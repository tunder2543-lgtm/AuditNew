// Dry Run: fetchBookNamesBySkusAnyCycle — แหล่งชื่อสินค้าตอน "สร้างลง Book" จาก count_only
//
// ที่มา: ถอดฟีเจอร์ SKU Master ออกจากเว็บ (2026-08-10) จึงต้องเปลี่ยนแหล่งชื่อสินค้า
// จากตาราง `sku_master` มาเป็น `book_stock_lines` ของรอบอื่น
//
// ⚠️ ทำไมตัดทิ้งเฉย ๆ ไม่ได้: `Html/reconcile.html` มี fallback `skuNameMap[sku]` เขียนไว้
// เหมือนว่ากันไว้แล้ว แต่มัน **ตายสนิท** — `canAddToBookLine` บังคับ `!bookSkuSet.has(sku)`
// และทั้ง `skuNameMap` กับ `bookSkuSet` มาจาก book_stock_lines ของ cycle เดียวกัน
// ⇒ SKU ที่กดปุ่มได้ย่อมไม่มีคีย์ใน map ⇒ ถ้าไม่มีแหล่งใหม่ name_pro จะเป็น null 100%
// และเขียนลง DB ถาวร (ระบบไม่มี UI แก้ book_stock_lines.name_pro รายแถว)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';

suite('dry-run: ชื่อสินค้าตอนสร้างลง Book (แทนที่ sku_master)');

function setup(bookRows) {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const mock = createMockClient({ book_stock_lines: bookRows });
    sb.apiService = { getClient: () => mock };
    return { RS: sb.reconcileService, mock };
}

test('[book-name] เอาชื่อจากรอบล่าสุดเมื่อ SKU เดียวกันมีหลายรอบชื่อต่างกัน', async () => {
    const { RS } = setup([
        { id: 1, sku_id: 'A1', name_pro: 'ชื่อเก่าสุด', created_at: '2026-05-01T00:00:00Z' },
        { id: 2, sku_id: 'A1', name_pro: 'ชื่อล่าสุด', created_at: '2026-07-01T00:00:00Z' },
        { id: 3, sku_id: 'A1', name_pro: 'ชื่อกลาง', created_at: '2026-06-01T00:00:00Z' },
    ]);
    const map = await RS.fetchBookNamesBySkusAnyCycle(['A1']);
    assert.equal(map.A1, 'ชื่อล่าสุด', 'ต้องเรียง created_at DESC แล้วเก็บตัวแรก');
});

test('[book-name] ข้ามแถวที่ name_pro ว่าง/null — ไม่บันทึกชื่อว่างทับของจริง', async () => {
    const { RS } = setup([
        { id: 1, sku_id: 'B2', name_pro: null, created_at: '2026-07-01T00:00:00Z' },
        { id: 2, sku_id: 'B2', name_pro: '   ', created_at: '2026-06-01T00:00:00Z' },
        { id: 3, sku_id: 'B2', name_pro: '  ชื่อจริง  ', created_at: '2026-05-01T00:00:00Z' },
    ]);
    const map = await RS.fetchBookNamesBySkusAnyCycle(['B2']);
    assert.equal(map.B2, 'ชื่อจริง', 'ต้องข้าม null/ช่องว่าง และ trim ค่าที่ได้');
});

test('[book-name] normalize SKU ทั้งขาเข้าและขาออก (invariant: UPPERCASE + trim)', async () => {
    const { RS, mock } = setup([
        { id: 1, sku_id: 'ABC123', name_pro: 'สินค้า ก', created_at: '2026-07-01T00:00:00Z' },
    ]);
    const map = await RS.fetchBookNamesBySkusAnyCycle(['  abc123  ']);
    assert.equal(map.ABC123, 'สินค้า ก', 'คีย์ผลลัพธ์ต้องเป็น SKU ที่ normalize แล้ว');

    const inFilter = findOps(mock, { table: 'book_stock_lines', op: 'select' })[0]
        .filters.find(f => f.type === 'in');
    assert.deepEqual(inFilter.vals, ['ABC123'], 'ค่าที่ส่งไป query ต้อง normalize ก่อน');
});

test('[book-name] SKU ที่ไม่มีใน Book รอบไหนเลย = ไม่มีคีย์ (ปลายทางจะได้ null)', async () => {
    const { RS } = setup([
        { id: 1, sku_id: 'A1', name_pro: 'มีชื่อ', created_at: '2026-07-01T00:00:00Z' },
    ]);
    const map = await RS.fetchBookNamesBySkusAnyCycle(['A1', 'NOPE']);
    assert.equal(map.A1, 'มีชื่อ');
    assert.equal(map.NOPE, undefined, 'ไม่ควรมีคีย์ปลอม');
});

test('[book-name] input ว่าง/ไม่มี client → คืน {} ไม่ throw และไม่ยิง query', async () => {
    const { RS, mock } = setup([]);
    // ⚠️ ใช้ Object.keys ไม่ใช่ deepEqual — map ถูกสร้างใน realm ของ sandbox
    //    prototype จึงคนละตัวกับ {} ในไฟล์นี้ deepStrictEqual จะ fail แบบเข้าใจผิด
    assert.equal(Object.keys(await RS.fetchBookNamesBySkusAnyCycle([])).length, 0);
    assert.equal(Object.keys(await RS.fetchBookNamesBySkusAnyCycle(null)).length, 0);
    assert.equal(findOps(mock, { table: 'book_stock_lines' }).length, 0);
});

test('[book-name] DB error → คืน {} ไม่ throw (ชื่อไม่ใช่ข้อมูลบังคับ ห้ามบล็อกการสร้าง Book)', async () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    sb.apiService = {
        getClient: () => ({
            from() {
                const q = {
                    select: () => q, in: () => q, not: () => q, order: () => q, range: () => q,
                    then: (res) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(res),
                };
                return q;
            },
        }),
    };
    const map = await sb.reconcileService.fetchBookNamesBySkusAnyCycle(['A1']);
    assert.equal(Object.keys(map).length, 0, 'error ต้องถูกกลืน แล้วคืน map ว่าง');
});

test('[book-name] ไม่ query ตาราง sku_master อีกแล้ว', async () => {
    const { RS, mock } = setup([
        { id: 1, sku_id: 'A1', name_pro: 'x', created_at: '2026-07-01T00:00:00Z' },
    ]);
    await RS.fetchBookNamesBySkusAnyCycle(['A1']);
    assert.equal(findOps(mock, { table: 'sku_master' }).length, 0,
        'ฟีเจอร์ SKU Master ถูกถอดออกแล้ว — ห้ามมี query กลับมา');
});

test('[book-name] reconcile.html เลิกใช้ skuNameMap เป็น fallback ตอนสร้าง Book (dead fallback)', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'reconcile.html'), 'utf8');

    for (const fn of ['async function addBookLine', 'async function bulkAddBookLines']) {
        const start = src.indexOf(fn);
        assert.ok(start > 0, `หาไม่เจอ: ${fn}`);
        const body = src.slice(start, start + 4000);
        // ⚠️ อย่าเขียน pattern ให้แคบกว่านี้ — รุ่นแรกใช้ `[\w.]*` ก่อน `||` ซึ่งไม่ครอบ `[` `]`
        //    จึงจับ `masterNames[sku] || skuNameMap[sku]` (รูปแบบจริงที่เคยมีในโค้ด) ไม่ได้เลย
        //    พิสูจน์ด้วย mutation แล้วว่าเทสผ่านฉลุยทั้งที่ fallback ถูกใส่กลับเข้าไป
        assert.ok(
            !/namePro:[^\n;]*skuNameMap/.test(body),
            `${fn}: ยังใช้ skuNameMap เป็น fallback ของ namePro — มันตายสนิท ` +
            `(canAddToBookLine บังคับว่า SKU นี้ยังไม่มีใน Book รอบนี้ ⇒ skuNameMap ไม่มีคีย์)`
        );
        assert.ok(
            body.includes('fetchBookNamesBySkusAnyCycle'),
            `${fn}: ต้องดึงชื่อจาก fetchBookNamesBySkusAnyCycle`
        );
    }
});

test('[book-name] มี .order("id") เป็น tiebreak (invariant ข้อ 13 — query นี้ใช้ .range())', async () => {
    const { RS, mock } = setup([
        { id: 1, sku_id: 'A1', name_pro: 'x', created_at: '2026-07-01T00:00:00Z' },
    ]);
    await RS.fetchBookNamesBySkusAnyCycle(['A1']);
    const q = findOps(mock, { table: 'book_stock_lines', op: 'select' })[0];
    const orders = q.modifiers.filter(m => m.type === 'order').map(m => m.col);
    assert.deepEqual(orders, ['created_at', 'id'],
        'ต้องเรียง created_at ก่อน แล้ว id เป็น tiebreak — created_at ซ้ำกันได้จาก bulk insert');
    assert.ok(q.modifiers.some(m => m.type === 'range'), 'ต้องแบ่งหน้าด้วย .range()');
});

test('[book-name] แบ่งหน้าต่อจนกว่าจะได้ชื่อครบ — ไม่ปล่อยให้ max-rows ตัดแถวเก่าทิ้ง', async () => {
    // จำลอง: SKU 'OLD' มีชื่ออยู่ในแถวที่ 1,001 เท่านั้น (หน้าแรกเต็มไปด้วยแถวของ SKU อื่น)
    const rows = [];
    for (let i = 0; i < 1000; i++) {
        rows.push({ id: i + 1, sku_id: 'NEW', name_pro: 'ชื่อใหม่', created_at: '2026-07-01T00:00:00Z' });
    }
    rows.push({ id: 2000, sku_id: 'OLD', name_pro: 'ชื่อเก่า', created_at: '2026-01-01T00:00:00Z' });

    const { RS, mock } = setup(rows);
    const map = await RS.fetchBookNamesBySkusAnyCycle(['NEW', 'OLD']);
    assert.equal(map.NEW, 'ชื่อใหม่');
    assert.equal(map.OLD, 'ชื่อเก่า', 'ถ้าไม่ดึงหน้าที่ 2 SKU นี้จะไม่ได้ชื่อ');
    assert.ok(findOps(mock, { table: 'book_stock_lines', op: 'select' }).length >= 2,
        'ต้องยิง query มากกว่า 1 หน้า');
});

test('[book-name] หยุดดึงหน้าถัดไปทันทีที่ได้ชื่อครบทุก SKU (ไม่ไล่ทั้งตาราง)', async () => {
    const rows = [];
    for (let i = 0; i < 1500; i++) {
        rows.push({ id: i + 1, sku_id: 'A1', name_pro: 'ชื่อ', created_at: '2026-07-01T00:00:00Z' });
    }
    const { RS, mock } = setup(rows);
    await RS.fetchBookNamesBySkusAnyCycle(['A1']);
    assert.equal(findOps(mock, { table: 'book_stock_lines', op: 'select' }).length, 1,
        'ได้ชื่อครบตั้งแต่หน้าแรกแล้ว ต้องไม่ยิงหน้าที่ 2');
});
