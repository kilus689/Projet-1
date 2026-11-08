'use strict';
// Monoplace 3D aux proportions d'une F1 2026 (1 unité = 10 cm) :
// 5,2 m de long, 1,9 m de large, empattement 3,4 m, roues de 72 cm.
// Repère local : +x vers l'avant, +y vers le haut, +z vers la droite.
(function () {
  const F1 = window.F1;
  const T = window.THREE;
  const X = F1.X3D;

  // ---------- Outils de géométrie ----------
  // « Loft » : enveloppe passant par des sections en super-ellipse.
  // section : { x, y, w (demi-largeur), ht (hauteur au-dessus de y), hb (en dessous) }
  function loft(sections, opts) {
    const segs = (opts && opts.segs) || 28;
    const e = (opts && opts.exp) || 2.6;
    const band = opts && opts.band != null ? opts.band : null;
    const pos = [], uv = [], idx = [];
    const n = sections.length;
    const x0 = sections[0].x, x1 = sections[n - 1].x;
    const pw = 2 / e;
    sections.forEach((s, i) => {
      for (let j = 0; j <= segs; j++) {
        const th = -Math.PI / 2 + (j / segs) * Math.PI * 2; // départ sous la pièce
        const c = Math.cos(th), sn = Math.sin(th);
        const z = s.w * Math.sign(c) * Math.pow(Math.abs(c), pw);
        const y = s.y + (sn > 0 ? s.ht : s.hb) * Math.sign(sn) * Math.pow(Math.abs(sn), pw);
        pos.push(s.x, y, z);
        let v = j / segs;
        if (band != null) v = (band + 0.02 + v * 0.96) / 3;
        uv.push((s.x - x0) / (x1 - x0), v);
      }
      if (i > 0) {
        const a = (i - 1) * (segs + 1), b = i * (segs + 1);
        for (let j = 0; j < segs; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
      }
    });
    // Bouchons aux extrémités
    for (const [si, flip] of [[0, false], [n - 1, true]]) {
      const s = sections[si];
      const ci = pos.length / 3;
      pos.push(s.x, s.y + (s.ht - s.hb) / 2 * 0, 0);
      uv.push(si ? 1 : 0, band != null ? (band + 0.5) / 3 : 0.5);
      const base = si * (segs + 1);
      for (let j = 0; j < segs; j++) {
        if (flip) idx.push(ci, base + j, base + j + 1); else idx.push(ci, base + j + 1, base + j);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Profil d'aile (extrudé selon z sur toute l'envergure)
  function airfoil(chord, thick, span, angle) {
    const sh = new T.Shape();
    const N = 14;
    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const yt = 5 * thick * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1015 * t ** 4);
      const camber = 0.06 * thick * 6 * t * (1 - t);
      top.push([-t * chord, camber + yt]);
      bot.push([-t * chord, camber - yt]);
    }
    sh.moveTo(top[0][0], top[0][1]);
    for (const p of top) sh.lineTo(p[0], p[1]);
    for (let i = bot.length - 1; i >= 0; i--) sh.lineTo(bot[i][0], bot[i][1]);
    const g = new T.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -span / 2);
    g.rotateZ(-(angle || 0));
    return g;
  }

  // Plaque plate (dérive, flasque) à partir d'un contour 2D dans le plan x/y
  function plate(points, thickness) {
    const sh = new T.Shape();
    sh.moveTo(points[0][0], points[0][1]);
    for (const p of points.slice(1)) sh.lineTo(p[0], p[1]);
    const g = new T.ExtrudeGeometry(sh, { depth: thickness, bevelEnabled: false });
    g.translate(0, 0, -thickness / 2);
    return g;
  }

  function rod(a, b, r) {
    const va = new T.Vector3(...a), vb = new T.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new T.CylinderGeometry(r, r, len, 6, 1);
    const m = new T.Matrix4();
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.compose(va.clone().add(vb).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    return g;
  }

  // Fusion de géométries (même jeu d'attributs : position, normal, uv)
  function merge(list) {
    const geos = list.map((g) => {
      let q = g.index ? g : g;
      if (!q.getAttribute('normal')) q.computeVertexNormals();
      if (!q.getAttribute('uv')) {
        const n = q.getAttribute('position').count;
        q.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(n * 2), 2));
      }
      return q;
    });
    let vCount = 0, iCount = 0;
    for (const g of geos) { vCount += g.getAttribute('position').count; iCount += g.index ? g.index.count : g.getAttribute('position').count; }
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
    const idx = new Uint32Array(iCount);
    let vo = 0, io = 0;
    for (const g of geos) {
      const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) {
        pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
        nor[(vo + i) * 3] = n.getX(i); nor[(vo + i) * 3 + 1] = n.getY(i); nor[(vo + i) * 3 + 2] = n.getZ(i);
        uv[(vo + i) * 2] = u.getX(i); uv[(vo + i) * 2 + 1] = u.getY(i);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
      else for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += g.index ? g.index.count : p.count;
      vo += p.count;
      g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    out.setIndex(new T.BufferAttribute(idx, 1));
    return out;
  }
  const at = (g, x, y, z, rx, ry, rz, s) => {
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    if (s) g.scale(s[0], s[1], s[2]);
    g.translate(x || 0, y || 0, z || 0);
    return g;
  };

  // Pièces peintes hors livrée : couleur unie (zone sans motif de l'atlas)
  function solid(g) {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.97, 0.4 / 3);
    return g;
  }

  // ---------- Géométries partagées par toutes les voitures ----------
  let shared = null;
  function buildShared() {
    const paint = [], carbon = [], accent = [];

    // Coque + nez (bande 0 de la livrée)
    paint.push(loft([
      { x: 26.8, y: 1.9, w: 0.35, ht: 0.3, hb: 0.3 },
      { x: 24.5, y: 2.15, w: 1.05, ht: 0.75, hb: 0.55 },
      { x: 20.5, y: 2.75, w: 1.65, ht: 1.15, hb: 0.85 },
      { x: 15.5, y: 3.55, w: 2.15, ht: 1.55, hb: 1.2 },
      { x: 10.5, y: 4.25, w: 2.7, ht: 1.85, hb: 1.55 },
      { x: 5.5, y: 4.55, w: 3.3, ht: 2.0, hb: 2.15 },
      { x: 0.5, y: 4.75, w: 3.6, ht: 1.9, hb: 2.55 },
      { x: -3.5, y: 4.95, w: 3.6, ht: 1.55, hb: 2.75 },
      { x: -6.5, y: 4.75, w: 3.1, ht: 1.15, hb: 2.55 },
      { x: -8.5, y: 4.4, w: 2.4, ht: 0.8, hb: 2.2 },
    ], { exp: 2.7, band: 0 }));
    // Capot moteur + boîte à air (bande 1)
    paint.push(loft([
      { x: -2.2, y: 7.7, w: 1.1, ht: 0.55, hb: 1.4 },
      { x: -3.8, y: 7.9, w: 1.9, ht: 1.35, hb: 2.0 },
      { x: -7, y: 7.6, w: 2.2, ht: 1.3, hb: 3.0 },
      { x: -11, y: 6.8, w: 2.0, ht: 1.0, hb: 3.2 },
      { x: -15, y: 5.8, w: 1.55, ht: 0.8, hb: 2.8 },
      { x: -19, y: 4.6, w: 1.05, ht: 0.6, hb: 2.2 },
      { x: -22.4, y: 3.6, w: 0.65, ht: 0.4, hb: 1.4 },
    ], { exp: 2.5, band: 1 }));
    // Pontons, forme « bouteille de Coca » (bande 2)
    paint.push(loft([
      { x: 6.2, y: 4.0, w: 5.4, ht: 0.85, hb: 0.85 },
      { x: 4.2, y: 4.0, w: 6.5, ht: 1.35, hb: 1.3 },
      { x: -0.8, y: 3.9, w: 6.8, ht: 1.5, hb: 1.6 },
      { x: -6, y: 3.6, w: 6.2, ht: 1.35, hb: 1.7 },
      { x: -11, y: 3.2, w: 4.8, ht: 1.1, hb: 1.7 },
      { x: -16, y: 2.8, w: 3.0, ht: 0.8, hb: 1.4 },
      { x: -19.5, y: 2.4, w: 1.9, ht: 0.5, hb: 1.1 },
    ], { exp: 3.4, band: 2 }));

    // Halo (tube) et son pilier central
    const hoop = new T.CatmullRomCurve3([
      [-2.8, 6.9, 3.4], [-0.6, 8.55, 3.25], [2.4, 8.95, 2.1], [4.3, 8.7, 0.85], [4.85, 8.55, 0],
      [4.3, 8.7, -0.85], [2.4, 8.95, -2.1], [-0.6, 8.55, -3.25], [-2.8, 6.9, -3.4],
    ].map((p) => new T.Vector3(...p)));
    carbon.push(new T.TubeGeometry(hoop, 48, 0.34, 8, false));
    carbon.push(rod([5.7, 6.4, 0], [4.85, 8.5, 0], 0.3));
    // Rétroviseurs
    for (const sd of [1, -1]) {
      paint.push(solid(at(new T.BoxGeometry(0.9, 0.9, 1.9), 3.4, 7.15, sd * 5.5)));
      carbon.push(rod([3.6, 6.3, sd * 3.4], [3.4, 7.0, sd * 4.9], 0.14));
    }

    // Fond plat, planche, diffuseur
    const floorShape = [[13, 1.6], [10, 4.5], [7, 6.9], [-15, 7.3], [-18, 6.2], [-20.5, 4.6], [-20.5, -4.6], [-18, -6.2], [-15, -7.3], [7, -6.9], [10, -4.5], [13, -1.6]];
    const fs = new T.Shape();
    fs.moveTo(floorShape[0][0], floorShape[0][1]);
    for (const p of floorShape.slice(1)) fs.lineTo(p[0], p[1]);
    const floor = new T.ExtrudeGeometry(fs, { depth: 0.35, bevelEnabled: false });
    floor.rotateX(Math.PI / 2);
    floor.translate(0, 0.85, 0);
    carbon.push(floor);
    carbon.push(at(plate([[0, 0], [5.5, 2.2], [5.5, 2.5], [0, 0.4]], 9.2), -15.5, 0.5, 0, 0, Math.PI, 0));
    // Ouverture du cockpit, entrées d'air
    carbon.push(at(new T.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), -0.6, 6.55, 0, 0, 0, 0, [3.0, 0.35, 2.55]));
    carbon.push(at(new T.CircleGeometry(1, 16), -2.15, 8.25, 0, 0, Math.PI / 2, 0, [1, 0.75, 0.9]));
    for (const sd of [1, -1]) carbon.push(at(new T.PlaneGeometry(1.5, 1.25), 6.25, 4.05, sd * 4.6, 0, Math.PI / 2));
    // Dérive (aileron de requin)
    accent.push(at(plate([[0, 0], [-9, 0], [-9, 1.9], [-3, 0.6]], 0.25), -12.5, 7.6, 0));

    // Aileron avant (plan principal + 2 volets) et flasques
    carbon.push(at(airfoil(2.8, 0.12, 18.4, 0.05), 28.2, 1.15, 0));
    accent.push(at(airfoil(1.7, 0.12, 17.6, 0.35), 25.7, 1.75, 0));
    accent.push(at(airfoil(1.25, 0.12, 16.4, 0.6), 24.4, 2.55, 0));
    for (const sd of [1, -1]) carbon.push(at(plate([[2.5, 0.6], [-3.5, 0.6], [-4.2, 3.4], [0.5, 2.6]], 0.22), 26, 0.35, sd * 9.25));
    // Aileron arrière (plan + volet), flasques, poutre, pylône
    carbon.push(at(airfoil(3.2, 0.11, 10.2, 0.12), -21.9, 8.1, 0));
    accent.push(at(airfoil(1.9, 0.11, 10.2, 0.55), -21.6, 9.25, 0));
    for (const sd of [1, -1]) paint.push(solid(at(plate([[1.2, 3.2], [-4.6, 3.2], [-4.6, 9.9], [-0.3, 10.1]], 0.25), -21.2, 0, sd * 5.15)));
    carbon.push(at(airfoil(1.7, 0.12, 8.2, 0.25), -22.2, 4.0, 0));
    carbon.push(at(plate([[0, 0], [-1.6, 0], [-2.6, 4.3], [-1.2, 4.3]], 0.6), -20.6, 4.0, 0));

    // Suspensions (bras triangulés, biellettes)
    for (const sd of [1, -1]) {
      const fz = sd * 6.6, rz = sd * 6.4;
      carbon.push(rod([17, 5.0, sd * 1.9], [15, 4.7, fz], 0.14), rod([13, 5.0, sd * 2.4], [15, 4.7, fz], 0.14));
      carbon.push(rod([17, 2.8, sd * 1.4], [15, 2.4, fz], 0.14), rod([12.5, 2.8, sd * 2.4], [15, 2.4, fz], 0.14));
      carbon.push(rod([14, 2.7, sd * 2.0], [15.3, 4.6, fz * 0.92], 0.12), rod([16.5, 3.6, sd * 1.7], [15.8, 3.6, fz], 0.11));
      carbon.push(rod([-17, 4.6, sd * 2.2], [-19, 4.6, rz], 0.14), rod([-21, 4.4, sd * 1.8], [-19, 4.6, rz], 0.14));
      carbon.push(rod([-16.5, 2.2, sd * 2.4], [-19, 2.2, rz], 0.14), rod([-21.5, 2.2, sd * 1.6], [-19, 2.2, rz], 0.14));
      // Écopes de frein
      carbon.push(at(new T.BoxGeometry(2.2, 2.6, 0.9), 15, 3.6, sd * 6.25), at(new T.BoxGeometry(2.6, 2.8, 1.1), -19, 3.7, sd * 5.9));
    }

    // Roue : pneu (profil tourné) + jante + bande de couleur + rayons
    const tyre = (r, w) => {
      const pr = [[2.35, -w / 2], [r - 0.55, -w / 2], [r - 0.15, -w / 2 + 0.3], [r, -w / 2 + 0.8], [r, w / 2 - 0.8], [r - 0.15, w / 2 - 0.3], [r - 0.55, w / 2], [2.35, w / 2]];
      const g = new T.LatheGeometry(pr.map((p) => new T.Vector2(p[0], p[1])), 32);
      g.rotateX(Math.PI / 2);
      return g;
    };
    const wheelGeo = (r, w) => {
      const t = tyre(r, w);
      const rim = new T.CylinderGeometry(2.33, 2.33, w - 0.3, 24, 1, true);
      rim.rotateX(Math.PI / 2);
      const face = [], ring = [];
      for (const sd of [1, -1]) {
        face.push(at(new T.CircleGeometry(2.3, 24), 0, 0, sd * (w / 2 - 0.4), 0, sd > 0 ? 0 : Math.PI, 0));
        for (let k = 0; k < 10; k++) face.push(at(new T.BoxGeometry(0.35, 1.9, 0.2), 0, 1.15, sd * (w / 2 - 0.3), 0, 0, 0).rotateZ((k / 10) * Math.PI * 2));
        ring.push(at(new T.RingGeometry(r - 0.62, r - 0.45, 32), 0, 0, sd * (w / 2 + 0.02), 0, sd > 0 ? 0 : Math.PI, 0));
      }
      return { tyre: t, rim: merge([rim, ...face]), ring: merge(ring) };
    };

    shared = {
      paint: merge(paint),
      carbon: merge(carbon),
      accent: merge(accent),
      helmet: new T.SphereGeometry(1.45, 18, 14),
      visor: at(new T.SphereGeometry(1.48, 18, 8, -0.9, 1.8, 1.05, 0.55), 0, 0, 0, 0, Math.PI, 0),
      wheelF: wheelGeo(3.6, 3.05),
      wheelR: wheelGeo(3.6, 4.05),
      light: new T.BoxGeometry(0.5, 0.6, 1.2),
      shadow: new T.PlaneGeometry(64, 30),
    };
    return shared;
  }

  // ---------- Matériaux ----------
  const COMPOUND = [0xd7262e, 0xf2c21b, 0xeeeeee];
  const matCache = new Map();
  function materials(team, num) {
    const key = team.color + team.color2 + num;
    if (matCache.has(key)) return matCache.get(key);
    const m = {
      paint: new T.MeshPhysicalMaterial({ map: X.livery(team, num), roughness: 0.42, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 0.55, side: T.DoubleSide }),
      accent: new T.MeshPhysicalMaterial({ color: team.color2, roughness: 0.45, metalness: 0.05, clearcoat: 0.6, envMapIntensity: 0.55, side: T.DoubleSide }),
    };
    matCache.set(key, m);
    return m;
  }
  let common = null;
  function commonMats() {
    if (common) return common;
    const carbonTex = X.tex.carbon();
    carbonTex.repeat.set(6, 6);
    common = {
      carbon: new T.MeshStandardMaterial({ map: carbonTex, color: 0x9a9a9a, roughness: 0.42, metalness: 0.45, side: T.DoubleSide }),
      rubber: new T.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.92, metalness: 0 }),
      rim: new T.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.3, metalness: 0.85, side: T.DoubleSide }),
      rings: COMPOUND.map((c) => new T.MeshStandardMaterial({ color: c, roughness: 0.6, side: T.DoubleSide })),
      visor: new T.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.05, metalness: 0.9, clearcoat: 1 }),
      light: new T.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 0.6 }),
      shadow: new T.MeshBasicMaterial({ map: X.tex.shadow(), transparent: true, depthWrite: false, opacity: 0.85 }),
    };
    return common;
  }

  // ---------- Construction d'une voiture ----------
  X.makeCar = function (team, num, isPlayer, compound) {
    const S = shared || buildShared();
    const C = commonMats();
    const M = materials(team, num);
    const g = new T.Group();
    const add = (geo, mat, cast) => { const m = new T.Mesh(geo, mat); m.castShadow = !!cast; g.add(m); return m; };

    const sh = add(S.shadow, C.shadow);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(-2, 0.25, 0);
    add(S.paint, M.paint, true);
    add(S.carbon, C.carbon, true);
    add(S.accent, M.accent, true);
    const helmet = new T.Group();
    helmet.add(new T.Mesh(S.helmet, new T.MeshPhysicalMaterial({ color: isPlayer ? 0xffffff : team.color2, roughness: 0.25, clearcoat: 1 })));
    helmet.add(new T.Mesh(S.visor, C.visor));
    helmet.position.set(-0.9, 7.55, 0);
    g.add(helmet);
    const light = add(S.light, C.light);
    light.position.set(-23.2, 3.0, 0);

    const wheels = [];
    const ringMat = C.rings[compound == null ? 0 : compound];
    const mk = (x, z, W, front) => {
      const pivot = new T.Group();
      pivot.position.set(x, 3.6, z);
      const spin = new T.Group();
      const t = new T.Mesh(W.tyre, C.rubber); t.castShadow = true;
      spin.add(t, new T.Mesh(W.rim, C.rim), new T.Mesh(W.ring, ringMat));
      pivot.add(spin);
      g.add(pivot);
      wheels.push({ pivot, wh: spin, r: 3.6, front });
    };
    mk(15, 7.85, S.wheelF, true); mk(15, -7.85, S.wheelF, true);
    mk(-19, 7.45, S.wheelR, false); mk(-19, -7.45, S.wheelR, false);
    return { g, wheels, helmet, spin: 0 };
  };

  X.geo = { loft, airfoil, plate, rod, merge, at };
})();
