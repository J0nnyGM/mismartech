const CACHE_NAME = 'pixeltech-shell-v9.7'; // 🔥 Subimos la versión

// Archivos vitales para que la app arranque sin internet
const urlsToCache = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/global-components.js',
  '/img/logo.webp',
  '/img/icons/icon-192x192.webp',
  '/offline.html'
];

self.addEventListener('install', (event) => {
  // ❌ AQUÍ ESTABA EL ERROR: Eliminamos self.skipWaiting()
  // Ahora el nuevo Service Worker se instalará, pero se quedará en estado "waiting"
  // hasta que el usuario presione el botón.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Borrando caché antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Toma control de la página inmediatamente (una vez activado)
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Ignorar extensiones de Chrome y protocolos raros
  if (!url.startsWith('http')) {
    return;
  }

// Lista negra de dominios y archivos que el Service Worker DEBE IGNORAR (siempre consultar a la red).
  const ignoredDomains = [
    'firebasestorage', 
    'firestore', 
    'api-colombia', 
    'split.io',      
    'addi.com',      
    'amazonaws.com',  
    'google-analytics'
  ];

  const alwaysFetchFiles = [
    'admin-ui.js',
    'admin-guard.js',
    'index.html' // Evita que el dashboard principal se quede atascado
  ];

  // Si la URL coincide con un dominio ignorado o con un archivo de administración vital, saltamos el caché
  if (ignoredDomains.some(domain => url.includes(domain)) || alwaysFetchFiles.some(file => url.includes(file))) {
    return; // Pasa directamente a la red sin tocar el caché
  }

  // 🔥 NUEVA ESTRATEGIA: Network First (Red Primero) para HTML, CSS y JS
  // Queremos que el código y el diseño siempre estén actualizados si hay internet
  const isNavigate = event.request.mode === 'navigate';
  const isScriptOrStyle = event.request.destination === 'script' || event.request.destination === 'style';

  if (isNavigate || isScriptOrStyle) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Si la red responde bien, guardamos una copia fresca en el caché
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Si no hay internet, buscamos en el caché
          return caches.match(event.request).then((cacheResponse) => {
            if (cacheResponse) {
              return cacheResponse;
            }
            // Si es navegación y no hay caché, mostramos offline.html
            if (isNavigate) {
              return caches.match('/offline.html');
            }
          });
        })
    );
    return;
  }

  // 2. ESTRATEGIA: Cache First (Caché Primero) para Imágenes y fuentes
  // Las imágenes no cambian tan seguido, así que ahorramos datos
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Ignoramos errores de red en assets secundarios
      });
    })
  );
});

// --- ESCUCHAR LA ORDEN DE ACTUALIZACIÓN MANUAL ---
self.addEventListener('message', (event) => {
  // 🔥 AQUÍ SÍ SE EJECUTA: Solo cuando el admin-ui.js manda el mensaje al hacer clic en el botón
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});