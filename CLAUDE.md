# AuditNew — ระบบนับสต็อก / ตรวจสอบคลังสินค้า

Static HTML + vanilla JS + Supabase (UI ภาษาไทย) — ไม่มี build step, ไม่มี framework, ไม่มี test
เปิดไฟล์ HTML ตรง ๆ ในเบราว์เซอร์ · libraries จาก CDN (supabase-js v2, SheetJS, Lucide, Chart.js)

## กฎสำคัญ (Invariants) — ห้ามละเมิดเมื่อแก้โค้ด

1. **`inventory_counts` = หลักฐานผลนับ (immutable evidence)** — flow Reconcile แตะได้เฉพาะคอลัมน์ `cycle_id`; การแก้/ลบรายแถวต้องเขียน `inventory_audit_logs` เสมอ
2. **SKU normalize เป็น UPPERCASE + trim** ผ่าน `SkuUtils.normalizeSku` (`Js/sku-utils.js`)
3. **ระบบห้ามลบ/แก้จำนวนเอง — "นับมายังไงเก็บอย่างนั้น"** (นโยบาย admin 2026-08-10)
   - **หลายแถวที่ตำแหน่งเดียวกัน จำนวนต่างกัน = การทำงานปกติ** — สินค้าจำนวนมากถูกแบ่งใส่หลายถุง พนักงานนับแล้วบันทึกทีละถุง · **ห้ามลบ ห้ามแนะนำให้ลบ ห้าม block เด็ดขาด** (เช่น `BNP20 @ B2-01` = 70+200 = Book 270 เป๊ะ)
   - **ค่าเหมือนกันครบทุกช่อง (รอบ+คลัง+SKU+ตำแหน่ง+จำนวน) = ซ้ำจริง** — ลบได้ **เฉพาะ** ผ่านปุ่ม "ลบแถวที่กดบันทึกซ้ำ" ที่มียืนยัน 2 ขั้น + สำรอง CSV + เขียน `inventory_audit_logs` ก่อนลบ (`findSameCycleDuplicates`) · เก็บแถวเก่าสุดของกลุ่มไว้เสมอ
   - **คำยืนยันของคนชนะกฎของระบบ** — กลุ่มที่กด "ยืนยันว่าปกติ" (`inventory_count_acceptances`, [019](docs/sql/019_inventory_count_acceptances.sql)) จะไม่ถูกเตือนและ**ไม่ถูกปุ่มลบเลือก** จนกว่าข้อมูลจะเปลี่ยน
   - migration 011 ยังคงอนุญาตแถวซ้ำระดับ DB (ใช้ `client_request_id` กัน retry) — การตัดสินทั้งหมดอยู่ที่ UI + คนกดยืนยัน
4. **cycle (`count_cycles`) เป็นแกนของ reconcile** — active cycle แชร์ผ่าน `localStorage.active_count_cycle_v1`; multi-warehouse เก็บเป็น `"A|B"`, ทุกคลัง = `'คลังทั้งหมด'`
5. **เวลา = Bangkok (+07)** — ใช้ helper ใน `Js/reconcile-shared.js`
6. **ห้าม commit key/credential** — ฝั่ง client ใช้ได้เฉพาะ anon/publishable key (`Js/api.js` ใช้ `sb_publishable_...` แล้ว มีเทสยาม [C1-guard] สแกน + `apiService.isServiceRoleKey()` ล้าง key admin ที่ค้างใน localStorage อัตโนมัติ) — service_role key เก่ายังอยู่ใน git history จนกว่า admin จะ revoke ใน dashboard
7. **ค่า dynamic ทุกตัวที่เข้า innerHTML/attribute ต้อง escape** — และ **ห้ามต่อค่าเข้า JS string ใน `onclick="fn('...')"` เด็ดขาด** แม้ escape แล้วก็ไม่ปลอดภัย (เบราว์เซอร์ decode entity ก่อน parse JS) ให้ใช้ `data-*` + `this.dataset` · เทส `tests/unit/xss-guard.test.mjs` บังคับกฎนี้อัตโนมัติ
8. ระวังลำดับ `<script>`: `Js/live-count-wall.js` ต้องมาหลัง `reconcile-shared.js`
9. **แก้ shared JS/CSS แล้วต้อง bump cache-buster ทุกที่** — shared JS ทุกตัว **และ `Css/style.css`** มี `?v=YYYYMMDDx` ในทุก HTML **และ** ต้อง bump `ASSET_VER` ใน `Js/sidebar-shared.js` ด้วย (ใช้กับไฟล์ที่ inject แบบ dynamic: chat-notify-shared.js, chat-notify.css) ถ้าไม่ bump เบราว์เซอร์จะใช้ไฟล์เก่าและการแก้จะไม่ถึงผู้ใช้ (เคยเกิดจริงตอนแก้ H1) · เทส `tests/unit/sidebar-responsive.test.mjs` [asset-ver] บังคับให้ `sidebar-shared.js` + `style.css` ของทุกหน้าตรงกับ `ASSET_VER` อัตโนมัติ (`style.css` เพิ่งเคยไม่มี `?v=` เลยจนถึง 2026-08-10)
11. **`apiService.getClient()` cache client ไว้แล้ว** — เรียกได้บ่อยตามสบาย ห้ามเรียก `createClient()` เองตรง ๆ (จะเกิด GoTrueClient ซ้อนกัน)
12. **RPC ที่เขียนตารางซึ่ง anon ไม่มี policy เขียน ต้องเป็น `SECURITY DEFINER` + `SET search_path`** — Postgres function เป็น `SECURITY INVOKER` โดยดีฟอลต์ จึงโดน RLS ของผู้เรียก (สมัย service_role key ไม่เห็นปัญหาเพราะข้าม RLS หมด) · ปัจจุบันมีตัวเดียวคือ `refresh_reconciliation_for_cycle` ([018](docs/sql/018_refresh_reconciliation_security_definer.sql)) · อาการเวลาพลาด: PostgREST คืน **HTTP 401** พร้อมข้อความ `new row violates row-level security policy` (sqlstate 42501) และ `DELETE` ในฟังก์ชันจะลบ 0 แถวแบบไม่ error
13. **query ที่แบ่งหน้าด้วย `.range()` ต้องมี `.order('id')` เสมอ** — `created_at` ซ้ำกันได้ (Postgres `now()` คงที่ทั้ง transaction → group submit / นำเข้า Excel ได้เวลาเท่ากันเป๊ะ) ถ้าเรียงไม่เสถียรจะข้าม/ซ้ำแถวเงียบ ๆ · เทส `tests/unit/stable-paging.test.mjs` บังคับอัตโนมัติ
10. `cycle_id` ต้องมาจาก `attachCycleToPayload()` เท่านั้น — มี guard `isCycleRelevantNow()` กันรอบเดือนเก่าค้าง ห้าม set `cycle_id` ตรง ๆ ตอน insert

## เอกสารระบบ (จัดทำ 2026-08-09 จากการวิเคราะห์โค้ดจริงทั้งระบบ)

### ภาพรวม
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — สถาปัตยกรรม, data flow, shared JS layer 13 ไฟล์, matrix การโหลดต่อหน้า, localStorage keys ทั้งหมด, เมนู sidebar
- [docs/DATABASE.md](docs/DATABASE.md) — schema 8 ตาราง + views + RPC 8 ตัว, ความสัมพันธ์, รายการ migration, จุดที่โค้ดกับ DB ไม่ตรงกัน
- [docs/ISSUES.md](docs/ISSUES.md) — **รายการสิ่งที่ควรแก้ทั้งหมด (Critical 2 / High 8 / Medium 23 / Low 11 กลุ่ม)** พร้อมช่องติ๊กให้ admin เลือก — Critical/High ผ่านการ verify กับโค้ดจริงครบทุกข้อ

### เอกสารรายหน้า (docs/pages/)
| หน้า | เอกสาร | หน้าที่ |
|---|---|---|
| `index.html` | [docs/pages/index.md](docs/pages/index.md) | นับสต็อก (Single/Group) + KPI + audit log |
| `Html/import_counts.html` | [docs/pages/import_counts.md](docs/pages/import_counts.md) | นำเข้าผลนับจาก Excel/CSV |
| `Html/count_search.html` | [docs/pages/count_search.md](docs/pages/count_search.md) | ค้นหาผลนับย้อนหลัง (อ่านอย่างเดียว) |
| `Html/audit_check.html` | [docs/pages/audit_check.md](docs/pages/audit_check.md) | ตรวจคุณภาพข้อมูล + bulk แก้/ลบ (หน้าเสี่ยงสูงสุด) |
| `Html/reconcile.html` | [docs/pages/reconcile.md](docs/pages/reconcile.md) | Match ยอด BOOK vs ผลนับ + ปรับยอด (รวม reconcile-shared.js) |
| `Html/cycle_config.html` | [docs/pages/cycle_config.md](docs/pages/cycle_config.md) | สร้างรอบนับ + อัปโหลด BOOK + ผูกผลนับ |
| `Html/book_explorer.html` | [docs/pages/book_explorer.md](docs/pages/book_explorer.md) | ดู BOOK (อ่านอย่างเดียว) |
| `Html/sku_master.html` | [docs/pages/sku_master.md](docs/pages/sku_master.md) | จัดการ SKU Master ต่อคลัง |
| `Html/dashboard.html` | [docs/pages/dashboard.md](docs/pages/dashboard.md) | สรุปภาพรวม 2 แท็บ (ความเร็วนับ / Match) |
| `Html/settings.html` | [docs/pages/settings.md](docs/pages/settings.md) | ตั้งค่า Supabase + registry คลัง |
| `Html/chat.html` | [docs/pages/chat.md](docs/pages/chat.md) | แชททีม + ระบบแจ้งเตือนข้ามหน้า |
| `Html/live_count_wall.html` | [docs/pages/live_count_wall.md](docs/pages/live_count_wall.md) | จอแสดงผลนับสด (realtime) |
| `Html/user_manual.html` | [docs/pages/user_manual.md](docs/pages/user_manual.md) | คู่มือแก้ไขได้ในเบราว์เซอร์ (localStorage ล้วน) |

### เอกสารเดิม (แก้ให้ตรงโค้ดแล้ว 2026-08-10 — เหลือ 1 จุดใน ISSUES.md ข้อ L8)
- [docs/SYSTEM_GUIDE.md](docs/SYSTEM_GUIDE.md) — คู่มือระบบฉบับเดิม
- [docs/RECONCILIATION_DESIGN.md](docs/RECONCILIATION_DESIGN.md) — แนวคิด reconcile ฉบับเดิม (⚠️ ยังต้อง verify ทิศทางเครื่องหมาย adjustment)
- `docs/sql/*.sql` — migrations (ดูสถานะรายไฟล์ใน [docs/DATABASE.md](docs/DATABASE.md))

## ระบบเทส (Dry Run 100% — ห้ามแตะ DB จริงในการเทสเด็ดขาด)

```bash
node tests/run.mjs
```

- ไม่มี network, Supabase เป็น mock, localStorage จำลอง — วิธีใช้/เขียนเทสเพิ่ม: [tests/README.md](tests/README.md)
- ผล: ✅ PASS · ❌ FAIL = **regression** (ห้าม commit) · 🟡 KNOWN-OPEN = บั๊กใน ISSUES.md ที่ยังไม่แก้ · 🎉 KNOWN-FIXED = แก้สำเร็จ (ย้ายเทสเป็น test ปกติ + อัปเดต tracking)
- **Workflow บังคับก่อน/หลังแก้โค้ดทุกครั้ง**: [docs/FIX_TRACKING.md](docs/FIX_TRACKING.md) — เก็บ baseline → แก้ → รันซ้ำ → เช็ค regression → smoke มือตาม Impact Map → ให้ code-reviewer ตรวจ

## Subagent

- `.claude/agents/code-reviewer.md` — agent ตรวจสอบโค้ดประจำโปรเจกต์ (อ่านอย่างเดียว) รู้ invariants และโครงสร้างระบบ — ใช้ review การแก้ไข / verify findings / หาบัคเพิ่ม

## สถานะงาน

- ✅ วิเคราะห์ + จัดทำเอกสารครบทุกหน้า (2026-08-09)
- ✅ ระบบเทส Dry Run + ระบบติดตามการแก้ไข/regression (2026-08-09) — ล่าสุด: 57 PASS / 0 FAIL / 6 KNOWN-OPEN
- ✅ **C1 ปิดสมบูรณ์** (2026-08-09): `Js/api.js` ใช้ publishable key + RLS policy (`docs/sql/016_rls_policies.sql`) + admin revoke legacy keys แล้ว (GitHub alert = resolved/revoked)
- ✅ DB cleanup (2026-08-09): ลบตารางสำรอง `_bk_*` 3 ตัว ([017](docs/sql/017_drop_skunorm_backup_tables.sql))
- ✅ **H1 เสร็จ** (2026-08-09): guard `isCycleRelevantNow()` กัน cycle เดือนเก่าค้าง + เตือนเมื่อเปิดหน้าค้างข้ามเดือน + cache-buster ทุกหน้า
- ✅ **C2 + M25 เสร็จ** (2026-08-09): ปิด Stored XSS ทุกจุด (escape ครบ + เลิกต่อค่าใน onclick) และ cache Supabase client
- ✅ **H2 เสร็จ** (2026-08-09): นิยาม "แถวซ้ำ" ใหม่ใน `Js/audit-dedupe.js` — เดิมจะลบข้อมูลนับที่ถูกต้อง 470 แถว ตอนนี้ลบ 0 · **เทส 92 PASS / 0 FAIL**
- ✅ **H5 เสร็จ** (2026-08-09): reconcile กันเขียนลงรอบเก่า — ล็อก cycle id ตอน guard (ไม่อ่าน global ตอนเขียน) + ล้างสถานะเมื่อสลับรอบ + ล็อก dropdown ระหว่างโหลด · **เทส 133 PASS**
- ✅ **H4 + H9 เสร็จ** (2026-08-09): dashboard เลิกคูณ Book ต่อคลัง (`computeBookCoverage`) และแก้ `.range()` ที่เรียงไม่เสถียร 10 จุด (ต้องมี `.order('id')` เสมอ — เพราะ bulk insert ทำให้ `created_at` ซ้ำ) · **เทส 123 PASS**
- ✅ **H3 เสร็จ** (2026-08-09): `Js/audit-log.js` เขียน `inventory_audit_logs` ครบทุก mutation ในหน้า audit_check (เดิม 0 จุด) — ลบต้อง log ก่อน · แก้ flush ทุก 100 แถว · **เทส 113 PASS** · ส่วน atomic แยกเป็น M27
- ✅ **แก้ 401 "คำนวณ Match"** (2026-08-09): `refresh_reconciliation_for_cycle` เป็น SECURITY DEFINER ([018](docs/sql/018_refresh_reconciliation_security_definer.sql)) — RPC ไม่ข้าม RLS เองถ้าไม่ประกาศ definer
- ✅ **H10 เสร็จ** (2026-08-09): audit_check เตือน "ซ้ำในรอบนับเดียวกัน" อีกครั้ง — `classifyCycleDuplicate` แยกคำถาม "ควรเตือนไหม" (รอบ+คลัง+SKU+ตำแหน่ง+จำนวนเท่ากัน → แดงเสมอ) ออกจาก "ลบอัตโนมัติได้ไหม" (กฎเข้ม H2 คงเดิม) · นับเฉพาะแถวส่วนเกิน (2 แถว = ผิดพลาด 1) · เจอจากข้อมูลจริง `PC700 @ G3-03 = 192` ที่ทำให้ Match ขึ้น counted 384 vs book 193 · **เทส 180 PASS · หมายเหตุชี้ตัวคู่ที่ซ้ำ (แถว # + วันเวลา + ผู้นับ)**
- ✅ **UI1 + M22 เสร็จ** (2026-08-10): เมนูซ้ายบนจอ ≤900px กลายเป็น **ลิ้นชักสไลด์** (ปุ่ม ☰ + ฉากมืด + Esc/คลิกฉาก/เลือกเมนู = ปิด + ปิดอัตโนมัติเมื่อขยายจอพ้น 900px) คงรูปทรงเมนูแนวตั้งเดิมไว้ทั้งหมด — สาเหตุเดิมคือ `@media (max-width:900px)` สั่ง `flex-direction: row` ทับ DOM กลุ่มพับได้ที่ `sidebar-shared.js` สร้าง · พ่วงแก้ `.sidebar` ล้นจอเตี้ย (`overflow-y:auto` + `100dvh`), `book_explorer` ขาด `has-sidebar` (M22) และ cache-buster `20260810a` ทั้ง 13 หน้า (`style.css` + `ui-confirm.css` เดิม **ไม่มี `?v=` เลย** — แก้ CSS แล้วผู้ใช้ไม่เคยได้รับ) · ⚠️ **บทเรียนจาก review:** z-index ของแถบเมนูต้องต่ำกว่า overlay ทุกตัวของระบบ (ค่าจริง: toast 50 · cs-modal 100 · export-menu 180 · log-drawer 200/210) ตอนแรกตั้งไว้ 720 เพราะอ่าน "เลขบรรทัด" เป็น z-index จนปุ่มปิด drawer ประวัติกดไม่ได้บนมือถือ — ตอนนี้ใช้ 30/35/40 + มีเทสเทียบอัตโนมัติ · **เทส 183 PASS**
- ✅ **H11 + M26 เสร็จ** (2026-08-10): audit_check เห็น "แถวทับซ้อน" (ตำแหน่งเดียวกัน จำนวนต่างกัน) แล้ว — สถานะใหม่ `overlap` (ส้ม) + โหลด `reconciliation_lines` มาเทียบ Book (`Js/audit-book-impact.js` — ตามนโยบายข้อ 3 **ไม่มีคำแนะนำให้ลบ** มีเทสบังคับ) · เจอในรอบปัจจุบัน 16 กลุ่ม โดย 6 กลุ่มลบแถวเดียวแล้ว variance = 0 เป๊ะ แต่ `BNP20` (70+200=Book 270) พิสูจน์ว่าทยอยนับก็มีจริง → **เตือนอย่างเดียว ไม่ลบให้** · M26: `classifyDestinationCollision` บล็อกเฉพาะปลายทางรอบเดียวกัน · **เทส 221 PASS**
- ✅ **H12 + ระบบยืนยัน เสร็จ** (2026-08-10): ปรับตามนโยบาย admin "ระบบไม่ลบ/ไม่แก้จำนวนเอง แค่แจ้งให้คนมายืนยัน" — เอาคำแนะนำให้ลบออกจากเคสนับแยกถุงทั้งหมด · เพิ่มปุ่ม **"ยืนยันว่าปกติ"** (`inventory_count_acceptances`) ยืนยันแล้วเงียบ ข้อมูลเปลี่ยนแล้วกลับมาเตือน · ปุ่ม "ลบแถวที่กดบันทึกซ้ำ" เปลี่ยนเป็นเกณฑ์ `findSameCycleDuplicates` (PC700 ถูกเลือกแล้ว) และ**ข้ามกลุ่มที่คนยืนยันว่าปกติ** · เพิ่มหน้า **"ประวัติการแก้ไข/ลบ"** อ่าน `inventory_audit_logs` (SKU · ตำแหน่ง · จำนวน · วันเวลา · ผู้ทำ) + ส่งออก Excel · **เทส 217 PASS**
- ✅ **รัน [019](docs/sql/019_inventory_count_acceptances.sql) แล้ว** (2026-08-10) — ปุ่ม "ยืนยันว่าปกติ" พร้อมใช้ · ⚠️ unique index เป็น expression จึงใช้ `ON CONFLICT` ไม่ได้ (42P10) โค้ดแยก insert/update by id เองแล้ว ห้ามเปลี่ยนกลับไปใช้ upsert
- ✅ **LC1 เสร็จ** (2026-08-10): โหมด "เทียบตำแหน่ง Excel" ใช้งานได้จริงเป็นครั้งแรก — เดิม `runLocCompare` SELECT ลืม `counted_qty` ทำให้ `resolveDestQty` คืน NaN แล้ว **บล็อกทุกแถว 100%** (ผู้ใช้เห็นแค่ "ไม่บันทึก — ปลายทางซ้ำทั้งหมด") · ย้าย logic ไป `Js/audit-loc-compare.js` + `missingQty` (ข้อมูลไม่ครบต้องดัง ไม่เงียบ) · **เลือกคลังในโมดัลได้ทีละคลัง** แล้วซิงก์กลับ scope bar + `loadReferenceData()` ตรง ๆ เพื่อไม่ให้ guard ชนปลายทางตาบอด · **เทส 244 PASS**
- ✅ **Dead code sweep ชุด 1-5 เสร็จ** (2026-08-10): ลบ asset กำพร้า 4 ไฟล์ (~4 MB, `assets/` 8.0→4.0 MB) · `<script>` ที่โหลดฟรี 6 จุด (`db-errors.js` เหลือ 4 หน้า, `settings-shared.js` เหลือ 9 หน้า) · ฟังก์ชัน/id/CSS ตายรายหน้า 19 จุด · **ฟีเจอร์ Extra SKU Drawer ทั้งชุดใน `Js/script.js` (−205 บรรทัด)** ซึ่ง `updateStats()` ยังเรียก `buildExtraCountedItems` แบบ O(n) ทุกครั้งที่บันทึกผลนับ · เพิ่มเทสยาม `unit/script-loads` (หน้าไหนอ้าง global ต้องโหลดไฟล์ต้นทาง) · **เทส 249 PASS**
  - **ค้นพบสำคัญ: `sku_master` ผูกกับหน้าเดียว** — `reconcile.html` เรียก `fetchSkuMasterNamesBySkus` ตอนกด "สร้างลง Book" (มี fallback อยู่แล้ว) · `index.html` grep คำว่า "master" = **0 hit** ใช้ `book_stock_lines` ล้วน → แก้เอกสาร 4 ไฟล์ที่บอกผิดมาตลอด · 🐛 ฟังก์ชันนั้น query โดย**ไม่กรอง `warehouse`** ทั้งที่ตารางแยกต่อคลัง (ยังไม่แก้)
  - **เหลือชุด 6-9** (ดู ISSUES.md L1/L2): `reconcile-shared.js` 6 ฟังก์ชัน ~180 บรรทัด (ต้องลด `shared-smoke.test.mjs:32` `>= 80` → `>= 75` พร้อมกัน) · `ui-confirm-modal`/`live-count-wall` · dead handler ใน `audit_check.html` · CSS ตาย ~200 บรรทัดใน `style.css` (ต้อง bump `ASSET_VER` + 13 หน้า)
  - ⛔ **ห้ามลบ `@import` ฟอนต์ Outfit ใน `Css/style.css:1`** — มี `<link>` แค่ 4/13 หน้า แต่ CSS ใช้ `'Outfit'` 12 จุดที่ยัง live → อีก 9 หน้าฟอนต์เพี้ยนเงียบ ๆ (Kanit ลบได้ ทุกหน้ามี `<link>` ครบ)
- ⏳ **รอ admin เลือกหัวข้อถัดไปใน [docs/ISSUES.md](docs/ISSUES.md)** — สถานะรายข้อดู [docs/FIX_TRACKING.md](docs/FIX_TRACKING.md)
