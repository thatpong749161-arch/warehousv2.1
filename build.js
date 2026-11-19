// สร้าง public/config.js จาก Environment Variables ตอน build บน Vercel
// (anon key เป็นคีย์สาธารณะโดยออกแบบ — ความปลอดภัยอยู่ที่ RLS ใน supabase/schema.sql)
const fs = require('fs');
const path = require('path');
const env = process.env;
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
fs.writeFileSync(path.join(__dirname, 'public', 'config.js'), out);
console.log('✓ เขียน public/config.js แล้ว (' + url + ')');
