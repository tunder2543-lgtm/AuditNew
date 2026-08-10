// เทสคุ้มกัน H8 (docs/ISSUES.md) — ปุ่ม "ล้างแชท" ในหน้า chat
//
// บั๊กเดิม 3 อย่าง:
//   1. ส่ง `okLabel` แต่ modal อ่าน `confirmLabel` → ปุ่มยืนยันแสดง "ยืนยัน" แทน "ล้างแชท"
//   2. ไม่มี else เมื่อไม่มี Supabase client → สถานะค้าง "กำลังล้างแชท..." ตลอดไป
//   3. ใครก็ลบประวัติ+ไฟล์ของทุกคนได้ถาวรโดยไม่มี authorization / ร่องรอย / ของสำรอง
//
// logic อยู่ใน inline script ของ HTML (เทสระดับ DOM ไม่ได้ในสภาพแวดล้อม dry-run)
// จึงตรวจที่ระดับ source ว่ากลไกป้องกันยังอยู่ครบ — เทสทุกข้อผ่าน mutation test มาแล้ว
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';

suite('chat: ปุ่มล้างแชท (H8)');

const CHAT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html/chat.html'), 'utf8');
const MODAL_SRC = fs.readFileSync(path.join(PROJECT_ROOT, 'Js/ui-confirm-modal.js'), 'utf8');

/** ไล่วงเล็บปีกกาจากตำแหน่ง `{` ตัวแรกหลัง idx จนปิดครบ — ไม่ใช้ regex เดาความยาว */
function balancedBlock(src, idx) {
    const open = src.indexOf('{', idx);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
    }
    return src.slice(open);
}

function extractFunction(src, header) {
    const start = src.indexOf(header);
    return start < 0 ? '' : balancedBlock(src, start);
}

/** ตัวฟังก์ชันคุมด่าน (clearAllChat) กับตัวที่ลบจริง (runClearNow) */
const CLEAR_FN = extractFunction(CHAT, 'async function clearAllChat(');
const RUN_FN = extractFunction(CHAT, 'async function runClearNow(');

test('[H8-guard] ต้องมีทั้ง clearAllChat (ด่าน) และ runClearNow (ลบจริง)', () => {
    assert.ok(CLEAR_FN, 'หา clearAllChat ไม่เจอ');
    assert.ok(RUN_FN, 'หา runClearNow ไม่เจอ');
    assert.ok(/await runClearNow\(/.test(CLEAR_FN), 'clearAllChat ต้องเรียก runClearNow หลังผ่านด่านครบ');
});

// -----------------------------------------------------------------------------
// (1) key ของ uiConfirm — กันทั้ง "ตระกูล" ของบั๊ก ไม่ใช่แค่ okLabel ตัวเดียว
//     option ที่พิมพ์ผิดจะถูก modal เมินเงียบ ๆ ผู้ใช้เห็นข้อความ default แทน
// -----------------------------------------------------------------------------

/** key ที่ ui-confirm-modal.js อ่านจริง */
function knownOptionKeys() {
    const keys = new Set(['step1', 'step2']);               // twoStep อ่านเอง
    for (const m of MODAL_SRC.matchAll(/opts\??\.(\w+)/g)) keys.add(m[1]);
    for (const m of MODAL_SRC.matchAll(/opts\.step[12]\?\.(\w+)/g)) keys.add(m[1]);
    return keys;
}

/** ดึง object literal ที่ส่งเข้า uiConfirm.show/twoStep แล้วคืน key ทุกระดับ */
function optionKeysPassedIn(src) {
    const found = [];
    const re = /uiConfirm\.(show|twoStep)\(\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const body = balancedBlock(src, m.index);
        for (const k of body.matchAll(/(?:^|[{,])\s*(\w+)\s*:/g)) {
            found.push({ key: k[1], line: src.slice(0, m.index).split('\n').length });
        }
    }
    return found;
}

/** ทุกไฟล์ source ในระบบ — ไม่ hardcode รายชื่อ ไม่งั้นหน้าใหม่จะหลุดการตรวจ */
function sourceFiles() {
    const out = [path.join(PROJECT_ROOT, 'index.html')];
    for (const dir of ['Js', 'Html']) {
        const full = path.join(PROJECT_ROOT, dir);
        for (const f of fs.readdirSync(full)) {
            if (/\.(js|html)$/.test(f)) out.push(path.join(full, f));
        }
    }
    return out;
}

test('[H8-guard] ทุก option ที่ส่งให้ uiConfirm ต้องเป็น key ที่ modal อ่านจริง', () => {
    const known = knownOptionKeys();
    const offenders = [];

    for (const file of sourceFiles()) {
        const rel = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
        const src = fs.readFileSync(file, 'utf8');
        for (const { key, line } of optionKeysPassedIn(src)) {
            if (!known.has(key)) offenders.push(`${rel}:${line} → "${key}"`);
        }
    }

    assert.deepEqual(JSON.parse(JSON.stringify(offenders)), [],
        `key เหล่านี้ modal ไม่ได้อ่าน จะถูกเมินเงียบ ๆ (เช่น okLabel ที่ต้องเป็น confirmLabel):\n  ${offenders.join('\n  ')}`);
});

test('[H8-guard] ห้ามมี okLabel หลงเหลือในหน้า chat', () => {
    assert.ok(!/okLabel\s*:/.test(CHAT), 'ui-confirm อ่าน confirmLabel ไม่ใช่ okLabel');
});

// -----------------------------------------------------------------------------
// (2) ไม่มี client แล้วต้องไม่ค้าง
// -----------------------------------------------------------------------------

test('[H8-guard] runClearNow ต้องมี else รองรับกรณีไม่มี Supabase client', () => {
    assert.ok(/\}\s*else\s*\{/.test(RUN_FN),
        'ต้องมี else ไม่งั้นสถานะค้างที่ "กำลังล้างแชท..." ตลอดไป');
    const elseBlock = RUN_FN.slice(RUN_FN.search(/\}\s*else\s*\{/));
    assert.ok(/showChatStatus\(/.test(elseBlock), 'else ต้องแจ้งสถานะให้ผู้ใช้เห็น');
});

test('[H8-guard] ต้องอ่าน client ใหม่ตอนกด ไม่พึ่ง supabaseClient ที่อาจยังไม่ถูกตั้ง', () => {
    assert.ok(/supabaseClient\s*\|\|\s*getSupabase\(\)/.test(CLEAR_FN),
        'ปิด modal ตั้งชื่อด้วยการคลิกพื้นหลัง = completeChatSetup ไม่เคยรัน → supabaseClient ยัง null');
});

test('[H8-guard] ปุ่มล้างต้องไม่ค้าง disabled และธงกันกดซ้ำต้องถูกคืนค่าใน finally', () => {
    assert.ok(/if \(clearInProgress\) return;/.test(CLEAR_FN), 'ต้องมีธงกันกดซ้ำ');
    const tail = CLEAR_FN.slice(CLEAR_FN.lastIndexOf('} finally {'));
    assert.ok(/clearInProgress\s*=\s*false/.test(tail) && /btn\.disabled\s*=\s*false/.test(tail),
        'finally ต้องคืนทั้งธงและปุ่ม ไม่งั้นกดล้างไม่ได้อีกเลยทั้งหน้า');
});

// -----------------------------------------------------------------------------
// (3) authorization / ความรับผิดชอบต่อการลบถาวร
// -----------------------------------------------------------------------------

test('[H8-guard] ต้องระบุชื่อผู้ทำก่อนจึงล้างได้', () => {
    assert.ok(/if\s*\(!normalizeText\(myName\)\)/.test(CLEAR_FN),
        'การลบประวัติของทุกคนต้องระบุได้ว่าใครทำ');
});

test('[H8-guard] ลำดับด่านต้องเป็น สำรอง → พิมพ์คำยืนยัน → ลบจริง', () => {
    const backup = CLEAR_FN.indexOf('downloadChatJson(');
    const ask = CLEAR_FN.indexOf('askClearPhrase(');
    const run = CLEAR_FN.indexOf('runClearNow(');
    assert.ok(backup > 0, 'ต้องดาวน์โหลดไฟล์สำรอง');
    assert.ok(ask > backup, 'ต้องสำรองก่อนถามคำยืนยัน (ผู้ใช้จะได้ตรวจว่าไฟล์ลงเครื่องจริง)');
    assert.ok(run > ask, 'ต้องถามคำยืนยันก่อนลบจริง');
});

test('[H8-guard] สำรองไม่สำเร็จต้อง return ไม่ไหลไปลบต่อ', () => {
    const catchIdx = CLEAR_FN.indexOf('} catch (err) {', CLEAR_FN.indexOf('downloadChatJson('));
    assert.ok(catchIdx > 0, 'ต้องมี catch ครอบขั้นสำรอง');
    const catchBlock = balancedBlock(CLEAR_FN, catchIdx);
    assert.ok(/\breturn;/.test(catchBlock),
        'สำรองไม่สำเร็จต้อง return ทันที (แนวเดียวกับ downloadRowsBackupCsv ใน audit_check)');
});

test('[H8-guard] สำรองแบบทั้งห้องต้องอ่านจากเซิร์ฟเวอร์ครบจริง ไม่ใช่ mirror ในเครื่อง', () => {
    const fn = extractFunction(CHAT, 'async function fetchAllRoomMessages(');
    assert.ok(fn, 'ต้องมีฟังก์ชันอ่านข้อความทั้งห้อง');
    assert.ok(/\.range\(/.test(fn), 'ต้องแบ่งหน้า ไม่ใช่ limit เดียวจบ');
    assert.ok(/\.order\(\s*['"]id['"]/.test(fn), 'แบ่งหน้าต้องเรียงด้วย id (กติกาข้อ 13)');
    assert.ok(/from \+= data\.length/.test(fn),
        'ต้องเลื่อน cursor ตามจำนวนแถวที่ได้จริง — PostgREST คืนน้อยกว่าที่ขอได้ (db-max-rows/timeout)');
    assert.ok(/count:\s*['"]exact['"]/.test(fn) && /throw new Error\(/.test(fn),
        'ต้องเทียบกับ count จริง แล้วโยน error ถ้าอ่านไม่ครบ — สำรองไม่ครบต้องไม่ปล่อยให้ลบ');
});

test('[H8-guard] ต้องมีด่านพิมพ์คำยืนยัน + await จริง + ปุ่มยืนยัน disabled ไว้ก่อน', () => {
    assert.ok(/const CLEAR_CONFIRM_PHRASE\s*=/.test(CHAT), 'ต้องมีคำยืนยัน');
    // ลืม await = ได้ Promise ซึ่ง truthy เสมอ → ด่านนี้ถูกข้ามทั้งด่านโดยเทสไม่รู้ตัว
    assert.ok(/const confirmed = await askClearPhrase\(/.test(CLEAR_FN),
        'ต้อง await — ไม่งั้น confirmed เป็น Promise (truthy เสมอ) และด่านนี้ไร้ผล');
    assert.ok(/if \(!confirmed\)/.test(CLEAR_FN) && /\breturn;/.test(
        balancedBlock(CLEAR_FN, CLEAR_FN.indexOf('if (!confirmed)'))),
        'ไม่ยืนยัน = ต้อง return');
    assert.ok(/id="btnClearConfirm"[^>]*\sdisabled/.test(CHAT),
        'ปุ่มยืนยันต้อง disabled ตั้งแต่ต้น เปิดเมื่อพิมพ์ตรงเท่านั้น');
    assert.ok(/btnClearConfirm\.disabled\s*=\s*normalizeText\(clearConfirmInput\.value\)\s*!==\s*CLEAR_CONFIRM_PHRASE/.test(CHAT),
        'ต้องเทียบข้อความที่พิมพ์กับคำยืนยันแบบตรงตัว');
});

test('[H8-guard] ทางออกที่ไม่ใช่การยืนยัน ต้อง resolve เป็น false ทุกทาง', () => {
    // "ยกเลิก" ที่ resolve(true) = กดยกเลิกแล้วลบ — ต้องจับให้ได้
    for (const [what, re] of [
        ['ปุ่มยกเลิก', /getElementById\('btnClearCancel'\)\.addEventListener\('click',\s*\(\)\s*=>\s*closeClearConfirm\(false\)\)/],
        ['คลิกพื้นหลัง', /clearConfirmModal\.addEventListener\('click'[\s\S]{0,160}?closeClearConfirm\(false\)/],
        ['ปุ่ม Escape', /Escape'[\s\S]{0,120}?clearConfirmModal[\s\S]{0,80}?closeClearConfirm\(false\)/]
    ]) {
        assert.ok(re.test(CHAT), `${what} ต้อง closeClearConfirm(false)`);
    }
    // ยืนยันจริงต้องผ่านการเทียบคำเสมอ
    assert.ok(/btnClearConfirm\.addEventListener\('click',[\s\S]{0,200}?===\s*CLEAR_CONFIRM_PHRASE\)\s*closeClearConfirm\(true\)/.test(CHAT),
        'ปุ่มยืนยันต้องเทียบคำก่อน closeClearConfirm(true)');
    // เปิดซ้อนต้องปิดตัวเก่า ไม่งั้นโปรมิสเดิมค้างตลอดอายุหน้า
    assert.ok(/if \(clearConfirmResolve\) closeClearConfirm\(false\);/.test(CHAT),
        'askClearPhrase ต้อง settle โปรมิสเดิมก่อนเปิดใหม่');
});

test('[H8-guard] DELETE ต้อง .select() และเทียบกับจำนวนที่อ่านจากเซิร์ฟเวอร์', () => {
    assert.ok(/\.delete\(\)[\s\S]{0,200}?\.select\(/.test(RUN_FN),
        'RLS บล็อก DELETE = PostgREST คืน 200 พร้อม 0 แถวแบบไม่ error (กติกาข้อ 12) — ต้องนับแถวจริง');
    assert.ok(/deletedCount === 0 && knownCount > 0/.test(RUN_FN),
        'ต้องเทียบกับจำนวนที่อ่านจากเซิร์ฟเวอร์ตอนสำรอง ไม่ใช่ mirror ในเครื่อง (ซึ่งอาจว่างอยู่แล้ว)');
    assert.ok(/showChatStatus\([\s\S]{0,200}deletedCount/.test(RUN_FN),
        'ต้องรายงานจำนวนที่ลบจริงให้ผู้ใช้เห็น');
});

test('[H8-guard] คำเตือนต้องไม่ถูกข้อความ realtime เขียนทับ', () => {
    // ข้อความใหม่ที่ไหลเข้ามาเรียก updateHint ทุกครั้ง เคยลบคำเตือน RLS ทิ้งใน < 1 วินาที
    assert.ok(/if \(Date\.now\(\) < statusHoldUntil\) return;/.test(CHAT),
        'updateHint ต้องไม่เขียนทับสถานะที่กำลังถูก hold');
    assert.ok(/statusHoldUntil = holdMs \? Date\.now\(\) \+ holdMs : 0;/.test(CHAT),
        'showChatStatus ต้องตั้ง/ล้าง hold');
    assert.ok(/showChatStatus\([\s\S]{0,240}?storageWarn,[\s\S]{0,60}?holdMs\s*\)/.test(RUN_FN),
        'ข้อความสรุปผลการล้าง (ที่อาจมีคำเตือน) ต้อง hold ไว้ให้อ่านทัน');
});

test('[H8-guard] ต้องทิ้งร่องรอยว่าใครล้างแชท', () => {
    const fn = extractFunction(CHAT, 'async function writeClearTrace(');
    assert.ok(fn, 'ต้องมีฟังก์ชันบันทึกร่องรอยการล้าง');
    assert.ok(/getDisplayName\(\)/.test(fn), 'ร่องรอยต้องมีชื่อผู้ทำ');
    const traceIdx = RUN_FN.indexOf('await writeClearTrace(');
    assert.ok(traceIdx > 0, 'runClearNow ต้องเรียกใช้');
    assert.ok(/try\s*\{\s*$/m.test(RUN_FN.slice(Math.max(0, traceIdx - 120), traceIdx)),
        'ต้องห่อ try/catch — เขียนร่องรอยไม่สำเร็จไม่ใช่การล้างไม่สำเร็จ');
});

test('[H8-guard] ล้างไฟล์แนบใน Storage ต้องวนจนหมด และจบลูปด้วยเงื่อนไขที่ถูกต้อง', () => {
    const from = RUN_FN.indexOf('let storageWarn');
    const to = RUN_FN.indexOf('localStorage.removeItem(STORAGE_KEY)', from);
    assert.ok(from > 0 && to > from, 'หาบล็อกล้าง Storage ไม่เจอ');
    const storagePart = RUN_FN.slice(from, to);

    assert.ok(/\.from\(CHAT_BUCKET\)/.test(storagePart), 'บล็อกนี้ต้องเป็นส่วนที่จัดการ Storage จริง');
    assert.ok(/for\s*\(/.test(storagePart), 'ต้องวนลบหลายรอบ ไม่งั้นเกิน 500 ไฟล์เหลือ orphan เงียบ ๆ');
    assert.ok(/MAX_ROUNDS/.test(storagePart), 'ต้องมีเพดานรอบ กันวนไม่รู้จบถ้า remove ไม่มีผลจริง');
    assert.ok(/const \{ data: removed[\s\S]*?!removed\?\.length/.test(storagePart),
        'remove ที่โดน policy บล็อกคืน data:[] โดยไม่ error — ต้องเช็คจำนวนที่ลบได้จริง');

    // ลูปต้องจบเพราะ "หน้าสุดท้ายไม่เต็ม" เท่านั้น — เปลี่ยนเป็น `break;` เปล่าเมื่อไหร่
    // ก็กลับไปเป็นบั๊กเดิม (ลบแค่ 500 ไฟล์แรก) โดยที่ for/MAX_ROUNDS ยังอยู่ครบ เทสเลยต้องตรึงเงื่อนไขนี้ตรง ๆ
    assert.ok(/if \(listed\.length < PAGE\) break;/.test(storagePart),
        'เงื่อนไขจบลูปต้องเป็น "หน้าสุดท้ายไม่เต็ม" — break เปล่าทำให้ลบแค่หน้าเดียวเหมือนบั๊กเดิม');
});
