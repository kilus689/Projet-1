# Paddock 2026

Jeu de course de monoplaces en vue de dessus, avec mode carrière, sur la saison 2026.
HTML5 Canvas + JavaScript, **aucune dépendance ni étape de compilation**.

> Jeu de fan non officiel, sans lien avec la Formule 1, la FIA, les écuries ou les pilotes.
> Aucun logo ni élément graphique officiel n'est utilisé. Les notes des pilotes et des voitures
> sont des estimations propres au jeu.

## Lancer le jeu

Ouvrez `index.html` dans un navigateur, ou servez le dossier en local :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Contenu

- **24 circuits du calendrier 2026**, aux tracés réels (de Melbourne à Abu Dhabi, Madring compris).
  Échelle réelle : 1 px = 10 cm, longueurs à ±1 % des longueurs officielles.
- **11 écuries et 22 pilotes 2026** (numéros de l'engagement officiel), plus 8 pilotes libres fictifs.
- Décor selon le circuit : parc, circuit permanent, désert ou circuit urbain (murs, immeubles).
- **Relief réel** : altitude issue de données ouvertes (Terrain Tiles), filtrée pour garder le
  niveau du sol et limiter la pente à 16 %. Dénivelés : Spa 104 m, Autriche 60 m, Monaco 50 m,
  Suzuka 43 m (avec le pont du croisement), Interlagos 41 m… La gravité agit sur les voitures
  (ralentissement en montée, accélération en descente). Le relief de Singapour est réduit car
  les données y sont faussées par les immeubles.

## Modes de jeu

### Course rapide
En 4 étapes : **circuit** (liste des 24 Grands Prix avec le drapeau du pays) → **écurie** →
**pilote** de l'écurie → **réglages** : météo (sec, nuageux, pluie, aléatoire), difficulté de l'IA,
aides au pilotage, sensibilité de la direction, aéro active, distance et qualifications.

### Habillage télé et arrêts au stand
- **Habillage pendant la course** (style propre au jeu) : tour de classement avec écarts, gomme
  et nombre d'arrêts de chaque pilote, mention STAND, meilleur tour ; compteur de tours et météo ;
  bandeaux (pilote sur la grille, duels à moins de 0,6 s, meilleur tour, arrêts, dernier tour, arrivée).
- **Pneus** : tendres (T), médiums (M), durs (D) et intermédiaires (I) sous la pluie. L'usure fait
  perdre de l'adhérence ; elle est calculée sur la distance de la course, donc une course courte
  demande aussi un arrêt. Réglages : usure désactivée / normale / forte, gomme de départ.
- **Arrêts au stand** : STAND / touche B pour rentrer au prochain passage, choix de la gomme
  (T, M, D, I ou touches 1 à 4). Voie des stands limitée à 80 km/h, arrêt d'environ 2,5 s au garage
  de l'écurie (perte totale d'environ 24 s). L'IA s'arrête selon l'usure et choisit sa gomme.

### Batterie, aéro active, météo et aides
- **Batterie (ERS)** : se vide en accélérant, se recharge au freinage et au lever de pied ;
  batterie vide = perte de puissance. **Boost** (⚡ / touche E) : plus de puissance, consommation accrue.
  L'IA gère aussi sa batterie et utilise le boost pour attaquer.
- **Aéro active** (lignes droites de plus de 300 m) : moins de traînée et plus de vitesse, mais
  moins d'adhérence ; se referme au freinage. Modes : automatique, manuel (AÉRO / Espace), désactivé.
- **Météo** : la pluie réduit l'adhérence, le freinage et la motricité (IA comprise). En carrière,
  la météo est tirée selon le climat du circuit (pluie fréquente à Spa, Interlagos, Silverstone…).
- **Aides** : freinage assisté, antipatinage / stabilité, direction assistée, trajectoire idéale
  (verte, rouge aux freinages). **Sensibilité de la direction** : faible, moyenne ou forte
  (rampe de braquage et braquage réduit à haute vitesse).

### Carrière
- **Mode pilote**
  - incarner l'un des 22 pilotes 2026 dans son écurie ;
  - ou **créer une nouvelle écurie** (la 12e : nom, couleurs, motoriste), puis **créer son pilote**
    ou **recruter un pilote 2026** (un pilote libre le remplace dans son ancienne écurie).
  - Réputation, duel avec le coéquipier, offres de contrat en fin de saison.
- **Mode écurie**
  - reprendre l'une des 11 écuries 2026 ;
  - ou **créer la 12e écurie** et recruter deux pilotes (pilotes libres ou pilote créé).
  - Budget, développement de la voiture (aéro, châssis, fiabilité), choix du pilote piloté.

Chaque Grand Prix : qualifications puis course, chacune **jouée ou simulée**.
Barème 25-18-15-12-10-8-6-4-2-1, classements pilotes et constructeurs, calendrier avec résultats,
enchaînement des saisons (évolution des pilotes et des voitures). Sauvegarde automatique dans le navigateur.

## Caméras

Touche **C** ou bouton 🎥 pendant une séance (le choix est mémorisé) :

- **Vue de dessus** : carte fixe, nord en haut.
- **Vue de dessus (suit la voiture)** : la voiture pointe toujours vers le haut de l'écran.
- **Caméra poursuite** (3D) : derrière la voiture.
- **Caméra embarquée** (3D) : au-dessus du pilote.
- **Cockpit** (3D) : à la place du pilote, avec halo et volant.

Les vues 3D utilisent [three.js](https://threejs.org) (inclus dans `js/vendor/`, licence MIT).

## Commandes

| Action | Clavier | Manette |
| --- | --- | --- |
| Accélérer | ↑ / W / Z | RT / A |
| Freiner, marche arrière | ↓ / S | LT / B |
| Tourner | ← → / A Q D | Stick gauche |
| Se replacer sur la piste | R | |
| Pause | Échap / P | Start |
| Boost (batterie) | E / Maj | RB |
| Aéro active (mode manuel) | Espace | LB |
| Arrêt au stand / choix des pneus | B / 1 à 4 | |
| Couper le son | M | |
| Changer de caméra | C | |

Sur mobile, des boutons tactiles s'affichent à l'écran.

## Structure

```
index.html            Page, HUD
css/style.css         Styles
js/data/circuits.js   Tracés des 24 circuits (générés depuis les données GeoJSON)
js/data/season2026.js Calendrier, écuries, pilotes, motoristes, barème
js/core.js            Simulation : piste, physique, IA, course (sans DOM, testable avec Node)
js/career.js          Carrière : création, simulation des séances, points, budget, saisons
js/render.js          Rendu Canvas (piste, décor, voitures, effets, mini-carte)
js/audio.js           Sons synthétisés (Web Audio)
js/session.js         Boucle de jeu, entrées, séances pilotées
js/ui.js              Menus et tableau de bord de la carrière
```

## Ligne de départ et stands

Le départ et la voie des stands sont placés sur la ligne droite principale. Corrections faites
à partir de sources publiques : Monaco (ligne sur le boulevard Albert Ier, stands côté port,
entrée avant Anthony-Noghès, sortie après Sainte-Dévote), Las Vegas (200 m de la pole au virage 1)
et Bakou (138 m entre la grille et le virage 1). Réglages par circuit dans `js/data/season2026.js`
(`startShift`, `pitSide`, `pitEntry`, `pitExit`).

## Calendrier

Le jeu reprend les 24 manches du calendrier 2026 publié en 2025. Les Grands Prix de Bahreïn et
d'Arabie saoudite ont ensuite été annulés pendant la saison réelle ; ils sont conservés dans le jeu.

## Crédits

Tracés des circuits : jeu de données [f1-circuits](https://github.com/bacinger/f1-circuits)
de Tomislav Bacinger, sous licence MIT (voir `THIRD_PARTY_NOTICES.md`).
