-- =============================================================================
-- 016 — RLS Policies สำหรับ anon/publishable key
-- ✅ รันแล้ว 2026-08-09 (migration name: 016_rls_policies_for_anon_client)
--    ยืนยันผลด้วย publishable key จริง: ทุกตารางอ่านได้ครบ + UPDATE/DELETE ผ่าน
-- =============================================================================
-- บริบท: docs/ISSUES.md ข้อ C1 — เปลี่ยน client จาก service_role key เป็น
-- publishable key แล้ว แต่ service_role เดิม "ข้าม RLS ทั้งหมด" ส่วน anon ไม่ข้าม
-- ผลคือตารางที่เปิด RLS ไว้แต่ไม่มี policy จะคืนค่าว่างเปล่าเงียบ ๆ (ไม่ error)
--
-- สถานะจริงที่ตรวจพบ 2026-08-09 (จาก pg_policies + ทดสอบด้วย publishable key จริง):
--   ตาราง                              RLS   policy เดิม              anon อ่านได้?
--   inventory_counts        5,971 แถว   on    SELECT, INSERT           ✅ อ่าน/เพิ่ม (แก้/ลบ ไม่ได้)
--   sku_master              1,179 แถว   on    SELECT (anon)            ✅ อ่านอย่างเดียว
--   inventory_audit_logs      717 แถว   on    SELECT, INSERT (public)  ✅
--   warehouses                  4 แถว   on    ไม่มี                    ❌ ว่างเปล่า
--   count_cycles                6 แถว   on    ไม่มี                    ❌ ว่างเปล่า
--   book_stock_lines        5,326 แถว   on    ไม่มี                    ❌ ว่างเปล่า
--   reconciliation_lines    5,628 แถว   on    ไม่มี                    ❌ ว่างเปล่า
--   stock_adjustments           0 แถว   on    ไม่มี                    ❌
--   reconciliation_match_acceptances    on    ไม่มี                    ❌
--   chat_messages              19 แถว   on    ไม่มี                    ❌ ว่างเปล่า
--
-- สคริปต์นี้ให้สิทธิ์ anon เท่าที่แต่ละหน้าต้องใช้จริง (ตาม docs/pages/*.md)
-- ระดับความปลอดภัย: เทียบเท่าพฤติกรรมเดิมสมัย service_role ในแง่ "ใครเปิดเว็บก็แก้ได้"
-- แต่ดีกว่าตรงที่ key ไม่มีสิทธิ์ admin (แตะ auth schema / เปลี่ยน schema / ข้าม policy
-- ในอนาคตไม่ได้) และรัดสิทธิ์เพิ่มทีหลังได้โดยไม่ต้องแก้โค้ดหน้าเว็บ
--
-- ⚠️ ข้อจำกัดที่ยังเหลือ: ระบบนี้ไม่มีการล็อกอิน ทุกคนที่เข้าถึงหน้าเว็บได้
-- = anon เหมือนกันหมด จึงยังแยกสิทธิ์รายบุคคลไม่ได้ ถ้าต้องการขั้นนั้นต้องทำ
-- Supabase Auth เพิ่ม (คนละงาน)
--
-- วิธีถอย: DROP POLICY ตามชื่อ (ไม่กระทบข้อมูลหรือโครงสร้างตาราง)
--
-- ผลหลังรัน (ตรวจจากเบราว์เซอร์ด้วย publishable key จริง 2026-08-09):
--   warehouses 4 · count_cycles 6 · book_stock_lines 5,326 · reconciliation_lines 5,628
--   stock_adjustments 1,202 · match_acceptances 733 · chat_messages 19
--   sku_master 1,179 · inventory_counts 5,971 · inventory_audit_logs 717
--   UPDATE/DELETE บน inventory_counts + sku_master: อนุญาต (ทดสอบด้วย id ที่ไม่มีจริง)
-- =============================================================================

-- ---------- อ่านอย่างเดียว: ข้อมูลอ้างอิงที่หน้าเว็บต้องเห็น ----------

-- warehouses — registry คลัง ใช้เติม dropdown ทุกหน้า
create policy "anon_select_warehouses" on public.warehouses
    for select to anon, authenticated using (true);
-- settings.html จัดการคลัง (เพิ่ม/เปิด-ปิด/ลบ)
create policy "anon_write_warehouses" on public.warehouses
    for all to anon, authenticated using (true) with check (true);

-- count_cycles — รอบนับ (cycle_config สร้าง/แก้/ลบ)
create policy "anon_all_count_cycles" on public.count_cycles
    for all to anon, authenticated using (true) with check (true);

-- book_stock_lines — ยอด BOOK (cycle_config อัปโหลด, reconcile เพิ่ม/ลบ)
create policy "anon_all_book_stock_lines" on public.book_stock_lines
    for all to anon, authenticated using (true) with check (true);

-- reconciliation_lines — cache ผล match (สร้างโดย RPC เป็นหลัก)
create policy "anon_select_reconciliation_lines" on public.reconciliation_lines
    for select to anon, authenticated using (true);

-- stock_adjustments — รายการปรับยอดฝั่ง Book
create policy "anon_all_stock_adjustments" on public.stock_adjustments
    for all to anon, authenticated using (true) with check (true);

-- reconciliation_match_acceptances — ธง "ยืนยันถูกต้อง"
create policy "anon_all_match_acceptances" on public.reconciliation_match_acceptances
    for all to anon, authenticated using (true) with check (true);

-- chat_messages — แชททีม
create policy "anon_all_chat_messages" on public.chat_messages
    for all to anon, authenticated using (true) with check (true);

-- ---------- เติมสิทธิ์ที่ขาดของตารางที่มี policy อยู่แล้ว ----------

-- sku_master: เดิม anon ได้แค่ SELECT → import/แก้ชื่อ/ลบ ในหน้า sku_master ใช้ไม่ได้
create policy "anon_write_sku_master" on public.sku_master
    for all to anon, authenticated using (true) with check (true);

-- inventory_counts: เดิมมีแค่ SELECT + INSERT
--   ⚠️ UPDATE/DELETE จำเป็นสำหรับ: index.html แก้ไข/ลบรายการ (มี audit log),
--   audit_check ทุกโหมด (แก้ location / สลับ SKU-Loc / dedupe / ลบ),
--   cycle_config ผูกผลนับเข้ารอบ (UPDATE cycle_id)
--   หลักการ immutable evidence เป็นกติกาเชิงแอป ไม่ได้บังคับที่ระดับ DB มาแต่เดิม
--   (สมัย service_role ก็แก้/ลบได้เต็มที่) — ถ้าต้องการบังคับที่ DB จริง ๆ ให้ทำแยก
--   เป็นงาน hardening ต่างหาก เพราะจะกระทบ 3 หน้าข้างต้นทันที
create policy "anon_update_inventory_counts" on public.inventory_counts
    for update to anon, authenticated using (true) with check (true);
create policy "anon_delete_inventory_counts" on public.inventory_counts
    for delete to anon, authenticated using (true);

-- =============================================================================
-- ตรวจผลหลังรัน:
--   select tablename, policyname, cmd, roles from pg_policies
--   where schemaname='public' order by tablename, policyname;
-- แล้วเปิดหน้าเว็บไล่ตาม Smoke Checklist ใน docs/FIX_TRACKING.md
-- =============================================================================
