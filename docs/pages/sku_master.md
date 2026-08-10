# sku_master.html — จัดการ SKU Master ต่อคลัง

> ไฟล์: `Html/sku_master.html` (~1,133 บรรทัด: CSS `:1-229`, markup `:230-444` + 2 modal, inline JS `:452-1130`)
> CRUD-lite ตาราง `sku_master` แยกต่อคลัง — เป็นข้อมูลอ้างอิงให้ KPI ในหน้านับและชื่อสินค้าใน reconcile

## หน้าที่และฟีเจอร์

- เลือกคลัง (จำค่าไว้), ช่องค้นหา (กรอง client-side จากชุดที่โหลด), ปุ่ม "โหลดข้อมูลใหม่"
- โหลดทั้งคลังแบบแบ่งหน้า 1000/ครั้ง เข้า `allSkuData` (`:505-549`) แล้ว render ทีละ 50 (`renderTable:733-776`)
- **Import Excel**:
  - auto-detect หัวคอลัมน์ SKU (`SKU`/`รหัสสินค้า`) และชื่อ (`NAME_PRO`/`NAME`/`ชื่อ`/`PRO`/`DESC` — ต้องคนละคอลัมน์กับ SKU) (`:816-830`)
  - normalize SKU ผ่าน `SkuUtils.normalizeSku`
  - preview modal 5 แถวแรก
  - dedupe ในไฟล์ **เก็บแถวสุดท้าย** (`dedupeImportRows:902-913`) ⚠️ ต่างจาก Book import ที่**บวกรวม**
  - guard ข้าม SKU ที่มีซ้ำอยู่แล้วหลายแถวในคลังเดียวกัน (`:1014-1020`)
  - upsert chunk 500 ด้วย `onConflict: 'sku_name,warehouse'` + fallback รายแถวเมื่อเจอ duplicate error (`upsertSkuMasterChunk:945`, `upsertOneSkuMasterRow:917`)
- **Export Excel** ของคลังที่โหลดอยู่ (`:1077-1104`)
- **ลบหลายรายการ**: select-all ต่อหน้า + indeterminate, แถบจำนวนที่เลือก, modal ยืนยันแสดงสูงสุด 12 รายการ, ลบ chunk 200 โดยบังคับ `.eq('warehouse',…)` เสมอ (`:675-715`)
- ปุ่มดาวน์โหลด Template ชี้ URL สาธารณะของ Supabase Storage (hardcode `:290`)

## ตาราง Supabase ที่ใช้

`sku_master` เท่านั้น: SELECT (ต่อคลัง แบ่งหน้า), SELECT lookup (`.in('sku_name')`), UPSERT (`onConflict: sku_name,warehouse`), UPDATE `name_pro` ตาม id, DELETE `.in('id')` + `.eq('warehouse')` — `warehouses` อ่านผ่าน `warehouseService`

## ฟังก์ชันหลัก (inline)

| ฟังก์ชัน | บรรทัด |
|---|---|
| โหลดข้อมูล | 505-549 |
| `filterTable` | 551 |
| ลบหลายรายการ | 675-715 |
| `renderTable` | 733-776 |
| detect หัวคอลัมน์ import | 816-830 |
| `showImportPreview` | 872 |
| `dedupeImportRows` | 902-913 |
| `upsertOneSkuMasterRow` / `upsertSkuMasterChunk` | 917 / 945 |
| ambiguity guard | 1014-1020 |
| `exportToExcel` | 1077-1104 |
| `showToast` | 1121 |

## Shared JS ที่โหลด (`:446-451`)

`api`, `sku-utils`, `warehouses-shared`, `db-errors` (ใช้จริง `:923, 1059, 1068`), `settings-shared`, `sidebar-shared` — **ไม่โหลด `reconcile-shared.js`** (หน้านี้ไม่เกี่ยวกับ cycle)

## localStorage keys

`sku_master_warehouse` (`:480, 490`)

## ความสัมพันธ์กับหน้าอื่น

- **`reconcile.html` เป็นหน้าเดียวที่ใช้** — lookup ชื่อสินค้า (`fetchSkuMasterNamesBySkus`) ตอนสร้างแถว Book ใหม่จาก count_only และมี fallback (`skuNameMap[sku] || null`) อยู่แล้ว
- ⚠️ **`index.html` ไม่ได้ใช้ `sku_master` เลย** — grep คำว่า "master" ใน `index.html` + `Js/script.js` = 0 hit · autocomplete และ KPI ทุกตัวอิง `book_stock_lines` ของรอบที่เลือก (`script.js:358`) · เอกสารเดิมที่บอกว่า KPI "% ใน Master" อิงตารางนี้ **ผิด**
- 🐛 `fetchSkuMasterNamesBySkus` ([reconcile-shared.js:1467](../../Js/reconcile-shared.js:1467)) query ด้วย `.in('sku_name', chunk)` **โดยไม่กรอง `warehouse`** ทั้งที่ตารางแยกต่อคลัง (unique index = `sku_name + warehouse`) → SKU เดียวกันที่มีชื่อต่างกันคนละคลัง จะได้ชื่อจากคลังไหนก็แล้วแต่ลำดับที่ DB คืนมา

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **XSS**: `showImportPreview` interpolate `sku_name`/`name_pro` จาก Excel ไม่ escape (`:872-873`) และ `showToast` ใช้ innerHTML กับข้อความที่มีชื่อ SKU + error ดิบ (`:1121, 1017`) ทั้งที่มี `escapeHtml` (`:464`) ใช้ที่อื่นทั้งหน้า
- คอลัมน์ "อัปเดตล่าสุด" แสดง `created_at` ซึ่ง upsert ไม่เคยแก้ → เป็นเวลาสร้างตลอดไป (`:340, 748`)
- `filterTable` รันทุก keystroke ไม่มี debounce (`:308, 551`)
- ตัวเลือกคลัง hardcode fallback (`:299-301`)
- เป็นหน้าเดียวในกลุ่มนี้ที่ผูก event ด้วย inline `onclick=`/`onchange=` ทั้งหน้า
- `exportToExcel` ตั้งความกว้าง 3 คอลัมน์สำหรับ sheet 4 คอลัมน์ (`:1095-1099`)
- นโยบายแถวซ้ำในไฟล์ (เก็บแถวสุดท้าย) ต่างจาก Book import (บวกรวม) — importer 2 ตัว 2 กติกา
