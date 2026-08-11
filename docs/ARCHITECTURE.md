# ARCHITECTURE — สถาปัตยกรรมระบบ AuditNew

> ระบบนับสต็อก/ตรวจสอบคลังสินค้า (UI ภาษาไทย) — static HTML + vanilla JS + Supabase
> ไม่มี build step, ไม่มี framework, ไม่มี test — เปิดไฟล์ HTML ตรง ๆ ในเบราว์เซอร์
> Libraries จาก CDN: supabase-js v2, SheetJS (xlsx), Lucide icons, Chart.js (เฉพาะ dashboard/index)

## ภาพรวม Data Flow

```
settings.html ──► localStorage SB_URL/SB_KEY ──► Js/api.js getClient() ──► ทุกหน้า
settings.html ──► ตาราง warehouses ──► Js/warehouses-shared.js ──► ทุกหน้าที่มี dropdown คลัง


cycle_config.html
  ├─ สร้างรอบ ──────────────► count_cycles
  ├─ อัปโหลด Book ──────────► book_stock_lines (ต่อ cycle_id, โหมด replace)
  ├─ ผูกผลนับเข้ารอบ ───────► inventory_counts.cycle_id  (คอลัมน์เดียวที่ flow reconcile แตะได้)
  └─ ตั้ง active cycle ─────► localStorage active_count_cycle_v1
                                     │
index.html (Js/script.js) ─┐         ▼
import_counts.html ────────┴─ แนบ cycle_id ─► INSERT inventory_counts (+ inventory_audit_logs)
                                     │
              ┌──────────────────────┼───────────────────┬────────────────┐
              ▼                      ▼                   ▼                ▼
      audit_check.html        count_search.html    reconcile.html   dashboard.html
      (อ่าน+แก้+ลบ           (อ่านอย่างเดียว)     (อ่าน sku_id +   live_count_wall
       ⚠️ ไม่เขียน log)                            ปรับฝั่ง Book)   (อ่าน + realtime)
                                                        │
                              RPC refresh_reconciliation_for_cycle
                                                        ▼
                                              reconciliation_lines (cache)
                                              stock_adjustments (draft→applied)
                                              reconciliation_match_acceptances
                                                        │
                                     book_explorer.html (อ่าน Book อย่างเดียว)
```

## ลำดับการใช้งานที่ระบบออกแบบไว้

1. `settings.html` — ตั้งค่า Supabase + จัดการคลัง
2. `cycle_config.html` — สร้างรอบ → อัปโหลด Book → ตั้ง active cycle
3. `index.html` / `import_counts.html` — บันทึก/นำเข้าผลนับ (แนบ cycle_id อัตโนมัติ)
4. `audit_check.html` / `count_search.html` — ตรวจคุณภาพ/ค้นหา
5. `cycle_config.html` — ผูกผลนับที่ยังไม่มี cycle_id เข้ารอบ
6. `reconcile.html` — กด "คำนวณ Match" → ปรับยอด/ยอมรับ → export
7. `book_explorer.html` / `dashboard.html` / `live_count_wall.html` — ดูผล

## Shared JS Layer (`Js/` — 16 ไฟล์)

| ไฟล์ | Global ที่ export | หน้าที่ |
|---|---|---|
| `api.js` | `window.apiService` | factory Supabase client — อ่าน `SB_URL`/`SB_KEY` จาก localStorage, fallback เป็นค่า config (publishable key — แก้ C1 แล้ว 2026-08-09) แล้ว seed กลับลง localStorage; มี `isServiceRoleKey()` ล้าง key admin ที่ค้างในเครื่องอัตโนมัติ |
| `sidebar-shared.js` | `window.sidebarShared` | render เมนูข้าง ทุกหน้า จากโครงสร้าง `GROUPS`/`PAGE_FILES` (`:11-69`); โหลด `chat-notify-shared.js` + CSS + supabase-js CDN แบบ lazy (`:194-261`); จำสถานะกลุ่มเปิด/ปิดใน `sidebar_groups_open_v1` |
| `settings-shared.js` | 5 globals | connection badge + ทดสอบ/บันทึกการเชื่อมต่อ — canary table คือ `inventory_counts` |
| `warehouses-shared.js` | `window.warehouseService` | registry คลัง (ตาราง `warehouses`), cache 30 วิ, fallback 3 คลัง hardcode, CRUD + event `warehouseRegistryChanged` |
| `sku-utils.js` | `window.SkuUtils` | มาตรฐาน SKU: `normalizeSku` = trim + UPPERCASE |
| `db-errors.js` | `window.DbErrors` | แปล error Postgres (23505/23502/23503/23514) เป็นภาษาไทย |
| `ui-confirm-modal.js` | `window.uiConfirm` | modal ยืนยัน (แทน `confirm()`) รองรับ 2 ขั้น (`show`, `twoStep`) — คู่กับ `Css/ui-confirm.css` |
| `reconcile-shared.js` | `window.reconcileService` | service ใหญ่สุด (~78 exports): cycle CRUD, Book import, active cycle, เวลา Bangkok, reconciliation, adjustments — ดูรายละเอียดใน [pages/reconcile.md](pages/reconcile.md) |
| `dashboard-shared.js` | `window.dashboardShared` | helper คำนวณ bucket/สถิติ + สร้าง Chart.js (ไม่มี I/O) |
| `audit-dedupe.js` | `window.AuditDedupe` | นิยาม "แถวซ้ำ" ของ `inventory_counts` ตามนโยบาย migration 011 (ใช้โดย audit_check — แยกออกมาให้เทสได้) |
| `audit-book-impact.js` | audit_check | คำนวณผลกระทบของแถวทับซ้อนต่อ Match + สถานะ "ยืนยันว่าปกติ" |
| `audit-loc-compare.js` | audit_check | เทียบตำแหน่งกับไฟล์ Excel (`buildLocComparePlan`) |
| `audit-log.js` | `window.AuditLog` | สร้าง/เขียน `inventory_audit_logs` ให้ทุก mutation ในหน้า audit_check (invariant ข้อ 1) |
| `chat-notify-shared.js` | — | แจ้งเตือนแชทข้ามหน้า (realtime + polling) — ถูก inject โดย sidebar ทุกหน้า |
| `script.js` | (IIFE) | logic ทั้งหมดของ index.html |
| `live-count-wall.js` | (IIFE) | logic ของ live_count_wall — ⚠️ capture `RS` ตอน parse ลำดับ script สำคัญ |

## Matrix การโหลด Shared JS ต่อหน้า

> สแกนจาก `<script src>` จริงเมื่อ 2026-08-10 (หลังถอด dead load 6 จุด) — มีเทส `tests/unit/script-loads.test.mjs` บังคับว่า **หน้าไหนอ้าง global ตัวไหน หน้านั้นต้องโหลดไฟล์ต้นทาง**

| หน้า | api | sku-utils | warehouses | db-errors | settings | reconcile | sidebar | ui-confirm | เฉพาะหน้า |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| index | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | script.js |
| import_counts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| audit_check | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | audit-dedupe, audit-log, audit-book-impact, audit-loc-compare |
| count_search | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | |
| reconcile | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | |
| book_explorer | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | |
| dashboard | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | dashboard-shared |
| live_count_wall | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | live-count-wall.js |
| settings | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | |
| cycle_config | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | |
| chat | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | |

`chat-notify-shared.js` + `Css/chat-notify.css` ไม่มี tag ในหน้าไหนเลย — `sidebar-shared.js` inject ให้ทุกหน้าตอน runtime (จึงต้อง bump `ASSET_VER`)

**`db-errors.js` โหลดแค่ 4 หน้า และ `settings-shared.js` 9 หน้า** — 6 จุดที่เหลือถูกถอดออกเมื่อ 2026-08-10 เพราะไม่มีการเรียกใช้จริง (`dashboard.html` มี connection pill ของตัวเองแยก ไม่ใช้ badge กลาง)

จุดที่ drift:
- ลำดับ `<script>` ไม่มีมาตรฐาน (6 หน้า sidebar มาก่อน api, 7 หน้ามาหลัง) — ทำงานได้เพราะ sidebar รอ DOMContentLoaded ยกเว้น `live-count-wall.js` ที่ลำดับสำคัญจริง
- **cache-buster**: ทุกไฟล์ใน `Js/` และ `Css/` ที่อ้างจาก HTML มี `?v=` ครบแล้ว และมีเทส `[asset-ver]` 3 ข้อบังคับอัตโนมัติ — ⚠️ **แก้ shared JS ทีไร ต้อง bump `?v=` ทุก tag ด้วยมือ** · แตะ `Css/style.css` หรือ `Js/sidebar-shared.js` ต้อง bump `ASSET_VER` + ทั้ง 11 หน้าด้วย
- `reconcile` และ `book_explorer` โหลด `reconcile-shared.js` โดยไม่โหลด `warehouses-shared.js` — ไม่พัง เพราะ `refreshStandardWarehousesFromRegistry()` ถูกเรียกจาก `cycle_config` / `settings` เท่านั้น ซึ่งโหลดครบ · `book_explorer` ไม่โหลด `sku-utils.js` ก็ไม่พัง เพราะ `reconcile-shared.js:70` มี fallback normalize ที่เหมือน `SkuUtils.normalizeSku` เป๊ะ
- `escapeHtml` มี **5 เวอร์ชัน** คนละชุดอักขระ (warehouses-shared, ui-confirm-modal, chat.html, dashboard.html, live-count-wall.js)
- Connection badge มี 3 implementation (settings-shared กลาง, dashboard `#connectionPill`, live_count_wall id-based)
- fallback รายชื่อคลัง hardcode ซ้ำ 3 ที่

## localStorage keys ทั้งระบบ

| Key | เขียนโดย | อ่านโดย |
|---|---|---|
| `SB_URL` / `SB_KEY` | settings, api.js (auto-seed) | ทุกหน้า (api.js) |
| `active_count_cycle_v1` | cycle_config (ผ่าน RS) | index, import_counts (แนบ cycle_id) |
| `saved_counter_name` | index, import_counts | index, import_counts |
| `saved_warehouse` | index, import_counts | index, import_counts, count_search |
| `saved_location` | index | index |
| `count_page_selected_cycle_v1` | index | index |
| `import_counts_warehouse` | import_counts | import_counts, count_search |
| `audit_check_year_month` | audit_check | audit_check |
| ~~`audit_check_all_time`~~ | — | — | 🚫 checkbox "ทุกช่วงเวลา" ถอดออก 2026-08-11 · key เก่าอาจค้างในเบราว์เซอร์ผู้ใช้ แต่ไม่มีโค้ดอ่านแล้ว |
| `audit_check_warehouse` | audit_check | ⚠️ ไม่มีใครอ่าน |
| `dashboard_scope_warehouse` / `dashboard_cycle_id` | dashboard | dashboard |
| `live_wall_warehouse` / `live_wall_cycle_id` | live_count_wall | live_count_wall |
| `sidebar_groups_open_v1` | sidebar-shared | sidebar-shared |
| `audit_chat_v2` / `audit_chat_name_v1` / `audit_chat_station_v1` / `audit_chat_session_v1` / `audit_chat_unread_v1` / `audit_chat_last_read_v1` | chat, chat-notify | chat, chat-notify |
| `recon_import_accept_v1_<cycleId>` (sessionStorage) | reconcile | reconcile |

⚠️ precedence ของ `saved_warehouse` vs `import_counts_warehouse` สลับกันระหว่าง import_counts กับ count_search — สลับหน้าแล้วคลังที่เลือกอาจเปลี่ยน

## เมนู (sidebar-shared.js:11-69)

| กลุ่ม | หน้า |
|---|---|
| เมนูนับสต็อก | index (นับสต็อก), import_counts |
| เมนูตรวจสอบ | audit_check, count_search, reconcile, book_explorer, dashboard, live_count_wall |
| ตั้งค่า | settings, cycle_config, chat |

ลิงก์ครบทั้ง 11 หน้า ไม่มีลิงก์เสีย (มีเทส `[menu-guard]` บังคับว่าทุกรายการต้องชี้ไฟล์ที่มีจริง และทุกกลุ่มต้องมีอย่างน้อย 1 รายการ)

## CSS

| ไฟล์ | บรรทัด | โหลดโดย |
|---|---|---|
| `Css/style.css` | ~1,863 | ทุกหน้า (global) |
| `Css/ui-confirm.css` | ~181 | 5 หน้าที่ใช้ uiConfirm |
| `Css/chat-notify.css` | ~114 | inject runtime โดย sidebar-shared |

หน้าใหญ่ ๆ มี CSS inline อีกหลายพันบรรทัด (dashboard ~1,100, audit_check ~870, live_count_wall ~330) — ไม่ cache, ซ้ำ pattern กัน

## แนวคิดสำคัญ (Invariants)

1. **`inventory_counts` = หลักฐานผลนับ (immutable evidence)** — flow Reconcile แตะได้เฉพาะ `cycle_id`; การแก้/ลบทำได้ที่ index (มี audit log) และ audit_check (⚠️ ปัจจุบันไม่มี log — เป็น issue)
2. **SKU = UPPERCASE + trim** ผ่าน `SkuUtils.normalizeSku`
3. **แถวซ้ำ (wh, sku, loc, qty) ถูกต้องตามนโยบาย** — migration 011 ตั้งใจอนุญาต ใช้ `client_request_id` กัน retry แทน
4. **cycle เป็นแกนของ reconcile** — multi-warehouse เก็บเป็น `"A|B"`, ทุกคลัง = `'คลังทั้งหมด'` (convention ฝั่ง client ไม่มี constraint ใน DB)
5. **เวลาคิดแบบ Bangkok (+07)** — helper ใน reconcile-shared.js

## สิ่งตกค้างจาก Cursor

- `.cursor/debug-ae4a9b.log` — log debug timezone ของโปรเจกต์นี้ (ควรลบ)
- `.cursor/debug-93df3f.log` — ⚠️ log จาก**โปรเจกต์อื่น** (Gemini API วิเคราะห์รูปเครื่องประดับ) หลุดเข้า git
- **ไม่มี `.gitignore`** ทั้ง repo
