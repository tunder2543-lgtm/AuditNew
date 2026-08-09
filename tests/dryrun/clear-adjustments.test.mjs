// Dry Run: รันโค้ดจริง clearAdjustmentsAndMatchAcceptancesForSkus กับ mock client
// พิสูจน์ว่า "ถ้ารันจริงจะลบอะไร" โดยไม่แตะ DB — รวม knownIssue H6
import assert from 'node:assert/strict';
import { suite, test, knownIssue } from '../helpers/harness.mjs';
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
// H6 (docs/ISSUES.md): delete ไม่กรอง status → ลบ adjustment ที่ applied แล้วด้วย
// ทำลาย audit trail ของการปรับยอดที่เกิดขึ้นจริงไปแล้ว
// พฤติกรรมที่ถูกต้อง: ลบเฉพาะ draft (หรือแยกขั้นตอนชัดเจนถ้าตั้งใจลบ applied)
// -----------------------------------------------------------------------------
knownIssue('H6', 'clearAdjustments ต้องลบเฉพาะ status=draft ไม่ใช่กวาด applied ไปด้วย', async () => {
    const { RS, mock } = setup();
    await RS.clearAdjustmentsAndMatchAcceptancesForSkus('cy-1', ['A1', 'B2']);
    const del = findOps(mock, { table: 'stock_adjustments', op: 'delete' })[0];

    const hasStatusFilter = del.filters.some(x => x.col === 'status');
    const wouldDeleteApplied = (del.wouldAffect || []).some(r => r.status === 'applied');
    assert.ok(hasStatusFilter && !wouldDeleteApplied,
        `delete ไม่มี filter status — ถ้ารันจริงจะลบแถว applied ${(del.wouldAffect || []).filter(r => r.status === 'applied').length} แถว (id: ${(del.wouldAffect || []).filter(r => r.status === 'applied').map(r => r.id).join(', ')})`);
});
