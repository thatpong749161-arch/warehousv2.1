// ไฟล์นี้ถูกสร้างทับอัตโนมัติตอน build บน Vercel (จาก Environment Variables)
// ใช้ตอนรันในเครื่อง: แก้ค่าด้านล่างเป็นของโปรเจกต์ Supabase ของคุณ
window.APP_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
  ORG_NAME: '', // (ไม่บังคับ) ชื่อบริษัท/สาขา แสดงบนหัวกระดาษตอนพิมพ์
  ALLOW_SIGNUP: '1' // '0' = ซ่อนปุ่มสมัครใช้งาน
};
