'use strict';
// Saison 2026 : calendrier, écuries, pilotes.
// Les notes (pilotes, voitures) sont des estimations propres au jeu.
(function (root) {
  const F1 = root.F1 || (root.F1 = {});

  // env : park | circuit | desert | street — influence le décor et les dégagements.
  // laps : nombre de tours de la vraie course (option « distance réelle »).
  F1.CALENDAR = [
    { id: 'au-1953', gp: 'Grand Prix d\'Australie', place: 'Melbourne', circuit: 'Albert Park', flag: '🇦🇺', laps: 58, env: 'park', width: 130 },
    { id: 'cn-2004', gp: 'Grand Prix de Chine', place: 'Shanghai', circuit: 'Shanghai International Circuit', flag: '🇨🇳', laps: 56, env: 'circuit', width: 140 },
    { id: 'jp-1962', gp: 'Grand Prix du Japon', place: 'Suzuka', circuit: 'Suzuka', flag: '🇯🇵', laps: 53, env: 'circuit', width: 120 },
    { id: 'bh-2002', gp: 'Grand Prix de Bahreïn', place: 'Sakhir', circuit: 'Bahrain International Circuit', flag: '🇧🇭', laps: 57, env: 'desert', width: 140 },
    { id: 'sa-2021', gp: 'Grand Prix d\'Arabie saoudite', place: 'Djeddah', circuit: 'Jeddah Corniche', flag: '🇸🇦', laps: 50, env: 'street', width: 125 },
    { id: 'us-2022', gp: 'Grand Prix de Miami', place: 'Miami', circuit: 'Miami International Autodrome', flag: '🇺🇸', laps: 57, env: 'street', width: 130 },
    { id: 'ca-1978', gp: 'Grand Prix du Canada', place: 'Montréal', circuit: 'Circuit Gilles-Villeneuve', flag: '🇨🇦', laps: 70, env: 'park', width: 125 },
    { id: 'mc-1929', gp: 'Grand Prix de Monaco', place: 'Monte-Carlo', circuit: 'Circuit de Monaco', flag: '🇲🇨', laps: 78, env: 'street', width: 105 },
    { id: 'es-1991', gp: 'Grand Prix de Barcelone-Catalogne', place: 'Barcelone', circuit: 'Circuit de Barcelona-Catalunya', flag: '🇪🇸', laps: 66, env: 'circuit', width: 130 },
    { id: 'at-1969', gp: 'Grand Prix d\'Autriche', place: 'Spielberg', circuit: 'Red Bull Ring', flag: '🇦🇹', laps: 71, env: 'circuit', width: 130 },
    { id: 'gb-1948', gp: 'Grand Prix de Grande-Bretagne', place: 'Silverstone', circuit: 'Silverstone', flag: '🇬🇧', laps: 52, env: 'circuit', width: 140 },
    { id: 'be-1925', gp: 'Grand Prix de Belgique', place: 'Spa-Francorchamps', circuit: 'Spa-Francorchamps', flag: '🇧🇪', laps: 44, env: 'park', width: 130 },
    { id: 'hu-1986', gp: 'Grand Prix de Hongrie', place: 'Budapest', circuit: 'Hungaroring', flag: '🇭🇺', laps: 70, env: 'circuit', width: 125 },
    { id: 'nl-1948', gp: 'Grand Prix des Pays-Bas', place: 'Zandvoort', circuit: 'Zandvoort', flag: '🇳🇱', laps: 72, env: 'park', width: 120 },
    { id: 'it-1922', gp: 'Grand Prix d\'Italie', place: 'Monza', circuit: 'Autodromo Nazionale Monza', flag: '🇮🇹', laps: 53, env: 'park', width: 130 },
    { id: 'es-2026', gp: 'Grand Prix d\'Espagne', place: 'Madrid', circuit: 'Madring', flag: '🇪🇸', laps: 57, env: 'street', width: 125 },
    { id: 'az-2016', gp: 'Grand Prix d\'Azerbaïdjan', place: 'Bakou', circuit: 'Baku City Circuit', flag: '🇦🇿', laps: 51, env: 'street', width: 120 },
    { id: 'sg-2008', gp: 'Grand Prix de Singapour', place: 'Singapour', circuit: 'Marina Bay', flag: '🇸🇬', laps: 62, env: 'street', width: 120 },
    { id: 'us-2012', gp: 'Grand Prix des États-Unis', place: 'Austin', circuit: 'Circuit of the Americas', flag: '🇺🇸', laps: 56, env: 'circuit', width: 140 },
    { id: 'mx-1962', gp: 'Grand Prix de Mexico', place: 'Mexico', circuit: 'Autódromo Hermanos Rodríguez', flag: '🇲🇽', laps: 71, env: 'park', width: 130 },
    { id: 'br-1940', gp: 'Grand Prix de São Paulo', place: 'São Paulo', circuit: 'Interlagos', flag: '🇧🇷', laps: 71, env: 'park', width: 130 },
    { id: 'us-2023', gp: 'Grand Prix de Las Vegas', place: 'Las Vegas', circuit: 'Las Vegas Strip Circuit', flag: '🇺🇸', laps: 50, env: 'street', width: 130 },
    { id: 'qa-2004', gp: 'Grand Prix du Qatar', place: 'Lusail', circuit: 'Lusail International Circuit', flag: '🇶🇦', laps: 57, env: 'desert', width: 135 },
    { id: 'ae-2009', gp: 'Grand Prix d\'Abu Dhabi', place: 'Yas Marina', circuit: 'Yas Marina', flag: '🇦🇪', laps: 58, env: 'desert', width: 135 },
  ];

  F1.ENGINES = {
    mercedes: { name: 'Mercedes', power: 88 },
    ferrari: { name: 'Ferrari', power: 86 },
    rbford: { name: 'Red Bull Ford', power: 83 },
    honda: { name: 'Honda', power: 82 },
    audi: { name: 'Audi', power: 80 },
  };

  // perf : aéro, châssis, fiabilité (0-100). Le moteur vient du motoriste.
  // budget en millions d'euros (mode écurie).
  F1.TEAMS2026 = [
    { id: 'mclaren', name: 'McLaren', color: '#ff8000', color2: '#1d2b3a', engine: 'mercedes', aero: 90, chassis: 89, reliability: 88, budget: 150, prestige: 92 },
    { id: 'mercedes', name: 'Mercedes', color: '#00d2be', color2: '#1a1a1a', engine: 'mercedes', aero: 90, chassis: 90, reliability: 90, budget: 150, prestige: 94 },
    { id: 'ferrari', name: 'Ferrari', color: '#e8002d', color2: '#ffeb3b', engine: 'ferrari', aero: 88, chassis: 87, reliability: 85, budget: 150, prestige: 98 },
    { id: 'redbull', name: 'Red Bull Racing', color: '#1e3a8a', color2: '#e8002d', engine: 'rbford', aero: 89, chassis: 87, reliability: 83, budget: 150, prestige: 93 },
    { id: 'aston', name: 'Aston Martin', color: '#00594f', color2: '#cedc00', engine: 'honda', aero: 84, chassis: 82, reliability: 80, budget: 140, prestige: 82 },
    { id: 'williams', name: 'Williams', color: '#1868db', color2: '#0b1a33', engine: 'mercedes', aero: 81, chassis: 82, reliability: 85, budget: 120, prestige: 80 },
    { id: 'alpine', name: 'Alpine', color: '#0090ff', color2: '#ff87bc', engine: 'mercedes', aero: 79, chassis: 79, reliability: 84, budget: 125, prestige: 76 },
    { id: 'racingbulls', name: 'Racing Bulls', color: '#f5f5f5', color2: '#3d5afe', engine: 'rbford', aero: 81, chassis: 80, reliability: 82, budget: 115, prestige: 72 },
    { id: 'haas', name: 'Haas', color: '#dfe3e6', color2: '#da1e28', engine: 'ferrari', aero: 79, chassis: 79, reliability: 82, budget: 105, prestige: 70 },
    { id: 'audi', name: 'Audi', color: '#a6a8ab', color2: '#e1001a', engine: 'audi', aero: 78, chassis: 79, reliability: 76, budget: 135, prestige: 78 },
    { id: 'cadillac', name: 'Cadillac', color: '#111111', color2: '#d4d4d4', engine: 'ferrari', aero: 74, chassis: 75, reliability: 78, budget: 120, prestige: 68 },
  ];

  // pace : vitesse pure, craft : combativité/gestion de course (0-100)
  F1.DRIVERS2026 = [
    { id: 'nor', first: 'Lando', last: 'Norris', code: 'NOR', num: 1, flag: '🇬🇧', team: 'mclaren', pace: 93, craft: 89, born: 1999 },
    { id: 'pia', first: 'Oscar', last: 'Piastri', code: 'PIA', num: 81, flag: '🇦🇺', team: 'mclaren', pace: 91, craft: 89, born: 2001 },
    { id: 'rus', first: 'George', last: 'Russell', code: 'RUS', num: 63, flag: '🇬🇧', team: 'mercedes', pace: 91, craft: 89, born: 1998 },
    { id: 'ant', first: 'Andrea Kimi', last: 'Antonelli', code: 'ANT', num: 12, flag: '🇮🇹', team: 'mercedes', pace: 87, craft: 82, born: 2006 },
    { id: 'lec', first: 'Charles', last: 'Leclerc', code: 'LEC', num: 16, flag: '🇲🇨', team: 'ferrari', pace: 93, craft: 87, born: 1997 },
    { id: 'ham', first: 'Lewis', last: 'Hamilton', code: 'HAM', num: 44, flag: '🇬🇧', team: 'ferrari', pace: 88, craft: 93, born: 1985 },
    { id: 'ver', first: 'Max', last: 'Verstappen', code: 'VER', num: 3, flag: '🇳🇱', team: 'redbull', pace: 96, craft: 95, born: 1997 },
    { id: 'had', first: 'Isack', last: 'Hadjar', code: 'HAD', num: 6, flag: '🇫🇷', team: 'redbull', pace: 85, craft: 81, born: 2004 },
    { id: 'alo', first: 'Fernando', last: 'Alonso', code: 'ALO', num: 14, flag: '🇪🇸', team: 'aston', pace: 86, craft: 94, born: 1981 },
    { id: 'str', first: 'Lance', last: 'Stroll', code: 'STR', num: 18, flag: '🇨🇦', team: 'aston', pace: 78, craft: 80, born: 1998 },
    { id: 'alb', first: 'Alexander', last: 'Albon', code: 'ALB', num: 23, flag: '🇹🇭', team: 'williams', pace: 85, craft: 86, born: 1996 },
    { id: 'sai', first: 'Carlos', last: 'Sainz', code: 'SAI', num: 55, flag: '🇪🇸', team: 'williams', pace: 87, craft: 89, born: 1994 },
    { id: 'gas', first: 'Pierre', last: 'Gasly', code: 'GAS', num: 10, flag: '🇫🇷', team: 'alpine', pace: 85, craft: 85, born: 1996 },
    { id: 'col', first: 'Franco', last: 'Colapinto', code: 'COL', num: 43, flag: '🇦🇷', team: 'alpine', pace: 79, craft: 77, born: 2003 },
    { id: 'law', first: 'Liam', last: 'Lawson', code: 'LAW', num: 30, flag: '🇳🇿', team: 'racingbulls', pace: 81, craft: 80, born: 2002 },
    { id: 'lin', first: 'Arvid', last: 'Lindblad', code: 'LIN', num: 41, flag: '🇬🇧', team: 'racingbulls', pace: 79, craft: 75, born: 2007 },
    { id: 'oco', first: 'Esteban', last: 'Ocon', code: 'OCO', num: 31, flag: '🇫🇷', team: 'haas', pace: 82, craft: 84, born: 1996 },
    { id: 'bea', first: 'Oliver', last: 'Bearman', code: 'BEA', num: 87, flag: '🇬🇧', team: 'haas', pace: 83, craft: 80, born: 2005 },
    { id: 'hul', first: 'Nico', last: 'Hülkenberg', code: 'HUL', num: 27, flag: '🇩🇪', team: 'audi', pace: 83, craft: 86, born: 1987 },
    { id: 'bor', first: 'Gabriel', last: 'Bortoleto', code: 'BOR', num: 5, flag: '🇧🇷', team: 'audi', pace: 82, craft: 79, born: 2004 },
    { id: 'per', first: 'Sergio', last: 'Pérez', code: 'PER', num: 11, flag: '🇲🇽', team: 'cadillac', pace: 82, craft: 87, born: 1990 },
    { id: 'bot', first: 'Valtteri', last: 'Bottas', code: 'BOT', num: 77, flag: '🇫🇮', team: 'cadillac', pace: 83, craft: 84, born: 1989 },
  ];

  // Pilotes libres (fictifs) disponibles pour une nouvelle écurie ou pour remplacer un titulaire
  F1.FREE_AGENTS = [
    { id: 'fa1', first: 'Matteo', last: 'Ravelli', code: 'RAV', num: 21, flag: '🇮🇹', pace: 78, craft: 74, born: 2004 },
    { id: 'fa2', first: 'Hugo', last: 'Delmas', code: 'DEL', num: 29, flag: '🇫🇷', pace: 77, craft: 76, born: 2003 },
    { id: 'fa3', first: 'Kenji', last: 'Moriyama', code: 'MOR', num: 8, flag: '🇯🇵', pace: 77, craft: 73, born: 2005 },
    { id: 'fa4', first: 'Lucas', last: 'Brennan', code: 'BRE', num: 34, flag: '🇺🇸', pace: 76, craft: 75, born: 2002 },
    { id: 'fa5', first: 'Teva', last: 'Maraetaata', code: 'MAR', num: 69, flag: '🇵🇫', pace: 75, craft: 72, born: 2006 },
    { id: 'fa6', first: 'Jonas', last: 'Vik', code: 'VIK', num: 19, flag: '🇳🇴', pace: 76, craft: 78, born: 2000 },
    { id: 'fa7', first: 'Rafael', last: 'Quintero', code: 'QUI', num: 28, flag: '🇨🇴', pace: 74, craft: 77, born: 1999 },
    { id: 'fa8', first: 'Elias', last: 'Hartmann', code: 'HAR', num: 50, flag: '🇩🇪', pace: 75, craft: 74, born: 2004 },
  ];

  F1.POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

  F1.DIFFICULTIES = {
    facile: { label: 'Facile', skill: 0.86, quali: 1.035 },
    normal: { label: 'Normal', skill: 0.93, quali: 1.015 },
    difficile: { label: 'Difficile', skill: 0.98, quali: 1.0 },
    expert: { label: 'Expert', skill: 1.02, quali: 0.99 },
  };

  F1.RACE_LENGTHS = [
    { id: '3', label: '3 tours', laps: () => 3 },
    { id: '5', label: '5 tours', laps: () => 5 },
    { id: '25', label: '25 %', laps: (gp) => Math.max(3, Math.round(gp.laps * 0.25)) },
    { id: '50', label: '50 %', laps: (gp) => Math.max(3, Math.round(gp.laps * 0.5)) },
    { id: '100', label: '100 %', laps: (gp) => gp.laps },
  ];

  F1.NATIONS = ['🇫🇷', '🇵🇫', '🇧🇪', '🇨🇭', '🇨🇦', '🇬🇧', '🇩🇪', '🇪🇸', '🇮🇹', '🇳🇱', '🇺🇸', '🇧🇷', '🇦🇷', '🇲🇽', '🇯🇵', '🇦🇺', '🇳🇿', '🇲🇨', '🇫🇮', '🇩🇰', '🇵🇹', '🇨🇳', '🇹🇭', '🇿🇦'];
})(typeof window !== 'undefined' ? window : globalThis);
