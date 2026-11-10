'use strict';
// Réglages du joueur (commandes, aides, aéro, météo), partagés par la course rapide et la carrière.
(function () {
  const F1 = window.F1;
  const KEY = 'paddock-settings';
  const DEFAULTS = {
    sens: 'low',          // sensibilité de la direction : low | mid | high
    aero: 'auto',         // aéro active : auto | manual | off
    weather: 'dry',       // météo de la course rapide : dry | cloudy | rain | random
    difficulty: 'normal', // difficulté de l'IA
    tyreWear: 'normal',   // usure des pneus : off | normal | high
    damage: 'normal',     // dégâts : off | normal | high
    setup: { wing: 3, gear: 3, susp: 3 }, // réglages de la voiture (1 à 5)
    startTyre: 'M',       // pneus de départ du joueur : S | M | H
    assists: { brake: false, tc: true, steer: false, line: false, autoPit: false },
  };
  let cur = null;
  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
    cur = Object.assign({}, DEFAULTS, saved, { assists: Object.assign({}, DEFAULTS.assists, saved.assists), setup: Object.assign({}, DEFAULTS.setup, saved.setup) });
    return cur;
  }
  F1.Settings = {
    get() { return cur || load(); },
    set(patch) {
      const c = this.get();
      if (patch.assists) Object.assign(c.assists, patch.assists);
      if (patch.setup) Object.assign(c.setup, patch.setup);
      for (const k of Object.keys(patch)) if (k !== 'assists' && k !== 'setup') c[k] = patch[k];
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* stockage indisponible */ }
      return c;
    },
    // Sensibilité : vitesse de braquage au clavier/tactile (par seconde) et réduction à haute vitesse
    SENS: {
      low: { label: 'Faible', rate: 2.2, back: 4.5, highSpeedCut: 0.5, pad: 1.8 },
      mid: { label: 'Moyenne', rate: 3.5, back: 6, highSpeedCut: 0.38, pad: 1.5 },
      high: { label: 'Forte', rate: 6, back: 9, highSpeedCut: 0.25, pad: 1.2 },
    },
    AERO: { auto: 'Automatique', manual: 'Manuelle', off: 'Désactivée' },
    // Réglage conseillé selon le circuit : beaucoup de virages lents = plus d'aileron
    setupHint(track) {
      let sum = 0;
      for (let i = 0; i < track.n; i++) sum += Math.abs(track.k[i]);
      const avg = sum / track.n;
      const wing = avg > 0.0007 ? 5 : avg > 0.00058 ? 4 : avg > 0.00048 ? 3 : avg > 0.0004 ? 2 : 1;
      return { wing, gear: wing >= 4 ? 2 : wing <= 2 ? 4 : 3 };
    },
    WEAR: { off: 'Désactivée', normal: 'Normale', high: 'Forte' },
    DAMAGE: { off: 'Aucun', normal: 'Réduits', high: 'Réalistes' },
    WEATHER_CHOICES: { dry: '☀️ Sec', cloudy: '☁️ Nuageux', rain: '🌧️ Pluie', changing: '🌦️ Changeante', random: '🎲 Aléatoire' },
    // Probabilité de pluie par circuit (carrière et météo aléatoire)
    RAIN: { 'be-1925': 0.35, 'br-1940': 0.3, 'gb-1948': 0.3, 'jp-1962': 0.25, 'sg-2008': 0.2, 'ca-1978': 0.2, 'hu-1986': 0.15, 'nl-1948': 0.2, 'at-1969': 0.2, 'mc-1929': 0.12, 'au-1953': 0.15, 'cn-2004': 0.2, 'us-2022': 0.15, 'it-1922': 0.1, 'es-1991': 0.08, 'es-2026': 0.08, 'mx-1962': 0.12, 'us-2012': 0.1 },
    // « Pole 2026 : 1:12.051 — Kimi Antonelli » (ou estimation 2026 à partir d'une pole plus ancienne)
    poleText(gp) {
      const P = gp.pole;
      if (!P) return '';
      const who = P.by ? ` — ${P.by}` : '';
      if (P.est) return `Pole ${P.y} : ${F1.fmt(P.t)}${who} · équivalent 2026 estimé : ${F1.fmt(P.est)}`;
      return `Pole ${P.y} : ${F1.fmt(P.t)}${who}`;
    },
    poleRef(gp) { return gp.pole ? (gp.pole.est || gp.pole.t) : null; },
    rollWeather(gpId, rnd) {
      const r = (rnd || Math.random)();
      const p = this.RAIN[gpId] || 0.03;
      return r < p * 0.6 ? 'rain' : r < p * 1.2 ? 'changing' : r < p + 0.3 ? 'cloudy' : 'dry';
    },
  };
})();
