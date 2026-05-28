-- =============================================================================
-- 013 — Audit warnings A10, A11, A16
-- รันใน Supabase SQL Editor หลัง 002, 009, 010, 011, 012
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A10) refresh_reconciliation — รวม SKU ด้วย UPPER(TRIM) ให้ตรงมาตรฐานแอป
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
        SELECT upper(trim(sku_id)) AS sku_id, SUM(book_qty) AS book_qty
        FROM book_stock_lines
        WHERE cycle_id = p_cycle_id
          AND trim(coalesce(sku_id, '')) <> ''
        GROUP BY upper(trim(sku_id))
    ),
    adj AS (
        SELECT upper(trim(sku_id)) AS sku_id, SUM(adjustment_qty) AS adjustment_applied
        FROM stock_adjustments
        WHERE cycle_id = p_cycle_id
          AND status = 'applied'
          AND trim(coalesce(sku_id, '')) <> ''
        GROUP BY upper(trim(sku_id))
    ),
    counted AS (
        SELECT upper(trim(sku_id)) AS sku_id,
               SUM(counted_qty) AS counted_qty,
               COUNT(*)::int AS count_row_count
        FROM inventory_counts
        WHERE cycle_id = p_cycle_id
          AND trim(coalesce(sku_id, '')) <> ''
        GROUP BY upper(trim(sku_id))
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
    WHERE b.cycle_id = p_cycle_id
      AND upper(trim(b.sku_id)) = sub.sku_id;

    RETURN v_inserted;
END;
$$;

-- -----------------------------------------------------------------------------
-- A11) Apply draft ทั้งรอบครั้งเดียว + refresh reconciliation ครั้งเดียว
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_all_drafts_for_cycle(
    p_cycle_id UUID,
    p_applied_by TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INT;
BEGIN
    IF p_cycle_id IS NULL THEN
        RAISE EXCEPTION 'cycle_id is required';
    END IF;

    UPDATE stock_adjustments
    SET
        status = 'applied',
        applied_at = now(),
        updated_at = now(),
        created_by = COALESCE(created_by, p_applied_by)
    WHERE cycle_id = p_cycle_id
      AND status = 'draft';

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        PERFORM refresh_reconciliation_for_cycle(p_cycle_id);
    END IF;

    RETURN v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- A16) เดือนที่มีผลนับ — ไม่ต้องดึง created_at ทุกแถวมาที่ browser
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_inventory_count_months(p_warehouse TEXT DEFAULT NULL)
RETURNS TABLE(year_month TEXT)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS year_month
    FROM inventory_counts
    WHERE created_at IS NOT NULL
      AND (
          p_warehouse IS NULL
          OR trim(p_warehouse) = ''
          OR warehouse = p_warehouse
      )
    ORDER BY 1 DESC;
$$;

-- ตรวจหลังรัน:
-- SELECT * FROM get_inventory_count_months('ตึกกันตนา') LIMIT 5;
-- SELECT apply_all_drafts_for_cycle('<cycle_uuid>'::uuid);
