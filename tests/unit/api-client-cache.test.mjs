// เทสว่า apiService.getClient() คืน client ตัวเดิม (ไม่สร้างใหม่ทุกครั้ง)
// เดิมสร้างใหม่ทุกการเรียก → เกิด "Multiple GoTrueClient instances" ในหน้าเดียว
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { createSandbox, loadScript } from '../helpers/sandbox.mjs';

suite('api.js: cache Supabase client');

/** sandbox + stub ของ supabase-js ที่นับจำนวนครั้งที่ createClient ถูกเรียก */
function setup() {
    const sb = createSandbox();
    let created = 0;
    sb.supabase = {
        createClient(url, key) { created++; return { __id: created, url, key }; }
    };
    loadScript(sb, 'Js/api.js');
    return { sb, calls: () => created };
}

test('เรียก getClient() หลายครั้ง → createClient ถูกเรียกครั้งเดียว', () => {
    const { sb, calls } = setup();
    const a = sb.apiService.getClient();
    const b = sb.apiService.getClient();
    const c = sb.apiService.getClient();
    assert.ok(a, 'ต้องได้ client');
    assert.equal(calls(), 1, `createClient ควรถูกเรียก 1 ครั้ง แต่ถูกเรียก ${calls()} ครั้ง`);
    assert.equal(a, b, 'ต้องเป็น object ตัวเดียวกัน');
    assert.equal(b, c);
});

test('เปลี่ยน SB_URL/SB_KEY → สร้าง client ใหม่ (ไม่ค้างของเก่า)', () => {
    const { sb, calls } = setup();
    const first = sb.apiService.getClient();
    sb.localStorage.setItem('SB_URL', 'https://other.supabase.co');
    sb.localStorage.setItem('SB_KEY', 'sb_publishable_other');
    const second = sb.apiService.getClient();
    assert.equal(calls(), 2, 'เปลี่ยน config แล้วต้องสร้างใหม่');
    assert.notEqual(first, second);
    assert.equal(second.url, 'https://other.supabase.co');
});

test('ไม่มี supabase library → คืน null และไม่ throw', () => {
    const sb = createSandbox();
    loadScript(sb, 'Js/api.js');
    assert.equal(sb.apiService.getClient(), null);
});
