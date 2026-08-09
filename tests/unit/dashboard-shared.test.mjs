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
