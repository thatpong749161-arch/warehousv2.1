// Service worker
//  • ไฟล์ของแอป (same-origin): network-first — ออนไลน์ได้ไฟล์ล่าสุดเสมอหลัง deploy, ออฟไลน์ใช้ที่แคชไว้
//  • ไลบรารี/ฟอนต์จาก CDN: cache-first (ระบุเวอร์ชันใน URL อยู่แล้ว)
//  • คำขอไป Supabase ไม่ผ่าน SW เลย
const VER = 'loan-v8';
// ไม่แคช 'index.html' ตรง ๆ เพราะ vercel.json เปิด cleanUrls (/index.html → 308 ไป /) — ใช้ './' แทน
const SHELL = ['./', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const CDN = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const save = (req, res) => {
  if (res && (res.ok || res.type === 'opaque') && !res.redirected) {
    const copy = res.clone();
    caches.open(VER).then(c => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CDN.includes(url.hostname)) return; // Supabase API ฯลฯ → ตรงไปเครือข่าย
  if (sameOrigin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(res => save(req, res))
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : undefined)))
    );
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => save(req, res))));
  }
});
