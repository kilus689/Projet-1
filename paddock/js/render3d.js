'use strict';
// Rendu 3D (Three.js) : caméras poursuite, embarquée et cockpit.
// Repère : x 2D -> X, y 2D -> Z, hauteur -> Y. 1 unité = 10 cm (comme la simulation).
(function () {
  const F1 = window.F1;
  const T = window.THREE;

  const ENV3D = {
    park: { sky: 0x9fcbf0, ground: ['#3f8f3a', '#46993f'], runoff: '#d6c79c', wall: 'tyre' },
    circuit: { sky: 0xa9cdee, ground: ['#4c8f3c', '#539842'], runoff: '#cdbd92', wall: 'tyre' },
    desert: { sky: 0xb9d4ea, ground: ['#d8b98b', '#d2b284'], runoff: '#8e9399', wall: 'concrete' },
    street: { sky: 0xa5c4e0, ground: ['#6b6f75', '#71757b'], runoff: '#878b91', wall: 'concrete' },
  };

  // ---------- Textures générées ----------
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
  }
  function noise(g, w, h, base, amp, n) {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? `rgba(0,0,0,${amp * Math.random()})` : `rgba(255,255,255,${amp * Math.random()})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }
  const tex = {};
  function textures() {
    if (tex.asphalt) return tex;
    tex.asphalt = canvasTex(256, 256, (g, w, h) => {
      noise(g, w, h, '#3a3d42', 0.12, 9000);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(w * 0.4, 0, w * 0.2, h);
    }, true);
    tex.curb = canvasTex(8, 64, (g, w, h) => {
      g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d62828'; g.fillRect(0, 0, w, h / 2);
    }, true);
    tex.checker = canvasTex(64, 64, (g, w, h) => {
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#fafafa';
        g.fillRect(i * 8, j * 8, 8, 8);
      }
    }, true);
    tex.wallConcrete = canvasTex(512, 64, (g, w, h) => {
      noise(g, w, h, '#e4e4e4', 0.06, 2000);
      // Panneaux publicitaires fictifs du jeu
      const cols = ['#e10600', '#0d0f14', '#0090ff', '#ffd60a'];
      for (let i = 0; i < 2; i++) {
        g.fillStyle = cols[i * 2 % cols.length];
        g.fillRect(i * 256 + 8, 10, 240, 44);
        g.fillStyle = i ? '#0d0f14' : '#ffffff';
        g.font = 'italic 800 34px "Barlow Condensed", Arial Narrow, sans-serif';
        g.textAlign = 'center';
        g.fillText(i ? 'PADDOCK 26' : 'PADDOCK', i * 256 + 128, 45);
      }
    }, true);
    tex.wallTyre = canvasTex(64, 32, (g, w, h) => {
      g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d62828'; g.fillRect(0, 0, w / 2, h * 0.5);
      g.fillStyle = '#f2f2f2'; g.fillRect(w / 2, 0, w / 2, h * 0.5);
    }, true);
    tex.crowd = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#4c5057'; g.fillRect(0, 0, w, h);
      const cols = ['#ffffff', '#e63946', '#ffd60a', '#00b4d8', '#ff7b00', '#2ec4b6', '#7b2cbf', '#f1faee'];
      for (let i = 0; i < 1800; i++) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
    }, true);
    tex.shadow = canvasTex(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    return tex;
  }

  // ---------- Géométrie de la piste ----------
  // Ruban le long du tracé entre deux décalages latéraux (indices i0..i1, peut boucler)
  function ribbon(track, o0, o1, y, vScale, i0, i1) {
    const pts = track.pts, N = track.n, sp = track.spacing;
    const pos = [], uv = [], idx = [];
    if (i0 == null) { i0 = 0; i1 = N; }
    let k = 0;
    for (let i = i0; i <= i1; i++, k++) {
      const p = pts[((i % N) + N) % N];
      pos.push(p.x + p.nx * o0, y, p.y + p.ny * o0, p.x + p.nx * o1, y, p.y + p.ny * o1);
      const v = (i * sp) / vScale;
      uv.push(0, v, 1, v);
      if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Mur vertical à un décalage donné ; on saute les morceaux qui couperaient une autre partie de la piste
  function wall(track, off, h, vScale) {
    const pts = track.pts, N = track.n, sp = track.spacing;
    const blocked = new Uint8Array(N);
    const lim = (track.half + 14) ** 2;
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
          if ((q.x - x) ** 2 + (q.y - y) ** 2 < lim) { blocked[i] = 1; break outer; }
        }
      }
    }
    const pos = [], uv = [], idx = [];
    let k = 0;
    for (let i = 0; i <= N; i++) {
      const ii = i % N;
      const p = pts[ii];
      const x = p.x + p.nx * off, z = p.y + p.ny * off;
      pos.push(x, 0, z, x, h, z);
      const v = (i * sp) / vScale;
      uv.push(v, 0, v, 1);
      if (i > 0 && !blocked[ii] && !blocked[(i - 1) % N]) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      k++;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function lambert(opts) { return new T.MeshLambertMaterial(Object.assign({ side: T.DoubleSide }, opts)); }

  function buildWorld(track, scene2d) {
    const env = ENV3D[track.env] || ENV3D.circuit;
    const tx = textures();
    const s = new T.Scene();
    s.background = new T.Color(env.sky);
    s.fog = new T.Fog(env.sky, 3000, 16000);
    s.add(new T.HemisphereLight(0xffffff, 0x556644, 1.1));
    const sun = new T.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.5, 1, 0.3);
    s.add(sun);

    const half = track.half, run = track.runoff;
    const b = track.bounds, pad = 15000;
    // Sol
    const gw = b.maxX - b.minX + pad * 2, gh = b.maxY - b.minY + pad * 2;
    const gt = canvasTex(128, 128, (g, w, h) => {
      noise(g, w, h, env.ground[0], 0.08, 1500);
      g.fillStyle = env.ground[1];
      g.globalAlpha = 0.6;
      g.fillRect(0, 0, w / 2, h);
    }, true);
    gt.repeat.set(gw / 600, gh / 600);
    const ground = new T.Mesh(new T.PlaneGeometry(gw, gh), new T.MeshLambertMaterial({ map: gt }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, -0.5, (b.minY + b.maxY) / 2);
    s.add(ground);

    // Dégagement, bitume, lignes blanches
    s.add(new T.Mesh(ribbon(track, -(half + run), half + run, 0.2, 400), lambert({ color: env.runoff })));
    const asph = tx.asphalt.clone();
    asph.needsUpdate = true;
    asph.repeat.set(1, 1);
    s.add(new T.Mesh(ribbon(track, -half, half, 0.6, 260), lambert({ map: asph })));
    const white = lambert({ color: 0xf2f2f2 });
    s.add(new T.Mesh(ribbon(track, -half, -half + 4, 0.8, 400), white));
    s.add(new T.Mesh(ribbon(track, half - 4, half, 0.8, 400), white));

    // Vibreurs dans les virages
    const N = track.n, TH = 0.0022;
    const curbMat = lambert({ map: tx.curb });
    let i = 0;
    while (i < N) {
      if (Math.abs(track.k[i]) > TH) {
        let j = i;
        while (j < i + N && Math.abs(track.k[j % N]) > TH) j++;
        for (const sd of [1, -1]) {
          const o0 = sd > 0 ? half - 1 : -half - 13, o1 = sd > 0 ? half + 13 : -half + 1;
          s.add(new T.Mesh(ribbon(track, o0, o1, 1.0, 32, i - 3, j + 3), curbMat));
        }
        i = j + 1;
      } else i++;
    }

    // Murs / barrières
    const street = env.wall === 'concrete';
    const wm = lambert({ map: street ? tx.wallConcrete : tx.wallTyre });
    const wh = street ? 14 : 9;
    for (const sd of [1, -1]) s.add(new T.Mesh(wall(track, sd * (half + run), wh, street ? 520 : 40), wm));

    // Ligne de départ
    const p0 = track.pts[0];
    const ck = tx.checker.clone();
    ck.needsUpdate = true;
    ck.repeat.set(half / 20, 0.5);
    const start = new T.Mesh(new T.PlaneGeometry(14, half * 2), lambert({ map: ck }));
    start.rotation.x = -Math.PI / 2;
    start.rotation.z = -p0.ang;
    start.position.set(p0.x, 1.1, p0.y);
    s.add(start);
    // Portique des feux
    const gantry = new T.Group();
    const dark = lambert({ color: 0x222428 });
    const span = half + run * 0.5 + 10;
    const beam = new T.Mesh(new T.BoxGeometry(4, 6, span * 2), dark);
    beam.position.y = 70;
    gantry.add(beam);
    for (const sd of [1, -1]) {
      const post = new T.Mesh(new T.BoxGeometry(4, 72, 4), dark);
      post.position.set(0, 36, sd * span);
      gantry.add(post);
    }
    for (let k = 0; k < 5; k++) {
      const box = new T.Mesh(new T.BoxGeometry(5, 14, 6), lambert({ color: 0x111111 }));
      box.position.set(-3, 62, (k - 2) * 9);
      gantry.add(box);
    }
    gantry.position.set(p0.x + p0.tx * 6, 0, p0.y + p0.ty * 6);
    gantry.rotation.y = -p0.ang;
    s.add(gantry);

    // Tribune
    if (scene2d && scene2d.stand) {
      const st = scene2d.stand;
      const side = Math.sign((st[0].x - track.pts[0].x) * track.pts[0].nx + (st[0].y - track.pts[0].y) * track.pts[0].ny) || 1;
      const pos = [], uv = [], idx = [];
      st.forEach((q, k) => {
        const nx = -Math.sin(q.a) * side, ny = Math.cos(q.a) * side;
        pos.push(q.x - nx * 30, 6, q.y - ny * 30, q.x + nx * 40, 70, q.y + ny * 40);
        uv.push(k * 0.5, 0, k * 0.5, 1);
        if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const ct = tx.crowd.clone();
      ct.needsUpdate = true;
      s.add(new T.Mesh(g, lambert({ map: ct })));
    }

    // Décor : arbres, palmiers, rochers, immeubles
    if (scene2d) {
      const C = F1.DECO_CELL;
      const trees = [], palms = [], rocks = [], builds = [];
      const m = 1600;
      for (let cx = Math.floor((b.minX - m) / C); cx <= Math.floor((b.maxX + m) / C); cx++) {
        for (let cy = Math.floor((b.minY - m) / C); cy <= Math.floor((b.maxY + m) / C); cy++) {
          const mid = track.distTo(cx * C + C / 2, cy * C + C / 2);
          if (mid > 1e8) continue; // trop loin de la piste
          for (const d of F1.decoCell(scene2d, cx, cy)) {
            if (d.t === 'tree') trees.push(d);
            else if (d.t === 'palm') palms.push(d);
            else if (d.t === 'rock') rocks.push(d);
            else if (d.t === 'b') builds.push(d);
          }
        }
      }
      const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3();
      const inst = (geo, mat, list, fn) => {
        if (!list.length) return;
        const im = new T.InstancedMesh(geo, mat, list.length);
        list.forEach((d, k) => { fn(d, P, S); M.compose(P, Q, S); im.setMatrixAt(k, M); });
        s.add(im);
        return im;
      };
      const trunkGeo = new T.CylinderGeometry(0.6, 1, 1, 6);
      const canopy = new T.IcosahedronGeometry(1, 0);
      inst(trunkGeo, new T.MeshLambertMaterial({ color: 0x6b4f2a }), trees.concat(palms), (d, p, sc) => {
        const hgt = d.t === 'palm' ? d.r * 3 : d.r * 1.4;
        p.set(d.x, hgt / 2, d.y); sc.set(d.r * 0.25, hgt, d.r * 0.25);
      });
      inst(canopy, new T.MeshLambertMaterial({ color: 0x2c6e31, flatShading: true }), trees, (d, p, sc) => {
        p.set(d.x, d.r * 2.1, d.y); sc.set(d.r * 1.1, d.r * 1.3, d.r * 1.1);
      });
      inst(canopy, new T.MeshLambertMaterial({ color: 0x3b9440, flatShading: true }), palms, (d, p, sc) => {
        p.set(d.x, d.r * 3, d.y); sc.set(d.r * 1.2, d.r * 0.35, d.r * 1.2);
      });
      inst(canopy, new T.MeshLambertMaterial({ color: 0xa88a62, flatShading: true }), rocks, (d, p, sc) => {
        p.set(d.x, d.r * 0.3, d.y); sc.set(d.r, d.r * 0.6, d.r);
      });
      const bm = inst(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: 0xffffff }), builds, (d, p, sc) => {
        const hgt = d.h2 * 7;
        p.set(d.x + d.w / 2, hgt / 2, d.y + d.h / 2); sc.set(d.w, hgt, d.h);
      });
      if (bm) {
        const col = new T.Color();
        builds.forEach((d, k) => { bm.setColorAt(k, col.set(d.c)); });
      }
    }
    return s;
  }

  // ---------- Monoplace ----------
  const geoCache = {};
  const box = (w, h, d) => {
    const k = `${w}|${h}|${d}`;
    return geoCache[k] || (geoCache[k] = new T.BoxGeometry(w, h, d));
  };
  function part(group, geo, mat, x, y, z, rz) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rz) m.rotation.z = rz;
    group.add(m);
    return m;
  }

  function makeCar(team, isPlayer) {
    const g = new T.Group();
    const c1 = new T.MeshLambertMaterial({ color: team.color });
    const c2 = new T.MeshLambertMaterial({ color: team.color2 });
    const blk = new T.MeshLambertMaterial({ color: 0x151515 });
    const carbon = new T.MeshLambertMaterial({ color: 0x2a2c30 });

    // Ombre au sol
    const sh = new T.Mesh(new T.PlaneGeometry(70, 40), new T.MeshBasicMaterial({ map: textures().shadow, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 1.3;
    g.add(sh);

    part(g, box(46, 1, 17), carbon, -2, 1.6, 0);          // fond plat
    part(g, box(26, 6, 8.5), c1, 2, 5, 0);                // coque
    part(g, box(18, 3.4, 5), c1, 21, 3.6, 0, -0.06);      // nez
    part(g, box(18, 6, 20), c1, -7, 4.6, 0);              // pontons
    part(g, box(19, 8, 6.5), c1, -15, 7.4, 0);            // capot moteur
    part(g, box(12, 4.5, 0.6), c2, -19, 12.5, 0);         // aileron de requin
    part(g, box(26, 0.8, 1.2), c2, 4, 8.1, 0);            // bande centrale
    part(g, box(7, 1.2, 5.4), blk, -0.5, 8.0, 0);         // ouverture du cockpit
    // Aileron avant
    part(g, box(5, 0.8, 30), c2, 27, 1.8, 0);
    part(g, box(3, 0.6, 28), c1, 25, 2.9, 0);
    for (const sd of [1, -1]) part(g, box(6, 3.5, 0.6), c2, 26.5, 2.7, sd * 15);
    // Aileron arrière
    part(g, box(5, 0.8, 22), c2, -26, 13.5, 0);
    part(g, box(3.5, 0.7, 22), c1, -23.5, 15, 0);
    for (const sd of [1, -1]) part(g, box(8, 10, 0.6), c1, -25, 10.5, sd * 11.2);
    part(g, box(2, 9, 1.2), carbon, -25, 8, 0);
    // Halo
    const halo = new T.Mesh(new T.TorusGeometry(5.2, 0.45, 6, 22, Math.PI * 1.25), carbon);
    halo.rotation.x = Math.PI / 2;
    halo.rotation.z = Math.PI * 0.375 + Math.PI;
    halo.position.set(-1.5, 13.4, 0);
    halo.scale.set(1.15, 1, 1);
    g.add(halo);
    part(g, box(0.7, 5.5, 0.8), carbon, 5.6, 10.6, 0, 0.35);
    // Casque
    const helmet = new T.Mesh(new T.SphereGeometry(2.7, 12, 10), new T.MeshLambertMaterial({ color: isPlayer ? 0xffffff : team.color2 }));
    helmet.position.set(-1.5, 10.2, 0);
    g.add(helmet);
    // Roues
    const wheels = [];
    const tyre = (r, w) => {
      const k = `t${r}|${w}`;
      if (!geoCache[k]) { const cg = new T.CylinderGeometry(r, r, w, 18); cg.rotateX(Math.PI / 2); geoCache[k] = cg; }
      return geoCache[k];
    };
    const rimMat = new T.MeshLambertMaterial({ color: 0x8a8f96 });
    const mk = (x, z, r, w, front) => {
      const pivot = new T.Group();
      pivot.position.set(x, r, z);
      const wh = new T.Mesh(tyre(r, w), blk);
      const rim = new T.Mesh(tyre(r * 0.55, w + 0.4), rimMat);
      wh.add(rim);
      pivot.add(wh);
      g.add(pivot);
      wheels.push({ pivot, wh, r, front });
    };
    mk(15, 12.5, 5.6, 6, true); mk(15, -12.5, 5.6, 6, true);
    mk(-17, 12, 6.2, 8, false); mk(-17, -12, 6.2, 8, false);
    return { g, wheels, helmet, spin: 0 };
  }

  function makeSteeringWheel() {
    const g = new T.Group();
    const mat = new T.MeshBasicMaterial({ color: 0x1a1b1e });
    const grip = new T.MeshBasicMaterial({ color: 0x2c2f35 });
    const body = new T.Mesh(new T.BoxGeometry(9, 4.6, 1), mat);
    g.add(body);
    for (const sd of [1, -1]) {
      const h = new T.Mesh(new T.BoxGeometry(2, 5.5, 1.6), grip);
      h.position.set(sd * 5.2, -0.4, 0);
      g.add(h);
    }
    const screen = new T.Mesh(new T.PlaneGeometry(3.6, 1.8), new T.MeshBasicMaterial({ color: 0x0b3d2e }));
    screen.position.set(0, 0.6, 0.55);
    g.add(screen);
    const leds = [0x3ddc84, 0x3ddc84, 0xffd60a, 0xffd60a, 0xe10600, 0xe10600];
    leds.forEach((c, k) => {
      const l = new T.Mesh(new T.BoxGeometry(0.6, 0.4, 0.3), new T.MeshBasicMaterial({ color: c }));
      l.position.set(-1.6 + k * 0.65, 2.0, 0.55);
      g.add(l);
    });
    return g;
  }

  // ---------- Rendu ----------
  class Renderer3D {
    constructor(container) {
      this.container = container;
      this.ok = !!T;
      this.cars = new Map();
    }

    init() {
      if (this.renderer || !this.ok) return this.ok;
      try {
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const r = (this.renderer = new T.WebGLRenderer({ antialias: !coarse, powerPreference: 'high-performance' }));
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
        r.outputColorSpace = T.SRGBColorSpace;
        r.domElement.id = 'game3d';
        r.domElement.className = 'hidden';
        this.container.insertBefore(r.domElement, this.container.querySelector('#hud'));
        this.camera = new T.PerspectiveCamera(70, 1, 1, 30000);
        this.wheel = makeSteeringWheel();
        // Le volant est toujours dessiné par-dessus la carrosserie
        this.wheel.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 10; } });
        this.camera.add(this.wheel);
        this.resize();
      } catch (e) {
        this.ok = false;
      }
      return this.ok;
    }

    resize() {
      if (!this.renderer) return;
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    }

    show(on) { if (this.renderer) this.renderer.domElement.classList.toggle('hidden', !on); }

    setTrack(track, scene2d) {
      if (this.trackId === track.id && this.scene) return;
      if (this.scene) this.dispose();
      this.scene = buildWorld(track, scene2d);
      this.scene.add(this.camera);
      this.trackId = track.id;
      this.cars.clear();
      this.raceRef = null;
    }

    dispose() {
      this.scene.traverse((o) => {
        if (o.geometry && !Object.values(geoCache).includes(o.geometry)) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map && !Object.values(tex).includes(m.map)) m.map.dispose(); m.dispose(); }
        }
      });
      this.scene = null;
    }

    syncCars(race) {
      if (this.raceRef === race) return;
      for (const v of this.cars.values()) this.scene.remove(v.g);
      this.cars.clear();
      for (const c of race.cars) {
        const m = makeCar(c.team, c.isPlayer);
        this.scene.add(m.g);
        this.cars.set(c, m);
      }
      this.raceRef = race;
      this.camInit = false;
    }

    draw(race, focus, mode, dt) {
      this.syncCars(race);
      for (const [c, m] of this.cars) {
        m.g.position.set(c.x, 0, c.y);
        m.g.rotation.y = -c.a;
        const fwd = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
        m.spin -= (fwd * dt);
        for (const w of m.wheels) {
          w.wh.rotation.z = m.spin / w.r;
          if (w.front) w.pivot.rotation.y = -c.steer * 0.35;
        }
        m.helmet.visible = !(c === focus && mode === 'cockpit');
      }

      // Placement de la caméra
      const cam = this.camera;
      const a = focus.a, fx = Math.cos(a), fz = Math.sin(a);
      const sp = Math.min(1, focus.speed / F1.PHYS.maxSpeed);
      if (mode === 'chase') {
        if (!this.camInit) { this.yaw = a; this.camInit = true; }
        this.yaw += F1.util.wrapAngle(a - this.yaw) * Math.min(1, dt * 4);
        const cx = Math.cos(this.yaw), cz = Math.sin(this.yaw);
        cam.position.set(focus.x - cx * 120, 40, focus.y - cz * 120);
        cam.lookAt(focus.x + cx * 70, 10, focus.y + cz * 70);
        cam.fov = 62 + sp * 10;
      } else {
        this.camInit = false;
        const eye = mode === 'cockpit' ? { b: -3, h: 10.6, look: 7 } : { b: -9, h: 20, look: 5 };
        cam.position.set(focus.x + fx * eye.b, eye.h, focus.y + fz * eye.b);
        cam.lookAt(focus.x + fx * 300, eye.look, focus.y + fz * 300);
        cam.fov = (mode === 'cockpit' ? 72 : 68) + sp * 8;
      }
      cam.updateProjectionMatrix();

      // Volant (cockpit uniquement)
      this.wheel.visible = mode === 'cockpit';
      if (mode === 'cockpit') {
        this.wheel.position.set(0, -6.4, -15);
        this.wheel.rotation.set(-0.35, 0, -focus.steer * 1.5);
      }
      this.renderer.render(this.scene, cam);
    }
  }

  F1.Renderer3D = Renderer3D;
})();
