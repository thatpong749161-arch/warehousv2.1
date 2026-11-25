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
const MOVE_T = { REG: 'ลง IMEI ของเดิม', SOLD: 'ขาย (ไม่คืนสต็อก)', INIT: 'ยอดเริ่มต้น', IN: 'รับเข้า', OUT: 'ตัดออก', SET: 'ตรวจนับ', ISSUE: 'จ่าย', RETURN: 'รับคืน' };
const ROLE_T = { requester: 'ผู้เบิก', issuer: 'ผู้จ่ายเบิก' };
const DRAFT_KEY = 'draft-v2';
const APP_VER = '2.7.1';
// เข้าระบบด้วย ID: ระบบแปลง ID เป็นอีเมลภายใน (ไม่มีการส่งอีเมลจริง) · พิมพ์อีเมลเต็มก็ยังใช้ได้ (บัญชีเดิม)
const ID_DOMAIN = 'loan.local';
const toEmail = id => { id = String(id || '').trim(); return id.includes('@') ? id.toLowerCase() : id.toLowerCase() + '@' + ID_DOMAIN; };
const showId = email => String(email || '').endsWith('@' + ID_DOMAIN) ? email.slice(0, -ID_DOMAIN.length - 1) : (email || '');
const ID_RE = /^[a-z0-9._-]{3,30}$/i;

/* ---------- Supabase ---------- */
const cfg = window.APP_CONFIG || {};
const ORG = cfg.ORG_NAME || '';
const ALLOW_SIGNUP = !/^(0|false|no)$/i.test(String(cfg.ALLOW_SIGNUP ?? '1'));
const configured = !!(window.supabase && /^https?:\/\//.test(cfg.SUPABASE_URL || '') && cfg.SUPABASE_ANON_KEY && !/YOUR_/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const state = {
  view: '', session: null, role: 'requester', me: { name: '', dept: '', username: '' }, authTab: 'login', signupOpen: true, operator: '', busy: false, loadErr: '',
  models: [], modelMap: new Map(), reqs: [], reqLimit: 200, anns: [], annEdit: null,
  acts: [], actQ: '', actM: '', act: { imei: '', model_id: null, model: '', color: '', note: '', info: '', auto: false },
  avail: new Map(), devMap: new Map(), tpl: {}, tplNew: [], imp: null, impMode: 'new', impCreate: true, rcv: { model_id: null, mode: 'new', items: [], note: '' }, rcvQ: '', imeiQ: '',
  open: [], openMap: new Map(), docs: [], docsLimit: 300,
  req: { person: '', dept: '', purpose: '', note: '', qty: {} },
  ful: null, // { no, items: [{ imei, model_id }], cur: model_id }
  cart: { return: [] }, rnote: '', retPerson: '', retQ: '', loose: false,
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
  hist: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6"/>',
  act: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M9 12.2l2.1 2.1L15 10.4"/>',
  news: '<path d="M3 10.5v3h2.5L12 18V6L5.5 10.5H3zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'
};
const NAV = {
  requester: [['request', 'ขอเบิก', 'req'], ['requests', 'คำขอของฉัน', 'list'], ['act', 'Activate', 'act'], ['news', 'ประกาศ', 'news']],
  issuer: [['requests', 'คำขอ', 'list'], ['return', 'รับคืน', 'ret'], ['out', 'ค้างอยู่', 'dev'], ['stock', 'สต็อก', 'box'], ['act', 'Activate', 'act'], ['news', 'ประกาศ', 'news'], ['history', 'ประวัติ', 'hist']]
};
const EXTRA = { requester: ['settings'], issuer: ['request', 'fulfill', 'receive', 'import', 'settings'] };
const allowed = v => NAV[state.role].some(x => x[0] === v) || EXTRA[state.role].includes(v);
const fixView = () => { if (!allowed(state.view)) state.view = NAV[state.role][0][0]; };

function renderNav() {
  const pend = state.reqs.filter(r => r.status === 'PENDING').length;
  const badge = { requests: pend, out: state.open.length, news: annUnseen() };
  const on = v => state.view === v || (v === 'requests' && state.view === 'fulfill') || (v === 'stock' && /^(receive|import)$/.test(state.view));
  $('#nav').innerHTML = state.session ? NAV[state.role].map(([v, t, i]) => `<button data-view="${v}" class="${on(v) ? 'on' : ''}" data-n="${badge[v] || ''}"><svg viewBox="0 0 24 24">${IC[i]}</svg><span>${t}</span></button>`).join('') : '';
  renderTicker();
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
  const t = $('#toast'), host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (t.parentNode !== host) host.appendChild(t); // ถ้ามีหน้าต่างเปิดอยู่ ต้องอยู่ในหน้าต่าง ไม่งั้นจะถูกบัง
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
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
const opName = () => state.operator.trim() || state.me.name || state.me.username || showId(state.session?.user?.email);
const daysSince = d => Math.max(0, Math.floor((Date.now() - new Date(d)) / 864e5));
const reqQty = r => r.request_items.reduce((a, i) => a + i.qty, 0);
const reqIssued = r => r.request_items.reduce((a, i) => a + (i.issued || 0), 0);
const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ req: state.req, ful: state.ful, ret: state.cart.return, rnote: state.rnote, retPerson: state.retPerson, rcv: state.rcv })); } catch { } };
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (!d) return;
    Object.assign(state.req, d.req || {}); state.req.qty = d.req?.qty || {};
    state.ful = d.ful || null; state.cart.return = d.ret || [];
    state.rnote = d.rnote || ''; state.retPerson = d.retPerson || '';
    if (d.rcv) state.rcv = Object.assign({ model_id: null, mode: 'new', items: [], note: '' }, d.rcv);
  } catch { }
}
function cleanDraft() {
  Object.keys(state.req.qty).forEach(id => { if (!state.modelMap.get(+id)?.active) delete state.req.qty[id]; else if (state.req.qty[id] > availOf(+id)) { const a = availOf(+id); if (a > 0) state.req.qty[id] = a; else delete state.req.qty[id]; } });
  state.rcv.items = (state.rcv.items || []).filter(x => !state.devMap.has(x) && !state.openMap.has(x));
  if (state.ful && (!isIssuer() || state.reqs.find(r => r.req_no === state.ful.no)?.status !== 'PENDING')) state.ful = null;
  state.cart.return = isIssuer() ? state.cart.return.filter(l => state.openMap.has(l.imei)) : [];
  saveDraft();
}

/* ---------- Excel (.xlsx) แบบเบา: เขียน/อ่านเองในเบราว์เซอร์ ไม่ต้องโหลดไลบรารี ---------- */
const XL = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const parts = [], cd = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), d = enc.encode(f.data), c = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, c, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, d);
      const e = new DataView(new ArrayBuffer(46));
      e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x0800, true); e.setUint16(14, 0x21, true);
      e.setUint32(16, c, true); e.setUint32(20, d.length, true); e.setUint32(24, d.length, true); e.setUint16(28, nm.length, true); e.setUint32(42, off, true);
      cd.push(new Uint8Array(e.buffer), nm);
      off += 30 + nm.length + d.length;
    }
    const size = cd.reduce((a, x) => a + x.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...cd, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const x = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // sheet: { name, widths:[...], rows:[[{v, s, n}]], freeze, validation:{sqref, formula} }  s = style index · n = ตัวเลข
  function sheetXml(sh) {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => { if (c == null) return ''; const ref = col(ci) + (ri + 1), st = c.s ? ` s="${c.s}"` : '';
      if (c.v === '' || c.v == null) return `<c r="${ref}"${st}/>`;
      return c.n ? `<c r="${ref}"${st}><v>${c.v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${x(c.v)}</t></is></c>`; }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + (sh.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '')
      + `<cols>${(sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData>`
      + (sh.validation ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${sh.validation.sqref}"><formula1>${x(sh.validation.formula)}</formula1></dataValidation></dataValidations>` : '')
      + `</worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font><font><b/><sz val="14"/><name val="Tahoma"/></font><font><sz val="10"/><color rgb="FF5D6A75"/><name val="Tahoma"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF101820"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF6D6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC9D0D6"/></left><right style="thin"><color rgb="FFC9D0D6"/></right><top style="thin"><color rgb="FFC9D0D6"/></top><bottom style="thin"><color rgb="FFC9D0D6"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  function workbook(sheets) {
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${x(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) }))
    ];
    return zip(files);
  }
  // ---- อ่าน .xlsx (รองรับไฟล์จาก Excel / Google Sheets / LibreOffice)
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf); let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('ไฟล์นี้ไม่ใช่ Excel (.xlsx)');
    const n = dv.getUint16(eocd + 10, true), ent = {}; let p = dv.getUint32(eocd + 16, true);
    for (let k = 0; k < n; k++) {
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      ent[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { m: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), lho: dv.getUint32(p + 42, true) };
      p += 46 + nl + el + cl;
    }
    return async name => {
      const e = ent[name]; if (!e) return null;
      const st = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true), data = u8.subarray(st, st + e.size);
      if (e.m === 0) return dec.decode(data);
      if (e.m !== 8) throw new Error('รูปแบบไฟล์ไม่รองรับ');
      if (typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้เปิด .xlsx ไม่ได้ — บันทึกเป็น CSV แล้วนำเข้าแทน');
      return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    };
  }
  const parse = t => new DOMParser().parseFromString(t, 'application/xml');
  const tags = (n, t) => [...n.getElementsByTagNameNS('*', t)];
  const colIdx = r => { const m = /^([A-Z]+)/.exec(r || ''); let n = 0; if (!m) return -1; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  // คืนค่า { sheets: [{name, rows:[[string]]}] }
  async function readXlsx(buf) {
    const read = await unzip(buf);
    const wb = parse(await read('xl/workbook.xml') || ''), rels = parse(await read('xl/_rels/workbook.xml.rels') || '');
    const ss = await read('xl/sharedStrings.xml'), shared = ss ? tags(parse(ss), 'si').map(si => tags(si, 't').map(t => t.textContent).join('')) : [];
    const target = {}; tags(rels, 'Relationship').forEach(r => target[r.getAttribute('Id')] = r.getAttribute('Target'));
    const out = [];
    for (const sh of tags(wb, 'sheet')) {
      const rid = sh.getAttribute('r:id') || [...sh.attributes].find(a => a.localName === 'id')?.value;
      let t = target[rid] || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      const xml = await read(t); if (!xml) continue;
      const rows = [];
      tags(parse(xml), 'row').forEach(r => {
        const ri = (+r.getAttribute('r') || rows.length + 1) - 1, row = [];
        tags(r, 'c').forEach((c, k) => {
          const ci = c.getAttribute('r') ? colIdx(c.getAttribute('r')) : k, ty = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '';
          let val = ty === 's' ? (shared[+v] ?? '') : ty === 'inlineStr' ? tags(c, 't').map(t => t.textContent).join('') : v;
          if ((!ty || ty === 'n') && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(val)) { const num = Number(val); if (Number.isInteger(num) && Math.abs(num) < 1e16) val = num.toFixed(0); }
          row[ci] = val;
        });
        rows[ri] = row;
      });
      out.push({ name: sh.getAttribute('name'), rows: Array.from(rows, r => Array.from(r || [], v => v ?? '')) });
    }
    return { sheets: out };
  }
  function readCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '', d = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return { sheets: [{ name: 'CSV', rows }] };
  }
  return { workbook, readXlsx, readCsv };
})();
const downloadBlob = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

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
async function loadAppConfig() {
  try { const { data } = await sb.rpc('app_config'); if (data) state.signupOpen = data.allow_signup !== false; } catch { }
}
async function loadRole() {
  const { data, error } = await sb.from('profiles').select('role,name,dept,username').eq('user_id', state.session.user.id).maybeSingle();
  if (error) throw error;
  state.role = data?.role === 'issuer' ? 'issuer' : 'requester';
  state.me = { name: data?.name || '', dept: data?.dept || '', username: data?.username || showId(state.session.user.email) };
}
// จำนวนพร้อมเบิก/ลง IMEI แล้ว ต่อรุ่น (ทุกคน) · รายการ IMEI ในคลัง (ผู้จ่ายเบิก)
async function loadAvail() {
  const { data, error } = await sb.rpc('model_avail');
  if (error) throw error;
  state.avail = new Map((data || []).map(r => [r.model_id, r]));
}
async function loadDevices() {
  const rows = await fetchAll((a, b) => sb.from('devices').select('imei,model_id').eq('status', 'IN_STOCK').order('imei').range(a, b));
  state.devMap = new Map(rows.map(d => [d.imei, d.model_id]));
}
const availOf = id => state.avail.get(id)?.avail ?? (state.modelMap.get(id)?.stock || 0);
const regOf = id => state.avail.get(id)?.registered ?? 0;
const unregOf = id => Math.max(0, (state.modelMap.get(id)?.stock || 0) - regOf(id));
async function loadActs() {
  state.acts = await fetchAll((a, b) => sb.from('activations').select('*').order('activated_at', { ascending: false }).order('id', { ascending: false }).range(a, b));
}
async function loadAnns() {
  const { data, error } = await sb.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  state.anns = data;
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
    const jobs = [loadModels(), loadReqs(), loadAppConfig(), loadAnns(), loadAvail(), loadActs()];
    if (isIssuer()) jobs.push(loadOpen(), loadDocs(), loadDevices()); else { state.open = []; state.openMap = new Map(); state.docs = []; state.devMap = new Map(); }
    await Promise.all(jobs); state.loadErr = '';
  } catch (e) { state.loadErr = errMsg(e); }
  fixView();
}
async function guarded(fn) {
  if (state.busy) return toast('กำลังบันทึก/โหลดข้อมูล รอสักครู่...');
  state.busy = true; document.body.classList.add('busy');
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('เซิร์ฟเวอร์ตอบช้าเกินไป — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (กดรีเฟรชเพื่อดูว่าบันทึกแล้วหรือยัง)')), 30000); });
  try { await Promise.race([fn(), timeout]); } catch (e) { toast(errMsg(e), true); }
  finally { clearTimeout(timer); state.busy = false; document.body.classList.remove('busy'); }
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
const addImei = (kind, raw) => kind === 'ful' ? addFul(raw) : kind === 'rcv' ? addRcv(raw) : kind === 'act' ? actScan(raw) : addReturn(raw);

const retLoans = () => state.retPerson ? state.open.filter(l => l.person === state.retPerson) : [];
const retMissing = () => { const got = new Set(state.cart.return.map(x => x.imei)); return retLoans().filter(l => !got.has(l.imei)); };
function addReturn(raw) {
  const s = normImei(raw), c = state.cart.return;
  if (!validImei(s)) return `✗ ${s} ไม่ใช่ IMEI ที่ถูกต้อง (15 หลัก)`;
  const loan = state.openMap.get(s);
  if (!loan) return `✗ ${s} ไม่ได้อยู่ในสถานะถูกเบิก`;
  if (!state.retPerson) { state.retPerson = loan.person; const w = $('#retWho'); if (w) w.innerHTML = retWhoHtml(); }
  else if (loan.person !== state.retPerson) return `✗ ${s} เป็นเครื่องของ ${loan.person} (ไม่ใช่ ${state.retPerson})`;
  if (c.some(x => x.imei === s)) return `✗ ยิง ${s} ซ้ำ`;
  c.push({ imei: s, model: loan.model, person: loan.person });
  renderRet(); saveDraft();
  return `✓ ${s}${loan.model ? ' · ' + loan.model : ''} (${c.length}/${retLoans().length})`;
}

/* จ่ายตามคำขอ: ยิงได้เลย — ระบบหารุ่นจาก IMEI ในสต็อกเอง (กันยิงผิดรุ่น)
   เครื่องเดิมที่ยังไม่ลง IMEI: ใส่ในรุ่นที่แตะเลือกไว้ (หรือรุ่นเดียวที่ยังมีของไม่ลง IMEI) */
const curReq = () => state.ful && state.reqs.find(r => r.req_no === state.ful.no);
const fulCnt = id => state.ful.items.filter(x => x.model_id === id).length;
const fulUnregUsed = id => state.ful.items.filter(x => x.model_id === id && x.unreg).length;
const mName = id => state.modelMap.get(id)?.name || '-';
function addFul(raw) {
  const r = curReq(); if (!r || r.status !== 'PENDING') return '✗ คำขอนี้ไม่ได้รอจ่ายแล้ว';
  const f = state.ful, s = normImei(raw), lines = r.request_items;
  if (!validImei(s)) return `✗ ${s} ไม่ใช่ IMEI ที่ถูกต้อง (15 หลัก)`;
  if (f.items.some(x => x.imei === s)) return `✗ ยิง ${s} ซ้ำ`;
  const loan = state.openMap.get(s);
  if (loan) return `✗ ${s} ถูกเบิกอยู่แล้ว (${loan.person})`;
  const nextCur = () => { f.cur = lines.find(l => fulCnt(l.model_id) < l.qty)?.model_id ?? f.cur; };
  const dev = state.devMap.get(s);
  if (dev != null) {
    const line = lines.find(l => l.model_id === dev);
    if (!line) return `✗ ${s} เป็นรุ่น ${mName(dev)} — ไม่อยู่ในคำขอนี้`;
    if (fulCnt(dev) >= line.qty) return `✗ ${s} รุ่น ${line.model} ครบ ${line.qty}/${line.qty} แล้ว`;
    f.items.push({ imei: s, model_id: dev });
    if (fulCnt(dev) >= line.qty) nextCur();
    renderFul(); saveDraft();
    return `✓ ${s} · ${line.model} (${fulCnt(dev)}/${line.qty})`;
  }
  // ไม่พบในสต็อก IMEI → ใช้ได้เฉพาะของเดิมที่ยังไม่ลง IMEI
  const cand = lines.filter(l => fulCnt(l.model_id) < l.qty && unregOf(l.model_id) - fulUnregUsed(l.model_id) > 0);
  if (!cand.length) return `✗ ${s} ไม่มีในสต็อก — รับเข้าสต็อกด้วย IMEI ก่อน (เมนูสต็อก)`;
  const line = cand.find(l => l.model_id === f.cur) || (cand.length === 1 ? cand[0] : null);
  if (!line) return `✗ ${s} ยังไม่ได้ลง IMEI — แตะเลือกรุ่นที่จะใส่ก่อน แล้วยิงใหม่`;
  f.items.push({ imei: s, model_id: line.model_id, unreg: true });
  if (fulCnt(line.model_id) >= line.qty) nextCur();
  renderFul(); saveDraft();
  return `✓ ${s} · ${line.model} (${fulCnt(line.model_id)}/${line.qty}) · เครื่องเดิมไม่ลง IMEI`;
}

const scanBox = (kind, bulk = true) => `
  <button class="primary big scanbtn" data-act="scan" data-k="${kind}"><i class="vfico"></i>สแกนด้วยกล้อง</button>
  <label style="margin-top:12px">เครื่องยิงบาร์โค้ด / พิมพ์ IMEI แล้วกด Enter
    <input class="wedge" data-k="${kind}" inputmode="numeric" placeholder="ยิง IMEI ที่นี่" autocomplete="off" enterkeyhint="done"></label>
  ${bulk ? `<details style="margin-bottom:10px"><summary class="muted" style="cursor:pointer">วางหลายเครื่องพร้อมกัน</summary>
    <textarea id="bulk-${kind}" rows="3" placeholder="คั่นด้วยบรรทัดหรือเว้นวรรค"></textarea>
    <button data-act="addBulk" data-k="${kind}" style="width:100%;margin-top:6px">เพิ่มรายการที่วาง</button></details>` : ''}
  <label class="chk"><input type="checkbox" data-bind="loose" ${state.loose ? 'checked' : ''}> ไม่ตรวจรูปแบบ IMEI (ใช้กับเลขซีเรียลอื่น)</label>`;

function retListHtml() {
  if (!state.retPerson) return '<p class="muted center" style="margin:6px 0">เลือกผู้เบิก หรือยิง IMEI ได้เลย — ระบบเลือกผู้เบิกให้เอง</p>';
  const list = retLoans(), got = new Set(state.cart.return.map(x => x.imei)), n = list.filter(l => got.has(l.imei)).length;
  const row = l => { const ok = got.has(l.imei); return `<div class="ri ${ok ? 'ok' : ''}"><span class="ck">${ok ? '✓' : ''}</span>
    <div class="grow"><b class="code">${esc(l.imei)}</b><small>${esc(l.model || '-')} · <span class="code">${esc(l.issue_doc)}</span>${l.last_note ? ` · <span class="warn-t">ค้างเพราะ: ${esc(l.last_note)}</span>` : ''}</small></div>
    ${ok ? `<button class="ghost" data-act="del" data-imei="${esc(l.imei)}" aria-label="ยกเลิกการยิง">✕</button>` : ''}</div>`; };
  return `<div class="retbar"><span>ยิงคืนแล้ว <b>${n}</b> / ${list.length} เครื่อง</span>${n === list.length && n ? '<span class="badge ok">ครบ</span>' : ''}</div>
    <div class="bar" style="margin:6px 0 10px"><i style="width:${list.length ? n / list.length * 100 : 0}%"></i></div>
    <div class="retlist">${[...list.filter(l => !got.has(l.imei)), ...list.filter(l => got.has(l.imei))].map(row).join('')}</div>`;
}
function retSumHtml() {
  const t = retLoans().length, n = state.cart.return.length;
  return t ? `<span>${esc(state.retPerson)}</span><b>${n} / ${t} เครื่อง</b>` : '<span>ยังไม่ได้เลือกผู้เบิก</span><b>0 เครื่อง</b>';
}
let retSig = '';
const retSignature = () => state.open.map(l => l.imei + '|' + l.person + '|' + (l.last_note || '')).sort().join(',');
function refreshReturnInPlace() {
  if (!$('#retWho')) return render();
  const sig = retSignature(); if (sig === retSig) return; // ข้อมูลไม่เปลี่ยน → ไม่แตะหน้าจอเลย
  retSig = sig;
  if (state.retPerson && !retPeople().has(state.retPerson)) { state.retPerson = ''; state.cart.return = []; }
  state.cart.return = state.cart.return.filter(x => state.openMap.has(x.imei));
  renderRetAll();
}
function renderRet() {
  const a = $('#retList'); if (a) a.innerHTML = retListHtml();
  const b = $('#retSum'); if (b) b.innerHTML = retSumHtml();
}

/* ---------- views ---------- */
function viewLogin() {
  const canSignup = ALLOW_SIGNUP && state.signupOpen, su = canSignup && state.authTab === 'signup';
  return `<section class="card" style="margin-top:20px">
    ${canSignup ? `<div class="seg"><button data-act="authTab" data-t="login" class="${su ? '' : 'on'}">เข้าสู่ระบบ</button><button data-act="authTab" data-t="signup" class="${su ? 'on' : ''}">สมัครใช้งาน</button></div>` : '<h2>เข้าสู่ระบบ</h2>'}
    ${su ? `<form id="signupForm">
      <label>ID ผู้ใช้ * <small style="display:inline">(อังกฤษ/ตัวเลข 3–30 ตัว ใช้ตอนเข้าระบบ)</small><input name="uid" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label>ชื่อ-นามสกุล * <small style="display:inline">(ใช้เป็นชื่อผู้เบิก)</small><input name="name" required></label>
      <label>แผนก / งาน<input name="dept"></label>
      <label>รหัสผ่าน * <small style="display:inline">(อย่างน้อย 6 ตัว)</small><input name="password" type="password" autocomplete="new-password" minlength="6" required></label>
      <label>ยืนยันรหัสผ่าน *<input name="password2" type="password" autocomplete="new-password" minlength="6" required></label>
      <button class="primary big" style="margin-top:4px">สมัครและเข้าใช้งาน</button>
    </form>
    <small style="margin-top:12px">สมัครแล้วเป็น “ผู้เบิก” · ผู้จ่ายเบิกเปลี่ยนสิทธิ์ให้ได้ในหน้าตั้งค่า</small>`
    : `<form id="loginForm">
      <label>ID ผู้ใช้ (หรืออีเมล)<input name="uid" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label>รหัสผ่าน<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="primary big" style="margin-top:4px">เข้าสู่ระบบ</button>
    </form>
    ${canSignup ? '<small style="margin-top:12px">ยังไม่มีบัญชี? กด “สมัครใช้งาน” ด้านบน</small>' : '<small style="margin-top:12px">ขอบัญชีได้จากผู้จ่ายเบิก</small>'}`}</section>
    <p class="muted center" style="font-size:12.5px">เวอร์ชัน ${APP_VER}</p>`;
}
const authErr = e => {
  const m = e?.message || String(e);
  if (/invalid login/i.test(m)) return 'ID หรือรหัสผ่านไม่ถูกต้อง';
  if (/already registered|already exists|duplicate/i.test(m)) return 'ID นี้มีคนใช้แล้ว — ลองชื่ออื่น';
  if (/signups? not allowed|signup is disabled/i.test(m)) return 'ระบบปิดการสมัครอยู่ — ผู้ดูแลต้องเปิด “Allow new users to sign up” ใน Supabase';
  if (/email not confirmed/i.test(m)) return 'บัญชียังไม่ยืนยัน — ผู้ดูแลต้องปิด “Confirm email” ใน Supabase';
  if (/password should be|weak password/i.test(m)) return 'รหัสผ่านสั้นหรือง่ายเกินไป (อย่างน้อย 6 ตัว)';
  if (/email address .* is invalid|invalid email/i.test(m)) return 'Supabase ไม่รับบัญชีนี้ (' + m + ')';
  if (/database error saving new user/i.test(m)) return 'บันทึกผู้ใช้ไม่สำเร็จ (ID อาจซ้ำ) — ลองชื่ออื่น';
  return errMsg(e);
};
const viewSetup = () => `<section class="card" style="margin-top:20px"><h2>ยังไม่ได้ตั้งค่า Supabase</h2>
  <p class="muted">ไม่พบ <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> (หรือโหลดไลบรารีไม่สำเร็จ)<br>
  บน Vercel: Settings → Environment Variables แล้ว Redeploy<br>ในเครื่อง: แก้ไฟล์ <code>public/config.js</code></p></section>`;
const errBanner = () => state.loadErr ? `<p class="badge err" style="display:block;white-space:normal;margin-bottom:12px">โหลดข้อมูลไม่สำเร็จ: ${esc(state.loadErr)}</p>` : '';
const peopleList = () => [...new Set([...state.reqs.map(r => r.person), ...state.open.map(l => l.person)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
const peopleOpts = () => peopleList().map(x => `<option value="${esc(x)}">`).join('');

/* ขอเบิก: เลือกรุ่น + จำนวน */
// ป้ายจำนวนพร้อมเบิก = คงเหลือ − ที่คำขออื่นจองไว้ · ขอได้ไม่เกินจำนวนนี้
const stockTag = id => { const n = availOf(id), a = state.avail.get(id);
  return `<span class="stk-tag ${n <= 0 ? 'out' : n <= 3 ? 'low' : 'ok'}">${n <= 0 ? 'หมด' : 'พร้อมเบิก ' + num(n)}${n > 0 && n <= 3 ? ' · ใกล้หมด' : ''}</span>`
    + (isIssuer() && a ? `<small class="stk-sub">คงเหลือ ${num(a.stock)}${a.reserved ? ` · จองแล้ว ${num(a.reserved)}` : ''}</small>` : ''); };
function modelPickHtml() {
  const q = state.mq.trim().toLowerCase();
  const ms = state.models.filter(m => m.active);
  if (!ms.length) return `<div class="empty"><i>📦</i><b>ยังไม่มีรุ่นเครื่องให้เลือก</b><span>${isIssuer() ? 'เพิ่มรุ่นได้ที่เมนู “สต็อก”' : 'ติดต่อผู้จ่ายเบิกให้เพิ่มรุ่น'}</span></div>`;
  const list = ms.filter(m => !q || m.name.toLowerCase().includes(q) || state.req.qty[m.id]);
  return list.sort((a, b) => (availOf(b.id) > 0) - (availOf(a.id) > 0)).map(m => { const n = state.req.qty[m.id] || 0, av = availOf(m.id); return `<div class="pick ${n ? 'on' : ''} ${av <= 0 && !n ? 'dis' : ''}" id="pk-${m.id}">
    <div class="nm">${esc(m.name)}${stockTag(m.id)}</div>
    <div class="step"><button data-act="qty" data-id="${m.id}" data-d="-1" aria-label="ลด">−</button><input type="number" inputmode="numeric" min="0" max="${av}" data-qty="${m.id}" value="${n || ''}" placeholder="0" ${av <= 0 && !n ? 'disabled' : ''} aria-label="จำนวน ${esc(m.name)}"><button data-act="qty" data-id="${m.id}" data-d="1" ${n >= av ? 'disabled' : ''} aria-label="เพิ่ม">+</button></div></div>`; }).join('')
    || '<p class="muted center">ไม่พบรุ่นที่ค้นหา</p>';
}
const reqLines = () => Object.entries(state.req.qty).filter(([id, n]) => n > 0 && state.modelMap.get(+id)?.active).map(([id, n]) => ({ model_id: +id, qty: n }));
function reqSumHtml() {
  const l = reqLines(), t = l.reduce((a, x) => a + x.qty, 0);
  return l.length ? `<span>${l.length} รุ่น</span><b>รวม ${t} เครื่อง</b>` : '<span>ยังไม่ได้เลือกรุ่น</span><b>0 เครื่อง</b>';
}
function setQty(id, n, syncInput = true) {
  n = Math.max(0, Math.min(999, Math.floor(+n || 0)));
  const av = availOf(+id);
  if (id && n > av) { n = av; syncInput = true; toast(av > 0 ? `${mName(+id)} พร้อมเบิกได้สูงสุด ${av} เครื่อง` : `${mName(+id)} หมดแล้ว`, true); }
  if (n) state.req.qty[id] = n; else delete state.req.qty[id];
  const row = $('#pk-' + id);
  if (row) { row.classList.toggle('on', n > 0); if (syncInput) row.querySelector('input').value = n || ''; const plus = row.querySelector('[data-d="1"]'); if (plus) plus.disabled = n >= av; }
  const s = $('#reqSum'); if (s) s.innerHTML = reqSumHtml();
  saveDraft();
}
function viewRequest() {
  const r = state.req;
  if (!isIssuer()) { if (!r.person) r.person = state.me.name || state.operator; if (!r.dept) r.dept = state.me.dept; }
  return errBanner() + (isIssuer() ? `<button class="ghost" data-view="requests" style="margin-bottom:8px">← กลับไปหน้าคำขอ</button>` : '')
  + `<section class="card"><h2>ข้อมูลผู้เบิก</h2>
    <label>ผู้เบิก *<input data-bind="req.person" value="${esc(r.person)}" list="people" autocomplete="off"></label>
    <datalist id="people">${peopleOpts()}</datalist>
    <label>แผนก / งาน<input data-bind="req.dept" value="${esc(r.dept)}"></label>
    <label>วัตถุประสงค์การใช้<input data-bind="req.purpose" value="${esc(r.purpose)}"></label>
    <label style="margin-bottom:0">หมายเหตุ<input data-bind="req.note" value="${esc(r.note)}"></label></section>
  <section class="card"><h2>เลือกรุ่นและจำนวน</h2>
    <p class="hint">ขอได้ไม่เกินจำนวน “พร้อมเบิก” ของแต่ละรุ่น</p>
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
  if (!list.length) return '<div class="empty"><i>🗂️</i><b>ไม่มีคำขอในหมวดนี้</b><span>ลองเปลี่ยนแท็บด้านบน หรือค้นหาด้วยคำอื่น</span></div>' + more;
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
      ${unregOf(l.model_id) ? `<small class="muted">ของเดิมไม่ลง IMEI ${unregOf(l.model_id) - fulUnregUsed(l.model_id)} เครื่อง — แตะการ์ดนี้ก่อนยิงเครื่องเหล่านั้น</small>` : ''}
      ${m && m.stock < l.qty ? `<small class="warn-t">⚠ คงเหลือในคลัง ${num(m.stock)}</small>` : ''}
      ${its.length ? `<div class="chips">${its.map(x => `<span class="chip ${x.unreg ? 'unreg' : ''}">${esc(x.imei)}<button data-act="fulDel" data-imei="${esc(x.imei)}" aria-label="ลบ">✕</button></span>`).join('')}</div>` : ''}
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
  <section class="card"><h2>ยิง IMEI ได้เลย</h2>
    <p class="hint">ยิงเครื่องไหนก็ได้ ไม่ต้องเรียงรุ่น — ระบบดูจาก IMEI ว่าเป็นรุ่นอะไร แล้วใส่ให้เอง · ยิงผิดรุ่นหรือเกินจำนวนระบบจะไม่รับ</p>
    <div id="fulLines">${fulLinesHtml()}</div>
    <div style="margin-top:14px">${scanBox('ful')}</div></section>
  <div class="cta"><div class="sum" id="fulSum">${fulSumHtml()}</div>
    <button class="primary big" data-act="commitFul">✅ ยืนยันจ่ายเครื่อง</button></div>`;
}

/* รับคืน: เลือกผู้เบิก → เห็น IMEI ทั้งหมด → ยิงอย่างเดียว */
function retPeople() {
  const by = new Map(); state.open.forEach(l => { const g = by.get(l.person) || { n: 0, oldest: l.issued_at }; g.n++; if (new Date(l.issued_at) < new Date(g.oldest)) g.oldest = l.issued_at; by.set(l.person, g); });
  return by;
}
// ผู้เบิก: เลือกแล้วโชว์ชื่อ + ปุ่มเปลี่ยน · ยังไม่เลือก โชว์การ์ดรายชื่อ (ปุ่มใหญ่ แตะง่าย ไม่ใช้ dropdown)
function retWhoHtml() {
  const by = retPeople();
  if (state.retPerson && by.has(state.retPerson)) return `<div class="who"><div class="grow"><small>ผู้เบิก</small><b>${esc(state.retPerson)}</b></div>
    <button data-act="retClear">เปลี่ยนผู้เบิก</button></div>`;
  if (!by.size) return '<p class="muted center" style="margin:0">ไม่มีเครื่องค้างอยู่</p>';
  return `<small style="margin-bottom:8px">แตะชื่อผู้เบิก หรือยิง IMEI ได้เลย — ระบบเลือกผู้เบิกให้เอง</small>
    ${by.size > 8 ? `<input data-bind="retQ" placeholder="ค้นหาชื่อผู้เบิก" value="${esc(state.retQ)}" autocomplete="off" style="margin:0 0 8px">` : ''}
    <div class="plist" id="plist">${plistHtml(by)}</div>`;
}
function plistHtml(by = retPeople()) {
  const q = state.retQ.trim().toLowerCase();
  const list = [...by].filter(([p]) => !q || p.toLowerCase().includes(q)).sort((a, b) => a[0].localeCompare(b[0], 'th'));
  return list.length ? list.map(([p, g]) => { const d = daysSince(g.oldest); return `<button class="pbtn" data-act="pickPerson" data-p="${esc(p)}">
    <b>${esc(p)}</b><span><i>${g.n}</i> เครื่อง${d >= 7 ? ` · <em>${d} วัน</em>` : ''}</span></button>`; }).join('') : '<p class="muted center" style="margin:4px 0">ไม่พบชื่อ</p>';
}
function renderRetAll() {
  const w = $('#retWho'); if (w) w.innerHTML = retWhoHtml();
  renderRet();
}
function viewReturn() {
  const by = retPeople();
  if (state.retPerson && !by.has(state.retPerson)) { state.retPerson = ''; state.cart.return = []; }
  retSig = retSignature();
  return errBanner() + `<section class="card"><h2>รับคืนเครื่อง</h2>
    <div id="retWho">${retWhoHtml()}</div>
    <label style="margin:12px 0 0">หมายเหตุ (เช่น สภาพเครื่อง)<input data-bind="rnote" value="${esc(state.rnote)}"></label></section>
  <section class="card"><h2>ยิง IMEI ที่คืน</h2>${scanBox('return', false)}
    <div id="retList" style="margin-top:12px">${retListHtml()}</div></section>
  <div class="cta"><div class="sum" id="retSum">${retSumHtml()}</div>
    <button class="primary big" data-act="commitReturn">✅ ยืนยันการรับคืน</button></div>`;
}

/* ค้างอยู่: รวมเป็นรายชื่อผู้เบิก */
function outGroups() {
  const q = state.outQ.trim().toLowerCase(), map = new Map();
  state.open.forEach(l => {
    let g = map.get(l.person);
    if (!g) map.set(l.person, g = { person: l.person, dept: l.dept, items: [], oldest: l.issued_at, docs: new Set(), models: new Map(), hit: !q, notes: 0 });
    g.items.push(l); g.docs.add(l.issue_doc); g.models.set(l.model || '-', (g.models.get(l.model || '-') || 0) + 1);
    if (new Date(l.issued_at) < new Date(g.oldest)) g.oldest = l.issued_at;
    if (l.last_note) g.notes++;
    if (q && [l.imei, l.model, l.person, l.dept, l.purpose, l.issue_doc, l.req_no].some(x => String(x || '').toLowerCase().includes(q))) g.hit = true;
  });
  return [...map.values()].filter(g => g.hit).sort((a, b) => new Date(a.oldest) - new Date(b.oldest));
}
function outListHtml() {
  const gs = outGroups();
  return gs.length ? gs.map(g => { const n = daysSince(g.oldest); return `<div class="card item doc t-ISSUE" data-act="personDlg" data-p="${esc(g.person)}"><div class="line" style="border:0;padding:0">
    <div class="grow"><b style="font-size:16.5px">${esc(g.person)}</b>${g.dept ? `<small>${esc(g.dept)}</small>` : ''}
      <small>${[...g.models].map(([m, c]) => `${esc(m)} ×${c}`).join(' · ')}</small>
      <small><span class="badge ${n >= 7 ? 'err' : 'warn'}">${n === 0 ? 'วันนี้' : 'นานสุด ' + n + ' วัน'}</span> · ${g.docs.size} ใบจ่าย${g.notes ? ` · <span class="warn-t">มีเหตุผลค้าง ${g.notes}</span>` : ''}</small></div>
    <div class="side"><b class="bignum">${g.items.length}</b><small>เครื่อง</small>
      <button class="primary sm" data-act="retPerson" data-p="${esc(g.person)}">รับคืน</button></div></div></div>`; }).join('')
    : '<div class="empty"><i>✅</i><b>ไม่มีเครื่องค้าง</b><span>ทุกเครื่องคืนครบแล้ว</span></div>';
}
const renderOutList = () => { const e = $('#outList'); if (e) e.innerHTML = outListHtml(); };
function viewOut() {
  const people = new Set(state.open.map(l => l.person)).size;
  return errBanner() + `<input data-bind="outQ" placeholder="ค้นหา ผู้เบิก / IMEI / รุ่น / เลขที่เอกสาร" value="${esc(state.outQ)}" style="margin-bottom:10px">
    <div class="stats"><div><b>${people}</b><small>ผู้เบิก</small></div><div><b>${num(state.open.length)}</b><small>เครื่องค้าง</small></div><div><b>${state.open.filter(l => daysSince(l.issued_at) >= 7).length}</b><small>เกิน 7 วัน</small></div></div>
    <div class="row"><button data-act="reload">🔄 รีเฟรช</button><button data-act="exportCsv">⬇️ ส่งออก CSV</button></div>
    <div id="outList">${outListHtml()}</div>`;
}
function personDlg(p) {
  const list = state.open.filter(l => l.person === p); if (!list.length) return;
  showDialog(`<h2>${esc(p)} · ค้าง ${list.length} เครื่อง</h2>
    <table><tr><th>IMEI</th><th>รุ่น</th><th class="r">วัน</th></tr>
    ${list.map(l => `<tr><td>${esc(l.imei)}<small style="font-family:var(--f)">${esc(l.issue_doc)}${l.last_note ? ` · <span class="warn-t">${esc(l.last_note)}</span>` : ''}</small></td><td class="txt">${esc(l.model || '-')}</td><td class="r">${daysSince(l.issued_at)}</td></tr>`).join('')}</table>
    <button class="primary big" data-act="retPerson" data-p="${esc(p)}">รับคืนจากคนนี้</button>
    <button class="big" data-act="closeDlg">ปิด</button>`);
}

/* สต็อก: จำนวนรวม + แยกที่ลง IMEI แล้ว / ของเดิมที่ยังไม่ลง */
function stockListHtml() {
  const q = state.sq.trim().toLowerCase();
  const out = new Map(); state.open.forEach(l => l.model_id && out.set(l.model_id, (out.get(l.model_id) || 0) + 1));
  const list = state.models.filter(m => !q || m.name.toLowerCase().includes(q)).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, 'th'));
  if (!list.length) return `<div class="empty"><b>${state.models.length ? 'ไม่พบรุ่นที่ค้นหา' : 'ยังไม่มีรุ่นเครื่อง'}</b>${state.models.length ? '' : '<span>เพิ่มรุ่นแรกได้จากฟอร์มด้านบน</span>'}</div>`;
  return list.map(m => { const a = state.avail.get(m.id) || {}, o = out.get(m.id) || 0, reg = regOf(m.id), un = unregOf(m.id), res = a.reserved || 0;
    return `<div class="card item stk ${m.active ? '' : 'off'}"><div class="line" style="border:0;padding:0">
    <div class="grow"><b class="stk-name">${esc(m.name)}</b> ${m.active ? '' : '<span class="badge">ปิดใช้งาน</span>'}
      <div class="stk-split"><span class="ok">📱 ลง IMEI ${num(reg)}</span>${un ? `<span class="warn">ยังไม่ลง IMEI ${num(un)}</span>` : ''}</div>
      <small>ถูกเบิกอยู่ ${o}${res ? ` · จองแล้ว ${res}` : ''}${res > m.stock ? ' · <b style="color:var(--red)">ไม่พอจ่าย</b>' : ''}</small></div>
    <div class="side"><b class="bignum ${m.stock <= 0 ? 'neg' : ''}">${num(m.stock)}</b><small>คงเหลือ</small></div></div>
    <div class="row stk-act"><button class="primary" data-act="rcvGo" data-id="${m.id}">📥 รับเข้า IMEI</button><button data-act="imeiDlg" data-id="${m.id}">📋 IMEI</button>
      <button data-act="stockDlg" data-id="${m.id}">± จำนวน</button><button data-act="modelDlg" data-id="${m.id}" aria-label="แก้ไขรุ่น">✎</button></div></div>`;
  }).join('');
}
const renderStockList = () => { const e = $('#stockList'); if (e) e.innerHTML = stockListHtml(); };
function viewStock() {
  const act = state.models.filter(m => m.active), tot = act.reduce((a, m) => a + m.stock, 0), reg = act.reduce((a, m) => a + regOf(m.id), 0);
  return errBanner() + `<div class="row" style="margin:0 0 14px"><button class="primary big" data-act="rcvGo" style="margin:0;flex:3">📥 รับเข้าสต็อก (ยิง IMEI)</button><button class="big" data-view="import" style="margin:0;flex:2">📄 Excel</button></div>
  <div class="stats"><div><b>${num(tot)}</b><small>คงเหลือทั้งหมด</small></div><div><b>${num(reg)}</b><small>ลง IMEI แล้ว</small></div><div><b>${num(state.open.length)}</b><small>ถูกเบิกอยู่</small></div></div>
  <details class="card" style="padding:12px 14px" ${state.models.length ? '' : 'open'}><summary style="cursor:pointer;font-weight:700">＋ เพิ่มรุ่นใหม่</summary>
    <div class="row" style="margin:10px 0 0"><label style="flex:2;margin:0">ชื่อรุ่น<input data-bind="newModel" value="${esc(state.newModel)}" placeholder="เช่น iPhone 15 128GB"></label>
    <label style="margin:0">จำนวนตั้งต้น<input data-bind="newQty" type="number" inputmode="numeric" min="0" value="${esc(state.newQty)}" placeholder="0"></label></div>
    <small style="margin-top:6px">ใส่ 0 แล้วค่อยกด “รับเข้า IMEI” ได้ · จำนวนตั้งต้นนับเป็นของเดิมที่ยังไม่ลง IMEI</small>
    <button class="primary big" data-act="addModel">＋ เพิ่มรุ่น</button></details>
  <input data-bind="sq" placeholder="🔍 ค้นหารุ่น" value="${esc(state.sq)}" style="margin:0 0 12px">
  <div id="stockList">${stockListHtml()}</div>`;
}

/* รับเข้าสต็อกด้วยการยิง IMEI */
function addRcv(raw) {
  const r = state.rcv, s = normImei(raw);
  if (!r.model_id || !state.modelMap.get(r.model_id)) return '✗ เลือกรุ่นก่อนยิง';
  if (!validImei(s)) return `✗ ${s} ไม่ใช่ IMEI ที่ถูกต้อง (15 หลัก)`;
  if (r.items.includes(s)) return `✗ ยิง ${s} ซ้ำ`;
  if (state.devMap.has(s)) return `✗ ${s} มีในสต็อกแล้ว (${mName(state.devMap.get(s))})`;
  const loan = state.openMap.get(s); if (loan) return `✗ ${s} ถูกเบิกอยู่ (${loan.person}) — ต้องรับคืนก่อน`;
  if (r.mode === 'register' && r.items.length >= unregOf(r.model_id)) return `✗ ของเดิมที่ยังไม่ลง IMEI ลงครบแล้ว (${unregOf(r.model_id)} เครื่อง)`;
  r.items.push(s); renderRcv(); saveDraft();
  return `✓ ${s} · ${mName(r.model_id)} (${r.items.length})`;
}
function rcvModelsHtml() {
  const q = state.rcvQ.trim().toLowerCase(), ms = state.models.filter(m => m.active && (!q || m.name.toLowerCase().includes(q)));
  return ms.length ? ms.map(m => `<button class="pbtn" data-act="rcvModel" data-id="${m.id}"><b>${esc(m.name)}</b><span>คงเหลือ <i>${num(m.stock)}</i>${unregOf(m.id) ? ` · <em>ไม่ลง IMEI ${unregOf(m.id)}</em>` : ''}</span></button>`).join('')
    : '<p class="muted center" style="margin:4px 0">ไม่พบรุ่น — เพิ่มรุ่นที่หน้าสต็อก</p>';
}
function rcvTopHtml() {
  const r = state.rcv, m = state.modelMap.get(r.model_id);
  if (!m) return `${state.models.filter(x => x.active).length > 8 ? `<input data-bind="rcvQ" placeholder="🔍 ค้นหารุ่น" value="${esc(state.rcvQ)}" autocomplete="off" style="margin:0 0 8px">` : ''}<div class="plist" id="rcvModels">${rcvModelsHtml()}</div>`;
  const un = unregOf(m.id);
  if (r.mode === 'register' && !un) r.mode = 'new';
  return `<div class="who"><div class="grow"><small>รุ่นที่รับเข้า</small><b>${esc(m.name)}</b><small>คงเหลือ ${num(m.stock)} · ลง IMEI แล้ว ${num(regOf(m.id))}${un ? ` · ยังไม่ลง ${num(un)}` : ''}</small></div><button data-act="rcvModel" data-id="">เปลี่ยนรุ่น</button></div>
    <div class="seg" style="margin:12px 0 4px"><button data-act="rcvMode" data-m="new" class="${r.mode === 'new' ? 'on' : ''}">📦 รับเข้าใหม่</button><button data-act="rcvMode" data-m="register" class="${r.mode === 'register' ? 'on' : ''}" ${un ? '' : 'disabled'}>🏷️ ลง IMEI ของเดิม${un ? ` (${un})` : ''}</button></div>
    <small>${r.mode === 'new' ? 'เครื่องเข้ามาใหม่ — สต็อกเพิ่มตามจำนวนที่ยิง' : 'เครื่องที่มีอยู่แล้วในสต็อกแต่ยังไม่มี IMEI — สต็อกไม่เปลี่ยน'}</small>`;
}
function rcvListHtml() {
  const it = state.rcv.items;
  return it.length ? `<div class="chips">${it.slice().reverse().map(x => `<span class="chip">${esc(x)}<button data-act="rcvDel" data-imei="${esc(x)}" aria-label="ลบ">✕</button></span>`).join('')}</div>` : '<p class="muted center" style="margin:6px 0">ยังไม่ได้ยิง IMEI</p>';
}
const rcvSumHtml = () => `<span>${state.rcv.model_id ? esc(mName(state.rcv.model_id)) : 'ยังไม่ได้เลือกรุ่น'}</span><b>${state.rcv.items.length} เครื่อง</b>`;
function renderRcv(top) {
  if (top) { const t = $('#rcvTop'); if (t) t.innerHTML = rcvTopHtml(); }
  const l = $('#rcvList'); if (l) l.innerHTML = rcvListHtml();
  const s = $('#rcvSum'); if (s) s.innerHTML = rcvSumHtml();
}
function viewReceive() {
  return errBanner() + `<button class="ghost" data-view="stock" style="margin-bottom:8px">← กลับไปหน้าสต็อก</button>
  <section class="card"><h2>รับเข้าสต็อกด้วย IMEI</h2><div id="rcvTop">${rcvTopHtml()}</div>
    <label style="margin:12px 0 0">หมายเหตุ (เช่น เลขที่ใบส่งของ / ผู้ส่ง)<input data-bind="rcv.note" value="${esc(state.rcv.note)}"></label></section>
  <section class="card"><h2>ยิง IMEI</h2>${scanBox('rcv')}<div id="rcvList" style="margin-top:12px">${rcvListHtml()}</div></section>
  <div class="cta"><div class="sum" id="rcvSum">${rcvSumHtml()}</div><button class="primary big" data-act="rcvCommit">📥 บันทึกรับเข้า</button></div>`;
}
function imeiDlg(id) {
  const m = state.modelMap.get(+id); if (!m) return;
  const list = [...state.devMap].filter(([, mid]) => mid === m.id).map(([i]) => i).sort();
  const q = state.imeiQ.trim().toUpperCase(), shown = list.filter(i => !q || i.includes(q));
  showDialog(`<h2>IMEI ในสต็อก · ${esc(m.name)}</h2>
    <p class="muted" style="margin-bottom:8px">ลง IMEI แล้ว <b>${list.length}</b> เครื่อง${unregOf(m.id) ? ` · ของเดิมยังไม่ลง ${unregOf(m.id)} เครื่อง` : ''}</p>
    ${list.length > 10 ? `<input id="imeiFind" placeholder="🔍 ค้นหา IMEI" value="${esc(state.imeiQ)}" autocomplete="off" style="margin:0 0 8px">` : ''}
    <div class="misslist" style="max-height:44vh;background:#fff;border-color:var(--line)">${shown.length ? shown.map(i => `<div class="mrow"><div class="grow"><b class="code">${esc(i)}</b></div><button class="danger" style="padding:4px 10px;font-size:13px" data-act="imeiRemove" data-imei="${esc(i)}" data-id="${m.id}">ตัดออก</button></div>`).join('') : '<p class="muted center" style="margin:6px 0">ยังไม่มี IMEI</p>'}</div>
    <button class="primary big" data-act="rcvGo" data-id="${m.id}">📥 รับเข้า IMEI รุ่นนี้</button>
    <button class="big" data-act="closeDlg">ปิด</button>`);
  const f = $('#imeiFind'); if (f) { f.oninput = () => { state.imeiQ = f.value; const pos = f.selectionStart; imeiDlg(id); const g = $('#imeiFind'); g?.focus(); g?.setSelectionRange(pos, pos); }; }
}

/* ---------- นำเข้า/ส่งออกตาราง IMEI (Excel) ---------- */
const tplTotal = () => Object.values(state.tpl).reduce((a, n) => a + n, 0) + state.tplNew.reduce((a, r) => a + r.qty, 0);
function tplListHtml() {
  const ms = state.models.filter(m => m.active);
  return (ms.length ? ms.map(m => { const n = state.tpl[m.id] || 0; return `<div class="pick ${n ? 'on' : ''}" id="tp-${m.id}"><div class="nm">${esc(m.name)}<small class="stk-sub">คงเหลือ ${num(m.stock)}${unregOf(m.id) ? ` · ยังไม่ลง IMEI ${unregOf(m.id)}` : ''}</small></div>
    <div class="step"><button data-act="tplQty" data-id="${m.id}" data-d="-1" aria-label="ลด">−</button><input type="number" inputmode="numeric" min="0" max="2000" data-tpl="${m.id}" value="${n || ''}" placeholder="0"><button data-act="tplQty" data-id="${m.id}" data-d="1" aria-label="เพิ่ม">+</button></div></div>`; }).join('') : '')
    + state.tplNew.map((r, i) => `<div class="pick on"><div class="nm">${esc(r.name)} <span class="badge pri">รุ่นใหม่</span></div><b class="bignum" style="font-size:18px">${r.qty}</b><button class="ghost" data-act="tplNewDel" data-i="${i}" aria-label="ลบ">✕</button></div>`).join('')
    + `<div class="row" style="margin:10px 0 0"><input id="tpNewName" placeholder="รุ่นใหม่ที่ยังไม่มีในระบบ (ถ้ามี)" style="flex:3;margin:0"><input id="tpNewQty" type="number" inputmode="numeric" min="1" placeholder="จำนวน" style="flex:1;margin:0"><button data-act="tplNewAdd" style="flex:0 0 auto">เพิ่ม</button></div>`;
}
function renderTpl() { const e = $('#tplList'); if (e) e.innerHTML = tplListHtml(); const t = $('#tplTotal'); if (t) t.textContent = tplTotal(); }
function exportTemplate() {
  const H = v => ({ v, s: 1 }), T = v => ({ v, s: 2 }), I = () => ({ v: '', s: 3 });
  const rows = [[H('ลำดับ'), H('รุ่น'), H('IMEI / ซีเรียล'), H('หมายเหตุ')]];
  let k = 0;
  const add = (name, n) => { for (let i = 0; i < n; i++) rows.push([{ v: ++k, s: 2, n: 1 }, T(name), I(), T('')]); };
  state.models.filter(m => state.tpl[m.id] > 0).forEach(m => add(m.name, state.tpl[m.id]));
  state.tplNew.forEach(r => add(r.name, r.qty));
  for (let i = 0; i < (k ? 10 : 50); i++) rows.push([{ v: ++k, s: 2, n: 1 }, T(''), I(), T('')]); // แถวว่างเผื่อเพิ่มเอง
  const names = [...state.models.filter(m => m.active).map(m => m.name), ...state.tplNew.map(r => r.name)];
  const guide = [[{ v: 'วิธีใช้ตารางรับเข้าสต็อก', s: 4 }], [], ...[
    '1) กรอก IMEI ในคอลัมน์ C (ช่องสีเหลือง) ทีละ 1 เครื่องต่อ 1 แถว — ยิงบาร์โค้ดลงช่องได้เลย',
    '2) คอลัมน์ B คือรุ่น ต้องตรงกับชื่อรุ่นในระบบ (เลือกจากรายการได้) · ใส่ชื่อรุ่นใหม่ได้ ระบบจะถามก่อนสร้าง',
    '3) แถวที่ไม่กรอก IMEI จะถูกข้ามไป ไม่ต้องลบ',
    '4) อย่าเปลี่ยนคอลัมน์ C เป็นตัวเลข (ให้เป็นข้อความ) เพื่อไม่ให้ Excel แปลงเลขยาวเป็น 3.57E+14',
    '5) บันทึกไฟล์ แล้วไปที่ แอป → สต็อก → นำเข้า/ส่งออก Excel → เลือกไฟล์นี้',
    `ไฟล์สร้างเมื่อ ${new Date().toLocaleString('th-TH')} · ระบบเบิก/คืนเครื่อง v${APP_VER}`].map(t => [{ v: t, s: 5 }])];
  const wb = XL.workbook([
    { name: 'กรอก IMEI', widths: [8, 34, 24, 26], rows, freeze: true, validation: names.length ? { sqref: `B2:B${rows.length + 500}`, formula: `'รายชื่อรุ่น'!$A$2:$A$${names.length + 1}` } : null },
    { name: 'รายชื่อรุ่น', widths: [40], rows: [[{ v: 'รุ่นในระบบ', s: 1 }], ...names.map(n => [{ v: n, s: 2 }])] },
    { name: 'วิธีใช้', widths: [110], rows: guide }
  ]);
  downloadBlob(`ตาราง-IMEI-${todayISO()}.xlsx`, wb);
  toast(`ดาวน์โหลดตาราง ${k} แถวแล้ว — กรอก IMEI แล้วนำเข้ากลับมา`);
}
// แปลงตารางเป็นรายการ {line, model, imei, note} — หาแถวหัวตารางที่มีคำว่า IMEI
function rowsToItems(book) {
  const sh = book.sheets.find(x => /imei/i.test(x.name)) || book.sheets.find(x => x.rows.some(r => (r || []).some(c => /imei/i.test(c)))) || book.sheets[0];
  if (!sh) throw new Error('ไม่พบข้อมูลในไฟล์');
  const rows = sh.rows; let h = rows.findIndex(r => (r || []).some(c => /imei|ซีเรียล|serial/i.test(String(c))));
  let ci = 2, cm = 1, cn = 3;
  if (h >= 0) { const r = rows[h].map(c => String(c || '')); ci = r.findIndex(c => /imei|ซีเรียล|serial/i.test(c)); cm = r.findIndex(c => /รุ่น|model/i.test(c)); cn = r.findIndex(c => /หมายเหตุ|note/i.test(c)); } else h = -1;
  const out = [];
  for (let i = h + 1; i < rows.length; i++) { const r = rows[i] || []; const imei = String(r[ci] ?? '').trim(), model = cm >= 0 ? String(r[cm] ?? '').trim() : '';
    if (!imei && !model) continue; out.push({ line: i + 1, model, imei, note: cn >= 0 ? String(r[cn] ?? '').trim() : '' }); }
  return { sheet: sh.name, items: out, noModelCol: cm < 0 };
}
function analyzeImport() {
  const im = state.imp; if (!im) return;
  const byName = new Map(state.models.map(m => [m.name.trim().toLowerCase(), m]));
  const seen = new Set(), groups = new Map(), problems = []; let blank = 0;
  im.items.forEach(it => {
    const raw = it.imei; if (!raw) { blank++; return; }
    const s = normImei(raw), key = it.model.toLowerCase(), m = byName.get(key);
    let why = '';
    if (/e\+?\d+$/i.test(raw.replace(/\s/g, '')) && /\./.test(raw)) why = 'Excel แปลงเป็นตัวเลขวิทยาศาสตร์ (ตั้งคอลัมน์ IMEI เป็นข้อความ)';
    else if (!validImei(s)) why = 'IMEI ไม่ถูกต้อง';
    else if (seen.has(s)) why = 'ซ้ำในไฟล์';
    else if (state.devMap.has(s)) why = `มีในสต็อกแล้ว (${mName(state.devMap.get(s))})`;
    else if (state.openMap.has(s)) why = `ถูกเบิกอยู่ (${state.openMap.get(s).person})`;
    else if (!it.model) why = 'ไม่ได้ระบุรุ่น';
    else if (!m && !state.impCreate) why = `ไม่มีรุ่น “${it.model}” ในระบบ`;
    if (why) { problems.push({ ...it, imei: s || raw, why }); return; }
    seen.add(s);
    const gk = m ? 'id:' + m.id : 'new:' + key;
    if (!groups.has(gk)) groups.set(gk, { model: m || null, name: m ? m.name : it.model, imeis: [], isNew: !m });
    groups.get(gk).imeis.push(s);
  });
  im.groups = [...groups.values()]; im.problems = problems; im.blank = blank;
  im.ok = im.groups.reduce((a, g) => a + g.imeis.length, 0);
  // โหมดลง IMEI ของเดิม: ต้องไม่เกินจำนวนที่ยังไม่ลง
  im.groups.forEach(g => { g.over = state.impMode === 'register' ? Math.max(0, g.imeis.length - (g.model ? unregOf(g.model.id) : 0)) : 0; });
}
function impPreviewHtml() {
  const im = state.imp; if (!im) return '';
  const over = im.groups.some(g => g.over);
  return `<div class="imp-file">📄 <b>${esc(im.fileName)}</b><small>ชีต “${esc(im.sheet)}” · ${im.items.length} แถว${im.blank ? ` · ข้ามแถวที่ไม่กรอก IMEI ${im.blank}` : ''}</small></div>
    ${im.groups.length ? `<table class="imp-t"><tr><th>รุ่น</th><th class="r">IMEI</th><th class="r">หลังนำเข้า</th></tr>${im.groups.map(g => { const st = g.model ? g.model.stock : 0, after = state.impMode === 'new' ? st + g.imeis.length : st;
      return `<tr><td class="txt">${esc(g.name)}${g.isNew ? ' <span class="badge pri">สร้างรุ่นใหม่</span>' : ''}${g.over ? `<small class="warn-t">ของเดิมไม่ลง IMEI มีแค่ ${g.model ? unregOf(g.model.id) : 0} — เกิน ${g.over}</small>` : ''}</td><td class="r">${g.imeis.length}</td><td class="r">${num(after)}</td></tr>`; }).join('')}</table>` : ''}
    ${im.problems.length ? `<details class="imp-bad" ${im.ok ? '' : 'open'}><summary><b>${im.problems.length} แถวมีปัญหา</b> — จะไม่ถูกนำเข้า (แตะเพื่อดู)</summary>
      <table class="imp-t">${im.problems.slice(0, 300).map(p => `<tr><td>แถว ${p.line}</td><td>${esc(p.imei)}</td><td class="txt">${esc(p.why)}</td></tr>`).join('')}</table>
      <button data-act="impBadExport" style="width:100%;margin-top:8px">⬇️ ดาวน์โหลดรายการที่มีปัญหา</button></details>` : ''}
    ${over ? '<p class="badge err" style="display:block;white-space:normal;margin-top:10px">โหมด “ลง IMEI ของเดิม” ยิงเกินจำนวนของเดิม — เปลี่ยนเป็น “รับเข้าใหม่” หรือแก้ไฟล์</p>' : ''}
    <div class="cta cta-static" style="margin-top:12px"><div class="sum"><span>${im.groups.length} รุ่น · ${im.problems.length ? `ข้าม ${im.problems.length}` : 'ไม่มีปัญหา'}</span><b>${im.ok} เครื่อง</b></div>
    <button class="primary big" data-act="impCommit" ${im.ok && !over ? '' : 'disabled'}>📥 นำเข้า ${im.ok} เครื่อง</button></div>`;
}
const renderImp = () => { analyzeImport(); const e = $('#impPreview'); if (e) e.innerHTML = impPreviewHtml(); };
function viewImport() {
  return errBanner() + `<button class="ghost" data-view="stock" style="margin-bottom:8px">← กลับไปหน้าสต็อก</button>
  <section class="card"><h2>① ดาวน์โหลดตารางไปกรอก IMEI</h2>
    <p class="hint">เลือกรุ่นและจำนวนเครื่อง → ดาวน์โหลดไฟล์ Excel ที่มีรุ่นใส่ไว้ให้แล้ว → กรอก/ยิง IMEI ลงคอลัมน์สีเหลือง</p>
    <div id="tplList">${tplListHtml()}</div>
    <button class="primary big" data-act="tplExport">⬇️ ดาวน์โหลดตาราง Excel (<span id="tplTotal">${tplTotal()}</span> แถว)</button>
    <small style="margin-top:6px">ไม่เลือกรุ่นก็ได้ — จะได้ตารางเปล่า 50 แถวไว้กรอกเอง</small></section>
  <section class="card"><h2>② นำเข้าไฟล์ที่กรอกแล้ว</h2>
    <div class="seg" style="margin-bottom:6px"><button data-act="impMode" data-m="new" class="${state.impMode === 'new' ? 'on' : ''}">📦 รับเข้าใหม่</button><button data-act="impMode" data-m="register" class="${state.impMode === 'register' ? 'on' : ''}">🏷️ ลง IMEI ของเดิม</button></div>
    <small style="margin-bottom:10px">${state.impMode === 'new' ? 'เครื่องเข้ามาใหม่ — สต็อกเพิ่มตามจำนวน IMEI' : 'เครื่องที่มีอยู่แล้วแต่ยังไม่มี IMEI — สต็อกไม่เปลี่ยน'}</small>
    <label class="chk" style="margin-bottom:10px"><input type="checkbox" id="impCreate" ${state.impCreate ? 'checked' : ''}> สร้างรุ่นใหม่ให้อัตโนมัติ ถ้าในไฟล์มีรุ่นที่ยังไม่มีในระบบ</label>
    <label class="filebtn">📂 เลือกไฟล์ (.xlsx หรือ .csv)<input type="file" id="impFile" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden></label>
    <div id="impPreview">${impPreviewHtml()}</div></section>`;
}
async function readImportFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const book = /\.csv$/i.test(file.name) || file.type === 'text/csv' ? XL.readCsv(new TextDecoder().decode(buf)) : await XL.readXlsx(buf);
    const r = rowsToItems(book);
    if (!r.items.length) throw new Error('ไม่พบแถวที่มีข้อมูล — ตรวจว่ามีคอลัมน์ IMEI');
    state.imp = { fileName: file.name, ...r };
    renderImp();
    toast(`อ่านไฟล์แล้ว ${r.items.length} แถว — ตรวจรายการก่อนกดนำเข้า`);
  } catch (e) { state.imp = null; renderImp(); toast('อ่านไฟล์ไม่ได้: ' + (e.message || e), true); }
}

/* ---------- Activate ---------- */
const actMine = a => a.created_by === state.session?.user?.id;
const recentColors = () => [...new Set(state.acts.map(a => a.color).filter(Boolean))].slice(0, 8);
function actFormHtml() {
  const f = state.act, colors = recentColors();
  return `<label>IMEI * <small style="display:inline">(ยิงบาร์โค้ด / พิมพ์แล้วกด Enter)</small>
      <div class="row" style="margin:4px 0 0;flex-wrap:nowrap"><input id="actImei" value="${esc(f.imei)}" inputmode="numeric" autocomplete="off" placeholder="ยิง IMEI ที่นี่" enterkeyhint="next" style="margin:0;flex:1;font-family:var(--mono)">
      <button data-act="scan" data-k="act" style="flex:0 0 auto" aria-label="สแกนด้วยกล้อง">📷</button></div></label>
    <div id="actInfo">${f.info}</div>
    <label>รุ่น *<input id="actModel" list="actModels" value="${esc(f.model)}" placeholder="ระบบเติมให้ถ้า IMEI อยู่ในสต็อก" autocomplete="off"></label>
    <datalist id="actModels">${state.models.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>
    <label>สี *<input id="actColor" list="actColors" value="${esc(f.color)}" placeholder="เช่น ดำ / ขาว / Titanium Blue" autocomplete="off"></label>
    <datalist id="actColors">${colors.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    ${colors.length ? `<div class="chips" style="margin:-4px 0 12px">${colors.map(c => `<button class="rchip" data-act="actColor" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    <label>หมายเหตุ<input id="actNote" value="${esc(f.note)}" placeholder="ไม่บังคับ"></label>
    <label class="chk" style="margin-bottom:12px"><input type="checkbox" id="actAuto" ${f.auto ? 'checked' : ''}> ยิงแล้วบันทึกทันที (ใช้รุ่นที่ระบบหาเจอ + สีที่กรอกไว้) — เหมาะกับ Activate หลายเครื่องสีเดียวกัน</label>
    <button class="primary big" data-act="actSave" style="margin-top:0">✅ บันทึก Activate</button>`;
}
// ตารางสรุป: ทุกรุ่นเรียงลงมา 1 บรรทัด/รุ่น (รวมรุ่นที่ยังไม่มีการ Activate) · แตะเพื่อดูเฉพาะรุ่นนั้น
function actSummaryHtml() {
  const today = todayISO(), cnt = new Map();
  state.acts.forEach(a => { const g = cnt.get(a.model) || { n: 0, t: 0 }; g.n++; if (new Date(a.activated_at).toLocaleDateString('sv-SE') === today) g.t++; cnt.set(a.model, g); });
  state.models.filter(m => m.active).forEach(m => { if (!cnt.has(m.name)) cnt.set(m.name, { n: 0, t: 0 }); });
  const rows = [...cnt].sort((a, b) => a[0].localeCompare(b[0], 'th'));
  if (!rows.length) return '<p class="muted center" style="margin:0">ยังไม่มีรุ่น</p>';
  return `<table class="sum-t"><thead><tr><th>รุ่น</th><th class="r">Activated</th><th class="r">วันนี้</th></tr></thead><tbody>
    <tr class="${state.actM ? '' : 'sel'}" data-act="actPick" data-m=""><td><b>ทุกรุ่น</b></td><td class="r"><b>${num(state.acts.length)}</b></td><td class="r">${num(rows.reduce((a, [, g]) => a + g.t, 0))}</td></tr>
    ${rows.map(([m, g]) => `<tr class="${state.actM === m ? 'sel' : ''} ${g.n ? '' : 'zero'}" data-act="actPick" data-m="${esc(m)}"><td>${esc(m)}</td><td class="r">${num(g.n)}</td><td class="r">${g.t ? num(g.t) : '–'}</td></tr>`).join('')}</tbody></table>`;
}
// รายการ IMEI แบบตารางแน่น จัดกลุ่มตามรุ่น
function actRowsHtml() {
  const q = state.actQ.trim().toLowerCase();
  const list = state.acts.filter(a => (!state.actM || a.model === state.actM) && (!q || [a.imei, a.model, a.color, a.by_name, a.note].some(x => String(x || '').toLowerCase().includes(q))));
  if (!list.length) return `<div class="empty"><i>📱</i><b>${state.acts.length ? 'ไม่พบรายการ' : 'ยังไม่มีเครื่องที่ Activate'}</b>${state.acts.length ? '<span>ลองล้างคำค้นหา หรือเลือก “ทุกรุ่น”</span>' : '<span>บันทึกเครื่องแรกจากฟอร์มด้านบน</span>'}</div>`;
  const groups = new Map(); list.slice(0, 1000).forEach(a => { if (!groups.has(a.model)) groups.set(a.model, []); groups.get(a.model).push(a); });
  const dt = d => new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<div class="act-tbl">${[...groups].sort((a, b) => a[0].localeCompare(b[0], 'th')).map(([m, arr]) => `
    <div class="act-gh"><b>${esc(m)}</b><span>${arr.length} เครื่อง</span></div>
    ${arr.map(a => `<div class="act-tr"><span class="ok-dot" title="Activated">✓</span><span class="imei-box"><span class="code imei">${esc(a.imei)}</span><span class="clr">🎨 ${esc(a.color)}</span></span>
      <span class="when">${dt(a.activated_at)}${a.by_name ? `<br>${esc(a.by_name)}` : ''}</span>
      ${isIssuer() || actMine(a) ? `<button class="ghost" data-act="actDel" data-id="${a.id}" data-imei="${esc(a.imei)}" aria-label="ลบ">✕</button>` : '<i></i>'}</div>`).join('')}`).join('')}</div>`
    + (list.length > 1000 ? `<p class="muted center">แสดง 1,000 จาก ${num(list.length)} — ใช้ช่องค้นหาเพื่อกรอง</p>` : '');
}
const renderActs = () => { const e = $('#actList'); if (e) e.innerHTML = actRowsHtml(); const c = $('#actCount'); if (c) c.innerHTML = actStatsHtml(); const t = $('#actSum'); if (t) t.innerHTML = actSummaryHtml(); };
function actStatsHtml() {
  const today = todayISO(), month = today.slice(0, 7), d = a => new Date(a.activated_at).toLocaleDateString('sv-SE');
  return `<div><b>${num(state.acts.length)}</b><small>Activate ทั้งหมด</small></div><div><b>${num(state.acts.filter(a => d(a) === today).length)}</b><small>วันนี้</small></div><div><b>${num(state.acts.filter(a => d(a).startsWith(month)).length)}</b><small>เดือนนี้</small></div>`;
}

function viewAct() {
  return errBanner() + `<div class="stats" id="actCount">${actStatsHtml()}</div>
  <section class="card"><h2>บันทึก Activate</h2><p class="hint">กรอกครบ รุ่น · IMEI · สี แล้วกดบันทึก = <b>Activated</b> ทันที</p><div id="actForm">${actFormHtml()}</div></section>
  <section class="card"><h2>สถานะ Activate แยกตามรุ่น</h2><div id="actSum">${actSummaryHtml()}</div></section>
  <section class="card" style="padding:14px 12px"><h2>รายการ IMEI</h2>
    <div class="row" style="margin:0 0 10px;flex-wrap:nowrap"><input data-bind="actQ" placeholder="🔍 ค้นหา IMEI / สี / ผู้บันทึก" value="${esc(state.actQ)}" style="margin:0;flex:1"><button data-act="actExport" style="flex:0 0 auto">⬇️ Excel</button></div>
    <div id="actList">${actRowsHtml()}</div></section>`;
}
// อ่านค่าจากฟอร์มเก็บไว้ (กันหายเวลาวาดฟอร์มใหม่)
function actReadForm() {
  const f = state.act, g = id => $(id)?.value ?? '';
  if ($('#actImei')) { f.imei = g('#actImei').trim(); f.model = g('#actModel').trim(); f.color = g('#actColor').trim(); f.note = g('#actNote').trim(); f.auto = !!$('#actAuto')?.checked; }
  return f;
}
const actSetInfo = html => { state.act.info = html; const e = $('#actInfo'); if (e) e.innerHTML = html; };
async function actLookup(imei) {
  const f = state.act, done = state.acts.find(a => a.imei === imei);
  if (done) { actSetInfo(`<p class="act-info err">⚠ IMEI นี้ Activate ไปแล้วเมื่อ ${fmt(done.activated_at)}${done.by_name ? ' โดย ' + esc(done.by_name) : ''} (${esc(done.model)} · ${esc(done.color)})</p>`); return false; }
  try {
    const { data } = await sb.rpc('imei_info', { p_imei: imei });
    if (data?.activated) { actSetInfo(`<p class="act-info err">⚠ IMEI นี้ Activate ไปแล้ว${data.activated_by ? ' โดย ' + esc(data.activated_by) : ''}</p>`); return false; }
    if (data?.model) {
      f.model_id = data.model_id; f.model = data.model;
      const m = $('#actModel'); if (m) m.value = data.model;
      actSetInfo(`<p class="act-info ok">✓ พบในระบบ: <b>${esc(data.model)}</b></p>`);
    } else { f.model_id = null; actSetInfo('<p class="act-info">IMEI นี้ไม่อยู่ในสต็อก — กรอกรุ่นเอง</p>'); }
  } catch { actSetInfo(''); }
  return true;
}
function actScan(raw) {
  const s = normImei(raw);
  if (!validImei(s)) return `✗ ${s} ไม่ใช่ IMEI ที่ถูกต้อง (15 หลัก)`;
  actReadForm(); state.act.imei = s; state.act.model_id = null;
  const i = $('#actImei'); if (i) i.value = s;
  actLookup(s).then(ok => { if (ok && state.act.auto) actSave(true); else $('#actColor')?.focus(); });
  return `✓ ${s}`;
}
const actSave = auto => guarded(async () => {
  const f = actReadForm(), s = normImei(f.imei);
  if (!s || !validImei(s)) return toast('IMEI ไม่ถูกต้อง', true);
  if (!f.model) return toast(auto ? 'ไม่พบรุ่นในระบบ — กรอกรุ่นแล้วกดบันทึก' : 'กรุณาระบุรุ่น', true);
  if (!f.color) return toast('กรุณาระบุสี', true);
  const m = state.models.find(x => x.name.trim().toLowerCase() === f.model.toLowerCase());
  await rpc('act_add', { p_imei: s, p_model_id: m ? m.id : null, p_model: f.model, p_color: f.color, p_note: f.note, p_by: opName() });
  // เตรียมเครื่องถัดไป: ล้าง IMEI/หมายเหตุ เก็บรุ่น+สีไว้
  Object.assign(state.act, { imei: '', note: '', info: `<p class="act-info ok">✓ Activate ${esc(s)} แล้ว — ยิงเครื่องถัดไปได้เลย</p>` });
  await loadActs(); renderActs();
  const fe = $('#actForm'); if (fe) fe.innerHTML = actFormHtml();
  beep(true); toast(`Activated ${s} · ${f.model} · ${f.color}`);
  if (!matchMedia('(hover:none)').matches) $('#actImei')?.focus();
});
function exportActs() {
  const H = v => ({ v, s: 1 }), T = v => ({ v, s: 2 });
  const rows = [[H('วันที่ Activate'), H('รุ่น'), H('IMEI'), H('สี'), H('สถานะ'), H('ผู้บันทึก'), H('หมายเหตุ')],
    ...state.acts.map(a => [T(new Date(a.activated_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })), T(a.model), { v: a.imei, s: 3 }, T(a.color), T('Activated'), T(a.by_name), T(a.note)])];
  downloadBlob(`Activate-${todayISO()}.xlsx`, XL.workbook([{ name: 'Activate', widths: [18, 30, 20, 16, 12, 18, 26], rows, freeze: true }]));
}

/* ประวัติเอกสาร */
const docSummary = d => { const n = d.document_items.length, f = d.document_items[0]; return (n ? `${esc(f.model ? f.model + ' · ' : '')}${esc(f.imei)}${n > 1 ? ` และอีก ${n - 1} เครื่อง` : ''}` : '') + (d.sold?.length ? `${n ? ' · ' : ''}ขาย ${d.sold.length} เครื่อง` : ''); };
function historyListHtml() {
  const q = state.hq.trim().toLowerCase(), t = state.ht;
  const list = state.docs.filter(d => (!t || d.type === t) && (!q || [d.doc_no, d.req_no, d.person, d.dept, d.purpose, d.note, ...d.document_items.flatMap(i => [i.imei, i.model])].some(x => String(x || '').toLowerCase().includes(q))));
  const html = list.length ? list.map(d => {
    let st = '';
    if (d.type === 'ISSUE') { const n = d.document_items.filter(i => state.openMap.get(i.imei)?.issue_doc === d.doc_no).length; st = `<span class="badge ${n ? 'warn' : 'ok'}">${n ? 'ค้าง ' + n : 'คืนครบ'}</span>`; }
    return `<div class="card item doc t-${d.type}" data-act="viewDoc" data-no="${esc(d.doc_no)}"><div class="line" style="border:0;padding:0"><div class="grow">
      <span class="badge ${DOC_CLS[d.type]}">${DOC_T[d.type]}</span> <b class="code">${esc(d.doc_no)}</b>
      <small>${fmt(d.created_at)} · ${esc(d.person || '-')}${d.dept ? ' · ' + esc(d.dept) : ''}</small><small>${docSummary(d)}</small></div>${st}</div></div>`;
  }).join('') : '<div class="empty"><i>🧾</i><b>ยังไม่มีเอกสาร</b></div>';
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
    <p class="muted" style="margin-bottom:8px">ID <b class="code">${esc(state.me.username || showId(state.session?.user?.email) || '-')}</b> · สิทธิ์ <span class="badge ${isIssuer() ? 'warn' : ''}">${ROLE_T[state.role]}</span></p>
    <div class="row" style="margin:0"><label style="margin:0">ชื่อ-นามสกุล<input id="meName" value="${esc(state.me.name)}"></label><label style="margin:0">แผนก / งาน<input id="meDept" value="${esc(state.me.dept)}"></label></div>
    <button data-act="saveMe" style="width:100%;margin:10px 0">บันทึกชื่อ/แผนก</button>
    ${isIssuer() ? `<label>ชื่อผู้บันทึกบนเอกสาร (ถ้าเว้นว่างใช้ชื่อด้านบน)<input data-bind="operator" value="${esc(state.operator)}"></label>` : ''}
    <details style="margin-bottom:10px"><summary class="muted" style="cursor:pointer">เปลี่ยนรหัสผ่าน</summary>
      <div class="row" style="margin:6px 0 0"><input id="myPw" type="password" autocomplete="new-password" placeholder="รหัสผ่านใหม่ (≥ 6 ตัว)" style="margin:0"><button data-act="myPw" style="flex:0 0 auto">บันทึก</button></div></details>
    <button class="danger" data-act="logout" style="width:100%">ออกจากระบบ</button></section>
  ${isIssuer() ? `<section class="card"><h2>เพิ่มผู้ใช้</h2>
    <div class="row" style="margin:0"><label style="margin:0">ID ผู้ใช้<input id="nuId" autocapitalize="none" spellcheck="false" placeholder="เช่น somchai"></label><label style="margin:0">ชื่อ-นามสกุล<input id="nuName"></label></div>
    <div class="row" style="margin:8px 0 0"><label style="margin:0">รหัสผ่าน (≥ 6 ตัว)<input id="nuPw" type="text" autocomplete="off"></label><label style="margin:0">สิทธิ์<select id="nuRole">${Object.entries(ROLE_T).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
    <button class="primary big" data-act="addUser">＋ เพิ่มผู้ใช้</button>
    <label class="chk" style="margin:12px 0 0"><input type="checkbox" id="allowSignup" ${state.signupOpen ? 'checked' : ''}> ให้ผู้ใช้กด “สมัครใช้งาน” เองได้ที่หน้าเข้าสู่ระบบ</label></section>
  <section class="card"><h2>สิทธิ์ผู้ใช้</h2>
    <small style="margin-bottom:8px">ผู้ใช้ที่สมัครเองเป็น “ผู้เบิก” อัตโนมัติ</small>
    <div id="users"><p class="muted">กำลังโหลด...</p></div></section>
  <section class="card"><h2>ข้อมูล</h2>
    <p class="muted">ข้อมูลเก็บบน Supabase ใช้ร่วมกันทุกเครื่อง/ทุกคน (ต้องออนไลน์)</p>
    <div class="row"><button data-act="reload">🔄 โหลดข้อมูลใหม่</button><button data-act="exportCsv">⬇️ ส่งออก CSV</button></div></section>` : ''}
  <section class="card danger-zone"><h2>ล้างข้อมูล</h2>
    <button data-act="clearLocal" style="width:100%">🧹 ล้างข้อมูลในเครื่องนี้</button>
    <small style="margin:4px 0 ${isIssuer() ? '12px' : '0'}">ลบร่างที่ยังไม่ยืนยันและแคชของแอปในเครื่องนี้ แล้วโหลดแอปใหม่ (ข้อมูลในระบบไม่หาย) — ใช้เมื่อแอปค้างหรือไม่อัปเดต</small>
    ${isIssuer() ? `<button class="danger" data-act="resetDlg" data-scope="tx" style="width:100%">ล้างประวัติทั้งหมดในระบบ</button>
    <small style="margin:4px 0 12px">ลบคำขอ ใบจ่าย ใบคืน รายการเครื่องค้าง และประวัติสต็อก — <b>เก็บรุ่นและยอดสต็อกไว้</b></small>
    <button class="danger" data-act="resetDlg" data-scope="all" style="width:100%">ล้างทั้งหมด รวมรุ่นและสต็อก</button>
    <small style="margin-top:4px">เริ่มใหม่หมด (บัญชีผู้ใช้และสิทธิ์ยังอยู่)</small>` : ''}</section>
  <section class="card"><h2>วิธีใช้</h2><p class="muted">${isIssuer()
    ? '1) เมนู “สต็อก” เพิ่มรุ่น และใส่จำนวนที่มี (รับเข้า/ตรวจนับ)<br>2) เมนู “คำขอ” เปิดคำขอที่รอจ่าย → กด “จ่าย” → สแกน IMEI ทีละเครื่อง → ยืนยัน (สต็อกลดอัตโนมัติ)<br>3) เมนู “รับคืน” สแกนเครื่องที่คืน (สต็อกเพิ่มอัตโนมัติ)<br>4) พิมพ์ใบขอเบิก/ใบจ่าย/ใบคืนได้จากหน้ารายละเอียด'
    : '1) เมนู “ขอเบิก” กรอกชื่อ → เลือกรุ่นและจำนวน → ส่งคำขอ<br>2) เมนู “คำขอของฉัน” ติดตามสถานะ เมื่อจ่ายแล้วจะเห็นเลข IMEI ของเครื่องที่ได้รับ'}
    <br>· กล้องต้องใช้ผ่าน HTTPS · ติดตั้งเป็นแอปได้จากเมนูเบราว์เซอร์ “เพิ่มไปยังหน้าจอหลัก”</p></section>
  <p class="muted center" style="font-size:12.5px">เวอร์ชัน ${APP_VER}</p>`;
}
async function loadUsersInto() {
  const box = $('#users'); if (!box) return;
  const { data, error } = await sb.from('profiles').select('user_id,email,role,username,name').order('created_at');
  if (error) { box.innerHTML = `<p class="badge err">${esc(errMsg(error))}</p>`; return; }
  const me = state.session.user.id;
  box.innerHTML = data.map(u => `<div class="line"><div class="grow"><b>${esc(u.name || u.username || showId(u.email) || '-')}</b><small><span class="code">${esc(u.username || showId(u.email))}</span>${u.user_id === me ? ' · คุณ' : ''}</small></div>
    ${u.user_id === me ? '' : `<button class="ghost" data-act="resetPw" data-u="${u.user_id}" data-n="${esc(u.username || showId(u.email))}" title="ตั้งรหัสผ่านใหม่" style="padding:6px">🔑</button>`}
    <select data-role-user="${u.user_id}" style="width:auto;margin:0" ${u.user_id === me ? 'disabled' : ''}>${Object.entries(ROLE_T).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('');
}

/* ---------- ประกาศ ---------- */
const ANN_K = { new: ['🆕', 'เครื่องเข้าใหม่'], info: ['📢', 'ข่าวสาร'], urgent: ['⚠️', 'ด่วน'] };
const todayISO = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD ตามเวลาเครื่อง
const annVisible = a => a.active && (!a.show_until || a.show_until >= todayISO());
const annShown = () => state.anns.filter(annVisible);
function etaText(eta) {
  if (!eta) return '';
  const d = Math.round((new Date(eta + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 864e5);
  return d > 1 ? `อีก ${d} วัน` : d === 1 ? 'พรุ่งนี้' : d === 0 ? 'เข้าวันนี้' : 'มาถึงแล้ว';
}
const dateTH = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
const SEEN_KEY = 'ann-seen';
const annUnseen = () => { let t = ''; try { t = localStorage.getItem(SEEN_KEY) || ''; } catch { } return annShown().filter(a => a.updated_at > t).length; };
const markAnnSeen = () => { const m = annShown().reduce((x, a) => a.updated_at > x ? a.updated_at : x, ''); if (m) try { localStorage.setItem(SEEN_KEY, m); } catch { } };
// แถบตัวหนังสือวิ่งใต้หัวแอป (แตะเพื่อเปิดหน้าประกาศ)
let tickerSig = '';
function renderTicker() {
  const el = $('#ticker'); if (!el) return;
  const list = state.session ? annShown() : [];
  const sig = list.map(a => a.id + a.updated_at).join();
  if (sig === tickerSig) return; tickerSig = sig;
  if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
  const items = list.map(a => `<span class="tk-item k-${a.kind}"><b>${ANN_K[a.kind][0]} ${esc(a.title)}</b>${a.eta ? `<em>${etaText(a.eta)} · ${dateTH(a.eta)}</em>` : ''}</span>`).join('<span class="tk-sep">◆</span>');
  const len = list.reduce((n, a) => n + a.title.length + 20, 0);
  el.innerHTML = `<div class="tk-label">ประกาศ</div><div class="tk-win"><div class="tk-track" style="--dur:${Math.max(14, Math.round(len * 0.32))}s">${items}<span class="tk-sep">◆</span>${items}<span class="tk-sep">◆</span></div></div>`;
  el.hidden = false;
}
function annCardHtml(a) {
  const [ic, kt] = ANN_K[a.kind] || ANN_K.info, vis = annVisible(a);
  const body = esc(a.body).replace(/\n/g, '<br>');
  return `<article class="ann k-${a.kind} ${vis ? '' : 'off'}">
    <div class="ann-top"><span class="ann-kind">${ic} ${kt}</span>${a.pinned ? '<span class="ann-pin">📌 ปักหมุด</span>' : ''}${!vis ? `<span class="ann-off">${a.active ? 'หมดเวลาแสดง' : 'ซ่อนอยู่'}</span>` : ''}</div>
    <h3>${esc(a.title)}</h3>
    ${a.eta ? `<div class="ann-eta"><b>${etaText(a.eta)}</b><span>คาดว่าเข้า ${dateTH(a.eta)}</span></div>` : ''}
    ${body ? `<p>${body}</p>` : ''}
    <footer>${esc(a.by_name || '')}${a.by_name ? ' · ' : ''}${fmt(a.updated_at)}${a.show_until ? ` · แสดงถึง ${dateTH(a.show_until)}` : ''}</footer>
    ${isIssuer() ? `<div class="row" style="margin:10px 0 0"><button data-act="annEdit" data-id="${a.id}">✎ แก้ไข</button><button data-act="annToggle" data-id="${a.id}">${a.active ? '🙈 ซ่อน' : '👁 แสดง'}</button><button class="danger" data-act="annDel" data-id="${a.id}">ลบ</button></div>` : ''}
  </article>`;
}
function annFormHtml() {
  const e = state.annEdit, a = e && e !== 'new' ? state.anns.find(x => x.id === e) : null;
  if (!e) return `<button class="primary big" data-act="annNew" style="margin:0 0 14px">＋ เขียนประกาศใหม่</button>`;
  return `<section class="card ann-form"><h2>${a ? 'แก้ไขประกาศ' : 'เขียนประกาศใหม่'}</h2>
    <label>ประเภท<div class="seg" style="margin:4px 0 0">${Object.entries(ANN_K).map(([k, [ic, t]]) => `<button data-act="annKind" data-k="${k}" class="${(a?.kind || state.annKind || 'new') === k ? 'on' : ''}">${ic} ${t}</button>`).join('')}</div></label>
    <label>หัวข้อ * <small style="display:inline">(แสดงในแถบตัวหนังสือวิ่ง)</small><input id="anTitle" value="${esc(a?.title || '')}" placeholder="เช่น iPhone 17 Pro Max เข้า 20 เครื่อง"></label>
    <label>รายละเอียด<textarea id="anBody" rows="4" style="font-family:var(--f);font-size:15px" placeholder="รุ่น / สี / ความจุ / จำนวน / วิธีขอเบิก ...">${esc(a?.body || '')}</textarea></label>
    <div class="row" style="margin:0"><label style="margin:0">วันที่คาดว่าเข้า<input id="anEta" type="date" value="${a?.eta || ''}"></label><label style="margin:0">แสดงถึงวันที่<input id="anUntil" type="date" value="${a?.show_until || ''}"></label></div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="anPin" ${a?.pinned ? 'checked' : ''}> 📌 ปักหมุดไว้บนสุด</label>
    <div class="row" style="margin:12px 0 0"><button data-act="annCancel">ยกเลิก</button><button class="primary" data-act="annSave">${a ? 'บันทึก' : 'ประกาศ'}</button></div></section>`;
}
function viewNews() {
  markAnnSeen();
  const list = isIssuer() ? state.anns : annShown();
  return errBanner() + `<div class="news-hero"><div><small>ประกาศ</small><b>เครื่องเข้าใหม่ &amp; ข่าวสาร</b></div><span>${annShown().length}</span></div>
    ${isIssuer() ? annFormHtml() : ''}
    ${list.length ? list.map(annCardHtml).join('') : '<div class="empty"><i>📢</i><b>ยังไม่มีประกาศ</b><span>ประกาศเครื่องเข้าใหม่จะแสดงที่นี่</span></div>'}`;
}

const views = { act: viewAct, import: viewImport, receive: viewReceive, news: viewNews, request: viewRequest, requests: viewRequests, fulfill: viewFulfill, return: viewReturn, out: viewOut, stock: viewStock, history: viewHistory, settings: viewSettings };
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
  document.querySelectorAll('dialog[open]').forEach(d => { try { d.close(); } catch { } }); // กันหน้าต่างค้างบังหน้า
  state.view = v; render();
  if (v === 'settings') return;
  refresh().then(() => {
    if (state.view !== v) return;
    if (v === 'request') { const a = $('#modelPick'); if (a) a.innerHTML = modelPickHtml(); const p = $('#people'); if (p) p.innerHTML = peopleOpts(); const s = $('#reqSum'); if (s) s.innerHTML = reqSumHtml(); renderNav(); }
    else if (v === 'fulfill' && curReq()?.status === 'PENDING') { renderFul(); renderNav(); }
    else if (v === 'return') { refreshReturnInPlace(); renderNav(); }
    else if (v === 'news' && state.annEdit) renderNav();
    else if (v === 'receive') { renderRcv(); renderNav(); }
    else if (v === 'act') { renderActs(); renderNav(); } // ไม่ล้างฟอร์มที่กำลังกรอก // ไม่วาดการ์ดรุ่นใหม่ทับ (กันแตะไม่ติด)
    else render();
  });
}

/* ---------- commits ---------- */
const submitReq = () => guarded(async () => {
  const r = state.req, items = reqLines();
  if (!r.person.trim()) return toast('กรุณาระบุผู้เบิก', true);
  if (!items.length) return toast('ยังไม่ได้เลือกรุ่นและจำนวน', true);
  const over = items.find(x => x.qty > availOf(x.model_id));
  if (over) return toast(`${mName(over.model_id)} พร้อมเบิกเหลือ ${availOf(over.model_id)} เครื่อง`, true);
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
const REASONS = ['ผู้เบิกยังใช้งานอยู่', 'ยังไม่ได้นำมาคืน', 'ส่งซ่อม', 'เครื่องเสียหาย', 'สูญหาย'];
let retSold = new Set(), retReason = '';
function commitReturn() {
  if (!state.retPerson) return toast('เลือกผู้เบิก หรือยิง IMEI ก่อน', true);
  const miss = retMissing();
  if (!miss.length) return doReturn([], '', []);
  retSold = new Set(); retReason = '';
  renderMissDlg();
}
// แต่ละเครื่องที่ไม่ได้ยิง: กด “ขาย” = ปิดรายการ ไม่คืนสต็อก · ที่เหลือ = ยังค้าง ต้องมีเหตุผล
function renderMissDlg() {
  const reasonEl = $('#missReason'); if (reasonEl) retReason = reasonEl.value;
  const miss = retMissing(), sold = miss.filter(l => retSold.has(l.imei)), keep = miss.filter(l => !retSold.has(l.imei));
  const n = state.cart.return.length;
  const parts = [n && `คืน ${n}`, sold.length && `ขาย ${sold.length}`, keep.length && `ค้างต่อ ${keep.length}`].filter(Boolean).join(' · ');
  showDialog(`<h2>ไม่ได้ยิงคืน ${miss.length} เครื่อง</h2>
    <p class="muted" style="margin-bottom:8px">${esc(state.retPerson)} — เครื่องที่ <b>ขายแล้ว</b> กด “ขาย” (ไม่ต้องยิง และไม่คืนเข้าสต็อก) · ที่เหลือจะค้างต่อ ต้องใส่เหตุผล</p>
    <div class="misslist">${miss.map(l => { const on = retSold.has(l.imei); return `<div class="mrow ${on ? 'sold' : ''}"><div class="grow"><b class="code">${esc(l.imei)}</b><small>${esc(l.model || '-')}</small></div>
      <button class="soldbtn ${on ? 'on' : ''}" data-act="toggleSold" data-imei="${esc(l.imei)}">${on ? '✓ ขายแล้ว' : 'ขาย?'}</button></div>`; }).join('')}</div>
    ${miss.length > 1 ? `<button data-act="soldAll" style="width:100%;margin-top:8px">${sold.length === miss.length ? 'ยกเลิกขายทั้งหมด' : `ขายทั้งหมด ${miss.length} เครื่อง`}</button>` : ''}
    ${keep.length ? `<label style="margin-top:12px">เหตุผลของเครื่องที่ยังค้าง (${keep.length} เครื่อง) *<input id="missReason" value="${esc(retReason)}" placeholder="เช่น ผู้เบิกยังใช้งานอยู่" autocomplete="off"></label>
    <div class="chips" style="margin:-4px 0 12px">${REASONS.map(r => `<button class="rchip" data-act="pickReason" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : '<div style="height:12px"></div>'}
    <button class="primary big" data-act="confirmReturn" style="margin-top:0">ยืนยัน: ${parts || '-'}</button>
    <button class="big" data-act="closeDlg">กลับไปยิงต่อ</button>`);
}
const doReturn = (missing, reason, sold) => guarded(async () => {
  const cart = state.cart.return;
  let doc;
  try { doc = await rpc('dev_return', { p_imeis: cart.map(l => l.imei), p_by: opName(), p_note: state.rnote.trim(), p_missing: missing, p_reason: reason, p_sold: sold }); }
  catch (e) { await refresh(); renderRet(); throw e; }
  if (dlg().open) dlg().close();
  state.cart.return = []; state.rnote = ''; state.retPerson = ''; saveDraft();
  await refresh(); render(); toast('บันทึกแล้ว ' + doc); showDoc(doc);
});

/* ---------- dialogs ---------- */
const dlg = () => $('#dlg');
function showDialog(html) { const t = $('#toast'); if (t && dlg().contains(t)) document.body.appendChild(t); dlg().innerHTML = html; if (!dlg().open) dlg().showModal(); }
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
    ${d.sold?.length ? `<div class="missbox sold"><b>ขายแล้ว ${d.sold.length} เครื่อง</b> (ปิดรายการ ไม่คืนสต็อก)<div class="chips">${d.sold.map(m => `<span class="chip" style="padding-right:8px">${esc(m.imei)}</span>`).join('')}</div></div>` : ''}
    ${d.missing?.length ? `<div class="missbox"><b>ยังไม่คืน ${d.missing.length} เครื่อง</b> — เหตุผล: ${esc(d.missing_reason)}<div class="chips">${d.missing.map(m => `<span class="chip" style="padding-right:8px">${esc(m.imei)}</span>`).join('')}</div></div>` : ''}
    <div class="row" style="margin-top:12px"><button data-act="printDoc" data-no="${esc(d.doc_no)}" data-mode="table">🖨️ พิมพ์ทั้งใบ</button><button data-act="printDoc" data-no="${esc(d.doc_no)}" data-mode="slip">🖨️ แยกทีละเครื่อง</button></div>
    <button class="primary big" data-act="closeDlg" style="margin-top:0">ปิด</button>`);
}
function stockDlg(id) {
  const m = state.modelMap.get(+id); if (!m) return;
  showDialog(`<h2>ปรับสต็อก · ${esc(m.name)}</h2>
    <p>คงเหลือปัจจุบัน <b class="bignum">${num(m.stock)}</b> เครื่อง</p>
    <p class="hint">ใช้กับเครื่องที่<b>ยังไม่ลง IMEI</b> · เครื่องที่มี IMEI ให้รับเข้า/ตัดออกด้วยการยิง IMEI</p>
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
// cells: [label, value, span] — span: ไม่ใส่ = 1 ช่อง, 2 = 2 ช่อง, 1/true = เต็มแถว
function metaGrid(cells, cols = 3) {
  let html = '', used = 0;
  const pad = k => { html += '<div></div>'.repeat(k); };
  cells.filter(x => x[1]).forEach(([k, v, sp]) => {
    const w = sp === 2 ? Math.min(2, cols) : sp ? cols : 1;
    if (used + w > cols) { pad(cols - used); used = 0; }
    html += `<div style="${w > 1 ? `grid-column:span ${w}` : ''}"><span class="lbl">${k}</span><span class="val">${v}</span></div>`;
    used = (used + w) % cols;
  });
  if (used) pad(cols - used);
  return `<div class="meta c${cols}">${html}</div>`;
}
const sheetHead = ({ title, en, no, sub, status }) => `<header class="hd"><div class="brand"><div class="mark">${PRINT_MARK}</div><div>
  <div class="kicker">${en}${ORG ? ' · ' + esc(ORG) : ''}</div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>
  <div class="docno"><small>เลขที่เอกสาร</small><div class="v">${esc(no)}</div>${status || ''}</div></header>`;
const signBox = (a, b) => `<div class="sign">${[a, b].map(t => `<div><div class="ttl">${t}</div><div class="ln"></div>
  <div class="nm"><span>( ........................................ )</span><span>วันที่ ____ / ____ / ______</span></div></div>`).join('')}</div>`;
const PRINT_CSS = `@page{size:A4;margin:13mm 13mm 15mm;@bottom-right{content:"หน้า " counter(page) " / " counter(pages);font:9.5px "IBM Plex Sans Thai",sans-serif;color:#4a5560}}
*{box-sizing:border-box}
:root{--ink:#101820;--mut:#3b4651;--line:#d5dbe0;--soft:#e9edf0;--yel:#ffc20e}
body{font:12.5px/1.6 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;color:var(--ink);margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mono,.imei,.docno .v,.kicker,td.n,.pill b,.q{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}
.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:16px;border-bottom:1px solid var(--line);position:relative}
.hd::after{content:"";position:absolute;left:0;bottom:-1px;width:64px;height:3px;background:var(--yel);border-radius:2px}
.brand{display:flex;gap:14px;align-items:center}
.mark{width:48px;height:48px;border-radius:13px;background:var(--ink);display:grid;place-items:center;flex:none}
.mark svg{width:28px;height:28px}
.kicker{font-weight:600;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--mut);margin-bottom:5px}
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
.lbl{display:block;font-size:10px;font-weight:600;color:var(--mut);letter-spacing:.02em;margin-bottom:1px}
.val{font-weight:600;font-size:13px}
.sumrow{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid #b9c2c9;border-radius:99px;padding:3px 4px 3px 12px;font-weight:500;font-size:12px;background:#fff}
.pill b{background:var(--ink);color:#fff;border-radius:99px;padding:0 9px;font-size:11px;font-weight:600;line-height:19px}
table{width:100%;border-collapse:separate;border-spacing:0}
thead{display:table-header-group}
th{font-size:10.5px;font-weight:600;color:#fff;background:var(--ink);text-align:left;padding:6px 10px;letter-spacing:.03em;white-space:nowrap}
th:first-child{border-radius:6px 0 0 6px}th:last-child{border-radius:0 6px 6px 0}
td{padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
tr{break-inside:avoid}
td.n,th.n{width:38px;font-size:10.5px}td.n{color:var(--mut)}
.r{text-align:right}
td.q{font-weight:600;font-size:14px}
.imei{font-weight:500;font-size:13px;letter-spacing:.05em;white-space:nowrap}
td.wr{border-bottom:1px solid var(--line)}
tr.grp td{background:var(--soft);color:var(--ink);font-weight:700;font-size:11.5px;padding:6px 10px;border-bottom:0}
tr.grp td span{color:var(--mut);font-weight:500}
.total{display:flex;justify-content:flex-end;align-items:baseline;gap:22px;margin-top:12px;color:var(--mut)}
.total b{font-size:20px;color:var(--ink);font-family:"IBM Plex Mono",monospace;margin:0 3px}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:34px;break-inside:avoid}
.sign>div{border:1px solid var(--line);border-radius:12px;padding:12px 16px 10px}
.sign .ttl{font-size:11px;color:var(--ink);font-weight:700}
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
.foot{margin-top:18px;color:#5d6a75;font-size:10px;display:flex;justify-content:space-between}
.meta.c4{grid-template-columns:repeat(4,1fr)}
/* โหมดกะทัดรัด (มากกว่า 20 เครื่อง): 2 คอลัมน์ ~60 เครื่องต่อหน้า */
.cp .hd{padding-bottom:10px}.cp .mark{width:40px;height:40px;border-radius:11px}.cp .mark svg{width:23px;height:23px}.cp h1{font-size:21px}
.cp .meta{margin:8px 0 4px}.cp .meta>div{padding:4px 11px 5px}.cp .val{font-size:12px}
.grp2{margin-top:5px;break-inside:auto}
.grp2 .gh{display:flex;justify-content:space-between;align-items:center;background:var(--ink);color:#fff;border-radius:5px;padding:1px 10px;font-size:10.5px;line-height:1.55;break-after:avoid}
.grp2 .gh span{background:var(--yel);color:var(--ink);font-weight:700;border-radius:99px;padding:0 8px;font-size:10.5px}
.ig{display:grid;grid-template-columns:repeat(4,1fr);column-gap:10px;margin-top:2px}
.ic{display:flex;align-items:center;gap:5px;padding:1.5px 2px;border-bottom:1px solid var(--line);font-size:10.5px;line-height:1.3;white-space:nowrap;break-inside:avoid}
.ic .n{font:500 9px "IBM Plex Mono",monospace;color:var(--mut);min-width:15px}
.ic .imei{font-size:10.8px;letter-spacing:.02em;font-weight:500}
.ic i.box{display:inline-block;width:9px;height:9px;border:1.2px solid #59646e;border-radius:2px;flex:none}
.cp .total{margin-top:5px}.cp .total b{font-size:17px}
.cp .sign{margin-top:10px}.cp .sign>div{padding:8px 14px 7px}.cp .sign .ln{height:28px}
.miss{margin-top:14px;border:1px solid #f2d16b;background:#fffaeb;border-radius:10px;padding:9px 14px;break-inside:avoid}
.miss .mh{font-weight:700;font-size:12px}.miss .mh span{font-weight:500;color:var(--mut);margin-left:6px}
.miss .mi{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:4px;font-size:11px}
.miss .mi span{font-family:"IBM Plex Mono",monospace}
.miss.sold{border-color:#9dbbe0;background:#eef4fb}`;
function openWin() {
  const w = window.open('', '_blank');
  if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์', true); return null; }
  w.document.write('<p style="font:16px system-ui;padding:24px">กำลังเตรียมเอกสาร...</p>');
  return w;
}
function writePrint(w, no, body) {
  const safe = String(no).replace(/[^\w-]/g, '');
  const stamp = ((ORG ? ORG + ' · ' : '') + 'พิมพ์เมื่อ ' + new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })).replace(/["\\]/g, '');
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${safe}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">
  <style>${PRINT_CSS}@page{@bottom-left{content:"${safe}  ·  ${stamp}";font:9.5px "IBM Plex Sans Thai",sans-serif;color:#4a5560}}</style></head><body>${body}
  <script>(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(()=>setTimeout(()=>print(),300));<\/script></body></html>`);
  w.document.close();
}
function printReq(no) {
  const r = state.reqs.find(x => x.req_no === no); if (!r) return;
  const w = openWin(); if (!w) return;
  const iss = r.status === 'ISSUED';
  const body = `<section>${sheetHead({ title: 'ใบขอเบิกเครื่อง', en: 'Device Request', no: r.req_no, sub: `${r.request_items.length} รุ่น · ${reqQty(r)} เครื่อง`, status: `<div class="st"><span class="pst s-${r.status}">${REQ_T[r.status]}</span></div>` })}
    ${metaGrid([['ผู้เบิก', esc(r.person)], ['แผนก / งาน', esc(r.dept)], ['วันที่ขอ', dtLong(r.created_at)], ['ผู้บันทึก', esc(r.by_name)], ['ใบจ่ายอ้างอิง', iss ? esc(r.issue_doc) : ''], ['จ่ายเมื่อ', iss ? dtLong(r.issued_at) : ''], ['วัตถุประสงค์', esc(r.purpose), 1], ['หมายเหตุ', esc(r.note), 1]], 3)}
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
    const metaCells = [[who, esc(d.person)], ['แผนก / งาน', esc(d.dept)], ['วันที่', dtLong(d.created_at)], ['ผู้บันทึก', esc(d.by_name)], ['วัตถุประสงค์', esc(d.purpose), 2], ['หมายเหตุ', esc(d.note), 2]];
    const pills = `<div class="sumrow">${[...groups].map(([m, a]) => `<span class="pill">${esc(m)}<b>${a.length}</b></span>`).join('')}</div>`;
    const miss = !iss && d.missing?.length ? `<div class="miss"><div class="mh">เครื่องที่ยังไม่คืน ${d.missing.length} เครื่อง<span>เหตุผล: ${esc(d.missing_reason)}</span></div>
      <div class="mi">${d.missing.map(m => `<span>${esc(imeiFmt(m.imei))} · ${esc(m.model || '-')}</span>`).join('')}</div></div>` : '';
    const sold = !iss && d.sold?.length ? `<div class="miss sold"><div class="mh">ขายแล้ว ${d.sold.length} เครื่อง<span>ปิดรายการ ไม่คืนเข้าสต็อก</span></div>
      <div class="mi">${d.sold.map(m => `<span>${esc(imeiFmt(m.imei))} · ${esc(m.model || '-')}</span>`).join('')}</div></div>` : '';
    const head = sheetHead({ title, en, no: d.doc_no, sub: `${n} เครื่อง · ${groups.size} รุ่น${d.req_no ? ' · อ้างอิงคำขอ ' + esc(d.req_no) : ''}` });
    if (!n) {
      body = `<section>${sheetHead({ title, en, no: d.doc_no, sub: 'ไม่มีเครื่องคืนเข้าคลัง' })}${metaGrid(metaCells, 4)}${sold}${miss}${sign}</section>`;
    } else if (n + (groups.size > 1 ? groups.size : 0) <= 12) { // แบบตารางใหญ่ (มีช่องสภาพ/หมายเหตุ)
      let k = 0;
      body = `<section>${head}${metaGrid(metaCells, 4)}${pills}
      <table><thead><tr><th class="n">#</th><th>IMEI / ซีเรียล</th><th>รุ่นเครื่อง</th><th style="width:30%">สภาพ / หมายเหตุ</th></tr></thead><tbody>
      ${[...groups].map(([m, a]) => (groups.size > 1 ? `<tr class="grp"><td colspan="4">${esc(m)} <span>· ${a.length} เครื่อง</span></td></tr>` : '')
        + a.map(it => `<tr><td class="n">${String(++k).padStart(2, '0')}</td><td class="imei">${esc(imeiFmt(it.imei))}</td><td>${esc(it.model || '-')}</td><td></td></tr>`).join('')).join('')}
      </tbody></table>
      <div class="total"><span>รวมทั้งสิ้น<b>${n}</b>เครื่อง</span></div>${sold}${miss}${sign}</section>`;
    } else {
      // แบบกะทัดรัด: จัดกลุ่มตามรุ่น · IMEI เรียง 4 คอลัมน์ (≈ 70–90 เครื่องจบใน A4 ใบเดียว)
      let k = 0;
      body = `<section class="cp">${head}${metaGrid(metaCells, 4)}
        ${[...groups].map(([m, a]) => `<div class="grp2"><div class="gh"><b>${esc(m)}</b><span>${a.length} เครื่อง</span></div>
          <div class="ig">${a.map(it => `<div class="ic"><i class="box"></i><span class="n">${String(++k).padStart(2, '0')}</span><span class="imei">${esc(imeiFmt(it.imei))}</span></div>`).join('')}</div></div>`).join('')}
        <div class="total"><span>รวมทั้งสิ้น<b>${n}</b>เครื่อง · ${groups.size} รุ่น</span></div>${sold}${miss}${sign}</section>`;
    }
  }
  writePrint(w, d.doc_no, body);
}

/* ---------- actions ---------- */
const actions = {
  scan: d => openScanner(code => addImei(d.k, code), { multi: true }),
  del: d => { state.cart.return = state.cart.return.filter(x => x.imei !== d.imei); renderRet(); saveDraft(); },
  pickReason: d => { const i = $('#missReason'); if (i) { i.value = d.v; i.focus(); } },
  toggleSold: d => { retSold.has(d.imei) ? retSold.delete(d.imei) : retSold.add(d.imei); renderMissDlg(); },
  soldAll: () => { const m = retMissing(); retSold = m.every(l => retSold.has(l.imei)) ? new Set() : new Set(m.map(l => l.imei)); renderMissDlg(); },
  confirmReturn: () => {
    const sold = retMissing().filter(l => retSold.has(l.imei)).map(l => l.imei);
    const keep = retMissing().filter(l => !retSold.has(l.imei)).map(l => l.imei);
    if (!state.cart.return.length && !sold.length) { toast('ยังไม่มีเครื่องที่คืนหรือขาย', true); return; }
    const reason = ($('#missReason')?.value || '').trim();
    if (keep.length && !reason) { const i = $('#missReason'); if (i) { i.setCustomValidity('กรุณาระบุเหตุผล หรือเลือกจากตัวเลือกด้านล่าง'); i.reportValidity(); i.oninput = () => i.setCustomValidity(''); } return; }
    doReturn(keep, keep.length ? reason : '', sold);
  },
  pickPerson: d => { if (state.retPerson !== d.p) { state.retPerson = d.p; state.cart.return = []; saveDraft(); } renderRetAll(); },
  retClear: () => {
    if (state.cart.return.length && !confirm(`ยิงไปแล้ว ${state.cart.return.length} เครื่อง — เปลี่ยนผู้เบิกจะล้างรายการที่ยิงไว้`)) return;
    state.retPerson = ''; state.cart.return = []; state.retQ = ''; saveDraft(); renderRetAll();
  },
  retPerson: d => {
    if (state.retPerson !== d.p) { state.retPerson = d.p; state.cart.return = []; saveDraft(); }
    if (dlg().open) dlg().close();
    go('return');
  },
  addBulk: d => {
    const ta = $('#bulk-' + d.k); if (!ta) return;
    const bad = [];
    ta.value.split(/[\s,;]+/).filter(Boolean).forEach(x => { if (addImei(d.k, x).startsWith('✗')) bad.push(x); });
    ta.value = bad.join('\n');
    toast(bad.length ? `เพิ่มไม่ได้ ${bad.length} รายการ (เหลือไว้ในช่องวาง)` : 'เพิ่มรายการแล้ว', !!bad.length);
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
  personDlg: d => personDlg(d.p),
  actSave: () => actSave(false),
  actPick: d => { state.actM = d.m || ''; renderActs(); $('#actList')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  actColor: d => { const c = $('#actColor'); if (c) c.value = d.v; state.act.color = d.v; },
  actExport: () => exportActs(),
  actDel: d => {
    if (!confirm(`ลบรายการ Activate ของ ${d.imei}?`)) return;
    guarded(async () => { await rpc('act_delete', { p_id: +d.id }); await loadActs(); renderActs(); toast('ลบแล้ว'); });
  },
  tplQty: d => { const n = Math.max(0, Math.min(2000, (state.tpl[d.id] || 0) + +d.d)); if (n) state.tpl[d.id] = n; else delete state.tpl[d.id]; const i = $(`[data-tpl="${d.id}"]`); if (i) { i.value = n || ''; i.closest('.pick').classList.toggle('on', n > 0); } const t = $('#tplTotal'); if (t) t.textContent = tplTotal(); },
  tplNewAdd: () => {
    const name = $('#tpNewName').value.trim(), qty = Math.floor(+$('#tpNewQty').value || 0);
    if (!name) return toast('ใส่ชื่อรุ่นใหม่', true);
    if (qty < 1) return toast('ใส่จำนวนเครื่อง', true);
    if (state.models.some(m => m.name.trim().toLowerCase() === name.toLowerCase())) return toast('รุ่นนี้มีในระบบแล้ว — ใช้ปุ่ม + ด้านบนแทน', true);
    state.tplNew.push({ name, qty }); renderTpl();
  },
  tplNewDel: d => { state.tplNew.splice(+d.i, 1); renderTpl(); },
  tplExport: () => exportTemplate(),
  impMode: d => { state.impMode = d.m; document.querySelectorAll('[data-act=impMode]').forEach(b => b.classList.toggle('on', b.dataset.m === d.m)); renderImp(); },
  impBadExport: () => {
    const im = state.imp; if (!im) return;
    const rows = [[{ v: 'แถว', s: 1 }, { v: 'รุ่น', s: 1 }, { v: 'IMEI', s: 1 }, { v: 'ปัญหา', s: 1 }], ...im.problems.map(p => [{ v: p.line, s: 2, n: 1 }, { v: p.model, s: 2 }, { v: p.imei, s: 3 }, { v: p.why, s: 2 }])];
    downloadBlob(`IMEI-มีปัญหา-${todayISO()}.xlsx`, XL.workbook([{ name: 'มีปัญหา', widths: [8, 30, 22, 50], rows, freeze: true }]));
  },
  impCommit: () => guarded(async () => {
    const im = state.imp; if (!im) return; analyzeImport();
    if (!im.ok) return toast('ไม่มีรายการที่นำเข้าได้', true);
    if (im.groups.some(g => g.over)) return toast('โหมดลง IMEI ของเดิม: บางรุ่นเกินจำนวนของเดิม', true);
    const newOnes = im.groups.filter(g => g.isNew);
    if (newOnes.length && !confirm(`จะสร้างรุ่นใหม่ ${newOnes.length} รุ่น:\n• ${newOnes.map(g => g.name).join('\n• ')}\n\nยืนยันนำเข้า?`)) return;
    for (const g of newOnes) { const id = await rpc('model_save', { p_id: null, p_name: g.name, p_active: true, p_stock: 0, p_by: opName() }); g.model = { id, name: g.name, stock: 0 }; }
    // โหมดลง IMEI ของเดิมใช้กับรุ่นที่เพิ่งสร้างไม่ได้ (ยังไม่มีของเดิม) → รับเข้าใหม่
    const done = [], fail = [];
    for (const g of im.groups) {
      const mode = g.isNew ? 'new' : state.impMode;
      try { await rpc('stock_receive', { p_model_id: g.model.id, p_imeis: g.imeis, p_mode: mode, p_note: `นำเข้าจากไฟล์ ${im.fileName}`, p_by: opName() }); done.push(`${g.name} ${g.imeis.length}`); }
      catch (e) { fail.push(`${g.name}: ${errMsg(e)}`); }
    }
    state.imp = null; state.tpl = {}; state.tplNew = [];
    await refresh(); state.view = 'stock'; render();
    if (fail.length) showDialog(`<h2>นำเข้าเสร็จบางส่วน</h2>${done.length ? `<p>✅ สำเร็จ: ${done.map(esc).join(' · ')}</p>` : ''}<p style="color:var(--red)">❌ ไม่สำเร็จ:<br>${fail.map(esc).join('<br>')}</p><button class="primary big" data-act="closeDlg">ปิด</button>`);
    else toast(`นำเข้าสต็อกแล้ว ${im.ok} เครื่อง (${done.length} รุ่น)`);
  }),
  rcvGo: d => { if (d.id && +d.id !== state.rcv.model_id) state.rcv = { model_id: +d.id, mode: 'new', items: [], note: '' }; saveDraft(); go('receive'); },
  rcvModel: d => {
    const id = d.id ? +d.id : null;
    if (state.rcv.items.length && id !== state.rcv.model_id && !confirm(`ยิงไปแล้ว ${state.rcv.items.length} เครื่อง — เปลี่ยนรุ่นจะล้างรายการที่ยิงไว้`)) return;
    if (id !== state.rcv.model_id) state.rcv.items = [];
    state.rcv.model_id = id; state.rcv.mode = 'new'; saveDraft(); renderRcv(true);
  },
  rcvMode: d => {
    if (d.m === 'register' && state.rcv.items.length > unregOf(state.rcv.model_id)) return toast(`ของเดิมที่ยังไม่ลง IMEI มี ${unregOf(state.rcv.model_id)} เครื่อง — ลบรายการที่ยิงเกินก่อน`, true);
    state.rcv.mode = d.m; saveDraft(); renderRcv(true);
  },
  rcvDel: d => { state.rcv.items = state.rcv.items.filter(x => x !== d.imei); saveDraft(); renderRcv(); },
  rcvCommit: () => guarded(async () => {
    const r = state.rcv;
    if (!r.model_id) return toast('เลือกรุ่นก่อน', true);
    if (!r.items.length) return toast('ยังไม่ได้ยิง IMEI', true);
    const n = r.items.length, name = mName(r.model_id);
    const bal = await rpc('stock_receive', { p_model_id: r.model_id, p_imeis: r.items, p_mode: r.mode, p_note: r.note, p_by: opName() });
    state.rcv = { model_id: null, mode: 'new', items: [], note: '' }; saveDraft();
    await refresh(); state.view = 'stock'; render(); toast(`${r.mode === 'new' ? 'รับเข้า' : 'ลง IMEI'} ${name} ${n} เครื่องแล้ว · คงเหลือ ${num(bal)}`);
  }),
  imeiDlg: d => { state.imeiQ = ''; imeiDlg(d.id); },
  imeiRemove: d => {
    const why = prompt(`ตัด ${d.imei} ออกจากสต็อก — ระบุเหตุผล (เช่น เครื่องเสีย / สูญหาย / ย้ายคลัง)`); if (why == null) return;
    if (!why.trim()) return toast('กรุณาระบุเหตุผล', true);
    guarded(async () => { await rpc('stock_remove', { p_imeis: [d.imei], p_note: why, p_by: opName() }); await refresh(); renderStockList(); imeiDlg(d.id); toast(`ตัด ${d.imei} ออกแล้ว`); });
  },
  authTab: d => { state.authTab = d.t; render(); },
  annNew: () => { state.annEdit = 'new'; state.annKind = 'new'; render(); setTimeout(() => $('#anTitle')?.focus(), 50); },
  annEdit: d => { state.annEdit = +d.id; state.annKind = state.anns.find(a => a.id === +d.id)?.kind; render(); },
  annCancel: () => { state.annEdit = null; render(); },
  annKind: d => { state.annKind = d.k; document.querySelectorAll('.ann-form .seg button').forEach(b => b.classList.toggle('on', b.dataset.k === d.k)); },
  annSave: () => guarded(async () => {
    const e = state.annEdit, a = e && e !== 'new' ? state.anns.find(x => x.id === e) : null;
    const title = $('#anTitle').value.trim(); if (!title) return toast('กรุณาใส่หัวข้อประกาศ', true);
    await rpc('ann_save', { p_id: a ? a.id : null, p_title: title, p_body: $('#anBody').value, p_kind: state.annKind || 'new',
      p_eta: $('#anEta').value || null, p_show_until: $('#anUntil').value || null, p_pinned: $('#anPin').checked, p_active: a ? a.active : true, p_by: opName() });
    state.annEdit = null; await loadAnns(); render(); toast(a ? 'บันทึกประกาศแล้ว' : 'ประกาศแล้ว');
  }),
  annToggle: d => guarded(async () => {
    const a = state.anns.find(x => x.id === +d.id); if (!a) return;
    await rpc('ann_save', { p_id: a.id, p_title: a.title, p_body: a.body, p_kind: a.kind, p_eta: a.eta, p_show_until: a.show_until, p_pinned: a.pinned, p_active: !a.active, p_by: a.by_name });
    await loadAnns(); render(); toast(a.active ? 'ซ่อนประกาศแล้ว' : 'แสดงประกาศแล้ว');
  }),
  annDel: d => guarded(async () => {
    if (!confirm('ลบประกาศนี้?')) return;
    await rpc('ann_delete', { p_id: +d.id }); await loadAnns(); render(); toast('ลบประกาศแล้ว');
  }),
  tickerGo: () => go('news'),
  myPw: () => guarded(async () => {
    const pw = $('#myPw').value; if (pw.length < 6) return toast('รหัสผ่านอย่างน้อย 6 ตัว', true);
    await rpc('my_set_password', { p_password: pw }); $('#myPw').value = ''; toast('เปลี่ยนรหัสผ่านแล้ว');
  }),
  resetPw: d => {
    const pw = prompt(`ตั้งรหัสผ่านใหม่ให้ ${d.n} (อย่างน้อย 6 ตัว)`); if (pw == null) return;
    if (pw.length < 6) return toast('รหัสผ่านอย่างน้อย 6 ตัว', true);
    guarded(async () => { await rpc('admin_set_password', { p_user: d.u, p_password: pw }); toast(`ตั้งรหัสใหม่ให้ ${d.n} แล้ว`); });
  },
  saveMe: () => guarded(async () => {
    await rpc('profile_update', { p_name: $('#meName').value, p_dept: $('#meDept').value });
    await loadRole(); toast('บันทึกแล้ว');
  }),
  addUser: () => guarded(async () => {
    const id = $('#nuId').value.trim(), name = $('#nuName').value.trim(), pw = $('#nuPw').value, role = $('#nuRole').value;
    if (!ID_RE.test(id)) return toast('ID ต้องเป็นตัวอังกฤษ/ตัวเลข 3–30 ตัว', true);
    if (!name) return toast('กรุณาใส่ชื่อ', true);
    if (pw.length < 6) return toast('รหัสผ่านอย่างน้อย 6 ตัว', true);
    await rpc('app_signup', { p_username: id, p_password: pw, p_name: name, p_dept: '', p_role: role });
    ['#nuId', '#nuName', '#nuPw'].forEach(x => $(x).value = '');
    toast(`เพิ่มผู้ใช้ ${id} แล้ว`); loadUsersInto();
  }),
  clearLocal: async () => {
    if (!confirm('ล้างร่างที่ยังไม่ยืนยันและแคชของแอปในเครื่องนี้?\n(ข้อมูลในระบบไม่หาย ไม่ต้องเข้าสู่ระบบใหม่)')) return;
    try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem('draft-v1'); } catch { }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { }
    try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch { }
    location.reload();
  },
  resetDlg: d => {
    const all = d.scope === 'all';
    showDialog(`<h2 style="color:var(--red)">⚠ ${all ? 'ล้างทั้งหมด รวมรุ่นและสต็อก' : 'ล้างประวัติทั้งหมดในระบบ'}</h2>
      <p>จะลบ <b>คำขอ ใบจ่าย ใบคืน รายการเครื่องค้าง ประวัติสต็อก</b>${all ? ' <b>และรุ่นเครื่องทั้งหมดพร้อมยอดสต็อก</b>' : ' (รุ่นและยอดสต็อกคงเหลือยังอยู่)'} ของทุกคน <b>กู้คืนไม่ได้</b></p>
      <button data-act="exportCsv" style="width:100%;margin-bottom:12px">⬇️ ส่งออก CSV เก็บไว้ก่อน</button>
      <label>พิมพ์คำว่า <b>ล้างข้อมูล</b> เพื่อยืนยัน<input id="resetConfirm" autocomplete="off"></label>
      <button class="danger big" data-act="doReset" data-scope="${all ? 'all' : 'tx'}" style="margin-top:0;background:var(--red);color:#fff">ยืนยันล้างข้อมูล</button>
      <button class="big" data-act="closeDlg">ยกเลิก</button>`);
  },
  doReset: d => guarded(async () => {
    const c = ($('#resetConfirm')?.value || '').trim();
    if (c !== 'ล้างข้อมูล') { const i = $('#resetConfirm'); i.setCustomValidity('พิมพ์คำว่า ล้างข้อมูล'); i.reportValidity(); i.oninput = () => i.setCustomValidity(''); return; }
    await rpc('admin_reset', { p_scope: d.scope, p_confirm: c });
    state.cart.return = []; state.ful = null; state.req.qty = {}; saveDraft();
    dlg().close(); await refresh(); render(); toast('ล้างข้อมูลแล้ว');
  }),
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
    Object.assign(state, { session: null, role: 'requester', me: { name: '', dept: '', username: '' }, anns: [], annEdit: null, acts: [], view: '', open: [], openMap: new Map(), docs: [], reqs: [], models: [], modelMap: new Map() });
    render();
  },
  exportCsv: () => guarded(async () => {
    const rows = await fetchAll((a, b) => sb.from('loans').select('*').order('issued_at', { ascending: false }).order('id').range(a, b));
    const head = ['IMEI', 'รุ่น', 'ผู้เบิก', 'แผนก', 'วัตถุประสงค์', 'วันที่จ่าย', 'เลขที่คำขอ', 'เลขที่ใบจ่าย', 'ผู้จ่าย', 'สถานะ', 'วันที่คืน', 'เลขที่ใบคืน', 'ผู้รับคืน'];
    const lines = rows.map(l => [l.imei, l.model, l.person, l.dept, l.purpose, new Date(l.issued_at).toLocaleString('sv-SE'), l.req_no || '', l.issue_doc, l.issued_by,
      l.returned_at ? (l.closed_reason === 'SOLD' ? 'ขายแล้ว' : 'คืนแล้ว') : 'ค้างอยู่', l.returned_at ? new Date(l.returned_at).toLocaleString('sv-SE') : '', l.return_doc || '', l.returned_by || '']);
    download('loans-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + [head, ...lines].map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
  })
};

/* ---------- events ---------- */
// ---- การแตะ/คลิก ----
// จอสัมผัส: ทำงานทันทีตอนยกนิ้ว (ถ้านิ้วไม่ได้ลาก) ไม่รอ click — กันอาการ "กดไม่ติด" ตอนคีย์บอร์ดหุบ/หน้าขยับ/เครื่อง PDA
// เมาส์/คีย์บอร์ด: ใช้ click ตามปกติ
const actTarget = el => el && el.closest ? el.closest('[data-view],[data-act]') : null;
function runTarget(el) {
  try {
    if (!el || el.disabled) return;
    if (el.hasAttribute('data-view')) return go(el.dataset.view);
    const f = actions[el.dataset.act]; if (f) f(el.dataset);
  } catch (err) { showError(err); }
}
let tap = null, tapDoneAt = 0;
document.addEventListener('pointerdown', e => {
  tap = null;
  if (e.pointerType === 'mouse' || !e.isPrimary) return;
  const el = actTarget(e.target);
  if (el && !el.disabled) tap = { el, x: e.clientX, y: e.clientY };
}, { passive: true });
document.addEventListener('pointermove', e => { if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 14) tap = null; }, { passive: true });
document.addEventListener('pointercancel', () => { tap = null; }, { passive: true });
document.addEventListener('pointerup', e => {
  const t = tap; tap = null;
  if (!t || e.pointerType === 'mouse' || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 14) return;
  tapDoneAt = Date.now(); runTarget(t.el);
});
document.addEventListener('click', e => {
  const el = actTarget(e.target); if (!el) return;
  if (Date.now() - tapDoneAt < 700) return; // ทำไปแล้วตอนยกนิ้ว
  runTarget(el);
});
// error ที่หลุดจากทุกที่ → แสดงบนจอ (ช่วยหาสาเหตุเวลาใช้งานจริง)
function showError(err) {
  const m = err?.message || String(err || 'unknown');
  console.error(err);
  try { toast(`เกิดข้อผิดพลาด: ${m} (v${APP_VER})`, true); } catch { }
}
addEventListener('error', e => { if (e.error || e.message) showError(e.error || e.message); });
addEventListener('unhandledrejection', e => showError(e.reason));
function onBind(e) {
  const t = e.target;
  if (t.dataset.qty) { if (e.type === 'input') setQty(+t.dataset.qty, t.value, false); else setQty(+t.dataset.qty, t.value); return; }
  if (t.id === 'impFile' && e.type === 'change') { const f = t.files && t.files[0]; t.value = ''; if (f) readImportFile(f); return; }
  if (t.id === 'impCreate' && e.type === 'change') { state.impCreate = t.checked; renderImp(); return; }
  if (t.dataset.tpl) { const n = Math.max(0, Math.min(2000, Math.floor(+t.value || 0))); if (n) state.tpl[t.dataset.tpl] = n; else delete state.tpl[t.dataset.tpl]; t.closest('.pick').classList.toggle('on', n > 0); const tt = $('#tplTotal'); if (tt) tt.textContent = tplTotal(); return; }
  if (t.id === 'allowSignup' && e.type === 'change') {
    guarded(async () => { try { await rpc('set_allow_signup', { p_on: t.checked }); state.signupOpen = t.checked; toast(t.checked ? 'เปิดให้สมัครเองแล้ว' : 'ปิดการสมัครเองแล้ว'); } catch (err) { t.checked = !t.checked; throw err; } });
    return;
  }
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
  else if (b === 'actQ') renderActs();
  else if (b === 'rcvQ') { const pl = $('#rcvModels'); if (pl) pl.innerHTML = rcvModelsHtml(); }
  else if (b === 'retQ') { const pl = $('#plist'); if (pl) pl.innerHTML = plistHtml(); }
  else if (b === 'retPerson') {
    if (state.cart.return.some(x => x.person !== v)) state.cart.return = state.cart.return.filter(x => x.person === v);
    renderRet();
  }
  else if (b === 'mq') { const p = $('#modelPick'); if (p) p.innerHTML = modelPickHtml(); }
  else if (b === 'operator') { try { localStorage.setItem('operator', v); } catch { } }
  if (b.startsWith('req.') || b.startsWith('rcv.') || b === 'rnote' || b === 'retPerson') saveDraft();
}
document.addEventListener('input', onBind);
document.addEventListener('change', onBind);
let scanBuf = '', scanT = 0;
document.addEventListener('keydown', e => {
  const scanView = state.view === 'return' ? 'return' : state.view === 'fulfill' ? 'ful' : state.view === 'receive' ? 'rcv' : state.view === 'act' ? 'act' : '';
  const t = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable;
  if (scanView && !typing && !document.querySelector('dialog[open]') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const now = Date.now(); if (now - scanT > 400) scanBuf = ''; scanT = now;
    if (e.key === 'Enter') {
      if (scanBuf.length >= 5) { e.preventDefault(); const r = addImei(scanView, scanBuf); beep(!r.startsWith('✗')); toast(r, r.startsWith('✗')); }
      scanBuf = ''; return;
    }
    if (e.key.length === 1 && /[0-9A-Za-z-]/.test(e.key)) scanBuf += e.key;
    return;
  }
  if (e.key === 'Enter' && t.id === 'actImei') { e.preventDefault(); const v = t.value.trim(); if (v) { const r = actScan(v); if (r.startsWith('✗')) { beep(false); toast(r, true); } } return; }
  if (e.key !== 'Enter' || !t.classList?.contains('wedge')) return;
  e.preventDefault();
  const code = e.target.value.trim(); e.target.value = ''; if (!code) return;
  const r = addImei(e.target.dataset.k, code);
  beep(!r.startsWith('✗')); toast(r, r.startsWith('✗'));
});
document.addEventListener('submit', e => {
  const id = e.target.getAttribute('id'); // ไม่ใช้ e.target.id — ช่องกรอกในฟอร์มอาจบังชื่อนี้
  if (id !== 'loginForm' && id !== 'signupForm') return;
  e.preventDefault();
  const f = new FormData(e.target), get = k => String(f.get(k) || '').trim();
  guarded(async () => {
    let res;
    if (id === 'loginForm') {
      res = await sb.auth.signInWithPassword({ email: toEmail(get('uid')), password: String(f.get('password')) });
    } else {
      const uid = get('uid'), name = get('name'), pw = String(f.get('password'));
      if (!ID_RE.test(uid)) return toast('ID ต้องเป็นตัวอังกฤษ/ตัวเลข 3–30 ตัว', true);
      if (!name) return toast('กรุณาใส่ชื่อ-นามสกุล', true);
      if (pw.length < 6) return toast('รหัสผ่านอย่างน้อย 6 ตัว', true);
      if (pw !== String(f.get('password2'))) return toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', true);
      // สร้างบัญชีผ่านฟังก์ชันในฐานข้อมูล (ไม่ติดการตรวจอีเมลของ Supabase) แล้วเข้าสู่ระบบทันที
      const { error } = await sb.rpc('app_signup', { p_username: uid, p_password: pw, p_name: name, p_dept: get('dept') });
      if (error) return toast(authErr(error), true);
      res = await sb.auth.signInWithPassword({ email: toEmail(uid), password: pw });
    }
    if (res.error) return toast(authErr(res.error), true);
    state.session = res.data.session; state.view = ''; await refresh(); cleanDraft(); render();
    if (id === 'signupForm') toast('สมัครเรียบร้อย ยินดีต้อนรับ');
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
    await loadAppConfig();
    sb.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT') { state.session = null; render(); } else if (s) state.session = s; });
    if (state.session) { await refresh(); cleanDraft(); }
  }
  render();
  if ('serviceWorker' in navigator) {
    // มีเวอร์ชันใหม่ (SW ตัวใหม่เข้าควบคุม) → รีโหลดหน้าเอง 1 ครั้ง (ร่างที่ยังไม่ยืนยันเก็บไว้ในเครื่องอยู่แล้ว)
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => { });
  }
})();
