'use strict';
// Rendu Canvas 2D : décor, piste, voitures, effets, mini-carte.
(function (root) {
  const F1 = root.F1;
  const { rng } = F1.util;

  // Prépare tout ce qui ne change pas pendant la course
  function buildScene(track) {
    const def = track.def;
    const pts = track.pts, N = track.n, half = track.half;
    const scene = { track };

    const loop = new Path2D();
    loop.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < N; i++) loop.lineTo(pts[i].x, pts[i].y);
    loop.closePath();
    scene.loop = loop;

    // Vibreurs dans les virages
    const curbs = [];
    let i = 0;
    while (i < N) {
      if (Math.abs(track.k[i]) > 0.0017) {
        let j = i;
        while (j < i + N && Math.abs(track.k[j % N]) > 0.0017) j++;
        const side = Math.sign(track.k[(i + ((j - i) >> 1)) % N]);
        const pIn = new Path2D(), pOut = new Path2D();
        for (let t = i - 3; t <= j + 3; t++) {
          const p = pts[((t % N) + N) % N];
          const off = half + 6;
          const xi = p.x + p.nx * off * side, yi = p.y + p.ny * off * side;
          const xo = p.x - p.nx * off * side, yo = p.y - p.ny * off * side;
          if (t === i - 3) { pIn.moveTo(xi, yi); pOut.moveTo(xo, yo); }
          else { pIn.lineTo(xi, yi); pOut.lineTo(xo, yo); }
        }
        curbs.push(pIn, pOut);
        i = j + 1;
      } else i++;
    }
    scene.curbs = curbs;

    // Motif d'herbe tondue
    const g = makeCanvas(160, 160);
    const gc = g.getContext('2d');
    gc.fillStyle = def.grass[0];
    gc.fillRect(0, 0, 160, 160);
    gc.fillStyle = def.grass[1];
    gc.fillRect(0, 0, 80, 160);
    const r = rng(3);
    for (let k = 0; k < 220; k++) {
      gc.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
      gc.fillRect(r() * 160, r() * 160, 2, 2);
    }
    scene.grassCanvas = g;

    // Tribune le long de la ligne droite de départ
    scene.stand = null;
    for (const side of [-1, 1]) {
      const segs = [];
      let ok = true;
      for (let t = -70; t <= 25; t += 5) {
        const p = pts[((t % N) + N) % N];
        const off = half + 150;
        const x = p.x + p.nx * off * side, y = p.y + p.ny * off * side;
        if (track.distTo(x, y) < half + 120) { ok = false; break; }
        segs.push({ x, y, a: p.ang });
      }
      if (ok) { scene.stand = segs; break; }
    }
    if (scene.stand) {
      const r2 = rng(11);
      const cols = ['#ffffff', '#e63946', '#ffd60a', '#00b4d8', '#ff7b00', '#2ec4b6', '#f1faee', '#7b2cbf'];
      scene.crowd = [];
      for (const s of scene.stand) {
        for (let k = 0; k < 14; k++) {
          const u = (r2() - 0.5) * 50, v = (r2() - 0.5) * 40;
          scene.crowd.push({
            x: s.x + Math.cos(s.a) * u - Math.sin(s.a) * v,
            y: s.y + Math.sin(s.a) * u + Math.cos(s.a) * v,
            c: cols[(r2() * cols.length) | 0],
          });
        }
      }
    }

    // Arbres et palmiers
    const b = track.bounds;
    const r3 = rng(def.id.length * 97 + 5);
    scene.trees = [];
    for (let k = 0; k < 420; k++) {
      const x = b.minX - 700 + r3() * (b.maxX - b.minX + 1400);
      const y = b.minY - 700 + r3() * (b.maxY - b.minY + 1400);
      if (track.distTo(x, y) < half + F1.PHYS.runoff + 70) continue;
      if (scene.stand && scene.stand.some((s) => Math.hypot(s.x - x, s.y - y) < 90)) continue;
      scene.trees.push({ x, y, r: 16 + r3() * 22, palm: r3() < 0.45, rot: r3() * Math.PI });
    }

    // Mini-carte
    scene.mini = buildMinimap(track, 180);
    return scene;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function minimapTransform(track, size, pad) {
    const b = track.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const s = (size - pad * 2) / Math.max(w, h);
    const ox = pad + (size - pad * 2 - w * s) / 2 - b.minX * s;
    const oy = pad + (size - pad * 2 - h * s) / 2 - b.minY * s;
    return { s, ox, oy };
  }

  function buildMinimap(track, size) {
    const dpr = 2;
    const c = makeCanvas(size * dpr, size * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const T = minimapTransform(track, size, 12);
    drawTrackOutline(ctx, track, T, 7, 'rgba(255,255,255,0.9)', 'rgba(0,0,0,0.55)');
    const p = track.pts[0];
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x * T.s + T.ox - p.nx * 7, p.y * T.s + T.oy - p.ny * 7);
    ctx.lineTo(p.x * T.s + T.ox + p.nx * 7, p.y * T.s + T.oy + p.ny * 7);
    ctx.stroke();
    return { canvas: c, T, size };
  }

  function drawTrackOutline(ctx, track, T, width, color, shadow) {
    const pts = track.pts;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * T.s + T.ox, pts[0].y * T.s + T.oy);
      for (let i = 1; i < pts.length; i += 2) ctx.lineTo(pts[i].x * T.s + T.ox, pts[i].y * T.s + T.oy);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    if (shadow) { ctx.strokeStyle = shadow; ctx.lineWidth = width + 4; path(); ctx.stroke(); }
    ctx.strokeStyle = color; ctx.lineWidth = width; path(); ctx.stroke();
  }

  // Aperçu d'un circuit pour le menu
  F1.drawTrackPreview = function (canvas, def) {
    const track = new F1.Track(def);
    const ctx = canvas.getContext('2d');
    const size = Math.min(canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const T = minimapTransform(track, size, size * 0.08);
    T.ox += (canvas.width - size) / 2;
    T.oy += (canvas.height - size) / 2;
    drawTrackOutline(ctx, track, T, size * 0.035, '#f5f5f5', 'rgba(0,0,0,0.35)');
    const p = track.pts[0];
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = size * 0.018;
    ctx.beginPath();
    ctx.moveTo(p.x * T.s + T.ox - p.nx * size * 0.04, p.y * T.s + T.oy - p.ny * size * 0.04);
    ctx.lineTo(p.x * T.s + T.ox + p.nx * size * 0.04, p.y * T.s + T.oy + p.ny * size * 0.04);
    ctx.stroke();
    return track;
  };

  // ---------- Dessin d'une voiture (vue de dessus, nez vers +x) ----------
  function drawCar(ctx, car, t) {
    const team = car.team || { color: '#ddd', color2: '#222' };
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.a);

    // Ombre
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    roundRect(ctx, -24, -14, 54, 32, 8);
    ctx.fill();

    // Pneus
    ctx.fillStyle = '#141414';
    const steerA = car.steer * 0.35;
    ctx.fillRect(-23, -17, 13, 8);
    ctx.fillRect(-23, 9, 13, 8);
    for (const sy of [-16, 10]) {
      ctx.save();
      ctx.translate(15, sy + 3);
      ctx.rotate(steerA);
      ctx.fillRect(-6, -3, 12, 6);
      ctx.restore();
    }
    // Suspensions
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(15, -13); ctx.lineTo(8, -4);
    ctx.moveTo(15, 13); ctx.lineTo(8, 4);
    ctx.moveTo(-16, -11); ctx.lineTo(-12, -6);
    ctx.moveTo(-16, 11); ctx.lineTo(-12, 6);
    ctx.stroke();

    // Aileron arrière
    ctx.fillStyle = team.color2;
    ctx.fillRect(-27, -12, 6, 24);
    ctx.fillStyle = team.color;
    ctx.fillRect(-27, -12, 2, 24);

    // Coque
    ctx.fillStyle = team.color;
    ctx.beginPath();
    ctx.moveTo(26, -2);
    ctx.lineTo(26, 2);
    ctx.lineTo(8, 4);
    ctx.lineTo(3, 9);
    ctx.lineTo(-13, 9);
    ctx.lineTo(-18, 5);
    ctx.lineTo(-23, 4);
    ctx.lineTo(-23, -4);
    ctx.lineTo(-18, -5);
    ctx.lineTo(-13, -9);
    ctx.lineTo(3, -9);
    ctx.lineTo(8, -4);
    ctx.closePath();
    ctx.fill();
    // Bande centrale
    ctx.fillStyle = team.color2;
    ctx.fillRect(-20, -1.5, 44, 3);

    // Aileron avant
    ctx.fillStyle = team.color2;
    ctx.fillRect(21, -14, 5, 28);
    ctx.fillStyle = team.color;
    ctx.fillRect(24, -14, 2, 28);

    // Halo + casque
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.5, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = car.isPlayer ? '#ffffff' : '#f2c14e';
    ctx.beginPath();
    ctx.arc(-1, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();

    // Feux stop
    if (car.brakeIn > 0.3 && car.speed > 20) {
      ctx.fillStyle = '#ff2020';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 8;
      ctx.fillRect(-29, -2, 2.5, 4);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Repère du joueur
    if (car.isPlayer) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -t * 20;
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTree(ctx, tr) {
    if (tr.palm) {
      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.rotate(tr.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(6, 6, tr.r, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 7; k++) {
        ctx.rotate((Math.PI * 2) / 7);
        ctx.fillStyle = k % 2 ? '#2f7d32' : '#3b9440';
        ctx.beginPath();
        ctx.ellipse(tr.r * 0.55, 0, tr.r * 0.6, tr.r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#6b4f2a';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(tr.x + 7, tr.y + 7, tr.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#25602a';
      ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f7a35';
      ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.25, tr.r * 0.62, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- Rendu principal ----------
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, zoom: 1 };
      this.skids = [];
      this.particles = [];
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.h + 'px';
    }

    setScene(scene) {
      this.scene = scene;
      this.grassPattern = this.ctx.createPattern(scene.grassCanvas, 'repeat');
      this.skids.length = 0;
      this.particles.length = 0;
    }

    snapCamera(car) {
      this.cam.x = car.x; this.cam.y = car.y;
    }

    // Effets : traces de pneus et poussière
    effects(cars, dt) {
      for (const car of cars) {
        const sp = car.speed;
        const marking = (car.skid > 55 && sp > 120) || (car.brakeIn > 0.8 && sp > 380 && !car.offTrack);
        const c = Math.cos(car.a), s = Math.sin(car.a);
        const rear = [
          { x: car.x - c * 16 + s * 13, y: car.y - s * 16 - c * 13 },
          { x: car.x - c * 16 - s * 13, y: car.y - s * 16 + c * 13 },
        ];
        if (marking && car.lastRear && !car.offTrack) {
          for (let k = 0; k < 2; k++) {
            this.skids.push([car.lastRear[k].x, car.lastRear[k].y, rear[k].x, rear[k].y]);
          }
          if (this.skids.length > 1600) this.skids.splice(0, this.skids.length - 1600);
        }
        car.lastRear = rear;
        if (car.offTrack && sp > 90 && Math.random() < 0.7) {
          this.particles.push({
            x: rear[(Math.random() * 2) | 0].x, y: rear[(Math.random() * 2) | 0].y,
            vx: -car.vx * 0.15 + (Math.random() - 0.5) * 60, vy: -car.vy * 0.15 + (Math.random() - 0.5) * 60,
            life: 0.9, max: 0.9, r: 8 + Math.random() * 8, sand: true,
          });
        }
        if (car.skid > 140 && sp > 200 && Math.random() < 0.5) {
          this.particles.push({
            x: rear[0].x, y: rear[0].y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
            life: 0.7, max: 0.7, r: 6 + Math.random() * 6, sand: false,
          });
        }
      }
      for (const p of this.particles) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 18 * dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
      if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    }

    draw(race, focus, t, dt) {
      const ctx = this.ctx, sc = this.scene, tr = race.track;
      const half = tr.half, runoff = F1.PHYS.runoff;

      // Caméra : suit la voiture, légère anticipation et dézoom avec la vitesse
      const sp = focus.speed;
      const base = Math.min(this.w, this.h) / (this.w < 700 ? 780 : 1000);
      const targetZoom = base * (1.15 - 0.3 * Math.min(1, sp / F1.PHYS.maxSpeed));
      const k = Math.min(1, dt * 4);
      this.cam.zoom += (targetZoom - this.cam.zoom) * Math.min(1, dt * 1.5);
      this.cam.x += (focus.x + focus.vx * 0.28 - this.cam.x) * k;
      this.cam.y += (focus.y + focus.vy * 0.28 - this.cam.y) * k;

      const z = this.cam.zoom;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(z, z);
      ctx.translate(-this.cam.x, -this.cam.y);

      const vw = this.w / z, vh = this.h / z;
      const view = { l: this.cam.x - vw / 2 - 80, t: this.cam.y - vh / 2 - 80, r: this.cam.x + vw / 2 + 80, b: this.cam.y + vh / 2 + 80 };

      ctx.fillStyle = this.grassPattern;
      ctx.fillRect(view.l, view.t, view.r - view.l, view.b - view.t);

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Mur de pneus
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = (half + runoff) * 2 + 16;
      ctx.stroke(sc.loop);
      ctx.strokeStyle = '#d8d8d8';
      ctx.lineWidth = (half + runoff) * 2 + 10;
      ctx.stroke(sc.loop);
      // Bac à sable / dégagement
      ctx.strokeStyle = tr.def.sand;
      ctx.lineWidth = (half + runoff) * 2;
      ctx.stroke(sc.loop);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = (half + runoff) * 2 - 30;
      ctx.stroke(sc.loop);
      // Vibreurs
      ctx.lineCap = 'butt';
      ctx.lineWidth = 14;
      for (const c of sc.curbs) {
        ctx.setLineDash([]);
        ctx.strokeStyle = '#f4f4f4';
        ctx.stroke(c);
        ctx.setLineDash([16, 16]);
        ctx.strokeStyle = '#d62828';
        ctx.stroke(c);
      }
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      // Bitume avec lignes blanches
      ctx.strokeStyle = '#f0f0f0';
      ctx.lineWidth = half * 2;
      ctx.stroke(sc.loop);
      ctx.strokeStyle = '#3a3d42';
      ctx.lineWidth = half * 2 - 7;
      ctx.stroke(sc.loop);
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.lineWidth = half * 0.9;
      ctx.stroke(sc.loop);

      // Ligne de départ en damier + emplacements de grille
      this.drawStart(ctx, tr);

      // Traces de pneus
      if (this.skids.length) {
        ctx.strokeStyle = 'rgba(15,15,15,0.33)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        for (const s of this.skids) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
        ctx.stroke();
        ctx.lineCap = 'round';
      }

      // Particules
      for (const p of this.particles) {
        const a = (p.life / p.max) * 0.45;
        ctx.fillStyle = p.sand ? `rgba(196,170,120,${a})` : `rgba(220,220,220,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }

      // Voitures
      for (const car of race.cars) {
        if (car.x < view.l - 40 || car.x > view.r + 40 || car.y < view.t - 40 || car.y > view.b + 40) continue;
        drawCar(ctx, car, t);
      }

      // Tribune
      if (sc.stand) {
        ctx.strokeStyle = '#5c6066';
        ctx.lineWidth = 60;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        sc.stand.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
        ctx.stroke();
        ctx.lineCap = 'round';
        for (const c of sc.crowd) {
          if (c.x < view.l || c.x > view.r || c.y < view.t || c.y > view.b) continue;
          ctx.fillStyle = c.c;
          ctx.fillRect(c.x - 2.5, c.y - 2.5, 5, 5);
        }
      }

      // Arbres (au-dessus de tout le reste)
      for (const tree of sc.trees) {
        if (tree.x < view.l - 50 || tree.x > view.r + 50 || tree.y < view.t - 50 || tree.y > view.b + 50) continue;
        drawTree(ctx, tree);
      }

      // Noms au-dessus des adversaires
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const car of race.cars) {
        if (car.isPlayer) continue;
        if (car.x < view.l || car.x > view.r || car.y < view.t || car.y > view.b) continue;
        const label = car.name;
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(car.x - w / 2, car.y - 52, w, 18);
        ctx.fillStyle = car.team.color;
        ctx.fillRect(car.x - w / 2, car.y - 52, 3, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, car.x + 1, car.y - 38);
      }
    }

    drawStart(ctx, tr) {
      const p = tr.pts[0], half = tr.half;
      const sq = 10;
      const rows = 2;
      const cols = Math.round((half * 2) / sq);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#111' : '#fafafa';
          ctx.fillRect(r * sq - sq, -half + c * sq, sq, sq);
        }
      }
      ctx.restore();
      // Grille
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3;
      for (let g = 0; g < 8; g++) {
        const pos = tr.posAt(-70 - g * 62 + 30, g % 2 === 0 ? -26 : 26);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(pos.a);
        ctx.beginPath();
        ctx.moveTo(-4, -18); ctx.lineTo(4, -18); ctx.lineTo(4, 18); ctx.lineTo(-4, 18);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawMinimap(mctx, race) {
      const mini = this.scene.mini;
      const size = mini.size;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mctx.canvas.width, mctx.canvas.height);
      const s = mctx.canvas.width / size;
      mctx.drawImage(mini.canvas, 0, 0, mctx.canvas.width, mctx.canvas.height);
      mctx.scale(s, s);
      const T = mini.T;
      const cars = race.cars.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
      for (const car of cars) {
        const x = car.x * T.s + T.ox, y = car.y * T.s + T.oy;
        mctx.fillStyle = car.team.color;
        mctx.strokeStyle = car.isPlayer ? '#fff' : 'rgba(0,0,0,0.7)';
        mctx.lineWidth = car.isPlayer ? 2.5 : 1.2;
        mctx.beginPath();
        mctx.arc(x, y, car.isPlayer ? 5.5 : 4, 0, Math.PI * 2);
        mctx.fill();
        mctx.stroke();
      }
    }
  }

  F1.buildScene = buildScene;
  F1.Renderer = Renderer;
  F1.drawCarPreview = function (canvas, team) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(canvas.width / 70, canvas.width / 70);
    ctx.rotate(-Math.PI / 2);
    drawCar(ctx, { x: 0, y: 0, a: 0, steer: 0, team, speed: 0, brakeIn: 0, isPlayer: false }, 0);
  };
})(window);
