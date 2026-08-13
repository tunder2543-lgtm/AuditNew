// เทสแผงปรับยอดหน้า Match — "ใช้ยอดที่กรอกเป็นยอดจริง" (2026-08-13)
//
// โจทย์ admin:
//   1. ช่อง "ยอดจริงที่ต้องการ" คือยอดที่คนตัดสินแล้วว่าเป็นยอดจริง (เช่น ทีมงานไปตรวจ
//      ซ้ำแล้วได้ 450 ทั้งที่ผลนับในระบบ = 200) — กดปุ่มเดียวต้องจบ: ปรับ Excel ใช้เทียบ
//      เป็น 450 + บันทึกยืนยันกำกับ + สถานะเป็นถูกต้อง โดยไม่แตะผลนับ/Book ต้นฉบับ
//   2. เดิมถ้ากรอกยอด ≠ ผลนับ ระบบปรับให้แต่สถานะค้างขาด/เกิน แล้ว toast โกหกว่า
//      "สถานะถูกต้อง" — ต้องไม่กลับมาอีก
//   3. ปุ่ม "บันทึก Draft" ถูกถอดออก (ซ้ำกับปุ่ม Apply)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('แผงปรับยอด: ใช้ยอดที่กรอกเป็นยอดจริง (reconcile)');

const RECONCILE = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'reconcile.html'), 'utf8');
const norm = v => String(v ?? '').trim().toUpperCase();

function fakeEl(extra = {}) {
    return {
        value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelectorAll: () => [], addEventListener() {},
        ...extra,
    };
}

/**
 * ยก acceptCountedForLine พร้อม helper คำนวณของจริง (computeDeltaFromTarget /
 * getTargetAdjustmentValidation / getLineEffectiveBook) — stub เฉพาะชั้น DB/DOM
 */
function liftAcceptFlow({ confirm = true } = {}) {
    const calls = { adjust: null, acceptMatch: null, confirms: 0, reload: 0 };
    const toasts = [];
    const els = { loading: fakeEl(), loadingText: fakeEl() };
    const fns = liftFunctions(RECONCILE, [
        'acceptCountedForLine', 'computeDeltaFromTarget', 'getTargetAdjustmentValidation',
        'getLineEffectiveBook', 'getTotalAdjustment', 'formatAdjustDeltaLabel',
    ], {
        RS: {
            normalizeSku: norm,
            acceptCountedQtyAsMatch: async args => { calls.adjust = args; return { adjustmentId: 'a1', skuId: args.skuId }; },
            acceptReconciliationAsMatch: async args => { calls.acceptMatch = args; return { skuId: args.skuId }; },
        },
        lockCycleId: () => 'cyc-1',
        currentCycle: { id: 'cyc-1', year_month: '2026-08' },
        inFlightActions: new Set(),
        skuNameMap: {},
        matchAcceptanceMap: new Map(),
        selectedAdjLine: null,
        linesCache: [],
        getDraftAdjustmentSum: () => 0,
        resolveDisplayStatus: l => {
            const eff = Number(l.book_qty) + Number(l.adjustment_applied);
            const c = Number(l.counted_qty);
            return eff === c ? 'match' : c < eff ? 'short' : 'over';
        },
        resolveComputedStatus: l => {
            const eff = Number(l.book_qty) + Number(l.adjustment_applied);
            const c = Number(l.counted_qty);
            return eff === c ? 'match' : c < eff ? 'short' : 'over';
        },
        computeDisplayVariance: l => Number(l.counted_qty) - Number(l.book_qty) - Number(l.adjustment_applied),
        getCycleLabelForConfirm: () => '2026-08',
        applyDraftsForSku: async () => 0,
        reloadMatchData: async () => { calls.reload++; },
        renderDraftList() {}, renderKpis() {}, renderTable() {},
        selectAdjLine() {}, refreshAdjPanelChrome() {}, renderAdjPanelSummary() {},
        uiConfirm: { twoStep: async () => { calls.confirms++; return confirm; } },
        runOnce: async (k, fn) => fn(),
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        document: { getElementById: id => els[id] || fakeEl() },
    });
    return { ...fns, calls, toasts };
}

// -----------------------------------------------------------------------------
// เส้นทางหลัก: กรอกเท่าผลนับ (ค่า default) = ยอมรับผลนับแบบเดิมเป๊ะ
// -----------------------------------------------------------------------------
test('[flow] กรอกเท่าผลนับ: ปรับ = ผลนับ − Excel ใช้เทียบ · ไม่เขียนคำยืนยันเพิ่ม', async () => {
    const g = liftAcceptFlow();
    const line = { sku_id: 'BG001-1', book_qty: 278, adjustment_applied: 0, counted_qty: 197 };
    await g.acceptCountedForLine(line, { targetQty: 197, skipConfirm: true, allowZeroWhenMatchesBook: true });
    assert.ok(g.calls.adjust, 'ต้องสร้าง+Apply ยอดปรับ');
    assert.equal(g.calls.adjust.adjustmentQty, -81, 'Excel 278 → 197 = ปรับ −81 (ฝั่ง Book ไม่ใช่ฝั่งผลนับ)');
    assert.equal(g.calls.adjust.cycleId, 'cyc-1');
    assert.equal(g.calls.acceptMatch, null, 'ยอดตรงผลนับอยู่แล้ว — ไม่ต้องมีคำยืนยันกำกับ');
    assert.match(g.calls.adjust.note, /ยอมรับผลนับ → ยอด 197/);
    assert.ok(g.toasts.some(t => /ยอมรับยอด 197/.test(t)), g.toasts.join(' | '));
});

// -----------------------------------------------------------------------------
// เคสที่ admin ยกตัวอย่าง: Book 500 นับได้ 200 แต่ตรวจซ้ำแล้วยอดจริงคือ 450
// -----------------------------------------------------------------------------
test('[flow] กรอก 450 ≠ ผลนับ 200: ปรับ Excel เป็น 450 + บันทึกยืนยันกำกับ + toast บอกความจริง', async () => {
    const g = liftAcceptFlow();
    const line = { sku_id: 'PC999', book_qty: 500, adjustment_applied: 0, counted_qty: 200 };
    await g.acceptCountedForLine(line, { targetQty: 450, skipConfirm: true, allowZeroWhenMatchesBook: true });
    assert.ok(g.calls.adjust, 'ต้องสร้าง+Apply ยอดปรับ');
    assert.equal(g.calls.adjust.adjustmentQty, -50, 'Excel 500 → 450 = ปรับ −50 (ไม่ใช่ 450−200=+250 ฝั่งผลนับ)');
    assert.match(g.calls.adjust.note, /450/, 'note ต้องบอกยอดจริงที่คนตัดสิน');
    assert.ok(g.calls.acceptMatch, 'ยอดที่กรอกต่างผลนับ = ต้องบันทึกยืนยันกำกับ ไม่งั้นสถานะค้างขาด/เกิน');
    assert.equal(g.calls.acceptMatch.cycleId, 'cyc-1');
    assert.equal(g.calls.acceptMatch.skuId, 'PC999');
    assert.match(g.calls.acceptMatch.note, /450/);
    assert.match(g.calls.acceptMatch.note, /200/, 'note ต้องเก็บผลนับเดิมไว้ตรวจย้อนหลัง');
    const toast = g.toasts.join(' | ');
    assert.match(toast, /ยอดจริง/, 'toast ต้องบอกว่าใช้ยอดที่กรอกเป็นยอดจริง: ' + toast);
    assert.match(toast, /450/);
    assert.ok(!/ยอมรับยอด 450 แล้ว — สถานะถูกต้อง$/.test(toast), 'ห้ามใช้ข้อความเดิมที่ไม่บอกเรื่องคำยืนยัน');
});

test('[flow] กรอกเท่า Excel ใช้เทียบ (ไม่มีอะไรต้องปรับ) แต่ต่างผลนับ: เขียนเฉพาะคำยืนยัน', async () => {
    const g = liftAcceptFlow();
    // effective = 450 อยู่แล้ว (book 500 ปรับไว้ −50) — คนกรอก 450 ซ้ำ = ยืนยันเฉย ๆ
    const line = { sku_id: 'PC999', book_qty: 500, adjustment_applied: -50, counted_qty: 200 };
    await g.acceptCountedForLine(line, { targetQty: 450, skipConfirm: true, allowZeroWhenMatchesBook: true });
    assert.equal(g.calls.adjust, null, 'ไม่มี delta = ห้ามสร้างยอดปรับ 0');
    assert.ok(g.calls.acceptMatch, 'ต้องบันทึกคำยืนยัน (เส้นทาง noAdjustment เดิม)');
});

test('[flow] ไม่ skipConfirm: dialog ต้องเตือนว่ายอดต่างผลนับ · กดยกเลิก = ไม่เขียนอะไรเลย', async () => {
    const g = liftAcceptFlow({ confirm: false });
    const line = { sku_id: 'PC999', book_qty: 500, adjustment_applied: 0, counted_qty: 200 };
    await g.acceptCountedForLine(line, { targetQty: 450 });
    assert.equal(g.calls.confirms, 1, 'ต้องผ่าน uiConfirm.twoStep');
    assert.equal(g.calls.adjust, null);
    assert.equal(g.calls.acceptMatch, null);
    assert.equal(g.calls.reload, 0);
});

// -----------------------------------------------------------------------------
// ปุ่มในแผง: ส่งค่าที่กรอกจริง (ความกลัวของ admin: "ยอด 450 ของผมจะไม่ถูกนับ")
// -----------------------------------------------------------------------------
function liftPanelButton({ armed = true } = {}) {
    const calls = { accept: null, armed: 0 };
    const fns = liftFunctions(RECONCILE, ['acceptCountedApplyFromPanel'], {
        selectedAdjLine: { sku_id: 'PC999', book_qty: 500, adjustment_applied: 0, counted_qty: 200 },
        parseAdjInput: () => 450,
        acceptApplyArmed: armed,
        acceptApplyArmSku: armed ? 'PC999' : null,
        armAcceptApplyBtn: () => { calls.armed++; },
        resetAcceptApplyBtn() {},
        acceptCountedForLine: async (line, opts) => { calls.accept = { line, opts }; },
        showToast() {},
    });
    return { ...fns, calls };
}

test('[flow] ปุ่ม Apply ในแผงส่ง "ค่าที่กรอก" (450) ไม่ใช่ผลนับดิบ (200)', async () => {
    const g = liftPanelButton();
    await g.acceptCountedApplyFromPanel();
    assert.ok(g.calls.accept, 'ต้องเรียก acceptCountedForLine');
    assert.equal(g.calls.accept.opts.targetQty, 450, 'ยอดที่กรอกต้องถูกใช้ ไม่ใช่ counted_qty');
    assert.equal(g.calls.accept.opts.skipConfirm, true, 'ปุ่ม armed 2 ขั้นแทน dialog');
});

test('[flow] กดครั้งแรก (ยังไม่ armed) = แค่ arm ไม่เขียนอะไร', async () => {
    const g = liftPanelButton({ armed: false });
    await g.acceptCountedApplyFromPanel();
    assert.equal(g.calls.accept, null);
    assert.equal(g.calls.armed, 1);
});

// -----------------------------------------------------------------------------
// UI: ปุ่ม Draft หาย + ป้ายใหม่ตรงกันทุกจุด
// -----------------------------------------------------------------------------
test('[ui] ปุ่ม "บันทึก Draft" และฟังก์ชัน saveDraft ต้องหายทั้งคู่ (ห้ามเหลือ listener กำพร้า)', () => {
    assert.ok(!/btnSaveDraft/.test(RECONCILE), 'id ปุ่มต้องไม่เหลือ — listener บน null จะพังทั้งหน้า');
    assert.ok(!/function saveDraft/.test(RECONCILE), 'ฟังก์ชันตายต้องไม่ค้าง');
});

test('[ui] ป้ายปุ่มใหม่: markup ตรงกับ resetAcceptApplyBtn (รันจริง)', () => {
    assert.match(RECONCILE, /ใช้ยอดที่กรอกเป็นยอดจริง \(Apply ทันที\)/, 'ปุ่มเขียว Apply');
    assert.match(RECONCILE, /ยืนยันว่ายอด Excel ถูกต้อง \(ไม่ปรับยอด\)/, 'ปุ่มยืนยัน Excel');
    // ปุ่ม reset หลัง arm ต้องกลับมาเป็นป้ายเดียวกับ markup — ไม่งั้นกดพลาดครั้งแรก
    // แล้วป้ายเปลี่ยนเป็นชื่อเก่า ผู้ใช้จะสับสนว่าเป็นคนละปุ่ม
    const btn = fakeEl();
    const fns = liftFunctions(RECONCILE, ['resetAcceptApplyBtn'], {
        acceptApplyArmed: true, acceptApplyArmSku: 'X', acceptApplyArmTimer: null,
        clearTimeout() {}, lucide: { createIcons() {} },
        document: { getElementById: () => btn },
    });
    fns.resetAcceptApplyBtn();
    assert.match(btn.innerHTML, /ใช้ยอดที่กรอกเป็นยอดจริง \(Apply ทันที\)/, 'ป้ายหลัง reset ต้องตรง markup');
});

test('[ui] สรุปในแผง (รันจริง): บอกวิธีใช้แบบใหม่ + แถว "ยอดจริงที่ต้องการ"', () => {
    const hint = fakeEl();
    const els = { adjHint: hint, adjQty: fakeEl({ value: '450' }) };
    const fns = liftFunctions(RECONCILE, [
        'renderAdjPanelSummary', 'computeDeltaFromTarget', 'getTargetAdjustmentValidation',
        'getLineEffectiveBook', 'getTotalAdjustment', 'formatAdjustDeltaLabel', 'parseAdjInput',
    ], {
        RS: { normalizeSku: norm },
        getDraftAdjustmentSum: () => 0,
        isLineAcceptedMatch: () => false,
        matchAcceptanceMap: new Map(),
        resolveDisplayStatus: () => 'short',
        resolveComputedStatus: () => 'short',
        computeDisplayVariance: l => Number(l.counted_qty) - Number(l.book_qty),
        canMarkAsMatchAccepted: () => true,
        document: { getElementById: id => els[id] || fakeEl() },
    });
    fns.renderAdjPanelSummary({ sku_id: 'PC999', book_qty: 500, adjustment_applied: 0, counted_qty: 200 });
    assert.match(hint.innerHTML, /ยอดจริงที่ต้องการ \(หลังปรับ\)/);
    assert.match(hint.innerHTML, /ใช้ยอดที่กรอก = ปรับ Excel ใช้เทียบเป็นยอดนั้น/);
    assert.match(hint.innerHTML, /ลด 50 ชิ้น/, 'กรอก 450 จาก Excel 500 ต้องบอก "ลด 50"');
});
