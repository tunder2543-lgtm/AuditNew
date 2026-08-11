// เทส parser Book Excel + สถานะ Match
// [M4] ชื่อโดน UPPERCASE — แก้แล้ว 2026-08-10 (เป็นเทสถาวรกัน regression)
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('reconcile-shared: Book Excel + computeMatchStatus');

const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
const RS = sb.reconcileService;

test('parseBookExcelRows: แถวปกติ parse ถูก (sku ถูก normalize)', () => {
    const out = RS.parseBookExcelRows([['a-01', '5', 'ชื่อสินค้า']]);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].sku, 'A-01');
    assert.equal(out.rows[0].qty, 5);
    assert.equal(out.rows[0].valid, true);
    assert.equal(out.validRows.length, 1);
});

test('parseBookExcelRows: แถวหัวตาราง (SKU/รหัส) ถูกข้าม', () => {
    const out = RS.parseBookExcelRows([['SKU', 'จำนวน', 'ชื่อ'], ['B-02', '3', '']]);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].sku, 'B-02');
});

test('parseBookExcelRows: qty ติดลบ/ไม่ใช่เลข = invalid', () => {
    const out = RS.parseBookExcelRows([['C-03', '-1', ''], ['C-04', 'abc', '']]);
    assert.equal(out.invalidRows.length, 2);
    assert.equal(out.validRows.length, 0);
});

test('parseBookExcelRows: SKU ซ้ำในไฟล์ถูกรวมยอด + รายงาน duplicateSkus', () => {
    const out = RS.parseBookExcelRows([['D-09', '2', ''], ['d-09', '3', '']]);
    assert.equal(out.validRows.length, 1);
    assert.equal(out.validRows[0].qty, 5);
    assert.equal(out.duplicateSkus.length, 1);
});

test('aggregateBookRowsBySku: SKU ซ้ำในไฟล์ → บวกรวม qty (นโยบาย Book import)', () => {
    const valid = [
        { rowNo: 1, sku: 'D-01', qty: 2, namePro: '', valid: true },
        { rowNo: 2, sku: 'd-01', qty: 3, namePro: '', valid: true },
    ];
    const out = RS.aggregateBookRowsBySku(valid);
    assert.equal(out.length, 1);
    assert.equal(out[0].qty, 5);
    assert.equal(out[0].mergedFrom, 2);
});

test('computeMatchStatus: กรณีพื้นฐาน match/short/over/book_only', () => {
    assert.equal(RS.computeMatchStatus({ bookQty: 10, countedQty: 10 }), 'match');
    assert.equal(RS.computeMatchStatus({ bookQty: 10, countedQty: 7 }), 'short');
    assert.equal(RS.computeMatchStatus({ bookQty: 10, countedQty: 12 }), 'over');
    assert.equal(RS.computeMatchStatus({ bookQty: 10, countedQty: 0, hasCountRecord: false }), 'book_only');
});

test('computeMatchStatus: adjustment มีผลต่อ effective book', () => {
    // book 10, adj -3 → effective 7, counted 7 = match
    assert.equal(RS.computeMatchStatus({ bookQty: 10, adjustmentTotal: -3, countedQty: 7 }), 'match');
});

// -----------------------------------------------------------------------------
// M4 — ✅ แก้แล้ว 2026-08-10 (ย้ายจาก knownIssue → เทสถาวรกัน regression)
//
// เดิม `parseBookExcelRows` ใช้ `normalizeSku` กับ **ชื่อสินค้า** ด้วย → "Widget Pro"
// กลายเป็น "WIDGET PRO" ถาวรใน `book_stock_lines.name_pro`
// invariant ข้อ 2 (UPPERCASE + trim) เป็นมาตรฐานของ **รหัส SKU** เท่านั้น ไม่ใช่ของชื่อ
//
// เรื่องนี้กว้างกว่าที่คิดตอนแรก: ตั้งแต่ถอดฟีเจอร์ SKU Master ปุ่ม "สร้างลง Book"
// ก็ดึงชื่อจาก `book_stock_lines` แล้ว ⇒ บั๊กนี้จะไหลไปทุกเส้นทาง และไม่มี UI แก้รายแถว
// -----------------------------------------------------------------------------
test('[M4] parseBookExcelRows คงตัวพิมพ์ของชื่อสินค้า (name_pro) ไว้', () => {
    const out = RS.parseBookExcelRows([['E-01', '1', 'Widget Pro']]);
    assert.equal(out.rows[0].namePro, 'Widget Pro',
        `ชื่อต้องคงเดิม แต่ได้ "${out.rows[0].namePro}"`);
    // `rows` เป็น items ดิบ — ตัวที่ไหลเข้า DB จริงคือ `validRows` (ผ่าน aggregateBookRowsBySku)
    // ต้อง assert ทั้งคู่ ไม่งั้นถ้าใครเผลอ uppercase ตอน aggregate เทสจะมองไม่เห็น
    assert.equal(out.validRows[0].namePro, 'Widget Pro',
        'แถวที่ส่งเข้า DB จริงก็ต้องคงตัวพิมพ์');
});

test('[M4] ชื่อสินค้ายัง trim หัวท้าย และรับค่าว่าง/ไทยได้ถูกต้อง', () => {
    const out = RS.parseBookExcelRows([
        ['E-01', '1', '  Widget Pro  '],
        ['E-02', '2', 'สร้อยข้อมือหยก 6 มิล'],
        ['E-03', '3', ''],
    ]);
    assert.equal(out.rows[0].namePro, 'Widget Pro', 'ต้อง trim ช่องว่างหัวท้าย');
    assert.equal(out.rows[1].namePro, 'สร้อยข้อมือหยก 6 มิล', 'ภาษาไทยต้องไม่เพี้ยน');
    assert.equal(out.rows[2].namePro, '', 'ช่องว่าง = string ว่าง ไม่ใช่ throw');
});

test('[M4] แต่ **รหัส SKU** ต้องยัง UPPERCASE ตาม invariant ข้อ 2', () => {
    const out = RS.parseBookExcelRows([['  e-01  ', '1', 'Widget Pro']]);
    assert.equal(out.rows[0].sku, 'E-01',
        'การแก้ M4 ต้องไม่เผลอถอด normalizeSku ออกจากคอลัมน์ SKU ด้วย');
});

// -----------------------------------------------------------------------------
// M2 (docs/ISSUES.md) — ปิดแล้ว 2026-08-11 โดย **ยึดฝั่ง JS เป็นแหล่งความจริง**
// เดิม SQL (013:77) ให้ 'count_only' กับ SKU ที่อยู่ใน Book ยอด 0 แล้วนับเจอ
// แต่เคสนี้เกิดหลังผู้ใช้กด "สร้างลง Book (ยอด 0)" — SKU มีใน Book แล้ว จึงต้องเป็น "เกิน"
// แก้ SQL ตามใน docs/sql/020 · เทสละเอียดอยู่ที่ tests/dryrun/match-status.test.mjs
// -----------------------------------------------------------------------------
test('[M2] อยู่ใน Book ยอด 0 แล้วนับเจอ = เกิน (ไม่ใช่ "นับเจอไม่พบใน Excel")', () => {
    assert.equal(RS.computeMatchStatus({ bookQty: 0, countedQty: 5, inBookSkuSet: true }), 'over');
    assert.equal(RS.computeMatchStatus({ bookQty: 0, countedQty: 5, inBookSkuSet: false }), 'count_only');
});
