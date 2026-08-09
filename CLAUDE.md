# AuditNew — ระบบนับสต็อก / ตรวจสอบคลังสินค้า

Static HTML + vanilla JS + Supabase (UI ภาษาไทย) — ไม่มี build step, ไม่มี framework, ไม่มี test
เปิดไฟล์ HTML ตรง ๆ ในเบราว์เซอร์ · libraries จาก CDN (supabase-js v2, SheetJS, Lucide, Chart.js)

## กฎสำคัญ (Invariants) — ห้ามละเมิดเมื่อแก้โค้ด

1. **`inventory_counts` = หลักฐานผลนับ (immutable evidence)** — flow Reconcile แตะได้เฉพาะคอลัมน์ `cycle_id`; การแก้/ลบรายแถวต้องเขียน `inventory_audit_logs` เสมอ
2. **SKU normalize เป็น UPPERCASE + trim** ผ่าน `SkuUtils.normalizeSku` (`Js/sku-utils.js`)
3. **แถวซ้ำ (warehouse, sku, location, qty) เป็นข้อมูลถูกต้อง** — migration 011 ตั้งใจอนุญาต (นับซ้ำ/สองคนนับ/คนละรอบ) ใช้ `client_request_id` กัน retry แทน — ห้ามเขียนโค้ด block/ลบ "duplicate" ตาม key นี้
4. **cycle (`count_cycles`) เป็นแกนของ reconcile** — active cycle แชร์ผ่าน `localStorage.active_count_cycle_v1`; multi-warehouse เก็บเป็น `"A|B"`, ทุกคลัง = `'คลังทั้งหมด'`
5. **เวลา = Bangkok (+07)** — ใช้ helper ใน `Js/reconcile-shared.js`
6. **ห้าม commit key/credential** — ฝั่ง client ใช้ได้เฉพาะ anon/publishable key (`Js/api.js` ใช้ `sb_publishable_...` แล้ว มีเทสยาม [C1-guard] สแกน + `apiService.isServiceRoleKey()` ล้าง key admin ที่ค้างใน localStorage อัตโนมัติ) — service_role key เก่ายังอยู่ใน git history จนกว่า admin จะ revoke ใน dashboard
7. **ค่า dynamic ทุกตัวที่เข้า innerHTML/attribute ต้อง escape** — และ **ห้ามต่อค่าเข้า JS string ใน `onclick="fn('...')"` เด็ดขาด** แม้ escape แล้วก็ไม่ปลอดภัย (เบราว์เซอร์ decode entity ก่อน parse JS) ให้ใช้ `data-*` + `this.dataset` · เทส `tests/unit/xss-guard.test.mjs` บังคับกฎนี้อัตโนมัติ
8. ระวังลำดับ `<script>`: `Js/live-count-wall.js` ต้องมาหลัง `reconcile-shared.js`
9. **แก้ shared JS แล้วต้อง bump cache-buster ทุกที่** — shared JS ทุกตัวมี `?v=YYYYMMDDx` ในทุก HTML **และ** ต้อง bump `ASSET_VER` ใน `Js/sidebar-shared.js` ด้วย (ใช้กับไฟล์ที่ inject แบบ dynamic: chat-notify-shared.js, chat-notify.css) ถ้าไม่ bump เบราว์เซอร์จะใช้ไฟล์เก่าและการแก้จะไม่ถึงผู้ใช้ (เคยเกิดจริงตอนแก้ H1)
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

### เอกสารเดิม (มีส่วนล้าสมัย — ดูรายละเอียดใน ISSUES.md ข้อ L8)
- [docs/SYSTEM_GUIDE.md](docs/SYSTEM_GUIDE.md) — คู่มือระบบฉบับเดิม (⚠️ ส่วน book_explorer อธิบายฟิลเตอร์ที่ไม่มีจริง)
- [docs/RECONCILIATION_DESIGN.md](docs/RECONCILIATION_DESIGN.md) — แนวคิด reconcile ฉบับเดิม (⚠️ Phase 3 ระบุ "รอทำ" ทั้งที่เสร็จแล้ว, รายการ SQL ขาด 007-015, ไม่พูดถึง `reconciliation_match_acceptances`)
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
- ✅ **H4 + H9 เสร็จ** (2026-08-09): dashboard เลิกคูณ Book ต่อคลัง (`computeBookCoverage`) และแก้ `.range()` ที่เรียงไม่เสถียร 10 จุด (ต้องมี `.order('id')` เสมอ — เพราะ bulk insert ทำให้ `created_at` ซ้ำ) · **เทส 123 PASS**
- ✅ **H3 เสร็จ** (2026-08-09): `Js/audit-log.js` เขียน `inventory_audit_logs` ครบทุก mutation ในหน้า audit_check (เดิม 0 จุด) — ลบต้อง log ก่อน · แก้ flush ทุก 100 แถว · **เทส 113 PASS** · ส่วน atomic แยกเป็น M27
- ✅ **แก้ 401 "คำนวณ Match"** (2026-08-09): `refresh_reconciliation_for_cycle` เป็น SECURITY DEFINER ([018](docs/sql/018_refresh_reconciliation_security_definer.sql)) — RPC ไม่ข้าม RLS เองถ้าไม่ประกาศ definer
- ⏳ **รอ admin เลือกหัวข้อถัดไปใน [docs/ISSUES.md](docs/ISSUES.md)** — สถานะรายข้อดู [docs/FIX_TRACKING.md](docs/FIX_TRACKING.md)
