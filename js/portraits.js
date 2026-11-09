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
  const PALETTE = ['#ffffff', '#ffd400', '#00a3e0', '#e10600', '#ff7a00', '#1a1a1a', '#7ad1ff', '#00b050', '#ff4fa3', '#c0c0c0'];

  function drawIllustration(cv, d, team) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, u = W / 100;
    const c1 = (team && team.color) || '#555', c2 = (team && team.color2) || '#ddd';
    const r = hash(d.id || d.last);
    const helmA = PALETTE[r % PALETTE.length] === c1 ? c2 : [c1, c2, PALETTE[r % PALETTE.length]][(r >> 4) % 3];
    let helmB = PALETTE[(r >> 8) % PALETTE.length];
    if (helmB === helmA) helmB = helmA === '#1a1a1a' ? '#ffffff' : '#1a1a1a';
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
    g.fillStyle = helmA; g.fillRect(0, 0, W, H);
    g.fillStyle = helmB;
    const style = (r >> 12) % 4;
    if (style === 0) { g.fillRect(cx - 4 * u, cy - R * 1.1, 8 * u, R * 2.2); }
    else if (style === 1) { for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(cx + k * 9 * u - 3 * u, cy - R * 1.2); g.lineTo(cx + k * 9 * u + 3 * u, cy - R * 1.2); g.lineTo(cx + k * 9 * u - 12 * u, cy + R * 1.2); g.lineTo(cx + k * 9 * u - 18 * u, cy + R * 1.2); g.fill(); } }
    else if (style === 2) { g.beginPath(); g.arc(cx, cy - R * 0.2, R * 0.55, Math.PI, 0); g.lineTo(cx + R, cy - R * 1.2); g.lineTo(cx - R, cy - R * 1.2); g.fill(); }
    else { g.fillRect(0, cy + R * 0.42, W, R * 0.25); g.fillRect(0, cy - R * 0.85, W, R * 0.18); }
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
