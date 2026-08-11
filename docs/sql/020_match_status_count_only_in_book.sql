-- =============================================================================
-- 020 — M2: สถานะ match ของ DB ให้ตรงกับหน้าเว็บ (count_only ต้องแปลว่า "ไม่มีใน Book")
-- รันใน Supabase SQL Editor หลัง 013 และ 018
-- =============================================================================
-- อาการ:
--   SKU ที่อยู่ใน Book ด้วยยอด 0 แล้วนับเจอ → DB บอก 'count_only' แต่หน้าเว็บบอก 'over'
--
-- เกิดขึ้นจริงเมื่อไหร่:
--   ผู้ใช้กดปุ่ม "สร้างลง Book (ยอด 0)" ในหน้า reconcile สำหรับ SKU ที่นับเจอแต่ไม่มีใน
--   ไฟล์ Excel — หลังกดแล้ว SKU นั้น **มีใน Book แล้ว** (ยอด 0) สถานะจึงต้องเป็น "เกิน"
--   ไม่ใช่ "นับเจอ แต่ไม่พบ SKU ใน Excel" อีกต่อไป
--
-- สาเหตุราก:
--   เงื่อนไขเดิม `effective_book_qty = 0 AND counted_qty > 0 THEN 'count_only'`
--   แยกไม่ออกระหว่าง "ไม่มีใน Book เลย" กับ "มีใน Book แต่ยอดเป็น 0"
--   ฝั่ง JS (`Js/reconcile-shared.js` computeMatchStatus) แยกออกเพราะรับ `inBookSkuSet`
--   → เลือก semantic ของ JS เป็นตัวตั้ง แล้วแก้ SQL ตาม (ตรงกับที่ admin ใช้งานจริง)
--
-- ผลกระทบกับข้อมูลที่มีอยู่ (นับจาก DB จริงก่อนรัน 2026-08-11):
--   count_only ทั้งหมด 81 แถว — 77 แถวมีใน Book จริง จะเปลี่ยนเป็น 'over'
--                                 4 แถวไม่มีใน Book คงเป็น 'count_only' เหมือนเดิม
--   สถานะอื่น (match/short/over/book_only) ไม่มีแถวไหนเปลี่ยน
--   ⚠️ แถวเดิมใน reconciliation_lines จะยังเป็นค่าเก่าจนกว่าจะกด "คำนวณ Match" ของรอบนั้น
--      (ตารางนี้เป็น cache ที่ RPC เขียนทับทั้งรอบ) — ดูคำสั่ง refresh ท้ายไฟล์
--
-- ผลกระทบต่อ dashboard (สำคัญ — ตัวเลขจะกระโดดโดยไม่มีใครแก้ข้อมูล):
--   `v_cycle_match_summary` (002:131) นับ `SUM(ABS(variance_qty))` เฉพาะสถานะ short/over
--   แถวที่ย้ายจาก count_only → over จึงถูกนับเพิ่มเข้าการ์ด "ความต่าง (ชิ้น)"
--   วัดจากของจริงหลังรัน: ตึกกันตนา 2026-08 เพิ่ม 411 ชิ้น (เป็น 7,943) · 2026-06 เพิ่ม 14 (เป็น 1,228)
--   และ Top 15 "เกิน" ในหน้า dashboard เรียงด้วย variance_qty จากมากไปน้อย — SKU ที่ Book = 0
--   มี variance เท่ากับยอดนับทั้งก้อน จึงมีสิทธิ์ขึ้นหัวตารางเบียด SKU ที่เกินจริงตกไป
--   ⇒ ไม่ใช่ข้อมูลใหม่ แค่ย้ายมาจากช่องที่จัดประเภทผิด แต่ต้องรู้ไว้ก่อนเทียบตัวเลขข้ามวัน
--
-- ข้อตกลงเรื่องรอบที่ปิดแล้ว:
--   คำสั่ง refresh ท้ายไฟล์ข้ามรอบ closed/archived โดยตั้งใจ (ตรงกับ CLOSED_CYCLE_STATUSES
--   ใน Js/reconcile-shared.js — M24 ห้ามให้ยอดที่สรุปแล้วขยับย้อนหลัง)
--   ⇒ **รอบที่ปิดแล้วจะเก็บ semantic เก่าไว้ถาวร** และไม่ตรงกับหน้า reconcile ที่คำนวณฝั่ง JS
--   นี่คือความตั้งใจ ไม่ใช่บั๊ก — ถ้าเจออาการนี้ในรอบเก่า อย่าเปิด M2 ใหม่
--   (ตอนรันจริง 2026-08-11 ยังไม่มีรอบไหนปิด จึง refresh ครบทั้ง 6 รอบ)
--
-- ⛔ ต้องคง SECURITY DEFINER + search_path ไว้ (invariant ข้อ 12)
--    018 ใช้ ALTER จึงไม่ได้เขียน attribute ลงใน body — แต่ CREATE OR REPLACE
--    เขียนทับ attribute ทั้งหมด ถ้าไม่ประกาศซ้ำจะกลับไปเป็น SECURITY INVOKER
--    แล้วโดน RLS ⇒ "คำนวณ Match" 401 เหมือนบั๊กที่ 018 แก้ไป
--
-- วิธีถอย: รัน 013 ส่วน A10 ซ้ำ แล้วตามด้วย 018
-- =============================================================================

CREATE OR REPLACE FUNCTION refresh_reconciliation_for_cycle(p_cycle_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
            -- M2: ต้องรู้ว่า SKU นี้ "มีบรรทัดใน Book" หรือไม่ ซึ่งไม่เท่ากับ "ยอด Book > 0"
            (b.sku_id IS NOT NULL) AS in_book,
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
            -- ⬇️ จุดเดียวที่ต่างจาก 013 — สะท้อน computeMatchStatus() ฝั่ง JS ตรงตัว
            WHEN m.effective_book_qty = 0 AND m.counted_qty > 0
                THEN CASE WHEN m.in_book THEN 'over' ELSE 'count_only' END
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

-- =============================================================================
-- ตรวจหลังรัน (ต้องได้ prosecdef = true เสมอ ไม่งั้น "คำนวณ Match" จะ 401):
--   select proname, prosecdef, proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname = 'refresh_reconciliation_for_cycle';
--
-- คำนวณสถานะใหม่ทุกรอบที่ยังไม่ปิด (หรือกดปุ่ม "คำนวณ Match" ในหน้า reconcile ทีละรอบ):
--   select c.id, refresh_reconciliation_for_cycle(c.id)
--   from count_cycles c
--   where coalesce(c.status, '') not in ('closed', 'archived');
-- =============================================================================
