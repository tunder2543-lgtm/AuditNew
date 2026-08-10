# Count Stock Audit — System Guide

เอกสารนี้สรุปภาพรวมระบบ, โครงสร้างข้อมูล, และวิธีใช้งานแต่ละหน้าแบบ end-to-end สำหรับโปรเจกต์ `AuditNew`

## 1) ภาพรวมระบบ

ระบบนี้แบ่งงานเป็น 3 ส่วนหลัก:

1. บันทึกผลนับจริง (`inventory_counts`)
2. จัดการข้อมูลอ้างอิง (รอบนับ / BOOK)
3. ตรวจสอบและสรุปผล (Audit, Reconcile, Dashboard, Book Explorer)

หลักการสำคัญ:

- `inventory_counts` คือหลักฐานผลนับจริง (ไม่ควรแก้ย้อนหลังใน flow Reconcile)
- `book_stock_lines` คือยอดก่อนนับ (BOOK) ที่ผูกกับ `count_cycles`
- ทุกหน้าต่อ Supabase ผ่านการตั้งค่าจากหน้า `settings.html`

## 2) โครงสร้างข้อมูลหลัก

ตารางหลักที่ระบบใช้งาน:

- `warehouses` — registry คลังที่ใช้ร่วมกันทุกหน้า
- `inventory_counts` — รายการนับจริง
- `count_cycles` — รอบนับ
- `book_stock_lines` — รายการ BOOK ต่อรอบ
- `reconciliation_lines` — ผลคำนวณ match
- `stock_adjustments` — รายการปรับยอดฝั่ง Reconcile
- `inventory_audit_logs` — audit log การเปลี่ยนแปลงบางส่วน
- `reconciliation_match_acceptances` — กลุ่มที่คนยืนยันว่า Match ปกติ (ฝั่ง reconcile)
- `inventory_count_acceptances` — กลุ่มผลนับที่คนกด "ยืนยันว่าปกติ" (ฝั่ง audit_check)
- `chat_messages` — แชททีม (ไฟล์แนบเก็บเป็นคอลัมน์ `file_*` ในตารางนี้ + Supabase Storage bucket `chat-attachments` ไม่ใช่ตารางแยก)

SQL: ดูรายการ migration ครบทุกไฟล์พร้อมสถานะรายไฟล์ที่ [DATABASE.md](DATABASE.md) — ปัจจุบันมี 21 ไฟล์ใน `docs/sql/` (เอกสารนี้เคยลิสต์ไว้แค่ 4)

## 3) ลำดับการใช้งานระบบ (แนะนำ)

1. ตั้งค่า Supabase ที่ `settings.html`
2. จัดการคลังที่ `settings.html` (เพิ่ม/ลบ/เปิด-ปิด)
4. สร้างรอบและอัปโหลด BOOK ที่ `cycle_config.html`
5. บันทึกผลนับที่ `index.html` หรือ import ผ่าน `import_counts.html`
6. ตรวจสอบข้อมูลที่ `audit_check.html` / `count_search.html`
7. Match และปรับยอดที่ `reconcile.html`
8. ดู BOOK แบบอ่านอย่างเดียวที่ `book_explorer.html`
9. ดูภาพรวมที่ `dashboard.html`

## 4) คู่มือแต่ละหน้า

### 4.1 `settings.html`

หน้าที่:

- ตั้งค่า Supabase URL/Key
- จัดการคลัง (Warehouse Registry)

สิ่งสำคัญ:

- คลังใหม่จะกระทบทุกหน้าในระบบ
- การลบคลังปัจจุบันเป็นการลบจาก registry (`warehouses`) ตามที่ปรับล่าสุด

---

### 4.2 `cycle_config.html`

หน้าที่:

- สร้างรอบนับ (`count_cycles`)
- อัปโหลด BOOK (`book_stock_lines`)
- ตั้ง active cycle / ผูกข้อมูลผลนับเข้ารอบ (ตาม flow ที่ระบบรองรับ)

---

### 4.3 `index.html` (นับสต็อก)

หน้าที่:

- บันทึกผลนับแบบ single/group เข้า `inventory_counts`
- แสดง KPI และรายการนับล่าสุด

หมายเหตุ:

- SKU ที่ไม่มีใน Master ยังบันทึกได้ แต่จะถูกจัดเป็นนอก Master ใน KPI ที่เกี่ยวข้อง

---

### 4.4 `import_counts.html`

หน้าที่:

- นำเข้าข้อมูลผลนับจำนวนมากจากไฟล์
- เขียนเข้า `inventory_counts`

---

### 4.5 `audit_check.html` / `count_search.html`

หน้าที่:

- ตรวจคุณภาพข้อมูลผลนับ
- ค้นหาและตรวจย้อนหลัง

---

### 4.6 `reconcile.html`

หน้าที่:

- เปรียบเทียบ BOOK vs Counted
- ช่วยทำงานปรับยอดและ export ตาม flow reconciliation

อ้างอิง:

- ดูแนวคิดเชิงลึกใน `docs/RECONCILIATION_DESIGN.md`

---

### 4.7 `book_explorer.html`

หน้าที่:

- หน้าอ่านข้อมูล BOOK โดยเฉพาะ (read-only)

ความสามารถ:

- ฟิลเตอร์: ปี (Book) → เดือน → รอบ → สถานะจำนวน (`ทั้งหมด` / `qty > 0` / `qty = 0`) → คำค้น (SKU / Location / ชื่อสินค้า) → จำนวนต่อหน้า
- **ไม่มี dropdown คลัง และไม่มีฟิลเตอร์ช่วงวันที่** (การกรองรอบทำผ่านปี-เดือน-รอบ)
- KPI สรุป, ตาราง, sort, pagination

---

### 4.8 `dashboard.html`

หน้าที่:

- สรุปภาพรวมประสิทธิภาพ/ปริมาณงานจากข้อมูลจริงในระบบ

## 5) ฟิลเตอร์และ KPI ที่ควรรู้

- KPI ในหน้านับเทียบกับ **BOOK ของรอบที่เลือก** (`book_stock_lines`)
- `book_explorer.html` ใช้ `book_stock_lines` เป็นหลัก และ join metadata รอบจาก `count_cycles`

## 6) Troubleshooting (ปัญหาพบบ่อย)

### 6.1 KPI ขึ้นไม่ตรงคาดในหน้านับ

ตรวจ:

- คลังที่เลือกตรงกับข้อมูลหรือไม่
- **รอบที่เลือกมี BOOK อัปโหลดแล้วหรือยัง** (KPI อิง `book_stock_lines` ของรอบนั้น)
- มี cache ค้างหรือไม่ (ลอง `Ctrl+F5`)

### 6.2 คลังใหม่ไม่ขึ้นทุกหน้า

ตรวจ:

- มีรายการใน `warehouses` จริง
- หน้าโหลด `warehouses-shared.js`
- รีโหลดหน้าเพื่อดึง registry ล่าสุด

### 6.3 หน้า Book Explorer ดูเหมือนตำแหน่งเพี้ยน

ตรวจ:

- ใช้ไฟล์ล่าสุดและ `Ctrl+F5`
- ดูว่า sidebar + main-content ใช้ layout เดียวกับหน้าอื่น

## 7) แนวทางดูแลระบบ

- สำรองข้อมูลก่อนรัน migration สำคัญ
- แยก environment dev/prod ให้ชัด
- เวลาปรับ flow Reconcile ให้รักษาหลักการ immutable ของ `inventory_counts`
- บันทึก change log ทุกครั้งที่แก้ schema / KPI logic

## 8) เอกสารอ้างอิงในโปรเจกต์

- `docs/RECONCILIATION_DESIGN.md`
- `Html/user_manual.html`
- `docs/sql/*.sql`

