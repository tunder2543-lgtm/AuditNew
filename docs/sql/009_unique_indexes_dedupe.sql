-- =============================================================================
-- Stock Audit — กันข้อมูลซ้ำในตารางสำคัญ (idempotency + unique index)
-- รันใน Supabase SQL Editor (รันได้หลายครั้ง — มี IF NOT EXISTS / IF EXISTS)
--
-- นิยาม "ซ้ำ" ของโปรเจกต์นี้:
--   inventory_counts: warehouse + sku_id + location + counted_qty เหมือนกัน
--      → ต่างคลังกัน = ไม่ซ้ำ (ของจริงคนละที่)
--      → ต่างตำแหน่ง = ไม่ซ้ำ
--      → ต่างจำนวน  = ไม่ซ้ำ
--
-- ลำดับการรัน:
--   STEP 1)   ดู duplicate ปัจจุบัน (SELECT) — ไม่แก้อะไร
--   STEP 2)   ล้าง duplicate เก่า (DELETE) — ⚠ ทำสำรองก่อน
--   STEP 3)   สร้าง column + unique index (กันซ้ำในอนาคต ผ่าน client_request_id)
--   STEP 3.5) ❌ DEPRECATED — ใช้ docs/sql/011 แทน
--   STEP 4)   ตรวจซ้ำหลังรัน
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1) สำรวจ duplicate ปัจจุบัน (รันก่อนเพื่อดูว่ามีอะไรซ้ำบ้าง)
-- -----------------------------------------------------------------------------

-- 1.1 inventory_counts ซ้ำ (sku + location + warehouse + counted_qty)
SELECT
    sku_id,
    location,
    warehouse,
    counted_qty,
    COUNT(*)                       AS row_count,
    array_agg(id ORDER BY created_at) AS ids,
    MIN(created_at)                AS first_at,
    MAX(created_at)                AS last_at
FROM inventory_counts
GROUP BY sku_id, location, warehouse, counted_qty
HAVING COUNT(*) > 1
ORDER BY row_count DESC, sku_id
LIMIT 500;

-- 1.2 sku_master ซ้ำ (sku_name + warehouse)
SELECT
    sku_name,
    warehouse,
    COUNT(*)                  AS row_count,
    array_agg(id ORDER BY id) AS ids
FROM sku_master
WHERE COALESCE(TRIM(warehouse), '') <> ''
GROUP BY sku_name, warehouse
HAVING COUNT(*) > 1
ORDER BY row_count DESC, sku_name;

-- 1.3 stock_adjustments: draft ซ้ำ (cycle + sku) — ปกติ 1 draft ต่อ SKU เท่านั้น
SELECT
    cycle_id,
    sku_id,
    COUNT(*)                        AS draft_count,
    array_agg(id ORDER BY created_at) AS ids
FROM stock_adjustments
WHERE status = 'draft'
GROUP BY cycle_id, sku_id
HAVING COUNT(*) > 1
ORDER BY draft_count DESC;


-- -----------------------------------------------------------------------------
-- STEP 2) ล้าง duplicate เก่า (⚠ ตรวจผลของ STEP 1 ก่อนค่อยรัน)
-- -----------------------------------------------------------------------------

-- 2.1 inventory_counts: เก็บแถวที่ created_at เก่าสุดต่อกลุ่ม (เก็บแถวแรก)
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY sku_id, location, warehouse, counted_qty
            ORDER BY created_at, id
        ) AS rn
    FROM inventory_counts
)
DELETE FROM inventory_counts
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2.2 sku_master: เก็บ id เล็กสุดต่อ (sku_name + warehouse)
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY sku_name, warehouse
            ORDER BY id
        ) AS rn
    FROM sku_master
    WHERE COALESCE(TRIM(warehouse), '') <> ''
)
DELETE FROM sku_master
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2.3 stock_adjustments: เก็บ draft แถว created_at เก่าสุดต่อ (cycle + sku)
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY cycle_id, sku_id
            ORDER BY created_at, id
        ) AS rn
    FROM stock_adjustments
    WHERE status = 'draft'
)
DELETE FROM stock_adjustments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);


-- -----------------------------------------------------------------------------
-- STEP 3) สร้าง column + unique index (กันซ้ำในอนาคต)
-- -----------------------------------------------------------------------------

-- 3.1 inventory_counts: idempotency key
ALTER TABLE inventory_counts
    ADD COLUMN IF NOT EXISTS client_request_id UUID;

COMMENT ON COLUMN inventory_counts.client_request_id IS
    'UUID สร้างฝั่ง client ใช้กัน insert ซ้ำจากการ retry/double-click';

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_counts_client_req
    ON inventory_counts (client_request_id)
    WHERE client_request_id IS NOT NULL;

-- 3.2 sku_master: 1 sku_name ต่อ 1 warehouse
CREATE UNIQUE INDEX IF NOT EXISTS uq_sku_master_name_warehouse
    ON sku_master (sku_name, warehouse)
    WHERE warehouse IS NOT NULL AND TRIM(warehouse) <> '';

-- 3.3 stock_adjustments: 1 draft ต่อ (cycle, sku)
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_adj_draft_per_sku
    ON stock_adjustments (cycle_id, sku_id)
    WHERE status = 'draft';

-- 3.4 chat_messages: กันส่งซ้ำผ่าน client_msg_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_client_id
    ON chat_messages (client_msg_id)
    WHERE client_msg_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- STEP 3.5) ❌ DEPRECATED — ห้ามรัน
--
-- เดิม index นี้ใช้สำหรับ "1 SKU/ตำแหน่ง/คลัง = 1 ค่านับ" แต่ปิดกั้น
-- business case จริงหลายอย่าง (verify ข้ามคน, นับข้ามรอบ, re-count)
--
-- ถูกแทนที่ด้วย policy ใหม่ (Option A): กันซ้ำผ่าน client_request_id เท่านั้น
-- ดูรายละเอียดที่ docs/sql/011_drop_strict_inventory_counts_index.sql
--
-- หากเคยรันมาก่อน → รัน 011 เพื่อ DROP index นี้ออก
-- -----------------------------------------------------------------------------
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_counts_sku_loc_wh_qty
--     ON inventory_counts (warehouse, sku_id, location, counted_qty);


-- -----------------------------------------------------------------------------
-- STEP 4) ตรวจสอบหลังรัน — ควรได้ 0 แถวทั้งหมด
-- -----------------------------------------------------------------------------
SELECT 'inventory_counts dup' AS kind, COUNT(*) AS remaining FROM (
    SELECT 1 FROM inventory_counts
    GROUP BY warehouse, sku_id, location, counted_qty HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 'sku_master dup', COUNT(*) FROM (
    SELECT 1 FROM sku_master WHERE COALESCE(TRIM(warehouse), '') <> ''
    GROUP BY sku_name, warehouse HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 'stock_adj draft dup', COUNT(*) FROM (
    SELECT 1 FROM stock_adjustments WHERE status = 'draft'
    GROUP BY cycle_id, sku_id HAVING COUNT(*) > 1
) t;


-- -----------------------------------------------------------------------------
-- ตรวจสอบหลังรัน — ควรได้ 0 แถวทั้งหมด
-- -----------------------------------------------------------------------------
-- SELECT 'inventory_counts dup' AS kind, COUNT(*) FROM (
--     SELECT 1 FROM inventory_counts GROUP BY sku_id, location, warehouse, counted_qty HAVING COUNT(*) > 1
-- ) t
-- UNION ALL
-- SELECT 'sku_master dup', COUNT(*) FROM (
--     SELECT 1 FROM sku_master WHERE COALESCE(TRIM(warehouse), '') <> ''
--     GROUP BY sku_name, warehouse HAVING COUNT(*) > 1
-- ) t
-- UNION ALL
-- SELECT 'stock_adj draft dup', COUNT(*) FROM (
--     SELECT 1 FROM stock_adjustments WHERE status='draft'
--     GROUP BY cycle_id, sku_id HAVING COUNT(*) > 1
-- ) t;
