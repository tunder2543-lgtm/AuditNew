// Dry Run: ระบบ active cycle (localStorage จำลอง — ไม่แตะเครื่อง/DB จริง)
// รวม knownIssue H1: cycle เดือนเก่าค้างแล้วถูกแนบให้ผลนับเดือนใหม่
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('dry-run: active cycle + การแนบ cycle_id');

function freshRS() {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    return { sb, RS: sb.reconcileService };
}

test('setActiveCycle → getActiveCycle round-trip', () => {
    const { RS } = freshRS();
    const ok = RS.setActiveCycle({ id: 'cy-1', warehouse: 'ตึกกันตนา', year_month: '2026-08' });
    assert.equal(ok, true);
    const active = RS.getActiveCycle();
    assert.equal(active.id, 'cy-1');
    assert.equal(active.warehouse, 'ตึกกันตนา');
});

test('clearActiveCycle ล้างจริง', () => {
    const { RS } = freshRS();
    RS.setActiveCycle({ id: 'cy-1', warehouse: 'ตึกกันตนา', year_month: '2026-08' });
    RS.clearActiveCycle();
    assert.equal(RS.getActiveCycle(), null);
});

test('attachCycleToPayload: คลังตรง → แนบ cycle_id', () => {
    const { RS } = freshRS();
    RS.setActiveCycle({ id: 'cy-1', warehouse: 'ตึกกันตนา', year_month: '2026-08' });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'ตึกกันตนา');
    assert.equal(p.cycle_id, 'cy-1');
});

test('attachCycleToPayload: คลังไม่ตรง → ไม่แนบ', () => {
    const { RS } = freshRS();
    RS.setActiveCycle({ id: 'cy-1', warehouse: 'ตึกกันตนา', year_month: '2026-08' });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'คลังอะไหล่');
    assert.equal(p.cycle_id, undefined);
});

test('attachCycleToPayload: รอบ "คลังทั้งหมด" แนบให้ทุกคลัง', () => {
    const { RS } = freshRS();
    RS.setActiveCycle({ id: 'cy-all', warehouse: 'คลังทั้งหมด', year_month: '2026-08' });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'คลังอะไหล่');
    assert.equal(p.cycle_id, 'cy-all');
});

// -----------------------------------------------------------------------------
// H1 (docs/ISSUES.md) — แก้แล้ว 2026-08-09 · ตอนนี้เป็นยามกัน regression
//
// บั๊กเดิม: getCycleIdForWarehouse เช็คแค่ชื่อคลัง ไม่เช็คว่ารอบยังใช้ได้อยู่ไหม
// → active cycle ของเดือนก่อนที่ค้างใน localStorage (index.html ไม่เคลียร์เมื่อ
//   เดือนใหม่ไม่มีรอบ) ถูกแนบให้ผลนับเดือนใหม่ → reconcile รอบเก่าเพี้ยน
//
// เกณฑ์หลังแก้ (isCycleRelevantNow) — ผ่านข้อใดข้อหนึ่ง:
//   1) year_month = เดือนปัจจุบัน (กรอกย้อนหลังในเดือนเดียวกันยังได้)
//   2) เวลาปัจจุบันอยู่ในช่วง count_start_at..count_end_at (รอบคร่อมเดือน)
// -----------------------------------------------------------------------------

/** สร้าง cycle ของ "เดือนนี้" แบบไดนามิก เพื่อให้เทสไม่พังเมื่อเวลาผ่านไป */
function currentYearMonth(d = new Date()) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(d);
    const g = t => p.find(x => x.type === t)?.value || '';
    return `${g('year')}-${g('month')}`;
}

test('[H1-guard] cycle ของเดือนเก่าต้องไม่ถูกแนบให้ผลนับเดือนปัจจุบัน', () => {
    const { RS } = freshRS();
    RS.setActiveCycle({ id: 'cy-old', warehouse: 'ตึกกันตนา', year_month: '2000-01' });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'ตึกกันตนา');
    assert.equal(p.cycle_id, undefined,
        `cycle เดือน 2000-01 ไม่ควรถูกแนบ แต่ได้ cycle_id=${p.cycle_id}`);
});

test('[H1-guard] รอบ "คลังทั้งหมด" ของเดือนเก่าก็ต้องไม่ถูกแนบ', () => {
    const { RS } = freshRS();
    RS.setActiveCycle({ id: 'cy-old-all', warehouse: 'คลังทั้งหมด', year_month: '2000-01' });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'คลังอะไหล่');
    assert.equal(p.cycle_id, undefined, 'รอบทุกคลังของเดือนเก่าต้องไม่รอด guard');
});

test('[H1-guard] รอบของเดือนปัจจุบันยังแนบได้ตามปกติ (ไม่ regression)', () => {
    const { RS } = freshRS();
    RS.setActiveCycle({ id: 'cy-now', warehouse: 'ตึกกันตนา', year_month: currentYearMonth() });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'ตึกกันตนา');
    assert.equal(p.cycle_id, 'cy-now');
});

test('[H1-guard] ช่วงวันของรอบจบไปแล้วแต่ยังเดือนเดียวกัน → ยังแนบได้ (กรอกย้อนหลัง)', () => {
    const { RS } = freshRS();
    const ym = currentYearMonth();
    RS.setActiveCycle({
        id: 'cy-ended', warehouse: 'ตึกกันตนา', year_month: ym,
        count_start_at: `${ym}-01T00:00:00+07:00`,
        count_end_at: `${ym}-02T00:00:00+07:00`   // จบตั้งแต่วันที่ 1
    });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'ตึกกันตนา');
    assert.equal(p.cycle_id, 'cy-ended', 'เดือนเดียวกันต้องยังแนบได้แม้ช่วงวันจบแล้ว');
});

test('[H1-guard] รอบคร่อมเดือน: อยู่ในช่วงวันแม้ year_month เป็นเดือนก่อน → แนบได้', () => {
    const { RS } = freshRS();
    // จำลองเวลา "ตอนนี้" = 1 ก.ย. 2026, รอบคือ 28 ส.ค. – 3 ก.ย. (year_month = 2026-08)
    const now = new Date('2026-09-01T05:00:00+07:00');
    RS.setActiveCycle({
        id: 'cy-span', warehouse: 'ตึกกันตนา', year_month: '2026-08',
        count_start_at: '2026-08-28T00:00:00+07:00',
        count_end_at: '2026-09-04T00:00:00+07:00'
    });
    const p = RS.attachCycleToPayload({ sku_id: 'A1' }, 'ตึกกันตนา', { now });
    assert.equal(p.cycle_id, 'cy-span', 'รอบที่คร่อมเดือนและยังอยู่ในช่วงต้องแนบได้');
});

test('[H1-guard] isCycleRelevantNow: เดือนเก่า=false · เดือนนี้=true · ค่าว่าง=false', () => {
    const { RS } = freshRS();
    assert.equal(RS.isCycleRelevantNow({ year_month: '2000-01' }), false);
    assert.equal(RS.isCycleRelevantNow({ year_month: currentYearMonth() }), true);
    assert.equal(RS.isCycleRelevantNow(null), false);
    assert.equal(RS.isCycleRelevantNow({}), false);
});
