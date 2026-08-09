// เทสตัว mock เอง — ยืนยันว่ากลไก Dry Run เชื่อถือได้
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';
import { createSandbox } from '../helpers/sandbox.mjs';

suite('dry-run: กลไก mock/sandbox เชื่อถือได้');

test('mock select: กรอง eq/in ถูกต้อง', async () => {
    const mock = createMockClient({
        inventory_counts: [
            { id: 1, warehouse: 'A', sku_id: 'X1' },
            { id: 2, warehouse: 'B', sku_id: 'X2' },
            { id: 3, warehouse: 'A', sku_id: 'X3' },
        ],
    });
    const { data } = await mock.from('inventory_counts').select('*').eq('warehouse', 'A');
    assert.equal(data.length, 2);
});

test('mock insert: บันทึก op แต่ไม่แก้ fixtures', async () => {
    const mock = createMockClient({ inventory_counts: [] });
    await mock.from('inventory_counts').insert([{ sku_id: 'NEW1' }, { sku_id: 'NEW2' }]);
    assert.equal(mock.fixtures.inventory_counts.length, 0, 'fixtures ต้องไม่เปลี่ยน');
    const ins = findOps(mock, { table: 'inventory_counts', op: 'insert' });
    assert.equal(ins.length, 1);
    assert.equal(ins[0].payload.length, 2);
});

test('mock update/delete: รายงาน wouldAffect โดยไม่ลบจริง', async () => {
    const mock = createMockClient({
        inventory_counts: [
            { id: 1, warehouse: 'A' },
            { id: 2, warehouse: 'B' },
        ],
    });
    await mock.from('inventory_counts').delete().eq('warehouse', 'A');
    const del = findOps(mock, { op: 'delete' })[0];
    assert.equal(del.wouldAffect.length, 1);
    assert.equal(del.wouldAffect[0].id, 1);
    assert.equal(mock.fixtures.inventory_counts.length, 2, 'ข้อมูลต้องยังครบ');
});

test('mock rpc: บันทึกชื่อ + args', async () => {
    const mock = createMockClient({}, { refresh_reconciliation_for_cycle: 42 });
    const { data } = await mock.rpc('refresh_reconciliation_for_cycle', { p_cycle_id: 'cy-1' });
    assert.equal(data, 42);
    const calls = findOps(mock, { op: 'rpc' });
    assert.equal(calls[0].fn, 'refresh_reconciliation_for_cycle');
});

test('sandbox: network ถูกบล็อกจริง (fetch ต้อง throw)', () => {
    const sb = createSandbox();
    assert.throws(() => sb.fetch('https://example.com'), /DRY-RUN GUARD/);
    assert.throws(() => new sb.XMLHttpRequest(), /DRY-RUN GUARD/);
});

test('sandbox: localStorage แยกอิสระต่อ sandbox ไม่รั่วข้ามเทส', () => {
    const sb1 = createSandbox();
    const sb2 = createSandbox();
    sb1.localStorage.setItem('k', 'v1');
    assert.equal(sb2.localStorage.getItem('k'), null);
});
