// เทส "ยอมรับเกิน (Apply เป็นชุด)" + "ประวัติ / คืนค่า" ในหน้า reconcile
//
// โจทย์ admin:
//   1. เลือกรายการสถานะ "เกิน" ที่ ต่าง +1 ถึง +N (เช่น +10) → ดูรายการ → Export →
//      ยืนยัน 2 รอบ → ยอมรับผลนับ (Apply ทันที) ทั้งชุด
//   2. ดูประวัติการปรับของรอบ แล้วกดคืนค่าได้ (เหมือน rollback ที่เคยทำ)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('ยอมรับเกินเป็นชุด + ประวัติ/คืนค่า (reconcile)');

const RECONCILE = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'reconcile.html'), 'utf8');
const norm = v => String(v ?? '').trim().toUpperCase();

const line = o => ({ sku_id: 'X', book_qty: 0, adjustment_applied: 0, counted_qty: 0, ...o });

function liftSelector({ accepted = [], drafts = {} } = {}) {
    const acceptedSet = new Set(accepted.map(norm));
    return liftFunctions(RECONCILE, [
        'selectRowsForBulkAccept', 'selectOverRowsForBulkAccept',
        'bulkAcceptRangeText', 'buildBulkAcceptExportRows',
        'getExportLineMetrics', 'getTotalAdjustment', 'computeDisplayVariance',
        'formatRowVariancePct', 'isExcludedFromPct',
    ], {
        RS: { normalizeSku: norm },
        skuNameMap: {},
        getDraftAdjustmentSum: sku => drafts[sku] || 0,
        isLineAcceptedMatch: sku => acceptedSet.has(norm(sku)),
        resolveDisplayStatus: (l) => {
            if (acceptedSet.has(norm(l.sku_id))) return 'match';
            if (l.__status) return l.__status;
            const eff = Number(l.book_qty) + Number(l.adjustment_applied) + (drafts[l.sku_id] || 0);
            const c = Number(l.counted_qty);
            if (eff === c) return 'match';
            return c < eff ? 'short' : 'over';
        },
    });
}

// -----------------------------------------------------------------------------
// ตัวเลือกช่วง
// -----------------------------------------------------------------------------
test('เคสที่ admin สั่ง: เพดาน +10 ต้องได้เฉพาะเกิน +1 ถึง +10', () => {
    const f = liftSelector();
    const rows = [
        line({ sku_id: 'P1', book_qty: 10, counted_qty: 11 }),   // +1  ✓
        line({ sku_id: 'P10', book_qty: 10, counted_qty: 20 }),  // +10 ✓ (ขอบบนรวม)
        line({ sku_id: 'P11', book_qty: 10, counted_qty: 21 }),  // +11 ✗ เกินเพดาน
        line({ sku_id: 'S1', book_qty: 30, counted_qty: 20 }),   // ขาด ✗
        line({ sku_id: 'M1', book_qty: 5, counted_qty: 5 }),     // ตรง ✗
        line({ sku_id: 'C1', book_qty: 0, counted_qty: 3, __status: 'count_only' }), // ไม่พบใน Excel ✗
        line({ sku_id: 'B0', book_qty: 0, counted_qty: 2 }),     // Book 0 ใน Book = เกิน +2 ✓
    ];
    const out = f.selectOverRowsForBulkAccept(rows, 10);
    assert.equal(out.map(l => l.sku_id).join(','), 'P1,P10,B0');
});

test('แถวที่ยืนยันไปแล้วต้องไม่ถูกเลือกซ้ำ', () => {
    const f = liftSelector({ accepted: ['P1'] });
    const out = f.selectOverRowsForBulkAccept([
        line({ sku_id: 'P1', book_qty: 10, counted_qty: 12 }),
        line({ sku_id: 'P2', book_qty: 10, counted_qty: 12 }),
    ], 10);
    assert.equal(out.map(l => l.sku_id).join(','), 'P2');
});

test('เพดานไม่ใช่เลข / ต่ำกว่า 1 ต้องได้ลิสต์ว่าง ไม่ใช่เลือกทั้งหมด', () => {
    const f = liftSelector();
    const rows = [line({ sku_id: 'P1', book_qty: 10, counted_qty: 12 })];
    for (const bad of [NaN, 0, -5, '']) {
        assert.equal(f.selectOverRowsForBulkAccept(rows, bad).length, 0, `เพดาน "${bad}" ต้องไม่เลือกอะไร`);
    }
});

test('Export: มีคอลัมน์ยอดหลัง Apply + แถวรวมบอกจำนวนและยอดเกินรวม', () => {
    const f = liftSelector();
    const rows = [
        line({ sku_id: 'P1', book_qty: 10, counted_qty: 13 }),
        line({ sku_id: 'P2', book_qty: 20, counted_qty: 25 }),
    ];
    const out = f.buildBulkAcceptExportRows(rows, 10);
    assert.equal(out[0]['ยอดหลัง Apply'], 13, 'หลัง Apply ยอดจริงคือผลนับ');
    assert.equal(out[0]['ต่าง'], 3);
    const total = out[out.length - 1];
    assert.equal(total.SKU, 'รวม');
    assert.equal(total['ต่าง'], 8);
    assert.match(String(total['ยอดหลัง Apply']), /2 SKU/);
});

// -----------------------------------------------------------------------------
// flow ยอมรับทั้งชุด (รันจริง)
// -----------------------------------------------------------------------------
function fakeEl(extra = {}) {
    return {
        value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelectorAll: () => [], addEventListener() {},
        ...extra,
    };
}

function liftBulkFlow({ lines, draftsInCache = [], confirm = true, max = 10, mode = 'over' } = {}) {
    const arguments0_mode = mode;
    const calls = { batch: null, applyAll: 0, refresh: 0, confirms: 0 };
    const toasts = [];
    const els = {
        bulkAcceptMax: fakeEl({ value: String(max) }),
        loadingText: fakeEl(),
        loading: fakeEl(),
        bulkAcceptModal: fakeEl(),
        btnBulkAcceptConfirm: fakeEl(),
    };
    const fns = liftFunctions(RECONCILE, [
        'runBulkAcceptOver', 'selectRowsForBulkAccept', 'bulkAcceptRangeText',
    ], {
        bulkAcceptMode: arguments0_mode || 'over',
        RS: {
            normalizeSku: norm,
            createStockAdjustmentsBatch: async items => { calls.batch = items; },
            applyAllDraftsForCycle: async () => { calls.applyAll++; return calls.batch?.length ?? 0; },
        },
        linesCache: lines,
        adjustmentsCache: draftsInCache,
        currentCycle: { id: 'cyc-1', year_month: '2026-08' },
        lockCycleId: () => 'cyc-1',
        isLineAcceptedMatch: () => false,
        resolveDisplayStatus: l => {
            const c = Number(l.counted_qty), b = Number(l.book_qty);
            return c > b ? 'over' : c < b ? 'short' : 'match';
        },
        computeDisplayVariance: l => Number(l.counted_qty) - Number(l.book_qty),
        computeAutoAdjustmentQty: l => Number(l.counted_qty) - Number(l.book_qty) - Number(l.adjustment_applied),
        uiConfirm: { twoStep: async () => { calls.confirms++; return confirm; } },
        runOnce: async (key, fn) => fn(),
        runRefresh: async () => { calls.refresh++; },
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        document: { getElementById: id => els[id] || fakeEl() },
        console: { error() {} },
    });
    return { ...fns, calls, toasts };
}

test('[flow] ยืนยัน 2 ขั้นแล้ว สร้างยอดปรับตามค่าต่างจริง + Apply ทั้งชุด + โหลดใหม่', async () => {
    const g = liftBulkFlow({
        lines: [
            line({ sku_id: 'P1', book_qty: 10, counted_qty: 13 }),
            line({ sku_id: 'P2', book_qty: 0, counted_qty: 2 }),
        ],
    });
    await g.runBulkAcceptOver();
    assert.equal(g.calls.confirms, 1, 'ต้องผ่าน uiConfirm.twoStep');
    assert.ok(g.calls.batch, 'ต้องสร้างยอดปรับแบบชุด');
    assert.equal(g.calls.batch.length, 2);
    assert.equal(g.calls.batch[0].adjustmentQty, 3, 'ยอดปรับ = ผลนับ − Excel ใช้เทียบ');
    assert.equal(g.calls.batch[0].skuId, 'P1');
    assert.match(g.calls.batch[0].note, /เกินไม่เกิน \+10/);
    assert.equal(g.calls.applyAll, 1, 'ต้อง Apply ทั้งชุดครั้งเดียว (ไม่ใช่ทีละตัว)');
    assert.equal(g.calls.refresh, 1, 'ต้องโหลดหน้าใหม่หลัง Apply');
    assert.ok(g.toasts.some(t => /ยอมรับผลนับแล้ว 2/.test(t)), g.toasts.join(' | '));
});

test('[flow] กดยกเลิกในยืนยัน = ห้ามเขียนอะไรเลย', async () => {
    const g = liftBulkFlow({
        lines: [line({ sku_id: 'P1', book_qty: 10, counted_qty: 13 })],
        confirm: false,
    });
    await g.runBulkAcceptOver();
    assert.equal(g.calls.batch, null);
    assert.equal(g.calls.applyAll, 0);
});

test('[flow] มี Draft ค้างอยู่ = บล็อกทั้งชุด — Apply ทั้งชุดจะพ่วง draft ที่ไม่เกี่ยวไปด้วย', async () => {
    const g = liftBulkFlow({
        lines: [line({ sku_id: 'P1', book_qty: 10, counted_qty: 13 })],
        draftsInCache: [{ sku_id: 'OTHER', status: 'draft', adjustment_qty: 99 }],
    });
    await g.runBulkAcceptOver();
    assert.equal(g.calls.batch, null, 'ห้ามสร้างยอดปรับ');
    assert.ok(g.toasts.some(t => /Draft ค้าง 1/.test(t)), g.toasts.join(' | '));
});

// -----------------------------------------------------------------------------
// ประวัติ + คืนค่า
// -----------------------------------------------------------------------------
test('ประวัติรวมยอดปรับ + การยืนยัน เรียงใหม่ → เก่า', () => {
    const f = liftFunctions(RECONCILE, ['buildAdjustHistoryEntries'], {});
    const out = f.buildAdjustHistoryEntries(
        [
            { sku_id: 'A1', adjustment_qty: 3, status: 'applied', note: 'ยอมรับผลนับ', created_by: 'BAM', created_at: '2026-08-11T05:00:00Z', applied_at: '2026-08-11T05:01:00Z' },
            { sku_id: 'D1', adjustment_qty: -2, status: 'draft', reason: 'reconcile', created_at: '2026-08-11T07:00:00Z' },
        ],
        new Map([['B1', { note: 'ตรวจแล้ว', accepted_by: 'PAT', accepted_at: '2026-08-11T06:00:00Z' }]])
    );
    assert.equal(out.length, 3);
    assert.equal(out.map(e => e.sku).join(','), 'D1,B1,A1', 'ต้องเรียงใหม่ → เก่า');
    assert.match(out[0].detail, /-2 \(draft\)/);
    assert.match(out[1].detail, /ยืนยันเป็นถูกต้อง/);
    assert.match(out[2].detail, /\+3 \(applied\)/);
    assert.equal(out[2].by, 'BAM');
});

test('[flow] คืนค่า: ยืนยันแล้วต้องเรียก clear (ตัวที่เขียนประวัติก่อนลบ) + คำนวณ Match ใหม่', async () => {
    const calls = { clear: null, refresh: 0 };
    const cbs = [
        fakeEl({ dataset: { sku: 'P1' }, checked: true }),
        fakeEl({ dataset: { sku: 'P2' }, checked: true }),
    ];
    const els = { loading: fakeEl(), loadingText: fakeEl(), adjHistoryModal: fakeEl(), btnHistoryRestoreSelected: fakeEl() };
    const fns = liftFunctions(RECONCILE, ['rollbackHistorySkus'], {
        RS: {
            clearAdjustmentsAndMatchAcceptancesForSkus: async (cycleId, skus) => { calls.clear = { cycleId, skus }; return { deleted: skus.length, logged: skus.length }; },
        },
        lockCycleId: () => 'cyc-1',
        uiConfirm: { twoStep: async () => true },
        runOnce: async (k, fn) => fn(),
        runRefresh: async () => { calls.refresh++; },
        showToast() {},
        document: {
            getElementById: id => els[id] || fakeEl(),
            querySelectorAll: () => cbs,
        },
        console: { error() {} },
    });
    await fns.rollbackHistorySkus();
    assert.ok(calls.clear, 'ต้องเรียก clearAdjustmentsAndMatchAcceptancesForSkus (H6 — เขียนประวัติก่อนลบ)');
    assert.equal(calls.clear.cycleId, 'cyc-1');
    assert.equal(calls.clear.skus.join(','), 'P1,P2');
    assert.equal(calls.refresh, 1, 'คืนค่าแล้วต้องคำนวณ Match ใหม่ ไม่งั้นตัวเลขบนจอไม่ตรง DB');
});

test('[flow] คืนค่า: กดยกเลิก = ไม่แตะอะไร', async () => {
    const calls = { clear: 0 };
    const fns = liftFunctions(RECONCILE, ['rollbackHistorySkus'], {
        RS: { clearAdjustmentsAndMatchAcceptancesForSkus: async () => { calls.clear++; } },
        lockCycleId: () => 'cyc-1',
        uiConfirm: { twoStep: async () => false },
        runOnce: async (k, fn) => fn(),
        runRefresh: async () => {},
        showToast() {},
        document: {
            getElementById: () => fakeEl(),
            querySelectorAll: () => [fakeEl({ dataset: { sku: 'P1' }, checked: true })],
        },
        console: { error() {} },
    });
    await fns.rollbackHistorySkus();
    assert.equal(calls.clear, 0);
});

test('[ui] ปุ่มยอมรับเกินต้องโผล่เฉพาะโหมด "เกิน" เท่านั้น', () => {
    // admin สั่งชัด: ห้ามโชว์ตอนอยู่โหมด ขาด / ถูกต้อง / ทั้งหมด
    assert.match(RECONCILE, /id="btnBulkAcceptOver" style="display:none;"/,
        'ค่าเริ่มต้นใน markup ต้องซ่อน — ก่อน JS รันก็ต้องไม่โผล่');
    const at = RECONCILE.indexOf('function updateAutoAdjustButton');
    const body = RECONCILE.slice(at, at + 1200);
    assert.match(body, /bulkBtn\.style\.display = adjustViewMode === 'over' \? '' : 'none'/,
        'ต้องผูกกับ updateAutoAdjustButton ซึ่งถูกเรียกทุกครั้งที่สลับโหมด');
});

test('[ui] ปุ่ม/โมดัลครบ และ Export ใช้รายการเดียวกับที่แสดง', () => {
    assert.match(RECONCILE, /id="btnBulkAcceptOver"/);
    assert.match(RECONCILE, /id="bulkAcceptModal"/);
    assert.match(RECONCILE, /id="btnBulkAcceptExport"/);
    assert.match(RECONCILE, /id="btnAdjHistory"/);
    assert.match(RECONCILE, /id="adjHistoryModal"/);
    assert.match(RECONCILE, /buildBulkAcceptExportRows\(bulkAcceptRows, max, bulkAcceptMode\)/, 'Export ต้องใช้รายการที่แสดงอยู่ตามโหมด');
    assert.match(RECONCILE, /uiConfirm\.twoStep/, 'ต้องยืนยัน 2 ขั้น');
});

// -----------------------------------------------------------------------------
// ฝั่ง "ขาด" — โจทย์เดียวกัน กลับเครื่องหมาย (โค้ดชุดเดียวกับฝั่งเกิน)
// -----------------------------------------------------------------------------
test('ฝั่งขาด: เพดาน 10 ต้องได้เฉพาะขาด −1 ถึง −10', () => {
    const f = liftSelector();
    const rows = [
        line({ sku_id: 'S1', book_qty: 11, counted_qty: 10 }),   // −1  ✓
        line({ sku_id: 'S10', book_qty: 20, counted_qty: 10 }),  // −10 ✓ (ขอบรวม)
        line({ sku_id: 'S11', book_qty: 21, counted_qty: 10 }),  // −11 ✗ เกินเพดาน
        line({ sku_id: 'P1', book_qty: 10, counted_qty: 12 }),   // เกิน ✗
        line({ sku_id: 'M1', book_qty: 5, counted_qty: 5 }),     // ตรง ✗
        line({ sku_id: 'B1', book_qty: 9, counted_qty: 0, __status: 'book_only' }), // ยังไม่ได้นับ ✗
    ];
    const out = f.selectRowsForBulkAccept(rows, 10, 'short');
    assert.equal(out.map(l => l.sku_id).join(','), 'S1,S10');
});

test('ฝั่งขาด: แถวที่ยืนยันแล้วไม่ถูกเลือก และโหมดที่ไม่รู้จัก = ว่าง', () => {
    const f = liftSelector({ accepted: ['S1'] });
    const rows = [
        line({ sku_id: 'S1', book_qty: 12, counted_qty: 10 }),
        line({ sku_id: 'S2', book_qty: 12, counted_qty: 10 }),
    ];
    assert.equal(f.selectRowsForBulkAccept(rows, 10, 'short').map(l => l.sku_id).join(','), 'S2');
    assert.equal(f.selectRowsForBulkAccept(rows, 10, 'อะไรก็ไม่รู้').length, 0);
});

test('ฝั่งขาด: Export ป้ายรวมต้องบอก "ขาดไม่เกิน −N" และต่างติดลบ', () => {
    const f = liftSelector();
    const rows = [
        line({ sku_id: 'S1', book_qty: 13, counted_qty: 10 }),
        line({ sku_id: 'S2', book_qty: 25, counted_qty: 20 }),
    ];
    const out = f.buildBulkAcceptExportRows(rows, 10, 'short');
    assert.equal(out[0]['ต่าง'], -3);
    assert.equal(out[0]['ยอดหลัง Apply'], 10, 'หลัง Apply ยอดจริงคือผลนับ');
    const total = out[out.length - 1];
    assert.match(String(total['ชื่อ']), /ขาดไม่เกิน −10/);
    assert.equal(total['ต่าง'], -8);
});

test('[flow] ฝั่งขาด: ยอดปรับต้องติดลบ และ note บอกขาดไม่เกิน', async () => {
    const g = liftBulkFlow({
        mode: 'short',
        lines: [line({ sku_id: 'S1', book_qty: 13, counted_qty: 10 })],
    });
    // liftBulkFlow stub resolveDisplayStatus เดิมมองแค่ over — flow ฝั่งขาดใช้ selector จริง
    await g.runBulkAcceptOver();
    assert.ok(g.calls.batch, 'ต้องสร้างยอดปรับ');
    assert.equal(g.calls.batch[0].adjustmentQty, -3, 'ขาด = ยอดปรับติดลบ (Excel ลดลงเท่าผลนับ)');
    assert.match(g.calls.batch[0].note, /ขาดไม่เกิน −10/);
    assert.equal(g.calls.applyAll, 1);
});

test('[ui] ปุ่มยอมรับขาดต้องโผล่เฉพาะโหมด "ขาด" เท่านั้น', () => {
    assert.match(RECONCILE, /id="btnBulkAcceptShort" style="display:none;"/,
        'ค่าเริ่มต้นใน markup ต้องซ่อน');
    const at = RECONCILE.indexOf('function updateAutoAdjustButton');
    const body = RECONCILE.slice(at, at + 1600);
    assert.match(body, /bulkShortBtn\.style\.display = adjustViewMode === 'short' \? '' : 'none'/,
        'ต้องโผล่เฉพาะโหมดขาด');
});

test('[flow] รายการที่แสดงในโมดัลต้องเป็นโหมดเดียวกับที่จะ Apply', () => {
    // mutation พิสูจน์ว่า refreshBulkAcceptList hardcode 'over' ได้โดยเทสอื่นเขียวหมด
    // = ผู้ใช้ตรวจรายการฝั่งเกิน แต่ตอนกดยืนยันระบบ Apply ฝั่งขาด — อันตรายมาก
    const lines = [
        line({ sku_id: 'P1', book_qty: 10, counted_qty: 12 }),   // เกิน +2
        line({ sku_id: 'S1', book_qty: 12, counted_qty: 10 }),   // ขาด −2
    ];
    const els = {
        bulkAcceptMax: fakeEl({ value: '10' }),
        bulkAcceptList: fakeEl(),
        bulkAcceptSummary: fakeEl(),
        bulkAcceptCount: fakeEl(),
        btnBulkAcceptConfirm: fakeEl(),
    };
    const fns = liftFunctions(RECONCILE, [
        'refreshBulkAcceptList', 'selectRowsForBulkAccept',
    ], {
        RS: { normalizeSku: norm, escapeHtml: v => String(v ?? '') },
        linesCache: lines,
        bulkAcceptMode: 'short',
        bulkAcceptRows: [],
        skuNameMap: {},
        isLineAcceptedMatch: () => false,
        resolveDisplayStatus: l => {
            const c = Number(l.counted_qty), b = Number(l.book_qty);
            return c > b ? 'over' : c < b ? 'short' : 'match';
        },
        computeDisplayVariance: l => Number(l.counted_qty) - Number(l.book_qty),
        getExportLineMetrics: l => ({
            effective: Number(l.book_qty), counted: Number(l.counted_qty),
            variance: Number(l.counted_qty) - Number(l.book_qty),
        }),
        lucide: { createIcons() {} },
        document: { getElementById: id => els[id] || fakeEl() },
    });
    fns.refreshBulkAcceptList();
    assert.match(els.bulkAcceptList.innerHTML, /S1/, 'โหมดขาดต้องแสดงแถวขาด');
    assert.ok(!/P1/.test(els.bulkAcceptList.innerHTML), 'ห้ามแสดงแถวเกินในโหมดขาด');
    assert.match(els.bulkAcceptSummary.textContent, /รวมขาด −2/);
});
