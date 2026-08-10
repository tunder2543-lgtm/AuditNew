// เทสคุ้มกันเมนูซ้าย (sidebar) บนจอเล็ก
//
// บั๊กที่เคยเกิดจริง: @media (max-width:900px) ใน Css/style.css ถูกเขียนไว้ตอนเมนูยังเป็น
// "แถวไอคอนแบน" (flex-direction: row) แต่ Js/sidebar-shared.js เปลี่ยนไปเรนเดอร์เป็น
// "กลุ่มพับได้" (column) แล้ว → CSS กับ DOM หลุดจากกัน เมนูบนมือถือ/iPad แตกยับ
//
// เทสชุดนี้จึงตรวจ 2 เรื่อง:
//   [sidebar-guard] CSS responsive ต้องสอดคล้องกับ DOM ที่ JS สร้างจริง
//   [asset-ver]     ทุกหน้าต้องโหลด style.css / sidebar-shared.js ด้วยเวอร์ชันตรงกับ ASSET_VER
//                   (ถ้าไม่ตรง เบราว์เซอร์ใช้ไฟล์เก่า → แก้แล้วผู้ใช้ไม่เห็นผล)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('ui: sidebar responsive');

// ตัดคอมเมนต์ทิ้งก่อนเสมอ — ไม่งั้นข้อความอย่าง "dashboard.html" ในคอมเมนต์จะถูกอ่านเป็น selector .html
const CSS = fs.readFileSync(path.join(PROJECT_ROOT, 'Css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SIDEBAR_JS = fs.readFileSync(path.join(PROJECT_ROOT, 'Js/sidebar-shared.js'), 'utf8');

/**
 * ดึงเนื้อในของ @media (max-width: 900px) { ... } **ทุกก้อน** โดยนับวงเล็บปีกกาให้สมดุล
 * ต้องวนทุกก้อน ไม่ใช่แค่ก้อนแรก — ไม่งั้นใครเพิ่มบล็อก 900px ท้ายไฟล์ที่พังเมนู ยามจะมองไม่เห็น
 */
function mobileBlocks() {
    const out = [];
    const re = /@media\s*\(max-width:\s*900px\)\s*\{/g;
    let m;
    while ((m = re.exec(CSS)) !== null) {
        const open = CSS.indexOf('{', m.index);
        let depth = 0;
        for (let i = open; i < CSS.length; i++) {
            if (CSS[i] === '{') depth++;
            else if (CSS[i] === '}') {
                depth--;
                if (depth === 0) {
                    out.push(CSS.slice(open + 1, i));
                    re.lastIndex = i;
                    break;
                }
            }
        }
    }
    assert.ok(out.length > 0, 'ต้องมี @media (max-width: 900px) ใน Css/style.css');
    return out;
}

/** กฎทั้งหมดในทุกบล็อกจอเล็ก รวมกัน */
function mobileRules() {
    return mobileBlocks().flatMap(b => rulesOf(b));
}

/** กฎ CSS ใน block → [{ selector, body }] */
function rulesOf(block) {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(block)) !== null) {
        out.push({ selector: m[1].trim(), body: m[2] });
    }
    return out;
}

function htmlPages() {
    const out = [path.join(PROJECT_ROOT, 'index.html')];
    const dir = path.join(PROJECT_ROOT, 'Html');
    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.html')) out.push(path.join(dir, f));
    }
    return out;
}

function assetVer() {
    const m = SIDEBAR_JS.match(/const ASSET_VER\s*=\s*'([^']+)'/);
    assert.ok(m, 'หา ASSET_VER ใน Js/sidebar-shared.js ไม่เจอ');
    return m[1];
}

// -----------------------------------------------------------------------------
// 1) หัวใจของบั๊ก — ห้ามพับ sidebar เป็นแถวนอนบนจอเล็ก
// -----------------------------------------------------------------------------
test('[sidebar-guard] จอเล็กต้องไม่พับ .sidebar/.sidebar-nav เป็นแถวนอน (สาเหตุบั๊กเดิม)', () => {
    for (const rule of mobileRules()) {
        const touchesSidebar = rule.selector.split(',').some(s => ['.sidebar', '.sidebar-nav'].includes(s.trim()));
        if (!touchesSidebar) continue;
        // ครอบทั้ง flex-direction, flex-flow และการพลิกเป็นแนวนอนด้วย grid
        assert.ok(
            !/flex-direction:\s*row/.test(rule.body),
            `"${rule.selector}" ตั้ง flex-direction: row บนจอเล็ก — DOM ที่ sidebar-shared.js สร้างเป็นกลุ่มพับได้แนวตั้ง จะแตกทันที`
        );
        assert.ok(
            !/flex-flow:\s*row/.test(rule.body),
            `"${rule.selector}" ตั้ง flex-flow: row บนจอเล็ก — ผลเหมือน flex-direction: row`
        );
        assert.ok(
            !/grid-auto-flow:\s*column/.test(rule.body),
            `"${rule.selector}" ตั้ง grid-auto-flow: column บนจอเล็ก — พลิกเมนูเป็นแนวนอนเหมือนกัน`
        );
    }
});

test('[sidebar-guard] จอเล็กต้องเป็นลิ้นชักสไลด์ (มี translateX + body.sidebar-open)', () => {
    const all = mobileBlocks().join('\n');
    assert.ok(/transform:\s*translateX\(-100%\)/.test(all), 'ต้องซ่อนเมนูออกนอกจอด้วย translateX(-100%)');
    assert.ok(/body\.sidebar-open\s+\.sidebar\b/.test(all), 'ต้องมีกฎเปิดลิ้นชัก body.sidebar-open .sidebar');
    assert.ok(/\.sidebar-scrim/.test(all), 'ต้องมีฉากมืด .sidebar-scrim');
    assert.ok(/body\.sidebar-open\s*\{[^}]*overflow:\s*hidden/.test(all), 'เปิดลิ้นชักแล้วต้องล็อกไม่ให้พื้นหลังเลื่อน');
});

test('[sidebar-guard] แถบเมนูจอเล็กต้องอยู่ใต้ overlay/modal ทุกตัวของระบบ', () => {
    // ถ้าแถบบนอยู่สูงกว่า overlay ปุ่มปิดของ drawer ประวัติ/modal จะถูกทับจนกดไม่ได้บนมือถือ
    const zOf = (sel) => {
        const m = CSS.match(new RegExp('\\' + sel + '\\s*\\{([^}]*)\\}'));
        const z = m && m[1].match(/z-index:\s*(\d+)/);
        return z ? Number(z[1]) : null;
    };
    const bar = zOf('.sidebar-mobile-bar');
    const drawer = CSS.match(/\.sidebar\s*\{[^}]*\}/g) && (CSS.match(/z-index:\s*(\d+);\s*\}\s*\n\s*body\.sidebar-open/) || [])[1];
    const lowestOverlay = Math.min(
        zOf('.toast-container') ?? Infinity,
        zOf('.cs-modal') ?? Infinity,
        zOf('.export-menu') ?? Infinity,
        zOf('.log-drawer-overlay') ?? Infinity
    );
    assert.ok(bar !== null, 'หา z-index ของ .sidebar-mobile-bar ไม่เจอ');
    assert.ok(Number.isFinite(lowestOverlay), 'หา z-index ของ overlay หลักไม่เจอ');
    assert.ok(
        bar < lowestOverlay,
        `แถบเมนู (z ${bar}) ต้องต่ำกว่า overlay ที่ต่ำสุดของระบบ (z ${lowestOverlay}) — ไม่งั้นทับปุ่มปิดของ drawer/modal บนมือถือ`
    );
    if (drawer) {
        assert.ok(Number(drawer) < lowestOverlay, `ลิ้นชัก (z ${drawer}) ต้องต่ำกว่า overlay ที่ต่ำสุด (z ${lowestOverlay})`);
    }
});

test('[sidebar-guard] ลิ้นชักต้องเริ่มใต้แถบบน ไม่ทับหัวเมนู', () => {
    const rule = mobileRules().find(r => r.selector.trim() === '.sidebar');
    assert.ok(rule, 'ต้องมีกฎ .sidebar ในบล็อกจอเล็ก');
    assert.ok(
        /top:\s*var\(--sidebar-bar-h\)/.test(rule.body),
        '.sidebar บนจอเล็กต้องตั้ง top: var(--sidebar-bar-h) — ถ้า top: 0 หัวเมนูจะถูกแถบบนทับ'
    );
    assert.ok(
        /height:\s*calc\(100dvh\s*-\s*var\(--sidebar-bar-h\)\)/.test(rule.body),
        '.sidebar บนจอเล็กต้องหักความสูงแถบออก ไม่งั้นเมนูล่างสุดเลื่อนไม่ถึง'
    );
});

// -----------------------------------------------------------------------------
// 2) ยามกันบั๊กชนิดนี้ไม่ให้เกิดซ้ำ — CSS responsive ต้องอ้างถึงคลาสที่มีจริงเท่านั้น
// -----------------------------------------------------------------------------
test('[sidebar-guard] ทุกคลาส .sidebar-* ในบล็อกจอเล็ก ต้องมีอยู่จริงใน DOM ที่ JS สร้าง', () => {
    const emitted = new Set();
    const add = (s) => s.split(/\s+/).filter(Boolean).forEach(c => emitted.add(c));

    // ⚠️ class ส่วนใหญ่ใน sidebar-shared.js ถูกต่อสตริง เช่น
    //    class="sidebar-nav-item' + (isActive ? ' active' : '') + '"
    //    จึงห้ามใช้ /class="([^"]+)"/ ที่ต้องการ quote ปิด — จะพลาด sidebar-nav-item/-sub/-group ทั้งหมด
    //    (แล้วเทสจะ FAIL แบบผิด ๆ จนคนไปเติมชื่อลง ALLOW และยามข้อนี้ตายสนิท)
    for (const m of SIDEBAR_JS.matchAll(/class="([a-zA-Z0-9 _-]*)/g)) add(m[1]);
    for (const m of SIDEBAR_JS.matchAll(/className\s*=\s*'([^']+)'/g)) add(m[1]);
    for (const m of SIDEBAR_JS.matchAll(/classList\.(?:add|toggle|contains|remove)\('([^']+)'/g)) emitted.add(m[1]);
    // ชิ้นส่วน class ที่มาจาก ternary เช่น (isActive ? ' active' : '')
    for (const m of SIDEBAR_JS.matchAll(/\?\s*'([a-zA-Z0-9 _-]+)'\s*:/g)) add(m[1]);

    // คลาสโครงหน้า/สถานะที่มาจาก HTML หรือหน้าอื่น ไม่ได้มาจาก sidebar-shared.js
    const ALLOW = new Set([
        'app-layout', 'main-area', 'main-content', 'content-area',
        'has-sidebar', 'sidebar', 'wall-fullscreen'
    ]);

    const unknown = new Set();
    for (const rule of mobileRules()) {
        for (const m of rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
            const cls = m[1];
            if (!emitted.has(cls) && !ALLOW.has(cls)) unknown.add(cls);
        }
    }

    assert.equal(
        unknown.size, 0,
        `CSS จอเล็กอ้างถึงคลาสที่ JS ไม่ได้สร้าง: ${[...unknown].join(', ')} — CSS responsive หลุดจาก DOM จริง (บั๊กเดิมเป็นแบบนี้)`
    );
});

test('[sidebar-guard] .sidebar ต้องมี overflow-y — กันเมนูล้นจอเตี้ย (1366×768)', () => {
    const m = CSS.match(/\n\.sidebar\s*\{([^}]*)\}/);
    assert.ok(m, 'หากฎ .sidebar ไม่เจอ');
    assert.ok(/overflow-y:\s*auto/.test(m[1]), '.sidebar ต้องตั้ง overflow-y: auto ไม่งั้นเมนูล่างสุดถูกตัดหายบนจอเตี้ย');
});

// -----------------------------------------------------------------------------
// 3) cache-buster — แก้แล้วต้องถึงผู้ใช้จริง (กฎข้อ 9 ใน CLAUDE.md)
// -----------------------------------------------------------------------------
test('[asset-ver] ทุกหน้าโหลด sidebar-shared.js ด้วยเวอร์ชันตรงกับ ASSET_VER', () => {
    const ver = assetVer();
    const bad = [];
    for (const file of htmlPages()) {
        const src = fs.readFileSync(file, 'utf8');
        const m = src.match(/src="(?:\.\.\/)?Js\/sidebar-shared\.js(\?v=([^"]*))?"/);
        if (!m) continue;                       // หน้าที่ไม่ได้ใช้ sidebar ก็ข้ามไป
        if (m[2] !== ver) bad.push(`${path.relative(PROJECT_ROOT, file)} = ${m[2] || '(ไม่มี ?v=)'}`);
    }
    assert.equal(bad.length, 0, `เวอร์ชันไม่ตรง ASSET_VER (${ver}): ${bad.join(' · ')}`);
});

test('[asset-ver] ทุกหน้าต้องใส่ ?v= ให้ Css/style.css และตรงกับ ASSET_VER', () => {
    const ver = assetVer();
    const bad = [];
    for (const file of htmlPages()) {
        const src = fs.readFileSync(file, 'utf8');
        const m = src.match(/href="(?:\.\.\/)?Css\/style\.css(\?v=([^"]*))?"/);
        if (!m) continue;
        if (m[2] !== ver) bad.push(`${path.relative(PROJECT_ROOT, file)} = ${m[2] || '(ไม่มี ?v=)'}`);
    }
    assert.equal(bad.length, 0, `style.css เวอร์ชันไม่ตรง ASSET_VER (${ver}): ${bad.join(' · ')} — ผู้ใช้จะได้ CSS เก่าค้าง cache`);
});

test('[asset-ver] ไฟล์ Js/ Css/ ในเครื่องที่อ้างจาก HTML ต้องมี ?v= เสมอ (ไม่เจาะจงเลข)', () => {
    // ยามกว้างสำหรับกฎข้อ 9 — จับกรณี "ลืมใส่ cache-buster ตั้งแต่แรก"
    // (style.css กับ ui-confirm.css เคยไม่มี ?v= เลยจนถึง 2026-08-10)
    const bad = [];
    for (const file of htmlPages()) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/(?:src|href)="((?:\.\.\/)?(?:Js|Css)\/[^"]+)"/g)) {
            if (!/\?v=.+/.test(m[1])) bad.push(`${path.relative(PROJECT_ROOT, file)} → ${m[1]}`);
        }
    }
    assert.equal(bad.length, 0, `ไฟล์ในเครื่องที่ยังไม่มี cache-buster: ${bad.join(' · ')}`);
});

// =============================================================================
// [menu-guard] โครงเมนูต้องสอดคล้องกับไฟล์ที่มีอยู่จริง
//
// ที่มา: ตอนถอดฟีเจอร์ SKU Master (2026-08-10) กลุ่ม `database` มี item เดียวพอดี
// ถ้าลบแค่ item จะเหลือ items: [] แล้ว sidebar-shared.js:149 มี special-case
// `if (group.items.length === 1)` ที่จะไม่เข้าเงื่อนไข ตกไปสาขากลุ่มพับ →
// เรนเดอร์หัวข้อ "ฐานข้อมูล" ที่กดแล้วว่างเปล่า **ทุกหน้าพร้อมกัน**
// =============================================================================

/** ดึง object/array literal จาก source โดยนับวงเล็บให้สมดุล (แม่นกว่า regex) */
function literalAfter(decl, openChar) {
    const at = SIDEBAR_JS.indexOf(decl);
    assert.ok(at >= 0, `หา ${decl} ใน sidebar-shared.js ไม่เจอ`);
    const closeChar = openChar === '[' ? ']' : '}';
    const open = SIDEBAR_JS.indexOf(openChar, at);
    let depth = 0;
    for (let i = open; i < SIDEBAR_JS.length; i++) {
        if (SIDEBAR_JS[i] === openChar) depth++;
        else if (SIDEBAR_JS[i] === closeChar) {
            depth--;
            if (depth === 0) return new Function('return ' + SIDEBAR_JS.slice(open, i + 1))();
        }
    }
    throw new Error(`วงเล็บของ ${decl} ไม่สมดุล`);
}

const GROUPS = literalAfter('const GROUPS =', '[');
const PAGE_FILES = literalAfter('const PAGE_FILES =', '{');

/** ไฟล์ HTML ของ pageId อยู่ที่ไหน — index อยู่ราก ที่เหลืออยู่ Html/ */
function pageFilePath(file) {
    return file === 'index.html'
        ? path.join(PROJECT_ROOT, file)
        : path.join(PROJECT_ROOT, 'Html', file);
}

test('[menu-guard] ทุกกลุ่มในเมนูต้องมีอย่างน้อย 1 รายการ (กันหัวข้อพับที่กดแล้วว่าง)', () => {
    const empty = GROUPS.filter(g => !g.items || g.items.length === 0).map(g => `${g.id} (${g.label})`);
    assert.equal(empty.length, 0,
        `กลุ่มเมนูที่ไม่มีรายการ: ${empty.join(' · ')} — ถ้าเอารายการสุดท้ายออก ต้องลบทั้งกลุ่มด้วย`);
});

test('[menu-guard] ทุกรายการในเมนูต้องมีใน PAGE_FILES และไฟล์นั้นต้องมีอยู่จริง', () => {
    const bad = [];
    for (const g of GROUPS) {
        for (const item of g.items) {
            const file = PAGE_FILES[item.id];
            if (!file) { bad.push(`${item.id}: ไม่มีใน PAGE_FILES`); continue; }
            if (!fs.existsSync(pageFilePath(file))) bad.push(`${item.id} → ${file} (ไม่มีไฟล์)`);
        }
    }
    assert.equal(bad.length, 0, `เมนูชี้ไปที่หน้าที่ไม่มีอยู่: ${bad.join(' · ')}`);
});

test('[menu-guard] ทุก entry ใน PAGE_FILES ต้องชี้ไฟล์ที่มีจริง และมีรายการเมนูใช้งาน', () => {
    const inMenu = new Set(GROUPS.flatMap(g => g.items.map(i => i.id)));
    const bad = [];
    for (const [pageId, file] of Object.entries(PAGE_FILES)) {
        if (!fs.existsSync(pageFilePath(file))) bad.push(`${pageId} → ${file} (ไม่มีไฟล์)`);
        else if (!inMenu.has(pageId)) bad.push(`${pageId}: มีใน PAGE_FILES แต่ไม่มีในเมนู (entry ค้าง)`);
    }
    assert.equal(bad.length, 0, `PAGE_FILES ไม่ตรงกับความจริง: ${bad.join(' · ')}`);
});

test('[menu-guard] FLAT_PAGES ต้องอ้างเฉพาะหน้าที่มีในเมนูจริง', () => {
    const flat = literalAfter('const FLAT_PAGES = new Set(', '[');
    const inMenu = new Set(GROUPS.flatMap(g => g.items.map(i => i.id)));
    const bad = flat.filter(id => !inMenu.has(id));
    assert.equal(bad.length, 0, `FLAT_PAGES มีหน้าที่ไม่อยู่ในเมนูแล้ว: ${bad.join(' · ')}`);
});
