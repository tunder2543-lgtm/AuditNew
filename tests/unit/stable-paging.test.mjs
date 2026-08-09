// เทสคุ้มกัน: query ที่แบ่งหน้าด้วย .range() ต้องเรียงแบบเสถียร (มี tiebreak ด้วย id)
//
// ที่มา: พบตอนแก้ H4 — dashboard โหลดผลนับ 2,230 แถวได้ครบจำนวน แต่ **ข้ามไป 36 แถว
// และซ้ำอีก 36 แถว** ทำให้ KPI "นับแล้ว" ต่ำกว่าความจริง 24 SKU
// สาเหตุ: เรียงด้วย created_at อย่างเดียว แต่การ insert ชุดเดียว (group submit / นำเข้า Excel)
// ทำให้หลายแถวมี created_at เท่ากันเป๊ะ (Postgres now() คงที่ทั้ง transaction)
// → ลำดับของแถวที่เวลาเท่ากันไม่คงที่ระหว่างการ query แต่ละหน้า
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('security/ความถูกต้อง: การแบ่งหน้าต้องเรียงเสถียร');

function sourceFiles() {
    const out = [];
    for (const dir of ['Js', 'Html']) {
        const full = path.join(PROJECT_ROOT, dir);
        for (const f of fs.readdirSync(full)) {
            if (/\.(js|html)$/.test(f)) out.push(path.join(full, f));
        }
    }
    out.push(path.join(PROJECT_ROOT, 'index.html'));
    return out;
}

/** ตัดคอมเมนต์ออกก่อนสแกน — ไม่งั้นคำว่า `.range()` ในคอมเมนต์จะทำให้ regex หยุดผิดที่ */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * ตรวจว่า query ที่แบ่งหน้าด้วย .range() เรียงแบบเสถียรหรือไม่
 *
 * เกณฑ์: ต้องมี `.order('id', ...)` เสมอ — เป็นคอลัมน์เดียวที่ unique แน่นอนทุกตาราง
 * (เดิมเกณฑ์คือ "ถ้าเรียงด้วย created_at ต้องมี id ด้วย" ซึ่งปล่อยผ่าน query ที่
 *  **ไม่มี .order() เลย** ทั้งที่นั่นคือกรณีที่แย่ที่สุด — ลำดับไม่นิยามตั้งแต่ต้น)
 */
/**
 * ข้อยกเว้นที่ตรวจด้วยมือแล้วว่าปลอดภัย — ต้องมีเหตุผลกำกับเสมอ
 * key = ไฟล์ · value = เหตุผล
 */
const ALLOWLIST = {
    'Html/book_explorer.html': 'query ประกอบผ่าน applySort() ซึ่งจบด้วย .order("id") อยู่แล้ว (regex มองข้ามฟังก์ชันไม่ได้)'
};

test('[paging-guard] ทุก query ที่แบ่งหน้าด้วย .range() ต้องเรียงด้วย id เพื่อให้ลำดับเสถียร', () => {
    const offenders = [];

    for (const file of sourceFiles()) {
        const rel = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
        const src = stripComments(fs.readFileSync(file, 'utf8'));
        const re = /\.from\(\s*['"](\w+)['"]\s*\)([\s\S]{0,900}?)\.range\(/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            const [, table, body] = m;
            if (/\.from\(/.test(body)) continue;            // จับข้าม statement — ไม่นับ
            if (/\.order\(\s*['"]id['"]/.test(body)) continue;
            if (ALLOWLIST[rel]) continue;                    // ตรวจมือแล้ว (ดูเหตุผลใน ALLOWLIST)
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${rel}~${line} (${table})`);
        }
    }

    assert.deepEqual(JSON.parse(JSON.stringify(offenders)), [],
        `query เหล่านี้แบ่งหน้าโดยลำดับไม่เสถียร — จะข้าม/ซ้ำแถว: ${offenders.join(' · ')}`);
});

test('[paging-guard] ไฟล์ใน ALLOWLIST ต้องยังมี .order("id") อยู่จริง', () => {
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
        const src = fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
        assert.ok(/\.order\(\s*['"]id['"]/.test(src),
            `${rel} อยู่ใน ALLOWLIST เพราะ "${reason}" แต่หา .order("id") ในไฟล์ไม่เจอแล้ว`);
    }
});

test('[paging-guard] loadInventoryCountsForDashboard เรียงด้วย created_at + id', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Js/reconcile-shared.js'), 'utf8');
    const fn = src.slice(src.indexOf('function loadInventoryCountsForDashboard'));
    const head = fn.slice(0, 2000);
    assert.ok(/\.order\(\s*['"]created_at['"]/.test(head), 'ต้องเรียงด้วย created_at');
    assert.ok(/\.order\(\s*['"]id['"]/.test(head), 'ต้อง tiebreak ด้วย id ไม่งั้นแบ่งหน้าแล้วข้ามแถว');
});
