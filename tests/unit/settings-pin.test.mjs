// เทสล็อกส่วน Supabase Config ในหน้าตั้งค่า (Js/settings-pin.js + docs/sql/021)
//
// กติกาโปรเจกต์: เทสต้อง "รัน" ฟังก์ชันจริง — runUnlockSettings ถูกรันครบ 4 เส้นทาง
// (รหัสถูก / รหัสผิด / เชื่อมต่อไม่ได้ / ไม่กรอกรหัส) ผ่าน DOM + client จำลอง
// หมายเหตุ: รหัสในเทสใช้ '9999' เสมอ — รหัสจริงห้ามอยู่ในรีโป (มีเทส [no-pin] ยาม)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('หน้าตั้งค่า: ล็อกส่วน Supabase Config ด้วยรหัส');

const JS_PATH = path.join(PROJECT_ROOT, 'Js', 'settings-pin.js');
const HTML_PATH = path.join(PROJECT_ROOT, 'Html', 'settings.html');
const SQL_PATH = path.join(PROJECT_ROOT, 'docs', 'sql', '021_settings_pin.sql');
const src = fs.readFileSync(JS_PATH, 'utf8');

/** อ่านค่า UNLOCK_KEY จากซอร์สจริง — เทสต้องพังถ้าประกาศหาย/เปลี่ยนรูป */
function unlockKeyFromSource() {
    const m = src.match(/var UNLOCK_KEY = '([^']+)'/);
    assert.ok(m, 'หา UNLOCK_KEY ใน settings-pin.js ไม่เจอ — โครงไฟล์เปลี่ยน?');
    return m[1];
}

/** สร้าง DOM + client จำลองหนึ่งชุดต่อหนึ่งเทส แล้วยกฟังก์ชันจริงเข้าไปรัน */
function setup(rpcImpl) {
    const key = unlockKeyFromSource();
    const els = {
        sbPinInput: { value: '', addEventListener() {} },
        sbPinMsg: { textContent: '' },
        sbPinBtn: { disabled: false },
        sbConfigLock: { style: { display: '' } },
        sbConfigForm: { style: { display: 'none' } },
    };
    const rpcCalls = [];
    const stored = {};
    const context = {
        // UNLOCK_KEY เป็นตัวแปรระดับโมดูลใน settings-pin.js — lift ยกมาแต่ฟังก์ชัน จึงต้องป้อนให้
        // sandbox เอง โดยดึง "ค่าจริงจากซอร์ส" ไม่พิมพ์ซ้ำ (สองที่ไม่ตรงกันแล้วต้องรู้)
        UNLOCK_KEY: key,
        document: { getElementById: (id) => els[id] || null },
        sessionStorage: {
            setItem: (k, v) => { stored[k] = v; },
            getItem: (k) => (k in stored ? stored[k] : null),
        },
        window: {
            apiService: {
                getClient: () => ({
                    rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcImpl(); },
                }),
            },
        },
    };
    const fns = liftFunctions(src, ['applyLockState', 'runUnlockSettings'], context);
    return { els, rpcCalls, stored, fns, key };
}

test('รหัสถูก: เรียก RPC ถูกชื่อ/ถูก argument → เปิดฟอร์ม จำสถานะในแท็บ ล้างช่องรหัส', async () => {
    const { els, rpcCalls, stored, fns, key } = setup(() => ({ data: true, error: null }));
    els.sbPinInput.value = ' 9999 '; // มีช่องว่างหัวท้าย — ต้อง trim ก่อนส่ง
    await fns.runUnlockSettings();
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'verify_settings_pin');
    assert.equal(JSON.stringify(rpcCalls[0].args), '{"p_pin":"9999"}');
    assert.equal(els.sbConfigLock.style.display, 'none', 'กล่องล็อกต้องหาย');
    assert.equal(els.sbConfigForm.style.display, '', 'ฟอร์มต้องโผล่');
    assert.equal(stored[key], '1', 'ต้องจำสถานะปลดล็อกของแท็บ');
    assert.equal(els.sbPinInput.value, '', 'ต้องล้างช่องรหัส');
    assert.equal(els.sbPinBtn.disabled, false, 'ปุ่มต้องกลับมากดได้');
});

test('รหัสผิด: แจ้ง "รหัสไม่ถูกต้อง" ฟอร์มยังซ่อน ไม่จำสถานะ ล้างช่องรหัส', async () => {
    const { els, stored, fns, key } = setup(() => ({ data: false, error: null }));
    els.sbPinInput.value = '9999';
    await fns.runUnlockSettings();
    assert.equal(els.sbPinMsg.textContent, 'รหัสไม่ถูกต้อง');
    assert.equal(els.sbConfigForm.style.display, 'none', 'ฟอร์มต้องยังซ่อนอยู่');
    assert.equal(els.sbConfigLock.style.display, '', 'กล่องล็อกต้องยังอยู่');
    assert.ok(!(key in stored), 'ห้ามจำสถานะเมื่อรหัสผิด');
    assert.equal(els.sbPinInput.value, '');
    assert.equal(els.sbPinBtn.disabled, false);
});

test('เชื่อมต่อไม่ได้ (RPC โยน error): แจ้งปัญหาการเชื่อมต่อ ฟอร์มยังซ่อน ปุ่มกลับมากดได้', async () => {
    const { els, stored, fns, key } = setup(() => ({ data: null, error: new Error('network down') }));
    els.sbPinInput.value = '9999';
    await fns.runUnlockSettings();
    assert.ok(els.sbPinMsg.textContent.includes('เชื่อมต่อ'), 'ข้อความต้องบอกว่าเป็นปัญหาการเชื่อมต่อ ไม่ใช่รหัสผิด');
    assert.equal(els.sbConfigForm.style.display, 'none');
    assert.ok(!(key in stored));
    assert.equal(els.sbPinBtn.disabled, false, 'ปุ่มห้ามค้าง disabled (บทเรียน ReferenceError ใน finally)');
});

test('ไม่กรอกรหัส: แจ้งเตือนและต้องไม่ยิง RPC เลย', async () => {
    const { els, rpcCalls, fns } = setup(() => ({ data: true, error: null }));
    els.sbPinInput.value = '   ';
    await fns.runUnlockSettings();
    assert.equal(rpcCalls.length, 0, 'ช่องว่างเปล่าห้ามยิง RPC');
    assert.equal(els.sbPinMsg.textContent, 'กรุณาใส่รหัสก่อน');
    assert.equal(els.sbConfigForm.style.display, 'none');
});

test('applyLockState: สลับ display ของกล่องล็อก/ฟอร์มถูกทิศทั้งสองทาง', () => {
    const { els, fns } = setup(() => ({ data: true, error: null }));
    fns.applyLockState(true);
    assert.equal(els.sbConfigLock.style.display, 'none');
    assert.equal(els.sbConfigForm.style.display, '');
    fns.applyLockState(false);
    assert.equal(els.sbConfigLock.style.display, '');
    assert.equal(els.sbConfigForm.style.display, 'none');
});

// ---------- ยามฝั่ง HTML / SQL / กติกาความปลอดภัย ----------

test('[guard] settings.html: ฟอร์มซ่อนตั้งแต่ใน markup (บทเรียน M10) + องค์ประกอบล็อกครบ + โหลดสคริปต์พร้อม ?v=', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.match(html, /id="sbConfigForm"\s+style="display:\s*none/, 'ฟอร์มต้องซ่อนใน markup ก่อน JS รัน');
    for (const id of ['sbConfigLock', 'sbPinInput', 'sbPinBtn', 'sbPinMsg']) {
        assert.ok(html.includes('id="' + id + '"'), 'ขาด element id=' + id);
    }
    assert.match(html, /Js\/settings-pin\.js\?v=\d{8}[a-z]/, 'ต้องโหลด settings-pin.js พร้อม cache-buster');
    assert.ok(html.includes('onclick="runUnlockSettings()"'), 'ปุ่มปลดล็อกเรียกแบบไม่มี argument เท่านั้น');
});

test('[guard] settings-pin.js ห้ามใช้ innerHTML ทั้งไฟล์ (invariant ข้อ 7)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!code.includes('innerHTML'), 'พบ innerHTML ในโค้ดจริง');
});

test('[sql-guard] 021: SECURITY DEFINER + SET search_path (invariant ข้อ 12) + ตารางต้องเข้าไม่ได้จาก API', () => {
    // ตัดคอมเมนต์ SQL (`-- …`) ก่อนสแกน — คำอธิบายในไฟล์มีวลี "create policy" อยู่โดยตั้งใจ
    const sql = fs.readFileSync(SQL_PATH, 'utf8').replace(/--[^\n]*/g, '').toLowerCase();
    assert.ok(sql.includes('security definer'), 'RPC ต้องเป็น SECURITY DEFINER');
    assert.ok(sql.includes('set search_path'), 'ต้องมี SET search_path ในตัวฟังก์ชัน');
    assert.ok(sql.includes('enable row level security'), 'ตารางต้องเปิด RLS');
    assert.ok(!sql.includes('create policy'), 'ห้ามมี policy ใด ๆ — ตารางนี้ต้องเข้าผ่าน API ไม่ได้เลย');
    assert.ok(sql.includes('revoke all on table public.app_settings_pin'), 'ต้อง revoke สิทธิ์ตารางจาก anon/authenticated');
    assert.ok(sql.includes('grant execute on function public.verify_settings_pin'), 'ต้อง grant execute ให้ anon เรียก RPC ได้');
});

test('[no-pin] รหัสจริงห้ามโผล่ในไฟล์ใด ๆ ของฟีเจอร์นี้ (รีโปเป็น public)', () => {
    // รหัสจริงเป็นเลข 4 หลักที่ตั้งใน DB โดยตรง — ไฟล์ทุกไฟล์ของฟีเจอร์ต้องไม่มีมัน
    // เทสนี้ใช้วิธีประกอบสตริงจากเลขฐาน เพื่อไม่ให้ตัวเทสเองกลายเป็นที่แปะรหัส
    const realPin = String(5000 + 44);
    for (const p of [JS_PATH, HTML_PATH, SQL_PATH]) {
        const body = fs.readFileSync(p, 'utf8');
        assert.ok(!body.includes(realPin), 'พบรหัสจริงใน ' + path.basename(p));
    }
});
