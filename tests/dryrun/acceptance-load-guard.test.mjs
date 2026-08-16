// เทสคุ้มกัน: โหลด "รายการที่คนยืนยันว่าปกติ" ไม่สำเร็จ = ห้ามลบอะไรทั้งนั้น
//
// ที่มา (code review 2026-08-16): `fetchAcceptances` เริ่มด้วย `acceptanceByKey.clear()`
// แล้วถ้า query ล้ม (เน็ตสะดุด/timeout) มันแค่ console.warn — แมปจึงว่างเปล่าและ
// `acceptanceTableMissing` ยังเป็น false ⇒ ไม่มีสัญญาณใด ๆ บนจอ
// ปุ่ม "ลบแถวที่กดบันทึกซ้ำ" เรียกต่อโดยไม่เช็คว่าโหลดสำเร็จไหม ⇒ ทุกกลุ่มถูกมองว่า
// "ยังไม่มีใครยืนยัน" แล้วถูกลบถาวร — ขัด invariant ข้อ 3 โดยตรง
// ("คำยืนยันของคนชนะกฎของระบบ")
//
// ⛔ กติกา: "ตรวจไม่ได้" ไม่เท่ากับ "ไม่ชน" — เส้นทางที่ลบข้อมูลต้อง fail-closed เสมอ
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftInto } from '../helpers/lift.mjs';

suite('audit_check: โหลดรายการยืนยันล้มเหลว = ห้ามลบ');

const HTML_PATH = path.join(PROJECT_ROOT, 'Html', 'audit_check.html');
const src = fs.readFileSync(HTML_PATH, 'utf8');

/** สร้าง query builder จำลองที่ทุก method คืนตัวเอง แล้วจบด้วยผลลัพธ์ที่กำหนด */
function fakeQuery(result) {
    const q = {};
    ['select', 'order', 'range', 'in', 'is', 'eq', 'gte', 'lte', 'not'].forEach(m => {
        q[m] = () => q;
    });
    q.then = (resolve) => Promise.resolve(result).then(resolve);
    return q;
}

function setup({ acceptanceResult }) {
    const calls = { deleted: [], toasts: [] };
    const context = {
        acceptanceByKey: new Map(),
        acceptanceTableMissing: false,
        acceptanceKey: (cycleId, sku, loc) => [cycleId, sku, loc].join('|'),
        supabaseClient: {
            from: () => fakeQuery(acceptanceResult),
        },
        showToast: (msg, kind) => calls.toasts.push({ msg, kind }),
        console: { warn() {}, error() {}, info() {} },
    };
    const { fns, sandbox } = liftInto(src, ['fetchAcceptances'], context);
    return { fns, sandbox, calls };
}

test('fetchAcceptances: โหลดสำเร็จต้องบอกว่าสำเร็จ', async () => {
    const { fns } = setup({
        acceptanceResult: { data: [{ id: 1, cycle_id: 'c1', sku_id: 'A', location: 'L1' }], error: null },
    });
    const ok = await fns.fetchAcceptances(['c1'], false);
    assert.equal(ok, true, 'ต้องคืนค่าบอกว่าโหลดสำเร็จ');
});

test('fetchAcceptances: query ล้ม (เน็ตสะดุด) ต้องบอกว่าไม่สำเร็จ ไม่ใช่เงียบ', async () => {
    const { fns, sandbox } = setup({
        acceptanceResult: { data: null, error: { message: 'network error', code: 'PGRST_TIMEOUT' } },
    });
    const ok = await fns.fetchAcceptances(['c1'], false);
    assert.equal(ok, false, 'โหลดไม่สำเร็จต้องคืน false — ผู้เรียกจะได้หยุดได้');
    assert.equal(sandbox.acceptanceTableMissing, false,
        'error ชั่วคราวห้ามถูกตีความว่า "ยังไม่ได้รัน migration 019"');
});

test('fetchAcceptances: ตารางยังไม่มีจริง (42P01) ต้องแยกออกจาก error ชั่วคราว', async () => {
    const { fns, sandbox } = setup({
        acceptanceResult: { data: null, error: { message: 'relation "x" does not exist', code: '42P01' } },
    });
    const ok = await fns.fetchAcceptances(['c1'], false);
    assert.equal(ok, false);
    assert.equal(sandbox.acceptanceTableMissing, true, 'ต้องตั้งธงให้ UI ไปบอกให้รัน 019');
});

test('fetchAcceptances: ไม่มีรอบให้ดึงเลย ถือว่าสำเร็จ (ไม่มีอะไรต้องโหลด)', async () => {
    const { fns } = setup({ acceptanceResult: { data: [], error: null } });
    const ok = await fns.fetchAcceptances([], false);
    assert.equal(ok, true);
});

test('[source-guard] ปุ่มลบแถวซ้ำต้องเช็คผลของ fetchAcceptances แล้วหยุดเมื่อโหลดไม่สำเร็จ', () => {
    // ยามระดับซอร์ส: ฟังก์ชันจริงยาวและผูกกับ DOM ทั้งหน้า ยกมารันทั้งดุ้นไม่ไหว
    // จึงบังคับ "รูปแบบการเรียก" แทน — คู่กับเทสด้านบนที่รัน fetchAcceptances จริง
    const at = src.indexOf('async function dedupeInventoryCountsInDb');
    assert.ok(at >= 0, 'หา dedupeInventoryCountsInDb ไม่เจอ');
    const body = src.slice(at, src.indexOf('\n        }', at));
    const callAt = body.indexOf('fetchAcceptances(');
    assert.ok(callAt >= 0, 'ปุ่มลบต้องโหลด acceptances สดก่อนตัดสิน');

    // 1) ผลลัพธ์ต้องถูกเก็บไว้ในตัวแปร ไม่ใช่ await ทิ้ง
    const assign = body.slice(Math.max(0, callAt - 200), callAt + 40)
        .match(/(?:const|let)\s+(\w+)\s*=\s*await\s+fetchAcceptances/);
    assert.ok(assign, 'ต้องเก็บผลลัพธ์ของ fetchAcceptances ไว้ตรวจ ไม่ใช่ await ทิ้ง');
    const varName = assign[1];

    // 2) ต้องมีบล็อก `if (!<ตัวแปรนั้น>) { … return … }` — อ่านทั้งบล็อกด้วยการนับวงเล็บ
    //    (เทียบแค่ "มีคำว่า return ภายใน N ตัวอักษร" จะพังเงียบเมื่อข้อความ toast ยาวขึ้น)
    const guardAt = body.search(new RegExp('if\\s*\\(\\s*!' + varName + '\\s*\\)'));
    assert.ok(guardAt >= 0, `ต้องมีเงื่อนไขหยุดเมื่อ ${varName} เป็น false`);
    const open = body.indexOf('{', guardAt);
    let depth = 0, close = -1;
    for (let i = open; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    assert.ok(close > open, 'บล็อก guard วงเล็บไม่สมดุล');
    assert.match(body.slice(open, close), /\breturn\b/,
        'ในบล็อก guard ต้อง return ออกไป ไม่เดินหน้าลบต่อ');
});
