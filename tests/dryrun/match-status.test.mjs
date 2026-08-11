// Dry Run: ชุด "ตัวเลขหน้า Match" — M2 + M18 + M3
//
// M2: SKU ที่อยู่ใน Book ด้วยยอด 0 แล้วนับเจอ → JS บอก 'over' แต่ SQL บอก 'count_only'
//     เกิดจริงหลังกดปุ่ม "สร้างลง Book (ยอด 0)" ⇒ ตัวเลขหน้าเว็บกับที่ dashboard/export
//     อ่านจาก DB ไม่ตรงกัน
//
// M18: `%` อ่านจาก `reconciliation_lines.variance_pct` ซึ่ง DB คำนวณจากยอดที่ Apply แล้ว
//      เท่านั้น พอมี draft คอลัมน์ "ต่าง" ขยับแต่ % ไม่ขยับ = สองช่องในแถวเดียวขัดกันเอง
//
// M3: `computeDisplayVariance` คืนค่าบวกทั้ง short และ over (คืนขนาด ไม่ใช่ทิศทาง)
//     ⇒ "ขาด 5" แสดงเป็น `+5` สีแดง และแถวรวมใน Export เอาสองทิศทางมาบวกกัน
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('dry-run: ตัวเลขหน้า Match (M2 สถานะ · M18 % · M3 เครื่องหมาย)');

const RECONCILE = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'reconcile.html'), 'utf8');

/** ยกฟังก์ชันตัวเลขของหน้า reconcile มารันจริง โดย stub เฉพาะตัวที่ต้องพึ่ง state/DOM */
function liftReconcileMath({ drafts = {}, accepted = [], status = null } = {}) {
    const acceptedSet = new Set(accepted);
    return liftFunctions(RECONCILE, [
        'getTotalAdjustment', 'computeDisplayVariance', 'isExcludedFromPct',
        'formatRowVariancePct', 'getExportLineMetrics', 'buildMatchExportRows',
    ], {
        getDraftAdjustmentSum: sku => drafts[sku] || 0,
        isLineAcceptedMatch: sku => acceptedSet.has(sku),
        resolveDisplayStatus: line => status
            ? status(line)
            : defaultStatus(line, drafts[line.sku_id] || 0, acceptedSet),
        skuNameMap: {},
        STATUS_MAP: {
            match: { th: 'ถูกต้อง' }, short: { th: 'ขาด' }, over: { th: 'เกิน' },
            count_only: { th: 'นับเจอ แต่ไม่พบSKUในExcel' }, book_only: { th: 'ยังไม่ได้นับ' },
        },
    });
}

function defaultStatus(line, draft, acceptedSet) {
    if (acceptedSet.has(line.sku_id)) return 'match';
    const eff = Number(line.book_qty) + Number(line.adjustment_applied) + draft;
    const c = Number(line.counted_qty);
    if (eff === c) return 'match';
    return c < eff ? 'short' : 'over';
}

function line(o) {
    return { sku_id: 'X', book_qty: 0, adjustment_applied: 0, counted_qty: 0, variance_pct: null, ...o };
}

// -----------------------------------------------------------------------------
// M2 — สถานะต้องตรงกันทั้งสองฝั่ง
// -----------------------------------------------------------------------------
test('[M2] อยู่ใน Book ยอด 0 แล้วนับเจอ = "เกิน" · ไม่อยู่ใน Book เลย = "นับเจอไม่พบใน Excel"', () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const f = sb.reconcileService.computeMatchStatus;
    // นี่คือสิ่งที่เกิดหลังผู้ใช้กด "สร้างลง Book (ยอด 0)" — SKU มีใน Book แล้ว
    assert.equal(f({ bookQty: 0, countedQty: 12, inBookSkuSet: true }), 'over');
    assert.equal(f({ bookQty: 0, countedQty: 12, inBookSkuSet: false }), 'count_only');
    // ยอด Book 0 แต่ไม่มีผลนับเลย → ไม่ใช่ทั้งคู่
    assert.equal(f({ bookQty: 0, countedQty: 0, inBookSkuSet: true }), 'match');
});

/** ตัดฟังก์ชัน refresh_reconciliation_for_cycle ออกมาจากไฟล์ migration */
function functionSource(file) {
    const raw = fs.readFileSync(path.join(PROJECT_ROOT, 'docs', 'sql', file), 'utf8');
    const at = raw.indexOf('CREATE OR REPLACE FUNCTION refresh_reconciliation_for_cycle');
    assert.ok(at >= 0, `หาฟังก์ชันใน ${file} ไม่เจอ`);
    const end = raw.indexOf('$$;', at);
    assert.ok(end > at, `หาจุดจบฟังก์ชันใน ${file} ไม่เจอ`);
    return raw.slice(at, end + 3);
}

/** บรรทัดที่มีความหมายจริง (ตัดคอมเมนต์/บรรทัดว่าง/ช่องว่างซ้ำ) */
function meaningfulLines(src) {
    return src.split('\n')
        .map(l => l.replace(/--.*$/, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

/**
 * แปลสาขา CASE ของ match_status จากไฟล์ SQL เป็นฟังก์ชัน JS แล้วรันจริง
 *
 * ⚠️ ทำแบบนี้เพราะเทสรุ่นแรกแค่มองหาคำว่า `in_book` / `over` / `count_only` ในสาขา
 *    ซึ่ง review พิสูจน์แล้วว่า mutant รอด 3 แบบ — รวมถึงการ **สลับ over↔count_only**
 *    (บั๊กเดิมกลับด้าน) และการลบสาขา book_only ทิ้งทั้งบรรทัด
 */
function compileSqlMatchStatus(src) {
    const at = src.indexOf('CASE', src.indexOf('m.variance_qty,'));
    const end = src.indexOf('END,', at);
    assert.ok(at > 0 && end > at, 'ตัดบล็อก CASE ของ match_status ไม่ได้');
    const block = src.slice(at + 4, end);

    const branches = [];
    // สาขาปกติ + สาขาที่ผลลัพธ์เป็น CASE ซ้อน
    const re = /WHEN ([\s\S]*?)\s+THEN\s+(?:'(\w+)'|CASE WHEN ([\w.]+) THEN '(\w+)' ELSE '(\w+)' END)/g;
    let m;
    while ((m = re.exec(block))) {
        branches.push({
            cond: m[1],
            value: m[2] || null,
            nested: m[3] ? { on: m[3].replace(/^m\./, ''), yes: m[4], no: m[5] } : null,
        });
    }
    const elseMatch = block.match(/ELSE\s+'(\w+)'\s*$/);
    assert.ok(branches.length >= 4, `แปลสาขาได้แค่ ${branches.length} — รูปแบบ CASE เปลี่ยนไป เทสนี้ล้าสมัย`);
    assert.ok(elseMatch, 'ไม่มีสาขา ELSE');

    const toJs = expr => expr
        .replace(/m\./g, '')
        .replace(/\bAND\b/g, '&&')
        .replace(/\bOR\b/g, '||')
        .replace(/([^<>!=])=([^=])/g, '$1===$2');
    const fn = (cond) => {
        assert.ok(!/[A-Za-z_]+\(/.test(cond), `เจอ function call ที่แปลไม่ได้: ${cond}`);
        return new Function('effective_book_qty', 'counted_qty', 'count_row_count', 'variance_qty', 'in_book',
            `return (${toJs(cond)});`);
    };
    const compiled = branches.map(b => ({ ...b, test: fn(b.cond) }));

    return (row) => {
        const args = [row.effective_book_qty, row.counted_qty, row.count_row_count, row.variance_qty, row.in_book];
        for (const b of compiled) {
            if (!b.test(...args)) continue;
            if (!b.nested) return b.value;
            return row[b.nested.on] ? b.nested.yes : b.nested.no;
        }
        return elseMatch[1];
    };
}

test('[M2] สาขา CASE ใน SQL ต้องให้ผลตรงกับ computeMatchStatus ทุกเคส', () => {
    const sqlStatus = compileSqlMatchStatus(functionSource('020_match_status_count_only_in_book.sql'));
    const js = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js').reconcileService.computeMatchStatus;

    // ตรวจว่าตัวแปลทำงานจริงก่อน — ถ้าแปลพลาดจนคืนค่าเดียวตลอด เทสจะไร้ความหมาย
    const seen = new Set();
    const cases = [];
    for (const book of [0, 5, 10]) {
        for (const adjust of [-5, 0, 3]) {
            for (const counted of [0, 5, 12]) {
                for (const inBook of [true, false]) {
                    for (const rowCount of [0, 2]) {
                        // count_row_count = 0 แต่มีผลนับ เป็นไปไม่ได้จริง — ข้ามไป
                        if ((counted > 0) !== (rowCount > 0)) continue;
                        cases.push({ book, adjust, counted, inBook, rowCount });
                    }
                }
            }
        }
    }
    assert.ok(cases.length >= 30, 'เคสน้อยเกินไป');

    for (const c of cases) {
        const effective = c.book + c.adjust;
        const fromSql = sqlStatus({
            effective_book_qty: effective,
            counted_qty: c.counted,
            count_row_count: c.rowCount,
            variance_qty: c.counted - effective,
            in_book: c.inBook,
        });
        const fromJs = js({
            bookQty: c.book, adjustmentTotal: c.adjust, countedQty: c.counted,
            hasCountRecord: c.rowCount > 0, inBookSkuSet: c.inBook,
        });
        seen.add(fromSql);
        assert.equal(fromSql, fromJs,
            `SQL ให้ '${fromSql}' แต่ JS ให้ '${fromJs}' ที่ ${JSON.stringify(c)} — หน้าเว็บกับ DB จะแสดงคนละค่า`);
    }
    assert.ok(seen.size >= 4, `ตัวแปล SQL คืนแค่ ${[...seen]} — น่าจะแปลผิด เทสนี้ไม่ได้ยามอะไร`);
});

test('[M2] body ของ 020 ต้องต่างจาก 013 เฉพาะจุดที่ตั้งใจแก้', () => {
    // 020 คือการ **คัดลอก body ทั้งก้อน** จาก 013 มาแก้ 3 จุด — copy drift ตรวจไม่ได้ด้วยตาเปล่า
    // (เช่นเผลอลบ UPDATE book_stock_lines ท้ายฟังก์ชันทิ้ง จะไม่มีอะไรฟ้องเลย)
    const before = meaningfulLines(functionSource('013_audit_warnings.sql'));
    const after = meaningfulLines(functionSource('020_match_status_count_only_in_book.sql'));

    const removed = before.filter(l => !after.includes(l));
    const added = after.filter(l => !before.includes(l));
    assert.deepEqual(removed, [
        "WHEN m.effective_book_qty = 0 AND m.counted_qty > 0 THEN 'count_only'",
    ], 'มีบรรทัดของ 013 หายไปเกินกว่าที่ตั้งใจ');
    assert.deepEqual(added, [
        'SECURITY DEFINER',
        'SET search_path = public, pg_temp',
        '(b.sku_id IS NOT NULL) AS in_book,',
        'WHEN m.effective_book_qty = 0 AND m.counted_qty > 0',
        "THEN CASE WHEN m.in_book THEN 'over' ELSE 'count_only' END",
    ], 'มีบรรทัดใหม่เกินกว่าที่ตั้งใจ');
});

test('[M2] migration 020 ต้องคง SECURITY DEFINER + search_path (invariant ข้อ 12)', () => {
    // ⚠️ 018 ตั้ง attribute ด้วย ALTER แต่ CREATE OR REPLACE เขียนทับ attribute ทั้งหมด
    //    ถ้าลืมประกาศซ้ำ ฟังก์ชันจะกลับเป็น SECURITY INVOKER แล้ว "คำนวณ Match" 401
    const head = functionSource('020_match_status_count_only_in_book.sql').split('AS $$')[0];
    assert.ok(/SECURITY DEFINER/i.test(head), 'ขาด SECURITY DEFINER → RPC จะโดน RLS แล้วคืน 401');
    assert.ok(/SET search_path\s*=\s*public,\s*pg_temp/i.test(head), 'ขาด SET search_path');
});

// -----------------------------------------------------------------------------
// M3 — เครื่องหมายของ "ต่าง"
// -----------------------------------------------------------------------------
test('[M3] ขาดต้องติดลบ เกินต้องเป็นบวก (ทิศทางเดียวกับ variance_qty ของ DB)', () => {
    const f = liftReconcileMath();
    assert.equal(f.computeDisplayVariance(line({ book_qty: 10, counted_qty: 5 })), -5, 'ขาด 5 ต้องเป็น -5 ไม่ใช่ +5');
    assert.equal(f.computeDisplayVariance(line({ book_qty: 10, counted_qty: 17 })), 7);
    assert.equal(f.computeDisplayVariance(line({ book_qty: 10, counted_qty: 10 })), 0);
});

test('[M3] ยอดปรับ (applied + draft) ต้องรวมอยู่ในค่าต่างด้วย', () => {
    const f = liftReconcileMath({ drafts: { X: 3 } });
    // Excel 10 + applied 2 + draft 3 = 15 · นับได้ 12 ⇒ ขาด 3
    assert.equal(f.computeDisplayVariance(line({ book_qty: 10, adjustment_applied: 2, counted_qty: 12 })), -3);
});

test('[M3] แถวที่ "ยืนยันว่าถูกต้อง" แล้วต้องเป็น 0 เสมอ', () => {
    const f = liftReconcileMath({ accepted: ['X'] });
    assert.equal(f.computeDisplayVariance(line({ book_qty: 10, counted_qty: 5 })), 0);
});

test('[M3] แถวรวมใน Export ต้องเป็นยอดสุทธิ + บอกขาด/เกินแยกกัน', () => {
    const f = liftReconcileMath();
    const rows = [
        line({ sku_id: 'A', book_qty: 100, counted_qty: 60 }),   // ขาด 40
        line({ sku_id: 'B', book_qty: 10, counted_qty: 55 }),    // เกิน 45
        line({ sku_id: 'C', book_qty: 7, counted_qty: 7 }),      // ตรง
    ];
    const out = f.buildMatchExportRows(rows);
    const total = out[out.length - 1];
    assert.equal(total.SKU, 'รวม');
    assert.equal(total['ต่าง'], 5, 'สุทธิ = -40 + 45 = +5 (เดิมบวกขนาดกันได้ 85 ซึ่งไม่มีความหมาย)');
    assert.match(total['สถานะ'], /ขาดรวม 40/);
    assert.match(total['สถานะ'], /เกินรวม 45/);
    assert.equal(out[0]['ต่าง'], -40, 'แถวรายตัวก็ต้องติดลบเมื่อขาด');
});

test('[M3] ชีต Adjusted ต้องใช้ทิศทางเดียวกับชีต Match (อยู่ไฟล์ Excel เดียวกัน)', () => {
    // review จับได้ว่าแก้แล้วยังเหลืออีกชีต — SKU ตัวเดียวกันเป็น -40 ในชีตหนึ่ง +40 ในอีกชีต
    const f = liftFunctions(RECONCILE, ['buildAdjustedExportRows', 'statusTh'], {
        skuNameMap: {},
        STATUS_MAP: { short: { th: 'ขาด' }, over: { th: 'เกิน' } },
        lastImportAdjustResults: [
            { skuId: 'A', bookQty: 100, adjustmentQty: 0, effectiveAfter: 100, countedQty: 60, statusAfter: 'short' },
            { skuId: 'B', bookQty: 10, adjustmentQty: 0, effectiveAfter: 10, countedQty: 55, statusAfter: 'over' },
        ],
    });
    const rows = f.buildAdjustedExportRows();
    assert.equal(rows[0]['ต่าง'], -40, 'ขาด 40 ต้องเป็น -40 เหมือนชีต Match');
    assert.equal(rows[1]['ต่าง'], 45);
});

// -----------------------------------------------------------------------------
// M18 — %
// -----------------------------------------------------------------------------
test('[M18] % ต้องคำนวณใหม่ตาม draft ไม่ใช่อ่านค่าค้างจาก DB', () => {
    // DB เก็บ variance_pct = 50% (คำนวณตอนยังไม่มี draft: Excel 100 นับ 50)
    // พอใส่ draft -40 ⇒ Excel ใช้เทียบ 60 · ต่าง -10 ⇒ ต้องเป็น 16.7% ไม่ใช่ 50%
    const l = line({ book_qty: 100, counted_qty: 50, variance_pct: 50 });
    const f = liftReconcileMath({ drafts: { X: -40 } });
    assert.equal(f.formatRowVariancePct(l, 'short'), '16.7%');

    const noDraft = liftReconcileMath();
    assert.equal(noDraft.formatRowVariancePct(l, 'short'), '50.0%', 'ไม่มี draft ต้องได้ค่าเดิมของ DB');
});

test('[M18] เคสหารศูนย์และเคสที่ไม่คิด % ต้องไม่พัง', () => {
    const f = liftReconcileMath();
    assert.equal(f.formatRowVariancePct(line({ counted_qty: 9 }), 'count_only'), '—', 'นับเจอไม่พบใน Excel ไม่คิด %');
    assert.equal(f.formatRowVariancePct(line({ book_qty: 0, counted_qty: 9 }), 'over'), '—', 'ฐานเป็น 0 → ไม่แสดง %');
    assert.equal(f.formatRowVariancePct(line({ book_qty: 5, counted_qty: 5 }), 'match'), '0%');
    // ปรับยอดจนฐานกลายเป็น 0 → ถอยไปใช้ book_qty เหมือนสูตรฝั่ง SQL
    const g = liftReconcileMath({ drafts: { X: -10 } });
    assert.equal(g.formatRowVariancePct(line({ book_qty: 10, counted_qty: 3 }), 'over'), '30.0%');
});

test('[M18] แถวที่ยืนยันว่าถูกต้องแล้วต้องเป็น 0% ไม่ใช่ค่าค้างจาก DB', () => {
    const f = liftReconcileMath({ accepted: ['X'] });
    assert.equal(f.formatRowVariancePct(line({ book_qty: 100, counted_qty: 50, variance_pct: 50 }), 'match'), '0%');
});
