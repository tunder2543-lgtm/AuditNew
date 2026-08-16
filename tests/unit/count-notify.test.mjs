// เทสแจ้งเตือนผลนับข้ามหน้า (Js/count-notify-shared.js)
//
// กติกาโปรเจกต์: ต้อง "รัน" ฟังก์ชันจริง — handlePayload/buildToastModel ถูกรันจริง
// ครบทั้ง 3 เหตุการณ์ + เส้นทางปิดสวิตช์ + เส้นทางข้ามหน้าจอนับสด
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('แจ้งเตือนผลนับข้ามหน้า');

const JS_PATH = path.join(PROJECT_ROOT, 'Js', 'count-notify-shared.js');
const CSS_PATH = path.join(PROJECT_ROOT, 'Css', 'count-notify.css');
const SIDEBAR_PATH = path.join(PROJECT_ROOT, 'Js', 'sidebar-shared.js');
const src = fs.readFileSync(JS_PATH, 'utf8');

/**
 * ดึงค่าตัวแปรระดับโมดูลจากซอร์สจริง (lift ยกมาแต่ฟังก์ชัน ค่าพวกนี้ต้องป้อนเข้า sandbox เอง)
 * อ่านจากซอร์สแทนการพิมพ์ซ้ำ — ถ้าค่าจริงเปลี่ยน เทสจะใช้ค่าใหม่ทันที ไม่แอบเขียว
 */
function constFromSource(name) {
    const marker = 'var ' + name + ' = ';
    const at = src.indexOf(marker);
    assert.ok(at >= 0, `หา ${name} ใน count-notify-shared.js ไม่เจอ — โครงไฟล์เปลี่ยน?`);
    let i = at + marker.length;
    let depth = 0;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        else if (ch === '}' || ch === ']' || ch === ')') depth--;
        else if (ch === ';' && depth === 0) break;
    }
    const expr = src.slice(at + marker.length, i);
    return new Function('return (' + expr + ')')();
}

const ENABLED_KEY = constFromSource('ENABLED_KEY');

/** DOM จำลองเท่าที่โมดูลใช้ — element ที่สร้างจริงเก็บลูกไว้ให้ assert ได้ */
function fakeEl(tag) {
    return {
        tag,
        className: '',
        style: {},
        type: '',
        children: [],
        textContent: '',
        attrs: {},
        classList: { add() {}, toggle() {} },
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(c) { this.children.push(c); return c; },
        prepend(c) { this.children.unshift(c); return c; },
        addEventListener() {},
        remove() {},
        get lastElementChild() { return this.children[this.children.length - 1] || null; },
        getBoundingClientRect() { return { height: 0, bottom: 0 }; },
    };
}

function setup({ enabled = true, pathname = '/Html/dashboard.html', activePage = 'dashboard' } = {}) {
    const store = {};
    if (!enabled) store[ENABLED_KEY] = '0';
    const created = [];
    const body = fakeEl('body');
    const context = {
        // ตัวแปรระดับโมดูล — ดึงค่าจริงจากซอร์ส · stackEl ต้องมีเพื่อให้ ensureStack เขียนทับได้
        ENABLED_KEY,
        META: constFromSource('META'),
        TOAST_MS: constFromSource('TOAST_MS'),
        MAX_TOASTS: constFromSource('MAX_TOASTS'),
        stackEl: null,
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; },
        },
        document: {
            body: Object.assign(body, { contains: () => true }),
            createElement: (t) => { const e = fakeEl(t); created.push(e); return e; },
            querySelector: () => null,          // ไม่มีกองแชทบนหน้า
            documentElement: {},
        },
        getComputedStyle: () => ({ getPropertyValue: () => '52px' }),
        setTimeout: () => 0,
        window: {
            location: { pathname },
            sidebarShared: { getActivePage: () => activePage },
            matchMedia: () => ({ matches: false }),
        },
    };
    context.window.window = context.window;
    const fns = liftFunctions(src, [
        'isEnabled', 'setEnabled', 'isOnLiveWallPage', 'toQty', 'fmtQty', 'buildToastModel',
        'ensureStack', 'syncStackOffset', 'clearAllToasts', 'el', 'showToast', 'handlePayload',
    ], context);
    return { fns, store, created, context };
}

const ROW = {
    sku_id: 'BNP20', counted_qty: 200, warehouse: 'ตึกกันตนา',
    location: 'B2-01', counter_name: 'สมชาย',
};

// ---------- buildToastModel ----------

test('INSERT: ประกอบข้อความครบ ผู้นับ · SKU · คลัง/ตำแหน่ง · จำนวน', () => {
    const { fns } = setup();
    const m = fns.buildToastModel('INSERT', ROW, null);
    assert.equal(m.type, 'INSERT');
    assert.equal(m.title, 'เพิ่มรายการนับ');
    assert.equal(m.className, 'count-notify-insert');
    assert.equal(m.who, 'สมชาย');
    assert.equal(m.sku, 'BNP20');
    assert.equal(m.place, 'ตึกกันตนา / B2-01');
    assert.equal(m.qtyText, 'จำนวน 200');
});

test('UPDATE: จำนวนเปลี่ยนต้องโชว์ลูกศร ก่อน → หลัง · ไม่เปลี่ยนโชว์ค่าเดียว', () => {
    const { fns } = setup();
    const changed = fns.buildToastModel('UPDATE', { ...ROW, counted_qty: 200 }, { ...ROW, counted_qty: 70 });
    assert.equal(changed.qtyText, 'จำนวน 70 → 200');
    assert.equal(changed.className, 'count-notify-update');
    const same = fns.buildToastModel('UPDATE', { ...ROW, counted_qty: 200 }, { ...ROW, counted_qty: 200 });
    assert.equal(same.qtyText, 'จำนวน 200', 'จำนวนเท่าเดิมห้ามโชว์ลูกศร');
});

test('DELETE: ใช้ค่าจากแถวเก่า (payload.new ว่าง) และบอกว่าเป็นจำนวนที่ลบ', () => {
    const { fns } = setup();
    const m = fns.buildToastModel('DELETE', {}, ROW);
    assert.equal(m.qtyText, 'จำนวนที่ลบ 200');
    assert.equal(m.className, 'count-notify-delete');
    assert.equal(m.sku, 'BNP20');
});

test('ข้อมูลไม่ครบต้องไม่โยน error และไม่โชว์ค่าเพี้ยน (DELETE ส่งมาไม่ครบทุกคอลัมน์)', () => {
    const { fns } = setup();
    const bare = fns.buildToastModel('INSERT', {}, null);
    assert.equal(bare.who, 'ไม่ระบุผู้นับ');
    assert.equal(bare.sku, '-');
    assert.equal(bare.place, '- / -');
    assert.equal(bare.qtyText, 'จำนวน -', 'จำนวนที่อ่านไม่ได้ต้องเป็น - ไม่ใช่ 0 หรือ NaN');
    assert.equal(fns.buildToastModel('TRUNCATE', ROW, null), null, 'เหตุการณ์ที่ไม่รู้จัก = ไม่เด้ง');
    assert.equal(fns.buildToastModel('INSERT', null, null), null, 'ไม่มีข้อมูลแถว = ไม่เด้ง');
});

// ---------- handlePayload (เส้นทางจริงจาก realtime) ----------

test('handlePayload: เปิดสวิตช์อยู่ + ไม่ใช่หน้าจอนับสด → เด้ง popup จริง', () => {
    const { fns, created } = setup();
    assert.equal(fns.handlePayload({ eventType: 'INSERT', new: ROW }), true);
    const texts = created.map(e => e.textContent).join(' | ');
    assert.ok(texts.includes('เพิ่มรายการนับ'), 'ต้องมีหัวข้อในกล่อง');
    assert.ok(texts.includes('สมชาย · BNP20'), 'ต้องมีบรรทัดผู้นับ+SKU');
    assert.ok(texts.includes('ตึกกันตนา / B2-01 · จำนวน 200'), 'ต้องมีบรรทัดคลัง/ตำแหน่ง+จำนวน');
});

test('handlePayload: ปิดสวิตช์แล้วต้องไม่สร้าง popup เลย', () => {
    const { fns, created } = setup({ enabled: false });
    assert.equal(fns.isEnabled(), false);
    assert.equal(fns.handlePayload({ eventType: 'INSERT', new: ROW }), false);
    assert.equal(created.length, 0, 'ปิดแล้วห้ามสร้าง element ใด ๆ');
});

test('handlePayload: หน้าจอนับสดต้องข้าม (มี popup ของตัวเองอยู่แล้ว ไม่งั้นเด้งซ้อน 2 อัน)', () => {
    const byPage = setup({ activePage: 'live_count_wall' });
    assert.equal(byPage.fns.handlePayload({ eventType: 'INSERT', new: ROW }), false);
    assert.equal(byPage.created.length, 0);
    // เผื่อ sidebarShared ยังไม่โหลด — ต้องดู pathname เป็นทางสำรอง
    const byPath = setup({ activePage: '', pathname: '/Html/live_count_wall.html' });
    assert.equal(byPath.fns.handlePayload({ eventType: 'INSERT', new: ROW }), false);
});

test('setEnabled: สลับค่าแล้วอ่านกลับได้ · ค่าเริ่มต้น (ไม่เคยตั้ง) = เปิด', () => {
    const { fns, store } = setup();
    assert.equal(fns.isEnabled(), true, 'ไม่เคยตั้งค่า = เปิด');
    fns.setEnabled(false);
    assert.equal(store[ENABLED_KEY], '0');
    assert.equal(fns.isEnabled(), false);
    fns.setEnabled(true);
    assert.equal(fns.isEnabled(), true);
});

// ---------- ยามฝั่ง sidebar / กติกา ----------

test('[guard] sidebar-shared.js ฉีดทั้ง CSS และ JS ของโมดูลนี้ให้ทุกหน้า + มีปุ่มสวิตช์', () => {
    const sb = fs.readFileSync(SIDEBAR_PATH, 'utf8');
    assert.ok(sb.includes("Css/count-notify.css?v=' + ASSET_VER"), 'ต้องฉีด CSS พร้อม cache-buster');
    assert.ok(sb.includes("Js/count-notify-shared.js'"), 'ต้องฉีดสคริปต์');
    assert.ok(sb.includes('sidebarCountNotifyToggle'), 'ต้องมีปุ่มสวิตช์ท้ายเมนู');
    assert.ok(sb.includes('countNotifyShared'), 'ปุ่มต้องคุยกับโมดูลจริง');
    // scriptReady ต้องรู้จักไฟล์ใหม่ ไม่งั้น loadScript รอ callback ที่ไม่มีวันมาเมื่อสคริปต์ถูกโหลดไว้แล้ว
    assert.ok(/count-notify-shared\\?\.js\/i\.test\(src\) && window\.countNotifyShared/.test(sb),
        'scriptReady ต้องเช็ค window.countNotifyShared');
});

test('[guard] count-notify-shared.js ห้ามใช้ innerHTML ทั้งไฟล์ (invariant ข้อ 7)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!code.includes('innerHTML'), 'พบ innerHTML ในโค้ดจริง');
});

test('[theme-guard] count-notify.css ห้ามมีสี hex/rgba ดิบ — ต้องใช้ var(--token) เท่านั้น', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
    assert.deepEqual(hits, [], 'พบสีดิบใน count-notify.css: ' + hits.join(', '));
});

test('[guard] ไม่มี polling — โมดูลนี้ต้องพึ่ง realtime อย่างเดียว (กันกินโควตา Supabase ฟรี)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/setInterval/.test(code), 'ห้ามมี setInterval — ตกลงกันว่าไม่ทำ polling');
    assert.ok(!/\.from\(/.test(code), 'ห้าม query ตารางตรง ๆ — รับข้อมูลจาก realtime payload เท่านั้น');
});
