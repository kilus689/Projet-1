# Robinpoké

Application web pour les cartes Pokémon. L'accueil présente les rubriques :

- **$ Détecteur** : on prend en photo une carte Pokémon (recto, et verso en option)
  et elle affiche son prix sur **Cardmarket**, ajusté selon l'état de la carte.
- **Sets** (icône Pokédex) : tous les sets Pokémon rangés par bloc (Méga-Évolution, Écarlate et Violet,
  Épée et Bouclier…), du plus récent au plus ancien, en français, anglais ou japonais.
  Toucher un set affiche ses cartes ; toucher une carte affiche son prix Cardmarket.

D'autres rubriques viendront s'ajouter au menu d'accueil.

## Détecteur

### Fonctionnement

1. **Photos** : touche « Recto » (et « Verso » si tu veux l'état) : la caméra s'ouvre avec un
   cadre jaune où placer la carte, ce qui permet de lire le nom et le numéro au bon endroit.
   On peut aussi choisir une photo existante (le fond autour de la carte est alors retiré au mieux).
2. **Reconnaissance**, deux modes :
   - **Avec une clé Claude** (recommandé, réglages en bas de page) : l'IA lit la carte dans
     n'importe quelle langue (français, anglais, japonais…), son numéro et son code d'extension,
     et **estime son état** (Mint → Poor) en regardant coins, bords, surface et centrage du recto et du verso.
     Coût : quelques centimes par carte sur ton compte Anthropic. La clé reste sur l'appareil.
   - **Sans clé** : lecteur de texte gratuit ([Tesseract.js](https://tesseract.projectnaptha.com/)),
     langue détectée automatiquement (latin ou japonais). Moins fiable sur les cartes holo,
     et l'état se choisit à la main.
3. **Identification** : la carte est recherchée dans l'API gratuite [TCGdex](https://tcgdex.dev).
   Le numéro, le nombre de cartes de l'extension et le code d'extension départagent les versions.
4. **Prix** : TCGdex fournit les prix Cardmarket (tendance, moyennes 7 j / 30 j, prix le plus bas,
   versions holo/reverse). Un bouton ouvre la recherche sur Cardmarket pour vérifier.

Le nom, le numéro, la langue et l'état restent modifiables à la main.

**État de la carte** : Cardmarket ne publie qu'un prix global (surtout des ventes en très bon état),
donc l'app applique une décote estimée : Excellent ≈ 85 %, Good ≈ 70 %, Light Played ≈ 55 %,
Played ≈ 40 %, Poor ≈ 25 %.

## Lancer l'application

Fichiers statiques (`index.html`, `app.js`, `style.css`), aucune installation.

- **En ligne** : GitHub Pages (Settings → Pages → branche `scan-pokemon`, dossier `/`).
- **Sur ordinateur** : `python3 -m http.server 8000` puis <http://localhost:8000>.

### Conseils pour une bonne lecture

- Carte à plat, bien éclairée, sans reflet, qui remplit tout le cadre jaune.
- Sans clé Claude, si le nom n'est pas lu, le numéro (ex : 059/103) suffit souvent :
  l'app cherche alors dans toutes les langues, japonais compris.

### Limites

- Prix indicatifs (mis à jour environ une fois par jour par TCGdex), l'ajustement selon l'état est une estimation.
- Cartes japonaises : beaucoup n'ont pas de prix Cardmarket dans TCGdex (extensions propres au Japon).
  Le lien Cardmarket utilise alors le nom anglais de la carte.
- L'estimation de l'état sur photo ne remplace pas un examen en main ou une gradation professionnelle.
