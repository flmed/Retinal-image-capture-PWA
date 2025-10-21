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
  // Caching models
  // Object detection
  'models/objectDetection/model.json',
  'models/objectDetection/group1-shard1of5.bin',
  'models/objectDetection/group1-shard2of5.bin',
  'models/objectDetection/group1-shard3of5.bin',
  'models/objectDetection/group1-shard4of5.bin',
  'models/objectDetection/group1-shard5of5.bin',

  //Classification light
  'models/classificationLight/model.json',
  'models/classificationLight/group1-shard1of3.bin',
  'models/classificationLight/group1-shard2of3.bin',
  'models/classificationLight/group1-shard3of3.bin',

  //MobileNet
  'models/mobileNet/model.json',
  'models/mobileNet/group1-shard1of7.bin',
  'models/mobileNet/group1-shard2of7.bin',
  'models/mobileNet/group1-shard3of7.bin',
  'models/mobileNet/group1-shard4of7.bin',
  'models/mobileNet/group1-shard5of7.bin',
  'models/mobileNet/group1-shard6of7.bin',
  'models/mobileNet/group1-shard7of7.bin',
];

// Install event: Caches static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install event: Caching assets.');
  self.skipWaiting();
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
  event.waitUntil(clients.claim());
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
  // Special handling for navigation requests (page loads)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then((cachedPage) => {
        // Return cached page immediately
        return cachedPage || fetch(event.request);
      }).catch(() => {
        // As a last resort, still return cached page if fetch fails
        return caches.match('index.html');
      })
    );
    return; // stop further processing
  }

  // For all other requests (CSS, JS, models, etc.)
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response; // Serve from cache
      }
      // Not cached — fetch and optionally cache
      return fetch(event.request).then((networkResponse) => {
        // Optional: dynamically cache new resources
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      });
    }).catch(() => {
      // Optional fallback for missing cached assets
      return caches.match('index.html');
    })
  );
});