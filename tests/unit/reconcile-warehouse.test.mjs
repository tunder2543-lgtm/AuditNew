// เทสระบบ encode/parse คลังของรอบนับ — [M19] แก้แล้ว 2026-08-11 (เทสถาวรกัน regression)
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('reconcile-shared: คลังของรอบ (encode/parse/match)');

const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
const RS = sb.reconcileService;

// หมายเหตุ: object/array ที่สร้างใน VM sandbox มี prototype คนละตัวกับฝั่งเทส
// → เทียบผ่าน JSON แทน deepEqual แบบ strict
const json = (v) => JSON.parse(JSON.stringify(v));

test('parseCycleWarehouses: คลังเดียว → [คลัง]', () => {
    assert.deepEqual(json(RS.parseCycleWarehouses('ตึกกันตนา')), ['ตึกกันตนา']);
});

test('parseCycleWarehouses: multi "A|B" → [A, B]', () => {
    assert.deepEqual(json(RS.parseCycleWarehouses('ตึกกันตนา|คลังอะไหล่')), ['ตึกกันตนา', 'คลังอะไหล่']);
});

test('parseCycleWarehouses: "คลังทั้งหมด" → null (แปลว่าทุกคลัง)', () => {
    assert.equal(RS.parseCycleWarehouses('คลังทั้งหมด'), null);
});

test('warehouseMatchesCycle: ตรงคลัง = true, ต่างคลัง = false, ทุกคลัง = true', () => {
    const cycle = { warehouse: 'ตึกกันตนา|คลังอะไหล่' };
    assert.equal(RS.warehouseMatchesCycle(cycle, 'ตึกกันตนา'), true);
    assert.equal(RS.warehouseMatchesCycle(cycle, 'หน้าไลฟ์(บางกรวย)'), false);
    assert.equal(RS.warehouseMatchesCycle({ warehouse: 'คลังทั้งหมด' }, 'อะไรก็ได้'), true);
});

test('encodeCycleWarehouses: คลังมาตรฐานเรียงเสถียร (ลำดับ input ไม่มีผล)', () => {
    const a = RS.encodeCycleWarehouses(['คลังอะไหล่', 'ตึกกันตนา']);
    const b = RS.encodeCycleWarehouses(['ตึกกันตนา', 'คลังอะไหล่']);
    assert.equal(a, b, 'ชุดคลังเดียวกันต้อง encode ได้ค่าเดียวกัน');
});

test('encodeCycleWarehouses: ว่าง → "คลังทั้งหมด"', () => {
    assert.equal(RS.encodeCycleWarehouses([]), 'คลังทั้งหมด');
    assert.equal(RS.encodeCycleWarehouses(null), 'คลังทั้งหมด');
});

test('parseYearMonth: รูปแบบถูก/ผิด', () => {
    assert.deepEqual(json(RS.parseYearMonth('2026-08')), { year: 2026, month: 8, yearMonth: '2026-08' });
    assert.equal(RS.parseYearMonth('2026-13'), null);
    assert.equal(RS.parseYearMonth('bad'), null);
});

// -----------------------------------------------------------------------------
// M19 — ✅ แก้แล้ว 2026-08-11 (ย้ายจาก knownIssue → เทสถาวรกัน regression)
//
// เดิมคลังที่ไม่อยู่ใน STANDARD_WAREHOUSES ถูก map เป็น 99 เท่ากันหมด ⇒ comparator คืน 0
// ⇒ Array.sort ของ V8 เสถียร จึงคงลำดับ input ⇒ "X|Y" กับ "Y|X" เป็นคนละสตริง
// ⇒ DB มองเป็นคนละรอบ = สร้างรอบซ้ำ ผลนับกระจายคนละรอบ Match เพี้ยนทั้งคู่
// -----------------------------------------------------------------------------
test('[M19] encodeCycleWarehouses เสถียรแม้คลังไม่อยู่ในรายการมาตรฐาน', () => {
    const a = RS.encodeCycleWarehouses(['คลังใหม่เอ', 'คลังใหม่บี']);
    const b = RS.encodeCycleWarehouses(['คลังใหม่บี', 'คลังใหม่เอ']);
    assert.equal(a, b, `ได้ "${a}" กับ "${b}" — ชุดเดียวกันต้อง encode เหมือนกัน`);
});

test('[M19] คลังมาตรฐานปนกับคลังนอกรายการ ก็ยังเสถียร', () => {
    const a = RS.encodeCycleWarehouses(['คลังใหม่บี', 'ตึกกันตนา', 'คลังใหม่เอ']);
    const b = RS.encodeCycleWarehouses(['คลังใหม่เอ', 'คลังใหม่บี', 'ตึกกันตนา']);
    assert.equal(a, b);
    assert.ok(a.startsWith('ตึกกันตนา'), 'คลังมาตรฐานต้องมาก่อนเสมอ — รอบเก่าใน DB เก็บลำดับนี้อยู่');
});

test('[M19] ลำดับคลังมาตรฐานต้องไม่เปลี่ยน (รอบเก่าใน DB พึ่งค่านี้)', () => {
    // ถ้าเผลอเปลี่ยนไปเรียงตามชื่อทั้งหมด รอบที่มีอยู่แล้วจะ encode ได้คนละค่า = สร้างรอบซ้ำเสียเอง
    assert.equal(
        RS.encodeCycleWarehouses(['คลังอะไหล่', 'ตึกกันตนา']),
        'ตึกกันตนา|คลังอะไหล่'
    );
});

test('[M19] ชื่อซ้ำ/ช่องว่างเกิน ต้องไม่ทำให้ได้คนละสตริง', () => {
    assert.equal(RS.encodeCycleWarehouses(['ตึกกันตนา', 'ตึกกันตนา']), 'ตึกกันตนา');
    assert.equal(RS.encodeCycleWarehouses(['  ตึกกันตนา  ']), 'ตึกกันตนา');
    assert.equal(RS.encodeCycleWarehouses(['', '   ']), 'คลังทั้งหมด');
});
