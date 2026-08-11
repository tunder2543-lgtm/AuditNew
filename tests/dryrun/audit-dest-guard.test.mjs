// Dry Run: ชุด "หน้า audit_check แก้ข้อมูลจริงได้" — M12 + M13 + M34
//
// M12: guard กันชนปลายทางเช็คจาก `refBySkuLoc` ซึ่งโหลดมาเฉพาะ **คลัง+เดือนที่เลือก**
//      ⇒ ย้ายแถวไปชนกับแถวนอก scope แล้วปล่อยผ่าน = แถวซ้ำจริงในรอบเดียวกัน
//      ⇒ Match บวกยอดซ้ำ (ขัด invariant ข้อ 3) · แถมยังไล่สแกนทั้ง map ใน loop (O(n×m))
//
// M13: โหมดสลับ SKU↔ตำแหน่ง normalize ฝั่งเดียว — SKU ใหม่ถูก UPPERCASE แต่ตำแหน่งใหม่
//      เขียนดิบ ⇒ สลับ 2 ครั้งไม่ได้ค่าเดิม (ในฐานจริงมีตำแหน่งตัวพิมพ์เล็กอยู่ 142 แถว)
//
// M34: `fetchAvailableMonths` ของ audit_check ซ้ำกับ `fetchCountMonths` ทั้งดุ้น
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('dry-run: guard ปลายทางของ audit_check (M12 · M13 · M34)');

const AUDIT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'audit_check.html'), 'utf8');

const norm = s => (s || '').toString().trim().toUpperCase();
// อ่านค่าคงที่จากซอร์สจริง — ถ้ามีคนเปลี่ยนเป็นค่าที่ชนชื่อคลังจริง เทสด้านล่างจะฟ้อง
const ANY_KEY = JSON.parse('"' + AUDIT.match(/const ANY_WAREHOUSE_KEY = '([^']*)'/)[1] + '"');
const refEntryKey = (sku, loc, wh, qty) => `${norm(sku)}|${norm(loc)}|${norm(wh)}|${qty}`;

/**
 * ยกชุดฟังก์ชัน guard จาก audit_check มารันจริงกับ mock DB
 * `refBySkuLoc` จำลอง "ข้อมูลที่โหลดมาใน scope ปัจจุบัน" — ตั้งเป็น Map ว่างได้
 * เพื่อจำลองว่าแถวที่ชนอยู่ **นอก** คลัง/เดือนที่เลือก
 */
function liftGuard({ dbRows = [], scopeEntries = [], cycleOf = () => 'cyc-1' } = {}) {
    const mock = createMockClient({ inventory_counts: dbRows });
    const refBySkuLoc = new Map();
    for (const e of scopeEntries) {
        refBySkuLoc.set(refEntryKey(e.sku_id, e.location, e.warehouse, Number(e.counted_qty)), e);
    }
    const dedupe = loadFresh('Js/audit-dedupe.js').AuditDedupe;
    const countScan = loadFresh('Js/count-scan-shared.js').countScanService;

    const fns = liftFunctions(AUDIT, [
        'fetchDestinationRowsFromDb', 'fetchMovingRowsMeta', 'validateDestUpdateBatch',
        'getDestinationCollision', 'resolveDestQty', 'bangkokMonthOf', 'scopeNoCycleRowsToSameMonth',
    ], {
        supabaseClient: mock,
        norm,
        refEntryKey,
        refBySkuLoc,
        ANY_WAREHOUSE_KEY: ANY_KEY,
        console: { error() {}, warn() {} },
        window: { AuditDedupe: dedupe, countScanService: countScan },
        findRefEntriesBySkuLocQty: () => [],
        getWarehouseForRecordId: () => '',
        getCycleForRecordId: cycleOf,
    });
    return { ...fns, mock };
}

const dbRow = o => ({
    id: 'r1', sku_id: 'A-01', location: 'B2-01', counted_qty: 5,
    warehouse: 'ตึกกันตนา', cycle_id: 'cyc-1', created_at: '2026-08-01T00:00:00Z', counter_name: 'ก', ...o,
});

// -----------------------------------------------------------------------------
// M12
// -----------------------------------------------------------------------------
test('[M12] ปลายทางชนกับแถวที่อยู่นอก scope ที่โหลดไว้ ต้องยังบล็อกได้', async () => {
    // scope ว่าง = ผู้ใช้เลือกคลัง/เดือนอื่นอยู่ · แต่ DB มีแถวปลายทาง รอบเดียวกัน
    const g = liftGuard({ dbRows: [dbRow({ id: 'มีอยู่แล้ว' })], scopeEntries: [] });
    const { ok, blocked } = await g.validateDestUpdateBatch([
        { recordId: 'กำลังย้าย', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(ok.length, 0, 'ปล่อยผ่าน = ได้แถวซ้ำจริงในรอบเดียวกัน Match จะบวกยอดซ้ำ');
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].message, /รอบนับเดียวกัน/);
});

test('[M12] ปลายทางเป็นคนละรอบนับ = เตือน ไม่บล็อก (migration 011)', async () => {
    const g = liftGuard({
        dbRows: [dbRow({ id: 'รอบเก่า', cycle_id: 'cyc-เก่า' })],
        scopeEntries: [],
        cycleOf: () => 'cyc-1',
    });
    const { ok, blocked, warned } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(blocked.length, 0);
    assert.equal(ok.length, 1, 'คนละรอบถือเป็นข้อมูลถูกต้อง ต้องย้ายได้');
    assert.equal(warned.length, 1);
});

test('[M12] ปลายทางว่างจริง ๆ ต้องผ่าน (ไม่ใช่บล็อกทุกอย่างเพื่อความปลอดภัย)', async () => {
    const g = liftGuard({ dbRows: [dbRow({ location: 'ที่อื่น' })], scopeEntries: [] });
    const { ok, blocked } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(blocked.length, 0);
    assert.equal(ok.length, 1);
});

test('[M12] ตำแหน่งตัวพิมพ์เล็กใน DB ต้องยังถูกจับว่าชน', async () => {
    // ฐานจริงมี location ตัวพิมพ์เล็กอยู่ 142 แถว — ถ้ากรอง location ฝั่ง DB จะพลาดทั้งหมด
    const g = liftGuard({ dbRows: [dbRow({ id: 'เล็ก', location: 'b2-01' })], scopeEntries: [] });
    const { blocked } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(blocked.length, 1, 'ต้องกรอง location ฝั่ง client ไม่ใช่ .in() ฝั่ง DB');
});

test('[M12] หาคลังของแถวที่กำลังย้ายไม่เจอ แต่ DB มีปลายทางอยู่ ต้องบล็อก', async () => {
    // เกิดจริงเมื่อแถวที่กดย้ายอยู่นอก scope ที่โหลด ⇒ getWarehouseForRecordId คืน ''
    // เส้นทางนี้เดิมดูแต่ refBySkuLoc ในหน่วยความจำ จึงคืน null = ปล่อยผ่าน
    const g = liftGuard({ dbRows: [dbRow({ id: 'ปลายทาง' })], scopeEntries: [] });
    const { ok, blocked } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: '', destQty: 5 },
    ]);
    assert.equal(ok.length, 0, 'ไม่รู้คลัง + ปลายทางมีของอยู่ = ตัดสินไม่ได้ ⇒ ห้ามเขียน');
    assert.match(blocked[0].message, /เลือกคลัง/);
});

test('[M12] ไม่รู้คลัง แต่ปลายทางว่างจริง ๆ ต้องผ่าน', async () => {
    const g = liftGuard({ dbRows: [dbRow({ location: 'ที่อื่น' })], scopeEntries: [] });
    const { ok } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: '', destQty: 5 },
    ]);
    assert.equal(ok.length, 1, 'ไม่ใช่ว่าไม่รู้คลังแล้วบล็อกทุกอย่าง');
});

test('[M12] แถวปลายทางที่ยังไม่ผูกรอบ ต้องนับเป็น "รอบเดียวกัน" เฉพาะเดือนไทยเดียวกัน', async () => {
    // cycleKey(null) เป็นค่าเดียวกันหมด ⇒ ก่อนแก้ แถวปีที่แล้วจะบล็อกการแก้ตำแหน่งของเดือนนี้
    // ด้วยข้อความ "รอบนับเดียวกัน" ที่ไม่จริง และกดผ่านไม่ได้เลย
    // เกิดได้จริงเพราะ FK เป็น ON DELETE SET NULL — ลบรอบทีเดียวแถวทั้งรอบกลายเป็นไม่มีรอบ
    const moving = { id: 'ย้าย', cycle_id: null, created_at: '2026-08-05T03:00:00Z', warehouse: 'ตึกกันตนา' };

    const คนละเดือน = liftGuard({
        dbRows: [moving, dbRow({ id: 'มี.ค.', cycle_id: null, created_at: '2026-03-02T03:00:00Z' })],
        cycleOf: () => null,
    });
    const r1 = await คนละเดือน.validateDestUpdateBatch([
        { recordId: 'ย้าย', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(r1.blocked.length, 0, 'คนละเดือน + ไม่มีรอบทั้งคู่ = คนละรอบ ต้องไม่บล็อก');
    assert.equal(r1.warned.length, 1, 'แต่ยังต้องเตือนให้เห็นก่อน');

    const เดือนเดียวกัน = liftGuard({
        dbRows: [moving, dbRow({ id: 'ส.ค.', cycle_id: null, created_at: '2026-08-09T03:00:00Z' })],
        cycleOf: () => null,
    });
    const r2 = await เดือนเดียวกัน.validateDestUpdateBatch([
        { recordId: 'ย้าย', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(r2.blocked.length, 1, 'เดือนเดียวกัน = ถือเป็นรอบเดียวกัน ต้องบล็อก');
});

test('[M12] รอบของแถวที่กำลังย้ายต้องอ่านจาก DB ไม่ใช่จาก scope ในหน่วยความจำ', async () => {
    // แถวที่ location ว่างไม่เข้า refBySkuLoc (loadReferenceData ข้ามไป) แต่นั่นคือแถวที่คน
    // เปิดโหมด "แก้ไขตำแหน่ง" มาเติมพอดี ⇒ เส้นทางที่ใช้บ่อยที่สุดคือเส้นที่ guard ตาบอดที่สุด
    const g = liftGuard({
        dbRows: [
            { id: 'ย้าย', sku_id: 'Z-99', location: '', counted_qty: 5, warehouse: 'ตึกกันตนา', cycle_id: 'cyc-1', created_at: '2026-08-05T03:00:00Z' },
            dbRow({ id: 'ปลายทาง', cycle_id: 'cyc-1' }),
        ],
        cycleOf: () => null,        // memory หาไม่เจอ (นี่คือของจริง)
    });
    const { ok, blocked } = await g.validateDestUpdateBatch([
        { recordId: 'ย้าย', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(ok.length, 0, 'รอบเดียวกันจริง แต่ถ้าอ่านรอบจาก memory จะกลายเป็นแค่ "เตือน" แล้วปล่อยผ่าน');
    assert.match(blocked[0].message, /รอบนับเดียวกัน/);
});

test('[M12] SKU เกิน 1 chunk ต้องถูกถามครบ', async () => {
    const skus = Array.from({ length: 45 }, (_, i) => `S${String(i).padStart(3, '0')}`);
    // แถวที่ชนอยู่ท้ายสุด = อยู่ chunk ที่ 2
    const g = liftGuard({ dbRows: [dbRow({ id: 'ท้ายสุด', sku_id: skus[44] })] });
    const { blocked } = await g.validateDestUpdateBatch(skus.map((sku, i) => ({
        recordId: `r${i}`, destSku: sku, destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5,
    })));
    assert.equal(blocked.length, 1, 'ถ้าทำแค่ chunk แรก SKU ตัวที่ 41-45 จะไม่ถูกตรวจเลย');
    assert.equal(blocked[0].destSku, skus[44]);
});

test('[M12] ปลายทางเกิน 1 หน้า ต้องอ่านครบทุกหน้า', async () => {
    // 1,200 แถวของ SKU เดียวกัน — แถวที่ชนจริงอยู่หน้า 2
    const filler = Array.from({ length: 1150 }, (_, i) => dbRow({
        id: `f${i}`, location: `ที่อื่น-${i}`, counted_qty: 5,
    }));
    const g = liftGuard({ dbRows: [...filler, dbRow({ id: 'หน้า2' })] });
    const { blocked } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(blocked.length, 1, 'หยุดที่หน้าแรก = แถวที่ชนอยู่หลังแถวที่ 1,000 หลุดหมด');
});

test('[M12] ชื่อคลังที่มีช่องว่าง/ตัวพิมพ์ต่างกันต้องยังจับคู่ได้', async () => {
    const g = liftGuard({ dbRows: [dbRow({ id: 'เว้นวรรค', warehouse: '  ตึกกันตนา ' })] });
    const { blocked } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(blocked.length, 1, 'ต้อง norm() ชื่อคลังตอนสร้างคีย์ ไม่งั้นแถวหลุด');
});

test('[M12] ค่าคีย์ "ไม่ระบุคลัง" ต้องเป็นค่าที่ชนชื่อคลัง/รอบจริงไม่ได้', () => {
    assert.ok(ANY_KEY, 'หา ANY_WAREHOUSE_KEY ในซอร์สไม่เจอ');
    assert.ok(/[\u0000-\u001f]/.test(ANY_KEY),
        `ค่า ${JSON.stringify(ANY_KEY)} เป็นข้อความธรรมดา — ชนกับชื่อคลังที่ผู้ใช้พิมพ์เองได้`);
});

test('[M12] ทุก call site ต้อง await validateDestUpdateBatch', () => {
    // ลืม await = ได้ Promise แล้ว toApply.length เป็น undefined ⇒ หน้าพังตอนรันจริง
    // โดยเทสพฤติกรรมทั้งหมดยังเขียว (บทเรียนเดียวกับ `const btn` ที่เคยทำ audit_check พังเงียบ)
    const calls = [...AUDIT.matchAll(/(\w+\s+)?validateDestUpdateBatch\(planned\)/g)];
    assert.equal(calls.length, 3, `เจอ call site ${calls.length} จุด — เทสนี้ล้าสมัย`);
    for (const c of calls) {
        assert.equal(c[1]?.trim(), 'await', `call site ที่ index ${c.index} ไม่มี await`);
    }
});

test('[M13] ทุกทางที่เขียน location ลง DB ต้องเขียนค่าที่ normalize แล้ว', () => {
    // guard เทียบด้วย norm() ⇒ ถ้าเขียนค่าดิบ "ค่าที่ตรวจ" กับ "ค่าที่เขียน" คนละตัว
    // และเป็นต้นทางของตำแหน่งตัวพิมพ์ผสมในฐาน (ที่บังคับให้ต้องกรอง location ฝั่ง client)
    const writes = [...AUDIT.matchAll(/\.update\(\{[^}]*location:\s*([^,}]+)/g)].map(m => m[1].trim());
    assert.ok(writes.length >= 3, `เจอจุดเขียน location ${writes.length} จุด — เทสนี้ล้าสมัย`);
    for (const w of writes) {
        assert.ok(/^norm\(|destLoc$|newLoc$/.test(w),
            `เขียนค่าดิบลง location: ${w} — ต้องผ่าน norm() ก่อน`);
    }
    // และค่าที่ถูกเขียนตอนสลับ ต้องเป็นตัวที่ผ่าน guard มา ไม่ใช่ค่าเดิมในช่อง
    const swap = AUDIT.slice(AUDIT.indexOf('async function applySwapSkuLocSelected'));
    assert.match(swap.slice(0, 6000), /\.update\(\{ sku_id: item\.newSkuId, location: item\.destLoc \}\)/);

    // ⚠️ เช็คถึง "ที่มา" ของตัวแปรด้วย — เขียน `item.newLoc` ดูผ่าน แต่ถ้า newLoc มาจาก
    //    `input.value.trim()` ดิบ ๆ ก็ยังเป็นบั๊กเดิม (mutation พิสูจน์แล้วว่ารอดได้)
    // ไล่ย้อนจากจุดเขียนจริงไปหา "การประกาศล่าสุดก่อนหน้า" ของตัวแปรนั้น
    // (ห้ามสแกนทุก `const newLoc` ในไฟล์ — มีตัวที่ใช้ทำข้อความ preview ซึ่งไม่ได้เขียน DB)
    // ⚠️ ห้ามสร้าง RegExp จากสตริง — `\s` ในไฟล์นี้กลายเป็น `s` เฉย ๆ แล้วเทสผ่านแบบว่างเปล่า
    let checked = 0;
    for (const m of AUDIT.matchAll(/\.update\(\{[^}]*location:\s*([^,}]+)/g)) {
        const expr = m[1].trim();
        const varName = expr.replace(/^norm\(/, '').replace(/\)$/, '').split('.').pop();
        const before = AUDIT.slice(0, m.index);
        const at = Math.max(before.lastIndexOf(`const ${varName} =`), before.lastIndexOf(`let ${varName} =`));
        if (at < 0) continue;                                // ค่ามาจาก object ที่สร้างที่อื่น
        const declExpr = before.slice(before.indexOf('=', at) + 1, before.indexOf(';', at)).trim();
        checked++;
        assert.ok(/norm\(/.test(expr) || /norm\(/.test(declExpr),
            `จุดเขียน location ใช้ ${expr} ซึ่งมาจาก ${varName} = ${declExpr} — ต้องผ่าน norm()`);
    }
    assert.ok(checked >= 1, 'ไล่ย้อนหาที่มาของค่าที่เขียนไม่ได้เลย — เทสนี้ล้าสมัย');
});

test('[M12] query ปลายทางต้องไม่กรองคลัง/เดือน และมี .order("id")', async () => {
    const g = liftGuard({ dbRows: [dbRow()], scopeEntries: [] });
    await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    const q = findOps(g.mock, { table: 'inventory_counts', op: 'select' })[0];
    assert.ok(q, 'ต้องยิง query ถาม DB จริง ไม่ใช่ดูแต่ใน memory');
    // ⚠️ mock เก็บ eq/in/gte ไว้ใน `filters` ส่วน order/range อยู่ใน `modifiers`
    //    เทสรุ่นแรกอ่านผิดที่ ทำให้ข้อ "ห้ามกรอง scope" ผ่านแบบว่างเปล่า
    const scoped = q.filters.filter(f => f.col === 'warehouse' || f.col === 'created_at').map(f => f.col);
    assert.deepEqual(scoped, [], `ห้ามกรองคลัง/เดือนตอนตรวจปลายทาง แต่เจอ: ${scoped.join(', ')}`);
    assert.ok(q.modifiers.some(m => m.type === 'order' && m.col === 'id'), 'invariant ข้อ 13');
    assert.ok(q.filters.some(f => f.type === 'in' && f.col === 'sku_id'), 'ควรแคบด้วย sku_id ฝั่ง DB');
    assert.ok(!q.filters.some(f => f.col === 'location'), 'ห้ามกรอง location ฝั่ง DB — จะพลาดแถวตัวพิมพ์เล็ก');
});

test('[M12] อ่านปลายทางไม่สำเร็จ ต้องบล็อกทั้งชุด ไม่ปล่อยผ่านเงียบ ๆ', async () => {
    const g = liftGuard({ dbRows: [] });
    g.mock.from = () => { throw new Error('เน็ตหลุด'); };
    const { ok, blocked } = await g.validateDestUpdateBatch([
        { recordId: 'x', destSku: 'A-01', destLoc: 'B2-01', warehouse: 'ตึกกันตนา', destQty: 5 },
    ]);
    assert.equal(ok.length, 0, 'ตรวจไม่ได้ = ไม่รู้ว่าชนไหม ⇒ ห้ามเขียน');
    assert.equal(blocked.length, 1);
});

test('[M12] findRefEntriesBySkuLocQty ต้องใช้ดัชนี ไม่ไล่สแกนทั้ง map', () => {
    const at = AUDIT.indexOf('function findRefEntriesBySkuLocQty');
    const body = AUDIT.slice(at, AUDIT.indexOf('}', AUDIT.indexOf('{', at) + 1) + 1);
    assert.ok(/refBySkuLocQty\.get/.test(body), 'ยังไล่สแกนอยู่ = O(n×m) ใน loop ของ validateDestUpdateBatch');
    assert.ok(!/for \(const entry of refBySkuLoc\.values/.test(body));
});

// -----------------------------------------------------------------------------
// M13
// -----------------------------------------------------------------------------
test('[M13] สลับ SKU↔ตำแหน่ง ต้อง normalize ทั้งสองฝั่ง', () => {
    const at = AUDIT.indexOf('const newSkuId = window.SkuUtils.normalizeSku(oldLoc);');
    assert.ok(at > 0, 'หาโค้ดสลับไม่เจอ — เทสนี้ล้าสมัย');
    const block = AUDIT.slice(at, at + 400);
    assert.ok(/const newLoc = norm\(oldSku\)/.test(block),
        'ตำแหน่งใหม่ต้องถูก normalize ด้วย ไม่งั้นสลับ 2 ครั้งไม่ได้ค่าเดิม');
    assert.ok(/destLoc: newLoc/.test(block) && !/destLoc: oldSku/.test(block),
        'ต้องเขียนค่าที่ normalize แล้วลง DB ไม่ใช่ค่าดิบจากช่องกรอก');
});

test('[M13] สลับ 2 ครั้งต้องได้ค่าเดิม (round-trip)', () => {
    const normalizeSku = loadFresh('Js/sku-utils.js').SkuUtils.normalizeSku;
    const swap = ({ sku, loc }) => ({ sku: normalizeSku(loc), loc: norm(sku) });

    const start = { sku: 'A-01', loc: 'b2-01' };
    const once = swap(start);
    assert.deepEqual(once, { sku: 'B2-01', loc: 'A-01' });
    const twice = swap(once);
    // ⚠️ ตัวพิมพ์เล็กเดิมของตำแหน่งหายไปตั้งแต่รอบแรก (ข้อมูลถูกทำลายเพราะ SKU ต้อง
    //    UPPERCASE ตาม invariant ข้อ 2) — ที่ต้องรับประกันคือ **สลับต่อจากนี้ต้องนิ่ง**
    assert.deepEqual(twice, { sku: 'A-01', loc: 'B2-01' });
    assert.deepEqual(swap(swap(twice)), twice, 'จากรอบที่ 2 เป็นต้นไปต้องกลับมาที่เดิมเป๊ะ');
});

// -----------------------------------------------------------------------------
// M34
// -----------------------------------------------------------------------------
test('[M34] audit_check ต้องไม่ถือสำเนา fetchCountMonths ของตัวเอง', () => {
    const at = AUDIT.indexOf('async function fetchAvailableMonths');
    assert.ok(at > 0);
    const body = AUDIT.slice(at, at + 400);
    assert.ok(/countScanService\.fetchCountMonths/.test(body), 'ต้องเรียก helper ร่วม');
    assert.ok(!/get_inventory_count_months/.test(body), 'ยังมีสำเนา RPC/paging ของตัวเองอยู่');
    // และต้องโหลดไฟล์ต้นทางจริง ไม่งั้น ReferenceError ตอนใช้งาน
    assert.match(AUDIT, /<script src="\.\.\/Js\/count-scan-shared\.js\?v=/);
});

test('[M34] reconcile-shared ต้อง delegate ไม่ใช่ถือโค้ดชุดที่สอง', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'reconcile-shared.js'), 'utf8');
    assert.ok(/countScan\(\)\.fetchCountMonths/.test(src));
    assert.ok(!/get_inventory_count_months/.test(src), 'ยังมีสำเนาอยู่ใน reconcile-shared');
});

test('[M34] ทุกหน้าที่โหลด reconcile-shared ต้องโหลด count-scan-shared ก่อน (invariant ข้อ 8)', () => {
    const files = ['index.html', ...fs.readdirSync(path.join(PROJECT_ROOT, 'Html'))
        .filter(f => f.endsWith('.html')).map(f => path.join('Html', f))];
    let checked = 0;
    for (const rel of files) {
        const src = fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
        const recon = src.indexOf('reconcile-shared.js?v=');
        if (recon < 0) continue;
        const scan = src.indexOf('count-scan-shared.js?v=');
        assert.ok(scan >= 0, `${rel} โหลด reconcile-shared แต่ไม่โหลด count-scan-shared`);
        assert.ok(scan < recon, `${rel} โหลด count-scan-shared ช้ากว่า reconcile-shared`);
        checked++;
    }
    assert.ok(checked >= 8, `ตรวจได้แค่ ${checked} หน้า — น่าจะหาไม่เจอ`);
});
