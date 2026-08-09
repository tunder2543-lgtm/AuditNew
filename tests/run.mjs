#!/usr/bin/env node
// =============================================================================
// run.mjs — ตัวรันเทสของระบบ AuditNew (Dry Run — ไม่แตะฐานข้อมูลจริง 100%)
//
// วิธีใช้:
//   node tests/run.mjs                  รันทั้งหมด
//   node tests/run.mjs --filter cycle   รันเฉพาะเทสที่ชื่อมีคำว่า cycle
//   node tests/run.mjs --json           ผลเป็น JSON (ไว้เทียบ baseline)
//
// Exit code: 0 = ไม่มี regression | 1 = มีเทสปกติพัง (REGRESSION)
// หมายเหตุ: KNOWN-OPEN (บั๊กที่รู้แล้วยังไม่แก้) ไม่ทำให้ exit 1
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAll } from './helpers/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const filterIdx = args.indexOf('--filter');
const filter = filterIdx >= 0 ? args[filterIdx + 1] : null;
const asJson = args.includes('--json');

function collectTestFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectTestFiles(full));
        else if (entry.name.endsWith('.test.mjs')) out.push(full);
    }
    return out;
}

const files = [
    ...collectTestFiles(path.join(__dirname, 'unit')),
    ...collectTestFiles(path.join(__dirname, 'dryrun')),
].sort();

for (const f of files) {
    await import(pathToFileURL(f).href);
}

const results = await runAll({ filter });

const ICON = { PASS: '✅', FAIL: '❌', 'KNOWN-OPEN': '🟡', 'KNOWN-FIXED': '🎉' };
const counts = { PASS: 0, FAIL: 0, 'KNOWN-OPEN': 0, 'KNOWN-FIXED': 0 };

if (asJson) {
    const plain = results.map(r => ({
        suite: r.suite, name: r.name, kind: r.kind, issueId: r.issueId ?? null,
        status: r.status, error: r.error ? String(r.error.message || r.error) : null,
    }));
    console.log(JSON.stringify(plain, null, 2));
    for (const r of results) counts[r.status]++;
    process.exit(counts.FAIL > 0 ? 1 : 0);
}

let lastSuite = null;
for (const r of results) {
    if (r.suite !== lastSuite) {
        console.log(`\n📁 ${r.suite}`);
        lastSuite = r.suite;
    }
    counts[r.status]++;
    const tag = r.issueId ? ` [${r.issueId}]` : '';
    console.log(`  ${ICON[r.status]} ${r.status.padEnd(11)}${tag} ${r.name}`);
    if (r.status === 'FAIL') {
        console.log(`     └─ ${String(r.error?.message || r.error).split('\n')[0]}`);
    }
}

console.log('\n' + '─'.repeat(64));
console.log(`✅ PASS: ${counts.PASS}   ❌ FAIL(regression): ${counts.FAIL}   🟡 KNOWN-OPEN(บั๊กยังไม่แก้): ${counts['KNOWN-OPEN']}   🎉 KNOWN-FIXED: ${counts['KNOWN-FIXED']}`);

if (counts.FAIL > 0) {
    console.log('\n⚠️  พบ REGRESSION — เทสที่เคยผ่านพังแล้ว ตรวจสอบการแก้ไขล่าสุดก่อน commit!');
}
if (counts['KNOWN-FIXED'] > 0) {
    console.log('\n🎉 มีบั๊กที่รู้อยู่แล้วถูกแก้สำเร็จ — อัปเดต docs/FIX_TRACKING.md');
    console.log('   แล้วย้ายเทสนั้นจาก knownIssue() → test() เพื่อให้กลายเป็นยามกัน regression');
}
console.log('🛡️  Dry Run: ไม่มีการเชื่อมต่อ network/ฐานข้อมูลจริงใด ๆ ในการรันเทสนี้');

process.exit(counts.FAIL > 0 ? 1 : 0);
