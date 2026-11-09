'use strict';
// Photos studio des voitures : rendu 3D hors écran du vrai modèle du jeu avec la livrée de l'écurie,
// mis en cache en image (une seule fois par écurie et par version de livrée).
(function () {
  const F1 = window.F1, X = F1.X3D, T = window.THREE;
  const W = 960, H = 540;
  let R = null, scene = null, cam = null, slot = null, broken = false;
  const cache = new Map();
  let queue = Promise.resolve();

  function setup() {
    if (R || broken) return !!R;
    try {
      R = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
      R.setPixelRatio(1);
      R.setSize(W, H, false);
      R.outputColorSpace = T.SRGBColorSpace;
      R.toneMapping = T.ACESFilmicToneMapping;
      R.toneMappingExposure = 1.0;
      R.shadowMap.enabled = true;
      R.shadowMap.type = T.PCFSoftShadowMap;
      scene = new T.Scene();
      scene.background = new T.Color(0x14171d);
      scene.fog = new T.Fog(0x14171d, 140, 320);

      // Studio : sol sombre légèrement brillant, éclairage par panneaux lumineux
      const env = new T.Scene();
      env.background = new T.Color(0x22262e);
      const panel = (x, y, z, w, h, c) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
      };
      panel(0, 60, 0, 120, 40, 0xffffff);
      panel(80, 20, 60, 50, 30, 0xdfe8ff);
      panel(-80, 25, -50, 60, 30, 0xfff1dc);
      const pm = new T.PMREMGenerator(R);
      scene.environment = pm.fromScene(env, 0.04).texture;

      const floor = new T.Mesh(new T.CircleGeometry(400, 64), new T.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.55, metalness: 0.2 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      scene.add(new T.HemisphereLight(0xdfe6f2, 0x202226, 0.9));
      const key = new T.DirectionalLight(0xffffff, 2.4);
      key.position.set(30, 70, 40);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
      key.shadow.bias = -0.0004;
      scene.add(key);
      const rim = new T.DirectionalLight(0xbfd2ff, 1.3);
      rim.position.set(-60, 30, -40);
      scene.add(rim);

      cam = new T.PerspectiveCamera(24, W / H, 1, 1000);
      cam.position.set(58, 22, 52);
      cam.lookAt(-1, 3.5, 0);
      slot = new T.Group();
      scene.add(slot);
      return true;
    } catch (e) {
      broken = true;
      return false;
    }
  }

  function render(team, num) {
    if (!setup()) return null;
    while (slot.children.length) slot.remove(slot.children[0]);
    const car = X.makeCar(team, num || 1, false, 1);
    car.g.children[0].visible = false; // ombre factice du jeu : le studio a de vraies ombres
    car.g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    car.g.rotation.y = 0.12;
    // roues avant légèrement braquées : pose « photo officielle »
    for (const w of car.wheels) if (w.front) w.pivot.rotation.y = 0.22;
    slot.add(car.g);
    R.render(scene, cam);
    return R.domElement.toDataURL('image/jpeg', 0.9);
  }

  F1.CarPhoto = {
    // Promesse d'une URL d'image (null si la 3D est indisponible)
    get(team, num) {
      const key = team.id + team.color + team.color2 + (num || 1) + ':' + (F1.Liveries ? F1.Liveries.version(team.id) : 0);
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      queue = queue.then(() => (F1.Liveries ? F1.Liveries.ready : null)).then(() => new Promise((res) => {
        // une image par image d'affichage pour ne pas figer l'interface
        requestAnimationFrame(() => {
          if (!cache.has(key)) {
            let url = null;
            try { url = render(team, num); } catch (e) { url = null; }
            cache.set(key, url);
          }
          res();
        });
      }));
      return queue.then(() => cache.get(key));
    },
  };
})();
