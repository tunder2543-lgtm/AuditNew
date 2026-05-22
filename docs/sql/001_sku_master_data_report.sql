-- =============================================================================
-- Stock Audit — รายงานความถูกต้องข้อมูล (อ่านอย่างเดียว ไม่แก้ schema)
-- รันใน Supabase SQL Editor
-- หมายเหตุ: sku_name ซ้ำได้ — ไม่ใส่ UNIQUE บน sku_name
-- =============================================================================

-- 1) sku_master: คู่ (sku_name, warehouse) ที่มีมากกว่า 1 แถว (ambiguous สำหรับ import อัตโนมัติ)
SELECT
    sku_name,
    warehouse,
    COUNT(*) AS row_count,
    array_agg(id ORDER BY id) AS ids
FROM sku_master
WHERE COALESCE(TRIM(warehouse), '') <> ''
GROUP BY sku_name, warehouse
HAVING COUNT(*) > 1
ORDER BY row_count DESC, sku_name;

-- 2) sku_master: แถวที่ไม่มีคลัง (ควรเติม warehouse)
SELECT id, sku_name, name_pro, warehouse
FROM sku_master
WHERE warehouse IS NULL OR TRIM(warehouse) = ''
ORDER BY sku_name;

-- 3) sku_master: สรุปต่อคลัง
SELECT
    COALESCE(NULLIF(TRIM(warehouse), ''), '(ว่าง)') AS warehouse,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT sku_name) AS distinct_sku_names
FROM sku_master
GROUP BY COALESCE(NULLIF(TRIM(warehouse), ''), '(ว่าง)')
ORDER BY total_rows DESC;

-- 4) inventory_counts: ซ้ำ (sku_id + location + warehouse) — ใช้ตรวจก่อน audit
--    แอปจะ flag เป็น「ข้อมูลซ้ำ」ไม่ให้ผ่าน「ถูกต้อง」
SELECT
    sku_id,
    location,
    warehouse,
    COUNT(*) AS row_count,
    array_agg(id ORDER BY created_at DESC) AS ids
FROM inventory_counts
GROUP BY sku_id, location, warehouse
HAVING COUNT(*) > 1
ORDER BY row_count DESC
LIMIT 200;
