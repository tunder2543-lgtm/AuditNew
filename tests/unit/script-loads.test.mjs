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

/**
 * global ที่หน้าเว็บเรียกใช้ → ไฟล์ที่ประกาศมันไว้
 * สร้างจาก `window.X = …` จริงในไฟล์ `Js/*.js` (มีเทสด้านล่างบังคับให้ตรงกัน)
 * ข้ามเฉพาะ global ที่เป็น handler ของ `Js/script.js` (ผูกกับ index.html หน้าเดียว)
 */
const PROVIDERS = {
    DbErrors: 'db-errors.js',
    SkuUtils: 'sku-utils.js',
    uiConfirm: 'ui-confirm-modal.js',
    warehouseService: 'warehouses-shared.js',
    reconcileService: 'reconcile-shared.js',
    countScanService: 'count-scan-shared.js',
    adjustHistoryService: 'adjust-history-shared.js',
    apiService: 'api.js',
    dashboardShared: 'dashboard-shared.js',
    sidebarShared: 'sidebar-shared.js',
    chatNotifyShared: 'chat-notify-shared.js',
    // audit_check แตกโมดูลย่อยออกมา 4 ตัว
    AuditDedupe: 'audit-dedupe.js',
    AuditLog: 'audit-log.js',
    AuditBookImpact: 'audit-book-impact.js',
    AuditLocCompare: 'audit-loc-compare.js',
    // settings-shared เป็นฟังก์ชันเดี่ยว ๆ ไม่ได้ห่อใน namespace
    updateConnectionBadge: 'settings-shared.js',
    checkSupabaseConnection: 'settings-shared.js',
    testSupabaseConnection: 'settings-shared.js',
    saveSupabaseSettings: 'settings-shared.js',
    goToSettingsPage: 'settings-shared.js'
};

/**
 * `chat-notify-shared.js` ไม่มี <script> ในหน้าไหน — `sidebar-shared.js` inject ให้ตอน runtime
 * จึงถือว่า "โหลดแล้ว" ทุกหน้าที่โหลด sidebar-shared
 */
const INJECTED_BY = { 'chat-notify-shared.js': 'sidebar-shared.js' };

/** ไฟล์ JS ที่เป็น "โค้ดของหน้านั้น" ไม่ใช่ shared layer */
const PAGE_JS = {
    'index.html': 'script.js',
    'live_count_wall.html': 'live-count-wall.js'
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

/**
 * เกณฑ์ "หน้านี้อ้าง global ตัวนี้": เจอชื่อมันโดด ๆ (มีหรือไม่มี `window.` นำหน้าก็ได้)
 *
 * ⚠️ ห้ามใช้เกณฑ์ "ต้องมี `.` / `?.` / `[` ตามหลัง" — จะพลาด pattern ที่ระบบนี้ใช้จริง
 * คือ capture ไว้ก่อนแล้วค่อยใช้ (`Js/live-count-wall.js:6` = `const RS = window.reconcileService`)
 * และพลาด global ที่เป็นฟังก์ชันเดี่ยว (`checkSupabaseConnection()`) ทั้งหมด
 */
function usesGlobal(src, name) {
    return new RegExp(`\\b(?:window\\.)?${name}\\b`).test(src);
}

test('[script-loads] หน้าที่อ้าง global ต้องโหลด <script> ของไฟล์ที่ให้ global นั้น', () => {
    const problems = [];

    for (const page of htmlPages()) {
        const loaded = loadedScripts(fs.readFileSync(page.full, 'utf8'));
        for (const [file, via] of Object.entries(INJECTED_BY)) {
            if (loaded.has(via)) loaded.add(file);
        }
        const own = pageOwnSource(page);

        for (const [global, file] of Object.entries(PROVIDERS)) {
            // ไฟล์ JS ประจำหน้าอาจเป็นตัวประกาศ global เองในบางกรณี — ข้าม
            if (PAGE_JS[page.name] === file) continue;

            if (usesGlobal(own, global) && !loaded.has(file)) {
                problems.push(`${page.name}: ใช้ ${global} แต่ไม่ได้โหลด Js/${file}`);
            }
        }
    }

    // ⚠️ tests/run.mjs พิมพ์แค่บรรทัดแรกของ error — รายชื่อจึงต้องอยู่บรรทัดเดียวกัน
    assert.deepEqual(problems, [], `หน้าที่อ้าง global โดยไม่โหลดไฟล์ต้นทาง: ${problems.join(' | ')}`);
});

test('ตาราง PROVIDERS ต้องครอบคลุม window.X ทุกตัวที่ shared JS ประกาศ', () => {
    /** global ที่เป็น handler ของหน้า index (script.js) — ผูกกับหน้าเดียว ไม่ใช่ shared API */
    const PAGE_LOCAL_FILES = new Set(Object.values(PAGE_JS));
    const missing = [];

    for (const f of fs.readdirSync(path.join(PROJECT_ROOT, 'Js'))) {
        if (!f.endsWith('.js') || PAGE_LOCAL_FILES.has(f)) continue;
        const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', f), 'latin1');
        // `=(?!=)` — ไม่งั้น `typeof window.showToast === 'function'` จะถูกนับเป็นการประกาศ
        for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
            if (PROVIDERS[m[1]] === undefined) missing.push(`${f} → window.${m[1]}`);
        }
    }

    assert.deepEqual(missing, [], `shared JS ประกาศ global ที่ยังไม่อยู่ในตาราง PROVIDERS: ${missing.join(' | ')}`);
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
