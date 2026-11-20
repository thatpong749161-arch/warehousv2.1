-- ระบบเบิก/คืนเครื่อง v2 — คำขอเบิก (รุ่น + จำนวน) · สต็อกนับจำนวน · สแกน IMEI ตอนจ่าย
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- (รันซ้ำได้อย่างปลอดภัย ไม่ลบข้อมูลเดิม · ใช้อัปเกรดจากเวอร์ชันแรกได้เลย)
--
-- สิทธิ์ผู้ใช้
--   requester (ผู้เบิก)     : ส่งคำขอโดยเลือกรุ่น + จำนวน, ดู/ยกเลิกคำขอของตัวเอง
--   issuer    (ผู้จ่ายเบิก) : จัดการรุ่น/สต็อก, จ่ายตามคำขอ (สแกน IMEI), รับคืน, ดูทุกอย่าง

-- ───────── ตารางเดิม ─────────
create table if not exists public.documents (
  doc_no      text primary key,
  type        text not null check (type in ('ISSUE','RETURN')),
  person      text not null,
  dept        text not null default '',
  purpose     text not null default '',
  note        text not null default '',
  by_name     text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.document_items (
  id      bigint generated always as identity primary key,
  doc_no  text not null references public.documents(doc_no) on delete cascade,
  imei    text not null,
  model   text not null default ''
);
create index if not exists document_items_doc_idx  on public.document_items(doc_no);
create index if not exists document_items_imei_idx on public.document_items(imei);

-- 1 แถว = การจ่ายเครื่อง 1 เครื่อง; returned_at เป็น null = ยังค้างอยู่กับผู้เบิก
create table if not exists public.loans (
  id          bigint generated always as identity primary key,
  imei        text not null,
  model       text not null default '',
  person      text not null,
  dept        text not null default '',
  purpose     text not null default '',
  issue_doc   text not null references public.documents(doc_no),
  issued_at   timestamptz not null default now(),
  issued_by   text not null default '',
  return_doc  text references public.documents(doc_no),
  returned_at timestamptz,
  returned_by text
);
create unique index if not exists loans_one_open_per_imei on public.loans(imei) where returned_at is null;
create index if not exists loans_imei_idx   on public.loans(imei);
create index if not exists loans_person_idx on public.loans(person);

create table if not exists public.doc_counters (
  prefix text not null,
  day    text not null,
  n      int  not null default 0,
  primary key (prefix, day)
);

-- ───────── ตารางใหม่ (v2) ─────────
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  role       text not null default 'requester' check (role in ('requester','issuer')),
  created_at timestamptz not null default now()
);

-- รุ่นเครื่อง + สต็อก (นับจำนวน ไม่อิง IMEI)
create table if not exists public.models (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  stock      int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ความเคลื่อนไหวสต็อก: INIT ยอดเริ่มต้น / IN รับเข้า / OUT ตัดออก / SET ตรวจนับ / ISSUE จ่าย / RETURN รับคืน
create table if not exists public.stock_moves (
  id         bigint generated always as identity primary key,
  model_id   bigint not null references public.models(id),
  delta      int  not null,
  balance    int  not null,
  reason     text not null,
  ref        text not null default '',
  note       text not null default '',
  by_name    text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists stock_moves_model_idx on public.stock_moves(model_id, created_at desc);

-- คำขอเบิก (ผู้เบิกเลือกรุ่น + จำนวน)
create table if not exists public.requests (
  req_no       text primary key,
  status       text not null default 'PENDING' check (status in ('PENDING','ISSUED','CANCELLED')),
  person       text not null,
  dept         text not null default '',
  purpose      text not null default '',
  note         text not null default '',
  by_name      text not null default '',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  issue_doc    text references public.documents(doc_no),
  issued_at    timestamptz,
  issued_by    text,
  cancelled_at timestamptz,
  cancelled_by text
);
create index if not exists requests_status_idx on public.requests(status, created_at desc);
create index if not exists requests_owner_idx  on public.requests(created_by);

create table if not exists public.request_items (
  id       bigint generated always as identity primary key,
  req_no   text not null references public.requests(req_no) on delete cascade,
  model_id bigint not null references public.models(id),
  model    text not null,
  qty      int  not null check (qty > 0),
  issued   int  not null default 0
);
create index if not exists request_items_req_idx on public.request_items(req_no);

alter table public.loans     add column if not exists model_id bigint references public.models(id);
alter table public.loans     add column if not exists req_no   text;
alter table public.documents add column if not exists req_no   text not null default '';
-- รับคืนไม่ครบ: เก็บรายการเครื่องที่ยังไม่คืน + เหตุผล ไว้ในใบรับคืน และเหตุผลล่าสุดไว้ที่เครื่อง
alter table public.documents add column if not exists missing        jsonb not null default '[]';
alter table public.documents add column if not exists missing_reason text  not null default '';
alter table public.loans     add column if not exists last_note      text  not null default '';
-- ปิดรายการแบบไหน: RETURN = คืนเข้าคลัง (สต็อก +1), SOLD = ขายแล้ว (ไม่คืนสต็อก — ตัดไปตั้งแต่ตอนจ่าย)
alter table public.loans     add column if not exists closed_reason  text  not null default '';
alter table public.documents add column if not exists sold           jsonb not null default '[]';
create index if not exists loans_req_idx on public.loans(req_no);

-- ───────── ผู้ใช้ / สิทธิ์ ─────────
-- อัปเกรดจากเวอร์ชันแรก: ผู้ใช้ที่มีอยู่แล้วทั้งหมด = ผู้จ่ายเบิก (เจ้าหน้าที่คลังเดิม)
insert into public.profiles(user_id, email, role)
select id, coalesce(email, ''), 'issuer' from auth.users
on conflict (user_id) do nothing;

-- ผู้ใช้ใหม่ = ผู้เบิก (ยกเว้นคนแรกของระบบที่ยังไม่มีผู้จ่ายเบิกเลย → เป็นผู้จ่ายเบิก)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email, role)
  values (new.id, coalesce(new.email, ''),
          case when exists (select 1 from profiles where role = 'issuer') then 'requester' else 'issuer' end)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_issuer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where user_id = auth.uid() and role = 'issuer')
$$;

create or replace function public.set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_issuer() then raise exception 'เฉพาะผู้จ่ายเบิกเท่านั้น'; end if;
  if p_user = auth.uid() then raise exception 'เปลี่ยนสิทธิ์ของตัวเองไม่ได้'; end if;
  if p_role not in ('requester','issuer') then raise exception 'สิทธิ์ไม่ถูกต้อง'; end if;
  update profiles set role = p_role where user_id = p_user;
end $$;

-- ───────── เลขที่เอกสาร (เวลาไทย) — REQ-/ISS-/RET-YYMMDD-001 ─────────
create or replace function public.next_doc_no(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare d text := to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD'); k int;
begin
  insert into doc_counters(prefix, day, n) values (p_prefix, d, 1)
  on conflict (prefix, day) do update set n = doc_counters.n + 1
  returning n into k;
  return p_prefix || '-' || d || '-' || lpad(k::text, 3, '0');
end $$;

-- ───────── รุ่น / สต็อก (ผู้จ่ายเบิก) ─────────
create or replace function public.model_save(p_id bigint, p_name text, p_active boolean, p_stock int, p_by text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_name text := trim(coalesce(p_name, ''));
begin
  if not is_issuer() then raise exception 'เฉพาะผู้จ่ายเบิกเท่านั้น'; end if;
  if v_name = '' then raise exception 'กรุณาระบุชื่อรุ่น'; end if;
  if exists (select 1 from models where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'มีรุ่น "%" อยู่แล้ว', v_name;
  end if;
  if p_id is null then
    if coalesce(p_stock, 0) < 0 then raise exception 'สต็อกเริ่มต้นต้องไม่ติดลบ'; end if;
    insert into models(name, stock) values (v_name, coalesce(p_stock, 0)) returning id into v_id;
    if coalesce(p_stock, 0) > 0 then
      insert into stock_moves(model_id, delta, balance, reason, by_name)
      values (v_id, p_stock, p_stock, 'INIT', coalesce(trim(p_by), ''));
    end if;
    -- เครื่องที่ค้างอยู่จากเวอร์ชันแรกที่ชื่อรุ่นตรงกัน → ผูกกับรุ่นนี้ (คืนแล้วสต็อกจะเพิ่มให้)
    update loans set model_id = v_id
    where model_id is null and returned_at is null and lower(trim(model)) = lower(v_name);
  else
    update models set name = v_name, active = coalesce(p_active, active) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'ไม่พบรุ่นนี้'; end if;
  end if;
  return v_id;
end $$;

-- p_mode: add = รับเข้า, sub = ตัดออก, set = ตั้งยอดตามที่ตรวจนับ
create or replace function public.stock_adjust(p_model_id bigint, p_mode text, p_qty int, p_note text, p_by text)
returns int language plpgsql security definer set search_path = public as $$
declare m models%rowtype; v_delta int; v_bal int;
begin
  if not is_issuer() then raise exception 'เฉพาะผู้จ่ายเบิกเท่านั้น'; end if;
  select * into m from models where id = p_model_id for update;
  if not found then raise exception 'ไม่พบรุ่นนี้'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนไม่ถูกต้อง'; end if;
  if p_mode <> 'set' and p_qty = 0 then raise exception 'กรุณาใส่จำนวน'; end if;
  v_delta := case p_mode when 'add' then p_qty when 'sub' then -p_qty when 'set' then p_qty - m.stock end;
  if v_delta is null then raise exception 'รูปแบบการปรับไม่ถูกต้อง'; end if;
  if m.stock + v_delta < 0 then raise exception 'สต็อกไม่พอ (คงเหลือ %)', m.stock; end if;
  update models set stock = stock + v_delta where id = p_model_id returning stock into v_bal;
  insert into stock_moves(model_id, delta, balance, reason, note, by_name)
  values (p_model_id, v_delta, v_bal,
          case p_mode when 'add' then 'IN' when 'sub' then 'OUT' else 'SET' end,
          coalesce(trim(p_note), ''), coalesce(trim(p_by), ''));
  return v_bal;
end $$;

-- ───────── คำขอเบิก (ทุกคน) ─────────
-- p_items: [{"model_id":1,"qty":3}, ...]
create or replace function public.req_create(
  p_person text, p_dept text, p_purpose text, p_note text, p_by text, p_items jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_no text; it jsonb; m models%rowtype; q int;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if coalesce(trim(p_person), '') = '' then raise exception 'กรุณาระบุผู้เบิก'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ยังไม่ได้เลือกรุ่น';
  end if;

  v_no := next_doc_no('REQ');
  insert into requests(req_no, person, dept, purpose, note, by_name)
  values (v_no, trim(p_person), coalesce(trim(p_dept),''), coalesce(trim(p_purpose),''),
          coalesce(trim(p_note),''), coalesce(trim(p_by),''));

  for it in select * from jsonb_array_elements(p_items) loop
    q := (it->>'qty')::int;
    if q is null or q < 1 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
    select * into m from models where id = (it->>'model_id')::bigint and active;
    if not found then raise exception 'ไม่พบรุ่นที่เลือก (อาจถูกปิดใช้งาน)'; end if;
    insert into request_items(req_no, model_id, model, qty) values (v_no, m.id, m.name, q);
  end loop;
  return v_no;
end $$;

create or replace function public.req_cancel(p_req_no text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare r requests%rowtype;
begin
  select * into r from requests where req_no = p_req_no for update;
  if not found then raise exception 'ไม่พบคำขอ'; end if;
  if not (is_issuer() or r.created_by = auth.uid()) then raise exception 'ไม่มีสิทธิ์ยกเลิกคำขอนี้'; end if;
  if r.status <> 'PENDING' then raise exception 'ยกเลิกได้เฉพาะคำขอที่รอจ่าย'; end if;
  update requests set status = 'CANCELLED', cancelled_at = now(), cancelled_by = coalesce(trim(p_by),'')
  where req_no = p_req_no;
end $$;

-- ───────── จ่ายตามคำขอ (ผู้จ่ายเบิก สแกน IMEI) — atomic ─────────
-- p_items: [{"imei":"350000000000000","model_id":1}, ...]
create or replace function public.req_fulfill(p_req_no text, p_by text, p_items jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype; ri request_items%rowtype; v_no text; it jsonb;
  v_imei text; v_model text; v_holder text; n int; rec record; v_bal int; v_by text := coalesce(trim(p_by),'');
begin
  if not is_issuer() then raise exception 'เฉพาะผู้จ่ายเบิกเท่านั้น'; end if;
  select * into r from requests where req_no = p_req_no for update;
  if not found then raise exception 'ไม่พบคำขอ'; end if;
  if r.status <> 'PENDING' then raise exception 'คำขอนี้ไม่ได้อยู่ในสถานะรอจ่ายแล้ว'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ยังไม่ได้สแกนเครื่อง';
  end if;
  if (select count(distinct upper(trim(x->>'imei'))) from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'มี IMEI ซ้ำในรายการ';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x
             where not exists (select 1 from request_items i
                               where i.req_no = p_req_no and i.model_id = (x->>'model_id')::bigint)) then
    raise exception 'มีเครื่องที่ไม่ได้อยู่ในรุ่นที่ขอ';
  end if;
  for ri in select * from request_items where req_no = p_req_no loop
    select count(*) into n from jsonb_array_elements(p_items) x where (x->>'model_id')::bigint = ri.model_id;
    if n > ri.qty then raise exception 'รุ่น % จ่ายเกินจำนวนที่ขอ (% / %)', ri.model, n, ri.qty; end if;
    update request_items set issued = n where id = ri.id;
  end loop;

  v_no := next_doc_no('ISS');
  insert into documents(doc_no, type, person, dept, purpose, note, by_name, req_no)
  values (v_no, 'ISSUE', r.person, r.dept, r.purpose, r.note, v_by, p_req_no);

  for it in select * from jsonb_array_elements(p_items) loop
    v_imei := upper(trim(it->>'imei'));
    if v_imei !~ '^[A-Z0-9-]{5,30}$' then raise exception 'IMEI/ซีเรียล % ไม่ถูกต้อง', v_imei; end if;
    select name into v_model from models where id = (it->>'model_id')::bigint;
    begin
      insert into loans(imei, model, model_id, person, dept, purpose, issue_doc, issued_by, req_no)
      values (v_imei, v_model, (it->>'model_id')::bigint, r.person, r.dept, r.purpose, v_no, v_by, p_req_no);
    exception when unique_violation then
      select person into v_holder from loans where imei = v_imei and returned_at is null;
      raise exception 'IMEI % ถูกเบิกอยู่แล้ว (ผู้เบิก: %)', v_imei, coalesce(v_holder, '-');
    end;
    insert into document_items(doc_no, imei, model) values (v_no, v_imei, v_model);
  end loop;

  -- ตัดสต็อกตามจำนวนที่จ่ายจริง (ยอมให้ติดลบได้ เพราะเครื่องอยู่ในมือแล้ว — แอปจะแจ้งเตือน)
  for rec in select (x->>'model_id')::bigint as mid, count(*)::int as c
             from jsonb_array_elements(p_items) x group by 1 loop
    update models set stock = stock - rec.c where id = rec.mid returning stock into v_bal;
    insert into stock_moves(model_id, delta, balance, reason, ref, by_name)
    values (rec.mid, -rec.c, v_bal, 'ISSUE', v_no, v_by);
  end loop;

  update requests set status = 'ISSUED', issue_doc = v_no, issued_at = now(), issued_by = v_by
  where req_no = p_req_no;
  return v_no;
end $$;

-- ───────── รับคืน / ขาย (ผู้จ่ายเบิก) — atomic ─────────
-- p_imeis   : เครื่องที่ยิงคืน → ปิดรายการ + คืนสต็อก
-- p_sold    : เครื่องที่ขายแล้ว (ไม่ต้องยิง) → ปิดรายการ ไม่คืนสต็อก
-- p_missing : เครื่องที่ยังค้างต่อ (ต้องมี p_reason)
drop function if exists public.dev_return(text[],text,text);
drop function if exists public.dev_return(text[],text,text,text[],text);
create or replace function public.dev_return(
  p_imeis text[], p_by text, p_note text, p_missing text[] default '{}', p_reason text default '', p_sold text[] default '{}')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_no text; v_imei text; l loans%rowtype; v_persons text[] := '{}'; v_person text; v_dept text := '';
  v_by text := coalesce(trim(p_by),''); v_reason text := coalesce(trim(p_reason),'');
  v_ret text[]; v_sold text[]; v_missing text[]; v_all text[]; v_bal int; rec record;
begin
  if not is_issuer() then raise exception 'เฉพาะผู้จ่ายเบิกเท่านั้น'; end if;
  select coalesce(array_agg(distinct upper(trim(x))), '{}') into v_ret  from unnest(coalesce(p_imeis, '{}')) x where trim(x) <> '';
  select coalesce(array_agg(distinct upper(trim(x))), '{}') into v_sold from unnest(coalesce(p_sold, '{}')) x where trim(x) <> '';
  select coalesce(array_agg(distinct upper(trim(x))), '{}') into v_missing
  from unnest(coalesce(p_missing, '{}')) x where trim(x) <> '' and not (upper(trim(x)) = any(v_sold));
  if cardinality(v_ret) = 0 and cardinality(v_sold) = 0 then raise exception 'ยังไม่มีเครื่องที่จะคืนหรือขาย'; end if;
  if v_ret && v_sold then raise exception 'เครื่องที่ยิงคืนแล้ว ระบุว่าขายซ้ำไม่ได้'; end if;
  if cardinality(v_missing) > 0 and v_reason = '' then raise exception 'กรุณาระบุเหตุผลของเครื่องที่ยังไม่คืน'; end if;

  v_all := v_ret || v_sold;
  foreach v_imei in array v_all loop
    select * into l from loans where imei = v_imei and returned_at is null for update;
    if not found then raise exception 'IMEI % ไม่ได้อยู่ในสถานะถูกเบิก', v_imei; end if;
    if not (l.person = any(v_persons)) then v_persons := v_persons || l.person; end if;
    v_dept := l.dept;
  end loop;
  v_person := case when array_length(v_persons, 1) = 1 then v_persons[1] else 'หลายคน: ' || array_to_string(v_persons, ', ') end;

  v_no := next_doc_no('RET');
  insert into documents(doc_no, type, person, dept, note, by_name, missing, missing_reason, sold)
  values (v_no, 'RETURN', v_person, case when array_length(v_persons,1) = 1 then v_dept else '' end,
          coalesce(trim(p_note),''), v_by,
          coalesce((select jsonb_agg(jsonb_build_object('imei', imei, 'model', model, 'issue_doc', issue_doc) order by id)
                    from loans where imei = any(v_missing) and returned_at is null and not (imei = any(v_all))), '[]'),
          case when cardinality(v_missing) > 0 then v_reason else '' end,
          coalesce((select jsonb_agg(jsonb_build_object('imei', imei, 'model', model, 'issue_doc', issue_doc) order by id)
                    from loans where imei = any(v_sold) and returned_at is null), '[]'));

  insert into document_items(doc_no, imei, model)
  select v_no, imei, model from loans where imei = any(v_ret) and returned_at is null order by id;
  update loans set returned_at = now(), return_doc = v_no, returned_by = v_by, closed_reason = 'RETURN'
  where imei = any(v_ret) and returned_at is null;
  update loans set returned_at = now(), return_doc = v_no, returned_by = v_by, closed_reason = 'SOLD',
                   last_note = 'ขายแล้ว (' || v_no || ')'
  where imei = any(v_sold) and returned_at is null;

  if cardinality(v_missing) > 0 then
    update loans set last_note = v_reason || ' (' || v_no || ')'
    where imei = any(v_missing) and returned_at is null;
  end if;

  -- คืนเข้าคลัง → สต็อกเพิ่ม
  for rec in select model_id, count(*)::int as c from loans
             where return_doc = v_no and closed_reason = 'RETURN' and model_id is not null group by model_id loop
    update models set stock = stock + rec.c where id = rec.model_id returning stock into v_bal;
    insert into stock_moves(model_id, delta, balance, reason, ref, by_name)
    values (rec.model_id, rec.c, v_bal, 'RETURN', v_no, v_by);
  end loop;
  -- ขาย → สต็อกไม่เปลี่ยน (ตัดไปตอนจ่ายแล้ว) บันทึกไว้ในประวัติเพื่อตรวจสอบ
  for rec in select model_id, count(*)::int as c from loans
             where return_doc = v_no and closed_reason = 'SOLD' and model_id is not null group by model_id loop
    insert into stock_moves(model_id, delta, balance, reason, ref, note, by_name)
    values (rec.model_id, 0, (select stock from models where id = rec.model_id), 'SOLD', v_no, 'ขาย ' || rec.c || ' เครื่อง', v_by);
  end loop;
  return v_no;
end $$;

-- ฟังก์ชันของเวอร์ชันแรก (เบิกโดยไม่ผ่านคำขอ/ไม่ตัดสต็อก) — เลิกใช้
drop function if exists public.issue_devices(text,text,text,text,text,jsonb);
drop function if exists public.return_devices(text[],text,text);

-- ───────── สิทธิ์ (RLS): อ่านตามบทบาท / เขียนได้ผ่านฟังก์ชันเท่านั้น ─────────
alter table public.documents      enable row level security;
alter table public.document_items enable row level security;
alter table public.loans          enable row level security;
alter table public.doc_counters   enable row level security;
alter table public.profiles       enable row level security;
alter table public.models         enable row level security;
alter table public.stock_moves    enable row level security;
alter table public.requests       enable row level security;
alter table public.request_items  enable row level security;

drop policy if exists "read documents"      on public.documents;
drop policy if exists "read document_items" on public.document_items;
drop policy if exists "read loans"          on public.loans;
drop policy if exists "read profiles"       on public.profiles;
drop policy if exists "read models"         on public.models;
drop policy if exists "read stock_moves"    on public.stock_moves;
drop policy if exists "read requests"       on public.requests;
drop policy if exists "read request_items"  on public.request_items;

-- ผู้จ่ายเบิกเห็นทุกอย่าง · ผู้เบิกเห็นเฉพาะคำขอ/ใบจ่าย/เครื่องของคำขอตัวเอง
create policy "read profiles" on public.profiles for select to authenticated
  using (user_id = auth.uid() or is_issuer());
create policy "read models" on public.models for select to authenticated using (true);
create policy "read stock_moves" on public.stock_moves for select to authenticated using (is_issuer());
create policy "read requests" on public.requests for select to authenticated
  using (created_by = auth.uid() or is_issuer());
create policy "read request_items" on public.request_items for select to authenticated
  using (exists (select 1 from requests r where r.req_no = request_items.req_no));
create policy "read loans" on public.loans for select to authenticated
  using (is_issuer() or exists (select 1 from requests r where r.req_no = loans.req_no and r.created_by = auth.uid()));
create policy "read documents" on public.documents for select to authenticated
  using (is_issuer() or exists (select 1 from requests r where r.issue_doc = documents.doc_no and r.created_by = auth.uid()));
create policy "read document_items" on public.document_items for select to authenticated
  using (exists (select 1 from documents d where d.doc_no = document_items.doc_no));

revoke all on public.documents, public.document_items, public.loans, public.doc_counters,
              public.profiles, public.models, public.stock_moves, public.requests, public.request_items
  from anon, authenticated;
grant select on public.documents, public.document_items, public.loans,
                public.profiles, public.models, public.stock_moves, public.requests, public.request_items
  to authenticated;

revoke all on function public.next_doc_no(text) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_role(uuid,text)                              from public, anon;
revoke all on function public.model_save(bigint,text,boolean,int,text)         from public, anon;
revoke all on function public.stock_adjust(bigint,text,int,text,text)          from public, anon;
revoke all on function public.req_create(text,text,text,text,text,jsonb)       from public, anon;
revoke all on function public.req_cancel(text,text)                            from public, anon;
revoke all on function public.req_fulfill(text,text,jsonb)                     from public, anon;
revoke all on function public.dev_return(text[],text,text,text[],text,text[]) from public, anon;
grant execute on function public.is_issuer()                                   to authenticated;
grant execute on function public.set_role(uuid,text)                           to authenticated;
grant execute on function public.model_save(bigint,text,boolean,int,text)      to authenticated;
grant execute on function public.stock_adjust(bigint,text,int,text,text)       to authenticated;
grant execute on function public.req_create(text,text,text,text,text,jsonb)    to authenticated;
grant execute on function public.req_cancel(text,text)                         to authenticated;
grant execute on function public.req_fulfill(text,text,jsonb)                  to authenticated;
grant execute on function public.dev_return(text[],text,text,text[],text,text[]) to authenticated;

notify pgrst, 'reload schema';
