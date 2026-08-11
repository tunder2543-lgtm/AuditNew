// เทสคุ้มกัน M6 + M9 — "บันทึกผลนับต้องไม่ซ้ำ ไม่หาย"
//
// M6 (import_counts): เดิมแถวที่นำเข้าไม่สำเร็จเก็บแค่ sku/loc/qty ⇒ กดนำเข้าซ้ำจะ mint
// `client_request_id` ใหม่ ⇒ unique index `uq_inventory_counts_client_req` มองเป็นคนละแถว
// ⇒ **แถวที่เข้า DB ไปแล้วตอนเน็ตหลุดถูกแทรกซ้ำจริง**
//
// M9 (index โหมดกลุ่ม): `insert(payloads)` all-or-nothing — 1 ใน 25 แถวพัง = rollback ทั้งชุด
//
// ⚠️ **บทเรียน 2026-08-11 (รอบที่ 2 ของวันเดียวกัน)**: เทสรุ่นแรกของไฟล์นี้ผ่าน 9/9
// ทั้งที่ code-reviewer ย้อนบั๊กกลับได้ทั้ง M6 และ M9 — เพราะมันจ้อง "หน้าตาของโค้ด"
// ตรงจุดที่ผมแก้ ไม่ได้จ้อง **ผู้บริโภคปลายทาง** (`buildCountPayload`) และใช้ regex
// ที่แพ้แค่การขึ้นบรรทัดใหม่ (`if (error) throw error;`)
// ⇒ ข้อ [behaviour] ด้านล่างจึง **รันโค้ดจริง** ผ่าน mock DB แทนการอ่านซอร์ส
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { suite, test } from '../helpers/harness.mjs';
import { PROJECT_ROOT } from '../helpers/sandbox.mjs';
import { createMockClient, findOps } from '../helpers/mock-supabase.mjs';
import { liftFunctions, bodyOf } from '../helpers/lift.mjs';

suite('บันทึกผลนับ: retry ต้อง idempotent + ไม่ล้มทั้งชุด (M6, M9)');

const IMPORT = fs.readFileSync(path.join(PROJECT_ROOT, 'Html', 'import_counts.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(PROJECT_ROOT, 'Js', 'script.js'), 'utf8');

// =============================================================================
// [behaviour] รันโค้ดจริง — ข้อที่จ้องพฤติกรรม ไม่ใช่หน้าตาโค้ด
// =============================================================================

test('[M6][behaviour] payload ของแถว retry ต้องใช้ client_request_id เดิม ไม่ mint ใหม่', () => {
    let minted = 0;
    const fns = liftFunctions(IMPORT, ['buildCountPayload'], {
        genClientRequestId: () => `new-${++minted}`,
        window: {},   // ไม่มี reconcileService → คืน base ตรง ๆ
    });

    const retryRow = { sku: 'A1', loc: 'L1', qty: 3, client_request_id: 'orig-key', import_batch_id: 'batch-1' };
    const payload = fns.buildCountPayload(retryRow, 'คลัง', 'ผู้นับ');

    assert.equal(payload.client_request_id, 'orig-key',
        'buildCountPayload คือผู้บริโภคปลายทาง — ถ้ามันไม่ใช้คีย์เดิม การแก้ทั้งหมดข้างบนไร้ผล');
    assert.equal(payload.import_batch_id, 'batch-1');
    assert.equal(minted, 0, 'ห้าม mint คีย์ใหม่ให้แถวที่มีคีย์อยู่แล้ว');
});

test('[M6][behaviour] แถวใหม่ (ไม่มีคีย์) ต้องได้คีย์ใหม่ตามปกติ', () => {
    const at = IMPORT.indexOf('const rowsWithReqId = rows.map');
    const block = IMPORT.slice(IMPORT.lastIndexOf('const batchImportId', at), IMPORT.indexOf('}));', at) + 4);
    const sandbox = { genClientRequestId: () => 'fresh', rows: [{ sku: 'A1' }, { sku: 'A2' }] };
    vm.createContext(sandbox);
    vm.runInContext(block + ';globalThis.__out = rowsWithReqId;', sandbox);
    assert.deepEqual(sandbox.__out.map(r => r.client_request_id), ['fresh', 'fresh']);
    assert.ok(sandbox.__out.every(r => r.import_batch_id === 'fresh'));
});

test('[M6][behaviour] แถวที่ค้างอยู่ต้องสืบทอด batch เดิม ไม่ตั้ง batch ใหม่', () => {
    const at = IMPORT.indexOf('const rowsWithReqId = rows.map');
    const block = IMPORT.slice(IMPORT.lastIndexOf('const batchImportId', at), IMPORT.indexOf('}));', at) + 4);
    const sandbox = {
        genClientRequestId: () => 'SHOULD-NOT-BE-USED',
        rows: [{ sku: 'A1', client_request_id: 'k1', import_batch_id: 'B1' }],
    };
    vm.createContext(sandbox);
    vm.runInContext(block + ';globalThis.__out = rowsWithReqId;', sandbox);
    assert.equal(sandbox.__out[0].client_request_id, 'k1');
    assert.equal(sandbox.__out[0].import_batch_id, 'B1',
        'batch เดิมต้องอยู่ ไม่งั้น "Export รายละเอียด" ของ log เดิมหาแถวไม่ครบ');
});

test('[M9][behaviour] bulk ล้ม → ต้องยิงรายแถวด้วยคีย์เดิม ไม่ทิ้งทั้งชุด', async () => {
    const mock = createMockClient({ inventory_counts: [] });
    // ให้ bulk (payload หลายแถว) ล้ม แต่รายแถวผ่าน — จำลองพฤติกรรมจริงของ M9
    const realFrom = mock.from.bind(mock);
    mock.from = (table) => {
        const q = realFrom(table);
        const origInsert = q.insert.bind(q);
        q.insert = (payload) => {
            const b = origInsert(payload);
            if (Array.isArray(payload) && payload.length > 1) {
                b.then = (res) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'bulk failed' } }).then(res);
            }
            return b;
        };
        return q;
    };

    const fns = liftFunctions(SCRIPT, ['insertGroupRowsOneByOne'], {
        supabaseClient: mock,
        window: { DbErrors: { isDuplicateError: (e) => e?.code === '23505', formatDbError: () => ({ message: 'x' }) } },
    });

    const items = [{ sku: 'A1', quantity: 1 }, { sku: 'A2', quantity: 2 }];
    const payloads = [
        { sku_id: 'A1', client_request_id: 'k1' },
        { sku_id: 'A2', client_request_id: 'k2' },
    ];
    const out = await fns.insertGroupRowsOneByOne(items, payloads);

    assert.equal(out.inserted.length, 2, 'แถวที่ถูกต้องต้องเข้า DB ไม่ถูก rollback ไปด้วย');
    assert.equal(out.failed.length, 0);
    const inserts = findOps(mock, { table: 'inventory_counts', op: 'insert' });
    assert.equal(inserts.length, 2, 'ต้องยิงทีละแถว');
    assert.deepEqual(
        inserts.map(o => o.payload[0].client_request_id), ['k1', 'k2'],
        'ต้องใช้คีย์เดิมของแต่ละรายการ ไม่ mint ใหม่ตอน fallback'
    );
});

test('[M9][behaviour] duplicate ต้องถูกนับแยกจาก fail (แถวนั้นเข้า DB ไปแล้ว)', async () => {
    const mock = createMockClient({ inventory_counts: [] });
    const realFrom = mock.from.bind(mock);
    mock.from = (table) => {
        const q = realFrom(table);
        const origInsert = q.insert.bind(q);
        q.insert = (payload) => {
            const b = origInsert(payload);
            const key = Array.isArray(payload) ? payload[0]?.client_request_id : null;
            if (key === 'dup') {
                b.then = (res) => Promise.resolve({ data: null, error: { code: '23505' } }).then(res);
            } else if (key === 'bad') {
                b.then = (res) => Promise.resolve({ data: null, error: { code: '23502', message: 'null value' } }).then(res);
            }
            return b;
        };
        return q;
    };

    const fns = liftFunctions(SCRIPT, ['insertGroupRowsOneByOne'], {
        supabaseClient: mock,
        window: { DbErrors: { isDuplicateError: (e) => e?.code === '23505', formatDbError: (e) => ({ message: e.message }) } },
    });

    const out = await fns.insertGroupRowsOneByOne(
        [{ sku: 'OK' }, { sku: 'DUP' }, { sku: 'BAD' }],
        [{ client_request_id: 'ok' }, { client_request_id: 'dup' }, { client_request_id: 'bad' }]
    );
    assert.equal(out.inserted.length, 1);
    assert.equal(out.duplicates.length, 1, 'duplicate ไม่ใช่ fail — เข้า DB ไปแล้วจากการกดครั้งก่อน');
    assert.equal(out.failed.length, 1);
    assert.equal(out.failed[0].item.sku, 'BAD');
});

// =============================================================================
// [structure] ข้อที่ยังต้องอ่านซอร์ส (เส้นทางที่ยกมารันไม่ได้เพราะพันกับ DOM)
// =============================================================================

test('[M6/M9-guard] อ่านบล็อกที่ต้องตรวจได้จริง (กันเทสผ่านทั้งที่ไม่ได้ตรวจ)', () => {
    assert.ok(bodyOf(IMPORT, 'function importRowsOneByOne').length > 200);
    assert.ok(bodyOf(IMPORT, 'function restorePendingKeys').length > 100);
    assert.ok(bodyOf(SCRIPT, 'window.submitGroup = async function').length > 1000);
});

test('[M6] แถวที่นำเข้าไม่สำเร็จ ต้องพาคีย์เดิมติดไปด้วย', () => {
    const push = bodyOf(IMPORT, 'function importRowsOneByOne');
    assert.ok(/client_request_id:\s*row\.client_request_id/.test(push));
    assert.ok(/import_batch_id:\s*row\.import_batch_id/.test(push));
    const prep = IMPORT.slice(IMPORT.indexOf('pendingValidRows = allFailedRows.map'), IMPORT.indexOf('pendingValidRows = allFailedRows.map') + 600);
    assert.ok(/client_request_id:\s*fr\.client_request_id/.test(prep));
});

test('[M6] คีย์ค้างต้องอยู่รอดข้ามการรีเฟรช (localStorage) — ไม่ใช่ในหน่วยความจำล้วน', () => {
    // เคสที่ M6 อันตรายที่สุดคือเน็ตหลุด ซึ่งเป็นเคสที่ผู้ใช้กด refresh มากที่สุด
    assert.ok(/const PENDING_KEYS_STORAGE\s*=/.test(IMPORT), 'ต้องมี storage key สำหรับคีย์ค้าง');
    assert.ok(/localStorage\.setItem\(PENDING_KEYS_STORAGE/.test(IMPORT));
    assert.ok(/pendingValidRows = restorePendingKeys\(valid\)/.test(IMPORT),
        'ตอน parse ไฟล์ใหม่ต้องกู้คีย์เดิมกลับ ไม่งั้นอัปไฟล์เดิมทับ = แถวซ้ำ');
    assert.ok(/savePendingKeys\(pendingValidRows\)/.test(IMPORT), 'หลังนำเข้าต้องบันทึกคีย์ที่ยังค้าง');
    assert.ok(/savePendingKeys\(\[\]\)/.test(IMPORT), 'กดล้างไฟล์ต้องทิ้งคีย์ค้าง');
});

test('[M9] submitGroup ต้องไม่โยน error ทิ้งทั้งชุดก่อนลอง fallback', () => {
    const body = bodyOf(SCRIPT, 'window.submitGroup = async function');
    const bulkAt = body.indexOf('.insert(payloads)');
    const fallbackAt = body.indexOf('insertGroupRowsOneByOne');
    assert.ok(fallbackAt > bulkAt, 'ต้องมี fallback หลัง bulk insert');
    // ห้ามมี throw ระหว่าง bulk กับ fallback (จับ mutation ที่แทรก `throw error;` คนละบรรทัด)
    const between = body.slice(bulkAt, fallbackAt);
    assert.ok(!/\bthrow\b/.test(between),
        'มี throw คั่นระหว่าง bulk กับ fallback — แถวที่ถูกต้องจะหายไปทั้งชุด (M9)');
});

test('[M9] แถวที่ยังพังต้องค้างในกลุ่ม และเรียงเหมือนเดิม', () => {
    const body = bodyOf(SCRIPT, 'window.submitGroup = async function');
    assert.ok(/groupItems = failedEntries\.map\(f => f\.item\)\.reverse\(\)/.test(body),
        'groupItems เรียง "ใหม่อยู่บน" แต่ reversedItems เป็น เก่า→ใหม่ — ต้อง reverse กลับ');
    assert.ok(/if \(!insertedPairs\.length && !duplicateItems\.length\) throw/.test(body),
        'พังทั้งชุดจริง ๆ ต้องโยนต่อให้ catch คืน snapshot');
    assert.ok(/groupItems = snapshot;/.test(body));
});

test('[M9] ทุกรายการในกลุ่มต้องมี clientRequestId ตั้งแต่ตอนเพิ่ม (ฐานของ idempotency)', () => {
    assert.ok(/groupItems\.unshift\(\{[^}]*clientRequestId:\s*genClientRequestId\(\)/s.test(SCRIPT));
    const body = bodyOf(SCRIPT, 'window.submitGroup = async function');
    assert.ok(/client_request_id:\s*item\.clientRequestId\s*\|\|/.test(body));
});
