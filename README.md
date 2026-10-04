# Projet-1 — Scan Pokémon

Petite application web : on prend en photo une carte Pokémon et elle affiche son prix sur **Cardmarket**.

## Fonctionnement

1. **Photo** : caméra du téléphone avec un cadre de visée, ou import d'une photo.
2. **Lecture** : le nom (haut de la carte) et le numéro (`006/165`, bas de la carte) sont lus
   directement dans le navigateur avec [Tesseract.js](https://tesseract.projectnaptha.com/).
   Aucune image n'est envoyée sur un serveur.
3. **Identification** : la carte est recherchée dans l'API gratuite [TCGdex](https://tcgdex.dev)
   (cartes en français, anglais, japonais, etc.). Le numéro et le nombre de cartes de l'extension
   servent à départager les versions d'un même Pokémon.
4. **Prix** : TCGdex fournit les prix Cardmarket (tendance, moyennes 7 j / 30 j, prix le plus bas,
   versions holo/reverse). Un bouton ouvre la recherche sur Cardmarket pour vérifier.

Le nom et le numéro lus restent modifiables si la lecture s'est trompée.

**État de la carte** : on choisit Mint, Near Mint, Excellent, Good, Light Played, Played ou Poor.
Cardmarket ne publie qu'un prix global (surtout des ventes en très bon état), donc l'app applique
une décote estimée : Excellent ≈ 85 %, Good ≈ 70 %, Light Played ≈ 55 %, Played ≈ 40 %, Poor ≈ 25 %.

## Lancer l'application

Aucune installation n'est nécessaire, ce sont des fichiers statiques (`index.html`, `app.js`, `style.css`).

- **Sur ordinateur** : `python3 -m http.server 8000` puis ouvrir <http://localhost:8000>.
- **Sur téléphone** : la caméra exige une adresse **https**. Le plus simple est d'activer
  GitHub Pages sur ce dépôt (Settings → Pages → branche `main`, dossier `/`).
  Le bouton « Choisir une photo » marche partout, même sans https.

## Conseils pour une bonne lecture

- Carte à plat, bien éclairée, sans reflet, qui remplit le cadre jaune.
- Choisir la langue de la carte **avant** la photo (surtout pour le japonais).

## Limites

- Les prix sont ceux publiés par TCGdex à partir de Cardmarket (mis à jour environ une fois par jour) :
  ils sont indicatifs. L'état de la carte (Near Mint, Played…) n'est pas pris en compte.
- Cartes japonaises : beaucoup n'ont pas de prix Cardmarket dans TCGdex (extensions propres au Japon).
  L'app l'indique et propose le lien Cardmarket pour vérifier.
- Cardmarket ne propose pas d'API publique ouverte : les prix viennent donc de TCGdex.
