/* GOVfind Service Worker (generiert, siehe vite.config.ts). Offline-Hülle + Datenkacheln.
   Karten-Kacheln (fremde Domain) werden NICHT gecacht (Nutzungsbedingungen des Anbieters, [prüfen]). */
const VERSION = '__VERSION__';
const SHELL = 'gf-shell-' + VERSION;
const DATA = 'gf-data';
const PRECACHE = __PRECACHE__;
const MATCH = { ignoreVary: true }; // Hoster senden teils 'Vary: Origin'
const scope = self.registration.scope;
const url = (p) => new URL(p, scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(PRECACHE.map((p) => c.add(new Request(url(p), { cache: 'reload' })).catch(() => undefined)));
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gf-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, MATCH)) || (fallbackUrl && (await caches.match(url(fallbackUrl), MATCH))) || Response.error();
  }
}
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, MATCH);
  const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => undefined);
  return hit || (await net) || Response.error();
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL, './')); return; }
  const rel = u.href.slice(scope.length);
  if (rel === 'data/index.json' || rel === 'data/places-meta.json') { e.respondWith(networkFirst(req, DATA)); return; }
  if (rel.startsWith('data/c/') || rel === 'data/gazetteer.json') { e.respondWith(staleWhileRevalidate(req, DATA)); return; }
  if (rel.startsWith('assets/')) { e.respondWith(caches.match(req, MATCH).then((h) => h || fetch(req).then((res) => { if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone())); return res; }))); return; }
  e.respondWith(staleWhileRevalidate(req, SHELL));
});
