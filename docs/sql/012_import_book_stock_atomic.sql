-- =============================================================================
-- A5: นำเข้า Book แบบ atomic (DELETE + INSERT ในทรานแซกเดียว)
--
-- ปัญหาเดิม: importBookStockLines แบบ replace ลบ book_stock_lines ก่อน แล้วค่อย insert
--            ถ้า insert ล้ม → Book ของรอบนั้นหายหมด
--
-- วิธีแก้: ใช้ฟังก์ชันนี้แทน — ล้มเหลวทั้งชุดจะ rollback อัตโนมัติ
--
-- รันใน Supabase SQL Editor (รันซ้ำได้ — CREATE OR REPLACE)
-- =============================================================================

CREATE OR REPLACE FUNCTION import_book_stock_lines_atomic(
    p_cycle_id   UUID,
    p_rows       JSONB,
    p_mode       TEXT DEFAULT 'replace',
    p_book_source TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_mode     TEXT;
    v_inserted INT;
BEGIN
    IF p_cycle_id IS NULL THEN
        RAISE EXCEPTION 'cycle_id is required';
    END IF;

    v_mode := lower(trim(coalesce(p_mode, 'replace')));
    IF v_mode NOT IN ('replace', 'merge') THEN
        RAISE EXCEPTION 'p_mode must be replace or merge, got: %', p_mode;
    END IF;

    IF v_mode = 'replace' THEN
        DELETE FROM book_stock_lines WHERE cycle_id = p_cycle_id;
    ELSE
        DELETE FROM book_stock_lines b
        WHERE b.cycle_id = p_cycle_id
          AND b.sku_id IN (
              SELECT UPPER(TRIM(elem->>'sku_id'))
              FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS elem
              WHERE NULLIF(TRIM(elem->>'sku_id'), '') IS NOT NULL
          );
    END IF;

    INSERT INTO book_stock_lines (cycle_id, sku_id, location, book_qty, name_pro, row_no)
    SELECT
        p_cycle_id,
        UPPER(TRIM(elem->>'sku_id')),
        NULLIF(TRIM(COALESCE(elem->>'location', '')), ''),
        COALESCE((elem->>'book_qty')::NUMERIC, 0),
        NULLIF(TRIM(COALESCE(elem->>'name_pro', '')), ''),
        CASE
            WHEN elem->>'row_no' IS NULL OR trim(elem->>'row_no') = '' THEN NULL
            ELSE (elem->>'row_no')::INT
        END
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS elem
    WHERE NULLIF(TRIM(elem->>'sku_id'), '') IS NOT NULL;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    UPDATE count_cycles
    SET
        book_source = COALESCE(p_book_source, book_source),
        book_imported_at = now(),
        updated_at = now()
    WHERE id = p_cycle_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'count_cycles not found: %', p_cycle_id;
    END IF;

    RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION import_book_stock_lines_atomic(UUID, JSONB, TEXT, TEXT) IS
    'นำเข้า book_stock_lines แบบ atomic — replace=ลบทั้งรอบก่อน insert, merge=ลบเฉพาะ SKU ในไฟล์';

-- ตรวจว่าฟังก์ชันพร้อมใช้งาน
-- SELECT import_book_stock_lines_atomic(
--     '<cycle_uuid>'::uuid,
--     '[{"sku_id":"TEST001","book_qty":1,"name_pro":"ทดสอบ","row_no":1}]'::jsonb,
--     'replace',
--     'test.xlsx'
-- );
