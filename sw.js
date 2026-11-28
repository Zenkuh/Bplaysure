/* Version web : réseau d'abord (toujours la dernière version), cache en secours hors ligne */
const C = "bplaysure-web-2";
const FILES = ["index.html","manifest.webmanifest","icon.svg","common.css","common.js","outdoor.js","partner.js","game.js","update.js","face.js","geomap.js","deckcards.js","remote-apps.js"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request)));
});
