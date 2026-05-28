# Count Stock Audit — System Guide

เอกสารนี้สรุปภาพรวมระบบ, โครงสร้างข้อมูล, และวิธีใช้งานแต่ละหน้าแบบ end-to-end สำหรับโปรเจกต์ `AuditNew`

## 1) ภาพรวมระบบ

ระบบนี้แบ่งงานเป็น 3 ส่วนหลัก:

1. บันทึกผลนับจริง (`inventory_counts`)
2. จัดการข้อมูลอ้างอิง (SKU Master / รอบนับ / BOOK)
3. ตรวจสอบและสรุปผล (Audit, Reconcile, Dashboard, Book Explorer)

หลักการสำคัญ:

- `inventory_counts` คือหลักฐานผลนับจริง (ไม่ควรแก้ย้อนหลังใน flow Reconcile)
- `sku_master` คือรายการ SKU เป้าหมายต่อคลัง
- `book_stock_lines` คือยอดก่อนนับ (BOOK) ที่ผูกกับ `count_cycles`
- ทุกหน้าต่อ Supabase ผ่านการตั้งค่าจากหน้า `settings.html`

## 2) โครงสร้างข้อมูลหลัก

ตารางหลักที่ระบบใช้งาน:

- `warehouses` — registry คลังที่ใช้ร่วมกันทุกหน้า
- `sku_master` — SKU Master ต่อคลัง
- `inventory_counts` — รายการนับจริง
- `count_cycles` — รอบนับ
- `book_stock_lines` — รายการ BOOK ต่อรอบ
- `reconciliation_lines` — ผลคำนวณ match
- `stock_adjustments` — รายการปรับยอดฝั่ง Reconcile
- `inventory_audit_logs` — audit log การเปลี่ยนแปลงบางส่วน

SQL ที่เกี่ยวข้อง (จากเอกสารใน `docs/sql`):

- `002_reconciliation_schema.sql`
- `003_cycle_all_warehouses_date_range.sql`
- `004_dashboard_submission_buckets.sql` (optional)
- `014_warehouses_registry.sql`

## 3) ลำดับการใช้งานระบบ (แนะนำ)

1. ตั้งค่า Supabase ที่ `settings.html`
2. จัดการคลังที่ `settings.html` (เพิ่ม/ลบ/เปิด-ปิด)
3. นำเข้า SKU Master ที่ `sku_master.html`
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

### 4.2 `sku_master.html`

หน้าที่:

- นำเข้า/จัดการ SKU Master ต่อคลัง

ผลกระทบ:

- KPI บางตัวใน `index.html` อิง SKU Master (เช่น ยังไม่ได้นับ, % ใน Master)

---

### 4.3 `cycle_config.html`

หน้าที่:

- สร้างรอบนับ (`count_cycles`)
- อัปโหลด BOOK (`book_stock_lines`)
- ตั้ง active cycle / ผูกข้อมูลผลนับเข้ารอบ (ตาม flow ที่ระบบรองรับ)

---

### 4.4 `index.html` (นับสต็อก)

หน้าที่:

- บันทึกผลนับแบบ single/group เข้า `inventory_counts`
- แสดง KPI และรายการนับล่าสุด

หมายเหตุ:

- SKU ที่ไม่มีใน Master ยังบันทึกได้ แต่จะถูกจัดเป็นนอก Master ใน KPI ที่เกี่ยวข้อง

---

### 4.5 `import_counts.html`

หน้าที่:

- นำเข้าข้อมูลผลนับจำนวนมากจากไฟล์
- เขียนเข้า `inventory_counts`

---

### 4.6 `audit_check.html` / `count_search.html`

หน้าที่:

- ตรวจคุณภาพข้อมูลผลนับ
- ค้นหาและตรวจย้อนหลัง

---

### 4.7 `reconcile.html`

หน้าที่:

- เปรียบเทียบ BOOK vs Counted
- ช่วยทำงานปรับยอดและ export ตาม flow reconciliation

อ้างอิง:

- ดูแนวคิดเชิงลึกใน `docs/RECONCILIATION_DESIGN.md`

---

### 4.8 `book_explorer.html`

หน้าที่:

- หน้าอ่านข้อมูล BOOK โดยเฉพาะ (read-only)

ความสามารถ:

- ฟิลเตอร์ตามคลัง, สถานะ qty, คำค้น, ช่วงวันที่
- KPI สรุป, ตาราง, sort, pagination

---

### 4.9 `dashboard.html`

หน้าที่:

- สรุปภาพรวมประสิทธิภาพ/ปริมาณงานจากข้อมูลจริงในระบบ

## 5) ฟิลเตอร์และ KPI ที่ควรรู้

- KPI ในหน้านับบางตัวสัมพันธ์กับ `sku_master` ไม่ใช่เฉพาะจำนวนที่สแกน
- `book_explorer.html` ใช้ `book_stock_lines` เป็นหลัก และ join metadata รอบจาก `count_cycles`
- ฟิลเตอร์วันที่ใน `book_explorer.html` ใช้ช่วงวันแบบ local-day logic

## 6) Troubleshooting (ปัญหาพบบ่อย)

### 6.1 KPI ขึ้นไม่ตรงคาดในหน้านับ

ตรวจ:

- คลังที่เลือกตรงกับข้อมูลหรือไม่
- SKU Master ของคลังนั้นมีข้อมูลหรือไม่
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

