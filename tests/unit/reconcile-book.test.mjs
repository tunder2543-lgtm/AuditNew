// เทส parser Book Excel + สถานะ Match — รวม knownIssue M4 (ชื่อโดน UPPERCASE)
// และ M2 (สถานะ JS ไม่ตรง SQL)
import assert from 'node:assert/strict';
import { suite, test, knownIssue } from '../helpers/harness.mjs';
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
// M4 (docs/ISSUES.md): parseBookExcelRows ใช้ normalizeSku กับชื่อสินค้า
// → "Widget Pro" กลายเป็น "WIDGET PRO" ใน DB
// -----------------------------------------------------------------------------
knownIssue('M4', 'parseBookExcelRows ต้องคงตัวพิมพ์ของชื่อสินค้า (name_pro) ไว้', () => {
    const out = RS.parseBookExcelRows([['E-01', '1', 'Widget Pro']]);
    assert.equal(out.rows[0].namePro, 'Widget Pro',
        `ชื่อควรคงเดิม แต่ได้ "${out.rows[0].namePro}"`);
});

// -----------------------------------------------------------------------------
// M2 (docs/ISSUES.md): JS กับ SQL ให้สถานะไม่ตรงกัน
// กรณี SKU อยู่ใน Book ที่ qty 0 แล้วนับเจอ:
//   SQL (docs/sql/013:77) → 'count_only'   |   JS ปัจจุบัน → 'over'
// เทสนี้ยึด SQL เป็นแหล่งความจริง (reconciliation_lines สร้างจาก SQL)
// ⚠️ ถ้า admin ตัดสินใจยึดฝั่ง JS แทน ให้แก้ SQL แล้วกลับ assert ข้อนี้
// -----------------------------------------------------------------------------
knownIssue('M2', 'computeMatchStatus (JS) ต้องให้ผลตรงกับ refresh_reconciliation_for_cycle (SQL)', () => {
    const status = RS.computeMatchStatus({ bookQty: 0, countedQty: 5, inBookSkuSet: true });
    assert.equal(status, 'count_only',
        `SQL ให้ 'count_only' แต่ JS ให้ '${status}' — หน้าเว็บกับ DB แสดงสถานะคนละค่า`);
});
