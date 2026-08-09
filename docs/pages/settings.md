# settings.html — ตั้งค่า Supabase + จัดการคลัง (Warehouse Registry)

> ไฟล์: `Html/settings.html` (~434 บรรทัด)
> 2 การ์ด: ตั้งค่าการเชื่อมต่อ Supabase และ CRUD registry คลัง (`warehouses`) ที่ทุกหน้าใช้ร่วมกัน

## หน้าที่และฟีเจอร์

### การ์ด 1 — เชื่อมต่อ Supabase
- ช่อง URL / API Key (ป้ายบอก "anon/public" ⚠️ แต่ค่าที่ระบบ seed จริงคือ service_role — ดูข้อสังเกต) เติมค่าจาก localStorage ตอนโหลด (`:256-257`)
- ปุ่มแสดง/ซ่อน key, ปุ่ม **ทดสอบ** (`testSupabaseConnection` — fetch REST ตรง), ปุ่ม **บันทึก** (`saveSupabaseSettings` — เขียน `SB_URL`/`SB_KEY`)

### การ์ด 2 — จัดการคลัง
- เพิ่มคลัง (upsert ตาม `name`), เปิด/ปิดใช้งาน (toggle `is_active`), ลบ, โหลดใหม่, checkbox "แสดงคลังที่ปิดใช้งาน"
- ทุก mutation เรียก `compactActiveSortOrders()` เรียงลำดับ 1..N ใหม่ + ยิง event `warehouseRegistryChanged`
- ตอนโหลดหน้า ถ้าเชื่อมต่ออยู่จะ compact ลำดับอัตโนมัติ (`:422-428`)

## ตาราง Supabase ที่ใช้

- `warehouses` (ผ่าน `warehouseService`): SELECT / UPSERT / UPDATE / DELETE
- `inventory_counts` โดยอ้อม — เป็นตาราง canary ของ connection check (`settings-shared.js:43`)

## Shared JS ที่โหลด (`:249-252`)

`api.js`, `warehouses-shared.js`, `settings-shared.js`, `sidebar-shared.js` — **ไม่โหลด** `db-errors.js` (error คลังโชว์ `err.message` ดิบ `:389, 400, 417`), **ไม่โหลด** `ui-confirm-modal.js` (ลบคลังใช้ native `confirm()` — จุดเดียวที่เหลือในทั้งระบบ `:410`)

## localStorage keys

`SB_URL`, `SB_KEY` (อ่าน/เขียน)

## ความสัมพันธ์กับหน้าอื่น

- **ทุกหน้า**อ่าน `SB_URL`/`SB_KEY` ผ่าน `api.js` — แก้ที่นี่มีผลทั้งระบบ (ต่อเครื่อง)
- Registry คลังถูกใช้โดย index, import_counts, count_search, audit_check, cycle_config, sku_master, dashboard, live_count_wall ผ่าน `warehouseService`
- การลบคลังใน registry **ไม่ลบข้อมูล** `inventory_counts`/`sku_master` ของคลังนั้น — แค่หายจาก dropdown

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **[ยืนยันแล้ว] XSS จากชื่อคลัง**: `${name}` ใส่ innerHTML ตรง ๆ (`:352`) และ onclick escape เฉพาะ `'` (`:348, 359`) — หน้าเดียวที่ไม่ escape ชื่อคลังเลย (warehouses-shared เอง escape ครบ)
- ~~ป้าย "anon/public" ขัดกับความจริง~~ **แก้แล้ว (C1, 2026-08-09)**: `api.js` ใช้ `sb_publishable_...` แล้ว + `runSaveSettings`/`saveSupabaseSettings` ปฏิเสธ service_role key ตั้งแต่ตอนบันทึก
- Dead: `window.RS?.refreshStandardWarehousesFromRegistry` (`:374`) — `window.RS` ไม่มีอยู่ที่ไหนในระบบ (export จริงชื่อ `window.reconcileService` และหน้านี้ไม่โหลดไฟล์นั้นด้วยซ้ำ) — branch ไม่เคยรัน
- native `confirm()` ลบคลัง — action ที่กระทบทุกหน้าได้ dialog ที่ให้ข้อมูลน้อยที่สุดในระบบ (`:410`)
- `settings-shared.js:22,27` ใช้ `badge.className = ...` ทับ class `connection-badge-status` หาย ([ยืนยันแล้ว] — style ที่ผูกกับ class นั้นหลุดหลังเช็คครั้งแรก)
- `testSupabaseConnection` ไม่ normalize trailing slash ของ URL (`settings-shared.js:59`)
