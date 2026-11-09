'use strict';
// Portraits des pilotes : illustration originale (casque + combinaison aux couleurs de l'écurie,
// motif de casque propre à chaque pilote). Si le joueur a importé une photo sur son appareil
// (Aides et commandes → Photos des pilotes), c'est elle qui est affichée.
(function () {
  const F1 = window.F1;
  const KEY = (id) => 'drv:' + id;

  function hash(s) { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }
  function shade(hex, k) {
    const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  // Casques : couleurs et motifs inspirés des casques 2026 (sans logos ni dessins de tiers)
  const HELMETS = {
    nor: { base: '#e4ff2e', c: ['#111111'], style: 'squiggle' },
    rus: { base: '#3cc4f0', c: ['#111111', '#1c2c6b'], style: 'crown' },
    ant: { base: '#ff1d1d', c: ['#1fe04a', '#13208a', '#ffffff'], style: 'chevron' },
    ham: { base: '#f5d90a', c: ['#a3100c'], style: 'lines' },
    ver: { base: '#ffffff', c: ['#d7141a', '#1e5bd8', '#ffcc00'], style: 'sun' },
    alo: { base: '#ffe62e', c: ['#10257a', '#2bb7f0', '#ff1a1a'], style: 'chevron' },
    alb: { base: '#ffffff', c: ['#2a3fbf', '#b8bcc4'], style: 'crown' },
    sai: { base: '#e1251b', c: ['#1d3fbf', '#ffc400'], style: 'chevron' },
    col: { base: '#5bb4ea', c: ['#ffffff', '#ff2a4a', '#111111'], style: 'bands' },
    law: { base: '#ff8ab8', c: ['#1b1f5e', '#ffffff', '#ffd200'], style: 'sun' },
    lin: { base: '#13206b', c: ['#43a7e6', '#e4ff2e', '#ff2a1a'], style: 'bands' },
    oco: { base: '#e61a0f', c: ['#ffffff'], style: 'lines' },
    bea: { base: '#14217a', c: ['#d7ff1f', '#ffffff'], style: 'crown' },
    hul: { base: '#f2f2f2', c: ['#8a8a8a', '#ff3b1f'], style: 'crown' },
    bor: { base: '#ffd600', c: ['#123a7a', '#0f8a3a', '#ffffff'], style: 'bands' },
    per: { base: '#0b0b0f', c: ['#1e7bff', '#8a8f99'], style: 'swirl' },
  };
  function rng(seed) { let x = seed || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
  // Peint un motif de casque dans le rectangle (x, y, w, h) : haut = sommet du casque
  function paintHelmet(g, x, y, w, h, D, seed) {
    const c = D.c, a = (i) => c[i % c.length];
    g.fillStyle = D.base; g.fillRect(x, y, w, h);
    const R = rng(seed);
    g.save(); g.translate(x, y);
    if (D.style === 'crown') {
      g.fillStyle = a(0); g.fillRect(0, 0, w, h * 0.34);
      g.fillStyle = a(1); g.fillRect(0, h * 0.34, w, h * 0.06);
      g.beginPath(); g.moveTo(0, h * 0.7); g.quadraticCurveTo(w * 0.5, h * 0.55, w, h * 0.7); g.lineTo(w, h * 0.78); g.quadraticCurveTo(w * 0.5, h * 0.63, 0, h * 0.78); g.fill();
    } else if (D.style === 'bands') {
      const n = c.length;
      for (let i = 0; i < n; i++) { g.fillStyle = a(i); g.fillRect(0, h * (0.28 + i * 0.13), w, h * 0.09); }
      g.fillStyle = a(0); g.fillRect(0, 0, w, h * 0.16);
    } else if (D.style === 'chevron') {
      for (let i = 0; i < c.length; i++) {
        g.fillStyle = a(i);
        const y0 = h * (0.2 + i * 0.2);
        g.beginPath(); g.moveTo(0, y0); g.lineTo(w * 0.5, y0 + h * 0.18); g.lineTo(w, y0); g.lineTo(w, y0 + h * 0.08); g.lineTo(w * 0.5, y0 + h * 0.27); g.lineTo(0, y0 + h * 0.08); g.fill();
      }
      g.fillStyle = a(0); g.fillRect(0, 0, w, h * 0.1);
    } else if (D.style === 'sun') {
      g.fillStyle = a(0); g.fillRect(0, 0, w, h * 0.42);
      g.fillStyle = a(1); g.fillRect(0, h * 0.68, w, h * 0.32);
      g.fillStyle = a(2);
      for (const fx of [0.18, 0.82]) { g.beginPath(); g.arc(w * fx, h * 0.5, h * 0.14, 0, Math.PI * 2); g.fill(); }
    } else if (D.style === 'lines') {
      g.strokeStyle = a(0); g.lineWidth = Math.max(1, h * 0.018);
      for (let i = 0; i < 9; i++) {
        const y0 = h * (0.1 + i * 0.09);
        g.beginPath(); g.moveTo(0, y0 + h * 0.08); g.quadraticCurveTo(w * 0.5, y0 - h * 0.06, w, y0 + h * 0.08); g.stroke();
      }
    } else if (D.style === 'squiggle' || D.style === 'swirl') {
      const n = D.style === 'swirl' ? 26 : 40;
      g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const px = R() * w, py = R() * h, r = (0.04 + R() * 0.08) * h;
        g.strokeStyle = g.fillStyle = a(i);
        g.lineWidth = D.style === 'swirl' ? r * 0.7 : h * 0.025;
        g.beginPath(); g.moveTo(px, py);
        g.bezierCurveTo(px + r * 2 * (R() - 0.5) * 3, py - r * 2, px + r * 3 * (R() - 0.5), py + r * 2, px + r * 2 * (R() - 0.5) * 3, py + r * (R() - 0.5) * 3);
        g.stroke();
      }
    }
    g.restore();
  }
  function designOf(d, team) {
    const key = d && (d.id && HELMETS[d.id] ? d.id : String(d.code || '').toLowerCase());
    if (HELMETS[key]) return HELMETS[key];
    const c1 = (team && team.color) || '#555', c2 = (team && team.color2) || '#ddd';
    const r = hash((d && (d.id || d.code || d.last)) || 'x');
    return { base: r % 2 ? c1 : '#ffffff', c: [r % 2 ? c2 : c1, PALETTE[r % PALETTE.length], c2], style: ['crown', 'bands', 'chevron', 'sun'][(r >> 6) % 4] };
  }

  const PALETTE = ['#ffffff', '#ffd400', '#00a3e0', '#e10600', '#ff7a00', '#1a1a1a', '#7ad1ff', '#00b050', '#ff4fa3', '#c0c0c0'];

  function drawIllustration(cv, d, team) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, u = W / 100;
    const c1 = (team && team.color) || '#555', c2 = (team && team.color2) || '#ddd';
    g.setTransform(1, 0, 0, 1, 0, 0);
    // fond studio
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, shade(c1, 0.15)); bg.addColorStop(1, shade(c1, -0.7));
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.18; g.fillStyle = c2;
    g.beginPath(); g.moveTo(W * 0.55, 0); g.lineTo(W, 0); g.lineTo(W, H * 0.7); g.lineTo(W * 0.2, H); g.lineTo(W * 0.05, H); g.closePath(); g.fill();
    g.globalAlpha = 1;
    // grand numéro en filigrane
    g.font = `italic 900 ${62 * u}px "Titillium Web", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillText(String(d.num), W * 0.68, H * 0.36);

    // épaules / combinaison
    const sy = H * 0.74;
    const suit = g.createLinearGradient(0, sy, 0, H);
    suit.addColorStop(0, shade(c1, 0.1)); suit.addColorStop(1, shade(c1, -0.35));
    g.fillStyle = suit;
    g.beginPath();
    g.moveTo(W * 0.04, H); g.bezierCurveTo(W * 0.06, sy + 8 * u, W * 0.2, sy - 2 * u, W * 0.36, sy - 4 * u);
    g.lineTo(W * 0.64, sy - 4 * u); g.bezierCurveTo(W * 0.8, sy - 2 * u, W * 0.94, sy + 8 * u, W * 0.96, H);
    g.closePath(); g.fill();
    g.fillStyle = c2; // bandes d'épaules
    g.fillRect(W * 0.12, sy + 4 * u, W * 0.16, 2.2 * u);
    g.fillRect(W * 0.72, sy + 4 * u, W * 0.16, 2.2 * u);
    // col (HANS)
    g.fillStyle = '#1b1b1b';
    g.beginPath(); g.ellipse(W * 0.5, sy - 2 * u, 20 * u, 6 * u, 0, 0, Math.PI * 2); g.fill();

    // casque
    const cx = W * 0.5, cy = H * 0.44, R = 25 * u;
    g.save();
    g.beginPath(); g.ellipse(cx, cy, R * 0.92, R * 1.05, 0, 0, Math.PI * 2); g.clip();
    paintHelmet(g, cx - R * 0.92, cy - R * 1.05, R * 1.84, R * 2.1, designOf(d, team), hash(d.id || d.last));
    // reflet
    const gl = g.createRadialGradient(cx - R * 0.35, cy - R * 0.55, 1, cx - R * 0.35, cy - R * 0.55, R * 0.9);
    gl.addColorStop(0, 'rgba(255,255,255,0.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(0, 0, W, H);
    const sh = g.createLinearGradient(cx - R, 0, cx + R, 0);
    sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(0.35, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H);
    g.restore();
    // visière
    g.save();
    const vg = g.createLinearGradient(0, cy - 6 * u, 0, cy + 9 * u);
    vg.addColorStop(0, '#0b0d12'); vg.addColorStop(0.5, '#2a3446'); vg.addColorStop(1, '#07080b');
    g.fillStyle = vg;
    g.beginPath();
    g.moveTo(cx - R * 0.86, cy + 1 * u);
    g.quadraticCurveTo(cx, cy - 9 * u, cx + R * 0.86, cy + 1 * u);
    g.quadraticCurveTo(cx + R * 0.7, cy + 11 * u, cx, cy + 10 * u);
    g.quadraticCurveTo(cx - R * 0.7, cy + 11 * u, cx - R * 0.86, cy + 1 * u);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 0.8 * u; g.stroke();
    g.restore();
    // mentonnière avec le code du pilote
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.ellipse(cx, cy + R * 0.78, R * 0.42, R * 0.16, 0, 0, Math.PI * 2); g.fill();
    g.font = `800 ${6.5 * u}px "Titillium Web", sans-serif`;
    g.fillStyle = '#fff';
    g.fillText(d.code || (d.last || '').slice(0, 3).toUpperCase(), cx, cy + R * 0.79);
    // numéro sur le casque
    g.font = `italic 900 ${9 * u}px "Titillium Web", sans-serif`;
    g.lineWidth = 1.2 * u; g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.strokeText(String(d.num), cx, cy - R * 0.55);
    g.fillStyle = '#fff';
    g.fillText(String(d.num), cx, cy - R * 0.55);
  }

  function drawPhoto(cv, img) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const s = Math.max(W / img.width, H / img.height);
    const w = img.width * s, h = img.height * s;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    g.drawImage(img, (W - w) / 2, (H - h) * 0.3, w, h); // cadrage centré, haut du visage privilégié
  }

  // Texture de casque pour la 3D (motif répété des deux côtés)
  const helmTex = new Map();
  F1.Helmets = {
    canvas(code, team) {
      const key = String(code || '') + (team ? team.id : '');
      if (helmTex.has(key)) return helmTex.get(key);
      const d = F1.DRIVERS2026.find((x) => x.code === code) || { code, id: String(code || '').toLowerCase() };
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 256;
      const g = cv.getContext('2d'), D = designOf(d, team), sd = hash(d.id || code);
      paintHelmet(g, 0, 0, 256, 256, D, sd);
      g.save(); g.translate(512, 0); g.scale(-1, 1); paintHelmet(g, 0, 0, 256, 256, D, sd); g.restore();
      helmTex.set(key, cv);
      return cv;
    },
  };

  F1.Portraits = {
    hasPhoto(id) { return !!(F1.Liveries && F1.Liveries.has(KEY(id))); },
    setPhoto(id, file) { return F1.Liveries.set(KEY(id), file); },
    removePhoto(id) { return F1.Liveries.remove(KEY(id)); },
    // Dessine le portrait dans un canvas (photo importée si elle existe)
    draw(cv, d, team) {
      const img = F1.Liveries && F1.Liveries.get(KEY(d.id));
      if (img) drawPhoto(cv, img); else drawIllustration(cv, d, team);
    },
  };
})();
