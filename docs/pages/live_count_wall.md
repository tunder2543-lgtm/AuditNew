# live_count_wall.html — จอแสดงผลนับสด (Wall Display)

> ไฟล์: `Html/live_count_wall.html` (~428 บรรทัด) + `Js/live-count-wall.js` (~724 บรรทัด)
> บอร์ดแสดงผลหน้างานนับ: ซ้าย = SKU ใน Book ที่ยังไม่นับ, ขวา = ผลนับที่ส่งเข้ามา (ใหม่สุดก่อน จำกัด 300), toast มุมจอเมื่อมี INSERT/UPDATE/DELETE, โหมดเต็มจอซ่อน sidebar

## หน้าที่และฟีเจอร์

- ฟิลเตอร์คลัง + รอบ (จำใน localStorage)
- **Realtime**: channel `live-count-wall-<timestamp>` บน `inventory_counts` — listener แยก 3 ตัว INSERT/UPDATE/DELETE ไม่มี filter (`:530-553`)
- **Polling fallback**: 15 วิเมื่อ realtime ล่ม / 90 วิเมื่อปกติ; Book รีเฟรชทุก 3 รอบ poll ช้า (`:8-12, 568-582`); หยุดเมื่อแท็บซ่อน (`:572, 660-667`)
- จุดเด่น: `resolveRowForEvent` (`:315-322`) — realtime DELETE ของ Supabase ส่งมาแค่ `{id}` โค้ดกู้ข้อมูลแถวจาก cache ในเครื่องเพื่อให้ toast แสดง SKU/ผู้นับ/จำนวนได้

## แหล่งข้อมูล

| แหล่ง | วิธีเรียก |
|---|---|
| `book_stock_lines` | แบ่งหน้า 1000 query ตรง (`:420-426`) |
| `inventory_counts` | `RS.loadInventoryCountsForDashboard({maxRows: 50000})` |
| `count_cycles` | `RS.fetchCycles`, `RS.getActiveCycle` |
| `warehouses` | `warehouseService.getWarehouseList({force:true})` |
| Realtime | `postgres_changes` บน `public.inventory_counts` |

## Shared JS ที่โหลด (`live_count_wall.html:415-422`)

`api`, `sku-utils`, `warehouses-shared`, `db-errors`, `settings-shared`, `reconcile-shared`, `sidebar-shared`, `live-count-wall` — ⚠️ **ลำดับสำคัญ**: `live-count-wall.js` capture `const RS = window.reconcileService` ตอน parse (`live-count-wall.js:6`) — ถ้าสลับให้มาก่อน reconcile-shared หน้าจะพังทันที

## localStorage keys

`live_wall_warehouse`, `live_wall_cycle_id` (`live-count-wall.js:16-17`)

## ความสัมพันธ์กับหน้าอื่น

- แสดงผลสดของแถวที่ index.html / import_counts.html เขียน
- Book จาก cycle_config.html

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- ป้าย fallback ใน JS ผิด: static HTML เขียน "— เดือนนี้ (ไม่กรองรอบ) —" (ถูก) แต่ `populateCycleSelect` (`:607`) ทับเป็น "— วันนี้ —" ทั้งที่พฤติกรรมจริง (`:451-453`) เป็นรายเดือน
- การ์ด pending แสดง "คลัง" จากค่าฟิลเตอร์ปัจจุบัน ไม่ใช่จากข้อมูลจริง (`:436`) — โหมดทุกคลังแสดง `-`
- Dead code: `bangkokTodayRange` (`:79-93`), `skuMatchesScope` (`:125-128`), `knownIds` Set ที่ add/delete แต่ไม่เคยอ่าน (`:25`), `getScopedBookSku()` shim (`:134-136`)
- fallback รายชื่อคลัง hardcode ชุดที่ 3 ของระบบ (`:14` — ซ้ำกับ warehouses-shared.js:8 และ dashboard.html:1630)
- `init()` เรียก `populateWarehouseSelect()` ซ้ำกับที่ `reloadAll` ทำแล้ว (`:709-710`)
