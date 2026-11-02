// Keeps the page's own files so it opens without a connection. The network is tried first, so a new version of the
// page shows up as soon as there is one; the saved copy is only used when the network is not there.
// Sending a link never goes through here (it is a POST to another server).
const CACHE = 'opnduck-send-v3'
const FILES = ['./', 'index.html', 'app.js', 'envelope.mjs', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.svg', 'pixels.svg', 'jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-700-normal.woff2']

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())))
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put(e.request, copy))
        }
        return res
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  )
})
