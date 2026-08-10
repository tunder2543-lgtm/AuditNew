# reconcile.html — Match ยอด (BOOK vs ผลนับ)

> ไฟล์: `Html/reconcile.html` (~2,512 บรรทัด: CSS `:1-394`, markup `:396-630`, inline JS `:639-2510`) + `Js/reconcile-shared.js` (~3,231 บรรทัด — service กลาง `window.reconcileService`)
> เทียบ BOOK (`book_stock_lines`) กับผลนับ (`inventory_counts`) ต่อ SKU ในหนึ่งรอบ แล้วปรับยอด**ฝั่ง Book เท่านั้น** — ไม่แตะ `inventory_counts` เลย (ตามหลัก immutable evidence)

## หน้าที่และฟีเจอร์

| ฟีเจอร์ | ตำแหน่ง |
|---|---|
| เลือกรอบ `#cycleSelect` + deep-link `?cycle=<uuid>` | `:1631-1646` |
| ปุ่ม "คำนวณ Match" → RPC refresh + โหลดใหม่ทั้งหมด | `runRefresh:1648-1706` |
| KPI 6 การ์ด (รอบนับ/ถูกต้อง/ขาด/เกิน/อื่นๆ) คลิกกรองสถานะได้ | `renderKpis:924-958` |
| ตารางหลัก 11 คอลัมน์ (#, SKU, ชื่อ, Excel, ปรับแล้ว, Excel ใช้เทียบ, ผลนับ, ต่าง, %, สถานะ, จัดการ) | `renderTable:960-1019` |
| Filter panel (SKU, ชื่อ, สถานะ) | `:549-577`, `applyTextFilters:759-772` |
| โหมดปรับยอด all/short/over | `setAdjustViewMode:1046-1056` |
| **ปรับยอด Auto** — สร้าง draft ทุก SKU ในโหมดปัจจุบัน | `autoAdjustAll:1765-1834` |
| Draft manual: autocomplete SKU + กรอกจำนวนเป้าหมาย → คำนวณ delta | `saveDraft:1708-1763` |
| รายการ draft + ลบรายตัว + **Apply ทั้งหมด** (RPC เดียว) | `renderDraftList:1598`, `applyAllDrafts:2311` |
| **ยอมรับผลนับ (Apply ทันที)** — ปุ่มกด 2 ครั้ง (armed 8 วิ) | `acceptCountedForLine:2065-2244` |
| **ยืนยันเป็นถูกต้อง (ไม่ปรับยอด)** → `reconciliation_match_acceptances` | `markLineAsMatchAccepted:1850-1922` |
| **สร้างลง Book** (เดี่ยว + bulk) สำหรับ `count_only` ที่ qty 0 | `addBookLine:1928`, `bulkAddBookLines:1983` |
| **ลบรายการ Book** ต่อ SKU (ลบ adjustment ของ SKU นั้นด้วย) | `deleteBookLine:2246-2309` |
| **Import Excel → Auto Apply** pipeline + progress bar | `parseImportFile:1368`, `runImportApply:1428-1555` |
| Export Excel (แถวที่มองเห็น + แถวรวม; แถม sheet `Adjusted` หลัง import) | `:2437-2490` |
| ยืนยัน 2 ขั้นทุก action ผ่าน `uiConfirm.twoStep` | `Js/ui-confirm-modal.js` |
| กันกดซ้ำ `runOnce(key, fn)` + `inFlightActions` | `:723-735` |

## ตาราง Supabase ที่ใช้ (ทั้งหมดผ่าน `reconcileService`)

| ตาราง / RPC | Operations |
|---|---|
| `count_cycles` | SELECT (list, by id) |
| `reconciliation_lines` | SELECT แบ่งหน้า 1000 (cache ผล match — สร้างโดย RPC) |
| `book_stock_lines` | SELECT names/ids; INSERT (qty 0); DELETE ตาม SKU; INSERT ผ่าน import |
| `inventory_counts` | **SELECT `sku_id` อย่างเดียว** (presence map) — ไม่มี UPDATE/DELETE |
| `stock_adjustments` | SELECT; INSERT draft; DELETE draft; DELETE ตามชุด SKU |
| `reconciliation_match_acceptances` | SELECT, UPSERT (`onConflict: cycle_id,sku_id`), DELETE |
| `sku_master` | SELECT `sku_name,name_pro` (`.in` chunk 200) |
| RPC `refresh_reconciliation_for_cycle` | คำนวณ match ใหม่ทั้งรอบ |
| RPC `apply_stock_adjustment` / `apply_all_drafts_for_cycle` | apply draft |
| RPC `import_book_stock_lines_atomic` | import Book แบบ atomic (fallback legacy ถ้าไม่มี) |

## Js/reconcile-shared.js — กลุ่มฟังก์ชัน

| กลุ่ม | บรรทัด | หมายเหตุ |
|---|---|---|
| ค่าคงที่ / SKU utils | 13-81 | `ACTIVE_CYCLE_KEY`, `ALL_WAREHOUSES='คลังทั้งหมด'`, คั่น multi-warehouse ด้วย `\|` |
| encode/parse คลัง | 103-261 | รอบหลายคลังเก็บเป็น `"A\|B"` ใน TEXT คอลัมน์เดียว |
| เวลา Bangkok +07 | 265-467 | `yearMonthToRangeISO`, `buildCycleTimestamps` ฯลฯ |
| active cycle (localStorage) | 471-557 | `getActiveCycle`/`setActiveCycle`/`attachCycleToPayload` |
| CRUD รอบ | 561-1017 | `fetchCycles`, `createCycle`, `deleteCycle` ฯลฯ |
| parse/import Book Excel | 1025-1936 | `parseBookExcelRows`, `importBookStockLines` |
| ผูกผลนับเข้ารอบ | 1564-1778 | `linkInventoryCountsToCycle` — ตั้งเฉพาะ `cycle_id` |
| อ่านผล reconcile | 1944-2400 | `fetchReconciliationLines`, `fetchCycleSummary` ฯลฯ |
| Adjustments | 2404-2977 | create/apply/apply-all/delete |
| Match acceptances | 2621-2700 | ยืนยันเป็นถูกต้องโดยไม่ปรับยอด |

## Shared JS ที่โหลด (`:632-638`)

`sidebar-shared.js`, `api.js`, `sku-utils.js`, `settings-shared.js`, `reconcile-shared.js`, `ui-confirm-modal.js` (ทุกไฟล์มี `?v=` แล้ว · ถอด `db-errors.js` ออก 2026-08-10 — ไม่มีการเรียกใช้) — **ไม่โหลด `warehouses-shared.js`**

## Storage keys

- `localStorage: active_count_cycle_v1` — หน้านี้**ไม่ตั้งค่าเอง** ใช้ dropdown ของตัวเอง
- `sessionStorage: recon_import_accept_v1_<cycleId>` — cache SKU ที่ถูก accept หลัง import Excel (`:656-691`)

## ความสัมพันธ์กับหน้าอื่น

- ต้องการให้ `cycle_config.html` (1) สร้างรอบ (2) อัปโหลด Book (3) ผูกผลนับเข้ารอบก่อน — ถ้าข้าม (3) ทุกอย่างขึ้น `book_only`/`count_only` เพราะ RPC กรอง `inventory_counts` ตาม `cycle_id` เท่านั้น
- `dashboard.html` อ่าน `v_cycle_reconciliation_summary` + `reconciliation_lines` ที่หน้านี้สั่ง refresh
- deep-link มาจาก `cycle_config.html` ผ่าน `?cycle=<id>`

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- ~~`#cycleSelect` ไม่มี change listener~~ **แก้แล้ว (H5, 2026-08-09)** — เปลี่ยนรอบ = ล้างสถานะ + ซ่อน panel ทันที แล้วโหลดรอบใหม่ให้ · ทุก action ล็อก cycle id ตอน guard และเช็คซ้ำหลัง confirm modal · dropdown ถูกล็อกระหว่างโหลด
- **Import Excel ทำให้ทุก SKU "ถูกต้อง" โดยไม่สนผลนับ**: import Book ก่อนแล้วค่อยคำนวณ adjustment → delta=0 เสมอ สถานะเปลี่ยนเพราะ force-accept ทุก SKU ในไฟล์ (`:1479-1498`, `reconcile-shared.js:2858`)
- **Import ลบ adjustment ที่ applied แล้ว** — `clearAdjustmentsAndMatchAcceptancesForSkus` delete โดยไม่กรอง status ทำลายประวัติ (`reconcile-shared.js:2712-2717`)
- แถว "ขาด" แสดงเครื่องหมาย `+` (เช่น ขาด 5 แสดง `+5` สีแดง) (`:867, 974`); แถวรวมใน export บวก variance คนละเครื่องหมายรวมกัน (`:2447`)
- `%` ใช้ค่า `variance_pct` เก่าจาก DB ก่อนมี draft — ขัดกับคอลัมน์ `ต่าง` ที่คำนวณใหม่ (`:895`)
- `computeMatchStatus` (JS) กับ SQL ให้สถานะไม่ตรงกันกรณี `effective=0 && counted>0` (JS=`over`, SQL=`count_only`)
- `parseBookExcelRows` ใช้ `normalizeSku` กับชื่อสินค้า → `name_pro` ถูกแปลงเป็นตัวพิมพ์ใหญ่หมด (`reconcile-shared.js:1108`)
- `saveDraft` ไม่ normalize SKU จากช่องค้นหา (`:1712-1728`)
- Dead: `renderImportPreview` + `#importPreviewWrap` ไม่เคยแสดง (`:1326-1346, 473-478`), `adjInputMode` ประกาศแล้วไม่อ่าน (`:693`), `updateCycleStatus`/`importBookStockLinesMerge` ใน shared ไม่มีผู้เรียก
- `deleteCycle` unlink + delete เป็น 2 statement — พังกลางทางเหลือรอบค้างกับ count ที่ `cycle_id=null` (`reconcile-shared.js:965-1017`)
