// ยามปุ่มที่ "เขียนข้อมูลจริง" — รันฟังก์ชันจริง ไม่ใช่แค่อ่านซอร์ส
//
// 🔴 ที่มา: 2026-08-11 `submitGroup` โยน ReferenceError ⇒ บันทึกผลนับแบบกลุ่มไม่ได้เลย
//    โดยเทส 348 ข้อผ่านหมด เพราะเทสยกแต่ "ฟังก์ชันลูก" มารัน ส่วนฟังก์ชันแม่ที่บรรทัด
//    พังอยู่มีแต่เทสอ่านซอร์ส · `new Function(src)` ก็ตรวจแค่ syntax ไม่ใช่ scope
//
//    วัดแล้วพบว่าฟังก์ชันที่แก้ในชุด 1–5 มี 88 จุด แต่มีเทสรันจริงแค่ 29
//
// ไฟล์นี้ปิดช่องของ **ปุ่มที่เขียน `inventory_counts`** ที่เหลือทั้ง 4 ตัว
// เป้าหมายไม่ใช่ทดสอบ business logic (มีไฟล์อื่นคุมอยู่แล้ว) แต่คือ
// **พิสูจน์ว่ากดแล้วโค้ดวิ่งจนจบจริง** และเขียน DB ตามที่ตั้งใจ
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('ยามปุ่มที่เขียนข้อมูล: ต้องกดแล้ววิ่งจนจบจริง');

const AUDIT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'audit_check.html'), 'utf8');
const IMPORT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'import_counts.html'), 'utf8');

const norm = v => String(v ?? '').trim().toUpperCase();

/** element ปลอมที่ตั้งค่าอะไรก็ไม่พัง */
function fakeEl(extra = {}) {
    const el = {
        value: '', textContent: '', innerHTML: '', title: '', disabled: false,
        dataset: {}, style: {}, cells: [],
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelector: () => fakeEl(),
        querySelectorAll: () => [],
        closest: () => null,
        focus() {}, click() {}, remove() {},
        addEventListener() {}, appendChild() {},
        ...extra,
    };
    return el;
}

/** แถวในตารางที่มีช่อง sku/loc/qty ครบ */
function fakeRow({ id = 'rec-1', sku = 'A-01', loc = 'B2-01', qty = '5' } = {}) {
    const fields = {
        sku: fakeEl({ value: sku }),
        loc: fakeEl({ value: loc }),
        qty: fakeEl({ value: qty }),
    };
    return fakeEl({
        dataset: { recordId: id, originalLoc: loc, originalSku: sku },
        querySelector: (sel) => {
            const m = /data-field="(\w+)"/.exec(sel);
            return m ? fields[m[1]] || fakeEl() : fakeEl();
        },
        __fields: fields,
    });
}

/** client ที่บันทึกทุก update/insert ที่ถูกยิง */
function recordingClient({ failOn = () => null } = {}) {
    const writes = [];
    const api = {
        writes,
        from(table) {
            const q = {
                _op: null, _payload: null, _filters: {},
                update(p) { q._op = 'update'; q._payload = p; return q; },
                insert(p) { q._op = 'insert'; q._payload = p; return q; },
                select() { return thenable(); },
                eq(col, val) { q._filters[col] = val; return q; },
                then(res, rej) { return thenable().then(res, rej); },
            };
            function thenable() {
                const err = failOn(q);
                writes.push({ table, op: q._op, payload: q._payload, filters: { ...q._filters } });
                const rows = Array.isArray(q._payload) ? q._payload : [q._payload];
                return Promise.resolve(err
                    ? { data: null, error: err }
                    : { data: rows.map((r, i) => ({ ...r, id: `new-${writes.length}-${i}` })), error: null });
            }
            return q;
        },
    };
    return api;
}

/** stub ที่ทั้ง 3 ปุ่มของ audit_check ใช้ร่วมกัน */
function auditContext({ client, rows, extra = {} }) {
    const toasts = [];
    const audits = [];
    return {
        toasts,
        audits,
        ctx: {
            supabaseClient: client,
            norm,
            showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
            setLoading() {}, setLoadingMessage() {}, setLoadingProgress() {},
            yieldToBrowser: async () => {},
            getCheckedRows: () => rows,
            getDirtyLocationRows: () => rows,
            ensureRefLoadedForDestCheck: () => true,
            // guard ปล่อยผ่านทุกแถว — business logic มีเทสของตัวเองแล้ว (dryrun/audit-dest-guard)
            validateDestUpdateBatch: async (planned) => ({ ok: planned, blocked: [], warned: [] }),
            confirmDestUpdatesWithSkips: async () => true,
            getWarehouseForRecordId: () => 'ตึกกันตนา',
            rowSnapshotFromTr: () => ({ sku_id: 'A-01', location: 'B2-01', counted_qty: 5 }),
            flushAuditLogsIfNeeded: async (changed, action) => { audits.push({ action, n: changed.length }); },
            loadReferenceData: async () => {},
            verifyRowsInBatches: async () => {},
            rowHasData: () => true,
            updateSelectionUI() {}, refreshLocationFilterOptions() {}, applyTableView() {},
            updateStats() {}, updateLocDirtyUI() {}, renderLocCompareResult() {},
            closeLocCompareModal() {}, refreshLocCompareApplyButton() {},
            syncTableRowsAfterLocCompare() {}, renderLocCompareSkipped() {},
            localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
            renderImpactSummary() {}, refreshAcceptButtonState() {},
            sheetBody: fakeEl({ querySelectorAll: () => rows }),
            uiConfirm: { twoStep: async () => true, show: async () => true },
            lucide: { createIcons() {} },
            console: { error() {}, warn() {}, log() {} },
            document: { getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [] },
            window: {
                SkuUtils: { normalizeSku: norm },
                DbErrors: { formatDbError: e => ({ message: e?.message || 'x' }) },
                AuditLog: { ACTIONS: { SWAP: 'SWAP', UPDATE: 'UPDATE', EDIT_LOCATION: 'EDIT_LOCATION' } },
            },
            ...extra,
        },
    };
}

// -----------------------------------------------------------------------------
// 1) สลับ SKU ↔ ตำแหน่ง
// -----------------------------------------------------------------------------
test('[write] ปุ่ม "สลับค่าที่เลือก" ต้องวิ่งจนจบและ update จริง', async () => {
    const client = recordingClient();
    const rows = [fakeRow({ id: 'r1', sku: 'A-01', loc: 'B2-01', qty: '5' })];
    const { ctx, toasts, audits } = auditContext({ client, rows });
    const fns = liftFunctions(AUDIT, ['applySwapSkuLocSelected'], ctx);

    await fns.applySwapSkuLocSelected();

    assert.ok(!toasts.some(t => /is not defined|undefined is not/.test(t)),
        `หลุด ReferenceError ออกมาเป็น toast: ${toasts.join(' | ')}`);
    const upd = client.writes.filter(w => w.op === 'update');
    assert.equal(upd.length, 1, `ต้อง update 1 แถว แต่ได้ ${upd.length}`);
    // ⚠️ deepEqual ข้าม realm ของ vm ไม่ได้ (prototype คนละตัว) — เทียบผ่าน JSON
    assert.equal(JSON.stringify(upd[0].payload), JSON.stringify({ sku_id: 'B2-01', location: 'A-01' }),
        `ค่าต้องสลับกันจริง แต่ได้ ${JSON.stringify(upd[0].payload)}`);
    assert.equal(upd[0].filters.id, 'r1');
    assert.ok(audits.length > 0, 'ต้องเขียน audit log (invariant ข้อ 1)');
    assert.ok(toasts.some(t => /สลับสำเร็จ 1/.test(t)), toasts.join(' | '));
});

test('[write] สลับแล้ว DB error ต้องรายงาน ไม่ใช่เงียบ', async () => {
    const client = recordingClient({ failOn: () => ({ code: '23514', message: 'พัง' }) });
    const rows = [fakeRow({ id: 'r1' })];
    const { ctx, toasts } = auditContext({ client, rows });
    const fns = liftFunctions(AUDIT, ['applySwapSkuLocSelected'], ctx);
    await fns.applySwapSkuLocSelected();
    assert.ok(toasts.some(t => /error/.test(t) && /ล้มเหลว 1/.test(t)), toasts.join(' | '));
});

// -----------------------------------------------------------------------------
// 2) บันทึกตำแหน่ง
// -----------------------------------------------------------------------------
test('[write] ปุ่ม "บันทึกตำแหน่ง" ต้องวิ่งจนจบและเขียนค่าที่ normalize แล้ว', async () => {
    const client = recordingClient();
    const rows = [fakeRow({ id: 'r9', sku: 'A-01', loc: 'c4-07', qty: '3' })];
    const { ctx, toasts, audits } = auditContext({ client, rows });
    const fns = liftFunctions(AUDIT, ['saveLocationChanges'], ctx);

    await fns.saveLocationChanges();

    assert.ok(!toasts.some(t => /is not defined/.test(t)), toasts.join(' | '));
    const upd = client.writes.filter(w => w.op === 'update');
    assert.equal(upd.length, 1);
    assert.equal(upd[0].payload.location, 'C4-07',
        'ต้องเขียนค่าที่ผ่าน norm() — ค่าที่ guard ตรวจกับค่าที่เขียนต้องเป็นตัวเดียวกัน (M13)');
    assert.equal(upd[0].filters.id, 'r9');
    assert.ok(audits.length > 0, 'ต้องเขียน audit log');
});

// -----------------------------------------------------------------------------
// 3) เทียบตำแหน่ง Excel
// -----------------------------------------------------------------------------
test('[write] ปุ่ม "เทียบข้อมูล → ปรับตำแหน่ง" ต้องวิ่งจนจบ', async () => {
    const client = recordingClient();
    const items = [{ id: 'x1', sku: 'A-01', dbLocation: 'b1-01', newLocation: 'd2-02', warehouse: 'ตึกกันตนา', counted_qty: 4 }];
    const { ctx, toasts } = auditContext({
        client,
        rows: [],
        extra: {
            locCompareState: { mismatches: items, dbAmbiguous: [], excelRows: items, matchedOk: 0, notInSystem: [] },
            locCompareConfirmStep: 1,          // ข้ามขั้นยืนยันแรก
        },
    });
    const fns = liftFunctions(AUDIT, ['applyLocCompareUpdates'], ctx);

    await fns.applyLocCompareUpdates();

    assert.ok(!toasts.some(t => /is not defined/.test(t)),
        `หลุด ReferenceError: ${toasts.join(' | ')}`);
    const upd = client.writes.filter(w => w.op === 'update');
    if (upd.length) {
        assert.equal(upd[0].payload.location, 'D2-02', 'ต้องเขียนค่าที่ normalize แล้ว (M13)');
    }
});

// -----------------------------------------------------------------------------
// 4) นำเข้า Excel
// -----------------------------------------------------------------------------
test('[write] ปุ่ม "เริ่มนำเข้า" ต้องวิ่งจนจบทั้ง 2 ขั้นยืนยัน', async () => {
    const client = recordingClient();
    const toasts = [];
    const rows = [
        { sku: 'A-01', loc: 'B2-01', qty: 1, client_request_id: 'k1', import_batch_id: 'b1' },
        { sku: 'A-02', loc: 'B2-01', qty: 2, client_request_id: 'k2', import_batch_id: 'b1' },
    ];
    const fns = liftFunctions(IMPORT, ['runImport'], {
        supabaseClient: client,
        isImporting: false,
        importConfirmStep: 1,               // ข้ามขั้นยืนยันแรก
        CHUNK_SIZE: 200,
        pendingValidRows: rows,
        lastImportFailedRows: [],
        fileName: 'test.xlsx',
        importBatchId: 'b1',
        genClientRequestId: () => 'gen-1',
        getImportCycleHint: () => ({ cycleId: 'cyc-1', linked: true, bullet: '' }),
        importChunkRows: async (chunk) => ({
            ok: chunk.length, fail: 0, duplicateSkipped: 0, failedRows: [], lastError: null, aborted: false,
        }),
        hideImportResultPanel() {}, showImportResultPanel() {}, renderImportResultPanel() {},
        setLoading() {}, hideImportProgress() {}, showImportProgress() {},
        renderPreview() {}, savePendingKeys() {}, clearFile() {},
        logImportBatch: async () => {},
        loadImportLog: async () => {},
        loadImportHistory: async () => {},
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        buildImportToastMessage: () => 'สรุปผล',
        getImportToastType: () => 'success',
        uiConfirm: { twoStep: async () => true, show: async () => true },
        lucide: { createIcons() {} },
        console: { error() {}, warn() {}, log() {} },
        localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
        document: { getElementById: (id) => fakeEl({ value: id === 'importWarehouse' ? 'ตึกกันตนา' : 'ผู้นับ' }) },
        window: { DbErrors: { formatDbError: e => ({ message: e?.message || 'x' }) } },
    });

    await fns.runImport();

    assert.ok(!toasts.some(t => /is not defined/.test(t)),
        `หลุด ReferenceError: ${toasts.join(' | ')}`);
    assert.ok(toasts.length > 0, 'ต้องมีข้อความสรุปผลให้ผู้ใช้');
});

test('[write] นำเข้าโดยไม่เลือกคลัง ต้องเตือน ไม่ใช่พังเงียบ', async () => {
    const toasts = [];
    const fns = liftFunctions(IMPORT, ['runImport'], {
        supabaseClient: recordingClient(),
        isImporting: false,
        importConfirmStep: 0,
        pendingValidRows: [{ sku: 'A', loc: 'B', qty: 1 }],
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        document: { getElementById: () => fakeEl({ value: '' }) },
        console: { error() {} },
        window: {},
    });
    await fns.runImport();
    assert.ok(toasts.some(t => /เลือกคลัง/.test(t)), toasts.join(' | '));
});
