// Dry Run: ชุด "หน้านับสต็อก" — M8 + M10 + M32
//
// M8: guard ตอนแก้ไขในหน้านับบล็อกทุกแถวที่ SKU+ตำแหน่ง+คลังตรงกัน **โดยไม่ดูจำนวน**
//     แต่ invariant ข้อ 3 บอกว่า "ตำแหน่งเดียวกัน จำนวนต่างกัน = การทำงานปกติ" (นับแยกถุง)
//     ⇒ ระบบบล็อกงานที่ถูกต้องของพนักงาน · แถมเช็คจาก allRecords ที่โหลดเฉพาะ scope
//     ⇒ เลือกคลังคนละอันได้คำตอบคนละอย่าง
//
// M10: ระหว่าง Book ยังโหลดไม่เสร็จ KPI แสดง 0 / 0% ซึ่งอ่านได้ว่า "นับครบแล้ว"
//
// M32: วน insert รายแถวไม่มีเงื่อนไขเลิก — เน็ตตายก็ยิงต่อจนครบทุกแถว UI ค้างยาว
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('dry-run: หน้านับสต็อก (M8 guard แก้ไข · M10 KPI · M32 circuit breaker)');

const SCRIPT = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'script.js'), 'utf8');
const IMPORT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'import_counts.html'), 'utf8');

const normalizeSkuKey = v => String(v ?? '').trim().toUpperCase();

function liftEditGuard({ dbRows = [], myCycle = 'cyc-1', cache = [] } = {}) {
    const mock = createMockClient({ inventory_counts: dbRows });
    const dedupe = loadFresh('Js/audit-dedupe.js').AuditDedupe;
    const countScan = loadFresh('Js/count-scan-shared.js').countScanService;

    // แถวที่กำลังแก้ — `.maybeSingle()` ต้องเคารพ `.eq('id', ...)` จริง
    // (เทสรุ่นแรก override ทับทุกตารางโดยไม่สนใจ filter ⇒ เปลี่ยน .eq('id') เป็นอะไรก็รอด)
    const origFrom = mock.from.bind(mock);
    mock.from = (table) => {
        const q = origFrom(table);
        q.maybeSingle = async () => {
            const idFilter = q._filters?.find(f => f.col === 'id');
            if (!idFilter) return { data: null, error: { message: 'maybeSingle ต้องกรองด้วย id' } };
            const hit = dbRows.find(r => String(r.id) === String(idFilter.val));
            return { data: hit ? { cycle_id: hit.cycle_id } : { cycle_id: myCycle }, error: null };
        };
        return q;
    };

    const fns = liftFunctions(SCRIPT, [
        'getEditDestinationCollision', 'bangkokMonthOfIso', 'nowIsoForCompare', 'scopeNoCycleRowsToSameMonth',
    ], {
        supabaseClient: mock,
        normalizeSkuKey,
        normalizeLocKey: v => String(v ?? '').trim().toUpperCase(),
        allRecords: cache,
        console: { error() {}, warn() {} },
        window: { AuditDedupe: dedupe, countScanService: countScan },
    });
    return { ...fns, mock };
}

const row = o => ({
    id: 'r1', sku_id: 'A-01', location: 'B2-01', counted_qty: 70,
    warehouse: 'ตึกกันตนา', cycle_id: 'cyc-1', created_at: '2026-08-05T03:00:00Z', ...o,
});

// -----------------------------------------------------------------------------
// M8
// -----------------------------------------------------------------------------
test('[M8] ตำแหน่งเดียวกัน จำนวนต่างกัน = นับแยกถุง ต้องไม่บล็อก (invariant ข้อ 3)', async () => {
    // เคสจริงในฐาน: BNP20 @ B2-01 = 70 + 200 = Book 270 เป๊ะ
    const g = liftEditGuard({ dbRows: [row({ id: 'ถุงแรก', counted_qty: 70 })] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.equal(coll, null, 'ระบบบล็อกงานที่ถูกต้องของพนักงาน — migration 011 อนุญาตระดับ DB ด้วย');
});

test('[M8] ค่าเหมือนกันครบทุกช่องในรอบเดียวกัน = ซ้ำจริง ต้องบล็อก', async () => {
    const g = liftEditGuard({ dbRows: [row({ id: 'มีอยู่แล้ว', counted_qty: 200 })] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.ok(coll?.blocked, 'รอบ+คลัง+SKU+ตำแหน่ง+จำนวนเท่ากันหมด = ซ้ำจริง');
    assert.match(coll.message, /รอบนับเดียวกัน/);
});

test('[M8] ค่าเหมือนกันแต่คนละรอบนับ = เตือน ไม่บล็อก', async () => {
    const g = liftEditGuard({ dbRows: [row({ id: 'รอบเก่า', counted_qty: 200, cycle_id: 'cyc-เก่า' })] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.equal(coll?.blocked, false, 'คนละรอบถือเป็นข้อมูลถูกต้อง (migration 011)');
    assert.ok(coll?.warning);
});

test('[M8] ต้องถาม DB ไม่ใช่ดูแต่ allRecords ที่โหลดเฉพาะ scope', async () => {
    // cache ว่าง (ผู้ใช้เลือกคลัง/เดือนอื่นอยู่) แต่ DB มีแถวที่ชนจริง
    const g = liftEditGuard({ dbRows: [row({ id: 'นอก scope', counted_qty: 200 })], cache: [] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.ok(coll?.blocked, 'ถ้าดูแต่ cache จะมองไม่เห็นแถวนี้แล้วปล่อยผ่าน');

    const q = findOps(g.mock, { table: 'inventory_counts', op: 'select' })[0];
    assert.ok(q, 'ต้องยิง query จริง');
    assert.ok(q.filters.some(f => f.type === 'eq' && f.col === 'sku_id'), 'แคบด้วย sku_id ฝั่ง DB ได้');
    assert.ok(q.filters.some(f => f.type === 'eq' && f.col === 'counted_qty'), 'แคบด้วยจำนวนด้วย');
    assert.ok(!q.filters.some(f => f.col === 'location'),
        'ห้ามกรอง location ฝั่ง DB — ฐานจริงมีตัวพิมพ์เล็กปนอยู่');
    assert.ok(q.modifiers.some(m => m.type === 'order' && m.col === 'id'), 'invariant ข้อ 13');
});

test('[M8] ตำแหน่งตัวพิมพ์เล็กใน DB ต้องยังถูกจับว่าชน', async () => {
    const g = liftEditGuard({ dbRows: [row({ id: 'เล็ก', location: 'b2-01', counted_qty: 200 })] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'x');
    assert.ok(coll?.blocked);
});

test('[M8] คนละคลัง ต้องไม่ชนกัน', async () => {
    const g = liftEditGuard({ dbRows: [row({ id: 'คลังอื่น', counted_qty: 200, warehouse: 'คลังอะไหล่' })] });
    assert.equal(await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'x'), null);
});

test('[M8] แถวที่ยังไม่ผูกรอบ ต้องนับเป็นรอบเดียวกันเฉพาะเดือนไทยเดียวกัน', async () => {
    // cycleKey(null) เป็นค่าเดียวทั้งฐาน ⇒ ถ้าไม่จำกัดเดือน แถวปีที่แล้วจะบล็อกงานเดือนนี้
    const มีค = liftEditGuard({
        dbRows: [row({ id: 'มี.ค.', counted_qty: 200, cycle_id: null, created_at: '2026-03-02T03:00:00Z' })],
        myCycle: null,
        cache: [{ id: 'กำลังแก้', created_at: '2026-08-05T03:00:00Z' }],
    });
    const r1 = await มีค.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.equal(r1?.blocked, false, 'คนละเดือน + ไม่มีรอบทั้งคู่ = คนละรอบ');

    const สค = liftEditGuard({
        dbRows: [row({ id: 'ส.ค.', counted_qty: 200, cycle_id: null, created_at: '2026-08-09T03:00:00Z' })],
        myCycle: null,
        cache: [{ id: 'กำลังแก้', created_at: '2026-08-05T03:00:00Z' }],
    });
    const r2 = await สค.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.ok(r2?.blocked, 'เดือนเดียวกัน = ถือเป็นรอบเดียวกัน');
});

test('[M8] ต้องแบ่งหน้า — แถวที่ชนอยู่หลังแถวที่ 1,000 ห้ามหลุด', async () => {
    // PostgREST ตัดที่ 1,000 แถวเงียบ ๆ และเพราะเรียงตาม id ขึ้น แถวที่ถูกตัดคือ "แถวใหม่สุด"
    // ซึ่งคือแถวรอบปัจจุบันที่ guard มีไว้จับพอดี (บทเรียน M1 — review ชุด 5 จับได้)
    const filler = Array.from({ length: 1200 }, (_, i) => row({
        id: `f${String(i).padStart(5, '0')}`, location: `ที่อื่น-${i}`, counted_qty: 200,
    }));
    const g = liftEditGuard({ dbRows: [...filler, row({ id: 'zzz-ท้ายสุด', counted_qty: 200 })] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.ok(coll?.blocked, 'อ่านหน้าเดียว = แถวที่ชนจริงหลุด แล้วเกิดแถวซ้ำในรอบเดียวกัน');

    const q = findOps(g.mock, { table: 'inventory_counts', op: 'select' })[0];
    assert.ok(q.modifiers.some(m => m.type === 'range'), 'ต้องใช้ .range() ไม่ใช่ query เดียวจบ');
});

test('[M8] ไม่รู้คลังของแถวที่แก้ แต่ปลายทางมีของอยู่ ต้องบล็อก (เกณฑ์เดียวกับ audit_check)', async () => {
    const g = liftEditGuard({ dbRows: [row({ id: 'ปลายทาง', counted_qty: 200 })] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', '', 200, 'กำลังแก้');
    assert.ok(coll?.blocked, 'เดิมยอมรับทุกคลังเป็นปลายทาง = ตัดสินไม่ได้แต่ปล่อยผ่าน');
    assert.match(coll.message, /เลือกคลัง/);
});

test('[M8] query แถวที่กำลังแก้ ต้องกรองด้วย id จริง', async () => {
    const g = liftEditGuard({
        dbRows: [row({ id: 'กำลังแก้', cycle_id: 'cyc-1', counted_qty: 200, location: 'ที่อื่น' }),
                 row({ id: 'ปลายทาง', cycle_id: 'cyc-1', counted_qty: 200 })],
    });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'กำลังแก้');
    assert.ok(coll?.blocked, 'ถ้าอ่านรอบของแถวที่แก้ผิดตัว การชนรอบเดียวกันจะกลายเป็นแค่เตือน');
});

test('[M8] ไม่มีโมดูล AuditDedupe = ต้องบล็อก ไม่ใช่ปล่อยผ่าน', async () => {
    const mock = createMockClient({ inventory_counts: [row({ id: 'ปลายทาง', counted_qty: 200 })] });
    const origFrom = mock.from.bind(mock);
    mock.from = (t) => { const q = origFrom(t); q.maybeSingle = async () => ({ data: { cycle_id: 'cyc-1' }, error: null }); return q; };
    const f = liftFunctions(SCRIPT, ['getEditDestinationCollision'], {
        supabaseClient: mock,
        normalizeSkuKey,
        normalizeLocKey: v => String(v ?? '').trim().toUpperCase(),
        allRecords: [],
        console: { error() {}, warn() {} },
        window: {},                                  // ไม่มี AuditDedupe
    });
    const coll = await f.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 200, 'x');
    assert.ok(coll?.blocked);
});

test('[M8] ไม่รู้ว่ากำลังแก้แถวไหน ต้องบล็อกทันที ไม่ยิง query ที่ id ว่าง', async () => {
    const g = liftEditGuard({ dbRows: [] });
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 5, '');
    assert.ok(coll?.blocked);
    assert.equal(findOps(g.mock, { table: 'inventory_counts' }).length, 0);
});

test('[M8] ปุ่มยืนยันต้องกันกดซ้ำ + กันผลลัพธ์ที่ค้างมาจากแถวก่อนหน้า', () => {
    // เส้นทางนี้พันกับ DOM/โมดัลจนยกมารันตรง ๆ ไม่ได้ — บังคับที่ระดับ pattern แทน
    // (ไม่มีอะไรกั้น = ดับเบิลคลิกได้ audit log ซ้ำ · กดยกเลิกแล้วเปิดแถวอื่นได้ audit log เท็จ)
    assert.ok(/let edBusy = false;/.test(SCRIPT), 'ไม่มี flag กันเรียกซ้ำ');
    assert.ok(/if \(edBusy\) return;/.test(SCRIPT));
    assert.ok(/edBtn\.disabled = true/.test(SCRIPT), 'ไม่ได้ disable ปุ่มระหว่างรอ DB');
    assert.ok(/edGeneration \+= 1;/.test(SCRIPT), 'closeEdModal ต้อง bump generation');
    const staleChecks = [...SCRIPT.matchAll(/if \(edStaleSince\(myGen\)\) return;/g)];
    assert.equal(staleChecks.length, 2, `ต้องมียาม stale หลัง await ทั้ง 2 ขั้น แต่เจอ ${staleChecks.length}`);
});

test('[M8] ตรวจปลายทางไม่สำเร็จ ต้องบล็อก ไม่ปล่อยผ่านเงียบ ๆ', async () => {
    const g = liftEditGuard({ dbRows: [] });
    g.mock.from = () => { throw new Error('เน็ตหลุด'); };
    const coll = await g.getEditDestinationCollision('A-01', 'B2-01', 'ตึกกันตนา', 5, 'x');
    assert.ok(coll?.blocked, '"ตรวจไม่ได้" ไม่เท่ากับ "ไม่ชน"');
});

test('[M8] ต้องตรวจตอนแก้จำนวนด้วย ไม่ใช่เฉพาะตอนย้ายตำแหน่ง', () => {
    // แก้จำนวนให้ไปตรงกับแถวที่มีอยู่ ก็สร้างแถวซ้ำได้เหมือนกัน
    assert.ok(/if \(locChanged \|\| qtyChanged\)/.test(SCRIPT), 'ขั้นที่ 1 ยังตรวจเฉพาะตอนเปลี่ยนตำแหน่ง');
    assert.ok(/if \(locWillChange \|\| qtyWillChange\)/.test(SCRIPT), 'ขั้นที่ 2 ยังตรวจเฉพาะตอนเปลี่ยนตำแหน่ง');
    const calls = [...SCRIPT.matchAll(/(\w+\s+)?getEditDestinationCollision\(/g)]
        .filter(m => m[1]?.trim() !== 'function');   // ตัดบรรทัดประกาศฟังก์ชันออก
    assert.equal(calls.length, 2, `เจอ call site ${calls.length} จุด — เทสนี้ล้าสมัย`);
    for (const c of calls) assert.equal(c[1]?.trim(), 'await', 'ลืม await = ได้ Promise แล้ว coll.blocked เป็น undefined');
});

test('[M8] index ต้องโหลด audit-dedupe.js (ใช้เกณฑ์ซ้ำร่วมกับ audit_check)', () => {
    const html = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
    assert.match(html, /<script src="Js\/audit-dedupe\.js\?v=/,
        'ถ้าไม่โหลด classifyDestinationCollision จะเป็น undefined แล้วบล็อกทุกอย่าง');
});

// -----------------------------------------------------------------------------
// M10
// -----------------------------------------------------------------------------
/** stub DOM เล็ก ๆ พอให้ updateStats / refreshUncounted รันได้จริง */
function fakeDom(ids) {
    const els = {};
    for (const id of ids) els[id] = { id, textContent: '', title: '', innerHTML: '' };
    return { els, getElementById: id => els[id] || null };
}

function liftKpi({ cycleId = 'cyc-1', loadedFor = 'cyc-1', book = [], counted = [] } = {}) {
    const dom = fakeDom(['totalScanned', 'totalUncounted', 'progressPercent', 'uncountedListContainer']);
    const fns = liftFunctions(SCRIPT, ['updateStats', 'refreshUncounted'], {
        document: { getElementById: dom.getElementById },
        lucide: { createIcons() {} },
        activeCycleForPage: cycleId ? { id: cycleId } : null,
        bookSkuLoadedForCycleId: loadedFor,
        bookSkuList: book,
        getBookSkuKeySet: () => new Set(book.map(x => normalizeSkuKey(x.sku_name))),
        getWarehouseScopedRecords: () => counted,
        normalizeSkuKey,
        isTodayInThailand: () => true,
        totalScannedEl: dom.els.totalScanned,
        refreshDashboardSummary() {},
        renderUncountedList() {},
        uncountedItemsCache: [],
    });
    return { ...fns, els: dom.els };
}

const bookOf = (...names) => names.map(n => ({ sku_name: n }));
const countOf = (...names) => names.map(n => ({ sku_id: n, counted_qty: 1, created_at: '2026-08-11T03:00:00Z' }));

test('[M10][behaviour] ระหว่าง Book โหลด ต้องเป็น "—" ไม่ใช่ 0 / 0%', () => {
    const k = liftKpi({ cycleId: 'cyc-1', loadedFor: null, book: [], counted: countOf('A') });
    k.updateStats();
    assert.equal(k.els.totalUncounted.textContent, '—', '0 อ่านได้ว่า "นับครบแล้ว" ซึ่งตรงข้ามกับความจริง');
    assert.equal(k.els.progressPercent.textContent, '—');
    assert.match(k.els.progressPercent.title, /กำลังโหลด/);
});

test('[M10][behaviour] โหลดเสร็จแล้วต้องได้ตัวเลขจริง', () => {
    const k = liftKpi({ book: bookOf('A', 'B', 'C', 'D'), counted: countOf('A', 'B', 'C') });
    k.updateStats();
    assert.equal(k.els.totalUncounted.textContent, '1');
    assert.equal(k.els.progressPercent.textContent, '75%');
    assert.equal(k.els.progressPercent.title, '');
});

test('[M10][behaviour] รอบไม่มีรายการ Book เลย ต้องเป็น "—" ทั้งสองกล่อง', () => {
    // review ชี้ว่าเดิมกล่องซ้ายขึ้น 0 กล่องขวาขึ้น — = สองกล่องบอกคนละเรื่องในสถานะเดียวกัน
    const k = liftKpi({ book: [], counted: countOf('A') });
    k.updateStats();
    assert.equal(k.els.totalUncounted.textContent, '—');
    assert.equal(k.els.progressPercent.textContent, '—');
    assert.match(k.els.totalUncounted.title, /ยังไม่มีรายการ Book/);
});

test('[M10][behaviour] refreshUncounted ต้องไม่เขียนทับ badge เป็นเลขดิบระหว่างโหลด', () => {
    // กล่อง KPI นี้กดได้ (openUncountedDrawer) ⇒ ผู้ใช้ที่เห็น "—" แล้วกดดู จะได้ 0 กลับมา
    // แล้วรายการขึ้นว่า "ยังไม่มี Book — อัปโหลดที่เมนูตั้งค่ารอบ" ทั้งที่ไม่ต้องทำอะไร
    const k = liftKpi({ cycleId: 'cyc-1', loadedFor: null, book: [], counted: countOf('A') });
    k.refreshUncounted();
    assert.equal(k.els.totalUncounted.textContent, '—');
    assert.match(k.els.uncountedListContainer.innerHTML, /กำลังโหลดรายการ Book/);

    const ready = liftKpi({ book: bookOf('A', 'B'), counted: countOf('A') });
    ready.refreshUncounted();
    assert.equal(ready.els.totalUncounted.textContent, '1', 'พอโหลดเสร็จต้องได้เลขจริง');

    // ไม่มี Book เลย ก็ต้องเป็น "—" เหมือน updateStats ไม่ใช่ 0 (สองเส้นทางต้องพูดตรงกัน)
    const noBook = liftKpi({ book: [], counted: countOf('A') });
    noBook.refreshUncounted();
    assert.equal(noBook.els.totalUncounted.textContent, '—');
    assert.match(noBook.els.totalUncounted.title, /ยังไม่มีรายการ Book/);
});

test('[M10] ค่าเริ่มต้นใน HTML ต้องไม่ใช่ 0 / 0% ด้วย', () => {
    // ก่อน JS รันเสร็จผู้ใช้ก็เห็นค่าใน markup อยู่แล้ว — ถ้าเป็น 0/0% ก็โกหกตั้งแต่วินาทีแรก
    const html = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
    assert.ok(!/id="totalUncounted"[^>]*>0</.test(html), 'ค่าเริ่มต้นของ "ยังไม่นับ" ยังเป็น 0');
    assert.ok(!/id="progressPercent"[^>]*>0%</.test(html), 'ค่าเริ่มต้นของ % ยังเป็น 0%');
});

// -----------------------------------------------------------------------------
// M32
// -----------------------------------------------------------------------------
function liftInsertLoop(errorsByIndex) {
    let i = 0;
    const calls = [];
    const mock = {
        from() {
            const q = {
                insert(p) { this._p = p; return q; },
                select: async () => {
                    calls.push(i);
                    const err = errorsByIndex[i++] || null;
                    return err ? { data: null, error: err } : { data: [{ id: `id${i}` }], error: null };
                },
            };
            return q;
        },
    };
    const fns = liftFunctions(SCRIPT, ['insertGroupRowsOneByOne'], {
        supabaseClient: mock,
        NETWORK_FAIL_STREAK_LIMIT: 3,
        window: {
            DbErrors: {
                isDuplicateError: e => e?.code === '23505',
                isNetworkError: e => e?.kind === 'net',
                formatDbError: e => ({ message: e.message || 'x' }),
            },
        },
    });
    return { ...fns, calls };
}

test('[M32] เน็ตตายติดกัน 3 ครั้ง ต้องหยุดยิง ไม่ไล่จนครบทุกแถว', async () => {
    const net = { kind: 'net', message: 'network' };
    const g = liftInsertLoop([net, net, net, net, net, net, net, net, net, net]);
    const items = Array.from({ length: 10 }, (_, i) => ({ sku: `S${i}` }));
    const out = await g.insertGroupRowsOneByOne(items, items.map(() => ({})));

    assert.equal(g.calls.length, 3, `ยิงไป ${g.calls.length} ครั้ง — ต้องหยุดที่ 3`);
    assert.equal(out.aborted, true);
    assert.equal(out.failed.length, 10, 'แถวที่เหลือต้องอยู่ใน failed ไม่ใช่หายเงียบ');
    assert.match(out.failed[9].reason, /เชื่อมต่อฐานข้อมูลไม่ได้/);
});

test('[M32] error ที่ไม่ใช่เน็ต ต้องไม่หยุดทั้งชุด (แถวเสียแค่บางแถว)', async () => {
    const bad = { code: '23514', message: 'check violation' };
    const g = liftInsertLoop([bad, bad, bad, bad, bad]);
    const items = Array.from({ length: 5 }, (_, i) => ({ sku: `S${i}` }));
    const out = await g.insertGroupRowsOneByOne(items, items.map(() => ({})));
    assert.equal(g.calls.length, 5, 'ข้อมูลผิดรายแถว ต้องลองให้ครบ');
    assert.ok(!out.aborted);
});

test('[M32] สำเร็จคั่นกลาง ต้องรีเซ็ตตัวนับ', async () => {
    const net = { kind: 'net', message: 'network' };
    const g = liftInsertLoop([net, net, null, net, net, null]);
    const items = Array.from({ length: 6 }, (_, i) => ({ sku: `S${i}` }));
    const out = await g.insertGroupRowsOneByOne(items, items.map(() => ({})));
    assert.equal(g.calls.length, 6, 'ไม่ควรหยุด เพราะไม่เคยพลาดติดกันครบ 3');
    assert.equal(out.inserted.length, 2);
    assert.ok(!out.aborted);
});

test('[M32][behaviour] importRowsOneByOne หยุดจริงเมื่อเน็ตตายติดกัน 3 ครั้ง', async () => {
    let n = 0;
    const fns = liftFunctions(IMPORT, ['importRowsOneByOne'], {
        buildCountPayload: r => r,
        insertOneCountRow: async () => { n++; return { status: 'error', error: { kind: 'net', message: 'net' } }; },
        window: { DbErrors: { isNetworkError: e => e?.kind === 'net', formatDbError: e => ({ message: e.message }) } },
    });
    const rows = Array.from({ length: 20 }, (_, i) => ({
        sku: `S${i}`, loc: 'A', qty: 1, client_request_id: `k${i}`, import_batch_id: 'b1',
    }));
    const out = await fns.importRowsOneByOne(rows, 'คลัง', 'คน');
    assert.equal(n, 3, `ยิงไป ${n} ครั้ง — ต้องหยุดที่ 3`);
    assert.equal(out.aborted, true);
    assert.equal(out.failedRows.length, 20, 'แถวที่เหลือต้องอยู่ใน failedRows ไม่ใช่หายเงียบ');
    assert.equal(out.failedRows[19].client_request_id, 'k19', 'ต้องพาคีย์เดิมไปด้วย ไม่งั้น retry แทรกซ้ำ (M6)');
});

test('[M32] chunk loop ต้องหยุดเมื่อ chunk ก่อนหน้า abort', () => {
    // คืนค่า `aborted` มาเฉย ๆ ไม่พอ — ไฟล์หมื่นแถว = 50 chunk × 4 request ทั้งที่เน็ตตายตั้งแต่ chunk แรก
    const at = IMPORT.indexOf('for (let i = 0; i < rowsWithReqId.length; i += CHUNK_SIZE)');
    assert.ok(at > 0, 'หา chunk loop ไม่เจอ');
    const body = IMPORT.slice(at, IMPORT.indexOf('lastImportFailedRows', at));
    assert.ok(/if \(chunkResult\.aborted\)/.test(body), '`aborted` ยังเป็นค่า write-only');
    assert.ok(/break;/.test(body));
    const stop = body.slice(body.indexOf('if (chunkResult.aborted)'));
    assert.ok(/client_request_id: r\.client_request_id/.test(stop),
        'แถวของ chunk ที่ยังไม่ได้ยิง ต้องเก็บคีย์ไว้ ไม่งั้นหายจาก "นำเข้าแถวที่เหลือ" ทั้งหมด');
});

test('[M32] import_counts ต้องมี circuit breaker เหมือนกัน', () => {
    const at = IMPORT.indexOf('async function importRowsOneByOne');
    const body = IMPORT.slice(at, IMPORT.indexOf('/** สรุปข้อความ toast', at));
    assert.ok(/isNetworkError/.test(body), 'ยังไม่มี circuit breaker');
    assert.ok(/aborted/.test(body));
    // แถวที่ถูกข้ามต้องพาคีย์เดิมไปด้วย ไม่งั้นกด "นำเข้าแถวที่เหลือ" แล้วแทรกซ้ำ (M6)
    const skip = body.slice(body.indexOf('if (aborted)'), body.indexOf('const payload'));
    assert.ok(/client_request_id: row\.client_request_id/.test(skip),
        'แถวที่ข้ามต้องเก็บ client_request_id ไว้ ไม่งั้น retry จะแทรกซ้ำ (M6)');
    assert.ok(/import_batch_id: row\.import_batch_id/.test(skip));
});
