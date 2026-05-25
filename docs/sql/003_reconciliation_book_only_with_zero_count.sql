-- ยังไม่ได้นับ (book_only) เฉพาะ SKU ที่ไม่มีแถวใน inventory_counts ของรอบนั้น
-- ถ้ามีแถวแต่ SUM(counted_qty)=0 ถือว่านับแล้ว → short (ขาด)
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
