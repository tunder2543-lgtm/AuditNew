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
import { liftFunctions, liftInto } from '../helpers/lift.mjs';

suite('แผงปรับยอด: ใช้ยอดที่กรอกเป็นยอดจริง (reconcile)');

const RECONCILE = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'reconcile.html'), 'utf8');
const norm = v => String(v ?? '').trim().toUpperCase();

function fakeEl(extra = {}) {
    // classList ต้องจำค่าจริง — เทสตัวช่วยเลือกปุ่มตรวจ class ที่ถูกใส่/ถอด
    const classes = new Set();
    return {
        value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {},
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            toggle(c, on) { on ? classes.add(c) : classes.delete(c); },
            contains: c => classes.has(c),
        },
        _classes: classes,
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
        uiConfirm: { twoStep: async payload => { calls.confirms++; calls.confirmPayload = payload; return confirm; } },
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

    const bullets = g.calls.confirmPayload.step1.bullets.join(' | ');
    assert.match(bullets, /ยอดที่กรอกต่างจากผลนับ 200/, 'dialog ต้องเตือนว่าต่างจากผลนับ: ' + bullets);
    // ป้ายเดิม "ต้องปรับ Book" ทำ admin เข้าใจผิดว่าระบบไปแก้ไฟล์ Excel (สับสน 2 ครั้ง)
    assert.match(bullets, /ส่วนต่างที่ต้องบันทึกปรับ \(ไม่แก้ไฟล์ Excel\): ลด 50 ชิ้น/, bullets);
    assert.ok(!/ต้องปรับ Book/.test(bullets), 'ห้ามใช้คำว่า "ต้องปรับ Book" อีก');
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

// -----------------------------------------------------------------------------
// ตัวช่วยเลือกปุ่ม — "กดแค่ปุ่มเดียว ป้องกันความผิดพลาด" (admin สั่ง 2026-08-13)
// -----------------------------------------------------------------------------
function liftGuidance(status = 'short') {
    return liftFunctions(RECONCILE, [
        'resolveAdjButtonGuidance', 'parseQtyOrNull', 'getLineEffectiveBook', 'getTotalAdjustment',
    ], { getDraftAdjustmentSum: () => 0, resolveComputedStatus: () => status });
}

test('[guidance] ขาด/เกิน: ชี้ปุ่มเดียวที่มีอยู่ (ปุ่มกรอก) และไม่หรี่อะไร', () => {
    const f = liftGuidance('short');
    const line = { sku_id: 'BG001-1', book_qty: 278, adjustment_applied: 0, counted_qty: 197 };
    const g = f.resolveAdjButtonGuidance(line, 197);
    assert.equal(g.recommend, 'typed');
    assert.equal(g.dim, null, 'ปุ่ม Excel ถูกซ่อนไปแล้ว ไม่ต้องหรี่');
    assert.match(g.reason, /ต่างจากยอดตั้งต้นตอนนี้ 278/);
});

test('[guidance] ⛔ เคสค่าเริ่มต้น (ช่อง = ผลนับ) ต้องชี้ปุ่มกรอกเสมอ', () => {
    // กติกาที่ admin เสนอตอนแรกคือเทียบกับ "ผลนับ" ⇒ เคสนี้จะชี้ผิดไปปุ่ม Excel
    // ซึ่งบันทึกยอด Book เป็นยอดจริง = ทิ้งผลนับทั้งที่คนตั้งใจใช้
    const f = liftGuidance('short');
    for (const [book, counted] of [[278, 197], [10, 25], [500, 200], [0, 7]]) {
        const g = f.resolveAdjButtonGuidance({ sku_id: 'X', book_qty: book, adjustment_applied: 0, counted_qty: counted }, counted);
        assert.equal(g.recommend, 'typed', `Book ${book} / นับ ${counted} ต้องชี้ปุ่มกรอก`);
    }
});

test('[guidance] ขาด/เกิน + กรอกเท่า Excel: ยังชี้ปุ่มเดิม แต่บอกว่าจะไม่สร้างยอดปรับ', () => {
    const f = liftGuidance('short');
    const line = { sku_id: 'X', book_qty: 500, adjustment_applied: -50, counted_qty: 200 };
    const g = f.resolveAdjButtonGuidance(line, 450);   // effective = 450
    assert.equal(g.recommend, 'typed', 'ปุ่มเดียวครอบทั้ง 2 เจตนา — ต่างที่เลขในช่อง');
    assert.match(g.reason, /บันทึกว่ายอด Excel คือยอดจริง/);
    assert.match(g.reason, /ไม่สร้างยอดปรับ/);
});

test('[guidance] ยังไม่ได้นับเลย (book_only): ชี้ปุ่ม Excel ซึ่งเป็นปุ่มเดียวที่โผล่', () => {
    const f = liftGuidance('book_only');
    const g = f.resolveAdjButtonGuidance({ sku_id: 'B1', book_qty: 9, adjustment_applied: 0, counted_qty: 0 }, null);
    assert.equal(g.recommend, 'excel');
    assert.equal(g.dim, null);
    assert.match(g.reason, /ยังไม่มีใครนับ/);
});

test('[guidance] ยังไม่ใส่ยอด / ไม่มีแถว = ไม่ชี้ปุ่มไหนเลย (ห้ามเดาแทนคน)', () => {
    const f = liftGuidance('short');
    const line = { sku_id: 'X', book_qty: 10, adjustment_applied: 0, counted_qty: 5 };
    for (const bad of [null, undefined, NaN, '']) {
        const g = f.resolveAdjButtonGuidance(line, bad);
        assert.equal(g.recommend, null, `target "${bad}" ต้องไม่ชี้ปุ่ม`);
        assert.equal(g.dim, null);
    }
    assert.equal(f.resolveAdjButtonGuidance(null, 5).recommend, null);
});

test('[ui] ปุ่มที่ควรกดได้กรอบแดง + ตัวเลขจริงอยู่บนปุ่ม (รันจริง)', () => {
    const btnMark = fakeEl(), btnAccept = fakeEl();
    const els = { btnMarkMatchOk: btnMark, btnAcceptCountApply: btnAccept, adjQty: fakeEl({ value: '197' }) };
    const fns = liftFunctions(RECONCILE, [
        'renderAdjActionButtons', 'resolveAdjButtonGuidance', 'parseQtyOrNull', 'getLineEffectiveBook',
        'getTotalAdjustment', 'formatAdjustDeltaLabel', 'parseAdjInput',
    ], {
        RS: { escapeHtml: v => String(v ?? '') },
        selectedAdjLine: { sku_id: 'BG001-1', book_qty: 278, adjustment_applied: 0, counted_qty: 197 },
        acceptApplyArmed: false,
        getDraftAdjustmentSum: () => 0,
        resolveComputedStatus: () => 'short',
        ADJ_BTN_DEFAULT_MARK: 'mark', ADJ_BTN_DEFAULT_ACCEPT: 'accept',
        lucide: { createIcons() {} },
        document: { getElementById: id => els[id] || fakeEl() },
    });
    fns.renderAdjActionButtons();
    assert.ok(btnAccept.classList.contains('rc-btn-recommend'), 'ปุ่มที่ควรกดต้องมีกรอบแดง');
    assert.ok(!btnAccept.classList.contains('rc-btn-dimmed'));
    // ตัวเลขจริงต้องอยู่บนปุ่ม — ผู้ใช้ต้องอ่านออกว่ากดแล้วได้ยอดไหนโดยไม่ต้องเดา
    assert.match(btnMark.innerHTML, /ใช้ยอด Excel \(278\) เป็นยอดจริง/);
    assert.match(btnAccept.innerHTML, /ใช้ยอดที่กรอก \(197\) เป็นยอดจริง/);
    assert.match(btnAccept.innerHTML, /บันทึกปรับ ลด 81 ชิ้น/);
});

// -----------------------------------------------------------------------------
// หมายเหตุของปุ่ม "ใช้ยอดตั้งต้นเป็นยอดจริง" ต้องจดยอดที่บันทึกจริง
// (ของเดิมจดเลขในช่องกรอก ⇒ ข้อมูลจริงเสียไป 23/76 แถว)
// -----------------------------------------------------------------------------
test('[note] จด "ยอดตั้งต้น" ไม่ใช่เลขในช่อง — เคส SP069 ที่เคยจดผิดจริง', () => {
    const f = liftFunctions(RECONCILE, ['buildMarkMatchNote', 'parseQtyOrNull'], {});
    // ของจริงในฐาน: Book 68 · ไม่มียอดปรับ · ผลนับ 30 · ช่องกรอกตั้งต้นเป็น 30
    const note = f.buildMarkMatchNote(68, 30, 30);
    assert.match(note, /ใช้ยอดตั้งต้น 68 เป็นยอดจริง/, 'ต้องจด 68 ซึ่งเป็นยอดที่ระบบบันทึกจริง');
    assert.match(note, /ผลนับ 30/, 'เก็บผลนับไว้ให้ตรวจย้อนหลังได้');
    assert.ok(!/^ยืนยันถูกต้อง @ 30/.test(note), 'ห้ามกลับไปจดเลขในช่องเป็นยอดจริง');
});

test('[note] เลขในช่องต่างจากยอดที่บันทึก → ต้องบอกว่า "ไม่ถูกใช้" (เคส PC292)', () => {
    const f = liftFunctions(RECONCILE, ['buildMarkMatchNote', 'parseQtyOrNull'], {});
    // ของจริง: Book 17 ปรับ −10 ⇒ ยอดตั้งต้น 7 · ผลนับ 9 · คนพิมพ์ 11 ไว้ในช่อง
    const note = f.buildMarkMatchNote(7, 9, 11);
    assert.match(note, /ใช้ยอดตั้งต้น 7 เป็นยอดจริง/);
    assert.match(note, /เลขในช่องตอนกด 11 ไม่ถูกใช้/, 'ต้องเก็บหลักฐานว่าเลขที่พิมพ์ถูกทิ้ง');
});

test('[note] เลขในช่องเท่ายอดที่บันทึก / ไม่ได้ใส่ = ไม่ต้องต่อท้าย', () => {
    const f = liftFunctions(RECONCILE, ['buildMarkMatchNote', 'parseQtyOrNull'], {});
    for (const t of [996, null, undefined, '', NaN]) {
        const note = f.buildMarkMatchNote(996, 0, t);
        assert.equal(note, 'ใช้ยอดตั้งต้น 996 เป็นยอดจริง (ผลนับ 0)', `target=${t}`);
    }
});

test('[note][flow] รัน markLineAsMatchAccepted จริง — note ที่ส่งเข้า DB ต้องเป็นยอดที่บันทึก', async () => {
    const calls = { accept: null };
    const els = { adjNote: fakeEl({ value: '' }), adjQty: fakeEl({ value: '30' }), loading: fakeEl(), loadingText: fakeEl() };
    const fns = liftFunctions(RECONCILE, [
        'markLineAsMatchAccepted', 'buildMarkMatchNote', 'parseQtyOrNull', 'getLineEffectiveBook',
        'getTotalAdjustment', 'parseAdjInput',
    ], {
        RS: { normalizeSku: norm, acceptReconciliationAsMatch: async a => { calls.accept = a; return { skuId: a.skuId }; } },
        lockCycleId: () => 'cyc-1',
        currentCycle: { id: 'cyc-1' },
        inFlightActions: new Set(),
        matchAcceptanceMap: new Map(),
        selectedAdjLine: null,
        getDraftAdjustmentSum: () => 0,
        isLineAcceptedMatch: () => false,
        canMarkAsMatchAccepted: () => true,
        uiConfirm: { twoStep: async () => true },
        runOnce: async (k, fn) => fn(),
        renderDraftList() {}, renderKpis() {}, renderTable() {},
        refreshAdjPanelChrome() {}, renderAdjPanelSummary() {},
        showToast() {},
        document: { getElementById: id => els[id] || fakeEl() },
    });
    await fns.markLineAsMatchAccepted({ sku_id: 'SP069', book_qty: 68, adjustment_applied: 0, counted_qty: 30 });
    assert.ok(calls.accept, 'ต้องเขียนคำยืนยัน');
    assert.match(calls.accept.note, /ใช้ยอดตั้งต้น 68 เป็นยอดจริง/, 'note จริงที่ลง DB: ' + calls.accept.note);
    assert.ok(!/@ 30/.test(calls.accept.note));
});

test('[note][flow] หมายเหตุที่คนพิมพ์เองต้องชนะข้อความอัตโนมัติ', async () => {
    const calls = { accept: null };
    const els = { adjNote: fakeEl({ value: 'ของอยู่ที่ช่างซ่อม' }), adjQty: fakeEl({ value: '30' }), loading: fakeEl(), loadingText: fakeEl() };
    const fns = liftFunctions(RECONCILE, [
        'markLineAsMatchAccepted', 'buildMarkMatchNote', 'parseQtyOrNull', 'getLineEffectiveBook',
        'getTotalAdjustment', 'parseAdjInput',
    ], {
        RS: { normalizeSku: norm, acceptReconciliationAsMatch: async a => { calls.accept = a; return { skuId: a.skuId }; } },
        lockCycleId: () => 'cyc-1',
        currentCycle: { id: 'cyc-1' },
        inFlightActions: new Set(),
        matchAcceptanceMap: new Map(),
        selectedAdjLine: null,
        getDraftAdjustmentSum: () => 0,
        isLineAcceptedMatch: () => false,
        canMarkAsMatchAccepted: () => true,
        uiConfirm: { twoStep: async () => true },
        runOnce: async (k, fn) => fn(),
        renderDraftList() {}, renderKpis() {}, renderTable() {},
        refreshAdjPanelChrome() {}, renderAdjPanelSummary() {},
        showToast() {},
        document: { getElementById: id => els[id] || fakeEl() },
    });
    await fns.markLineAsMatchAccepted({ sku_id: 'SP069', book_qty: 68, adjustment_applied: 0, counted_qty: 30 });
    assert.equal(calls.accept.note, 'ของอยู่ที่ช่างซ่อม');
});

test('[ui] ป้าย "Excel ใช้เทียบ" ต้องหายไปทั้งไฟล์ (คำว่า Excel ทำให้เข้าใจว่าเป็นเลขในไฟล์)', () => {
    assert.ok(!/Excel ใช้เทียบ/.test(RECONCILE), 'ยังเหลือชื่อเดิมอยู่');
    assert.match(RECONCILE, /ยอดตั้งต้นตอนนี้/, 'ต้องมีชื่อใหม่');
    // ชื่อใหม่ต้องบอกที่มาให้ชัดในแถวสรุป ไม่งั้นก็ยังเดาไม่ออกว่ามาจากไหน
    assert.match(RECONCILE, /ยอดตั้งต้นตอนนี้ \(ไฟล์\+ปรับ\)/);
});
function liftChrome(status, { canMark = true } = {}) {
    const els = {
        adjQtyLabel: fakeEl(), adjQty: fakeEl({ value: '197' }),
        btnAcceptCountApply: fakeEl(), btnMarkMatchOk: fakeEl(),
        btnUseCountedTarget: fakeEl(), btnUseEffectiveTarget: fakeEl(),
        actWrapMarkMatch: fakeEl(), actWrapAcceptApply: fakeEl(),
    };
    const fns = liftFunctions(RECONCILE, ['refreshAdjPanelChrome'], {
        adjInputMode: 'target',
        selectedAdjLine: { sku_id: 'X', book_qty: 278, adjustment_applied: 0, counted_qty: 197 },
        resolveComputedStatus: () => status,
        canMarkAsMatchAccepted: () => canMark,
        resetAcceptApplyBtn() {}, renderAdjActionButtons() {},
        document: { getElementById: id => els[id] || fakeEl() },
    });
    fns.refreshAdjPanelChrome();
    return els;
}

test('[หนึ่งปุ่ม] ขาด/เกิน → โผล่เฉพาะปุ่มกรอก · ปุ่ม Excel ต้องถูกซ่อน', () => {
    for (const st of ['short', 'over']) {
        const els = liftChrome(st);
        assert.equal(els.actWrapAcceptApply.style.display, 'flex', `${st}: ปุ่มกรอกต้องโผล่`);
        assert.equal(els.actWrapMarkMatch.style.display, 'none',
            `${st}: ปุ่ม Excel ซ้ำซ้อน 100% กับปุ่มกรอก ต้องไม่โผล่ (กดผิดแล้วผลนับถูกทิ้งเงียบ ๆ)`);
        assert.equal(els.btnUseEffectiveTarget.style.display, 'inline-block', 'ต้องมีทางลัด "ใส่ตามยอด Excel"');
        assert.equal(els.btnUseCountedTarget.style.display, 'inline-block');
    }
});

test('[หนึ่งปุ่ม] ยังไม่ได้นับเลย (book_only) → โผล่เฉพาะปุ่ม Excel (ไม่มีผลนับให้ยอมรับ)', () => {
    const els = liftChrome('book_only');
    assert.equal(els.actWrapMarkMatch.style.display, 'flex');
    assert.equal(els.actWrapAcceptApply.style.display, 'none');
    assert.equal(els.btnUseCountedTarget.style.display, 'none', 'ไม่มีผลนับ ทางลัดนี้ต้องไม่โผล่');
});

test('[หนึ่งปุ่ม] ถูกต้องแล้ว / ยืนยันไปแล้ว → ไม่โผล่ปุ่มไหนเลย', () => {
    const els = liftChrome('match', { canMark: false });
    assert.equal(els.actWrapMarkMatch.style.display, 'none');
    assert.equal(els.actWrapAcceptApply.style.display, 'none');
    const accepted = liftChrome('book_only', { canMark: false });   // ยืนยันไปแล้ว
    assert.equal(accepted.actWrapMarkMatch.style.display, 'none');
});

test('[ui] ตอน armed ห้ามเขียนทับป้าย "กดอีกครั้ง" (ไม่งั้นผู้ใช้ไม่รู้ว่าติดอาวุธอยู่)', () => {
    const btnMark = fakeEl(), btnAccept = fakeEl({ innerHTML: 'กดอีกครั้งเพื่อ Apply (2/2)' });
    const els = { btnMarkMatchOk: btnMark, btnAcceptCountApply: btnAccept, adjQty: fakeEl({ value: '197' }) };
    const fns = liftFunctions(RECONCILE, [
        'renderAdjActionButtons', 'resolveAdjButtonGuidance', 'parseQtyOrNull', 'getLineEffectiveBook',
        'getTotalAdjustment', 'formatAdjustDeltaLabel', 'parseAdjInput',
    ], {
        RS: { escapeHtml: v => String(v ?? '') },
        selectedAdjLine: { sku_id: 'X', book_qty: 278, adjustment_applied: 0, counted_qty: 197 },
        acceptApplyArmed: true,
        getDraftAdjustmentSum: () => 0,
        resolveComputedStatus: () => 'short',
        ADJ_BTN_DEFAULT_MARK: 'mark', ADJ_BTN_DEFAULT_ACCEPT: 'accept',
        lucide: { createIcons() {} },
        document: { getElementById: id => els[id] || fakeEl() },
    });
    fns.renderAdjActionButtons();
    assert.match(btnAccept.innerHTML, /กดอีกครั้งเพื่อ Apply/, 'ป้าย armed ต้องคงอยู่');
});

// -----------------------------------------------------------------------------
// popup "?" — จำลองว่ากดแล้วยอดจะออกมาเท่าไร
// -----------------------------------------------------------------------------
function liftPreview() {
    return liftFunctions(RECONCILE, ['buildActionPreview', 'parseQtyOrNull', 'formatAdjustDeltaLabel'], {
        getDraftAdjustmentSum: () => 0,
    });
}

test('[preview] ปุ่ม Excel: ยอดจริง = Excel ใช้เทียบ · ไม่สร้างยอดปรับ · บอกชัดว่าผลนับไม่ถูกใช้', () => {
    const f = liftPreview();
    const pv = f.buildActionPreview('excel', { sku_id: 'BG001-1', book_qty: 278, adjustment_applied: 0, counted_qty: 197 }, 197);
    assert.equal(pv.finalQty, 278, 'ปุ่มนี้บันทึกยอด Excel เป็นยอดจริง ไม่ใช่ผลนับ');
    assert.equal(pv.adjustDelta, 0);
    assert.equal(pv.upstreamFix, 0, 'Excel ถูกอยู่แล้ว = ไม่ต้องแก้ระบบต้นทาง');
    assert.match(pv.note, /197/, 'ต้องเตือนว่าผลนับ 197 จะไม่ถูกใช้');
    assert.match(pv.rows.map(r => r.join(' ')).join(' | '), /ยอดจริงที่ระบบจะบันทึก 278 ชิ้น/);
});

test('[preview] ปุ่มกรอก: ยอดจริง = ค่าที่กรอก · ยอดปรับ = กรอก − Excel ใช้เทียบ', () => {
    const f = liftPreview();
    const pv = f.buildActionPreview('typed', { sku_id: 'X', book_qty: 500, adjustment_applied: 0, counted_qty: 200 }, 450);
    assert.equal(pv.finalQty, 450);
    assert.equal(pv.adjustDelta, -50, 'Excel 500 → 450');
    assert.equal(pv.upstreamFix, -50, 'ระบบต้นทางต้องตัดออก 50');
    assert.equal(pv.writesAcceptance, true, 'กรอก 450 ≠ ผลนับ 200 ⇒ ต้องบันทึกคำยืนยันกำกับ');
    assert.match(pv.note, /450/);
    assert.match(pv.note, /200/);
});

test('[preview] ปุ่มกรอกเมื่อค่า = ผลนับ: ไม่ต้องบันทึกคำยืนยันเพิ่ม', () => {
    const f = liftPreview();
    const pv = f.buildActionPreview('typed', { sku_id: 'X', book_qty: 278, adjustment_applied: 0, counted_qty: 197 }, 197);
    assert.equal(pv.finalQty, 197);
    assert.equal(pv.adjustDelta, -81);
    assert.equal(pv.writesAcceptance, false);
    assert.match(pv.note, /เท่ากับผลนับ/);
});

test('[preview] ยังไม่ใส่ยอด: ต้องไม่เดายอดจริงให้ (นโยบายข้อ 3)', () => {
    const f = liftPreview();
    const pv = f.buildActionPreview('typed', { sku_id: 'X', book_qty: 278, adjustment_applied: 0, counted_qty: 197 }, null);
    assert.equal(pv.finalQty, null);
    assert.equal(pv.adjustDelta, null);
    assert.equal(pv.writesAcceptance, false);
});

test('[ui] ปุ่ม "?" + โมดัลจำลองผลลัพธ์ต้องมีครบ และผูก listener แล้ว', () => {
    assert.match(RECONCILE, /id="btnExplainExcel"/);
    assert.match(RECONCILE, /id="btnExplainTyped"/);
    assert.match(RECONCILE, /id="adjExplainModal"/);
    assert.match(RECONCILE, /btnExplainExcel'\)\.addEventListener\('click', \(\) => renderAdjExplain\('excel'\)\)/);
    assert.match(RECONCILE, /btnExplainTyped'\)\.addEventListener\('click', \(\) => renderAdjExplain\('typed'\)\)/);
});

test('[ui] ป้ายปุ่มใหม่: reset หลัง arm ต้องกลับมาเป็นป้ายที่มีตัวเลข (รันจริง)', () => {
    const btnMark = fakeEl(), btnAccept = fakeEl({ innerHTML: 'กดอีกครั้งเพื่อ Apply (2/2)' });
    btnAccept.classList.add('armed');
    const els = { btnMarkMatchOk: btnMark, btnAcceptCountApply: btnAccept, adjQty: fakeEl({ value: '197' }) };
    const { fns, sandbox } = liftInto(RECONCILE, [
        'resetAcceptApplyBtn', 'renderAdjActionButtons', 'resolveAdjButtonGuidance', 'parseQtyOrNull',
        'getLineEffectiveBook', 'getTotalAdjustment', 'formatAdjustDeltaLabel', 'parseAdjInput',
    ], {
        RS: { escapeHtml: v => String(v ?? '') },
        selectedAdjLine: { sku_id: 'X', book_qty: 278, adjustment_applied: 0, counted_qty: 197 },
        acceptApplyArmed: true, acceptApplyArmSku: 'X', acceptApplyArmTimer: null,
        getDraftAdjustmentSum: () => 0,
        resolveComputedStatus: () => 'short',
        ADJ_BTN_DEFAULT_MARK: 'mark', ADJ_BTN_DEFAULT_ACCEPT: 'accept',
        clearTimeout() {}, lucide: { createIcons() {} },
        document: { getElementById: id => els[id] || fakeEl() },
    });
    fns.resetAcceptApplyBtn();
    assert.equal(sandbox.acceptApplyArmed, false, 'ต้องปลดอาวุธ');
    assert.ok(!btnAccept.classList.contains('armed'));
    assert.match(btnAccept.innerHTML, /ใช้ยอดที่กรอก \(197\) เป็นยอดจริง/, 'ป้ายหลัง reset ต้องมีตัวเลขจริง');
});

test('[ui] ชื่อปุ่มต้องเป็นคู่ขนาน "ใช้ยอด X เป็นยอดจริง" และไม่เหลือชื่อเก่า', () => {
    assert.match(RECONCILE, /ใช้ยอด Excel เป็นยอดจริง/, 'ปุ่ม Excel');
    assert.match(RECONCILE, /ใช้ยอดที่กรอกเป็นยอดจริง/, 'ปุ่มกรอก');
    assert.ok(!/ยืนยันว่ายอด Excel ถูกต้อง/.test(RECONCILE), 'ชื่อกลาง ๆ ที่ admin บอกว่ายังงงต้องหายไป');
    assert.ok(!/ยอมรับผลนับ \(Apply ทันที\)/.test(RECONCILE.split('bulkAcceptModal')[0]), 'ชื่อเดิมในแผงต้องไม่กลับมา');
});

test('[ui] สรุปในแผง (รันจริง): บอกวิธีใช้แบบใหม่ + แถว "ยอดจริงที่ต้องการ"', () => {
    const hint = fakeEl();
    const els = { adjHint: hint, adjQty: fakeEl({ value: '450' }) };
    const fns = liftFunctions(RECONCILE, [
        'renderAdjPanelSummary', 'computeDeltaFromTarget', 'getTargetAdjustmentValidation',
        'getLineEffectiveBook', 'getTotalAdjustment', 'formatAdjustDeltaLabel', 'parseAdjInput',
        'resolveAdjButtonGuidance', 'parseQtyOrNull',
    ], {
        RS: { normalizeSku: norm, escapeHtml: v => String(v ?? '') },
        getDraftAdjustmentSum: () => 0,
        isLineAcceptedMatch: () => false,
        matchAcceptanceMap: new Map(),
        resolveDisplayStatus: () => 'short',
        resolveComputedStatus: () => 'short',
        computeDisplayVariance: l => Number(l.counted_qty) - Number(l.book_qty),
        canMarkAsMatchAccepted: () => true,
        renderAdjActionButtons() {},
        document: { getElementById: id => els[id] || fakeEl() },
    });
    fns.renderAdjPanelSummary({ sku_id: 'PC999', book_qty: 500, adjustment_applied: 0, counted_qty: 200 });
    assert.match(hint.innerHTML, /ยอดจริงที่ต้องการ \(หลังปรับ\)/);
    assert.match(hint.innerHTML, /กดปุ่มเดียวด้านล่าง/, 'ต้องบอกว่าเหลือปุ่มเดียว');
    assert.match(hint.innerHTML, /ใส่ตามยอด Excel/, 'ต้องชี้ทางลัดฝั่ง Excel');
    assert.match(hint.innerHTML, /ลด 50 ชิ้น/, 'กรอก 450 จาก Excel 500 ต้องบอก "ลด 50"');
    assert.match(hint.innerHTML, /ต่างจากยอดตั้งต้นตอนนี้ 500/, 'ต้องบอกเหตุผลว่าทำไมชี้ปุ่มนั้น');
    // ป้ายแถวส่วนต่าง: คำว่า "ต้องปรับ Book" ทำให้ admin เข้าใจว่าระบบไปแก้ยอดในไฟล์ Excel
    // ทั้งที่จริงแค่ INSERT แถวใน stock_adjustments (book_qty ไม่เคยถูกเขียนทับ)
    assert.match(hint.innerHTML, /ส่วนต่างที่ต้องบันทึกปรับ/, 'ป้ายใหม่ต้องอยู่ในสรุป');
    assert.match(hint.innerHTML, /<small>ไม่แก้ไฟล์ Excel<\/small>/, 'ต้องมีบรรทัดกำกับว่าไม่แตะไฟล์ Excel');
    assert.ok(!/ต้องปรับ Book/.test(hint.innerHTML), 'ห้ามใช้คำว่า "ต้องปรับ Book" อีก');
});

test('[ui] ทั้งไฟล์ต้องไม่เหลือคำว่า "ต้องปรับ Book" (ป้ายที่ทำให้เข้าใจผิดมาแล้ว 2 ครั้ง)', () => {
    assert.ok(!/ต้องปรับ Book/.test(RECONCILE), 'ยังมีคำเดิมค้างอยู่ในหน้า');
});
