// เทสระบบตรวจ "SKU เดียวกัน จำนวนเท่ากัน แต่คนละตำแหน่ง" (ซ้ำข้ามตำแหน่ง)
//
// ที่มา: admin เจอด้วยตาเองในหน้า audit_check — SKU เดียวกัน จำนวนเท่ากันเป๊ะ
// ต่างกันแค่ตำแหน่ง · ตรวจกับข้อมูลจริง 2026-08-11 แล้วพบว่าเป็นการนับชั้นเดิม
// ซ้ำใต้ป้ายคนละชื่อจริง (K3-03 กับ L4-03, K3-04 กับ L4-04 …)
//   PK089 = 256 ชิ้นทั้งสองที่ · Book 258 · Match ขึ้น "เกิน" 254
//   ทั้งรอบ 19 SKU / 1,376 ชิ้น ≈ ยอด "เกิน" ของ SKU กลุ่มเดียวกัน (1,368)
//
// ⚠️ นโยบายข้อ 3: เตือนอย่างเดียว ห้ามลบ ห้ามแนะนำให้ลบ — SKU เดียวกันวางจริง 2 ที่
//    แล้วจำนวนบังเอิญเท่ากันก็เป็นไปได้ · คนเป็นคนตัดสิน
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('ตรวจซ้ำข้ามตำแหน่ง (SKU+จำนวนเท่ากัน คนละตำแหน่ง)');

const AUDIT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'audit_check.html'), 'utf8');
const find = loadFresh('Js/audit-dedupe.js').AuditDedupe.findCrossLocationDuplicates;

const row = (o) => ({
    id: 'r', cycle_id: 'cyc-1', warehouse: 'ตึกกันตนา',
    sku_id: 'PK089', location: 'K3-03', counted_qty: 256, counter_name: 'PAT', ...o,
});

test('เคสจริง PK089 — 256 ชิ้นเท่ากันที่ K3-03 และ L4-03 ต้องถูกจับ', () => {
    const out = find([
        row({ id: 'a', location: 'K3-03' }),
        row({ id: 'b', location: 'L4-03' }),
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual([...out[0].locations], ['K3-03', 'L4-03']);
    assert.equal(out[0].qty, 256);
    assert.equal(out[0].suspectedExtraQty, 256, 'ถ้านับซ้ำจริง Match จะเกินมา 256');
});

test('จำนวนต่างกัน = ไม่ใช่เคสนี้ (ของจริงวางคนละที่คนละจำนวน)', () => {
    assert.equal(find([
        row({ id: 'a', location: 'K3-03', counted_qty: 256 }),
        row({ id: 'b', location: 'L4-03', counted_qty: 100 }),
    ]).length, 0);
});

test('ตำแหน่งเดียวกัน = เป็นเคส "ทับซ้อน" ไม่ใช่เคสนี้', () => {
    assert.equal(find([
        row({ id: 'a', location: 'K3-03' }),
        row({ id: 'b', location: 'K3-03' }),
    ]).length, 0, 'ตำแหน่งเดียวกันมีตัวตรวจของตัวเองอยู่แล้ว (overlap/ซ้ำในรอบเดียวกัน)');
});

test('คนละรอบนับ ต้องไม่จับคู่กัน', () => {
    assert.equal(find([
        row({ id: 'a', location: 'K3-03', cycle_id: 'cyc-1' }),
        row({ id: 'b', location: 'L4-03', cycle_id: 'cyc-2' }),
    ]).length, 0, 'คนละรอบ = นับคนละครั้ง ไม่ใช่การนับซ้ำ');
});

test('คนละคลัง ต้องไม่จับคู่กัน', () => {
    assert.equal(find([
        row({ id: 'a', location: 'K3-03', warehouse: 'ตึกกันตนา' }),
        row({ id: 'b', location: 'L4-03', warehouse: 'คลังอะไหล่' }),
    ]).length, 0);
});

test('จำนวน 0 ต้องไม่นับ — ไม่กระทบยอด Match', () => {
    assert.equal(find([
        row({ id: 'a', location: 'A1', counted_qty: 0 }),
        row({ id: 'b', location: 'A2', counted_qty: 0 }),
    ]).length, 0);
});

test('ตัวพิมพ์เล็ก/ช่องว่างของ SKU กับตำแหน่ง ต้องไม่ทำให้หลุด', () => {
    // ฐานจริงมีตำแหน่งตัวพิมพ์เล็กอยู่ 142 แถว
    const out = find([
        row({ id: 'a', sku_id: ' pk089 ', location: ' k3-03 ' }),
        row({ id: 'b', sku_id: 'PK089', location: 'L4-03' }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].sku, 'PK089');
});

test('3 ตำแหน่งขึ้นไป — ยอดที่น่าจะเกินต้องคิดตามจำนวนแถวส่วนเกิน', () => {
    const out = find([
        row({ id: 'a', location: 'K3-01', counted_qty: 32 }),
        row({ id: 'b', location: 'L4-01', counted_qty: 32 }),
        row({ id: 'c', location: 'M5-01', counted_qty: 32 }),
    ]);
    assert.equal(out[0].suspectedExtraQty, 64, '3 แถว = ส่วนเกิน 2 แถว');
    assert.equal(out[0].rows.length, 3);
});

test('แถวที่ไม่เกี่ยวข้องต้องไม่ถูกลากเข้ามา', () => {
    const out = find([
        row({ id: 'a', location: 'K3-03' }),
        row({ id: 'b', location: 'L4-03' }),
        row({ id: 'c', sku_id: 'อื่น', location: 'Z9-99', counted_qty: 256 }),
    ]);
    assert.equal(out.length, 1);
    // deepEqual ข้าม realm ของ vm ไม่ได้ (prototype คนละตัว) — เทียบผ่านสตริง
    assert.equal(out[0].rows.map(r => r.id).join(','), 'a,b');
});

// -----------------------------------------------------------------------------
// การต่อเข้าหน้าเว็บ
// -----------------------------------------------------------------------------
test('[ui] หน้า audit_check ต้องมีการ์ดสถิติ + ตัวกรองของสถานะใหม่', () => {
    assert.match(AUDIT, /data-filter="crossloc"/, 'ไม่มีตัวกรอง');
    assert.match(AUDIT, /id="statCrossLoc"/, 'ไม่มีการ์ดสถิติ');
    assert.match(AUDIT, /crossloc: 'ซ้ำข้ามตำแหน่ง'/, 'ไม่มีป้ายชื่อในตัวกรอง');
    assert.match(AUDIT, /\.status-crossloc/, 'ไม่มีสีของสถานะ');
    assert.match(AUDIT, /tr\.row-crossloc/, 'ไม่มีสีพื้นแถว');
});

test('[ui] ต้องนับเข้าสถิติ + รู้จักสถานะตอนกรอง', () => {
    assert.match(AUDIT, /row-crossloc'\)\) crossloc\+\+/, 'updateStats ไม่ได้นับ');
    assert.match(AUDIT, /statCrossLoc'\)/, 'ไม่ได้เขียนค่าลงการ์ด');
    assert.match(AUDIT, /contains\('row-crossloc'\)\) return 'crossloc'/, 'getRowStatus ไม่รู้จัก');
    assert.match(AUDIT, /status === 'crossloc' \? 'status-crossloc'/, 'applyResult ไม่ได้ใส่คลาส');
});

test('[ui] ต้องเตือนอย่างเดียว — ห้ามมีคำแนะนำให้ลบ (นโยบายข้อ 3)', () => {
    const at = AUDIT.indexOf('function formatCrossLocNote');
    assert.ok(at > 0, 'หาข้อความอธิบายไม่เจอ');
    const body = AUDIT.slice(at, AUDIT.indexOf('/** คีย์ของกลุ่มที่ยืนยันได้', at));
    assert.ok(!/ให้ลบ|ควรลบ|ลบแถว|ลบทิ้ง/.test(body),
        'มีคำแนะนำให้ลบ — ขัดนโยบายข้อ 3 (ระบบไม่ตัดสินแทนคน)');
    assert.ok(/ยืนยันว่าปกติ/.test(body), 'ต้องบอกทางออกให้ผู้ใช้ปิดรายการได้');
});

test('[ui] กลุ่มที่ยืนยันว่าปกติแล้ว ต้องเงียบ และกลับมาเตือนเมื่อข้อมูลเปลี่ยน', () => {
    assert.match(AUDIT, /clAccepted\.ack\.state === 'accepted'/, 'ไม่ได้เช็คสถานะยืนยัน');
    const at = AUDIT.indexOf('const cl = getCrossLocContext(recordId);');
    assert.ok(at > 0);
    const body = AUDIT.slice(at, at + 500);
    assert.match(body, /stale.*ข้อมูลเปลี่ยนหลังยืนยัน/, 'ข้อมูลเปลี่ยนแล้วต้องกลับมาเตือน');
});

test('[ui] ปุ่ม "ยืนยันว่าปกติ" ต้องเลือกแถวของสถานะใหม่ได้', () => {
    assert.match(AUDIT, /crossLocByRecordId\.has\(String\(tr\.dataset\.recordId\)\)/,
        'ปุ่มยังไม่เปิดให้เลือกแถวซ้ำข้ามตำแหน่ง');
    assert.match(AUDIT, /const cl = crossLocByRecordId\.get\(String\(id\)\);/,
        'acceptSelectedAsNormal ยังไม่รองรับกลุ่มนี้');
});

test('[ui] ดัชนีต้องถูกสร้างใหม่ทุกครั้งที่โหลดข้อมูลอ้างอิง', () => {
    assert.match(AUDIT, /buildCrossLocIndex\(allRows\)/, 'ไม่ได้สร้างดัชนีตอนโหลด');
    const at = AUDIT.indexOf('function buildCrossLocIndex');
    const body = AUDIT.slice(at, at + 600);
    assert.match(body, /crossLocByRecordId\.clear\(\)/, 'ไม่ได้ล้างของเก่า = ค้างข้ามการโหลด');
});

// -----------------------------------------------------------------------------
// จับคู่ให้อยู่ติดกัน — admin เจอว่าคู่ของ PK011 อยู่แถว 941 กับ 1005 คนละหน้าจอ
// -----------------------------------------------------------------------------
test('[ui] ต้องมีโหมดเรียงแบบจับคู่ และกดการ์ดแล้วสลับให้อัตโนมัติ', () => {
    assert.match(AUDIT, /<option value="crossloc">/, 'ไม่มีตัวเลือกในกล่องเรียง');
    assert.match(AUDIT, /if \(sortMode === 'crossloc'\)/, 'sortTableByLocation ไม่รู้จักโหมดนี้');
    const at = AUDIT.indexOf('function toggleStatusFilter');
    const body = AUDIT.slice(at, at + 1200);
    assert.match(body, /sortEl\.value = 'crossloc'/, 'กดการ์ดแล้วไม่จัดคู่ให้');
    assert.match(body, /sortBeforeCrossLoc/, 'ปิดตัวกรองแล้วต้องคืนค่าเรียงเดิม');
});

test('[ui] เลือกโซนต้องไม่เด้งออกจากโหมดจับคู่', () => {
    // ไม่งั้นพอกรองโซน คู่จะกระจายกลับทันทีโดยผู้ใช้ไม่ได้สั่ง
    const at = AUDIT.indexOf('function updateSortForSelectedZone');
    const body = AUDIT.slice(at, at + 500);
    assert.match(body, /if \(sortEl\.value === 'crossloc'\) return;/);
});

test('[ui] ต้องตีเส้นคั่นระหว่างคู่ให้อ่านออกว่าอันไหนคู่กัน', () => {
    assert.match(AUDIT, /crossloc-pair-start/);
    assert.match(AUDIT, /crossloc-pair-mid/);
    assert.match(AUDIT, /tr\.crossloc-pair-start > td \{ border-top/, 'ไม่มี CSS ของเส้นคั่น');
    const at = AUDIT.indexOf('function markCrossLocPairEdges');
    assert.ok(at > 0, 'ไม่มีฟังก์ชันตีเส้น');
    const body = AUDIT.slice(at, at + 700);
    assert.match(body, /classList\.remove\('crossloc-pair-start', 'crossloc-pair-mid'\)/,
        'ต้องล้างของเก่าก่อน ไม่งั้นเส้นค้างเมื่อเรียงใหม่');
});

test('[ui] จัดคู่แล้วต้องเรียงเลขแถวใหม่ (ไม่งั้นเลขแถวสลับมั่ว)', () => {
    const at = AUDIT.indexOf("if (sortMode === 'crossloc')");
    const body = AUDIT.slice(at, at + 1600);
    assert.match(body, /renumberRows\(\);/);
    assert.match(body, /markCrossLocPairEdges\(\);/);
    assert.match(body, /if \(ga && !gb\) return -1;/, 'แถวที่อยู่ในกลุ่มต้องขึ้นก่อน');
    assert.match(body, /compareLocation\(locOf\(a\), locOf\(b\)\)/, 'ในคู่เดียวกันต้องเรียงตามตำแหน่ง');
});
