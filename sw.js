'use strict';
// Service worker : permet de jouer hors ligne une fois l'application installée.
// Changer VERSION à chaque mise à jour pour forcer le rechargement des fichiers.
const VERSION = 'paddock-v20';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/data/circuits.js',
  './js/data/season2026.js',
  './js/data/elevation.js',
  './js/core.js',
  './js/settings.js',
  './js/career.js',
  './js/render.js',
  './js/liveries.js',
  './js/portraits.js',
  './js/vendor/three.min.js',
  './js/3d/tex3d.js',
  './js/3d/car3d.js',
  './js/3d/world3d.js',
  './js/render3d.js',
  './js/3d/photo3d.js',
  './js/audio.js',
  './js/session.js',
  './js/ui.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache d'abord (rapide et hors ligne), puis mise à jour en arrière-plan
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req, { ignoreSearch: sameOrigin }).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});
