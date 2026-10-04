// Service Worker：网络优先（保证代码更新能生效），离线时回退缓存
const CACHE_NAME = 'chess-4p-v3';
const PRECACHE = [
  './',
  './index.html',
  './styles/style.css',
  './styles/main.css',
  './js/main.js',
  './js/board/BoardRenderer.js',
  './js/board/CoordinateMapper.js',
  './js/board/PieceManager.js',
  './js/game/GameEngine.js',
  './js/game/GameState.js',
  './js/game/RuleValidator.js',
  './js/ui/GameInterface.js',
  './js/utils/Config.js',
  './js/utils/Utils.js',
  './js/utils/GameStatePersistence.js',
  './js/game/Replay.js',
  './js/net/OnlineSession.js',
  './vendor/trystero.nostr.iife.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.map(name => name !== CACHE_NAME ? caches.delete(name) : null)
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 只处理同源请求；跨域（联机信令/WebSocket 等）直接放行，绝不缓存
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    // no-cache：每次都向服务器校验（走 304），避免浏览器 HTTP 缓存把旧代码一直返回
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
