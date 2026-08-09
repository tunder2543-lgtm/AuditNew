// เทสคุ้มกัน C1 (docs/ISSUES.md): ห้ามมี key ระดับ admin (service_role) ใน source
// สแกน JWT ทุกตัวในไฟล์ Js/ + Html/ + index.html แล้ว decode ดู payload.role
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('security: ไม่มี secret key ใน source');

function listSourceFiles() {
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

/** หา JWT ทุกตัวในข้อความ แล้วคืน [{file, role}] เฉพาะตัวที่ decode ได้ */
function findJwtRoles() {
    const found = [];
    const jwtRe = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
    for (const file of listSourceFiles()) {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.match(jwtRe) || []) {
            try {
                const payload = JSON.parse(Buffer.from(m.split('.')[1], 'base64url').toString('utf8'));
                found.push({ file: path.relative(PROJECT_ROOT, file), role: payload.role || '(none)' });
            } catch { /* ไม่ใช่ JWT จริง (เช่น placeholder) — ข้าม */ }
        }
    }
    return found;
}

// -----------------------------------------------------------------------------
// C1 (แก้แล้ว 2026-08-09 — ตอนนี้เป็นยามถาวร): source ต้องไม่มี JWT ที่
// role = service_role (key ระดับ admin ข้าม RLS) — key ฝั่ง client ต้องเป็น
// anon / publishable เท่านั้น
// -----------------------------------------------------------------------------
test('[C1-guard] source ต้องไม่มี service_role key (ใช้ anon/publishable เท่านั้น)', () => {
    const bad = findJwtRoles().filter(j => j.role === 'service_role');
    assert.equal(bad.length, 0,
        `พบ service_role key ใน: ${bad.map(b => b.file).join(', ')}`);
});

test('JWT ที่เหลือใน source (ถ้ามี) ต้องเป็น anon เท่านั้น', () => {
    const roles = findJwtRoles().map(j => j.role);
    const allowed = roles.every(r => r === 'anon' || r === 'service_role');
    // service_role ถูกจับแยกโดยเทส C1 ข้างบน — เทสนี้กันเฉพาะ role แปลกปลอมอื่น ๆ
    assert.ok(allowed, `พบ JWT role แปลกปลอม: ${roles.join(', ')}`);
});

// -----------------------------------------------------------------------------
// migration: เครื่องที่เคยถูก seed service_role key ไว้ใน localStorage
// ต้องถูกล้างเป็น key ใหม่อัตโนมัติเมื่อเรียก getClient()
// -----------------------------------------------------------------------------
function fakeJwt(payload) {
    const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.fakesig`;
}

test('getClient: service_role key ค้างใน localStorage ถูกแทนที่ด้วย key ใหม่จาก config', async () => {
    const { loadFresh } = await import('../helpers/sandbox.mjs');
    const sb = loadFresh('Js/api.js');
    sb.localStorage.setItem('SB_URL', 'https://old.supabase.co');
    sb.localStorage.setItem('SB_KEY', fakeJwt({ role: 'service_role' }));
    sb.apiService.getClient(); // คืน null ใน sandbox (ไม่มี lib) แต่ migration ต้องทำงานก่อน
    assert.equal(sb.localStorage.getItem('SB_KEY'), sb.apiService.SUPABASE_CONFIG.KEY,
        'SB_KEY เก่าแบบ service_role ต้องถูกเขียนทับ');
    assert.equal(sb.localStorage.getItem('SB_URL'), sb.apiService.SUPABASE_CONFIG.URL);
});

test('getClient: key ปกติ (anon/publishable) ใน localStorage ต้องไม่ถูกแตะ', async () => {
    const { loadFresh } = await import('../helpers/sandbox.mjs');
    const sb = loadFresh('Js/api.js');
    const anonKey = fakeJwt({ role: 'anon' });
    sb.localStorage.setItem('SB_URL', 'https://custom.supabase.co');
    sb.localStorage.setItem('SB_KEY', anonKey);
    sb.apiService.getClient();
    assert.equal(sb.localStorage.getItem('SB_KEY'), anonKey, 'key anon ของผู้ใช้ต้องคงเดิม');
    assert.equal(sb.localStorage.getItem('SB_URL'), 'https://custom.supabase.co');
});

test('getClient: key แบบใหม่ sb_publishable_... ไม่ถูกมองเป็น service_role', async () => {
    const { loadFresh } = await import('../helpers/sandbox.mjs');
    const sb = loadFresh('Js/api.js');
    sb.localStorage.setItem('SB_URL', 'https://custom.supabase.co');
    sb.localStorage.setItem('SB_KEY', 'sb_publishable_xxxx');
    sb.apiService.getClient();
    assert.equal(sb.localStorage.getItem('SB_KEY'), 'sb_publishable_xxxx');
});

test('saveSupabaseSettings: ปฏิเสธ service_role key ตั้งแต่ตอนบันทึก', async () => {
    const { loadFresh } = await import('../helpers/sandbox.mjs');
    const sb = loadFresh('Js/api.js', 'Js/settings-shared.js');
    const ok = sb.saveSupabaseSettings('https://x.supabase.co', fakeJwt({ role: 'service_role' }));
    assert.equal(ok, false, 'ต้องบันทึกไม่สำเร็จ');
    assert.equal(sb.localStorage.getItem('SB_KEY') === sb.apiService.SUPABASE_CONFIG.KEY
        || sb.localStorage.getItem('SB_KEY') === null, true,
        'service_role key ต้องไม่ถูกเขียนลง localStorage');
});

test('saveSupabaseSettings: key ปกติบันทึกได้ตามเดิม', async () => {
    const { loadFresh } = await import('../helpers/sandbox.mjs');
    const sb = loadFresh('Js/api.js', 'Js/settings-shared.js');
    const ok = sb.saveSupabaseSettings('https://x.supabase.co', 'sb_publishable_ok');
    assert.equal(ok, true);
    assert.equal(sb.localStorage.getItem('SB_KEY'), 'sb_publishable_ok');
});
