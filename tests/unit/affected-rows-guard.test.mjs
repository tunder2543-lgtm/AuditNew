// เทสคุ้มกัน: เขียน/ลบ DB แล้วต้องตรวจว่า "โดนกี่แถวจริง"
//
// ที่มา (code review 2026-08-16): PostgREST คืน `error: null` เมื่อ UPDATE/DELETE
// ไม่แมตช์แถวใดเลย (RLS บล็อก · แถวถูกลบไปแล้ว · ค่าใน .eq() ไม่ตรง)
// ⇒ ระบบขึ้นว่า "สำเร็จ" ลบแถวออกจากจอ **และเขียน audit log ว่าลบแล้ว**
//   ทั้งที่ข้อมูลยังอยู่ในฐาน = หลักฐานเท็จ (ขัด invariant ข้อ 1)
//
// เคสที่เกิดง่ายที่สุด: หน้านับผูก `.eq('warehouse', …)` ไปด้วย ถ้าแถวถูกย้ายคลัง
// จาก audit_check ไปแล้ว จะแมตช์ 0 แถว แต่ UI ลบทิ้งและเขียน log
//
// `chat.html` แก้เรื่องนี้ไปแล้วตอน H8 พร้อมคอมเมนต์อธิบาย แต่ไม่ได้ไล่หน้าอื่น
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { liftFunctions } from '../helpers/lift.mjs';

suite('เขียน/ลบ DB ต้องตรวจจำนวนแถวที่กระทบจริง');

const SCRIPT = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'script.js'), 'utf8');

// ---------- ยามระดับ repo ----------

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
}

/** ไฟล์ทั้งหมดที่อาจเขียน DB */
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

/**
 * หา chain ของ query ที่เริ่มด้วย .update( หรือ .delete( แล้วอ่านต่อไปจนจบ statement
 * เพื่อดูว่ามี .select( อยู่ใน chain เดียวกันไหม
 *
 * ⚠️ chain อาจถูกเก็บใส่ตัวแปรแล้วต่อทีหลัง (`let q = …; q = q.eq(…); await q;`)
 *    กรณีนั้นดูภายใน ±1200 ตัวอักษรรอบจุดนั้นแทน
 */
function writesWithoutSelect(src) {
    const code = stripComments(src);
    const hits = [];
    // จับเฉพาะ chain ที่เริ่มจาก inventory_counts — ตารางหลักฐาน (invariant ข้อ 1)
    // การรายงาน "สำเร็จ" เท็จที่นี่ทำให้ audit log โกหก ซึ่งร้ายแรงกว่าตารางอื่น
    const re = /from\s*\(\s*['"]inventory_counts['"]\s*\)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        const chain = code.slice(m.index, m.index + 900);
        const op = /\.(update|delete)\s*\(/.exec(chain);
        if (!op) continue;                       // เป็นแค่ select ธรรมดา
        // นับ .select( ที่อยู่ "หลัง" จุดที่เริ่ม update/delete เท่านั้น
        const after = chain.slice(op.index);
        if (!/\.select\s*\(/.test(after)) {
            hits.push(`${op[1]} @บรรทัด ${code.slice(0, m.index).split('\n').length}`);
        }
    }
    return hits;
}

test('[affected-rows] เขียน/ลบ inventory_counts ต้องมี .select() เพื่ออ่านจำนวนแถวที่โดนจริง', () => {
    const problems = [];
    for (const f of sourceFiles()) {
        const src = fs.readFileSync(f, 'utf8');
        const hits = writesWithoutSelect(src);
        if (hits.length) problems.push(path.basename(f) + ': ' + hits.join(', '));
    }
    assert.deepEqual(problems, [], 'พบ query ที่เขียน/ลบโดยไม่อ่านผลกลับ:\n' + problems.join('\n'));
});

// ---------- รันจริง: เส้นทางลบในหน้านับ ----------

/**
 * client จำลองที่ควบคุมได้ว่า "โดนกี่แถว"
 * @param {{affected:number, error?:object}} cfg
 */
function clientReturning({ affected, error = null }) {
    const calls = [];
    return {
        calls,
        from(table) {
            const q = {
                _op: null,
                update(p) { q._op = 'update'; q._payload = p; return q; },
                delete() { q._op = 'delete'; return q; },
                eq() { return q; },
                select() { return q; },
                then(res, rej) {
                    calls.push({ table, op: q._op });
                    const rows = Array.from({ length: affected }, (_, i) => ({ id: 'r' + i }));
                    return Promise.resolve(error ? { data: null, error } : { data: rows, error: null })
                        .then(res, rej);
                },
            };
            return q;
        },
    };
}

function liftDeleteFlow({ affected }) {
    const toasts = [];
    const logs = [];
    const removed = [];
    const client = clientReturning({ affected });
    const state = {
        mode: 'delete', id: 'rec-1', sku: 'A-01', oldQty: 5, newQty: 5,
        oldLocation: 'B2-01', newLocation: 'B2-01', step: 2,
        warehouse: 'คลัง', location: 'B2-01', counterName: 'คน',
    };
    const el = () => ({
        value: '', textContent: '', innerHTML: '', title: '', disabled: false, children: [],
        style: {}, classList: { add() {}, remove() {}, toggle() {} },
        remove() { removed.push(1); },
    });
    const fns = liftFunctions(SCRIPT, ['handleEdConfirm', 'handleEdConfirmInner', 'edStaleSince', 'closeEdModal'], {
        supabaseClient: client,
        edState: state,
        edGeneration: 0,
        edBusy: false,
        getEditDestinationCollision: async () => null,
        showToast: (m, t) => toasts.push(`${t || 'success'}: ${m}`),
        logAudit: (...a) => logs.push(a),
        updateRecordRowDom() {},
        updateStats() {},
        renderRecords() {},
        saveToLocalStorage() {},
        allRecords: [{ id: 'rec-1', counted_qty: 5, location: 'B2-01' }],
        escapeHtml: v => String(v ?? ''),
        normalizeLocKey: v => String(v ?? '').trim().toUpperCase(),
        lucide: { createIcons() {} },
        console: { error() {}, warn() {} },
        document: { getElementById: el },
        window: { DbErrors: { formatDbError: e => ({ message: e?.message || 'x' }) } },
    });
    return { fns, toasts, logs, removed, client };
}

test('[affected-rows] ลบแล้วไม่โดนสักแถว: ต้องแจ้งเตือน และห้ามเขียน audit log ว่าลบแล้ว', async () => {
    const { fns, toasts, logs } = liftDeleteFlow({ affected: 0 });
    await fns.handleEdConfirm();
    assert.ok(!logs.some(l => l[0] === 'DELETE'),
        'ห้ามเขียน audit log DELETE เมื่อ DB ไม่ได้ลบอะไรเลย — หลักฐานเท็จ · log ที่เขียน: ' + JSON.stringify(logs));
    assert.ok(toasts.some(t => /^error:/.test(t)),
        'ต้องบอกผู้ใช้ว่าลบไม่สำเร็จ · toasts: ' + toasts.join(' | '));
});

test('[affected-rows] ลบสำเร็จจริง 1 แถว: ยังต้องทำงานครบเหมือนเดิม', async () => {
    const { fns, toasts, logs } = liftDeleteFlow({ affected: 1 });
    await fns.handleEdConfirm();
    assert.ok(logs.some(l => l[0] === 'DELETE'), 'ลบสำเร็จต้องเขียน audit log');
    assert.ok(!toasts.some(t => /^error:/.test(t)), 'ลบสำเร็จห้ามขึ้น error: ' + toasts.join(' | '));
});
