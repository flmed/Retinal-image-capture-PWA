const CACHE_NAME = 'retina-capture-v1';
const urlsToCache = [
  '/', // Root path
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  // Placeholder assets needed for PWA install (assuming these exist)
  'placeholder-icon-192.png',
  'placeholder-icon-512.png',
];

// Install event: Caches static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install event: Caching assets.');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('Failed to cache assets during install:', err);
      })
  );
});

// Activate event: Cleans up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate event: Cleaning up old caches.');
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event: Serves content from cache first (Cache-First Strategy)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        // No cache match - fetch from network
        return fetch(event.request);
      })
      .catch((error) => {
        // This catch is for when fetch() fails (i.e., network is unavailable)
        console.error('Fetching failed:', error);
      })
  );
});
