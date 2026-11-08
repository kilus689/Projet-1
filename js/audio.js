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
      this.osc1.start();
      this.osc2.start();

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
      this.noise.start();
    }

    setMuted(m) {
      this.muted = m;
      try { localStorage.setItem('f1-muted', m ? '1' : '0'); } catch (e) { /* ignoré */ }
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }

    // Régime moteur simulé à partir de la vitesse (8 rapports)
    engine(car, active) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const v = Math.max(0, car.speed) / F1.PHYS.maxSpeed;
      const gears = 8;
      const g = Math.min(gears - 1, Math.floor(v * gears * 0.999));
      const within = v * gears - g;
      const rpm = 0.25 + 0.75 * (g === 0 ? v * gears : 0.35 + 0.65 * within);
      const freq = 55 + rpm * 190 + (car.throttle > 0 ? 8 : 0);
      this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
      this.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
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
    }
  }

  F1.Audio = Audio;
})(window);
