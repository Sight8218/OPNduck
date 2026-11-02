// Keeps the page's own files so it opens without a connection. Sending still needs the network (and never goes through here).
const CACHE = 'opnduck-send-v1'
const FILES = ['./', 'index.html', 'app.js', 'envelope.mjs', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())))
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return // links are sent with POST to other servers: leave them alone
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request)))
})
