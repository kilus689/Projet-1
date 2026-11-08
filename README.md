# Grand Prix des Îles

Jeu de course de monoplaces (style Formule 1) en vue de dessus, jouable directement dans le navigateur.
HTML5 Canvas + JavaScript, **aucune dépendance ni étape de compilation**.

## Lancer le jeu

Ouvrez `index.html` dans un navigateur, ou servez le dossier en local :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Fonctionnalités

- 3 circuits originaux : Circuit des Lagons, Anneau du Volcan, Côte de Corail
- 8 monoplaces sur la grille : vous + 7 adversaires pilotés par l'IA (trajectoire, freinage, évitement)
- Feux de départ, chronos au tour, meilleur tour, classement en direct avec écarts, mini-carte
- 3 niveaux de difficulté, 1 / 3 / 5 / 10 tours, choix de l'écurie et du nom du pilote
- Physique arcade : adhérence, dérapage, bacs à sable, murs de pneus, collisions
- Traces de pneus, poussière, sons de moteur synthétisés (Web Audio)
- Records par circuit sauvegardés dans le navigateur
- Clavier, manette et commandes tactiles (mobile)

## Commandes

| Action | Clavier | Manette |
| --- | --- | --- |
| Accélérer | ↑ / W / Z | RT / A |
| Freiner, marche arrière | ↓ / S | LT / B |
| Tourner | ← → / A Q D | Stick gauche |
| Se replacer sur la piste | R | |
| Pause | Échap / P | Start |
| Couper le son | M | |

## Structure

```
index.html        Page, HUD et menus
css/style.css     Styles
js/data.js        Circuits, écuries, pilotes, difficultés
js/core.js        Simulation : piste, physique, IA, logique de course (sans DOM)
js/render.js      Rendu Canvas (piste, décor, voitures, effets, mini-carte)
js/audio.js       Sons synthétisés
js/game.js        Boucle de jeu, entrées, interface
```

### Ajouter un circuit

Ajoutez une entrée dans `F1.TRACKS` (`js/data.js`) : une liste de points de contrôle
reliés par une spline fermée. Le premier point est la ligne de départ et doit se trouver
sur une ligne droite. Évitez que deux portions de piste passent à moins d'environ
4 unités l'une de l'autre (avec `scale: 125`).

Toutes les écuries, pilotes et circuits sont fictifs.
