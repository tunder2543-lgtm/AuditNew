// Dry Run: รันโค้ดจริง clearAdjustmentsAndMatchAcceptancesForSkus กับ mock client
// พิสูจน์ว่า "ถ้ารันจริงจะลบอะไร" โดยไม่แตะ DB — รวม knownIssue H6
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';

suite('dry-run: clearAdjustments (โค้ดจริง + mock DB)');

function setup() {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({
        stock_adjustments: [
            { id: 1, cycle_id: 'cy-1', sku_id: 'A1', status: 'draft', adjustment_qty: -2 },
            { id: 2, cycle_id: 'cy-1', sku_id: 'A1', status: 'applied', adjustment_qty: 5 },
            { id: 3, cycle_id: 'cy-1', sku_id: 'B2', status: 'applied', adjustment_qty: 1 },
            { id: 4, cycle_id: 'cy-OTHER', sku_id: 'A1', status: 'draft', adjustment_qty: 9 },
        ],
        reconciliation_match_acceptances: [
            { cycle_id: 'cy-1', sku_id: 'A1' },
        ],
    });
    sb.apiService = { getClient: () => mock };
    return { RS: sb.reconcileService, mock };
}

test('เรียกแล้วยิง delete ไปที่ stock_adjustments + acceptances โดยกรอง cycle_id ถูกต้อง', async () => {
    const { RS, mock } = setup();
    await RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']);

    const adjDeletes = findOps(mock, { table: 'stock_adjustments', op: 'delete' });
    assert.equal(adjDeletes.length, 1, 'ต้องมี delete stock_adjustments 1 ครั้ง (chunk เดียว)');
    const f = adjDeletes[0].filters;
    assert.ok(f.some(x => x.type === 'eq' && x.col === 'cycle_id' && x.val === 'cy-1'), 'ต้องกรอง cycle_id');
    assert.ok(f.some(x => x.type === 'in' && x.col === 'sku_id'), 'ต้องกรอง sku_id แบบ in');

    const accDeletes = findOps(mock, { table: 'reconciliation_match_acceptances', op: 'delete' });
    assert.equal(accDeletes.length, 1);
});

test('Dry Run guarantee: fixtures ไม่ถูกแก้ (ข้อมูล "จริง" ปลอดภัย)', async () => {
    const { RS, mock } = setup();
    await RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']);
    assert.equal(mock.fixtures.stock_adjustments.length, 4, 'mock ต้องไม่ลบข้อมูลจริง');
});

test('รอบอื่น (cy-OTHER) ต้องไม่โดนหางเลข', async () => {
    const { RS, mock } = setup();
    await RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']);
    const del = findOps(mock, { table: 'stock_adjustments', op: 'delete' })[0];
    const wouldDeleteOtherCycle = (del.wouldAffect || []).some(r => r.cycle_id !== 'cy-1');
    assert.equal(wouldDeleteOtherCycle, false);
});

// -----------------------------------------------------------------------------
// H6 (docs/ISSUES.md) — แก้แล้ว 2026-08-09
//
// การตัดสินใจของ admin: **ยังต้องลบทั้ง draft และ applied** เพราะ
// `effective_book_qty = book_qty + SUM(applied)` ถ้าเหลือยอดปรับเก่าไว้หลัง Import Book ใหม่
// จะกลายเป็นนับซ้ำ (ยอดผิดทันที) — แต่ทุกแถวที่ลบต้องมี audit log กำกับก่อนเสมอ
// จึงไม่ใช่ "กรอง status=draft" อย่างที่ ISSUES เสนอไว้ตอนแรก
// -----------------------------------------------------------------------------

/** ลำดับ index ของ op แรกที่ตรงเงื่อนไข (−1 = ไม่มี) */
function opIndex(mock, { table, op }) {
    return mock.ops.findIndex(o => o.table === table && o.op === op);
}

test('[H6-guard] ต้องเขียน inventory_audit_logs ก่อน delete stock_adjustments เสมอ', async () => {
    const { RS, mock } = setup();
    await RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']);

    const logAt = opIndex(mock, { table: 'inventory_audit_logs', op: 'insert' });
    const delAt = opIndex(mock, { table: 'stock_adjustments', op: 'delete' });
    assert.ok(logAt >= 0, 'ต้องมี insert inventory_audit_logs');
    assert.ok(logAt < delAt, 'log ต้องมาก่อน delete — ลบแล้วสร้าง log ย้อนหลังไม่ได้');
});

test('[H6-guard] log ต้องครบทุกแถวที่จะถูกลบ รวมแถว applied ด้วย', async () => {
    const { RS, mock } = setup();
    const res = await RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']);

    const logIns = findOps(mock, { table: 'inventory_audit_logs', op: 'insert' })[0];
    const entries = Array.isArray(logIns.payload) ? logIns.payload : [logIns.payload];
    const del = findOps(mock, { table: 'stock_adjustments', op: 'delete' })[0];
    const doomed = del.wouldAffect || [];

    assert.equal(entries.length, doomed.length, 'จำนวน log ต้องเท่ากับจำนวนแถวที่จะถูกลบ');
    assert.equal(res.logged, doomed.length);
    assert.equal(res.deleted, doomed.length);

    const loggedIds = entries.map(e => String(e.record_id)).sort();
    assert.deepEqual(loggedIds, doomed.map(r => String(r.id)).sort(), 'ต้อง log ตรงตัวทุก id');
    assert.ok(entries.some(e => /applied/.test(e.location)), 'ต้องมีแถว applied อยู่ใน log ด้วย');
    entries.forEach(e => {
        assert.equal(e.action_type, 'RECONCILE_ADJ_CLEAR');
        assert.equal(e.new_qty, null, 'ลบ = ไม่มีค่าใหม่');
        assert.ok(e.old_qty != null, 'ต้องเก็บยอดปรับเดิมไว้');
    });
});

test('[H6-guard] เขียน log ไม่สำเร็จ = ห้ามลบ (ยอมล้มทั้งงานดีกว่าลบแบบไร้หลักฐาน)', async () => {
    const { RS, mock } = setup();
    const realFrom = mock.from.bind(mock);
    mock.from = (table) => {
        if (table !== 'inventory_audit_logs') return realFrom(table);
        const stub = {
            insert() { mock.ops.push({ table, op: 'insert-denied' }); return stub; },
            select() { return stub; },
            delete() { return stub; },
            in() { return stub; },
            then(resolve, reject) {
                return Promise.resolve({ data: null, error: { message: 'RLS denied' } }).then(resolve, reject);
            }
        };
        return stub;
    };

    await assert.rejects(
        () => RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']),
        /ยกเลิกการล้างยอดปรับ/
    );
    assert.equal(findOps(mock, { table: 'stock_adjustments', op: 'delete' }).length, 0,
        'log พังแล้วยังลบต่อ = หลักฐานหาย');
});

// -----------------------------------------------------------------------------
// H6 ส่วนที่ 2: Import Excel ต้องไม่ force ทุก SKU ในไฟล์เป็น "ถูกต้อง"
// (ของเดิมเรียก acceptReconciliationAsMatchBatch กับทุก SKU โดยไม่ดูผลนับ)
// -----------------------------------------------------------------------------

function setupImport() {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({
        stock_adjustments: [
            { id: 1, cycle_id: 'cy-1', sku_id: 'A1', status: 'draft', adjustment_qty: -2 },
            { id: 2, cycle_id: 'cy-1', sku_id: 'A1', status: 'applied', adjustment_qty: 5 },
        ],
        book_stock_lines: [
            { cycle_id: 'cy-1', sku_id: 'A1', book_qty: 10 },
        ],
        reconciliation_lines: [
            { cycle_id: 'cy-1', sku_id: 'A1', book_qty: 10, adjustment_applied: 5, effective_book_qty: 15, counted_qty: 8 },
        ],
        reconciliation_match_acceptances: [],
    }, {
        import_book_stock_lines_atomic: 2,
        refresh_reconciliation_for_cycle: null,
    });
    sb.apiService = { getClient: () => mock };
    return { RS: sb.reconcileService, mock };
}

const IMPORT_ROWS = [{ sku: 'A1', qty: 8 }, { sku: 'B2', qty: 3 }];

test('[H6-guard] importBookAndRecompute ต้องไม่ยิง accept "ถูกต้อง" ให้ SKU ในไฟล์', async () => {
    const { RS, mock } = setupImport();
    await RS.importBookAndRecompute('cy-1', IMPORT_ROWS, 'book.xlsx');

    const forced = mock.ops.filter(o =>
        o.table === 'reconciliation_match_acceptances' && (o.op === 'upsert' || o.op === 'insert'));
    assert.equal(forced.length, 0,
        'import ต้องปล่อยให้สถานะคำนวณจาก Book ใหม่ vs ผลนับจริง ไม่ force เป็น match');
});

test('[H6-guard] importBookAndRecompute: ล้างยอดปรับเก่า → merge Book → refresh (ตามลำดับ)', async () => {
    const { RS, mock } = setupImport();
    const res = await RS.importBookAndRecompute('cy-1', IMPORT_ROWS, 'book.xlsx');

    const importAt = mock.ops.findIndex(o => o.op === 'rpc' && o.fn === 'import_book_stock_lines_atomic');
    const delAt = opIndex(mock, { table: 'stock_adjustments', op: 'delete' });
    const refreshAt = mock.ops.findIndex(o => o.op === 'rpc' && o.fn === 'refresh_reconciliation_for_cycle');

    assert.ok(importAt >= 0, 'ต้อง import Book');
    assert.equal(mock.ops[importAt].args.p_mode, 'merge');
    // ลำดับนี้สำคัญเรื่อง failure mode: ถ้า merge ก่อนแล้วล้างพัง จะเหลือ Book ใหม่ + ยอดปรับเก่า
    // → effective = book + SUM(applied) = นับซ้ำเงียบ ๆ
    assert.ok(delAt < importAt, 'ต้องล้างยอดปรับเก่าก่อน merge Book');
    assert.ok(refreshAt > importAt, 'refresh ต้องเป็นขั้นสุดท้าย ไม่งั้นสถานะยังเป็นของเก่า');
    assert.equal(res.imported, 2);
    assert.equal(res.cleared.deleted, 2, 'ต้องล้างยอดปรับเดิมของ A1 ทั้ง draft และ applied');
});

test('[H6-guard] ลบยอดปรับไม่สำเร็จหลังเขียน log แล้ว = ต้องถอน log ทิ้ง (กันหลักฐานเท็จ)', async () => {
    const { RS, mock } = setup();
    const realFrom = mock.from.bind(mock);
    let logSeq = 0;
    mock.from = (table) => {
        if (table === 'inventory_audit_logs') {
            const stub = {
                _op: null, _ids: null,
                insert(rows) { stub._op = 'insert'; stub._rows = rows; return stub; },
                select() { return stub; },
                delete() { stub._op = 'delete'; return stub; },
                in(col, vals) { stub._ids = [...vals]; return stub; },
                then(resolve, reject) {
                    mock.ops.push({ table, op: stub._op, payload: stub._rows, ids: stub._ids });
                    // insert คืน id จริงเพื่อให้ writtenIds ไม่ว่าง (mock ปกติคืน payload ที่ไม่มี id)
                    const data = stub._op === 'insert'
                        ? stub._rows.map(() => ({ id: ++logSeq }))
                        : null;
                    return Promise.resolve({ data, error: null }).then(resolve, reject);
                }
            };
            return stub;
        }
        if (table !== 'stock_adjustments') return realFrom(table);
        const inner = realFrom(table);
        const origThen = inner.then.bind(inner);
        inner.then = (resolve, reject) => {
            if (inner._op === 'delete') {
                mock.ops.push({ table, op: 'delete-failed' });
                return Promise.resolve({ data: null, error: { message: 'network lost' } }).then(resolve, reject);
            }
            return origThen(resolve, reject);
        };
        return inner;
    };

    // Supabase คืน error เป็น object ธรรมดา (ไม่ใช่ Error) โค้ดจึง `throw error` ตรง ๆ ตามธรรมเนียมโปรเจกต์
    await assert.rejects(
        () => RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']),
        (err) => err?.message === 'network lost'
    );

    const rollback = mock.ops.find(o => o.table === 'inventory_audit_logs' && o.op === 'delete');
    assert.ok(rollback, 'ต้องถอน log ที่เพิ่งเขียนเมื่อการลบล้มเหลว');
    assert.deepEqual(rollback.ids, [1, 2, 3], 'ต้องถอนครบทุก id ที่เขียนไป');
});

test('[H6-guard] ลบรายการ Book (deleteBookStockBySku) ก็ต้อง log ยอดปรับก่อนลบ', async () => {
    const { RS, mock } = setupImport();
    await RS.deleteBookStockBySku('cy-1', 'A1');

    const logAt = opIndex(mock, { table: 'inventory_audit_logs', op: 'insert' });
    const delAt = opIndex(mock, { table: 'stock_adjustments', op: 'delete' });
    assert.ok(logAt >= 0 && logAt < delAt, 'ต้อง log ก่อนลบยอดปรับ — เส้นทางนี้ก็ลบทั้ง draft และ applied');

    const entries = findOps(mock, { table: 'inventory_audit_logs', op: 'insert' })[0].payload;
    assert.equal(entries.length, 2, 'A1 มียอดปรับ 2 แถว (draft + applied)');
    assert.ok(/reconcile_delete_book/.test(entries[0].counter_name), 'ต้องระบุที่มาว่ามาจากการลบ Book');
});

test('[H6-guard] preview ต้องคิดจากยอดก่อน merge (ไม่งั้นเทียบ "ก่อน → หลัง" ไม่ได้)', async () => {
    const { RS, mock } = setupImport();
    const res = await RS.importBookAndRecompute('cy-1', IMPORT_ROWS, 'book.xlsx');

    const previewAt = opIndex(mock, { table: 'reconciliation_lines', op: 'select' });
    const importAt = mock.ops.findIndex(o => o.op === 'rpc' && o.fn === 'import_book_stock_lines_atomic');
    assert.ok(previewAt >= 0 && previewAt < importAt, 'ต้องอ่านยอดเดิมก่อน merge');

    const a1 = res.preview.find(p => p.skuId === 'A1');
    assert.ok(a1, 'ต้องมี preview ของ A1');
    assert.equal(a1.currentEffective, 13, 'effective เดิม = applied 15 + draft (−2)');
    assert.equal(a1.targetEffective, 8, 'เป้าหมายจากไฟล์');
    assert.equal(a1.statusAfter, 'match', 'ไฟล์ 8 = ผลนับ 8 → ถูกต้องจริง (ไม่ได้ force)');
});

test('[H6-guard] ไฟล์ไม่ตรงผลนับ ต้องได้สถานะ ขาด/เกิน — ไม่ใช่ถูกต้อง (หัวใจของ H6)', async () => {
    const { RS } = setupImport();

    // ผลนับ A1 = 8 · ไฟล์สั่ง Book = 20 → นับได้น้อยกว่า Book = "ขาด" (short)
    const low = await RS.importBookAndRecompute('cy-1', [{ sku: 'A1', qty: 20 }], 'book.xlsx');
    const a1Low = low.preview.find(p => p.skuId === 'A1');
    assert.equal(a1Low.targetEffective, 20);
    assert.equal(a1Low.statusAfter, 'short', `ไฟล์ 20 vs ผลนับ 8 ต้องเป็น "ขาด" แต่ได้ ${a1Low.statusAfter}`);

    // ไฟล์สั่ง Book = 3 → นับได้มากกว่า Book = "เกิน" (over)
    const high = await RS.importBookAndRecompute('cy-1', [{ sku: 'A1', qty: 3 }], 'book.xlsx');
    const a1High = high.preview.find(p => p.skuId === 'A1');
    assert.equal(a1High.statusAfter, 'over', `ไฟล์ 3 vs ผลนับ 8 ต้องเป็น "เกิน" แต่ได้ ${a1High.statusAfter}`);
});
