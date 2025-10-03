// Service Worker for offline support
const CACHE_NAME = 'chess-4p-v1.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles/style.css',
  '/styles/main.css',
  '/js/main.js',
  '/js/board/BoardRenderer.js',
  '/js/board/CoordinateMapper.js',
  '/js/board/PieceManager.js',
  '/js/game/GameEngine.js',
  '/js/game/GameState.js',
  '/js/game/RuleValidator.js',
  '/js/ui/GameInterface.js',
  '/js/utils/Config.js',
  '/js/utils/Utils.js',
  '/js/utils/GameStatePersistence.js'
];

// 安装事件
self.addEventListener('install', event => {
  console.log('Service Worker 安装中...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('缓存文件中...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活事件
self.addEventListener('activate', event => {
  console.log('Service Worker 激活中...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 拦截请求
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 缓存命中，返回缓存
        if (response) {
          return response;
        }
        
        // 克隆请求
        const fetchRequest = event.request.clone();
        
        return fetch(fetchRequest).then(response => {
          // 检查是否是有效响应
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // 克隆响应
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        });
      })
  );
});
