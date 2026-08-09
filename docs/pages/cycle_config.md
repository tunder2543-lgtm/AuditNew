# cycle_config.html — ตั้งค่ารอบนับ + อัปโหลด BOOK

> ไฟล์: `Html/cycle_config.html` (~2,018 บรรทัด: CSS `:1-426`, markup `:428-849` รวม 2 modal, inline JS `:859-2016`)
> ศูนย์กลางจัดการ `count_cycles`: สร้างรอบ, อัปโหลด Book, ตั้ง active cycle, ผูกผลนับเข้ารอบ

## หน้าที่และฟีเจอร์

### 1. สร้างรอบ (`:464-554`)
- โหมดคลัง: เลือกหลายคลัง (checkbox) หรือ "คลังทั้งหมด"
- เลือกปี+เดือน + ปุ่ม "โหลดเดือนที่มีข้อมูลนับ"
- เลือกช่วงวัน — dropdown แสดง**เฉพาะวันที่มีข้อมูลนับจริง**
- สถานะ (`open/counting/reconciling/closed`) + label
- `btnCreateCycle` → `RS.createCycle` (`:1659-1683`)

### 2. รายการรอบ (`:557-588`)
- กรองตามคลัง, แต่ละแถวแสดงจำนวนแถว Book + จำนวนผลนับที่ผูกแล้ว (⚠️ N+1: ยิง count 2 query ต่อรอบ — `:1336-1340`)
- badge สถานะ + active, ปุ่ม เลือก / ใช้งาน / ลบ

### 3. แถบ active cycle (`:455-461`)
`localStorage.active_count_cycle_v1` ผ่าน `RS.setActiveCycle` (`:1419-1426`) — เป็นช่องทางสื่อสารให้ index.html / import_counts.html แนบ `cycle_id`

### 4. Panel รายละเอียดรอบที่เลือก (`:591-762`)
- สถิติ (แถว Book, ผลนับที่ผูก, ช่วงวัน, สถานะ)
- **แก้คลังของรอบ** (`btnSaveCycleWarehouse:1556-1602`)
- **แก้ช่วงวัน** (`btnSaveCycleDates:1604-1657`)
- **อัปโหลด Book**: dropzone + `FileReader.readAsBinaryString`, ตารางแถวผิด (สูงสุด 200), panel SKU ซ้ำ (สูงสุด 30), แถบ "พร้อมแต่ยังไม่บันทึก", ดาวน์โหลด Template, ปุ่ม **นำเข้า Book** ใช้ `mode: 'replace'` (`:1820-1847`)
- **ผูกผลนับเข้ารอบ**: ปุ่มตรวจสอบจำนวน preview, ตารางแถวค้าง (แสดง 500 แรก export ได้ทั้งหมด), modal ยืนยัน 2 ขั้น — link ตั้งเฉพาะ `cycle_id` (`:1969-2000`)
- ลิงก์ไป `reconcile.html?cycle=<id>`

### 5. Modal ลบรอบ (`:776-811`)
แยกชัด: "จะลบ" (Book + match + adjustments ผ่าน FK CASCADE) vs "คงไว้" (ผลนับ — `cycle_id` ถูกตั้ง null)

## ตาราง Supabase ที่ใช้

| ตาราง | Operations |
|---|---|
| `count_cycles` | SELECT/INSERT/UPDATE/DELETE (ผ่าน reconcileService) |
| `book_stock_lines` | count, INSERT (RPC atomic หรือ legacy) |
| `inventory_counts` | SELECT `created_at` ตรง ๆ สำหรับ picker วัน/เดือน (`:997-1001, 1148-1152, 1222-1224`); count; SELECT แถว linkable; UPDATE `{cycle_id}` / `{cycle_id: null}` |
| `warehouses` | ผ่าน `warehouseService` (populateSelect, renderCheckboxGroup) |

## Shared JS ที่โหลด (`:851-858`)

ครบชุด: `sidebar-shared`, `api`, `sku-utils`, `warehouses-shared`, `db-errors`, `settings-shared`, `reconcile-shared`, `ui-confirm-modal` — แต่ใช้ระบบ confirm 2 แบบปนกัน (uiConfirm + modal promise เขียนเอง `showDeleteCycleModal:1430`, `showLinkConfirmModal:1452`)

## localStorage keys

เฉพาะ `active_count_cycle_v1` (ผ่าน reconcileService) — ฟิลเตอร์คลัง/เดือนที่เลือก**ไม่ถูกจำ** (ต่างจาก sku_master/audit_check)

## ความสัมพันธ์กับหน้าอื่น

```
cycle_config ──สร้าง──► count_cycles ──► reconcile / dashboard / book_explorer / index
             ──อัปโหลด──► book_stock_lines ──► index (autocomplete/KPI), reconcile, book_explorer, live_count_wall
             ──ผูก──► inventory_counts.cycle_id ──► reconcile (RPC กรองตามนี้)
             ──ตั้ง──► active_count_cycle_v1 ──► index / import_counts แนบ cycle_id อัตโนมัติ
```

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **`.limit(10000)` / `.limit(5000)` บน `inventory_counts`** (`:1152, 1224`) — PostgREST hosted จำกัด max-rows (ปกติ 1000) → เดือนที่ข้อมูลเยอะ รายการ "วันที่มีข้อมูล" จะขาดหายเงียบ ๆ ทั้งที่มี RPC `get_inventory_count_months` (สร้างใน `docs/sql/013`) ที่ audit_check ใช้อยู่แล้วแต่หน้านี้ไม่ใช้
- คำนวณ timezone Bangkok 2 วิธีในไฟล์เดียว: `Intl.DateTimeFormat` (`:1098-1105`) vs บวก 7 ชม. เอง (`:1227-1229`)
- N+1 รายการรอบ: 50 รอบ = 100 round-trip
- ตัวเลือกคลัง hardcode 3 คลังเป็น fallback (`:562-568`) — ถ้า registry โหลดพังจะเห็นรายการเก่า
- **ยืนยัน link ขั้น 2 ไม่ reset ตอน cancel** — กด cancel แล้วปุ่มยังค้าง "(2/2)" คลิกถัดไปผูกทันทีข้ามขั้นแรก (`:1969-1999`)
- ลากไฟล์วางโดยยังไม่เลือกรอบ → parse ได้ เปิดปุ่มนำเข้า แต่กดแล้วเงียบ (`:1691-1696, 1821`)
- `btnBookTemplate` (`:1809-1818`) copy โค้ด `RS.downloadBookImportTemplate` มาทั้งก้อนแทนที่จะเรียกใช้
- `readAsBinaryString` deprecated (`:1781`) — ขณะที่ reconcile ใช้ arrayBuffer แล้ว (parser 2 ชุดสำหรับไฟล์แบบเดียวกัน)
