// เทสยามระบบธีม Light/Dark (Phase 1 — 2026-08-13)
//
// สถาปัตยกรรม: Css/style.css ประกาศ design tokens ใน :root (dark = ค่าเริ่มต้น)
// + html[data-theme="light"] override · ทุกหน้ามี boot script ใน <head> ก่อน <link> style.css
// (กัน flash ธีมผิด) · หน้าที่ inline style แปลงเป็น token ครบแล้วติด data-theme-ready
// บน <html> — หน้าที่ไม่ติด boot จะบังคับ dark เสมอ ต่อให้ผู้ใช้เลือก light ไว้
//
// ยามอะไร:
//   [theme-guard] boot script ครบทุกหน้า + อยู่ก่อน style.css + เนื้อหาตรงกันทุกหน้า
//   [theme-guard] token ทุกตัวใน :root ต้องมีคู่ light (เพิ่ม token แล้วลืมฝั่ง light = จอสว่างสีเพี้ยน)
//   [theme-guard] หน้าไหนติด data-theme-ready → ห้ามเหลือสี hex ดิบใน <style> เกิน 3 จุด
//   [theme-guard] @import Outfit ห้ามหาย (8/12 หน้าพึ่งพามัน — ดู FIX_TRACKING)
//   [theme-guard] จอ TV (live_count_wall) ต้อง dark ถาวร — ห้ามติด data-theme-ready
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('ui: theme guard (Light/Dark tokens)');

const PAGES = [
    'index.html',
    'Html/import_counts.html', 'Html/audit_check.html', 'Html/count_search.html',
    'Html/reconcile.html', 'Html/adjust_history.html', 'Html/book_explorer.html',
    'Html/dashboard.html', 'Html/live_count_wall.html', 'Html/settings.html',
    'Html/cycle_config.html', 'Html/chat.html'
];

const CSS = fs.readFileSync(path.join(PROJECT_ROOT, 'Css/style.css'), 'utf8');
const pageSrc = (p) => fs.readFileSync(path.join(PROJECT_ROOT, p), 'utf8');

/** ดึงเนื้อในบล็อก { ... } แรกหลัง selector โดยนับปีกกา */
function blockOf(src, selector) {
    const at = src.indexOf(selector);
    assert.ok(at >= 0, `ไม่เจอ "${selector}" ใน style.css`);
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    assert.fail(`บล็อก "${selector}" ปีกกาไม่สมดุล`);
}

test('[theme-guard] ทุกหน้ามี boot script เหมือนกัน และอยู่ก่อน <link> style.css', () => {
    for (const p of PAGES) {
        const s = pageSrc(p);
        const boot = s.indexOf("localStorage.getItem('theme_v1')");
        const ready = s.indexOf("hasAttribute('data-theme-ready')");
        const link = s.search(/<link[^>]*Css\/style\.css\?v=/);
        assert.ok(boot >= 0, `${p}: ไม่มี boot script (theme_v1)`);
        assert.ok(ready >= 0, `${p}: boot script ไม่เช็ค data-theme-ready (หน้าไม่พร้อมต้องบังคับ dark)`);
        assert.ok(link >= 0, `${p}: ไม่เจอ <link> style.css`);
        assert.ok(boot < link, `${p}: boot script ต้องอยู่ก่อน <link> style.css ไม่งั้นเกิด flash ธีมผิด`);
    }
});

test('[theme-guard] token สีทุกตัวใน :root ต้องถูก override ในบล็อก light ครบ', () => {
    const rootBlock = blockOf(CSS, ':root');
    const lightBlock = blockOf(CSS, 'html[data-theme="light"]');
    const tokenNames = (block) => [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);

    const rootTokens = tokenNames(rootBlock).filter(name => {
        // ข้าม alias (ค่าเป็น var(...)) และตัวแปร layout ที่ไม่ใช่สี
        const val = rootBlock.match(new RegExp(name.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;]+);'));
        if (!val) return false;
        if (val[1].includes('var(')) return false;
        if (name === '--sidebar-bar-h') return false;
        return true;
    });
    assert.ok(rootTokens.length >= 40, `token ใน :root น้อยผิดปกติ (${rootTokens.length})`);

    const lightSet = new Set(tokenNames(lightBlock));
    const missing = rootTokens.filter(t => !lightSet.has(t));
    assert.deepEqual(missing, [], `token ขาดฝั่ง light: ${missing.join(', ')}`);

    // ฝั่งกลับ: light ห้ามประกาศ token ที่ :root ไม่รู้จัก (กัน typo เงียบ)
    const rootSet = new Set(tokenNames(rootBlock));
    const orphan = tokenNames(lightBlock).filter(t => !rootSet.has(t));
    assert.deepEqual(orphan, [], `token ฝั่ง light ที่ :root ไม่มี: ${orphan.join(', ')}`);
});

test('[theme-guard] หน้าที่ติด data-theme-ready ห้ามเหลือสี hex ดิบใน <style> เกิน 3 จุด', () => {
    for (const p of PAGES) {
        const s = pageSrc(p);
        if (!/<html[^>]*\bdata-theme-ready\b/.test(s)) continue;
        const styles = [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
        const hexes = styles.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
        assert.ok(hexes.length <= 3,
            `${p}: ติด data-theme-ready แล้วแต่ยังมีสี hex ดิบใน <style> ${hexes.length} จุด (เกิน 3) — แปลงเป็น var(--token) ก่อน: ${hexes.slice(0, 8).join(' ')}`);
    }
});

test('[theme-guard] @import ฟอนต์ Outfit ยังอยู่ (ห้ามลบ — 8 หน้าไม่มี <link> ของตัวเอง)', () => {
    assert.match(CSS, /@import[^;]*family=Outfit/, 'ห้ามลบ @import Outfit ใน Css/style.css');
});

test('[theme-guard] ปุ่มสลับธีมอยู่ใน sidebar-shared.js และผูกด้วย addEventListener', () => {
    const js = fs.readFileSync(path.join(PROJECT_ROOT, 'Js/sidebar-shared.js'), 'utf8');
    assert.ok(js.includes('class="sidebar-theme-toggle"'), 'ไม่เจอปุ่ม sidebar-theme-toggle');
    assert.ok(js.includes("localStorage.setItem(THEME_KEY"), 'สลับธีมแล้วต้องเขียน localStorage');
    assert.ok(js.includes("CustomEvent('themechange'"), 'สลับธีมแล้วต้องประกาศ event themechange (กราฟใช้วาดใหม่)');
    assert.ok(!/sidebar-theme-toggle[^>]*onclick=/.test(js), 'ห้ามผูกปุ่มด้วย onclick string (กฎ xss-guard)');
});

test('[theme-guard] จอ TV live_count_wall ต้อง dark ถาวร — ห้ามติด data-theme-ready', () => {
    const s = pageSrc('Html/live_count_wall.html');
    assert.ok(!/<html[^>]*\bdata-theme-ready\b/.test(s),
        'live_count_wall เป็นจอ TV ในคลัง เปิดค้างทั้งวัน — นโยบายคือ dark ถาวร (boot script บังคับให้เองเมื่อไม่มี attr นี้)');
});
