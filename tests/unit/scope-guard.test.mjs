// ยามกัน ReferenceError จากตัวแปรที่อยู่ผิด scope
//
// 🔴 เกิดจริง 2 ครั้งในโปรเจกต์นี้ และทั้ง 2 ครั้งเทสหลายร้อยข้อผ่านหมด:
//   1. 2026-08-11 `audit_check.html` — ลบ `const btn` แต่ลืมบรรทัด `if (btn) ...` ใน finally
//      ⇒ pipeline ตรวจสอบตายทั้งหน้า
//   2. 2026-08-11 `script.js` — ใช้ `one.aborted` นอกบล็อก `else` ที่ประกาศ `const one`
//      ⇒ **บันทึกผลนับแบบกลุ่มไม่ได้เลย** (ผู้ใช้เจอก่อนเทส)
//
// สาเหตุที่เทสไม่จับ: `new Function(src)` แค่ตรวจ syntax — ตัวแปรที่อยู่ผิด scope
// เป็น runtime error และไม่มีเทสไหนรันฟังก์ชันตัวนั้นจริง
//
// เทสนี้จึง **รันฟังก์ชันจริง** ในเส้นทางที่ผู้ใช้ใช้บ่อยที่สุด
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('ยามตัวแปรผิด scope (รันฟังก์ชันจริง ไม่ใช่แค่ตรวจ syntax)');

const SCRIPT = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'script.js'), 'utf8');

/** mock client ที่ให้ bulk insert ล้ม แล้วรายแถวสำเร็จ — บังคับให้วิ่งเข้าเส้น fallback */
function makeClient({ bulkFails = true } = {}) {
    let calls = 0;
    return {
        calls: () => calls,
        from() {
            const q = {
                _rows: null,
                insert(rows) { q._rows = rows; return q; },
                select: async () => {
                    calls++;
                    const many = Array.isArray(q._rows) && q._rows.length > 1;
                    if (many && bulkFails) return { data: null, error: { code: '23514', message: 'bulk fail' } };
                    return { data: (q._rows || []).map((r, i) => ({ ...r, id: `id-${calls}-${i}` })), error: null };
                },
            };
            return q;
        },
    };
}

function liftGroupFlow(client) {
    const logs = [];
    const toasts = [];
    return {
        logs,
        toasts,
        fns: liftFunctions(SCRIPT, ['insertGroupRowsOneByOne', 'submitGroup'], {
            supabaseClient: client,
            NETWORK_FAIL_STREAK_LIMIT: 3,
            groupSubmitPromise: null,
            groupItems: [
                { sku: 'A1', quantity: 1, clientRequestId: 'k1' },
                { sku: 'A2', quantity: 2, clientRequestId: 'k2' },
            ],
            initSupabase() {},
            attachCycleId: p => p,
            genClientRequestId: () => 'gen-' + Math.floor(1e6 * 0.5),
            isGroupSubmitting: false,
            allRecords: [],
            addRecord() {},
            hideSkuInfo() {},
            closeDropdown() {},
            skuInput: { value: '', focus() {} },
            quantityInput: { value: '' },
            localStorage: { setItem() {}, getItem: () => null },
            console: { error() {}, warn() {}, log() {} },
            validateGroupContext: () => true,
            getGroupContext: () => ({ counter_name: 'คน', warehouse: 'คลัง', location: 'A1-01' }),
            highlightGroupFieldError() {},
            attachCycleToPayload: p => p,
            ensureCycleStillValid: async () => true,
            renderGroupList() {},
            updateStats() {},
            loadInventoryCounts: async () => {},
            addRecordRowDom() {},
            logAudit: (...a) => logs.push(a),
            showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
            normalizeSkuKey: v => String(v ?? '').trim().toUpperCase(),
            goToSettingsPage() {},
            escapeHtml: v => String(v ?? ''),
            lucide: { createIcons() {} },
            // DOM ปลอมต้องคืน element เสมอ ไม่ใช่ null — โค้ดจริงตั้ง .disabled/.textContent ตรง ๆ
            document: {
                getElementById: () => ({ disabled: false, textContent: '', value: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, style: {}, focus() {}, closest: () => null }),
                querySelector: () => null,
                querySelectorAll: () => [],
            },
            window: {
                DbErrors: {
                    isDuplicateError: e => e?.code === '23505',
                    isNetworkError: e => e?.kind === 'net',
                    formatDbError: e => ({ message: e?.message || 'x' }),
                },
            },
        }),
    };
}

test('[scope] เส้นทาง fallback ของ submitGroup ต้องรันจบโดยไม่ ReferenceError', async () => {
    // เส้นนี้คือเส้นที่พังจริงเมื่อ 2026-08-11 — bulk ล้ม แล้ววิ่งเข้า insertGroupRowsOneByOne
    const client = makeClient({ bulkFails: true });
    const { fns, toasts } = liftGroupFlow(client);
    await fns.submitGroup();
    assert.ok(client.calls() >= 3, 'ต้องลอง bulk แล้วตกมาทีละแถวจริง');
    assert.ok(!toasts.some(t => /ReferenceError|is not defined/.test(t)),
        `เจอ ReferenceError หลุดออกมาเป็น toast: ${toasts.join(' | ')}`);
    assert.ok(toasts.some(t => /บันทึก/.test(t)), `ไม่มี toast ผลลัพธ์เลย: ${toasts.join(' | ')}`);
});

test('[scope] เส้นทาง bulk สำเร็จก็ต้องรันจบเหมือนกัน', async () => {
    const { fns, toasts } = liftGroupFlow(makeClient({ bulkFails: false }));
    await fns.submitGroup();
    assert.ok(!toasts.some(t => /is not defined/.test(t)), toasts.join(' | '));
});

test('[scope] ต้องเขียน audit log ของแถวที่เข้า DB จริงเท่านั้น', async () => {
    const { fns, logs } = liftGroupFlow(makeClient({ bulkFails: true }));
    await fns.submitGroup();
    assert.equal(logs.length, 1, 'ต้องเขียน audit log 1 ครั้งต่อการกด 1 ครั้ง');
    assert.equal(logs[0][0], 'GROUP_INSERT');
});

// -----------------------------------------------------------------------------
// handleEdConfirm — ฟังก์ชันที่เพิ่งถูกเขียนใหม่ในชุด 5 (async + ยาม race)
// เดิมไม่มีเทสไหนรันมันเลย มีแต่เทสที่อ่านข้อความในซอร์ส
// -----------------------------------------------------------------------------
function liftEditFlow({ collision = null, dbError = null } = {}) {
    const toasts = [];
    const logs = [];
    const updates = [];
    const inputs = { edNewQty: { value: '5' }, edNewLoc: { value: 'B2-02' } };
    const el = id => inputs[id] || {
        value: '', textContent: '', innerHTML: '', title: '', disabled: false,
        style: {}, classList: { add() {}, remove() {}, toggle() {} },
    };
    const state = {
        mode: 'edit', id: 'rec-1', sku: 'A-01', oldQty: 1, newQty: 0,
        oldLocation: 'B2-01', newLocation: '', step: 1,
        warehouse: 'คลัง', location: 'B2-01', counterName: 'คน',
    };
    const fns = liftFunctions(SCRIPT, ['handleEdConfirm', 'handleEdConfirmInner', 'edStaleSince', 'closeEdModal'], {
        supabaseClient: {
            from: () => ({
                update(payload) { updates.push(payload); return this; },
                eq() { return this; },
                then: undefined,
                // ทำตัวเป็น thenable ให้ await ได้
                [Symbol.toPrimitive]: undefined,
            }),
        },
        edState: state,
        edGeneration: 0,
        edBusy: false,
        getEditDestinationCollision: async () => collision,
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        logAudit: (...a) => logs.push(a),
        updateRecordRowDom() {},
        allRecords: [{ id: 'rec-1', counted_qty: 1, location: 'B2-01' }],
        escapeHtml: v => String(v ?? ''),
        normalizeLocKey: v => String(v ?? '').trim().toUpperCase(),
        lucide: { createIcons() {} },
        console: { error() {}, warn() {} },
        document: { getElementById: el },
        window: { DbErrors: { formatDbError: e => ({ message: e?.message || 'x' }) } },
    });
    return { fns, toasts, logs, updates, state };
}

test('[scope] handleEdConfirm ขั้นที่ 1 ต้องรันจบโดยไม่ ReferenceError', async () => {
    const { fns, toasts, state } = liftEditFlow();
    await fns.handleEdConfirm();
    assert.ok(!toasts.some(t => /is not defined/.test(t)), toasts.join(' | '));
    assert.equal(state.step, 2, 'ผ่าน guard แล้วต้องไปขั้นยืนยัน');
});

test('[scope] guard บล็อก = ต้องขึ้น toast แล้วไม่ไปขั้นถัดไป', async () => {
    const { fns, toasts, state } = liftEditFlow({
        collision: { blocked: true, message: 'ปลายทางซ้ำ' },
    });
    await fns.handleEdConfirm();
    assert.equal(state.step, 1, 'ถูกบล็อกแล้วต้องค้างอยู่ขั้นเดิม');
    assert.ok(toasts.some(t => /ปลายทางซ้ำ/.test(t)));
});

test('[scope] กดซ้ำระหว่างรอ DB ต้องไม่ทำงานสองรอบ', async () => {
    const { fns, state } = liftEditFlow();
    await Promise.all([fns.handleEdConfirm(), fns.handleEdConfirm()]);
    assert.equal(state.step, 2, 'กด 2 ครั้งต้องได้ผลเท่ากับกดครั้งเดียว');
});
