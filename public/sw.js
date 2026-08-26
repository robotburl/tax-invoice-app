const CACHE = 'tax-invoice-nas-2026-08-26c';
const STATIC = ['/login.html', '/manifest.json', '/css/app.css', '/js/app.js',
  '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API/auth: ต่อเน็ตอย่างเดียว ไม่แคช
  if (url.includes('/api/') || url.includes('/auth/')) {
    return e.respondWith(fetch(e.request));
  }

  // ที่เหลือ: เอาของใหม่จากเซิร์ฟเวอร์ก่อนเสมอ แล้วอัปเดตแคชไว้ใช้ตอนออฟไลน์
  // (เดิมเป็น cache-first ทำให้เครื่องยึดไฟล์เก่าไว้จนหน้าเว็บเพี้ยน)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
