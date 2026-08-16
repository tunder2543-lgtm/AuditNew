// เทสโหมด "แก้ไขจำนวน" ในหน้า audit_check — รันฟังก์ชันจริง ไม่ใช่แค่อ่านซอร์ส
//
// ที่มา: admin แก้จำนวนในตารางแล้วสถานะค้างที่ "ตำแหน่ง/จำนวนไม่ตรง" ตลอด เพราะเดิม
// ไม่มีทางเขียนจำนวนใหม่ลง DB จากหน้านี้เลย (มีแต่โหมดแก้ตำแหน่ง)
//
// นโยบายข้อ 3 ("นับมายังไงเก็บอย่างนั้น") ห้าม **ระบบ** แก้เอง — แต่การแก้โดยคน
// ผ่านยืนยัน 2 ขั้น + audit log (ค่าเดิม → ค่าใหม่) คือเส้นทางเดียวกับโหมดแก้ตำแหน่ง
// ที่มีอยู่แล้ว · ทุกการแก้ย้อนดูได้ในปุ่ม "ประวัติการแก้ไข/ลบ"
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('โหมดแก้ไขจำนวน (audit_check): เขียนจริง + audit log + guard ซ้ำ');

const AUDIT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'audit_check.html'), 'utf8');
const norm = v => String(v ?? '').trim().toUpperCase();

function fakeEl(extra = {}) {
    return {
        value: '', textContent: '', innerHTML: '', title: '', disabled: false,
        dataset: {}, style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelector: () => fakeEl(), querySelectorAll: () => [],
        addEventListener() {}, focus() {},
        ...extra,
    };
}

function qtyRow({ id = 'r1', sku = 'A-01', loc = 'B2-01', oldQty = '5', newQty = '9' } = {}) {
    const fields = {
        sku: fakeEl({ value: sku }),
        loc: fakeEl({ value: loc }),
        qty: fakeEl({ value: newQty }),
    };
    return fakeEl({
        dataset: { recordId: id, originalQty: oldQty, originalLoc: loc, originalSku: sku },
        querySelector: sel => {
            const m = /data-field="(\w+)"/.exec(sel);
            return m ? fields[m[1]] || fakeEl() : fakeEl();
        },
    });
}

/**
 * client จำลอง — ต้องเลียนแบบ PostgREST ให้ตรง:
 *   update(...).eq(...).select('id') ที่สำเร็จ **คืนแถวที่ถูกแก้จริงกลับมา**
 *   ถ้าไม่แมตช์แถวใดเลย จะได้ `data: []` พร้อม `error: null` (ไม่ใช่ error)
 * @param {{failOn?:Function, affectedRows?:number}} cfg
 */
function recordingClient({ failOn = () => null, affectedRows = 1 } = {}) {
    const writes = [];
    return {
        writes,
        from(table) {
            const q = {
                _op: null, _payload: null, _filters: {},
                update(p) { q._op = 'update'; q._payload = p; return q; },
                eq(col, val) { q._filters[col] = val; return q; },
                select() { return q; },
                then(res, rej) {
                    const err = failOn(q);
                    writes.push({ table, op: q._op, payload: q._payload, filters: { ...q._filters } });
                    const rows = Array.from({ length: affectedRows }, () => ({ id: q._filters.id || 'r1' }));
                    return Promise.resolve(err ? { data: null, error: err } : { data: rows, error: null }).then(res, rej);
                },
            };
            return q;
        },
    };
}

function liftSaveQty({ rows, client, guard } = {}) {
    const toasts = [];
    const audits = [];
    const fns = liftFunctions(AUDIT, ['saveQtyChanges', 'getDirtyQtyRows', 'updateQtyDirtyUI'], {
        supabaseClient: client,
        norm,
        sheetBody: fakeEl({ querySelectorAll: () => rows }),
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        setLoading() {}, setLoadingProgress() {},
        yieldToBrowser: async () => {},
        ensureRefLoadedForDestCheck: () => true,
        validateDestUpdateBatch: guard || (async planned => ({ ok: planned, blocked: [], warned: [] })),
        confirmDestUpdatesWithSkips: async () => true,
        getWarehouseForRecordId: () => 'ตึกกันตนา',
        getAuditFilters: () => ({ warehouse: 'ตึกกันตนา' }),
        rowSnapshotFromTr: tr => ({
            id: tr.dataset.recordId, sku_id: tr.dataset.originalSku,
            location: tr.dataset.originalLoc, counted_qty: tr.dataset.originalQty,
            warehouse: 'ตึกกันตนา',
        }),
        flushAuditLogsIfNeeded: async (changed, action, force) => { audits.push({ action, n: changed.length, force: !!force }); },
        loadReferenceData: async () => {},
        applyTableView() {},
        uiConfirm: { twoStep: async () => true, show: async () => true },
        lucide: { createIcons() {} },
        console: { error() {}, warn() {} },
        document: { getElementById: () => fakeEl() },
        window: {
            DbErrors: { formatDbError: e => ({ message: e?.message || 'x' }) },
            AuditLog: { ACTIONS: { EDIT_QTY: 'AUDIT_EDIT_QTY', EDIT_LOC: 'AUDIT_EDIT_LOC' } },
        },
    });
    return { ...fns, toasts, audits };
}

test('[qty] บันทึกจำนวนใหม่ลง DB จริง — payload คือ counted_qty ตัวเลข ไม่ใช่สตริง', async () => {
    const client = recordingClient();
    const g = liftSaveQty({ rows: [qtyRow({ id: 'r7', oldQty: '5', newQty: '9' })], client });
    await g.saveQtyChanges();

    assert.ok(!g.toasts.some(t => /is not defined/.test(t)), g.toasts.join(' | '));
    const upd = client.writes.filter(w => w.op === 'update');
    assert.equal(upd.length, 1);
    assert.equal(JSON.stringify(upd[0].payload), JSON.stringify({ counted_qty: 9 }),
        'ต้องเขียนเป็นตัวเลข — สตริงจะทำให้การเทียบจำนวนทั้งระบบเพี้ยน');
    assert.equal(upd[0].filters.id, 'r7');
    assert.ok(g.toasts.some(t => /บันทึกจำนวนสำเร็จ 1/.test(t)), g.toasts.join(' | '));
});

test('[qty] ทุกการแก้ต้องเขียน audit log ด้วย action EDIT_QTY (ค่าเดิม → ค่าใหม่)', async () => {
    const g = liftSaveQty({ rows: [qtyRow()], client: recordingClient() });
    await g.saveQtyChanges();
    assert.ok(g.audits.length > 0, 'ไม่มี audit log = แก้หลักฐานโดยไม่มีร่องรอย (ขัด invariant ข้อ 1)');
    assert.ok(g.audits.every(a => a.action === 'AUDIT_EDIT_QTY'));
    assert.ok(g.audits.some(a => a.force), 'ต้องมี flush ปิดท้ายเสมอ');
});

test('[qty] จำนวนใหม่ไปตรงกับแถวอื่นในรอบเดียวกัน = guard ต้องได้เห็นและบล็อกได้', async () => {
    // แก้ 5 → 200 ทั้งที่มีแถว sku+ตำแหน่งเดียวกัน qty 200 อยู่แล้ว = สร้างแถวซ้ำจริง
    let seenPlanned = null;
    const client = recordingClient();
    const g = liftSaveQty({
        rows: [qtyRow({ oldQty: '5', newQty: '200' })],
        client,
        guard: async planned => { seenPlanned = planned; return { ok: [], blocked: planned, warned: [] }; },
    });
    await g.saveQtyChanges();

    assert.ok(seenPlanned, 'ต้องเรียก validateDestUpdateBatch (guard M12 ตัวเดียวกับทุกทางแก้ไข)');
    assert.equal(seenPlanned[0].destQty, 200, 'guard ต้องตรวจด้วยจำนวนใหม่ ไม่ใช่จำนวนเดิม');
    assert.equal(seenPlanned[0].destLoc, 'B2-01');
    assert.equal(client.writes.filter(w => w.op === 'update').length, 0, 'ถูกบล็อกแล้วห้ามเขียน');
});

test('[qty] จำนวนไม่ใช่เลขจำนวนเต็ม ≥ 0 ต้องถูกปฏิเสธก่อนถึง DB', async () => {
    for (const bad of ['-3', '2.5', 'abc']) {
        const client = recordingClient();
        const g = liftSaveQty({ rows: [qtyRow({ newQty: bad })], client });
        await g.saveQtyChanges();
        assert.equal(client.writes.length, 0, `"${bad}" หลุดไปถึง DB`);
        assert.ok(g.toasts.some(t => /จำนวนเต็ม 0 ขึ้นไป/.test(t)), g.toasts.join(' | '));
    }
});

test('[qty] แก้แล้ว DB ไม่โดนสักแถว = ต้องนับเป็นล้มเหลว ห้ามเขียน audit log', async () => {
    // แถวถูกลบ/ย้ายไปแล้วโดยคนอื่น ⇒ PostgREST คืน error:null + data:[] (ไม่ใช่ error)
    const g = liftSaveQty({
        rows: [qtyRow({ id: 'rec-1', oldQty: '5', newQty: '9' })],
        client: recordingClient({ affectedRows: 0 }),
    });
    await g.saveQtyChanges();
    // ตัวปิดท้ายยังถูกเรียกได้ (n = 0) แต่ต้องไม่มี "รายการ" ไหนถูกบันทึกว่าแก้สำเร็จ
    assert.ok(g.audits.every(a => a.n === 0),
        'ไม่มีแถวไหนถูกแก้จริง ห้ามมี audit entry · ที่เขียนไป: ' + JSON.stringify(g.audits));
    assert.ok(g.toasts.some(t => /error/.test(t) && /ล้มเหลว 1/.test(t)),
        'ต้องนับเป็นล้มเหลว 1 · toasts: ' + g.toasts.join(' | '));
});

test('[qty] DB error ต้องรายงาน ไม่เงียบ', async () => {
    const g = liftSaveQty({
        rows: [qtyRow()],
        client: recordingClient({ failOn: () => ({ code: '23514', message: 'พัง' }) }),
    });
    await g.saveQtyChanges();
    assert.ok(g.toasts.some(t => /error/.test(t) && /ล้มเหลว 1/.test(t)), g.toasts.join(' | '));
});

test('[qty] getDirtyQtyRows นับเฉพาะแถวที่ค่าเปลี่ยนจริงและมี record id', () => {
    const rows = [
        qtyRow({ id: 'a', oldQty: '5', newQty: '9' }),      // เปลี่ยน
        qtyRow({ id: 'b', oldQty: '5', newQty: '5' }),      // เท่าเดิม
        qtyRow({ id: 'c', oldQty: '5', newQty: '05' }),     // เท่าเดิม (เลขเดียวกัน)
        qtyRow({ id: '', oldQty: '5', newQty: '9' }),       // ไม่มี id (พิมพ์เอง)
        qtyRow({ id: 'e', oldQty: '5', newQty: '' }),       // ว่าง = ยังไม่ได้กรอก
    ];
    const g = liftSaveQty({ rows, client: recordingClient() });
    assert.deepEqual(g.getDirtyQtyRows().map(tr => tr.dataset.recordId).join(','), 'a');
});

// -----------------------------------------------------------------------------
// การต่อเข้าหน้า
// -----------------------------------------------------------------------------
test('[ui] มีปุ่ม + banner + โหมดต้องไม่ทับกับโหมดอื่น', () => {
    assert.match(AUDIT, /id="btnEditQtyMode"/);
    assert.match(AUDIT, /id="btnSaveQtyChanges"/);
    assert.match(AUDIT, /id="editQtyBanner"/);
    assert.match(AUDIT, /if \(enabled && editLocationMode\) await setEditLocationMode\(false\);/,
        'เปิดโหมดจำนวนต้องปิดโหมดตำแหน่ง — readOnly จะตีกัน');
    assert.match(AUDIT, /if \(enabled && editQtyMode\) setEditQtyMode\(false\);/,
        'เปิดโหมดสลับต้องปิดโหมดจำนวน');
    assert.match(AUDIT, /if \(enabled && editQtyMode\) await setEditQtyMode\(false\);/,
        'เปิดโหมดตำแหน่งต้องปิดโหมดจำนวน');
});

test('[ui] ระหว่างอยู่ในโหมด ต้องไม่ verify (กันสถานะเด้งกลางทาง) และออกแล้วตรวจใหม่', () => {
    assert.match(AUDIT, /if \(editLocationMode \|\| editQtyMode\) return \{ status: 'empty'/,
        'verifyRowElement ต้องเงียบระหว่างแก้');
    assert.match(AUDIT, /ปิดโหมดแก้ไขจำนวนก่อนตรวจสอบ/, 'verifyAll ต้องกันโหมดนี้');
    const at = AUDIT.indexOf('async function setEditQtyMode');
    const body = AUDIT.slice(at, at + 2500);
    assert.match(body, /rows\.forEach\(tr => verifyRowElement\(tr\)\)/,
        'ออกจากโหมดแล้วต้องตรวจใหม่ — นี่คือจุดที่ทำให้สถานะไม่ค้างที่ "ตำแหน่ง/จำนวนไม่ตรง"');
});

test('[ui] audit-log.js มี action EDIT_QTY และ cache-buster ถูก bump แล้ว', () => {
    const AuditLog = loadFresh('Js/audit-log.js').AuditLog;
    assert.equal(AuditLog.ACTIONS.EDIT_QTY, 'AUDIT_EDIT_QTY');
    // invariant ข้อ 9 — แก้ shared JS ต้อง bump ไม่งั้นผู้ใช้ได้ไฟล์เก่า action หาย
    assert.ok(!/audit-log\.js\?v=20260809j/.test(AUDIT), 'ยังใช้ cache-buster เก่าอยู่');
});

test('[qty] createRow ต้องรันจบจริง (จุดที่เคยพัง ReferenceError จนตารางโหลดไม่ขึ้น)', () => {
    // 🔴 เกิดจริงตอน smoke: ผมเติม listener โดยอ้าง `qtyInput` ใน scope ที่ไม่มีตัวแปรนี้
    // ⇒ createRow โยน ReferenceError ทุกแถว = ตารางว่างทั้งหน้า · เทส [ui] ทั้งชุดจับไม่ได้
    //    เพราะไม่มีข้อไหนรัน createRow — ข้อนี้รันจริง
    const listeners = [];
    const mkInput = () => ({
        value: '', placeholder: '', readOnly: false,
        addEventListener: (ev, fn) => listeners.push(ev),
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        focus() {}, select() {},
    });
    const cells = {};
    const fns = liftFunctions(AUDIT, ['createRow'], {
        document: {
            createElement: () => ({
                set innerHTML(v) {},
                dataset: {},
                querySelector: (sel) => {
                    const m = /data-field="(\w+)"|(row-select-cb)|(col-\w+)/.exec(sel);
                    const key = m?.[1] || m?.[2] || m?.[3] || sel;
                    if (!cells[key]) cells[key] = mkInput();
                    return cells[key];
                },
                querySelectorAll: () => [mkInput(), mkInput(), mkInput()],
                classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            }),
        },
        updateSelectionUI() {},
        markLocDirty() {},
        markQtyDirty() {},
        editLocationMode: false,
        editQtyMode: false,
        verifyRowElement() {},
        syncRowEditLocState() {},
        syncRowEditQtyState() {},
        syncRowSwapModeState() {},
        window: {},
    });
    const tr = fns.createRow(1);          // ต้องไม่ throw
    assert.ok(tr, 'createRow คืนแถวไม่ได้');
    assert.ok(listeners.includes('input'), 'listener ของช่องต้องถูกผูก');
});
