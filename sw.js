// แคชเฉพาะตัวแอป (shell) + ไลบรารี/ฟอนต์จาก CDN — คำขอไป Supabase ไม่ผ่าน SW เลย
const VER = 'loan-v3';
// ไม่แคช 'index.html' ตรง ๆ เพราะ vercel.json เปิด cleanUrls (/index.html → 308 ไป /) — ใช้ './' แทน
const SHELL = ['./', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const CDN = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CDN.includes(url.hostname)) return; // Supabase API ฯลฯ → ตรงไปเครือข่าย
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VER).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit || (req.mode === 'navigate' ? caches.match('./') : undefined));
      // same-origin: stale-while-revalidate, CDN: cache-first
      return hit ? (sameOrigin ? (net.catch(() => {}), hit) : hit) : net;
    })
  );
});
