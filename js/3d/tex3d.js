'use strict';
// Textures procédurales pour le rendu 3D (aucun fichier image : tout est dessiné au chargement).
(function () {
  const F1 = window.F1;
  const T = window.THREE;
  const X = (F1.X3D = F1.X3D || {});

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function toTex(c, repeat, srgb) {
    const t = new T.CanvasTexture(c);
    if (srgb !== false) t.colorSpace = T.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 16;
    return t;
  }
  // Bruit de valeur lissé (plusieurs octaves), pour des taches naturelles
  function valueNoise(w, h, scale, seed) {
    let s = seed || 1;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
    const grid = new Float32Array(gw * gh).map(rnd);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = x / scale, fy = y / scale;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const g = (a, b) => grid[((iy + b) % gh) * gw + ((ix + a) % gw)];
        out[y * w + x] = (g(0, 0) * (1 - sx) + g(1, 0) * sx) * (1 - sy) + (g(0, 1) * (1 - sx) + g(1, 1) * sx) * sy;
      }
    }
    return out;
  }
  function hexRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Remplit un canvas : couleur de base + grain + taches
  function grainy(c, base, grain, blotch, blotchScale, seed) {
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    const img = g.createImageData(w, h);
    const [r, gg, b] = hexRgb(base);
    const n1 = valueNoise(w, h, blotchScale || 32, seed || 7);
    let s = (seed || 7) * 13;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < w * h; i++) {
      const v = (rnd() - 0.5) * grain + (n1[i] - 0.5) * blotch;
      img.data[i * 4] = Math.max(0, Math.min(255, r + v));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, gg + v));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, b + v));
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return g;
  }

  const cache = {};
  const once = (k, fn) => cache[k] || (cache[k] = fn());

  X.tex = {
    asphalt: () => once('asphalt', () => {
      const c = canvas(512, 512);
      const g = grainy(c, '#4a4c50', 46, 18, 64, 3);
      // Gravillons clairs et fissures légères
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`;
        g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
      }
      g.strokeStyle = 'rgba(20,20,20,0.25)';
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        let x = Math.random() * 512, y = Math.random() * 512;
        g.moveTo(x, y);
        for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 30; g.lineTo(x, y); }
        g.stroke();
      }
      return toTex(c, true);
    }),
    lightAsphalt: () => once('lightAsphalt', () => toTex((() => { const c = canvas(256, 256); grainy(c, '#6e7176', 40, 16, 48, 5); return c; })(), true)),
    gravel: () => once('gravel', () => {
      const c = canvas(256, 256);
      const g = grainy(c, '#bfae88', 70, 20, 24, 11);
      for (let i = 0; i < 2500; i++) {
        const v = 120 + Math.random() * 100;
        g.fillStyle = `rgb(${v},${v * 0.92},${v * 0.78})`;
        g.beginPath();
        g.arc(Math.random() * 256, Math.random() * 256, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
      return toTex(c, true);
    }),
    grass: (cols) => once('grass' + cols.join(), () => {
      const c = canvas(256, 256);
      const g = grainy(c, cols[0], 26, 30, 40, 17);
      // Bandes de tonte
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,180'},${Math.random() * 0.12})`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 1, 2);
      }
      return toTex(c, true);
    }),
    ground: (base) => once('ground' + base, () => toTex((() => { const c = canvas(256, 256); grainy(c, base, 30, 26, 40, 19); return c; })(), true)),
    turf: () => once('turf', () => toTex((() => { const c = canvas(128, 128); grainy(c, '#3f8a4c', 30, 10, 16, 23); return c; })(), true)),
    curb: () => once('curb', () => {
      const c = canvas(64, 128);
      const g = c.getContext('2d');
      const grad = (y0, col) => {
        const gr = g.createLinearGradient(0, 0, 64, 0);
        gr.addColorStop(0, col); gr.addColorStop(0.5, col); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = col; g.fillRect(0, y0, 64, 64);
        g.fillStyle = gr; g.globalAlpha = 0.25; g.fillRect(0, y0, 64, 64); g.globalAlpha = 1;
      };
      grad(0, '#c8102e');
      grad(64, '#f2f2f2');
      // Usure
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(30,30,30,${Math.random() * 0.15})`; g.fillRect(Math.random() * 64, Math.random() * 128, 2, 2); }
      return toTex(c, true);
    }),
    checker: () => once('checker', () => {
      const c = canvas(64, 64);
      const g = c.getContext('2d');
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#151515' : '#f5f5f5'; g.fillRect(i * 8, j * 8, 8, 8); }
      return toTex(c, true);
    }),
    chainlink: () => once('chainlink', () => {
      const c = canvas(64, 64);
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(200,205,210,0.95)';
      g.lineWidth = 2;
      for (let i = -64; i < 128; i += 16) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
        g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
      }
      g.fillStyle = 'rgba(160,165,170,1)';
      g.fillRect(0, 0, 64, 2);
      return toTex(c, true);
    }),
    armco: () => once('armco', () => {
      const c = canvas(128, 32);
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 32);
      gr.addColorStop(0, '#9aa1a8'); gr.addColorStop(0.3, '#e6e9ec'); gr.addColorStop(0.55, '#8d949b'); gr.addColorStop(0.8, '#d5d9dd'); gr.addColorStop(1, '#7b828a');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 32);
      g.fillStyle = 'rgba(40,40,40,0.5)';
      g.fillRect(0, 0, 3, 32);
      return toTex(c, true);
    }),
    tecpro: () => once('tecpro', () => {
      const c = canvas(256, 64);
      const g = c.getContext('2d');
      const cols = ['#d71920', '#f2f2f2', '#1d4ed8', '#f2f2f2'];
      for (let i = 0; i < 4; i++) {
        g.fillStyle = cols[i]; g.fillRect(i * 64, 0, 62, 64);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(i * 64 + 62, 0, 2, 64);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(i * 64, 4, 62, 6);
      }
      return toTex(c, true);
    }),
    concrete: () => once('concrete', () => {
      const c = canvas(1024, 64);
      const g = grainy(c, '#d9d9d6', 26, 20, 20, 29);
      // Panneaux publicitaires fictifs du jeu
      const ads = [['#e10600', '#ffffff', 'PADDOCK'], ['#0d0f14', '#ffd60a', 'GRAND PRIX'], ['#0090ff', '#ffffff', 'PADDOCK 26'], ['#f2f2f2', '#e10600', 'SAISON 2026']];
      ads.forEach(([bg, fg, txt], i) => {
        g.fillStyle = bg; g.fillRect(i * 256 + 6, 8, 244, 48);
        g.fillStyle = fg;
        g.font = 'italic 800 34px "Barlow Condensed", Arial Narrow, sans-serif';
        g.textAlign = 'center';
        g.fillText(txt, i * 256 + 128, 45);
      });
      for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(i * 256, 0, 2, 64); }
      return toTex(c, true);
    }),
    pitwall: () => once('pitwall', () => {
      const c = canvas(256, 64);
      const g = grainy(c, '#e8e8e8', 20, 10, 16, 31);
      g.fillStyle = '#0d0f14'; g.fillRect(0, 44, 256, 20);
      return toTex(c, true);
    }),
    crowd: () => once('crowd', () => {
      const c = canvas(512, 256);
      const g = c.getContext('2d');
      g.fillStyle = '#3d4148'; g.fillRect(0, 0, 512, 256);
      const cols = ['#ffffff', '#e63946', '#ffd60a', '#00b4d8', '#ff7b00', '#2ec4b6', '#7b2cbf', '#f1faee', '#1d3557', '#e9c46a'];
      for (let row = 0; row < 16; row++) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(0, row * 16 + 13, 512, 3);
        for (let i = 0; i < 70; i++) {
          if (Math.random() < 0.12) continue;
          const x = i * 7.3 + Math.random() * 2, y = row * 16 + 3;
          g.fillStyle = cols[(Math.random() * cols.length) | 0];
          g.fillRect(x, y + 4, 5, 7);
          g.fillStyle = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][(Math.random() * 4) | 0];
          g.fillRect(x + 1, y, 3, 4);
        }
      }
      return toTex(c, true);
    }),
    facade: (night) => once('facade' + !!night, () => {
      const c = canvas(256, 256);
      const g = grainy(c, '#b9b3a8', 24, 26, 40, 37);
      for (let fy = 0; fy < 8; fy++) {
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, fy * 32 + 28, 256, 3);
        for (let fx = 0; fx < 8; fx++) {
          const lit = night && Math.random() < 0.55;
          g.fillStyle = lit ? `rgba(255,${200 + Math.random() * 40},${120 + Math.random() * 60},0.95)` : `rgba(${40 + Math.random() * 30},${60 + Math.random() * 30},${80 + Math.random() * 40},0.9)`;
          g.fillRect(fx * 32 + 6, fy * 32 + 6, 20, 18);
        }
      }
      return toTex(c, true);
    }),
    garage: () => once('garage', () => {
      const c = canvas(1024, 128);
      const g = grainy(c, '#e6e6e3', 18, 10, 30, 41);
      const cols = F1.TEAMS2026.map((t) => t.color);
      for (let i = 0; i < 8; i++) {
        const x = i * 128;
        g.fillStyle = '#16181c'; g.fillRect(x + 12, 40, 104, 88);
        g.fillStyle = cols[i % cols.length]; g.fillRect(x + 12, 28, 104, 10);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        for (let k = 0; k < 6; k++) g.fillRect(x + 20 + k * 16, 60, 8, 60);
      }
      g.fillStyle = 'rgba(70,110,150,0.85)'; g.fillRect(0, 0, 1024, 24);
      return toTex(c, true);
    }),
    carbon: () => once('carbon', () => {
      const c = canvas(64, 64);
      const g = c.getContext('2d');
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = (x + y) % 2 ? 30 : 42;
        const gr = g.createLinearGradient(x * 8, y * 8, x * 8 + 8, y * 8 + 8);
        gr.addColorStop(0, `rgb(${v},${v},${v + 3})`); gr.addColorStop(1, `rgb(${v - 10},${v - 10},${v - 8})`);
        g.fillStyle = gr; g.fillRect(x * 8, y * 8, 8, 8);
      }
      return toTex(c, true);
    }),
    board: (txt) => once('board' + txt, () => {
      const c = canvas(128, 160);
      const g = c.getContext('2d');
      g.fillStyle = '#f5f5f5'; g.fillRect(0, 0, 128, 160);
      g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 152);
      g.fillStyle = '#111';
      g.font = '800 70px "Barlow Condensed", Arial Narrow, sans-serif';
      g.textAlign = 'center';
      g.fillText(txt, 64, 108);
      return toTex(c);
    }),
    shadow: () => once('shadow', () => {
      const c = canvas(128, 64);
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 32, 4, 64, 32, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
      return toTex(c);
    }),
  };

  // Ciel équirectangulaire : dégradé, nuages et soleil (jour) ou étoiles (nuit)
  X.skyTexture = function (night, seed, weather) {
    const overcast = weather === 'rain' || weather === 'cloudy';
    const w = 1024, h = 512;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, h / 2);
    if (night) {
      gr.addColorStop(0, '#02040b'); gr.addColorStop(0.75, '#0b1530'); gr.addColorStop(1, '#2a3550');
    } else {
      if (weather === 'rain') { gr.addColorStop(0, '#6b737c'); gr.addColorStop(0.6, '#8f979f'); gr.addColorStop(1, '#b4bbc1'); }
      else if (overcast) { gr.addColorStop(0, '#7f97b3'); gr.addColorStop(0.6, '#a9bacb'); gr.addColorStop(1, '#d6dde3'); }
      else { gr.addColorStop(0, '#2f6fbf'); gr.addColorStop(0.6, '#79aee6'); gr.addColorStop(1, '#dbe9f5'); }
    }
    g.fillStyle = gr; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = night ? '#1c2233' : '#c9d6df';
    g.fillRect(0, h / 2, w, h / 2);
    if (night) {
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`;
        g.fillRect(Math.random() * w, Math.random() * h * 0.42, 1, 1);
      }
      // Halo lumineux de la ville / du circuit à l'horizon
      const hz = g.createLinearGradient(0, h * 0.38, 0, h * 0.5);
      hz.addColorStop(0, 'rgba(255,170,90,0)'); hz.addColorStop(1, 'rgba(255,170,90,0.35)');
      g.fillStyle = hz; g.fillRect(0, h * 0.38, w, h * 0.12);
    } else {
      // Nuages : bruit seuillé, plus denses vers l'horizon
      const n = valueNoise(w, h / 2, 48, seed || 5), n2 = valueNoise(w, h / 2, 14, (seed || 5) + 9);
      const img = g.getImageData(0, 0, w, h / 2);
      for (let y = 0; y < h / 2; y++) {
        const horizon = y / (h / 2);
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          let v = n[i] * 0.75 + n2[i] * 0.25;
          v = Math.max(0, (v - (weather === 'rain' ? 0.2 : overcast ? 0.35 : 0.55)) * 3.2) * (overcast ? 0.9 : 0.35 + horizon * 0.65);
          if (v > 0) {
            const a = Math.min(0.92, v);
            const k = i * 4;
            const shade = (weather === 'rain' ? 150 : overcast ? 215 : 255) - (1 - n2[i]) * 30;
            img.data[k] = img.data[k] * (1 - a) + shade * a;
            img.data[k + 1] = img.data[k + 1] * (1 - a) + shade * a;
            img.data[k + 2] = img.data[k + 2] * (1 - a) + (shade + 4) * a;
          }
        }
      }
      g.putImageData(img, 0, 0);
      if (overcast) { const t = toTex(c); t.mapping = T.EquirectangularReflectionMapping; return t; }
      const sx = w * 0.62, sy = h * 0.18;
      const sg = g.createRadialGradient(sx, sy, 2, sx, sy, 90);
      sg.addColorStop(0, 'rgba(255,255,240,1)'); sg.addColorStop(0.12, 'rgba(255,250,220,0.9)'); sg.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = sg; g.fillRect(sx - 90, sy - 90, 180, 180);
    }
    const t = toTex(c);
    t.mapping = T.EquirectangularReflectionMapping;
    return t;
  };

  // Livrée d'une écurie : atlas de 3 bandes (coque / capot moteur / pontons)
  // ---------- Livrées par écurie (zones de couleur, sans logos) ----------
  // Bandes de l'atlas : 0 = coque + nez (u : 0 = pointe du nez → 1 = arrière du cockpit),
  // 1 = capot moteur (u : 0 = prise d'air → 1 = arrière), 2 = pontons (u : 0 = entrée d'air → 1 = arrière).
  // v (autour de la pièce) : 0 dessous, 0.25 flanc droit, 0.5 dessus, 0.75 flanc gauche, 1 dessous.
  const CARB = '#17181b';
  const TOP = [0.3, 0.7], UPPER = [0.18, 0.82], LOW = [[0, 0.17], [0.83, 1]];
  const DESIGNS = {
    // Bleu nuit, nez jaune, grand motif jaune/rouge à l'avant du capot moteur
    redbull: (z) => {
      z.all('#1b2a5e'); z.shade(0.25); z.lower(CARB);
      z.box(0, 0, 0.09, ...UPPER, '#f5b61c'); z.box(0, 0.09, 0.12, ...UPPER, '#d71920');
      z.box(1, 0, 0.3, ...TOP, '#f5b61c'); z.box(1, 0.04, 0.24, 0.4, 0.6, '#d71920');
      z.stripe(2, 0.55, '#d71920', 0.02);
    },
    // Blanc, bandes bleu roi, nez jaune
    racingbulls: (z) => {
      z.all('#f4f4f2'); z.lower(CARB);
      z.box(0, 0, 0.08, ...UPPER, '#f5b61c');
      z.stripe(0, 0.27, '#1d3fa8', 0.04); z.stripe(0, 0.73, '#1d3fa8', 0.04);
      z.box(1, 0, 0.26, ...TOP, '#f5b61c'); z.box(1, 0.05, 0.2, 0.42, 0.58, '#d71920');
      z.box(2, 0, 1, 0.12, 0.28, '#1d3fa8'); z.box(2, 0, 1, 0.72, 0.88, '#1d3fa8');
    },
    // Rouge, avant du capot moteur blanc, pontons rouges à bas noir
    ferrari: (z) => {
      z.all('#d40000'); z.shade(0.2); z.lower(CARB);
      z.box(1, 0, 0.45, ...UPPER, '#f2f2f2'); z.stripe(1, 0.5, '#d40000', 0.04);
      z.box(2, 0.7, 1, 0, 1, CARB);
    },
    // Bleu, nez et dos du cockpit roses, rose sur l'arrière du capot
    alpine: (z) => {
      z.all('#1f6fd1'); z.shade(0.2); z.lower(CARB);
      z.box(0, 0, 0.62, 0.38, 0.62, '#f19ec6');
      z.box(1, 0.55, 1, ...TOP, '#f19ec6');
      z.box(2, 0, 0.15, ...UPPER, '#f19ec6');
    },
    // Bleu roi, flancs bleu clair et blanc, dessous noir
    williams: (z) => {
      z.all('#1e5bd8'); z.lower(CARB);
      z.box(2, 0, 0.5, 0.15, 0.3, '#f2f2f2'); z.box(2, 0, 0.5, 0.7, 0.85, '#f2f2f2');
      z.box(2, 0.5, 1, 0.15, 0.3, '#3fb2e6'); z.box(2, 0.5, 1, 0.7, 0.85, '#3fb2e6');
      z.stripe(0, 0.3, '#3fb2e6', 0.015); z.stripe(0, 0.7, '#3fb2e6', 0.015);
    },
    // Noir carbone, dos argenté, filets turquoise, bandes argent sur les pontons
    mercedes: (z) => {
      z.all('#141517'); z.carbonWeave();
      z.box(0, 0, 0.85, 0.36, 0.64, '#e6e7e8');
      z.stripe(0, 0.35, '#00d2be', 0.018); z.stripe(0, 0.65, '#00d2be', 0.018);
      for (let i = 0; i < 4; i++) z.diag(2, 0.12 + i * 0.13, 0.06, '#e6e7e8');
      z.stripe(2, 0.3, '#00d2be', 0.02); z.stripe(2, 0.7, '#00d2be', 0.02);
    },
    // Noir et blanc, capot moteur asymétrique, dégradé blanc sur les pontons
    cadillac: (z) => {
      z.all('#121212'); z.carbonWeave();
      z.box(1, 0, 1, 0, 0.5, '#f2f2f2');
      z.stripe(0, 0.32, '#f2f2f2', 0.025); z.stripe(0, 0.68, '#f2f2f2', 0.025);
      z.fade(2, 0, 0.6, '#f2f2f2');
    },
    // Vert, filets jaune citron, bas noir
    aston: (z) => {
      z.all('#00665a'); z.shade(0.25); z.lower(CARB);
      z.stripe(0, 0.33, '#cedc00', 0.015); z.stripe(0, 0.67, '#cedc00', 0.015);
      z.dots(2, 0.15, 0.45, '#cedc00');
      z.box(2, 0.55, 1, 0, 1, CARB);
    },
    // Gris clair, haut des pontons et flancs du capot rouges, dessus du capot noir
    audi: (z) => {
      z.all('#d9d9d9'); z.shade(0.15); z.lower(CARB);
      z.box(1, 0, 1, ...TOP, '#151515'); z.box(1, 0, 0.55, 0.18, 0.3, '#e1001a'); z.box(1, 0, 0.55, 0.7, 0.82, '#e1001a');
      z.box(2, 0, 0.35, 0, 1, '#e1001a');
    },
    // Papaye, pontons noirs à bandes papaye, touches turquoise près du cockpit
    mclaren: (z) => {
      z.all('#ff8000'); z.lower(CARB);
      z.box(0, 0.55, 0.85, 0.3, 0.42, '#00a19c'); z.box(0, 0.55, 0.85, 0.58, 0.7, '#00a19c');
      z.box(1, 0, 1, 0, 1, '#151515'); z.box(1, 0, 0.25, ...TOP, '#00a19c'); z.box(1, 0.35, 1, 0.18, 0.26, '#ff8000'); z.box(1, 0.35, 1, 0.74, 0.82, '#ff8000');
      z.box(2, 0, 1, 0, 1, '#151515'); z.diag(2, 0.25, 0.1, '#ff8000'); z.diag(2, 0.55, 0.1, '#ff8000');
    },
    // Blanc, bas noir, filet rouge
    haas: (z) => {
      z.all('#ececec'); z.lower(CARB);
      z.stripe(0, 0.3, '#da1e28', 0.02); z.stripe(0, 0.7, '#da1e28', 0.02);
      z.box(2, 0.6, 1, 0, 1, CARB); z.box(1, 0, 1, ...TOP, '#1a1a1a');
    },
  };

  // Résolution des livrées (largeur de l'atlas) : 1024, 2048 ou 4096 (« 4K ») selon la qualité
  X.texRes = 1024;
  X.livery = function (team, num) {
    // Livrée importée par le joueur (stockée sur l'appareil) : utilisée telle quelle
    const custom = F1.Liveries && F1.Liveries.get(team.id);
    if (custom) {
      return once('custom' + team.id + F1.Liveries.version(team.id), () => {
        const t = new T.Texture(custom);
        t.colorSpace = T.SRGBColorSpace;
        t.anisotropy = 16;
        t.needsUpdate = true;
        return t;
      });
    }
    const key = 'liv' + (team.id || '') + team.color + team.color2 + num + '@' + X.texRes;
    return once(key, () => {
      const W = X.texRes, B = W / 4, c = canvas(W, B * 3);
      const PX = W / 1024; // facteur d'échelle des détails en pixels
      const g = c.getContext('2d');
      const band = (k) => B * (2 - k); // la bande 0 est en bas (v faible)
      const Y = (k, v) => band(k) + B * (1 - v);
      const all = (k) => (k == null ? [0, 1, 2] : [k]);
      const z = {
        all(col) { g.fillStyle = col; g.fillRect(0, 0, W, B * 3); },
        box(k, u0, u1, v0, v1, col) { g.fillStyle = col; g.fillRect(W * u0, Y(k, v1), W * (u1 - u0), B * (v1 - v0)); },
        lower(col) { for (const k of all()) for (const [a, b] of LOW) this.box(k, 0, 1, a, b, col); },
        stripe(k, v, col, h) { this.box(k, 0, 1, v - h / 2, v + h / 2, col); },
        diag(k, u, w, col) { // bande oblique sur les deux flancs
          g.fillStyle = col;
          for (const [v0, v1] of [[0.12, 0.42], [0.58, 0.88]]) {
            g.beginPath();
            g.moveTo(W * u, Y(k, v0)); g.lineTo(W * (u + w), Y(k, v0)); g.lineTo(W * (u + w + 0.08), Y(k, v1)); g.lineTo(W * (u + 0.08), Y(k, v1));
            g.fill();
          }
        },
        fade(k, u0, u1, col) {
          const gr = g.createLinearGradient(W * u0, 0, W * u1, 0);
          gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(W * u0, Y(k, 0.85), W * (u1 - u0), B * 0.7);
        },
        dots(k, u0, u1, col) {
          g.fillStyle = col;
          for (let u = u0; u < u1; u += 0.012) for (const vc of [0.3, 0.7]) {
            const sz = 5 * PX * (1 - (u - u0) / (u1 - u0));
            for (let dv = -0.08; dv <= 0.08; dv += 0.04) g.fillRect(W * u, Y(k, vc + dv), sz, sz);
          }
        },
        shade(a) {
          for (const k of all()) {
            const y0 = band(k);
            const gr = g.createLinearGradient(0, y0, 0, y0 + B);
            gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.5, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, `rgba(0,0,0,${a})`);
            g.fillStyle = gr; g.fillRect(0, y0, W, B);
          }
        },
        carbonWeave() {
          const q = 6 * PX;
          for (let y = 0; y < B * 3; y += q) for (let x = Math.round(y / q) % 2 ? 0 : q; x < W; x += 2 * q) { g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(x, y, q, q); }
        },
      };
      const design = DESIGNS[team.id];
      if (design) design(z);
      else {
        // Écurie créée par le joueur : couleur principale, bande secondaire et filets
        z.all(team.color); z.shade(0.25); z.lower(CARB);
        for (const k of [0, 1, 2]) { z.stripe(k, 0.5, team.color2, 0.035); z.diag(k, 0.4, 0.08, team.color2); }
      }
      // Numéros (orientés pour être lisibles de chaque côté)
      const numTxt = String(num);
      const drawNum = (x, y, size, sx, sy, rot) => {
        g.save();
        g.translate(x, y);
        if (rot) g.rotate(rot);
        g.scale(sx, sy);
        size *= PX;
        g.font = `italic 800 ${size}px "Barlow Condensed", Arial Narrow, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = size * 0.12;
        g.strokeStyle = team.color2;
        g.fillStyle = '#ffffff';
        g.strokeText(numTxt, 0, 0);
        g.fillText(numTxt, 0, 0);
        g.restore();
      };
      // Coque : numéro sur le dessus du nez (v = 0.5 de la bande 0)
      drawNum(W * 0.24, band(0) + B * 0.5, 54, 1, 1, Math.PI / 2);
      // Capot moteur : côtés droit (v=0.25) et gauche (v=0.75)
      drawNum(W * 0.33, band(1) + B * 0.75, 70, -1, 1);
      drawNum(W * 0.33, band(1) + B * 0.25, 70, 1, -1);
      const t = toTex(c);
      return t;
    });
  };
})();
