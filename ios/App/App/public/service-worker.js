const CACHE_NAME = 'edupulse-shell-v131';
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './css/style.css?v=67',
  './css/ios-pwa.css?v=10',
  './js/app.js?v=96',
  './js/study.js?v=5',
  './js/calls.js?v=11',
  './js/study-groups.js?v=4',
  './js/pwa.js?v=13',
  './js/firebase-config.js',
  './js/ai-config.js?v=7',
  './js/ai-rag.js?v=2',
  './js/ai-web.js?v=1',
  './js/ai-profile.js?v=1',
  './js/push-config.js?v=2',
  './js/push-client.js?v=3',
  './icons/app-icon-180.png',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=Noto+Sans+Math&family=Noto+Sans+Symbols+2&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  let title = 'EduPulse';
  let body = 'Đã đến lúc ôn bài — mở app để xem kỳ thi tiếp theo.';
  let data = null;
  try {
    const payload = event.data ? event.data.json() : null;
    if (payload) {
      title = payload.title || title;
      body = payload.body || body;
      data = payload.data || null;
    }
  } catch (e) { /* payload không phải JSON */ }
  let tag = 'edupulse-countdown';
  if (data && data.type === 'chat') tag = 'edupulse-chat';
  else if (data && data.type === 'call') tag = 'edupulse-call-' + (data.callId || '');
  event.waitUntil(
    (async () => {
      // Khi app đang mở (foreground), iOS ẩn notification — gửi thẳng cho trang để đổ chuông + overlay.
      if (data && data.type === 'call') {
        try {
          const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const client of clientList) {
            client.postMessage({ type: 'CALL_INCOMING', data });
          }
        } catch (e) { /* bỏ qua */ }
      }
      const options = {
        body,
        icon: './icons/app-icon-192.png',
        badge: './icons/app-icon-192.png',
        tag,
        data,
        renotify: true
      };
      if (data && data.type === 'call') {
        // Trông như cuộc gọi đến: rung liên tục, không tự biến mất (desktop); iOS dùng hành vi mặc định.
        options.vibrate = [250, 120, 250, 120, 250, 120, 250, 120, 250, 120, 250];
        options.requireInteraction = true;
      }
      return self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notifData = event.notification.data || null;
  const openChat = notifData && notifData.type === 'chat';
  const openCall = notifData && notifData.type === 'call';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (openChat) client.postMessage({ type: 'OPEN_CHAT' });
          if (openCall) client.postMessage({ type: 'OPEN_CALL', data: notifData });
          return;
        }
      }
      // Không có cửa sổ app đang mở → mở app kèm thông tin cuộc gọi để hiện màn hình gọi đến.
      if (openCall) {
        const q = [
          'tab=chat',
          'call=' + encodeURIComponent(notifData.callId || ''),
          'caller=' + encodeURIComponent(notifData.callerUid || ''),
          'name=' + encodeURIComponent(notifData.callerName || ''),
          'type=' + encodeURIComponent(notifData.callType || 'voice')
        ].join('&');
        return self.clients.openWindow('./?' + q);
      }
      return self.clients.openWindow('./?tab=chat');
    })
  );
});

// App gửi yêu cầu đóng notification cuộc gọi khi trạng thái thay đổi (đã nghe/kết thúc…)
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'CLOSE_CALL' || !event.data.callId) return;
  const tag = 'edupulse-call-' + event.data.callId;
  self.registration.getNotifications({ tag }).then(list => list.forEach(n => n.close()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests
  if (request.method !== 'GET') return;

  // Do NOT intercept or cache any backend APIs, Firebase auth, or Firestore endpoints
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebaseinstallations') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('generativelanguage.googleapis.com')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then(response => response || caches.match('./offline.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (
          response &&
          response.ok &&
          (url.origin === self.location.origin ||
           url.hostname.includes('gstatic.com') ||
           url.hostname.includes('cdnjs.cloudflare.com') ||
           url.hostname.includes('fonts.googleapis.com') ||
           url.hostname.includes('fonts.gstatic.com'))
        ) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});












