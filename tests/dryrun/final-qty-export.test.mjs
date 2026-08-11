// เทส "Export ยอดจริง" — ตารางสรุปว่าแต่ละ SKU ต้องใช้ยอดไหนเป็นยอดจริง
//
// ที่มา: admin ยืนยันขาด-เกินเสร็จแล้ว export ออกมา **ไม่รู้เลยว่าแถวไหนต้องเชื่อเลขไหน**
// เพราะปุ่ม 2 ตัวความหมายต่างกัน:
//   "ยืนยันเป็นถูกต้อง (ไม่ปรับยอด)" = ยอด Excel คือยอดจริง (ตัวเลขไม่เปลี่ยน)
//   "ยอมรับผลนับ (Apply)"           = ผลนับคือยอดจริง (สร้างยอดปรับให้ Excel ขยับตาม)
//
// กติกาสำคัญ: แถวที่ยังไม่ตัดสิน **ต้องเว้นช่องยอดจริงไว้** ไม่เดาแทนคน (นโยบายข้อ 3)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('Export ยอดจริง (สรุปว่าแต่ละ SKU เชื่อเลขไหน)');

const RECONCILE = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'reconcile.html'), 'utf8');
const norm = v => String(v ?? '').trim().toUpperCase();

function liftBuilder({ accepted = {}, adjustments = [], drafts = {} } = {}) {
    const acceptedMap = new Map(Object.entries(accepted).map(([k, v]) => [norm(k), v]));
    return liftFunctions(RECONCILE, [
        'buildFinalQtyExportRows', 'getExportLineMetrics', 'getTotalAdjustment',
        'computeDisplayVariance', 'formatRowVariancePct', 'isExcludedFromPct',
    ], {
        RS: { normalizeSku: norm },
        matchAcceptanceMap: acceptedMap,
        adjustmentsCache: adjustments,
        skuNameMap: { BB096: 'สร้อยข้อมือหยกบูลลาย' },
        getDraftAdjustmentSum: sku => drafts[sku] || 0,
        isLineAcceptedMatch: sku => acceptedMap.has(norm(sku)),
        resolveDisplayStatus: (line) => {
            if (acceptedMap.has(norm(line.sku_id))) return 'match';
            const eff = Number(line.book_qty) + Number(line.adjustment_applied) + (drafts[line.sku_id] || 0);
            const c = Number(line.counted_qty);
            if (line.__status) return line.__status;
            if (eff === c) return 'match';
            return c < eff ? 'short' : 'over';
        },
    });
}

const line = o => ({ sku_id: 'X', book_qty: 0, adjustment_applied: 0, counted_qty: 0, ...o });

test('ยืนยันเป็นถูกต้อง = ยอดจริงคือยอด Excel + บอกใครยืนยันเมื่อไหร่', () => {
    const f = liftBuilder({
        accepted: { AS002: { accepted_by: 'BAM', accepted_at: '2026-08-11T07:00:00Z', note: 'ตรวจแล้ว' } },
    });
    const out = f.buildFinalQtyExportRows([line({ sku_id: 'AS002', book_qty: 2, counted_qty: 1 })]);
    assert.equal(out[0]['ยอดจริงที่ใช้'], 2, 'ต้องใช้ยอด Excel ไม่ใช่ผลนับ');
    assert.match(out[0]['ที่มาของยอดจริง'], /ยืนยันเป็นถูกต้อง/);
    assert.match(out[0]['ผู้ยืนยัน / รายละเอียด'], /BAM/);
    assert.match(out[0]['ผู้ยืนยัน / รายละเอียด'], /ตรวจแล้ว/);
});

test('เคสที่ admin ยกตัวอย่าง: Book 31 ปรับ +10 → ยอดจริง 41 และเห็นยอดปรับชัด', () => {
    const f = liftBuilder({
        adjustments: [{ sku_id: 'BG335', adjustment_qty: 10, status: 'applied', note: 'ยอมรับผลนับ → ยอด 41' }],
    });
    const out = f.buildFinalQtyExportRows([
        line({ sku_id: 'BG335', book_qty: 31, adjustment_applied: 10, counted_qty: 41 }),
    ]);
    assert.equal(out[0]['ยอด Book (ไฟล์)'], 31);
    assert.equal(out[0]['ปรับยอด'], 10);
    assert.equal(out[0]['ยอดจริงที่ใช้'], 41);
    assert.match(out[0]['ที่มาของยอดจริง'], /ตรงกันหลังปรับยอด \(\+10\)/);
    assert.match(out[0]['ผู้ยืนยัน / รายละเอียด'], /ยอมรับผลนับ → ยอด 41/);
});

test('Book ตรงกับผลนับเอง = ยอดจริงชัดเจน ไม่ต้องยืนยัน', () => {
    const f = liftBuilder();
    const out = f.buildFinalQtyExportRows([line({ sku_id: 'OK1', book_qty: 5, counted_qty: 5 })]);
    assert.equal(out[0]['ยอดจริงที่ใช้'], 5);
    assert.match(out[0]['ที่มาของยอดจริง'], /Book ตรงกับผลนับ/);
});

test('ขาด/เกินที่ยังไม่กดอะไร = ช่องยอดจริงว่าง ห้ามเดาแทนคน', () => {
    const f = liftBuilder();
    const out = f.buildFinalQtyExportRows([
        line({ sku_id: 'SHORT1', book_qty: 30, counted_qty: 20 }),
        line({ sku_id: 'OVER1', book_qty: 10, counted_qty: 17 }),
    ]);
    assert.equal(out[0]['ยอดจริงที่ใช้'], '', 'ขาด — ยังไม่ตัดสิน ต้องว่าง');
    assert.match(out[0]['ที่มาของยอดจริง'], /ยังไม่ตัดสิน — ขาด 10/);
    assert.equal(out[1]['ยอดจริงที่ใช้'], '');
    assert.match(out[1]['ที่มาของยอดจริง'], /ยังไม่ตัดสิน — เกิน 7/);
});

test('ยังไม่ได้นับ / ไม่พบใน Excel ต้องบอกสถานะตรง ๆ', () => {
    const f = liftBuilder();
    const out = f.buildFinalQtyExportRows([
        line({ sku_id: 'B1', book_qty: 9, counted_qty: 0, __status: 'book_only' }),
        line({ sku_id: 'C1', book_qty: 0, counted_qty: 4, __status: 'count_only' }),
    ]);
    assert.match(out[0]['ที่มาของยอดจริง'], /ยังไม่ได้นับ/);
    assert.match(out[1]['ที่มาของยอดจริง'], /ไม่พบใน Excel/);
    assert.equal(out[0]['ยอดจริงที่ใช้'], '');
    assert.equal(out[1]['ยอดจริงที่ใช้'], '');
});

test('draft ที่ยังไม่ Apply ต้องถูกฟ้องไว้ในที่มา', () => {
    const f = liftBuilder({ drafts: { D1: 3 } });
    const out = f.buildFinalQtyExportRows([
        line({ sku_id: 'D1', book_qty: 7, counted_qty: 10 }),
    ]);
    assert.match(out[0]['ที่มาของยอดจริง'], /มี draft ยังไม่ Apply/);
});

test('แถวรวม: นับเฉพาะที่ยืนยันแล้ว + บอกจำนวนที่ค้างชัดเจน', () => {
    const f = liftBuilder({
        accepted: { A1: { accepted_by: 'BAM', accepted_at: '2026-08-11T07:00:00Z' } },
    });
    const out = f.buildFinalQtyExportRows([
        line({ sku_id: 'A1', book_qty: 100, counted_qty: 90 }),   // ยืนยัน → ใช้ 100
        line({ sku_id: 'M1', book_qty: 5, counted_qty: 5 }),      // ตรงกัน → 5
        line({ sku_id: 'S1', book_qty: 30, counted_qty: 20 }),    // ยังไม่ตัดสิน
    ]);
    const total = out[out.length - 1];
    assert.equal(total.SKU, 'รวม');
    assert.equal(total['ยอดจริงที่ใช้'], 105, 'รวมเฉพาะที่ยืนยันแล้ว (100+5) ห้ามรวมตัวที่ยังไม่ตัดสิน');
    assert.match(total['ที่มาของยอดจริง'], /ยืนยันแล้ว 2 SKU · ยังไม่ยืนยัน 1 SKU/);
    assert.match(total['ผู้ยืนยัน / รายละเอียด'], /ต้องกลับไปตัดสินก่อน/);
});

test('[ui] มีปุ่ม Export ยอดจริง และ listener ผูกกับ builder จริง', () => {
    assert.match(RECONCILE, /id="btnExportFinal"/);
    assert.match(RECONCILE, /btnExportFinal'\)\.addEventListener/);
    const at = RECONCILE.indexOf("btnExportFinal').addEventListener");
    const body = RECONCILE.slice(at, at + 900);
    assert.match(body, /buildFinalQtyExportRows\(rows\)/);
    assert.match(body, /'ยอดจริง'/, 'ชื่อชีตต้องสื่อความหมาย');
});
