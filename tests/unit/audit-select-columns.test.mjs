// เทสยาม: query ที่ผลลัพธ์ถูกส่งไป "แก้/ลบ" ข้อมูล ต้อง SELECT คอลัมน์ให้ครบ
//
// ที่มา (2026-08-10): โหมด "Import เทียบตำแหน่ง" ในหน้า audit_check ใช้งานไม่ได้เลย
// ตั้งแต่แรก เพราะ `runLocCompare` เรียก
//     fetchAllInventoryCounts('id, sku_id, location, warehouse', filters)
// ลืม `counted_qty` → แผนที่ได้มี counted_qty = '' → resolveDestQty คืน NaN
// → getDestinationCollision บล็อกทุกแถวด้วย "จำนวนปลายทางไม่ถูกต้อง"
// ผู้ใช้เห็นแค่ "ไม่บันทึก — ปลายทางซ้ำทั้งหมด 51 รายการ" โดยไม่มีทางรู้สาเหตุ
//
// เทสหน่วยของ buildLocComparePlan จับบั๊กนี้ไม่ได้ เพราะความผิดอยู่ที่ **ผู้เรียก**
// จึงต้องมียามสแกน source แบบนี้คู่กัน
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('audit_check: SELECT ต้องมีคอลัมน์ที่ปลายทางใช้จริง');

const AUDIT_HTML = path.join(PROJECT_ROOT, 'Html', 'audit_check.html');

function readAuditHtml() {
    return fs.readFileSync(AUDIT_HTML, 'utf8');
}

/**
 * ตัดคอมเมนต์ออกก่อนสแกนโค้ด — ไม่งั้นโค้ดที่ถูก comment ทิ้งไว้จะยังทำให้เทสผ่าน
 * (เจอจริงตอน mutation test: comment บรรทัด `sel.value = ...` ออกแล้วเทสยังเขียว)
 */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
}

/** ตัวโค้ด (ไม่รวมคอมเมนต์) ของฟังก์ชันหนึ่ง ๆ ในไฟล์ */
function functionBody(decl) {
    const src = readAuditHtml();
    const start = src.indexOf(decl);
    assert.ok(start > -1, `หา ${decl} ไม่เจอ — เทสล้าสมัยแล้ว`);
    const rest = src.slice(start + decl.length);
    // ฟังก์ชันถัดไปอาจเป็น `async function` — ถ้าตัดด้วย '\n        function ' อย่างเดียว
    // body จะยาวเลยเถิดไปกินฟังก์ชันอื่น แล้วยามจะตัดสินจากโค้ดผิดตัว
    const end = rest.search(/\n {8}(?:async )?function /);
    return stripComments(end > -1 ? rest.slice(0, end) : rest);
}

/** ดึงสตริงคอลัมน์ของทุก `fetchAllInventoryCounts('...')` พร้อมบริบทรอบ ๆ */
function selectCalls(src) {
    const out = [];
    const re = /fetchAllInventoryCounts\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const cols = m[1].split(',').map(s => s.trim()).filter(Boolean);
        // ชื่อฟังก์ชันที่ครอบ call นี้อยู่ — ใช้บอกจุดที่พังในข้อความ assert
        const before = src.slice(0, m.index);
        const fnMatch = [...before.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)].pop();
        out.push({ cols, fn: fnMatch ? fnMatch[1] : '(unknown)' });
    }
    return out;
}

test('[LC-guard] ทุก fetchAllInventoryCounts ต้อง SELECT id เสมอ', () => {
    const calls = selectCalls(readAuditHtml());
    assert.ok(calls.length >= 3, `ควรเจอ call อย่างน้อย 3 จุด แต่เจอ ${calls.length}`);
    for (const c of calls) {
        assert.ok(c.cols.includes('id'), `${c.fn}: SELECT ไม่มี 'id' — อ้างอิงแถวกลับไม่ได้`);
    }
});

test('[LC-guard] query ที่ส่งผลเข้าเส้นทางแก้/ลบ ต้อง SELECT counted_qty', () => {
    // ฟังก์ชันเหล่านี้เอาผลไปเข้า validateDestUpdateBatch / findSameCycleDuplicates
    // ซึ่งใช้ "จำนวน" เป็นส่วนหนึ่งของคีย์ตัดสิน — ขาดเมื่อไหร่ = บล็อกทุกแถวเงียบ ๆ
    const MUTATING = ['runLocCompare', 'dedupeInventoryCountsInDb', 'loadReferenceData'];
    const calls = selectCalls(readAuditHtml());

    for (const fn of MUTATING) {
        const call = calls.find(c => c.fn === fn);
        assert.ok(call, `หา fetchAllInventoryCounts ใน ${fn} ไม่เจอ — เทสนี้ล้าสมัยแล้ว ต้องอัปเดต`);
        assert.ok(
            call.cols.includes('counted_qty'),
            `${fn}: SELECT ขาด 'counted_qty' → resolveDestQty จะได้ NaN แล้วบล็อกทุกแถว (บั๊กเดิม 2026-08-10)`
        );
    }
});

test('[LC-guard] query ที่ต้องตัดสิน "ซ้ำในรอบเดียวกัน" ต้อง SELECT cycle_id', () => {
    // H10/H12/M26 ตัดสินจากรอบนับทั้งหมด — ไม่มี cycle_id ก็ตัดสินผิดทุกกรณี
    const NEEDS_CYCLE = ['runLocCompare', 'dedupeInventoryCountsInDb', 'loadReferenceData'];
    const calls = selectCalls(readAuditHtml());

    for (const fn of NEEDS_CYCLE) {
        const call = calls.find(c => c.fn === fn);
        assert.ok(call, `หา fetchAllInventoryCounts ใน ${fn} ไม่เจอ`);
        assert.ok(
            call.cols.includes('cycle_id'),
            `${fn}: SELECT ขาด 'cycle_id' → กติกาซ้ำ/ชนปลายทางตัดสินรอบไม่ได้`
        );
    }
});

// -----------------------------------------------------------------------------
// จุดที่ code-review จับได้ (2026-08-10) — ทั้งหมดเป็นเรื่อง "เลือกคลังผิด = แก้ผิดคลังทั้งชุด"
// -----------------------------------------------------------------------------
test('[LC-guard] dropdown คลังต้องไม่เดาคลังแทนผู้ใช้', () => {
    // warehouseService.populateSelect ล้าง innerHTML แล้ว "เลือกคลังแรกให้เอง" เมื่อไม่มี selected
    // → placeholder หาย + guard "ต้องเลือกคลัง" ไม่เคยทำงาน + default เป็นคลังที่ผู้ใช้ไม่ได้เลือก
    const body = functionBody('async function populateLocCompareWarehouses');

    assert.ok(/option value=""/.test(body), 'ต้องใส่ placeholder กลับหลัง populateSelect');
    assert.ok(/sel\.value\s*=\s*hasScopeWh/.test(body), 'ต้องบังคับค่าเอง ไม่ปล่อยให้ populateSelect เลือกให้');
    assert.ok(/updateLocCompareScopeNote\(\)/.test(body), 'ต้องอัปเดตข้อความบอกขอบเขตหลังตั้งค่า');
});

test('[LC-guard] runLocCompare ต้องโหลด reference ใหม่เองหลังสลับคลัง', () => {
    // runFullAuditLoad() คืนค่าเงียบ ๆ ได้ (autoRunInFlight / โหมดแก้ตำแหน่ง)
    // แล้ว refBySkuLoc จะยังเป็นของคลังเดิม → getDestinationCollision ตาบอด ปล่อยผ่านทุกแถว
    const body = functionBody('async function runLocCompare');

    assert.ok(/await loadReferenceData\(\)/.test(body),
        'ต้องเรียก loadReferenceData() ตรง ๆ (มันอ่าน getAuditFilters() เองจึงได้ scope ที่ถูกเสมอ)');
    assert.ok(!/onAuditWarehouseChange/.test(body),
        'ห้ามพึ่ง onAuditWarehouseChange → runFullAuditLoad ซึ่ง early-return ได้');
    assert.ok(/editLocationMode\s*\|\|\s*swapSkuLocMode/.test(body),
        'ต้องกันไม่ให้เทียบตำแหน่งระหว่างเปิดโหมดแก้ตำแหน่ง/สลับ SKU');
});

test('[LC-guard] ต้องผ่านด่านตรวจให้ครบก่อนไปแตะ scope ของหน้า', () => {
    // เดิมสลับคลังทิ้งไว้แล้วค่อย abort → หน้าเปลี่ยนถาวรทั้งที่ผู้ใช้ยกเลิก
    const body = functionBody('async function runLocCompare');

    const idxConflict = body.indexOf('excelConflicts');
    const idxSync = body.indexOf('whEl.value = chosenWh');
    assert.ok(idxConflict > -1 && idxSync > -1, 'หาจุดตรวจ/จุดซิงก์ไม่เจอ — เทสล้าสมัย');
    assert.ok(idxConflict < idxSync, 'ต้องตรวจไฟล์ Excel ให้ผ่านก่อนแล้วค่อยสลับคลัง');
});

test('[LC-guard] buildLocComparePlan ต้องไม่อ่าน getAuditFilters() เอง (ต้องรับคลังเข้ามา)', () => {
    // เดิมฟังก์ชันนี้ผูกกับ DOM จึงเขียนเทสไม่ได้ — ย้ายไป Js/audit-loc-compare.js แล้ว
    const mod = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'audit-loc-compare.js'), 'utf8');
    assert.ok(!/getAuditFilters|document\./.test(mod),
        'Js/audit-loc-compare.js ต้องเป็น logic ล้วน ห้ามแตะ DOM/ตัวกรองของหน้า');
    assert.ok(/window\.AuditLocCompare/.test(mod), 'ต้อง export ผ่าน window.AuditLocCompare');
});
