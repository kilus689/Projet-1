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
    maxSpeed: 950, // px/s (≈ 342 km/h)
    accel: 600,
    brake: 1350,
    reverseMax: 220,
    steerRate: 2.7, // rad/s
    grip: 9,
    drag: 0.05,
    offTrackMax: 0.42,
    radius: 19,
  };
  F1.PHYS = PHYS;
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

      // Profil de vitesse théorique (utilisé par l'IA)
      const vc = new Float32Array(N);
      const kSteer = (0.42 * PHYS.steerRate) / PHYS.maxSpeed;
      for (let i = 0; i < N; i++) {
        let kmax = 0;
        for (let j = -6; j <= 6; j++) kmax = Math.max(kmax, Math.abs(this.k[(i + j + N) % N]));
        vc[i] = Math.min(PHYS.maxSpeed, (PHYS.steerRate * 0.9) / (kmax + kSteer));
      }
      const vp = new Float32Array(vc);
      const b = PHYS.brake * 0.75;
      for (let pass = 0; pass < 3; pass++) {
        for (let i = N - 1; i >= 0; i--) {
          const nxt = vp[(i + 1) % N];
          vp[i] = Math.min(vc[i], Math.sqrt(nxt * nxt + 2 * b * sp));
        }
      }
      this.vp = vp;

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
    }

    cellKey(cx, cy) { return cx * 65536 + cy; }

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
      trackCache.set(gp.id, new Track(Object.assign({ poly: F1.SHAPES[gp.id], name: gp.circuit }, gp)));
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

    update(dt, inp, track) {
      const P = PHYS;
      this.steer += (inp.steer - this.steer) * Math.min(1, dt * 10);
      this.throttle = inp.throttle;
      this.brakeIn = inp.brake;

      let fx = Math.cos(this.a), fy = Math.sin(this.a);
      let vF = this.vx * fx + this.vy * fy;
      const absF = Math.abs(vF);
      const low = Math.min(1, absF / 160);
      const high = 1 - 0.42 * Math.min(1, absF / P.maxSpeed);
      this.a += this.steer * P.steerRate * low * high * Math.sign(vF) * (this.offTrack ? 0.8 : 1) * dt;
      this.a = wrapAngle(this.a);

      fx = Math.cos(this.a); fy = Math.sin(this.a);
      const rx = -fy, ry = fx;
      vF = this.vx * fx + this.vy * fy;
      let vR = this.vx * rx + this.vy * ry;

      const maxS = P.maxSpeed * this.power * (this.offTrack ? P.offTrackMax : 1);
      if (inp.throttle > 0 && vF > -10) {
        const r = Math.max(0, vF / maxS);
        vF += P.accel * this.power * inp.throttle * Math.max(0, 1 - Math.pow(r, 1.7)) * dt;
      }
      if (inp.brake > 0) {
        if (vF > 5) vF = Math.max(0, vF - P.brake * inp.brake * dt);
        else vF = Math.max(-P.reverseMax, vF - P.accel * 0.45 * inp.brake * dt);
      }
      vF -= vF * P.drag * dt;
      if (inp.throttle <= 0 && inp.brake <= 0) {
        const roll = 60 * dt;
        vF = Math.abs(vF) < roll ? 0 : vF - Math.sign(vF) * roll;
      }
      if (this.offTrack && Math.abs(vF) > maxS) vF -= (vF - Math.sign(vF) * maxS) * 2.2 * dt;

      this.skid = Math.abs(vR);
      vR *= Math.exp(-P.grip * (this.offTrack ? 0.55 : 1) * dt);

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

      // Mur / barrière
      const lim = track.half + track.runoff;
      if (ad > lim) {
        const s = Math.sign(this.lat);
        this.x -= p.nx * (ad - lim) * s;
        this.y -= p.ny * (ad - lim) * s;
        const vn = this.vx * p.nx + this.vy * p.ny;
        if (vn * s > 0) {
          this.wallHit = Math.max(this.wallHit, Math.abs(vn));
          this.vx -= p.nx * vn * 1.35;
          this.vy -= p.ny * vn * 1.35;
          this.vx *= 0.75;
          this.vy *= 0.75;
        }
      }
      this.alongTrack = this.vx * p.tx + this.vy * p.ty;
    }
  }
  F1.Car = Car;

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

    const vt = track.vp[(car.idx + Math.round((20 + speed * 0.1) / sp)) % N] * car.skill;
    let throttle = 0, brake = 0;
    if (speed < vt - 5 && !lift) throttle = 1;
    else if (speed > vt + 25) brake = clamp((speed - vt) / 160, 0.2, 1);
    if (Math.abs(err) > 1.2 && speed > 200) { throttle = 0; brake = 0.5; }
    return { steer, throttle, brake };
  };

  // Temps au tour de référence (IA parfaite, voiture au maximum) — mis en cache
  const refCache = new Map();
  F1.refLapTime = function (track) {
    if (refCache.has(track.id)) return refCache.get(track.id);
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
    refCache.set(track.id, res);
    return res;
  };

  // ---------- Course / qualification jouée ----------
  // entries : [{ id, name, code, num, team, isPlayer, skill, power }] dans l'ordre de la grille
  class Race {
    constructor({ track, entries, laps, mode }) {
      this.track = track;
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

      entries.forEach((e, g) => {
        const car = new Car(Object.assign({ lanePref: (rand() - 0.5) * 24 }, e));
        car.grid = g + 1;
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
        if (car.isPlayer && !car.finished && playerInput) inp = playerInput;
        else inp = F1.aiInput(car, tr, this.cars, dt);
        car.update(dt, inp, tr);
        if (!car.isPlayer || car.finished) {
          if (car.speed < 40) car.stuck += dt; else car.stuck = 0;
          if (car.stuck > 2.5) car.resetOnTrack(tr);
        }
        car.wrongWay = car.alongTrack < -60 ? car.wrongWay + dt : 0;
      }
      this.hits = this.cars.length > 1 ? F1.collide(this.cars) : [];
      if (this.hits.length) for (const car of this.cars) car.trackUpdate(tr);
      if (this.started) this.updateLaps();
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
