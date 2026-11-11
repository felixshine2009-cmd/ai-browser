const CACHE = 'aib-web-v2.4.0';
const PY_CACHE = 'aib-pyodide-v314.0.7';
const PYPI_CACHE = 'aib-pypi-v1';
const SHELL = ['./','./index.html','./css/app.css','./js/app.js','./js/i18n.js','./js/settings.js','./js/chat.js','./js/api.js','./js/kb.js','./js/panels.js','./js/desktop-disabled.js','./js/local-model.js','./js/shard-cache.js','./js/confirm.js','./js/embed.js','./js/agent-tools.js','./js/vkeyboard.js','./js/v36.js','./js/model-catalog.js','./js/model-picker.js','./js/models-web.js','./js/fzstd.js','./js/zim-reader.js','./js/zim-web.js','./js/runpanel.js','./js/python.js','./js/python-worker.js','./js/compute-tools.js','./js/linux-vm.js','./js/py-settings.js','./panels-ggb.html','./panels-phys.html','./physics/sim.js','./physics/modules.js','./physics/rigid.js','./physics/elements.js','./physics/elements-types.js','./physics/editor.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('aib-web-') && k !== CACHE) || (k.startsWith('aib-pyodide-') && k !== PY_CACHE)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Python runtime (Pyodide core + packages) and PyPI wheels: cache-first so Python works offline after first use.
  if ((u.hostname === 'cdn.jsdelivr.net' && u.pathname.startsWith('/pyodide/')) || u.hostname === 'files.pythonhosted.org') {
    const name = u.hostname === 'files.pythonhosted.org' ? PYPI_CACHE : PY_CACHE;
    e.respondWith(caches.open(name).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (u.hostname === 'pypi.org' && u.pathname.startsWith('/pypi/')) {
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(PYPI_CACHE).then(c => c.put(e.request, copy)); } return res; }).catch(() => caches.open(PYPI_CACHE).then(c => c.match(e.request)).then(r => r || Response.error())));
    return;
  }
  if (u.origin === location.origin) {
    // The bundled Linux VM image (iPad) is already local; do not duplicate it in Cache Storage.
    if (u.pathname.includes('/vm/')) return;
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match('./index.html'))));
  }
});
