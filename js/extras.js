'use strict';
// Records par circuit, défis du week-end, messages radio de l'ingénieur, fantôme du contre-la-montre
// et enregistrement des ralentis. Tout est stocké uniquement sur l'appareil (localStorage).
(function () {
  const F1 = window.F1;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou indisponible */ } };
  const hash = (s) => { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };

  // ---------- Records ----------
  F1.Records = {
    all() { return load('paddock-records', {}); },
    // kind : 'lap' (qualifs, contre-la-montre) ou 'raceLap' (meilleur tour en course)
    lap(gpId, t, kind) {
      if (!(t > 0 && t < 9000)) return false;
      const R = this.all(), r = (R[gpId] = R[gpId] || {}), key = kind || 'lap';
      const better = !r[key] || t < r[key];
      if (better) r[key] = t;
      save('paddock-records', R);
      return better;
    },
    race(gpId, pos, dnf) {
      const R = this.all(), r = (R[gpId] = R[gpId] || {});
      r.races = (r.races || 0) + 1;
      if (dnf) r.dnfs = (r.dnfs || 0) + 1;
      else {
        if (pos === 1) r.wins = (r.wins || 0) + 1;
        if (pos <= 3) r.podiums = (r.podiums || 0) + 1;
        r.bestPos = Math.min(r.bestPos || 99, pos);
      }
      save('paddock-records', R);
    },
    totals() {
      const R = this.all(), t = { races: 0, wins: 0, podiums: 0, dnfs: 0, challenges: Object.keys(F1.Challenges.done()).length };
      for (const r of Object.values(R)) { t.races += r.races || 0; t.wins += r.wins || 0; t.podiums += r.podiums || 0; t.dnfs += r.dnfs || 0; }
      return t;
    },
  };

  // ---------- Difficulté adaptative ----------
  F1.Adapt = {
    get level() { const v = parseFloat(localStorage.getItem('paddock-adapt')); return v > 0 ? v : 1; },
    set level(v) { try { localStorage.setItem('paddock-adapt', String(Math.max(0.9, Math.min(1.1, v)))); } catch (e) { /* ignoré */ } },
    // Après chaque course : on rapproche les IA de votre niveau
    afterRace(pos, dnf) {
      const d = dnf ? -0.01 : pos <= 2 ? 0.015 : pos <= 5 ? 0.006 : pos >= 14 ? -0.015 : pos >= 10 ? -0.006 : 0;
      this.level = this.level + d;
    },
    label() { return Math.round(this.level * 100) + ' %'; },
  };

  // ---------- Défis du week-end ----------
  F1.Challenges = {
    LIST: {
      win: { text: 'Gagner la course', test: (r) => !r.dnf && r.pos === 1 },
      podium: { text: 'Finir sur le podium', test: (r) => !r.dnf && r.pos <= 3 },
      top10: { text: 'Marquer des points (top 10)', test: (r) => !r.dnf && r.pos <= 10 },
      gain5: { text: 'Gagner au moins 5 places', test: (r) => !r.dnf && r.grid - r.pos >= 5 },
      gain3: { text: 'Gagner au moins 3 places', test: (r) => !r.dnf && r.grid - r.pos >= 3 },
      fastest: { text: 'Signer le meilleur tour en course', test: (r) => r.fastest },
      clean: { text: 'Finir sans pénalité ni gros dégât', test: (r) => !r.dnf && !r.penalty && r.maxDmg < 0.5 },
      onestop: { text: 'Finir avec un arrêt au stand au plus', test: (r) => !r.dnf && r.stops <= 1 },
    },
    // Défi adapté à la position de départ (change chaque jour et selon le circuit)
    pick(gpId, grid) {
      const pools = grid <= 3 ? ['win', 'fastest', 'clean'] : grid <= 8 ? ['podium', 'fastest', 'clean', 'gain3'] : grid <= 14 ? ['top10', 'gain5', 'clean', 'onestop'] : ['gain5', 'top10', 'onestop'];
      const day = Math.floor(Date.now() / 86400000);
      const id = pools[hash(gpId + day) % pools.length];
      return { id, text: this.LIST[id].text };
    },
    check(ch, r) { return !!(ch && this.LIST[ch.id] && this.LIST[ch.id].test(r)); },
    done() { return load('paddock-challenges', {}); },
    mark(gpId, ch) {
      const D = this.done();
      D[gpId + ':' + ch.id] = Date.now();
      save('paddock-challenges', D);
    },
  };

  // ---------- Radio de l'ingénieur ----------
  let radioT = 0, lastSay = 0, voice = null;
  F1.Radio = {
    enabled() { return F1.Settings.get().radio !== 'off'; },
    voiceOn() { return F1.Settings.get().radio === 'voice'; },
    say(text, prio) {
      if (!this.enabled()) return;
      const now = performance.now();
      if (!prio && now - lastSay < 7000) return;
      lastSay = now;
      const el = document.getElementById('radio');
      if (el) {
        document.getElementById('radio-txt').textContent = text;
        el.classList.remove('hidden');
        radioT = 4.5;
      }
      if (this.voiceOn() && window.speechSynthesis) {
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'fr-FR';
          if (!voice) voice = (speechSynthesis.getVoices() || []).find((v) => /^fr/i.test(v.lang)) || null;
          if (voice) u.voice = voice;
          u.rate = 1.08; u.pitch = 0.95; u.volume = 0.9;
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        } catch (e) { /* synthèse vocale indisponible */ }
      }
    },
    tick(dt) {
      if (radioT > 0) { radioT -= dt; if (radioT <= 0) { const el = document.getElementById('radio'); if (el) el.classList.add('hidden'); } }
    },
    stop() {
      radioT = 0;
      const el = document.getElementById('radio');
      if (el) el.classList.add('hidden');
      if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* ignoré */ }
    },
  };

  // ---------- Fantôme du contre-la-montre ----------
  // Échantillons [t, x, y, a] toutes les 50 ms sur le meilleur tour
  F1.Ghost = {
    get(gpId) { return load('paddock-ghost-' + gpId, null); },
    set(gpId, g) { save('paddock-ghost-' + gpId, g); },
    at(g, t) {
      const s = g && g.s;
      if (!s || !s.length) return null;
      const i = Math.min(s.length - 1, Math.max(0, Math.floor(t / g.dt)));
      const a = s[i], b = s[Math.min(s.length - 1, i + 1)], f = Math.min(1, Math.max(0, t / g.dt - i));
      let da = b[2] - a[2];
      if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, a: a[2] + da * f };
    },
  };

  // ---------- Ralentis : mémoire des 30 dernières secondes ----------
  F1.Replay = class {
    constructor(cars, track, seconds) { this.cars = cars; this.track = track; this.max = Math.round((seconds || 30) * 30); this.frames = []; this.acc = 0; }
    record(dt) {
      this.acc += dt;
      if (this.acc < 1 / 30) return;
      this.acc = 0;
      const f = new Float32Array(this.cars.length * 6);
      this.cars.forEach((c, k) => { f.set([c.x, c.y, c.a, c.steer, c.speed, c.aeroOpen ? 1 : 0], k * 6); });
      this.frames.push(f);
      if (this.frames.length > this.max) this.frames.shift();
    }
    // Applique l'image n aux voitures (positions seulement) ; renvoie false à la fin
    apply(n) {
      const f = this.frames[Math.floor(n)];
      if (!f) return false;
      this.cars.forEach((c, k) => {
        c.x = f[k * 6]; c.y = f[k * 6 + 1]; c.a = f[k * 6 + 2]; c.steer = f[k * 6 + 3];
        const v = f[k * 6 + 4];
        c.vx = Math.cos(c.a) * v; c.vy = Math.sin(c.a) * v;
        c.aeroOpen = f[k * 6 + 5] > 0.5;
        c.idx = this.track.nearest(c.x, c.y, c.idx);
      });
      return true;
    }
    snapshot() { return this.cars.map((c) => ({ x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, steer: c.steer, aeroOpen: c.aeroOpen, idx: c.idx, wrap: c.wrap, lat: c.lat })); }
    restore(s) { this.cars.forEach((c, k) => Object.assign(c, s[k])); }
  };
})();
