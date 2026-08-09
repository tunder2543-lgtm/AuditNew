// เทสคุ้มกัน C2 (docs/ISSUES.md) — Stored XSS
// 1) ตรวจว่า escape function ของทุกไฟล์ครอบอักขระครบ (รวม ' และ ")
// 2) สแกน source หา pattern อันตราย: onclick="fn('${...}')" ที่ต่อค่าเข้าไปใน JS string
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT, loadFresh } from '../helpers/sandbox.mjs';

suite('security: XSS guard');

const PAYLOAD = `<img src=x onerror=alert(1)>'"&`;

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

// -----------------------------------------------------------------------------
// escape function ของ shared JS ต้องครอบครบ 5 อักขระ
// -----------------------------------------------------------------------------
test('escapeHtml ใน reconcile-shared ครอบ < > & " \' ครบ', () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    const out = sb.reconcileService.escapeHtml(PAYLOAD);
    for (const ch of ['<', '>', '"', "'"]) {
        assert.ok(!out.includes(ch), `ยังหลุด ${ch} ออกมา: ${out}`);
    }
});

test('escapeHtml ของ script.js (หน้านับ) ครอบครบ + ไม่ทำให้เลข 0 หาย', () => {
    // script.js เป็น IIFE ที่ผูกกับ DOM — ตรวจที่ระดับ source แทนการรัน
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Js/script.js'), 'utf8');
    const fn = src.match(/function escapeHtml\(value\)\s*\{[\s\S]*?\n    \}/)?.[0] || '';
    assert.ok(fn.includes("&#39;"), "escapeHtml ต้อง escape single quote (')");
    assert.ok(fn.includes('&quot;'), 'escapeHtml ต้อง escape double quote (")');
    assert.ok(fn.includes('value ?? '), 'ต้องใช้ ?? ไม่ใช่ || (ไม่งั้นเลข 0 กลายเป็นช่องว่าง)');
});

test('ทุกไฟล์ที่มี escape function ต้องครอบ single quote', () => {
    const missing = [];
    for (const file of sourceFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        // ดูเฉพาะไฟล์ที่ประกาศ escape function เอง
        // \n\s*\} — รองรับทุกระดับการย่อหน้า (เดิมจับแค่ 4/8 ช่อง ทำให้พลาด book_explorer ที่ย่อ 12 ช่อง)
        const decls = src.match(/function (escapeHtml|escHtml|esc)\s*\([\s\S]{0,400}?\n\s*\}/g) || [];
        for (const d of decls) {
            const usesTextContent = d.includes('textContent');
            const hasQuote = d.includes('&#39;') || d.includes('&apos;') || d.includes('&#x27;') || d.includes('&#039;');
            // ยอมรับตัวที่ delegate ไปยัง escape กลางของไฟล์นั้น (เช่น escHtml -> escapeHtml)
            const delegates = /return\s+escapeHtml\(/.test(d);
            if (!hasQuote && !usesTextContent && !delegates) {
                missing.push(path.relative(PROJECT_ROOT, file));
            }
        }
    }
    assert.deepEqual(missing, [], `ไฟล์เหล่านี้มี escape function ที่ไม่ครอบ ' : ${missing.join(', ')}`);
});

// -----------------------------------------------------------------------------
// pattern อันตราย: ต่อค่าเข้าไปใน JS string ภายใน attribute เช่น
//   onclick="fn('${value}')"   ← HTML escape ไม่พอ! เบราว์เซอร์ decode entity ก่อน parse JS
// ทางที่ถูก: เก็บใน data-* แล้วอ่านผ่าน this.dataset
// -----------------------------------------------------------------------------
test('[C2-guard] ห้ามมี onclick/onchange ที่ต่อค่าเข้า JS string โดยตรง', () => {
    const found = [];
    // จับ on<event>="...'${...}'..." — เครื่องหมาย ' ครอบ ${} คือสัญญาณว่ากำลังต่อเป็น JS string
    const re = /on(?:click|change|input|blur|focus|submit)\s*=\s*"[^"]*'\$\{[^"]*"/g;
    for (const file of sourceFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        src.split('\n').forEach((line, i) => {
            if (re.test(line)) found.push(`${path.relative(PROJECT_ROOT, file)}:${i + 1}`);
            re.lastIndex = 0;
        });
    }
    assert.deepEqual(found, [],
        `พบการต่อค่าเข้า JS string ใน event attribute (ใช้ data-* + this.dataset แทน): ${found.join(', ')}`);
});

test('[C2-guard] จุดที่รู้ว่าเคยเป็นช่องโหว่ ต้อง escape แล้ว', () => {
    const checks = [
        ['Js/script.js', /toast\.innerHTML = `<i data-lucide="\$\{iconName\}"><\/i><span>\$\{escapeHtml\(message\)\}/, 'showToast ต้อง escape message'],
        ['Html/sku_master.html', /<span>\$\{escapeHtml\(message\)\}/, 'sku_master showToast ต้อง escape'],
        ['Html/audit_check.html', /<span>\$\{escapeHtml\(message\)\}/, 'audit_check showToast ต้อง escape'],
        ['Html/settings.html', /<span class="warehouse-name">\$\{escapeHtml\(name\)\}/, 'ชื่อคลังต้อง escape'],
        ['Html/import_counts.html', /<td>\$\{escHtml\(r\.sku \|\| '-'\)\}/, 'preview import ต้อง escape'],
        // จุดที่ code-reviewer พบเพิ่มรอบ C2 (mini-dashboard ใน index.html + modal ลบขั้น 2)
        ['Js/script.js', /<strong>\$\{escapeHtml\(row\.counter_name \|\| 'Unknown'\)\}/, 'mini-dashboard ต้อง escape counter_name'],
        ['Js/script.js', /<td>\$\{escapeHtml\(row\.counter_name \|\| 'Unknown'\)\}<\/td>/, 'ตาราง mini-dashboard ต้อง escape'],
        ['Js/script.js', /<option value="\$\{escapeHtml\(name\)\}">\$\{escapeHtml\(name\)\}<\/option>/, 'ตัวกรองผู้นับต้อง escape'],
        ['Js/script.js', /ที่จะลบ <strong>\$\{escapeHtml\(edState\.sku\)\}/, 'modal ลบขั้น 2/2 ต้อง escape'],
        ['Html/audit_check.html', /ไม่มีข้อมูลการนับ \(\$\{escapeHtml\(whLabel\)\}\)/, 'ตัวเลือกเดือนต้อง escape ชื่อคลัง'],
    ];
    for (const [file, re, msg] of checks) {
        const src = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
        assert.ok(re.test(src), `${file}: ${msg}`);
    }
});

test('[C2-guard] ห้ามใช้ setAttribute กับ event handler (on*)', () => {
    const found = [];
    for (const file of sourceFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        src.split('\n').forEach((line, i) => {
            if (/setAttribute\(\s*['"]on[a-z]+['"]/i.test(line)) {
                found.push(`${path.relative(PROJECT_ROOT, file)}:${i + 1}`);
            }
        });
    }
    assert.deepEqual(found, [], `ให้ใช้ addEventListener หรือ data-* แทน: ${found.join(', ')}`);
});
