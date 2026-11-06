// Lets the web app load when your server is out of reach. Your data is saved by the app itself,
// so this only stores the app's own files, and never anything from the API.
const CACHE = 'os-app-v1';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  event.respondWith((async () => {
    try {
      // The newest version wins whenever the server answers in time.
      const response = await Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
      ]);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    } catch {
      const saved = await caches.match(request);
      if (saved) return saved;
      if (request.mode === 'navigate') {
        const page = await caches.match('/');
        if (page) return page;
      }
      return Response.error();
    }
  })());
});
