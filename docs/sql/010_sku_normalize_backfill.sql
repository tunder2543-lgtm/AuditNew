-- =============================================================================
-- Stock Audit — Backfill: normalize SKU เป็น UPPERCASE + TRIM ทั้งระบบ
-- เป้าหมาย: รวมรูปแบบ SKU ในทุกตารางให้สอดคล้องกับมาตรฐาน frontend ใหม่
--           (UPPERCASE + trim) เพื่อกัน mismatch จากตัวพิมพ์ใหญ่/เล็ก/ช่องว่าง
--
-- ลำดับการรัน (รัน Step ทีละ Step ดูผลก่อน):
--   STEP 1) สำรวจค่า SKU ที่ "ไม่ได้มาตรฐาน" (ไม่ใช่ UPPER หรือมี whitespace) — SELECT
--   STEP 2) สำรวจ "duplicate ที่จะเกิดหลัง normalize" — SELECT (สำคัญมาก!)
--   STEP 3) Backup ตารางก่อน normalize (CTAS)
--   STEP 4) Normalize ค่า SKU ในทุกตารางที่เกี่ยวข้อง (UPDATE)
--   STEP 5) ตรวจซ้ำหลัง normalize — SELECT
--
-- ⚠ ข้อควรระวัง:
--   - หาก STEP 2 พบ duplicate ที่จะเกิดขึ้น ต้องรัน docs/sql/009_unique_indexes_dedupe.sql
--     เพื่อล้าง duplicate ก่อน → แล้วค่อยกลับมารัน STEP 4
--   - sku_master มี unique index บน (sku_name) อยู่ — ถ้ามี "ABC" และ "abc" 
--     หลัง UPPER จะ conflict → ต้อง merge/delete ก่อน
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1) สำรวจค่า SKU ที่ไม่ได้มาตรฐาน
-- -----------------------------------------------------------------------------

-- 1.1 inventory_counts.sku_id ที่ยังไม่ใช่ UPPER หรือมีช่องว่างหัว/ท้าย
SELECT
    sku_id                       AS current_sku,
    UPPER(TRIM(sku_id))          AS normalized_sku,
    COUNT(*)                     AS rows_affected
FROM inventory_counts
WHERE sku_id IS NOT NULL
  AND (sku_id <> UPPER(TRIM(sku_id)) OR sku_id <> TRIM(sku_id))
GROUP BY sku_id
ORDER BY rows_affected DESC
LIMIT 500;

-- 1.2 sku_master.sku_name ที่ยังไม่ใช่ UPPER หรือมีช่องว่าง
SELECT
    sku_name                     AS current_sku,
    UPPER(TRIM(sku_name))        AS normalized_sku,
    COUNT(*)                     AS rows_affected
FROM sku_master
WHERE sku_name IS NOT NULL
  AND (sku_name <> UPPER(TRIM(sku_name)) OR sku_name <> TRIM(sku_name))
GROUP BY sku_name
ORDER BY rows_affected DESC
LIMIT 500;

-- 1.3 book_stock_lines.sku_id (ถ้าตารางนี้มี)
SELECT
    sku_id                       AS current_sku,
    UPPER(TRIM(sku_id))          AS normalized_sku,
    COUNT(*)                     AS rows_affected
FROM book_stock_lines
WHERE sku_id IS NOT NULL
  AND (sku_id <> UPPER(TRIM(sku_id)) OR sku_id <> TRIM(sku_id))
GROUP BY sku_id
ORDER BY rows_affected DESC
LIMIT 500;


-- -----------------------------------------------------------------------------
-- STEP 2) ตรวจสอบว่าหลัง normalize จะเกิด duplicate ที่ขัด unique index หรือไม่
-- -----------------------------------------------------------------------------

-- 2.1 sku_master จะ conflict ตรงไหน (กรณีมี "ABC" และ "abc" หรือ " ABC ")
SELECT
    UPPER(TRIM(sku_name))               AS normalized_sku,
    warehouse,
    COUNT(*)                            AS will_become_duplicate,
    array_agg(sku_name)                 AS current_variants,
    array_agg(id ORDER BY id)           AS row_ids
FROM sku_master
WHERE sku_name IS NOT NULL
GROUP BY UPPER(TRIM(sku_name)), warehouse
HAVING COUNT(*) > 1
ORDER BY will_become_duplicate DESC;

-- 2.2 inventory_counts จะเกิด duplicate (sku+loc+wh+qty) ใหม่หรือไม่
SELECT
    UPPER(TRIM(sku_id))                 AS normalized_sku,
    location,
    warehouse,
    counted_qty,
    COUNT(*)                            AS will_become_duplicate,
    array_agg(DISTINCT sku_id)          AS current_variants
FROM inventory_counts
WHERE sku_id IS NOT NULL
GROUP BY UPPER(TRIM(sku_id)), location, warehouse, counted_qty
HAVING COUNT(*) > 1
ORDER BY will_become_duplicate DESC
LIMIT 500;

-- 2.3 book_stock_lines จะเกิด conflict กับ uq_book_stock_cycle_sku_loc
--     (cycle_id, sku_id, COALESCE(location, '')) หรือไม่
--     ถ้ามีผลลัพธ์ ต้องรัน STEP 3.5 ก่อน STEP 4.3
SELECT
    cycle_id,
    UPPER(TRIM(sku_id))                 AS normalized_sku,
    COALESCE(location, '')              AS location_norm,
    COUNT(*)                            AS will_become_duplicate,
    array_agg(DISTINCT sku_id)          AS current_variants,
    array_agg(id ORDER BY id)           AS row_ids,
    array_agg(book_qty ORDER BY id)     AS book_qtys
FROM book_stock_lines
WHERE sku_id IS NOT NULL
GROUP BY cycle_id, UPPER(TRIM(sku_id)), COALESCE(location, '')
HAVING COUNT(*) > 1
ORDER BY will_become_duplicate DESC
LIMIT 500;


-- -----------------------------------------------------------------------------
-- STEP 3) Backup ก่อนแก้ (เผื่อต้อง rollback) — รันครั้งเดียว
-- -----------------------------------------------------------------------------

-- ⚠ ถ้ามี backup เก่าอยู่แล้ว ให้ DROP TABLE ทิ้งก่อน หรือเปลี่ยนชื่อใหม่
DROP TABLE IF EXISTS _bk_inventory_counts_pre_skunorm;
DROP TABLE IF EXISTS _bk_sku_master_pre_skunorm;
DROP TABLE IF EXISTS _bk_book_stock_lines_pre_skunorm;

CREATE TABLE _bk_inventory_counts_pre_skunorm AS
    SELECT * FROM inventory_counts;

CREATE TABLE _bk_sku_master_pre_skunorm AS
    SELECT * FROM sku_master;

CREATE TABLE _bk_book_stock_lines_pre_skunorm AS
    SELECT * FROM book_stock_lines;


-- -----------------------------------------------------------------------------
-- STEP 3.5) แก้ conflict ของ book_stock_lines ก่อน normalize (จำเป็นถ้า STEP 2.3 พบ)
--
-- กรณีที่เจอ: มี (cycle_id, location) เดียวกัน แต่ sku_id เขียนต่าง case
-- เช่น "vip327" และ "VIP327" → หลัง UPPER จะชน unique index uq_book_stock_cycle_sku_loc
--
-- กลยุทธ์: รวม book_qty (+ adjusted_book_qty ถ้ามี) ของแถว non-UPPER เข้าแถว UPPER
--          แล้วลบแถว non-UPPER ทิ้ง (ใช้แถว UPPER เป็น canonical)
--
-- หมายเหตุ: ถ้าไม่มีแถว UPPER (มีแต่ lowercase 2 แถว) จะไม่ตกในเงื่อนไขนี้ —
--           STEP 4.3 จะจัดการเองได้เพราะอัปเดตทุกแถว → กลายเป็น UPPER ทั้งคู่ → ชนกันเอง
--           ดังนั้น STEP 3.5b รวมแถว non-canonical ที่ normalize แล้วซ้ำกันด้วย
-- -----------------------------------------------------------------------------

-- 3.5a) Preview ก่อน merge — ดูคู่ที่จะถูก merge
SELECT
    canon.id            AS canonical_id,
    canon.sku_id        AS canonical_sku,
    canon.book_qty      AS canonical_qty,
    dup.id              AS duplicate_id,
    dup.sku_id          AS duplicate_sku,
    dup.book_qty        AS duplicate_qty,
    canon.cycle_id,
    COALESCE(canon.location, '') AS location_norm
FROM book_stock_lines canon
JOIN book_stock_lines dup
  ON dup.cycle_id = canon.cycle_id
 AND COALESCE(dup.location, '') = COALESCE(canon.location, '')
 AND UPPER(TRIM(dup.sku_id)) = UPPER(TRIM(canon.sku_id))
 AND dup.id <> canon.id
WHERE canon.sku_id = UPPER(TRIM(canon.sku_id))         -- canon = แถวที่เป็น UPPER อยู่แล้ว
  AND dup.sku_id   <> UPPER(TRIM(dup.sku_id))           -- dup   = แถวที่ยังไม่ UPPER
LIMIT 500;

-- 3.5b) Merge: บวก book_qty ของ duplicate (lowercase) เข้า canonical (uppercase)
UPDATE book_stock_lines AS canon
SET book_qty = canon.book_qty + dup_totals.sum_qty,
    adjusted_book_qty = COALESCE(canon.adjusted_book_qty, 0)
                      + COALESCE(dup_totals.sum_adj_qty, 0)
FROM (
    SELECT
        canon_inner.id                                       AS canon_id,
        SUM(dup_inner.book_qty)                              AS sum_qty,
        SUM(COALESCE(dup_inner.adjusted_book_qty, 0))        AS sum_adj_qty
    FROM book_stock_lines canon_inner
    JOIN book_stock_lines dup_inner
      ON dup_inner.cycle_id = canon_inner.cycle_id
     AND COALESCE(dup_inner.location, '') = COALESCE(canon_inner.location, '')
     AND UPPER(TRIM(dup_inner.sku_id)) = UPPER(TRIM(canon_inner.sku_id))
     AND dup_inner.id <> canon_inner.id
    WHERE canon_inner.sku_id = UPPER(TRIM(canon_inner.sku_id))
      AND dup_inner.sku_id   <> UPPER(TRIM(dup_inner.sku_id))
    GROUP BY canon_inner.id
) AS dup_totals
WHERE canon.id = dup_totals.canon_id;

-- 3.5c) ลบแถว lowercase ที่ถูก merge เข้า canonical ไปแล้ว
DELETE FROM book_stock_lines AS dup
USING book_stock_lines AS canon
WHERE dup.cycle_id = canon.cycle_id
  AND COALESCE(dup.location, '') = COALESCE(canon.location, '')
  AND UPPER(TRIM(dup.sku_id)) = UPPER(TRIM(canon.sku_id))
  AND dup.id <> canon.id
  AND canon.sku_id = UPPER(TRIM(canon.sku_id))
  AND dup.sku_id   <> UPPER(TRIM(dup.sku_id));

-- 3.5d) จัดการเคสที่ "ไม่มีแถว UPPER เลย" (มี lowercase หลายแถว) — merge รวมเป็นแถวเก่าสุด
WITH groups AS (
    SELECT
        cycle_id,
        UPPER(TRIM(sku_id))            AS norm_sku,
        COALESCE(location, '')         AS loc_norm,
        MIN(id::text)::uuid            AS keep_id,
        SUM(book_qty)                  AS total_qty,
        SUM(COALESCE(adjusted_book_qty, 0)) AS total_adj_qty,
        COUNT(*)                       AS row_count
    FROM book_stock_lines
    WHERE sku_id IS NOT NULL
      AND sku_id <> UPPER(TRIM(sku_id))
    GROUP BY cycle_id, UPPER(TRIM(sku_id)), COALESCE(location, '')
    HAVING COUNT(*) > 1
)
UPDATE book_stock_lines b
SET book_qty = g.total_qty,
    adjusted_book_qty = NULLIF(g.total_adj_qty, 0)
FROM groups g
WHERE b.id = g.keep_id;

-- 3.5e) ลบแถว lowercase ที่ไม่ใช่ keep_id ใน group (เหลือ 1 แถว/group)
WITH groups AS (
    SELECT
        cycle_id,
        UPPER(TRIM(sku_id))            AS norm_sku,
        COALESCE(location, '')         AS loc_norm,
        MIN(id::text)::uuid            AS keep_id
    FROM book_stock_lines
    WHERE sku_id IS NOT NULL
      AND sku_id <> UPPER(TRIM(sku_id))
    GROUP BY cycle_id, UPPER(TRIM(sku_id)), COALESCE(location, '')
    HAVING COUNT(*) > 1
)
DELETE FROM book_stock_lines b
USING groups g
WHERE b.cycle_id = g.cycle_id
  AND COALESCE(b.location, '') = g.loc_norm
  AND UPPER(TRIM(b.sku_id)) = g.norm_sku
  AND b.id <> g.keep_id
  AND b.sku_id <> UPPER(TRIM(b.sku_id));

-- 3.5f) ตรวจซ้ำก่อนไป STEP 4 — ทุก SELECT ต่อไปนี้ต้องคืน 0 แถว
SELECT
    cycle_id,
    UPPER(TRIM(sku_id))                 AS normalized_sku,
    COALESCE(location, '')              AS location_norm,
    COUNT(*)                            AS remaining_conflicts
FROM book_stock_lines
WHERE sku_id IS NOT NULL
GROUP BY cycle_id, UPPER(TRIM(sku_id)), COALESCE(location, '')
HAVING COUNT(*) > 1;


-- -----------------------------------------------------------------------------
-- STEP 4) Normalize SKU เป็น UPPERCASE + TRIM
--
-- ⚠ ห้ามรัน STEP นี้ ถ้า STEP 2 หรือ STEP 3.5f ยังพบ duplicate/conflict!
-- ⚠ ให้รัน docs/sql/009 หรือ STEP 3.5 เพื่อล้าง conflict ก่อน
-- -----------------------------------------------------------------------------

-- 4.1 inventory_counts.sku_id
UPDATE inventory_counts
SET sku_id = UPPER(TRIM(sku_id))
WHERE sku_id IS NOT NULL
  AND sku_id <> UPPER(TRIM(sku_id));

-- 4.2 sku_master.sku_name
UPDATE sku_master
SET sku_name = UPPER(TRIM(sku_name))
WHERE sku_name IS NOT NULL
  AND sku_name <> UPPER(TRIM(sku_name));

-- 4.3 book_stock_lines.sku_id
UPDATE book_stock_lines
SET sku_id = UPPER(TRIM(sku_id))
WHERE sku_id IS NOT NULL
  AND sku_id <> UPPER(TRIM(sku_id));


-- -----------------------------------------------------------------------------
-- STEP 5) ตรวจซ้ำหลัง normalize — ทุก SELECT ใน STEP 5 ควรคืน 0 แถว
-- -----------------------------------------------------------------------------

-- 5.1 ใน inventory_counts ยังมีค่าที่ไม่ใช่ UPPER+TRIM หรือไม่
SELECT COUNT(*) AS still_not_normalized
FROM inventory_counts
WHERE sku_id IS NOT NULL
  AND sku_id <> UPPER(TRIM(sku_id));

-- 5.2 ใน sku_master ยังมีค่าที่ไม่ใช่ UPPER+TRIM หรือไม่
SELECT COUNT(*) AS still_not_normalized
FROM sku_master
WHERE sku_name IS NOT NULL
  AND sku_name <> UPPER(TRIM(sku_name));

-- 5.3 ใน book_stock_lines ยังมีค่าที่ไม่ใช่ UPPER+TRIM หรือไม่
SELECT COUNT(*) AS still_not_normalized
FROM book_stock_lines
WHERE sku_id IS NOT NULL
  AND sku_id <> UPPER(TRIM(sku_id));


-- =============================================================================
-- (Optional) เพิ่ม CHECK constraint กันคนเขียน SKU ผิดรูปแบบในอนาคต
-- =============================================================================

-- ALTER TABLE inventory_counts
--     ADD CONSTRAINT chk_inventory_counts_sku_uppercase
--     CHECK (sku_id IS NULL OR sku_id = UPPER(TRIM(sku_id)));
--
-- ALTER TABLE sku_master
--     ADD CONSTRAINT chk_sku_master_sku_uppercase
--     CHECK (sku_name IS NULL OR sku_name = UPPER(TRIM(sku_name)));
--
-- ALTER TABLE book_stock_lines
--     ADD CONSTRAINT chk_book_stock_lines_sku_uppercase
--     CHECK (sku_id IS NULL OR sku_id = UPPER(TRIM(sku_id)));

-- =============================================================================
-- เสร็จสิ้น A1: SKU normalization
-- =============================================================================
