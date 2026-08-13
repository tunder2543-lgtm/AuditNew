// Dry Run: fetchAdjustments / fetchMatchAcceptanceMap ต้องแบ่งหน้า
//
// ที่มา (code review 2026-08-13): สองฟังก์ชันนี้ยิง query เดียวไม่มี `.range()`
// แต่ PostgREST ตัดผลลัพธ์ที่ ~1,000 แถว **เงียบ ๆ** — บทเรียน M1 ที่โปรเจกต์นี้เจอมาแล้ว 3 รอบ
// (`.limit(10000)` ถูกตัดเหลือ 1,000 โดยไม่มี error)
//
// ทำไมสำคัญกว่าที่คิด: ทั้ง `Html/reconcile.html` (หน้า Match + modal ประวัติ) และ
// `Html/adjust_history.html` (หน้ารายงาน + Export) อ่านผ่านสองฟังก์ชันนี้
// ⇒ รอบที่ปรับยอดเยอะจะได้ **ตัวเลข Match ผิด** และ **ไฟล์ Export ไม่ครบ** พร้อมกัน
// โดยหน้าจอยังบอก "แสดง N / N รายการ" ราวกับครบ
//
// เทสนี้รันฟังก์ชันจริงกับ mock ที่มี >1,000 แถว — เทสอ่านซอร์สยามข้อนี้ไม่ได้
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';

suite('dry-run: แบ่งหน้ายอดปรับ/การยืนยัน (>1,000 แถว)');

const PAGE = 1000;

function setup({ adjustments = [], acceptances = [] } = {}) {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({
        stock_adjustments: adjustments,
        reconciliation_match_acceptances: acceptances,
    });
    sb.apiService = { getClient: () => mock };
    return { RS: sb.reconcileService, mock };
}

/** ยอดปรับ n แถว — created_at ซ้ำกันหมดโดยตั้งใจ (bulk insert ใช้ now() เดียวทั้ง transaction) */
function adjRows(n, cycleId = 'cy1') {
    return Array.from({ length: n }, (_, i) => ({
        id: String(i + 1).padStart(6, '0'),
        cycle_id: cycleId,
        sku_id: `SKU${String(i + 1).padStart(5, '0')}`,
        adjustment_qty: 1,
        status: 'applied',
        created_at: '2026-08-11T03:00:00Z',
    }));
}

test('[paging] ยอดปรับ 2,350 แถว ต้องได้ครบ ไม่ใช่ถูกตัดที่ 1,000 เงียบ ๆ', async () => {
    const { RS } = setup({ adjustments: adjRows(2350) });
    const rows = await RS.fetchAdjustments('cy1');
    assert.equal(rows.length, 2350,
        'ได้ไม่ครบ = หน้า Match คำนวณผิด และไฟล์ Export ขาดแถวโดยไม่มีอะไรเตือน');
    assert.equal(new Set(rows.map(r => r.id)).size, 2350, 'ต้องไม่มีแถวซ้ำจากการแบ่งหน้า');
});

test('[paging] ต้องยิงหลายหน้าจริง และทุกหน้าเรียงด้วย id (invariant ข้อ 13)', async () => {
    const { RS, mock } = setup({ adjustments: adjRows(2350) });
    await RS.fetchAdjustments('cy1');
    const ops = findOps(mock, { table: 'stock_adjustments', op: 'select' });
    assert.equal(ops.length, 3, `ต้องยิง 3 หน้า (1000+1000+350) แต่ยิง ${ops.length}`);
    for (const op of ops) {
        const orders = (op.modifiers || []).filter(m => m.type === 'order');
        assert.ok(orders.some(o => o.col === 'id'),
            'created_at ซ้ำกันได้จาก bulk insert — ไม่เรียง id จะข้าม/ซ้ำแถวเงียบ ๆ');
        assert.ok((op.modifiers || []).some(m => m.type === 'range'), 'ทุกหน้าต้องมี .range()');
    }
});

test('[paging] แบ่งหน้าแล้วยังกรอง cycle_id ครบทุกหน้า — ห้ามหลุดไปดึงรอบอื่น', async () => {
    const { RS, mock } = setup({
        adjustments: [...adjRows(1200, 'cy1'), ...adjRows(50, 'cy-OTHER')],
    });
    const rows = await RS.fetchAdjustments('cy1');
    assert.ok(rows.every(r => r.cycle_id === 'cy1'), 'มีแถวของรอบอื่นหลุดเข้ามา');
    const ops = findOps(mock, { table: 'stock_adjustments', op: 'select' });
    for (const op of ops) {
        assert.ok((op.filters || []).some(f => f.type === 'eq' && f.col === 'cycle_id'),
            'ทุกหน้าต้องกรอง cycle_id');
    }
});

test('[paging] ผลลัพธ์ยังเรียงใหม่ → เก่า ตามสัญญาเดิมของฟังก์ชัน', async () => {
    // แบ่งหน้าต้องเรียงด้วย id แต่ค่าที่คืนออกไปต้องยังเป็น created_at DESC เหมือนเดิม
    const { RS } = setup({
        adjustments: [
            { id: 'a', cycle_id: 'cy1', sku_id: 'A', adjustment_qty: 1, created_at: '2026-08-01T00:00:00Z' },
            { id: 'b', cycle_id: 'cy1', sku_id: 'B', adjustment_qty: 1, created_at: '2026-08-12T00:00:00Z' },
            { id: 'c', cycle_id: 'cy1', sku_id: 'C', adjustment_qty: 1, created_at: '2026-08-05T00:00:00Z' },
        ],
    });
    const rows = await RS.fetchAdjustments('cy1');
    assert.equal(rows.map(r => r.sku_id).join(','), 'B,C,A');
});

test('[paging] แถวพอดี 1,000 ต้องยิงหน้าที่ 2 เพื่อยืนยันว่าหมดจริง', async () => {
    const { RS, mock } = setup({ adjustments: adjRows(PAGE) });
    const rows = await RS.fetchAdjustments('cy1');
    assert.equal(rows.length, PAGE);
    assert.equal(findOps(mock, { table: 'stock_adjustments', op: 'select' }).length, 2,
        'ได้เต็มหน้าพอดี = ยังไม่รู้ว่าหมด ต้องถามต่ออีกหน้า');
});

test('[paging] การยืนยัน 2,100 รายการ ต้องได้ครบ และเรียงด้วย sku_id', async () => {
    // ตารางนี้ PK = (cycle_id, sku_id) ไม่มีคอลัมน์ id — sku_id คือคีย์ที่ unique ในรอบ
    const acceptances = Array.from({ length: 2100 }, (_, i) => ({
        cycle_id: 'cy1',
        sku_id: `ACK${String(i + 1).padStart(5, '0')}`,
        note: null,
        accepted_at: '2026-08-11T03:00:00Z',
        accepted_by: 'BAM',
    }));
    const { RS, mock } = setup({ acceptances });
    const map = await RS.fetchMatchAcceptanceMap('cy1');
    assert.equal(map.size, 2100, 'ยืนยันหายไป = หน้า Match จะเตือนซ้ำรายการที่คนตัดสินไปแล้ว');
    const ops = findOps(mock, { table: 'reconciliation_match_acceptances', op: 'select' });
    assert.equal(ops.length, 3);
    for (const op of ops) {
        assert.ok((op.modifiers || []).some(m => m.type === 'order' && m.col === 'sku_id'),
            'ไม่มี id ให้เรียง ต้องเรียง sku_id แทน ไม่งั้นแบ่งหน้าแล้วข้ามแถว');
    }
});

test('[paging] ตารางการยืนยันยังไม่ถูกสร้าง = คืน Map ว่าง ไม่ใช่โยน error', async () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    sb.apiService = {
        getClient: () => ({
            from: () => ({
                select: () => ({
                    eq: () => ({
                        order: () => ({
                            range: async () => ({
                                data: null,
                                error: { message: 'relation "reconciliation_match_acceptances" does not exist' },
                            }),
                        }),
                    }),
                }),
            }),
        }),
    };
    const map = await sb.reconcileService.fetchMatchAcceptanceMap('cy1');
    assert.equal(map.size, 0, 'ระบบที่ยังไม่ได้รัน migration 008 ต้องใช้งานต่อได้');
});
