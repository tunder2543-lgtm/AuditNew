# หน้า "ประวัติการปรับ / ยืนยัน" แบบเต็มหน้า — Design

วันที่: 2026-08-13
สถานะ: อนุมัติแล้ว (admin ยืนยัน 2026-08-13)

## ปัญหา

ประวัติการปรับ/ยืนยันตอนนี้อยู่ใน **modal** ของ `Html/reconcile.html` เท่านั้น
(ปุ่ม `btnAdjHistory` → `openAdjHistoryModal()`) ซึ่ง:

- ไม่มีช่องค้นหา SKU — รอบเดือน 2026-08 มีหลายร้อยรายการ ต้องเลื่อนหาเอง
- ไม่มี filter ใด ๆ (ประเภท / วันที่ / จำนวน / รายละเอียด)
- เรียงได้แบบเดียวคือ ใหม่→เก่า (hard-code ใน `buildAdjustHistoryEntries`)
- ไม่มี Export — ต้องการเอาไปทำรายงาน/ส่งต่อไม่ได้

## ขอบเขต

หน้าใหม่ `Html/adjust_history.html` — **รอบละหนึ่ง** (เลือกรอบจาก dropdown)
มี ค้นหา / filter / เรียง / Export (Excel + CSV) / คืนค่า

modal เดิมใน `reconcile.html` **คงไว้ทั้งหมด** เพิ่มแค่ลิงก์ไปหน้าใหม่
(ไม่แตะของเดิม = ไม่มีความเสี่ยง regression กับปุ่มคืนค่าที่ใช้อยู่)

## แหล่งข้อมูล

รวมจาก 2 ตาราง เหมือน modal เดิมทุกประการ:

| ตาราง | helper | ได้อะไร |
|---|---|---|
| `stock_adjustments` | `RS.fetchAdjustments(cycleId)` | ยอดปรับ (draft / applied) |
| `reconciliation_match_acceptances` | `RS.fetchMatchAcceptanceMap(cycleId)` | "ยืนยันเป็นถูกต้อง (ไม่ปรับยอด)" |

**ไม่แตะ `inventory_counts`** (invariant ข้อ 1) — หน้านี้อ่านเฉพาะ "การตัดสิน" ไม่ใช่ผลนับ

## สถาปัตยกรรม

### 1. ย้ายกติกาขึ้น shared (บังคับ)

`buildAdjustHistoryEntries()` ตอนนี้เป็น inline ใน `reconcile.html:2674`
ถ้า copy ไปหน้าใหม่ = กติกาอยู่ 2 ที่ ⇒ บทเรียนเดิมของโปรเจกต์ (M34, M8)

**ย้ายไป `Js/reconcile-shared.js`** เป็น `RS.buildAdjustHistoryEntries(adjustments, ackMap)`
แล้ว `reconcile.html` เรียกตัวเดียวกัน (ลบสำเนา inline ทิ้ง)

รูปแบบ entry — เพิ่ม field ดิบให้ filter/sort ใช้ โดย `detail` ยังคำนวณจาก field ดิบเหมือนเดิม
เพื่อให้ข้อความบนสองหน้าจอตรงกันเป๊ะ:

```js
{
  type:   'adj' | 'ack',
  sku:    string,
  qty:    number | null,          // null สำหรับ ack
  status: 'draft' | 'applied' | null,
  note:   string,                 // note || reason
  detail: string,                 // ข้อความไทยที่แสดง (คำนวณจากด้านบน)
  by:     string,
  at:     string | null           // ISO
}
```

### 2. ฟังก์ชันใหม่ใน `Js/adjust-history-shared.js` (ไฟล์ใหม่)

แยกไฟล์เพราะเป็นตรรกะเฉพาะหน้านี้ และต้อง lift มาทดสอบได้:

| ฟังก์ชัน | หน้าที่ |
|---|---|
| `filterHistoryEntries(entries, criteria)` | กรองตามเกณฑ์ทั้ง 5 |
| `sortHistoryEntries(entries, key, dir)` | เรียงตาม key ที่รองรับ |
| `buildHistoryExportRows(entries)` | แปลงเป็นแถวสำหรับ Excel/CSV (คอลัมน์ไทย) |
| `buildHistoryFileName(cycle, ext, now)` | ชื่อไฟล์ Export |
| `toCsv(rows)` | CSV + BOM |

### 3. Filter (client-side ทั้งหมด บนข้อมูลของรอบที่โหลดมา)

| ตัวกรอง | รายละเอียด |
|---|---|
| ประเภท | ทั้งหมด / ยอดปรับ / ยอดปรับ-draft / ยอดปรับ-applied / ยืนยันถูกต้อง |
| SKU | normalize UPPERCASE (`RS.normalizeSku`) แล้ว match แบบ contains |
| วันที่ | จาก–ถึง — ตีความเป็น **เวลาไทย** ผ่าน `RS.dateToBangkokStartISO` / `RS.dateToBangkokEndExclusiveISO` |
| รายละเอียด | ค้นข้อความใน `detail` (case-insensitive) |
| จำนวนที่ปรับ | min–max · แถว `ack` (qty = null) ถูกกรองออกเมื่อระบุช่วง |

ทุกช่องว่าง = ไม่กรอง · เกณฑ์รวมกันแบบ AND

### 4. Sort

คลิกหัวคอลัมน์สลับ asc/desc:

| key | เกณฑ์ |
|---|---|
| `at` | วันที่-เวลา — **ค่าเริ่มต้น desc (ใหม่→เก่า)** |
| `sku` | `localeCompare` |
| `type` | จัดกลุ่มประเภทเดียวกันติดกัน (adj ก่อน ack) แล้ว tiebreak ด้วย sku |
| `qty` | **ค่าจริงมีเครื่องหมาย** (`+5` > `+1` > `−3`) ให้ตรงกับที่ M3 แก้คอลัมน์ "ต่าง" ให้คืนทิศทาง · `null` (ack) ไปท้ายเสมอทั้ง asc และ desc |

ทุก key มี tiebreak สุดท้ายด้วย `sku` แล้ว `at` — ให้ผลเรียงเสถียร (deterministic)

### 5. Export

สองปุ่ม: **Excel (.xlsx)** ผ่าน SheetJS · **CSV (.csv)**
ส่งออก **ตามที่กรอง + เรียงอยู่บนจอ** (ไม่ใช่ข้อมูลดิบทั้งรอบ)

คอลัมน์ (ตามที่ admin ยืนยัน):
`ประเภท · SKU · จำนวน · สถานะ · รายละเอียด · โดย · วันเวลา (ไทย)`

ชื่อไฟล์:
```
ประวัติการปรับ-ยืนยัน_<คลัง>_<รอบ>_<YYYY-MM-DD_HHmm>.xlsx
```
ตัวอย่าง: `ประวัติการปรับ-ยืนยัน_คลังA_2026-08_2026-08-13_1710.xlsx`

- `/` ใช้ในชื่อไฟล์ไม่ได้ → ชื่อฟีเจอร์เขียนเป็น `ประวัติการปรับ-ยืนยัน`
- ชื่อคลังผ่าน `RS.formatWarehouseDisplay()` แล้ว sanitize อักขระต้องห้าม `\ / : * ? " < > |` เป็น `-`
- วันเวลาเป็น **Asia/Bangkok จริง** ไม่ใช่เวลาเครื่อง (invariant ข้อ 5)
- CSV ขึ้นต้นด้วย BOM `﻿` ไม่งั้น Excel เปิดภาษาไทยเป็นขยะ · escape `"` และ field ที่มี `,` / newline

### 6. ปุ่มคืนค่า

เส้นทางเดิมทุกขั้น ไม่เปลี่ยนตรรกะ:

```
เลือก checkbox → uiConfirm.twoStep
  → RS.clearAdjustmentsAndMatchAcceptancesForSkus(cycleId, skus)   // เขียน audit log ก่อนลบเสมอ
  → RS.refreshReconciliation(cycleId)                              // คำนวณ Match ใหม่
  → โหลดรายการใหม่
```

จุดที่ต่างจาก modal เดิม **เพราะหน้านี้มี filter**:

- "เลือกทั้งหมด" เลือกเฉพาะแถวที่**มองเห็นหลังกรอง**เท่านั้น
- เปลี่ยน filter / เปลี่ยนการเรียง / เปลี่ยนรอบ ⇒ **ล้าง selection ทิ้ง**
  (กันเคสเลือกไว้ตอนกรอง A แล้วกดคืนค่าตอนกรอง B)
- ล็อก `cycleId` ก่อน confirm + ตรวจซ้ำหลัง `await` ทุกจุด (บทเรียน H5)
- ยืนยันขั้น 2 บอกชัดว่า **คืนค่า = ต่อ SKU ทั้งการตัดสินในรอบนั้น** ไม่ใช่ต่อแถวที่ติ๊ก
  (ติ๊กแถว "ยอดปรับ" ของ SKU X ⇒ การยืนยันของ X ในรอบนั้นก็หายด้วย)

## เมนู + cache-buster

- `Js/sidebar-shared.js` — เพิ่มในกลุ่ม `audit`:
  `{ id: 'adjust_history', label: 'ประวัติการปรับ', icon: 'history' }` + `PAGE_FILES`
- `reconcile.html` modal — เพิ่มปุ่ม "เปิดหน้าเต็ม" → `adjust_history.html?cycle=<id>`
- หน้าใหม่รับ `?cycle=<id>` จาก URL (pattern เดียวกับ `reconcile.html:1777`)
- **bump `ASSET_VER` + `?v=` ทุกหน้า** เพราะแตะ `sidebar-shared.js` + `reconcile-shared.js` (invariant ข้อ 9)

## ลำดับ `<script>` ของหน้าใหม่ (invariant ข้อ 8)

```
sidebar-shared → api → sku-utils → settings-shared
  → count-scan-shared → reconcile-shared
  → adjust-history-shared → ui-confirm-modal
```

## เทส

ไฟล์ใหม่ `tests/unit/adjust-history.test.mjs` — **lift มารันจริง** ไม่ใช่แค่อ่านซอร์ส
(กติกา: แก้บรรทัดในฟังก์ชันไหน ต้องมีเทสที่ *รัน* ฟังก์ชันนั้น)

- `buildAdjustHistoryEntries` — รวม 2 แหล่ง, field ดิบครบ, `detail` ตรงกับของเดิม
- `filterHistoryEntries` — ทั้ง 5 เกณฑ์ + รวมกันแบบ AND + ack ถูกกรองออกเมื่อระบุช่วงจำนวน
- `sortHistoryEntries` — qty มีเครื่องหมาย, null ไปท้ายทั้ง 2 ทิศ, เรียงเสถียร
- `buildHistoryFileName` — เวลาไทย, sanitize อักขระต้องห้าม, ไม่มี `/`
- `toCsv` — BOM, escape `"` และ `,`
- เส้นทางคืนค่า — รันจริงแบบ `write-path-runtime`: เรียก `clearAdjustments...` ด้วย SKU ที่มองเห็นเท่านั้น + refresh หลังลบ + ยกเลิกเมื่อรอบเปลี่ยน

เทสยามที่สแกนทุกหน้าจะกินหน้าใหม่อัตโนมัติ: `[asset-ver]` · `script-loads` · `xss-guard` · `stable-paging` · `[menu-guard]`

## Baseline

ก่อนแก้: **425 PASS / 0 FAIL / 0 KNOWN-OPEN**

## นอกขอบเขต (YAGNI)

- ดูข้ามรอบพร้อมกัน — เลือกทีละรอบพอ
- อ่าน `inventory_audit_logs` (ประวัติแก้/ลบผลนับ) — คนละเรื่อง มีหน้าของตัวเองใน `audit_check`
- แก้ไขรายการประวัติ — ประวัติเป็นหลักฐาน คืนค่าได้อย่างเดียว
