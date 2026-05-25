-- =============================================================================
-- Stock Audit — Reconciliation / Match ยอดก่อนนับ vs ผลนับ
-- รันใน Supabase SQL Editor (ปรับตามนโยบาย RLS ของโปรเจกต์)
--
-- กฎสำคัญ: inventory_counts = หลักฐานผลนับ (READ-ONLY ในระบบ Match)
--   - ห้าม UPDATE counted_qty / location / sku_id จากหน้า Reconcile
--   - ปรับยอดทำที่ stock_adjustments (+ optional book_stock_lines) เท่านั้น
--   - อนุญาต UPDATE cycle_id บน inventory_counts เพื่อผูกรอบ (metadata)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) รอบการนับ (แยกคลัง + ปีเดือน — ไม่ลบรอบเก่า)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS count_cycles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse       TEXT NOT NULL,
    year_month      TEXT NOT NULL,              -- '2026-05'
    label           TEXT,                       -- 'นับพฤษภาคม 2569'
    status          TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('draft', 'open', 'counting', 'reconciling', 'closed', 'archived')),
    count_start_at  TIMESTAMPTZ,                -- ช่วงวันที่นับ (optional)
    count_end_at    TIMESTAMPTZ,
    book_source     TEXT,                       -- ชื่อไฟล์ต้นฉบับ
    book_imported_at TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (warehouse, year_month)
);

CREATE INDEX IF NOT EXISTS idx_count_cycles_wh_ym ON count_cycles (warehouse, year_month);

COMMENT ON TABLE count_cycles IS 'รอบนับ 1 ชุดต่อคลังต่อเดือน — ใช้แยกพ.ค./มิ.ย. ไม่ลบข้อมูลเก่า';

-- -----------------------------------------------------------------------------
-- 2) ยอดก่อนนับ (Book) — จาก Excel แปลงเป็นแถว
--    คอลัมน์ Excel แนะนำ: A=SKU, B=qty (หรือ C=location ถ้า match ระดับ location)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS book_stock_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id        UUID NOT NULL REFERENCES count_cycles(id) ON DELETE CASCADE,
    sku_id          TEXT NOT NULL,              -- รหัสสินค้า (เทียบ inventory_counts.sku_id)
    location        TEXT,                       -- NULL = รวมระดับ SKU
    book_qty        NUMERIC(18, 4) NOT NULL DEFAULT 0,
    adjusted_book_qty NUMERIC(18, 4),             -- ยอด Book หลัง Apply (cache ต่อ SKU)
    name_pro        TEXT,
    row_no          INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_book_stock_cycle_sku_loc
    ON book_stock_lines (cycle_id, sku_id, COALESCE(location, ''));

CREATE INDEX IF NOT EXISTS idx_book_stock_cycle_sku ON book_stock_lines (cycle_id, sku_id);

-- -----------------------------------------------------------------------------
-- 3) ผูกผลนับกับรอบ (migration จาก inventory_counts เดิม)
-- -----------------------------------------------------------------------------
ALTER TABLE inventory_counts
    ADD COLUMN IF NOT EXISTS cycle_id UUID REFERENCES count_cycles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_counts_cycle ON inventory_counts (cycle_id);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_wh_created ON inventory_counts (warehouse, created_at DESC);

COMMENT ON COLUMN inventory_counts.cycle_id IS
    'ผูกรอบนับ — อนุญาต UPDATE คอลัมน์นี้เท่านั้น ห้ามแก้ counted_qty จาก Reconcile';

-- -----------------------------------------------------------------------------
-- 4) ผล Match ต่อ SKU (cache — คำนวณใหม่ได้จาก reconcile page)
--    counted_qty มาจาก inventory_counts (อ่านอย่างเดียว)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reconciliation_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id        UUID NOT NULL REFERENCES count_cycles(id) ON DELETE CASCADE,
    sku_id          TEXT NOT NULL,
    book_qty        NUMERIC(18, 4) NOT NULL DEFAULT 0,
    adjustment_applied NUMERIC(18, 4) NOT NULL DEFAULT 0,
    effective_book_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
    counted_qty     NUMERIC(18, 4) NOT NULL DEFAULT 0,
    variance_qty    NUMERIC(18, 4) NOT NULL DEFAULT 0,  -- counted - effective_book
    match_status    TEXT NOT NULL
        CHECK (match_status IN ('match', 'short', 'over', 'count_only', 'book_only')),
    variance_pct    NUMERIC(9, 4),              -- |variance|/book*100 เมื่อ book>0
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cycle_id, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_recon_cycle_status ON reconciliation_lines (cycle_id, match_status);

-- -----------------------------------------------------------------------------
-- 5) รายการปรับยอด — ฝั่ง Book/ERP เท่านั้น (ไม่แตะ inventory_counts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id        UUID NOT NULL REFERENCES count_cycles(id) ON DELETE CASCADE,
    sku_id          TEXT NOT NULL,
    adjustment_qty  NUMERIC(18, 4) NOT NULL,    -- บวกลด effective_book (ไม่ใช่ counted_qty)
    variance_before NUMERIC(18, 4),           -- snapshot ก่อนปรับ
    reason          TEXT NOT NULL DEFAULT 'reconcile'
        CHECK (reason IN ('reconcile', 'manual', 'damage', 'found', 'other')),
    status          TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'exported', 'applied', 'cancelled')),
    note            TEXT,
    created_by      TEXT,
    exported_at     TIMESTAMPTZ,
    applied_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adj_cycle_status ON stock_adjustments (cycle_id, status);

COMMENT ON TABLE stock_adjustments IS
    'ปรับยอดฝั่ง Book/ERP — Apply ห้าม UPDATE inventory_counts.counted_qty';

-- -----------------------------------------------------------------------------
-- 6) View สรุปรอบ (ใช้ใน Dashboard / Reconcile KPI)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cycle_reconciliation_summary AS
SELECT
    c.id AS cycle_id,
    c.warehouse,
    c.year_month,
    c.status AS cycle_status,
    COUNT(r.*) FILTER (WHERE r.match_status = 'match')     AS sku_match,
    COUNT(r.*) FILTER (WHERE r.match_status = 'short')     AS sku_short,
    COUNT(r.*) FILTER (WHERE r.match_status = 'over')      AS sku_over,
    COUNT(r.*) FILTER (WHERE r.match_status = 'count_only') AS sku_count_only,
    COUNT(r.*) FILTER (WHERE r.match_status = 'book_only')  AS sku_book_only,
    COUNT(r.*)                                               AS sku_total,
    COALESCE(SUM(ABS(r.variance_qty)) FILTER (WHERE r.match_status IN ('short','over')), 0) AS total_variance_pcs,
    CASE
        WHEN COUNT(r.*) FILTER (WHERE r.book_qty > 0) = 0 THEN NULL
        ELSE ROUND(
            100.0 * COUNT(r.*) FILTER (WHERE r.match_status = 'match')
            / NULLIF(COUNT(r.*) FILTER (WHERE r.book_qty > 0 OR r.counted_qty > 0), 0),
            2
        )
    END AS match_pct
FROM count_cycles c
LEFT JOIN reconciliation_lines r ON r.cycle_id = c.id
GROUP BY c.id, c.warehouse, c.year_month, c.status;

-- -----------------------------------------------------------------------------
-- 7) รีเฟรช reconciliation — อ่าน inventory_counts อย่างเดียว + รวม adjustment applied
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_reconciliation_for_cycle(p_cycle_id UUID)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_inserted INT;
BEGIN
    DELETE FROM reconciliation_lines WHERE cycle_id = p_cycle_id;

    INSERT INTO reconciliation_lines (
        cycle_id, sku_id, book_qty, adjustment_applied, effective_book_qty,
        counted_qty, variance_qty, match_status, variance_pct
    )
    WITH book AS (
        SELECT sku_id, SUM(book_qty) AS book_qty
        FROM book_stock_lines
        WHERE cycle_id = p_cycle_id
        GROUP BY sku_id
    ),
    adj AS (
        SELECT sku_id, SUM(adjustment_qty) AS adjustment_applied
        FROM stock_adjustments
        WHERE cycle_id = p_cycle_id AND status = 'applied'
        GROUP BY sku_id
    ),
    counted AS (
        SELECT sku_id,
               SUM(counted_qty) AS counted_qty,
               COUNT(*)::int AS count_row_count
        FROM inventory_counts
        WHERE cycle_id = p_cycle_id
        GROUP BY sku_id
    ),
    union_sku AS (
        SELECT sku_id FROM book
        UNION
        SELECT sku_id FROM counted
        UNION
        SELECT sku_id FROM adj
    ),
    merged AS (
        SELECT
            u.sku_id,
            COALESCE(b.book_qty, 0) AS book_qty,
            COALESCE(a.adjustment_applied, 0) AS adjustment_applied,
            COALESCE(b.book_qty, 0) + COALESCE(a.adjustment_applied, 0) AS effective_book_qty,
            COALESCE(c.counted_qty, 0) AS counted_qty,
            COALESCE(c.count_row_count, 0) AS count_row_count,
            COALESCE(c.counted_qty, 0)
                - (COALESCE(b.book_qty, 0) + COALESCE(a.adjustment_applied, 0)) AS variance_qty
        FROM union_sku u
        LEFT JOIN book b ON b.sku_id = u.sku_id
        LEFT JOIN adj a ON a.sku_id = u.sku_id
        LEFT JOIN counted c ON c.sku_id = u.sku_id
    )
    SELECT
        p_cycle_id,
        m.sku_id,
        m.book_qty,
        m.adjustment_applied,
        m.effective_book_qty,
        m.counted_qty,
        m.variance_qty,
        CASE
            WHEN m.effective_book_qty = 0 AND m.counted_qty > 0 THEN 'count_only'
            WHEN m.effective_book_qty > 0 AND m.counted_qty = 0 AND m.count_row_count = 0 THEN 'book_only'
            WHEN m.variance_qty = 0 THEN 'match'
            WHEN m.variance_qty < 0 THEN 'short'
            ELSE 'over'
        END,
        CASE
            WHEN m.effective_book_qty > 0 THEN ROUND(100.0 * ABS(m.variance_qty) / m.effective_book_qty, 4)
            WHEN m.book_qty > 0 THEN ROUND(100.0 * ABS(m.variance_qty) / m.book_qty, 4)
            ELSE NULL
        END
    FROM merged m;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    UPDATE book_stock_lines b
    SET adjusted_book_qty = sub.effective_book_qty
    FROM (
        SELECT sku_id, effective_book_qty
        FROM reconciliation_lines
        WHERE cycle_id = p_cycle_id
    ) sub
    WHERE b.cycle_id = p_cycle_id AND b.sku_id = sub.sku_id;

    RETURN v_inserted;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7b) Apply adjustment — อัปเดต stock_adjustments เท่านั้น (ห้ามแตะ inventory_counts)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_stock_adjustment(p_adjustment_id UUID, p_applied_by TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE stock_adjustments
    SET
        status = 'applied',
        applied_at = now(),
        updated_at = now(),
        created_by = COALESCE(created_by, p_applied_by)
    WHERE id = p_adjustment_id
      AND status IN ('draft', 'exported');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'adjustment not found or not in draft/exported state';
    END IF;

    PERFORM refresh_reconciliation_for_cycle(
        (SELECT cycle_id FROM stock_adjustments WHERE id = p_adjustment_id)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8) ตัวอย่าง: สร้างรอบ + ผูกแถวนับเดิม (รันทีละคลัง)
-- -----------------------------------------------------------------------------
-- INSERT INTO count_cycles (warehouse, year_month, label, status)
-- VALUES ('ตึกกันตนา', '2026-05', 'นับพฤษภาคม 2569', 'reconciling')
-- RETURNING id;

-- UPDATE inventory_counts ic
-- SET cycle_id = '<cycle_uuid>'
-- WHERE ic.warehouse = 'ตึกกันตนา'
--   AND ic.created_at >= '2026-05-01'::timestamptz
--   AND ic.created_at <  '2026-06-01'::timestamptz;

-- SELECT refresh_reconciliation_for_cycle('<cycle_uuid>'::uuid);
