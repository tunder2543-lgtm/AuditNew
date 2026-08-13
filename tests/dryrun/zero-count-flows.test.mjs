// เทสเคส "นับได้ 0 แต่ Book มากกว่า 0" + ปุ่ม "ปรับยอด Auto"  (โจทย์ admin 2026-08-13)
//
// ⚠️ เคสนี้แยกเป็น 2 แบบที่ผลต่างกันคนละเรื่อง และในฐานจริงมีทั้งคู่:
//   (ก) **ไม่มีแถวนับเลย** (ไม่มีใครไปนับ)  → `book_only` — 70 SKU ในฐาน
//   (ข) **มีแถวนับ แต่จำนวน = 0** (ไปนับแล้วไม่เจอของ) → `short` — 25 SKU ในฐาน
// ตัวแยกคือ `hasCountRecord` (มาจาก `skuCountPresence`) ไม่ใช่ตัวเลข 0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('นับได้ 0 แต่ Book > 0 + ปรับยอด Auto (reconcile)');

const RECONCILE = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'reconcile.html'), 'utf8');
const SHARED = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'reconcile-shared.js'), 'utf8');
const norm = v => String(v ?? '').trim().toUpperCase();

// ใช้ตัวจริงจาก reconcile-shared.js — ไม่ใช่ stub ที่เดาเอง
const { computeMatchStatus } = liftFunctions(SHARED, ['computeMatchStatus'], {});

const line = o => ({ sku_id: 'X', book_qty: 0, adjustment_applied: 0, counted_qty: 0, ...o });

/**
 * @param presence จำนวนแถวใน inventory_counts ต่อ SKU — 0/ไม่ใส่ = ไม่มีใครไปนับ
 */
function liftStatus({ accepted = [], presence = {}, drafts = {}, inBook = null } = {}) {
    const lines = [];
    return {
        lines,
        ...liftFunctions(RECONCILE, [
            'resolveDisplayStatus', 'resolveComputedStatus', 'getTotalAdjustment',
            'computeDisplayVariance', 'computeAutoAdjustmentQty', 'skuHasInventoryCount',
            'isLineAcceptedMatch', 'selectRowsForBulkAccept', 'getLineEffectiveBook',
        ], {
            RS: { normalizeSku: norm, computeMatchStatus },
            matchAcceptanceMap: new Map(accepted.map(s => [norm(s), { sku_id: s }])),
            skuCountPresence: new Map(Object.entries(presence).map(([k, v]) => [norm(k), v])),
            bookSkuSet: new Set((inBook || Object.keys(presence).concat(['B1', 'S1', 'X'])).map(norm)),
            getDraftAdjustmentSum: sku => drafts[sku] || 0,
        }),
    };
}

// -----------------------------------------------------------------------------
// คำถามข้อ 1 ของ admin: "นับมาได้ 0 แต่ Book > 0 ใช้ยอมรับขาดเป็นชุดได้ไหม"
// -----------------------------------------------------------------------------
test('(ข) ไปนับแล้วไม่เจอของ (มีแถวนับ · จำนวน 0) → สถานะ "ขาด" และยอมรับขาดเป็นชุดได้', () => {
    const f = liftStatus({ presence: { S1: 1 } });
    const l = line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 });
    assert.equal(f.resolveDisplayStatus(l), 'short', 'ต้องเป็นขาด ไม่ใช่ book_only');
    assert.equal(f.computeDisplayVariance(l), -9, 'ต่าง = 0 − 9');
    const picked = f.selectRowsForBulkAccept([l], 10, 'short');
    assert.equal(picked.length, 1, 'เพดาน −10 ต้องครอบ −9');
    // ยอดปรับที่จะถูกสร้าง = ผลนับ − Excel ใช้เทียบ = −9 (ไม่ใช่ 0 จึงผ่านด่าน "จำนวนปรับยอดไม่ถูกต้อง")
    assert.equal(f.computeAutoAdjustmentQty(l), -9);
});

test('(ข) เพดานเล็กกว่าค่าต่าง = ไม่ถูกเลือก (เช่น Book 9 นับ 0 เพดาน −5)', () => {
    const f = liftStatus({ presence: { S1: 1 } });
    const l = line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 });
    assert.equal(f.selectRowsForBulkAccept([l], 5, 'short').length, 0);
});

test('(ก) ไม่มีใครไปนับเลย → สถานะ "ยังไม่ได้นับ" และยอมรับขาดเป็นชุด **ไม่เลือกให้**', () => {
    const f = liftStatus({ presence: {} });
    const l = line({ sku_id: 'B1', book_qty: 9, counted_qty: 0 });
    assert.equal(f.resolveDisplayStatus(l), 'book_only');
    assert.equal(f.selectRowsForBulkAccept([l], 999, 'short').length, 0,
        'ไม่มีผลนับให้ยอมรับ — ห้ามเหมารวมว่าของหมด');
});

test('ทั้ง 2 แบบปนกันในรอบเดียว: เลือกเฉพาะตัวที่ไปนับแล้วจริง', () => {
    const f = liftStatus({ presence: { S1: 1, S2: 3 } });
    const rows = [
        line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 }),    // ไปนับแล้วไม่เจอ ✓
        line({ sku_id: 'S2', book_qty: 4, counted_qty: 0 }),    // ไปนับแล้วไม่เจอ ✓
        line({ sku_id: 'B1', book_qty: 9, counted_qty: 0 }),    // ไม่ได้นับ ✗
    ];
    assert.equal(f.selectRowsForBulkAccept(rows, 10, 'short').map(l => l.sku_id).join(','), 'S1,S2');
});

test('ยืนยันไปแล้วต้องไม่ถูกเลือกซ้ำ แม้ผลนับจะเป็น 0', () => {
    const f = liftStatus({ presence: { S1: 1 }, accepted: ['S1'] });
    const l = line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 });
    assert.equal(f.resolveDisplayStatus(l), 'match', 'ยืนยันแล้วต้องแสดงเป็นถูกต้อง');
    assert.equal(f.selectRowsForBulkAccept([l], 10, 'short').length, 0);
});

// -----------------------------------------------------------------------------
// คำถามข้อ 2 ของ admin: "ปุ่มปรับยอด Auto ยังทำงานถูกไหม"
// -----------------------------------------------------------------------------
function fakeEl(extra = {}) {
    return {
        value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelectorAll: () => [], addEventListener() {},
        ...extra,
    };
}

function liftAuto({ lines, mode = 'short', draftsInCache = [], accepted = [], presence = {}, confirm = true } = {}) {
    const calls = { batch: null, confirmPayload: null };
    const toasts = [];
    const els = { loading: fakeEl(), loadingText: fakeEl() };
    const helpers = liftStatus({ accepted, presence });
    const fns = liftFunctions(RECONCILE, ['autoAdjustAll'], {
        adjustViewMode: mode,
        currentCycle: { id: 'cyc-1' },
        linesCache: lines,
        adjustmentsCache: draftsInCache,
        resolveDisplayStatus: helpers.resolveDisplayStatus,
        computeAutoAdjustmentQty: helpers.computeAutoAdjustmentQty,
        computeDisplayVariance: helpers.computeDisplayVariance,
        RS: {
            createStockAdjustmentsBatch: async items => { calls.batch = items; return items; },
            fetchAdjustments: async () => draftsInCache,
        },
        uiConfirm: { show: async p => { calls.confirmPayload = p; return confirm; } },
        runOnce: async (k, fn) => fn(),
        renderDraftList() {}, renderKpis() {}, renderTable() {},
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        document: { getElementById: id => els[id] || fakeEl() },
    });
    return { ...fns, calls, toasts };
}

test('[auto] โหมดขาด: สร้าง Draft ให้ตัวที่นับได้ 0 (มีแถวนับ) ด้วยยอด −9', async () => {
    const g = liftAuto({
        presence: { S1: 1 },
        lines: [line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 })],
    });
    await g.autoAdjustAll();
    assert.ok(g.calls.batch, 'ต้องสร้าง Draft');
    assert.equal(g.calls.batch.length, 1);
    assert.equal(g.calls.batch[0].adjustmentQty, -9, 'Excel 9 → 0');
    assert.equal(g.calls.batch[0].note, 'Auto ขาด');
    assert.equal(g.calls.batch[0].reason, 'reconcile');
});

test('[auto] ต้องไม่แตะ "ยังไม่ได้นับ" แม้อยู่โหมดขาด (ของอาจอยู่ครบ แค่ยังไม่มีใครไปนับ)', async () => {
    const g = liftAuto({
        presence: { S1: 1 },
        lines: [
            line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 }),   // ไปนับแล้ว ✓
            line({ sku_id: 'B1', book_qty: 50, counted_qty: 0 }),  // ไม่ได้นับ ✗
        ],
    });
    await g.autoAdjustAll();
    assert.equal(g.calls.batch.length, 1);
    assert.equal(g.calls.batch[0].skuId, 'S1');
});

test('[auto] ข้าม SKU ที่ยืนยันไปแล้ว และที่มี Draft ค้างอยู่', async () => {
    const g = liftAuto({
        presence: { S1: 1, S2: 1, S3: 1 },
        accepted: ['S2'],
        draftsInCache: [{ sku_id: 'S3', status: 'draft', adjustment_qty: -1 }],
        lines: [
            line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 }),
            line({ sku_id: 'S2', book_qty: 9, counted_qty: 0 }),   // ยืนยันแล้ว ✗
            line({ sku_id: 'S3', book_qty: 9, counted_qty: 0 }),   // มี draft ✗
        ],
    });
    await g.autoAdjustAll();
    assert.equal(g.calls.batch.map(i => i.skuId).join(','), 'S1');
});

test('[auto] โหมดเกินต้องไม่กวาดแถวขาดมาด้วย', async () => {
    const g = liftAuto({
        mode: 'over',
        presence: { S1: 1, P1: 1 },
        lines: [
            line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 }),    // ขาด ✗
            line({ sku_id: 'P1', book_qty: 2, counted_qty: 7 }),    // เกิน ✓
        ],
    });
    await g.autoAdjustAll();
    assert.equal(g.calls.batch.map(i => i.skuId).join(','), 'P1');
    assert.equal(g.calls.batch[0].adjustmentQty, 5);
    assert.equal(g.calls.batch[0].note, 'Auto เกิน');
});

test('[auto] กดยกเลิกในกล่องยืนยัน = ไม่เขียนอะไรเลย', async () => {
    const g = liftAuto({
        presence: { S1: 1 },
        lines: [line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 })],
        confirm: false,
    });
    await g.autoAdjustAll();
    assert.equal(g.calls.batch, null);
    assert.ok(g.calls.confirmPayload, 'ต้องถามก่อน');
});

test('[auto] โหมด "ดูทั้งหมด" ต้องไม่ทำงาน (กันกวาดทั้งรอบโดยไม่ตั้งใจ)', async () => {
    const g = liftAuto({
        mode: 'all',
        presence: { S1: 1 },
        lines: [line({ sku_id: 'S1', book_qty: 9, counted_qty: 0 })],
    });
    await g.autoAdjustAll();
    assert.equal(g.calls.batch, null);
    assert.ok(g.toasts.some(t => /เลือกโหมด ขาด หรือ เกิน ก่อน/.test(t)), g.toasts.join(' | '));
});
