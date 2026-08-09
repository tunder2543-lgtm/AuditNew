// เทส helper ของ dashboard — รวม knownIssue H7 (avgPerMin สูงเกินจริง)
import assert from 'node:assert/strict';
import { suite, test, knownIssue } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('dashboard-shared: bucket/สถิติความเร็วส่งงาน');

const sb = loadFresh('Js/dashboard-shared.js');
const DS = sb.dashboardShared;

// สร้างแถว submission ณ เวลา (นาทีที่ n จาก epoch อ้างอิง)
const BASE = Date.parse('2026-08-01T03:00:00.000Z');
const rowAtMin = (m) => ({ created_at: new Date(BASE + m * 60_000).toISOString() });

test('bucketSubmissionsByInterval: แบ่งถูก bucket + นับถูก', () => {
    const rows = [rowAtMin(0), rowAtMin(1), rowAtMin(2), rowAtMin(11)];
    const buckets = DS.bucketSubmissionsByInterval(rows, 10);
    assert.equal(buckets.length, 2, 'ต้องได้ 2 bucket (นาที 0-9 กับ 10-19)');
    assert.equal(buckets[0].count, 3);
    assert.equal(buckets[1].count, 1);
});

test('bucketSubmissionsByInterval: แถว created_at เสียถูกข้าม ไม่พัง', () => {
    const buckets = DS.bucketSubmissionsByInterval([{ created_at: 'not-a-date' }, rowAtMin(0)], 10);
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].count, 1);
});

test('computeSubmissionRateStats: ไม่มีข้อมูล → ศูนย์ทุกช่อง ไม่ NaN', () => {
    const s = DS.computeSubmissionRateStats([], 10);
    assert.equal(s.avgPerMin, 0);
    assert.equal(s.peakPerMin, 0);
    assert.equal(s.totalRecords, 0);
});

test('MATCH_STATUS_LABELS: ครบ 5 สถานะตรงกับ DB CHECK constraint', () => {
    for (const k of ['match', 'short', 'over', 'count_only', 'book_only']) {
        assert.ok(DS.MATCH_STATUS_LABELS[k], `ขาดสถานะ ${k}`);
    }
});

suite('dashboard-shared: ความคืบหน้าเทียบ Book (H4)');

const book = (...skus) => skus.map(s => ({ sku_name: s }));
const rec = (sku, warehouse) => ({ sku_id: sku, warehouse });

test('คลังเดียว: นับจำนวน SKU ใน Book ที่ถูกนับแล้ว', () => {
    const r = DS.computeBookCoverage(book('A', 'B', 'C'), [rec('A', 'W1'), rec('B', 'W1')]);
    assert.equal(r.totalSku, 3);
    assert.equal(r.countedSku, 2);
    assert.equal(r.uncountedSku, 1);
    assert.equal(r.progress, 66);
});

// -----------------------------------------------------------------------------
// H4 (docs/ISSUES.md): Book (`book_stock_lines`) ไม่มีมิติคลัง — เป็นรายการเดียวต่อรอบ
// เดิม renderKpis วน loop ต่อคลังแล้ว `totalSku += bookList.length` สะสม
// → ยอดคูณตามจำนวนคลัง (วัดจริง: รอบ 2 คลัง แสดง Book 2,902 ทั้งที่จริง 1,451
//   และ "ยังไม่ได้นับ" 827 ทั้งที่จริง 49 = ผิด 17 เท่า)
// -----------------------------------------------------------------------------
test('[H4-guard] หลายคลังในรอบเดียว → Book ต้องไม่ถูกนับซ้ำ', () => {
    const b = book('A', 'B', 'C', 'D');
    const rows = [
        rec('A', 'คลัง1'), rec('B', 'คลัง1'),
        rec('A', 'คลัง2'), rec('C', 'คลัง2')   // A ถูกนับใน 2 คลัง
    ];
    const r = DS.computeBookCoverage(b, rows);
    assert.equal(r.totalSku, 4, 'Book มี 4 SKU ไม่ว่ามีกี่คลัง');
    assert.equal(r.countedSku, 3, 'A นับ 2 คลังต้องนับเป็น 1 SKU (A, B, C)');
    assert.equal(r.uncountedSku, 1, 'เหลือ D');
    assert.equal(r.progress, 75);
});

test('[H4-guard] กรองเฉพาะคลังที่ระบุได้', () => {
    const b = book('A', 'B', 'C');
    const rows = [rec('A', 'คลัง1'), rec('B', 'คลัง2')];
    const only1 = DS.computeBookCoverage(b, rows, { warehouse: 'คลัง1' });
    assert.equal(only1.countedSku, 1);
    assert.equal(only1.totalSku, 3, 'Book ยังเป็นชุดเต็มเสมอ');
    const only2 = DS.computeBookCoverage(b, rows, { warehouse: ' คลัง2 ' });
    assert.equal(only2.countedSku, 1, 'ชื่อคลังต้อง trim ก่อนเทียบ');
});

test('นับเฉพาะ SKU ที่อยู่ใน Book — ผลนับนอก Book ไม่ทำให้เกิน 100%', () => {
    const r = DS.computeBookCoverage(book('A'), [rec('A', 'W'), rec('ZZZ', 'W')]);
    assert.equal(r.countedSku, 1);
    assert.equal(r.progress, 100);
    assert.equal(r.uncountedSku, 0);
});

test('SKU เทียบแบบไม่สนตัวพิมพ์/ช่องว่าง', () => {
    const r = DS.computeBookCoverage(book(' a-01 '), [rec('A-01', 'W')]);
    assert.equal(r.countedSku, 1);
});

test('Book ซ้ำใน list → นับเป็น SKU เดียว', () => {
    const r = DS.computeBookCoverage(book('A', 'A', 'B'), []);
    assert.equal(r.totalSku, 2);
});

test('ค่าว่าง/null ไม่พัง และไม่หาร 0', () => {
    const empty = DS.computeBookCoverage([], []);
    assert.equal(empty.totalSku, 0);
    assert.equal(empty.progress, 0);
    assert.equal(DS.computeBookCoverage(null, null).totalSku, 0);
    const r = DS.computeBookCoverage(book('A', ''), [rec('', 'W'), rec(null, 'W')]);
    assert.equal(r.totalSku, 1, 'SKU ว่างไม่นับ');
    assert.equal(r.countedSku, 0);
});

// -----------------------------------------------------------------------------
// H7 (docs/ISSUES.md): avgPerMin หารด้วยจำนวน bucket ที่มีข้อมูล ไม่ใช่ช่วงเวลาจริง
// สถานการณ์: นับ 30 ชิ้นในนาที 0-9, พัก (ว่าง) นาที 10-19, นับ 30 ชิ้นในนาที 20-29
// ช่วงเวลาจริง = 30 นาที → ค่าเฉลี่ยที่ถูกต้อง = 60/30 = 2 ชิ้น/นาที
// โค้ดปัจจุบัน: 60/(2 bucket × 10 นาที) = 3 ชิ้น/นาที (สูงเกินจริง 50%)
// -----------------------------------------------------------------------------
knownIssue('H7', 'avgPerMin ต้องคิดจากช่วงเวลาจริง (รวมช่วงว่าง) ไม่ใช่เฉพาะ bucket ที่มีข้อมูล', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(rowAtMin(0 + (i % 10)));   // 30 ชิ้น นาที 0-9
    for (let i = 0; i < 30; i++) rows.push(rowAtMin(20 + (i % 10)));  // 30 ชิ้น นาที 20-29
    const s = DS.computeSubmissionRateStats(rows, 10);
    assert.ok(Math.abs(s.avgPerMin - 2) < 0.01,
        `ค่าเฉลี่ยที่ถูกต้องคือ 2/นาที แต่ได้ ${s.avgPerMin} (ช่วงพักหายจากตัวหาร)`);
});
