"""Construit les tables de prix Cardmarket utilisées par l'app (dossier data/cardmarket/).

Cardmarket publie chaque jour deux fichiers officiels :
- la liste des cartes Pokémon (idProduct, nom + attaques, idExpansion) ;
- le guide des prix (moyennes 1, 7 et 30 jours, tendance…) par idProduct.
On les relie et on range les fiches par extension Cardmarket (un fichier par idExpansion) :
l'app y retrouve la carte par son nom et son rang, et affiche la moyenne 7 jours.
"""
import json, os, sys, urllib.request, gzip, io

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
# Le fichier des produits ne contient pas le numéro des cartes, mais l'extension Cardmarket
# (idExpansion) et le nom, suivi des attaques entre crochets : « Lugia EX [Aero Ball | Deep Hurricane] ».
# On range donc les fiches par extension ; l'app y retrouve la carte par son nom et, quand
# plusieurs fiches ont le même nom (ex : Lugia EX normale et Full Art), par leur ordre.
by_exp = {}
for p in plist:
    if p.get('idCategory') != 51:  # cartes Pokémon à l'unité uniquement
        continue
    g = guide.get(p.get('idProduct')) or {}
    full = p.get('name', '')
    base = full.split(' [')[0].strip()
    by_exp.setdefault(p.get('idExpansion'), []).append([
        p['idProduct'], base, full[len(base):].strip(' []') or None,
        g.get('avg7'), g.get('avg30'), g.get('avg'), g.get('trend'), g.get('avg7-holo'), g.get('avg30-holo')])
for rows in by_exp.values():
    rows.sort(key=lambda r: r[0])  # ordre de création chez Cardmarket
print(f'{sum(len(r) for r in by_exp.values())} cartes dans {len(by_exp)} extensions')
for exp in (1660, 6601):
    rows = by_exp.get(exp, [])
    print(f'extension {exp} : {len(rows)} fiches ; exemples :', json.dumps(rows[:3], ensure_ascii=False))
    print('   « Lugia » / « Charizard » :', json.dumps([r for r in rows if r[1].startswith(('Lugia', 'Charizard'))], ensure_ascii=False))

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.json'): os.remove(os.path.join(OUT, f))
for exp, rows in by_exp.items():
    with open(os.path.join(OUT, f'{exp}.json'), 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
    json.dump({'createdAt': prices.get('createdAt'),
               'champs': ['idProduct', 'nom', 'attaques', 'avg7', 'avg30', 'avg', 'trend', 'avg7-holo', 'avg30-holo'],
               'extensions': sorted(e for e in by_exp if e is not None)}, f, separators=(',', ':'))
print('écrit dans', OUT)
