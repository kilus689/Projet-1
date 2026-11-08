'use strict';
// Rendu Canvas 2D : décor, piste, voitures, effets, mini-carte.
(function (root) {
  const F1 = root.F1;
  const { rng } = F1.util;

  const ENV = {
    park: { bg: ['#3f8f3a', '#46993f'], runoff: '#d6c79c', wall: '#d8d8d8', deco: 'trees' },
    circuit: { bg: ['#4c8f3c', '#539842'], runoff: '#cdbd92', wall: '#d8d8d8', deco: 'sparse' },
    desert: { bg: ['#d8b98b', '#d2b284'], runoff: '#8e9399', wall: '#e3e3e3', deco: 'palms' },
    street: { bg: ['#6b6f75', '#71757b'], runoff: '#878b91', wall: '#ececec', deco: 'city' },
  };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ---------- Préparation de la scène ----------
  function buildScene(track) {
    const pts = track.pts, N = track.n, half = track.half;
    const env = ENV[track.env] || ENV.circuit;
    const scene = { track, env, decoCache: new Map() };

    // Tracé découpé en morceaux pour ne dessiner que la partie visible
    const CH = 120;
    const pad = half + track.runoff + 20;
    scene.chunks = [];
    for (let s = 0; s < N; s += CH) {
      const path = new Path2D();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = s; i <= Math.min(s + CH, N); i++) {
        const p = pts[i % N];
        if (i === s) path.moveTo(p.x, p.y); else path.lineTo(p.x, p.y);
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      scene.chunks.push({ path, l: minX - pad, t: minY - pad, r: maxX + pad, b: maxY + pad });
    }

    // Vibreurs dans les virages
    scene.curbs = [];
    const TH = 0.0022;
    let i = 0;
    while (i < N) {
      if (Math.abs(track.k[i]) > TH) {
        let j = i;
        while (j < i + N && Math.abs(track.k[j % N]) > TH) j++;
        const side = Math.sign(track.k[(i + ((j - i) >> 1)) % N]);
        for (const sd of [side, -side]) {
          const path = new Path2D();
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let t = i - 3; t <= j + 3; t++) {
            const p = pts[((t % N) + N) % N];
            const x = p.x + p.nx * (half + 6) * sd, y = p.y + p.ny * (half + 6) * sd;
            if (t === i - 3) path.moveTo(x, y); else path.lineTo(x, y);
            minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
          scene.curbs.push({ path, l: minX - 20, t: minY - 20, r: maxX + 20, b: maxY + 20 });
        }
        i = j + 1;
      } else i++;
    }

    // Motif du sol
    const g = makeCanvas(160, 160);
    const gc = g.getContext('2d');
    gc.fillStyle = env.bg[0];
    gc.fillRect(0, 0, 160, 160);
    gc.fillStyle = env.bg[1];
    if (track.env === 'street') { gc.fillRect(0, 0, 78, 78); gc.fillRect(80, 80, 80, 80); } else gc.fillRect(0, 0, 80, 160);
    const r = rng(3);
    for (let k = 0; k < 260; k++) {
      gc.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
      gc.fillRect(r() * 160, r() * 160, 2, 2);
    }
    scene.groundCanvas = g;

    // Tribune près de la ligne de départ
    scene.stand = null;
    for (const side of [1, -1]) {
      const segs = [];
      let ok = true;
      const off = half + track.runoff + 60;
      for (let t = -90; t <= 30; t += 5) {
        const p = pts[((t % N) + N) % N];
        const x = p.x + p.nx * off * side, y = p.y + p.ny * off * side;
        if (track.distTo(x, y) < off - 15) { ok = false; break; }
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

    scene.mini = buildMinimap(track, 180);
    return scene;
  }

  // Décor généré à la demande, par case de 700 px
  const DCELL = 700;
  function decoCell(scene, cx, cy) {
    const key = cx * 65536 + cy;
    let list = scene.decoCache.get(key);
    if (list) return list;
    list = [];
    const track = scene.track;
    const r = rng((cx * 73856093) ^ (cy * 19349663) ^ track.id.length * 83492791);
    const clear = track.half + track.runoff + 50;
    const kind = scene.env.deco;
    const count = kind === 'city' ? 5 : kind === 'sparse' ? 4 : kind === 'palms' ? 3 : 9;
    for (let k = 0; k < count; k++) {
      const x = cx * DCELL + r() * DCELL, y = cy * DCELL + r() * DCELL;
      if (kind === 'city' && r() < 0.75) {
        const w = 90 + r() * 260, h = 90 + r() * 260;
        const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y + h / 2], [x + w / 2, y], [x, y + h / 2], [x + w, y + h / 2], [x + w / 2, y + h]];
        if (corners.some(([a, b]) => track.distTo(a, b) < clear)) continue;
        const shade = 150 + ((r() * 70) | 0);
        list.push({ t: 'b', x, y, w, h, c: `rgb(${shade},${shade - 8},${shade - 18})`, h2: 8 + r() * 26 });
      } else {
        const rad = 16 + r() * 22;
        if (track.distTo(x, y) < clear + rad) continue;
        const palm = kind === 'palms' || (kind === 'trees' && r() < 0.3);
        if (kind === 'palms' && r() < 0.4) list.push({ t: 'rock', x, y, r: 8 + r() * 14 });
        else list.push({ t: palm ? 'palm' : 'tree', x, y, r: rad, rot: r() * Math.PI });
      }
    }
    if (scene.decoCache.size > 3000) scene.decoCache.clear();
    scene.decoCache.set(key, list);
    return list;
  }

  function minimapTransform(track, size, pad) {
    const b = track.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const s = (size - pad * 2) / Math.max(w, h);
    const ox = pad + (size - pad * 2 - w * s) / 2 - b.minX * s;
    const oy = pad + (size - pad * 2 - h * s) / 2 - b.minY * s;
    return { s, ox, oy };
  }

  function drawOutline(ctx, track, T, width, color, shadow) {
    const pts = track.pts;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * T.s + T.ox, pts[0].y * T.s + T.oy);
      for (let i = 4; i < pts.length; i += 4) ctx.lineTo(pts[i].x * T.s + T.ox, pts[i].y * T.s + T.oy);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    if (shadow) { ctx.strokeStyle = shadow; ctx.lineWidth = width + 4; path(); ctx.stroke(); }
    ctx.strokeStyle = color; ctx.lineWidth = width; path(); ctx.stroke();
  }

  function startMark(ctx, track, T, len, width) {
    const p = track.pts[0];
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p.x * T.s + T.ox - p.nx * len, p.y * T.s + T.oy - p.ny * len);
    ctx.lineTo(p.x * T.s + T.ox + p.nx * len, p.y * T.s + T.oy + p.ny * len);
    ctx.stroke();
  }

  function buildMinimap(track, size) {
    const dpr = 2;
    const c = makeCanvas(size * dpr, size * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const T = minimapTransform(track, size, 12);
    drawOutline(ctx, track, T, 5, 'rgba(255,255,255,0.9)', 'rgba(0,0,0,0.55)');
    startMark(ctx, track, T, 6, 2.5);
    return { canvas: c, T, size };
  }

  // Aperçu d'un circuit (menus)
  F1.drawTrackPreview = function (canvas, gp, opts) {
    const track = F1.getTrack(gp);
    const ctx = canvas.getContext('2d');
    const size = Math.min(canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const T = minimapTransform(track, size, size * 0.08);
    T.ox += (canvas.width - size) / 2;
    T.oy += (canvas.height - size) / 2;
    drawOutline(ctx, track, T, Math.max(2, size * 0.022), (opts && opts.color) || '#f5f5f5', 'rgba(0,0,0,0.35)');
    startMark(ctx, track, T, size * 0.035, Math.max(2, size * 0.014));
    return track;
  };

  // ---------- Voiture (vue de dessus, nez vers +x) ----------
  function drawCar(ctx, car, t) {
    const team = car.team || { color: '#ddd', color2: '#222' };
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.a);

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    roundRect(ctx, -24, -14, 54, 32, 8);
    ctx.fill();

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
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(15, -13); ctx.lineTo(8, -4);
    ctx.moveTo(15, 13); ctx.lineTo(8, 4);
    ctx.moveTo(-16, -11); ctx.lineTo(-12, -6);
    ctx.moveTo(-16, 11); ctx.lineTo(-12, 6);
    ctx.stroke();

    ctx.fillStyle = team.color2;
    ctx.fillRect(-27, -12, 6, 24);
    ctx.fillStyle = team.color;
    ctx.fillRect(-27, -12, 2, 24);

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
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = team.color2;
    ctx.fillRect(-12, -9, 3, 18);
    ctx.fillRect(4, -1.5, 20, 3);

    ctx.fillStyle = team.color2;
    ctx.fillRect(21, -14, 5, 28);
    ctx.fillStyle = team.color;
    ctx.fillRect(24, -14, 2, 28);

    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.5, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = car.isPlayer ? '#ffffff' : team.color2;
    ctx.beginPath();
    ctx.arc(-1, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();

    if (car.brakeIn > 0.3 && car.speed > 20) {
      ctx.fillStyle = '#ff2020';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 8;
      ctx.fillRect(-29, -2, 2.5, 4);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

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

  function drawDeco(ctx, d) {
    if (d.t === 'b') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(d.x + d.h2, d.y + d.h2, d.w, d.h);
      ctx.fillStyle = d.c;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 3;
      ctx.strokeRect(d.x + 10, d.y + 10, d.w - 20, d.h - 20);
    } else if (d.t === 'rock') {
      ctx.fillStyle = '#a88a62';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#bb9d74';
      ctx.beginPath(); ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.55, 0, Math.PI * 2); ctx.fill();
    } else if (d.t === 'palm') {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(6, 6, d.r, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 7; k++) {
        ctx.rotate((Math.PI * 2) / 7);
        ctx.fillStyle = k % 2 ? '#2f7d32' : '#3b9440';
        ctx.beginPath();
        ctx.ellipse(d.r * 0.55, 0, d.r * 0.6, d.r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#6b4f2a';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(d.x + 7, d.y + 7, d.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#25602a';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f7a35';
      ctx.beginPath(); ctx.arc(d.x - d.r * 0.25, d.y - d.r * 0.25, d.r * 0.62, 0, Math.PI * 2); ctx.fill();
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
      this.groundPattern = this.ctx.createPattern(scene.groundCanvas, 'repeat');
      this.skids.length = 0;
      this.particles.length = 0;
    }

    snapCamera(car) { this.cam.x = car.x; this.cam.y = car.y; }

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
          for (let k = 0; k < 2; k++) this.skids.push([car.lastRear[k].x, car.lastRear[k].y, rear[k].x, rear[k].y]);
          if (this.skids.length > 2000) this.skids.splice(0, this.skids.length - 2000);
        }
        car.lastRear = rear;
        if (car.offTrack && sp > 90 && Math.random() < 0.6) {
          const w = rear[(Math.random() * 2) | 0];
          this.particles.push({
            x: w.x, y: w.y,
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
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 18 * dt; }
      this.particles = this.particles.filter((p) => p.life > 0);
      if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    }

    draw(race, focus, t, dt) {
      const ctx = this.ctx, sc = this.scene, tr = race.track;
      const half = tr.half, runoff = tr.runoff;

      const sp = focus.speed;
      const base = Math.min(this.w, this.h) / (this.w < 700 ? 780 : 1000);
      const targetZoom = base * (1.15 - 0.32 * Math.min(1, sp / F1.PHYS.maxSpeed));
      const k = Math.min(1, dt * 4);
      this.cam.zoom += (targetZoom - this.cam.zoom) * Math.min(1, dt * 1.5);
      const look = this.rotate ? 0.1 : 0.28;
      this.cam.x += (focus.x + focus.vx * look - this.cam.x) * k;
      this.cam.y += (focus.y + focus.vy * look - this.cam.y) * k;

      const z = this.cam.zoom;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      let V;
      if (this.rotate) {
        // Vue de dessus qui tourne avec la voiture (nez vers le haut de l'écran)
        if (this.cam.a == null) this.cam.a = focus.a;
        this.cam.a += F1.util.wrapAngle(focus.a - this.cam.a) * Math.min(1, dt * 5);
        const ay = this.h * 0.64;
        ctx.translate(this.w / 2, ay);
        ctx.scale(z, z);
        ctx.rotate(-this.cam.a - Math.PI / 2);
        ctx.translate(-this.cam.x, -this.cam.y);
        const R = Math.hypot(this.w / 2, ay) / z + 60;
        V = { l: this.cam.x - R, t: this.cam.y - R, r: this.cam.x + R, b: this.cam.y + R };
      } else {
        this.cam.a = null;
        ctx.translate(this.w / 2, this.h / 2);
        ctx.scale(z, z);
        ctx.translate(-this.cam.x, -this.cam.y);
        const vw = this.w / z, vh = this.h / z;
        V = { l: this.cam.x - vw / 2 - 60, t: this.cam.y - vh / 2 - 60, r: this.cam.x + vw / 2 + 60, b: this.cam.y + vh / 2 + 60 };
      }
      const inView = (o) => !(o.r < V.l || o.l > V.r || o.b < V.t || o.t > V.b);
      const chunks = sc.chunks.filter(inView);

      ctx.fillStyle = this.groundPattern;
      ctx.fillRect(V.l, V.t, V.r - V.l, V.b - V.t);

      // Décor au sol (bâtiments) sous la piste
      const c0x = Math.floor(V.l / DCELL), c1x = Math.floor(V.r / DCELL);
      const c0y = Math.floor(V.t / DCELL), c1y = Math.floor(V.b / DCELL);
      const decos = [];
      for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) decos.push(...decoCell(sc, cx, cy));
      for (const d of decos) if (d.t === 'b' || d.t === 'rock') drawDeco(ctx, d);

      const strokeAll = (style, width, cap) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.lineCap = cap || 'round';
        for (const c of chunks) ctx.stroke(c.path);
      };
      ctx.lineJoin = 'round';
      // Murs / barrières
      strokeAll('#2b2b2b', (half + runoff) * 2 + 16);
      strokeAll(sc.env.wall, (half + runoff) * 2 + 10);
      // Dégagement
      strokeAll(sc.env.runoff, (half + runoff) * 2);
      // Vibreurs
      ctx.lineCap = 'butt';
      ctx.lineWidth = 14;
      for (const c of sc.curbs) {
        if (!inView(c)) continue;
        ctx.setLineDash([]);
        ctx.strokeStyle = '#f4f4f4';
        ctx.stroke(c.path);
        ctx.setLineDash([16, 16]);
        ctx.strokeStyle = '#d62828';
        ctx.stroke(c.path);
      }
      ctx.setLineDash([]);
      // Bitume
      strokeAll('#f0f0f0', half * 2);
      strokeAll('#3a3d42', half * 2 - 7);
      strokeAll('rgba(255,255,255,0.025)', half * 0.9);

      this.drawStart(ctx, race);

      if (this.skids.length) {
        ctx.strokeStyle = 'rgba(15,15,15,0.33)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        for (const s of this.skids) {
          if (s[0] < V.l || s[0] > V.r || s[1] < V.t || s[1] > V.b) continue;
          ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]);
        }
        ctx.stroke();
      }
      ctx.lineCap = 'round';

      for (const p of this.particles) {
        const a = (p.life / p.max) * 0.45;
        ctx.fillStyle = p.sand ? `rgba(196,170,120,${a})` : `rgba(220,220,220,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }

      for (const car of race.cars) {
        if (car.x < V.l - 40 || car.x > V.r + 40 || car.y < V.t - 40 || car.y > V.b + 40) continue;
        drawCar(ctx, car, t);
      }

      if (sc.stand) {
        ctx.strokeStyle = '#5c6066';
        ctx.lineWidth = 60;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        sc.stand.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
        ctx.stroke();
        ctx.lineCap = 'round';
        for (const c of sc.crowd) {
          if (c.x < V.l || c.x > V.r || c.y < V.t || c.y > V.b) continue;
          ctx.fillStyle = c.c;
          ctx.fillRect(c.x - 2.5, c.y - 2.5, 5, 5);
        }
      }

      for (const d of decos) if (d.t === 'tree' || d.t === 'palm') drawDeco(ctx, d);

      // Codes pilotes au-dessus des voitures adverses (dessinés à l'écran, jamais tournés)
      const m = ctx.getTransform();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const w = 40;
      for (const car of race.cars) {
        if (car.isPlayer) continue;
        if (car.x < V.l || car.x > V.r || car.y < V.t || car.y > V.b) continue;
        const sx = (m.a * car.x + m.c * car.y + m.e) / this.dpr;
        const sy = (m.b * car.x + m.d * car.y + m.f) / this.dpr - 34 * z;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(sx - w / 2, sy - 17, w, 17);
        ctx.fillStyle = car.team.color;
        ctx.fillRect(sx - w / 2, sy - 17, 3, 17);
        ctx.fillStyle = '#fff';
        ctx.fillText(car.code, sx + 1, sy - 4);
      }
    }

    drawStart(ctx, race) {
      const tr = race.track;
      const p = tr.pts[0], half = tr.half;
      const sq = 10;
      const cols = Math.round((half * 2) / sq);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#111' : '#fafafa';
          ctx.fillRect(r * sq - sq, -half + c * sq, sq, sq);
        }
      }
      ctx.restore();
      if (race.mode !== 'race') return;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3;
      for (let g = 0; g < race.cars.length; g++) {
        const pos = tr.posAt(-70 - g * 80 + 30, g % 2 === 0 ? -half * 0.4 : half * 0.4);
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
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mctx.canvas.width, mctx.canvas.height);
      const s = mctx.canvas.width / mini.size;
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
        mctx.arc(x, y, car.isPlayer ? 5.5 : 3.5, 0, Math.PI * 2);
        mctx.fill();
        mctx.stroke();
      }
    }
  }

  F1.buildScene = buildScene;
  F1.decoCell = decoCell;
  F1.DECO_CELL = DCELL;
  F1.Renderer = Renderer;
  F1.drawCarPreview = function (canvas, team) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    const s = Math.min(canvas.width, canvas.height) / 62;
    ctx.scale(s, s);
    if (canvas.height > canvas.width) ctx.rotate(-Math.PI / 2);
    drawCar(ctx, { x: 0, y: 0, a: 0, steer: 0, team, speed: 0, brakeIn: 0, isPlayer: false }, 0);
  };
})(window);
