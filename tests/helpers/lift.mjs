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
 * ยกฟังก์ชันชื่อ `names` จาก `src` มาประกาศใน sandbox ใหม่ พร้อม global ที่ป้อนให้ใน `context`
 * คืน object ของฟังก์ชันที่เรียกได้จริง
 */
export function liftFunctions(src, names, context = {}) {
    const decls = names.map(n => {
        const marker = src.includes(`async function ${n}`) ? `async function ${n}` : `function ${n}`;
        const at = src.indexOf(marker);
        assert.ok(at >= 0, `ยกฟังก์ชัน ${n} ไม่ได้`);
        return src.slice(at, at + bodyOf(src, marker).length + (src.indexOf('{', at) - at));
    });
    const sandbox = { console: { warn() {}, info() {}, error() {} }, ...context };
    vm.createContext(sandbox);
    vm.runInContext(decls.join('\n') + `\n;globalThis.__fns = { ${names.join(', ')} };`, sandbox);
    return sandbox.__fns;
}
