-- =============================================================================
-- 017 — ลบตารางสำรองจาก migration 010 (SKU normalization)
-- ✅ รันแล้ว 2026-08-09 (migration name: 017_drop_skunorm_backup_tables)
-- =============================================================================
-- ตาราง _bk_*_pre_skunorm ถูกสร้างโดย docs/sql/010_sku_normalize_backfill.sql
-- เพื่อสำรองข้อมูลก่อนแปลง SKU เป็น UPPERCASE — migration เสร็จนานแล้ว
-- และไม่มีโค้ดในระบบอ้างถึงเลย (ยืนยันด้วย grep ทั้งโปรเจกต์)
--
-- การตรวจสอบก่อนลบ (เทียบทีละแถวด้วย id กับตารางจริง):
--   _bk_inventory_counts_pre_skunorm   2,411 แถว → ซ้ำกับตารางจริง 100%
--   _bk_sku_master_pre_skunorm         1,179 แถว → ซ้ำกับตารางจริง 100%
--   _bk_book_stock_lines_pre_skunorm   1,635 แถว → ซ้ำ 1,632 · ไม่มีในตารางจริง 3 แถว
--   รวม 5,222 จาก 5,225 แถวเป็นข้อมูลซ้ำ
--
-- 3 แถวที่ไม่ซ้ำ สำรองไว้ที่ docs/backup/2026-08-09_bk_tables_unique_rows.md
-- (พร้อม CSV และ SQL กู้คืน)
--
-- คืนพื้นที่ได้ ~1 MB
-- =============================================================================

drop table if exists public._bk_inventory_counts_pre_skunorm;
drop table if exists public._bk_sku_master_pre_skunorm;
drop table if exists public._bk_book_stock_lines_pre_skunorm;

-- ตรวจผล:
--   select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind='r' and c.relname like '\_bk\_%';  -- ต้องได้ 0
