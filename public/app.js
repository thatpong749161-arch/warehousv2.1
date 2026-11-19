'use strict';
/* ระบบเบิก/คืนเครื่อง v2 — PWA (vanilla JS + Supabase)
   ผู้เบิก      : เลือกรุ่น + จำนวน → ส่งคำขอ (ไม่ต้องสนสต็อก/IMEI)
   ผู้จ่ายเบิก  : สร้างรุ่น · สต็อกนับเป็นจำนวน · จ่ายตามคำขอโดยสแกน IMEI ทีละเครื่อง · รับคืน */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
const dtLong = d => d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' }) : '';
const num = n => Number(n || 0).toLocaleString('th-TH');
const DOC_T = { ISSUE: 'จ่าย', RETURN: 'คืน' };
const DOC_CLS = { ISSUE: 'warn', RETURN: 'ok' };
const REQ_T = { PENDING: 'รอจ่าย', ISSUED: 'จ่ายแล้ว', CANCELLED: 'ยกเลิก' };
const REQ_CLS = { PENDING: 'warn', ISSUED: 'ok', CANCELLED: '' };
const MOVE_T = { INIT: 'ยอดเริ่มต้น', IN: 'รับเข้า', OUT: 'ตัดออก', SET: 'ตรวจนับ', ISSUE: 'จ่าย', RETURN: 'รับคืน' };
const ROLE_T = { requester: 'ผู้เบิก', issuer: 'ผู้จ่ายเบิก' };
const DRAFT_KEY = 'draft-v2';

/* ---------- Supabase ---------- */
const cfg = window.APP_CONFIG || {};
const ORG = cfg.ORG_NAME || '';
const configured = !!(window.supabase && /^https?:\/\//.test(cfg.SUPABASE_URL || '') && cfg.SUPABASE_ANON_KEY && !/YOUR_/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const state = {
  view: '', session: null, role: 'requester', operator: '', busy: false, loadErr: '',
  models: [], modelMap: new Map(), reqs: [], reqLimit: 200,
  open: [], openMap: new Map(), docs: [], docsLimit: 300,
  req: { person: '', dept: '', purpose: '', note: '', qty: {} },
  ful: null, // { no, items: [{ imei, model_id }], cur: model_id }
  cart: { return: [] }, rnote: '', retPerson: '', loose: false,
  outQ: '', hq: '', ht: '', rq: 'PENDING', pq: '', mq: '', sq: '', newModel: '', newQty: ''
};
const isIssuer = () => state.role === 'issuer';

/* ---------- เมนูตามสิทธิ์ ---------- */
const IC = {
  req: '<path d="M12 14V3M7 8l5-5 5 5M4 17v3h16v-3"/>',
  list: '<path d="M8.5 3.5h7v3h-7zM6.5 5H4.5v16h15V5h-2M8 11h8M8 15h5"/>',
  ret: '<path d="M12 3v11M7 9l5 5 5-5M4 17v3h16v-3"/>',
  dev: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9"/>',
  hist: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6"/>'
};
const NAV = {
  requester: [['request', 'ขอเบิก', 'req'], ['requests', 'คำขอของฉัน', 'list']],
  issuer: [['requests', 'คำขอ', 'list'], ['return', 'รับคืน', 'ret'], ['out', 'ค้างอยู่', 'dev'], ['stock', 'สต็อก', 'box'], ['history', 'ประวัติ', 'hist']]
};
const EXTRA = { requester: ['settings'], issuer: ['request', 'fulfill', 'settings'] };
const allowed = v => NAV[state.role].some(x => x[0] === v) || EXTRA[state.role].includes(v);
const fixView = () => { if (!allowed(state.view)) state.view = NAV[state.role][0][0]; };

function renderNav() {
  const pend = state.reqs.filter(r => r.status === 'PENDING').length;
  const badge = { requests: pend, out: state.open.length };
  const on = v => state.view === v || (v === 'requests' && state.view === 'fulfill');
  $('#nav').innerHTML = state.session ? NAV[state.role].map(([v, t, i]) => `<button data-view="${v}" class="${on(v) ? 'on' : ''}" data-n="${badge[v] || ''}"><svg viewBox="0 0 24 24">${IC[i]}</svg><span>${t}</span></button>`).join('') : '';
  const rb = $('#role'); if (rb) { rb.hidden = !state.session; rb.textContent = ROLE_T[state.role]; rb.className = 'badge' + (isIssuer() ? ' warn' : ''); }
}

/* ---------- helpers ---------- */
const errMsg = e => {
  const m = e?.message || String(e);
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต';
  if (/schema cache|relation .* does not exist|could not find the function/i.test(m)) return 'ฐานข้อมูลยังไม่ได้อัปเดต — รันไฟล์ supabase/schema.sql ใน Supabase SQL Editor';
  return m;
};
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 2800);
}
let ac;
function beep(ok = true) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 1000 : 300; g.gain.value = .1; o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + .12);
  } catch { }
  navigator.vibrate?.(ok ? 40 : [80, 40, 80]);
}
const loadScript = url => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${url}"]`)) return res();
  const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => rej(new Error('โหลดไลบรารีไม่ได้ (ต้องออนไลน์ครั้งแรก)')); document.head.appendChild(s);
});
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const opName = () => state.operator.trim() || state.session?.user?.email || '';
const daysSince = d => Math.max(0, Math.floor((Date.now() - new Date(d)) / 864e5));
const reqQty = r => r.request_items.reduce((a, i) => a + i.qty, 0);
const reqIssued = r => r.request_items.reduce((a, i) => a + (i.issued || 0), 0);
const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ req: state.req, ful: state.ful, ret: state.cart.return, rnote: state.rnote, retPerson: state.retPerson })); } catch { } };
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (!d) return;
    Object.assign(state.req, d.req || {}); state.req.qty = d.req?.qty || {};
    state.ful = d.ful || null; state.cart.return = d.ret || [];
    state.rnote = d.rnote || ''; state.retPerson = d.retPerson || '';
  } catch { }
}
function cleanDraft() {
  Object.keys(state.req.qty).forEach(id => { if (!state.modelMap.get(+id)?.active) delete state.req.qty[id]; });
  if (state.ful && (!isIssuer() || state.reqs.find(r => r.req_no === state.ful.no)?.status !== 'PENDING')) state.ful = null;
  state.cart.return = isIssuer() ? state.cart.return.filter(l => state.openMap.has(l.imei)) : [];
  saveDraft();
}

/* ---------- data (Supabase) ---------- */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
async function loadRole() {
  const { data, error } = await sb.from('profiles').select('role').eq('user_id', state.session.user.id).maybeSingle();
  if (error) throw error;
  state.role = data?.role === 'issuer' ? 'issuer' : 'requester';
}
async function loadModels() {
  const { data, error } = await sb.from('models').select('*').order('name');
  if (error) throw error;
  state.models = data; state.modelMap = new Map(data.map(m => [m.id, m]));
}
async function loadReqs() {
  const { data, error } = await sb.from('requests').select('*, request_items(*)').order('created_at', { ascending: false }).limit(state.reqLimit);
  if (error) throw error;
  data.forEach(r => r.request_items.sort((a, b) => a.id - b.id));
  state.reqs = data;
}
async function loadOpen() {
  state.open = await fetchAll((a, b) => sb.from('loans').select('*').is('returned_at', null).order('issued_at', { ascending: false }).order('id').range(a, b));
  state.openMap = new Map(state.open.map(l => [l.imei, l]));
}
async function loadDocs() {
  const { data, error } = await sb.from('documents').select('*, document_items(imei, model)').order('created_at', { ascending: false }).limit(state.docsLimit);
  if (error) throw error;
  state.docs = data;
}
async function refresh() {
  if (!sb || !state.session) return;
  try {
    await loadRole();
    const jobs = [loadModels(), loadReqs()];
    if (isIssuer()) jobs.push(loadOpen(), loadDocs()); else { state.open = []; state.openMap = new Map(); state.docs = []; }
    await Promise.all(jobs); state.loadErr = '';
  } catch (e) { state.loadErr = errMsg(e); }
  fixView();
}
async function guarded(fn) {
  if (state.busy) return; state.busy = true;
  try { await fn(); } catch (e) { toast(errMsg(e), true); }
  state.busy = false;
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

/* ---------- scanner ---------- */
async function openScanner(onCode, { multi = true } = {}) {
  const dlg = $('#scanDlg'), msg = $('#scanMsg'), video = $('#scanVideo'), reader = $('#reader');
  msg.textContent = 'กำลังเปิดกล้อง...'; video.hidden = false; reader.hidden = true;
  let stopped = false, stream, timer, h5, last = '', lastT = 0, busy = false;
  const stop = () => {
    if (stopped) return; stopped = true; clearInterval(timer);
    stream?.getTracks().forEach(t => t.stop()); video.srcObject = null;
    if (h5) { h5.stop().catch(() => { }).finally(() => { try { h5.clear(); } catch { } }); }
    if (dlg.open) dlg.close();
  };
  const handle = code => {
    const now = Date.now();
    if (code === last && now - lastT < 1500) return;
    last = code; lastT = now;
    const r = onCode(code);
    const ok = r !== false && !(typeof r === 'string' && r.startsWith('✗'));
    beep(ok); msg.textContent = typeof r === 'string' ? r : (ok ? '✓ ' + code : '✗ ' + code);
    if (!multi && ok) stop();
  };
  dlg.onclose = stop; $('#scanClose').onclick = stop;
  dlg.showModal();
  if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'เบราว์เซอร์นี้ไม่รองรับกล้อง (ต้องใช้ HTTPS) — ใช้เครื่องยิงบาร์โค้ดหรือพิมพ์รหัสแทนได้'; return; }
  try {
    if ('BarcodeDetector' in window) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream; await video.play();
      const fmts = await BarcodeDetector.getSupportedFormats();
      const det = new BarcodeDetector({ formats: fmts });
      msg.textContent = 'เล็งกล้องไปที่บาร์โค้ด IMEI';
      timer = setInterval(async () => {
        if (busy || stopped) return; busy = true;
        try { const r = await det.detect(video); if (r[0]?.rawValue) handle(r[0].rawValue); } catch { }
        busy = false;
      }, 200);
    } else {
      await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
      video.hidden = true; reader.hidden = false;
      h5 = new Html5Qrcode('reader');
      await h5.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 260 } }, handle, () => { });
      msg.textContent = 'เล็งกล้องไปที่บาร์โค้ด IMEI';
    }
  } catch (e) {
    msg.textContent = 'เปิดกล้องไม่ได้: ' + (e.message || e.name) + ' — ตรวจสอบสิทธิ์กล้อง/HTTPS';
  }
}

/* ---------- IMEI ---------- */
function validImei(s) {
  if (state.loose) return /^[A-Z0-9-]{5,30}$/.test(s);
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) { let d = +s[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
function normImei(raw) {
  let s = String(raw).trim().replace(/\s+/g, '');
  if (!state.loose) { const m = s.match(/\d{15}/); if (m) s = m[0]; }
  return s.toUpperCase();
}
const addImei = (kind, raw) => kind === 'ful' ? addFul(raw) : addReturn(raw);

function addReturn(raw) {
  const s = normImei(raw), c = state.cart.return;
  if (!validImei(s)) return `✗ ${s} ไม่ใช่ IMEI ที่ถูกต้อง (15 หลัก)`;
  if (c.some(x => x.imei === s)) return `✗ สแกน ${s} ซ้ำ`;
  const loan = state.openMap.get(s);
  if (!loan) return `✗ ${s} ไม่ได้อยู่ในสถานะถูกเบิก`;
  c.push({ imei: s, model: loan.model, person: loan.person });
  renderCart(); saveDraft();
  return `✓ ${s}${loan.model ? ' · ' + loan.model : ''} (รวม ${c.length})`;
}

/* จ่ายตามคำขอ: IMEI เข้ารุ่นที่เลือกอยู่ ครบแล้วเลื่อนไปรุ่นถัดไปอัตโนมัติ */
const curReq = () => state.ful && state.reqs.find(r => r.req_no === state.ful.no);
const fulCnt = id => state.ful.items.filter(x => x.model_id === id).length;
function addFul(raw) {
  const r = curReq(); if (!r || r.status !== 'PENDING') return '✗ คำขอนี้ไม่ได้รอจ่ายแล้ว';
  const f = state.ful, s = normImei(raw);
  if (!validImei(s)) return `✗ ${s} ไม่ใช่ IMEI ที่ถูกต้อง (15 หลัก)`;
  if (f.items.some(x => x.imei === s)) return `✗ สแกน ${s} ซ้ำ`;
  const loan = state.openMap.get(s);
  if (loan) return `✗ ${s} ถูกเบิกอยู่แล้ว (${loan.person})`;
  const lines = r.request_items;
  const line = lines.find(l => l.model_id === f.cur && fulCnt(l.model_id) < l.qty) || lines.find(l => fulCnt(l.model_id) < l.qty);
  if (!line) return '✗ จ่ายครบทุกรุ่นตามคำขอแล้ว';
  f.items.push({ imei: s, model_id: line.model_id });
  const n = fulCnt(line.model_id);
  f.cur = n >= line.qty ? (lines.find(l => fulCnt(l.model_id) < l.qty)?.model_id ?? line.model_id) : line.model_id;
  renderFul(); saveDraft();
  return `✓ ${s} · ${line.model} (${n}/${line.qty})`;
}

const scanBox = kind => `
  <button class="primary big scanbtn" data-act="scan" data-k="${kind}"><i class="vfico"></i>สแกนด้วยกล้อง</button>
  <label style="margin-top:12px">เครื่องยิงบาร์โค้ด / พิมพ์ IMEI แล้วกด Enter
    <input class="wedge" data-k="${kind}" inputmode="numeric" placeholder="ยิง IMEI ที่นี่" autocomplete="off" enterkeyhint="done"></label>
  <details style="margin-bottom:10px"><summary class="muted" style="cursor:pointer">วางหลายเครื่องพร้อมกัน</summary>
    <textarea id="bulk-${kind}" rows="3" placeholder="คั่นด้วยบรรทัดหรือเว้นวรรค"></textarea>
    <button data-act="addBulk" data-k="${kind}" style="width:100%;margin-top:6px">เพิ่มรายการที่วาง</button></details>
  <label class="chk"><input type="checkbox" data-bind="loose" ${state.loose ? 'checked' : ''}> ไม่ตรวจรูปแบบ IMEI (ใช้กับเลขซีเรียลอื่น)</label>`;

function cartHtml() {
  const c = state.cart.return;
  if (!c.length) return '<p class="muted center">ยังไม่มีเครื่อง — สแกนหรือพิมพ์ IMEI</p>';
  return c.slice().reverse().map(l => `<div class="line"><div class="grow"><b class="code">${esc(l.imei)}</b>
    <small>${[l.model, l.person].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</small></div>
    <button class="ghost" data-act="del" data-imei="${esc(l.imei)}" aria-label="ลบ">✕</button></div>`).join('')
    + `<p class="total">รวม ${c.length} เครื่อง</p>`;
}
const renderCart = () => { const e = $('#cart-return'); if (e) e.innerHTML = cartHtml(); };

/* ---------- views ---------- */
function viewLogin() {
  return `<section class="card" style="margin-top:20px"><h2>เข้าสู่ระบบ</h2>
    <form id="loginForm">
      <label>อีเมล<input name="email" type="email" autocomplete="username" required></label>
      <label>รหัสผ่าน<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="primary big" style="margin-top:4px">เข้าสู่ระบบ</button>
    </form>
    <small style="margin-top:12px">บัญชีผู้ใช้สร้างโดยผู้ดูแลระบบใน Supabase (Authentication → Users)</small></section>`;
}
const viewSetup = () => `<section class="card" style="margin-top:20px"><h2>ยังไม่ได้ตั้งค่า Supabase</h2>
  <p class="muted">ไม่พบ <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> (หรือโหลดไลบรารีไม่สำเร็จ)<br>
  บน Vercel: Settings → Environment Variables แล้ว Redeploy<br>ในเครื่อง: แก้ไฟล์ <code>public/config.js</code></p></section>`;
const errBanner = () => state.loadErr ? `<p class="badge err" style="display:block;white-space:normal;margin-bottom:12px">โหลดข้อมูลไม่สำเร็จ: ${esc(state.loadErr)}</p>` : '';
const peopleList = () => [...new Set([...state.reqs.map(r => r.person), ...state.open.map(l => l.person)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
const peopleOpts = () => peopleList().map(x => `<option value="${esc(x)}">`).join('');

/* ขอเบิก: เลือกรุ่น + จำนวน */
function modelPickHtml() {
  const q = state.mq.trim().toLowerCase();
  const ms = state.models.filter(m => m.active);
  if (!ms.length) return `<p class="muted center">ยังไม่มีรุ่นเครื่องให้เลือก${isIssuer() ? ' — เพิ่มรุ่นได้ที่เมนู “สต็อก”' : ' — ติดต่อผู้จ่ายเบิกให้เพิ่มรุ่น'}</p>`;
  const list = ms.filter(m => !q || m.name.toLowerCase().includes(q) || state.req.qty[m.id]);
  return list.map(m => { const n = state.req.qty[m.id] || 0; return `<div class="pick ${n ? 'on' : ''}" id="pk-${m.id}">
    <div class="nm">${esc(m.name)}${isIssuer() ? `<small>คงเหลือ ${num(m.stock)}</small>` : ''}</div>
    <div class="step"><button data-act="qty" data-id="${m.id}" data-d="-1" aria-label="ลด">−</button><input type="number" inputmode="numeric" min="0" max="999" data-qty="${m.id}" value="${n || ''}" placeholder="0" aria-label="จำนวน ${esc(m.name)}"><button data-act="qty" data-id="${m.id}" data-d="1" aria-label="เพิ่ม">+</button></div></div>`; }).join('')
    || '<p class="muted center">ไม่พบรุ่นที่ค้นหา</p>';
}
const reqLines = () => Object.entries(state.req.qty).filter(([id, n]) => n > 0 && state.modelMap.get(+id)?.active).map(([id, n]) => ({ model_id: +id, qty: n }));
function reqSumHtml() {
  const l = reqLines(), t = l.reduce((a, x) => a + x.qty, 0);
  return l.length ? `<span>${l.length} รุ่น</span><b>รวม ${t} เครื่อง</b>` : '<span>ยังไม่ได้เลือกรุ่น</span><b>0 เครื่อง</b>';
}
function setQty(id, n, syncInput = true) {
  n = Math.max(0, Math.min(999, Math.floor(+n || 0)));
  if (n) state.req.qty[id] = n; else delete state.req.qty[id];
  const row = $('#pk-' + id);
  if (row) { row.classList.toggle('on', n > 0); if (syncInput) row.querySelector('input').value = n || ''; }
  const s = $('#reqSum'); if (s) s.innerHTML = reqSumHtml();
  saveDraft();
}
function viewRequest() {
  const r = state.req;
  if (!r.person && !isIssuer() && state.operator) r.person = state.operator;
  return errBanner() + (isIssuer() ? `<button class="ghost" data-view="requests" style="margin-bottom:8px">← กลับไปหน้าคำขอ</button>` : '')
  + `<section class="card"><h2>ข้อมูลผู้เบิก</h2>
    <label>ผู้เบิก *<input data-bind="req.person" value="${esc(r.person)}" list="people" autocomplete="off"></label>
    <datalist id="people">${peopleOpts()}</datalist>
    <label>แผนก / งาน<input data-bind="req.dept" value="${esc(r.dept)}"></label>
    <label>วัตถุประสงค์การใช้<input data-bind="req.purpose" value="${esc(r.purpose)}"></label>
    <label style="margin-bottom:0">หมายเหตุ<input data-bind="req.note" value="${esc(r.note)}"></label></section>
  <section class="card"><h2>เลือกรุ่นและจำนวน</h2>
    ${state.models.filter(m => m.active).length > 6 ? `<input data-bind="mq" placeholder="ค้นหารุ่น" value="${esc(state.mq)}" style="margin:0 0 6px">` : ''}
    <div id="modelPick">${modelPickHtml()}</div></section>
  <div class="cta"><div class="sum" id="reqSum">${reqSumHtml()}</div>
    <button class="primary big" data-act="submitReq">ส่งคำขอเบิก</button></div>`;
}

/* คำขอ */
const reqSummary = r => r.request_items.map(i => `${esc(i.model)} ×${i.qty}`).join(' · ');
function reqListHtml() {
  const q = state.pq.trim().toLowerCase(), s = state.rq;
  const list = state.reqs.filter(r => (!s || r.status === s) && (!q || [r.req_no, r.person, r.dept, r.purpose, r.note, r.issue_doc, ...r.request_items.map(i => i.model)].some(x => String(x || '').toLowerCase().includes(q))));
  const more = state.reqs.length >= state.reqLimit ? '<button data-act="moreReqs" style="width:100%">โหลดเพิ่ม</button>' : '';
  if (!list.length) return '<p class="muted center">ไม่มีคำขอ</p>' + more;
  return list.map(r => `<div class="card item doc s-${r.status}" data-act="viewReq" data-no="${esc(r.req_no)}"><div class="line" style="border:0;padding:0"><div class="grow">
    <span class="badge ${REQ_CLS[r.status]}">${REQ_T[r.status]}</span> <b class="code">${esc(r.req_no)}</b>
    <small><b>${esc(r.person)}</b>${r.dept ? ' · ' + esc(r.dept) : ''} · ${fmt(r.created_at)}</small>
    <small>${reqSummary(r)}</small></div>
    <div class="side"><b class="bignum">${r.status === 'ISSUED' ? reqIssued(r) + '<i>/' + reqQty(r) + '</i>' : reqQty(r)}</b><small>เครื่อง</small>
    ${isIssuer() && r.status === 'PENDING' ? `<button class="primary sm" data-act="startFul" data-no="${esc(r.req_no)}">จ่าย</button>` : ''}</div></div></div>`).join('') + more;
}
const renderReqList = () => { const e = $('#reqList'); if (e) e.innerHTML = reqListHtml(); };
function viewRequests() {
  const c = s => state.reqs.filter(r => r.status === s).length;
  const segs = [['PENDING', 'รอจ่าย', c('PENDING')], ['ISSUED', 'จ่ายแล้ว'], ['CANCELLED', 'ยกเลิก'], ['', 'ทั้งหมด']];
  return errBanner() + (isIssuer() ? `<button class="big" data-view="request" style="margin:0 0 12px">＋ สร้างคำขอแทนผู้เบิก</button>` : '')
    + `<div class="seg">${segs.map(([k, t, n]) => `<button data-act="setRq" data-s="${k}" class="${state.rq === k ? 'on' : ''}">${t}${n ? ` <i>${n}</i>` : ''}</button>`).join('')}</div>
    <input data-bind="pq" placeholder="ค้นหา เลขที่คำขอ / ผู้เบิก / รุ่น" value="${esc(state.pq)}" style="margin:0 0 12px">
    <div id="reqList">${reqListHtml()}</div>`;
}

/* จ่ายตามคำขอ */
function fulLinesHtml() {
  const r = curReq(), f = state.ful;
  return r.request_items.map(l => {
    const n = fulCnt(l.model_id), m = state.modelMap.get(l.model_id), its = f.items.filter(x => x.model_id === l.model_id);
    return `<div class="tile ${f.cur === l.model_id ? 'cur' : ''} ${n >= l.qty ? 'done' : ''}" data-act="setCur" data-id="${l.model_id}">
      <div class="tl"><b>${esc(l.model)}</b><span class="cnt">${n}<i>/${l.qty}</i></span></div>
      <div class="bar"><i style="width:${Math.min(100, n / l.qty * 100)}%"></i></div>
      ${m && m.stock < l.qty ? `<small class="warn-t">⚠ สต็อกในระบบเหลือ ${num(m.stock)}</small>` : ''}
      ${its.length ? `<div class="chips">${its.map(x => `<span class="chip">${esc(x.imei)}<button data-act="fulDel" data-imei="${esc(x.imei)}" aria-label="ลบ">✕</button></span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}
function fulSumHtml() {
  const r = curReq(); const t = reqQty(r), n = state.ful.items.length;
  return `<span>สแกนแล้ว</span><b>${n} / ${t} เครื่อง</b>`;
}
function renderFul() {
  const a = $('#fulLines'); if (a) a.innerHTML = fulLinesHtml();
  const b = $('#fulSum'); if (b) b.innerHTML = fulSumHtml();
}
function viewFulfill() {
  const r = curReq();
  const back = `<button class="ghost" data-view="requests" style="margin-bottom:8px">← กลับไปหน้าคำขอ</button>`;
  if (!r || r.status !== 'PENDING') return back + `<section class="card"><p class="muted center" style="margin:0">คำขอนี้ไม่ได้อยู่ในสถานะรอจ่ายแล้ว</p></section>`;
  return errBanner() + back + `<section class="card"><h2>จ่ายตามคำขอ <span class="code">${esc(r.req_no)}</span></h2>
    <p style="margin:0"><b>${esc(r.person)}</b>${r.dept ? ' · ' + esc(r.dept) : ''}</p>
    <small>${fmt(r.created_at)}${r.purpose ? ' · ' + esc(r.purpose) : ''}${r.note ? ' · ' + esc(r.note) : ''}</small></section>
  <section class="card"><h2>สแกน IMEI ทีละเครื่อง</h2>
    <small style="margin:-4px 0 10px">แตะเลือกรุ่นที่กำลังสแกน · ครบจำนวนแล้วระบบเลื่อนไปรุ่นถัดไปให้เอง</small>
    <div id="fulLines">${fulLinesHtml()}</div>
    <div style="margin-top:14px">${scanBox('ful')}</div></section>
  <div class="cta"><div class="sum" id="fulSum">${fulSumHtml()}</div>
    <button class="primary big" data-act="commitFul">✅ ยืนยันการจ่าย</button></div>`;
}

/* รับคืน */
function viewReturn() {
  const by = new Map(); state.open.forEach(l => by.set(l.person, (by.get(l.person) || 0) + 1));
  const people = [...by.keys()].sort((a, b) => a.localeCompare(b, 'th'));
  return errBanner() + `<section class="card"><h2>คืนทั้งชุดของผู้เบิก</h2>
    ${people.length ? `<label>ผู้เบิกที่มีเครื่องค้างอยู่<select data-bind="retPerson"><option value="">— เลือกผู้เบิก —</option>
      ${people.map(x => `<option value="${esc(x)}" ${x === state.retPerson ? 'selected' : ''}>${esc(x)} (${by.get(x)} เครื่อง)</option>`).join('')}</select></label>
      <button data-act="addPerson" style="width:100%">ใส่เครื่องทั้งหมดของคนนี้</button>`
      : '<p class="muted center" style="margin:0">ไม่มีเครื่องค้างอยู่</p>'}
    <label style="margin-top:12px">หมายเหตุ (เช่น สภาพเครื่อง)<input data-bind="rnote" value="${esc(state.rnote)}"></label></section>
  <section class="card"><h2>สแกนเครื่องที่คืน</h2>${scanBox('return')}<div id="cart-return">${cartHtml()}</div></section>
  <button class="primary big" data-act="commitReturn">✅ ยืนยันการรับคืน</button>`;
}

/* ค้างอยู่ */
function outListHtml() {
  const q = state.outQ.trim().toLowerCase();
  const list = state.open.filter(l => !q || [l.imei, l.model, l.person, l.dept, l.purpose, l.issue_doc, l.req_no].some(x => String(x || '').toLowerCase().includes(q)));
  return list.length ? list.slice(0, 200).map(l => { const n = daysSince(l.issued_at); return `<div class="card item doc t-ISSUE"><div class="line" style="border:0;padding:0">
    <div class="grow"><b class="code">${esc(l.imei)}</b>${l.model ? ' ' + esc(l.model) : ''}
      <small><b>${esc(l.person)}</b>${l.dept ? ' · ' + esc(l.dept) : ''}</small>
      <small>จ่าย ${fmt(l.issued_at)} · <span class="code">${esc(l.issue_doc)}</span></small></div>
    <div style="text-align:right"><span class="badge ${n >= 7 ? 'err' : 'warn'}">${n === 0 ? 'วันนี้' : n + ' วัน'}</span><br>
    <button data-act="retOne" data-imei="${esc(l.imei)}" style="margin-top:8px;padding:6px 12px">คืน</button></div></div></div>`; }).join('')
    + (list.length > 200 ? `<p class="muted center">แสดง 200 จาก ${list.length} — ใช้ช่องค้นหาเพื่อกรอง</p>` : '')
    : '<p class="muted center">ไม่พบรายการ</p>';
}
const renderOutList = () => { const e = $('#outList'); if (e) e.innerHTML = outListHtml(); };
function viewOut() {
  const people = new Set(state.open.map(l => l.person)).size;
  return errBanner() + `<input data-bind="outQ" placeholder="ค้นหา IMEI / รุ่น / ผู้เบิก / เลขที่เอกสาร" value="${esc(state.outQ)}" style="margin-bottom:10px">
    <p class="muted">เครื่องที่ถูกเบิกอยู่ <b>${state.open.length}</b> เครื่อง · ${people} คน</p>
    <div class="row"><button data-act="reload">🔄 รีเฟรช</button><button data-act="exportCsv">⬇️ ส่งออก CSV</button></div>
    <div id="outList">${outListHtml()}</div>`;
}

/* สต็อก (นับจำนวน) */
function stockListHtml() {
  const q = state.sq.trim().toLowerCase();
  const out = new Map(); state.open.forEach(l => l.model_id && out.set(l.model_id, (out.get(l.model_id) || 0) + 1));
  const need = new Map(); state.reqs.filter(r => r.status === 'PENDING').forEach(r => r.request_items.forEach(i => need.set(i.model_id, (need.get(i.model_id) || 0) + i.qty)));
  const list = state.models.filter(m => !q || m.name.toLowerCase().includes(q)).sort((a, b) => b.active - a.active);
  if (!list.length) return `<p class="muted center">${state.models.length ? 'ไม่พบรุ่นที่ค้นหา' : 'ยังไม่มีรุ่น — เพิ่มรุ่นแรกด้านบน'}</p>`;
  return list.map(m => { const nd = need.get(m.id) || 0, o = out.get(m.id) || 0;
    return `<div class="card item stk ${m.active ? '' : 'off'}"><div class="line" style="border:0;padding:0">
    <div class="grow"><b>${esc(m.name)}</b> ${m.active ? '' : '<span class="badge">ปิดใช้งาน</span>'}
      <small>ถูกเบิกอยู่ ${o} · รอจ่าย ${nd}${nd > m.stock ? ' · <b style="color:var(--red)">ไม่พอจ่าย</b>' : ''}</small></div>
    <div class="side"><b class="bignum ${m.stock <= 0 ? 'neg' : ''}">${num(m.stock)}</b><small>คงเหลือ</small></div></div>
    <div class="row" style="margin:10px 0 0"><button data-act="stockDlg" data-id="${m.id}">± ปรับสต็อก</button><button data-act="modelDlg" data-id="${m.id}">✎ แก้ไขรุ่น</button></div></div>`;
  }).join('');
}
const renderStockList = () => { const e = $('#stockList'); if (e) e.innerHTML = stockListHtml(); };
function viewStock() {
  const act = state.models.filter(m => m.active), tot = act.reduce((a, m) => a + m.stock, 0);
  return errBanner() + `<section class="card"><h2>เพิ่มรุ่นใหม่</h2>
    <div class="row" style="margin:0"><label style="flex:2;margin:0">ชื่อรุ่น<input data-bind="newModel" value="${esc(state.newModel)}" placeholder="เช่น iPhone 15 128GB"></label>
    <label style="margin:0">สต็อกเริ่มต้น<input data-bind="newQty" type="number" inputmode="numeric" min="0" value="${esc(state.newQty)}" placeholder="0"></label></div>
    <button class="primary big" data-act="addModel">＋ เพิ่มรุ่น</button></section>
  <div class="stats"><div><b>${act.length}</b><small>รุ่นที่ใช้งาน</small></div><div><b>${num(tot)}</b><small>สต็อกคงเหลือ</small></div><div><b>${num(state.open.length)}</b><small>ถูกเบิกอยู่</small></div></div>
  <input data-bind="sq" placeholder="ค้นหารุ่น" value="${esc(state.sq)}" style="margin:0 0 12px">
  <div id="stockList">${stockListHtml()}</div>`;
}

/* ประวัติเอกสาร */
const docSummary = d => { const n = d.document_items.length, f = d.document_items[0]; return n ? `${esc(f.model ? f.model + ' · ' : '')}${esc(f.imei)}${n > 1 ? ` และอีก ${n - 1} เครื่อง` : ''}` : ''; };
function historyListHtml() {
  const q = state.hq.trim().toLowerCase(), t = state.ht;
  const list = state.docs.filter(d => (!t || d.type === t) && (!q || [d.doc_no, d.req_no, d.person, d.dept, d.purpose, d.note, ...d.document_items.flatMap(i => [i.imei, i.model])].some(x => String(x || '').toLowerCase().includes(q))));
  const html = list.length ? list.map(d => {
    let st = '';
    if (d.type === 'ISSUE') { const n = d.document_items.filter(i => state.openMap.get(i.imei)?.issue_doc === d.doc_no).length; st = `<span class="badge ${n ? 'warn' : 'ok'}">${n ? 'ค้าง ' + n : 'คืนครบ'}</span>`; }
    return `<div class="card item doc t-${d.type}" data-act="viewDoc" data-no="${esc(d.doc_no)}"><div class="line" style="border:0;padding:0"><div class="grow">
      <span class="badge ${DOC_CLS[d.type]}">${DOC_T[d.type]}</span> <b class="code">${esc(d.doc_no)}</b>
      <small>${fmt(d.created_at)} · ${esc(d.person || '-')}${d.dept ? ' · ' + esc(d.dept) : ''}</small><small>${docSummary(d)}</small></div>${st}</div></div>`;
  }).join('') : '<p class="muted center">ไม่มีรายการ</p>';
  return html + (state.docs.length >= state.docsLimit ? '<button data-act="moreDocs" style="width:100%">โหลดเพิ่ม</button>' : '');
}
const renderHistoryList = () => { const e = $('#histList'); if (e) e.innerHTML = historyListHtml(); };
function viewHistory() {
  return errBanner() + `<div class="row"><input data-bind="hq" placeholder="ค้นหา เลขที่เอกสาร / ผู้เบิก / IMEI" value="${esc(state.hq)}">
    <select data-bind="ht"><option value="">ทั้งหมด</option>${Object.entries(DOC_T).map(([k, v]) => `<option value="${k}" ${state.ht === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div id="histList">${historyListHtml()}</div>`;
}

function viewSettings() {
  return errBanner() + `<section class="card"><h2>ผู้ใช้งาน</h2>
    <p class="muted" style="margin-bottom:8px">เข้าสู่ระบบเป็น <b>${esc(state.session?.user?.email || '-')}</b> · สิทธิ์ <span class="badge ${isIssuer() ? 'warn' : ''}">${ROLE_T[state.role]}</span></p>
    <label>ชื่อผู้บันทึก (ใส่ในทุกเอกสาร — ถ้าเว้นว่างจะใช้อีเมล)<input data-bind="operator" value="${esc(state.operator)}"></label>
    <button class="danger" data-act="logout" style="width:100%">ออกจากระบบ</button></section>
  ${isIssuer() ? `<section class="card"><h2>สิทธิ์ผู้ใช้</h2>
    <small style="margin-bottom:8px">ผู้ใช้ใหม่เป็น “ผู้เบิก” อัตโนมัติ · สร้างบัญชีได้ใน Supabase (Authentication → Users)</small>
    <div id="users"><p class="muted">กำลังโหลด...</p></div></section>
  <section class="card"><h2>ข้อมูล</h2>
    <p class="muted">ข้อมูลเก็บบน Supabase ใช้ร่วมกันทุกเครื่อง/ทุกคน (ต้องออนไลน์)</p>
    <div class="row"><button data-act="reload">🔄 โหลดข้อมูลใหม่</button><button data-act="exportCsv">⬇️ ส่งออก CSV</button></div></section>` : ''}
  <section class="card"><h2>วิธีใช้</h2><p class="muted">${isIssuer()
    ? '1) เมนู “สต็อก” เพิ่มรุ่น และใส่จำนวนที่มี (รับเข้า/ตรวจนับ)<br>2) เมนู “คำขอ” เปิดคำขอที่รอจ่าย → กด “จ่าย” → สแกน IMEI ทีละเครื่อง → ยืนยัน (สต็อกลดอัตโนมัติ)<br>3) เมนู “รับคืน” สแกนเครื่องที่คืน (สต็อกเพิ่มอัตโนมัติ)<br>4) พิมพ์ใบขอเบิก/ใบจ่าย/ใบคืนได้จากหน้ารายละเอียด'
    : '1) เมนู “ขอเบิก” กรอกชื่อ → เลือกรุ่นและจำนวน → ส่งคำขอ<br>2) เมนู “คำขอของฉัน” ติดตามสถานะ เมื่อจ่ายแล้วจะเห็นเลข IMEI ของเครื่องที่ได้รับ'}
    <br>· กล้องต้องใช้ผ่าน HTTPS · ติดตั้งเป็นแอปได้จากเมนูเบราว์เซอร์ “เพิ่มไปยังหน้าจอหลัก”</p></section>`;
}
async function loadUsersInto() {
  const box = $('#users'); if (!box) return;
  const { data, error } = await sb.from('profiles').select('user_id,email,role').order('email');
  if (error) { box.innerHTML = `<p class="badge err">${esc(errMsg(error))}</p>`; return; }
  const me = state.session.user.id;
  box.innerHTML = data.map(u => `<div class="line"><div class="grow"><b>${esc(u.email || u.user_id)}</b>${u.user_id === me ? '<small>คุณ</small>' : ''}</div>
    <select data-role-user="${u.user_id}" style="width:auto;margin:0" ${u.user_id === me ? 'disabled' : ''}>${Object.entries(ROLE_T).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('');
}

const views = { request: viewRequest, requests: viewRequests, fulfill: viewFulfill, return: viewReturn, out: viewOut, stock: viewStock, history: viewHistory, settings: viewSettings };
function render() {
  document.body.classList.toggle('noauth', !state.session);
  if (state.session) fixView();
  renderNav();
  $('#app').innerHTML = !configured ? viewSetup() : !state.session ? viewLogin() : views[state.view]();
  window.scrollTo(0, 0);
  if (state.session && state.view === 'settings' && isIssuer()) loadUsersInto();
}
function go(v) {
  if (!state.session || !allowed(v)) return;
  state.view = v; render();
  if (v === 'settings') return;
  refresh().then(() => {
    if (state.view !== v) return;
    if (v === 'request') { const a = $('#modelPick'); if (a) a.innerHTML = modelPickHtml(); const p = $('#people'); if (p) p.innerHTML = peopleOpts(); const s = $('#reqSum'); if (s) s.innerHTML = reqSumHtml(); renderNav(); }
    else if (v === 'fulfill' && curReq()?.status === 'PENDING') { renderFul(); renderNav(); }
    else render();
  });
}

/* ---------- commits ---------- */
const submitReq = () => guarded(async () => {
  const r = state.req, items = reqLines();
  if (!r.person.trim()) return toast('กรุณาระบุผู้เบิก', true);
  if (!items.length) return toast('ยังไม่ได้เลือกรุ่นและจำนวน', true);
  const no = await rpc('req_create', { p_person: r.person, p_dept: r.dept, p_purpose: r.purpose, p_note: r.note, p_by: opName(), p_items: items });
  state.req = { person: isIssuer() ? '' : r.person, dept: isIssuer() ? '' : r.dept, purpose: '', note: '', qty: {} }; saveDraft();
  await refresh(); state.view = 'requests'; state.rq = 'PENDING'; render();
  toast('ส่งคำขอแล้ว ' + no); showReq(no);
});
function startFul(no) {
  const r = state.reqs.find(x => x.req_no === no);
  if (!r || r.status !== 'PENDING') return toast('คำขอนี้ไม่ได้รอจ่ายแล้ว', true);
  if (state.ful && state.ful.no !== no && state.ful.items.length && !confirm(`มีรายการสแกนค้างของคำขอ ${state.ful.no} (${state.ful.items.length} เครื่อง) — ทิ้งแล้วเริ่มคำขอนี้?`)) return;
  if (!state.ful || state.ful.no !== no) state.ful = { no, items: [], cur: r.request_items[0]?.model_id };
  saveDraft(); if (dlg().open) dlg().close(); go('fulfill');
}
const commitFul = () => guarded(async () => {
  const r = curReq(), f = state.ful;
  if (!r) return;
  if (!f.items.length) return toast('ยังไม่ได้สแกนเครื่อง', true);
  const t = reqQty(r);
  if (f.items.length < t && !confirm(`จ่าย ${f.items.length} จาก ${t} เครื่อง (ไม่ครบตามคำขอ)\nคำขอจะถูกปิดเป็น “จ่ายแล้ว” — ยืนยัน?`)) return;
  let doc;
  try { doc = await rpc('req_fulfill', { p_req_no: r.req_no, p_by: opName(), p_items: f.items }); }
  catch (e) { await refresh(); renderFul(); throw e; }
  state.ful = null; saveDraft();
  await refresh(); state.view = 'requests'; render(); toast('บันทึกการจ่าย ' + doc); showDoc(doc);
});
const commitReturn = () => guarded(async () => {
  const cart = state.cart.return;
  if (!cart.length) return toast('ยังไม่ได้สแกนเครื่องที่คืน', true);
  let doc;
  try { doc = await rpc('dev_return', { p_imeis: cart.map(l => l.imei), p_by: opName(), p_note: state.rnote.trim() }); }
  catch (e) { await refresh(); throw e; }
  state.cart.return = []; state.rnote = ''; state.retPerson = ''; saveDraft();
  await refresh(); render(); toast('บันทึกการคืน ' + doc); showDoc(doc);
});

/* ---------- dialogs ---------- */
const dlg = () => $('#dlg');
function showDialog(html) { dlg().innerHTML = html; if (!dlg().open) dlg().showModal(); }
function showReq(no) {
  const r = state.reqs.find(x => x.req_no === no); if (!r) return;
  const iss = r.status === 'ISSUED', mine = r.created_by === state.session?.user?.id, no_ = esc(r.req_no);
  showDialog(`<h2><span class="badge ${REQ_CLS[r.status]}">${REQ_T[r.status]}</span> คำขอ ${no_}</h2>
    <p>วันที่: ${fmt(r.created_at)}<br>ผู้เบิก: <b>${esc(r.person)}</b>${r.dept ? '<br>แผนก/งาน: ' + esc(r.dept) : ''}
    ${r.purpose ? '<br>วัตถุประสงค์: ' + esc(r.purpose) : ''}${r.note ? '<br>หมายเหตุ: ' + esc(r.note) : ''}<br>บันทึกโดย: ${esc(r.by_name || '-')}
    ${iss ? `<br>จ่ายเมื่อ ${fmt(r.issued_at)} โดย ${esc(r.issued_by || '-')} · ใบจ่าย <span class="code">${esc(r.issue_doc)}</span>` : ''}
    ${r.status === 'CANCELLED' ? `<br>ยกเลิกเมื่อ ${fmt(r.cancelled_at)}${r.cancelled_by ? ' โดย ' + esc(r.cancelled_by) : ''}` : ''}</p>
    <table><tr><th>รุ่น</th><th class="r">ขอ</th>${iss ? '<th class="r">จ่าย</th>' : ''}</tr>
    ${r.request_items.map(i => `<tr><td class="txt">${esc(i.model)}</td><td class="r">${i.qty}</td>${iss ? `<td class="r">${i.issued}</td>` : ''}</tr>`).join('')}</table>
    <p class="muted" style="margin-top:8px">รวม ${reqQty(r)} เครื่อง${iss ? ` · จ่ายจริง ${reqIssued(r)} เครื่อง` : ''}</p>
    ${iss ? '<div id="reqImeis"><p class="muted">กำลังโหลด IMEI...</p></div>' : ''}
    <div class="row" style="margin-top:12px"><button data-act="printReq" data-no="${no_}">🖨️ พิมพ์ใบขอเบิก</button>${iss ? `<button data-act="printDoc" data-no="${esc(r.issue_doc)}" data-mode="table">🖨️ พิมพ์ใบจ่าย</button>` : ''}</div>
    ${r.status === 'PENDING' && isIssuer() ? `<button class="primary big" data-act="startFul" data-no="${no_}" style="margin-top:0">📦 จ่ายเครื่องตามคำขอนี้</button>` : ''}
    ${r.status === 'PENDING' && (isIssuer() || mine) ? `<button class="danger big" data-act="cancelReq" data-no="${no_}">ยกเลิกคำขอ</button>` : ''}
    <button class="big" data-act="closeDlg">ปิด</button>`);
  if (iss) sb.from('loans').select('imei,model,returned_at').eq('req_no', r.req_no).order('id').then(({ data, error }) => {
    const box = $('#reqImeis'); if (!box) return;
    box.innerHTML = error ? `<p class="badge err">${esc(errMsg(error))}</p>` : data.length
      ? `<small style="margin-bottom:4px">IMEI ที่จ่าย</small><div class="chips" style="margin-top:0">${data.map(l => `<span class="chip" style="padding-right:8px" title="${esc(l.model)}">${esc(l.imei)}${l.returned_at ? ' ✓คืน' : ''}</span>`).join('')}</div>` : '';
  });
}
async function getDoc(no) {
  const d = state.docs.find(x => x.doc_no === no); if (d) return d;
  const { data, error } = await sb.from('documents').select('*, document_items(imei, model)').eq('doc_no', no).maybeSingle();
  if (error) throw error; return data;
}
async function showDoc(no) {
  let d; try { d = await getDoc(no); } catch (e) { return toast(errMsg(e), true); }
  if (!d) return;
  const iss = d.type === 'ISSUE';
  showDialog(`<h2>${iss ? 'ใบจ่าย' : 'ใบคืน'} · ${esc(d.doc_no)}</h2>
    <p>วันที่: ${fmt(d.created_at)}<br>${iss ? 'ผู้เบิก' : 'ผู้คืน'}: <b>${esc(d.person || '-')}</b>${d.dept ? '<br>แผนก/งาน: ' + esc(d.dept) : ''}
    ${d.purpose ? '<br>วัตถุประสงค์: ' + esc(d.purpose) : ''}${d.note ? '<br>หมายเหตุ: ' + esc(d.note) : ''}${d.req_no ? '<br>อ้างอิงคำขอ: <span class="code">' + esc(d.req_no) + '</span>' : ''}<br>บันทึกโดย: ${esc(d.by_name || '-')}</p>
    <table><tr><th>IMEI</th><th>รุ่น</th>${iss && isIssuer() ? '<th class="r">สถานะ</th>' : ''}</tr>
    ${d.document_items.map(i => `<tr><td>${esc(i.imei)}</td><td>${esc(i.model || '-')}</td>${iss && isIssuer() ? `<td class="r">${state.openMap.get(i.imei)?.issue_doc === d.doc_no ? '<span class="badge warn">ค้าง</span>' : '<span class="badge ok">คืนแล้ว</span>'}</td>` : ''}</tr>`).join('')}</table>
    <p class="muted" style="margin-top:8px">รวม ${d.document_items.length} เครื่อง</p>
    <div class="row" style="margin-top:12px"><button data-act="printDoc" data-no="${esc(d.doc_no)}" data-mode="table">🖨️ พิมพ์ทั้งใบ</button><button data-act="printDoc" data-no="${esc(d.doc_no)}" data-mode="slip">🖨️ แยกทีละเครื่อง</button></div>
    <button class="primary big" data-act="closeDlg" style="margin-top:0">ปิด</button>`);
}
function stockDlg(id) {
  const m = state.modelMap.get(+id); if (!m) return;
  showDialog(`<h2>ปรับสต็อก · ${esc(m.name)}</h2>
    <p>คงเหลือปัจจุบัน <b class="bignum">${num(m.stock)}</b> เครื่อง</p>
    <label>จำนวน<input id="adjQty" type="number" inputmode="numeric" min="0" placeholder="0"></label>
    <label>หมายเหตุ (เช่น รับเข้าจากซัพพลายเออร์, ตรวจนับประจำเดือน)<input id="adjNote"></label>
    <div class="row"><button class="primary" data-act="adjust" data-id="${m.id}" data-mode="add">＋ รับเข้า</button><button data-act="adjust" data-id="${m.id}" data-mode="sub">− ตัดออก</button></div>
    <button style="width:100%" data-act="adjust" data-id="${m.id}" data-mode="set">ตั้งยอดคงเหลือเป็นจำนวนนี้ (ตรวจนับ)</button>
    <h2 style="margin-top:20px;font-size:15px">ความเคลื่อนไหวล่าสุด</h2><div id="moves"><p class="muted">กำลังโหลด...</p></div>
    <button class="big" data-act="closeDlg">ปิด</button>`);
  setTimeout(() => $('#adjQty')?.focus(), 60);
  sb.from('stock_moves').select('*').eq('model_id', m.id).order('created_at', { ascending: false }).limit(15).then(({ data, error }) => {
    const box = $('#moves'); if (!box) return;
    box.innerHTML = error ? `<p class="badge err">${esc(errMsg(error))}</p>` : !data.length ? '<p class="muted">ยังไม่มีรายการ</p>'
      : `<table><tr><th>วันที่</th><th>รายการ</th><th class="r">±</th><th class="r">คงเหลือ</th></tr>${data.map(x => `<tr><td>${fmt(x.created_at)}</td><td class="txt">${MOVE_T[x.reason] || x.reason}${x.ref ? ` <span class="code">${esc(x.ref)}</span>` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</td><td class="r" style="color:${x.delta < 0 ? 'var(--red)' : 'var(--grn)'}">${x.delta > 0 ? '+' : ''}${x.delta}</td><td class="r">${x.balance ?? ''}</td></tr>`).join('')}</table>`;
  });
}
function modelDlg(id) {
  const m = state.modelMap.get(+id); if (!m) return;
  showDialog(`<h2>แก้ไขรุ่น</h2>
    <label>ชื่อรุ่น<input id="mName" value="${esc(m.name)}"></label>
    <label class="chk"><input type="checkbox" id="mActive" ${m.active ? 'checked' : ''}> เปิดใช้งาน (แสดงให้ผู้เบิกเลือก)</label>
    <button class="primary big" data-act="saveModel" data-id="${m.id}">บันทึก</button><button class="big" data-act="closeDlg">ยกเลิก</button>`);
}

/* ---------- พิมพ์เอกสาร (A4) ---------- */
const PRINT_MARK = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="4" rx="1" fill="#ffc20e"/><rect x="4.5" y="9.6" width="15" height="10.4" rx="1" fill="#ffc20e"/><rect x="4.5" y="9.6" width="15" height="2.8" fill="#ffdf73"/><rect x="10" y="13.8" width="4" height="2.2" fill="#101820"/></svg>';
const imeiFmt = s => /^\d{15}$/.test(s) ? `${s.slice(0, 2)} ${s.slice(2, 8)} ${s.slice(8, 14)} ${s.slice(14)}` : s;
function metaGrid(cells, cols = 3) {
  const norm = cells.filter(x => x[1] && !x[2]), wide = cells.filter(x => x[1] && x[2]);
  const cell = ([k, v], cls = '') => `<div class="${cls}"><span class="lbl">${k}</span><span class="val">${v}</span></div>`;
  const pad = (cols - norm.length % cols) % cols;
  return `<div class="meta c${cols}">${norm.map(x => cell(x)).join('')}${'<div></div>'.repeat(pad)}${wide.map(x => cell(x, 'w')).join('')}</div>`;
}
const sheetHead = ({ title, en, no, sub, status }) => `<header class="hd"><div class="brand"><div class="mark">${PRINT_MARK}</div><div>
  <div class="kicker">${en}${ORG ? ' · ' + esc(ORG) : ''}</div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>
  <div class="docno"><small>เลขที่เอกสาร</small><div class="v">${esc(no)}</div>${status || ''}</div></header>`;
const signBox = (a, b) => `<div class="sign">${[a, b].map(t => `<div><div class="ttl">${t}</div><div class="ln"></div>
  <div class="nm"><span>( ........................................ )</span><span>วันที่ ____ / ____ / ______</span></div></div>`).join('')}</div>`;
const PRINT_CSS = `@page{size:A4;margin:13mm 13mm 15mm;@bottom-right{content:"หน้า " counter(page) " / " counter(pages);font:9.5px "IBM Plex Sans Thai",sans-serif;color:#8a96a0}}
*{box-sizing:border-box}
:root{--ink:#101820;--mut:#6b7782;--line:#e1e5e9;--soft:#f5f7f8;--yel:#ffc20e}
body{font:12.5px/1.6 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;color:var(--ink);margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mono,.imei,.docno .v,.kicker,td.n,.pill b,.q{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}
.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:16px;border-bottom:1px solid var(--line);position:relative}
.hd::after{content:"";position:absolute;left:0;bottom:-1px;width:64px;height:3px;background:var(--yel);border-radius:2px}
.brand{display:flex;gap:14px;align-items:center}
.mark{width:48px;height:48px;border-radius:13px;background:var(--ink);display:grid;place-items:center;flex:none}
.mark svg{width:28px;height:28px}
.kicker{font-weight:500;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--mut);margin-bottom:5px}
h1{font-size:25px;line-height:1.1;margin:0;font-weight:700;letter-spacing:-.01em}
.sub{color:var(--mut);font-size:12px;margin-top:4px}
.docno{text-align:right;flex:none}
.docno small{display:block;color:var(--mut);font-size:10.5px;margin-bottom:5px}
.docno .v{font-weight:600;font-size:17px;letter-spacing:.02em;background:var(--yel);padding:5px 12px;border-radius:8px;display:inline-block}
.st{margin-top:7px}
.pst{display:inline-block;font-size:10.5px;font-weight:600;padding:2px 10px;border-radius:99px;border:1px solid var(--line)}
.pst.s-PENDING{background:#fff4cc;border-color:#f2d16b;color:#7a5600}.pst.s-ISSUED{background:#dff3ec;border-color:#a9dcc9;color:#0d7a5f}.pst.s-CANCELLED{color:var(--mut)}
.meta{display:grid;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:18px 0}
.meta.c3{grid-template-columns:repeat(3,1fr)}.meta.c2{grid-template-columns:repeat(2,1fr)}.meta.c1{grid-template-columns:1fr}
.meta>div{background:#fff;padding:8px 14px 9px;min-height:20px}
.meta>div.w{grid-column:1/-1}
.lbl{display:block;font-size:10px;color:var(--mut);letter-spacing:.02em;margin-bottom:1px}
.val{font-weight:600;font-size:13px}
.sumrow{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:99px;padding:3px 4px 3px 12px;font-weight:500;font-size:12px;background:#fff}
.pill b{background:var(--ink);color:#fff;border-radius:99px;padding:0 9px;font-size:11px;font-weight:600;line-height:19px}
table{width:100%;border-collapse:separate;border-spacing:0}
thead{display:table-header-group}
th{font-size:10px;font-weight:600;color:var(--mut);text-align:left;padding:0 10px 7px;border-bottom:1.5px solid var(--ink);letter-spacing:.04em;white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
tr{break-inside:avoid}
td.n,th.n{width:38px;color:var(--mut);font-size:10.5px}
.r{text-align:right}
td.q{font-weight:600;font-size:14px}
.imei{font-weight:500;font-size:13px;letter-spacing:.05em;white-space:nowrap}
td.wr{border-bottom:1px solid var(--line)}
tr.grp td{background:var(--soft);font-weight:700;font-size:11.5px;padding:6px 10px;border-bottom:0}
tr.grp td span{color:var(--mut);font-weight:500}
.total{display:flex;justify-content:flex-end;align-items:baseline;gap:22px;margin-top:12px;color:var(--mut)}
.total b{font-size:20px;color:var(--ink);font-family:"IBM Plex Mono",monospace;margin:0 3px}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:34px;break-inside:avoid}
.sign>div{border:1px solid var(--line);border-radius:12px;padding:12px 16px 10px}
.sign .ttl{font-size:10.5px;color:var(--mut);font-weight:600}
.sign .ln{border-bottom:1px dashed #9aa5ae;height:40px;margin-bottom:6px}
.sign .nm{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;color:var(--mut)}
.slip{border:1px solid var(--line);border-left:5px solid var(--yel);border-radius:14px;padding:14px 18px 14px;break-inside:avoid;page-break-inside:avoid}
.slip .hd{padding-bottom:10px}.slip .mark{width:38px;height:38px;border-radius:10px}.slip .mark svg{width:22px;height:22px}
.slip h1{font-size:19px}.slip .docno .v{font-size:14px;padding:3px 10px}
.slipbody{display:grid;grid-template-columns:1.15fr 1fr;gap:12px;margin-top:12px}
.slipbody .meta{margin:0}
.dev{background:#fffaeb;border:1px solid #f2d16b;border-radius:12px;padding:10px 14px}
.dev b{display:block;font-size:16px;margin-bottom:6px}.dev b.imei{font-size:19px;margin:0}
.slip .sign{margin-top:14px}.slip .sign .ln{height:30px}
.cut{display:flex;align-items:center;gap:8px;color:#b6bec5;font-size:11px;margin:9px 0}
.cut::before,.cut::after{content:"";flex:1;border-top:1px dashed #c9d0d6}
.foot{margin-top:18px;color:#9aa5ae;font-size:10px;display:flex;justify-content:space-between}`;
function openWin() {
  const w = window.open('', '_blank');
  if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์', true); return null; }
  w.document.write('<p style="font:16px system-ui;padding:24px">กำลังเตรียมเอกสาร...</p>');
  return w;
}
function writePrint(w, no, body) {
  const safe = String(no).replace(/[^\w-]/g, '');
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${safe}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">
  <style>${PRINT_CSS}@page{@bottom-left{content:"${safe}";font:9.5px "IBM Plex Mono",monospace;color:#8a96a0}}</style></head><body>${body}
  <div class="foot"><span>${ORG ? esc(ORG) + ' · ' : ''}ระบบเบิก/คืนเครื่อง</span><span>พิมพ์เมื่อ ${esc(new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
  <script>(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(()=>setTimeout(()=>print(),300));<\/script></body></html>`);
  w.document.close();
}
function printReq(no) {
  const r = state.reqs.find(x => x.req_no === no); if (!r) return;
  const w = openWin(); if (!w) return;
  const iss = r.status === 'ISSUED';
  const body = `<section>${sheetHead({ title: 'ใบขอเบิกเครื่อง', en: 'Device Request', no: r.req_no, sub: `${r.request_items.length} รุ่น · ${reqQty(r)} เครื่อง`, status: `<div class="st"><span class="pst s-${r.status}">${REQ_T[r.status]}</span></div>` })}
    ${metaGrid([['ผู้เบิก', esc(r.person)], ['แผนก / งาน', esc(r.dept)], ['วันที่ขอ', dtLong(r.created_at)], ['ผู้บันทึก', esc(r.by_name)], ['ใบจ่ายอ้างอิง', iss ? esc(r.issue_doc) : ''], ['จ่ายเมื่อ', iss ? dtLong(r.issued_at) : ''], ['วัตถุประสงค์', esc(r.purpose), 1], ['หมายเหตุ', esc(r.note), 1]])}
    <table><thead><tr><th class="n">#</th><th>รุ่นเครื่อง</th><th class="r" style="width:15%">จำนวนที่ขอ</th><th class="r" style="width:15%">จ่ายจริง</th><th style="width:26%">หมายเหตุ</th></tr></thead><tbody>
    ${r.request_items.map((i, k) => `<tr><td class="n">${String(k + 1).padStart(2, '0')}</td><td><b>${esc(i.model)}</b></td><td class="r q">${i.qty}</td><td class="r q">${iss ? i.issued : ''}</td><td></td></tr>`).join('')}</tbody></table>
    <div class="total"><span>จำนวนที่ขอ<b>${reqQty(r)}</b>เครื่อง</span>${iss ? `<span>จ่ายจริง<b>${reqIssued(r)}</b>เครื่อง</span>` : ''}</div>
    ${signBox('ผู้ขอเบิก', 'ผู้อนุมัติ / ผู้จ่ายเบิก')}</section>`;
  writePrint(w, r.req_no, body);
}
async function printDoc(no, mode = 'table') {
  const w = openWin(); if (!w) return;
  let d; try { d = await getDoc(no); } catch (e) { w.close(); return toast(errMsg(e), true); }
  if (!d) { w.close(); return toast('ไม่พบเอกสาร', true); }
  const iss = d.type === 'ISSUE', title = iss ? 'ใบจ่ายเครื่อง' : 'ใบรับคืนเครื่อง', en = iss ? 'Device Issue Note' : 'Device Return Note';
  const items = [...d.document_items].sort((a, b) => (a.model || '').localeCompare(b.model || '', 'th')), n = items.length;
  const groups = new Map(); items.forEach(i => { const k = i.model || '-'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  const who = iss ? 'ผู้เบิก / ผู้รับเครื่อง' : 'ผู้คืนเครื่อง';
  const sign = iss ? signBox('ผู้รับเครื่อง', 'ผู้จ่ายเครื่อง') : signBox('ผู้คืนเครื่อง', 'ผู้รับคืน');
  let body;
  if (mode === 'slip') {
    body = items.map((it, k) => `<section class="slip">${sheetHead({ title, en, no: d.doc_no, sub: `เครื่องที่ ${k + 1} / ${n}` })}
      <div class="slipbody"><div class="dev"><span class="lbl">รุ่นเครื่อง</span><b>${esc(it.model || '-')}</b><span class="lbl">IMEI / ซีเรียล</span><b class="imei">${esc(imeiFmt(it.imei))}</b></div>
      ${metaGrid([[who, esc(d.person)], ['แผนก / งาน', esc(d.dept)], ['วันที่', dtLong(d.created_at)]], 1)}</div>${sign}</section>`).join('<div class="cut">✂</div>');
  } else {
    let k = 0;
    body = `<section>${sheetHead({ title, en, no: d.doc_no, sub: `${n} เครื่อง · ${groups.size} รุ่น` })}
      ${metaGrid([[who, esc(d.person)], ['แผนก / งาน', esc(d.dept)], ['วันที่', dtLong(d.created_at)], ['ผู้บันทึก', esc(d.by_name)], ['อ้างอิงคำขอ', esc(d.req_no)], ['วัตถุประสงค์', esc(d.purpose), 1], ['หมายเหตุ', esc(d.note), 1]])}
      <div class="sumrow">${[...groups].map(([m, a]) => `<span class="pill">${esc(m)}<b>${a.length}</b></span>`).join('')}</div>
      <table><thead><tr><th class="n">#</th><th>IMEI / ซีเรียล</th><th>รุ่นเครื่อง</th><th style="width:30%">สภาพ / หมายเหตุ</th></tr></thead><tbody>
      ${[...groups].map(([m, a]) => (groups.size > 1 ? `<tr class="grp"><td colspan="4">${esc(m)} <span>· ${a.length} เครื่อง</span></td></tr>` : '')
        + a.map(it => `<tr><td class="n">${String(++k).padStart(2, '0')}</td><td class="imei">${esc(imeiFmt(it.imei))}</td><td>${esc(it.model || '-')}</td><td></td></tr>`).join('')).join('')}
      </tbody></table>
      <div class="total"><span>รวมทั้งสิ้น<b>${n}</b>เครื่อง</span></div>${sign}</section>`;
  }
  writePrint(w, d.doc_no, body);
}

/* ---------- actions ---------- */
const actions = {
  scan: d => openScanner(code => addImei(d.k, code), { multi: true }),
  del: d => { state.cart.return = state.cart.return.filter(x => x.imei !== d.imei); renderCart(); saveDraft(); },
  addBulk: d => {
    const ta = $('#bulk-' + d.k); if (!ta) return;
    const bad = [];
    ta.value.split(/[\s,;]+/).filter(Boolean).forEach(x => { if (addImei(d.k, x).startsWith('✗')) bad.push(x); });
    ta.value = bad.join('\n');
    toast(bad.length ? `เพิ่มไม่ได้ ${bad.length} รายการ (เหลือไว้ในช่องวาง)` : 'เพิ่มรายการแล้ว', !!bad.length);
  },
  addPerson: () => {
    if (!state.retPerson) return toast('เลือกผู้เบิกก่อน', true);
    let n = 0;
    state.open.filter(l => l.person === state.retPerson).forEach(l => { if (!state.cart.return.some(x => x.imei === l.imei)) { state.cart.return.push({ imei: l.imei, model: l.model, person: l.person }); n++; } });
    renderCart(); saveDraft(); toast(n ? `เพิ่ม ${n} เครื่อง` : 'เครื่องของคนนี้อยู่ในรายการครบแล้ว');
  },
  retOne: d => {
    const r = addReturn(d.imei);
    if (r.startsWith('✗') && !r.includes('ซ้ำ')) return toast(r, true);
    go('return'); toast(r.startsWith('✗') ? 'เครื่องนี้อยู่ในรายการคืนแล้ว' : 'ใส่ในรายการคืนแล้ว');
  },
  qty: d => setQty(+d.id, (state.req.qty[d.id] || 0) + +d.d),
  submitReq, commitFul, commitReturn,
  setRq: d => { state.rq = d.s; document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.s === d.s)); renderReqList(); },
  viewReq: d => showReq(d.no),
  startFul: d => startFul(d.no),
  setCur: d => { state.ful.cur = +d.id; renderFul(); saveDraft(); },
  fulDel: d => { state.ful.items = state.ful.items.filter(x => x.imei !== d.imei); renderFul(); saveDraft(); },
  cancelReq: d => guarded(async () => {
    if (!confirm(`ยกเลิกคำขอ ${d.no}?`)) return;
    await rpc('req_cancel', { p_req_no: d.no, p_by: opName() });
    if (state.ful?.no === d.no) { state.ful = null; saveDraft(); }
    dlg().close(); await refresh(); render(); toast('ยกเลิกคำขอแล้ว');
  }),
  moreReqs: () => guarded(async () => { state.reqLimit += 200; await loadReqs(); renderReqList(); }),
  addModel: () => guarded(async () => {
    const name = state.newModel.trim(), qty = Math.floor(+state.newQty || 0);
    if (!name) return toast('กรุณาระบุชื่อรุ่น', true);
    if (qty < 0) return toast('สต็อกต้องไม่ติดลบ', true);
    await rpc('model_save', { p_id: null, p_name: name, p_active: true, p_stock: qty, p_by: opName() });
    state.newModel = ''; state.newQty = ''; await refresh(); render(); toast('เพิ่มรุ่น ' + name);
  }),
  stockDlg: d => stockDlg(d.id),
  modelDlg: d => modelDlg(d.id),
  adjust: d => guarded(async () => {
    const raw = $('#adjQty')?.value ?? '', q = Math.floor(+raw);
    if (raw === '' || !(q >= 0) || (d.mode !== 'set' && q === 0)) return toast('กรุณาใส่จำนวน', true);
    const bal = await rpc('stock_adjust', { p_model_id: +d.id, p_mode: d.mode, p_qty: q, p_note: $('#adjNote')?.value || '', p_by: opName() });
    dlg().close(); await loadModels(); renderStockList(); toast('บันทึกแล้ว — คงเหลือ ' + num(bal));
  }),
  saveModel: d => guarded(async () => {
    await rpc('model_save', { p_id: +d.id, p_name: $('#mName').value, p_active: $('#mActive').checked, p_stock: null, p_by: opName() });
    dlg().close(); await loadModels(); renderStockList(); toast('บันทึกรุ่นแล้ว');
  }),
  viewDoc: d => showDoc(d.no),
  printDoc: d => printDoc(d.no, d.mode),
  printReq: d => printReq(d.no),
  closeDlg: () => dlg().close(),
  reload: () => guarded(async () => { await refresh(); render(); toast(state.loadErr || 'โหลดข้อมูลแล้ว', !!state.loadErr); }),
  moreDocs: () => guarded(async () => { state.docsLimit += 300; await loadDocs(); renderHistoryList(); }),
  logout: async () => {
    if (!confirm('ออกจากระบบ?')) return;
    await sb.auth.signOut();
    Object.assign(state, { session: null, role: 'requester', view: '', open: [], openMap: new Map(), docs: [], reqs: [], models: [], modelMap: new Map() });
    render();
  },
  exportCsv: () => guarded(async () => {
    const rows = await fetchAll((a, b) => sb.from('loans').select('*').order('issued_at', { ascending: false }).order('id').range(a, b));
    const head = ['IMEI', 'รุ่น', 'ผู้เบิก', 'แผนก', 'วัตถุประสงค์', 'วันที่จ่าย', 'เลขที่คำขอ', 'เลขที่ใบจ่าย', 'ผู้จ่าย', 'สถานะ', 'วันที่คืน', 'เลขที่ใบคืน', 'ผู้รับคืน'];
    const lines = rows.map(l => [l.imei, l.model, l.person, l.dept, l.purpose, new Date(l.issued_at).toLocaleString('sv-SE'), l.req_no || '', l.issue_doc, l.issued_by,
      l.returned_at ? 'คืนแล้ว' : 'ค้างอยู่', l.returned_at ? new Date(l.returned_at).toLocaleString('sv-SE') : '', l.return_doc || '', l.returned_by || '']);
    download('loans-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + [head, ...lines].map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
  })
};

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-view]');
  if (nav) { go(nav.dataset.view); return; }
  const a = e.target.closest('[data-act]');
  if (a) actions[a.dataset.act]?.(a.dataset);
});
function onBind(e) {
  const t = e.target;
  if (t.dataset.qty) { if (e.type === 'input') setQty(+t.dataset.qty, t.value, false); else setQty(+t.dataset.qty, t.value); return; }
  if (t.dataset.roleUser && e.type === 'change') {
    guarded(async () => { try { await rpc('set_role', { p_user: t.dataset.roleUser, p_role: t.value }); toast('เปลี่ยนสิทธิ์แล้ว'); } catch (err) { loadUsersInto(); throw err; } });
    return;
  }
  const b = t.dataset.bind; if (!b) return;
  const v = t.type === 'checkbox' ? t.checked : t.value;
  const [o, k] = b.split('.');
  if (k) state[o][k] = v; else state[o] = v;
  if (b === 'outQ') renderOutList();
  else if (b === 'hq' || b === 'ht') renderHistoryList();
  else if (b === 'pq') renderReqList();
  else if (b === 'sq') renderStockList();
  else if (b === 'mq') { const p = $('#modelPick'); if (p) p.innerHTML = modelPickHtml(); }
  else if (b === 'operator') { try { localStorage.setItem('operator', v); } catch { } }
  if (b.startsWith('req.') || b === 'rnote' || b === 'retPerson') saveDraft();
}
document.addEventListener('input', onBind);
document.addEventListener('change', onBind);
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.classList?.contains('wedge')) return;
  e.preventDefault();
  const code = e.target.value.trim(); e.target.value = ''; if (!code) return;
  const r = addImei(e.target.dataset.k, code);
  beep(!r.startsWith('✗')); toast(r, r.startsWith('✗'));
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  const f = new FormData(e.target);
  guarded(async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) });
    if (error) return toast(/invalid login/i.test(error.message) ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : errMsg(error), true);
    state.session = data.session; state.view = ''; await refresh(); cleanDraft(); render();
  });
});
const setNet = () => { const n = $('#net'); n.textContent = navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์'; n.className = 'badge ' + (navigator.onLine ? 'ok' : 'warn'); };
addEventListener('online', setNet); addEventListener('offline', setNet);

/* ---------- boot ---------- */
(async () => {
  setNet();
  try { state.operator = localStorage.getItem('operator') || ''; } catch { }
  if (configured) {
    loadDraft();
    try { state.session = (await sb.auth.getSession()).data.session; } catch { }
    sb.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT') { state.session = null; render(); } else if (s) state.session = s; });
    if (state.session) { await refresh(); cleanDraft(); }
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
