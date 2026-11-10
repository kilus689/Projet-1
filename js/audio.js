'use strict';
// Sons synthétisés avec la Web Audio API (aucun fichier audio requis).
(function (root) {
  const F1 = root.F1;

  class Audio {
    constructor() {
      this.ctx = null;
      this.muted = false;
      try { this.muted = localStorage.getItem('f1-muted') === '1'; } catch (e) { /* stockage indisponible */ }
    }

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(ctx.destination);

      // Moteur : deux oscillateurs filtrés
      this.engGain = ctx.createGain();
      this.engGain.gain.value = 0;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 900;
      this.osc1 = ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'square';
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      this.osc1.connect(this.filter);
      this.osc2.connect(g2).connect(this.filter);
      this.filter.connect(this.engGain).connect(this.master);
      // Harmonique aiguë (caractère du V6 turbo hybride)
      this.osc3 = ctx.createOscillator();
      this.osc3.type = 'triangle';
      this.g3 = ctx.createGain();
      this.g3.gain.value = 0.25;
      this.osc3.connect(this.g3).connect(this.filter);
      // Sifflement du turbo et du MGU-H
      this.turbo = ctx.createOscillator();
      this.turbo.type = 'sine';
      this.turboGain = ctx.createGain();
      this.turboGain.gain.value = 0;
      this.turbo.connect(this.turboGain).connect(this.master);
      // Voitures proches (passage) : un second moteur dont le volume dépend de la distance
      this.other = ctx.createOscillator();
      this.other.type = 'sawtooth';
      this.otherF = ctx.createBiquadFilter();
      this.otherF.type = 'lowpass';
      this.otherF.frequency.value = 1200;
      this.otherGain = ctx.createGain();
      this.otherGain.gain.value = 0;
      this.other.connect(this.otherF).connect(this.otherGain).connect(this.master);
      this.osc1.start();
      this.osc2.start();
      this.osc3.start();
      this.turbo.start();
      this.other.start();

      // Bruit (crissements, sable)
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = ctx.createBufferSource();
      this.noise.buffer = buf;
      this.noise.loop = true;
      this.noiseFilter = ctx.createBiquadFilter();
      this.noiseFilter.type = 'bandpass';
      this.noiseFilter.frequency.value = 1800;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0;
      this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
      // Souffle du vent (aspiration derrière une voiture)
      this.wind = ctx.createBufferSource();
      this.wind.buffer = buf;
      this.wind.loop = true;
      this.windF = ctx.createBiquadFilter();
      this.windF.type = 'lowpass';
      this.windF.frequency.value = 500;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.wind.connect(this.windF).connect(this.windGain).connect(this.master);
      this.noise.start();
      this.wind.start();
    }

    setMuted(m) {
      this.muted = m;
      try { localStorage.setItem('f1-muted', m ? '1' : '0'); } catch (e) { /* ignoré */ }
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }

    // Régime moteur simulé à partir de la vitesse (8 rapports)
    engine(car, active, race) {
      if (!this.ctx) return;
      // Caractère propre à chaque motoriste : hauteur et richesse du son
      const CH = { mercedes: [1, 0.22], ferrari: [1.06, 0.34], rbford: [0.97, 0.28], honda: [1.03, 0.3], audi: [0.95, 0.2] };
      const ch = CH[car.team && car.team.engine] || [1, 0.25];
      const t = this.ctx.currentTime;
      const v = Math.max(0, car.speed) / F1.PHYS.maxSpeed;
      const gears = 8;
      const g = Math.min(gears - 1, Math.floor(v * gears * 0.999));
      const within = v * gears - g;
      const rpm = 0.25 + 0.75 * (g === 0 ? v * gears : 0.35 + 0.65 * within);
      const freq = (55 + rpm * 190 + (car.throttle > 0 ? 8 : 0)) * ch[0];
      this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
      this.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
      this.osc3.frequency.setTargetAtTime(freq * 3, t, 0.03);
      this.g3.gain.setTargetAtTime(ch[1] * (car.throttle > 0 ? 1 : 0.4), t, 0.05);
      // Turbo : siffle plus fort à haut régime, surtout en déploiement électrique
      this.turbo.frequency.setTargetAtTime(2400 + rpm * 3200, t, 0.05);
      this.turboGain.gain.setTargetAtTime(active ? (car.throttle > 0 ? 0.006 + 0.01 * rpm : 0.004) * (car.deploying ? 1.5 : 1) : 0, t, 0.1);
      // Vent : plus de souffle à haute vitesse, encore plus dans l'aspiration
      this.windF.frequency.setTargetAtTime(300 + v * 900, t, 0.1);
      this.windGain.gain.setTargetAtTime(active ? v * v * 0.05 + (car.tow || 0) * 0.08 : 0, t, 0.1);
      // Voiture la plus proche
      let near = 1e9, nv = 0;
      if (race && active) for (const o of race.cars) {
        if (o === car || o.pit || o.out) continue;
        const d = Math.hypot(o.x - car.x, o.y - car.y);
        if (d < near) { near = d; nv = o.speed; }
      }
      const ov = near < 400 ? (1 - near / 400) * 0.07 : 0;
      this.other.frequency.setTargetAtTime(60 + (nv / F1.PHYS.maxSpeed) * 210, t, 0.05);
      this.otherGain.gain.setTargetAtTime(ov, t, 0.08);
      this.filter.frequency.setTargetAtTime(500 + rpm * 1800 * (car.throttle > 0 ? 1 : 0.6), t, 0.05);
      const vol = active ? 0.06 + 0.07 * (car.throttle > 0 ? 1 : 0.4) : 0;
      this.engGain.gain.setTargetAtTime(vol, t, 0.08);
      const skid = active && !car.offTrack ? Math.min(1, Math.max(0, (car.skid - 60) / 200)) : 0;
      const sand = active && car.offTrack ? Math.min(1, car.speed / 400) : 0;
      this.noiseFilter.frequency.setTargetAtTime(sand > skid ? 400 : 1900, t, 0.05);
      this.noiseGain.gain.setTargetAtTime(Math.max(skid * 0.12, sand * 0.18), t, 0.05);
      return g + 1;
    }

    beep(freq, dur, vol) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    thud(force) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
      g.gain.setValueAtTime(Math.min(0.4, force / 800), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.3);
    }

    stopEngine() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.engGain.gain.setTargetAtTime(0, t, 0.1);
      this.noiseGain.gain.setTargetAtTime(0, t, 0.1);
      this.turboGain.gain.setTargetAtTime(0, t, 0.1);
      this.windGain.gain.setTargetAtTime(0, t, 0.1);
      this.otherGain.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  F1.Audio = Audio;
})(window);
