// เทสคุ้มกัน H2 (docs/ISSUES.md) — นิยาม "แถวซ้ำ" ต้องไม่ลบข้อมูลนับที่ถูกต้อง
// อ้างอิงนโยบายใน docs/sql/011: แถวที่ค่าเหมือนกันเป็นข้อมูลถูกต้อง ถ้ามาจากการนับจริง
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('audit-dedupe: นิยามแถวซ้ำ (H2)');

const AD = loadFresh('Js/audit-dedupe.js').AuditDedupe;

const T0 = Date.parse('2026-08-09T03:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();

/** แถวมาตรฐาน — override ได้ */
const row = (o = {}) => ({
    id: o.id ?? Math.random().toString(36).slice(2),
    warehouse: 'ตึกกันตนา',
    sku_id: 'A-01',
    location: 'J5-01',
    counted_qty: 10,
    counter_name: 'สมชาย',
    cycle_id: 'cy-1',
    created_at: at(0),
    ...o
});

test('กดบันทึกซ้ำ (ทุกอย่างเหมือนกัน ห่าง 5 วินาที) → ลบตัวใหม่ เก็บตัวเก่า', () => {
    const a = row({ id: 'keep', created_at: at(0) });
    const b = row({ id: 'dup', created_at: at(5) });
    const r = AD.findAccidentalDuplicates([a, b]);
    assert.equal(r.toDelete.length, 1);
    assert.equal(r.toDelete[0].id, 'dup', 'ต้องลบแถวที่ใหม่กว่า');
    assert.equal(r.groups[0].keep.id, 'keep');
});

// -----------------------------------------------------------------------------
// 3 เคสที่ migration 011 ระบุว่า "เป็นข้อมูลถูกต้อง" — ห้ามลบเด็ดขาด
// -----------------------------------------------------------------------------
test('[H2-guard] คนละรอบนับ (cycle_id ต่างกัน) → ห้ามลบ', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'r1', cycle_id: 'cy-1', created_at: at(0) }),
        row({ id: 'r2', cycle_id: 'cy-2', created_at: at(3) })
    ]);
    assert.equal(r.toDelete.length, 0, 'รอบต่างกันต้องไม่ถูกลบ');
    assert.equal(r.keptSeparate.length, 1);
    assert.ok(r.keptSeparate[0].reasons.includes('คนละรอบนับ'));
});

test('[H2-guard] คนละผู้นับ (สองคนยืนยันได้เท่ากัน) → ห้ามลบ', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'r1', counter_name: 'สมชาย', created_at: at(0) }),
        row({ id: 'r2', counter_name: 'สมหญิง', created_at: at(3) })
    ]);
    assert.equal(r.toDelete.length, 0, 'ผู้นับต่างคนต้องไม่ถูกลบ');
    assert.ok(r.keptSeparate[0].reasons.includes('คนละผู้นับ'));
});

test('[H2-guard] นับซ้ำเพื่อยืนยัน (คนเดิม รอบเดิม แต่ห่าง 2 ชั่วโมง) → ห้ามลบ', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'r1', created_at: at(0) }),
        row({ id: 'r2', created_at: at(7200) })
    ]);
    assert.equal(r.toDelete.length, 0, 'เวลาห่างเกินช่วงกดซ้ำต้องไม่ถูกลบ');
});

test('[H2-guard] แถวที่ไม่มี created_at → ไม่กล้าลบ', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'r1', created_at: at(0) }),
        row({ id: 'r2', created_at: null })
    ]);
    assert.equal(r.toDelete.length, 0);
});

test('ค่าต่างกัน (qty/location/warehouse) → ไม่ใช่กลุ่มเดียวกัน', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'r1', counted_qty: 10 }),
        row({ id: 'r2', counted_qty: 11 }),
        row({ id: 'r3', location: 'K1-02' }),
        row({ id: 'r4', warehouse: 'คลังอะไหล่' })
    ]);
    assert.equal(r.toDelete.length, 0);
});

test('ปรับ windowMinutes ได้ — แคบลงแล้วลบน้อยลง', () => {
    const rows = [row({ id: 'a', created_at: at(0) }), row({ id: 'b', created_at: at(120) })]; // ห่าง 2 นาที
    assert.equal(AD.findAccidentalDuplicates(rows).toDelete.length, 1, 'window 10 นาที → ลบ');
    assert.equal(AD.findAccidentalDuplicates(rows, { windowMinutes: 1 }).toDelete.length, 0, 'window 1 นาที → ไม่ลบ');
    assert.equal(AD.findAccidentalDuplicates(rows, { windowMinutes: 0 }).toDelete.length, 0, 'window 0 → ไม่ลบอะไรเลย');
});

test('ขอบเขต window: 10 นาทีพอดี = ลบ · เกินไป 1 วินาที = ไม่ลบ', () => {
    const exact = AD.findAccidentalDuplicates([row({ id: 'a', created_at: at(0) }), row({ id: 'b', created_at: at(600) })]);
    assert.equal(exact.toDelete.length, 1);
    const over = AD.findAccidentalDuplicates([row({ id: 'a', created_at: at(0) }), row({ id: 'b', created_at: at(601) })]);
    assert.equal(over.toDelete.length, 0);
});

test('ชุดข้อมูลผสม: ลบเฉพาะที่ควรลบ นับสถิติถูกต้อง', () => {
    const rows = [
        row({ id: 'dup-keep', created_at: at(0) }),
        row({ id: 'dup-del', created_at: at(4) }),                        // กดซ้ำ → ลบ
        row({ id: 'other-cycle', cycle_id: 'cy-2', created_at: at(6) }),  // คนละรอบ → เก็บ
        row({ id: 'other-counter', counter_name: 'สมหญิง', created_at: at(8) }), // คนละคน → เก็บ
        row({ id: 'unique', sku_id: 'B-99', created_at: at(10) })         // ไม่ซ้ำ
    ];
    const r = AD.findAccidentalDuplicates(rows);
    // เทียบผ่าน JSON — array มาจาก VM sandbox (prototype คนละตัวกับฝั่งเทส)
    assert.deepEqual(JSON.parse(JSON.stringify(r.toDelete.map(x => x.id))), ['dup-del']);
    assert.equal(r.stats.scanned, 5);
    assert.equal(r.stats.deleteCount, 1);
    // เหลือ 3 แถวที่ค่าเหมือนกัน (dup-keep, other-cycle, other-counter) = ส่วนเกิน 2 แถว
    assert.equal(r.stats.keptGroupCount, 1);
    assert.equal(r.stats.keptRowCount, 2, 'นับเฉพาะแถวส่วนเกินที่กันไว้ไม่ลบ');
});

suite('audit-dedupe: การจัดประเภทตอน verify');

test('classifyRefDuplicate: คนละรอบ = ไม่ใช่ปัญหา', () => {
    const c = AD.classifyRefDuplicate([row({ cycle_id: 'cy-1' }), row({ cycle_id: 'cy-2' })]);
    assert.equal(c.suspicious, false);
    assert.equal(c.reason, 'นับคนละรอบ');
});

test('classifyRefDuplicate: คนละผู้นับ = ไม่ใช่ปัญหา', () => {
    const c = AD.classifyRefDuplicate([row({ counter_name: 'A' }), row({ counter_name: 'B' })]);
    assert.equal(c.suspicious, false);
});

test('classifyRefDuplicate: กดซ้ำเวลาใกล้กัน = น่าสงสัย', () => {
    const c = AD.classifyRefDuplicate([row({ created_at: at(0) }), row({ created_at: at(3) })]);
    assert.equal(c.suspicious, true);
});

test('classifyRefDuplicate: แถวเดียว = ไม่ใช่ปัญหา', () => {
    assert.equal(AD.classifyRefDuplicate([row()]).suspicious, false);
    assert.equal(AD.classifyRefDuplicate([]).suspicious, false);
});

suite('audit-dedupe: เคสที่ code-review จับได้ (H2 รอบสอง)');

// -----------------------------------------------------------------------------
// Postgres now() = เวลาเริ่ม transaction → insert หลายแถวครั้งเดียว (group submit /
// นำเข้า Excel) ได้ created_at ตรงกันเป๊ะ = คนละบรรทัดในชุดเดียวกัน ไม่ใช่กดซ้ำ
// (พบจากข้อมูลจริง: 2 แถว created_at ตรงกันถึงไมโครวินาที แต่ client_request_id ต่างกัน)
// -----------------------------------------------------------------------------
test('[H2-guard] created_at ตรงกันเป๊ะ (insert ชุดเดียวกัน) → ห้ามลบ', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'g1', created_at: at(0), client_request_id: 'req-1' }),
        row({ id: 'g2', created_at: at(0), client_request_id: 'req-2' })
    ]);
    assert.equal(r.toDelete.length, 0, 'แถวจาก insert ชุดเดียวกันต้องไม่ถูกลบ');
    assert.ok(r.keptSeparate[0].reasons.includes('บันทึกมาในชุดเดียวกัน'));
});

test('[H2-guard] มาจากไฟล์นำเข้าเดียวกัน (import_batch_id ตรงกัน) → ห้ามลบ', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'i1', created_at: at(0), import_batch_id: 'batch-A' }),
        row({ id: 'i2', created_at: at(3), import_batch_id: 'batch-A' })
    ]);
    assert.equal(r.toDelete.length, 0, 'คนละบรรทัดในไฟล์เดียวกันต้องไม่ถูกลบ');
});

test('นำเข้าไฟล์เดิมซ้ำ 2 ครั้ง (batch ต่างกัน เวลาใกล้กัน) → ยังจับได้', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'i1', created_at: at(0), import_batch_id: 'batch-A' }),
        row({ id: 'i2', created_at: at(30), import_batch_id: 'batch-B' })
    ]);
    assert.equal(r.toDelete.length, 1);
    assert.equal(r.toDelete[0].id, 'i2');
});

test('กดบันทึกซ้ำจริง (คนละ request → เวลาต่างกันเล็กน้อย) → ยังลบได้', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'k', created_at: at(0) }),
        row({ id: 'd', created_at: at(2) })   // ต่างกัน 2 วินาที = คนละ transaction
    ]);
    assert.equal(r.toDelete.length, 1);
    assert.equal(r.toDelete[0].id, 'd');
});

test('[H2-guard] id ซ้ำในชุดข้อมูล → ต้องไม่ลบตัวที่เก็บไว้', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'same', created_at: at(0) }),
        row({ id: 'same', created_at: at(5) })
    ]);
    const keepIds = new Set(r.groups.map(g => String(g.keep.id)));
    assert.ok(!r.toDelete.some(x => keepIds.has(String(x.id))), 'toDelete ต้องไม่มี id เดียวกับแถวที่เก็บ');
});

test('tie-break: เวลาเท่ากันและไม่มีเวลา → เรียงด้วย id เสมอ (deterministic)', () => {
    const a = AD.findAccidentalDuplicates([row({ id: 'zz', created_at: null }), row({ id: 'aa', created_at: null })]);
    const b = AD.findAccidentalDuplicates([row({ id: 'aa', created_at: null }), row({ id: 'zz', created_at: null })]);
    assert.equal(a.toDelete.length, 0);
    assert.equal(b.toDelete.length, 0);
});

test('keptRowCount นับเฉพาะแถวส่วนเกิน ไม่นับแถวแรกของกลุ่ม', () => {
    // 2 แถวคนละผู้นับ → ส่วนเกิน 1 แถว (ไม่ใช่ 2)
    const r = AD.findAccidentalDuplicates([
        row({ id: 'a', counter_name: 'สมชาย' }),
        row({ id: 'b', counter_name: 'สมหญิง' })
    ]);
    assert.equal(r.stats.keptGroupCount, 1);
    assert.equal(r.stats.keptRowCount, 1, 'ต้องนับส่วนเกิน 1 แถว ไม่ใช่ 2');
});
