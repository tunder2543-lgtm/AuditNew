# import_counts.html — นำเข้าผลนับจากไฟล์ (Bulk Import)

> ไฟล์: `Html/import_counts.html` (~1,643 บรรทัด, logic ทั้งหมด inline `:547-1641`)
> นำเข้าผลนับจำนวนมากจาก Excel/CSV เข้า `inventory_counts`

## หน้าที่และฟีเจอร์

### การ์ดข้อมูลนำเข้า
- เลือกคลัง (จาก `warehouseService` — **ไม่มีช่อง custom** ต่างจาก index.html) + ชื่อผู้นำเข้า
- **แถบสถานะรอบ (cycle banner)** (`:438-441`, `refreshImportCycleBanner:629`): เขียว = จะแนบ `cycle_id` / เหลือง = `cycle_id` ว่าง — ฟัง `storage` event ข้ามแท็บของ `active_count_cycle_v1` (`:1606`)

### อัปโหลดไฟล์
- คลิกหรือลากวาง `.xlsx/.xls/.csv` — คอลัมน์ **A=Location, B=SKU, C=จำนวน** (สลับกับ paste ใน audit_check ที่เป็น SKU,Loc,Qty)
- ตรวจหัวตารางด้วย heuristic + ข้ามแถวว่าง (`parseExcelRows:844`)
- ดาวน์โหลด Template สร้างจากฝั่ง client (`downloadTemplate:1340`)

### Preview + Import
- แสดง chip จำนวนแถว ถูกต้อง/ผิด/รวม, ตาราง 100 แถวแรก, เหตุผลข้อผิดพลาดรายแถว
- **Import ยืนยัน 2 ขั้น** ผ่าน `uiConfirm.show`, แบ่ง chunk ละ **200 แถว** (`CHUNK_SIZE:550`)
- **Bulk แล้ว fallback ทีละแถว**: ถ้า insert ทั้ง chunk พัง จะไล่ insert ทีละแถวเพื่อนับ ok/duplicate/fail แม่นยำ (`importChunkRows:690`, `importRowsOneByOne:718`)
- **Panel แถวที่พัง + retry**: แถวที่พังถูกโหลดกลับเข้า `pendingValidRows` ให้กด "นำเข้าแถวที่เหลือ" (`:1478-1488, 1552-1557`)

### ประวัติการนำเข้า
- แสดง log `IMPORT` 50 รายการล่าสุดจาก `inventory_audit_logs`
- ปุ่ม **"Export รายละเอียด"** ต่อแถว — ดึงแถว `inventory_counts` จริงของ batch นั้น (ใช้ `import_batch_id` ถ้ามี ไม่มีก็เดาจากช่วงเวลา)
- Export ประวัติทั้งหมดเป็น Excel

## ตาราง Supabase ที่ใช้

| ตาราง | Operation | รายละเอียด |
|---|---|---|
| `inventory_counts` | INSERT | `warehouse, location, sku_id, counted_qty, counter_name, client_request_id, import_batch_id` (+`cycle_id`) — `buildCountPayload:649` |
| `inventory_counts` | SELECT | ตาม `import_batch_id` (`:1136-1139`) หรือช่วงเวลา (`:1153-1161`) |
| `inventory_audit_logs` | INSERT | `action_type:'IMPORT'`, `record_id`=batch UUID, `old_qty`=จำนวนพัง, `new_qty`=จำนวนสำเร็จ, `location`=ชื่อไฟล์ (`logImportBatch:972`) |
| `inventory_audit_logs` | SELECT | `action_type='IMPORT'` limit 50 (`:1261`) / แบ่งหน้า 1000 (`:1236`) |
| `warehouses` | SELECT | ผ่าน `warehouseService.populateSelect` |

ต้องรัน migration `docs/sql/015_import_batch_id.sql` ก่อน (UI แจ้งไว้ที่ `:519`)

## ฟังก์ชันหลัก (inline ทั้งหมด)

| ฟังก์ชัน | บรรทัด |
|---|---|
| `genClientRequestId` | 565 |
| `getImportCycleHint` / `refreshImportCycleBanner` | 591 / 629 |
| `buildCountPayload` / `insertOneCountRow` | 649 / 672 |
| `importChunkRows` / `importRowsOneByOne` | 690 / 718 |
| `renderImportResultPanel` | 777 |
| `parseExcelRows` / `renderPreview` / `handleFile` | 844 / 874 / 934 |
| `logImportBatch` | 961 |
| `fetchRowsForImportLog` / `exportImportBatchDetail` | 1128 / 1167 |
| `loadImportHistory` / `exportImportHistory` | 1252 / 1286 |
| `runImport` | 1352 |

## Shared JS ที่โหลด

`sidebar-shared.js`, `api.js`, `sku-utils.js`, `warehouses-shared.js`, `db-errors.js`, `settings-shared.js`, `reconcile-shared.js`, `ui-confirm-modal.js` (+ `Css/ui-confirm.css`)

## localStorage keys

- เขียน: `saved_counter_name`, `saved_warehouse`, `import_counts_warehouse` (`:1490-1492`)
- อ่าน: ค่าข้างบน + `active_count_cycle_v1` (ผ่าน storage event)

## ความสัมพันธ์กับหน้าอื่น

- แนบ `cycle_id` จาก active cycle ที่ตั้งใน `cycle_config.html` (ผ่าน `RS.attachCycleToPayload`)
- แถวที่นำเข้าไปปรากฏใน index.html (รายการล่าสุด/KPI), audit_check, count_search, reconcile, dashboard
- ประวัติ IMPORT ใช้ `inventory_audit_logs` ร่วมกับ index.html

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **XSS ใน preview table**: `r.sku`, `r.loc`, `r.errors` ใส่ innerHTML ตรง ๆ (`:906-909`) ทั้งที่มี `escHtml` (`:957`) ใช้ที่อื่นทั้งหน้า
- **"Export รายละเอียด" ของ log เก่า (ไม่มี batch id) เดาจากช่วงเวลา ±30 นาที** — อาจปนแถวที่นับมือเข้ามา (`:1149-1164`)
- **Retry สร้าง `client_request_id`/`import_batch_id` ใหม่** — แถวที่จริง ๆ insert สำเร็จแต่ network error จะกลายเป็นซ้ำจริงใน DB (`:1479-1485, 1448-1454`)
- ไม่มี guard บังคับให้มี `cycle_id` — นำเข้าได้ทั้งที่แถบเหลือง แถวเหล่านั้นจะมองไม่เห็นในทุก view ที่กรองตามรอบ
- `loadImportHistory()` ถูกเรียกซ้ำ 2 ครั้งตอนบูต (`:1625-1640`)
- `readAsBinaryString` deprecated (`:954`)
- ลำดับ precedence คลัง (`saved_warehouse || import_counts_warehouse`) สลับกับ count_search — สลับหน้าแล้วคลังที่เลือกอาจเปลี่ยน
