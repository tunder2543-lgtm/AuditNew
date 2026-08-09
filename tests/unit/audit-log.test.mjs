// เทสคุ้มกัน H3 (docs/ISSUES.md) — การแก้/ลบ inventory_counts ต้องเขียน audit log เสมอ
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';

suite('audit-log: สร้าง payload (H3)');

function fresh() {
    const sb = loadFresh('Js/audit-log.js');
    return { sb, AL: sb.AuditLog };
}

const row = (o = {}) => ({
    id: 'rec-1', sku_id: 'A-01', location: 'J5-01',
    warehouse: 'ตึกกันตนา', counted_qty: 12, ...o
});

test('แก้ตำแหน่ง: บันทึกค่าเดิม → ค่าใหม่ และจำนวนไม่เปลี่ยน', () => {
    const { AL } = fresh();
    const e = AL.buildEntry({ action: AL.ACTIONS.EDIT_LOC, row: row(), after: { location: 'K2-09' } });
    assert.equal(e.action_type, 'AUDIT_EDIT_LOC');
    assert.equal(e.record_id, 'rec-1');
    assert.equal(e.sku_id, 'A-01');
    assert.equal(e.location, 'J5-01 → K2-09');
    assert.equal(e.old_qty, 12);
    assert.equal(e.new_qty, 12, 'แก้ตำแหน่งไม่กระทบจำนวน');
    assert.equal(e.warehouse, 'ตึกกันตนา');
});

test('สลับ SKU↔Location: บันทึกทั้งสองค่า', () => {
    const { AL } = fresh();
    const e = AL.buildEntry({
        action: AL.ACTIONS.SWAP, row: row(),
        after: { sku_id: 'J5-01', location: 'A-01' }
    });
    assert.equal(e.location, 'A-01@J5-01 → J5-01@A-01');
    assert.equal(e.sku_id, 'J5-01', 'sku_id ควรเป็นค่าใหม่');
});

test('ลบแถว: new_qty เป็น null และเก็บจำนวนเดิมไว้', () => {
    const { AL } = fresh();
    const e = AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row() });
    assert.equal(e.action_type, 'AUDIT_DELETE');
    assert.equal(e.old_qty, 12);
    assert.equal(e.new_qty, null);
    assert.equal(e.location, 'J5-01', 'เก็บตำแหน่งเดิมของแถวที่ถูกลบ');
});

test('ลบแถวกดซ้ำ: ใช้ action แยกจากการลบปกติ', () => {
    const { AL } = fresh();
    assert.equal(AL.buildEntry({ action: AL.ACTIONS.DEDUPE, row: row() }).action_type, 'AUDIT_DEDUPE');
});

test('ค่าว่าง/null ไม่ทำให้พัง และ field ที่ DB บังคับต้องไม่ว่าง', () => {
    const { AL } = fresh();
    const e = AL.buildEntry({ action: AL.ACTIONS.DELETE, row: { id: 'x' } });
    assert.equal(e.record_id, 'x');
    assert.ok(e.sku_id, 'sku_id เป็น NOT NULL ใน DB — ต้องมีค่าเสมอ');
    assert.equal(e.old_qty, null, 'counted_qty ที่ไม่ใช่ตัวเลข → null');
});

test('counted_qty ที่เป็น string ตัวเลข → แปลงเป็น int', () => {
    const { AL } = fresh();
    assert.equal(AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row({ counted_qty: '7' }) }).old_qty, 7);
});

// -----------------------------------------------------------------------------
// พบจาก code-review: Number('') === 0 และ Number(null) === 0
// ถ้าไม่กันไว้ log จะบันทึก "จำนวนเดิม 0 ชิ้น" ทั้งที่ความจริงคือไม่รู้จำนวน
// (ช่องจำนวนว่างในตาราง และ LOC_COMPARE ที่ตั้ง counted_qty เป็น '' เมื่อ parse ไม่ได้)
// -----------------------------------------------------------------------------
test('[H3-guard] counted_qty ที่เป็น "" หรือ null → null ไม่ใช่ 0', () => {
    const { AL } = fresh();
    assert.equal(AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row({ counted_qty: '' }) }).old_qty, null);
    assert.equal(AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row({ counted_qty: null }) }).old_qty, null);
    assert.equal(AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row({ counted_qty: 0 }) }).old_qty, 0, 'เลข 0 จริงต้องยังเป็น 0');
});

test('[H3-guard] ข้อความสรุปยาวเกินไปถูกตัด (กัน insert พังเพราะเกินขนาดคอลัมน์)', () => {
    const { AL } = fresh();
    const long = 'X'.repeat(500);
    const e = AL.buildEntry({
        action: AL.ACTIONS.SWAP,
        row: row({ sku_id: long, location: long }),
        after: { sku_id: 'A', location: 'B' }
    });
    assert.ok(e.location.length <= AL.MAX_DETAIL, `ยาว ${e.location.length} เกิน ${AL.MAX_DETAIL}`);
});

test('resolveActor: ต่อท้ายด้วยแหล่งที่มาเสมอ (ไม่ให้เข้าใจผิดว่าคนนั้นเป็นคนกด)', () => {
    const { sb, AL } = fresh();
    assert.equal(AL.resolveActor(), 'audit_check');
    sb.localStorage.setItem('saved_counter_name', ' สมชาย ');
    assert.equal(AL.resolveActor(), 'สมชาย (audit_check)');
});

suite('audit-log: เขียนลง DB (dry run)');

test('เขียนเป็นชุด แบ่ง chunk ละ 100', async () => {
    const { AL } = fresh();
    const mock = createMockClient({ inventory_audit_logs: [] });
    const entries = Array.from({ length: 250 }, (_, i) =>
        AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row({ id: 'r' + i }) }));
    const res = await AL.writeEntries(mock, entries);
    assert.equal(res.ok, 250);
    assert.equal(res.failed, 0);
    const inserts = findOps(mock, { table: 'inventory_audit_logs', op: 'insert' });
    assert.equal(inserts.length, 3, 'ต้องแบ่ง 3 ชุด (100+100+50)');
});

test('รายการว่าง / ไม่มี client → ไม่พัง', async () => {
    const { AL } = fresh();
    const res = await AL.writeEntries(null, []);
    assert.equal(res.ok, 0);
    assert.equal(res.failed, 0);
    assert.equal(res.error, null);
    const mock = createMockClient({});
    assert.equal((await AL.writeEntries(mock, [])).ok, 0);
});

test('DB error → รายงาน failed แต่ไม่ throw (ผู้เรียกตัดสินใจเอง)', async () => {
    const { AL } = fresh();
    const mock = createMockClient({ inventory_audit_logs: [] });
    mock.from = () => ({ insert: () => ({ select: async () => ({ error: { message: 'boom' } }) }) });
    const res = await AL.writeEntries(mock, [AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row() })]);
    assert.equal(res.ok, 0);
    assert.equal(res.failed, 1);
    assert.ok(res.error, 'ต้องคืน error ให้ผู้เรียกตรวจได้');
});

// -----------------------------------------------------------------------------
// พบจาก code-review: ถ้า chunk กลางพังแล้วยังเขียนต่อ จะเหลือ log ที่บอกว่า
// "ลบแล้ว" ทั้งที่ผู้เรียก abort การลบไปแล้ว = หลักฐานเท็จ (แย่กว่าไม่มี log)
// -----------------------------------------------------------------------------
test('[H3-guard] chunk พัง → หยุดทันที ไม่เขียนต่อ และคืน id ที่เขียนไปแล้วให้ย้อนได้', async () => {
    const { AL } = fresh();
    let call = 0;
    const mock = createMockClient({});
    mock.from = () => ({
        insert: (rows) => ({
            select: async () => {
                call += 1;
                if (call === 2) return { error: { message: 'boom' } };
                return { data: rows.map((_, i) => ({ id: `log-${call}-${i}` })), error: null };
            }
        })
    });
    const entries = Array.from({ length: 250 }, () => AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row() }));
    const res = await AL.writeEntries(mock, entries);
    assert.equal(call, 2, 'ต้องหยุดที่ chunk ที่พัง ไม่ยิง chunk ที่ 3');
    assert.equal(res.ok, 100);
    assert.equal(res.failed, 150);
    assert.equal(res.writtenIds.length, 100, 'ต้องคืน id ของ log ที่เขียนสำเร็จเพื่อย้อนกลับ');
});

test('[H3-guard] rollbackEntries ลบ log ที่เขียนไปแล้วได้', async () => {
    const { AL } = fresh();
    const mock = createMockClient({ inventory_audit_logs: [] });
    const okRollback = await AL.rollbackEntries(mock, ['a', 'b']);
    assert.equal(okRollback, true);
    const dels = findOps(mock, { table: 'inventory_audit_logs', op: 'delete' });
    assert.equal(dels.length, 1);
    assert.ok(dels[0].filters.some(f => f.type === 'in' && f.col === 'id'));
});

test('rollbackEntries: ไม่มี id / ไม่มี client → ไม่พัง', async () => {
    const { AL } = fresh();
    assert.equal(await AL.rollbackEntries(null, ['a']), true);
    assert.equal(await AL.rollbackEntries(createMockClient({}), []), true);
});

test('Dry Run: fixtures ไม่ถูกแก้จริง', async () => {
    const { AL } = fresh();
    const mock = createMockClient({ inventory_audit_logs: [] });
    await AL.writeEntries(mock, [AL.buildEntry({ action: AL.ACTIONS.DELETE, row: row() })]);
    assert.equal(mock.fixtures.inventory_audit_logs.length, 0);
});

suite('audit-log: บังคับว่าทุก mutation ต้องเขียน log (H3)');

// -----------------------------------------------------------------------------
// audit_check.html แก้/ลบ inventory_counts อยู่ 5 จุด — ทุกจุดต้องผูกกับ audit log
// เทสนี้สแกน source เพื่อกันไม่ให้มีการเพิ่ม mutation ใหม่โดยลืมเขียน log
// -----------------------------------------------------------------------------
test('[H3-guard] audit_check: ทุกฟังก์ชันที่ mutate inventory_counts ต้องเรียก audit log ในตัวมันเอง', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { PROJECT_ROOT } = await import('../helpers/sandbox.mjs');
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Html/audit_check.html'), 'utf8');

    // แบ่ง source เป็นบล็อกตามการประกาศฟังก์ชัน แล้วตรวจทีละบล็อก
    // (แม่นกว่าการนับรวมทั้งไฟล์ — เพิ่ม mutation ในฟังก์ชัน A แล้วไป log ในฟังก์ชัน B จะไม่ผ่าน)
    const parts = src.split(/(?=\n\s*(?:async\s+)?function\s+\w+)/);
    const MUTATION = /\.from\(['"]inventory_counts['"]\)[\s\S]{0,120}?\.(update|delete|upsert)\(/;
    const LOGGING = /(writeAuditLogs(OrAbort|AfterUpdate)|flushAuditLogsIfNeeded)\s*\(/;

    const offenders = [];
    let mutatingBlocks = 0;
    for (const block of parts) {
        if (!MUTATION.test(block)) continue;
        mutatingBlocks += 1;
        if (!LOGGING.test(block)) {
            const name = block.match(/(?:async\s+)?function\s+(\w+)/)?.[1] || '(ไม่ทราบชื่อ)';
            offenders.push(name);
        }
    }

    assert.ok(mutatingBlocks >= 3, `ควรเจอฟังก์ชันที่ mutate อย่างน้อย 3 ตัว เจอ ${mutatingBlocks}`);
    assert.deepEqual(JSON.parse(JSON.stringify(offenders)), [],
        `ฟังก์ชันเหล่านี้แก้/ลบ inventory_counts โดยไม่เขียน audit log: ${offenders.join(', ')}`);
});

test('[H3-guard] audit_check โหลด Js/audit-log.js', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { PROJECT_ROOT } = await import('../helpers/sandbox.mjs');
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Html/audit_check.html'), 'utf8');
    assert.ok(/src="\.\.\/Js\/audit-log\.js/.test(src), 'ต้องโหลด audit-log.js');
});

test('[H3-guard] การลบต้องเขียน log ก่อน และยกเลิกถ้า log ไม่สำเร็จ', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { PROJECT_ROOT } = await import('../helpers/sandbox.mjs');
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'Html/audit_check.html'), 'utf8');

    // รับได้ 2 รูปแบบ:
    //   (ก) deleteRecordsFromSupabase(...) ที่เขียน log ให้ในตัว → ผู้เรียกเช็คค่าที่คืนมา
    //   (ข) writeAuditLogsOrAbort(...) ตรง ๆ แล้ว return เมื่อไม่ผ่าน
    const guardA = (src.match(/await deleteRecordsFromSupabase\([\s\S]{0,200}?if \(!\w+\) return;/g) || []).length;
    const guardB = (src.match(/await writeAuditLogsOrAbort\([\s\S]{0,200}?if \(!\w+\) return;/g) || []).length;

    // จุดที่ลบข้อมูลจริงมี 2 แห่ง: ลบรายการที่เลือก + ลบแถวที่กดซ้ำ
    assert.equal(guardA + guardB, 2,
        `จุดที่ลบข้อมูลต้องยกเลิกเมื่อเขียน log ไม่สำเร็จ (เจอ guard ${guardA + guardB} จุด)`);

    // และฟังก์ชันลบระดับล่างต้องเขียน log ให้ในตัว ไม่พึ่งผู้เรียก
    assert.ok(/async function deleteRecordsFromSupabase\([\s\S]{0,600}?writeAuditLogsOrAbort\(/.test(src),
        'deleteRecordsFromSupabase ต้องเขียน audit log ในตัวเอง เพื่อไม่ให้ผู้เรียกใหม่ลืม');
});

test('action_type ของหน้า audit_check ขึ้นต้นด้วย AUDIT_ ทุกตัว (ให้ตัวแสดงผลแยกออก)', () => {
    const { AL } = fresh();
    for (const [k, v] of Object.entries(AL.ACTIONS)) {
        assert.ok(String(v).startsWith('AUDIT_'), `${k} ควรขึ้นต้นด้วย AUDIT_ แต่เป็น ${v}`);
    }
});

test('หน้าประวัติใน script.js รู้จัก action ทุกตัวที่ audit-log.js ใช้', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { PROJECT_ROOT } = await import('../helpers/sandbox.mjs');
    const script = fs.readFileSync(path.join(PROJECT_ROOT, 'Js/script.js'), 'utf8');
    const { AL } = fresh();
    for (const action of Object.values(AL.ACTIONS)) {
        assert.ok(script.includes(action), `script.js ต้องมีป้ายกำกับสำหรับ ${action} ไม่งั้นประวัติจะขึ้นว่างเปล่า`);
    }
});
