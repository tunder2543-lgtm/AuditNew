-- ขยาย reason ของ stock_adjustments (ถ้าเคยใช้ accept_count ในแอปเวอร์ชันเก่า)
-- รันครั้งเดียวใน Supabase SQL Editor

ALTER TABLE stock_adjustments
    DROP CONSTRAINT IF EXISTS stock_adjustments_reason_check;

ALTER TABLE stock_adjustments
    ADD CONSTRAINT stock_adjustments_reason_check
    CHECK (reason IN ('reconcile', 'manual', 'damage', 'found', 'other', 'accept_count'));
