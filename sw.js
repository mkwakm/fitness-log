// 오프라인에서도 앱이 열리도록 파일을 캐시합니다. 파일을 바꾸면 CACHE 버전을 올리세요.
const CACHE = 'fitness-log-v42';
// 사진 인식 AI(라이브러리·모델, 50MB쯤)는 앱을 고칠 때마다 다시 받으면 안 되므로 따로 두고 안 지운다
const AI_CACHE = 'fitness-log-ai';
const AI_HOSTS = ['cdn.jsdelivr.net'];
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'food-db.js', 'sync.js', 'photos.js', 'vision.js',
  'food-vision.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== AI_CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// 네트워크 우선, 실패하면 캐시 사용
self.addEventListener('fetch', (e) => {
  // AI 라이브러리는 버전이 박힌 주소라 내용이 안 바뀐다: 캐시에 있으면 그대로 (오프라인에서도 사진 인식)
  // 모델 파일(huggingface)은 라이브러리가 스스로 캐시하므로 여기서 건드리지 않는다
  if (AI_HOSTS.includes(new URL(e.request.url).hostname)) {
    e.respondWith(caches.open(AI_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (/(^|\.)(huggingface\.co|hf\.co|xethub\.hf\.co)$/.test(new URL(e.request.url).hostname)) return;
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
