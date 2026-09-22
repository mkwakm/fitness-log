// 오프라인에서도 앱이 열리도록 파일을 캐시합니다. 파일을 바꾸면 CACHE 버전을 올리세요.
const CACHE = 'fitness-log-v17';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'food-db.js', 'sync.js',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// 네트워크 우선, 실패하면 캐시 사용
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
