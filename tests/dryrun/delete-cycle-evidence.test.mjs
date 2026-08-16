// เทสคุ้มกัน M29: ลบรอบต้องเหลือหลักฐานว่ายอดปรับหายไปไหน
//
// ที่มา: FK ของตารางลูกเป็น ON DELETE CASCADE (ยืนยันกับฐานจริง 2026-08-16)
//   stock_adjustments · reconciliation_lines · book_stock_lines ·
//   reconciliation_match_acceptances · inventory_count_acceptances → CASCADE
//   inventory_counts → SET NULL (ผลนับรอด ตาม invariant ข้อ 1)
//
// ⇒ กดปุ่ม "ลบรอบ" ครั้งเดียว = การตัดสินใจทั้งเดือนหายถาวรโดยไม่มีร่องรอย
//   (รอบ 2026-05 ในฐานจริง = ยอดปรับ 1,008 + Book 1,451 + การยืนยัน 18)
//
// เส้นทาง import/ลบ Book (H6) เขียน log ก่อนลบไปแล้ว — เส้นทางลบรอบยังไม่มี
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('ลบรอบ: ต้องเขียนหลักฐานก่อนที่ CASCADE จะกิน');

const RS = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'reconcile-shared.js'), 'utf8');

const ADJ_ROWS = [
    { id: 'a1', sku_id: 'BNP20', adjustment_qty: 5, status: 'applied', note: 'ยอมรับผลนับ' },
    { id: 'a2', sku_id: 'PK089', adjustment_qty: -2, status: 'draft', note: '' },
];

/**
 * client จำลองที่แยกพฤติกรรมตามตาราง และจดทุกอย่างที่ถูกยิง
 * @param {{adjRows?:Array, failLog?:boolean}} cfg
 */
function fakeClient({ adjRows = ADJ_ROWS, failLog = false } = {}) {
    const ops = [];
    const make = (table) => {
        const q = {
            _op: 'select',
            select() { return q; },
            insert(rows) { q._op = 'insert'; q._rows = rows; return q; },
            update(p) { q._op = 'update'; q._payload = p; return q; },
            delete() { q._op = 'delete'; return q; },
            eq() { return q; },
            in() { return q; },
            is() { return q; },
            order() { return q; },
            range() { return q; },
            maybeSingle() { return q; },
            then(res, rej) {
                ops.push({ table, op: q._op, rows: q._rows, payload: q._payload });
                let out = { data: [], error: null, count: 0 };
                if (table === 'stock_adjustments' && q._op === 'select') {
                    out = { data: adjRows, error: null, count: adjRows.length };
                } else if (table === 'inventory_audit_logs' && q._op === 'insert') {
                    out = failLog
                        ? { data: null, error: { message: 'log เขียนไม่ได้' } }
                        : { data: (q._rows || []).map((_, i) => ({ id: 'log-' + i })), error: null };
                } else if (table === 'inventory_counts' && q._op === 'update') {
                    out = { data: [{ id: 'c1' }, { id: 'c2' }], error: null };
                } else if (table === 'inventory_counts' && q._op === 'select') {
                    out = { data: [], error: null, count: 2 };
                } else if (table === 'count_cycles' && q._op === 'select') {
                    out = { data: { id: 'cyc-1', warehouse: 'ตึกกันตนา', year_month: '2026-08' }, error: null };
                }
                return Promise.resolve(out).then(res, rej);
            },
        };
        return q;
    };
    return { ops, from: (t) => make(t) };
}

function liftDeleteCycle(client) {
    return liftFunctions(RS, [
        'deleteCycle', 'logAdjustmentsBeforeDelete', 'rollbackAuditEntries',
        'countLinkedInventory', 'resolveReconcileActor', 'auditQtyOrNull',
    ], {
        getClient: () => client,
        fetchCycleById: async () => ({ id: 'cyc-1', warehouse: 'ตึกกันตนา', year_month: '2026-08' }),
        getActiveCycle: () => null,
        setActiveCycle() {},
        clearActiveCycle() {},
        normalizeSku: v => String(v ?? '').trim().toUpperCase(),
        ADJ_CLEAR_ACTION: 'RECONCILE_ADJ_CLEAR',
        AUDIT_LOG_CHUNK: 100,
        AUDIT_DETAIL_MAX: 300,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        console: { warn() {}, error() {}, info() {} },
        window: {},
    });
}

test('[M29] ลบรอบต้องเขียน audit log ของยอดปรับทุกแถวก่อน แล้วค่อยลบ', async () => {
    const client = fakeClient();
    const fns = liftDeleteCycle(client);
    await fns.deleteCycle('cyc-1');

    const logIns = client.ops.filter(o => o.table === 'inventory_audit_logs' && o.op === 'insert');
    assert.ok(logIns.length > 0,
        'ต้องเขียน inventory_audit_logs ก่อนลบรอบ · ops ที่เกิดขึ้น: ' +
        JSON.stringify(client.ops.map(o => o.table + ':' + o.op)));

    const logged = logIns.flatMap(o => o.rows || []);
    assert.equal(logged.length, ADJ_ROWS.length, 'ต้อง log ครบทุกยอดปรับที่จะถูก CASCADE ลบ');
    const skus = logged.map(e => e.sku_id).sort();
    assert.deepEqual(skus, ['BNP20', 'PK089'], 'ต้องระบุ SKU ที่หายไป · ได้: ' + skus.join(','));

    // ลำดับสำคัญ: log ต้องมาก่อนการลบ count_cycles
    const logAt = client.ops.findIndex(o => o.table === 'inventory_audit_logs' && o.op === 'insert');
    const delAt = client.ops.findIndex(o => o.table === 'count_cycles' && o.op === 'delete');
    assert.ok(delAt >= 0, 'ต้องมีการลบรอบจริง');
    assert.ok(logAt < delAt, 'ต้องเขียนหลักฐานก่อนลบ ไม่ใช่หลังลบ (ลบแล้วอ่านไม่ได้อีก)');
});

test('[M29] เขียนหลักฐานไม่สำเร็จ = ห้ามลบรอบ (รักษาข้อมูลไว้ก่อน)', async () => {
    const client = fakeClient({ failLog: true });
    const fns = liftDeleteCycle(client);
    await assert.rejects(() => fns.deleteCycle('cyc-1'), /ประวัติ|หลักฐาน|log/i,
        'ต้องโยน error ออกมา ไม่ใช่ลบเงียบ ๆ');
    const deleted = client.ops.some(o => o.table === 'count_cycles' && o.op === 'delete');
    assert.equal(deleted, false, 'log ล้มแล้วห้ามลบรอบเด็ดขาด');
});

test('[M29] รอบที่ไม่มียอดปรับเลย ต้องลบได้ตามปกติ', async () => {
    const client = fakeClient({ adjRows: [] });
    const fns = liftDeleteCycle(client);
    await fns.deleteCycle('cyc-1');
    assert.ok(client.ops.some(o => o.table === 'count_cycles' && o.op === 'delete'),
        'ไม่มีอะไรต้อง log ก็ต้องลบได้');
});
