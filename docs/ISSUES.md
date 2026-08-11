# ISSUES — รายการสิ่งที่ควรแก้ไข (สำหรับ admin review)

> จัดทำ: 2026-08-09 · ข้อระดับ **Critical/High ทั้งหมดผ่านการ verify กับโค้ดจริงแล้ว** โดย code-reviewer agent (เปิดไฟล์อ่านบรรทัดจริงทุกข้อ — CONFIRMED ครบ)
> **วิธีใช้**: ติ๊ก `[x]` หน้าข้อที่ต้องการให้แก้ แล้วสั่งงานรอบแก้ไขได้เลย — ยังไม่มีการแก้โค้ดใด ๆ ในรอบนี้

---

## 🔴 Critical — ความเสี่ยงข้อมูลรั่ว/เสียหายทั้งระบบ

### - [x] C1. Supabase **service_role key** ฝังในโค้ดฝั่ง browser
> **สถานะ 2026-08-09: ✅ เสร็จ** — `Js/api.js` ใช้ `sb_publishable_...` + ล้าง key เก่าจาก localStorage อัตโนมัติ + block ไม่ให้บันทึก service_role ในหน้า settings, มีเทสยาม [C1-guard] กันหลุดซ้ำ, เพิ่ม `.gitignore`
> **RLS:** เพิ่ม policy ให้ anon แล้ว (`docs/sql/016_rls_policies.sql` — รันแล้ว) หลังพบว่าการเปลี่ยน key ทำ 7 ตารางคืนค่าว่าง ดูกรณีศึกษาใน [FIX_TRACKING.md](FIX_TRACKING.md#-regression-c1-พบและแก้แล้ว-2026-08-09--เคสตัวอย่าง-แก้จุดนี้-อีกจุดเสียแทน)
> **✅ Revoke แล้ว 2026-08-09** — admin กด Disable legacy API keys ใน dashboard ยืนยันผลแล้ว: legacy `anon`+`service_role` = `disabled: true`, GitHub secret-scanning alert #1 = `resolved / revoked`, ระบบยังทำงานปกติครบทุกหน้า (เทส 57 PASS)
>
> **ประวัติการรั่ว (บันทึกไว้เป็นบทเรียน):** key อยู่ใน repo **public** `tunder2543-lgtm/AuditNew` ตั้งแต่ 21 พ.ค. 2569 ถึง 9 ส.ค. 2569 ≈ **2 เดือนครึ่ง** — ต้องถือว่าถูกเก็บไปแล้วโดยบอตสแกน แต่ปัจจุบันใช้ไม่ได้อีก
>
> **⚠️ ยังค้างอยู่ (คนละโปรเจกต์ — นอกขอบเขตงานนี้):** repo public `tunder2543-lgtm/Filter-Live-TikTok-Sell` มี service_role key ของโปรเจกต์ `akvzebodkihbjdnanjoi` รั่วอยู่ที่ `service/supabaseService.js` ตั้งแต่ 14 พ.ค. 2569 — alert ยังเปิดค้าง
**ตำแหน่ง:** `Js/api.js:9` (และปรากฏใน `Html/settings.html` ผ่านการ seed)
**ยืนยันแล้ว:** decode JWT ได้ `role: "service_role"` หมดอายุปี 2035 — คีย์ระดับ admin **ข้าม Row Level Security ทั้งหมด**
**ผลกระทบ:** ใครก็ตามที่เปิดหน้าเว็บ (หรืออ่าน repo — key อยู่ใน git history ด้วย) กด view-source ก็ได้สิทธิ์อ่าน/เขียน/ลบทุกตารางทุก bucket ของโปรเจกต์ Supabase ทันที ซ้ำ `api.js:47-50` ยัง **เขียน key ลง localStorage อัตโนมัติ** ทุกเครื่อง และลบค่าออกถาวรไม่ได้ (โดน seed ซ้ำทุกครั้งที่เรียก `getClient()`)
**แนวทางแก้:** (1) rotate service_role key ใน Supabase dashboard (2) เปลี่ยนค่าในโค้ดเป็น **anon key** (3) เปิด RLS + เขียน policy ทุกตาราง (4) ล้าง `SB_KEY` เก่าจาก localStorage เครื่องผู้ใช้ (5) เพิ่ม `.gitignore` — *หมายเหตุ: กระทบการใช้งานทุกหน้าทันทีจนกว่า policy จะครบ ควรทำเป็นรอบแยกที่มีเวลาทดสอบ*

### - [x] C2. Stored XSS หลายจุด (อันตรายเป็นพิเศษเพราะประกอบกับ C1)
> **✅ แก้แล้ว 2026-08-09** — วิธีแก้ 3 ชั้น:
> 1. **escape ครบทุกไฟล์** — เสริม escape function ทั้ง 14 ตัวให้ครอบ `'` และ `"` (เดิมหลายตัวขาด) + เปลี่ยน `String(v || '')` → `String(v ?? '')` กันเลข 0 หาย
> 2. **เลิกต่อค่าเข้า JS string ใน `onclick`** — เปลี่ยนเป็น `data-*` + `this.dataset` (HTML escape ไม่พอในบริบทนี้ เพราะเบราว์เซอร์ decode entity ก่อน parse JS) ที่ `Js/script.js` (ปุ่มแก้ไข/ลบ), `Html/settings.html` (คลัง), `Html/sku_master.html` (เลือก/ลบ SKU)
> 3. **escape ทุก sink** — recent list, group list, autocomplete, toast, audit log drawer, uncounted drawer, modal ลบทั้ง 2 ขั้น, mini-dashboard, ตัวกรองผู้นับ, note/suggestion ใน audit_check, preview import, preview sku_master, ชื่อคลังใน settings
>
> **เทสคุ้มกัน 7 ข้อ** ใน `tests/unit/xss-guard.test.mjs` — สแกน source อัตโนมัติหา pattern อันตราย (`onclick` ที่ต่อค่า, `setAttribute('on*')`, escape function ที่ไม่ครอบ `'`) + pin test จุดที่เคยพลาด
> **ทดสอบจริง**: ยิง payload `<img src=x onerror=...>` เข้า toast และ note ในเบราว์เซอร์ → ไม่ execute แสดงเป็นข้อความ และ `<strong>` ที่ตั้งใจใส่ยังทำงาน
>
> ✅ **ปิดแล้ว 2026-08-11** — จุด self-XSS ที่เหลือ (`manual-editor.js` `root.innerHTML = state.html` จาก localStorage) หายไปพร้อมการถอดหน้าคู่มือ
**ยืนยันแล้วทุกจุด:** ข้อมูลจากผู้ใช้/Excel/DB ถูกใส่ `innerHTML` หรือ `onclick="..."` โดยไม่ escape:
- `Html/settings.html:352` (ชื่อคลัง), `:348, :359` (escape เฉพาะ `'` — `"` และ `<` หลุด)
- `Js/script.js:553-554, 562, 565, 785, 1034-1035, 1330, 1333, 1423 (toast), 1771, 1777, 1801-1802`
- `Html/audit_check.html:2291-2329, 2367` (`noteTd.innerHTML`), `:1332` (toast)
- `Html/import_counts.html:906-909` (preview จาก Excel)
- `Html/sku_master.html:872-873, 1121`
**ผลกระทบ:** SKU/ชื่อสินค้า/ชื่อคลัง/ชื่อผู้นับที่มี `<script>` หรือ `')` ฝัง (พิมพ์เองหรือมากับไฟล์ Excel) จะรันโค้ดในเบราว์เซอร์คนอื่น — และเพราะ C1 โค้ดนั้นอ่าน service_role key จาก localStorage ได้ = ยึดฐานข้อมูลทั้งระบบ
**แนวทางแก้:** สร้าง `escapeHtml` กลางตัวเดียว (เช่นใน sku-utils หรือไฟล์ใหม่ `html-utils.js`) ครอบ `& < > " '` แล้วไล่แก้ทุกจุด + เลิกฝัง handler ใน onclick attribute (ใช้ dataset + addEventListener)

---

## 🟠 High — ข้อมูล/ผลลัพธ์ผิด

### - [x] H1. ผลนับเดือนใหม่ถูกแนบ `cycle_id` ของเดือนเก่า
> **✅ แก้แล้ว 2026-08-09** — เพิ่ม `isCycleRelevantNow()` ใน `Js/reconcile-shared.js` เป็น guard กลางที่ `getCycleIdForWarehouse` เรียกใช้ (คุมทั้ง index และ import_counts ในจุดเดียว)
> เกณฑ์: รอบใช้ได้เมื่อ **(1)** `year_month` = เดือนปัจจุบัน (กรอกย้อนหลังในเดือนเดียวกันยังได้) **หรือ (2)** เวลาปัจจุบันอยู่ในช่วง `count_start_at..count_end_at`
> เพิ่มเติม: `ensureCycleStillValid()` ใน `Js/script.js` เตือนเมื่อเปิดหน้าค้างข้ามเดือน · ข้อความ banner ใน import_counts แยกกรณี "คนละเดือน" ออกจาก "ไม่ครอบคลัง" · ใส่ cache-buster `?v=` ทุกหน้า (ไม่งั้นเบราว์เซอร์ใช้ไฟล์เก่า การแก้ไม่มีผล)
> เทสคุ้มกัน 6 ข้อ `[H1-guard]` ใน `tests/dryrun/active-cycle.test.mjs`
**ตำแหน่ง:** `Js/script.js:183-187` + `Js/reconcile-shared.js:531-545, 203-215`
**ยืนยันแล้ว:** เมื่อเดือนปัจจุบันไม่มีรอบ `populateAndResolveCycle` ตั้ง `activeCycleForPage = null` แต่**ไม่เคลียร์** `localStorage.active_count_cycle_v1`; ตอนบันทึก `attachCycleToPayload` → `getCycleIdForWarehouse` เช็คแค่**ชื่อคลัง** ไม่เช็ค `year_month` → ผลนับเดือนใหม่ติด cycle เดือนเก่า (ทั้งเส้นทาง single `:1245` และ group `:1113`)
**ผลกระทบ:** reconcile รอบเก่านับข้อมูลเดือนใหม่ปนเข้าไป — ยอด Match/ขาด/เกิน ผิดทั้งสองรอบ
**แนวทางแก้:** ให้ `warehouseMatchesCycle` เทียบ `year_month` ด้วย หรือเรียก `RS.clearActiveCycle()` เมื่อ resolve รอบไม่ได้

### - [x] H2. audit_check ไม่รู้จัก cycle + โหมด "ลบ duplicate" ลบข้อมูลนับที่ถูกต้องถาวร
> **✅ แก้แล้ว 2026-08-09** — ย้ายนิยาม "แถวซ้ำ" ออกมาเป็น [`Js/audit-dedupe.js`](../Js/audit-dedupe.js) (มีเทสคุ้มกัน 19 ข้อ) แล้วให้ `audit_check.html` เรียกใช้
>
> **เกณฑ์ลบใหม่ — ต้องครบทุกข้อ:** คลัง+SKU+ตำแหน่ง+จำนวนเหมือนกัน · **รอบนับเดียวกัน** · **ผู้นับคนเดียวกัน** · ห่างกันไม่เกิน 10 นาที · **`created_at` ไม่ตรงกันเป๊ะ** · **ไม่ได้มาจากไฟล์นำเข้าเดียวกัน**
>
> ⚠️ **จุดสำคัญที่เกือบพลาด** (code-review จับได้): Postgres `now()` คือเวลาเริ่ม transaction จึงคงที่ทั้ง statement → การ insert หลายแถวครั้งเดียว (**group submit** ในหน้านับ / **นำเข้า Excel**) ทำให้ทุกแถวได้ `created_at` **ตรงกันถึงไมโครวินาที** นั่นคือคนละบรรทัดในชุดเดียวกัน **ไม่ใช่การกดซ้ำ** — ส่วนการกดซ้ำจริงเป็นคนละ request คนละ transaction เวลาจึงต่างกันเสมอ
>
> **ผลกับข้อมูลจริง 6,078 แถว:** กฎเก่าจะลบ **470 แถว** · กฎใหม่ลบ **0 แถว** → กันข้อมูลนับที่ถูกต้องไว้ได้ **470 แถว** (เหตุผล: คนละรอบนับ / คนละผู้นับ / บันทึกมาในชุดเดียวกัน)
>
> **เพิ่มความปลอดภัย:** สำรอง CSV อัตโนมัติก่อนลบ (10 คอลัมน์ครบพอ insert กลับ รวม `client_request_id`/`import_batch_id`) และ**ยกเลิกการลบถ้าสำรองไม่สำเร็จ** · ฝั่ง verify เปลี่ยนจาก `error: ข้อมูลซ้ำในระบบ` เป็น `ok`/`warn` ตามจริง · ย้าย classify เป็น post-pass ครั้งเดียว (เลี่ยง O(n²))
>
> ⚠️ **ยังเหลือ:** หน้านี้ยังกรองด้วยคลัง+เดือนปฏิทิน (ไม่มีตัวกรองรอบ) — แต่ตอนนี้ **ไม่ทำให้ข้อมูลเสียหายแล้ว** เพราะทุกการตัดสิน "ซ้ำ" ดู `cycle_id` เป็นหลัก · การไม่เขียน audit log ตอนลบ = ข้อ H3
**ตำแหน่ง:** `Html/audit_check.html:3878-3904` (dedupe), ทั้งไฟล์ไม่มีคำว่า cycle
**ยืนยันแล้ว:** grep ทั้งไฟล์ = 0 การอ้างถึง cycle; dedupe group ด้วย `warehouse|sku|location|qty` เก็บแถวเก่าสุด ลบที่เหลือ — **ขัดตรง ๆ กับ `docs/sql/011`** ที่ระบุว่าแถวซ้ำจากการนับจริง (สองคนนับ/นับซ้ำ/คนละรอบ) เป็นข้อมูลถูกต้อง
**ผลกระทบ:** การนับรอบ 2 ที่ค่าเท่ารอบ 1 ถูกมองเป็น "ซ้ำ" และ**ถูกลบถาวร** — หลักฐานผลนับหาย, reconcile รอบ 2 ขาดข้อมูล
**แนวทางแก้:** เพิ่มมิติ cycle ใน scope ของหน้า (โหลด reconcile-shared + กรอง/group รวม `cycle_id`) หรืออย่างน้อยให้ dedupe รวม `cycle_id` ใน key + เตือนชัดเจน

### - [x] H3. audit_check แก้/ลบข้อมูลจำนวนมากโดย**ไม่เขียน audit log และไม่ atomic**
> **✅ แก้แล้ว 2026-08-09 (ส่วน audit log)** — สร้าง [`Js/audit-log.js`](../Js/audit-log.js) แล้วต่อเข้าครบทั้ง **5 จุด mutation** (แก้ตำแหน่ง / สลับ SKU↔Loc / เทียบ Excel / ลบรายการที่เลือก / ลบแถวกดซ้ำ) — เดิม grep เจอ 0
>
> **หลักการที่ใช้:**
> - **ลบ** → เขียน log **ก่อน** (ลบแล้วข้อมูลหาย สร้างย้อนหลังไม่ได้) · ถ้า log ไม่สำเร็จ **ยกเลิกการลบ** และย้อน log ที่เขียนไปแล้วออก (กัน log ค้างที่บอกว่า "ลบแล้ว" ทั้งที่ยังอยู่)
> - **แก้** → เขียน log หลังแต่ละแถวสำเร็จ **flush ทุก 100 แถวระหว่าง loop** ไม่รอจบทั้งก้อน (ปิดแท็บกลางทางแล้วยังมีร่องรอย)
> - `deleteRecordsFromSupabase()` เขียน log **ในตัวเอง** — ผู้เรียกใหม่ลืมไม่ได้
> - บันทึกค่าจาก **DB จริง** (`dataset.original*`) ไม่ใช่ค่าที่ผู้ใช้พิมพ์ค้างในช่อง
> - `counter_name` ต่อท้าย `(audit_check)` เสมอ — หน้านี้ไม่มีช่องกรอกชื่อ จึงยืมชื่อผู้นับล่าสุดของเครื่อง ไม่ใช่ผู้กดจริง
>
> `Js/script.js` เพิ่มป้ายกำกับให้ drawer ประวัติแสดง `AUDIT_*` และ `IMPORT` ได้ (เดิมขึ้นว่างเปล่า) · **เทสคุ้มกัน 21 ข้อ** รวมตัวสแกนที่บังคับว่าทุกฟังก์ชันซึ่ง mutate `inventory_counts` ต้องเรียก audit log ในตัวมันเอง
>
> ⚠️ **ส่วน atomic ยังไม่ได้ทำ** → แยกเป็นข้อ M27 (ความเสี่ยงลดลงมากแล้วเพราะมี log ครบ + update เป็น idempotent)
**ตำแหน่ง:** `Html/audit_check.html:2769-2779, 2938-2946, 3717-3723` (loop update ทีละแถว), `:2481, 3938` (delete)
**ยืนยันแล้ว:** grep `inventory_audit_logs` ในไฟล์ = 0 — ทุก bulk แก้ location / สลับ SKU↔Loc / เทียบ Excel / dedupe / ลบแถว ไม่มีร่องรอยใน log เลย (ขณะที่ index.html log ทุกการแก้เดี่ยว) และพังกลางทางได้ครึ่ง ๆ กลาง ๆ ไม่มี rollback
**ผลกระทบ:** ประวัติ audit ให้ภาพเท็จว่าข้อมูลไม่เคยถูกแก้ — โหมดสลับ SKU↔Loc พังครึ่งทางกู้คืนไม่ได้เพราะค่าเดิมถูกทับ
**แนวทางแก้:** เขียน `inventory_audit_logs` ทุก mutation (batch summary ก็ยังดี) และ/หรือย้าย bulk operation ไปเป็น RPC ฝั่ง DB ให้ atomic

### - [x] H4. Dashboard โหมด "ทุกคลัง" — Book ถูกคูณด้วยจำนวนคลัง
> **✅ แก้แล้ว 2026-08-09** — ย้ายการคำนวณไปเป็น `computeBookCoverage()` ใน [`Js/dashboard-shared.js`](../Js/dashboard-shared.js) (มีเทส 8 ข้อ) แล้วให้ทั้ง `renderKpis` และ `computeWarehouseStats` ใช้ตัวเดียวกัน
> **หลักการ:** `book_stock_lines` **ไม่มีมิติคลัง** เป็นรายการ SKU ชุดเดียวต่อรอบ → นับ Book ครั้งเดียวเสมอ · "นับแล้ว" = SKU ใน Book ที่ถูกนับที่คลังไหนก็ได้ (union ไม่ใช่ผลบวก)
> เลิกใช้ป้าย "รวม 3 คลัง" ที่ hardcode · ลบ logic คำนวณซ้ำใน `render()` ที่เขียนทับแถบ progress
>
> **ผลจริงกับรอบ TIKTOK (2 คลัง):**
> | | ก่อน | หลัง | ค่าจริงใน DB |
> |---|---|---|---|
> | Book | 2,902 | **1,451** | 1,451 |
> | นับแล้ว | 2,075 | **1,402** | 1,402 |
> | ยังไม่นับ | 827 | **49** | 49 |
> | progress | 71% | **96%** | 96% |
>
> **⚠️ พบบั๊กที่สองระหว่างทดสอบ (แก้พร้อมกัน):** ดูข้อ H9

### - [x] H9. การแบ่งหน้าด้วย `.range()` เรียงไม่เสถียร → ข้าม/ซ้ำแถวเงียบ ๆ
พบตอนทดสอบ H4: dashboard โหลดผลนับได้ครบ **2,230 แถวเท่ากับ DB** แต่ **ข้ามไป 36 แถวและซ้ำอีก 36** ทำให้ KPI ต่ำกว่าความจริง 24 SKU
**สาเหตุ:** query เรียงด้วย `created_at` อย่างเดียว (บางจุด**ไม่มี `.order()` เลย**) แต่ Postgres `now()` คงที่ทั้ง transaction → การ insert ชุดเดียว (group submit / นำเข้า Excel) ทำให้หลายแถวมีเวลาเท่ากันเป๊ะ ลำดับจึงไม่คงที่ระหว่างหน้า
**จุดที่กระทบหนักสุด:** `fetchInventoryCountPresenceBySku` (`Js/reconcile-shared.js`) — ตัวตัดสินว่า SKU ไหน "นับแล้ว" ในหน้า reconcile ซึ่งใช้ประกอบการปรับยอด
> **✅ แก้แล้ว 2026-08-09** — เพิ่ม `.order('id')` เป็น tiebreak ครบ **10 จุด** ใน `reconcile-shared.js`, `script.js`, `live-count-wall.js`, `dashboard.html`, `sku_master.html`, `book_explorer.html`
> **เทสยาม** `tests/unit/stable-paging.test.mjs` สแกน source บังคับว่าทุก `.range()` ต้องมี `.order('id')` (มี allowlist ที่ต้องเขียนเหตุผลกำกับ)
> ยืนยันจริง: เรียก `fetchInventoryCountPresenceBySku` 3 ครั้งได้ 1,503 เท่ากันทุกครั้ง (ตรงกับ DB)
**ตำแหน่ง:** `Html/dashboard.html:2396-2404` + `loadPagedBookSku:2092-2124`
**ยืนยันแล้ว:** query Book กรองแค่ `cycle_id` ไม่กรอง warehouse แล้ว loop คลังบวก `bookList.length` ต่อคลัง → `totalSku`, "ยังไม่ได้นับ", progress bar ผิดเป็น N เท่า (`computeWarehouseStats:1744-1750` ก็แบบเดียวกัน)
**ผลกระทบ:** KPI หน้า dashboard เชื่อถือไม่ได้ในโหมดทุกคลัง — และแค่มีชื่อคลังสะกดผิด 1 แถวในข้อมูล ตัวเลขก็กระโดดทั้ง Book
**แนวทางแก้:** นับ Book ครั้งเดียวไม่ loop ต่อคลัง (Book ปัจจุบันไม่มีมิติคลัง) หรือถ้าต้องการต่อคลังจริงให้เพิ่มมิติคลังในข้อมูล Book ก่อน

### - [x] H5. reconcile: เปลี่ยนรอบใน dropdown แล้ว action เขียนลง**รอบเก่า**
> **✅ แก้แล้ว 2026-08-09** — ป้องกัน 3 ชั้น:
> 1. **เปลี่ยนรอบ = ล้างสถานะทันที** — `change` listener เรียก `invalidateCycleView()` (ล้าง `currentCycle` + cache ทุกตัว + state ของ Import + ซ่อน `#resultsPanel` ซึ่งครอบปุ่มที่เขียน DB ทั้ง 11 ตัว) แล้วโหลดรอบใหม่อัตโนมัติแบบไม่สั่งคำนวณใหม่
> 2. **ล็อก id ตอน guard ไม่ใช่ตอนเขียน** — `lockCycleId()` เก็บ id ไว้ตั้งแต่ต้น action แล้วส่งค่านั้นเข้า `RS.*` · หลัง confirm modal ปิดเช็คซ้ำด้วย `stillOnCycle(id)` — **นี่คือรากของบั๊ก**: เดิมอ่าน `currentCycle.id` ตอนจะเขียน ซึ่งระหว่าง `await` (modal/network) ผู้ใช้สลับรอบได้
> 3. **ล็อก dropdown + กันรันซ้อน** — `sel.disabled` + ธง `isRefreshing` ระหว่าง `runRefresh` (overlay บล็อกเมาส์ได้ แต่คีย์บอร์ดยังเปลี่ยน `<select>` ได้)
>
> เพิ่มเติม: แสดง `⚠️ ผลคำนวณเดิม (วันที่)` เมื่อโหลดรอบโดยไม่คำนวณใหม่ — กันไม่ให้ "ยอมรับผลนับ" บนตัวเลขที่ล้าสมัย · แก้ `addEventListener('click', runRefresh)` ที่ส่ง MouseEvent เป็น options
>
> **เทสคุ้มกัน 10 ข้อ** — สแกน call site ของ `RS.*` ที่เขียน DB ทุกจุด (ไม่ใช้รายชื่อ hardcode) จึงจับได้แม้ mutation ที่เพิ่มใหม่ · พบระหว่าง review ว่าปุ่มลบ draft หลุด guard ทั้งหมด (handler แบบ inline) แก้แล้ว
**ตำแหน่ง:** `Html/reconcile.html` — `#cycleSelect` ไม่มี change listener (grep พบแค่ 4 จุด ไม่มี addEventListener)
**ยืนยันแล้ว:** `currentCycle` อัปเดตเฉพาะใน `runRefresh` (`:1659`) แต่ปุ่ม mutation กว่า 25 จุดใช้ `currentCycle.id` — เปลี่ยน dropdown โดยไม่กด "คำนวณ Match" แล้วกดปุ่มใด ๆ (เพิ่ม/ลบ Book, draft, accept) = เขียนลงรอบที่แล้ว
**แนวทางแก้:** เพิ่ม change listener ที่ disable ปุ่ม action ทั้งหมดจนกว่าจะกดคำนวณ หรือ auto-refresh เมื่อเปลี่ยนรอบ

### - [x] H6. reconcile: Import Excel บังคับทุก SKU เป็น "ถูกต้อง" + ลบประวัติ adjustment ที่ applied แล้ว
**ตำแหน่ง:** `Html/reconcile.html:1479-1498` + `Js/reconcile-shared.js:2858, 2712-2717`
**ยืนยันแล้ว:** pipeline import Book (merge) ก่อนแล้วค่อยคำนวณ adjustment → `requiredAdjustmentQty = target − bookQty = 0 เสมอ` (กลไก adjustment เป็น dead path, ตัวเลขใน confirm ก็ไม่ตรงผลจริง) — สถานะเปลี่ยนเพราะ `acceptReconciliationAsMatchBatch` **force ทุก SKU ในไฟล์เป็น match ไม่สนผลนับ**; และ `clearAdjustmentsAndMatchAcceptancesForSkus` delete `stock_adjustments` **โดยไม่กรอง status** — ลบทั้ง draft และ **applied** (ทำลาย audit trail)
**ผลกระทบ:** admin เห็น KPI "ถูกต้อง" สูงโดยที่ของจริงอาจไม่ตรง + ประวัติการปรับยอดที่ apply ไปแล้วหายถาวร
**แนวทางแก้:** ตัดสินใจ semantic ที่ต้องการก่อน (นี่คือคำถามเชิงธุรกิจ): ถ้า import = "ยอด Book ใหม่ที่แก้แล้ว" ควร refresh แล้วปล่อยให้สถานะคำนวณเองตามจริง ไม่ force-accept; และ delete ควรกรอง `status='draft'` เท่านั้น
> **✅ แก้แล้ว 2026-08-09 — admin เลือก semantic แล้ว**
> 1. **สถานะ = คำนวณตามจริง** เลิก force ทุก SKU ในไฟล์เป็น match · ฟังก์ชันใหม่ `importBookAndRecompute()` (`Js/reconcile-shared.js`) ทำตามลำดับ preview(ก่อน merge) → merge Book → ล้างยอดปรับเก่า → `refresh_reconciliation_for_cycle` แล้วปล่อยให้ DB ตัดสินสถานะเอง
> 2. **ยอดปรับเก่ายังต้องลบทั้ง draft และ applied** (ไม่ใช่กรอง `status='draft'` อย่างที่เสนอไว้ตอนแรก) เพราะ `effective_book_qty = book_qty + SUM(applied)` ถ้าเหลือไว้จะนับซ้ำกับ Book ใหม่ทันที — แต่**เขียน `inventory_audit_logs` (`action_type='RECONCILE_ADJ_CLEAR'`) ก่อนลบทุกแถว** ถ้าเขียน log ไม่สำเร็จจะยกเลิกการลบทั้งชุด
> **เทสยาม** `tests/dryrun/clear-adjustments.test.mjs` [H6-guard] × 9 (รวมเคส "ลบพังหลังเขียน log แล้วต้องถอน log" และ "ไฟล์ ≠ ผลนับ ต้องได้ ขาด/เกิน")

### - [x] H7. dashboard-shared: ค่าเฉลี่ยส่งงาน/นาที สูงเกินจริง
**ตำแหน่ง:** `Js/dashboard-shared.js:38-43, 64-65`
**ยืนยันแล้ว:** bucket ถูกสร้างเฉพาะช่วงที่มีข้อมูล — `avgPerMin = total / (buckets.length × interval)` ช่วงว่าง (พักเที่ยง) หายจากตัวหาร
**แนวทางแก้:** หารด้วยช่วงเวลาจริง (max−min timestamp) หรือเติม bucket ว่างให้ครบช่วง
> **✅ แก้แล้ว 2026-08-09** — ตัวหารเป็นช่วงเวลาจริงจาก bucket แรกถึง bucket สุดท้าย (`(lastMs − firstMs)/sizeMs + 1` คูณ interval) เท่ากับเติม bucket ว่างให้ครบ · ใช้วิธีนี้แทน max−min timestamp เพราะ max−min จะสั้นกว่าช่วงจริง 1 bucket (เคส 30 นาทีจะได้ 29)
> **เทสยาม** `tests/unit/dashboard-shared.test.mjs` [H7-guard] × 3 — รวมข้อที่บังคับว่า `peakPerMin` ต้องไม่เปลี่ยน และข้อมูลต่อเนื่องต้องได้ค่าเท่าเดิม

### - [x] H8. chat: ลบแชททั้งห้องไม่มี authorization + ปุ่มยืนยันแสดงข้อความผิด + UI ค้างเมื่อไม่มี client
**ตำแหน่ง:** `Html/chat.html:545` (`okLabel` แต่ modal อ่าน `confirmLabel` — `ui-confirm-modal.js:145`), `:552-599` (ไม่มี else — ข้อความค้าง "กำลังล้างแชท...")
**ยืนยันแล้วทั้ง 2 จุด** — และโดยรวมหน้าแชทไม่มีการยืนยันตัวตน ใครก็ลบประวัติ+ไฟล์ของทุกคนได้ถาวร
**แนวทางแก้:** เปลี่ยน key เป็น `confirmLabel`, เพิ่ม else แจ้ง error, พิจารณาจำกัดปุ่มล้าง (เช่น ต้องพิมพ์คำยืนยัน หรือซ่อนไว้หลัง role)

> **✅ แก้แล้ว 2026-08-09** — footprint คือ `Html/chat.html` ไฟล์เดียว (ตั้งใจไม่แตะ `Js/ui-confirm-modal.js` เพื่อไม่ต้อง bump cache-buster 6 หน้า ระหว่างที่อีกฝั่งแก้ H6/H7 อยู่)
> 1. `okLabel` → `confirmLabel` · เทสสแกนทั้งโปรเจกต์แล้วว่าไม่มี option ตัวไหนที่ modal ไม่ได้อ่าน (กันบั๊กตระกูลเดียวกันซ้ำ)
> 2. เพิ่ม else โหมด local — ลบเฉพาะ mirror ในเครื่องแล้วบอกชัดว่าข้อมูลบนเซิร์ฟเวอร์ยังอยู่ (เดิมค้าง "กำลังล้างแชท..." ตลอดไป)
> 3. แทน authorization ที่ระบบไม่มี ด้วย **3 ด่าน**: ต้องระบุชื่อผู้ทำ → สำรองอัตโนมัติทั้งห้อง (สำรองไม่ครบ = ไม่ลบ) → พิมพ์คำว่า `ล้างแชท` · ลบเสร็จเขียนข้อความระบุผู้ล้างไว้ในห้อง
> 4. เก็บของแถมระหว่างทาง: `DELETE` นับแถวจริงด้วย `.select('id')` (RLS บล็อกแล้วคืน 0 แถวโดยไม่ error), ลบไฟล์ Storage วนจนหมด (เดิม 500 ไฟล์แรก), `statusHoldUntil` กัน realtime เขียนทับคำเตือน
>
> **เทสยาม** `tests/unit/chat-clear-guard.test.mjs` [H8-guard] × 16 — ผ่าน mutation test 7 แบบ · **ยังไม่ใช่ authorization จริง** ถ้าต้องการต้องมี Supabase Auth + RLS ต่อ role (ดู L-group)

---

## 🟡 Medium — พฤติกรรมไม่คาดคิด / เปราะบาง

### - [x] M1. cycle_config: รายการ "วัน/เดือนที่มีข้อมูล" อาจขาดหายเงียบ ๆ
> **✅ แก้แล้ว 2026-08-11** — เพิ่ม `fetchCountMonths()` + `fetchCountDaysInMonth()` ใน `Js/reconcile-shared.js` แล้วให้ `cycle_config` เรียกใช้ทั้ง 3 จุด
> เดือน: ใช้ RPC `get_inventory_count_months` (013) ก่อน — คำนวณฝั่ง DB จึงไม่ติดเพดานแถวเลย · ไม่มี RPC ค่อยตกมาแบ่งหน้า
> วัน: ไม่มี RPC จึงแบ่งหน้าด้วย `.range()` + `.order('id')` (invariant ข้อ 13) จนครบ และหยุดเร็วเมื่อครบ 31 วัน
> เทสคุ้มกัน 7 ข้อ `[M1]` ใน `tests/dryrun/cycle-scope.test.mjs` รวมข้อที่**บังคับว่าห้ามมี `.limit()` เกิน 1,000 หลงเหลือใน cycle_config**
> **review จับ regression ได้ 1 ข้อ (แก้แล้วในชุดเดียวกัน)**: รุ่นแรกส่ง `p_warehouse` ดิบเข้า RPC แต่ RPC เทียบ `warehouse = p_warehouse` ตรง ๆ จึงรับได้แค่ชื่อคลังจริง ⇒ โหมด "ทุกคลัง"/หลายคลังได้ **0 เดือน** (แย่กว่าบั๊กเดิมที่ยังได้ 1,000 แถวแรก) · ตอนนี้ผ่าน `parseCycleWarehouses()` แล้วยิง RPC ทีละคลังจริงแล้ว union
> พ่วงแก้จาก review: `count_search.html` มีฟังก์ชันชื่อเดียวกัน บั๊กเดียวกัน (`.limit(8000)`) — ย้ายมาใช้ helper แล้ว · เงื่อนไขหยุดแบ่งหน้าเปลี่ยนเป็น "เดินตามจำนวนแถวที่ได้จริง" (เดิมบวกทีละ 1,000 ซึ่งจะข้ามแถวกลางถ้า max-rows ต่ำกว่านั้น) · ข้อความเตือนแยก "รอบปิดแล้ว" ออกจาก "ข้ามเดือนแล้ว" ทั้ง index และ import_counts
> พิสูจน์กับข้อมูลจริงในเบราว์เซอร์: ทุกคลัง/หลายคลัง/คลังเดียว ได้ 3 เดือนเท่ากันหมด (ก่อนแก้ ทุกคลัง = `[]`) · วัน 06–11 ของเดือนปัจจุบันครบ · `count_search` กด "โหลดเดือน" ขึ้น "พบ 3 เดือน" · ไม่มี 4xx/console error
`Html/cycle_config.html:1001, 1152` (`.limit(10000)` — **2 จุด**), `:1224` (`.limit(5000)`) บน `inventory_counts` — Supabase hosted จำกัด max-rows (ปกติ 1000) และไม่มี paginate → เดือนที่ข้อมูลเยอะ วันที่มีนับจริงจะไม่โผล่ให้เลือก ทั้งที่มี RPC `get_inventory_count_months` (013) อยู่แล้วแต่หน้านี้ไม่ใช้ **[ยืนยันแล้ว]**
**แก้:** ใช้ RPC + เพิ่ม RPC "days with counts"

### - [ ] M2. สถานะ match ไม่ตรงกันระหว่างหน้าเว็บกับ DB
`Js/reconcile-shared.js:1080-1081` (JS: `over`) vs `docs/sql/013:77` (SQL: `count_only`) กรณี SKU อยู่ใน Book ที่ qty 0 แล้วนับเจอ **[ยืนยันแล้ว]**
**แก้:** เลือก semantic เดียวแล้วแก้อีกฝั่งให้ตรง

### - [ ] M3. reconcile: แถว "ขาด" แสดง `+N` และแถวรวมใน export ไร้ความหมาย
`Html/reconcile.html:867, 974` (ขาด 5 แสดง `+5` สีแดง), `:2447` (บวก variance คนละเครื่องหมายรวมกัน) **[ยืนยันแล้ว]**

### - [x] M4. Book import แปลงชื่อสินค้าเป็นตัวพิมพ์ใหญ่หมด
> **✅ แก้แล้ว 2026-08-10** — `parseBookExcelRows` เปลี่ยนจาก `normalizeSku` เป็น `String(...).trim()` เฉพาะคอลัมน์ชื่อ (`Js/reconcile-shared.js`) · invariant ข้อ 2 (UPPERCASE + trim) เป็นมาตรฐานของ **รหัส SKU** เท่านั้น ไม่ใช่ของชื่อ — คอลัมน์ SKU ยัง normalize เหมือนเดิม (มีเทสบังคับ)
> เทสย้ายจาก `knownIssue` → เทสถาวร **3 ข้อ** `[M4]` ใน `tests/unit/reconcile-book.test.mjs` (คงตัวพิมพ์ · trim/ไทย/ค่าว่าง · SKU ต้องยัง UPPERCASE)
> ⚠️ **แก้โค้ดไม่ได้แก้ข้อมูลเก่า** — แถวที่นำเข้าไปแล้วยังเป็น ALL CAPS ถ้าต้องการล้างต้องอัปโหลดไฟล์ Book ทับ (โหมด replace) หรือ UPDATE ใน DB ซึ่งอยู่นอกขอบเขตงานนี้
> ⚠️ **และชื่อเก่าจะ "ไหลต่อ" ไปรอบใหม่ได้** — `fetchBookNamesBySkusAnyCycle` ก็อปชื่อจากแถวเก่ามาเขียนลงแถว Book ของรอบใหม่ตอนกด "สร้างลง Book" ⇒ ถ้าจะล้างจริงต้อง `UPDATE` ครั้งเดียวให้จบ ไม่งั้นล้างรอบเดียวไม่หมด
> เหตุที่รีบแก้: ตั้งแต่ถอด `sku_master` (ซึ่งเก็บชื่อคงตัวพิมพ์) ปุ่ม "สร้างลง Book" ก็ดึงชื่อจาก `book_stock_lines` แล้ว บั๊กนี้จึงจะไหลไปทุกเส้นทาง

### - [ ] M5. Connection badge เสีย class หลังเช็คครั้งแรก
`Js/settings-shared.js:22, 27` — `badge.className = ...` ทับ `connection-badge-status` ทิ้ง (style ที่ผูกอยู่หลุด) **[ยืนยันแล้ว]** — ใช้ classList.add/remove

### - [x] M6. import_counts: retry สร้าง id ใหม่ → แถวซ้ำจริงเมื่อ network error
> **✅ แก้แล้ว 2026-08-11** — คีย์เดิมรอดตลอดเส้นทาง (`failedRows` → `pendingValidRows` → `buildCountPayload`) และ `batchImportId` สืบทอดจากแถวที่ค้าง ⇒ กดนำเข้าซ้ำชน unique index แล้วถูกนับเป็น **duplicate (ข้าม)** แทนการแทรกซ้ำ
> **และเก็บคีย์ค้างลง `localStorage.import_counts_pending_keys_v1`** — เพราะเคสที่ M6 อันตรายที่สุด (เน็ตหลุด) เป็นเคสที่ผู้ใช้กด refresh มากที่สุด · ตอน parse ไฟล์ใหม่ แถวที่ (sku+loc+qty) ตรงกับที่ค้างจะ**ยืมคีย์เดิมกลับ** ⇒ ปิดครบทั้ง 3 เส้นทางที่เคยทำคีย์หาย: refresh · อัปไฟล์เดิมทับ · (กดล้างไฟล์ = ตั้งใจเริ่มใหม่ จึงล้างคีย์ให้)
> ไฟล์ที่นำเข้าสำเร็จหมดแล้วจะไม่มีคีย์ค้าง ⇒ การนำเข้าไฟล์เดิมซ้ำโดยตั้งใจยังทำได้ปกติ
> เทสคุ้มกัน 11 ข้อ — **5 ข้อ `[behaviour]` รันโค้ดจริงผ่าน mock DB** (ไม่ใช่แค่สแกนซอร์ส) หลัง code-reviewer พิสูจน์ว่าเทสรุ่นแรกย้อนบั๊กกลับได้โดยไม่มีอะไรแดง
> เทสคุ้มกัน 3 ข้อ `[M6]` ใน `tests/unit/import-retry-idempotent.test.mjs` (พิสูจน์ด้วย mutation)

### - [ ] M7. import_counts: "Export รายละเอียด" ของ log เก่าเดาจากช่วงเวลา
`Html/import_counts.html:1149-1164` — window ±30 นาที กรองแค่คลัง+ชื่อคน — ปนแถวนับมือได้ ไฟล์ export ไม่มีเครื่องหมายบอก

### - [ ] M8. index: กติกากันซ้ำตอนแก้ไขขัดนโยบาย DB + เช็คจาก cache บางส่วน
`Js/script.js:449-471` — block ปลายทางซ้ำ (sku+loc+wh) ที่ migration 011 อนุญาต และเช็คจาก `allRecords` ที่โหลดเฉพาะ scope ปัจจุบัน — ไม่ deterministic

### - [x] M9. index: group insert แบบ all-or-nothing
> **✅ แก้แล้ว 2026-08-11** — เพิ่ม `insertGroupRowsOneByOne()` ใน `Js/script.js`: bulk ล้มแล้วตกมาทีละแถว ⇒ แถวที่ถูกต้อง**เข้า DB จริง** ไม่ถูก rollback · แถวที่ยังพังค้างอยู่ในกลุ่มให้แก้ต่อ (เดิมล้างกลุ่มทั้งชุด) · duplicate นับเป็น "บันทึกไว้แล้ว" ไม่ใช่ error · toast บอกชัดว่าเข้ากี่/ค้างกี่รายการ พร้อมเหตุผลของแถวแรกที่พัง
> ปลอดภัยเพราะทุกรายการมี `clientRequestId` ตั้งแต่ตอนกด "เพิ่มลงกลุ่ม" ⇒ retry ชน unique index แทนการแทรกซ้ำ · ถ้าไม่มีอะไรเข้า DB เลย (ไม่มีสิทธิ์/เน็ตหลุด) ยังคืนสภาพกลุ่มเหมือนเดิม
> เทสคุ้มกัน 5 ข้อ `[M9]` (พิสูจน์ด้วย mutation)

### - [ ] M10. index: KPI แสดง 0%/0 ระหว่าง Book โหลด โดยแยกไม่ออกจาก "นับครบแล้ว"
`Js/script.js:1345, 1363`

### - [ ] M11. count_search: ตัวเลือกเดือนตัดที่ 8000 แถวเงียบ ๆ
`Html/count_search.html:566` — เดือนเก่าหายจาก picker โดยไม่เตือน

### - [ ] M12. audit_check: guard ชนปลายทางเช็คจาก reference map ที่จำกัด scope
`Html/audit_check.html:2017-2145` — มองไม่เห็นข้อมูลนอกคลัง/เดือนปัจจุบัน + O(n) scan ใน loop ช้ามากเมื่อข้อมูลเยอะ (`:1229, 2003-2011`)

### - [ ] M13. audit_check: โหมดสลับ SKU↔Loc normalize ฝั่งเดียว
`Html/audit_check.html:2742-2778` — SKU ใหม่ถูก UPPERCASE แต่ location ใหม่เขียนดิบ — สลับ 2 ครั้งไม่ได้ค่าเดิม

### - [ ] M14. cycle_config: ยืนยัน link ขั้น 2 ไม่ reset ตอน cancel
`Html/cycle_config.html:1969-1999` — cancel แล้วปุ่มค้าง "(2/2)" คลิกถัดไปผูกทันที

### - [ ] M15. chat-notify: badge ยังไม่อ่านเพิ่มต่อแท็บที่เปิด + เพิ่มแม้อ่านอยู่
`Js/chat-notify-shared.js:207, 209-214` — เปิด 3 แท็บ ข้อความเดียว badge +3

### - [ ] M16. dashboard: `async render()` ไม่มีใคร await
`Html/dashboard.html:2764` + call sites — RPC พังกลายเป็น unhandled rejection ผู้ใช้ไม่เห็น error

### - [ ] M17. deleteCycle ไม่ atomic
`Js/reconcile-shared.js:965-1017` — unlink counts กับ delete cycle เป็น 2 statement พังกลางทางค้างสถานะครึ่ง ๆ

### - [ ] M18. reconcile: `%` ใช้ค่าเก่าจาก DB ขัดกับคอลัมน์ "ต่าง" ที่คำนวณใหม่เมื่อมี draft
`Html/reconcile.html:895`

### - [x] M19. `encodeCycleWarehouses` เรียงไม่เสถียร — ชุดคลังเดียวกัน encode ได้ 2 แบบ = 2 รอบใน DB
> **✅ แก้แล้ว 2026-08-11** — comparator เดิม map คลังนอกรายการเป็น 99 เท่ากันหมด ⇒ คืน 0 ⇒ `Array.sort` ของ V8 เสถียรจึงคงลำดับ input ⇒ "A|B" กับ "B|A" เป็นคนละสตริง
> เพิ่ม tiebreak ด้วย `localeCompare(.., 'th')` สำหรับคลังนอกรายการ + ตัดชื่อซ้ำ/ช่องว่างทิ้ง
> ⚠️ **ลำดับคลังมาตรฐานคงเดิมโดยตั้งใจ** (ตาม registry) — ถ้าเปลี่ยนไปเรียงตามชื่อทั้งหมด รอบที่มีอยู่แล้วใน DB จะ encode ได้คนละค่า = สร้างรอบซ้ำเสียเอง · มีเทสบังคับข้อนี้
> เทสย้ายจาก `knownIssue` → เทสถาวร 4 ข้อ
> 🔶 **ยังเหลือครึ่งหนึ่ง → แตกเป็น M33** — review ชี้ว่าเส้นทางที่แก้ (คลังนอกรายการมาตรฐาน) แทบไม่เกิดจริง เพราะ `refreshStandardWarehousesFromRegistry()` เขียนทับ `STANDARD_WAREHOUSES` ด้วย registry ทั้งชุดก่อนสร้าง checkbox ⇒ ทุกคลังที่เลือกได้เป็น "มาตรฐาน" เสมอ · เคสที่เกิดจริงคือ admin จัดลำดับคลังใหม่ในหน้า Settings

### - [x] M20. user_manual: รูปเก็บซ้ำ 2 ชุดใน localStorage + backup กู้กลับไม่ได้ + toast quota ไม่ทำงาน
> 🚫 **ตกไป 2026-08-11** — ถอดหน้าคู่มือออกจากระบบทั้งฟีเจอร์ (มติ admin) · key `stock_audit_user_manual_v2` / `stock_audit_manual_mode_v1` อาจค้างในเบราว์เซอร์ผู้ใช้แต่ไม่มีโค้ดอ่านแล้ว
`Js/manual-editor.js:37-41, 205-218, 44-53`

### - [ ] M31. import_counts: คีย์ค้างไม่ผูกกับคลัง/ผู้นับ
ถ้าผู้ใช้เปลี่ยน dropdown คลังก่อนกด "นำเข้าแถวที่เหลือ" และแถวนั้นเข้า DB ไปแล้วในคลังเดิม จะถูกนับเป็น "ข้ามซ้ำ" เงียบ ๆ แทนที่จะเข้าคลังใหม่ (`Html/import_counts.html` — คีย์ผูกกับ sku+loc+qty ไม่ผูก context) · ไม่มีทางเลือกไหน "ถูก" ชัด แต่ควรเตือนเมื่อคลัง/ผู้นับเปลี่ยนขณะมีแถวค้าง · **พบจาก review M6** 

### - [ ] M32. ไม่มี circuit breaker ตอน insert รายแถว
`Js/script.js` `insertGroupRowsOneByOne` (25 แถว) และ `Html/import_counts.html` `importRowsOneByOne` (chunk 200) วน insert แบบ sequential ไม่มีเงื่อนไขเลิก — เน็ตตาย = ยิงต่อจนครบทุกแถว UI ค้างยาว · ควร break เมื่อเจอ network error ติดกัน 3 ครั้งแล้วโยนแถวที่เหลือเข้า `failed` · **พบจาก review M6/M9**

### - [ ] M33. ลำดับคลังใน registry เป็น input ที่ไม่เสถียรของ `encodeCycleWarehouses`
`Js/reconcile-shared.js:177-187` `refreshStandardWarehousesFromRegistry()` ตั้ง `STANDARD_WAREHOUSES` จาก `warehouses.sort_order` ซึ่ง admin จัดลำดับใหม่ได้ในหน้า Settings (`Js/warehouses-shared.js` `sortWarehouseRows` / `compactActiveSortOrders`) ⇒ **ชุดคลังเดิมจะ encode ได้คนละสตริงหลังจัดลำดับใหม่** ⇒ unique index `uq_count_cycles_full_month` / `uq_count_cycles_date_range` เทียบสตริงตรง ๆ จึงจับไม่ได้ ⇒ สร้างรอบซ้ำ (อาการเดียวกับ M19)
แก้ยาก: เรียงตามชื่อล้วนจะทำให้รอบเก่าใน DB encode ได้คนละค่า ต้องมี migration แปลงสตริงรอบเก่าพร้อมกัน — หรือเปลี่ยนไปเทียบด้วยชุดคลังที่เรียงแล้ว (generated column) แทนสตริงดิบ · **พบจาก review M19**

### - [ ] M34. `audit_check` มี `fetchAvailableMonths` ซ้ำกับ `RS.fetchCountMonths` ทั้งดุ้น
`Html/audit_check.html:1700-1730` — RPC ก่อน → regex เดียวกัน → paging 1,000 เหมือนกัน แต่หน้านี้ไม่โหลด `reconcile-shared.js` จึงใช้ helper กลางไม่ได้ทันที · แก้บั๊กตัวเดียวกันต้องแก้ 2 ที่ตลอดไป (หน้านี้รอดจาก regression "ทุกคลัง" เพราะส่งชื่อคลังเดี่ยวเสมอ) · **พบจาก review M1**

### - [ ] M21. chat: ล้าง Storage จำกัด 500 ไฟล์ไม่มี pagination + ไฟล์แนบเป็น public URL ถาวร
`Html/chat.html:565, 386-390`

### - [x] M22. book_explorer: layout แตกแถวจากหน้าอื่น (ไม่มี `has-sidebar`)
`Html/book_explorer.html:12, 113, 116` — ตรงกับอาการ "ตำแหน่งเพี้ยน" ใน SYSTEM_GUIDE §6.3
> **✅ แก้แล้ว 2026-08-10** (พ่วงมากับงาน UI1) — ใส่ `class="has-sidebar"` ที่ `<body>` และย้ายระยะขอบมาไว้ที่ `.main-content` (`padding: 2rem 1.5rem 3rem` เท่า `.main-area`) เพราะ `has-sidebar` ตั้ง body padding เป็น 0 · ยืนยันในเบราว์เซอร์: sidebar อยู่ที่ x=0 กว้าง 220px เนื้อหาเริ่มที่ x=220 (เดิมลอยกลางจอ)

### - [x] UI1. เมนูซ้ายแตกบนมือถือ / iPad แนวตั้ง / จอคอมแคบ
`Css/style.css:1164-1194 (เดิม)` — บล็อก `@media (max-width:900px)` เขียนไว้ตอนเมนูยังเป็น "แถวไอคอนแบน" แต่ `Js/sidebar-shared.js` เปลี่ยนไปเรนเดอร์เป็น "กลุ่มพับได้" (column) แล้ว → CSS สั่ง `flex-direction: row` ทับ DOM แนวตั้ง ทำให้หัวข้อกลุ่ม (`width:100%`) ยืดเต็มความกว้างแล้วตกบรรทัดมั่ว · ชื่อกลุ่มไทย + chevron ยังโชว์เพราะกฎซ่อนข้อความจับแค่ `.sidebar-nav-item span` ไม่ครอบ `.sidebar-group-left span`
> **✅ แก้แล้ว 2026-08-10** — เปลี่ยนเป็นลิ้นชักสไลด์ (off-canvas drawer) + ปุ่ม ☰ + ฉากมืด คงรูปทรงเมนูแนวตั้งเดิมไว้ทั้งหมด · เทส `tests/unit/sidebar-responsive.test.mjs` × 9 กันไม่ให้ CSS responsive หลุดจาก DOM จริงอีก (พิสูจน์ด้วย mutation แล้ว)

### - [ ] UI2. ลิ้นชักเมนูจอเล็กยังไม่มี focus trap
พบจาก review ของ UI1 — ตอนลิ้นชักเปิดบนจอเล็ก กด Tab ต่อจากเมนูตัวสุดท้ายแล้วโฟกัสวิ่งเข้าเนื้อหาหลังฉากมืดได้ (ยังไม่ตั้ง `inert` / `aria-hidden` ให้ `.app-layout`)
**ผลกระทบจริงต่ำ**: ผู้ใช้บนมือถือใช้นิ้วแตะ ไม่ค่อยใช้ Tab · เมนูปิดสนิทเมื่อไม่เปิด (`visibility: hidden` ตัดออกจากลำดับ Tab แล้ว) — เหลือเฉพาะช่วงที่เปิดอยู่
**แนวทางแก้:** ตั้ง `document.querySelector('.app-layout').inert = true` ตอนเปิด และคืนค่าตอนปิดใน `setDrawer()` (`Js/sidebar-shared.js`)

### - [x] M25. `getClient()` สร้าง Supabase client ใหม่ทุกครั้งที่ถูกเรียก
พบจากที่ admin เห็น console เตือน `Multiple GoTrueClient instances detected` รัว ๆ — `Js/api.js` `getSupabaseClient()` เรียก `createClient()` ใหม่ทุกครั้ง ทำให้หนึ่งหน้าเว็บมี client 6+ ตัว แต่ละตัวมี GoTrueClient + timer refresh token ของตัวเอง ใช้ storage key เดียวกัน (เปลืองและพฤติกรรมไม่แน่นอน)
> **✅ แก้แล้ว 2026-08-09** — cache client ตาม `(url, key)` สร้างใหม่เฉพาะตอน config เปลี่ยน · เทส 3 ข้อใน `tests/unit/api-client-cache.test.mjs` · ยืนยันจริง: เดิม 6 warning/โหลด → เหลือ **0**

### - [ ] M27. bulk update ใน audit_check ยังไม่ atomic (แยกจาก H3)
loop `update` ทีละแถวไม่มี transaction — พังกลางทางแล้วบางแถวเปลี่ยน บางแถวไม่เปลี่ยน
**ความเสี่ยงตอนนี้ต่ำ** เพราะ (1) มี audit log ครบทุกแถวที่สำเร็จแล้ว ตามรอยได้ (2) การ set location เป็นค่าเป้าหมายเป็น idempotent กดซ้ำได้ (3) มี guard ตรวจก่อนเริ่ม
**ข้อยกเว้น:** สลับ SKU↔Location ไม่ idempotent (กดซ้ำ = สลับกลับ) — แต่มี log before/after ให้กู้ได้
**แนวทางแก้:** RPC ฝั่ง DB ที่รับ array แล้ว update + เขียน log ใน transaction เดียว (`SECURITY DEFINER` + `SET search_path` ตามบทเรียนจาก 018) — ต้องขออนุมัติ admin ก่อนเพราะแตะ DB

### - [x] M26. `getDestinationCollision` ยังบล็อกการแก้ตำแหน่งตาม key ที่ migration 011 ยกเลิก
พบระหว่าง review H2 — H2 แก้ฝั่ง "ลบ" แล้ว แต่ `Html/audit_check.html` `getDestinationCollision()` ยัง **block** การแก้ location/สลับ SKU เมื่อปลายทางมีแถว `sku+loc+warehouse+qty` เหมือนกันอยู่ ทั้งที่แถวนั้นอาจมาจากคนละรอบ/คนละผู้นับ (= ข้อมูลถูกต้อง)
**ผลกระทบ:** แก้ตำแหน่งแบบ bulk ไม่ผ่านโดยไม่มีเหตุผลที่ถูกต้อง (ไม่ทำข้อมูลเสียหาย แค่ทำงานไม่ได้)
> **✅ แก้แล้ว 2026-08-10** — ย้ายการตัดสินไป `classifyDestinationCollision` ใน [`Js/audit-dedupe.js`](../Js/audit-dedupe.js)
> บล็อกเฉพาะเมื่อปลายทางมีแถว **รอบนับเดียวกัน** (จะกลายเป็นเคส H10 ที่ Match บวกซ้ำ) · คนละรอบ = ผ่าน พร้อมแสดงรายการเตือนในกล่องยืนยันก่อนบันทึก
> `validateDestUpdateBatch` คืน `{ok, blocked, warned}` · เทส `unit/audit-dedupe` [M26] × 6

### - [x] H11. audit_check มองไม่เห็นแถวทับซ้อน (ตำแหน่งเดียวกัน จำนวนต่างกัน)
> **✅ แก้แล้ว 2026-08-10** — เก็บไว้เป็นบันทึกเพราะเป็นบั๊กที่ทำให้ยอด Match เพี้ยนจริงในข้อมูลปัจจุบัน

`refresh_reconciliation_for_cycle` ใช้ `SUM(counted_qty)` ต่อ SKU ต่อรอบ → SKU เดียวกันที่ตำแหน่งเดียวกันหลายแถวถูกบวกรวมเสมอ แต่หน้า audit_check ขึ้นเขียว "ข้อมูลถูกต้อง" ทุกแถว
**หลักฐาน (รอบ `141972ac` สิงหาคม 2569):** 16 กลุ่ม · **6 กลุ่มที่ลบแถวเดียวแล้ว variance = 0 พอดีเป๊ะ** (BNP298 51+1 vs Book 1 · NER041 11+1 vs 1 · RJGN0870 2+19 vs 2 · RJBL0354 8+1 vs 1 · FR022 3+1 vs 1 · NB070 42+1 vs 42) รวมยอดเกินหลอก ~285 ชิ้นเมื่อรวม PC700
**แต่ตัดสินอัตโนมัติไม่ได้:** `BNP20 @ B2-01` = 70+200 = 270 = Book 270 เป๊ะ → ทยอยนับที่ถูกต้อง
**ทางแก้ที่ใช้:** สถานะใหม่ "ทับซ้อน" (ส้ม) + โหลด `reconciliation_lines` มาเทียบ Book — [`Js/audit-book-impact.js`](../Js/audit-book-impact.js) · ตามนโยบาย admin (invariant 3) **ไม่มีคำแนะนำให้ลบ** (นับแยกถุงเป็นเรื่องปกติ) ให้คนกด "ยืนยันว่าปกติ" แทน · เทส `unit/audit-book-impact`

### - [ ] M29. `deleteCycle` ลบยอดปรับทั้งรอบด้วย FK CASCADE โดยไม่มี audit log
พบระหว่าง review H6 — `deleteCycle()` (`Js/reconcile-shared.js:1030-1038`, เรียกจาก `Html/cycle_config.html`) ลบ `count_cycles` แล้ว CASCADE พา `stock_adjustments` (รวม **applied**), `book_stock_lines`, `reconciliation_lines` หายทั้งรอบ
**ผลกระทบ:** เป็นเส้นทางที่ลบ adjustment ที่ apply แล้วได้มากที่สุดในระบบ และไม่ทิ้งหลักฐานเลย — H6 ปิดเฉพาะเส้นทาง import และลบรายการ Book
**แนวทางแก้:** ใช้ `logAdjustmentsBeforeDelete()` ตัวเดียวกับ H6 หรือเขียน log สรุประดับรอบ 1 แถวก่อนลบ (ปริมาณอาจมากถ้า log รายแถว)

### - [ ] M30. `RECONCILE_ADJ_CLEAR` อาจท่วม drawer ประวัติในหน้า index
drawer ดึง `inventory_audit_logs` แค่ 100 แถวล่าสุดโดยไม่กรอง `action_type` (`Js/script.js:1787-1791`) — import ครั้งเดียวที่ล้างยอดปรับ 500 SKU จะเขียน log 500 แถวและกลบประวัติการนับหายจากหน้าจอ
**แนวทางแก้:** เพิ่มตัวกรอง action_type/แท็บในหน้า index หรือเขียนเป็น log สรุปต่อ import 1 แถว (แบบที่ `IMPORT` ทำ) แล้วเก็บรายละเอียดรายแถวไว้ต่างหาก — ต้องชั่งกับกติกา "ทุกแถวที่ลบต้องมีหลักฐานรายแถว"

### - [x] M24. รอบที่ปิดแล้ว (`status = closed/archived`) ยังรับผลนับใหม่ได้
> **✅ แก้แล้ว 2026-08-11** — `isCycleRelevantNow()` เช็ค `isCycleClosed(cycle)` ก่อนเป็นอย่างแรก **และ** `filterCyclesCurrentMonth()` ใน `Js/script.js` กรองรอบที่ปิดออกจาก dropdown หน้านับ — ทำคู่กันตามที่แนวทางแก้ระบุไว้ ไม่งั้นผู้ใช้เลือกรอบที่ปิดได้แต่ระบบเงียบ ๆ ไม่แนบ แล้ววนเตือนซ้ำ
> เทสคุ้มกัน 5 ข้อ `[M24]` (รวมข้อที่บังคับว่า dropdown ต้องกรองด้วย)
พบระหว่าง review การแก้ H1 — `isCycleRelevantNow()` (`Js/reconcile-shared.js`) ดูแค่ช่วงเวลา **ไม่ดู `status`** ดังนั้นรอบที่ถูกปิดไปแล้วแต่ยังอยู่ในเดือนปัจจุบัน ยังถูกแนบให้ผลนับใหม่ได้ → ข้อมูลไหลเข้ารอบที่ปิด/กระทบยอดที่ reconcile ไปแล้ว
**ผลกระทบตอนนี้: ยังไม่มี** — ตรวจแล้วทั้ง 6 รอบใน DB เป็น `open` ทั้งหมด
**แนวทางแก้:** เพิ่มเงื่อนไข `if (['closed','archived'].includes(cycle.status)) return false;` **พร้อมกับ** กรองรอบที่ปิดออกจาก dropdown ในหน้านับ (`filterCyclesCurrentMonth` ใน `Js/script.js:120`) — ต้องทำคู่กัน ไม่งั้นผู้ใช้เลือกรอบที่ปิดได้แต่ระบบเงียบ ๆ ไม่แนบ แล้ววนเตือนซ้ำ

### - [ ] M23. debug log จากโปรเจกต์อื่นหลุดเข้า git + ไม่มี .gitignore
`.cursor/debug-93df3f.log` (log Gemini API วิเคราะห์เครื่องประดับ — คนละโปรเจกต์), `.cursor/debug-ae4a9b.log` — ควรลบทั้งคู่ + เพิ่ม `.gitignore`

---

## 🟢 Low — ความสะอาดโค้ด / dead code / ป้ายผิด

### - [ ] L1. Dead code ก้อนใหญ่ใน index/script.js — **ปิดไปครึ่งข้อ**
- ✅ **แก้แล้ว 2026-08-10** — Extra-SKU drawer ลบครบทั้งฟีเจอร์ (`buildExtraCountedItems` + 6 ฟังก์ชัน + cache + `toggleModal` + `clearListBtn` + 2 สาขา progress) รวม −205 บรรทัด
- ⬜ **ยังเหลือ** — Dashboard modal ทั้งชุดเข้าถึงไม่ได้: `index.html:316-412` + `Js/script.js` (`openDashboard()` ทำ `location.href = 'Html/dashboard.html'` ไม่ได้เปิด `#dashboardModal`) — และโหลด Chart.js CDN ฟรี ๆ (`index.html:18`)

### - [ ] L2. Dead code กระจาย — **ปิดไปเกือบหมด เหลือ 4 จุด**
- ✅ **แก้แล้ว 2026-08-10** — `dashboard.html` (`renderFilters`, `buildLookup`, `getSkuWarehouse`, `.status-chip.bad`), `reconcile.html` (`resolveAdjustmentQtyFromInput`), `import_counts.html` (`hasPartial`), CSS/id ตายรายหน้าอีก 12 จุด
- ⬜ **ยังเหลือ** — `audit_check.html` (`verifyAll`/`btnLoadCounts` binding ที่ปุ่มไม่มีจริง, `skuLocKey`, `countDataRowsInZone`, `.audit-toolbar-left`, `historySubtitle`, `audit_check_warehouse` เขียนแล้วไม่อ่าน) · `dashboard.html:1614` (`bookSku` write-only) · `live-count-wall.js` (`bangkokTodayRange`, `skuMatchesScope`, `window.liveCountWall`) · `settings.html:374` (`window.RS` ไม่มีอยู่จริง) · `reconcile.html:1326-1346` (preview ไม่เคยแสดง), `:693` (`adjInputMode`) · `reconcile-shared.js` 6 ฟังก์ชันตายสนิท ~180 บรรทัด (`applyAdjustmentsToBookTargets`, `acceptReconciliationAsMatchBatch`, `fetchBookQtySums`, `updateCycleStatus`, `isMultiWarehouseCycle`, `importBookStockLinesMerge`) — ⚠️ ลบแล้วต้องลด `shared-smoke.test.mjs:32` จาก `>= 80` เป็น `>= 75` ในคอมมิตเดียวกัน · `ui-confirm-modal.js` (`parseMessage`) · `db-errors.js:24` (`SERIALIZATION`) · `Css/style.css` บล็อก KPI ~164 บรรทัด + `.sidebar-*-flat` 32 บรรทัด + `--input-focus`

### - [ ] L3. `escapeHtml` 5 เวอร์ชัน + fallback รายชื่อคลัง 3 ชุด + connection badge 3 แบบ
รวมเป็น util กลางชุดเดียว (เกี่ยวพันกับ C2)

### - [ ] L4. ป้าย/ข้อความผิด
`dashboard.html:2443` "รวม 3 คลัง" hardcode; `live-count-wall.js:607` "วันนี้" (จริงคือรายเดือน); `settings.html:192` ป้าย "(anon/public)" ขัดค่าจริง

### - [ ] L5. `readAsBinaryString` deprecated 3 จุด
`import_counts.html:954`, `audit_check.html:3844`, `cycle_config.html:1781` — เปลี่ยนเป็น arrayBuffer (reconcile ใช้แล้ว)

### - [ ] L6. ลำดับคอลัมน์ Excel/paste ไม่ตรงกันระหว่างหน้า
import_counts ไฟล์ = Loc, SKU, Qty แต่ audit_check paste = SKU, Loc, Qty — ตึกเดียวกัน 2 กติกา

### - [ ] L7. นโยบายแถวซ้ำในไฟล์ import ไม่ตรงกัน
🚫 **ตกไป 2026-08-10** — ฟีเจอร์ SKU Master ถูกถอดออกจากเว็บ เหลือ importer ตัวเดียวคือ Book (cycle_config)

### - [ ] L8. เอกสารเดิมล้าสมัย — **แก้แล้วเกือบหมด 2026-08-10**
✅ แก้แล้ว: `docs/SYSTEM_GUIDE.md` (ฟิลเตอร์ book_explorer ที่ไม่มีจริง, ตารางหลักขาด 5 ตัว, รายการ SQL, KPI อิง sku_master) · `docs/RECONCILIATION_DESIGN.md` (Phase 3 "รอทำ", รายการ SQL, `reconciliation_match_acceptances`, "ไฟล์เสนอ" ที่สร้างแล้ว) · `docs/DATABASE.md` (ขาด `inventory_count_acceptances` จาก 019, ลิสต์ `chat_attachments` เป็นตารางทั้งที่ไม่มีจริง) · `docs/ARCHITECTURE.md` + `docs/pages/sku_master.md` (อ้างว่า index อิง sku_master)
⬜ ยังเหลือ: **ทิศทางเครื่องหมาย adjustment ใน RECONCILIATION_DESIGN.md ขัดกับโค้ด** — ยังไม่ได้ verify

### - [ ] L9. SQL hygiene
ไฟล์ `003_reconciliation_book_only_with_zero_count.sql` เลขซ้ำ+เนื้อหา no-op (ควรลบ); `010` ปน DDL ทำลายล้างกับ diagnostics ใน script เดียว; `007` สร้าง reason ที่ client ไม่เคยใช้

### - [ ] L10. คลังแบบพิมพ์เอง (custom) ใน index.html ไม่เข้า registry
เลือกไม่ได้ในหน้า import/count_search/audit_check จนกว่าจะเพิ่มเองใน settings

### - [ ] L11. เบ็ดเตล็ด
count_search `cycle_id` โหลดมาแต่ไม่ใช้; precedence คลังสลับกันระหว่าง import_counts กับ count_search; cycle_config confirm 2 ระบบปนกัน + N+1 รายการรอบ + timezone 2 วิธี; `ui-confirm-modal.js:184` expression `hideBulletsBox` กลับค่าเอง; `warehouses-shared.js:52-60` update ทีละแถวทุกครั้งที่แตะ registry; `book_explorer` reuse query builder ข้าม await; loadImportHistory เรียกซ้ำ 2 ครั้งตอนบูต

---

## สรุปจำนวน

| ระดับ | จำนวน | สถานะ verify |
|---|---|---|
| 🔴 Critical | 2 | ✅ **แก้ครบแล้วทั้ง C1 และ C2** |
| 🟠 High | 9 | ✅ **แก้ครบแล้วทั้ง H1–H9** |
| 🟡 Medium | 27 | ✅ M25 แก้แล้ว · M24, M26, M27 รอ · ที่เหลือจากการสำรวจละเอียด |
| 🟢 Low | 11 กลุ่ม | L3 (cache-buster + escapeHtml ซ้ำ) แก้ไปเกือบหมดตอนทำ H1/C2 |

**ข้อเสนอลำดับการแก้ (เมื่อ admin เลือกแล้ว):**
1. รอบ security: C1 + C2 (ควรทำคู่กัน — C2 ร้ายแรงเพราะ C1)
2. รอบความถูกต้องข้อมูล: H1, H2, H3, H6 (กระทบ integrity ของหลักฐานผลนับ)
3. รอบความถูกต้อง KPI/UI: H4, H5, H7, H8, M1-M5
4. รอบทำความสะอาด: Medium/Low ที่เหลือ
