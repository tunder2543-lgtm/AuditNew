# index.html — หน้านับสต็อก (Stock Counting)

> ไฟล์: `index.html` (root) + logic ทั้งหมดใน `Js/script.js` (~2,530 บรรทัด, IIFE เดียวใน `DOMContentLoaded`)
> หน้าหลักสำหรับบันทึกผลนับจริงเข้า `inventory_counts`

## หน้าที่และฟีเจอร์

### Header / KPI bar (`index.html:26-85`)
- นาฬิกาไทยแบบ real-time (`setInterval` 1 วินาที — `script.js:77-88`)
- KPI 3 ช่อง (`updateStats` — `script.js:1342`):
  1. **บันทึกแล้ววันนี้ (SKU / ชิ้น)**
  2. **ยังไม่ได้นับ (SKU ใน Book)** — คลิกเพื่อเปิด drawer รายการที่ยังไม่นับ
  3. **% SKU ใน Book ที่นับแล้ว**
- Connection badge สถานะ Supabase, ปุ่ม Audit Log drawer, ปุ่ม Export menu
- **แถบเลือกรอบอ้างอิง (Book)** `#countCycle` — แสดงเฉพาะรอบที่ `year_month` ตรงกับเดือนปัจจุบัน (เวลา Bangkok) ของคลังที่เลือก (`populateAndResolveCycle` — `script.js:159-223`)

### ฟอร์มบันทึก (`index.html:94-188`)
- 2 โหมดผ่านแท็บ: **Single** (ทีละรายการ) และ **Group** (แบบกลุ่ม, ค่าเริ่มต้น) — `setMode` (`script.js:894`)
- แถว context: ชื่อผู้นับ / คลัง (select + ช่อง "custom" พิมพ์เอง) / Location
- ช่อง SKU มี **autocomplete** จาก Book SKU ของรอบที่เลือก (คีย์บอร์ด ↑↓/Enter/Tab/Esc, ไฮไลต์ `<mark>`) — `script.js:722-856`
  - SKU อยู่ใน Book → แท็กเขียวแสดงชื่อสินค้า
  - SKU ไม่อยู่ใน Book → เตือนสีเหลือง แต่**ยังบันทึกได้** (จัดเป็น "นอก Master" ใน KPI)
- โหมด Group: รายการ staging สูงสุด **25 รายการ**, ลบรายตัวได้, submit เป็น `insert()` ครั้งเดียว (`submitGroup` — `script.js:1067-1199`)

### รายการล่าสุด (`index.html:192-204`)
- แสดง 100 แถวล่าสุดของคลังที่เลือก แต่ละแถวมีปุ่ม **แก้ไข** (qty + location) และ **ลบ** แบบ modal ยืนยัน 2 ขั้น (`script.js:1476-1693`)

### Drawers / Modals
- **Audit Log drawer**: `inventory_audit_logs` 100 แถวล่าสุด, ขยายดูรายละเอียด `GROUP_INSERT`, export Excel (`script.js:1698-1910`)
- **Uncounted drawer**: Book SKU ที่ยังไม่มีผลนับ + ค้นหาสด + export Excel (`script.js:1993-2059, 2419`)
- **Export menu**: Excel / CSV / ปุ่ม "Dashboard" (navigate ไป `Html/dashboard.html`)
- **Dashboard modal** (`index.html:316-412`) — ⚠️ **โค้ดตาย เข้าถึงไม่ได้** (ดูข้อสังเกต)

## ตาราง Supabase ที่ใช้

| ตาราง | Operation | รายละเอียด |
|---|---|---|
| `book_stock_lines` | SELECT | `sku_id, name_pro` ตาม `cycle_id`, แบ่งหน้า 1000 (`script.js:343-348`) |
| `inventory_counts` | SELECT | `*` เรียง `created_at` desc กรอง warehouse, แบ่งหน้า (`script.js:399-404`) |
| `inventory_counts` | INSERT | `warehouse, location, sku_id, counted_qty, counter_name, client_request_id` (+`cycle_id`) — single `:1243`, group `:1122` |
| `inventory_counts` | UPDATE | `{counted_qty?, location?}` ตาม id+warehouse (`script.js:1598-1605`) |
| `inventory_counts` | DELETE | ตาม id+warehouse (`script.js:1653-1660`) |
| `inventory_audit_logs` | INSERT | action: `INSERT` / `GROUP_INSERT` / `UPDATE` / `DELETE` (`script.js:869`) |
| `inventory_audit_logs` | SELECT | 100 แถวล่าสุด (`:1723`), แบ่งหน้าสำหรับ export (`:1847`) |
| `count_cycles` | SELECT | ผ่าน `reconcileService.fetchCycles/fetchCycleById` |
| `warehouses` | SELECT | ผ่าน `warehouseService.getWarehouseList({force:true})` (`script.js:268`) |

## ฟังก์ชันหลัก (ทั้งหมดใน `Js/script.js`)

| ฟังก์ชัน | บรรทัด | หน้าที่ |
|---|---|---|
| `initSupabase` | 27 | สร้าง client ผ่าน apiService |
| `populateAndResolveCycle` | 159-223 | เติม dropdown รอบ + resolve รอบที่ใช้ |
| `loadBookSkuList` | 324 | โหลด Book SKU ของรอบ |
| `onWarehouseContextChanged` | 374 | รีโหลดทุกอย่างเมื่อเปลี่ยนคลัง |
| `loadPagedInventoryCounts` | 392 | โหลดผลนับแบบแบ่งหน้า |
| `attachCycleId` | 413 | แนบ cycle_id เข้า payload (ผ่าน `RS.attachCycleToPayload`) |
| `getEditDestinationCollision` | 449 | เช็คชนกันก่อนแก้ไข (sku+loc+wh) |
| `renderRecentRecordsList` | 535 | วาดรายการล่าสุด |
| `searchSku` | 612 | ค้นหาในรายการล่าสุด |
| autocomplete | 722-856 | dropdown SKU จาก Book |
| `logAudit` | 866 | เขียน audit log |
| `setMode` | 894 | สลับ Single/Group |
| `addGroupItem` / `submitGroup` | 979 / 1067 | จัดการโหมดกลุ่ม |
| form submit handler | 1204 | บันทึก Single |
| `updateStats` | 1342 | คำนวณ KPI 3 ช่อง |
| edit/delete modal | 1450-1693 | แก้ไข/ลบรายแถว + audit log |
| `loadAuditLogs` / `exportAuditLogs` | 1710 / 1834 | drawer ประวัติ |
| uncounted drawer | 1993-2059 | รายการยังไม่นับ |
| `exportInventory` | 2324 | export Excel/CSV |
| (dead) dashboard modal | 2095-2417 | โค้ดตาย ~320 บรรทัด |

## Shared JS ที่โหลด

`sidebar-shared.js`, `api.js`, `sku-utils.js`, `warehouses-shared.js`, `db-errors.js`, `settings-shared.js`, `reconcile-shared.js`, `script.js` — **ไม่โหลด** `ui-confirm-modal.js` (ใช้ modal ของตัวเอง)

## localStorage keys

| Key | ใช้ทำอะไร |
|---|---|
| `saved_counter_name` | จำชื่อผู้นับ |
| `saved_location` | จำ location ล่าสุด |
| `saved_warehouse` | จำคลังที่เลือก (แชร์กับหน้าอื่น) |
| `count_page_selected_cycle_v1` | จำรอบที่เลือกต่อ `warehouse\|YYYY-MM` |
| `active_count_cycle_v1` | active cycle กลาง (เขียน/อ่านผ่าน reconcile-shared) |
| `SB_URL` / `SB_KEY` | config Supabase (ผ่าน api.js) |

## ความสัมพันธ์กับหน้าอื่น

- อ่าน Book จากที่ `cycle_config.html` อัปโหลด (`book_stock_lines`) และรอบจาก `count_cycles`
- เขียนแถวที่ `audit_check`, `count_search`, `reconcile`, `dashboard`, `live_count_wall` อ่านต่อ
- รายชื่อคลังมาจาก registry ที่จัดการใน `settings.html`
- ⚠️ คลังแบบพิมพ์เอง (custom) จะ**ไม่เข้า** ตาราง `warehouses` — เลือกไม่ได้ในหน้า import/count_search/audit_check

## ข้อสังเกต / จุดเปราะบาง (ดูรายละเอียด + สถานะใน [ISSUES.md](../ISSUES.md))

- **cycle_id ค้างข้ามเดือน**: ถ้าเดือนปัจจุบันไม่มีรอบ ระบบยังแนบ cycle เก่าจาก localStorage ให้ผลนับใหม่ (`script.js:169-188, 413-418`)
- **XSS**: interpolate `sku_id`/`name_pro`/`counter_name` เข้า innerHTML/onclick โดยไม่ escape หลายจุด (`script.js:553-565, 785, 1034, 1330, 1771, 1801`)
- **กติกากันซ้ำตอนแก้ไขขัดกับนโยบาย DB**: `getEditDestinationCollision` ห้ามซ้ำ sku+loc+wh ทั้งที่ migration 011 อนุญาต
- **Group insert แบบ all-or-nothing**: แถวเดียวพังทั้งชุด rollback ไม่มี fallback รายแถว (ต่างจาก import_counts ที่มี)
- **KPI แสดง 0% ระหว่าง Book กำลังโหลด** โดยไม่มีสถานะ loading (`script.js:1345, 1363`)
- **Dead code ~450 บรรทัด**: extra-SKU drawer (`script.js:1918-1991, 2457-2501`), dashboard modal ทั้งชุด (`index.html:316-412` + `script.js:2095-2417`) — โหลด Chart.js จาก CDN โดยไม่ได้ใช้
