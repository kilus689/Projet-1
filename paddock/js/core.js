'use strict';
// Cœur de la simulation : circuit, physique des voitures, pilotes IA, course.
// Aucun accès au DOM ici, ce qui permet de tester la simulation avec Node.
(function (root) {
  const F1 = root.F1 || (root.F1 = {});

  // ---------- Utilitaires ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    const u = Math.max(1e-9, r()), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  F1.util = { clamp, wrapAngle, rng, gauss };

  // ---------- Physique ----------
  // Échelle : 1 px = 10 cm. Une voiture mesure 52 px (5,2 m).
  const PHYS = {
    // Valeurs calées sur une F1 2026 : 0-100 km/h ≈ 2 s, 0-200 ≈ 4,5 s, pointe ≈ 314 km/h
    // (≈ 345 km/h avec batterie et aéro active), freinage ≈ 5,5 g à haute vitesse
    maxSpeed: 975, // px/s
    accel: 128,
    accelExp: 3.2,
    brake: 470,
    highSpeedSteer: 0.62, // perte de vivacité en virage à haute vitesse
    reverseMax: 220,
    steerRate: 2.7, // rad/s
    grip: 9,
    drag: 0.05,
    offTrackMax: 0.42,
    radius: 19,
  };
  F1.PHYS = PHYS;

  // Météo : multiplicateurs d'adhérence, de freinage, de motricité et de braquage
  F1.WEATHER = {
    dry: { label: 'Sec', grip: 1, brake: 1, accel: 1, steer: 1, ai: 1 },
    cloudy: { label: 'Nuageux', grip: 1, brake: 1, accel: 1, steer: 1, ai: 1 },
    rain: { label: 'Pluie', grip: 0.62, brake: 0.78, accel: 0.86, steer: 0.86, ai: 0.84 },
  };
  // Pneus : adhérence relative et durée de vie (fraction de la distance de course avant usure complète)
  F1.TYRES = {
    S: { label: 'Tendre', short: 'T', color: '#e10600', grip: 1.035, life: 0.32 },
    M: { label: 'Médium', short: 'M', color: '#ffd60a', grip: 1.0, life: 0.52 },
    H: { label: 'Dur', short: 'D', color: '#f2f2f2', grip: 0.975, life: 0.8 },
    I: { label: 'Intermédiaire', short: 'I', color: '#3ddc84', grip: 1.0, life: 0.65 },
  };
  F1.PIT_SPEED = 222; // 80 km/h dans la voie des stands
  // Batterie (ERS 2026) : fractions de batterie par seconde
  F1.ERS = { deploy: 0.03, boost: 0.085, harvestBrake: 0.12, harvestLift: 0.04, gain: 0.06, boostGain: 0.13, empty: -0.08 };
  F1.KMH = 0.36; // px/s -> km/h

  // ---------- Circuit ----------
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  // Catmull-Rom centripète : pas de boucles parasites même avec des points irréguliers
  function centripetal(p0, p1, p2, p3, out) {
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.max(1e-3, dist(p0, p1)));
    const t2 = t1 + Math.sqrt(Math.max(1e-3, dist(p1, p2)));
    const t3 = t2 + Math.sqrt(Math.max(1e-3, dist(p2, p3)));
    const n = Math.max(2, Math.ceil(dist(p1, p2) / 4));
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const lerp = (a, b, ta, tb) => ({
        x: ((tb - t) / (tb - ta)) * a.x + ((t - ta) / (tb - ta)) * b.x,
        y: ((tb - t) / (tb - ta)) * a.y + ((t - ta) / (tb - ta)) * b.y,
      });
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }

  // ---------- Altitude (grille issue de js/data/elevation.js) ----------
  const demCache = new Map();
  function decodeElev(id) {
    if (demCache.has(id)) return demCache.get(id);
    const e = F1.ELEV[id];
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(e.data);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else bytes = new Uint8Array(Buffer.from(e.data, 'base64'));
    const n = e.nx * e.ny;
    let v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = e.base + (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) / 10;
    // Léger flou pour adoucir le bruit des données
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(n);
      for (let y = 0; y < e.ny; y++) for (let x = 0; x < e.nx; x++) {
        let acc = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= e.nx || yy >= e.ny) continue;
          acc += v[yy * e.nx + xx]; c++;
        }
        o[y * e.nx + x] = acc / c;
      }
      v = o;
    }
    // Les tracés sont décalés de +3000 par Track (voir plus bas)
    const E = { ox: e.x0 + 3000, oy: e.y0 + 3000, sp: e.sp, nx: e.nx, ny: e.ny, v };
    demCache.set(id, E);
    return E;
  }
  function demAt(E, x, y) {
    let fx = (x - E.ox) / E.sp, fy = (y - E.oy) / E.sp;
    fx = Math.max(0, Math.min(E.nx - 1.001, fx));
    fy = Math.max(0, Math.min(E.ny - 1.001, fy));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const v = E.v, w = E.nx;
    return (v[iy * w + ix] * (1 - tx) + v[iy * w + ix + 1] * tx) * (1 - ty) + (v[(iy + 1) * w + ix] * (1 - tx) + v[(iy + 1) * w + ix + 1] * tx) * ty;
  }

  class Track {
    constructor(def) {
      this.def = def;
      this.id = def.id;
      this.name = def.name || def.circuit || def.id;
      this.width = def.width || 130;
      this.half = this.width / 2;
      this.env = def.env || 'circuit';
      this.runoff = def.runoff || (this.env === 'street' ? 32 : 110);
      this.spacing = 10;

      let ctrl;
      if (def.poly) {
        ctrl = [];
        for (let i = 0; i < def.poly.length; i += 2) ctrl.push({ x: def.poly[i] + 3000, y: def.poly[i + 1] + 3000 });
      } else {
        const S = def.scale || 100;
        ctrl = def.points.map((p) => ({ x: p[0] * S, y: p[1] * S }));
      }
      const n = ctrl.length;
      const dense = [];
      for (let i = 0; i < n; i++) {
        centripetal(ctrl[(i - 1 + n) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n], dense);
      }

      // Rééchantillonnage à pas constant
      const sp = this.spacing;
      let pts = [{ x: dense[0].x, y: dense[0].y }];
      let prev = dense[0], carry = 0;
      for (let i = 1; i <= dense.length; i++) {
        const cur = dense[i % dense.length];
        let start = prev;
        let seg = dist(start, cur);
        while (carry + seg >= sp) {
          const need = sp - carry;
          const t = need / seg;
          const np = { x: start.x + (cur.x - start.x) * t, y: start.y + (cur.y - start.y) * t };
          pts.push(np);
          seg -= need;
          start = np;
          carry = 0;
        }
        carry += seg;
        prev = cur;
      }
      if (carry < sp * 0.5) pts.pop();
      let N = pts.length;

      // Lissage léger (bruit GPS des tracés réels)
      if (def.poly) {
        for (let pass = 0; pass < 3; pass++) {
          const q = new Array(N);
          for (let i = 0; i < N; i++) {
            let sx = 0, sy = 0;
            for (let j = -2; j <= 2; j++) { const p = pts[(i + j + N) % N]; sx += p.x; sy += p.y; }
            q[i] = { x: sx / 5, y: sy / 5 };
          }
          pts = q;
        }
      }
      this.n = N;
      this.length = N * sp;

      for (let i = 0; i < N; i++) {
        const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const p = pts[i];
        p.ang = ang;
        p.tx = Math.cos(ang);
        p.ty = Math.sin(ang);
        p.nx = -p.ty;
        p.ny = p.tx;
      }
      // Courbure signée (k > 0 : le virage tourne du côté +normale)
      const m = 3;
      const raw = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        raw[i] = wrapAngle(pts[(i + m) % N].ang - pts[(i - m + N) % N].ang) / (2 * m * sp);
      }
      this.k = new Float32Array(N);
      const sm = 4;
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let j = -sm; j <= sm; j++) s += raw[(i + j + N) % N];
        this.k[i] = s / (2 * sm + 1);
      }
      this.pts = pts;

      // Profil de vitesse théorique (utilisé par l'IA) — dépend de l'adhérence du circuit
      this.setGrip(def.gripK || 1);

      // Zones d'aéro active : lignes droites d'au moins 300 m
      this.aeroZone = new Uint8Array(N);
      this.aeroZones = [];
      for (let i = 0; i < N;) {
        if (Math.abs(this.k[i]) < 0.0007) {
          let j = i;
          while (j < i + N && Math.abs(this.k[j % N]) < 0.0007) j++;
          if (j - i >= 300) {
            this.aeroZones.push([i + 60, j - 30]);
            for (let t = i + 60; t < j - 30; t++) this.aeroZone[t % N] = 1;
          }
          i = j + 1;
        } else i++;
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      this.bounds = { minX, minY, maxX, maxY };

      // Grille spatiale pour les requêtes de distance
      this.cell = 512;
      this.grid = new Map();
      for (let i = 0; i < N; i++) {
        const key = this.cellKey(Math.floor(pts[i].x / this.cell), Math.floor(pts[i].y / this.cell));
        let arr = this.grid.get(key);
        if (!arr) this.grid.set(key, (arr = []));
        arr.push(i);
      }

      // Relief réel (altitude en mètres le long du tracé, pente)
      this.elevation(def);
      // Voie des stands le long de la ligne droite de départ
      this.computePit();
    }

    computePit() {
      const N = this.n, half = this.half, run = this.runoff, def = this.def || {};
      let best = null;
      for (const side of def.pitSide ? [def.pitSide] : [1, -1]) {
        const off = side * (half + run + 175);
        const ok = (t) => {
          const p = this.pts[((t % N) + N) % N];
          return this.distTo(p.x + p.nx * off, p.y + p.ny * off) > half + run + 150 &&
            this.distTo(p.x + p.nx * off * 0.4, p.y + p.ny * off * 0.4) > Math.abs(off * 0.4) - 25;
        };
        let a = 0, z = 0;
        while (a > -260 && ok(a - 5)) a -= 5;
        while (z < 70 && ok(z + 5)) z += 5;
        if (!best || z - a > best.z - best.a) best = { side, a, z };
      }
      if (best.z - best.a < 100) { best.a = -150; best.z = 50; }
      const lane = half + run + 29;
      this.pit = { side: best.side, a: best.a, z: best.z, lane, entry: best.a - 150, exit: best.z + 150 };
      // Entrée / sortie réelles connues (mètres par rapport à la ligne)
      if (def.pitEntry != null) { this.pit.entry = def.pitEntry; this.pit.a = Math.max(def.pitEntry + 120, this.pit.a); }
      if (def.pitExit != null) { this.pit.exit = def.pitExit; this.pit.z = Math.min(def.pitExit - 120, Math.max(this.pit.z, 40)); }
      // Voie des stands réelle décrite par rapport aux virages (js/data/season2026.js, champ « pit »)
      if (def.pit) this.applyPitSpec(def.pit);
    }

    // Virages (zones de courbure) en indices relatifs à la ligne de départ
    cornerRuns() {
      // Virage = rayon < ~110 m sur au moins 15 m (les courbes rapides comme la Parabolica comptent)
      const N = this.n, TH = 0.0009, runs = [];
      for (let i = 0; i < N;) {
        if (Math.abs(this.k[i]) > TH) {
          let j = i;
          while (j < N && Math.abs(this.k[j]) > TH) j++;
          if (j - i >= 15) runs.push({ s: i, e: j });
          i = j + 1;
        } else i++;
      }
      return runs;
    }

    // spec : { side: 'R'|'L', entry: [n, 'before'|'after'] (n-ième virage avant la ligne, 1 = dernier)
    //          ou entryLen: m (longueur de voie avant la sortie), exit: [n, 'before'|'after'] (n-ième virage après la ligne) }
    applyPitSpec(spec) {
      const N = this.n, runs = this.cornerRuns(), P = this.pit;
      if (!runs.length) return;
      P.side = spec.side === 'L' ? -1 : 1;
      const before = runs.slice().reverse(); // derniers virages du tour
      if (spec.exit) {
        const r = runs[Math.min(runs.length - 1, spec.exit[0] - 1)];
        P.exit = spec.exit[1] === 'before' ? r.s - 25 : r.e + 25;
      }
      if (spec.entryLen) P.entry = P.exit - spec.entryLen;
      else if (spec.entry) {
        const r = before[Math.min(before.length - 1, spec.entry[0] - 1)];
        P.entry = (spec.entry[1] === 'after' ? r.e + 15 : r.s - 45) - N;
      }
      if (spec.entryM != null) P.entry = spec.entryM;
      if (spec.exitM != null) P.exit = spec.exitM;
      // Garde-fous : entrée avant la ligne, sortie après, longueur raisonnable
      if (!(P.entry < -150)) P.entry = -400;
      if (!(P.exit > 80)) P.exit = 250;
      if (P.entry < -1300) P.entry = -1300;
      if (P.exit > 900) P.exit = 900;
      // Partie droite de la voie (garages) entre les deux bretelles
      // Zone limitée à 80 km/h (devant les garages) : ~350 m autour de la ligne, comme en réalité
      P.a = Math.max(P.entry + 140, -260);
      P.z = Math.min(P.exit - 110, 90);
      if (P.z < P.a + 150) P.z = Math.min(P.exit - 60, P.a + 150);
    }

    // Indice relatif à la ligne de départ (négatif avant la ligne)
    rel(i) { return i > this.n / 2 ? i - this.n : i; }

    // Décalage latéral de la voie des stands à la distance relative d (échantillons)
    pitLat(d) {
      const P = this.pit;
      const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
      let f = 0;
      if (d <= P.entry || d >= P.exit) f = 0;
      else if (d < P.a - 30) f = sm((d - P.entry) / (P.a - 30 - P.entry));
      else if (d <= P.z + 30) f = 1;
      else f = 1 - sm((d - P.z - 30) / (P.exit - P.z - 30));
      return P.side * P.lane * f;
    }

    cellKey(cx, cy) { return cx * 65536 + cy; }

    // Adhérence du circuit (1 = référence) : recalcule le profil de vitesse de l'IA
    setGrip(k) {
      this.gripK = k;
      const N = this.n, sp = this.spacing;
      const vc = new Float32Array(N);
      const sr = PHYS.steerRate * k;
      for (let i = 0; i < N; i++) {
        let kmax = 0;
        for (let j = -6; j <= 6; j++) kmax = Math.max(kmax, Math.abs(this.k[(i + j + N) % N]));
        // Vitesse la plus haute telle que le taux de lacet disponible suffise : v·k ≤ 0,9·sr·(1 − h·(v/vmax)^0,8)
        let lo = 0, hi = PHYS.maxSpeed * 1.05;
        for (let it = 0; it < 22; it++) {
          const v = (lo + hi) / 2;
          const ok = v * kmax <= 0.9 * sr * (1 - PHYS.highSpeedSteer * Math.pow(Math.min(1, v / PHYS.maxSpeed), 0.8));
          if (ok) lo = v; else hi = v;
        }
        vc[i] = lo;
      }
      const vp = new Float32Array(vc);
      const b = PHYS.brake * 0.72;
      for (let pass = 0; pass < 3; pass++) {
        for (let i = N - 1; i >= 0; i--) {
          const nxt = vp[(i + 1) % N];
          // freinage plus faible à basse vitesse (même modèle que la voiture)
          const bb = b * (0.45 + 0.55 * Math.min(1, nxt / PHYS.maxSpeed));
          vp[i] = Math.min(vc[i], Math.sqrt(nxt * nxt + 2 * bb * sp));
        }
      }
      this.vp = vp;
      this._line = null;
    }

    // ---------- Relief ----------
    elevation(def) {
      const N = this.n, pts = this.pts;
      this.h = new Float32Array(N);
      this.slope = new Float32Array(N);
      const E = def.id && F1.ELEV && F1.ELEV[def.id] ? decodeElev(def.id) : null;
      this.dem = E;
      // Échelle appliquée au tracé (longueur officielle) : les données d'altitude restent dans le repère d'origine
      this.sf = def.scaleF || 1;
      if (!E) return;
      const raw = new Float32Array(N);
      for (let i = 0; i < N; i++) raw[i] = demAt(E, this.unscale(pts[i].x), this.unscale(pts[i].y));
      // 1) Niveau du sol : 20e centile sur ±60 m (élimine immeubles, ponts, arbres)
      const W = 60, low = new Float32Array(N), win = new Float32Array(2 * W + 1);
      for (let i = 0; i < N; i += 4) {
        for (let j = -W; j <= W; j++) win[j + W] = raw[(i + j + N) % N];
        win.sort();
        const v = win[Math.floor(win.length * 0.2)];
        for (let k = 0; k < 4 && i + k < N; k++) low[i + k] = v;
      }
      // 2) Lissage (trois moyennes glissantes ≈ gaussienne de 25 m)
      let s = low;
      for (let pass = 0; pass < 3; pass++) {
        const o = new Float32Array(N);
        let acc = 0;
        const R = 25;
        for (let j = -R; j <= R; j++) acc += s[(j + N) % N];
        for (let i = 0; i < N; i++) {
          o[i] = acc / (2 * R + 1);
          acc += s[(i + R + 1) % N] - s[(i - R + N) % N];
        }
        s = o;
      }
      // 3) Pente limitée à 16 % (la plus forte du calendrier est d'environ 18 %)
      const g = 0.16 * (this.spacing / 10);
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 1; i < 2 * N; i++) { const a = i % N, b = (i - 1) % N; s[a] = Math.min(Math.max(s[a], s[b] - g), s[b] + g); }
        for (let i = 2 * N; i > 0; i--) { const a = i % N, b = (i + 1) % N; s[a] = Math.min(Math.max(s[a], s[b] - g), s[b] + g); }
      }
      // 4) Correction des circuits où les données sont faussées (voir season2026.js)
      let mean = 0;
      for (let i = 0; i < N; i++) mean += s[i];
      mean /= N;
      this.meanH = mean;
      this.reliefScale = def.relief != null ? def.relief : 1;
      for (let i = 0; i < N; i++) this.h[i] = mean + (s[i] - mean) * this.reliefScale;
      // 5) Pont : quand le tracé se croise (Suzuka), la portion la plus tardive passe dessus
      this.bridges = [];
      for (let i = 0; i < N; i += 3) {
        const p = pts[i];
        const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const arr = this.grid.get(this.cellKey(cx + a, cy + b));
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i + 300 || N - (j - i) <= 300) continue;
            if ((pts[j].x - p.x) ** 2 + (pts[j].y - p.y) ** 2 > (this.half * 0.6) ** 2) continue;
            if (this.bridges.some((br) => Math.abs(br.j - j) < 200)) continue;
            this.bridges.push({ i, j });
          }
        }
      }
      for (const br of this.bridges) {
        const need = this.h[br.i] + 7.5 - this.h[br.j];
        if (need <= 0) continue;
        const R = 170;
        for (let d = -R; d <= R; d++) {
          const w = Math.cos((d / R) * Math.PI / 2) ** 2;
          this.h[(br.j + d + N) % N] += need * w;
        }
      }
      for (let i = 0; i < N; i++) this.slope[i] = (this.h[(i + 3) % N] - this.h[(i - 3 + N) % N]) / (6 * this.spacing / 10);
    }

    // Trajectoire idéale : décalage latéral (corde des virages) et zones de freinage
    racingLine() {
      if (this._line) return this._line;
      const N = this.n, half = this.half;
      const lat = new Float32Array(N), brake = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let j = -12; j <= 12; j++) acc += Math.max(-1, Math.min(1, this.k[(i + 10 + j + N) % N] * 900));
        lat[i] = (acc / 25) * half * 0.55;
        let mn = Infinity;
        for (let j = 5; j <= 60; j += 5) mn = Math.min(mn, this.vp[(i + j) % N]);
        brake[i] = this.vp[i] - mn > 60 ? 1 : 0;
      }
      return (this._line = { lat, brake });
    }

    // Altitude du terrain (mètres) en un point du jeu, avec la même correction que la piste
    unscale(v) { return 3000 + (v - 3000) / (this.sf || 1); }

    groundAt(x, y) {
      if (!this.dem) return 0;
      const v = demAt(this.dem, this.unscale(x), this.unscale(y));
      return this.meanH + (v - this.meanH) * this.reliefScale;
    }

    // Distance au tracé (précise jusqu'à ~500 px, sinon renvoie une grande valeur)
    distTo(x, y) {
      const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
      let bd = Infinity;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const arr = this.grid.get(this.cellKey(cx + i, cy + j));
          if (!arr) continue;
          for (const k of arr) {
            const p = this.pts[k];
            const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
            if (d < bd) bd = d;
          }
        }
      }
      return bd === Infinity ? 1e9 : Math.sqrt(bd);
    }

    nearest(x, y, hint) {
      const N = this.n, pts = this.pts;
      let best = 0, bd = Infinity;
      if (hint == null || hint < 0) {
        for (let i = 0; i < N; i++) {
          const dx = pts[i].x - x, dy = pts[i].y - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
        return best;
      }
      for (let j = -35; j <= 35; j++) {
        const i = (hint + j + N) % N;
        const dx = pts[i].x - x, dy = pts[i].y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    idxAt(s) {
      const N = this.n;
      return ((Math.round(s / this.spacing) % N) + N) % N;
    }

    posAt(s, lat) {
      const i = this.idxAt(s);
      const p = this.pts[i];
      return { x: p.x + p.nx * lat, y: p.y + p.ny * lat, a: p.ang, idx: i };
    }
  }
  F1.Track = Track;

  const trackCache = new Map();
  F1.getTrack = function (gp) {
    if (!trackCache.has(gp.id)) {
      let poly = F1.SHAPES[gp.id];
      // Ligne de départ déplacée (startShift en mètres, négatif = plus tôt sur le tour)
      if (gp.startShift) {
        const tmp = new Track(Object.assign({ poly, name: gp.circuit }, gp, { id: null }));
        const target = tmp.pts[((Math.round(gp.startShift * 10 / tmp.spacing) % tmp.n) + tmp.n) % tmp.n];
        // On insère un sommet exactement sur la nouvelle ligne, puis le tracé commence par lui
        const tx = target.x - 3000, ty = target.y - 3000, n = poly.length / 2;
        let best = 0, bd = Infinity, bx = tx, by = ty;
        for (let i = 0; i < n; i++) {
          const ax = poly[i * 2], ay = poly[i * 2 + 1], cx = poly[((i + 1) % n) * 2], cy = poly[((i + 1) % n) * 2 + 1];
          const dx = cx - ax, dy = cy - ay, L = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((tx - ax) * dx + (ty - ay) * dy) / L));
          const px = ax + dx * t, py = ay + dy * t, d = (px - tx) ** 2 + (py - ty) ** 2;
          if (d < bd) { bd = d; best = i; bx = px; by = py; }
        }
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([poly[i * 2], poly[i * 2 + 1]]);
        pts.splice(best + 1, 0, [Math.round(bx), Math.round(by)]);
        const rot = pts.slice(best + 1).concat(pts.slice(0, best + 1)).filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 30);
        poly = [].concat(...rot);
      }
      let tr = new Track(Object.assign({}, gp, { poly, name: gp.circuit }));
      // Mise à l'échelle sur la longueur officielle du circuit
      if (gp.length) {
        const f = (gp.length * 10) / tr.length;
        if (Math.abs(f - 1) > 0.0015) {
          poly = poly.map((v) => Math.round(v * f));
          tr = new Track(Object.assign({}, gp, { poly, name: gp.circuit, scaleF: f }));
        }
      }
      trackCache.set(gp.id, tr);
    }
    return trackCache.get(gp.id);
  };

  // ---------- Voiture ----------
  class Car {
    constructor(o) {
      Object.assign(this, {
        name: 'Pilote', code: '---', num: 0, team: null, isPlayer: false, skill: 1, power: 1,
        x: 0, y: 0, a: 0, vx: 0, vy: 0, steer: 0,
        idx: 0, wrap: -1, maxWrap: -1, lat: 0,
        lapStart: 0, lapTimes: [], bestLap: Infinity,
        finished: false, finishTime: 0, finishPos: 0,
        offTrack: false, skid: 0, wallHit: 0, alongTrack: 0,
        lane: 0, lanePref: 0, stuck: 0, wrongWay: 0,
        throttle: 0, brakeIn: 0, gap: 0,
        battery: 0.85, aeroOpen: false, boosting: false, deploying: false,
        tyre: 'M', wear: 0, tyreF: 1, stops: 0, pitReq: false, nextTyre: null, pit: null, prevProg: null,
        // Dégâts (0 = intact, 1 = détruit) : aileron avant, aileron arrière, suspension/carrosserie
        dmg: { fw: 0, rw: 0, sus: 0 }, dmgSide: 0, dmgMul: 0, dmgEvents: null,
      }, o);
    }

    get speed() { return Math.hypot(this.vx, this.vy); }
    get progress() { return this.wrap * 100000 + this.idx; }

    placeOnTrack(track, s, lat, speed) {
      const p = track.posAt(s, lat);
      this.x = p.x; this.y = p.y; this.a = p.a;
      this.vx = Math.cos(p.a) * (speed || 0);
      this.vy = Math.sin(p.a) * (speed || 0);
      this.idx = p.idx;
      this.wrap = p.idx > track.n / 2 ? -1 : 0;
      this.maxWrap = this.wrap;
    }

    resetOnTrack(track) {
      const p = track.pts[this.idx];
      this.x = p.x; this.y = p.y; this.a = p.ang;
      this.vx = this.vy = 0;
      this.steer = 0;
      this.stuck = 0;
    }

    update(dt, inp, track, cond) {
      const P = PHYS, E = F1.ERS;
      const C0 = cond || F1.WEATHER.dry;
      const tf = this.tyreF || 1;
      const D = this.dmg;
      // Aileron avant abîmé : moins d'appui à l'avant (sous-virage) ; arrière : moins de grip et de vitesse ; suspension : la voiture tire d'un côté
      const C = {
        grip: C0.grip * tf * (1 - 0.22 * D.fw - 0.16 * D.rw - 0.08 * D.sus),
        steer: C0.steer * (0.5 + 0.5 * tf) * (1 - 0.32 * D.fw - 0.1 * D.sus),
        brake: C0.brake * (0.7 + 0.3 * tf) * (1 - 0.12 * D.fw),
        accel: C0.accel * (0.8 + 0.2 * tf) * (1 - 0.1 * D.sus),
        aero: C0.aero,
      };
      this.steer += (inp.steer - this.steer) * Math.min(1, dt * 10);
      this.throttle = inp.throttle;
      this.brakeIn = inp.brake;

      // Aéro active : seulement dans une zone, refermée au freinage
      const zone = track.aeroZone ? track.aeroZone[this.idx] : 0;
      if (!zone || inp.brake > 0.1 || C.aero === 'off') this.aeroOpen = false;
      else if (inp.aero != null) this.aeroOpen = !!inp.aero;
      const aero = this.aeroOpen ? 1 : 0;

      let fx = Math.cos(this.a), fy = Math.sin(this.a);
      let vF = this.vx * fx + this.vy * fy;
      const absF = Math.abs(vF);
      const low = Math.min(1, absF / 160);
      // Plus la voiture va vite, plus le rayon de braquage s'agrandit (comme une vraie F1)
      const high = 1 - P.highSpeedSteer * Math.pow(Math.min(1, absF / P.maxSpeed), 0.8);
      this.a += this.steer * P.steerRate * (track.gripK || 1) * C.steer * (aero ? 0.82 : 1) * low * high * Math.sign(vF) * (this.offTrack ? 0.8 : 1) * dt;
      if (D.sus > 0.05 && absF > 30) this.a += D.sus * this.dmgSide * 0.05 * low * Math.sign(vF) * dt;
      this.a = wrapAngle(this.a);

      fx = Math.cos(this.a); fy = Math.sin(this.a);
      const rx = -fy, ry = fx;
      vF = this.vx * fx + this.vy * fy;
      let vR = this.vx * rx + this.vy * ry;

      // Batterie : déploiement à pleine charge, récupération au freinage et au lever de pied
      let deploy = 0;
      if (inp.throttle > 0.6 && vF > 150 && this.battery > 0.002) deploy = inp.boost ? E.boost : E.deploy;
      const harvest = inp.brake > 0 ? E.harvestBrake * inp.brake : inp.throttle <= 0.1 && vF > 100 ? E.harvestLift : 0;
      this.battery = Math.min(1, Math.max(0, this.battery + (harvest - deploy) * dt));
      this.deploying = deploy > 0;
      this.boosting = deploy === E.boost;
      const ers = deploy > 0 ? (this.boosting ? E.boostGain : E.gain) : this.battery <= 0.002 ? E.empty : 0;
      const pw = this.power * (1 + ers);

      const maxS = P.maxSpeed * pw * (1 + 0.045 * aero) * (1 - 0.05 * D.fw - 0.07 * D.rw - 0.08 * D.sus) * (this.offTrack ? P.offTrackMax : 1);
      // Si la voiture recule (rebond sur un mur) et qu'on accélère : on freine d'abord le recul
      if (inp.throttle > 0 && vF < 0) vF = Math.min(0, vF + P.brake * inp.throttle * dt);
      if (inp.throttle > 0 && vF > -10) {
        const r = Math.max(0, vF / maxS);
        vF += P.accel * pw * C.accel * inp.throttle * Math.max(0, 1 - Math.pow(r, P.accelExp)) * dt;
      }
      if (inp.brake > 0) {
        // Freinage plus fort à haute vitesse (appui aérodynamique)
        if (vF > 5) vF = Math.max(0, vF - P.brake * C.brake * inp.brake * (0.45 + 0.55 * Math.min(1, vF / P.maxSpeed)) * dt);
        else vF = Math.max(-P.reverseMax, vF - P.accel * 0.45 * inp.brake * dt);
      }
      vF -= vF * P.drag * (1 - 0.35 * aero) * dt;
      if (inp.throttle <= 0 && inp.brake <= 0) {
        const roll = 60 * dt;
        vF = Math.abs(vF) < roll ? 0 : vF - Math.sign(vF) * roll;
      }
      if (this.offTrack && Math.abs(vF) > maxS) vF -= (vF - Math.sign(vF) * maxS) * 2.2 * dt;
      // Gravité : on ralentit en montée, on accélère en descente (g = 98,1 unités/s²)
      if (track.slope) {
        const p = track.pts[this.idx];
        vF -= 98.1 * track.slope[this.idx] * (fx * p.tx + fy * p.ty) * dt;
      }

      this.skid = Math.abs(vR);
      vR *= Math.exp(-P.grip * C.grip * (inp.stability ? 1.35 : 1) * (aero ? 0.85 : 1) * (this.offTrack ? 0.55 : 1) * dt);

      this.vx = fx * vF + rx * vR;
      this.vy = fy * vF + ry * vR;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      this.trackUpdate(track);
    }

    trackUpdate(track) {
      const N = track.n;
      const idx = track.nearest(this.x, this.y, this.idx);
      const d = idx - this.idx;
      if (d < -N / 2) this.wrap++;
      else if (d > N / 2) this.wrap--;
      this.idx = idx;

      const p = track.pts[idx];
      this.lat = (this.x - p.x) * p.nx + (this.y - p.y) * p.ny;
      const ad = Math.abs(this.lat);
      this.offTrack = ad > track.half + 6;
      if (this.pit) { this.offTrack = false; return; }

      // Mur / barrière : c'est la carrosserie (et pas seulement le centre) qui s'arrête contre le mur.
      // Largeur occupée selon l'angle de la voiture : 0,95 m de côté, jusqu'à 2,5 m si elle est en travers.
      const hx = Math.cos(this.a), hy = Math.sin(this.a);
      const sl = Math.abs(hx * p.nx + hy * p.ny);
      const ext = sl * 25 + Math.sqrt(Math.max(0, 1 - sl * sl)) * 9.5;
      const lim = track.half + track.runoff - ext;
      if (ad > lim) {
        const s = Math.sign(this.lat);
        this.x -= p.nx * (ad - lim) * s;
        this.y -= p.ny * (ad - lim) * s;
        const vn = this.vx * p.nx + this.vy * p.ny;
        if (vn * s > 0) {
          const imp = Math.abs(vn);
          this.wallHit = Math.max(this.wallHit, imp);
          // Dégâts : le nez qui tape abîme l'aileron avant, l'arrière l'aileron arrière, le flanc la suspension
          if (this.dmgMul && imp > 60) {
            const h = (hx * p.nx + hy * p.ny) * s;
            const sev = Math.min(1, (imp - 60) / 420) * this.dmgMul * (this.isPlayer ? 1 : 0.5);
            if (h > 0.4) this.hurt('fw', sev * 1.1, s);
            else if (h < -0.4) this.hurt('rw', sev * 1.1, s);
            else this.hurt('sus', sev * 0.8, s);
          }
          // On retire la vitesse vers le mur (petit rebond seulement si le choc est franc)
          const bounce = imp > 120 ? 1.3 : 1.0;
          this.vx -= p.nx * vn * bounce;
          this.vy -= p.ny * vn * bounce;
          // Frottement proportionnel à la violence du choc : frôler le mur ne bloque plus la voiture
          const keep = 1 - Math.min(0.45, imp / 900);
          this.vx *= keep;
          this.vy *= keep;
        }
      }
      this.alongTrack = this.vx * p.tx + this.vy * p.ty;
    }

    hurt(part, amount, side) {
      if (!(amount > 0.004)) return;
      const D = this.dmg, before = D[part];
      D[part] = Math.min(1, before + amount);
      if (part === 'sus' && side) this.dmgSide = side;
      if (this.dmgEvents) {
        const crossed = [0.15, 0.5, 0.9].filter((th) => before < th && D[part] >= th);
        if (crossed.length) this.dmgEvents.push({ type: 'damage', car: this, part, level: D[part] });
      }
    }
    get damaged() { const D = this.dmg; return Math.max(D.fw, D.rw, D.sus); }
  }
  F1.Car = Car;
  F1.DAMAGE_PARTS = { fw: 'Aileron avant', rw: 'Aileron arrière', sus: 'Suspension' };

  // Partie de la voiture touchée par un contact venant de la direction (nx, ny)
  function contactPart(car, nx, ny) {
    const h = Math.cos(car.a) * nx + Math.sin(car.a) * ny;
    if (h > 0.5) return 'fw';
    if (h < -0.5) return 'rw';
    return 'sus';
  }

  F1.collide = function (cars) {
    const r2 = PHYS.radius * 2;
    const hits = [];
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx > r2 || dx < -r2 || dy > r2 || dy < -r2) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 * r2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const pen = (r2 - d) / 2;
        a.x -= nx * pen; a.y -= ny * pen;
        b.x += nx * pen; b.y += ny * pen;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.65;
          a.vx -= nx * imp; a.vy -= ny * imp;
          b.vx += nx * imp; b.vy += ny * imp;
          hits.push({ a, b, force: -rel });
          // Contact entre voitures : dégâts selon la partie touchée (nez dans l'arrière, roue contre roue…)
          // Les frottements légers ne cassent rien : il faut un vrai choc (> 25 km/h de vitesse relative)
          const sev = Math.min(1, Math.max(0, -rel - 70) / 420);
          if (sev > 0) {
            const side = (o, sx, sy) => Math.sign(-Math.sin(o.a) * sx + Math.cos(o.a) * sy) || 1;
            if (a.dmgMul) { const pa = contactPart(a, nx, ny); a.hurt(pa, sev * a.dmgMul * (a.isPlayer || b.isPlayer ? 1 : 0.4) * (pa === 'sus' ? 0.6 : 1), side(a, nx, ny)); }
            if (b.dmgMul) { const pb = contactPart(b, -nx, -ny); b.hurt(pb, sev * b.dmgMul * (a.isPlayer || b.isPlayer ? 1 : 0.4) * (pb === 'sus' ? 0.6 : 1), side(b, -nx, -ny)); }
          }
        }
      }
    }
    return hits;
  };

  // ---------- Pilote IA ----------
  F1.aiInput = function (car, track, cars, dt) {
    const N = track.n, sp = track.spacing;
    const speed = car.speed;
    const fx = Math.cos(car.a), fy = Math.sin(car.a);

    const kAhead = track.k[(car.idx + Math.round((90 + speed * 0.55) / sp)) % N];
    let target = clamp(kAhead * 900, -1, 1) * track.half * 0.5 + car.lanePref;

    let lift = false;
    for (const o of cars) {
      if (o === car) continue;
      const dx = o.x - car.x, dy = o.y - car.y;
      if (dx > 170 || dx < -170 || dy > 170 || dy < -170) continue;
      const fwd = dx * fx + dy * fy;
      if (fwd <= 0 || fwd > 160) continue;
      const side = -dx * fy + dy * fx;
      if (Math.abs(side) < 36) {
        const os = o.speed;
        if (os < speed + 30) {
          target += (side > 0 ? -1 : 1) * 48;
          if (fwd < 60 && os < speed - 40) lift = true;
        }
      }
    }
    target = clamp(target, -track.half + 16, track.half - 16);
    car.lane += (target - car.lane) * Math.min(1, dt * 1.6);

    const look = Math.round((50 + speed * 0.26) / sp);
    const tp = track.pts[(car.idx + look) % N];
    const tx = tp.x + tp.nx * car.lane, ty = tp.y + tp.ny * car.lane;
    const err = wrapAngle(Math.atan2(ty - car.y, tx - car.x) - car.a);
    const steer = clamp(err * 3.2, -1, 1);

    const vt = track.vp[(car.idx + Math.round((20 + speed * 0.1) / sp)) % N] * car.skill * (car.wx || 1) * (0.55 + 0.45 * (car.tyreF || 1));
    let throttle = 0, brake = 0;
    if (speed < vt - 5 && !lift) throttle = 1;
    else if (speed > vt + 25) brake = clamp((speed - vt) / 160, 0.2, 1);
    if (Math.abs(err) > 1.2 && speed > 200) { throttle = 0; brake = 0.5; }
    // Boost quand une voiture est juste devant et que la batterie le permet
    let boost = false;
    if (car.battery > 0.35 && throttle) {
      for (const o of cars) {
        if (o === car) continue;
        const dx = o.x - car.x, dy = o.y - car.y;
        const fwd = dx * fx + dy * fy;
        if (fwd > 40 && fwd < 400 && Math.abs(-dx * fy + dy * fx) < 120) { boost = true; break; }
      }
    }
    const aero = !!track.aeroZone && track.aeroZone[car.idx] === 1 && !brake && Math.abs(steer) < 0.3;
    return { steer, throttle, brake, boost, aero };
  };

  // Temps au tour de référence (IA parfaite, voiture au maximum) — mis en cache
  const refCache = new Map();
  F1.refLapTime = function (track) {
    const key = track.id + ':' + track.gripK;
    if (refCache.has(key)) return refCache.get(key);
    const car = new Car({ skill: 1, power: 1 });
    const s0 = -2000;
    car.placeOnTrack(track, s0, 0, track.vp[track.idxAt(s0)] * 0.9);
    const dt = 1 / 60;
    let t = 0, start = -1, res = 0;
    const startWrap = car.wrap;
    for (let i = 0; i < 60 * 400; i++) {
      car.update(dt, F1.aiInput(car, track, [car], dt), track);
      t += dt;
      if (start < 0 && car.wrap > startWrap) start = t;
      else if (start >= 0 && car.wrap > startWrap + 1) { res = t - start; break; }
    }
    if (!res) res = track.length / 600;
    refCache.set(key, res);
    return res;
  };

  // ---------- Course / qualification jouée ----------
  // entries : [{ id, name, code, num, team, isPlayer, skill, power }] dans l'ordre de la grille
  class Race {
    constructor({ track, entries, laps, mode, weather, aeroMode, assists, tyreWear, playerTyre, damage }) {
      this.track = track;
      this.weather = F1.WEATHER[weather] ? weather : 'dry';
      this.cond = Object.assign({}, F1.WEATHER[this.weather], { aero: aeroMode || 'auto' });
      this.aeroMode = aeroMode || 'auto';
      this.assists = assists || {};
      this.mode = mode || 'race';
      this.laps = this.mode === 'quali' ? 1 : laps;
      this.time = 0;
      this.started = false;
      this.cars = [];
      this.events = [];
      this.finishOrder = [];
      this.splits = new Map();
      this.bestLap = { time: Infinity, car: null };
      const rand = rng(Date.now());
      this.rand = rand;
      this.wearMul = this.mode === 'quali' || tyreWear === 'off' ? 0 : tyreWear === 'high' ? 1.7 : 1;
      this.dmgMul = damage === 'off' || !damage ? 0 : damage === 'high' ? 1.8 : 1;

      entries.forEach((e, g) => {
        const car = new Car(Object.assign({ lanePref: (rand() - 0.5) * 24 }, e));
        car.grid = g + 1;
        car.dmgMul = this.dmgMul;
        car.dmgEvents = this.events;
        car.wx = this.cond.ai;
        // Pneus de départ : intermédiaires sous la pluie, sinon tendres ou médiums (choix du joueur)
        if (this.weather === 'rain') car.tyre = 'I';
        else if (this.mode === 'quali') car.tyre = 'S';
        else if (car.isPlayer && playerTyre) car.tyre = playerTyre;
        else car.tyre = g < 10 ? (rand() < 0.6 ? 'M' : 'S') : (rand() < 0.5 ? 'H' : 'M');
        const ti = (F1.TEAMS2026 || []).findIndex((t) => t.id === (car.team && car.team.id));
        car.garage = ti < 0 ? 10 : ti;
        if (this.mode === 'quali') {
          const s = -2600;
          car.placeOnTrack(track, s, 0, track.vp[track.idxAt(s)] * 0.75);
        } else {
          car.placeOnTrack(track, -70 - g * 80, g % 2 === 0 ? -track.half * 0.4 : track.half * 0.4);
        }
        this.cars.push(car);
      });
      this.player = this.cars.find((c) => c.isPlayer) || null;
      if (this.mode === 'quali') this.started = true;
    }

    step(dt, playerInput) {
      const tr = this.track;
      if (this.started) this.time += dt;
      for (const car of this.cars) {
        let inp;
        if (!this.started) {
          // Voitures immobiles sur la grille pendant les feux
          car.vx = car.vy = 0;
          car.throttle = playerInput && car.isPlayer ? playerInput.throttle : 0;
          continue;
        }
        this.tyres(car);
        if (car.pit) { this.pitStep(car, dt); continue; }
        this.maybeEnterPit(car);
        if (car.pit) { this.pitStep(car, dt); continue; }
        if (car.isPlayer && !car.finished && playerInput) inp = this.playerAssist(car, playerInput, dt);
        else inp = F1.aiInput(car, tr, this.cars, dt);
        car.update(dt, inp, tr, this.cond);
        if (!car.isPlayer || car.finished) {
          if (car.speed < 40) car.stuck += dt; else car.stuck = 0;
          if (car.stuck > 2.5) car.resetOnTrack(tr);
        }
        car.wrongWay = car.alongTrack < -60 ? car.wrongWay + dt : 0;
      }
      this.hits = this.cars.length > 1 ? F1.collide(this.cars.filter((c) => !c.pit)) : [];
      if (this.hits.length) for (const car of this.cars) car.trackUpdate(tr);
      if (this.started) this.updateLaps();
    }

    // ---------- Pneus ----------
    lifeOf(compound) {
      const T = F1.TYRES[compound];
      let life = T.life;
      if (compound === 'I' && this.weather !== 'rain') life *= 0.4; // les intermédiaires fondent sur le sec
      return life;
    }
    wearPerLap(compound) { return this.wearMul / (this.lifeOf(compound) * Math.max(1, this.laps)); }

    tyres(car) {
      const N = this.track.n;
      const prog = car.wrap * N + car.idx;
      if (car.prevProg != null) {
        const d = prog - car.prevProg;
        if (d > 0 && d < 60) car.wear += (d / N) * this.wearPerLap(car.tyre);
      }
      car.prevProg = prog;
      const T = F1.TYRES[car.tyre];
      let g = T.grip;
      if (this.weather === 'rain' && car.tyre !== 'I') g *= 0.8;   // pneus slicks sous la pluie
      if (this.weather !== 'rain' && car.tyre === 'I') g *= 0.94;
      const w = car.wear;
      car.tyreF = Math.max(0.55, g * (1 - 0.16 * Math.pow(Math.min(w, 1), 1.6) - Math.max(0, w - 1) * 0.5));
      if (!car.isPlayer && !car.pitReq && !car.pit && !car.finished && this.mode === 'race') this.aiStrategy(car);
    }

    // Gomme la plus rapide qui tient jusqu'à l'arrivée (ou la plus dure)
    bestTyreFor(lapsLeft) {
      if (this.weather === 'rain') return 'I';
      for (const c of ['S', 'M', 'H']) if (this.wearPerLap(c) * lapsLeft <= 0.95) return c;
      return 'H';
    }

    lapsLeft(car) {
      const N = this.track.n;
      const done = car.wrap + Math.max(0, this.track.rel(car.idx)) / N;
      return Math.max(0, this.laps - done);
    }

    aiStrategy(car) {
      // Aileron avant cassé : l'IA rentre changer de nez s'il reste de la course
      if (!car.isPlayer && car.dmg && (car.dmg.fw > 0.45 || car.dmg.rw > 0.6) && this.lapsLeft(car) > 1.5 && !car.pitReq) {
        car.pitReq = true;
        car.nextTyre = this.bestTyreFor(this.lapsLeft(car) - 0.3);
        return;
      }
      if (!this.wearMul && !(this.weather === 'rain' && car.tyre !== 'I')) return;
      const left = this.lapsLeft(car);
      if (left < 0.4) return;
      const proj = car.wear + this.wearPerLap(car.tyre) * left;
      // On s'arrête le plus tard possible : pneus bien usés ET impossible de finir avec
      car.pitTh = car.pitTh || 0.7 + this.rand() * 0.2;
      const wrongTyres = this.weather === 'rain' ? car.tyre !== 'I' : car.tyre === 'I';
      if (wrongTyres || (proj > 1.0 && car.wear > car.pitTh)) {
        car.pitReq = true;
        car.nextTyre = this.bestTyreFor(left - 0.3);
      }
    }

    // ---------- Arrêts au stand ----------
    maybeEnterPit(car) {
      if (car.finished || this.mode !== 'race') return;
      const P = this.track.pit, d = this.track.rel(car.idx);
      // Le joueur peut aussi entrer simplement en se dirigeant vers l'entrée des stands
      if (!car.pitReq && car.isPlayer && d >= P.entry - 60 && d <= P.entry + 60 &&
          Math.sign(car.lat) === P.side && Math.abs(car.lat) > this.track.half * 0.45) {
        car.pitReq = true;
        if (!car.nextTyre) car.nextTyre = this.bestTyreFor(this.lapsLeft(car) - 0.3);
      }
      if (!car.pitReq) return;
      if (d >= P.entry - 40 && d <= P.entry + 3) {
        const span = P.z - P.a - 40;
        car.pit = { d, v: car.speed, stopD: P.a + 20 + (Math.min(10, car.garage) / 10) * span, phase: 'in', stopT: 0, t0: this.time };
        car.pitReq = false;
        car.aeroOpen = false;
        if (!car.nextTyre) car.nextTyre = this.bestTyreFor(this.lapsLeft(car) - 0.3);
        this.events.push({ type: 'pitIn', car });
      }
    }

    pitStep(car, dt) {
      const tr = this.track, N = tr.n, pit = car.pit, P = tr.pit;
      const VL = F1.PIT_SPEED;
      if (pit.phase === 'stop') {
        pit.stopT -= dt;
        car.vx = car.vy = 0;
        if (pit.stopT <= 0) {
          car.tyre = car.nextTyre || 'M';
          car.wear = 0;
          car.nextTyre = null;
          car.stops++;
          car.battery = Math.max(car.battery, 0.5);
          // Les ailerons sont changés pendant l'arrêt ; la suspension, elle, ne se répare pas
          car.dmg.fw = 0; car.dmg.rw = 0;
          pit.phase = 'out';
        }
      } else {
        // Freinage jusqu'à la limite de vitesse, arrêt au garage, puis réaccélération
        let target = VL;
        if (pit.phase === 'in') {
          // Bretelle d'entrée plus rapide, limitation à 80 km/h dans la voie, puis arrêt au garage
          const toLimit = Math.max(0, (P.a - 30 - pit.d) * tr.spacing);
          const dist = Math.max(0, (pit.stopD - pit.d) * tr.spacing);
          target = Math.min(Math.sqrt(VL * VL + 2 * 1100 * toLimit), Math.sqrt(2 * 900 * dist) + 4);
          // Sur la bretelle d'entrée : pas plus vite que ce que permet la courbe de la piste
          if (pit.d < P.a - 30) {
            const N = tr.n, ahead = Math.floor(pit.d);
            let lim = 900;
            for (let j = 0; j <= 40; j += 5) lim = Math.min(lim, tr.vp[(((ahead + j) % N) + N) % N]);
            target = Math.min(target, lim);
          }
        }
        // Bretelle de sortie : on reprend de la vitesse, sans dépasser ce que permet le virage suivant
        if (pit.phase === 'out' && pit.d > P.z + 30) {
          const N = tr.n, ahead = Math.floor(pit.d);
          let lim = 600;
          for (let j = 0; j <= 60; j += 5) lim = Math.min(lim, tr.vp[(((ahead + j) % N) + N) % N]);
          target = lim;
        }
        pit.v = pit.v > target ? Math.max(target, pit.v - 1300 * dt) : Math.min(target, pit.v + 500 * dt);
        pit.d += (pit.v * dt) / tr.spacing;
        if (pit.phase === 'in' && pit.d >= pit.stopD - 0.05) {
          pit.d = pit.stopD;
          pit.phase = 'stop';
          pit.stationary = 2.1 + this.rand() * 0.6 + (this.rand() < 0.05 ? 2.5 : 0);
          // Changement de nez : environ 8 s de plus, aileron arrière : 15 s
          pit.repair = (car.dmg.fw > 0.1 ? 8 : 0) + (car.dmg.rw > 0.25 ? 15 : 0);
          pit.stationary += pit.repair;
          pit.stopT = pit.stationary;
          pit.v = 0;
        }
      }
      // Position sur la voie (interpolée entre deux échantillons)
      const di = Math.floor(pit.d), f = pit.d - di;
      const p0 = tr.pts[((di % N) + N) % N], p1 = tr.pts[(((di + 1) % N) + N) % N];
      const l0 = tr.pitLat(di), l1 = tr.pitLat(di + 1);
      const x0 = p0.x + p0.nx * l0, y0 = p0.y + p0.ny * l0, x1 = p1.x + p1.nx * l1, y1 = p1.y + p1.ny * l1;
      car.x = x0 + (x1 - x0) * f;
      car.y = y0 + (y1 - y0) * f;
      car.a = Math.atan2(y1 - y0, x1 - x0);
      car.vx = Math.cos(car.a) * pit.v;
      car.vy = Math.sin(car.a) * pit.v;
      car.steer = 0; car.throttle = pit.phase === 'out' ? 1 : 0; car.brakeIn = 0;
      car.trackUpdate(tr);
      if (pit.d >= P.exit) {
        this.events.push({ type: 'pit', car, stationary: pit.stationary || 0, total: this.time - pit.t0, tyre: car.tyre });
        car.pit = null;
        car.stuck = 0;
      }
    }

    // Aides au pilotage et aéro pour le joueur
    playerAssist(car, raw, dt) {
      const tr = this.track, N = tr.n, A = this.assists;
      const inp = Object.assign({}, raw);
      const speed = car.speed;
      if (A.steer || A.brake) {
        const ai = F1.aiInput(car, tr, this.cars, dt);
        if (A.steer) inp.steer = Math.max(-1, Math.min(1, inp.steer * 0.6 + ai.steer * 0.4));
        if (A.brake) {
          const vt = tr.vp[(car.idx + Math.round((30 + speed * 0.12) / tr.spacing)) % N] * this.cond.ai * 1.03;
          if (speed > vt + 20) { inp.throttle = 0; inp.brake = Math.max(inp.brake, Math.min(1, Math.max(0.3, (speed - vt) / 150))); }
        }
      }
      if (A.tc) {
        inp.stability = true;
        if (car.skid > 90) inp.throttle *= 0.5;
      }
      // Aéro : automatique, manuelle (bouton) ou désactivée
      if (this.aeroMode === 'auto') inp.aero = tr.aeroZone[car.idx] === 1 && inp.brake < 0.1 && Math.abs(inp.steer) < 0.35;
      else if (this.aeroMode === 'manual') inp.aero = !!raw.aero;
      else inp.aero = false;
      return inp;
    }

    updateLaps() {
      for (const car of this.cars) {
        if (car.wrap > car.maxWrap) {
          car.maxWrap = car.wrap;
          if (car.wrap === 0) {
            car.lapStart = this.time;
          } else if (car.wrap >= 1 && !car.finished) {
            const lt = this.time - car.lapStart;
            car.lapTimes.push(lt);
            car.lapStart = this.time;
            if (lt < car.bestLap) car.bestLap = lt;
            if (lt < this.bestLap.time) {
              this.bestLap = { time: lt, car };
              this.events.push({ type: 'fastest', car, time: lt });
            }
            if (car.wrap >= this.laps) {
              car.finished = true;
              car.finishTime = this.time;
              this.finishOrder.push(car);
              car.finishPos = this.finishOrder.length;
              this.events.push({ type: 'finish', car, pos: car.finishPos, time: lt });
            } else {
              this.events.push({ type: 'lap', car, lap: car.wrap + 1, time: lt });
            }
          }
        }
        if (!car.finished) {
          const b = car.wrap * 100000 + Math.floor(car.idx / 5);
          if (!this.splits.has(b)) this.splits.set(b, this.time);
          car.gap = this.time - this.splits.get(b);
        } else {
          car.gap = car.finishTime - this.finishOrder[0].finishTime;
        }
      }
    }

    standings() {
      return this.cars.slice().sort((a, b) => {
        if (a.finished && b.finished) return a.finishPos - b.finishPos;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.progress - a.progress;
      });
    }

    get allFinished() { return this.cars.every((c) => c.finished); }
  }
  F1.Race = Race;
})(typeof window !== 'undefined' ? window : globalThis);
