-- 022: ให้ realtime ส่งข้อมูลแถวเดิมมาด้วยตอน UPDATE/DELETE (2026-08-16)
--
-- ปัญหา: REPLICA IDENTITY ของ Postgres เป็น "default" = ส่งเฉพาะคอลัมน์ที่เป็น PK
--        ⇒ event DELETE/UPDATE ส่ง old มาแค่ { id } · popup แจ้งเตือนผลนับข้ามหน้า
--        (Js/count-notify-shared.js) จึงไม่มีอะไรจะแสดง และลูกศร "70 → 200" ตอนแก้ไข
--        ไม่มีวันทำงาน · จอนับสดเลี่ยงปัญหานี้ด้วยการดึงจาก cache ในหน้า แต่หน้าอื่นไม่มี cache
--
-- ผลข้างเคียงที่ยอมรับ: WAL ต่อ 1 UPDATE/DELETE ใหญ่ขึ้น (เก็บค่าเดิมทั้งแถว)
--   ตารางนี้แถวเล็ก (10 คอลัมน์ ไม่มี text ยาว) และการแก้/ลบเกิดไม่บ่อย — INSERT ไม่กระทบเลย
--   ⛔ ห้ามใช้ FULL กับตารางที่แถวใหญ่/เขียนถี่ (เช่น book_stock_lines ตอน import)
--
-- ตรวจผล:
--   select relreplident from pg_class where relname = 'inventory_counts';  -- ต้องได้ 'f'

alter table public.inventory_counts replica identity full;
