'use strict';
// Livrées personnalisées : images importées par le joueur, stockées uniquement sur son appareil
// (IndexedDB), jamais envoyées ni publiées. Elles doivent suivre le gabarit du modèle du jeu.
(function () {
  const F1 = window.F1;
  const DB = 'paddock-liveries', STORE = 'img';
  const imgs = new Map(), versions = new Map();

  function open() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB indisponible'));
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  function tx(mode, fn) {
    return open().then((db) => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    }));
  }
  function decode(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
      im.src = url;
    });
  }
  function bump(id) { versions.set(id, (versions.get(id) || 0) + 1); }

  F1.Liveries = {
    get(id) { return imgs.get(id) || null; },
    has(id) { return imgs.has(id); },
    version(id) { return versions.get(id) || 0; },
    // Charge toutes les livrées enregistrées au démarrage
    async load() {
      try {
        const keys = await tx('readonly', (s) => s.getAllKeys());
        for (const k of keys || []) {
          const blob = await tx('readonly', (s) => s.get(k));
          if (blob) { imgs.set(k, await decode(blob)); bump(k); }
        }
      } catch (e) { /* stockage indisponible : on garde les livrées du jeu */ }
    },
    async set(id, file) {
      const im = await decode(file);
      imgs.set(id, im);
      bump(id);
      try { await tx('readwrite', (s) => s.put(file, id)); } catch (e) { /* gardée pour la session */ }
    },
    async remove(id) {
      imgs.delete(id);
      bump(id);
      try { await tx('readwrite', (s) => s.delete(id)); } catch (e) { /* ignoré */ }
    },
    // Gabarit 4096 × 3072 : découpage exact de la carrosserie du modèle du jeu
    template() {
      const W = 4096, B = 1024, c = document.createElement('canvas');
      c.width = W; c.height = B * 3;
      const g = c.getContext('2d');
      const names = ['COQUE + NEZ', 'CAPOT MOTEUR', 'PONTONS (les deux côtés)'];
      const ends = [['pointe du nez', 'arrière du cockpit'], ["prise d'air", 'arrière'], ["entrée d'air", 'arrière']];
      for (let k = 0; k < 3; k++) {
        const y0 = B * (2 - k);
        g.fillStyle = ['#2b3a55', '#3b2b55', '#2b5540'][k];
        g.fillRect(0, y0, W, B);
        const rows = [[0, 'DESSOUS'], [0.25, 'FLANC DROIT'], [0.5, 'DESSUS'], [0.75, 'FLANC GAUCHE'], [1, 'DESSOUS']];
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 6;
        g.font = 'bold 56px sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.85)';
        for (const [v, label] of rows) {
          const y = y0 + B * (1 - v);
          g.setLineDash([30, 20]);
          g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
          g.setLineDash([]);
          g.fillText(label, 40, Math.min(y0 + B - 20, Math.max(y0 + 70, y - 14)));
        }
        g.font = 'bold 110px sans-serif';
        g.fillStyle = '#ffffff';
        g.fillText(names[k], W * 0.32, y0 + B * 0.42);
        g.font = 'bold 60px sans-serif';
        g.fillText(`← ${ends[k][0]}`, 40, y0 + B * 0.6);
        g.textAlign = 'right';
        g.fillText(`${ends[k][1]} →`, W - 40, y0 + B * 0.6);
        g.textAlign = 'left';
        g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(5, y0 + 5, W - 10, B - 10);
      }
      return c;
    },
  };
  F1.Liveries.ready = F1.Liveries.load();
})();
