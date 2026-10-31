const CACHE = 'aib-web-v1.0.1';
const SHELL = ['./','./index.html','./css/app.css','./js/app.js','./js/i18n.js','./js/settings.js','./js/chat.js','./js/api.js','./js/kb.js','./js/panels.js','./js/desktop-disabled.js','./panels-ggb.html','./panels-phys.html','./physics/sim.js','./physics/modules.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match('./index.html'))));
  }
});
