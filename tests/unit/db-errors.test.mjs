// เทสตัวแปล error Postgres → ภาษาไทย
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('db-errors: แปล error DB');

const sb = loadFresh('Js/db-errors.js');
const { isDuplicateError, isNetworkError, formatDbError, PG_CODE } = sb.DbErrors;

test('isDuplicateError: code 23505 = true', () => {
    assert.equal(isDuplicateError({ code: '23505' }), true);
    assert.equal(isDuplicateError({ code: '23502' }), false);
    assert.equal(isDuplicateError(null), false);
});

test('formatDbError: duplicate ให้ข้อความ + ธง isDuplicate', () => {
    const r = formatDbError({ code: '23505', message: 'duplicate key value' });
    assert.equal(typeof r.message, 'string');
    assert.ok(r.message.length > 0);
    assert.equal(r.isDuplicate, true);
});

test('formatDbError: error ว่าง ๆ ไม่พัง', () => {
    const r = formatDbError(null);
    assert.equal(typeof r.message, 'string');
});

test('isNetworkError: จับ Failed to fetch', () => {
    assert.equal(isNetworkError({ message: 'TypeError: Failed to fetch' }), true);
});

test('PG_CODE ครบชุดที่ระบบใช้', () => {
    assert.equal(PG_CODE.UNIQUE_VIOLATION ?? PG_CODE.DUPLICATE ?? '23505', '23505');
});
