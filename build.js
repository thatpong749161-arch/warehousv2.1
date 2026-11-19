// สร้าง public/config.js จาก Environment Variables ตอน build บน Vercel
// (anon key เป็นคีย์สาธารณะโดยออกแบบ — ความปลอดภัยอยู่ที่ RLS ใน supabase/schema.sql)
const fs = require('fs');
const path = require('path');
const env = process.env;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const WEB = ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const has = (dir, f) => fs.existsSync(path.join(dir, f));

// ---- ตรวจว่ามีโฟลเดอร์ public/ ที่มีไฟล์เว็บครบ ----
// ถ้าไม่มี แต่ไฟล์เว็บถูกอัปไว้ผิดที่ (หน้าแรกของ repo หรือ 2-GitHub/public) → คัดลอกเข้า public/ ให้
if (!has(PUB, 'index.html') || !has(PUB, 'app.js')) {
  const src = [ROOT, path.join(ROOT, '2-GitHub', 'public'), path.join(ROOT, '2-GitHub')]
    .find(d => has(d, 'index.html') && has(d, 'app.js') && has(d, 'style.css'));
  if (src) {
    fs.mkdirSync(PUB, { recursive: true });
    WEB.forEach(f => { if (has(src, f)) fs.copyFileSync(path.join(src, f), path.join(PUB, f)); });
    console.warn(`! ไม่พบไฟล์เว็บใน public/ — ใช้ไฟล์จาก "${path.relative(ROOT, src) || '(หน้าแรกของ repo)'}" แทน`);
    console.warn('  แนะนำจัด repo ให้ถูก: ไฟล์เว็บทั้งหมดต้องอยู่ในโฟลเดอร์ public/ (ดู README)');
  } else {
    console.error('✗ ไม่พบโฟลเดอร์ public/ ที่มี index.html และ app.js');
    console.error('  ไฟล์/โฟลเดอร์ที่หน้าแรกของ repo ตอนนี้: ' + fs.readdirSync(ROOT).filter(f => f !== '.git').join(', '));
    console.error('  ต้องมี: public/ (ข้างในมี index.html, app.js, style.css, sw.js ...), supabase/, build.js, vercel.json, package.json');
    process.exit(1);
  }
}
const missing = WEB.filter(f => !has(PUB, f));
if (missing.length) console.warn('! public/ ขาดไฟล์: ' + missing.join(', '));

// ---- สร้าง config.js ----
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';
const org = env.ORG_NAME || ''; // (ไม่บังคับ) ชื่อบริษัท/สาขา แสดงบนหัวกระดาษตอนพิมพ์

if (!url || !key) {
  const msg = 'ไม่พบ SUPABASE_URL / SUPABASE_ANON_KEY ใน Environment Variables';
  if (env.VERCEL) { console.error('✗ ' + msg); process.exit(1); }
  console.warn('! ' + msg + ' — ข้ามการสร้าง config.js (ใช้ไฟล์ public/config.js เดิม)');
  process.exit(0);
}
const out = `// สร้างอัตโนมัติโดย build.js — อย่าแก้ไฟล์นี้\nwindow.APP_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, ORG_NAME: org }, null, 2)};\n`;
fs.writeFileSync(path.join(PUB, 'config.js'), out);
console.log('✓ เขียน public/config.js แล้ว (' + url + ')');
