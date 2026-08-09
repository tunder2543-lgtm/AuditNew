// เทสระบบ encode/parse คลังของรอบนับ — รวม knownIssue M19 (encode ไม่เสถียร)
import assert from 'node:assert/strict';
import { suite, test, knownIssue } from '../helpers/harness.mjs';
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
// M19 (docs/ISSUES.md): คลังที่ไม่อยู่ใน STANDARD_WAREHOUSES ทุกตัว map เป็น 99
// เท่ากันหมด → sort เสถียรของ V8 คงลำดับ input → "X|Y" กับ "Y|X" เป็นคนละ string
// → DB (unique อิง string) มองเป็นคนละรอบ สร้างรอบซ้ำได้
// -----------------------------------------------------------------------------
knownIssue('M19', 'encodeCycleWarehouses ต้องเสถียรแม้คลังไม่อยู่ในรายการมาตรฐาน', () => {
    const a = RS.encodeCycleWarehouses(['คลังใหม่เอ', 'คลังใหม่บี']);
    const b = RS.encodeCycleWarehouses(['คลังใหม่บี', 'คลังใหม่เอ']);
    assert.equal(a, b, `ได้ "${a}" กับ "${b}" — ชุดเดียวกันต้อง encode เหมือนกัน`);
});
