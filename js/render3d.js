'use strict';
// Rendu 3D (Three.js) : caméras poursuite, embarquée et cockpit.
// Repère : x 2D -> X, y 2D -> Z, hauteur -> Y. 1 unité = 10 cm (comme la simulation).
// Le décor est construit par js/3d/world3d.js, les monoplaces par js/3d/car3d.js.
(function () {
  const F1 = window.F1;
  const T = window.THREE;
  const X = F1.X3D;

  const QUALITY = ['low', 'medium', 'high', 'ultra'];
  const QLABEL = { low: 'Basse', medium: 'Moyenne', high: 'Élevée', ultra: 'Maximale (4K)' };
  const TEXRES = { low: 1024, medium: 1024, high: 2048, ultra: 4096 };

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
    const leds = [];
    [0x3ddc84, 0x3ddc84, 0x3ddc84, 0xffd60a, 0xffd60a, 0xe10600, 0xe10600, 0x3b82f6].forEach((c, k) => {
      const m = new T.MeshBasicMaterial({ color: c });
      const l = new T.Mesh(new T.BoxGeometry(0.42, 0.4, 0.3), m);
      l.position.set(-1.7 + k * 0.48, 2.0, 0.55);
      g.add(l);
      leds.push({ m, c: new T.Color(c) });
    });
    g.userData.leds = leds;
    return g;
  }

  class Renderer3D {
    constructor(container) {
      this.container = container;
      this.ok = !!(T && X && X.buildWorld);
      this.cars = new Map();
      let q = null;
      try { q = localStorage.getItem('paddock-gfx'); } catch (e) { /* ignoré */ }
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      this.quality = QUALITY.includes(q) ? q : coarse ? 'high' : 'ultra';
    }

    get qualityLabel() { return QLABEL[this.quality]; }

    cycleQuality() {
      this.quality = QUALITY[(QUALITY.indexOf(this.quality) + 1) % QUALITY.length];
      try { localStorage.setItem('paddock-gfx', this.quality); } catch (e) { /* ignoré */ }
      if (this.renderer) {
        this.applyQuality();
        if (this.world) { this.dispose(); }
      }
      return this.qualityLabel;
    }

    applyQuality() {
      const r = this.renderer;
      const dpr = window.devicePixelRatio || 1;
      // Maximale : pleine définition de l'écran (Retina), textures 4096 px, ombres 4096 px
      r.setPixelRatio(Math.min(dpr, this.quality === 'ultra' ? 3 : this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1));
      if (X.texRes !== TEXRES[this.quality]) { X.texRes = TEXRES[this.quality]; if (X.resetCarMats) X.resetCarMats(); this.raceRef = null; }
      r.shadowMap.enabled = this.quality !== 'low';
      r.shadowMap.type = T.PCFSoftShadowMap;
      this.resize();
    }

    init() {
      if (this.renderer || !this.ok) return this.ok;
      try {
        const r = (this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true }));
        r.outputColorSpace = T.SRGBColorSpace;
        r.toneMapping = T.ACESFilmicToneMapping;
        r.toneMappingExposure = 0.88;
        r.domElement.id = 'game3d';
        r.domElement.className = 'hidden';
        this.container.insertBefore(r.domElement, this.container.querySelector('#hud'));
        this.pmrem = new T.PMREMGenerator(r);
        this.camera = new T.PerspectiveCamera(70, 1, 0.5, 40000);
        this.wheel = makeSteeringWheel();
        this.wheel.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 10; } });
        this.camera.add(this.wheel);
        this.applyQuality();
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

    setTrack(track, scene2d, weather) {
      weather = weather || 'dry';
      if (this.trackId === track.id && this.world && this.weather === weather) return;
      this.weather = weather;
      if (this.world) this.dispose();
      this.world = X.buildWorld(track, scene2d, this.quality, weather);
      this.rain = null;
      if (weather === 'rain') {
        // Gouttes : segments qui tombent dans une boîte autour de la caméra
        const n = this.quality === 'low' ? 900 : 2200;
        const pos = new Float32Array(n * 6);
        for (let i = 0; i < n; i++) {
          const x = (Math.random() - 0.5) * 400, y = Math.random() * 200, z = (Math.random() - 0.5) * 400;
          pos.set([x, y, z, x + 0.6, y - 9, z], i * 6);
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(pos, 3));
        this.rain = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0.45, fog: false }));
        this.rain.frustumCulled = false;
        this.world.scene.add(this.rain);
      }
      this.scene = this.world.scene;
      this.envRT = this.pmrem.fromEquirectangular(this.world.sky);
      this.scene.environment = this.envRT.texture;
      this.scene.add(this.camera);
      this.fx = makeFx(this.scene);
      this.trackId = track.id;
      this.cars.clear();
      this.raceRef = null;
    }

    dispose() {
      if (!this.world) return;
      this.scene.traverse((o) => {
        if (o.isMesh && o.parent === this.scene && o.geometry) o.geometry.dispose();
      });
      if (this.envRT) this.envRT.dispose();
      this.world = null;
      this.scene = null;
      this.trackId = null;
    }

    syncCars(race) {
      if (this.raceRef === race) return;
      for (const v of this.cars.values()) this.scene.remove(v.g);
      this.cars.clear();
      race.cars.forEach((c, k) => {
        const m = X.makeCar(c.team, c.num || k + 1, c.isPlayer, race.weather === 'rain' ? 3 : (c.num || k) % 3, c.code);
        this.scene.add(m.g);
        this.cars.set(c, m);
      });
      this.raceRef = race;
      this.camInit = false;
      this.camInitH = false;
      // Compile les shaders d'avance pour éviter un à-coup au départ
      try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* facultatif */ }
    }

    draw(race, focus, mode, dt, opts) {
      this.syncCars(race);
      const tr = race.track, N = tr.n;
      const hAt = (i) => tr.h[((i % N) + N) % N] * 10;
      for (const [c, m] of this.cars) {
        const p = tr.pts[c.idx];
        // Hauteur et tangage selon la pente de la piste
        const along = (c.x - p.x) * p.tx + (c.y - p.y) * p.ty;
        m.g.position.set(c.x, hAt(c.idx) + along * tr.slope[c.idx] * 0.1, c.y);
        m.g.rotation.y = -c.a;
        m.g.rotation.x = 0;
        const pitch = Math.atan(tr.slope[c.idx] * Math.cos(c.a - p.ang));
        const fwd = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
        m.spin -= fwd * dt;
        for (const w of m.wheels) {
          w.wh.rotation.z = m.spin / w.r;
          if (w.front) w.pivot.rotation.y = -c.steer * 0.35;
        }
        m.helmet.visible = !(c === focus && mode === 'cockpit');
        if (m.tyre !== c.tyre) { m.tyre = c.tyre; const rm = X.ringMat(c.tyre); for (const r of m.rings) r.material = rm; }
        // Légère prise de roulis/tangage avec les forces
        m.g.rotation.z = pitch + Math.max(-0.02, Math.min(0.02, (c.brakeIn > 0.5 ? 0.012 : c.throttle > 0 ? -0.006 : 0)));
        this.carDamage(c, m, dt);
      }
      this.updateSC(race);
      this.updateFx(race, dt);

      if (this.world.racingLine) this.world.racingLine.visible = !!(race.assists && race.assists.line);

      // Feux du portique de départ
      const lights = opts && opts.lights != null ? opts.lights : 0;
      this.world.gantryLights.forEach((m, k) => { m.emissiveIntensity = k < lights ? 3.0 : 0; });

      // Caméra
      const cam = this.camera;
      const a = focus.a, fx = Math.cos(a), fz = Math.sin(a);
      const sp = Math.min(1, focus.speed / F1.PHYS.maxSpeed);
      const hF = this.cars.get(focus) ? this.cars.get(focus).g.position.y : 0;
      if (this.camH == null || !this.camInitH) { this.camH = hF; this.camInitH = true; }
      this.camH += (hF - this.camH) * Math.min(1, dt * 6);
      const shake = sp > 0.6 ? (Math.random() - 0.5) * 0.12 * sp : 0;
      if (mode === 'chase') {
        if (!this.camInit) { this.yaw = a; this.camInit = true; }
        this.yaw += F1.util.wrapAngle(a - this.yaw) * Math.min(1, dt * 4.5);
        const cx = Math.cos(this.yaw), cz = Math.sin(this.yaw);
        const dist = 70 + sp * 12;
        const back = hAt(focus.idx - Math.round(dist / 10));
        cam.position.set(focus.x - cx * dist, 21 + Math.max(back, this.camH - 30), focus.y - cz * dist);
        cam.lookAt(focus.x + cx * 60, 6 + hAt(focus.idx + 6), focus.y + cz * 60);
        cam.fov = 58 + sp * 10;
      } else {
        this.camInit = false;
        const eye = mode === 'cockpit' ? { b: -1.2, h: 8.1, look: 5.5 } : { b: -5, h: 12.8, look: 4 };
        cam.position.set(focus.x + fx * eye.b, eye.h + shake + hF, focus.y + fz * eye.b);
        // Le regard suit la pente de la route devant la voiture
        const pitch = Math.atan(tr.slope[focus.idx] * Math.cos(focus.a - tr.pts[focus.idx].ang));
        cam.lookAt(focus.x + fx * 300, eye.look + hF + Math.tan(pitch) * 300, focus.y + fz * 300);
        cam.fov = (mode === 'cockpit' ? 70 : 64) + sp * 8;
      }
      cam.updateProjectionMatrix();
      this.world.dome.position.copy(cam.position);

      // L'ombre du soleil suit la voiture suivie
      const sun = this.world.sun;
      sun.target.position.set(focus.x, hF, focus.y);
      sun.position.set(focus.x + 900, hF + 1600, focus.y + 500);

      // Volant (cockpit)
      this.wheel.visible = mode === 'cockpit';
      if (mode === 'cockpit') {
        this.wheel.position.set(0, -6.4, -15);
        this.wheel.rotation.set(-0.35, 0, -focus.steer * 1.5);
        const rpm = (sp * 8) % 1;
        this.wheel.userData.leds.forEach((l, k) => l.m.color.copy(k / 8 < rpm ? l.c : new T.Color(0x1a1a1a)));
      }
      if (this.rain) {
        const a = this.rain.geometry.getAttribute('position');
        const arr = a.array, fall = 950 * dt;
        for (let i = 0; i < arr.length; i += 6) {
          arr[i + 1] -= fall; arr[i + 4] -= fall;
          if (arr[i + 4] < -20) {
            const x = (Math.random() - 0.5) * 400, z = (Math.random() - 0.5) * 400, y = 160 + Math.random() * 40;
            arr[i] = x; arr[i + 1] = y; arr[i + 2] = z; arr[i + 3] = x + 0.6; arr[i + 4] = y - 9; arr[i + 5] = z;
          }
        }
        a.needsUpdate = true;
        this.rain.position.set(cam.position.x, cam.position.y - 100, cam.position.z);
      }
      this.renderer.render(this.scene, cam);
    }
  }

  // ---------- Dégâts visibles, étincelles, fumée, débris, voiture de sécurité ----------
  function makeFx(scene) {
    const NS = 400;
    const sp = new Float32Array(NS * 3).fill(-9999);
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(sp, 3));
    const sparks = new T.Points(sg, new T.PointsMaterial({ color: 0xffb340, size: 0.8, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false;
    scene.add(sparks);
    const smokeTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    })();
    const smokeMat = new T.SpriteMaterial({ map: smokeTex, color: 0x8c8c8c, transparent: true, depthWrite: false, opacity: 0.5 });
    const smoke = [];
    for (let i = 0; i < 70; i++) { const sp2 = new T.Sprite(smokeMat.clone()); sp2.visible = false; scene.add(sp2); smoke.push({ s: sp2, life: 0 }); }
    return { sparks, sp, sv: new Float32Array(NS * 3), sl: new Float32Array(NS), si: 0, smoke, smi: 0, debris: [] };
  }

  Renderer3D.prototype.carDamage = function (c, m, dt) {
    const D = c.dmg;
    if (!D || !m.fw) return;
    // Aileron avant : plie vers le sol, puis se détache s'il est détruit
    if (D.fw >= 0.9 && !m.fwGone) { m.fwGone = true; this.detach(m, m.fw, c); }
    if (D.fw < 0.9 && m.fwGone) { m.fwGone = false; m.fw.visible = true; }
    m.fw.rotation.z = -D.fw * 0.3;
    m.fw.rotation.x = (c.dmgSide || 1) * D.fw * 0.12;
    if (D.rw >= 0.9 && !m.rwGone) { m.rwGone = true; this.detach(m, m.rw, c); }
    if (D.rw < 0.9 && m.rwGone) { m.rwGone = false; m.rw.visible = true; }
    m.rw.rotation.x = (c.dmgSide || 1) * D.rw * 0.25;
    // Volet de l'aéro active : s'ouvre en ligne droite
    const open = c.aeroOpen && !m.rwGone ? 0.75 : 0;
    m.flap.rotation.z += (open - m.flap.rotation.z) * Math.min(1, dt * 10);
    // Suspension cassée : roues du côté touché de travers
    for (const w of m.wheels) {
      const side = Math.sign(w.pivot.position.z);
      w.pivot.rotation.x = side === (c.dmgSide || 0) ? side * D.sus * 0.35 : 0;
    }
    // Fumée : suspension très abîmée ou voiture arrêtée après un accident
    if ((D.sus >= 0.5 || c.out) && Math.random() < (c.out ? 0.5 : 0.25)) this.puff(m.g.position.x, m.g.position.y + 3, m.g.position.z);
  };

  Renderer3D.prototype.detach = function (m, part, c) {
    if (!this.fx) return;
    const piece = part.clone();
    part.updateWorldMatrix(true, false);
    part.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
    this.scene.add(piece);
    part.visible = false;
    const sp = c.speed * 0.6;
    this.fx.debris.push({ o: piece, vx: Math.cos(c.a) * sp + (Math.random() - 0.5) * 80, vz: Math.sin(c.a) * sp + (Math.random() - 0.5) * 80, vy: 60 + Math.random() * 40, spin: (Math.random() - 0.5) * 12, life: 25 });
    for (let k = 0; k < 6; k++) this.puff(piece.position.x, piece.position.y, piece.position.z);
  };

  Renderer3D.prototype.puff = function (x, y, z) {
    const F = this.fx;
    const p = F.smoke[F.smi++ % F.smoke.length];
    p.s.visible = true; p.life = 2.2; p.s.position.set(x + (Math.random() - 0.5) * 3, y, z + (Math.random() - 0.5) * 3);
    p.s.scale.set(4, 4, 4);
  };

  Renderer3D.prototype.updateFx = function (race, dt) {
    const F = this.fx;
    if (!F) return;
    const tr = race.track, N = tr.n;
    const hAt = (x, y) => { const i = tr.nearest(x, y, -1); return tr.h ? tr.h[i] * 10 : 0; };
    // Nouvelles étincelles
    while (race.sparks && race.sparks.length) {
      const s0 = race.sparks.shift();
      const n = Math.min(40, 8 + s0.power / 12), y = hAt(s0.x, s0.y) + 1.5;
      for (let k = 0; k < n; k++) {
        const i = F.si++ % F.sl.length;
        F.sp[i * 3] = s0.x; F.sp[i * 3 + 1] = y; F.sp[i * 3 + 2] = s0.y;
        F.sv[i * 3] = (Math.random() - 0.5) * 220; F.sv[i * 3 + 1] = 30 + Math.random() * 90; F.sv[i * 3 + 2] = (Math.random() - 0.5) * 220;
        F.sl[i] = 0.3 + Math.random() * 0.4;
      }
    }
    for (let i = 0; i < F.sl.length; i++) {
      if (F.sl[i] <= 0) continue;
      F.sl[i] -= dt;
      if (F.sl[i] <= 0) { F.sp[i * 3 + 1] = -9999; continue; }
      F.sv[i * 3 + 1] -= 300 * dt;
      F.sp[i * 3] += F.sv[i * 3] * dt; F.sp[i * 3 + 1] += F.sv[i * 3 + 1] * dt; F.sp[i * 3 + 2] += F.sv[i * 3 + 2] * dt;
    }
    F.sparks.geometry.getAttribute('position').needsUpdate = true;
    for (const p of F.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.s.position.y += 6 * dt;
      const k = 4 + (2.2 - p.life) * 9;
      p.s.scale.set(k, k, k);
      p.s.material.opacity = Math.max(0, p.life / 2.2) * 0.45;
      if (p.life <= 0) p.s.visible = false;
    }
    // Débris : retombent, rebondissent puis restent au bord
    for (const d of F.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const g = hAt(d.o.position.x, d.o.position.z) + 0.4;
      if (d.o.position.y > g || d.vy > 0) {
        d.vy -= 98 * dt;
        d.o.position.x += d.vx * dt; d.o.position.y += d.vy * dt; d.o.position.z += d.vz * dt;
        d.o.rotation.y += d.spin * dt; d.o.rotation.x += d.spin * 0.5 * dt;
        if (d.o.position.y < g) { d.o.position.y = g; d.vy = -d.vy * 0.3; d.vx *= 0.6; d.vz *= 0.6; d.spin *= 0.5; if (Math.abs(d.vy) < 8) d.vy = 0; }
      }
      if (d.life <= 0) this.scene.remove(d.o);
    }
    F.debris = F.debris.filter((d) => d.life > 0);
  };

  // Voiture de sécurité : coupé argent avec rampe de gyrophares orange
  Renderer3D.prototype.updateSC = function (race) {
    const sc = race.sc;
    if (!sc) { if (this.scCar) this.scCar.visible = false; return; }
    if (!this.scCar || this.scCar.parent !== this.scene) {
      const g = new T.Group();
      const body = new T.MeshPhysicalMaterial({ color: 0xbfc4ca, metalness: 0.7, roughness: 0.3, clearcoat: 1 });
      const dark = new T.MeshStandardMaterial({ color: 0x15171a, roughness: 0.2, metalness: 0.5 });
      const b1 = new T.Mesh(new T.BoxGeometry(46, 6, 19), body); b1.position.y = 5; g.add(b1);
      const b2 = new T.Mesh(new T.BoxGeometry(20, 5, 16), dark); b2.position.set(-4, 10, 0); g.add(b2);
      const b3 = new T.Mesh(new T.BoxGeometry(14, 1.2, 14), body); b3.position.set(-5, 13, 0); g.add(b3);
      this.scLights = [];
      for (const z of [-4, -1.3, 1.3, 4]) {
        const l = new T.Mesh(new T.BoxGeometry(2, 1, 2.4), new T.MeshStandardMaterial({ color: 0x552200, emissive: 0xff8a00, emissiveIntensity: 0 }));
        l.position.set(-5, 14, z); g.add(l); this.scLights.push(l.material);
      }
      const tyre = new T.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
      for (const [x, z] of [[14, 8.5], [14, -8.5], [-15, 8.5], [-15, -8.5]]) {
        const w = new T.Mesh(new T.CylinderGeometry(3.4, 3.4, 2.6, 20), tyre); w.rotation.x = Math.PI / 2; w.position.set(x, 3.4, z); g.add(w);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(g);
      this.scCar = g;
    }
    const g = this.scCar, tr = race.track;
    g.visible = true;
    g.position.set(sc.x, tr.h ? tr.h[sc.idx] * 10 : 0, sc.y);
    g.rotation.y = -sc.a;
    const ph = Math.floor(performance.now() / 120) % 2;
    this.scLights.forEach((m, k) => { m.emissiveIntensity = (k % 2) === ph ? 3 : 0.2; });
  };

  F1.Renderer3D = Renderer3D;
})();
