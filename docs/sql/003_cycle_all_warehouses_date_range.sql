-- =============================================================================
-- Migration 003: รอบ "คลังทั้งหมด" + หลายช่วงวันที่ต่อเดือน
-- รันหลัง 002_reconciliation_schema.sql
--
-- เปลี่ยน unique constraint จาก (warehouse, year_month) เดียว
-- เป็น partial indexes รองรับ:
--   - รอบเต็มเดือน (ไม่มี count_start_at)
--   - รอบช่วงวันที่ (มี count_start_at + count_end_at) หลายรอบ/เดือนได้
--
-- warehouse = 'คลังทั้งหมด' = รอบรวมทุกคลัง Match ต่อ SKU ไฟล์ Book เดียว
-- =============================================================================

-- ลบ unique constraint เดิม (ชื่อ default ของ PostgreSQL)
ALTER TABLE count_cycles
    DROP CONSTRAINT IF EXISTS count_cycles_warehouse_year_month_key;

-- รอบแบบเต็มเดือน (ไม่กำหนดช่วงวันที่) — 1 รอบต่อคลังต่อเดือน
CREATE UNIQUE INDEX IF NOT EXISTS uq_count_cycles_full_month
    ON count_cycles (warehouse, year_month)
    WHERE count_start_at IS NULL;

-- รอบแบบช่วงวันที่ — หลายรอบต่อเดือนได้ (ช่วงวันที่ต้องไม่ซ้ำ)
CREATE UNIQUE INDEX IF NOT EXISTS uq_count_cycles_date_range
    ON count_cycles (warehouse, year_month, count_start_at, count_end_at)
    WHERE count_start_at IS NOT NULL;

COMMENT ON TABLE count_cycles IS
    'รอบนับ — แยกคลังหรือคลังทั้งหมด · รองรับช่วงวันที่ในเดือน · ไม่ลบรอบเก่า';

COMMENT ON COLUMN count_cycles.warehouse IS
    'ชื่อคลัง หรือ ''คลังทั้งหมด'' สำหรับ Match รวมทุกคลังต่อ SKU';

COMMENT ON COLUMN count_cycles.count_start_at IS
    'วันเริ่มช่วงนับ (เวลาไทย +07) — ถ้ามี ใช้แทนทั้งเดือนตอนผูกผลนับ';

COMMENT ON COLUMN count_cycles.count_end_at IS
    'วันสิ้นสุดช่วงนับ (inclusive, end-of-day +07) — เก็บเป็น TIMESTAMPTZ';
