-- =============================================================================
-- A2: ลบ unique index ที่ "ปิดกั้นการนับซ้ำที่ valid"
--
-- Policy ใหม่ (Option A):
--   - กันซ้ำผ่าน client_request_id เท่านั้น (idempotency key ระดับ request)
--   - อนุญาตให้ inventory_counts มีหลายแถวที่ (warehouse, sku, location, qty)
--     เหมือนกันได้ ถ้าเกิดจากการนับจริง (counter หลายคน, re-count, ต่างรอบ)
--
-- เหตุผล: index เดิม `uq_inventory_counts_sku_loc_wh_qty` (จาก 009 STEP 3.5)
-- บล็อค business case หลายอย่างที่ valid เช่น:
--   - counter A และ B verify ได้ qty เดียวกัน → ถูก reject
--   - นับใหม่ใน cycle ต่างกัน ได้ qty เดียวกัน → ถูก reject
--   - re-count ในรอบเดียวกัน เพื่อยืนยัน → ถูก reject
--
-- รันใน Supabase SQL Editor (รันซ้ำได้ — มี IF EXISTS)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1) ตรวจว่า index ที่ strict เกินไปยังอยู่หรือไม่ (รันก่อนเพื่อตัดสินใจ)
-- -----------------------------------------------------------------------------
SELECT
    n.nspname              AS schema_name,
    c.relname              AS index_name,
    pg_get_indexdef(c.oid) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'i'
  AND c.relname IN (
      'uq_inventory_counts_sku_loc_wh_qty',
      'uq_inventory_counts_client_req'
  );


-- -----------------------------------------------------------------------------
-- STEP 2) DROP index strict — ปลอดภัย ไม่กระทบข้อมูล
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_inventory_counts_sku_loc_wh_qty;


-- -----------------------------------------------------------------------------
-- STEP 3) ยืนยันว่า idempotency key ยังคงอยู่ (จาก 009 STEP 3.1)
--          ถ้าไม่มี ให้สร้างใหม่
-- -----------------------------------------------------------------------------

-- 3.1 ตรวจว่ามี client_request_id column และ unique index แล้วหรือยัง
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'inventory_counts'
  AND column_name = 'client_request_id';

-- 3.2 ถ้ายังไม่มี → สร้าง column และ unique index
ALTER TABLE inventory_counts
    ADD COLUMN IF NOT EXISTS client_request_id UUID;

COMMENT ON COLUMN inventory_counts.client_request_id IS
    'UUID สร้างฝั่ง client — ใช้กัน insert ซ้ำจาก retry/double-click';

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_counts_client_req
    ON inventory_counts (client_request_id)
    WHERE client_request_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- STEP 4) ยืนยันผลหลังรัน
-- -----------------------------------------------------------------------------

-- 4.1 ต้องคืนแถวเดียว (uq_inventory_counts_client_req) — ไม่มี uq_inventory_counts_sku_loc_wh_qty
SELECT
    c.relname AS index_name,
    pg_get_indexdef(c.oid) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'i'
  AND n.nspname = 'public'
  AND c.relname LIKE 'uq_inventory_counts_%';


-- =============================================================================
-- หมายเหตุสำคัญ:
--
--   - เมื่อ DROP index แล้ว ระบบจะอนุญาตให้แถว (warehouse, sku, location, qty)
--     ซ้ำกันได้ ถ้าเป็นการนับจริงคนละครั้ง
--
--   - การกัน duplicate จาก "double-click" หรือ "network retry" จะอาศัย
--     client_request_id เท่านั้น (frontend สร้าง UUID ใหม่ทุก request)
--
--   - ถ้าพบ duplicate ในข้อมูลเก่าและอยากล้าง สามารถรัน 009 STEP 2.1 ได้เสมอ
--
--   - ถ้าในอนาคตต้องการ "1 SKU/loc/cycle = 1 row" → สร้าง index แบบรวม cycle_id:
--     CREATE UNIQUE INDEX uq_inventory_counts_cycle_sku_loc
--         ON inventory_counts (cycle_id, warehouse, sku_id, location, counted_qty)
--         WHERE cycle_id IS NOT NULL;
-- =============================================================================
