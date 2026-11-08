'use strict';
// Cœur de la simulation : circuit, physique des voitures, pilotes IA.
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
  F1.util = { clamp, wrapAngle, rng };

  // ---------- Physique ----------
  const PHYS = {
    maxSpeed: 950, // px/s (≈ 342 km/h)
    accel: 600,
    brake: 1300,
    reverseMax: 220,
    steerRate: 2.7, // rad/s
    grip: 9,
    drag: 0.05,
    offTrackMax: 0.42, // fraction de la vitesse max hors piste
    runoff: 95, // largeur du dégagement avant le mur
    radius: 19, // rayon de collision
  };
  F1.PHYS = PHYS;
  F1.KMH = 0.36; // conversion px/s -> km/h

  // ---------- Circuit ----------
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
  }

  class Track {
    constructor(def) {
      this.def = def;
      this.name = def.name;
      this.width = def.width || 120;
      this.half = this.width / 2;
      this.spacing = 10;
      const S = def.scale || 100;
      const ctrl = def.points.map((p) => ({ x: p[0] * S, y: p[1] * S }));
      const n = ctrl.length;

      // Échantillonnage dense de la spline
      const dense = [];
      for (let i = 0; i < n; i++) {
        const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
        for (let k = 0; k < 60; k++) dense.push(catmull(p0, p1, p2, p3, k / 60));
      }

      // Rééchantillonnage à pas constant
      const sp = this.spacing;
      const pts = [{ x: dense[0].x, y: dense[0].y }];
      let prev = dense[0], carry = 0;
      for (let i = 1; i <= dense.length; i++) {
        const cur = dense[i % dense.length];
        let start = prev;
        let seg = Math.hypot(cur.x - start.x, cur.y - start.y);
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
      const N = (this.n = pts.length);
      this.length = N * sp;

      // Tangentes, normales
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
        // vitesse max de passage en courbe compte tenu du taux de braquage
        let kmax = 0;
        for (let j = -6; j <= 6; j++) kmax = Math.max(kmax, Math.abs(this.k[(i + j + N) % N]));
        const v = (PHYS.steerRate * 0.9) / (kmax + kSteer);
        vc[i] = Math.min(PHYS.maxSpeed, v);
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

      // Boîte englobante
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      this.bounds = { minX, minY, maxX, maxY };
    }

    // Index du point de la ligne médiane le plus proche
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

    distTo(x, y) {
      const i = this.nearest(x, y, -1);
      return Math.hypot(this.pts[i].x - x, this.pts[i].y - y);
    }

    // Position sur la piste à une distance s (px) de la ligne, décalée latéralement
    posAt(s, lat) {
      const N = this.n;
      const i = ((Math.round(s / this.spacing) % N) + N) % N;
      const p = this.pts[i];
      return { x: p.x + p.nx * lat, y: p.y + p.ny * lat, a: p.ang, idx: i };
    }
  }
  F1.Track = Track;

  // ---------- Voiture ----------
  class Car {
    constructor(o) {
      Object.assign(this, {
        name: 'Pilote', team: null, isPlayer: false, skill: 1, power: 1,
        x: 0, y: 0, a: 0, vx: 0, vy: 0, steer: 0,
        idx: 0, wrap: -1, maxWrap: -1, lat: 0,
        lapStart: 0, lapTimes: [], bestLap: Infinity,
        finished: false, finishTime: 0, finishPos: 0,
        offTrack: false, skid: 0, wallHit: 0,
        lane: 0, lanePref: 0, stuck: 0, wrongWay: 0,
        throttle: 0, brakeIn: 0,
      }, o);
    }

    get speed() { return Math.hypot(this.vx, this.vy); }
    get progress() { return this.wrap * 100000 + this.idx; }

    placeOnGrid(track, s, lat) {
      const p = track.posAt(s, lat);
      this.x = p.x; this.y = p.y; this.a = p.a;
      this.vx = this.vy = 0;
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
      // Braquage progressif
      this.steer += (inp.steer - this.steer) * Math.min(1, dt * 10);
      this.throttle = inp.throttle;
      this.brakeIn = inp.brake;

      // Rotation du châssis
      let fx = Math.cos(this.a), fy = Math.sin(this.a);
      let vF = this.vx * fx + this.vy * fy;
      const absF = Math.abs(vF);
      const low = Math.min(1, absF / 160);
      const high = 1 - 0.42 * Math.min(1, absF / P.maxSpeed);
      this.a += this.steer * P.steerRate * low * high * Math.sign(vF) * (this.offTrack ? 0.8 : 1) * dt;
      this.a = wrapAngle(this.a);

      // Décomposition de la vitesse dans le nouveau repère
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
      // Résistances
      vF -= vF * P.drag * dt;
      if (inp.throttle <= 0 && inp.brake <= 0) {
        const roll = 60 * dt;
        vF = Math.abs(vF) < roll ? 0 : vF - Math.sign(vF) * roll;
      }
      if (this.offTrack && Math.abs(vF) > maxS) vF -= (vF - Math.sign(vF) * maxS) * 2.2 * dt;

      // Adhérence latérale
      this.skid = Math.abs(vR);
      vR *= Math.exp(-P.grip * (this.offTrack ? 0.55 : 1) * dt);

      this.vx = fx * vF + rx * vR;
      this.vy = fy * vF + ry * vR;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      this.trackUpdate(track);
      return vF;
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

      // Mur de pneus
      const lim = track.half + PHYS.runoff;
      if (ad > lim) {
        const s = Math.sign(this.lat);
        this.x -= p.nx * (ad - lim) * s;
        this.y -= p.ny * (ad - lim) * s;
        const vn = this.vx * p.nx + this.vy * p.ny;
        if (vn * s > 0) {
          this.wallHit = Math.abs(vn);
          this.vx -= p.nx * vn * 1.35;
          this.vy -= p.ny * vn * 1.35;
          this.vx *= 0.75;
          this.vy *= 0.75;
        }
      }
      // Sens de circulation
      const along = this.vx * p.tx + this.vy * p.ty;
      this.alongTrack = along;
    }
  }
  F1.Car = Car;

  // Collisions entre voitures (cercles)
  F1.collide = function (cars) {
    const r2 = PHYS.radius * 2;
    const hits = [];
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 * r2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const pen = (r2 - d) / 2;
        a.x -= nx * pen; a.y -= ny * pen;
        b.x += nx * pen; b.y += ny * pen;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.65; // échange d'impulsion amorti
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

    // Trajectoire : se placer à l'intérieur des virages
    const kAhead = track.k[(car.idx + Math.round((90 + speed * 0.55) / sp)) % N];
    let target = clamp(kAhead * 900, -1, 1) * track.half * 0.5 + car.lanePref;

    // Évitement des voitures devant
    let lift = false;
    for (const o of cars) {
      if (o === car) continue;
      const dx = o.x - car.x, dy = o.y - car.y;
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

    // Direction
    const look = Math.round((50 + speed * 0.26) / sp);
    const tp = track.pts[(car.idx + look) % N];
    const tx = tp.x + tp.nx * car.lane, ty = tp.y + tp.ny * car.lane;
    const err = wrapAngle(Math.atan2(ty - car.y, tx - car.x) - car.a);
    const steer = clamp(err * 3.2, -1, 1);

    // Vitesse cible
    const vt = track.vp[(car.idx + Math.round((20 + speed * 0.1) / sp)) % N] * car.skill;
    let throttle = 0, brake = 0;
    if (speed < vt - 5 && !lift) throttle = 1;
    else if (speed > vt + 25) brake = clamp((speed - vt) / 160, 0.2, 1);
    if (Math.abs(err) > 1.2 && speed > 200) { throttle = 0; brake = 0.5; }
    return { steer, throttle, brake };
  };

  // ---------- Course ----------
  class Race {
    constructor({ trackDef, laps, difficulty, playerTeam, playerName, seed }) {
      const diff = F1.DIFFICULTIES[difficulty] || F1.DIFFICULTIES.normal;
      this.track = new Track(trackDef);
      this.laps = laps;
      this.time = 0; // temps depuis le départ
      this.started = false;
      this.cars = [];
      this.events = []; // évènements pour l'interface (meilleur tour, arrivée…)
      this.finishOrder = [];
      this.splits = new Map();
      this.bestLap = { time: Infinity, car: null };
      const rand = rng(seed || Date.now());

      const teams = F1.TEAMS.slice();
      const pIdx = playerTeam ? teams.findIndex((t) => t.id === playerTeam) : -1;
      const pTeam = pIdx >= 0 ? teams.splice(pIdx, 1)[0] : null;
      const drivers = F1.DRIVERS.slice();
      const playerGrid = pTeam ? 5 : -1; // le joueur part 6e
      let ai = 0;
      const total = 8;
      for (let g = 0; g < total; g++) {
        let car;
        if (g === playerGrid) {
          car = new Car({ name: playerName || 'Vous', team: pTeam, isPlayer: true });
        } else {
          const team = teams[ai % teams.length];
          car = new Car({
            name: drivers[ai % drivers.length],
            team,
            skill: diff.skill * (0.975 + rand() * 0.05) * (1 - g * 0.004),
            power: diff.power * (0.985 + rand() * 0.03),
            lanePref: (rand() - 0.5) * 24,
          });
          ai++;
        }
        car.grid = g + 1;
        car.placeOnGrid(this.track, -70 - g * 62, g % 2 === 0 ? -26 : 26);
        this.cars.push(car);
      }
      this.player = this.cars.find((c) => c.isPlayer) || null;
    }

    step(dt, playerInput) {
      const tr = this.track;
      if (this.started) this.time += dt;
      for (const car of this.cars) {
        let inp;
        if (!this.started) inp = { steer: 0, throttle: 0, brake: 1 };
        else if (car.isPlayer && !car.finished && playerInput) inp = playerInput;
        else inp = F1.aiInput(car, tr, this.cars, dt);
        car.update(dt, inp, tr);

        if (!this.started) continue;
        // Voiture bloquée : on la replace sur la piste (IA uniquement)
        if (!car.isPlayer || car.finished) {
          if (car.speed < 40) car.stuck += dt; else car.stuck = 0;
          if (car.stuck > 2.5) car.resetOnTrack(tr);
        }
        // Mauvais sens
        car.wrongWay = car.alongTrack < -60 ? car.wrongWay + dt : 0;
      }
      this.hits = F1.collide(this.cars);
      for (const car of this.cars) car.trackUpdate(tr);
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
              this.events.push({ type: 'finish', car, pos: car.finishPos });
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
