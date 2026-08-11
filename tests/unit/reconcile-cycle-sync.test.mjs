// เทสคุ้มกัน H5 (docs/ISSUES.md) — reconcile ต้องไม่เขียนข้อมูลลง "รอบเก่า"
//
// บั๊กเดิม: `#cycleSelect` ไม่มี change listener → `currentCycle` อัปเดตเฉพาะตอนกด
// "คำนวณ Match" ผู้ใช้เปลี่ยนรอบใน dropdown แล้วกดปุ่มใด ๆ = เขียนลงรอบที่แล้ว
//
// logic อยู่ใน inline script ของ HTML (เทสระดับ DOM ไม่ได้ในสภาพแวดล้อม dry-run)
// จึงตรวจที่ระดับ source ว่ากลไกป้องกันยังอยู่ครบ
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('reconcile: กันเขียนลงรอบเก่า (H5)');

const SRC = fs.readFileSync(path.join(PROJECT_ROOT, 'Html/reconcile.html'), 'utf8');

test('[H5-guard] #cycleSelect ต้องมี change listener', () => {
    assert.ok(
        /getElementById\('cycleSelect'\)\s*\.addEventListener\(\s*'change'/.test(SRC),
        'ต้องผูก change listener ไม่งั้นเปลี่ยนรอบแล้วสถานะไม่ตาม'
    );
});

test('[H5-guard] เปลี่ยนรอบต้องล้างสถานะทันที (invalidateCycleView)', () => {
    assert.ok(/function invalidateCycleView\(/.test(SRC), 'ต้องมีฟังก์ชันล้างสถานะ');
    // ต้องถูกเรียกใน change handler
    const handler = SRC.match(/getElementById\('cycleSelect'\)\.addEventListener\('change'[\s\S]{0,700}?\n    \}\);/)?.[0] || '';
    assert.ok(/invalidateCycleView\(/.test(handler), 'change handler ต้องล้างสถานะก่อนโหลดรอบใหม่');
});

test('[H5-guard] invalidateCycleView ต้องล้าง currentCycle + cache + ซ่อน resultsPanel', () => {
    const fn = SRC.match(/function invalidateCycleView\([\s\S]*?\n    \}/)?.[0] || '';
    assert.ok(/currentCycle\s*=\s*null/.test(fn), 'ต้องล้าง currentCycle');
    for (const cache of ['linesCache', 'adjustmentsCache', 'bookSkuSet', 'matchAcceptanceMap', 'skuCountPresence']) {
        assert.ok(new RegExp(cache + '\\s*=').test(fn), `ต้องล้าง ${cache}`);
    }
    assert.ok(/resultsPanel'\)\.style\.display\s*=\s*'none'/.test(fn),
        'ต้องซ่อน resultsPanel — ปุ่ม action ทุกตัวอยู่ในนั้น');
});

test('[H5-guard] runOnce ต้องตรวจว่ารอบตรงกับ dropdown ก่อนทำงาน', () => {
    const fn = SRC.match(/async function runOnce\([\s\S]*?\n    \}/)?.[0] || '';
    assert.ok(/assertCycleInSync\(\)/.test(fn), 'runOnce ต้องเรียก assertCycleInSync');
});

/** ฟังก์ชันใน reconcileService ที่ "เขียน" ฐานข้อมูล — ทุก call site ต้องอยู่หลัง guard */
const RS_WRITE_FNS = [
    'importBookStockLines',
    'acceptReconciliationAsMatch', 'acceptCountedQtyAsMatch',
    'createStockAdjustment', 'createStockAdjustmentsBatch', 'deleteDraftAdjustment',
    'applyStockAdjustment', 'applyAllDraftsForCycle',
    'addBookFromCountOnly', 'addBookFromCountOnlyBatch', 'deleteBookStockBySku',
    'clearAdjustmentsAndMatchAcceptancesForSkus',
    'importBookAndRecompute'          // entry point ของ Import หลังแก้ H6
];

/** หา "บล็อกโค้ดที่ครอบบรรทัดนี้" — ไล่ขึ้นไปหาการประกาศฟังก์ชัน/handler ที่ใกล้ที่สุด */
function enclosingBlock(lines, idx) {
    for (let i = idx; i >= 0; i--) {
        const l = lines[i];
        if (/^\s{0,8}(async\s+)?function\s+\w+\s*\(/.test(l)) return { start: i, name: l.trim().slice(0, 60) };
        if (/addEventListener\(\s*'[a-z]+'\s*,\s*(async\s*)?\(/.test(l)) return { start: i, name: l.trim().slice(0, 60) };
    }
    return { start: 0, name: '(top-level)' };
}

// -----------------------------------------------------------------------------
// สแกน call site จริง แทนการใช้รายชื่อฟังก์ชันแบบ hardcode
// (รายชื่อ hardcode มองไม่เห็น mutation ที่เพิ่มใหม่ และไม่เห็น handler แบบ inline
//  ซึ่งเคยทำให้ปุ่มลบ draft หลุด guard โดยเทสยังเขียว)
// -----------------------------------------------------------------------------
test('[H5-guard] ทุก call site ที่เขียน DB ต้องอยู่ในบล็อกที่ตรวจรอบก่อน', () => {
    const lines = SRC.split('\n');
    const offenders = [];

    lines.forEach((line, i) => {
        const called = RS_WRITE_FNS.find(fn => line.includes(`RS.${fn}(`));
        if (!called) return;
        const block = enclosingBlock(lines, i);
        const body = lines.slice(block.start, i + 1).join('\n');
        // ผ่านได้ถ้าบล็อกนั้นล็อกรอบไว้ หรือถูกห่อด้วย runOnce (ซึ่งตรวจให้แล้ว)
        const guarded = /lockCycleId\(\)|assertCycleInSync\(\)|stillOnCycle\(/.test(body)
            || /runOnce\(/.test(body);
        if (!guarded) offenders.push(`บรรทัด ${i + 1} → RS.${called} ใน ${block.name}`);
    });

    assert.deepEqual(JSON.parse(JSON.stringify(offenders)), [],
        `เขียน DB โดยไม่ตรวจรอบก่อน:\n  ${offenders.join('\n  ')}`);
});

test('[H5-guard] ห้ามส่ง currentCycle.id เข้าฟังก์ชันเขียน DB โดยตรง (ต้องใช้ id ที่ล็อกไว้)', () => {
    const offenders = [];
    SRC.split('\n').forEach((line, i) => {
        const fn = RS_WRITE_FNS.find(f => line.includes(`RS.${f}(`));
        if (fn && /currentCycle\??\.id/.test(line)) {
            offenders.push(`บรรทัด ${i + 1}: RS.${fn}(currentCycle.id …)`);
        }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(offenders)), [],
        `ต้อง capture id ตอน guard แล้วใช้ค่านั้น — ระหว่าง await ผู้ใช้สลับรอบได้:\n  ${offenders.join('\n  ')}`);
});

test('[H5-guard] action ที่มี confirm modal ต้องเช็ครอบซ้ำหลัง modal ปิด', () => {
    const needRecheck = ['addBookLine', 'bulkAddBookLines', 'deleteBookLine'];
    const lines = SRC.split('\n');
    const missing = [];
    for (const name of needRecheck) {
        const start = lines.findIndex(l => l.includes(`async function ${name}(`));
        if (start < 0) { missing.push(`${name} (ไม่พบ)`); continue; }
        const body = lines.slice(start, start + 60).join('\n');
        const okIdx = body.indexOf('if (!ok) return;');
        if (okIdx < 0) { missing.push(`${name} (ไม่พบ confirm)`); continue; }
        if (!/stillOnCycle\(/.test(body.slice(okIdx))) missing.push(name);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(missing)), [],
        `ฟังก์ชันเหล่านี้ยังไม่เช็ครอบซ้ำหลัง confirm: ${missing.join(', ')}`);
});

test('[H5-guard] runRefresh ต้องล็อก dropdown + กันรันซ้อน', () => {
    const start = SRC.indexOf('async function runRefresh(');
    const fn = start < 0 ? '' : SRC.slice(start, SRC.indexOf('try {', start));
    assert.ok(/isRefreshing/.test(fn), 'ต้องมีธงกันรันซ้อน');
    assert.ok(/sel\.disabled\s*=\s*true/.test(fn), 'ต้องปิด dropdown ระหว่างโหลด (คีย์บอร์ดเปลี่ยนรอบได้แม้มี overlay)');
    assert.ok(/sel\.disabled\s*=\s*false/.test(SRC) && /isRefreshing\s*=\s*false/.test(SRC),
        'ต้องคืนค่าใน finally');
});

test('[H5-guard] assertCycleInSync เทียบ currentCycle.id กับค่าใน dropdown จริง', () => {
    const fn = SRC.match(/function isCycleViewInSync\([\s\S]*?\n    \}/)?.[0] || '';
    assert.ok(/cycleSelect/.test(fn) && /currentCycle/.test(fn),
        'ต้องเทียบ currentCycle กับค่าที่เลือกใน #cycleSelect');
});

test('btnRefresh ต้องไม่ผูก runRefresh ตรง ๆ (MouseEvent จะกลายเป็น options)', () => {
    assert.ok(!/addEventListener\('click',\s*runRefresh\s*\)/.test(SRC),
        "ต้องห่อด้วย arrow function: () => runRefresh()");
});
