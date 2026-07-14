/**
 * sw.js — FocusPod Service Worker
 * 오프라인 지원 + PWA 설치 가능
 */

const CACHE_NAME = 'focuspod-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/config.js',
  '/js/storage.js',
  '/js/alarm.js',
  '/js/tracker.js',
  '/js/blink.js',
  '/js/drowsy.js',
  '/js/timer.js',
  '/js/app.js',
  '/icons/icon.svg',
];

// ── 설치 ──────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 외부 CDN 리소스는 캐시 제외 (별도로 브라우저가 캐시)
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })))
        .catch(err => console.warn('[SW] 일부 파일 캐시 실패:', err));
    })
  );
  self.skipWaiting();
});

// ── 활성화 ────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── 요청 가로채기 ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // CDN 리소스(Firebase, MediaPipe, Google Fonts)는 네트워크 우선
  if (url.hostname !== location.hostname) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // 앱 리소스: 캐시 우선 (오프라인 지원)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 성공적인 응답이면 캐시에 저장
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
// ── 기존 sw.js 끝에 추가할 코드 ────────────────────────────────

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || '📚 복습 알림', {
      body:    data.body  || '복습할 내용이 있어요!',
      icon:    data.icon  || '/icons/icon-192.png',
      badge:   data.badge || '/icons/icon-192.png',
      tag:     'review-' + (data.data?.studiedDate || Date.now()),
      renotify: false,
      data:    data.data || {}
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
