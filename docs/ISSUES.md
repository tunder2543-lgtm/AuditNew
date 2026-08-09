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
> ⚠️ **ยังเหลือ (นอกขอบเขต C2):** `Js/manual-editor.js:243` `root.innerHTML = state.html` จาก localStorage — เป็น self-XSS (ผู้ใช้ทำร้ายตัวเองเท่านั้น) จะเป็นปัญหาก็ต่อเมื่อทำฟีเจอร์ import ไฟล์ backup กลับ
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

### - [ ] H3. audit_check แก้/ลบข้อมูลจำนวนมากโดย**ไม่เขียน audit log และไม่ atomic**
**ตำแหน่ง:** `Html/audit_check.html:2769-2779, 2938-2946, 3717-3723` (loop update ทีละแถว), `:2481, 3938` (delete)
**ยืนยันแล้ว:** grep `inventory_audit_logs` ในไฟล์ = 0 — ทุก bulk แก้ location / สลับ SKU↔Loc / เทียบ Excel / dedupe / ลบแถว ไม่มีร่องรอยใน log เลย (ขณะที่ index.html log ทุกการแก้เดี่ยว) และพังกลางทางได้ครึ่ง ๆ กลาง ๆ ไม่มี rollback
**ผลกระทบ:** ประวัติ audit ให้ภาพเท็จว่าข้อมูลไม่เคยถูกแก้ — โหมดสลับ SKU↔Loc พังครึ่งทางกู้คืนไม่ได้เพราะค่าเดิมถูกทับ
**แนวทางแก้:** เขียน `inventory_audit_logs` ทุก mutation (batch summary ก็ยังดี) และ/หรือย้าย bulk operation ไปเป็น RPC ฝั่ง DB ให้ atomic

### - [ ] H4. Dashboard โหมด "ทุกคลัง" — Book ถูกคูณด้วยจำนวนคลัง
**ตำแหน่ง:** `Html/dashboard.html:2396-2404` + `loadPagedBookSku:2092-2124`
**ยืนยันแล้ว:** query Book กรองแค่ `cycle_id` ไม่กรอง warehouse แล้ว loop คลังบวก `bookList.length` ต่อคลัง → `totalSku`, "ยังไม่ได้นับ", progress bar ผิดเป็น N เท่า (`computeWarehouseStats:1744-1750` ก็แบบเดียวกัน)
**ผลกระทบ:** KPI หน้า dashboard เชื่อถือไม่ได้ในโหมดทุกคลัง — และแค่มีชื่อคลังสะกดผิด 1 แถวในข้อมูล ตัวเลขก็กระโดดทั้ง Book
**แนวทางแก้:** นับ Book ครั้งเดียวไม่ loop ต่อคลัง (Book ปัจจุบันไม่มีมิติคลัง) หรือถ้าต้องการต่อคลังจริงให้เพิ่มมิติคลังในข้อมูล Book ก่อน

### - [ ] H5. reconcile: เปลี่ยนรอบใน dropdown แล้ว action เขียนลง**รอบเก่า**
**ตำแหน่ง:** `Html/reconcile.html` — `#cycleSelect` ไม่มี change listener (grep พบแค่ 4 จุด ไม่มี addEventListener)
**ยืนยันแล้ว:** `currentCycle` อัปเดตเฉพาะใน `runRefresh` (`:1659`) แต่ปุ่ม mutation กว่า 25 จุดใช้ `currentCycle.id` — เปลี่ยน dropdown โดยไม่กด "คำนวณ Match" แล้วกดปุ่มใด ๆ (เพิ่ม/ลบ Book, draft, accept) = เขียนลงรอบที่แล้ว
**แนวทางแก้:** เพิ่ม change listener ที่ disable ปุ่ม action ทั้งหมดจนกว่าจะกดคำนวณ หรือ auto-refresh เมื่อเปลี่ยนรอบ

### - [ ] H6. reconcile: Import Excel บังคับทุก SKU เป็น "ถูกต้อง" + ลบประวัติ adjustment ที่ applied แล้ว
**ตำแหน่ง:** `Html/reconcile.html:1479-1498` + `Js/reconcile-shared.js:2858, 2712-2717`
**ยืนยันแล้ว:** pipeline import Book (merge) ก่อนแล้วค่อยคำนวณ adjustment → `requiredAdjustmentQty = target − bookQty = 0 เสมอ` (กลไก adjustment เป็น dead path, ตัวเลขใน confirm ก็ไม่ตรงผลจริง) — สถานะเปลี่ยนเพราะ `acceptReconciliationAsMatchBatch` **force ทุก SKU ในไฟล์เป็น match ไม่สนผลนับ**; และ `clearAdjustmentsAndMatchAcceptancesForSkus` delete `stock_adjustments` **โดยไม่กรอง status** — ลบทั้ง draft และ **applied** (ทำลาย audit trail)
**ผลกระทบ:** admin เห็น KPI "ถูกต้อง" สูงโดยที่ของจริงอาจไม่ตรง + ประวัติการปรับยอดที่ apply ไปแล้วหายถาวร
**แนวทางแก้:** ตัดสินใจ semantic ที่ต้องการก่อน (นี่คือคำถามเชิงธุรกิจ): ถ้า import = "ยอด Book ใหม่ที่แก้แล้ว" ควร refresh แล้วปล่อยให้สถานะคำนวณเองตามจริง ไม่ force-accept; และ delete ควรกรอง `status='draft'` เท่านั้น

### - [ ] H7. dashboard-shared: ค่าเฉลี่ยส่งงาน/นาที สูงเกินจริง
**ตำแหน่ง:** `Js/dashboard-shared.js:38-43, 64-65`
**ยืนยันแล้ว:** bucket ถูกสร้างเฉพาะช่วงที่มีข้อมูล — `avgPerMin = total / (buckets.length × interval)` ช่วงว่าง (พักเที่ยง) หายจากตัวหาร
**แนวทางแก้:** หารด้วยช่วงเวลาจริง (max−min timestamp) หรือเติม bucket ว่างให้ครบช่วง

### - [ ] H8. chat: ลบแชททั้งห้องไม่มี authorization + ปุ่มยืนยันแสดงข้อความผิด + UI ค้างเมื่อไม่มี client
**ตำแหน่ง:** `Html/chat.html:545` (`okLabel` แต่ modal อ่าน `confirmLabel` — `ui-confirm-modal.js:145`), `:552-599` (ไม่มี else — ข้อความค้าง "กำลังล้างแชท...")
**ยืนยันแล้วทั้ง 2 จุด** — และโดยรวมหน้าแชทไม่มีการยืนยันตัวตน ใครก็ลบประวัติ+ไฟล์ของทุกคนได้ถาวร
**แนวทางแก้:** เปลี่ยน key เป็น `confirmLabel`, เพิ่ม else แจ้ง error, พิจารณาจำกัดปุ่มล้าง (เช่น ต้องพิมพ์คำยืนยัน หรือซ่อนไว้หลัง role)

---

## 🟡 Medium — พฤติกรรมไม่คาดคิด / เปราะบาง

### - [ ] M1. cycle_config: รายการ "วัน/เดือนที่มีข้อมูล" อาจขาดหายเงียบ ๆ
`Html/cycle_config.html:1001, 1152` (`.limit(10000)` — **2 จุด**), `:1224` (`.limit(5000)`) บน `inventory_counts` — Supabase hosted จำกัด max-rows (ปกติ 1000) และไม่มี paginate → เดือนที่ข้อมูลเยอะ วันที่มีนับจริงจะไม่โผล่ให้เลือก ทั้งที่มี RPC `get_inventory_count_months` (013) อยู่แล้วแต่หน้านี้ไม่ใช้ **[ยืนยันแล้ว]**
**แก้:** ใช้ RPC + เพิ่ม RPC "days with counts"

### - [ ] M2. สถานะ match ไม่ตรงกันระหว่างหน้าเว็บกับ DB
`Js/reconcile-shared.js:1080-1081` (JS: `over`) vs `docs/sql/013:77` (SQL: `count_only`) กรณี SKU อยู่ใน Book ที่ qty 0 แล้วนับเจอ **[ยืนยันแล้ว]**
**แก้:** เลือก semantic เดียวแล้วแก้อีกฝั่งให้ตรง

### - [ ] M3. reconcile: แถว "ขาด" แสดง `+N` และแถวรวมใน export ไร้ความหมาย
`Html/reconcile.html:867, 974` (ขาด 5 แสดง `+5` สีแดง), `:2447` (บวก variance คนละเครื่องหมายรวมกัน) **[ยืนยันแล้ว]**

### - [ ] M4. Book import แปลงชื่อสินค้าเป็นตัวพิมพ์ใหญ่หมด
`Js/reconcile-shared.js:1108` — ใช้ `normalizeSku` (UPPERCASE) กับ `name_pro` **[ยืนยันแล้ว]** — ควรเป็น `String(...).trim()`

### - [ ] M5. Connection badge เสีย class หลังเช็คครั้งแรก
`Js/settings-shared.js:22, 27` — `badge.className = ...` ทับ `connection-badge-status` ทิ้ง (style ที่ผูกอยู่หลุด) **[ยืนยันแล้ว]** — ใช้ classList.add/remove

### - [ ] M6. import_counts: retry สร้าง id ใหม่ → แถวซ้ำจริงเมื่อ network error
`Html/import_counts.html:1479-1485, 1448-1454` — retry mint `client_request_id`/`import_batch_id` ใหม่ ทำลายกลไก idempotent และแตก batch เดียวเป็นหลาย id

### - [ ] M7. import_counts: "Export รายละเอียด" ของ log เก่าเดาจากช่วงเวลา
`Html/import_counts.html:1149-1164` — window ±30 นาที กรองแค่คลัง+ชื่อคน — ปนแถวนับมือได้ ไฟล์ export ไม่มีเครื่องหมายบอก

### - [ ] M8. index: กติกากันซ้ำตอนแก้ไขขัดนโยบาย DB + เช็คจาก cache บางส่วน
`Js/script.js:449-471` — block ปลายทางซ้ำ (sku+loc+wh) ที่ migration 011 อนุญาต และเช็คจาก `allRecords` ที่โหลดเฉพาะ scope ปัจจุบัน — ไม่ deterministic

### - [ ] M9. index: group insert แบบ all-or-nothing
`Js/script.js:1122-1127` — แถวเดียวพังทั้ง 25 แถว rollback ผู้ใช้ต้องหาเอง (import_counts มี fallback รายแถวอยู่แล้วแต่ไม่ได้ share โค้ด)

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

### - [ ] M19. `encodeCycleWarehouses` เรียงไม่เสถียร — ชุดคลังเดียวกัน encode ได้ 2 แบบ = 2 รอบใน DB
`Js/reconcile-shared.js:143-161` (คลังนอกรายการมาตรฐาน map เป็น 99 เท่ากันหมด)

### - [ ] M20. user_manual: รูปเก็บซ้ำ 2 ชุดใน localStorage + backup กู้กลับไม่ได้ + toast quota ไม่ทำงาน
`Js/manual-editor.js:37-41, 205-218, 44-53`

### - [ ] M21. chat: ล้าง Storage จำกัด 500 ไฟล์ไม่มี pagination + ไฟล์แนบเป็น public URL ถาวร
`Html/chat.html:565, 386-390`

### - [ ] M22. book_explorer: layout แตกแถวจากหน้าอื่น (ไม่มี `has-sidebar`)
`Html/book_explorer.html:12, 113, 116` — ตรงกับอาการ "ตำแหน่งเพี้ยน" ใน SYSTEM_GUIDE §6.3

### - [x] M25. `getClient()` สร้าง Supabase client ใหม่ทุกครั้งที่ถูกเรียก
พบจากที่ admin เห็น console เตือน `Multiple GoTrueClient instances detected` รัว ๆ — `Js/api.js` `getSupabaseClient()` เรียก `createClient()` ใหม่ทุกครั้ง ทำให้หนึ่งหน้าเว็บมี client 6+ ตัว แต่ละตัวมี GoTrueClient + timer refresh token ของตัวเอง ใช้ storage key เดียวกัน (เปลืองและพฤติกรรมไม่แน่นอน)
> **✅ แก้แล้ว 2026-08-09** — cache client ตาม `(url, key)` สร้างใหม่เฉพาะตอน config เปลี่ยน · เทส 3 ข้อใน `tests/unit/api-client-cache.test.mjs` · ยืนยันจริง: เดิม 6 warning/โหลด → เหลือ **0**

### - [ ] M26. `getDestinationCollision` ยังบล็อกการแก้ตำแหน่งตาม key ที่ migration 011 ยกเลิก
พบระหว่าง review H2 — H2 แก้ฝั่ง "ลบ" แล้ว แต่ `Html/audit_check.html` `getDestinationCollision()` ยัง **block** การแก้ location/สลับ SKU เมื่อปลายทางมีแถว `sku+loc+warehouse+qty` เหมือนกันอยู่ ทั้งที่แถวนั้นอาจมาจากคนละรอบ/คนละผู้นับ (= ข้อมูลถูกต้อง)
**ผลกระทบ:** แก้ตำแหน่งแบบ bulk ไม่ผ่านโดยไม่มีเหตุผลที่ถูกต้อง (ไม่ทำข้อมูลเสียหาย แค่ทำงานไม่ได้)
**แนวทางแก้:** ใช้เกณฑ์เดียวกับ `Js/audit-dedupe.js` — ชนกันจริงเมื่อ cycle+ผู้นับเดียวกันเท่านั้น

### - [ ] M24. รอบที่ปิดแล้ว (`status = closed/archived`) ยังรับผลนับใหม่ได้
พบระหว่าง review การแก้ H1 — `isCycleRelevantNow()` (`Js/reconcile-shared.js`) ดูแค่ช่วงเวลา **ไม่ดู `status`** ดังนั้นรอบที่ถูกปิดไปแล้วแต่ยังอยู่ในเดือนปัจจุบัน ยังถูกแนบให้ผลนับใหม่ได้ → ข้อมูลไหลเข้ารอบที่ปิด/กระทบยอดที่ reconcile ไปแล้ว
**ผลกระทบตอนนี้: ยังไม่มี** — ตรวจแล้วทั้ง 6 รอบใน DB เป็น `open` ทั้งหมด
**แนวทางแก้:** เพิ่มเงื่อนไข `if (['closed','archived'].includes(cycle.status)) return false;` **พร้อมกับ** กรองรอบที่ปิดออกจาก dropdown ในหน้านับ (`filterCyclesCurrentMonth` ใน `Js/script.js:120`) — ต้องทำคู่กัน ไม่งั้นผู้ใช้เลือกรอบที่ปิดได้แต่ระบบเงียบ ๆ ไม่แนบ แล้ววนเตือนซ้ำ

### - [ ] M23. debug log จากโปรเจกต์อื่นหลุดเข้า git + ไม่มี .gitignore
`.cursor/debug-93df3f.log` (log Gemini API วิเคราะห์เครื่องประดับ — คนละโปรเจกต์), `.cursor/debug-ae4a9b.log` — ควรลบทั้งคู่ + เพิ่ม `.gitignore`

---

## 🟢 Low — ความสะอาดโค้ด / dead code / ป้ายผิด

### - [ ] L1. Dead code ก้อนใหญ่ใน index/script.js (~450 บรรทัด)
- Dashboard modal ทั้งชุดเข้าถึงไม่ได้: `index.html:316-412` + `Js/script.js:2095-2417` — และโหลด Chart.js CDN ฟรี ๆ (`index.html:18`)
- Extra-SKU drawer อ้าง element ที่ไม่มีจริง: `Js/script.js:1918-1991, 2457-2501`

### - [ ] L2. Dead code กระจาย
`audit_check.html:2401-2430` (`verifyAll` — ปุ่มไม่มีจริง), `btnLoadCounts`, `initConnectionBadge` (ไม่มีนิยามทั้ง repo); `dashboard.html:2447` (`renderFilters`), `:1614` (`bookSku` write-only); `live-count-wall.js:79-93, 125-128, :25` (`knownIds`); `settings.html:374` (`window.RS` ไม่มีอยู่จริง); `reconcile.html:1326-1346` (preview ไม่เคยแสดง), `:693` (`adjInputMode`); `reconcile-shared.js` (`updateCycleStatus`, `importBookStockLinesMerge` @deprecated); `db-errors.js:24` (`SERIALIZATION`)

### - [ ] L3. `escapeHtml` 5 เวอร์ชัน + fallback รายชื่อคลัง 3 ชุด + connection badge 3 แบบ
รวมเป็น util กลางชุดเดียว (เกี่ยวพันกับ C2)

### - [ ] L4. ป้าย/ข้อความผิด
`dashboard.html:2443` "รวม 3 คลัง" hardcode; `live-count-wall.js:607` "วันนี้" (จริงคือรายเดือน); `sku_master.html:340` "อัปเดตล่าสุด" (จริงคือ created_at); `user_manual.html:220` "ภาคผนิ"→"ภาคผนวก", `:314` สอน anon key; `settings.html:192` ป้าย "(anon/public)" ขัดค่าจริง

### - [ ] L5. `readAsBinaryString` deprecated 3 จุด
`import_counts.html:954`, `audit_check.html:3844`, `cycle_config.html:1781` — เปลี่ยนเป็น arrayBuffer (reconcile ใช้แล้ว)

### - [ ] L6. ลำดับคอลัมน์ Excel/paste ไม่ตรงกันระหว่างหน้า
import_counts ไฟล์ = Loc, SKU, Qty แต่ audit_check paste = SKU, Loc, Qty — ตึกเดียวกัน 2 กติกา

### - [ ] L7. นโยบายแถวซ้ำในไฟล์ import ไม่ตรงกัน
sku_master เก็บแถวสุดท้าย vs Book import บวกรวม

### - [ ] L8. เอกสารเดิมล้าสมัย
`docs/SYSTEM_GUIDE.md` (book_explorer มีฟิลเตอร์ที่ไม่มีจริง), `docs/RECONCILIATION_DESIGN.md` (Phase 3 "รอทำ" ที่เสร็จแล้ว, รายการ SQL ขาด 007-015, ทิศทางเครื่องหมาย adjustment ขัดกับโค้ด, ไม่พูดถึง `reconciliation_match_acceptances` เลย)

### - [ ] L9. SQL hygiene
ไฟล์ `003_reconciliation_book_only_with_zero_count.sql` เลขซ้ำ+เนื้อหา no-op (ควรลบ); `010` ปน DDL ทำลายล้างกับ diagnostics ใน script เดียว; `007` สร้าง reason ที่ client ไม่เคยใช้

### - [ ] L10. คลังแบบพิมพ์เอง (custom) ใน index.html ไม่เข้า registry
เลือกไม่ได้ในหน้า import/count_search/audit_check จนกว่าจะเพิ่มเองใน settings

### - [ ] L11. เบ็ดเตล็ด
count_search `cycle_id` โหลดมาแต่ไม่ใช้; precedence คลังสลับกันระหว่าง import_counts กับ count_search; cycle_config confirm 2 ระบบปนกัน + N+1 รายการรอบ + timezone 2 วิธี; `ui-confirm-modal.js:184` expression `hideBulletsBox` กลับค่าเอง; `warehouses-shared.js:52-60` update ทีละแถวทุกครั้งที่แตะ registry; `book_explorer` reuse query builder ข้าม await; sku_master ผูก event แบบ inline onclick ทั้งหน้า; loadImportHistory เรียกซ้ำ 2 ครั้งตอนบูต

---

## สรุปจำนวน

| ระดับ | จำนวน | สถานะ verify |
|---|---|---|
| 🔴 Critical | 2 | ✅ **แก้ครบแล้วทั้ง C1 และ C2** |
| 🟠 High | 8 | ✅ H1, H2 แก้แล้ว · อีก 6 ข้อรอ |
| 🟡 Medium | 26 | ✅ M25 แก้แล้ว · M24, M26 รอ · ที่เหลือจากการสำรวจละเอียด |
| 🟢 Low | 11 กลุ่ม | L3 (cache-buster + escapeHtml ซ้ำ) แก้ไปเกือบหมดตอนทำ H1/C2 |

**ข้อเสนอลำดับการแก้ (เมื่อ admin เลือกแล้ว):**
1. รอบ security: C1 + C2 (ควรทำคู่กัน — C2 ร้ายแรงเพราะ C1)
2. รอบความถูกต้องข้อมูล: H1, H2, H3, H6 (กระทบ integrity ของหลักฐานผลนับ)
3. รอบความถูกต้อง KPI/UI: H4, H5, H7, H8, M1-M5
4. รอบทำความสะอาด: Medium/Low ที่เหลือ
