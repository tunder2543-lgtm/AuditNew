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
- [docs/PURPOSE.md](docs/PURPOSE.md) — **จุดประสงค์ระบบ + workflow 7 ขั้นตามที่ admin ใช้จริง + ตารางความสอดคล้อง + ข้อเสนอ UX/UI 10 ข้อ** (จัดทำ 2026-08-10 จากคำอธิบาย admin โดยตรง — อ่านก่อนตัดสินใจเชิงฟีเจอร์เสมอ)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — สถาปัตยกรรม, data flow, shared JS layer 16 ไฟล์, matrix การโหลดต่อหน้า, localStorage keys ทั้งหมด, เมนู sidebar
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
| `Html/adjust_history.html` | [docs/pages/adjust_history.md](docs/pages/adjust_history.md) | ประวัติการปรับ/ยืนยันของรอบ — ค้นหา/กรอง/เรียง/Export/คืนค่า |
| `Html/cycle_config.html` | [docs/pages/cycle_config.md](docs/pages/cycle_config.md) | สร้างรอบนับ + อัปโหลด BOOK + ผูกผลนับ |
| `Html/book_explorer.html` | [docs/pages/book_explorer.md](docs/pages/book_explorer.md) | ดู BOOK (อ่านอย่างเดียว) |
| `Html/dashboard.html` | [docs/pages/dashboard.md](docs/pages/dashboard.md) | สรุปภาพรวม 2 แท็บ (ความเร็วนับ / Match) |
| `Html/settings.html` | [docs/pages/settings.md](docs/pages/settings.md) | ตั้งค่า Supabase + registry คลัง |
| `Html/chat.html` | [docs/pages/chat.md](docs/pages/chat.md) | แชททีม + ระบบแจ้งเตือนข้ามหน้า |
| `Html/live_count_wall.html` | [docs/pages/live_count_wall.md](docs/pages/live_count_wall.md) | จอแสดงผลนับสด (realtime) |

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

- `.claude/agents/system-expert.md` — **ผู้เชี่ยวชาญระบบ** (ใหม่ 2026-08-10): รู้จุดประสงค์+workflow+invariants ใช้ตอบคำถามการใช้งาน/วิเคราะห์ผลกระทบ/สอนพนักงานใหม่ — เทสแล้วตอบถูกพร้อม path:line
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
  - **ค้นพบสำคัญ: `sku_master` ผูกกับหน้าเดียว** — `reconcile.html` เรียก `fetchSkuMasterNamesBySkus` ตอนกด "สร้างลง Book" · `index.html` grep คำว่า "master" = **0 hit** ใช้ `book_stock_lines` ล้วน → แก้เอกสาร 4 ไฟล์ที่บอกผิดมาตลอด · ⚠️ ที่บันทึกไว้ตอนนั้นว่า "มี fallback อยู่แล้ว" **ผิด** — `skuNameMap` ตายสนิท (ดูหัวข้อถอดฟีเจอร์ด้านล่าง) · **ฟีเจอร์นี้ถูกถอดออกทั้งหมดแล้ว 2026-08-10**
  - ✅ ชุด 6-9 ทำครบแล้ว 2026-08-11 · เหลือใน ISSUES L1/L2: Dashboard modal ใน `index.html` ที่เข้าถึงไม่ได้ (+ Chart.js CDN ที่โหลดฟรี), `dashboard.html` `bookSku` write-only, `settings.html:392` `window.RS` ที่ไม่มีอยู่จริง, `reconcile.html` `renderImportPreview`/`adjInputMode`, `db-errors.js` `SERIALIZATION`
  - ⛔ **ห้ามลบ `@import` ฟอนต์ Outfit ใน `Css/style.css:1`** — มี `<link>` แค่ 4/13 หน้า แต่ CSS ใช้ `'Outfit'` 12 จุดที่ยัง live → อีก 9 หน้าฟอนต์เพี้ยนเงียบ ๆ (Kanit ลบได้ ทุกหน้ามี `<link>` ครบ)
- ✅ **ถอดฟีเจอร์ SKU Master ออกจากเว็บ เสร็จ** (2026-08-10): ลบ `Html/sku_master.html` + เมนู + lookup ทั้งหมด — **ตาราง `sku_master` ยังอยู่ใน Supabase ครบ 1,179 แถว (มติ admin ห้ามลบ)** ไม่มีโค้ดใดเรียกอีก · หน้าเว็บ 13 → **12** · **เทส 261 PASS**
  - ⚠️ **บทเรียน:** `reconcile.html` เขียน `namePro: masterNames[sku] || skuNameMap[sku] || null` ดูเหมือนมี fallback แต่ **ตายสนิท** (`canAddToBookLine` บังคับ `!bookSkuSet.has(sku)` และทั้ง 2 map มาจาก `book_stock_lines` ของ cycle เดียวกัน) — ตัด lookup ทิ้งเฉย ๆ = `name_pro` เป็น null 100% เขียนลง DB ถาวร · แหล่งใหม่คือ `fetchBookNamesBySkusAnyCycle` อ่าน `book_stock_lines` ข้ามรอบ (กว้างกว่าเดิม + ปิดบั๊ก query ไม่กรอง warehouse)
  - ⚠️ กลุ่มเมนูที่เหลือ 0 รายการจะกลายเป็นหัวข้อพับที่กดแล้วว่าง — ลบ item สุดท้ายต้องลบทั้งกลุ่ม · มีเทส `[menu-guard]` × 4 บังคับแล้ว
- ✅ **M4 เสร็จ** (2026-08-10): `parseBookExcelRows` เลิกใช้ `normalizeSku` กับ **ชื่อสินค้า** (invariant ข้อ 2 เป็นมาตรฐานของ *รหัส SKU* เท่านั้น) — คอลัมน์ SKU ยัง UPPERCASE เหมือนเดิม มีเทสบังคับ · เทสย้ายจาก knownIssue → ถาวร 3 ข้อ · **267 PASS / 2 KNOWN-OPEN**
  - ⚠️ **แก้โค้ดไม่ได้แก้ข้อมูลเก่า** — แถว `book_stock_lines.name_pro` ที่นำเข้าไปแล้วยังเป็น ALL CAPS · จะล้างต้องอัปโหลดไฟล์ Book ทับ (โหมด replace) หรือ UPDATE ใน DB
- ✅ **ถอด checkbox "ทุกช่วงเวลา" + ถอดหน้าคู่มือ + dead code ชุด 6-9 เสร็จ** (2026-08-11): audit_check เหลือกรองตามคลัง+เดือนเสมอ · ลบ `Html/user_manual.html` + `Js/manual-editor.js` + `assets/manual/` (`assets/` 4 MB → 16 KB) — **หน้าเว็บ 12 → 11** · `reconcile-shared.js` ลบ 6 ฟังก์ชันตาย (export 85→79) · `style.css` −208 บรรทัด · `ASSET_VER` `20260811b`
  - 🔴 **บทเรียน**: ลบ `const btn` แต่ลืมบรรทัด `if (btn) btn.disabled = false;` ใน `finally` → `ReferenceError` ทำ pipeline ตรวจสอบใน audit_check ตายทั้งหน้า **โดยเทส 267 ข้อผ่านหมด** (ไม่มีเทสไหนรัน inline script ของ HTML) · code-reviewer จับได้ · **แตะ `audit_check.html` เมื่อไหร่ ต้อง smoke หน้านั้นเสมอ** — เพิ่มเข้า Smoke Checklist แล้ว
- ✅ **PURPOSE.md + system-expert agent + Note ส่งมอบ** (2026-08-10 เย็น): เทสระบบ 267 PASS + smoke ผ่าน · งานถัดไป (ถอดคู่มือ + checkbox "ทุกช่วงเวลา" + dead code ชุด 6-9) **แผน+impact ครบแล้ว**ที่ [docs/notes/2026-08-10_handoff.md](docs/notes/2026-08-10_handoff.md)
- ✅ **ชุดแก้บั๊ก 2 "รอบต้องถูกต้อง" เสร็จ** (2026-08-11): **M19** `encodeCycleWarehouses` เพิ่ม tiebreak (ชุดคลังเดิมต้อง encode ได้ค่าเดิมเสมอ ไม่งั้นเกิดรอบซ้ำ) · **M24** รอบที่ปิดแล้วไม่รับผลนับใหม่ — `isCycleClosed()` + guard ใน `isCycleRelevantNow` **และ**กรองออกจาก dropdown หน้านับ (ต้องทำคู่กัน) · **M1** `cycle_config`/`count_search` เลิกใช้ `.limit(10000/8000/5000)` ซึ่ง Supabase ตัดเหลือ 1,000 **เงียบ ๆ** → helper กลาง `fetchCountMonths` / `fetchCountDaysInMonth` · **เทส 296 PASS / 1 KNOWN-OPEN**
  - ⛔ **`fetchCountMonths` ห้ามส่งค่าคลังดิบเข้า RPC** — RPC `get_inventory_count_months` เทียบ `warehouse = p_warehouse` ตรง ๆ จึงรับได้แค่**ชื่อคลังจริงตัวเดียว** ค่าที่ call site ส่งมาเป็นค่า encode (`'คลังทั้งหมด'` / `'A|B'`) ต้องผ่าน `parseCycleWarehouses()` แล้วยิงทีละคลัง · เคยพลาดจริงในชุดนี้ = โหมดทุกคลังได้ **0 เดือน** ทั้งที่มีข้อมูลเป็นหมื่นแถว (review จับได้ เทสไม่จับเพราะยิงแต่คลังเดี่ยว)
  - ⚠️ **แบ่งหน้าต้องเดินตามจำนวนแถวที่ได้จริง** (`from += rows.length`) ไม่ใช่บวกทีละ page size — ถ้า PostgREST ตั้ง max-rows ต่ำกว่าที่ขอ การบวกคงที่จะข้ามแถวกลางหายเงียบ ๆ
  - 🧪 **`tests/helpers/lift.mjs` ใหม่** — ยกฟังก์ชันจากซอร์สจริงมารันใน `vm` · **เทสที่อ่านซอร์สไม่ใช่เทสยาม** (พลาดครั้งที่ 4 ในโปรเจกต์นี้: review ลบ `.filter()` ที่ใช้จริงโดยเก็บบรรทัดประกาศไว้ แล้วเทสเขียวหมด) · และ **เทสที่มองแค่ไฟล์ที่เพิ่งแก้ก็ไม่ยาม** — `.limit()` scan ต้องสแกนทั้ง repo ไม่งั้นไม่เห็นหน้าอื่นที่บั๊กเดียวกัน
  - เปิดใหม่จาก review: **M33** (ลำดับคลังใน registry เปลี่ยนได้ = ยังสร้างรอบซ้ำได้ ส่วนที่เหลือของ M19) · **M34** (`audit_check` มี `fetchAvailableMonths` ซ้ำ helper ทั้งดุ้น)
- ✅ **ชุดแก้บั๊ก 3 "ตัวเลขหน้า Match" เสร็จ + รัน migration จริง** (2026-08-11): **M2** สถานะ DB ตรงกับหน้าเว็บแล้ว — `count_only` ต้องแปลว่า "ไม่มีบรรทัดใน Book" ไม่ใช่ "ยอด Book = 0" ([020](docs/sql/020_match_status_count_only_in_book.sql) เพิ่ม `in_book` เข้า CTE) · **M18** `%` คำนวณใหม่ตาม draft (เดิมอ่านค่าค้างจาก DB ทำให้ 2 ช่องในแถวเดียวขัดกัน) · **M3** "ต่าง" คืนทิศทางแทนขนาด (ขาด = ลบ) ทั้งตาราง + Export ทั้ง 2 ชีต · **เทส 309 PASS / 0 FAIL / 0 KNOWN-OPEN** (ครั้งแรกที่ไม่เหลือ KNOWN-OPEN)
  - ⛔ **`CREATE OR REPLACE FUNCTION` เขียนทับ attribute ทั้งชุด** — `SECURITY DEFINER`/`SET search_path` ที่ 018 ตั้งด้วย `ALTER` จะหายถ้าไม่ประกาศซ้ำ แล้ว "คำนวณ Match" จะ 401 ทันที (invariant ข้อ 12) · owner/GRANT/COMMENT ไม่หาย เพราะ oid เดิม · **มีเทสบังคับแล้ว**
  - ⚠️ **`docs/sql/002` และ `003` ถือฟังก์ชันนี้เวอร์ชันเก่า** — ถ้าตั้งฐานใหม่ `020` ต้องเป็นตัวสุดท้ายของสายนี้เสมอ
  - 🔴 **บทเรียน: เทสที่สแกนไฟล์ SQL แทบไม่ยามอะไรเลย** — รุ่นแรกปล่อย mutant รอด 3 แบบ (สลับ over↔count_only, ลบสาขา `book_only`, ลบ `UPDATE book_stock_lines`) ตัวหนึ่งรอดเพราะ `indexOf` คืน `-1` แล้ว `slice(start, -1)` กลายเป็นเกือบทั้งไฟล์ ⇒ **แปล `CASE` จาก SQL เป็นฟังก์ชัน JS แล้วรันเทียบ `computeMatchStatus` ทุกเคส** + diff body กับ 013 ว่าต่างเฉพาะ hunk ที่ตั้งใจ
  - ⚠️ **`stock_adjustments.variance_before` เปลี่ยน convention** — แถวก่อน 2026-08-11 เก็บขนาด (ขาดเป็นบวก) แถวใหม่เก็บทิศทาง (ขาดเป็นลบ) · คอลัมน์นี้ write-only แต่ถ้าทำรายงานย้อนหลังต้องแยกตามวันที่
  - ผลกับข้อมูลจริง: 77 แถวเปลี่ยน `count_only` → `over` · ไม่มีแถวหาย/เพิ่ม · `variance_qty`/`variance_pct` ไม่ขยับเลย · การ์ด "ความต่าง (ชิ้น)" ของ dashboard เพิ่ม 411 ชิ้น (2026-08) — ย้ายมาจากช่องที่จัดประเภทผิด ไม่ใช่ข้อมูลใหม่
  - เปิดใหม่จาก review: **M35** (`renderTable` สแกน `adjustmentsCache` ~7 รอบต่อแถว)
- ✅ **ชุดแก้บั๊ก 4 "หน้า audit_check" เสร็จ** (2026-08-11): **M12** guard กันชนปลายทาง **ถาม DB จริงข้ามคลัง/เดือน** แล้ว (เดิมดูแต่ `refBySkuLoc` ที่โหลดเฉพาะ scope ที่เลือก ⇒ ชนกับแถวนอก scope แล้วปล่อยผ่าน = แถวซ้ำจริงในรอบเดียวกัน ขัด invariant ข้อ 3) · **M13** สลับ SKU↔ตำแหน่ง normalize ทั้งสองฝั่ง · **M34** ยกโค้ดอ่านเดือน/วันเป็น `Js/count-scan-shared.js` ใช้ร่วมกัน · **M11** ปิดไปแล้วพร้อม M1 · **เทส 321 PASS / 0 FAIL / 0 KNOWN-OPEN**
  - ⛔ **`Js/count-scan-shared.js` ต้องโหลดก่อน `reconcile-shared.js` ทุกหน้า** (invariant ข้อ 8) — reconcile-shared delegate ไปหามัน · มีเทสบังคับลำดับ
  - ⚠️ **กรอง `location` ฝั่ง DB ไม่ได้** — ฐานจริงมีตำแหน่งตัวพิมพ์เล็ก 142 แถว (270 ตำแหน่ง เหลือ 269 หลัง normalize) `.in('location', ...)` จะพลาดแถวที่ต่างแค่ตัวพิมพ์ · กรอง `sku_id` ฝั่ง DB ได้เพราะ normalize แล้วตาม invariant ข้อ 2
  - ⚠️ **ตรวจปลายทางไม่สำเร็จ = บล็อกทั้งชุด** — "ตรวจไม่ได้" ไม่เท่ากับ "ไม่ชน"
  - ⚠️ **M13 แก้ได้แค่ครึ่งเดียวโดยธรรมชาติ** — ตัวพิมพ์เดิมของตำแหน่งหายตั้งแต่สลับรอบแรก เพราะมันกลายเป็น SKU ที่ต้อง UPPERCASE · รับประกันได้แค่ "ตั้งแต่รอบ 2 เป็นต้นไปนิ่ง"
  - 🔴 **บทเรียน: เทสอ่าน field ผิดที่แล้วผ่านแบบว่างเปล่า** — mock เก็บ `eq/in/gte` ใน `filters` แต่ `order/range` ใน `modifiers` · ข้อ "ห้ามกรอง scope" จึงเช็คกับ array ว่าง เจอตอน mutation ไม่ใช่ตอนเขียน
  - 🔴 **บทเรียน: `\\s` ในสตริงที่เอาไปสร้าง RegExp หายเงียบ ๆ** — ``new RegExp(`\\s+`)`` กลายเป็น `s+` (JS ตัด escape ที่ไม่รู้จักทิ้ง) แล้วเทสผ่านแบบว่างเปล่า ⇒ **ห้ามสร้าง RegExp จากสตริงในเทส** ใช้ literal หรือ `lastIndexOf`
  - ⚠️ **guard ต้องสมมาตร** — M12 รอบแรกเปิดตาให้ฝั่ง "ปลายทาง" เห็นทั้งฐาน แต่ฝั่ง "แถวที่กำลังย้าย" ยังอ่านรอบจาก memory ซึ่งไม่มีแถวที่ `location` ว่าง (`loadReferenceData` ข้าม) — และนั่นคือแถวที่คนเปิดโหมด "แก้ไขตำแหน่ง" มาเติมพอดี
  - ⚠️ **`cycle_id = null` ไม่ได้แปลว่า "รอบเดียวกัน"** — `cycleKey(null)` เป็นค่าเดียวทั้งฐาน · พอ guard เห็นทั้งฐาน แถวปีที่แล้วจะบล็อกงานเดือนนี้ · FK เป็น `ON DELETE SET NULL` ทำให้เกิดง่ายมาก · จำกัดด้วยเดือนไทย
  - ⚠️ **`inventory_counts` ไม่มี index บน `sku_id`** — เปิด M36 ไว้ · ระหว่างนี้แคบด้วย `.in('counted_qty', ...)`
- ✅ **ชุดแก้บั๊ก 5 "หน้านับสต็อก" เสร็จ** (2026-08-11): **M8** guard ตอนแก้ไขผิด 2 ชั้น — บล็อกงานที่ถูกต้อง (นับแยกถุง ขัด invariant ข้อ 3) **และ** ปล่อยงานที่ผิดจริงผ่าน (ดูแต่ `allRecords` ของ scope ปัจจุบัน) · ตอนนี้ถาม DB จริงและใช้ `AuditDedupe.classifyDestinationCollision` **ตัวเดียวกับ audit_check** · **M10** KPI แสดง `—` แทน 0/0% ระหว่าง Book โหลด (แก้ markup ด้วย) · **M32** circuit breaker หยุดเมื่อเน็ตตายติดกัน 3 ครั้ง · **เทส 348 PASS / 0 FAIL / 0 KNOWN-OPEN**
  - ⛔ **เกณฑ์ "ซ้ำจริง" ต้องอยู่ที่เดียว** — `index.html` โหลด `Js/audit-dedupe.js` แล้ว ห้ามเขียนกติกาซ้ำในหน้าไหนอีก (บทเรียนเดียวกับ M34)
  - ⚠️ **guard ที่ตัดสินจาก cache ของ scope ปัจจุบัน = ไม่ deterministic** — ผู้ใช้เลือกคลังคนละอันได้คำตอบคนละอย่าง (บั๊กเดียวกับ M12 คนละหน้า)
  - ⚠️ **M10 ต้องแก้ค่าเริ่มต้นใน HTML ด้วย** — ก่อน JS รันผู้ใช้ก็เห็นค่าใน markup อยู่แล้ว
  - ⚠️ **แถวที่ circuit breaker ข้าม ต้องพา `client_request_id` เดิมไปด้วย** ไม่งั้นกด "นำเข้าแถวที่เหลือ" แล้วแทรกซ้ำ (บั๊ก M6 กลับมาทางอ้อม)
  - 🔴 **บทเรียน M1 ซ้ำรอบที่ 3** — query ของ guard ต้องแบ่งหน้าเสมอ · เรียง `id` ขึ้นแล้วโดนตัดที่ 1,000 = **แถวใหม่สุดหาย** ซึ่งคือแถวที่ guard มีไว้จับพอดี · และต้องมีเพดานรอบกันลูปไม่จบ
  - 🔴 **เปลี่ยนฟังก์ชันเป็น async = สร้าง race ใหม่** — `handleEdConfirm` ต้องมี `edBusy` + `edGeneration` + ยาม stale หลัง await ทุกจุด ไม่งั้นกดยกเลิกแล้วเปิดแถวอื่นระหว่างรอ = เขียน **audit log ของการแก้ไขที่ไม่เคยเกิด**
  - 🔴 **เทส regex ล้วนยามไม่ได้ (ครั้งที่ 5)** — `const bookPending = false;` ผ่านเทส M10 ทั้ง 3 ข้อ ⇒ ต้องยกฟังก์ชันมารันจริง · `tests/helpers/lift.mjs` ยก `window.f = function` ได้แล้ว
  - ⚠️ **คืนค่าสถานะมาแล้วต้องมีคนอ่าน** — `aborted` เคยเป็น write-only ทั้ง 2 หน้า circuit breaker จึงแทบไม่ได้ผล
- 🔴 **บั๊กที่หลุดถึงผู้ใช้จริง 2026-08-11 (ครั้งที่ 2 ในโปรเจกต์)** — `submitGroup` โยน `ReferenceError: one is not defined` ⇒ **บันทึกผลนับแบบกลุ่มไม่ได้เลย** · สาเหตุ: ใช้ `one.aborted` นอกบล็อก `else` ที่ประกาศ `const one`
  - **ทำไมเทส 348 ข้อผ่านหมด**: เทสยกเฉพาะ `insertGroupRowsOneByOne` (ลูก) มารันจริง ส่วน `submitGroup` (แม่ ที่บรรทัดพังอยู่) มีแต่เทสอ่านซอร์ส · `new Function(src)` ตรวจแค่ syntax — ตัวแปรผิด scope เป็น runtime error
  - **วัดแล้ว**: ฟังก์ชันที่แก้ในชุด 1–5 มี **88 จุด · มีเทสรันจริงแค่ 29** (ที่เหลือมีแต่เทสอ่านซอร์ส) — เสี่ยงแบบเดียวกันทั้งหมด
  - เพิ่ม `tests/unit/scope-guard.test.mjs` — **รัน `submitGroup` + `handleEdConfirm` จริงทั้ง 2 เส้นทาง** (พิสูจน์แล้วว่าเอาบั๊กกลับมาแล้วแดง)
  - ⚠️ **`tests/helpers/lift.mjs` เคยยกผิดฟังก์ชันเงียบ ๆ** — `includes('function handleEdConfirm')` ไปแมตช์ `handleEdConfirmInner` · เพิ่มเช็คขอบคำแล้ว
  - ⛔ **กติกาใหม่: แก้บรรทัดในฟังก์ชันไหน ต้องมีเทสที่ *รัน* ฟังก์ชันนั้น** ไม่ใช่แค่เทสที่อ่านซอร์สของมัน
  - ✅ **ปิดช่องปุ่มที่เขียนข้อมูลครบทั้ง 5 ตัวแล้ว** — `tests/unit/write-path-runtime.test.mjs` รัน `applySwapSkuLocSelected` · `saveLocationChanges` · `applyLocCompareUpdates` · `runImport` จริง (คู่กับ `scope-guard` ที่รัน `submitGroup` + `handleEdConfirm`) · mutation 6 แบบแดง 5 (อีก 1 พิสูจน์แล้วว่าเป็น no-op — flush audit log กลางลูปหายไปแต่ตัวปิดท้ายยังบังคับเขียนอยู่)
  - ตัวเลขล่าสุด: ฟังก์ชันที่แก้ในชุด 1–5 มี 90 จุด **มีเทสรันจริง 36** (เดิม 29) — ที่เหลือส่วนใหญ่เป็น helper เล็ก ๆ ที่ไม่เขียน DB
  - ⚠️ **`deepStrictEqual` ใช้ข้าม realm ของ `vm` ไม่ได้** — object ที่สร้างใน sandbox มี prototype คนละตัว · เทียบผ่าน `JSON.stringify` แทน (เจอซ้ำครั้งที่ 2)
- ✅ **ฟีเจอร์ใหม่: ตรวจ "ซ้ำข้ามตำแหน่ง"** (2026-08-11, admin เจอด้วยตาก่อน): SKU เดียวกัน **จำนวนเท่ากันเป๊ะ** แต่คนละตำแหน่ง ในรอบ+คลังเดียวกัน → สถานะใหม่ `crossloc` (ม่วง) ใน `Html/audit_check.html` · ตัวตรวจอยู่ที่ `AuditDedupe.findCrossLocationDuplicates` · **เทส 389 PASS**
  - **เป็นการนับซ้ำจริง** — ยืนยันกับฐาน: `PK089` 256 ชิ้นทั้งที่ K3-03 และ L4-03 (Book 258 ⇒ Match เกิน 254) · เป็นชุด K3-0x/L4-0x = ชั้นเดียวกันถูกนับ 2 ป้าย · ทั้งฐาน 105 กลุ่ม / 211 แถว
  - **ต่างจาก "ทับซ้อน"** — ทับซ้อน = ตำแหน่งเดียวกัน จำนวนต่างกัน · อันใหม่ = ตำแหน่งต่างกัน จำนวนเท่ากัน · `SUM` ต่อ SKU ต่อรอบไม่สนตำแหน่ง จึงบวกซ้ำเต็มจำนวน
  - ⚠️ **เตือนอย่างเดียว ห้ามแนะนำให้ลบ** (นโยบายข้อ 3) — มีเทสบังคับว่าข้อความห้ามมีคำว่าลบ · ปิดเสียงผ่านปุ่ม "ยืนยันว่าปกติ" เดิม คีย์ = `ตำแหน่งทั้งหมด@จำนวน`
  - กดการ์ดแล้ว**จับคู่ให้อยู่ติดกันอัตโนมัติ** (โหมดเรียง `crossloc` + เส้นคั่น) — เดิมคู่ของ PK011 อยู่แถว 941 กับ 1005 คนละหน้าจอ
- ✅ **ปุ่ม "Export ยอดจริง" + กู้คืนการยืนยันรอบ 2026-08** (2026-08-11 บ่าย): admin ลบแถวซ้ำแล้วขอเริ่มยืนยันขาด-เกินใหม่ → ลบ acceptances 168 แถว + ยอดปรับ 2 แถวของรอบนี้ (log `RECONCILE_ADJ_CLEAR` ก่อนลบ · รอบเก่า 733 รายการไม่แตะ) แล้ว refresh · ฟีเจอร์ใหม่: ชีต `ยอดจริง` บอกต่อ SKU ว่าเชื่อเลขไหน (`buildFinalQtyExportRows`) — **แถวที่ยังไม่ตัดสินเว้นช่องว่าง ไม่เดาแทนคน** · เทส 397 PASS
  - ⚠️ **ความหมายของปุ่มยืนยันในหน้า Match**: "ยืนยันเป็นถูกต้อง (ไม่ปรับยอด)" = ยอด Excel คือยอดจริง (เขียน `reconciliation_match_acceptances`) · "ยอมรับผลนับ (Apply)" = ผลนับคือยอดจริง (สร้าง+Apply `stock_adjustments`) — สองตารางนี้คือแหล่งความจริงของ "การตัดสิน" ทั้งหมด
- ✅ **โหมด "แก้ไขจำนวน" ใน audit_check** (2026-08-11 เย็น): โครงเดียวกับโหมดแก้ตำแหน่งทุกจุด — ยืนยัน 2 ขั้น + guard M12 + `AUDIT_EDIT_QTY` ลง audit log ทุกแถว + ออกจากโหมดแล้ว re-verify (สถานะไม่ค้างที่ "ตำแหน่ง/จำนวนไม่ตรง") · โหมดแก้ไขเปิดได้ทีละอย่าง · **เทส 407 PASS**
  - ⚠️ การแก้จำนวนโดย**คน**ผ่านยืนยัน 2 ขั้น + audit log ไม่ขัดนโยบายข้อ 3 (ที่ห้ามคือ**ระบบ**แก้เอง) — เส้นทางเดียวกับโหมดแก้ตำแหน่งที่มีมาก่อน
  - 🔴 **ReferenceError รอบที่ 3 ของวัน (smoke จับได้ก่อน commit)** — อ้าง `qtyInput` ใน scope ที่ไม่มี ⇒ `createRow` พังทุกแถว ตารางว่างทั้งหน้า · เทส [ui] regex 9 ข้อผ่านหมดเพราะไม่มีข้อไหนรัน `createRow` ⇒ เพิ่มเทสรัน `createRow` จริงแล้ว · **แตะ `createRow`/listener ของตาราง = ต้อง smoke ตารางโหลดขึ้นเสมอ**
- ✅ **reconcile: "ยอมรับเกิน/ขาด (Apply เป็นชุด)" + "ประวัติ / คืนค่า"** (2026-08-11 ค่ำ): เลือกรายการตามเพดานค่าต่าง (เกิน +1..+N · ขาด −1..−N ใช้ `selectRowsForBulkAccept(mode)` ตัวเดียว · ปุ่มโผล่เฉพาะโหมดตัวเอง) → ดูรายการ/Export → ยืนยัน 2 ขั้น → batch create + `applyAllDraftsForCycle` (refresh ครั้งเดียว) · โมดัลประวัติดึงสดจาก DB คืนค่าผ่าน `clearAdjustmentsAndMatchAcceptancesForSkus` (H6) แล้ว `runRefresh()` เต็ม · **เทส 418 PASS**
  - ⛔ **`apply_all_drafts_for_cycle` Apply ทุก draft ของรอบ** — flow แบบชุดต้องบล็อกเมื่อมี draft ค้าง ไม่งั้นพ่วง draft ที่ไม่เกี่ยวไปด้วย (มีเทสบังคับ)
  - ⚠️ **คืนค่า = ต่อ SKU ทั้งการตัดสิน** (ยอดปรับ+การยืนยันของ SKU นั้นในรอบ) ไม่ใช่ต่อรายการ log — ผลนับไม่ถูกแตะ · เขียน `RECONCILE_ADJ_CLEAR` ก่อนลบเสมอ
- ✅ **หน้าใหม่ "ประวัติการปรับ / ยืนยัน"** (2026-08-13): แยก modal เดิมของ reconcile ออกเป็นหน้าเต็ม [`Html/adjust_history.html`](docs/pages/adjust_history.md) — ค้นหา SKU · กรอง 5 เกณฑ์ (ประเภท/SKU/รายละเอียด/ช่วงวัน/ช่วงจำนวน) · เรียง 4 คอลัมน์ · Export Excel+CSV · คืนค่า · หน้าเว็บ 11 → **12** · **เทส 459 PASS / 0 FAIL** (baseline 425) · **mutation 6 แบบแดงครบ 6**
  - modal เดิมใน reconcile **คงไว้ทั้งหมด** เพิ่มแค่ปุ่ม "เปิดหน้าเต็ม" (`?cycle=<id>`) — ไม่แตะของเดิม = ไม่เสี่ยงกับปุ่มคืนค่าที่ใช้อยู่
  - ⛔ `buildAdjustHistoryEntries` ย้ายจาก inline ใน `reconcile.html` ขึ้น `Js/reconcile-shared.js` — **ห้ามคัดลอกกลับไปไว้ในหน้า** (บทเรียน M34 / M8) · เพิ่ม field ดิบ `qty` / `status` / `note` ให้ filter/sort ใช้ โดย `detail` ยังคำนวณจาก field เดิม ⇒ ข้อความบน 2 หน้าจอตรงกันเป๊ะ
  - ⚠️ **`now instanceof Date` ใช้ข้าม realm ไม่ได้** — Date จาก vm ของเทส (หรือ iframe) ไม่ผ่าน instanceof แล้ว **เงียบ ๆ ตกไปใช้เวลาปัจจุบัน** แทนค่าที่ส่งมา · เทสจับได้ตอนแรก ⇒ ใช้ `new Date(now)` แทน (เจอ cross-realm เป็นครั้งที่ 3 ต่อจาก `deepStrictEqual`)
  - ⚠️ **หน้าที่มี filter + ปุ่มลบ/คืนค่า = ความเสี่ยงใหม่ที่ modal เดิมไม่มี** — "เลือกทั้งหมด" ต้องเลือกเฉพาะแถวที่เห็นหลังกรอง และเปลี่ยน filter/sort/รอบต้องล้าง selection ทิ้ง ไม่งั้นกดคืนค่า SKU ที่มองไม่เห็น · selection เก็บเป็น `Set` ไม่ใช่อ่านจาก DOM ตอนกด (render ใหม่แล้ว checkbox หาย)
  - ⚠️ ชื่อไฟล์ Export ต้อง sanitize `\ / : * ? " < > |` — รอบหลายคลังเก็บ warehouse เป็น `"A|B"` ซึ่งเป็นอักขระต้องห้ามบน Windows พอดี
  - smoke จริงบนข้อมูลรอบ 2026-08: 656 รายการ / 624 SKU · filter/sort/deep-link/selection-guard ผ่าน · modal เดิมยังให้ผลเหมือนเดิมเป๊ะ (656 แถว ข้อความตรงกัน)
- ⏳ **รอ admin เลือกหัวข้อถัดไปใน [docs/ISSUES.md](docs/ISSUES.md)** — สถานะรายข้อดู [docs/FIX_TRACKING.md](docs/FIX_TRACKING.md)
