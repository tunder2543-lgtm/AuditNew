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

// =============================================================================
// H10 — "ซ้ำแล้วบวกซ้ำในรอบเดียวกัน" (คนละคำถามกับ "ลบอัตโนมัติได้ไหม")
//
// refresh_reconciliation_for_cycle ใช้ SUM(counted_qty) ต่อ SKU ต่อรอบ
// → แถวที่ (รอบ + คลัง + SKU + ตำแหน่ง + จำนวน) เหมือนกันหมด จะถูกบวกซ้ำใน Match
//   ไม่ว่าใครนับ หรือห่างกันกี่ชั่วโมง → ต้องเตือนเสมอ (แต่ยังห้ามลบอัตโนมัติ)
//
// เคสจริงที่ทำให้เจอ: PC700 @ G3-03 = 192 นับโดย "แบม" และ "TOK" ในรอบเดียวกัน
// → reconciliation_lines: book 193 · counted 384 · variance +191 · over (ยอดหลอก)
// =============================================================================
suite('audit-dedupe: แถวที่บวกซ้ำในรอบเดียวกัน (H10)');

test('[H10] คนละผู้นับ ห่างกันข้ามวัน แต่รอบเดียวกัน → ต้องเตือนว่าซ้ำ', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'old', counter_name: 'แบม', created_at: at(0) }),
        row({ id: 'new', counter_name: 'TOK', created_at: at(99000) })
    ]);
    assert.equal(c.duplicate, true, 'คนละผู้นับก็ยังบวกซ้ำใน Match อยู่ดี');
    assert.equal(c.extraCount, 1, 'ต้องนับ "แถวเกิน" = 1 ไม่ใช่ 2');
    assert.deepEqual(JSON.parse(JSON.stringify(c.dupIds)), ['new'], 'แถวเกินคือแถวที่ใหม่กว่า');
    assert.deepEqual(JSON.parse(JSON.stringify(c.keepIds)), ['old']);
});

test('[H10] เคสนี้ต้องยังห้ามลบอัตโนมัติ (กติกา H2 ไม่เปลี่ยน)', () => {
    const r = AD.findAccidentalDuplicates([
        row({ id: 'old', counter_name: 'แบม', created_at: at(0) }),
        row({ id: 'new', counter_name: 'TOK', created_at: at(99000) })
    ]);
    assert.equal(r.toDelete.length, 0, 'เตือนได้ แต่ห้ามลบให้เอง');
});

test('[H10] insert ชุดเดียวกัน (created_at ตรงกันเป๊ะ ผู้นับคนเดียว) → ก็ยังซ้ำ', () => {
    // เคสจริง: SP133 @ ชั้นสีน้ำเงิน = 1 สองแถว เวลาตรงกันถึงไมโครวินาที
    const c = AD.classifyCycleDuplicate([
        row({ id: 'a', created_at: at(0) }),
        row({ id: 'b', created_at: at(0) })
    ]);
    assert.equal(c.duplicate, true);
    assert.equal(c.extraCount, 1);
});

test('[H10] คนละรอบนับ → ไม่ซ้ำ (Match แยกรอบกัน ไม่บวกข้ามรอบ)', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'a', cycle_id: 'cy-1' }),
        row({ id: 'b', cycle_id: 'cy-2' })
    ]);
    assert.equal(c.duplicate, false);
    assert.equal(c.extraCount, 0);
});

test('[H10] 3 แถวในรอบเดียวกัน → แถวเกิน 2', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'a', created_at: at(0) }),
        row({ id: 'b', created_at: at(10) }),
        row({ id: 'c', created_at: at(20) })
    ]);
    assert.equal(c.extraCount, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(c.dupIds)), ['b', 'c']);
});

test('[H10] ผสมรอบ: รอบ A ซ้ำ 2 แถว + รอบ B 1 แถว → เกินแค่ 1', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'a1', cycle_id: 'cy-1', created_at: at(0) }),
        row({ id: 'a2', cycle_id: 'cy-1', created_at: at(30) }),
        row({ id: 'b1', cycle_id: 'cy-2', created_at: at(60) })
    ]);
    assert.equal(c.duplicate, true);
    assert.equal(c.extraCount, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(c.dupIds)), ['a2']);
});

test('[H10] แถวที่ยังไม่ผูกรอบ (cycle_id = null) นับเป็นกลุ่มเดียวกัน', () => {
    // ยังไม่เข้า Match แต่ถ้าเอาไปผูกรอบทีหลังจะบวกซ้ำทันที
    const c = AD.classifyCycleDuplicate([
        row({ id: 'a', cycle_id: null, created_at: at(0) }),
        row({ id: 'b', cycle_id: null, created_at: at(5) })
    ]);
    assert.equal(c.duplicate, true);
    assert.equal(c.extraCount, 1);
});

test('[H10] แถวเดียว / ว่าง → ไม่ซ้ำ', () => {
    assert.equal(AD.classifyCycleDuplicate([row()]).duplicate, false);
    assert.equal(AD.classifyCycleDuplicate([]).duplicate, false);
    assert.equal(AD.classifyCycleDuplicate(null).duplicate, false);
});

test('[H10] คืนรายชื่อผู้นับทั้งหมด ไว้แสดงในหมายเหตุ (เดิมโชว์ชื่อเดียว)', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'a', counter_name: 'แบม', created_at: at(0) }),
        row({ id: 'b', counter_name: 'TOK', created_at: at(5) })
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(c.counters)), ['แบม', 'TOK']);
    assert.ok(c.reason.includes('แบม') && c.reason.includes('TOK'), `reason ต้องบอกชื่อผู้นับ: ${c.reason}`);
});

test('[H10] บอกได้ว่าซ้ำกับแถวไหน (siblings) — ผู้ใช้ต้องตามไปตรวจตัวจริงได้', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'old', counter_name: 'แบม', created_at: at(0) }),
        row({ id: 'new', counter_name: 'TOK', created_at: at(5) })
    ]);
    const s = JSON.parse(JSON.stringify(c.siblings));
    assert.deepEqual(Object.keys(s).sort(), ['new', 'old'], 'ต้องมีข้อมูลของทั้งสองฝั่ง');
    assert.equal(s['new'].length, 1);
    assert.equal(s['new'][0].id, 'old');
    assert.equal(s['new'][0].counter_name, 'แบม', 'ต้องบอกชื่อผู้นับของแถวคู่');
    assert.ok(s['new'][0].created_at, 'ต้องบอกเวลาของแถวคู่');
    assert.equal(s['old'][0].id, 'new');
});

test('[H10] siblings 3 แถว: แต่ละแถวเห็นอีก 2 แถว เรียงเก่า→ใหม่', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'b', created_at: at(10) }),
        row({ id: 'c', created_at: at(20) }),
        row({ id: 'a', created_at: at(0) })
    ]);
    const s = JSON.parse(JSON.stringify(c.siblings));
    assert.deepEqual(s['b'].map(x => x.id), ['a', 'c']);
    assert.deepEqual(s['a'].map(x => x.id), ['b', 'c']);
});

test('[H10] siblings ไม่ข้ามรอบ — แถวรอบอื่นต้องไม่ถูกอ้างว่าซ้ำ', () => {
    const c = AD.classifyCycleDuplicate([
        row({ id: 'a1', cycle_id: 'cy-1', created_at: at(0) }),
        row({ id: 'a2', cycle_id: 'cy-1', created_at: at(30) }),
        row({ id: 'b1', cycle_id: 'cy-2', created_at: at(60) })
    ]);
    const s = JSON.parse(JSON.stringify(c.siblings));
    assert.deepEqual(s['a2'].map(x => x.id), ['a1']);
    assert.equal(s['b1'], undefined, 'แถวที่ไม่ซ้ำต้องไม่มีใน siblings');
});

// =============================================================================
// H12 — เกณฑ์ของปุ่ม "ลบแถวที่กดบันทึกซ้ำ" (admin ตัดสินใจ 2026-08-10)
//
// เดิมใช้กฎเข้มของ H2 (ต้องผู้นับคนเดียวกัน + ห่างไม่เกิน 10 นาที) → PC700 ไม่เคยถูกเลือก
// admin สั่งว่า: แถวที่ รอบ+คลัง+SKU+ตำแหน่ง+จำนวน เหมือนกันหมด = ซ้ำ ให้เลือกลบได้
// (เก็บแถวเก่าสุดไว้เสมอ · ยืนยัน 2 ขั้น · สำรอง CSV · เขียน log ก่อนลบ)
//
// ต่างจาก "นับแยกถุง" (จำนวนต่างกัน) ซึ่ง **ห้ามแตะเด็ดขาด** — ไม่เข้าเกณฑ์นี้อยู่แล้ว
// =============================================================================
suite('audit-dedupe: เกณฑ์ปุ่มลบแถวซ้ำ (H12)');

test('[H12] PC700 คนละผู้นับ ข้ามวัน รอบเดียวกัน → ต้องถูกเลือกลบ (เก็บแถวเก่าสุด)', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'old', counter_name: 'แบม', created_at: at(0) }),
        row({ id: 'new', counter_name: 'TOK', created_at: at(99000) })
    ]);
    assert.equal(r.toDelete.length, 1);
    assert.equal(r.toDelete[0].id, 'new');
    assert.equal(r.groups[0].keep.id, 'old');
    assert.equal(r.stats.deleteCount, 1);
    assert.equal(r.stats.groupCount, 1);
});

test('[H12] SP133 ผู้นับคนเดียว เวลาตรงกันเป๊ะ (insert ชุดเดียวกัน) → ถูกเลือกลบ', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'a', created_at: at(0) }),
        row({ id: 'b', created_at: at(0) })
    ]);
    assert.equal(r.toDelete.length, 1, 'เวลาตรงกันเป๊ะก็ยังถือว่าซ้ำ');
});

test('[H12] นับแยกถุง (จำนวนต่างกัน) → ห้ามแตะเด็ดขาด', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'bag1', counted_qty: 70, created_at: at(0) }),
        row({ id: 'bag2', counted_qty: 200, created_at: at(180) })
    ]);
    assert.equal(r.toDelete.length, 0, 'จำนวนต่างกัน = ผลนับจริง ห้ามลบ');
    assert.equal(r.groups.length, 0);
});

test('[H12] คนละรอบนับ → ห้ามลบ (Match แยกรอบกัน)', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'a', cycle_id: 'cy-1' }),
        row({ id: 'b', cycle_id: 'cy-2' })
    ]);
    assert.equal(r.toDelete.length, 0);
});

test('[H12] คนละคลัง / คนละตำแหน่ง → ห้ามลบ', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'a' }),
        row({ id: 'b', warehouse: 'คลังอะไหล่' }),
        row({ id: 'c', location: 'K9-09' })
    ]);
    assert.equal(r.toDelete.length, 0);
});

test('[H12] 3 แถวเหมือนกัน → ลบ 2 เก็บแถวเก่าสุด', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'b', created_at: at(10) }),
        row({ id: 'c', created_at: at(20) }),
        row({ id: 'a', created_at: at(0) })
    ]);
    assert.equal(r.groups[0].keep.id, 'a');
    assert.deepEqual(JSON.parse(JSON.stringify(r.toDelete.map(x => x.id))), ['b', 'c']);
});

test('[H12] เวลาเท่ากันทั้งกลุ่ม → ตัดสินด้วย id เสมอ (ผลเดิมทุกครั้งที่กด)', () => {
    const a = AD.findSameCycleDuplicates([row({ id: 'zz', created_at: at(0) }), row({ id: 'aa', created_at: at(0) })]);
    const b = AD.findSameCycleDuplicates([row({ id: 'aa', created_at: at(0) }), row({ id: 'zz', created_at: at(0) })]);
    assert.equal(a.groups[0].keep.id, 'aa');
    assert.equal(b.groups[0].keep.id, 'aa');
    assert.deepEqual(JSON.parse(JSON.stringify(a.toDelete.map(x => x.id))), ['zz']);
});

test('[H12] แถวที่ยังไม่ผูกรอบ (null) นับเป็นรอบเดียวกัน', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'a', cycle_id: null, created_at: at(0) }),
        row({ id: 'b', cycle_id: null, created_at: at(5) })
    ]);
    assert.equal(r.toDelete.length, 1);
});

test('[H12] id ซ้ำในชุดข้อมูล → ต้องไม่ลบแถวที่เก็บไว้', () => {
    const r = AD.findSameCycleDuplicates([
        row({ id: 'same', created_at: at(0) }),
        row({ id: 'same', created_at: at(5) })
    ]);
    const keepIds = new Set(r.groups.map(g => String(g.keep.id)));
    assert.ok(!r.toDelete.some(x => keepIds.has(String(x.id))));
});

test('[H12] ข้อมูลว่าง → ไม่พัง', () => {
    assert.equal(AD.findSameCycleDuplicates([]).toDelete.length, 0);
    assert.equal(AD.findSameCycleDuplicates(null).stats.scanned, 0);
});

// -----------------------------------------------------------------------------
// buildLocationShapes — shape ของ "ทั้งตำแหน่ง" ไว้เทียบกับ inventory_count_acceptances
// (จาก review: guard ปุ่มลบเคยเทียบเฉพาะกลุ่มจำนวนเท่ากัน → acceptance กลาย stale ผิด ๆ
//  แล้วแถวที่คนยืนยันว่าปกติแล้วถูกลบ — ขัด invariant "คำยืนยันของคนชนะกฎของระบบ")
// -----------------------------------------------------------------------------
test('[H12] buildLocationShapes: [5,5,9] ตำแหน่งเดียว → shape (3 แถว, 19 ชิ้น) ไม่ใช่ (2, 10)', () => {
    const rows = [
        row({ id: 'a', counted_qty: 5, created_at: at(0) }),
        row({ id: 'b', counted_qty: 5, created_at: at(10) }),
        row({ id: 'c', counted_qty: 9, created_at: at(20) })
    ];
    const shape = AD.buildLocationShapes(rows).get(AD.locationShapeKey(rows[0]));
    assert.equal(shape.rowCount, 3, 'ต้องนับทุกแถวในตำแหน่ง ไม่ใช่เฉพาะจำนวนเท่ากัน');
    assert.equal(shape.totalQty, 19);
});

test('[H12] buildLocationShapes: แยกตามรอบ/ตำแหน่ง และ normalize ตัวพิมพ์-เว้นวรรค', () => {
    const shapes = AD.buildLocationShapes([
        row({ id: 'a', location: 'a1-01', counted_qty: 5 }),
        row({ id: 'b', location: ' A1-01 ', counted_qty: 3 }),
        row({ id: 'c', location: 'A1-01', counted_qty: 7, cycle_id: 'cy-2' }),
        row({ id: 'd', location: 'B2-02', counted_qty: 1 })
    ]);
    assert.equal(shapes.get('cy-1|A-01|A1-01').rowCount, 2, 'ตัวพิมพ์/เว้นวรรคต่างกัน = ตำแหน่งเดียวกัน');
    assert.equal(shapes.get('cy-1|A-01|A1-01').totalQty, 8);
    assert.equal(shapes.get('cy-2|A-01|A1-01').totalQty, 7, 'คนละรอบต้องแยก shape');
    assert.equal(shapes.get('cy-1|A-01|B2-02').rowCount, 1);
});

test('[H12] buildLocationShapes: แถวไม่ผูกรอบ (null) ใช้คีย์ (no-cycle) ตรงกับ acceptanceKey', () => {
    const rows = [row({ id: 'a', cycle_id: null, counted_qty: 2 }), row({ id: 'b', cycle_id: null, counted_qty: 3 })];
    const key = AD.locationShapeKey(rows[0]);
    assert.ok(key.startsWith('(no-cycle)|'), `คีย์ต้องขึ้นต้น (no-cycle): ${key}`);
    assert.equal(AD.buildLocationShapes(rows).get(key).totalQty, 5);
    assert.equal(AD.buildLocationShapes(null).size, 0, 'ข้อมูลว่างไม่พัง');
});

// =============================================================================
// M26 — ปลายทางของการย้ายตำแหน่ง/สลับ SKU
//
// เดิม audit_check บล็อกทุกครั้งที่ปลายทางมีแถว sku+loc+warehouse+qty เหมือนกัน
// ซึ่งขัด invariant 3 (คนละรอบ/คนละผู้นับ = ข้อมูลถูกต้อง) → ย้ายไม่ได้ทั้งที่ควรได้
// กติกาใหม่: บล็อกเฉพาะเมื่อจะกลายเป็น "ซ้ำในรอบเดียวกัน" (เคส H10 ที่ทำให้ Match บวกเกิน)
// =============================================================================
suite('audit-dedupe: ชนปลายทางตอนย้ายตำแหน่ง (M26)');

test('[M26] ปลายทางว่าง → ผ่าน', () => {
    const c = AD.classifyDestinationCollision({ destRows: [], movingCycleId: 'cy-1' });
    assert.equal(c.blocked, false);
    assert.equal(c.warning, '');
});

test('[M26] ปลายทางมีแถวรอบเดียวกัน → บล็อก (จะกลายเป็นซ้ำที่ทำให้ Match บวกเกิน)', () => {
    const c = AD.classifyDestinationCollision({
        destRows: [row({ id: 'x', cycle_id: 'cy-1' })],
        movingCycleId: 'cy-1'
    });
    assert.equal(c.blocked, true);
    assert.ok(c.message.includes('รอบ'), `ข้อความต้องบอกเหตุผล: ${c.message}`);
});

test('[M26] ปลายทางมีแต่แถวคนละรอบ → ผ่าน แต่ต้องเตือน', () => {
    const c = AD.classifyDestinationCollision({
        destRows: [row({ id: 'x', cycle_id: 'cy-2' }), row({ id: 'y', cycle_id: 'cy-3' })],
        movingCycleId: 'cy-1'
    });
    assert.equal(c.blocked, false, 'คนละรอบเป็นข้อมูลถูกต้องตาม migration 011');
    assert.ok(c.warning.includes('2'), `ต้องบอกว่ามีกี่แถว: ${c.warning}`);
});

test('[M26] ปลายทางมีทั้งรอบเดียวกันและคนละรอบ → บล็อก (ยึดตัวที่อันตราย)', () => {
    const c = AD.classifyDestinationCollision({
        destRows: [row({ id: 'x', cycle_id: 'cy-2' }), row({ id: 'y', cycle_id: 'cy-1' })],
        movingCycleId: 'cy-1'
    });
    assert.equal(c.blocked, true);
});

test('[M26] แถวที่ยังไม่ผูกรอบ (null) นับเป็นรอบเดียวกัน', () => {
    const same = AD.classifyDestinationCollision({
        destRows: [row({ id: 'x', cycle_id: null })],
        movingCycleId: null
    });
    assert.equal(same.blocked, true, 'null + null = กลุ่มเดียวกัน');

    const diff = AD.classifyDestinationCollision({
        destRows: [row({ id: 'x', cycle_id: null })],
        movingCycleId: 'cy-1'
    });
    assert.equal(diff.blocked, false, 'แถวไม่มีรอบ ไม่ชนกับแถวที่มีรอบ');
});

test('[M26] destRows ว่าง/null → ไม่พัง', () => {
    assert.equal(AD.classifyDestinationCollision({}).blocked, false);
    assert.equal(AD.classifyDestinationCollision(null).blocked, false);
});

test('[H10] เรียงเสถียร: เวลาเท่ากันใช้ id ตัดสินว่าใครคือแถวหลัก', () => {
    const a = AD.classifyCycleDuplicate([row({ id: 'zz', created_at: at(0) }), row({ id: 'aa', created_at: at(0) })]);
    const b = AD.classifyCycleDuplicate([row({ id: 'aa', created_at: at(0) }), row({ id: 'zz', created_at: at(0) })]);
    assert.deepEqual(JSON.parse(JSON.stringify(a.keepIds)), ['aa']);
    assert.deepEqual(JSON.parse(JSON.stringify(b.keepIds)), ['aa']);
});
