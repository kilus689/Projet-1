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

## Modes de jeu

### Course rapide
Choisissez le circuit, le pilote, la distance (3 tours, 5 tours, 25 %, 50 % ou 100 %),
la difficulté, et des qualifications jouées ou simulées.

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

## Calendrier

Le jeu reprend les 24 manches du calendrier 2026 publié en 2025. Les Grands Prix de Bahreïn et
d'Arabie saoudite ont ensuite été annulés pendant la saison réelle ; ils sont conservés dans le jeu.

## Crédits

Tracés des circuits : jeu de données [f1-circuits](https://github.com/bacinger/f1-circuits)
de Tomislav Bacinger, sous licence MIT (voir `THIRD_PARTY_NOTICES.md`).
