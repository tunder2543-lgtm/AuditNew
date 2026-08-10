// เทส LC — โหมด "Import เทียบตำแหน่ง" ในหน้า audit_check
//
// บั๊กจริงที่ทำให้ต้องมีเทสชุดนี้ (พบ 2026-08-10):
//   runLocCompare SELECT ข้อมูลมาโดยไม่เอา `counted_qty`
//   → แผนเดิมแปลงเป็น '' เงียบ ๆ → resolveDestQty คืน NaN
//   → getDestinationCollision บล็อกทุกแถวด้วย "จำนวนปลายทางไม่ถูกต้อง"
//   → ผู้ใช้เห็นแค่ "ไม่บันทึก — ปลายทางซ้ำทั้งหมด 51 รายการ" โดยไม่รู้สาเหตุ
//   ฟีเจอร์นี้จึงใช้งานไม่ได้เลยตั้งแต่แรก
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('audit-loc-compare: เทียบตำแหน่งกับ Excel (LC)');

const LC = loadFresh('Js/audit-loc-compare.js').AuditLocCompare;

/** แถวจาก inventory_counts */
const rec = (o = {}) => ({
    id: o.id ?? Math.random().toString(36).slice(2),
    sku_id: 'PC698',
    location: 'G2-05',
    warehouse: 'ตึกกันตนา',
    counted_qty: 5,
    cycle_id: 'cy-1',
    ...o
});

const excel = (pairs) => new Map(pairs);

test('[LC-guard] แถวที่มี counted_qty ต้องส่งค่าต่อถึง mismatches', () => {
    // ถ้าค่านี้หาย ตัวเช็คชนปลายทางจะได้ NaN แล้วบล็อกทุกแถว = บั๊กเดิม
    const r = LC.buildLocComparePlan(
        [rec({ id: 'r1', counted_qty: 213 })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.mismatches.length, 1);
    assert.equal(r.mismatches[0].counted_qty, 213, 'จำนวนต้องติดไปกับแผน');
    assert.equal(r.mismatches[0].dbLocation, 'G2-05');
    assert.equal(r.mismatches[0].newLocation, 'G1-03');
    assert.equal(r.mismatches[0].cycle_id, 'cy-1', 'ต้องพา cycle_id ไปให้ guard M26 ตัดสินรอบได้');
    assert.equal(r.missingQty.length, 0);
});

test('[LC-guard] counted_qty = 0 คือค่าที่ถูกต้อง ห้ามตกไปเป็น "ไม่มีค่า"', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'zero', counted_qty: 0 })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.mismatches.length, 1, 'นับแล้วไม่เจอของ (0) ก็ต้องย้ายตำแหน่งได้');
    assert.equal(r.mismatches[0].counted_qty, 0);
    assert.equal(r.missingQty.length, 0);
});

test('[LC-guard] แถวที่ไม่มี counted_qty → เข้า missingQty ไม่ใช่เงียบ ๆ ผ่านไป', () => {
    const noQty = rec({ id: 'bad' });
    delete noQty.counted_qty;                       // จำลอง SELECT ที่ลืมคอลัมน์นี้ (บั๊กเดิม)
    const r = LC.buildLocComparePlan([noQty], 'G', excel([['PC698', 'G1-03']]), { warehouse: 'ตึกกันตนา' });

    assert.equal(r.mismatches.length, 0, 'ห้ามส่งแถวที่ข้อมูลไม่ครบไปแก้ DB');
    assert.equal(r.missingQty.length, 1, 'ต้องรายงานออกมาให้เห็น');
    assert.equal(r.missingQty[0].sku, 'PC698');
});

test('[LC] counted_qty ที่เป็น null / ค่าขยะ → missingQty เหมือนกัน', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'n', counted_qty: null }), rec({ id: 'x', counted_qty: 'abc' })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.missingQty.length, 2);
    assert.equal(r.mismatches.length, 0);
});

test('[LC] กรองโซน: เทียบเฉพาะ SKU ที่ตำแหน่งใน Excel อยู่โซนที่เลือก', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'a', sku_id: 'PC698' }), rec({ id: 'b', sku_id: 'AA001', location: 'B1-01' })],
        'G',
        excel([['PC698', 'G1-03'], ['AA001', 'B9-09']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.deepEqual(JSON.parse(JSON.stringify(r.mismatches.map(m => m.sku))), ['PC698']);
});

test('[LC] ตำแหน่งเดิมอยู่คนละโซนก็ย้ายได้ (ยึดโซนของ Excel เป็นเกณฑ์)', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'a', location: 'B4-02' })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.mismatches.length, 1);
    assert.equal(r.mismatches[0].dbLocation, 'B4-02');
});

test('[LC] กรองคลัง: แถวคลังอื่นต้องไม่ถูกแตะ', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'in', warehouse: 'ตึกกันตนา' }), rec({ id: 'out', warehouse: 'คลังอะไหล่' })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.deepEqual(JSON.parse(JSON.stringify(r.mismatches.map(m => m.id))), ['in']);
});

test('[LC] ไม่ระบุคลัง → ไม่กรองคลัง', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'a', warehouse: 'ตึกกันตนา' }), rec({ id: 'b', warehouse: 'คลังอะไหล่' })],
        'G',
        excel([['PC698', 'G1-03']]),
        {}
    );
    // SKU เดียวกันอยู่ 2 คลังที่ตำแหน่งเดียวกัน → ไม่กำกวม ย้ายทั้งคู่
    assert.equal(r.mismatches.length, 2);
});

test('[LC] ตำแหน่งตรงกันแล้ว → matchedOk ไม่เข้า mismatches', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'a', location: 'G1-03' })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.matchedOk, 1);
    assert.equal(r.mismatches.length, 0);
});

test('[LC] เทียบตำแหน่งแบบ normalize (ตัวพิมพ์/เว้นวรรค)', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'a', location: ' g1-03 ' })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.matchedOk, 1, 'เว้นวรรค/ตัวพิมพ์ต่างกัน = ตำแหน่งเดียวกัน ไม่ต้องแก้');
});

test('[LC] SKU ใน Excel ที่ไม่มีในระบบ → notInSystem (ไม่สร้างรหัสใหม่)', () => {
    const r = LC.buildLocComparePlan([], 'G', excel([['NEW-SKU', 'G1-03']]), { warehouse: 'ตึกกันตนา' });
    assert.equal(r.notInSystem.length, 1);
    assert.equal(r.notInSystem[0].sku, 'NEW-SKU');
    assert.equal(r.mismatches.length, 0);
});

test('[LC] notInSystem ใช้ชื่อ SKU ตามที่พิมพ์ในไฟล์ได้ (skuLabelOf)', () => {
    const r = LC.buildLocComparePlan([], 'G', excel([['NEW-SKU', 'G1-03']]), {
        skuLabelOf: () => 'new-sku'
    });
    assert.equal(r.notInSystem[0].sku, 'new-sku');
});

test('[LC] SKU ที่มีหลายตำแหน่งใน DB → dbAmbiguous และห้ามเข้า mismatches', () => {
    // เคสจริง: PC696 อยู่ทั้ง G1-01 และ G2-05 — ระบบตัดสินแทนคนไม่ได้ว่าจะย้ายแถวไหน
    const r = LC.buildLocComparePlan(
        [rec({ id: 'a', sku_id: 'PC696', location: 'G1-01' }), rec({ id: 'b', sku_id: 'PC696', location: 'G2-05' })],
        'G',
        excel([['PC696', 'G1-01']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.dbAmbiguous.length, 1);
    assert.equal(r.dbAmbiguous[0].sku, 'PC696');
    assert.equal(r.dbAmbiguous[0].locations.length, 2);
    assert.equal(r.mismatches.length, 0);
});

test('[LC] SKU เดียวกันหลายแถว "ตำแหน่งเดียวกัน" (นับแยกถุง) → ย้ายทุกแถว', () => {
    const r = LC.buildLocComparePlan(
        [rec({ id: 'bag1', counted_qty: 70 }), rec({ id: 'bag2', counted_qty: 200 })],
        'G',
        excel([['PC698', 'G1-03']]),
        { warehouse: 'ตึกกันตนา' }
    );
    assert.equal(r.mismatches.length, 2, 'ทุกถุงต้องย้ายตามกัน ไม่งั้นของกระจัดกระจาย');
    assert.deepEqual(JSON.parse(JSON.stringify(r.mismatches.map(m => m.counted_qty))), [70, 200]);
});

test('[LC] ข้อมูลว่าง / ไม่มี Excel → ไม่พัง', () => {
    const empty = LC.buildLocComparePlan(null, 'G', null, {});
    assert.equal(empty.mismatches.length, 0);
    assert.equal(empty.matchedOk, 0);
    assert.equal(empty.notInSystem.length, 0);
    assert.equal(empty.missingQty.length, 0);
});

test('[LC] getLocationZone: อักษรตัวแรกของตำแหน่ง', () => {
    assert.equal(LC.getLocationZone('G2-05'), 'G');
    assert.equal(LC.getLocationZone(' g1-03 '), 'G');
    assert.equal(LC.getLocationZone('3-05'), '');
    assert.equal(LC.getLocationZone(''), '');
    assert.equal(LC.getLocationZone(null), '');
});
