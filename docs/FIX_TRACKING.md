# FIX_TRACKING — ระบบติดตามการแก้ไข + ตรวจจับ Regression

> ตอบโจทย์: *"แก้จุดนี้แล้ว จุดนี้ทำงานได้ แต่อีกจุดเสียแทน"* — ทุกการแก้ต้องรู้ว่า (1) แก้สำเร็จจริงไหม (2) ไปทำอะไรพังหรือเปล่า
> ใช้คู่กับ [ISSUES.md](ISSUES.md) (รายการบั๊ก) และ [tests/](../tests/README.md) (ระบบเทส Dry Run)

---

## Workflow บังคับ ทุกครั้งที่แก้โค้ด

```
1. ก่อนแก้   node tests/run.mjs --json > baseline.json     ← เก็บสถานะก่อนแก้
2. แก้โค้ด   (แก้ทีละ issue — อย่ารวมหลาย issue ใน commit เดียว)
3. หลังแก้   node tests/run.mjs                            ← ดูผล
4. อ่านผล:
   ├─ 🎉 KNOWN-FIXED [รหัส issue ที่แก้]  = แก้สำเร็จ → ทำข้อ 5
   ├─ ❌ FAIL ตัวใหม่ที่ไม่เคยพัง          = ⚠️ REGRESSION! การแก้ไปพังของเดิม
   │                                        → ห้ามไปต่อ แก้ให้เขียวก่อน หรือ revert
   └─ 🟡 KNOWN-OPEN เท่าเดิม              = ปกติ (บั๊กอื่นที่ยังไม่ถึงคิว)
5. เมื่อ KNOWN-FIXED:
   a. ย้ายเทสนั้นจาก knownIssue() → test()   ← กลายเป็นยามกัน regression ถาวร
   b. อัปเดตตารางสถานะข้างล่าง + ติ๊ก [x] ใน ISSUES.md
6. ทดสอบมือตาม checklist ของ "หน้าที่ได้รับผลกระทบ" (ดู Impact Map)
7. ให้ code-reviewer agent ตรวจ diff ก่อน commit
```

**กติกาเหล็ก:** เทสทั้งหมดเป็น **Dry Run** — ห้ามเขียนเทสที่ต่อ Supabase จริง ห้ามแก้/เพิ่ม/ลบข้อมูลหรือโครงสร้าง DB ในการเทสเด็ดขาด

---

## ตารางสถานะการแก้ไข

สถานะ: ⬜ รอ admin เลือก · 🔧 กำลังแก้ · ✅ แก้แล้ว(เทสผ่าน) · ⚠️ แก้แล้วแต่เกิด regression · 🚫 ไม่แก้ (ยอมรับ)

| Issue | เรื่อง | สถานะ | เทสคุ้มกัน (อัตโนมัติ) | ไฟล์ที่ต้องแตะ | จุดเสี่ยงพังตาม (ดู Impact Map) |
|---|---|---|---|---|---|
| C1 | service_role key ใน api.js | ✅ **ปิดงานสมบูรณ์** (โค้ด + RLS + revoke key เก่าแล้ว) | ✅ `unit/no-secret-keys` [C1-guard] + เทส migration 3 ข้อ | `Js/api.js`, `Js/settings-shared.js`, `Html/settings.html`, `docs/sql/016_rls_policies.sql` | **ทุกหน้า** — ทดสอบจริงผ่านแล้ว |
| C2 | Stored XSS หลายจุด | ✅ **เสร็จ** | ✅ `unit/xss-guard` × 7 (สแกน source อัตโนมัติ) | script.js, sidebar-shared, + escape ทุกไฟล์ 14 ตัว, settings/audit_check/sku_master/import_counts/count_search/book_explorer/dashboard | ทดสอบ payload จริงในเบราว์เซอร์แล้ว ไม่ execute |
| M25 | `getClient()` สร้าง client ใหม่ทุกครั้ง | ✅ **เสร็จ** | ✅ `unit/api-client-cache` × 3 | `Js/api.js` | **ทุกหน้า** — เดิม 6 GoTrueClient warning/โหลด เหลือ 0 |
| H1 | cycle_id เดือนเก่าค้าง | ✅ **เสร็จ** | ✅ `dryrun/active-cycle` [H1-guard] × 6 | `Js/reconcile-shared.js`, `Js/script.js`, `Js/sidebar-shared.js`, `Html/import_counts.html` + cache-buster ทุกหน้า | ทดสอบครบ 8 หน้าที่ใช้ reconcile-shared แล้ว |
| H2 | audit_check dedupe ลบข้อมูลถูกต้อง | ✅ **เสร็จ** | ✅ `unit/audit-dedupe` × 19 | `Js/audit-dedupe.js` (ใหม่), `Html/audit_check.html` | audit_check ทั้งหน้า — ทดสอบกับข้อมูลจริง 6,078 แถวแล้ว |
| H10 | audit_check ไม่เตือนแถวที่บวกซ้ำในรอบเดียวกัน (ผลข้างเคียงของ H2) | ✅ **เสร็จ** | ✅ `unit/audit-dedupe` [H10] × 13 | `Js/audit-dedupe.js` (+`classifyCycleDuplicate`), `Html/audit_check.html` (verifyRow/formatRefNote/classifyRefDuplicates + cache-buster `k`) | audit_check: กล่องสถิติ "ผิดพลาด" + ฟิลเตอร์สถานะ · ปุ่มลบอัตโนมัติ **ไม่เปลี่ยนพฤติกรรม** (ยังใช้กฎ H2) |
| H12 | ปุ่ม "ลบแถวที่กดบันทึกซ้ำ" ไม่เคยเลือกเคสอย่าง PC700 (ใช้กฎเข้มของ H2) | ✅ **เสร็จ** | ✅ `unit/audit-dedupe` [H12] × 10 | `Js/audit-dedupe.js` (+`findSameCycleDuplicates`), `Html/audit_check.html` (`dedupeInventoryCountsInDb` + ข้อความ popup 2 ขั้น + tooltip) | **ปุ่มลบข้อมูลจริง** — เกณฑ์กว้างขึ้น ต้องอ่าน popup ให้ครบก่อนกด · ข้ามกลุ่มที่ยืนยันว่าปกติแล้วเสมอ · กฎเดิม `findAccidentalDuplicates` ยังอยู่แต่ไม่ใช่ตัวตัดสินการลบแล้ว |
| ACK | ระบบต้อง "แจ้งให้คนยืนยัน" แทนการตัดสินลบเอง (นโยบาย admin) | ✅ **เสร็จ** | ✅ `unit/audit-book-impact` [ACK] × 5 | `docs/sql/019` (ใหม่ — **รันแล้ว 2026-08-10**), `Js/audit-book-impact.js` (+`classifyAcceptance`), `Html/audit_check.html` (ปุ่ม "ยืนยันว่าปกติ" + โหลด acceptances + หน้าประวัติการแก้ไข/ลบ) | ถ้ายังไม่รัน 019 ปุ่มยืนยันจะใช้ไม่ได้ (หน้าเตือนเอง) ส่วนอื่นทำงานปกติ · การยืนยันมีผลกับทั้งสถานะบนจอ **และ** การเลือกของปุ่มลบ |
| H11 | audit_check มองไม่เห็นแถวทับซ้อน (ตำแหน่งเดียวกัน จำนวนต่างกัน) | ✅ **เสร็จ** (ปรับนิยามใหม่ตามนโยบาย) | ✅ `unit/audit-book-impact` [H11] × 13 | `Js/audit-book-impact.js` (ใหม่), `Html/audit_check.html` (โหลด `reconciliation_lines`, สถานะ `overlap`, แถบสรุป, cache-buster ล่าสุด `20260810d`) | audit_check: กล่องสถิติเพิ่มเป็น 5 ช่อง + ฟิลเตอร์ใหม่ 2 ตัว (`overlap`, `impact`) · Export Excel ได้สถานะใหม่อัตโนมัติ · ถ้าโหลด `reconciliation_lines` ไม่ได้ หน้ายังตรวจข้อมูลนับได้ตามปกติ (แค่ไม่มีตัวเลขเทียบ Book) |
| LC1 | โหมด "เทียบตำแหน่ง Excel" บล็อกทุกแถว 100% — ใช้งานไม่ได้เลยตั้งแต่แรก | ✅ **เสร็จ** | ✅ `unit/audit-loc-compare` [LC] × 15 + `unit/audit-select-columns` [LC-guard] × 7 (สแกน source · ตัดคอมเมนต์ก่อนสแกน · พิสูจน์ด้วย mutation ทั้ง delete และ comment-out) | `Js/audit-loc-compare.js` (ใหม่ — ย้าย `buildLocComparePlan` ออกจาก HTML + `missingQty`), `Html/audit_check.html` (SELECT เพิ่ม `counted_qty, cycle_id` · dropdown คลังในโมดัล + ซิงก์ scope bar · ข้อความ block ที่บอกสาเหตุ · cache-buster `20260810f`) | **เส้นทางที่แก้ข้อมูลจริงจำนวนมาก** — เพิ่งเริ่มทำงานได้เป็นครั้งแรก ต้องทดสอบกับโซนเล็กก่อน · guard M26 เพิ่งมีผลจริงเมื่อ qty ถูกต้อง |
| M26 | `getDestinationCollision` ยังบล็อกตาม key เดิม | ✅ **เสร็จ** | ✅ `unit/audit-dedupe` [M26] × 6 | `Js/audit-dedupe.js` (+`classifyDestinationCollision`), `Html/audit_check.html` (+`getCycleForRecordId`, `validateDestUpdateBatch` คืน `warned`, กล่องยืนยันใหม่) | โหมดแก้ location / สลับ SKU↔loc / เทียบตำแหน่งจาก Excel — ทั้ง 3 เส้นทางใช้ `confirmDestUpdatesWithSkips` ร่วมกัน |
| H3 | audit_check ไม่เขียน audit log | ✅ **เสร็จ** (ส่วน atomic → M27) | ✅ `unit/audit-log` × 21 (มีตัวสแกนบังคับทุกฟังก์ชันที่ mutate) | `Js/audit-log.js` (ใหม่), `Html/audit_check.html`, `Js/script.js` | ปริมาณ log เพิ่ม → drawer ประวัติใน index (limit 100 → ดู M28) |
| M29 | `deleteCycle` ลบ adjustment ทั้งรอบด้วย FK CASCADE โดยไม่ log | ⬜ (พบใหม่จาก review H6) | — | `Js/reconcile-shared.js:1030-1038` | cycle_config: ปุ่มลบรอบ — เส้นทางที่ลบ applied ได้มากที่สุดในระบบ |
| M30 | log `RECONCILE_ADJ_CLEAR` ท่วม drawer ประวัติ (limit 100) | ⬜ (พบใหม่จาก review H6) | — | `Js/script.js:1787-1791` | index: drawer ประวัติการทำงาน |
| M27 | bulk update ยังไม่ atomic | ⬜ (แยกจาก H3) | — | `Html/audit_check.html` + RPC ใหม่ (ต้องขออนุมัติ) | ความเสี่ยงต่ำแล้วเพราะมี log ครบ |
| UI1 | เมนูซ้ายแตกบนจอเล็ก (CSS responsive หลุดจาก DOM ที่ JS สร้าง) | ✅ **เสร็จ** | ✅ `unit/sidebar-responsive` [sidebar-guard] × 6 (รวมยาม z-index + ตำแหน่งลิ้นชัก) + [asset-ver] × 3 — พิสูจน์ด้วย mutation แล้วว่าจับบั๊กเดิมได้จริง | `Css/style.css` (แทนที่ media 900px + สไตล์ bar/toggle/scrim + `--sidebar-bar-h` + overflow), `Js/sidebar-shared.js` (`renderMobileChrome` + open/close + matchMedia), `Css/chat-notify.css` (ดัน toast พ้นปุ่ม ☰), **13 HTML** (cache-buster `20260810a`: style.css + sidebar-shared.js + ui-confirm.css) | **ทั้ง 13 หน้า** — ทดสอบจริงในเบราว์เซอร์ที่ 375 / 598 / 1024×560 / 1200 / 1366×768 + hit-test ปุ่มปิด drawer ประวัติแล้ว |
| M22 | book_explorer ไม่มี `has-sidebar` | ✅ **เสร็จ** (พ่วง UI1) | — (ครอบด้วยสายตา + เทส asset-ver) | `Html/book_explorer.html` (`<body>` + padding `.main-content`) | book_explorer เท่านั้น |
| H4 | dashboard คูณ Book ต่อคลัง | ✅ **เสร็จ** | ✅ `unit/dashboard-shared` [H4-guard] × 8 | `Js/dashboard-shared.js`, `Html/dashboard.html` | dashboard แท็บ 1 — ทดสอบกับรอบ 2 คลังจริงแล้ว |
| H9 | `.range()` เรียงไม่เสถียร (พบตอนแก้ H4) | ✅ **เสร็จ** | ✅ `unit/stable-paging` (สแกน source ทั้งโปรเจกต์) | `reconcile-shared`, `script.js`, `live-count-wall`, `dashboard/sku_master/book_explorer` (10 จุด) | **ทุกหน้าที่โหลดข้อมูลเกิน 1,000 แถว** — reconcile presence map กระทบหนักสุด |
| H5 | reconcile เปลี่ยนรอบแล้วเขียนรอบเก่า | ✅ **เสร็จ** | ✅ `unit/reconcile-cycle-sync` [H5-guard] × 10 (สแกน call site) | `Html/reconcile.html`, `Js/reconcile-shared.js` (export `isoToBangkokYmd`) | ทุกปุ่มใน reconcile — ทดสอบสลับรอบ + คำนวณ Match จริงแล้ว |
| H6 | import force "ถูกต้อง" + ลบ adjustment applied ไร้หลักฐาน | ✅ **เสร็จ** | ✅ `dryrun/clear-adjustments` [H6-guard] × 9 | `Js/reconcile-shared.js` (+`importBookAndRecompute`, `logAdjustmentsBeforeDelete`, `rollbackAuditEntries`), `Html/reconcile.html` (call site + เลิก cache accept), `Js/script.js` (drawer รู้จัก action ใหม่), `docs/DATABASE.md` | reconcile: Excel import **และ** ลบรายการ Book (ทั้งสองทางลบ adjustment) · ⚠️ ยังเหลือ `deleteCycle` ที่ลบทั้งรอบด้วย FK CASCADE โดยไม่ log (ดู M29) |
| H7 | avgPerMin สูงเกินจริง | ✅ **เสร็จ** | ✅ `unit/dashboard-shared` [H7-guard] × 3 | `Js/dashboard-shared.js:63-70` | dashboard แท็บ 1 (KPI ความเร็ว) — peakPerMin ยืนยันแล้วว่าไม่เปลี่ยน |
| H8 | chat: okLabel/UI ค้าง/no-auth | ✅ **เสร็จ** | ✅ `unit/chat-clear-guard` [H8-guard] × 16 | `Html/chat.html` (เท่านั้น — ไม่แตะ shared JS จึงไม่ต้อง bump cache-buster) | chat: ปุ่มล้างแชท (3 ด่าน + สำรองอัตโนมัติ + ร่องรอยผู้ทำ) |
| M2 | สถานะ JS ≠ SQL | ⬜ | 🟡 `unit/reconcile-book` [M2] | `Js/reconcile-shared.js:1080-1081` (หรือ SQL ถ้าเลือกทางกลับ) | reconcile preview import, KPI นับสถานะ |
| M4 | name_pro โดน UPPERCASE | ⬜ | 🟡 `unit/reconcile-book` [M4] | `Js/reconcile-shared.js:1108` | cycle_config upload Book, reconcile import — ชื่อใน DB เก่ายัง UPPERCASE อยู่ (แก้โค้ดไม่ได้แก้ข้อมูลเก่า) |
| M19 | encode คลังไม่เสถียร | ⬜ | 🟡 `unit/reconcile-warehouse` [M19] | `Js/reconcile-shared.js:143-161` | cycle_config สร้าง/แก้รอบ — รอบเก่าใน DB ที่ encode แบบเก่าจะไม่ match กับ encode ใหม่ |
| M24 | รอบ `closed/archived` ยังรับผลนับใหม่ | ⬜ (พบใหม่จาก review H1) | — | `Js/reconcile-shared.js` + `Js/script.js:120` | ต้องแก้ guard **คู่กับ** dropdown ไม่งั้นวนเตือนซ้ำ · ตอนนี้ยังไม่มีผล (ทุกรอบเป็น open) |
| M อื่น ๆ / L | ดู [ISSUES.md](ISSUES.md) | ⬜ | เพิ่มเทสเมื่อเริ่มแก้ | — | — |

> **ธรรมเนียม:** issue ไหนเริ่มแก้ ให้เพิ่มเทส (อย่างน้อย 1 knownIssue → test) ก่อนหรือพร้อมกับการแก้เสมอ — ถ้า logic อยู่ inline ใน HTML ให้พิจารณาย้ายฟังก์ชันนั้นลง `Js/*.js` เพื่อให้เทสได้

---

## ✅ Regression C1 (พบและแก้แล้ว 2026-08-09) — เคสตัวอย่าง "แก้จุดนี้ อีกจุดเสียแทน"

> **สรุป: แก้เรียบร้อยแล้ว** ด้วย `docs/sql/016_rls_policies.sql` (รันแล้ว) — ทุกตารางกลับมาอ่าน/เขียนได้ครบ ยืนยันด้วยการทดสอบหน้าจริง
> เก็บบันทึกไว้เป็นกรณีศึกษาว่ากลไกตรวจจับทำงานอย่างไร และทำไม smoke แบบผิวเผินถึงพลาด

**อาการ:** เปลี่ยนจาก service_role → publishable key แล้ว **ตารางส่วนใหญ่คืนค่าว่างเปล่าเงียบ ๆ** (HTTP 200 + 0 แถว ไม่มี error)

**สาเหตุ:** service_role **ข้าม RLS ทั้งหมด** ส่วน anon/publishable **ไม่ข้าม** — ตารางเหล่านี้เปิด RLS ไว้แต่**ไม่มี policy สักข้อ** ผลคือ anon ถูกปฏิเสธทุกแถว

| ตาราง | แถวจริงใน DB | anon อ่านได้ | ผลต่อระบบ |
|---|---|---|---|
| `warehouses` | 4 | **0** ❌ | dropdown คลังว่างทุกหน้า (ตกไปใช้ fallback hardcode 3 คลัง) |
| `count_cycles` | 6 | **0** ❌ | เลือกรอบไม่ได้ → index/cycle_config/reconcile/dashboard ใช้งานไม่ได้ |
| `book_stock_lines` | 5,326 | **0** ❌ | Book หายหมด → KPI = 0%, autocomplete ว่าง, book_explorer ว่าง |
| `reconciliation_lines` | 5,628 | **0** ❌ | หน้า reconcile + dashboard แท็บ Match ว่าง |
| `stock_adjustments` / `..._match_acceptances` | 0 / 0 | ❌ | ปรับยอด/ยืนยันถูกต้อง ใช้ไม่ได้ |
| `chat_messages` | 19 | **0** ❌ | แชทว่าง |
| `sku_master` | 1,179 | ✅ SELECT | อ่านได้ แต่ import/แก้/ลบ **ไม่ได้** |
| `inventory_counts` | 5,971 | ✅ SELECT+INSERT | นับ/บันทึกได้ แต่ **แก้ไข/ลบไม่ได้** → audit_check ทุกโหมดตาย, cycle_config ผูกรอบไม่ได้ |
| `inventory_audit_logs` | 717 | ✅ SELECT+INSERT | ปกติ |

**ทำไมเทส + smoke ครั้งแรกจับไม่ได้:**
1. เทสอัตโนมัติเป็น Dry Run (mock DB) — ตามนิยามจะไม่เห็นพฤติกรรม RLS ของ DB จริง
2. Smoke มือดู "badge เชื่อมต่อแล้ว" ซึ่งยิงไปที่ `inventory_counts` — เป็นตารางเดียวที่**มี** policy อยู่แล้ว จึงเขียวหลอกตา
→ **บทเรียน: เพิ่มขั้น "ตรวจว่าอ่านข้อมูลได้จริงทุกตารางหลัก" เข้า Smoke Checklist** (เพิ่มแล้วข้างล่าง)

**สถานะความเสี่ยงตอนพบ:** ยังไม่ได้ commit/push → ระบบที่ deploy อยู่ยังเป็นโค้ดเดิม ไม่มีผู้ใช้ได้รับผลกระทบ

**การแก้ (admin อนุมัติแล้ว 2026-08-09):** รัน `docs/sql/016_rls_policies.sql` — เพิ่ม RLS policy ให้ anon ตามที่แต่ละหน้าต้องใช้ **เพิ่ม policy อย่างเดียว ไม่แตะข้อมูลหรือโครงสร้างตาราง** ถอยได้ด้วย `DROP POLICY`

**ผลหลังแก้ (ยืนยันด้วย publishable key จริงในเบราว์เซอร์):**

| ตรวจ | ผล |
|---|---|
| อ่าน 10 ตารางหลัก | ✅ ครบทุกตาราง ตรงกับจำนวนแถวใน DB (5,326 / 5,628 / 5,971 / 1,179 …) |
| UPDATE/DELETE `inventory_counts`, `sku_master` | ✅ อนุญาต (ทดสอบด้วย id ที่ไม่มีจริง — ไม่แตะข้อมูล) |
| `index.html` | ✅ badge เขียว · dropdown รอบมีรอบจริง · progress 59% · ยังไม่ได้นับ 419 (ก่อนแก้เป็น 0/0%) |
| `reconcile.html` | ✅ 6 รอบใน dropdown · reconciliation_lines 1,088 แถวของรอบล่าสุด |
| `dashboard.html` | ✅ KPI ขึ้นครบ (นับแล้ว 628 · ยังไม่นับ 419 · 59%) |
| `node tests/run.mjs` | ✅ 57 PASS / 0 FAIL |

> หมายเหตุ: dropdown คลังแสดง 1 คลังถูกต้องแล้ว — registry มี 4 แต่ `is_active = true` แค่ `ตึกกันตนา`

---

## Impact Map — แก้ไฟล์นี้ กระทบหน้าไหนบ้าง

แก้ shared JS 1 ไฟล์ = ทุกหน้าในแถวนั้นต้องถูกทดสอบมือซ้ำ (อย่างน้อยตาม Smoke Checklist ข้างล่าง)

| ไฟล์ที่แก้ | หน้าที่ได้รับผลกระทบ |
|---|---|
| `Js/api.js` | **ทั้ง 13 หน้า** |
| `Js/sidebar-shared.js` | **ทั้ง 13 หน้า** (เมนู + ระบบแจ้งเตือนแชท) |
| `Js/reconcile-shared.js` | index, import_counts, count_search, reconcile, book_explorer, dashboard, live_count_wall, cycle_config |
| `Js/warehouses-shared.js` | index, import_counts, count_search, audit_check, dashboard, live_count_wall, sku_master, settings, cycle_config |
| `Js/settings-shared.js` | ทุกหน้าที่มี connection badge (10 หน้า — ยกเว้น book_explorer, chat, user_manual) |
| `Js/sku-utils.js` | index, import_counts, count_search, audit_check, reconcile, dashboard, live_count_wall, sku_master, cycle_config |
| `Js/db-errors.js` | index, import_counts, count_search, audit_check, reconcile, dashboard, live_count_wall, sku_master, cycle_config |
| `Js/ui-confirm-modal.js` | import_counts, audit_check, reconcile, cycle_config, chat, user_manual |
| `Js/chat-notify-shared.js` | **ทั้ง 13 หน้า** (inject ผ่าน sidebar) |
| `Js/dashboard-shared.js` | dashboard |
| `Js/audit-dedupe.js` | audit_check |
| `Js/audit-log.js` | audit_check (และรูปแบบ log กระทบ drawer ประวัติใน index) |
| `Js/script.js` | index เท่านั้น |
| `Js/live-count-wall.js` | live_count_wall เท่านั้น |
| `Js/manual-editor.js` | user_manual เท่านั้น |
| `Css/style.css` | **ทั้ง 13 หน้า** |
| `Css/ui-confirm.css` | 6 หน้าที่ใช้ uiConfirm |
| `docs/sql/*` (ถ้า admin อนุมัติในอนาคต) | ตาม RPC/ตารางที่แตะ — ปัจจุบัน **ห้ามแตะ DB** |

**ตัวอย่างการใช้:** จะแก้ H6 (`Js/reconcile-shared.js`) → แถว reconcile-shared บอกว่า 8 หน้าใช้ไฟล์นี้ → หลังแก้ รันเทสอัตโนมัติ + ไล่ smoke มือ 8 หน้า (โฟกัส reconcile ที่เรียกฟังก์ชันนี้ตรง ๆ 2 จุด: Excel import และ ลบรายการ Book)

---

## Smoke Checklist ทดสอบมือรายหน้า (หลังแก้ไฟล์ที่กระทบหน้านั้น)

**ขั้นที่ 0 (บังคับ — เพิ่มหลังเจอ Regression C1): ตรวจว่าอ่านข้อมูลได้จริงทุกตารางหลัก ไม่ใช่แค่ badge เขียว**
วางใน DevTools Console หน้าใดก็ได้ที่โหลด `api.js` — ทุกตารางต้องคืนจำนวนแถว **ไม่ใช่ 0**:

```js
(async () => { const c = window.apiService.getClient(); const out = {};
  for (const t of ['inventory_counts','warehouses','count_cycles','book_stock_lines','sku_master','reconciliation_lines']) {
    const { data, error } = await c.from(t).select('*').limit(1);
    out[t] = error ? 'ERR: ' + error.message : (data.length ? 'อ่านได้' : '⚠️ ว่างเปล่า'); }
  console.table(out); })()
```

> ⚠️ RLS ปฏิเสธแบบ **เงียบ** — คืน HTTP 200 พร้อม 0 แถว ไม่ใช่ error สีแดง Console ที่สะอาดจึงไม่ได้แปลว่าระบบทำงาน

จากนั้นเปิดหน้าในเบราว์เซอร์ + เปิด DevTools Console (ต้องไม่มี error สีแดง) แล้วไล่ตามนี้ — **ระวัง: นี่คือระบบจริง ถ้าไม่อยากเขียนข้อมูลจริงให้ทดสอบเฉพาะส่วนอ่าน/แสดงผล หรือใช้คลัง+รอบทดสอบแยก**

| หน้า | เช็คขั้นต่ำ (อ่านอย่างเดียว — ปลอดภัย) |
|---|---|
| index | โหลดหน้า → KPI 3 ช่องขึ้นตัวเลข, dropdown รอบมีรายการ, autocomplete SKU เด้ง, รายการล่าสุดแสดง |
| import_counts | แถบรอบขึ้นสีถูก (เขียว/เหลือง), ลากไฟล์ template → preview ขึ้น (อย่ากดนำเข้า) |
| count_search | โหลดเดือนที่มีข้อมูล → ค้นหา → ตารางขึ้น + summary ตรง |
| audit_check | เลือกคลัง+เดือน → ตารางโหลด + สถิติสถานะขึ้น (อย่ากด apply/ลบ) |
| reconcile | เลือกรอบ → คำนวณ Match → KPI + ตารางขึ้น, ตัวเลข "ต่าง" สมเหตุผล (อย่ากดปรับยอด) |
| cycle_config | รายการรอบโหลด, เลือกรอบ → panel รายละเอียดขึ้น (อย่ากดลบ/นำเข้า) |
| book_explorer | เลือก ปี→เดือน→รอบ → ตาราง + KPI ขึ้น, ลอง sort + ค้นหา |
| sku_master | เลือกคลัง → ตารางโหลด, ค้นหา filter ทำงาน |
| dashboard | ทั้ง 2 แท็บโหลด, เปลี่ยนฟิลเตอร์คลัง/รอบแล้วตัวเลขเปลี่ยนสมเหตุผล |
| settings | badge เชื่อมต่อเขียว, รายการคลังโหลด (อย่ากดลบคลัง) |
| chat | ข้อความเก่าโหลด, ส่งข้อความทดสอบ 1 ข้อความได้ (ห้องรวม — ลบไม่ได้รายข้อความ) |
| live_count_wall | สองฝั่งโหลด, ลองสลับคลัง/รอบ, ดู realtime ขึ้นเมื่อมีคนบันทึก |
| user_manual | โหมดอ่านแสดงครบ, สลับโหมดแก้ไขได้, ปุ่มสำรองดาวน์โหลดไฟล์ |

---

## บันทึกการแก้ไข (Change Log — เติมทุกครั้งที่แก้)

| วันที่ | Issue | ไฟล์ | ผลเทสก่อน/หลัง | Regression? | หมายเหตุ |
|---|---|---|---|---|---|
| 2026-08-09 | — (สร้างระบบเทส baseline) | tests/* (ไฟล์ใหม่ล้วน) | 50 PASS / 0 FAIL / 6 KNOWN-OPEN | — | baseline แรก — ยังไม่มีการแก้โค้ดระบบ |
| 2026-08-09 | C1 (เริ่ม) | `tests/unit/no-secret-keys.test.mjs` (ใหม่), `.gitignore` (ใหม่) | 51 PASS / 0 FAIL / 7 KNOWN-OPEN | — | เพิ่มเทสสแกน JWT + .gitignore — รอ anon key จาก admin ก่อนแก้ `Js/api.js` (โปรเจกต์ nfhfuybqhskzlllkgmyi ไม่อยู่ในบัญชี MCP ที่เชื่อม) |
| 2026-08-09 | C1 (ฝั่งโค้ดเสร็จ) | `Js/api.js` (+31/-1) | ก่อน: 50/0/6 → หลัง: 55/0/6, C1 เด้ง KNOWN-FIXED แล้วย้ายเป็นยามถาวร | ไม่มี | เปลี่ยนเป็น `sb_publishable_...` + เพิ่ม `isServiceRoleKey()` ล้าง key admin ค้างใน localStorage อัตโนมัติ — **ค้าง: admin ต้อง revoke service_role เก่าใน dashboard** (key ยังอยู่ใน git history) |
| 2026-08-09 | C1 (เก็บงานตาม review) | `Js/api.js` (export isServiceRoleKey + try/catch seed + warn), `Js/settings-shared.js` (+2), `Html/settings.html` (+4) | 57/0/6 | ไม่มี | ตามข้อเสนอ code-reviewer: block service_role ตั้งแต่ตอนบันทึกใน settings + แก้ pre-existing setItem ไม่มี try/catch — smoke ครั้งแรก "ผ่าน" (badge เขียว) แต่**ไม่เพียงพอ** ดูแถวถัดไป |
| 2026-08-09 | **C1 — พบ REGRESSION** (หลังเชื่อม Supabase MCP แล้วตรวจ RLS จริง) | — | 57/0/6 (เทส dry-run ยังเขียว — จับไม่ได้ตามนิยาม) | ⚠️ **ใช่ — 7 ตารางคืนค่าว่าง** | anon ไม่ข้าม RLS แต่ 7 ตารางไม่มี policy → ระบบใช้งานไม่ได้จริง · ยังไม่ push → production ปลอดภัย · เพิ่มขั้นที่ 0 เข้า Smoke Checklist |
| 2026-08-09 | **H5 — เสร็จ** | `Html/reconcile.html` (change listener + `invalidateCycleView` + `lockCycleId`/`stillOnCycle` + ล็อก dropdown + ป้าย "ผลคำนวณเดิม"), `Js/reconcile-shared.js` (export `isoToBangkokYmd`), เทสใหม่ `reconcile-cycle-sync` | ก่อน: 123/0/5 → หลัง: **133/0/5** | ไม่มี | รากของบั๊กคือ **อ่าน `currentCycle.id` ตอนเขียน ไม่ใช่ตอน guard** — review ชี้จุดนี้ทำให้แก้ได้ตรงจุด · review ยังพบว่าปุ่มลบ draft หลุด guard ทั้งหมด (inline handler) และเทสรุ่นแรกที่ใช้รายชื่อ hardcode มองไม่เห็น → เปลี่ยนเป็นสแกน call site |
| 2026-08-09 | **H4 + H9 — เสร็จ** | `Js/dashboard-shared.js` (+`computeBookCoverage`), `Html/dashboard.html` (เลิก loop ต่อคลัง + ลบ logic ซ้ำใน render), `Js/reconcile-shared.js` / `Js/script.js` / `Js/live-count-wall.js` / 3 HTML (+`.order('id')` 10 จุด), เทสใหม่ `stable-paging` | ก่อน: 113/0/5 → หลัง: **123/0/5** | ไม่มี | **รอบ TIKTOK: Book 2,902→1,451 · ยังไม่นับ 827→49** ตรง DB เป๊ะ · review จับได้ว่า guard ตัวแรกของผม**ตาบอดต่อโค้ดที่เพิ่งแก้เอง** (regex หยุดที่ `.range()` ในคอมเมนต์) แก้แล้วเผยอีก 10 จุด · presence map ใน reconcile เสถียรแล้ว (1,503 เท่ากันทุกครั้ง) |
| 2026-08-09 | **H3 — เสร็จ (ส่วน audit log)** | `Js/audit-log.js` (ใหม่), `Html/audit_check.html` (ต่อ log ครบ 5 จุด + flush ทุก 100 แถว + `dataset.originalSku/Qty`), `Js/script.js` (ป้ายกำกับ `AUDIT_*`/`IMPORT` ใน drawer) | ก่อน: 92/0/5 → หลัง: **113/0/5** | ไม่มี | review จับได้ 4 จุดสำคัญที่แก้ตาม: log เขียนครั้งเดียวหลัง loop (ปิดแท็บ = ไม่มี log เลย), chunk พังแล้วเขียนต่อจนเหลือหลักฐานเท็จ, `Number('')===0` ทำให้บันทึก "จำนวน 0" ผิด, snapshot อ่านค่าที่ผู้ใช้พิมพ์ค้างแทนค่าใน DB · ส่วน atomic แยกเป็น M27 |
| 2026-08-09 | **H2 — เสร็จ** | `Js/audit-dedupe.js` (ใหม่ — นิยาม "แถวซ้ำ" + เทส 19 ข้อ), `Html/audit_check.html` (ใช้โมดูลใหม่, ดึง cycle_id/counter_name/import_batch_id, สำรอง CSV ก่อนลบ, verify error→warn, classify เป็น post-pass) | ก่อน: 72/0/5 → หลัง: **92/0/5** | ไม่มี | **ผลจริง 6,078 แถว: กฎเก่าจะลบ 470 แถว → กฎใหม่ลบ 0** · review รอบแรกจับได้ว่าผมตีความ `created_at` ตรงกันเป๊ะผิด (เป็น bulk insert ไม่ใช่กดซ้ำ) แก้แล้วพร้อมเทส · พบ M26 เป็นข้อใหม่ |
| 2026-08-09 | **C2 (XSS) + M25 (client cache) — เสร็จ** | `Js/script.js`, `Js/api.js`, `Js/sidebar-shared.js` (ASSET_VER + cache-buster ให้ script ที่ inject), escape function 14 ตัวทุกไฟล์, `Html/` settings·audit_check·sku_master·import_counts·count_search·book_explorer·dashboard, เทสใหม่ `xss-guard` + `api-client-cache` | ก่อน: 63/0/5 → หลัง: **72/0/5** | ไม่มี — ทดสอบจริง 6 หน้า | เปลี่ยน onclick ที่ต่อค่าเข้า JS string → `data-*` + `this.dataset` · review เจอ sink ที่ ISSUES เดิมตกหล่น 5 จุด (mini-dashboard ใน index, modal ลบขั้น 2, ตัวกรองผู้นับ) เก็บครบแล้ว · แก้ `highlightMatch` ให้ไฮไลต์ apostrophe ได้ · cache-buster → `20260809c` |
| 2026-08-09 | **H1 — เสร็จ** | `Js/reconcile-shared.js` (+`isCycleRelevantNow`,`bangkokYearMonthNow`), `Js/script.js` (+`ensureCycleStillValid` เรียกใน 2 submit path), `Js/sidebar-shared.js` (prefix-match src), `Html/import_counts.html` (ข้อความ banner), **HTML ทุกไฟล์** (cache-buster `?v=20260809a` 30 tags) | ก่อน: 57/0/6 → หลัง: **63/0/5** (H1 ย้ายจาก knownIssue → เทสถาวร 6 ข้อ) | ไม่มี — ทดสอบจริงครบ 8 หน้า | **ค้นพบระหว่างทาง:** เบราว์เซอร์ cache `reconcile-shared.js` ไว้ ทำให้การแก้ไม่มีผล → ต้องใส่ cache-buster ถึงจะ deploy ได้จริง · review เจอ M24 (รอบ closed ยังรับผลนับ) บันทึกเป็นข้อใหม่ |
| 2026-08-09 | **C1 — revoke key เก่า (admin ทำใน dashboard)** | — (ฝั่ง Supabase) | 57/0/6 | ไม่มี | legacy `anon`+`service_role` = `disabled: true` · GitHub alert #1 = `resolved/revoked` · ยืนยันหน้า index ยังปกติ (59% / 419) และอ่านครบ 10 ตาราง · **C1 ปิดสมบูรณ์** |
| 2026-08-09 | **DB cleanup** (admin อนุมัติ) | `docs/sql/017_drop_skunorm_backup_tables.sql`, `docs/backup/2026-08-09_bk_tables_unique_rows.md` | 57/0/6 | ไม่มี — ทุกตารางที่ระบบใช้ยังอ่านได้ครบ | ลบตารางสำรอง `_bk_*` 3 ตัว (5,225 แถว) หลังตรวจพบว่า 5,222 แถวซ้ำกับตารางจริง 100% · สำรอง 3 แถวที่ไม่ซ้ำเป็น CSV+SQL ไว้แล้ว |
| 2026-08-09 | **C1 — ปิดงาน** (admin อนุมัติเพิ่ม RLS policy) | `docs/sql/016_rls_policies.sql` (รันจริงผ่าน MCP: 11 policies บน 9 ตาราง) | 57 PASS / 0 FAIL / 6 KNOWN-OPEN | ✅ **regression หายแล้ว** | ทุกตารางอ่าน/เขียนได้ครบ · ทดสอบหน้า index/reconcile/dashboard จริงผ่าน · **ค้าง: admin revoke service_role key เก่าใน dashboard** |
| 2026-08-09 | **H6 + H7 — เสร็จ** (ทำขนานกับ H5 คนละไฟล์) | `Js/reconcile-shared.js` (+`importBookAndRecompute`, `logAdjustmentsBeforeDelete`, `clearAdjustments…` คืนจำนวน, `deleteBookStockBySku` log ก่อนลบ), `Html/reconcile.html` (call site import + ลบกลไก cache accept), `Js/dashboard-shared.js` (ตัวหาร avgPerMin), เทส `dryrun/clear-adjustments` + `unit/dashboard-shared` | ก่อน: 130/0/5 → หลัง: **156 PASS / 0 FAIL / 3 KNOWN-OPEN** (ในนั้นเป็นเทส H8 ของอีกเซสชันที่อยู่ใน working tree เดียวกัน 11 ข้อ — เฉพาะขอบเขต H6+H7 คือ 145) | ไม่มี | admin เลือก semantic: import = "Book ใหม่คือความจริง" → เลิก force ทุก SKU เป็น match, ปล่อยให้ `refresh_reconciliation_for_cycle` ตัดสิน · ยอดปรับเก่ายัง**ต้อง**ลบทั้ง draft/applied (ไม่งั้น `effective = book + SUM(applied)` นับซ้ำ) แต่เขียน `inventory_audit_logs` (`RECONCILE_ADJ_CLEAR`) ก่อนลบ ถ้า log ไม่สำเร็จ = ยกเลิกการลบ · พบเส้นทางที่สองที่ลบ adjustment โดยไม่ log: `deleteBookStockBySku` แก้ด้วย (ยังเหลือ `deleteCycle` → M29) · H7 ใช้ช่วง bucket แรก→สุดท้าย ไม่ใช่ max−min (max−min สั้นกว่าจริง 1 bucket) · **review จับได้ 2 ข้อ High เรื่องลำดับ operation**: (1) เดิม merge Book ก่อนล้างยอดปรับ ถ้าล้างพังจะได้ Book ใหม่ + ปรับเก่า = นับซ้ำเงียบ ๆ → สลับเป็นล้างก่อน merge (2) `deleteBookStockBySku` ลบ Book ก่อน log → ย้าย log ขึ้นก่อน + เพิ่ม `rollbackAuditEntries` เมื่อการลบพังหลังเขียน log แล้ว · cache-buster → `20260809k` เฉพาะ 8 หน้าที่โหลดไฟล์ที่แก้ |
| 2026-08-09 | **C1 — regression ตกค้างรอบ 2: "คำนวณ Match" 401** | `docs/sql/018_refresh_reconciliation_security_definer.sql` (รันจริงผ่าน MCP: `ALTER FUNCTION` 2 บรรทัด) | 108 PASS / 0 FAIL / 5 KNOWN-OPEN (ก่อน=หลัง — เทส dry-run จับ RLS ไม่ได้ตามนิยาม) | ✅ **แก้แล้ว** | 016 ให้ `reconciliation_lines` แค่ policy SELECT เพราะคิดว่า RPC เขียนได้อยู่แล้ว แต่ `prosecdef=false` → RPC รันด้วยสิทธิ์ anon → `DELETE` ลบ 0 แถวเงียบ ๆ + `INSERT` โดน 42501 → PostgREST คืน **HTTP 401** · reproduce ด้วย `set local role anon` + rollback ยืนยันทั้งก่อน (42501) และหลัง (00000, 1,113 แถว) · `apply_stock_adjustment` / `apply_all_drafts_for_cycle` หายตามเพราะ PERFORM ต่อเข้าฟังก์ชันนี้ |
| 2026-08-09 | **H8 — เสร็จ** (ทำขนานกับงานอีกฝั่ง — footprint คือ `Html/chat.html` ไฟล์เดียว) | `Html/chat.html` (+`#clearConfirmModal`, `runClearNow`, `fetchAllRoomMessages`, `downloadChatJson`, `writeClearTrace`, `statusHoldUntil`), เทสใหม่ `unit/chat-clear-guard` | ก่อน: 145/0/3 → หลัง: **161 PASS / 0 FAIL / 3 KNOWN-OPEN** | ไม่มี | แก้ครบ 3 อาการ: `okLabel`→`confirmLabel` (ทั้งโปรเจกต์เหลือ 0 จุด), เพิ่ม else โหมด local (เดิมค้าง "กำลังล้างแชท..." ตลอดไป), และเพิ่ม 3 ด่านแทน authorization ที่ระบบไม่มี: ต้องระบุชื่อผู้ทำ → สำรองอัตโนมัติ (สำรองพัง = ไม่ลบ) → พิมพ์คำว่า "ล้างแชท" · เจตนาไม่แตะ `Js/ui-confirm-modal.js` เพื่อเลี่ยง bump cache-buster 6 ไฟล์ HTML ที่อาจชนกับงาน H6/H7 · **review จับได้ 6 ข้อที่แก้ตาม**: (1) realtime echo ของข้อความร่องรอยเรียก `updateHint` ทับคำเตือน RLS หายใน <1 วิ → เพิ่ม `statusHoldUntil` (2) paging ของการสำรองเลื่อน cursor ตายตัว ถ้า PostgREST คืนไม่ครบหน้าจะข้ามแถวแล้วเลิกลูปเงียบ ๆ → เลื่อนตาม `data.length` + เทียบ `count:'exact'` (3) `storage.remove()` ที่โดน policy บล็อกคืน `data: []` โดยไม่ error → ต้องอ่าน `data` ไม่ใช่แค่ `error` (4) เทียบ "ลบ 0 แถว" กับ mirror ในเครื่องซึ่งอาจว่างอยู่แล้ว → ใช้จำนวนที่อ่านจากเซิร์ฟเวอร์ตอนสำรอง (5) กดปุ่มล้างซ้ำระหว่างด่าน 3 = โปรมิสเดิมค้างถาวร → `clearInProgress` + settle ตัวเก่า (6) เทส 3 ข้อผ่านแบบหลอก (ลืม `await`, ปุ่มยกเลิก resolve(true), ลูป Storage รอบเดียว) → รัดเทสใหม่จน mutation ทั้ง 7 แบบถูกจับครบ · ทดสอบจริงบนห้อง `main` 20 ข้อความ: ไฟล์สำรองลงเครื่องครบ 20 แถวจากเซิร์ฟเวอร์, กดยกเลิกแล้วไม่มีอะไรถูกลบ (DB ยัง 20 แถว `created_at` เดิม), โหมด local รายงานถูกต้องไม่ค้าง |
| 2026-08-10 | **UI1 + M22 — เสร็จ** (เมนูซ้ายบนจอเล็ก) | `Css/style.css` (แทนที่ `@media 900px` ทั้งบล็อก + `.sidebar-mobile-bar`/`.sidebar-toggle`/`.sidebar-scrim` + `--sidebar-bar-h` + `overflow-y`/`100dvh` ที่ `.sidebar`), `Js/sidebar-shared.js` (+`renderMobileChrome`/`setDrawer`/`pageLabel` + matchMedia + Escape), `Css/chat-notify.css` (ดัน toast ลงใต้แถบ), `Html/book_explorer.html` (`has-sidebar` + padding + sticky top), **13 HTML** (cache-buster `20260810a` ให้ `style.css`+`sidebar-shared.js`+`ui-confirm.css`), เทสใหม่ `unit/sidebar-responsive` | ก่อน: 171/0/3 → หลัง: **183 PASS / 0 FAIL / 3 KNOWN-OPEN** (ในนั้นมีงาน H10/H8 ของเซสชันอื่นใน working tree เดียวกัน) | ไม่มี | รากของบั๊ก: `@media (max-width:900px)` เขียนสมัยเมนูเป็น "แถวไอคอนแบน" แต่ JS เปลี่ยนไปเรนเดอร์ "กลุ่มพับได้" แล้ว — CSS สั่ง `flex-direction: row` ทับ DOM แนวตั้ง · เปลี่ยนเป็น off-canvas drawer + ☰ + ฉากมืด · **review จับได้ 1 High ที่ผมพลาดจริง**: ผมอ่าน "style.css:756 .toast-container" จากผลสำรวจแล้วเข้าใจว่า 756 คือ z-index ทั้งที่เป็น**เลขบรรทัด** ค่าจริงคือ 50 → ตั้งแถบเมนูไว้ 720 ทับ `.log-drawer` (210) จนปุ่มปิดกดไม่ได้บนมือถือ แก้เป็น 30/35/40 (ต่ำกว่า overlay ทุกตัว) + เพิ่มเทสเทียบ z-index อัตโนมัติ · อีก 3 ข้อที่แก้ตาม: ลิ้นชัก `top:0` ทำให้หัวเมนูถูกแถบทับ (→ `top: var(--sidebar-bar-h)`), chat toast กลืน tap ปุ่ม ☰ บนจอ <392px, และเทสรุ่นแรกมีทั้ง false-FAIL (regex `class="([^"]+)"` มองไม่เห็น class ที่ต่อสตริง) และ false-PASS (อ่านบล็อก 900px แค่ก้อนแรก) — รัดใหม่แล้วพิสูจน์ด้วย mutation 2 แบบว่าจับได้จริง · พบว่า `style.css` และ `ui-confirm.css` **ไม่เคยมี `?v=` เลย** → แก้ CSS ที่ผ่านมาไม่เคยถึงผู้ใช้ที่เปิดระบบมาก่อน เพิ่มเทสยามกว้าง "ทุกไฟล์ Js/Css ต้องมี `?v=`" |
