-- =============================================================================
-- 019 — inventory_count_acceptances : "ตรวจแล้ว ยืนยันว่าปกติ"
-- ✅ รันแล้ว 2026-08-10 — ตรวจผลแล้ว: 10 คอลัมน์ · 3 index · RLS on · 1 policy · 0 แถว
--    ทดสอบ insert + กันซ้ำ (ต่างแค่ตัวพิมพ์/เว้นวรรค → 23505) ใน transaction แล้ว rollback
-- =============================================================================
-- บริบท (ตัดสินใจโดย admin 2026-08-10):
--   หน้า audit_check จะ **ไม่ลบหรือแก้จำนวนเอง** — นับมายังไงเก็บอย่างนั้น
--   หน้าที่ของระบบคือ "ชี้รายการที่ผิดปกติ แล้วให้คนมายืนยันว่าปกติหรือไม่"
--
--   เคสหลักคือ SKU + ตำแหน่งเดียวกัน มีหลายแถวจำนวนต่างกัน ซึ่ง **เป็นเรื่องปกติ**
--   เพราะสินค้าจำนวนมากถูกแบ่งใส่หลายถุง พนักงานนับแล้วบันทึกทีละถุง
--   → ระบบเตือนได้ครั้งเดียว พอคนยืนยันแล้วต้องเงียบ ไม่งั้นเตือนซ้ำทุกครั้งจนไม่มีใครอ่าน
--
--   แนวคิดเดียวกับ reconciliation_match_acceptances ที่หน้า Match ใช้อยู่แล้ว
--   ต่างกันตรงที่อันนี้ต้อง key ด้วย **ตำแหน่ง** ด้วย (ปัญหาอยู่ระดับ SKU+ตำแหน่ง)
--
-- วิธีถอย: DROP TABLE public.inventory_count_acceptances;
--          (ไม่กระทบข้อมูลผลนับ — ตารางนี้เก็บแค่ "ใครตรวจแล้วบอกว่าปกติ")
-- =============================================================================

create table if not exists public.inventory_count_acceptances (
    id           uuid primary key default gen_random_uuid(),
    cycle_id     uuid references public.count_cycles(id) on delete cascade,
    warehouse    text        not null default '',
    sku_id       text        not null,
    location     text        not null,

    -- สภาพข้อมูล "ตอนที่กดยืนยัน" — ถ้าภายหลังต่างไปจากนี้ (มีแถวเพิ่ม/จำนวนเปลี่ยน)
    -- แปลว่าการยืนยันเดิมใช้ไม่ได้แล้ว ต้องกลับมาเตือนให้ตรวจใหม่
    row_count    integer     not null,
    total_qty    numeric     not null,

    note         text,
    accepted_at  timestamptz not null default now(),
    accepted_by  text
);

comment on table public.inventory_count_acceptances is
    'บันทึกว่า "ตรวจแล้ว ยืนยันว่าปกติ" ของกลุ่มแถวนับที่ SKU+ตำแหน่งเดียวกัน — ไม่แตะข้อมูลผลนับ';
comment on column public.inventory_count_acceptances.row_count is
    'จำนวนแถวในกลุ่ม ณ เวลาที่ยืนยัน — ใช้ตรวจว่าข้อมูลเปลี่ยนหลังยืนยันหรือยัง';
comment on column public.inventory_count_acceptances.total_qty is
    'ผลรวมจำนวน ณ เวลาที่ยืนยัน — ใช้ตรวจว่าข้อมูลเปลี่ยนหลังยืนยันหรือยัง';

-- ยืนยันได้ครั้งเดียวต่อ (รอบ, SKU, ตำแหน่ง)
-- cycle_id เป็น null ได้ (แถวที่ยังไม่ผูกรอบ) จึงต้อง coalesce เป็น uuid คงที่
--
-- ⚠️ index นี้เป็นแบบ **expression** → `ON CONFLICT (cycle_id, sku_id, location)` ใช้ไม่ได้
--    (Postgres 42P10: no unique or exclusion constraint matching the ON CONFLICT specification)
--    ฝั่งหน้าเว็บจึงแยกเองเป็น insert (ของใหม่) + update by id (ของเดิม) ห้ามเปลี่ยนกลับไปใช้ upsert
--    เว้นแต่จะเพิ่ม unique constraint บนคอลัมน์ตรง ๆ (ต้องใช้ NULLS NOT DISTINCT เพราะ cycle_id null ได้)
create unique index if not exists uq_inventory_count_acceptances_key
    on public.inventory_count_acceptances (
        coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid),
        upper(btrim(sku_id)),
        upper(btrim(location))
    );

create index if not exists idx_inventory_count_acceptances_cycle
    on public.inventory_count_acceptances (cycle_id);

-- ---------- RLS ----------
-- ระบบยังไม่มีล็อกอิน (ดู 016) — anon ทำได้ทุกอย่างเหมือนตารางอื่นในหน้าเดียวกัน
-- ตารางนี้ไม่ใช่หลักฐานผลนับ จึงถอนการยืนยัน (delete) ได้โดยไม่ขัด invariant ข้อ 1
alter table public.inventory_count_acceptances enable row level security;

create policy "anon_all_inventory_count_acceptances"
    on public.inventory_count_acceptances
    for all to anon, authenticated
    using (true) with check (true);

-- ตรวจหลังรัน:
-- select count(*) from public.inventory_count_acceptances;   -- ต้องได้ 0 ไม่ใช่ error
-- insert into public.inventory_count_acceptances (cycle_id, sku_id, location, row_count, total_qty, accepted_by)
--   values (null, 'TEST-SKU', 'TEST-LOC', 2, 3, 'sql-editor');
-- delete from public.inventory_count_acceptances where sku_id = 'TEST-SKU';
