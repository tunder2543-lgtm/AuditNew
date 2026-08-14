// เทสการ์ด "Supabase Keep-Alive" ในหน้าตั้งค่า (Js/keepalive-status.js)
//
// กติกาโปรเจกต์: เทสต้อง "รัน" ฟังก์ชันจริงผ่าน lift ไม่ใช่อ่านหน้าตาซอร์ส
// จุดยามสำคัญสุด: [cron-sync] ตารางเวลาใน JS ต้องตรงกับ cron ในไฟล์ workflow จริง
// — วันหน้าใครแก้เวลา ping ใน yml แล้วลืมแก้หน้าเว็บ (หรือกลับกัน) เทสนี้ต้องแดง
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('หน้าตั้งค่า: การ์ด Supabase Keep-Alive');

const JS_PATH = path.join(PROJECT_ROOT, 'Js', 'keepalive-status.js');
const HTML_PATH = path.join(PROJECT_ROOT, 'Html', 'settings.html');
const YML_PATH = path.join(PROJECT_ROOT, '.github', 'workflows', 'supabase-keepalive.yml');
const src = fs.readFileSync(JS_PATH, 'utf8');

const fns = liftFunctions(src, [
    'keepaliveSchedule',
    'computeNextRun',
    'formatRemaining',
    'formatBkkDateTime',
    'buildRunsViewModel',
]);

// ---------- [cron-sync] ตารางเวลา JS ⇄ workflow yml ----------

test('[cron-sync] ตารางเวลาใน JS ตรงกับ cron ในไฟล์ workflow จริง', () => {
    const yml = fs.readFileSync(YML_PATH, 'utf8');
    const m = yml.match(/cron:\s*'([^']+)'/);
    assert.ok(m, 'หา cron ใน supabase-keepalive.yml ไม่เจอ — โครงไฟล์เปลี่ยน?');
    const parts = m[1].trim().split(/\s+/);
    assert.equal(parts.length, 5, 'cron ต้องมี 5 ช่อง: ' + m[1]);
    const sch = fns.keepaliveSchedule();
    assert.equal(Number(parts[0]), sch.utcMinute, 'นาที (UTC) ไม่ตรงกัน');
    assert.equal(Number(parts[1]), sch.utcHour, 'ชั่วโมง (UTC) ไม่ตรงกัน');
    assert.equal(parts[2], '*', 'day-of-month ต้องเป็น *');
    assert.equal(parts[3], '*', 'month ต้องเป็น *');
    const ymlDays = parts[4].split(',').map(Number).sort((a, b) => a - b);
    assert.deepEqual(ymlDays, [...sch.utcDays].sort((a, b) => a - b), 'วันในสัปดาห์ (UTC) ไม่ตรงกัน');
});

// ---------- computeNextRun ----------

test('computeNextRun: กวาดทุกชั่วโมงตลอด 1 สัปดาห์ — ผลต้องอยู่ในตาราง, มากกว่า now, ห่างไม่เกิน 4 วัน', () => {
    const sch = fns.keepaliveSchedule();
    const start = Date.UTC(2026, 7, 10, 0, 0, 0); // จันทร์ 10 ส.ค. 2026 00:00 UTC
    for (let h = 0; h < 24 * 7; h++) {
        const now = new Date(start + h * 3600000);
        const next = fns.computeNextRun(now);
        assert.ok(next, 'ต้องหารอบถัดไปเจอเสมอ (now=' + now.toISOString() + ')');
        assert.ok(next.getTime() > now.getTime(), 'รอบถัดไปต้องมากกว่า now เคร่งครัด');
        assert.ok(sch.utcDays.includes(next.getUTCDay()), 'วันต้องอยู่ในตาราง');
        assert.equal(next.getUTCHours(), sch.utcHour);
        assert.equal(next.getUTCMinutes(), sch.utcMinute);
        const gapDays = (next.getTime() - now.getTime()) / 86400000;
        assert.ok(gapDays <= 4, 'ช่องว่างต้องไม่เกิน 4 วัน แต่ได้ ' + gapDays);
    }
});

test('computeNextRun: ก่อนเวลา 1 นาที = วันเดียวกัน · ตรงเวลาเป๊ะ = ข้ามไปรอบหน้า', () => {
    // พฤหัส 13 ส.ค. 2026 02:59 UTC → รอบถัดไปคือ 03:00 วันเดียวกัน
    const before = fns.computeNextRun(new Date(Date.UTC(2026, 7, 13, 2, 59, 0)));
    assert.equal(before.toISOString(), '2026-08-13T03:00:00.000Z');
    // ตรง 03:00:00 เป๊ะ ต้อง "ไม่" คืนเวลาเดิม (ping กำลังรันอยู่แล้ว) → ไปจันทร์หน้า
    const exact = fns.computeNextRun(new Date(Date.UTC(2026, 7, 13, 3, 0, 0)));
    assert.equal(exact.toISOString(), '2026-08-17T03:00:00.000Z');
    // ศุกร์ → จันทร์
    const friday = fns.computeNextRun(new Date(Date.UTC(2026, 7, 14, 12, 0, 0)));
    assert.equal(friday.toISOString(), '2026-08-17T03:00:00.000Z');
});

// ---------- formatRemaining / formatBkkDateTime ----------

test('formatRemaining: แตกวัน/ชม./นาทีถูก และปัดวินาทีขึ้นเป็นนาที', () => {
    const now = Date.UTC(2026, 7, 13, 0, 0, 0);
    const r = fns.formatRemaining(now, now + (2 * 1440 + 3 * 60 + 25) * 60000);
    assert.deepEqual([r.days, r.hours, r.minutes], [2, 3, 25]);
    assert.equal(r.text, 'อีก 2 วัน 3 ชม. 25 นาที');
    // เหลือ 30 วินาที ต้องแสดง "1 นาที" ไม่ใช่ "0 นาที"
    const s = fns.formatRemaining(now, now + 30000);
    assert.equal(s.text, 'อีก 1 นาที');
    // เลยเวลาแล้วต้องไม่ติดลบ
    const p = fns.formatRemaining(now, now - 60000);
    assert.ok(p.text.includes('ถึงเวลาแล้ว'));
});

test('formatBkkDateTime: แปลงเป็นเวลาไทย (+07) พร้อมชื่อวัน/เดือนไทย', () => {
    // 03:00 UTC = 10:00 น. ไทย วันพฤหัส 13 ส.ค.
    assert.equal(fns.formatBkkDateTime(Date.UTC(2026, 7, 13, 3, 0, 0)), 'พฤหัส 13 ส.ค. 10:00 น.');
    // ข้ามเที่ยงคืนไทย: 18:30 UTC วันพุธ = 01:30 น. วันพฤหัส
    assert.equal(fns.formatBkkDateTime(Date.UTC(2026, 7, 12, 18, 30, 0)), 'พฤหัส 13 ส.ค. 01:30 น.');
    assert.equal(fns.formatBkkDateTime('ไม่ใช่วันที่'), '—');
});

// ---------- buildRunsViewModel ----------

test('buildRunsViewModel: แยกสถานะ สำเร็จ/ล้มเหลว/กำลังทำงาน + ประเภทการสั่งรัน', () => {
    const rows = fns.buildRunsViewModel({
        workflow_runs: [
            { status: 'completed', conclusion: 'success', run_started_at: '2026-08-13T03:00:00Z', event: 'schedule' },
            { status: 'completed', conclusion: 'failure', run_started_at: '2026-08-10T03:00:00Z', event: 'workflow_dispatch' },
            { status: 'in_progress', conclusion: null, run_started_at: '2026-08-13T03:00:10Z', event: 'schedule' },
        ],
    });
    assert.equal(rows.length, 3);
    assert.equal(rows[0].key, 'success');
    assert.equal(rows[0].label, 'สำเร็จ');
    assert.equal(rows[0].trigger, 'ตามตาราง');
    assert.equal(rows[1].key, 'failure');
    assert.ok(rows[1].label.includes('failure'));
    assert.equal(rows[1].trigger, 'กดรันเอง');
    assert.equal(rows[2].key, 'running');
});

test('buildRunsViewModel: ข้อมูลภายนอกรูปร่างเพี้ยนต้องไม่โยน error', () => {
    // ⚠️ ผลลัพธ์มาจาก realm ของ vm — เทียบด้วย deepEqual ไม่ได้ (prototype คนละตัว) ใช้ JSON แทน
    assert.equal(JSON.stringify(fns.buildRunsViewModel(null)), '[]');
    assert.equal(JSON.stringify(fns.buildRunsViewModel({})), '[]');
    assert.equal(JSON.stringify(fns.buildRunsViewModel({ workflow_runs: 'oops' })), '[]');
    const weird = fns.buildRunsViewModel({ workflow_runs: [{}, { status: 'completed' }] });
    assert.equal(weird.length, 2);
    assert.equal(weird[0].key, 'running');       // ไม่มี status = ยังไม่จบ
    assert.equal(weird[1].key, 'failure');       // completed แต่ conclusion หาย = ต้องดัง ไม่เงียบ
    assert.equal(weird[0].timeMs, null);         // เวลาหาย → null ไม่ใช่ NaN
});

// ---------- ยามฝั่งหน้า HTML / กติกาความปลอดภัย ----------

test('[guard] settings.html โหลด keepalive-status.js พร้อม ?v= และมี element ครบ', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.match(html, /Js\/keepalive-status\.js\?v=\d{8}[a-z]/, 'ต้องโหลดสคริปต์พร้อม cache-buster');
    for (const id of ['kaCountdown', 'kaNextTime', 'kaLastStatus', 'kaLastTime', 'kaRunsList', 'kaGithubLink']) {
        assert.ok(html.includes('id="' + id + '"'), 'ขาด element id=' + id);
    }
});

test('[guard] keepalive-status.js ห้ามใช้ innerHTML ทั้งไฟล์ (invariant ข้อ 7 — สร้าง DOM ด้วย textContent เท่านั้น)', () => {
    // ตัดคอมเมนต์ก่อน — หัวไฟล์มีคำว่า innerHTML ในคำอธิบายกติกาอยู่แล้ว (แบบเดียวกับ stable-paging)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!code.includes('innerHTML'), 'พบ innerHTML ในโค้ดจริง — ไฟล์นี้ต้องสร้าง DOM ด้วย createElement/textContent เท่านั้น');
});
