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
    t.anisotropy = 8;
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
  X.skyTexture = function (night, seed) {
    const w = 1024, h = 512;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, h / 2);
    if (night) {
      gr.addColorStop(0, '#02040b'); gr.addColorStop(0.75, '#0b1530'); gr.addColorStop(1, '#2a3550');
    } else {
      gr.addColorStop(0, '#2f6fbf'); gr.addColorStop(0.6, '#79aee6'); gr.addColorStop(1, '#dbe9f5');
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
          v = Math.max(0, (v - 0.55) * 3.2) * (0.35 + horizon * 0.65);
          if (v > 0) {
            const a = Math.min(0.92, v);
            const k = i * 4;
            const shade = 255 - (1 - n2[i]) * 30;
            img.data[k] = img.data[k] * (1 - a) + shade * a;
            img.data[k + 1] = img.data[k + 1] * (1 - a) + shade * a;
            img.data[k + 2] = img.data[k + 2] * (1 - a) + (shade + 4) * a;
          }
        }
      }
      g.putImageData(img, 0, 0);
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
  X.livery = function (team, num) {
    const key = 'liv' + team.color + team.color2 + num;
    return once(key, () => {
      const W = 1024, B = 256, c = canvas(W, B * 3);
      const g = c.getContext('2d');
      const band = (k) => B * (2 - k); // la bande 0 est en bas (v faible)
      for (let k = 0; k < 3; k++) {
        const y0 = band(k);
        g.fillStyle = team.color; g.fillRect(0, y0, W, B);
        // Léger dégradé (reflet de la peinture)
        const gr = g.createLinearGradient(0, y0, 0, y0 + B);
        gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
        g.fillStyle = gr; g.fillRect(0, y0, W, B);
        // Bande d'accent en diagonale
        g.save();
        g.beginPath(); g.rect(0, y0, W, B); g.clip();
        g.fillStyle = team.color2;
        g.beginPath();
        const off = k === 0 ? 520 : k === 1 ? 120 : 300;
        g.moveTo(off, y0 + B); g.lineTo(off + 140, y0); g.lineTo(off + 230, y0); g.lineTo(off + 90, y0 + B);
        g.fill();
        g.fillRect(0, y0 + B * 0.47, W, B * 0.035);
        g.restore();
      }
      // Numéros (orientés pour être lisibles de chaque côté)
      const numTxt = String(num);
      const drawNum = (x, y, size, sx, sy, rot) => {
        g.save();
        g.translate(x, y);
        if (rot) g.rotate(rot);
        g.scale(sx, sy);
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
      drawNum(W * 0.2, band(0) + B * 0.5, 90, 1, 1, Math.PI / 2);
      // Capot moteur : côtés droit (v=0.25) et gauche (v=0.75)
      drawNum(W * 0.33, band(1) + B * 0.75, 70, -1, 1);
      drawNum(W * 0.33, band(1) + B * 0.25, 70, 1, -1);
      const t = toTex(c);
      return t;
    });
  };
})();
