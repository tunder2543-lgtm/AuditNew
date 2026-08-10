# ระบบเทส AuditNew (Dry Run 100%)

> **การันตี: ไม่แตะฐานข้อมูลจริงเด็ดขาด** — ไม่มี network (fetch/XHR/WebSocket ถูกบล็อกใน sandbox, เรียกเมื่อไหร่ throw ทันที), Supabase เป็น mock ทั้งหมด, localStorage เป็นหน่วยความจำจำลอง
> ต้องการแค่ Node.js (มีในเครื่องแล้ว: v22) — ไม่ต้อง npm install อะไรเลย

## วิธีรัน

```bash
node tests/run.mjs
```

```bash
node tests/run.mjs --filter cycle     # รันเฉพาะเทสที่ชื่อมีคำว่า cycle
```

```bash
node tests/run.mjs --json > baseline.json    # เก็บผลเป็น JSON ไว้เทียบก่อน/หลังแก้
```

## ความหมายของผล

| สัญลักษณ์ | ความหมาย | ต้องทำอะไร |
|---|---|---|
| ✅ PASS | เทสปกติผ่าน | — |
| ❌ FAIL | **REGRESSION** — ของที่เคยดีพังแล้ว | ห้าม commit จนกว่าจะหาสาเหตุ (ดู workflow ใน [docs/FIX_TRACKING.md](../docs/FIX_TRACKING.md)) |
| 🟡 KNOWN-OPEN | บั๊กที่รู้อยู่แล้วใน [docs/ISSUES.md](../docs/ISSUES.md) ยังไม่แก้ — พังตามคาด | ปกติ ไม่ต้องทำอะไร |
| 🎉 KNOWN-FIXED | บั๊กที่รู้อยู่แล้วถูกแก้สำเร็จ | อัปเดต FIX_TRACKING + ย้ายเทสจาก `knownIssue()` → `test()` ให้กลายเป็นยามกัน regression ถาวร |

Exit code: `0` = ไม่มี regression, `1` = มี FAIL

## โครงสร้าง

```
tests/
├── run.mjs                  ตัวรัน
├── helpers/
│   ├── harness.mjs          test() / knownIssue() + ตัวเก็บผล
│   ├── sandbox.mjs          VM sandbox: window/localStorage จำลอง + บล็อก network
│   └── mock-supabase.mjs    Supabase จำลอง: select จาก fixtures / mutation บันทึกอย่างเดียวไม่แก้ข้อมูล
├── unit/                    เทสฟังก์ชัน pure ใน Js/*.js (โหลดโค้ดจริงเข้า sandbox)
│   ├── shared-smoke.test.mjs        ทุก shared JS โหลดได้ + export ครบ
│   ├── sku-utils.test.mjs           มาตรฐาน SKU (invariant ข้อ 2)
│   ├── db-errors.test.mjs           ตัวแปล error
│   ├── dashboard-shared.test.mjs    bucket/สถิติ (+H7)
│   ├── reconcile-warehouse.test.mjs encode/parse คลัง (+M19)
│   └── reconcile-book.test.mjs      parser Book + สถานะ match (M4 แก้แล้ว, knownIssue M2)
└── dryrun/                  รันโค้ดจริงกับ mock DB — ตรวจว่า "ถ้ารันจริงจะเขียนอะไร"
    ├── mock-selftest.test.mjs       พิสูจน์กลไก dry run เชื่อถือได้
    ├── active-cycle.test.mjs        การแนบ cycle_id (+H1)
    └── clear-adjustments.test.mjs   โค้ดลบ adjustment (+H6 — โชว์ว่าจะลบแถว applied ทิ้ง)
```

## วิธีเขียนเทสเพิ่ม

```js
import assert from 'node:assert/strict';
import { suite, test, knownIssue } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';

suite('ชื่อกลุ่มเทส');

// เทสปกติ = ยามกัน regression
test('อธิบายพฤติกรรมที่ต้องเป็น', () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    assert.equal(sb.reconcileService.normalizeSku(' a '), 'A');
});

// เทสของบั๊กใน ISSUES.md ที่ยังไม่แก้ — assert "พฤติกรรมที่ถูกต้อง" (ตอนนี้จะพัง = KNOWN-OPEN)
knownIssue('H1', 'อธิบายพฤติกรรมที่ควรเป็นหลังแก้', () => { /* ... */ });

// dry run กับ mock DB — จับว่าโค้ดพยายามเขียนอะไร
test('ตรวจ ops ที่โค้ดจะยิงเข้า DB', async () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({ stock_adjustments: [/* fixtures */] });
    sb.apiService = { getClient: () => mock };
    await sb.reconcileService.someFunction('arg');
    const deletes = findOps(mock, { table: 'stock_adjustments', op: 'delete' });
    assert.equal(deletes.length, 1);
    // deletes[0].wouldAffect = แถวที่ "จะ" โดนลบถ้ารันจริง (fixtures ไม่ถูกแก้จริง)
});
```

## ข้อจำกัด (ตรงไปตรงมา)

- ครอบคลุมเฉพาะ **shared JS** (`Js/*.js`) — โค้ด inline ในไฟล์ HTML (audit_check ~3,000 บรรทัด, reconcile ~1,900 บรรทัด ฯลฯ) ยังเทสอัตโนมัติไม่ได้โดยตรง ต้องใช้ checklist ทดสอบมือใน [docs/FIX_TRACKING.md](../docs/FIX_TRACKING.md) ประกอบ
- mock Supabase กรองเฉพาะ eq/in/gte/lte — `or`/`ilike` คืนทั้งชุด (พอสำหรับตรวจ ops ที่โค้ดยิง)
- ถ้าจะแก้บั๊กในไฟล์ HTML แนะนำ **ย้าย logic ที่แก้ลง shared JS** เพื่อให้เขียนเทสคุ้มกันได้
