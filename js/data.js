'use strict';
// Données du jeu : circuits, écuries et pilotes (tous fictifs).
(function (root) {
  const F1 = root.F1 || (root.F1 = {});

  // Les points de contrôle sont reliés par une spline fermée (Catmull-Rom).
  // Le premier point est la ligne de départ / arrivée, sur une ligne droite.
  F1.TRACKS = [
    {
      id: 'lagons',
      name: 'Circuit des Lagons',
      desc: 'Rapide et fluide, idéal pour débuter.',
      scale: 125,
      width: 130,
      grass: ['#3f8f3a', '#46993f'],
      sand: '#d9c48f',
      points: [
        [20, 30], [10, 30], [5, 26], [5, 10], [8, 5], [14, 4], [18, 7], [20, 12],
        [24, 14], [30, 12], [33, 6], [38, 5], [42, 9], [41, 16], [36, 19], [32, 22],
        [32, 27], [28, 30],
      ],
    },
    {
      id: 'volcan',
      name: 'Anneau du Volcan',
      desc: 'Longues courbes à haute vitesse.',
      scale: 125,
      width: 125,
      grass: ['#4a7d34', '#52873a'],
      sand: '#7a6a5a',
      points: [
        [20, 32], [8, 32], [3, 26], [4, 18], [10, 14], [16, 16], [20, 12], [18, 6],
        [24, 2], [34, 3], [40, 8], [38, 16], [32, 18], [30, 24], [36, 28], [34, 33],
        [28, 34],
      ],
    },
    {
      id: 'corail',
      name: 'Côte de Corail',
      desc: 'Tracé technique et sinueux.',
      scale: 125,
      width: 120,
      grass: ['#3a8a52', '#41955a'],
      sand: '#ead7a8',
      points: [
        [18, 26], [6, 26], [3, 22], [4, 16], [9, 14], [9, 9], [5, 6], [8, 2],
        [16, 2], [18, 7], [15, 11], [20, 15], [27, 12], [26, 5], [32, 2], [38, 5],
        [38, 12], [33, 16], [34, 22], [30, 27],
      ],
    },
  ];

  F1.TEAMS = [
    { id: 'tiare', name: 'Tiare Racing', color: '#e63946', color2: '#f1faee' },
    { id: 'lagoon', name: 'Lagoon GP', color: '#00b4d8', color2: '#03045e' },
    { id: 'volcan', name: 'Volcan Motorsport', color: '#ff7b00', color2: '#1b1b1b' },
    { id: 'corail', name: 'Corail Speed', color: '#ff4d8d', color2: '#ffffff' },
    { id: 'atoll', name: 'Atoll Engineering', color: '#2ec4b6', color2: '#011627' },
    { id: 'nordwind', name: 'Nordwind', color: '#b8c0c8', color2: '#1d1d1d' },
    { id: 'aurora', name: 'Aurora Racing', color: '#7b2cbf', color2: '#ffd60a' },
    { id: 'sable', name: 'Sable Team', color: '#ffd60a', color2: '#14213d' },
  ];

  F1.DRIVERS = [
    'L. Moana', 'K. Varenne', 'S. Okafor', 'D. Lindqvist',
    'R. Tanaka', 'A. Castell', 'J. Mercer', 'N. Hereiti',
  ];

  F1.DIFFICULTIES = {
    facile: { label: 'Facile', skill: 0.84, power: 0.93 },
    normal: { label: 'Normal', skill: 0.93, power: 0.97 },
    difficile: { label: 'Difficile', skill: 1.0, power: 1.0 },
  };
})(typeof window !== 'undefined' ? window : globalThis);
