-- 015: ผูกแถว inventory_counts กับครั้งนำเข้า (import batch) สำหรับ Export รายละเอียดต่อ log
-- รันหลัง 011_drop_strict_inventory_counts_index.sql

ALTER TABLE inventory_counts
    ADD COLUMN IF NOT EXISTS import_batch_id UUID;

COMMENT ON COLUMN inventory_counts.import_batch_id IS
    'UUID ต่อครั้งกดนำเข้า — ใช้ดึงรายการยอดนับของครั้งนั้น (Export ประวัติ import)';

CREATE INDEX IF NOT EXISTS idx_inventory_counts_import_batch
    ON inventory_counts (import_batch_id)
    WHERE import_batch_id IS NOT NULL;
