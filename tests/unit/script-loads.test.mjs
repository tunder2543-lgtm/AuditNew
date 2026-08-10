// เทสคุ้มกัน: หน้าไหนใช้ global ตัวไหน หน้านั้นต้องโหลด <script> ที่ให้ global ตัวนั้น
//
// ที่มา: ตอนลบ dead code รอบ 2026-08-10 พบว่า 5 หน้าโหลด `Js/db-errors.js` ทั้งที่
// ไม่มีคำว่า `DbErrors` เลย (count_search, cycle_config, dashboard, live_count_wall,
// reconcile) และ dashboard โหลด `Js/settings-shared.js` ทั้งที่ไม่มี connection badge
// จึงถอด <script> ทิ้ง
//
// ความเสี่ยงที่เหลืออยู่: ทุกจุดเรียกใช้เขียนเป็น `window.DbErrors?.…` (optional chaining)
// ถ้าใครเพิ่มการเรียกกลับเข้าไปในหน้าที่ไม่ได้โหลดไฟล์แล้ว มันจะคืน `undefined` **เงียบ ๆ**
// ตกไปใช้ error ดิบโดยไม่มีอะไรแดงให้เห็น เทสนี้จับกรณีนั้น
//
// ขอบเขต: ตรวจเฉพาะ "โค้ดของหน้านั้นเอง" = inline script ในไฟล์ HTML + ไฟล์ JS ประจำหน้า
// **ไม่ตรวจ** shared JS เรียก shared JS ด้วยกัน เพราะหลายจุดตั้งใจให้ทำงานได้แม้ไม่มี
// (เช่น `reconcile-shared.js:70` มี fallback normalize ที่เหมือน `SkuUtils.normalizeSku` เป๊ะ
//  จึงจงใจไม่บังคับให้ book_explorer โหลด sku-utils.js)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('โครงสร้าง: หน้าที่ใช้ global ต้องโหลดไฟล์ที่ให้ global นั้น');

/** global ที่หน้าเว็บเรียกใช้ → ไฟล์ที่ประกาศมันไว้ */
const PROVIDERS = {
    DbErrors: 'db-errors.js',
    SkuUtils: 'sku-utils.js',
    uiConfirm: 'ui-confirm-modal.js',
    warehouseService: 'warehouses-shared.js',
    reconcileService: 'reconcile-shared.js',
    apiService: 'api.js',
    dashboardShared: 'dashboard-shared.js'
};

/** ไฟล์ JS ที่เป็น "โค้ดของหน้านั้น" ไม่ใช่ shared layer */
const PAGE_JS = {
    'index.html': 'script.js',
    'live_count_wall.html': 'live-count-wall.js',
    'user_manual.html': 'manual-editor.js'
};

function htmlPages() {
    const out = [{ name: 'index.html', full: path.join(PROJECT_ROOT, 'index.html') }];
    const dir = path.join(PROJECT_ROOT, 'Html');
    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.html')) out.push({ name: f, full: path.join(dir, f) });
    }
    return out;
}

function stripComments(src) {
    return src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/[^\n]*/gm, '');
}

/** basename ของไฟล์ใน Js/ ที่หน้านี้โหลดผ่าน <script src> */
function loadedScripts(html) {
    const out = new Set();
    for (const m of html.matchAll(/<script[^>]+src=["'][^"']*\/?Js\/([\w.-]+\.js)/g)) {
        out.add(m[1]);
    }
    return out;
}

/** เนื้อโค้ดของหน้านั้นเอง = HTML ที่ตัด <script src> ออก + ไฟล์ JS ประจำหน้า (ถ้ามี) */
function pageOwnSource(page) {
    let src = fs.readFileSync(page.full, 'utf8').replace(/<script[^>]+src=["'][^"']+["'][^>]*><\/script>/g, '');
    const jsName = PAGE_JS[page.name];
    if (jsName) src += '\n' + fs.readFileSync(path.join(PROJECT_ROOT, 'Js', jsName), 'utf8');
    return stripComments(src);
}

test('ทุก global ในตาราง PROVIDERS ถูกประกาศไว้ในไฟล์ที่ระบุจริง', () => {
    for (const [global, file] of Object.entries(PROVIDERS)) {
        const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', file), 'utf8');
        assert.ok(
            new RegExp(`window\\.${global}\\s*=`).test(src),
            `Js/${file} ต้องมี window.${global} = … (ตาราง PROVIDERS ในเทสนี้ล้าสมัย?)`
        );
    }
});

test('[script-loads] หน้าที่อ้าง global ต้องโหลด <script> ของไฟล์ที่ให้ global นั้น', () => {
    const problems = [];

    for (const page of htmlPages()) {
        const loaded = loadedScripts(fs.readFileSync(page.full, 'utf8'));
        const own = pageOwnSource(page);

        for (const [global, file] of Object.entries(PROVIDERS)) {
            // ไฟล์ JS ประจำหน้าอาจเป็นตัวประกาศ global เองในบางกรณี — ข้าม
            if (PAGE_JS[page.name] === file) continue;

            const uses = new RegExp(`\\b${global}\\s*(\\?\\.|\\.|\\[)`).test(own);
            if (uses && !loaded.has(file)) {
                problems.push(`${page.name}: ใช้ ${global} แต่ไม่ได้โหลด Js/${file}`);
            }
        }
    }

    assert.deepEqual(problems, [], 'หน้าที่อ้าง global โดยไม่โหลดไฟล์ต้นทาง:\n  ' + problems.join('\n  '));
});

test('[script-loads] 5 หน้าที่ถอด db-errors.js ออก ต้องยังไม่มีการอ้าง DbErrors', () => {
    const trimmed = ['count_search.html', 'cycle_config.html', 'dashboard.html', 'live_count_wall.html', 'reconcile.html'];
    for (const name of trimmed) {
        const page = { name, full: path.join(PROJECT_ROOT, 'Html', name) };
        const own = pageOwnSource(page);
        assert.ok(
            !/\bDbErrors\s*(\?\.|\.|\[)/.test(own),
            `Html/${name} เริ่มใช้ DbErrors แล้ว — ต้องเพิ่ม <script src="../Js/db-errors.js?v=…"> กลับเข้าไป ` +
            `(ไม่งั้น optional chaining จะคืน undefined เงียบ ๆ แล้วผู้ใช้เห็น error ดิบ)`
        );
    }
});

test('[script-loads] dashboard.html ที่ถอด settings-shared.js ออก ต้องยังไม่มี connection badge', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'dashboard.html'), 'utf8');
    assert.ok(
        !/connectionBadge|data-connection-badge/.test(src),
        'dashboard.html มี connection badge แล้ว — ต้องโหลด Js/settings-shared.js กลับเข้าไป ' +
        '(settings-shared.js:91-95 เป็นตัวอัปเดต badge อัตโนมัติตอน DOMContentLoaded)'
    );
});
