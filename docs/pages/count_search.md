# count_search.html — ค้นหาผลนับย้อนหลัง

> ไฟล์: `Html/count_search.html` (~861 บรรทัด, inline script `:345-859`)
> หน้าอ่านอย่างเดียว — ค้นหา/กรอง/export ข้อมูล `inventory_counts` ย้อนหลัง
> เป็นหน้าที่โค้ดสะอาดที่สุดในกลุ่ม count flow (escape HTML ครบทุกจุด)

## หน้าที่และฟีเจอร์

- **Toolbar** (`:259-306`): คำค้นอิสระ (SKU/location/ผู้นับ/คลัง), เลือกคลัง, เลือก **ปี + เดือน** พร้อมปุ่ม "โหลดเฉพาะเดือนที่มีข้อมูล", กรอง location, กรองผู้นับ, ปุ่มค้นหา, ปุ่ม Export
- **กรอง 2 ชั้น**:
  - ชั้น DB: warehouse + ช่วงเดือน (`applyDbFilters:418`)
  - ชั้น client: SKU/location/ผู้นับ กรองจาก cache แล้ว re-render ทันทีตอนพิมพ์ (`applyLocalFilters:438`)
- **แบ่งหน้าโหลดพร้อม progress**: ยิง `count: 'exact', head: true` ก่อนเพื่อรู้จำนวนที่คาด แล้วดึงทีละ 1000 แถวพร้อม progress bar, จำกัด `MAX_BATCHES = 500` (500,000 แถว) (`fetchAllRowsInRange:618`)
- **ตรวจความครบถ้วน**: dedupe ตาม `id` (`dedupeRowsById:598`) ถ้า `fetched !== expected` แสดงคำอธิบายภาษาไทย + สรุปเป็นสีเหลือง (`updateDisplaySummary:460`)
- Export Excel ของ view ที่กรองอยู่ (`:804-822`)

## ตาราง Supabase ที่ใช้ (อ่านอย่างเดียว)

| Query | รายละเอียด |
|---|---|
| `inventory_counts` count exact | `select('id',{count:'exact',head:true})` + filters (`:624-625`) |
| `inventory_counts` select | `id, sku_id, location, warehouse, counted_qty, counter_name, created_at, cycle_id` เรียง `created_at` desc → `id` desc, `.range()` (`:658-663`) |
| `inventory_counts` เดือนที่มีข้อมูล | `select('created_at')` limit **8000** (`:564-566`) |
| `warehouses` | ผ่าน `warehouseService.populateSelect` |

## ฟังก์ชันหลัก (inline)

| ฟังก์ชัน | บรรทัด |
|---|---|
| `getMonthBoundsIso` | 389 |
| `buildDbFilters` / `applyDbFilters` / `applyLocalFilters` | 403 / 418 / 438 |
| `updateDisplaySummary` | 460 |
| `bangkokYearMonth` / `buildYearOptions` / `buildMonthOptions` | 509 / 518 / 527 |
| `loadAvailableMonths` | 557 |
| `dedupeRowsById` / `fetchAllRowsInRange` | 598 / 618 |
| `runSearch` / `renderTable` | 738 / 783 |

## Shared JS ที่โหลด

`sidebar-shared.js`, `api.js`, `sku-utils.js`, `warehouses-shared.js`, `settings-shared.js`, `reconcile-shared.js` — ไม่โหลด `ui-confirm-modal.js` (ไม่มี action ทำลายข้อมูล)

## localStorage keys

- อ่านอย่างเดียว: `saved_warehouse`, `import_counts_warehouse` (`:845`) — ไม่เขียนอะไรเลย

## ความสัมพันธ์กับหน้าอื่น

- อ่านข้อมูลที่ index.html / import_counts.html เขียน
- **กรองตามเดือนปฏิทิน** ขณะที่ index/import/reconcile คิดเป็น "รอบ (cycle)" — ผลค้นหา "มิถุนายน" กับผล reconcile "รอบ 2 ของมิถุนายน" อาจไม่ตรงกันโดยไม่มีคำอธิบายบนหน้าจอ

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **ตัวเลือกเดือนตัดที่ 8000 แถวเงียบ ๆ** (`:566` เรียง desc) — ข้อมูลเกิน 8000 แถวแล้วเดือนเก่าจะหายจากตัวเลือกโดยไม่เตือน
- `cycle_id` ถูก select มาแต่**ไม่ใช้เลย** — ไม่แสดง ไม่ export ไม่กรอง (`:658` vs `:790-800, 806-816`)
- `const RS = window.reconcileService` capture ตอน parse (`:348`) — ผูกกับลำดับ script tag
- precedence คลัง (`saved_warehouse || import_counts_warehouse`) สลับกับ import_counts.html
- จุดแข็ง: เป็นหน้าเดียวในกลุ่ม count flow ที่ `esc()` ครบทุกค่า dynamic (`:793-798, 503`)
