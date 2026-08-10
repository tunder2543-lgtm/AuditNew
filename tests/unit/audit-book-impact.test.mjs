// เทส H11 — "ตำแหน่งเดียวกัน SKU เดียวกัน หลายแถว" ทำให้ Match บวกเกิน
//
// refresh_reconciliation_for_cycle ใช้ SUM(counted_qty) ต่อ SKU ต่อรอบ (docs/sql/013)
// แถวหลายแถวที่ตำแหน่งเดียวกันจึงถูกบวกรวมเสมอ — บางทีถูก (ทยอยนับทีละกล่อง)
// บางทีผิด (คีย์ผิดแล้วคีย์ใหม่ แถวเก่าค้าง) → โมดูลนี้ "คำนวณให้ดู" ไม่ตัดสินแทนคน
//
// ⛔ นโยบาย admin (2026-08-10): ระบบห้ามลบ/แก้จำนวนเอง และ **ห้ามแนะนำให้ลบ**
//    ทางออกคือให้คนกด "ยืนยันว่าปกติ" (ดู suite ท้ายไฟล์)
//
// ตัวเลขทุกเคสด้านล่างมาจากข้อมูลจริงในรอบ 141972ac (สิงหาคม 2569) ตรวจด้วย SQL แล้ว
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('audit-book-impact: ผลกระทบของแถวทับซ้อนต่อ Match (H11)');

const BI = loadFresh('Js/audit-book-impact.js').AuditBookImpact;

const T0 = Date.parse('2026-08-06T03:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();

/** แถว inventory_counts */
const row = (o = {}) => ({
    id: o.id ?? Math.random().toString(36).slice(2),
    warehouse: 'ตึกกันตนา',
    sku_id: 'X-01',
    location: 'A1-01',
    counted_qty: 1,
    counter_name: 'ADMIN',
    cycle_id: 'cy-1',
    created_at: at(0),
    ...o
});

/** แถว reconciliation_lines — ค่าจาก PostgREST มาเป็น string ("1.0000") จงใจใส่แบบนั้น */
const line = (book, counted) => ({
    sku_id: 'X-01',
    book_qty: `${book}.0000`,
    effective_book_qty: `${book}.0000`,
    counted_qty: `${counted}.0000`,
    variance_qty: `${counted - book}.0000`,
    match_status: counted === book ? 'match' : (counted > book ? 'over' : 'short')
});

// -----------------------------------------------------------------------------
// เคสจริงจากรอบสิงหาคม — ยอดรวม/ส่วนต่างต้องรายงานให้ครบ ไม่ตัดสินว่าแถวไหนผิด
// -----------------------------------------------------------------------------
test('[H11] BNP298 @ B1-01 = 51,1 · Book 1 → รายงานยอดรวมและส่วนต่างให้ครบ', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'r51', location: 'B1-01', counted_qty: 51, created_at: at(0) }),
        row({ id: 'r1', location: 'B1-01', counted_qty: 1, created_at: at(5) })
    ], line(1, 52));

    assert.equal(r.totalCounted, 52);
    assert.equal(r.effectiveBookQty, 1);
    assert.equal(r.variance, 51);
    assert.equal(r.overlapLocations.length, 1);
    assert.equal(r.overlapLocations[0].location, 'B1-01');
    assert.equal(r.overlapLocations[0].sameQty, false);

    assert.deepEqual(JSON.parse(JSON.stringify(r.overlapLocations[0].rows.map(x => x.id))), ['r51', 'r1']);
    assert.equal(r.overlapLocations[0].sum, 52);
    // นโยบาย: ห้ามเสนอให้ลบ — โมดูลต้องไม่มีช่องแนะนำการลบเหลืออยู่เลย
    assert.equal(r.fixHints, undefined, 'ห้ามมี fixHints — ระบบไม่แนะนำให้ลบข้อมูลนับ');
});

test('[H11] NB070 @ C1-01 = 42,1 · Book 42 → variance +1', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'C1-01', counted_qty: 42, created_at: at(0) }),
        row({ id: 'b', location: 'C1-01', counted_qty: 1, created_at: at(3000) })
    ], line(42, 43));
    assert.equal(r.totalCounted, 43);
    assert.equal(r.variance, 1);
});

// -----------------------------------------------------------------------------
// เคสจริงที่ "นับแยกถุง" ถูกต้อง — ต้องรายงานเฉย ๆ ห้ามชี้ว่าผิด
// -----------------------------------------------------------------------------
test('[H11] BNP20 @ B2-01 = 70,200 · Book 270 → นับแยก 2 ถุง ยอดตรงพอดี', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'B2-01', counted_qty: 70, created_at: at(0) }),
        row({ id: 'b', location: 'B2-01', counted_qty: 200, created_at: at(180) })
    ], line(270, 270));

    assert.equal(r.variance, 0);
    assert.equal(r.overlapLocations.length, 1, 'ยังต้องรายงานว่ามีหลายแถว (ให้คนดู)');
    assert.equal(r.overlapLocations[0].sum, 270);
});

test('[H11] BB002 @ B4-02 = 150,180,72,2 · Book 391 → นับแยก 4 ถุง รายงานยอดรวม', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'B4-02', counted_qty: 150, created_at: at(0) }),
        row({ id: 'b', location: 'B4-02', counted_qty: 180, created_at: at(60) }),
        row({ id: 'c', location: 'B4-02', counted_qty: 72, created_at: at(240) }),
        row({ id: 'd', location: 'B4-02', counted_qty: 2, created_at: at(540) })
    ], line(391, 404));

    assert.equal(r.totalCounted, 404);
    assert.equal(r.variance, 13);
    assert.equal(r.overlapLocations[0].rows.length, 4);
    assert.equal(r.overlapLocations[0].sum, 404, 'นับแยก 4 ถุง — รายงานยอดรวมให้คนดู ไม่ตัดสินแทน');
});

// -----------------------------------------------------------------------------
// เคสค่าเท่ากันเป๊ะ (H10 จัดการอยู่แล้ว) — โมดูลนี้แค่ทำเครื่องหมายว่า sameQty
// -----------------------------------------------------------------------------
test('[H11] PC700 @ G3-03 = 192,192 · Book 193 → ทำเครื่องหมาย sameQty ให้ H10 จัดการต่อ', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'G3-03', counted_qty: 192, created_at: at(0) }),
        row({ id: 'b', location: 'G3-03', counted_qty: 192, created_at: at(99000) })
    ], line(193, 384));

    assert.equal(r.overlapLocations[0].sameQty, true, 'ต้องบอกได้ว่าเป็นเคสค่าเท่ากันเป๊ะ (H10 จัดการต่อ)');
    assert.equal(r.totalCounted, 384);
});

// -----------------------------------------------------------------------------
// ขอบเขต / ความปลอดภัยของข้อมูล
// -----------------------------------------------------------------------------
test('[H11] ยังไม่ได้คำนวณ Match (ไม่มี recLine) → ห้ามเดายอด Book', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', counted_qty: 5 }),
        row({ id: 'b', counted_qty: 7 })
    ], null);

    assert.equal(r.hasMatchData, false);
    assert.equal(r.bookQty, null);
    assert.equal(r.effectiveBookQty, null);
    assert.equal(r.variance, null);
    assert.equal(r.totalCounted, 12, 'ยอดรวมยังคำนวณได้');
    assert.equal(r.overlapLocations.length, 1, 'ยังชี้ได้ว่าตำแหน่งนี้มีหลายแถว');
});

test('[H11] SKU อยู่หลายตำแหน่ง — รายงานเฉพาะตำแหน่งที่มีหลายแถว', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'A1-01', counted_qty: 5 }),
        row({ id: 'b', location: 'A1-01', counted_qty: 3 }),
        row({ id: 'c', location: 'Z9-09', counted_qty: 2 })
    ], line(8, 10));

    assert.equal(r.totalCounted, 10);
    assert.deepEqual(JSON.parse(JSON.stringify(r.overlapLocations.map(o => o.location))), ['A1-01']);
    assert.equal(r.overlapLocations[0].sum, 8, 'ยอดของตำแหน่งที่ทับซ้อนต้องแยกจากยอดรวมทั้ง SKU');
});

test('[H11] ตำแหน่งละแถวเดียวทั้งหมด → ไม่ทับซ้อน', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'A1-01', counted_qty: 5 }),
        row({ id: 'b', location: 'B2-02', counted_qty: 3 })
    ], line(8, 8));
    assert.equal(r.overlapLocations.length, 0);
});

test('[H11] ตำแหน่งเทียบแบบ normalize (เว้นวรรค/ตัวพิมพ์)', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'a1-01', counted_qty: 5 }),
        row({ id: 'b', location: ' A1-01 ', counted_qty: 3 })
    ], line(5, 8));
    assert.equal(r.overlapLocations.length, 1, 'ต้องมองเป็นตำแหน่งเดียวกัน');
});

test('[H11] แถวในตำแหน่งทับซ้อนเรียงเก่า→ใหม่ (เวลาเท่ากันใช้ id)', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'c', location: 'A1-01', counted_qty: 3, created_at: at(60) }),
        row({ id: 'a', location: 'A1-01', counted_qty: 1, created_at: at(0) }),
        row({ id: 'b', location: 'A1-01', counted_qty: 2, created_at: at(0) })
    ], null);
    assert.deepEqual(JSON.parse(JSON.stringify(r.overlapLocations[0].rows.map(x => x.id))), ['a', 'b', 'c']);
});

test('[H11] Match ที่คำนวณไว้ล้าสมัย (counted ใน recLine ไม่ตรงกับผลรวมจริง) → ต้องบอก', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'A1-01', counted_qty: 5 }),
        row({ id: 'b', location: 'A1-01', counted_qty: 3 })
    ], line(5, 99));   // recLine บอก counted 99 แต่ของจริงตอนนี้ 8

    assert.equal(r.staleMatch, true, 'ต้องเตือนว่าต้องกดคำนวณ Match ใหม่');
    assert.equal(r.totalCounted, 8);
});

test('[H11] effective_book ต่างจาก book (มีปรับยอด) → ใช้ effective เป็นตัวเทียบ', () => {
    const r = BI.computeSkuImpact([
        row({ id: 'a', location: 'A1-01', counted_qty: 10 }),
        row({ id: 'b', location: 'A1-01', counted_qty: 4 })
    ], { book_qty: '10.0000', effective_book_qty: '4.0000', counted_qty: '14.0000', variance_qty: '10.0000', match_status: 'over' });

    assert.equal(r.bookQty, 10);
    assert.equal(r.effectiveBookQty, 4);
    assert.equal(r.variance, 10, 'variance ต้องคิดจาก effective');
});

// =============================================================================
// "ตรวจแล้ว ยืนยันว่าปกติ" — นับแยกถุงเป็นเรื่องปกติ ระบบต้องเตือนครั้งเดียวแล้วเงียบ
// แต่ถ้าข้อมูลเปลี่ยนหลังยืนยัน ต้องกลับมาเตือนใหม่ ไม่งั้นของใหม่จะแอบผ่าน
// =============================================================================
suite('audit-book-impact: การยืนยันว่าปกติ');

const accept = (rowCount, totalQty, o = {}) => ({
    row_count: rowCount,
    total_qty: `${totalQty}.0000`,
    accepted_by: 'แบม (audit_check)',
    accepted_at: '2026-08-10T02:00:00.000Z',
    note: '',
    ...o
});

test('[ACK] ยังไม่เคยยืนยัน → none', () => {
    assert.equal(BI.classifyAcceptance({ rowCount: 2, totalQty: 270 }, null).state, 'none');
});

test('[ACK] ยืนยันแล้วและข้อมูลเหมือนเดิม → accepted (ต้องเงียบ)', () => {
    const c = BI.classifyAcceptance({ rowCount: 2, totalQty: 270 }, accept(2, 270));
    assert.equal(c.state, 'accepted');
    assert.equal(c.acceptedBy, 'แบม (audit_check)');
    assert.ok(c.acceptedAt);
});

test('[ACK] ยืนยันแล้วแต่มีแถวเพิ่มทีหลัง → stale (กลับมาเตือน)', () => {
    const c = BI.classifyAcceptance({ rowCount: 3, totalQty: 300 }, accept(2, 270));
    assert.equal(c.state, 'stale');
    assert.equal(c.wasRowCount, 2, 'ต้องบอกได้ว่าตอนยืนยันเป็นยังไง');
    assert.equal(c.wasTotalQty, 270);
});

test('[ACK] จำนวนแถวเท่าเดิมแต่ยอดเปลี่ยน (มีคนแก้จำนวน) → stale', () => {
    assert.equal(BI.classifyAcceptance({ rowCount: 2, totalQty: 271 }, accept(2, 270)).state, 'stale');
});

test('[ACK] ค่าจาก PostgREST เป็น string ("270.0000") ต้องเทียบได้', () => {
    assert.equal(BI.classifyAcceptance({ rowCount: 2, totalQty: 270 }, accept(2, 270)).state, 'accepted');
});

test('[ACK] guard ปุ่มลบต้องเทียบ shape ของทั้งตำแหน่ง — เคส [5,5,9] ที่ยืนยันแล้ว', () => {
    // จาก review: ตำแหน่งมีแถว [5,5,9] (นับแยกถุง + มีคู่ค่าเท่ากัน) ผู้ใช้ยืนยัน → เก็บ (3, 19)
    // guard เดิมคำนวณจากกลุ่มจำนวนเท่ากัน (2, 10) → stale ผิด ๆ → แถวที่ยืนยันแล้วถูกลบ
    const AD = loadFresh('Js/audit-dedupe.js').AuditDedupe;
    const mk = (id, qty) => ({ id, warehouse: 'ตึกกันตนา', sku_id: 'X-01', location: 'A1-01', counted_qty: qty, counter_name: 'ADMIN', cycle_id: 'cy-1', created_at: at(0) });
    const rows = [mk('a', 5), mk('b', 5), mk('c', 9)];

    const shape = AD.buildLocationShapes(rows).get(AD.locationShapeKey(rows[0]));
    assert.equal(BI.classifyAcceptance({ rowCount: shape.rowCount, totalQty: shape.totalQty }, accept(3, 19)).state,
        'accepted', 'shape ทั้งตำแหน่ง (3,19) ต้องยัง accepted → ปุ่มลบข้ามกลุ่มนี้');

    // วิธีคำนวณแบบเก่า (เฉพาะกลุ่มจำนวนเท่ากัน) ต้องให้ผลต่าง — คือบั๊กที่ห้ามกลับมา
    assert.equal(BI.classifyAcceptance({ rowCount: 2, totalQty: 10 }, accept(3, 19)).state, 'stale');
});

test('[H11] แถวว่าง/ไม่มีข้อมูล → ไม่พัง', () => {
    assert.equal(BI.computeSkuImpact([], null).totalCounted, 0);
    assert.equal(BI.computeSkuImpact(null, null).overlapLocations.length, 0);
    assert.equal(BI.computeSkuImpact([row()], line(1, 1)).overlapLocations.length, 0);
});
