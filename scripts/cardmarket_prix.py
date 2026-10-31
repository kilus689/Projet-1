"""Construit les tables de prix Cardmarket utilisées par l'app (dossier data/cardmarket/).

Cardmarket publie chaque jour deux fichiers officiels :
- la liste des cartes Pokémon (idProduct, nom), dont le nom contient le code d'extension et le
  numéro, ex « Lugia EX (AOR 94) » ou « Mew (30C R/RGB) » ;
- le guide des prix (moyennes 1, 7 et 30 jours, tendance…) par idProduct.
On les relie pour obtenir, par code d'extension, une table « numéro → prix » : l'app y retrouve
une carte par son code et son numéro, et affiche la moyenne 7 jours de la bonne fiche.
"""
import json, os, re, sys, urllib.request, gzip, io

BASE = 'https://downloads.s3.cardmarket.com/productCatalog'
PRODUCTS = f'{BASE}/productList/products_singles_6.json'
PRICES = f'{BASE}/priceGuide/price_guide_6.json'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/cardmarket'

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Robinpoke-prix/1.0', 'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip' or raw[:2] == b'\x1f\x8b':
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    data = json.loads(raw)
    print(f'{url} : clés {list(data)[:6]}, version {data.get("version")}, créé {data.get("createdAt")}')
    return data

products = fetch(PRODUCTS)
prices = fetch(PRICES)
plist = products.get('products') or products.get('productList') or []
glist = prices.get('priceGuides') or []
print(f'{len(plist)} produits, {len(glist)} prix')
print('exemples de produits :', json.dumps(plist[:3], ensure_ascii=False))
print('exemple de prix :', json.dumps(glist[:1], ensure_ascii=False))

guide = {g['idProduct']: g for g in glist if 'idProduct' in g}
# « Nom (CODE NUMÉRO) » — le numéro peut contenir des lettres ou une barre (TG01, GG35, R/RGB, 059)
NAME_RE = re.compile(r'^(?P<name>.+?)\s*\((?P<code>[A-Za-z0-9:\.\-]+)\s+(?P<num>[A-Za-z0-9/\-]+)\)\s*$')
tables, unparsed = {}, []
for p in plist:
    m = NAME_RE.match(p.get('name', ''))
    if not m:
        if len(unparsed) < 15: unparsed.append(p.get('name'))
        continue
    g = guide.get(p.get('idProduct'))
    if not g:
        continue
    code = m['code'].upper()
    num = m['num'].upper().lstrip('0') or '0'
    entry = [p['idProduct'], m['name'],
             g.get('avg7'), g.get('avg30'), g.get('avg'), g.get('trend'),
             g.get('avg7-holo'), g.get('avg30-holo')]
    tables.setdefault(code, {}).setdefault(num, []).append(entry)

print(f'{sum(len(t) for t in tables.values())} cartes reliées dans {len(tables)} extensions')
print('noms non reconnus (exemples) :', unparsed)
for code in ('AOR', '30C', 'CRZ', 'MEW', 'SVI'):
    t = tables.get(code, {})
    print(f'  {code}: {len(t)} numéros', '— ex.', json.dumps(dict(list(t.items())[:2]), ensure_ascii=False) if t else '')

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.json'): os.remove(os.path.join(OUT, f))
safe = lambda c: re.sub(r'[^A-Za-z0-9_-]', '_', c)
for code, table in tables.items():
    with open(os.path.join(OUT, f'{safe(code)}.json'), 'w', encoding='utf-8') as f:
        json.dump(table, f, ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
    json.dump({'createdAt': prices.get('createdAt'), 'champs': ['idProduct', 'nom', 'avg7', 'avg30', 'avg', 'trend', 'avg7-holo', 'avg30-holo'],
               'extensions': {c: safe(c) for c in sorted(tables)}}, f, ensure_ascii=False, separators=(',', ':'))
print('écrit dans', OUT)
