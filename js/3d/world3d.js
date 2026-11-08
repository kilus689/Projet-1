'use strict';
// Construction du circuit en 3D : ciel, sol, piste, vibreurs, dégagements, barrières,
// stands, tribunes, panneaux, éclairage, végétation et bâtiments.
(function () {
  const F1 = window.F1;
  const T = window.THREE;
  const X = F1.X3D;
  const G = X.geo;

  const NIGHT = new Set(['sg-2008', 'us-2023', 'bh-2002', 'sa-2021', 'qa-2004', 'ae-2009']);
  const TROPICAL = new Set(['us-2022', 'sg-2008', 'br-1940', 'mx-1962', 'ae-2009', 'qa-2004', 'bh-2002', 'sa-2021', 'au-1953']);
  X.isNight = (id) => NIGHT.has(id);

  // ---------- Rubans le long du tracé ----------
  // offs : décalages latéraux (gauche -> droite) ; ys : hauteur de chaque décalage (nombre ou tableau)
  function ribbon(track, offs, ys, vScale, i0, i1, colorFn) {
    const pts = track.pts, N = track.n, sp = track.spacing;
    if (i0 == null) { i0 = 0; i1 = N; }
    const L = offs.length;
    const pos = [], uv = [], idx = [], col = colorFn ? [] : null;
    let k = 0;
    for (let i = i0; i <= i1; i++, k++) {
      const ii = ((i % N) + N) % N;
      const p = pts[ii];
      for (let j = 0; j < L; j++) {
        const o = offs[j];
        pos.push(p.x + p.nx * o, (Array.isArray(ys) ? ys[j] : ys) + (track.h ? track.h[ii] * 10 : 0), p.y + p.ny * o);
        uv.push(j / (L - 1), (i * sp) / vScale);
        if (col) { const c = colorFn(ii, o); col.push(c, c, c); }
      }
      if (k > 0) {
        const a = (k - 1) * L, b = k * L;
        for (let j = 0; j < L - 1; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Zones où une barrière couperait une autre portion de piste (tracés serrés, croisement de Suzuka)
  function blockedMask(track, off) {
    const pts = track.pts, N = track.n;
    const m = new Uint8Array(N);
    const lim = (track.half + 16) ** 2;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const x = p.x + p.nx * off, y = p.y + p.ny * off;
      const cx = Math.floor(x / track.cell), cy = Math.floor(y / track.cell);
      outer: for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = track.grid.get(track.cellKey(cx + a, cy + b));
        if (!arr) continue;
        for (const j of arr) {
          let di = Math.abs(j - i); di = Math.min(di, N - di);
          if (di < 60) continue;
          const q = pts[j];
          if ((q.x - x) ** 2 + (q.y - y) ** 2 < lim) { m[i] = 1; break outer; }
        }
      }
    }
    return m;
  }

  // Paroi verticale à un décalage donné, seulement là où keep(i) est vrai
  function wall(track, off, y0, y1, vScale, keep) {
    const pts = track.pts, N = track.n, sp = track.spacing;
    const pos = [], uv = [], idx = [];
    let k = 0;
    for (let i = 0; i <= N; i++) {
      const ii = i % N;
      const p = pts[ii];
      const x = p.x + p.nx * off, z = p.y + p.ny * off;
      const hh = track.h ? track.h[ii] * 10 : 0;
      pos.push(x, y0 + hh, z, x, y1 + hh, z);
      // Côté droit : texture inversée pour que les textes se lisent depuis la piste
      const u = ((off > 0 ? -1 : 1) * i * sp) / vScale;
      uv.push(u, 0, u, 1);
      if (i > 0 && keep(ii) && keep((i - 1) % N)) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      k++;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const std = (o) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0, side: T.DoubleSide }, o));

  function instanced(scene, geo, mat, items, place, opts) {
    if (!items.length) return null;
    const im = new T.InstancedMesh(geo, mat, items.length);
    const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), E = new T.Euler();
    const col = new T.Color();
    items.forEach((d, k) => {
      E.set(0, 0, 0);
      const c = place(d, P, S, E, col);
      Q.setFromEuler(E);
      M.compose(P, Q, S);
      im.setMatrixAt(k, M);
      if (c) im.setColorAt(k, col);
    });
    if (opts && opts.cast) im.castShadow = true;
    if (opts && opts.receive) im.receiveShadow = true;
    scene.add(im);
    return im;
  }

  // Hauteur du sol (unités) : collée à la piste près du tracé, terrain réel plus loin
  function groundFn(track) {
    const pts = track.pts, half = track.half, run = track.runoff;
    return (x, z) => {
      const cx = Math.floor(x / track.cell), cy = Math.floor(z / track.cell);
      let bd = Infinity;
      const cand = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = track.grid.get(track.cellKey(cx + a, cy + b));
        if (!arr) continue;
        for (const j of arr) {
          const d = (pts[j].x - x) ** 2 + (pts[j].y - z) ** 2;
          if (d < bd) bd = d;
          if (d < 360000) cand.push(j, d);
        }
      }
      const dem = track.groundAt(x, z) * 10;
      if (bd === Infinity) return dem;
      const d = Math.sqrt(bd);
      let hMin = Infinity;
      const lim = (d + 60) ** 2;
      for (let k = 0; k < cand.length; k += 2) if (cand[k + 1] <= lim) hMin = Math.min(hMin, track.h[cand[k]] * 10);
      if (hMin === Infinity) return dem;
      let t = (d - (half + run + 30)) / 420;
      t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      return (hMin - 2) * (1 - t) + dem * t;
    };
  }

  // ---------- Construction ----------
  X.buildWorld = function (track, scene2d, quality, weather) {
    const rain = weather === 'rain', cloudy = weather === 'cloudy';
    const s = new T.Scene();
    const id = track.id, night = NIGHT.has(id);
    const env = track.env;
    const half = track.half, run = track.runoff, N = track.n, sp = track.spacing;
    const tx = X.tex;
    const add = (geo, mat, recv, cast) => { const m = new T.Mesh(geo, mat); m.receiveShadow = recv !== false; if (cast) m.castShadow = true; s.add(m); return m; };
    const info = { night, gantryLights: [] };
    const H = (i) => (track.h ? track.h[((i % N) + N) % N] * 10 : 0);
    const groundY = groundFn(track);
    info.groundY = groundY;

    // Ciel, brouillard, reflets
    const sky = X.skyTexture(night, id.length * 7, weather);
    const dome = new T.Mesh(new T.SphereGeometry(20000, 32, 16), new T.MeshBasicMaterial({ map: sky, side: T.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -1;
    s.add(dome);
    info.dome = dome;
    s.fog = rain ? new T.Fog(night ? 0x161c28 : 0x9aa3ac, 1200, night ? 7000 : 9000)
      : new T.Fog(night ? 0x1c2436 : cloudy ? 0xc6ced6 : 0xd2e1ec, night ? 2500 : 4500, night ? 14000 : cloudy ? 16000 : 19000);
    info.sky = sky;

    // Lumières
    const hemi = new T.HemisphereLight(night ? 0xc8d4ff : 0xdbe8ff, night ? 0x2a2a33 : 0x6b6450, night ? 1.6 : rain ? 1.15 : cloudy ? 1.35 : 1.25);
    s.add(hemi);
    const sun = new T.DirectionalLight(night ? 0xe8efff : 0xfff1dc, night ? 1.6 : rain ? 0.7 : cloudy ? 1.4 : 3.0);
    sun.position.set(night ? 0 : 900, 1600, night ? 200 : 500);
    if (quality !== 'low') {
      sun.castShadow = true;
      const sz = quality === 'high' ? 2048 : 1024;
      sun.shadow.mapSize.set(sz, sz);
      const c = sun.shadow.camera;
      c.left = -260; c.right = 260; c.top = 260; c.bottom = -260; c.near = 100; c.far = 4000;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
    }
    s.add(sun, sun.target);
    info.sun = sun;

    // Sol
    const b = track.bounds, pad = 16000;
    const gw = b.maxX - b.minX + pad * 2, gh = b.maxY - b.minY + pad * 2;
    const groundBase = env === 'desert' ? '#cfae7f' : env === 'street' ? '#7a7d82' : '#47913f';
    const gtex = (env === 'park' || env === 'circuit') ? tx.grass([groundBase]).clone() : tx.ground(groundBase).clone();
    gtex.needsUpdate = true;
    gtex.repeat.set(gw / 260, gh / 260);
    let minG = 0;
    if (track.dem) {
      const E = track.dem, step = quality === 'low' ? 320 : 200;
      const x0 = E.ox, z0 = E.oy, x1 = E.ox + (E.nx - 1) * E.sp, z1 = E.oy + (E.ny - 1) * E.sp;
      const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
      const pos = [], uv = [], idx = [];
      minG = Infinity;
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        const y = groundY(x, z);
        minG = Math.min(minG, y);
        pos.push(x, y, z);
        uv.push(x / 260, z / 260);
        if (i < nx && j < nz) { const a = j * (nx + 1) + i; idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2); }
      }
      const gg = new T.BufferGeometry();
      gg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      gg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      gg.setIndex(idx);
      gg.computeVertexNormals();
      const gt2 = gtex.clone(); gt2.needsUpdate = true; gt2.repeat.set(1, 1);
      add(gg, std({ map: gt2, side: T.FrontSide }));
    }
    const ground = add(new T.PlaneGeometry(gw * 2, gh * 2), std({ map: gtex, side: T.FrontSide }));
    gtex.repeat.set(gw * 2 / 260, gh * 2 / 260);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, track.dem ? minG - 40 : -0.3, (b.minY + b.maxY) / 2);

    // Virages : indices et côté extérieur
    const TH = 0.0022;
    const corner = new Int8Array(N); // signe du côté extérieur, 0 en ligne droite
    const runs = [];
    for (let i = 0; i < N;) {
      if (Math.abs(track.k[i]) > TH) {
        let j = i;
        let kmax = 0;
        while (j < i + N && Math.abs(track.k[j % N]) > TH) { kmax = Math.max(kmax, Math.abs(track.k[j % N])); j++; }
        const outside = -Math.sign(track.k[(i + ((j - i) >> 1)) % N]);
        runs.push({ i, j, outside, kmax });
        for (let t = i - 25; t <= j + 35; t++) corner[((t % N) + N) % N] = outside;
        i = j + 1;
      } else i++;
    }

    // Dégagements
    const kerbOut = half + 13;
    if (env === 'park' || env === 'circuit') {
      const turf = tx.turf().clone(); turf.needsUpdate = true;
      for (const sd of [1, -1]) add(ribbon(track, sd > 0 ? [kerbOut - 1, half + 32] : [-(half + 32), -(kerbOut - 1)], 0.18, 60), std({ map: turf }));
      // Bacs à gravier à l'extérieur des virages
      const gr = std({ map: tx.gravel() });
      for (const r of runs) {
        const sd = r.outside;
        add(ribbon(track, sd > 0 ? [half + 31, half + run] : [-(half + run), -(half + 31)], 0.14, 90, r.i - 20, r.j + 30), gr);
      }
    } else {
      const ra = std({ map: tx.lightAsphalt() });
      for (const sd of [1, -1]) add(ribbon(track, sd > 0 ? [kerbOut - 1, half + run] : [-(half + run), -(kerbOut - 1)], 0.2, 120), ra);
      if (env === 'desert') {
        const gr = std({ map: tx.gravel() });
        for (const r of runs) {
          const sd = r.outside;
          add(ribbon(track, sd > 0 ? [half + 55, half + run] : [-(half + run), -(half + 55)], 0.24, 90, r.i - 10, r.j + 25), gr);
        }
      }
    }

    // Bitume avec trajectoire gommée (plus sombre) et bords plus poussiéreux
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = -12; j <= 12; j++) acc += Math.max(-1, Math.min(1, track.k[(i + 10 + j + N) % N] * 900));
      line[i] = (acc / 25) * half * 0.55;
    }
    const lanes = [];
    for (let k = 0; k <= 10; k++) lanes.push(-half + (2 * half * k) / 10);
    const asph = tx.asphalt().clone(); asph.needsUpdate = true;
    asph.repeat.set(1.5, 1);
    add(ribbon(track, lanes, 0.5, 220, 0, N, (i, o) => {
      const d = o - line[i];
      const rub = 0.3 * Math.exp(-(d * d) / (2 * 15 * 15));
      const edge = Math.abs(o) > half * 0.8 ? 0.12 : 0;
      return 1.05 - rub + edge * 0.5;
    }), std({ map: asph, vertexColors: true, roughness: rain ? 0.28 : 0.85, metalness: rain ? 0.25 : 0, color: rain ? 0x8a8d92 : 0xffffff }));
    // Lignes blanches de bord de piste
    const white = std({ color: 0xf4f4f4, roughness: 0.6 });
    add(ribbon(track, [-half, -half + 4], 0.58, 400), white);
    add(ribbon(track, [half - 4, half], 0.58, 400), white);

    // Vibreurs en relief
    const curbMat = std({ map: tx.curb(), roughness: 0.6 });
    for (const r of runs) {
      for (const sd of [1, -1]) {
        const offs = sd > 0 ? [half - 2, half + 5, kerbOut] : [-kerbOut, -half - 5, -half + 2];
        const ys = sd > 0 ? [0.55, 1.15, 0.7] : [0.7, 1.15, 0.55];
        add(ribbon(track, offs, ys, 26, r.i - 4, r.j + 4), curbMat);
      }
    }

    // Ligne de départ, cases de la grille
    const p0 = track.pts[0];
    const ck = tx.checker().clone(); ck.needsUpdate = true; ck.repeat.set(half / 16, 0.4);
    const startLine = add(new T.PlaneGeometry(12, half * 2), std({ map: ck, side: T.FrontSide }));
    startLine.rotation.set(-Math.PI / 2, 0, -p0.ang);
    startLine.position.set(p0.x, 0.6 + H(0), p0.y);
    const gridGeo = [];
    for (let gIdx = 0; gIdx < 24; gIdx++) {
      const pos = track.posAt(-70 - gIdx * 80 + 30, gIdx % 2 === 0 ? -half * 0.4 : half * 0.4);
      const bar = new T.BoxGeometry(1.5, 0.1, 20);
      bar.rotateY(-pos.a);
      bar.translate(pos.x, 0.62 + H(pos.idx), pos.y);
      gridGeo.push(bar);
    }
    add(G.merge(gridGeo), white);

    // ---------- Barrières ----------
    const pitSide = scene2d && scene2d.stand
      ? -Math.sign((scene2d.stand[0].x - p0.x) * p0.nx + (scene2d.stand[0].y - p0.y) * p0.ny) || 1
      : 1;
    // Zone des stands le long de la ligne droite de départ
    let pitRange = null;
    {
      const off = pitSide * (half + run + 175);
      let a = 0, z = 0;
      const ok = (t) => {
        const p = track.pts[((t % N) + N) % N];
        return track.distTo(p.x + p.nx * off, p.y + p.ny * off) > half + run + 150 && track.distTo(p.x + p.nx * off * 0.4, p.y + p.ny * off * 0.4) > Math.abs(off * 0.4) - 25;
      };
      while (a > -260 && ok(a - 5)) a -= 5;
      while (z < 70 && ok(z + 5)) z += 5;
      if (z - a >= 100) pitRange = [a, z];
    }
    const inPit = (i, sd) => {
      if (!pitRange || sd !== pitSide) return false;
      let d = i > N / 2 ? i - N : i;
      return d >= pitRange[0] && d <= pitRange[1];
    };

    const posts = [], fencePosts = [];
    for (const sd of [1, -1]) {
      const off = sd * (half + run);
      const blocked = blockedMask(track, off);
      const free = (i) => !blocked[i];
      if (env === 'street') {
        add(wall(track, off, 0, 11, 1024, (i) => free(i) && !inPit(i, sd)), std({ map: tx.concrete(), roughness: 0.8 }), true, true);
      } else {
        const tec = (i) => free(i) && corner[i] === sd && !inPit(i, sd);
        const arm = (i) => free(i) && corner[i] !== sd && !inPit(i, sd);
        add(wall(track, off, 0, 10, 26, tec), std({ map: tx.tecpro(), roughness: 0.7 }), true, true);
        const armMat = std({ map: tx.armco(), metalness: 0.6, roughness: 0.4 });
        add(wall(track, off, 3.0, 4.6, 40, arm), armMat);
        add(wall(track, off, 5.4, 7.0, 40, arm), armMat);
        for (let i = 0; i < N; i += 4) if (arm(i)) posts.push({ i, off });
      }
      // Muret des stands
      if (pitRange) add(wall(track, off, 0, 11, 256, (i) => inPit(i, sd)), std({ map: tx.pitwall(), roughness: 0.8 }), true, true);
      // Grillage de sécurité
      if (quality !== 'low') {
        const fOff = off + sd * 2;
        const top = env === 'street' ? 11 : 0;
        const fence = tx.chainlink().clone(); fence.needsUpdate = true;
        fence.repeat.set(1, 6);
        add(wall(track, fOff, top, 38, 12, free), std({ map: fence, transparent: false, alphaTest: 0.5, metalness: 0.6, roughness: 0.5 }), false);
        for (let i = 0; i < N; i += 6) if (free(i)) fencePosts.push({ i, off: fOff });
      }
    }
    const postMat = std({ color: 0x8b9096, metalness: 0.7, roughness: 0.4 });
    const pl = (d, P, S) => { const p = track.pts[d.i]; P.set(p.x + p.nx * d.off, H(d.i), p.y + p.ny * d.off); };
    instanced(s, new T.BoxGeometry(0.6, 7, 0.6).translate(0, 3.5, 0), postMat, posts, (d, P, S) => { pl(d, P, S); S.set(1, 1, 1); });
    instanced(s, new T.CylinderGeometry(0.35, 0.35, 40, 5).translate(0, 20, 0), postMat, fencePosts, (d, P, S) => { pl(d, P, S); S.set(1, 1, 1); });

    // ---------- Stands : voie des stands et garages ----------
    if (pitRange) {
      const [a, z] = pitRange;
      const o = (v) => pitSide * (half + run + v);
      const rng = (o1, o2) => (pitSide > 0 ? [o(o1), o(o2)] : [o(o2), o(o1)]);
      add(ribbon(track, rng(3, 55), 0.3, 220, a, z), std({ map: tx.asphalt() }));
      add(ribbon(track, rng(28, 29.2), 0.36, 400, a, z), white);
      const keep = (i) => { let d = i > N / 2 ? i - N : i; return d >= a && d <= z; };
      add(wall(track, o(60), 0, 72, 1280, keep), std({ map: tx.garage(), roughness: 0.7 }), true, true);
      add(wall(track, o(60), 72, 112, 300, keep), std({ map: tx.facade(night), roughness: 0.3, metalness: 0.4, emissive: night ? 0x332211 : 0x000000 }), true, true);
      add(wall(track, o(170), 0, 112, 300, keep), std({ map: tx.facade(night) }), true, true);
      add(ribbon(track, rng(52, 172), 112, 400, a, z), std({ color: 0xd8dadc, roughness: 0.6 }), true, true);
    }

    // ---------- Tribunes (ligne droite + grands virages) ----------
    const crowd = std({ map: tx.crowd() });
    const steel = std({ color: 0x6d737a, metalness: 0.5, roughness: 0.5 });
    const roofMat = std({ color: 0xe9ecef, roughness: 0.5 });
    const roofPosts = [];
    const keepR = (i0, i1) => (i) => { let d = i - (((i0 % N) + N) % N); d = ((d % N) + N) % N; return d <= i1 - i0; };
    const stand = (i0, i1, sd, base) => {
      const o1 = base, o2 = base + 75;
      const ro = (u, v) => (sd > 0 ? [u, v] : [-v, -u]);
      add(wall(track, sd * o1, 0, 9, 400, keepR(i0, i1)), steel, true, true);
      add(ribbon(track, ro(o1, o2), sd > 0 ? [9, 52] : [52, 9], 60, i0, i1), crowd, true, true);
      add(ribbon(track, ro(o1 - 6, o2 + 2), 66, 400, i0, i1), roofMat, true, true);
      for (let i = i0; i <= i1; i += 7) roofPosts.push({ i: ((i % N) + N) % N, off: sd * (o2 + 1) }, { i: ((i % N) + N) % N, off: sd * (o1 - 4) });
      add(wall(track, sd * o2, 0, 52, 400, keepR(i0, i1)), steel, true, true);
    };
    const standOK = (i0, i1, sd, base) => {
      for (let i = i0; i <= i1; i += 4) {
        const p = track.pts[((i % N) + N) % N];
        for (const off of [base, base + 80]) {
          if (track.distTo(p.x + p.nx * sd * off, p.y + p.ny * sd * off) < off - 12) return false;
        }
      }
      return true;
    };
    const standBase = half + run + 40;
    if (standOK(-90, 30, -pitSide, standBase)) stand(-90, 30, -pitSide, standBase);
    runs.slice().sort((p, q) => q.kmax - p.kmax).slice(0, 6).forEach((r, n) => {
      if (n > 3) return;
      const i0 = r.i - 10, i1 = Math.min(r.j + 10, r.i + 90);
      if (standOK(i0, i1, r.outside, standBase)) stand(i0, i1, r.outside, standBase);
    });
    instanced(s, new T.BoxGeometry(1.2, 66, 1.2).translate(0, 33, 0), steel, roofPosts, (d, P, S) => { pl(d, P, S); S.set(1, 1, 1); }, { cast: true });

    // ---------- Portique de départ (feux réels) ----------
    {
      const gantry = new T.Group();
      const dark = std({ color: 0x1c1d21, metalness: 0.5, roughness: 0.5 });
      const span = half + 18;
      const beam = new T.Mesh(new T.BoxGeometry(5, 8, span * 2 + 6), dark);
      beam.position.y = 66;
      beam.castShadow = true;
      gantry.add(beam);
      for (const sd of [1, -1]) {
        const post = new T.Mesh(new T.BoxGeometry(5, 70, 5), dark);
        post.position.set(0, 35, sd * span);
        post.castShadow = true;
        gantry.add(post);
      }
      for (let k = 0; k < 5; k++) {
        const pod = new T.Mesh(new T.BoxGeometry(4, 18, 7), dark);
        pod.position.set(-4, 58, (k - 2) * 10);
        gantry.add(pod);
        const lampMat = new T.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 });
        info.gantryLights.push(lampMat);
        for (const y of [62, 56]) {
          const lamp = new T.Mesh(new T.CircleGeometry(2, 14), lampMat);
          lamp.rotation.y = -Math.PI / 2;
          lamp.position.set(-6.05, y, (k - 2) * 10);
          gantry.add(lamp);
        }
      }
      gantry.position.set(p0.x + p0.tx * 8, H(0), p0.y + p0.ty * 8);
      gantry.rotation.y = -p0.ang;
      s.add(gantry);
    }

    // ---------- Panneaux de freinage 300 / 200 / 100 m ----------
    for (const r of runs) {
      const vBefore = track.vp[((r.i - 60) % N + N) % N], vIn = track.vp[r.i % N];
      if (vBefore - vIn < 230) continue;
      [100, 200, 300].forEach((dist) => {
        const i = ((r.i - dist) % N + N) % N;
        if (corner[i] && Math.abs(track.k[i]) > TH) return;
        const p = track.pts[i];
        const sd = r.outside;
        const off = sd * (half + 26);
        const grp = new T.Group();
        const panel = new T.Mesh(new T.PlaneGeometry(9, 11), new T.MeshStandardMaterial({ map: tx.board(String(dist)), roughness: 0.6 }));
        panel.position.y = 12;
        const post = new T.Mesh(new T.BoxGeometry(0.6, 8, 0.6), postMat);
        post.position.y = 4;
        grp.add(panel, post);
        grp.position.set(p.x + p.nx * off, H(i), p.y + p.ny * off);
        grp.rotation.y = Math.atan2(-p.tx, -p.ty);
        s.add(grp);
      });
    }

    // ---------- Postes de commissaires ----------
    const huts = [];
    for (let i = 60, k = 0; i < N; i += 160, k++) {
      const sd = k % 2 ? 1 : -1;
      if (inPit(i, sd)) continue;
      const off = sd * (half + run + 14);
      const p = track.pts[i];
      if (track.distTo(p.x + p.nx * off, p.y + p.ny * off) < Math.abs(off) - 6) continue;
      huts.push({ i, off });
    }
    instanced(s, new T.BoxGeometry(12, 15, 12).translate(0, 7.5, 0), std({ color: 0xff7a00, roughness: 0.6 }), huts, (d, P, S, E) => { pl(d, P, S); S.set(1, 1, 1); E.y = -track.pts[d.i].ang; }, { cast: true });
    instanced(s, new T.BoxGeometry(14, 1.2, 14).translate(0, 15.6, 0), std({ color: 0xf2f2f2 }), huts, (d, P, S, E) => { pl(d, P, S); S.set(1, 1, 1); E.y = -track.pts[d.i].ang; });

    // ---------- Éclairage (courses de nuit) ----------
    if (night) {
      const poles = [];
      for (let i = 0, k = 0; i < N; i += 28, k++) {
        const sd = k % 2 ? 1 : -1;
        const off = sd * (half + run + 22);
        const p = track.pts[i];
        if (track.distTo(p.x + p.nx * off, p.y + p.ny * off) < Math.abs(off) - 6) continue;
        poles.push({ i, off, sd });
      }
      instanced(s, new T.CylinderGeometry(0.9, 1.3, 150, 6).translate(0, 75, 0), steel, poles, (d, P, S) => { pl(d, P, S); S.set(1, 1, 1); });
      instanced(s, new T.BoxGeometry(5, 3, 14).translate(0, 150, 0), new T.MeshBasicMaterial({ color: 0xfff6e0 }), poles, (d, P, S, E) => { pl(d, P, S); S.set(1, 1, 1); E.y = -track.pts[d.i].ang; });
    }

    // ---------- Végétation, rochers, immeubles ----------
    if (scene2d) {
      const C = F1.DECO_CELL;
      const trees = [], palms = [], conifers = [], rocks = [], builds = [];
      const tropical = TROPICAL.has(id);
      const m = 1700;
      let r = 1;
      const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
      for (let cx = Math.floor((b.minX - m) / C); cx <= Math.floor((b.maxX + m) / C); cx++) {
        for (let cy = Math.floor((b.minY - m) / C); cy <= Math.floor((b.maxY + m) / C); cy++) {
          if (track.distTo(cx * C + C / 2, cy * C + C / 2) > 1e8) continue;
          for (const d of F1.decoCell(scene2d, cx, cy)) {
            const off = Math.abs(track.distTo(d.x, d.y));
            if (off < half + run + 60) continue;
            if (d.t === 'tree') {
              const u = rnd();
              if (tropical && u < 0.45) palms.push(d);
              else if (!tropical && u < 0.35) conifers.push(d);
              else trees.push(d);
            } else if (d.t === 'palm') {
              // Pas de palmiers sous un climat tempéré : sapins et feuillus à la place
              if (tropical || env === 'desert') palms.push(d);
              else (rnd() < 0.5 ? conifers : trees).push(d);
            }
            else if (d.t === 'rock') rocks.push(d);
            else if (d.t === 'b') builds.push(d);
          }
        }
      }
      const cap = quality === 'low' ? 600 : quality === 'medium' ? 2500 : 6000;
      for (const arr of [trees, conifers, palms]) if (arr.length > cap) arr.length = cap;
      const leaf = std({ color: 0xffffff, roughness: 0.95, flatShading: true });
      const bark = std({ color: 0x5a4128 });
      // Feuillus : 3 masses de feuillage
      const crown = G.merge([
        G.at(new T.IcosahedronGeometry(1, 0), 0, 2.1, 0, 0, 0, 0, [1.05, 0.9, 1.05]),
        G.at(new T.IcosahedronGeometry(0.75, 0), 0.55, 2.7, 0.3),
        G.at(new T.IcosahedronGeometry(0.7, 0), -0.5, 2.55, -0.35),
      ]);
      const trunk = new T.CylinderGeometry(0.1, 0.16, 2, 6).translate(0, 1, 0);
      const vary = (d, col, base, spread) => { const v = (Math.sin(d.x * 0.013 + d.y * 0.007) + 1) / 2; col.setHSL(base[0] + (v - 0.5) * spread, base[1], base[2] + (v - 0.5) * 0.1); return true; };
      for (const d of trees.concat(conifers, palms, rocks)) d.gy = groundY(d.x, d.y);
      instanced(s, crown, leaf, trees, (d, P, S, E, col) => { P.set(d.x, d.gy, d.y); S.setScalar(d.r * 1.1); E.y = d.rot; return vary(d, col, [0.28, 0.45, 0.28], 0.06); }, { cast: true });
      instanced(s, trunk, bark, trees.concat(conifers), (d, P, S) => { P.set(d.x, d.gy, d.y); S.set(d.r * 1.1, d.r * 1.1, d.r * 1.1); }, { cast: true });
      // Conifères : cônes empilés
      const cone = G.merge([
        G.at(new T.ConeGeometry(0.9, 1.6, 6), 0, 1.6, 0),
        G.at(new T.ConeGeometry(0.72, 1.4, 6), 0, 2.4, 0),
        G.at(new T.ConeGeometry(0.5, 1.2, 6), 0, 3.1, 0),
      ]);
      instanced(s, cone, leaf, conifers, (d, P, S, E, col) => { P.set(d.x, d.gy, d.y); S.setScalar(d.r * 1.3); E.y = d.rot; return vary(d, col, [0.33, 0.4, 0.2], 0.04); }, { cast: true });
      // Palmiers : tronc + palmes retombantes
      const fronds = [];
      for (let k = 0; k < 8; k++) {
        const f = new T.BoxGeometry(1.6, 0.05, 0.32);
        f.translate(0.8, 0, 0);
        f.rotateZ(-0.45);
        f.rotateY((k / 8) * Math.PI * 2);
        f.translate(0, 3.4, 0);
        fronds.push(f);
      }
      const palmTop = G.merge(fronds);
      const palmTrunk = new T.CylinderGeometry(0.09, 0.14, 3.4, 6).translate(0, 1.7, 0);
      instanced(s, palmTrunk, std({ color: 0x8a6a45 }), palms, (d, P, S) => { P.set(d.x, d.gy, d.y); S.setScalar(d.r * 1.3); }, { cast: true });
      instanced(s, palmTop, leaf, palms, (d, P, S, E, col) => { P.set(d.x, d.gy, d.y); S.setScalar(d.r * 1.3); E.y = d.rot; return vary(d, col, [0.3, 0.5, 0.3], 0.05); }, { cast: true });
      instanced(s, new T.DodecahedronGeometry(1, 0), std({ color: 0xa88a62, flatShading: true }), rocks, (d, P, S, E) => { P.set(d.x, d.gy + d.r * 0.3, d.y); S.set(d.r, d.r * 0.6, d.r); E.y = d.r; });
      // Immeubles
      const bm = instanced(s, new T.BoxGeometry(1, 1, 1), std({ map: tx.facade(night), roughness: 0.7, emissive: night ? 0x221a10 : 0x000000 }), builds, (d, P, S, E, col) => {
        const hgt = 60 + d.h2 * 9;
        const gy = Math.min(groundY(d.x, d.y), groundY(d.x + d.w, d.y + d.h), groundY(d.x + d.w / 2, d.y + d.h / 2));
        P.set(d.x + d.w / 2, gy + hgt / 2 - 10, d.y + d.h / 2); S.set(d.w, hgt + 20, d.h);
        col.set(d.c);
        return true;
      }, { cast: true });
    }

    // Trajectoire idéale (affichée seulement si l'aide est activée)
    {
      const RL = track.racingLine();
      const pos = [], col = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const ii = i % N, p = track.pts[ii], l = RL.lat[ii], y = 0.75 + H(ii);
        pos.push(p.x + p.nx * (l - 3.5), y, p.y + p.ny * (l - 3.5), p.x + p.nx * (l + 3.5), y, p.y + p.ny * (l + 3.5));
        const c = RL.brake[ii] ? [0.95, 0.15, 0.12] : [0.15, 0.9, 0.35];
        col.push(...c, ...c);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide }));
      m.visible = false;
      s.add(m);
      info.racingLine = m;
    }

    if (track.bridges && track.bridges.length) {
      const concrete = std({ color: 0xb9b6ae, roughness: 0.85 });
      for (const br of track.bridges) {
        const i0 = br.j - 34, i1 = br.j + 34;
        add(ribbon(track, [-(half + 16), half + 16], -9, 400, i0, i1), concrete, true, true);
        const keep = (i) => { let d = i - (((i0 % N) + N) % N); d = ((d % N) + N) % N; return d <= i1 - i0; };
        for (const sd of [1, -1]) add(wall(track, sd * (half + 16), -9, 9, 200, keep), concrete, true, true);
        for (const dj of [-26, 26]) {
          const p = track.pts[((br.j + dj) % N + N) % N];
          const top = H(br.j + dj) - 9, bot = groundY(p.x, p.y) - 5;
          if (top - bot < 5) continue;
          const pier = new T.Mesh(new T.BoxGeometry(14, top - bot, half * 1.6), concrete);
          pier.position.set(p.x, (top + bot) / 2, p.y);
          pier.rotation.y = -p.ang;
          pier.castShadow = true;
          s.add(pier);
        }
      }
    }

    info.scene = s;
    return info;
  };
})();
