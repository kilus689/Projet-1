# Robinpoké

Application web pour les cartes Pokémon. L'accueil présente les rubriques :

- **$ Détecteur** : on prend en photo une carte Pokémon (recto, et verso en option)
  et elle affiche son prix sur **Cardmarket**, ajusté selon l'état de la carte.
- **Sets** (icône Pokédex) : tous les sets Pokémon rangés par bloc (Méga-Évolution, Écarlate et Violet,
  Épée et Bouclier…), du plus récent au plus ancien, en français, anglais ou japonais.
  Toucher un set affiche ses cartes ; toucher une carte affiche son prix Cardmarket.

- **🔍 Recherche** : on tape le nom d'un Pokémon (dans n'importe quelle langue : « Sylveon » trouve
  aussi Nymphali) et toutes ses cartes s'affichent, rangées par bloc puis par set, du plus récent
  au plus ancien. Les noms proches sont distingués (« Mew » ne renvoie pas Mewtwo). Toucher une
  carte affiche son prix ; « voir le set » ouvre le set dans la rubrique Sets.

- **📒 Classeur** : deux classeurs fermés, **My folder** et **My dream** (nombre de cartes et valeur
  sur la couverture) ; on en touche un pour l'ouvrir. Chacun est un classeur pro de 20 pages
  × 9 cases (3×3, 180 cartes), affiché en double
  page (une page sur téléphone) avec des pages qui tournent (flèches ou glisser du doigt).
  Le bouton « ＋ Ajouter au classeur » de la Recherche et du Détecteur demande dans quel
  classeur ranger la carte, puis la place dans la première case libre. Valeur totale et valeur de chaque page (prix Cardmarket, actualisés
  chaque jour ou d'un toucher) ; toucher une carte pour voir son prix, la déplacer ou la retirer.
  Le classeur est enregistré sur l'appareil uniquement.

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
     langue détectée automatiquement (latin ou japonais), et l'état se choisit à la main.
     Pour fiabiliser la lecture :
     - le nom est lu sur plusieurs zones et réglages, puis corrigé grâce à un **dictionnaire des
       1 025 Pokémon** en 6 langues (`data/noms-pokemon.json`, d'après [PokéAPI](https://pokeapi.co)),
       en tenant compte des confusions typiques du japonais (二/ニ, 力/カ…) ; un nom peu sûr n'est
       gardé que s'il existe une carte de ce Pokémon dans un set de la taille lue ;
     - le numéro est lu une dizaine de fois avec des réglages différents, et la lecture la plus
       fréquente dont le total correspond à un vrai set l'emporte.
3. **Identification** : la carte est recherchée dans l'API gratuite [TCGdex](https://tcgdex.dev).
   Le numéro, le nombre de cartes de l'extension et le code d'extension départagent les versions.
4. **Prix** : le prix affiché est le **prix moyen 7 jours** de Cardmarket (sinon moyenne 30 j,
   générale, 1 j, puis tendance) — jamais le prix le plus bas. Le détail montre les moyennes
   7 j / 30 j / générale / 1 j et la tendance ; un avertissement signale deux cartes d'un même set
   reliées à la même fiche Cardmarket (erreur de la base),
   ainsi qu'un **prix par version** quand une carte en a plusieurs (normale, reverse, holo,
   tampon 30ᵉ anniversaire…). Un bouton ouvre la recherche sur Cardmarket pour vérifier.

## Données et mises à jour

Les prix et les images ne sont pas stockés dans l'app : ils sont lus **en direct** dans TCGdex
à chaque recherche. Dès que TCGdex ajoute une image ou met à jour un prix (environ une fois par
jour pour les prix), l'app l'affiche, sans mise à jour du logiciel.

- Les prix viennent du **guide des prix officiel de Cardmarket**, relu toutes les heures par TCGdex
  (les cartes des sets du 30ᵉ anniversaire y sont toutes reliées à leur produit Cardmarket).
- Si l'image d'une carte n'existe pas encore dans la langue choisie, l'app essaie l'image de la
  version anglaise, puis l'**image Cardmarket** du produit (numéro de produit et code d'extension
  donnés par TCGdex ; format d'adresse non garanti), puis une image « Image bientôt disponible ».
- « Voir sur Cardmarket » cherche le nom anglais de la carte suivi du code d'extension (ex : « Charizard 30C »).
- Les sets très récents (ex : sets du 30ᵉ anniversaire, sortis le 16/09/2026) peuvent avoir des
  images manquantes quelque temps : c'est la base TCGdex qui doit les ajouter.

Le nom, le numéro, la langue et l'état restent modifiables à la main.

**État de la carte** : Cardmarket ne publie qu'un prix global (surtout des ventes en très bon état),
donc l'app applique une décote estimée : Excellent ≈ 85 %, Good ≈ 70 %, Light Played ≈ 55 %,
Played ≈ 40 %, Poor ≈ 25 %.

## Lancer l'application

Fichiers statiques (`index.html`, `app.js`, `style.css`), aucune installation.

- **En ligne** : GitHub Pages (Settings → Pages → branche `scan-pokemon`, dossier `/`).
- **Sur ordinateur** : `python3 -m http.server 8000` puis <http://localhost:8000>.

### Mises à jour de l'app

Safari (et l'icône de l'écran d'accueil) garde parfois l'ancienne page en mémoire. À chaque ouverture,
l'app compare son numéro de version à celui de `version.json` sur GitHub et se recharge si elle est
en retard. **À chaque publication, augmenter ensemble** le numéro de `version.json`, `APP_VERSION`
dans `index.html` et les `?v=` des fichiers.

## Conseils pour une bonne lecture

- Carte à plat, bien éclairée, sans reflet, qui remplit tout le cadre jaune.
- Sans clé Claude, si le nom n'est pas lu, le numéro (ex : 059/103) suffit souvent :
  l'app cherche alors dans toutes les langues, japonais compris.

### Limites

- Prix indicatifs (mis à jour environ une fois par jour par TCGdex), l'ajustement selon l'état est une estimation.
- Cartes japonaises : beaucoup n'ont pas de prix Cardmarket dans TCGdex (extensions propres au Japon).
  Le lien Cardmarket utilise alors le nom anglais de la carte.
- L'estimation de l'état sur photo ne remplace pas un examen en main ou une gradation professionnelle.
