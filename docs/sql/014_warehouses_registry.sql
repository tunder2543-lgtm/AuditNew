-- =============================================================================
-- 014 — Dynamic warehouse registry (รองรับเพิ่มคลังใหม่ทั้งระบบ)
-- รันหลัง 002, 009, 010, 011, 012, 013
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Registry รายชื่อคลัง
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
    name        TEXT PRIMARY KEY,
    sort_order  INT NOT NULL DEFAULT 999,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE warehouses IS
    'รายชื่อคลังกลางของระบบ ใช้เติม dropdown/checkbox ทุกหน้า';

COMMENT ON COLUMN warehouses.name IS
    'ชื่อคลัง เช่น ตึกกันตนา, หน้าไลฟ์(บางกรวย), คลังอะไหล่, TEST';

-- -----------------------------------------------------------------------------
-- 2) Seed คลังมาตรฐาน (idempotent)
-- -----------------------------------------------------------------------------
INSERT INTO warehouses (name, sort_order, is_active)
VALUES
    ('ตึกกันตนา', 1, true),
    ('หน้าไลฟ์(บางกรวย)', 2, true),
    ('คลังอะไหล่', 3, true)
ON CONFLICT (name) DO UPDATE
SET sort_order = EXCLUDED.sort_order;

-- -----------------------------------------------------------------------------
-- 3) Sync คลังที่มีอยู่จริงในข้อมูลเก่า (กัน dropdown หาย)
-- -----------------------------------------------------------------------------
WITH wh AS (
    SELECT DISTINCT trim(warehouse) AS name
    FROM sku_master
    WHERE trim(COALESCE(warehouse, '')) <> ''
    UNION
    SELECT DISTINCT trim(warehouse) AS name
    FROM inventory_counts
    WHERE trim(COALESCE(warehouse, '')) <> ''
    UNION
    SELECT DISTINCT trim(warehouse) AS name
    FROM count_cycles
    WHERE trim(COALESCE(warehouse, '')) <> ''
)
INSERT INTO warehouses (name, sort_order, is_active)
SELECT name, 999, true
FROM wh
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) Utility: ดึงคลัง active เรียงตาม sort_order แล้วตามชื่อ
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_active_warehouses()
RETURNS TABLE(name TEXT)
LANGUAGE sql
STABLE
AS $$
    SELECT w.name
    FROM warehouses w
    WHERE w.is_active = true
    ORDER BY w.sort_order ASC, w.name ASC;
$$;

-- ตรวจหลังรัน:
-- SELECT * FROM get_active_warehouses();
-- SELECT * FROM warehouses ORDER BY sort_order, name;
