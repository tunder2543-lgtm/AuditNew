// ยกฟังก์ชันจากซอร์สจริงมารันใน sandbox
//
// ทำไมต้องมี: หน้าเว็บทุกหน้าเป็น IIFE + แตะ DOM จึง import ตรง ๆ ไม่ได้
// แต่ถ้าเทสไป "อ่านหน้าตาโค้ด" แทนการรันจริง มันจะผ่านทั้งที่บั๊กกลับมาแล้ว
// (เกิดขึ้นจริง 3 ครั้งในวันเดียว — ดูหัวไฟล์ unit/import-retry-idempotent.test.mjs)
// ⇒ ยกเฉพาะฟังก์ชันที่บริสุทธิ์พอจะรันได้ มาป้อน input จริงแล้ว assert ผลลัพธ์
import assert from 'node:assert/strict';
import vm from 'node:vm';

/** ดึงเนื้อฟังก์ชันแบบนับวงเล็บให้สมดุล */
export function bodyOf(src, marker) {
    const at = src.indexOf(marker);
    assert.ok(at >= 0, `หา "${marker}" ไม่เจอ — เทสนี้ล้าสมัยแล้ว`);
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
    }
    throw new Error('วงเล็บไม่สมดุล: ' + marker);
}

/**
 * ตัดทั้งฟังก์ชัน (header + body) โดยข้าม parameter list ก่อนค่อยหา `{` ของ body
 *
 * ทำไมไม่ใช้ bodyOf ตรง ๆ: ฟังก์ชันที่มี default parameter เป็น object เช่น
 * `acceptCountedForLine(line, opts = {})` จะทำให้ `{}` ในวงเล็บถูกนับเป็น body
 * แล้วฟังก์ชันถูกตัดขาดกลางอากาศ → sandbox พังด้วย "Unexpected token" (เจอจริง 2026-08-13)
 */
function fnSlice(src, marker) {
    const at = src.indexOf(marker);
    assert.ok(at >= 0, `หา "${marker}" ไม่เจอ — เทสนี้ล้าสมัยแล้ว`);
    const paren = src.indexOf('(', at);
    assert.ok(paren >= 0, `ไม่พบ parameter list ของ: ${marker}`);
    let pd = 0, i = paren;
    for (; i < src.length; i++) {
        if (src[i] === '(') pd++;
        else if (src[i] === ')') { pd--; if (pd === 0) break; }
    }
    const open = src.indexOf('{', i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
    }
    throw new Error('วงเล็บไม่สมดุล: ' + marker);
}

/**
 * ยกฟังก์ชันชื่อ `names` จาก `src` มาประกาศใน sandbox ใหม่ พร้อม global ที่ป้อนให้ใน `context`
 * คืน object ของฟังก์ชันที่เรียกได้จริง
 */
export function liftFunctions(src, names, context = {}) {
    return liftInto(src, names, context).fns;
}

/**
 * เหมือน `liftFunctions` แต่คืน sandbox มาด้วย
 *
 * ทำไมต้องมี: `sandbox` เป็น **สำเนา** ของ `context` การที่ฟังก์ชันเขียนทับตัวแปรระดับ
 * โมดูล (เช่น `viewEntries = ...`) จึงไปลงที่ sandbox ไม่ใช่ object ที่ผู้เรียกถืออยู่
 * เทสที่อยากตรวจ "สถานะหลังรัน" ต้องอ่านจาก sandbox โดยตรง
 * ⚠️ object ใน sandbox อยู่คนละ realm — เทียบด้วย `deepStrictEqual` ไม่ได้ ใช้ JSON แทน
 *
 * @returns {{fns: Record<string, Function>, sandbox: object}}
 */
export function liftInto(src, names, context = {}) {
    const decls = names.map(n => {
        // รองรับทั้ง `function f()`, `async function f()` และ `window.f = function ()`
        // (หน้าเว็บในโปรเจกต์นี้ผูกฟังก์ชันไว้กับ window เพื่อให้ onclick= เรียกได้)
        const forms = [
            `async function ${n}`,
            `function ${n}`,
            `window.${n} = async function`,
            `window.${n} = function`,
        ];
        // ⚠️ ต้องเช็คขอบคำ — `includes('function handleEdConfirm')` ไปแมตช์
        //    `function handleEdConfirmInner` ได้ แล้วยกผิดตัว **เงียบ ๆ** (เจอจริง 2026-08-11)
        const boundaryOk = (f) => {
            const i = src.indexOf(f);
            if (i < 0) return false;
            const next = src[i + f.length];
            // ตัวถัดจากชื่อฟังก์ชันต้องไม่ใช่ตัวอักษร/ตัวเลข/_ /$
            return f.includes('= ') ? true : !/[\w$]/.test(next || '');
        };
        const marker = forms.find(boundaryOk);
        assert.ok(marker, `ยกฟังก์ชัน ${n} ไม่ได้`);
        const raw = fnSlice(src, marker);
        return marker.startsWith('window.')
            ? raw.replace(marker, marker.includes('async') ? `async function ${n}` : `function ${n}`)
            : raw;
    });
    const sandbox = { console: { warn() {}, info() {}, error() {} }, ...context };
    vm.createContext(sandbox);
    vm.runInContext(decls.join('\n') + `\n;globalThis.__fns = { ${names.join(', ')} };`, sandbox);
    return { fns: sandbox.__fns, sandbox };
}
