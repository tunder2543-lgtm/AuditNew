// เทสหน้า "ประวัติการปรับ / ยืนยัน" (Html/adjust_history.html)
//
// กติกาของโปรเจกต์: แก้บรรทัดในฟังก์ชันไหน ต้องมีเทสที่ **รัน** ฟังก์ชันนั้น
// ไม่ใช่แค่เทสที่อ่านซอร์ส (พลาดมาแล้ว 5 ครั้ง — ล่าสุด `submitGroup` พังถึงมือผู้ใช้
// ทั้งที่เทส 348 ข้อเขียวหมด) ⇒ ที่นี่โหลด Js/adjust-history-shared.js เข้า vm จริง
// แล้วเรียกฟังก์ชันด้วย input จริง · ส่วนเส้นทาง "คืนค่า" ยกมารันทั้งฟังก์ชัน
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions, liftInto, bodyOf } from '../helpers/lift.mjs';

suite('ประวัติการปรับ / ยืนยัน (adjust_history)');

const PAGE = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'adjust_history.html'), 'utf8');
const SHARED_SRC = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'adjust-history-shared.js'), 'utf8');
const RECONCILE_SHARED = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'reconcile-shared.js'), 'utf8');

const norm = v => String(v ?? '').trim().toUpperCase();

/** ค่า `RS` ปลอมเท่าที่ adjust-history-shared ใช้จริง */
const FAKE_RS = {
    normalizeSku: norm,
    dateToBangkokStartISO: d => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00+07:00` : null),
    dateToBangkokEndExclusiveISO: d => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
        if (!m) return null;
        const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
        const p = n => String(n).padStart(2, '0');
        return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T00:00:00+07:00`;
    },
    formatWarehouseDisplay: wh => String(wh || ''),
};

/** โหลดไฟล์จริงเข้า sandbox แล้วคืน window.adjustHistoryService */
function loadAH(rs = FAKE_RS) {
    const sandbox = { window: { reconcileService: rs }, console: { warn() {}, error() {} } };
    vm.createContext(sandbox);
    vm.runInContext(SHARED_SRC, sandbox);
    assert.ok(sandbox.window.adjustHistoryService, 'ไฟล์ต้อง export window.adjustHistoryService');
    return sandbox.window.adjustHistoryService;
}

const AH = loadAH();

/** ชุดข้อมูลตัวอย่างในรูปแบบเดียวกับที่ buildAdjustHistoryEntries คืนออกมา */
function sample() {
    return [
        { type: 'adj', sku: 'A1', qty: 5, status: 'applied', note: 'ยอมรับผลนับ', detail: '+5 (applied) — ยอมรับผลนับ', by: 'BAM', at: '2026-08-10T03:00:00Z' },
        { type: 'adj', sku: 'B2', qty: -3, status: 'draft', note: '', detail: '-3 (draft)', by: 'PAT', at: '2026-08-11T03:00:00Z' },
        { type: 'adj', sku: 'C3', qty: 1, status: 'applied', note: '', detail: '+1 (applied)', by: '', at: '2026-08-12T03:00:00Z' },
        { type: 'ack', sku: 'D4', qty: null, status: null, note: 'ตรวจแล้ว', detail: 'ยืนยันเป็นถูกต้อง (ไม่ปรับยอด) — ตรวจแล้ว', by: 'MAY', at: '2026-08-11T09:00:00Z' },
    ];
}

const skus = list => list.map(e => e.sku).join(',');

// -----------------------------------------------------------------------------
// buildAdjustHistoryEntries — field ดิบต้องครบ (filter/sort ทั้งหน้าพึ่งมัน)
// -----------------------------------------------------------------------------
test('buildAdjustHistoryEntries ให้ field ดิบ (qty/status/note) ครบ ไม่ใช่แค่ข้อความ', () => {
    const f = liftFunctions(RECONCILE_SHARED, ['buildAdjustHistoryEntries'], {});
    const out = f.buildAdjustHistoryEntries(
        [
            { sku_id: 'A1', adjustment_qty: 3, status: 'applied', note: 'ยอมรับผลนับ', created_by: 'BAM', created_at: '2026-08-11T05:00:00Z', applied_at: '2026-08-11T05:01:00Z' },
            { sku_id: 'D1', adjustment_qty: -2, status: 'draft', reason: 'reconcile', created_at: '2026-08-11T07:00:00Z' },
        ],
        new Map([['B1', { note: 'ตรวจแล้ว', accepted_by: 'PAT', accepted_at: '2026-08-11T06:00:00Z' }]])
    );
    const byS = Object.fromEntries(out.map(e => [e.sku, e]));
    assert.equal(byS.A1.qty, 3);
    assert.equal(byS.A1.status, 'applied');
    assert.equal(byS.D1.qty, -2);
    assert.equal(byS.D1.status, 'draft');
    assert.equal(byS.D1.note, 'reconcile', 'ไม่มี note ให้ใช้ reason แทน — ไม่งั้นค้นรายละเอียดไม่เจอ');
    assert.equal(byS.B1.qty, null, 'ยืนยันถูกต้องไม่มีจำนวน ต้องเป็น null ไม่ใช่ 0');
    assert.equal(byS.B1.status, null);
    // ข้อความต้องเหมือนเดิมเป๊ะ — modal เดิมกับหน้าใหม่ต้องอ่านได้ตรงกัน
    assert.match(byS.A1.detail, /\+3 \(applied\) — ยอมรับผลนับ/);
    assert.match(byS.D1.detail, /-2 \(draft\) — reconcile/);
});

// -----------------------------------------------------------------------------
// filter
// -----------------------------------------------------------------------------
test('[filter] ไม่ใส่เกณฑ์ = ได้ครบทุกแถว', () => {
    assert.equal(AH.filterHistoryEntries(sample(), {}).length, 4);
    assert.equal(AH.filterHistoryEntries(sample(), { sku: '', type: '', qtyMin: '', qtyMax: '' }).length, 4);
});

test('[filter] ประเภท — แยก ยอดปรับ / ร่าง / ปรับแล้ว / ยืนยันถูกต้อง', () => {
    const s = sample();
    assert.equal(skus(AH.filterHistoryEntries(s, { type: 'adj' })), 'A1,B2,C3');
    assert.equal(skus(AH.filterHistoryEntries(s, { type: 'ack' })), 'D4');
    assert.equal(skus(AH.filterHistoryEntries(s, { type: 'adj:draft' })), 'B2');
    assert.equal(skus(AH.filterHistoryEntries(s, { type: 'adj:applied' })), 'A1,C3');
});

test('[filter] SKU ค้นแบบ contains และ normalize ตัวพิมพ์ให้ (invariant ข้อ 2)', () => {
    assert.equal(skus(AH.filterHistoryEntries(sample(), { sku: 'a1' })), 'A1');
    assert.equal(skus(AH.filterHistoryEntries(sample(), { sku: '  b  ' })), 'B2');
    assert.equal(AH.filterHistoryEntries(sample(), { sku: 'ZZZ' }).length, 0);
});

test('[filter] รายละเอียด ค้นข้อความไม่สนตัวพิมพ์', () => {
    assert.equal(skus(AH.filterHistoryEntries(sample(), { detail: 'ยอมรับผลนับ' })), 'A1');
    assert.equal(skus(AH.filterHistoryEntries(sample(), { detail: 'DRAFT' })), 'B2');
});

test('[filter] วันที่ตีความเป็นเวลาไทย และ "ถึงวันที่" รวมทั้งวันนั้น', () => {
    const s = sample();
    // 2026-08-11T03:00Z = 10:00 ของวันที่ 11 ตามเวลาไทย
    assert.equal(skus(AH.filterHistoryEntries(s, { dateFrom: '2026-08-11', dateTo: '2026-08-11' })), 'B2,D4');
    assert.equal(skus(AH.filterHistoryEntries(s, { dateFrom: '2026-08-12' })), 'C3');
    assert.equal(skus(AH.filterHistoryEntries(s, { dateTo: '2026-08-10' })), 'A1');
});

test('[filter] แถวไม่มีเวลา ต้องตกออกเมื่อระบุช่วงวัน (ไม่เดาแทนคน)', () => {
    const s = sample().concat([{ type: 'adj', sku: 'NOAT', qty: 1, status: 'applied', note: '', detail: '+1', by: '', at: null }]);
    assert.equal(AH.filterHistoryEntries(s, {}).length, 5, 'ไม่กรองวัน = ต้องยังเห็น');
    assert.ok(!skus(AH.filterHistoryEntries(s, { dateFrom: '2026-08-01' })).includes('NOAT'));
});

test('[filter] ช่วงจำนวนใช้ค่าจริงมีเครื่องหมาย และตัดแถว "ยืนยันถูกต้อง" ออก', () => {
    const s = sample();
    assert.equal(skus(AH.filterHistoryEntries(s, { qtyMin: 0 })), 'A1,C3', 'ค่าติดลบต้องหลุดออก ไม่ใช่นับเป็นขนาด');
    assert.equal(skus(AH.filterHistoryEntries(s, { qtyMax: 0 })), 'B2');
    assert.equal(skus(AH.filterHistoryEntries(s, { qtyMin: -3, qtyMax: 1 })), 'B2,C3');
    assert.ok(!skus(AH.filterHistoryEntries(s, { qtyMin: -99, qtyMax: 99 })).includes('D4'),
        'ack ไม่มีจำนวน — ระบุช่วงเมื่อไหร่ต้องหลุด');
});

test('[filter] หลายเกณฑ์รวมกันแบบ AND', () => {
    const got = AH.filterHistoryEntries(sample(), { type: 'adj', qtyMin: 0, dateFrom: '2026-08-12' });
    assert.equal(skus(got), 'C3');
});

// -----------------------------------------------------------------------------
// sort
// -----------------------------------------------------------------------------
test('[sort] จำนวนใช้ค่าจริงมีเครื่องหมาย (+5 > +1 > −3) ไม่ใช่ขนาด', () => {
    assert.equal(skus(AH.sortHistoryEntries(sample(), 'qty', 'desc')).split(',').slice(0, 3).join(','), 'A1,C3,B2');
    assert.equal(skus(AH.sortHistoryEntries(sample(), 'qty', 'asc')).split(',').slice(0, 3).join(','), 'B2,C3,A1');
});

test('[sort] แถวที่ไม่มีจำนวนไปท้ายเสมอ ทั้ง asc และ desc', () => {
    for (const dir of ['asc', 'desc']) {
        const out = AH.sortHistoryEntries(sample(), 'qty', dir);
        assert.equal(out[out.length - 1].sku, 'D4', `dir=${dir} — ack ต้องอยู่ท้าย ไม่ใช่เด้งขึ้นหัวตอนสลับทิศ`);
    }
});

test('[sort] วันเวลา / SKU / ประเภท', () => {
    assert.equal(skus(AH.sortHistoryEntries(sample(), 'at', 'desc')), 'C3,D4,B2,A1');
    assert.equal(skus(AH.sortHistoryEntries(sample(), 'at', 'asc')), 'A1,B2,D4,C3');
    assert.equal(skus(AH.sortHistoryEntries(sample(), 'sku', 'asc')), 'A1,B2,C3,D4');
    assert.equal(skus(AH.sortHistoryEntries(sample(), 'sku', 'desc')), 'D4,C3,B2,A1');
    // ประเภท: ยอดปรับมาก่อนยืนยันถูกต้อง แล้ว tiebreak ด้วย sku
    assert.equal(skus(AH.sortHistoryEntries(sample(), 'type', 'asc')), 'A1,B2,C3,D4');
});

test('[sort] ค่าเสมอกันต้องได้ลำดับเดิมทุกครั้ง (ไม่สลับเองระหว่าง render)', () => {
    const tie = [
        { type: 'adj', sku: 'Z9', qty: 1, status: 'applied', detail: '', by: '', at: '2026-08-11T03:00:00Z' },
        { type: 'adj', sku: 'A1', qty: 1, status: 'applied', detail: '', by: '', at: '2026-08-11T03:00:00Z' },
        { type: 'adj', sku: 'M5', qty: 1, status: 'applied', detail: '', by: '', at: '2026-08-11T03:00:00Z' },
    ];
    const a = skus(AH.sortHistoryEntries(tie, 'qty', 'desc'));
    const b = skus(AH.sortHistoryEntries(tie.slice().reverse(), 'qty', 'desc'));
    assert.equal(a, b, 'ลำดับ input ต่างกันต้องได้ผลเดียวกัน');
    assert.equal(a, 'A1,M5,Z9');
});

test('[sort] ไม่แก้ array เดิม + key ที่ไม่รู้จักตกไปที่วันเวลา', () => {
    const s = sample();
    const before = skus(s);
    AH.sortHistoryEntries(s, 'sku', 'asc');
    assert.equal(skus(s), before, 'ต้องคืน array ใหม่ ไม่ sort ทับของเดิม');
    assert.equal(skus(AH.sortHistoryEntries(s, 'มั่ว', 'desc')), skus(AH.sortHistoryEntries(s, 'at', 'desc')));
});

// -----------------------------------------------------------------------------
// export
// -----------------------------------------------------------------------------
test('[export] คอลัมน์ครบ 7 ช่องตามที่ admin สั่ง และเรียงตามที่กำหนด', () => {
    // ⚠️ deepStrictEqual ใช้ข้าม realm ของ vm ไม่ได้ (prototype คนละตัว) — เทียบผ่าน JSON
    assert.equal(JSON.stringify(AH.EXPORT_HEADERS),
        JSON.stringify(['ประเภท', 'SKU', 'จำนวน', 'สถานะ', 'รายละเอียด', 'โดย', 'วันเวลา (ไทย)']));
    const rows = AH.buildHistoryExportRows(sample());
    assert.equal(rows.length, 4);
    assert.equal(JSON.stringify(Object.keys(rows[0])), JSON.stringify([...AH.EXPORT_HEADERS]));
});

test('[export] ค่าที่ส่งออกตรงกับที่แสดง — จำนวนเป็นตัวเลข, ack เว้นว่าง', () => {
    const rows = AH.buildHistoryExportRows(sample());
    const byS = Object.fromEntries(rows.map(r => [r['SKU'], r]));
    assert.equal(byS['A1']['ประเภท'], 'ยอดปรับ');
    assert.equal(byS['A1']['จำนวน'], 5, 'ต้องเป็น number ไม่ใช่สตริง — ไม่งั้น Excel เรียง/รวมไม่ได้');
    assert.equal(byS['B2']['จำนวน'], -3);
    assert.equal(byS['B2']['สถานะ'], 'ร่าง');
    assert.equal(byS['A1']['สถานะ'], 'ปรับแล้ว');
    assert.equal(byS['D4']['ประเภท'], 'ยืนยันถูกต้อง');
    assert.equal(byS['D4']['จำนวน'], '', 'ไม่มีจำนวน = เว้นว่าง ห้ามใส่ 0 (จะอ่านเป็น "ปรับ 0")');
    assert.equal(byS['D4']['สถานะ'], '');
});

test('[export] วันเวลาเป็นเวลาไทย ไม่ใช่ UTC', () => {
    // 2026-08-11T19:30Z = 2026-08-12 02:30 ตามเวลาไทย
    assert.equal(AH.fmtBangkokDateTime('2026-08-11T19:30:00Z'), '2026-08-12 02:30');
    assert.equal(AH.fmtBangkokDateTime(null), '');
});

test('[export] ชื่อไฟล์: ชื่อฟีเจอร์ + คลัง + รอบ + วันเวลาไทย', () => {
    const name = AH.buildHistoryFileName(
        { warehouse: 'ตึกกันตนา', year_month: '2026-08' },
        'xlsx',
        new Date('2026-08-13T09:10:00Z')     // = 16:10 เวลาไทย
    );
    assert.equal(name, 'ประวัติการปรับ-ยืนยัน_ตึกกันตนา_2026-08_2026-08-13_1610.xlsx');
});

test('[export] ชื่อไฟล์ห้ามมีอักขระที่ Windows ใช้ไม่ได้ (คลังหลายตัวคั่นด้วย |)', () => {
    const name = AH.buildHistoryFileName({ warehouse: 'A|B', year_month: '2026-08' }, 'csv');
    assert.ok(!/[\\/:*?"<>|]/.test(name.replace(/\.csv$/, '')), `ยังมีอักขระต้องห้าม: ${name}`);
    assert.ok(name.startsWith('ประวัติการปรับ-ยืนยัน_'), name);
    assert.ok(name.endsWith('.csv'), name);
});

test('[export] เวลาในชื่อไฟล์เป็น Asia/Bangkok ไม่ใช่ timezone เครื่อง', () => {
    // 17:00Z ของวันที่ 12 = เที่ยงคืนของวันที่ 13 ตามเวลาไทย ⇒ ต้องขึ้นวันใหม่
    assert.equal(AH.bangkokStampForFilename(new Date('2026-08-12T17:00:00Z')), '2026-08-13_0000');
});

test('[export] CSV มี BOM และ escape เครื่องหมายคำพูด/จุลภาค', () => {
    const csv = AH.toCsv(AH.buildHistoryExportRows([
        { type: 'adj', sku: 'A1', qty: 2, status: 'applied', detail: 'ยอมรับ, ทั้งชุด "OK"', by: 'BAM', at: '2026-08-11T03:00:00Z' },
    ]));
    assert.ok(csv.startsWith('﻿'), 'ไม่มี BOM แล้ว Excel เปิดภาษาไทยเป็นขยะ');
    assert.ok(csv.includes('"ยอมรับ, ทั้งชุด ""OK"""'), csv);
    assert.ok(csv.split('\r\n')[0].startsWith('﻿ประเภท,SKU,จำนวน'), 'บรรทัดแรกต้องเป็นหัวคอลัมน์');
});

test('[export] ไม่มีรายการ ก็ยังได้หัวคอลัมน์ (ไฟล์ว่างต้องอ่านออก)', () => {
    const csv = AH.toCsv([]);
    assert.ok(csv.includes('ประเภท,SKU,จำนวน,สถานะ,รายละเอียด,โดย,วันเวลา (ไทย)'), csv);
});

// -----------------------------------------------------------------------------
// เส้นทางคืนค่า — ยกมารันจริงทั้งฟังก์ชัน
// -----------------------------------------------------------------------------
function fakeEl(extra = {}) {
    return {
        value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
        dataset: {}, style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
        ...extra,
    };
}

function liftRestore({ confirm = true, selected = ['P1', 'P2'], cycleId = 'cyc-1', clearThrows = null } = {}) {
    const calls = { clear: null, refresh: [], reload: 0, locked: 0 };
    const toasts = [];
    const els = { loading: fakeEl(), loadingText: fakeEl(), btnRestore: fakeEl(), cycleSelect: fakeEl() };
    const fns = liftFunctions(PAGE, ['restoreSelected', 'restoreSelectedInner'], {
        isBusy: false,
        selectedSkus: new Set(selected),
        RS: {
            clearAdjustmentsAndMatchAcceptancesForSkus: async (cid, skus) => {
                if (clearThrows) throw new Error(clearThrows);
                calls.clear = { cycleId: cid, skus };
                return { deleted: skus.length, logged: skus.length };
            },
            refreshReconciliation: async (cid) => { calls.refresh.push(cid); },
        },
        lockCycleId: () => { calls.locked++; return cycleId; },
        stillOnCycle: () => true,
        uiConfirm: { twoStep: async () => confirm },
        setLoading() {},
        loadHistory: async () => { calls.reload++; },
        showToast: (m) => toasts.push(String(m)),
        document: { getElementById: id => els[id] || fakeEl() },
        console: { error() {} },
    });
    return { fns, calls, toasts };
}

test('[flow] คืนค่า: ยืนยันแล้วต้องเรียก clear (เขียนประวัติก่อนลบ) → คำนวณ Match ใหม่ → โหลดใหม่', async () => {
    const { fns, calls } = liftRestore();
    await fns.restoreSelected();
    assert.ok(calls.clear, 'ต้องเรียก clearAdjustmentsAndMatchAcceptancesForSkus (H6)');
    assert.equal(calls.clear.cycleId, 'cyc-1');
    assert.equal(calls.clear.skus.join(','), 'P1,P2');
    assert.deepEqual(calls.refresh, ['cyc-1'], 'ลบแล้วไม่คำนวณใหม่ = ตัวเลข Match ค้างผิดทั้งรอบ');
    assert.equal(calls.reload, 1, 'ต้องโหลดรายการใหม่ ไม่งั้นแถวที่ลบแล้วยังอยู่บนจอ');
});

test('[flow] คืนค่า: กดยกเลิก = ไม่แตะอะไรเลย', async () => {
    const { fns, calls } = liftRestore({ confirm: false });
    await fns.restoreSelected();
    assert.equal(calls.clear, null);
    assert.equal(calls.refresh.length, 0);
    assert.equal(calls.reload, 0);
});

test('[flow] คืนค่า: ไม่ได้เลือกอะไร = ห้ามยิง DB และห้ามเปิด modal ยืนยัน', async () => {
    const { fns, calls, toasts } = liftRestore({ selected: [] });
    await fns.restoreSelected();
    assert.equal(calls.clear, null);
    assert.equal(calls.locked, 0, 'ต้องหยุดก่อนถึงขั้นล็อกรอบ');
    assert.ok(toasts.some(t => /เลือกรายการก่อน/.test(t)), toasts.join(' | '));
});

test('[flow] คืนค่า: รอบไม่ sync (lockCycleId คืน null) = ห้ามเขียนอะไร', async () => {
    const { fns, calls } = liftRestore({ cycleId: null });
    await fns.restoreSelected();
    assert.equal(calls.clear, null);
    assert.equal(calls.refresh.length, 0);
});

test('[flow] คืนค่า: ลบล้มเหลว = ต้องรายงาน + ยังโหลดใหม่ (จอต้องตรงกับ DB จริง)', async () => {
    const { fns, calls, toasts } = liftRestore({ clearThrows: 'ลบไม่สำเร็จ' });
    await fns.restoreSelected();
    assert.equal(calls.refresh.length, 0, 'ลบไม่สำเร็จ ห้ามคำนวณใหม่ราวกับสำเร็จ');
    assert.ok(toasts.some(t => /ลบไม่สำเร็จ/.test(t)), toasts.join(' | '));
    assert.equal(calls.reload, 1, 'ล้มเหลวแล้วยิ่งต้องโหลดใหม่ — อาจลบไปได้บางส่วน');
});

// -----------------------------------------------------------------------------
// รันเส้นทางโหลด/แสดงผลจริง — ไม่ใช่อ่านซอร์ส
//
// ช่องนี้คือช่องเดียวกับที่ทำให้ `submitGroup` และ `createRow` หลุดถึงผู้ใช้:
// เทส regex ผ่านหมดเพราะไม่มีข้อไหน *รัน* ฟังก์ชันที่พัง
// -----------------------------------------------------------------------------

/** DOM ปลอมพอให้ inline script ของหน้าทำงานได้จริง */
function makeDom(ids) {
    const store = new Map();
    const get = (id) => {
        if (!store.has(id)) store.set(id, fakeEl({ id }));
        return store.get(id);
    };
    (ids || []).forEach(get);
    return { store, get };
}

/** ยกชุดฟังก์ชันแสดงผลของหน้ามารันจริง พร้อม state ที่แชร์กันได้ */
function liftView({ entries = sample(), cycle = { id: 'cy1', warehouse: 'คลังA', year_month: '2026-08' } } = {}) {
    const dom = makeDom(['historyBody', 'summaryText', 'selectAll', 'selCount',
        'btnRestore', 'btnExportXlsx', 'btnExportCsv',
        'fType', 'fSku', 'fDetail', 'fDateFrom', 'fDateTo', 'fQtyMin', 'fQtyMax']);
    // checkbox ที่ "เรนเดอร์อยู่" — จำลองผลของ innerHTML ด้วยการ parse data-sku ออกมา
    let rendered = [];
    const ctx = {
        currentCycle: cycle,
        allEntries: entries,
        viewEntries: [],
        selectedSkus: new Set(),
        sortKey: 'at',
        sortDir: 'desc',
        AH: loadAH(),
        RS: {
            ...FAKE_RS,
            escapeHtml: v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'),
        },
        showToast() {},
        document: {
            getElementById: dom.get,
            querySelectorAll: (sel) => {
                if (sel === '[data-mark]') return [];
                if (sel === '.ah-cb') return rendered;
                return [];
            },
        },
    };
    // ⚠️ ต้องอ่านสถานะจาก sandbox ไม่ใช่ ctx — sandbox เป็นสำเนา การเขียนทับตัวแปร
    //    ระดับโมดูล (viewEntries = ...) จะไม่สะท้อนกลับมาที่ ctx
    const { fns, sandbox } = liftInto(PAGE, [
        'readCriteria', 'clearSelection', 'refreshSelCount', 'renderSortMarks',
        'applyView', 'renderTable', 'syncSelectAllBox', 'exportRows',
    ], ctx);
    // หลัง renderTable เขียน innerHTML แล้ว สร้าง checkbox ปลอมตาม data-sku ที่ออกมาจริง
    const syncRendered = () => {
        const html = dom.get('historyBody').innerHTML || '';
        rendered = [...html.matchAll(/data-sku="([^"]*)"/g)]
            .map(m => fakeEl({ dataset: { sku: m[1] }, checked: false }));
    };
    return { fns, state: sandbox, dom, syncRendered, getRendered: () => rendered };
}

test('[run] applyView → renderTable วิ่งจนจบ และสรุปตรงกับจำนวนที่กรองได้', () => {
    const { fns, state, dom, syncRendered } = liftView();
    fns.applyView();
    syncRendered();
    assert.equal(state.viewEntries.length, 4);
    assert.match(dom.get('summaryText').innerHTML, /แสดง <strong>4<\/strong> \/ 4 รายการ/);
    assert.match(dom.get('summaryText').innerHTML, /<strong>4<\/strong> SKU/);
    assert.equal(dom.get('btnExportXlsx').disabled, false);
});

test('[run] แถวที่เรนเดอร์ต้องตรงกับที่กรองได้ ไม่ใช่ข้อมูลทั้งรอบ', () => {
    const { fns, state, dom, syncRendered, getRendered } = liftView();
    dom.get('fType').value = 'adj';
    fns.applyView();
    syncRendered();
    assert.equal(state.viewEntries.length, 3);
    assert.equal(getRendered().length, 3, 'checkbox ต้องมีเท่าแถวที่เห็น');
    // ค่าเริ่มต้นเรียงวันเวลาใหม่ → เก่า ⇒ C3 (08-12), B2 (08-11), A1 (08-10)
    assert.equal(getRendered().map(cb => cb.dataset.sku).join(','), 'C3,B2,A1',
        'ลำดับ checkbox ต้องตรงกับลำดับที่เรียงไว้ ไม่ใช่ลำดับใน allEntries');
    assert.ok(!dom.get('historyBody').innerHTML.includes('D4'), 'แถวที่ถูกกรองออกต้องไม่อยู่ใน DOM');
});

test('[run] ไม่มีรอบ = ปุ่ม Export ต้องปิด แม้จะยังมีแถวค้างอยู่ (finding #4)', () => {
    const { fns, state, dom } = liftView();
    fns.applyView();
    assert.equal(dom.get('btnExportXlsx').disabled, false);
    state.currentCycle = null;               // รอบหลุดไป แต่ viewEntries ยังมีของ
    fns.applyView();
    assert.equal(dom.get('btnExportXlsx').disabled, true, 'ไม่งั้นได้ไฟล์ที่ติดป้ายรอบผิด');
    assert.equal(dom.get('btnExportCsv').disabled, true);
    assert.equal(fns.exportRows(), undefined, 'exportRows ต้องไม่คืนแถวเมื่อไม่รู้ว่ารอบไหน');
});

test('[run] ไม่มีแถว = ปุ่ม Export ปิด และขึ้นข้อความต่างกันตามสาเหตุ', () => {
    const { fns, state, dom } = liftView();
    dom.get('fSku').value = 'ไม่มีทางเจอ';
    fns.applyView();
    assert.equal(dom.get('btnExportXlsx').disabled, true);
    assert.match(dom.get('historyBody').innerHTML, /ไม่มีรายการที่ตรงกับตัวกรอง/);
    state.allEntries = [];
    fns.applyView();
    assert.match(dom.get('historyBody').innerHTML, /ยังไม่มีการปรับ\/ยืนยัน/);
});

test('[run] selectAll เลือกได้เฉพาะแถวที่เรนเดอร์อยู่ แล้วนับถูก', () => {
    const { fns, state, dom, syncRendered, getRendered } = liftView();
    dom.get('fType').value = 'adj';
    fns.applyView();
    syncRendered();
    // จำลองสิ่งที่ handler ของ selectAll ทำ (วนเฉพาะ .ah-cb ที่เรนเดอร์อยู่)
    getRendered().forEach(cb => { cb.checked = true; state.selectedSkus.add(cb.dataset.sku); });
    fns.refreshSelCount();
    assert.equal(dom.get('selCount').textContent, '3');
    assert.equal(dom.get('btnRestore').disabled, false);
    assert.ok(!state.selectedSkus.has('D4'), 'SKU ที่ถูกกรองออกต้องไม่ถูกเลือก');
    fns.clearSelection();
    assert.equal(dom.get('selCount').textContent, '0');
    assert.equal(dom.get('btnRestore').disabled, true);
});

test('[run] loadHistory: รอบหาย (fetchCycleById คืน null) ต้องดัง ไม่ใช่เดินต่อเงียบ ๆ', async () => {
    const dom = makeDom(['cycleSelect', 'historyBody', 'summaryText', 'loading', 'loadingText',
        'btnExportXlsx', 'btnExportCsv', 'selCount', 'btnRestore', 'selectAll']);
    dom.get('cycleSelect').value = 'cy-gone';
    const toasts = [];
    const state = { currentCycle: { id: 'old' }, allEntries: [1, 2, 3], viewEntries: [1, 2, 3] };
    const fns = liftFunctions(PAGE, ['loadHistory'], {
        ...state,
        isBusy: false,
        RS: {
            fetchCycleById: async () => null,            // รอบถูกลบไปแล้ว
            fetchAdjustments: async () => { throw new Error('ไม่ควรถูกเรียก'); },
            fetchMatchAcceptanceMap: async () => new Map(),
            escapeHtml: v => String(v ?? ''),
            buildAdjustHistoryEntries: () => [],
        },
        setLoading() {},
        clearSelection() {},
        applyView() { state.applied = (state.applied || 0) + 1; },
        showToast: (m) => toasts.push(String(m)),
        document: { getElementById: dom.get },
        console: { error() {} },
    });
    await fns.loadHistory();
    assert.ok(toasts.some(t => /ไม่พบรอบนี้แล้ว/.test(t)), toasts.join(' | '));
    assert.match(dom.get('summaryText').textContent, /โหลดล้มเหลว/);
    assert.equal(dom.get('cycleSelect').disabled, false, 'ต้องปลดล็อก dropdown ใน finally');
});

test('[run] loadHistory: โหลดล้มเหลวต้องเรียก applyView เพื่อปิดปุ่ม Export (finding #3)', async () => {
    const dom = makeDom(['cycleSelect', 'historyBody', 'summaryText', 'loading', 'loadingText']);
    dom.get('cycleSelect').value = 'cy1';
    const seen = { applied: 0 };
    const fns = liftFunctions(PAGE, ['loadHistory'], {
        currentCycle: { id: 'old' },
        allEntries: [1, 2, 3],
        viewEntries: [1, 2, 3],
        isBusy: false,
        RS: {
            fetchCycleById: async () => ({ id: 'cy1' }),
            fetchAdjustments: async () => { throw new Error('เน็ตหลุด'); },
            fetchMatchAcceptanceMap: async () => new Map(),
            escapeHtml: v => String(v ?? ''),
            buildAdjustHistoryEntries: () => [],
        },
        setLoading() {},
        clearSelection() {},
        applyView() { seen.applied++; },
        showToast() {},
        document: { getElementById: dom.get },
        console: { error() {} },
    });
    await fns.loadHistory();
    assert.equal(seen.applied, 1, 'catch ต้องเรียก applyView — ไม่งั้นปุ่ม Export ค้างเปิดกับข้อมูลรอบเก่า');
});

// -----------------------------------------------------------------------------
// โครงหน้า
// -----------------------------------------------------------------------------
test('[ui] หน้าใหม่ต้องไม่เขียนกติกาซ้ำ — ใช้ตัวรวมรายการจาก shared เท่านั้น', () => {
    assert.ok(!/function\s+buildAdjustHistoryEntries/.test(PAGE),
        'ห้าม copy ตัวรวมรายการมาไว้ในหน้า (บทเรียน M34 / M8) — ต้องเรียก RS.buildAdjustHistoryEntries');
    assert.match(PAGE, /RS\.buildAdjustHistoryEntries\(/);
});

test('[ui] เลือกทั้งหมด/เปลี่ยนตัวกรอง ต้องไม่ทำให้คืนค่าแถวที่มองไม่เห็น', () => {
    // selection เก็บใน Set แล้วล้างทุกครั้งที่มุมมองเปลี่ยน — เป็นแกนความปลอดภัยของหน้านี้
    const at = PAGE.indexOf("document.getElementById('selectAll').addEventListener");
    assert.ok(at > 0, 'ต้องมี handler ของ selectAll');
    const body = PAGE.slice(at, at + 500);
    assert.match(body, /querySelectorAll\('\.ah-cb'\)/, 'ต้องวนเฉพาะ checkbox ที่เรนเดอร์อยู่ (= แถวที่เห็นหลังกรอง)');
    assert.ok(!/allEntries/.test(body), 'ห้ามลากรายการทั้งรอบมาเลือก');

    // ต้องชี้ไปที่ตัว handler ไม่ใช่ id ใน markup ⇒ ค้นจากข้อความที่ผูก listener
    for (const marker of ["getElementById('btnClearFilters').addEventListener", "['fType', 'fSku'"]) {
        const i = PAGE.indexOf(marker);
        assert.ok(i > 0, `หา ${marker} ไม่เจอ`);
        assert.match(PAGE.slice(i, i + 700), /clearSelection\(\)/,
            `${marker}: เปลี่ยนตัวกรองแล้วต้องล้าง selection`);
    }
});

test('[ui] เปลี่ยนรอบต้องล้างทั้ง selection และข้อมูลเดิม', () => {
    const at = PAGE.indexOf("document.getElementById('cycleSelect').addEventListener");
    assert.ok(at > 0);
    const body = PAGE.slice(at, at + 500);
    assert.match(body, /currentCycle = null/);
    assert.match(body, /allEntries = \[\]/);
    assert.match(body, /clearSelection\(\)/);
});

test('[ui] ยืนยัน 2 ขั้น + บอกชัดว่าคืนค่าเป็นราย SKU ทั้งรอบ', () => {
    assert.match(PAGE, /uiConfirm\.twoStep/);
    // ใช้ bodyOf() นับวงเล็บ ไม่ใช่ slice ด้วยเลขคงที่ — ฟังก์ชันยาวขึ้นนิดเดียว
    // เทสแบบเลขคงที่จะเริ่มมองไม่เห็นท้ายฟังก์ชันแบบเงียบ ๆ
    const body = bodyOf(PAGE, 'async function restoreSelectedInner');
    assert.match(body, /ราย SKU/, 'ต้องบอกว่าติ๊กแถวเดียวก็ลบการตัดสินทั้งหมดของ SKU นั้น');
    assert.match(body, /ผลนับไม่ถูกแตะ/, 'ต้องย้ำว่าไม่แตะ inventory_counts (invariant ข้อ 1)');
});

test('[ui] Export ต้องส่งออกรายการที่กรอง/เรียงอยู่ ไม่ใช่ข้อมูลดิบทั้งรอบ', () => {
    const at = PAGE.indexOf('function exportRows');
    const body = PAGE.slice(at, at + 300);
    assert.match(body, /viewEntries/);
    assert.ok(!/allEntries/.test(body), 'ห้าม export allEntries — ผู้ใช้กรองมาแล้วต้องได้ตามที่เห็น');
});

test('[ui] ลำดับ <script>: reconcile-shared ต้องมาก่อน adjust-history-shared', () => {
    const a = PAGE.indexOf('Js/reconcile-shared.js');
    const b = PAGE.indexOf('Js/adjust-history-shared.js');
    assert.ok(a > 0 && b > 0, 'ต้องโหลดทั้งสองไฟล์');
    assert.ok(a < b, 'adjust-history-shared เรียก window.reconcileService — ต้องมาทีหลัง');
    const c = PAGE.indexOf('Js/count-scan-shared.js');
    assert.ok(c > 0 && c < a, 'count-scan-shared ต้องมาก่อน reconcile-shared (invariant ข้อ 8)');
});

test('[ui] ไม่โหลด shared JS ก็ต้องดัง ไม่ใช่เงียบ', () => {
    const sandbox = { window: {}, console: { warn() {}, error() {} } };
    vm.createContext(sandbox);
    vm.runInContext(SHARED_SRC, sandbox);
    assert.throws(
        () => sandbox.window.adjustHistoryService.filterHistoryEntries([], { sku: 'A' }),
        /reconcile-shared/,
        'ไม่มี reconcileService ต้องโยน error บอกสาเหตุ ไม่ใช่คืนผลลัพธ์ผิดเงียบ ๆ'
    );
});
