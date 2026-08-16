# DATABASE — Schema ฐานข้อมูล Supabase (ตามจริงจาก docs/sql/* + โค้ด)

> **โปรเจกต์ Supabase:** `DB_SKU&LOCATION` (`nfhfuybqhskzlllkgmyi`, ap-southeast-2)
> ⚠️ **โปรเจกต์นี้ใช้ร่วมกับระบบอื่น** — จาก 40 ตารางใน `public` **AuditNew ใช้จริงแค่ 11 ตาราง + 1 view**
> ที่เหลือ 30 ตารางเป็นของระบบ QC / เอกสารจัดส่ง / Dashboard โรงงาน (`qc_*`, `delivery_*`, `check_location`,
> `stock_audits`, `products`, `staff_list`, `login_D_1st` ฯลฯ) — **ห้ามแตะ** ดูรายการเต็มใน
> [รายการตารางที่ใช้/ไม่ใช้](#ตารางในโปรเจกต์ที่-auditnew-ไม่ได้ใช้)

## ตารางหลัก

### `warehouses` (migration 014)
| คอลัมน์ | หมายเหตุ |
|---|---|
| `name` (PK) | ชื่อคลัง |
| `sort_order` int | ลำดับแสดงผล (compact เป็น 1..N โดย settings.html) |
| `is_active` bool | เปิด/ปิดใช้งาน |
| `created_at` | |

Registry กลางของทุกหน้า — seed 3 คลังไทย + sync จากข้อมูลเดิม; **ไม่มี** `'คลังทั้งหมด'` ในตาราง (เป็นค่าพิเศษฝั่ง client); helper `get_active_warehouses()`

### ~~`sku_master`~~ — 🚫 **เลิกใช้แล้ว 2026-08-10 (ตารางยังอยู่ในฐาน)**
| คอลัมน์ | หมายเหตุ |
|---|---|
| `id`, `sku_name`, `name_pro`, `warehouse`, `created_at` | ไม่มี `updated_at` |

Unique partial index: `uq_sku_master_name_warehouse (sku_name, warehouse) WHERE warehouse <> ''` (009 §3.2)

**ฟีเจอร์ SKU Master ถูกถอดออกจากเว็บทั้งหมด** — ลบ `Html/sku_master.html` + เมนู + `fetchSkuMasterNamesBySkus`
⇒ **ไม่มีโค้ดใดในระบบอ่านหรือเขียนตารางนี้อีกแล้ว** (มีเทส `dryrun/book-names` [book-name] บังคับว่าห้าม query กลับมา)

⚠️ **เจตนาไม่ลบตารางออกจาก Supabase** (มติ admin) — 1,179 แถวยังอยู่ครบ พร้อม index และ RLS policy เดิม
เหตุผลที่เก็บไว้: โปรเจกต์ Supabase นี้ใช้ร่วมกับระบบอื่นอีก 30 ตาราง จึงพิสูจน์ไม่ได้ว่าไม่มีแอปนอก repo นี้เรียกใช้ · และการเก็บไว้ทำให้ migration `009` / `010` / `014` / `016` ที่อ้างตารางนี้ยังรันได้ปกติ — สำคัญมากสำหรับ [016:77](sql/016_rls_policies.sql) ซึ่งถ้า error จะขวางไม่ให้ถึง policy `UPDATE`/`DELETE` ของ `inventory_counts` ที่ `:86` / `:88` (audit_check + cycle_config จะตายเงียบแบบ Regression C1)

แหล่งชื่อสินค้าที่มาแทน: `book_stock_lines.name_pro` ข้ามรอบ (`fetchBookNamesBySkusAnyCycle` ใน `Js/reconcile-shared.js`)

### `inventory_counts` — หัวใจของระบบ (หลักฐานผลนับ, immutable)
| คอลัมน์ | ที่มา |
|---|---|
| `id`, `sku_id`, `location`, `warehouse`, `counted_qty`, `counter_name`, `created_at` | เดิม |
| `cycle_id` | 002 §3 — FK → `count_cycles` **ON DELETE SET NULL** (คอลัมน์เดียวที่ flow reconcile แก้ได้) |
| `client_request_id` uuid | 009 §3.1 — unique-when-not-null กัน insert ซ้ำจาก retry |
| `import_batch_id` uuid | 015 — ผูกแถวเข้ากับ batch import |

Indexes: `(cycle_id)`, `(warehouse, created_at DESC)`, partial `(import_batch_id)`
⚠️ **นโยบายสำคัญ**: unique index เข้ม `(warehouse, sku, location, qty)` ถูก **drop ใน migration 011** โดยตั้งใจ — แถวซ้ำจากการนับจริง (สองคนนับ/นับซ้ำ/คนละรอบ) เป็นข้อมูลถูกต้อง — โค้ด client ที่ block/ลบ "duplicate" ตาม key นี้ขัดนโยบาย (audit_check dedupe, script.js edit guard)

### `count_cycles` (002 §1) — รอบนับ
| คอลัมน์ | หมายเหตุ |
|---|---|
| `id` uuid PK | |
| `warehouse` text | ชื่อเดียว / multi `"A\|B"` / `'คลังทั้งหมด'` — convention client ไม่มี CHECK |
| `year_month` | `'YYYY-MM'` |
| `label`, `notes` | |
| `status` | CHECK: `draft\|open\|counting\|reconciling\|closed\|archived` — ⚠️ ตั้งได้ตอนสร้างเท่านั้น (`updateCycleStatus` ไม่มีผู้เรียก) |
| `count_start_at`, `count_end_at` timestamptz | ช่วงวันนับ (Bangkok) |
| `book_source`, `book_imported_at` | metadata การอัปโหลด Book |
| `created_at`, `updated_at` | |

Unique เดิม `(warehouse, year_month)` ถูก drop ใน 003 แทนด้วย partial unique 2 ตัว:
- `uq_count_cycles_full_month (warehouse, year_month) WHERE count_start_at IS NULL`
- `uq_count_cycles_date_range (warehouse, year_month, count_start_at, count_end_at) WHERE count_start_at IS NOT NULL`

⚠️ unique อิง string ตรง ๆ — `"A|B"` กับ `"B|A"` เป็นคนละรอบ (และ `encodeCycleWarehouses` เรียงไม่เสถียรสำหรับคลังนอกรายการมาตรฐาน)

### `book_stock_lines` (002 §2) — ยอด BOOK ต่อรอบ
| คอลัมน์ | หมายเหตุ |
|---|---|
| `id`, `cycle_id` FK **CASCADE**, `sku_id`, `location`, `book_qty` numeric(18,4), `adjusted_book_qty`, `name_pro`, `row_no`, `created_at` | `location` **เป็น null เสมอ**ในทางปฏิบัติ (ทุก insert path เขียน null — ระดับ SKU+Location ใน design doc ยังไม่เคยใช้) |

Unique `(cycle_id, sku_id, COALESCE(location,''))`; index `(cycle_id, sku_id)`

### `reconciliation_lines` (002 §4) — cache ผล match (rebuild ทั้งก้อนโดย RPC)
`id`, `cycle_id` FK CASCADE, `sku_id`, `book_qty`, `adjustment_applied`, `effective_book_qty`, `counted_qty`, `variance_qty`, `match_status` CHECK (`match|short|over|count_only|book_only`), `variance_pct`, `computed_at` — UNIQUE `(cycle_id, sku_id)`

### `stock_adjustments` (002 §5) — รายการปรับยอดฝั่ง Book
`id`, `cycle_id` FK CASCADE, `sku_id`, `adjustment_qty`, `variance_before`, `reason` CHECK (`reconcile|manual|damage|found|other` + `accept_count` จาก 007 — ⚠️ client ไม่เคยส่งค่านี้), `status` CHECK (`draft|exported|applied|cancelled` — ⚠️ `exported` ไม่มีโค้ดไหนตั้ง), `note`, `created_by`, `exported_at`, `applied_at`, timestamps

Partial unique: `uq_stock_adj_draft_per_sku (cycle_id, sku_id) WHERE status='draft'` (009 §3.3)

### `reconciliation_match_acceptances` (008) — ธง "ยืนยันถูกต้องโดยไม่ปรับยอด"
PK `(cycle_id, sku_id)`, `note`, `accepted_at`, `accepted_by` — เป็นกลไกหลักที่ทำให้ KPI "ถูกต้อง" ขึ้นหลัง Excel import (⚠️ design doc ไม่พูดถึงตารางนี้เลย)

### `inventory_count_acceptances` (019) — ธง "ยืนยันว่าผลนับกลุ่มนี้ปกติ"
ใช้โดย `audit_check.html` 3 จุด — กลุ่ม (รอบ + คลัง + SKU + ตำแหน่ง) ที่คนกด "ยืนยันว่าปกติ" จะไม่ถูกเตือนซ้ำและไม่ถูกปุ่มลบเลือก จนกว่าข้อมูลจะเปลี่ยน
⚠️ unique index เป็น **expression index** จึงใช้ `ON CONFLICT` ไม่ได้ (42P10) — โค้ดแยก insert/update by id เอง **ห้ามเปลี่ยนกลับไปใช้ upsert**

### อื่น ๆ
`chat_messages` (ไฟล์แนบเก็บเป็นคอลัมน์ `file_*` **ในตารางเดียวกัน** + Supabase Storage bucket `chat-attachments` — **`chat_attachments` ไม่ใช่ตาราง** migration 006 ทำแค่ `ALTER TABLE chat_messages ADD COLUMN` + สร้าง bucket/policy), `inventory_audit_logs` — action_type ที่ใช้จริง:
| action_type | เขียนโดย | หมายเหตุ |
|---|---|---|
| `INSERT` / `GROUP_INSERT` / `UPDATE` / `DELETE` | `index.html` | นับ/แก้/ลบรายแถว |
| `IMPORT` | `import_counts.html` | `old_qty`=จำนวนที่พลาด · `new_qty`=จำนวนที่สำเร็จ · `record_id`=batch uuid |
| `AUDIT_EDIT_LOC` / `AUDIT_SWAP` / `AUDIT_LOC_COMPARE` / `AUDIT_DELETE` / `AUDIT_DEDUPE` | `audit_check.html` (ผ่าน `Js/audit-log.js`, เพิ่มตอนแก้ H3) | คอลัมน์ `location` เก็บข้อความ "ค่าเดิม → ค่าใหม่" เพราะ schema ไม่มีช่อง note · `counter_name` ต่อท้าย `(audit_check)` |
| `RECONCILE_ADJ_CLEAR` | `reconcile.html` (ผ่าน `Js/reconcile-shared.js`, เพิ่มตอนแก้ H6) | 1 แถวต่อ `stock_adjustments` 1 แถวที่ถูกลบ (ทั้ง draft และ applied) · `record_id`=id ของ adjustment · `old_qty`=ยอดปรับเดิม · `new_qty`=null · `location`=`stock_adjustments <status> · qty=… · cycle=…` · `counter_name` ต่อท้าย `(reconcile_import)` หรือ `(reconcile_delete_book)` · ⚠️ ปริมาณเยอะได้ (import ครั้งเดียวอาจหลายร้อยแถว) — drawer ประวัติในหน้า index ดึงแค่ 100 แถวล่าสุดโดยไม่กรอง action_type |

## Views / Functions (RPC)

| ชื่อ | จาก | หน้าที่ / ผู้ใช้ |
|---|---|---|
| `v_cycle_reconciliation_summary` | 002 §6 | สรุปต่อรอบ (นับตามสถานะ, `match_pct`) — dashboard เท่านั้น |
| `refresh_reconciliation_for_cycle(uuid)` | 002 §7 → **นิยามซ้ำ 3 ครั้ง** (002, 003_reconciliation_book_only…, 013) — ตัวที่รันทีหลังชนะ; เวอร์ชัน 013 (UPPER/TRIM grouping) คือของจริงปัจจุบัน |
| `apply_stock_adjustment(uuid, text)` | 002 §7b | flip draft→applied แล้ว refresh ทั้งรอบ |
| `apply_all_drafts_for_cycle(uuid, text)` | 013 §A11 | apply ทุก draft ใน 1 RPC |
| `import_book_stock_lines_atomic(uuid, jsonb, text, text)` | 012 | import Book แบบ atomic (replace/merge) + UPPER/TRIM sku |
| `get_inventory_count_months(text)` | 013 §A16 | รายการเดือนที่มีข้อมูล — ⚠️ audit_check ใช้ แต่ cycle_config ยังดึงแถวดิบ |
| `get_active_warehouses()` | 014 | 💀 **ไม่มีโค้ดเรียกเลย** — `Js/warehouses-shared.js:74` ดึงตารางตรงแทนเพราะต้องการแถว inactive ด้วย |
| `submission_rate_buckets(...)` | 004 | bucket อัตราส่งงาน (Bangkok, รองรับ multi-warehouse) |

## ความสัมพันธ์

```
warehouses.name ~(soft ไม่มี FK)~ sku_master.warehouse / inventory_counts.warehouse / count_cycles.warehouse

count_cycles 1─┬─n book_stock_lines               (ON DELETE CASCADE)
               ├─n reconciliation_lines           (CASCADE)
               ├─n stock_adjustments              (CASCADE)
               ├─n reconciliation_match_acceptances (CASCADE)
               └─n inventory_counts               (ON DELETE SET NULL)

sku_master.sku_name ~(soft)~ inventory_counts.sku_id ~(soft)~ book_stock_lines.sku_id
  (normalize UPPER+TRIM โดย app + migration 010 — CHECK constraint ถูก comment ไว้ที่ 010:306-316 ไม่ได้บังคับจริง)
```

## รายการไฟล์ migration (`docs/sql/`)

| ไฟล์ | เนื้อหา | สถานะ |
|---|---|---|
| `001_sku_master_data_report.sql` | รายงาน SKU master | — |
| `002_reconciliation_schema.sql` | schema reconcile หลักทั้งชุด | ใช้งาน |
| `003_cycle_all_warehouses_date_range.sql` | drop unique เดิม + partial unique ช่วงวัน | ใช้งาน |
| `003_reconciliation_book_only_with_zero_count.sql` | ⚠️ **เลขซ้ำกับไฟล์บน** และเนื้อหาเป็น no-op ซ้ำกับ 002 (ถูก 013 ทับอยู่ดี) | ควรลบ |
| `004_dashboard_submission_buckets.sql` | RPC submission_rate_buckets | optional |
| `007_stock_adjustments_reason_accept.sql` | เพิ่ม reason `accept_count` | ⚠️ client ไม่เคยใช้ — ไร้ผล |
| `008_reconciliation_match_acceptances.sql` | ตาราง acceptances | ใช้งาน (UI พึ่งพา) |
| `009_*.sql` | client_request_id + indexes (มี STEP ที่ deprecated ในตัว) | ใช้งานบางส่วน |
| `010_*.sql` | normalize UPPER/TRIM + backup tables | ⚠️ มี DDL/DML ทำลายล้างปนใน script เดียว |
| `011_drop_strict_inventory_counts_index.sql` | drop unique เข้ม — **นโยบายแถวซ้ำถูกต้อง** | ใช้งาน (สำคัญ) |
| `012_import_book_atomic.sql` | RPC import atomic | ใช้งาน (มี legacy fallback ใน client) |
| `013_*.sql` | refresh ฉบับ UPPER/TRIM + apply_all + get_months | ใช้งาน (เวอร์ชันจริงปัจจุบัน) |
| `014_warehouses_registry.sql` | ตาราง warehouses | ใช้งาน |
| `015_import_batch_id.sql` | คอลัมน์ import_batch_id | ใช้งาน (import_counts พึ่งพา) |
| `016_rls_policies.sql` | RLS policy สำหรับ anon/publishable key | ✅ รันแล้ว 2026-08-09 |
| `017_drop_skunorm_backup_tables.sql` | ลบตารางสำรอง `_bk_*` จาก 010 | ✅ รันแล้ว 2026-08-09 |
| `018_refresh_reconciliation_security_definer.sql` | `refresh_reconciliation_for_cycle` → SECURITY DEFINER (แก้ 401 ตอนกด "คำนวณ Match") | ✅ รันแล้ว 2026-08-09 |
| `019_inventory_count_acceptances.sql` | ตาราง "ยืนยันว่าผลนับปกติ" + RLS policy | ✅ รันแล้ว 2026-08-10 |
| `020_match_status_count_only_in_book.sql` | M2: `count_only` ต้องแปลว่า "ไม่มีบรรทัดใน Book" ไม่ใช่ "ยอด Book = 0" | ✅ รันแล้ว 2026-08-11 (77 แถวเปลี่ยน count_only → over · refresh ครบ 6 รอบ) |
| `021_settings_pin.sql` | รหัสปลดล็อกส่วน Supabase Config ในหน้าตั้งค่า — ตาราง `app_settings_pin` (RLS ไม่มี policy = API เข้าไม่ได้) + RPC `verify_settings_pin` (SECURITY DEFINER) · **ตัวรหัสตั้งตรงใน DB ไม่อยู่ในรีโป** | ✅ รันแล้ว 2026-08-16 + ตั้งรหัสแล้ว |

> **เลข migration ที่ชนกัน — อย่าเปลี่ยนชื่อไฟล์** (รันไปแล้วในฐานจริง เปลี่ยนชื่อแล้วสืบย้อนไม่ได้):
> `003` ×2 · `004` ×2 (`004_chat_messages.sql` กับ `004_dashboard_submission_buckets.sql`)
> 🔴 **ห้ามรัน `003_reconciliation_book_only_with_zero_count.sql` เด็ดขาด** — ถือ `refresh_reconciliation_for_cycle` เวอร์ชันเก่า ถ้ารันจะทับ 013 + 018 + 020 → Match พังทั้งระบบ และหายเป็น SECURITY DEFINER ทำให้กลับไป 401
> 🔴 **`002_reconciliation_schema.sql` ก็ถือฟังก์ชันนี้เวอร์ชันเก่าเช่นกัน** — ถ้าตั้งฐานใหม่ ลำดับบังคับคือ 002 → 013 → 018 → **020 ต้องเป็นตัวสุดท้ายของสาย `refresh_reconciliation_for_cycle` เสมอ** (020 มี body ครบและประกาศ SECURITY DEFINER ไว้ในตัวแล้ว)

## DB objects ที่ไม่มีโค้ดใช้ (บันทึกไว้ — **ไม่ลบ**)

สแกน `.from()` / `.rpc()` / `.select()` ทั้งโปรเจกต์เทียบกับ schema เมื่อ 2026-08-10 · การลบคอลัมน์/enum ต้อง admin อนุมัติ + สำรอง + วางแผน downtime จึงบันทึกไว้เฉย ๆ

**RPC:** `get_active_warehouses()` — 0 caller (ดูตาราง RPC ข้างบน)

**คอลัมน์ที่ไม่มีใครอ่าน:**

| คอลัมน์ | สภาพ |
|---|---|
| `stock_adjustments.exported_at` | 💀 ไม่มีใครเขียน ไม่มีใครอ่าน — RPC ก็ไม่แตะ |
| `stock_adjustments.applied_at` / `.created_by` | write-only (RPC เขียน client ไม่เคย select) |
| `stock_adjustments.variance_before` | write-only (ไม่มีจุดอ่าน) · ⚠️ **เปลี่ยนทิศทางเครื่องหมาย 2026-08-11 (M3)** — แถวก่อนหน้านั้นเก็บ "ขนาด" (ขาดเป็นบวก) แถวใหม่เก็บ "ทิศทาง" (ขาดเป็นลบ) · ถ้าทำรายงานย้อนหลังจากคอลัมน์นี้ ต้องแยกตามวันที่ ไม่งั้นตัวเลขหักล้างกันเอง |
| `book_stock_lines.adjusted_book_qty` | write-only (RPC 013 เขียนทุกครั้ง client ไม่เคยอ่าน) |
| `book_stock_lines.row_no` | write-only |
| `book_stock_lines.location` | null เสมอ + ไม่เคยถูก filter |
| `count_cycles.notes` | null เสมอ — `createCycle` รับ param แต่ผู้เรียกเดียว (`cycle_config.html`) ไม่ส่ง |
| `warehouses.created_at` | ไม่เคยถูก select |

**enum value ที่ไม่มีโค้ดผลิต:**
- `stock_adjustments.reason` — โค้ดผลิตแค่ `manual` / `reconcile` · `damage` `found` `other` **`accept_count`** ไม่เคยถูกใช้ (⚠️ migration 007 **ไร้ผลถาวร** เพราะ `Js/reconcile-shared.js:39` map `accept_count` → `manual`)
- `stock_adjustments.status` — client ตั้งได้แค่ `draft`, RPC ตั้ง `applied` · `exported` `cancelled` ไม่เคยถูกใช้
- `count_cycles.status` — dropdown ให้แค่ `open|counting|reconciling|closed` · `draft` `archived` ไม่เคยถูกใช้ (และ `updateCycleStatus` ไม่มีผู้เรียก → สถานะแก้ไม่ได้หลังสร้าง)

**index ที่โค้ดไม่ได้ใช้ประโยชน์ (เป็น guard เฉย ๆ):** `idx_count_cycles_wh_ym` (ไม่มี `.eq('warehouse')` บน `count_cycles` เลย — `fetchCycles` ดึงทั้งตารางแล้วกรองฝั่ง JS) · `uq_book_stock_cycle_sku_loc` · `uq_stock_adj_draft_per_sku` · `uq_chat_msg_client_id` · `uq_inventory_count_acceptances_key`

## ตารางในโปรเจกต์ที่ AuditNew ไม่ได้ใช้

สแกนโค้ดทั้งโปรเจกต์ (`.from()` + `.rpc()`) เทียบกับ DB เมื่อ 2026-08-09 — **30 ตารางนี้ไม่ปรากฏในโค้ด AuditNew เลยแม้แต่บรรทัดเดียว** เป็นของระบบอื่นที่ใช้โปรเจกต์ Supabase ร่วมกัน **ห้ามลบโดยไม่ยืนยันกับเจ้าของระบบนั้น**

**มีข้อมูลอยู่ (18 ตาราง):** `check_location` (6,737) · `stock_audits` (1,062) · `qc_logs` (745) · `system_logs` (519) · `qc_product_mix` (404) · `qc_reports` (198) · `qc_dashboard_data` (172) · `history_logs` (32) · `qc_config` (19) · `staff_list` (13) · `qc_employees` (10) · `qr_history` (9) · `export_logs` (8) · `login_D_1st` (6) · `qc_users` (6) · `system_settings` (2) · `company_settings` (1) · `products` (1)

**ว่างเปล่า 0 แถว (12 ตาราง):** `add_pro_audit` · `Data1Sum` · `Data2Sum` · `Data3Sum` · `delivery_documents` · `delivery_items` · `document_reads` · `issue_report` · `rest_data` · `stock_activity_logs` · `tem_pro_del3month` · `template_sort`

> กลุ่ม `delivery_documents` / `delivery_items` / `document_reads` ผูก FK กันเอง และ `delivery_documents` ชี้ไป `login_D_1st` — ถ้าจะลบต้องลบตามลำดับ

**ลบไปแล้ว (2026-08-09):** `_bk_inventory_counts_pre_skunorm`, `_bk_sku_master_pre_skunorm`, `_bk_book_stock_lines_pre_skunorm` — ดู [017](sql/017_drop_skunorm_backup_tables.sql) และ [backup](backup/2026-08-09_bk_tables_unique_rows.md)

### ขนาดพื้นที่ (สำหรับวางแผน cleanup)

`reconciliation_lines` = **24 MB** และ `book_stock_lines` = **12 MB** คิดเป็นเกือบทั้งหมดของขนาด DB — ส่วนตารางระบบอื่น 30 ตัวรวมกันแค่ ~4 MB

`reconciliation_lines` บวมผิดปกติ (5,628 แถว = ~4 KB/แถว) เพราะ RPC `refresh_reconciliation_for_cycle` ลบ-สร้างใหม่ทั้งตารางทุกครั้งที่กด "คำนวณ Match" — autovacuum คืนพื้นที่ให้ Postgres แต่ไม่คืนให้ระบบไฟล์ ถ้าต้องการคืนพื้นที่จริงต้อง `VACUUM FULL reconciliation_lines` (ล็อกตารางชั่วครู่ ควรทำตอนไม่มีคนใช้)

## จุดที่โค้ดกับ DB ไม่ตรงกัน (สรุป — รายละเอียดใน [ISSUES.md](ISSUES.md))

1. ~~`computeMatchStatus` (JS) vs `refresh_reconciliation_for_cycle` (SQL): กรณี `effective=0 && counted>0` และ SKU อยู่ใน Book~~ **แก้แล้ว (M2, 2026-08-11)** — ยึดฝั่ง JS แล้วแก้ SQL ตามใน [020](sql/020_match_status_count_only_in_book.sql) · ⚠️ **รอบที่ปิดแล้วจะยังค้าง semantic เก่า** เพราะคำสั่ง refresh ข้าม closed/archived โดยตั้งใจ (M24) — ถ้าเจอในรอบเก่า อย่าเปิด M2 ใหม่
2. audit_check dedupe + script.js edit guard บังคับกติกา unique ที่ migration 011 ตั้งใจยกเลิก
3. `reason='accept_count'` (007) ไม่เคยถูกใช้ — client map เป็นค่าอื่น
4. `status='exported'` ไม่มีโค้ดตั้ง — export เป็น XLSX ฝั่ง client ล้วน
5. `book_stock_lines.location` มีใน schema แต่ null เสมอ — match ระดับ SKU+Location ยังไม่เกิดจริง
6. RLS: ฝั่ง client เปลี่ยนเป็น publishable key แล้ว (C1, 2026-08-09) และเพิ่ม policy ให้ anon ครบทุกตารางที่ระบบใช้ใน `docs/sql/016_rls_policies.sql` — policy ปัจจุบันเป็นแบบ **อนุญาตทุกคน** (ระบบไม่มีล็อกอิน ทุกผู้ใช้คือ anon เหมือนกัน) การรัดสิทธิ์รายบุคคลต้องทำ Supabase Auth เพิ่ม; service_role key เก่ายังใช้ได้จนกว่า admin จะ revoke
