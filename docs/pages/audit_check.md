# audit_check.html — ตรวจสอบคุณภาพข้อมูลผลนับ

> ไฟล์: `Html/audit_check.html` (~4,167 บรรทัด: CSS ~870 + markup ~300 + **inline script ~2,968 บรรทัด** `:1197-4165`)
> หน้าแบบตาราง Google-Sheets สำหรับตรวจ/แก้/ลบข้อมูล `inventory_counts` — **ไฟล์ที่มีความเสี่ยงสูงสุดในระบบ** เพราะแก้และลบข้อมูลจำนวนมากได้โดยไม่เขียน audit log

## หน้าที่และฟีเจอร์

### Scope bar (`:979-999`)
คลัง · เดือน (เฉพาะเดือนที่มีข้อมูล) · checkbox "ทุกช่วงเวลา" — เปลี่ยนค่าแล้ว auto รัน pipeline `runFullAuditLoad` (`:4023`): โหลด reference → เติมตาราง → verify ทุกแถว

### ตาราง (grid) (`:1052-1078`, `createRow:2990`)
คอลัมน์: checkbox / # / SKU / Location / จำนวน / คลัง (read-only) / วันเวลา (read-only) / สถานะ / หมายเหตุ
- นำทางด้วย Enter/Tab, verify เมื่อ blur, **paste TSV จาก Excel ได้** (`:4069` — ลำดับ SKU, Loc, Qty ⚠️ สลับกับไฟล์ import ที่เป็น Loc, SKU, Qty)
- เริ่ม 25 แถว ขยายอัตโนมัติ

### เครื่องยนต์ verify (`verifyRow:2249`)
เทียบแต่ละแถวกับ reference map ที่สร้างจาก `inventory_counts` ใน scope เดียวกัน:
- `ok` — ตรงทั้ง sku+loc+warehouse+qty
- `error` — ข้อมูลขาด / **ซ้ำในรอบนับเดียวกัน** / จำนวนไม่ตรง / ไม่พบ SKU / ผิดทั้ง loc+qty / กำกวมข้ามคลัง
- `warn` — จำนวนตรงแต่ location ไม่ตรง พร้อม**รายการแนะนำจัดอันดับ** (`buildSuggestions:2223`, `locationSimilarity:2202` — คะแนน 45 จาก qty + 35 จากความคล้าย loc)

> **"ซ้ำในรอบเดียวกัน" (H10, 2026-08-09)** — `classifyCycleDuplicate` ใน [`Js/audit-dedupe.js`](../../Js/audit-dedupe.js):
> ถ้า **รอบนับ + คลัง + SKU + ตำแหน่ง + จำนวน** เหมือนกันหมด → ขึ้น `error` เสมอ ไม่สนว่าใครนับหรือห่างกันกี่ชั่วโมง
> เพราะ `refresh_reconciliation_for_cycle` ใช้ `SUM(counted_qty)` ต่อ SKU ต่อรอบ → ยอดถูกบวกซ้ำใน Match
> ทำเครื่องหมายเฉพาะ **แถวส่วนเกิน** (แถวเก่าสุดของกลุ่ม = `ok`) → 2 แถวซ้ำนับเป็นผิดพลาด 1 · 3 แถวนับเป็น 2
> คนละรอบนับ = ไม่ซ้ำ (Match แยกรอบกัน) · จำนวนต่างกันที่ตำแหน่งเดียวกัน = ทยอยนับ ไม่ใช่ซ้ำ
> **เตือนอย่างเดียว ไม่ลบให้เอง** — การลบต้องกดปุ่มเอง (โหมด 4 ข้างล่าง ใช้เกณฑ์เดียวกันนี้ตั้งแต่ H12)
> หมายเหตุบอก **ชี้ตัวคู่ที่ซ้ำ** ด้วย (`siblings` → `describeDuplicatePartners`): `ซ้ำกับ แถว #443 (8/8/69 10:11 · ผู้นับ แบม)`
> แถวหลักก็บอกกลับด้วยว่ามีอีกกี่แถวและแถวไหน — ผู้ใช้กระโดดไปตรวจตัวจริงได้ทันที
> **กรอง "ผิดพลาด" จะลากแถวต้นฉบับมาแสดงด้วย** (`dupPartner` → `data-dup-partner` → `applyTableView`)
> เห็นทั้งกลุ่มคู่กันเสมอ (PC700 ซ้ำ 2 แถว = เห็น 2 แถว) แต่ตัวเลข "ผิดพลาด" ยังนับแค่แถวส่วนเกิน
> แถวต้นฉบับมีขีดซ้ายสีแดงจาง (`.row-dup-partner`) แยกจากแถวแดงจริง

> ## ⛔ นโยบายหลักของหน้านี้ (admin 2026-08-10)
> **ระบบไม่ลบและไม่แก้จำนวนเอง — "นับมายังไงเก็บอย่างนั้น"** หน้าที่คือ *ชี้รายการผิดปกติ แล้วให้คนมายืนยันว่าปกติหรือไม่*
> - **หลายแถวที่ตำแหน่งเดียวกัน จำนวนต่างกัน = ปกติ** (สินค้าเยอะ แบ่งใส่หลายถุง พนักงานนับทีละถุง) → เตือนให้ดูเฉย ๆ ห้ามแนะนำให้ลบ
> - **ค่าเหมือนกันครบทุกช่อง = ซ้ำจริง** → ลบได้เฉพาะผ่านปุ่ม (ยืนยัน 2 ขั้น + CSV + log)
> - **คนกด "ยืนยันว่าปกติ" แล้ว ระบบต้องเงียบ** และปุ่มลบต้องไม่แตะกลุ่มนั้นด้วย

> **`overlap` — "ตำแหน่งเดียวกันหลายแถว" (H11, 2026-08-10)** — [`Js/audit-book-impact.js`](../../Js/audit-book-impact.js) `computeSkuImpact`:
> SKU + ตำแหน่งเดียวกัน มีหลายแถว **จำนวนต่างกัน** → ส้มทุกแถวในกลุ่ม (ยังไม่รู้ว่าแถวไหนผิด ต้องให้คนเทียบ)
> เพราะ `SUM(counted_qty)` ต่อ SKU ต่อรอบ บวกรวมทุกแถวเสมอ — ถูกก็ได้ (ทยอยนับทีละกล่อง) ผิดก็ได้ (คีย์ผิดแล้วคีย์ใหม่)
> หน้านี้จึงโหลด **`reconciliation_lines`** ของรอบที่เกี่ยวข้องมาเทียบ (`fetchReconciliationLines` → `recLineByCycleSku` → `buildImpactMap`)
> หมายเหตุบอก: ซ้ำกับแถวไหน (เลขแถว + จำนวน + เวลา + ผู้นับ) · `Match รวม = X · Book Y · เกิน/ขาด Z` · แล้วชวนให้กด "ยืนยันว่าปกติ"
> **ห้ามแนะนำให้ลบ** — โมดูลไม่มี `fixHints` แล้ว (มีเทสบังคับว่าต้องเป็น `undefined`)
> รอบที่ยังไม่ได้กด "คำนวณ Match" จะไม่มี `reconciliation_lines` → บอกตรง ๆ ว่ายังเทียบไม่ได้ ไม่เดายอด Book

### ยืนยันว่าปกติ (`acceptSelectedAsNormal` · [`docs/sql/019`](../sql/019_inventory_count_acceptances.sql))
ติ๊กแถวที่ระบบเตือน → กด **"ยืนยันว่าปกติ"** → upsert ลง `inventory_count_acceptances` ตาม key **(รอบ, SKU, ตำแหน่ง)**
- **ไม่แตะ `inventory_counts` เลย** — เก็บแค่ว่าใครตรวจแล้วบอกว่ากลุ่มนี้ปกติ
- เก็บ `row_count` + `total_qty` ณ เวลาที่ยืนยันไว้ด้วย → `classifyAcceptance` เทียบกับของปัจจุบัน
  - เท่ากัน = `accepted` → แถวขึ้นเขียว "ยืนยันแล้วว่าปกติ โดย … เมื่อ …" **และปุ่มลบจะข้ามกลุ่มนี้**
  - ต่างกัน = `stale` → กลับมาเตือน "ข้อมูลเปลี่ยนหลังยืนยัน" พร้อมบอกว่าตอนยืนยันเป็นเท่าไหร่
- ⚠️ unique index ของ 019 เป็นแบบ expression → **ห้ามใช้ `.upsert({onConflict})`** (Postgres 42P10) โค้ดแยก `insert` ของใหม่ + `update .eq('id')` ของเดิมเอง
- ถ้าตารางยังไม่ถูกสร้าง → ปิดฟีเจอร์อย่างสุภาพ ส่วนอื่นของหน้าทำงานปกติ

### แถบสรุป (`updateImpactBar` / `computeImpactSummary`)
นับเป็น **กลุ่ม** ไม่ใช่ "ผิดกี่ชิ้น" (ระบบตัดสินแทนคนไม่ได้): ทั้งหมดกี่กลุ่ม · รอตรวจกี่กลุ่ม (ในนั้นยอดไม่ตรง Book กี่กลุ่ม / ยังไม่คำนวณ Match กี่กลุ่ม) · ยืนยันแล้วกี่กลุ่ม · ข้อมูลเปลี่ยนหลังยืนยันกี่กลุ่ม

ปุ่ม "ดูเฉพาะรายการนี้" = ฟิลเตอร์ `impact` — แสดง **ทุกแถวที่อยู่ในกลุ่มทับซ้อน** ไม่ว่าสถานะจะแดง/ส้ม/เขียว

### ประวัติการแก้ไข/ลบ (`loadAuditHistory`)
ปุ่มเปิด modal อ่าน `inventory_audit_logs` (500 รายการล่าสุด) — วันเวลา · ประเภท · SKU · ตำแหน่ง/รายละเอียด · จำนวน · คลัง · ผู้ทำ
กรองตามประเภท/SKU ได้ · ส่งออก Excel ได้ · แถวที่เป็นการลบขึ้นพื้นแดงจาง

### ฟิลเตอร์/เรียง
กรองตามโซน (อักษรแรกของ location), natural sort location พร้อมทิศทางอัตโนมัติ (`autoSortDirectionForZone:1440`), คลิกกล่องสถิติสถานะเพื่อกรอง (`toggleStatusFilter:1821`)

### โหมดแก้ไข 4 โหมด
1. **แก้ Location** (`setEditLocationMode:2831`): ล็อก SKU+qty แก้เฉพาะ location, ยืนยัน 2 ขั้น, `update` ทีละแถว
2. **สลับ SKU ↔ Location** (`applySwapSkuLocSelected:2700`): สำหรับแถวที่กรอกสลับช่อง, `update({sku_id, location})` ทีละแถว
3. **เทียบ Location กับ Excel** (modal เต็มจอ): โหลด template จาก Supabase Storage → อัปโหลด A=SKU, B=Location → **เลือกคลังในโมดัล** + เลือกโซน → [`Js/audit-loc-compare.js`](../../Js/audit-loc-compare.js) `buildLocComparePlan` แยกเป็น ไม่ตรง/ตรงอยู่แล้ว/ไม่มีในระบบ/กำกวมใน DB/**ข้อมูลไม่ครบ** → review → apply 2 ขั้น → export แถวที่ข้าม
   > **เลือกคลังได้ทีละคลัง** (Excel ไม่มีคอลัมน์คลัง จึงบอกไม่ได้ว่าตำแหน่งเป็นของคลังไหน) · ตอนกด "เทียบข้อมูล" ระบบ **ซิงก์คลังกลับไปที่แถบด้านบน** แล้วโหลด `loadReferenceData()` + `loadCountsToTable()` + `verifyAll()` เองก่อนเสมอ — เพราะ `getDestinationCollision` ตัดสินจาก `refBySkuLoc` และ `getWarehouseForRecordId()` ตัดสินจากแถวในตาราง ถ้าสองอย่างนี้เป็นคนละคลังกันจะ "ตาบอด" แล้วปล่อยผ่านหมด
   > **🐛 บั๊กที่เคยทำให้โหมดนี้ใช้ไม่ได้เลย (แก้ 2026-08-10):** `runLocCompare` SELECT มาโดยไม่มี `counted_qty` → แผนเก็บเป็น `''` → `resolveDestQty` คืน NaN → `getDestinationCollision` บล็อก **ทุกแถว 100%** ด้วยข้อความ "จำนวนปลายทางไม่ถูกต้อง" ผู้ใช้เห็นแค่ "ไม่บันทึก — ปลายทางซ้ำทั้งหมด N รายการ"
   > ตอนนี้แถวที่ข้อมูลไม่ครบไปอยู่ใน `missingQty` — โผล่เป็น chip ที่ 5, ในกล่อง "รายการที่ไม่อัปเดตอัตโนมัติ" และในไฟล์ Excel export (ไม่ใช่แค่ toast ที่หายไปใน 4 วินาที)
   > **กติกาที่ code-review บังคับไว้ (มียามสแกน source `unit/audit-select-columns` พิสูจน์ด้วย mutation แล้วทั้ง 4 ข้อ):**
   > - SELECT ต้องมี `counted_qty` + `cycle_id`
   > - `populateLocCompareWarehouses` ต้องใส่ placeholder กลับและบังคับค่าเอง — `warehouseService.populateSelect` เลือกคลังแรกให้อัตโนมัติ ทำให้ guard "ต้องเลือกคลัง" ไม่เคยทำงานและ default เป็นคลังที่ผู้ใช้ไม่ได้เลือก (= แก้ผิดคลังทั้งชุด)
   > - หลังสลับคลังต้องเรียก `loadReferenceData()` **ตรง ๆ** ห้ามพึ่ง `onAuditWarehouseChange()` → `runFullAuditLoad()` ซึ่ง early-return ได้ (`autoRunInFlight` / โหมดแก้ตำแหน่ง) แล้ว `refBySkuLoc` ค้างเป็นคลังเดิม = guard ชนปลายทางตาบอด ปล่อยผ่านทุกแถว
   > - ต้องผ่านด่านตรวจให้ครบ (เดือน / ทุกช่วงเวลา / SKU ซ้ำในไฟล์) **ก่อน** จะไปแตะ scope ของหน้า ไม่งั้นผู้ใช้กดยกเลิกแล้วหน้ายังเปลี่ยนคลังค้างไว้ · ถ้าเดือนถูกสลับอัตโนมัติต้องเตือน
   > - ห้ามเทียบตำแหน่งระหว่างเปิดโหมดแก้ตำแหน่ง/สลับ SKU
4. **ลบแถวที่กดบันทึกซ้ำ** (`dedupeInventoryCountsInDb`): ใช้ `findSameCycleDuplicates` จาก [`Js/audit-dedupe.js`](../../Js/audit-dedupe.js) — ซ้ำ = **รอบนับ + คลัง + SKU + ตำแหน่ง + จำนวน เหมือนกันครบ** (ไม่สนผู้นับ/เวลา) เก็บแถวเก่าสุดของกลุ่มไว้เสมอ · **ข้ามกลุ่มที่กด "ยืนยันว่าปกติ" ไว้แล้ว** · ยืนยัน 2 ขั้น (ขั้น 2 ลิสต์ SKU/ตำแหน่ง/จำนวน/เวลา/ผู้นับ ของทุกแถวที่จะลบ) · สำรอง CSV อัตโนมัติก่อนลบ (ยกเลิกถ้าสำรองไม่ได้) · เขียน `inventory_audit_logs` ก่อนลบ แล้วลบเป็น chunk ละ 100
   > แก้ที่ H12 (2026-08-10) — เกณฑ์เดิม (ผู้นับคนเดียวกัน + ห่างไม่เกิน 10 นาที) ทำให้เคสจริงอย่าง `PC700 @ G3-03 = 192` (คนละผู้นับ ข้ามวัน) ไม่เคยถูกเลือกเลย · `findAccidentalDuplicates` ยังอยู่แต่ไม่ใช่ตัวตัดสินการลบแล้ว
   > แก้ในข้อ H2 (2026-08-09) — เดิม group แค่ `warehouse|sku|location|qty` ซึ่งจะลบข้อมูลนับที่ถูกต้อง 470 แถวจากข้อมูลจริง

### ลบแถวที่เลือก (`deleteSelectedRows:2489`)
ลบผสมแถวใน DB + แถว local, ยืนยัน 2 ขั้น, `.in('id',…)` chunk

### Guard กันชนปลายทาง (ใช้ร่วมโหมด 1-3)
`getDestinationCollision:2017` / `validateDestUpdateBatch:2083` / `confirmDestUpdatesWithSkips:2123` — แยก batch เป็นทำได้/ถูกบล็อก แล้วถามว่าจะข้ามไหม

## ตาราง Supabase ที่ใช้

| ตาราง / RPC | Operation | รายละเอียด |
|---|---|---|
| `rpc('get_inventory_count_months')` | CALL | รายการเดือน; fallback สแกนทั้งตารางถ้าไม่มีฟังก์ชัน (`:1515-1553`) |
| `inventory_counts` | SELECT | `fetchAllInventoryCounts:1704` แบ่งหน้า 1000, กรอง warehouse + ช่วง created_at |
| `inventory_counts` | UPDATE | `{location}` (`:2945, 3722`), `{sku_id, location}` (`:2778`) — ทีละแถว |
| `inventory_counts` | DELETE | `.in('id', chunk)` ละ 100 (`:2481, 3938`) |
| `warehouses` | SELECT | `warehouseService.populateSelect` (`:1666`) |
| `reconciliation_lines` | SELECT | `fetchReconciliationLines` — ผล Match ของรอบที่เกี่ยวข้อง ไว้เทียบ Book (H11) |
| `inventory_count_acceptances` | SELECT / UPSERT | "ยืนยันว่าปกติ" — ต้องรัน [019](../sql/019_inventory_count_acceptances.sql) ก่อน |
| `inventory_audit_logs` | SELECT | หน้าประวัติการแก้ไข/ลบ (500 รายการล่าสุด) |
| Supabase Storage | GET | `TemplateMATH.xlsx` URL สาธารณะ hardcode (`:3155`) |

✅ **เขียน `inventory_audit_logs` ครบทุก mutation แล้ว** (H3, 2026-08-09) ผ่าน [`Js/audit-log.js`](../../Js/audit-log.js) — action: `AUDIT_EDIT_LOC` / `AUDIT_SWAP` / `AUDIT_LOC_COMPARE` / `AUDIT_DELETE` / `AUDIT_DEDUPE`
> ลบ = เขียน log ก่อน (ไม่สำเร็จ = ไม่ลบ) · แก้ = flush log ทุก 100 แถวระหว่าง loop · ดูประวัติได้ที่ปุ่ม **"ประวัติการแก้ไข/ลบ"** ในหน้านี้ (H12) หรือ drawer ในหน้า index

## ฟังก์ชันหลัก

| ฟังก์ชัน | บรรทัด |
|---|---|
| `refEntryKey` / `findRefEntriesBySkuLocQty` | 1222 / 1229 |
| `fetchAvailableMonths` / `getAuditFilters` | 1514 / 1602 |
| `fetchAllInventoryCounts` | 1704 |
| `applyTableView` / `verifyRowsInBatches` | 1834 / 1946 |
| `getDestinationCollision` / `validateDestUpdateBatch` | 2017 / 2083 |
| `loadReferenceData` / `buildSuggestions` / `verifyRow` | 2145 / 2223 / 2249 |
| `deleteSelectedRows` | 2489 |
| `applySwapSkuLocSelected` | 2700 |
| `setEditLocationMode` / `saveLocationChanges` | 2831 / 2873 |
| `createRow` / `fillRows` | 2990 / 3068 |
| `buildLocComparePlan` / `applyLocCompareUpdates` | 3305 / 3626 |
| `dedupeInventoryCountsInDb` | 3854 |
| `loadCountsToTable` / `runFullAuditLoad` | 3960 / 4023 |

## Shared JS ที่โหลด (`:1190-1196`)

`sidebar-shared.js` (มาก่อน api.js — ต่างจากหน้าอื่น), `api.js`, `sku-utils.js`, `warehouses-shared.js`, `db-errors.js`, `settings-shared.js`, `ui-confirm-modal.js`, **`audit-dedupe.js`** (เพิ่มตอนแก้ H2), **`audit-book-impact.js`** (เพิ่มตอนแก้ H11) — ยังไม่โหลด `reconcile-shared.js` แต่ตอนนี้ดึง `cycle_id` มาใช้ตัดสิน "แถวซ้ำ" และอ่าน `reconciliation_lines` มาเทียบ Book แล้ว

## localStorage keys

`audit_check_year_month` (อ่าน/เขียน), `audit_check_all_time` (อ่าน/เขียน), `audit_check_warehouse` (**เขียนอย่างเดียว ไม่เคยอ่าน** — `:1649, 1674`)

## ความสัมพันธ์กับหน้าอื่น

- อ่าน+แก้+ลบข้อมูลที่ index.html / import_counts.html เขียน
- **ไม่รู้จัก cycle**: scope ตามคลัง+เดือนปฏิทินเท่านั้น — รอบที่คร่อมเดือนถูกผ่าครึ่ง, สองรอบในเดือนเดียวถูกรวม, การนับซ้ำข้ามรอบถูกมองเป็น "ข้อมูลซ้ำ"

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- ~~โหมด "ลบ duplicate" ขัดนโยบาย DB~~ **แก้แล้ว (H2, 2026-08-09)** — ดูเกณฑ์ใหม่ในหัวข้อโหมด 4 ข้างบน
- **Bulk mutation ไม่ log, ไม่ atomic**: loop `update` ทีละแถว พังกลางทางค้างครึ่ง ๆ ไม่มี rollback (`:2769-2795, 2938-2960, 3717-3736`)
- **XSS ใน note/suggestion**: `noteTd.innerHTML = result.note` โดย note สร้างจากค่า DB ไม่ escape (`:2291-2329, 2367`) ทั้งที่มี `escapeHtml` (`:1320`) ใช้ใน modal เทียบ Excel
- โหมดสลับ SKU↔Loc normalize ฝั่งเดียว — สลับสองครั้งไม่ได้ค่าเดิมกลับ (`:2742-2778`)
- Reference map จำกัด scope ปัจจุบัน → guard ชนปลายทางมองไม่เห็นข้อมูลนอก scope (`:2117-2145`)
- ประสิทธิภาพ: `findRefEntriesBySkuLocQty` O(n) ใน loop (`:1229, 2273`), `getWarehouseForRecordId` O(n·m) (`:2003-2011`)
- Dead code: `verifyAll` (`:2401-2430` — ปุ่มไม่มีใน markup), `btnLoadCounts`, `initConnectionBadge` (ไม่มีนิยามที่ไหนเลย), `btnAddRows` ซ่อนอยู่
