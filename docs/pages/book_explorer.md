# book_explorer.html — ดูข้อมูล BOOK (อ่านอย่างเดียว)

> ไฟล์: `Html/book_explorer.html` (~820 บรรทัด: CSS `:1-111`, markup `:113-218`, IIFE เดียว `:224-817`)
> หน้าอ่านอย่างเดียวสำหรับ browse `book_stock_lines` — **ไม่มีการเขียน DB เลย**

## หน้าที่และฟีเจอร์

- **เลือกแบบขั้นบันได ปี → เดือน → รอบ** สร้างจากรอบที่มีข้อมูล Book จริง (`refreshYearSelect:355`, `refreshMonthSelect:371`, `refreshCycleSelect:397`, auto-select เมื่อมีรอบเดียว `:424-436`)
- ฟิลเตอร์: สถานะ qty (`ทั้งหมด` / `>0` / `=0`), คำค้นอิสระ ilike ครอบ `sku_id | location | name_pro` พร้อม escape `%`/`_` (`escapedLike:453`), ขนาดหน้า 500/1000/**ทั้งหมด**
- KPI 4 ช่อง: จำนวนแถวทั้งหมด (exact count จาก server) / SKU ไม่ซ้ำ / ผลรวม qty / ล่าสุด (**เฉพาะหน้าที่แสดง** — `:636-650`)
- เรียงคอลัมน์ได้ (`sku_id`, `name_pro`, `location`, `book_qty`, `created_at`) มี whitelist (`:557`), แบ่งหน้า server-side, banner เตือน/error, overlay loading

## ตาราง Supabase ที่ใช้ (อ่านอย่างเดียว)

| Query | รายละเอียด |
|---|---|
| `count_cycles` | SELECT 9 คอลัมน์ `.limit(500)` (`:476-481`) |
| `book_stock_lines` | SELECT 7 คอลัมน์ + `{count:'exact'}`, `.in('cycle_id',…)`, filters, sort, `.range()` (`:587-624`) |
| `book_stock_lines` | สแกน `cycle_id` ทีละ 1000 ทั้งตาราง ใน `fetchCycleIdsWithBookLines` (`:510-529`) — ใช้เฉพาะเมื่อไม่มีรอบไหนตั้ง `book_imported_at` |

## Shared JS ที่โหลด (`:220-222`)

แค่ 3 ไฟล์: `api.js`, `reconcile-shared.js`, `sidebar-shared.js` — เป็นหน้าที่โหลด shared น้อยที่สุด (ไม่มี settings-shared → ไม่มี connection badge, ไม่มี db-errors → error เป็นภาษาอังกฤษดิบ) ใช้ helper จาก `reconcileService` แค่ `formatWarehouseDisplay`, `formatCycleLabel`, `statusLabel` (มี guard `?.` ครบ) ที่เหลือเขียน util เอง

## localStorage keys

**ไม่มีเลย** — ไม่จำสถานะใด ๆ

## ความสัมพันธ์กับหน้าอื่น

- อ่าน Book ที่ `cycle_config.html` อัปโหลด + metadata รอบจาก `count_cycles`
- warehouse เป็นเพียงข้อความแสดงผล ดึงจากรอบที่ join (`:662`) — **ไม่มีฟิลเตอร์คลัง**

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **เอกสารเดิมไม่ตรงจริง**: `docs/SYSTEM_GUIDE.md` ระบุว่ามี "ฟิลเตอร์ตามคลัง + ช่วงวันที่" — จริง ๆ มีแค่ ปี/เดือน/รอบ
- **Layout แตกแถว**: `<body>` ไม่มี class `has-sidebar` ใช้ `.main-content` + CSS เฉพาะหน้า ขณะที่หน้าอื่นใช้ `has-sidebar` + `.main-area` (`:12, 113, 116`) — ตรงกับอาการ "ตำแหน่งเพี้ยน" ที่ SYSTEM_GUIDE §6.3 บันทึกไว้
- `.limit(500)` บน `count_cycles` — เกิน 500 รอบแล้วช่วงเวลาเก่าหายจาก picker เงียบ ๆ (`:481`)
- โหมด "ทั้งหมด" reuse query builder ตัวเดิม `.range()` ซ้ำหลายรอบ (`:605-613`) — พฤติกรรมไม่ definded ของ supabase-js อาจพังในเวอร์ชันหน้า
- `fetchCycleIdsWithBookLines` โหลด `book_stock_lines` ทั้งตารางลง browser ในเคส fallback (`:510-529`)
- `escapeHtml(s)` ใช้ `String(s || '')` — ค่า `0` กลายเป็นช่องว่าง (`:446`)
