// =============================================================================
// harness.mjs — โครงเทสกลาง: test() / knownIssue() + ตัวเก็บผล
//
// ประเภทผล:
//   PASS         — เทสปกติผ่าน
//   FAIL         — เทสปกติพัง = ⚠️ REGRESSION (ของที่เคยดีเสียแล้ว)
//   KNOWN-OPEN   — เทสของบั๊กที่รู้อยู่แล้ว (ISSUES.md) ยังพังตามคาด = ยังไม่ได้แก้
//   KNOWN-FIXED  — เทสของบั๊กที่รู้อยู่แล้วกลับผ่าน = บั๊กถูกแก้แล้ว!
//                  → อัปเดต docs/FIX_TRACKING.md แล้วย้ายเทสนั้นเป็น test() ปกติ
//                  เพื่อให้มันกลายเป็นยามกัน regression ต่อไป
// =============================================================================

const registry = [];
let currentSuite = '(no suite)';

export function suite(name) { currentSuite = name; }

export function test(name, fn) {
    registry.push({ suite: currentSuite, name, fn, kind: 'normal' });
}

/**
 * เทสที่ assert "พฤติกรรมที่ถูกต้อง" ของบั๊กที่รู้อยู่แล้วใน docs/ISSUES.md
 * ตอนนี้คาดว่าจะ FAIL (เพราะยังไม่แก้) — เมื่อแก้แล้วจะรายงาน KNOWN-FIXED
 */
export function knownIssue(issueId, name, fn) {
    registry.push({ suite: currentSuite, name, fn, kind: 'known', issueId });
}

export async function runAll({ filter } = {}) {
    const results = [];
    for (const t of registry) {
        if (filter && !(`${t.suite} ${t.name}`.toLowerCase().includes(filter.toLowerCase()))) continue;
        let status, error = null;
        try {
            await t.fn();
            status = t.kind === 'known' ? 'KNOWN-FIXED' : 'PASS';
        } catch (err) {
            status = t.kind === 'known' ? 'KNOWN-OPEN' : 'FAIL';
            error = err;
        }
        results.push({ ...t, status, error });
    }
    return results;
}

export function clearRegistry() { registry.length = 0; }
