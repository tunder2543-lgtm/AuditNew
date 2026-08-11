// Dry Run: ชุด "รอบต้องถูกต้อง" — M1 + M24
//
// M1: `cycle_config` ใช้ `.limit(10000)` / `.limit(5000)` บน `inventory_counts`
//     แต่ Supabase hosted จำกัด max-rows ไว้ที่ 1,000 และ **ตัดเงียบ ๆ**
//     ⇒ วัน/เดือนที่มีการนับจริงหายจาก dropdown โดยไม่มีอะไรเตือน
//     ⇒ ผูกผลนับเข้ารอบได้ไม่ครบ
//
// M24: `isCycleRelevantNow()` ดูแค่ช่วงเวลา ไม่ดู `status`
//      ⇒ รอบที่ปิดไปแล้วแต่ยังอยู่ในเดือนปัจจุบัน ยังรับผลนับใหม่ได้
//      ⇒ ข้อมูลไหลเข้ารอบที่ reconcile/ปรับยอดไปแล้ว = ยอดที่สรุปแล้วเปลี่ยนย้อนหลัง
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('dry-run: ขอบเขตรอบนับ (M1 แบ่งหน้า · M24 รอบปิด)');

function setup(rows = [], rpcResults = {}) {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({ inventory_counts: rows }, rpcResults);
    sb.apiService = { getClient: () => mock };
    return { RS: sb.reconcileService, mock, sb };
}

/** สร้างแถวนับปลอม n แถวในเดือนที่ระบุ กระจายตามวันที่ให้ */
function rowsFor(yearMonth, days, perDay) {
    const out = [];
    let id = 1;
    for (const d of days) {
        for (let i = 0; i < perDay; i++) {
            out.push({ id: id++, warehouse: 'ตึกกันตนา', created_at: `${yearMonth}-${d}T05:00:00.000Z` });
        }
    }
    return out;
}

// -----------------------------------------------------------------------------
// M1 — เดือน
// -----------------------------------------------------------------------------
test('[M1] fetchCountMonths ใช้ RPC ก่อน (คำนวณฝั่ง DB ไม่ติดเพดาน 1,000 แถว)', async () => {
    const { RS, mock } = setup([], { get_inventory_count_months: [{ year_month: '2026-08' }, { year_month: '2026-05' }] });
    const months = await RS.fetchCountMonths('ตึกกันตนา');
    assert.deepEqual([...months], ['2026-08', '2026-05']);
    assert.equal(findOps(mock, { table: 'inventory_counts' }).length, 0, 'มี RPC แล้วไม่ต้องไล่อ่านตาราง');
});

test('[M1] ไม่มี RPC → ตกมาแบ่งหน้า และต้องอ่านครบทุกหน้า', async () => {
    // 2,500 แถวใน 2 เดือน — ถ้าอ่านหน้าเดียว (1,000) เดือนที่ 2 จะหาย
    const rows = [
        ...rowsFor('2026-08', ['01'], 1500),
        ...rowsFor('2026-05', ['02'], 1000),
    ].map((r, i) => ({ ...r, id: i + 1 }));

    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({ inventory_counts: rows });
    mock.rpc = async () => ({ data: null, error: { message: 'function get_inventory_count_months does not exist' } });
    sb.apiService = { getClient: () => mock };

    const months = await sb.reconcileService.fetchCountMonths('');
    assert.deepEqual([...months].sort(), ['2026-05', '2026-08'],
        'เดือนที่อยู่หลังแถวที่ 1,000 ต้องไม่หาย');
    assert.ok(findOps(mock, { table: 'inventory_counts', op: 'select' }).length >= 3, 'ต้องอ่านมากกว่า 1 หน้า');
});

test('[M1] query เดือนต้องมี .order("id") เป็น tiebreak (invariant ข้อ 13)', async () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({ inventory_counts: rowsFor('2026-08', ['01'], 3) });
    mock.rpc = async () => ({ data: null, error: { message: 'function get_inventory_count_months does not exist' } });
    sb.apiService = { getClient: () => mock };
    await sb.reconcileService.fetchCountMonths('');
    const q = findOps(mock, { table: 'inventory_counts', op: 'select' })[0];
    const orders = q.modifiers.filter(m => m.type === 'order').map(m => m.col);
    assert.deepEqual(orders, ['created_at', 'id']);
    assert.ok(q.modifiers.some(m => m.type === 'range'), 'ต้องแบ่งหน้าด้วย .range() ไม่ใช่ .limit()');
});

// -----------------------------------------------------------------------------
// M1 — วัน
// -----------------------------------------------------------------------------
test('[M1] fetchCountDaysInMonth คืนวันครบแม้ข้อมูลเกิน 1 หน้า', async () => {
    // 1,800 แถว: วันที่ 01 จำนวนมาก แล้ววันที่ 20 อยู่ท้ายสุด (เกินหน้าแรก)
    const rows = [
        ...rowsFor('2026-08', ['01'], 1500),
        ...rowsFor('2026-08', ['20'], 300),
    ].map((r, i) => ({ ...r, id: i + 1 }));
    const { RS } = setup(rows);
    const days = await RS.fetchCountDaysInMonth('', '2026-08');
    assert.deepEqual([...days], ['01', '20'], 'วันที่อยู่หลังแถวที่ 1,000 ต้องไม่หาย (นี่คือหัวใจของ M1)');
});

test('[M1] กรองเฉพาะเดือนที่ขอ ไม่ปนเดือนอื่น', async () => {
    const rows = [
        ...rowsFor('2026-08', ['05'], 2),
        ...rowsFor('2026-07', ['09'], 2),
    ].map((r, i) => ({ ...r, id: i + 1 }));
    const { RS } = setup(rows);
    assert.deepEqual([...await RS.fetchCountDaysInMonth('', '2026-08')], ['05']);
});

test('[M1] ไม่มีข้อมูล → คืน [] ไม่ throw', async () => {
    const { RS } = setup([]);
    assert.equal((await RS.fetchCountDaysInMonth('', '2026-08')).length, 0);
    assert.equal((await RS.fetchCountDaysInMonth('', 'ไม่ใช่เดือน')).length, 0);
});

test('[M1] ไม่มี .limit() เกินเพดาน 1,000 หลงเหลือทั้งระบบ', () => {
    // ⚠️ สแกนทุกไฟล์ ไม่ใช่แค่ cycle_config — review รอบแรกจับได้ว่า `count_search.html`
    //    มีฟังก์ชันชื่อเดียวกัน บั๊กเดียวกัน แต่เทสเดิมมองแค่ไฟล์ที่ผมแก้จึงไม่เห็น
    const files = [
        ...fs.readdirSync(path.join(PROJECT_ROOT, 'Html')).map(f => path.join('Html', f)),
        ...fs.readdirSync(path.join(PROJECT_ROOT, 'Js')).map(f => path.join('Js', f)),
        'index.html',
    ].filter(f => /\.(html|js)$/.test(f));

    const bad = [];
    for (const rel of files) {
        const raw = fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
        // ตัดคอมเมนต์ก่อน — คอมเมนต์ที่อธิบายบั๊กเดิมมีข้อความ `.limit(10000)` อยู่
        const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
        for (const m of src.matchAll(/\.limit\((\d+)\)/g)) {
            if (Number(m[1]) > 1000) bad.push(`${rel}: .limit(${m[1]})`);
        }
    }
    assert.ok(files.length > 20, 'สแกนได้ไฟล์น้อยผิดปกติ — เทสนี้อาจไม่ได้ยามจริง');
    assert.deepEqual(bad, [],
        `เกินเพดาน max-rows ของ Supabase (1,000) จะถูกตัดเงียบ ๆ:\n  ${bad.join('\n  ')}`);
});

test('[M1] fetchCountMonths ต้องไม่ยัดค่า encode ("คลังทั้งหมด" / "A|B") เข้า RPC ดิบ ๆ', async () => {
    // RPC เทียบ `warehouse = p_warehouse` ตรง ๆ จึงรับได้แค่ชื่อคลังจริงตัวเดียว
    // ถ้าส่งค่า encode เข้าไป จะไม่ match อะไรเลย = ได้ 0 เดือนทั้งที่มีข้อมูลเป็นหมื่นแถว
    // (นี่คือ regression ที่ review จับได้ — แย่กว่าบั๊ก M1 เดิมที่อย่างน้อยยังได้ 1,000 แถวแรก)
    const seen = [];
    const byWarehouse = {
        'ตึกกันตนา': [{ year_month: '2026-08' }],
        'คลังอะไหล่': [{ year_month: '2026-06' }],
    };
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({ inventory_counts: [] });
    mock.rpc = async (fn, params) => {
        seen.push(params.p_warehouse);
        return { data: params.p_warehouse == null
            ? [{ year_month: '2026-08' }, { year_month: '2026-06' }]
            : (byWarehouse[params.p_warehouse] || []), error: null };
    };
    sb.apiService = { getClient: () => mock };
    const RS = sb.reconcileService;

    assert.deepEqual([...await RS.fetchCountMonths(RS.ALL_WAREHOUSES)], ['2026-08', '2026-06'],
        'ทุกคลัง → ต้องส่ง null ให้ RPC ไม่ใช่สตริง "คลังทั้งหมด"');
    assert.deepEqual(seen, [null]);

    seen.length = 0;
    const multi = await RS.fetchCountMonths('ตึกกันตนา|คลังอะไหล่');
    assert.deepEqual([...multi], ['2026-08', '2026-06'], 'หลายคลัง → ต้องรวมผลของทุกคลัง');
    assert.deepEqual(seen, ['ตึกกันตนา', 'คลังอะไหล่'], 'ต้องยิงทีละคลังจริง ไม่ใช่ส่งสตริง "A|B"');
});

// -----------------------------------------------------------------------------
// M24
// -----------------------------------------------------------------------------
const THIS_MONTH_CYCLE = (status) => ({
    id: 'cy-1',
    warehouse: 'ตึกกันตนา',
    year_month: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7),
    status
});

test('[M24] รอบที่ปิดแล้วต้องไม่รับผลนับใหม่ แม้ยังอยู่ในเดือนปัจจุบัน', () => {
    const { RS } = setup([]);
    assert.equal(RS.isCycleRelevantNow(THIS_MONTH_CYCLE('open')), true, 'รอบเปิดต้องยังใช้ได้');
    assert.equal(RS.isCycleRelevantNow(THIS_MONTH_CYCLE('closed')), false, 'ปิดรอบแล้วห้ามรับผลนับ');
    assert.equal(RS.isCycleRelevantNow(THIS_MONTH_CYCLE('archived')), false);
});

test('[M24] สถานะระหว่างทาง (counting/reconciling/draft) ยังรับผลนับได้', () => {
    const { RS } = setup([]);
    for (const st of ['counting', 'reconciling', 'draft', '', null, undefined]) {
        assert.equal(RS.isCycleRelevantNow(THIS_MONTH_CYCLE(st)), true, `status=${st} ไม่ควรถูกบล็อก`);
    }
});

test('[M24] isCycleClosed ทนช่องว่าง/ตัวพิมพ์', () => {
    const { RS } = setup([]);
    assert.equal(RS.isCycleClosed({ status: '  CLOSED ' }), true);
    assert.equal(RS.isCycleClosed({ status: 'Archived' }), true);
    assert.equal(RS.isCycleClosed({ status: 'open' }), false);
    assert.equal(RS.isCycleClosed({}), false);
    assert.equal(RS.isCycleClosed(null), false);
});

test('[M24] getCycleIdForWarehouse ไม่แนบ cycle_id ของรอบที่ปิด', () => {
    const { RS, sb } = setup([]);
    sb.localStorage.setItem('active_count_cycle_v1', JSON.stringify(THIS_MONTH_CYCLE('closed')));
    assert.equal(RS.getCycleIdForWarehouse('ตึกกันตนา'), null,
        'นี่คือจุดที่ M24 ทำอันตราย — แถวใหม่จะถูกแนบเข้ารอบที่ปิดไปแล้ว');
    sb.localStorage.setItem('active_count_cycle_v1', JSON.stringify(THIS_MONTH_CYCLE('open')));
    assert.equal(RS.getCycleIdForWarehouse('ตึกกันตนา'), 'cy-1');
});

test('[M24][behaviour] dropdown หน้านับต้องกรองรอบที่ปิดออกด้วย (ต้องทำคู่กับ guard)', () => {
    // ⚠️ ห้ามกลับไปเป็นเทสอ่านซอร์ส — รุ่นแรกเช็คแค่ว่ามีคำว่า `isCycleClosed` อยู่ใกล้ ๆ
    //    review ลบ `.filter()` ที่ใช้จริงออกโดยเก็บบรรทัดประกาศไว้ แล้วเทสยังเขียว 294/294
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'script.js'), 'utf8');
    const { RS } = setup([]);
    const ym = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
    const { filterCyclesCurrentMonth } = liftFunctions(src, ['filterCyclesCurrentMonth', 'getCurrentYearMonthBangkok'], {
        window: { reconcileService: { isCycleClosed: RS.isCycleClosed } },
    });

    const kept = filterCyclesCurrentMonth([
        { id: 'a', year_month: ym, status: 'open' },
        { id: 'b', year_month: ym, status: 'closed' },
        { id: 'c', year_month: ym, status: 'archived' },
        { id: 'd', year_month: '2020-01', status: 'open' },
    ]);
    assert.deepEqual(kept.map(c => c.id), ['a'],
        'ถ้ากรองแค่ฝั่ง guard ผู้ใช้จะเลือกรอบที่ปิดได้ แต่ระบบเงียบ ๆ ไม่แนบ แล้ววนเตือนซ้ำ');

    // ทน reconcileService ยังไม่โหลด (ลำดับ <script>) — ต้องไม่ throw
    const noRS = liftFunctions(src, ['filterCyclesCurrentMonth', 'getCurrentYearMonthBangkok'], { window: {} });
    assert.equal(noRS.filterCyclesCurrentMonth([{ id: 'a', year_month: ym }]).length, 1);
});

test('[M24] ข้อความเตือนต้องแยก "รอบปิดแล้ว" ออกจาก "ข้ามเดือนแล้ว"', () => {
    // isCycleRelevantNow คืน false ได้ 2 เหตุผลหลัง M24 — ถ้าบอกเหมารวม ผู้ใช้จะไปหาสาเหตุผิดทาง
    for (const [rel, marker] of [['Js/script.js', 'ensureCycleStillValid'], ['Html/import_counts.html', 'getImportCycleHint']]) {
        const src = fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
        const at = src.indexOf(marker);
        assert.ok(at > 0, `หา ${marker} ใน ${rel} ไม่เจอ`);
        const body = src.slice(at, at + 1600);
        assert.ok(/isCycleClosed/.test(body) && /ปิดแล้ว/.test(body), `${rel} ยังบอกเหตุผลเหมารวม`);
    }
});
