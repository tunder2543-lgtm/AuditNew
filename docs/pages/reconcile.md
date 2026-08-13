# reconcile.html — Match ยอด (BOOK vs ผลนับ)

> ไฟล์: `Html/reconcile.html` (~2,512 บรรทัด: CSS `:1-394`, markup `:396-630`, inline JS `:639-2510`) + `Js/reconcile-shared.js` (~3,231 บรรทัด — service กลาง `window.reconcileService`)
> เทียบ BOOK (`book_stock_lines`) กับผลนับ (`inventory_counts`) ต่อ SKU ในหนึ่งรอบ แล้วบันทึกส่วนต่าง**ฝั่ง Book เท่านั้น** — ไม่แตะ `inventory_counts` เลย (ตามหลัก immutable evidence)

## ⚠️ "ปรับยอด" ในหน้านี้ = INSERT แถวใหม่ ไม่ใช่เขียนทับยอดเดิม

คำถามที่ admin ถามซ้ำ 2 ครั้ง (2026-08-13): *"ทำไมต้องปรับ Book — เราไม่ควรเพิ่มยอด Adjust แทนหรือ"*
**ระบบทำแบบ Adjust อยู่แล้ว** ป้ายเดิมเขียนว่า "ต้องปรับ Book" จึงทำให้เข้าใจผิดว่าไปแก้ไฟล์ Excel
(เปลี่ยนเป็น **"ส่วนต่างที่ต้องบันทึกปรับ / ไม่แก้ไฟล์ Excel"** แล้ว · มีเทสห้ามคำเดิมกลับมา)

| คอลัมน์ | ใครเขียน | โดนแตะตอนปรับยอดไหม |
|---|---|---|
| `book_stock_lines.book_qty` | import Excel เท่านั้น | ❌ **ไม่เคย** — ยอดต้นฉบับอยู่ถาวร |
| `book_stock_lines.adjusted_book_qty` | RPC `refresh_reconciliation_for_cycle` | ✅ คำนวณใหม่ = `book_qty + SUM(adjustments)` |
| `stock_adjustments` (แถวใหม่) | ปุ่มปรับยอดทุกตัว | ✅ **INSERT อย่างเดียว** — นี่คือ "ยอด Adjust" |
| `inventory_counts` | หน้านับ/นำเข้าเท่านั้น | ❌ ไม่เคย (invariant ข้อ 1) |

ตรวจกับฐานจริงรอบ 2026-08 แล้ว เช่น `BG001` : `book_qty` = **100** (เท่าไฟล์เดิม) · ยอดปรับ +225 · `adjusted_book_qty` = 325

**ทำไมต้องขยับฝั่ง Book:** ฝั่งผลนับล็อกตายตามนโยบาย "นับมายังไงเก็บอย่างนั้น" เมื่อสองฝั่งไม่ตรงกัน
ฝั่งที่ขยับได้จึงเหลือฝั่งเดียว · และเลขส่วนต่างนี้คือ**ผลลัพธ์ที่ต้องเอาไปแก้ในระบบสต็อกต้นทางจริง**
(Book 278 vs ของจริง 197 ⇒ ระบบต้นทางเกินอยู่ 81 ต้องตัดออก 81)

## หน้าที่และฟีเจอร์

| ฟีเจอร์ | ตำแหน่ง |
|---|---|
| เลือกรอบ `#cycleSelect` + deep-link `?cycle=<uuid>` | `:1631-1646` |
| ปุ่ม "คำนวณ Match" → RPC refresh + โหลดใหม่ทั้งหมด | `runRefresh:1648-1706` |
| KPI 6 การ์ด (รอบนับ/ถูกต้อง/ขาด/เกิน/อื่นๆ) คลิกกรองสถานะได้ | `renderKpis:924-958` |
| ตารางหลัก 11 คอลัมน์ (#, SKU, ชื่อ, Excel, ปรับแล้ว, Excel ใช้เทียบ, ผลนับ, ต่าง, %, สถานะ, จัดการ) | `renderTable:960-1019` |
| Filter panel (SKU, ชื่อ, สถานะ) | `:549-577`, `applyTextFilters:759-772` |
| โหมดปรับยอด all/short/over | `setAdjustViewMode:1046-1056` |
| **ปรับยอด Auto** — สร้าง draft ทุก SKU ในโหมดปัจจุบัน | `autoAdjustAll` |
| ~~Draft manual (ปุ่ม "บันทึก Draft")~~ **ถอดออก 2026-08-13** — ซ้ำกับปุ่ม Apply · draft เหลือเฉพาะจาก "ปรับยอด Auto" + flow ยอมรับเป็นชุด | — |
| รายการ draft + ลบรายตัว + **Apply ทั้งหมด** (RPC เดียว) | `renderDraftList`, `applyAllDrafts` |
| **ใช้ยอดที่กรอก (N) เป็นยอดจริง** — ปุ่มกด 2 ครั้ง (armed 8 วิ) · ปรับ Excel ใช้เทียบเป็นยอดที่กรอก · **ถ้ายอดที่กรอกต่างจากผลนับ จะเขียน `reconciliation_match_acceptances` กำกับอัตโนมัติ** | `acceptCountedForLine` |
| **ใช้ยอด Excel (N) เป็นยอดจริง** → `reconciliation_match_acceptances` เท่านั้น ไม่สร้างยอดปรับ | `markLineAsMatchAccepted` |
| **ตัวช่วยเลือกปุ่ม** — ไฮไลต์กรอบแดงปุ่มที่ควรกด · หรี่ปุ่มที่ไม่เกี่ยว (ยังกดได้ ไม่บล็อก) | `resolveAdjButtonGuidance`, `renderAdjActionButtons` |
| **ปุ่ม `?` จำลองผลลัพธ์** — บอกล่วงหน้าว่ากดแล้วยอดจริงจะเป็นเท่าไร ยอดปรับเท่าไร ต้องแก้ระบบต้นทางเท่าไร | `buildActionPreview`, `renderAdjExplain` |

### ชื่อปุ่ม 2 ตัวนี้เปลี่ยนมา 3 รอบ — อย่าเปลี่ยนกลับ

| เดิม | ปัญหาที่เกิดจริง |
|---|---|
| "ยอมรับผลนับ (Apply ทันที)" | อ่านได้ว่าใช้**ผลนับดิบ** ทั้งที่ใช้ค่าในช่อง — admin กลัวยอดที่กรอกไม่ถูกนับ |
| "ยืนยันเป็นถูกต้อง (ไม่ปรับยอด)" | ไม่บอกว่า "ถูกต้อง" หมายถึงเลขไหน — admin เข้าใจกลับด้านว่าปุ่มนี้ยืนยัน**ผลนับ** |
| "ยืนยันว่ายอด Excel ถูกต้อง (ไม่ปรับยอด)" | ยังงง — คำว่า "ยืนยัน...ถูกต้อง" ไม่สื่อว่าเลขไหนจะถูกบันทึกเป็นยอดจริง |

**ชื่อปัจจุบันตั้งใจให้เป็นคู่ขนาน** — ต่างกันแค่คำเดียวคือเลขที่จะถูกใช้ และ**ใส่ตัวเลขจริงลงบนปุ่ม**:
`ใช้ยอด Excel (278) เป็นยอดจริง` · `ใช้ยอดที่กรอก (197) เป็นยอดจริง` — มีเทสห้ามชื่อเก่ากลับมา

### ปุ่มไหนโผล่ตอนไหน — "เหลือปุ่มเดียว" (มติ admin 2026-08-13)

| สถานะ | ปุ่มที่โผล่ | เหตุผล |
|---|---|---|
| ขาด / เกิน | **ใช้ยอดที่กรอก** ปุ่มเดียว | ปุ่ม Excel ซ้ำซ้อน **100%** — พิมพ์เลข Excel ลงช่องแล้วกดปุ่มนี้ จะวิ่งเข้าเส้นทาง `noAdjustment` เขียน acceptance แถวเดียวเหมือนกันเป๊ะ ไม่สร้างยอดปรับ · ทางลัด: ปุ่ม「ใส่ตามยอด Excel」|
| ยังไม่ได้นับ (`book_only`) | **ใช้ยอด Excel** ปุ่มเดียว | ไม่มีผลนับให้ยอมรับ · ปุ่มกรอกไม่โผล่ (`isAdjustable` = short/over เท่านั้น) |
| ถูกต้อง / ยืนยันแล้ว | ไม่โผล่ปุ่มไหน | ปิดเคสแล้ว |

⚠️ **ยังเปิดค้าง:** `book_only` ปิดเคสได้ทางเดียวคือ "เชื่อ Excel" — ถ้าของหมดจริง (ยอดจริง 0)
ทำจากแผงนี้ไม่ได้ ต้องไปนับใส่ที่หน้านับแทน

### ⛔ ตัวช่วยเลือกปุ่มต้องเทียบ `target` กับ **Excel ใช้เทียบ** ไม่ใช่ผลนับ

ข้อเสนอแรก (2026-08-13) คือ "ถ้าค่าในช่อง = ผลนับ ให้หรี่ปุ่มกรอก" — **ใช้ไม่ได้**
เพราะค่าเริ่มต้นของช่องคือผลนับอยู่แล้ว จะกลายเป็นหรี่ปุ่มที่ถูกต้องในเคสปกติที่สุด
(ยอมรับผลนับ) แล้วชี้ไปปุ่ม Excel ซึ่งบันทึก **ยอด Book** เป็นยอดจริง = ผลนับถูกทิ้ง
มีเทส `[guidance] ⛔ เคสค่าเริ่มต้น` บังคับไว้ (mutation พิสูจน์แล้วว่าแดง 5 ข้อ)
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
| `book_stock_lines` (ข้ามรอบ) | SELECT `sku_id,name_pro` (`.in` chunk 100, เรียง `created_at` DESC) — lookup ชื่อสินค้าตอน "สร้างลง Book" · แทนที่ `sku_master` เดิมตั้งแต่ 2026-08-10 |
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
- ~~แถว "ขาด" แสดงเครื่องหมาย `+`; แถวรวมใน export บวก variance คนละเครื่องหมายรวมกัน~~ **แก้แล้ว (M3, 2026-08-11)** — `computeDisplayVariance` คืน "ทิศทาง" (`ผลนับ − Excel ใช้เทียบ`) ทั้งคอลัมน์แล้ว ลบ = ขาด · แถวรวมเป็นยอดสุทธิ + บอก "ขาดรวม/เกินรวม" แยกกัน · ชีต `Adjusted` ใช้ทิศทางเดียวกัน
- ~~`%` ใช้ค่า `variance_pct` เก่าจาก DB ก่อนมี draft~~ **แก้แล้ว (M18, 2026-08-11)** — `formatRowVariancePct` คำนวณใหม่จาก effective ที่รวม draft (สูตรเดียวกับ SQL: ใช้ effective ก่อน ถ้า ≤ 0 ถอยไปใช้ book ถ้าไม่มีคืน `—`)
- ~~`computeMatchStatus` (JS) กับ SQL ให้สถานะไม่ตรงกันกรณี `effective=0 && counted>0`~~ **แก้แล้ว (M2, 2026-08-11)** — ยึดฝั่ง JS (เคสนี้เกิดหลังกด "สร้างลง Book (ยอด 0)" จึงต้องเป็น "เกิน") แล้วแก้ SQL ตามใน `docs/sql/020`
- ~~`parseBookExcelRows` ใช้ `normalizeSku` กับชื่อสินค้า → `name_pro` ถูกแปลงเป็นตัวพิมพ์ใหญ่หมด~~ **แก้แล้ว (M4, 2026-08-10)** — ใช้ `String(...).trim()` เฉพาะคอลัมน์ชื่อ (คอลัมน์ SKU ยัง normalize เหมือนเดิม) · ⚠️ ข้อมูลเก่ายังเป็น ALL CAPS
- `saveDraft` ไม่ normalize SKU จากช่องค้นหา (`:1712-1728`)
- Dead: `renderImportPreview` + `#importPreviewWrap` ไม่เคยแสดง (`:1326-1346, 473-478`), `adjInputMode` ประกาศแล้วไม่อ่าน (`:693`), `updateCycleStatus`/`importBookStockLinesMerge` ใน shared ไม่มีผู้เรียก
- `deleteCycle` unlink + delete เป็น 2 statement — พังกลางทางเหลือรอบค้างกับ count ที่ `cycle_id=null` (`reconcile-shared.js:965-1017`)

## ปุ่ม "Export ยอดจริง" (เพิ่ม 2026-08-11)

ตอบคำถามตอนสรุปยอด: **แต่ละ SKU ต้องเชื่อเลขไหน** — เดิม export บอกแค่ตัวเลขทุกช่องแต่ไม่บอกว่าช่องไหนคือยอดที่ถือเป็นจริง

ชีต `ยอดจริง` — คอลัมน์ `ยอดจริงที่ใช้` + `ที่มาของยอดจริง` + `ผู้ยืนยัน / รายละเอียด` ตัดสินตามความหมายจริงของปุ่มในหน้านี้:

| กรณี | ยอดจริงที่ใช้ | ที่มา |
|---|---|---|
| กด "ยืนยันว่ายอด Excel ถูกต้อง (ไม่ปรับยอด)" — รวมเคส Apply ยอดที่กรอกซึ่งต่างจากผลนับ (ระบบเขียน acceptance ให้) | ยอด Excel ใช้เทียบ | ยืนยันเป็นถูกต้อง — ใช้ยอด Excel (+ ใคร/เมื่อไหร่/หมายเหตุ) |
| ตรงกันหลังปรับยอด (เช่น Apply ยอดที่กรอก = ผลนับ) | ค่าที่เท่ากัน | ตรงกันหลังปรับยอด (+N) + note ของยอดปรับ |
| Book ตรงกับผลนับเอง | ค่าที่เท่ากัน | Book ตรงกับผลนับ |
| ขาด/เกิน/ยังไม่ได้นับ/ไม่พบใน Excel ที่ยังไม่กดอะไร | **ช่องว่าง** | "ยังไม่ตัดสิน — ขาด/เกิน N" ฯลฯ |

- ⚠️ **แถวที่ยังไม่ตัดสิน จงใจเว้นช่องว่าง ไม่เดาแทนคน** (นโยบายข้อ 3) — แถวรวมท้ายตารางนับเฉพาะที่ยืนยันแล้ว และบอกจำนวนที่ค้าง
- draft ที่ยังไม่ Apply ถูกฟ้องใน "ที่มา"
- builder: `buildFinalQtyExportRows()` — เทส `tests/dryrun/final-qty-export.test.mjs` (8 ข้อ รันจริงผ่าน lift)

## ปุ่ม "ยอมรับเกิน (Apply เป็นชุด)" + "ประวัติ / คืนค่า" (เพิ่ม 2026-08-11)

**ยอมรับเกิน/ขาดเป็นชุด** (ปุ่มในแผงปรับยอด ใต้ "ปรับยอด Auto" — โผล่เฉพาะโหมดของตัวเอง):
- ฝั่ง **ขาด** (เพิ่ม 2026-08-11 ค่ำ): โจทย์เดียวกันกลับเครื่องหมาย — เลือกขาด −1 ถึง −เพดาน · ยอดปรับติดลบ (Excel ใช้เทียบลดลงเท่าผลนับ) · โค้ดชุดเดียวกับฝั่งเกิน (`selectRowsForBulkAccept(mode)`) แก้ทีเดียวได้ทั้งคู่
- กำหนดเพดานค่าต่าง (เช่น +10) → ระบบเลือกรายการสถานะ **เกิน** ที่ต่าง +1 ถึง +เพดาน (ข้ามที่ยืนยันแล้ว · `count_only` ไม่เข้าเพราะสถานะไม่ใช่ over)
- แสดงรายการให้ตรวจ + Export Excel ได้ก่อนตัดสิน → ยืนยัน 2 ขั้น → สร้างยอดปรับแบบชุด (`createStockAdjustmentsBatch`) แล้ว `applyAllDraftsForCycle` — refresh ครั้งเดียว ไม่ใช่ทีละ SKU
- ⛔ **มี Draft ค้างอยู่ = บล็อก** — `apply_all_drafts_for_cycle` จะ Apply ทุก draft ของรอบ ถ้าไม่บล็อกจะพ่วง draft ที่ไม่เกี่ยวไปด้วย

**ประวัติ / คืนค่า** (ปุ่มในหัวหน้า ข้าง Export):
- โมดัลแสดงยอดปรับทุกสถานะ + การยืนยันถูกต้อง ของรอบ (ดึงสดจาก DB) เรียงใหม่ → เก่า
- ติ๊กเลือก → "คืนค่าที่เลือก" → ยืนยัน 2 ขั้น → `clearAdjustmentsAndMatchAcceptancesForSkus` (H6 — เขียน `RECONCILE_ADJ_CLEAR` ก่อนลบเสมอ) → `runRefresh()` เต็ม
- **คืนค่า = ต่อ SKU ทั้งการตัดสิน** (ยอดปรับ + การยืนยัน ของ SKU นั้นในรอบนี้) — ผลนับไม่ถูกแตะ
- เทส: `tests/dryrun/bulk-accept-over.test.mjs` (11 ข้อ รันจริงผ่าน lift)
