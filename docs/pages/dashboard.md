# dashboard.html — สรุปภาพรวม (Analytics)

> ไฟล์: `Html/dashboard.html` (~2,859 บรรทัด: inline `<style>` ~1,100 + inline `<script>` ~1,250) + `Js/dashboard-shared.js` (~242 บรรทัด, helper ล้วนไม่มี I/O)
> หน้าวิเคราะห์ 2 แท็บ: ความเร็วการนับ/ส่งงาน และผล Match ยอดต่อรอบ

## หน้าที่และฟีเจอร์

### แท็บ 1 — การนับและความเร็วส่งงาน
- KPI การนับ, กราฟเส้นอัตราส่งงานตามช่วงเวลา (Chart.js) — bucket ตามนาทีที่เลือก
- ตัวกรอง: คลัง (scope), รอบ (cycle), ช่วง bucket (dropdown hardcode ใน HTML `:1375-1378`), ผู้นับ
- สถิติจาก `dashboardShared.bucketSubmissionsByInterval` / `computeSubmissionRateStats`

### แท็บ 2 — Match ยอด (รอบ)
- KPI สรุปจาก `v_cycle_reconciliation_summary`
- ตาราง top variance จาก `reconciliation_lines`
- Progress การนับเทียบ Book (kpiUncounted / kpiProgress)

- รีเฟรชด้วยปุ่ม `#btnReloadDashboard` หรือเปลี่ยนฟิลเตอร์ — **ไม่มี realtime subscription**

## แหล่งข้อมูล (ส่วนใหญ่ผ่าน `RS = window.reconcileService`)

| แหล่ง | วิธีเรียก |
|---|---|
| `book_stock_lines` | แบ่งหน้า 1000 query ตรง `.eq('cycle_id')` — **ไม่กรอง warehouse** (`:2092-2124`) |
| `inventory_counts` | `RS.loadInventoryCountsForDashboard` |
| `count_cycles` | `RS.fetchCycles`, `RS.getActiveCycle` |
| `v_cycle_reconciliation_summary` (view) | `RS.fetchCycleSummary` |
| `reconciliation_lines` | `RS.fetchReconciliationLinesTop` |
| `warehouses` | `warehouseService.getWarehouseList({force:true})` |
| RPC `submission_rate_buckets` | `RS.fetchSubmissionBuckets` (คืน null เงียบ ๆ เมื่อพัง) |

## Shared JS ที่โหลด (`:1597-1604`)

`sidebar-shared`, `api`, `sku-utils` (โหลดแต่**ไม่ใช้** — หน้าใช้ `normalize()` ของตัวเองแบบ lowercase `:1713`), `warehouses-shared`, `db-errors`, `settings-shared`, `reconcile-shared`, `dashboard-shared`

## localStorage keys

`dashboard_scope_warehouse` (`:1621, 1770-1772`), `dashboard_cycle_id` (`:1622, 2129-2130`) + รับ `?cycle=` query param (`:1623`)

## ความสัมพันธ์กับหน้าอื่น

- อ่านผลจาก `reconcile.html` (ต้องกด "คำนวณ Match" ก่อนตัวเลขแท็บ 2 จึงอัปเดต)
- อ่านผลนับจาก index/import, Book จาก cycle_config

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- ~~โหมดทุกคลังคูณ Book ต่อจำนวนคลัง~~ **แก้แล้ว (H4, 2026-08-09)** — ใช้ `dashboardShared.computeBookCoverage()` นับ Book ครั้งเดียว (Book ไม่มีมิติคลัง) · แก้บั๊ก paging ที่ทำให้ข้าม/ซ้ำแถวไปพร้อมกัน (H9)
- **[ยืนยันแล้ว] `avgPerMin` เฉลี่ยสูงเกินจริง** (`dashboard-shared.js:64-65`): หารด้วยจำนวน bucket ที่มีข้อมูล ไม่ใช่ช่วงเวลาจริง — พักเที่ยง 2 ชม. หายจากตัวหาร
- ~~ป้าย "รวม 3 คลัง" hardcode~~ **แก้แล้ว (H4)** — เปลี่ยนเป็น "(ทุกคลังในรอบนี้)"
- `getSKUName(skuId)` รับ 1 argument แต่ถูกเรียกด้วย 2 (warehouse ถูกทิ้ง) 4 จุด (`:2340, 2629, 2663, 2679`)
- `async render()` ไม่มีใคร await — RPC พังกลายเป็น unhandled rejection (`:2764` + call sites)
- Connection badge เขียนเองใหม่ (`#connectionPill`, `:2055-2070`) — settings-shared โหลดมาแต่ไม่ทำงานเพราะไม่มี element ที่มันหา
- Dead: `renderFilters` (`:2447-2453` ไม่มีผู้เรียก), ตัวแปร `bookSku` (`:1614` write-only), `getScopedBookSku()` เป็น shim คืน `bookSkuAll` ตรง ๆ (`:1731-1733`)
- normalize SKU แบบ lowercase ของตัวเอง — สวนมาตรฐาน UPPERCASE ของระบบ (ไม่บั๊กตราบใดที่ self-consistent แต่เป็นกับดัก)
- สี chart hardcode hex ไม่ใช้ CSS variables (dashboard-shared.js)
