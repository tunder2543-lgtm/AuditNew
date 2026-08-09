// เทสมาตรฐาน SKU (invariant ข้อ 2: UPPERCASE + trim) — ยามกัน regression
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh } from '../helpers/sandbox.mjs';

suite('sku-utils: มาตรฐาน SKU กลาง');

const sb = loadFresh('Js/sku-utils.js');
const { normalizeSku, isSameSku, normalizeSkuList } = sb.SkuUtils;

test('normalizeSku: trim + UPPERCASE', () => {
    assert.equal(normalizeSku('  ab-01  '), 'AB-01');
    assert.equal(normalizeSku('sku123'), 'SKU123');
});

test('normalizeSku: ค่าว่าง/null ไม่พัง', () => {
    assert.equal(normalizeSku(''), '');
    assert.equal(normalizeSku(null), '');
    assert.equal(normalizeSku(undefined), '');
});

test('normalizeSku: ตัวเลขและอักษรไทยคงเดิม (แค่ trim)', () => {
    assert.equal(normalizeSku(12345), '12345');
    assert.equal(normalizeSku(' สินค้า1 '), 'สินค้า1');
});

test('isSameSku: เทียบแบบไม่สนตัวพิมพ์/ช่องว่าง', () => {
    assert.equal(isSameSku('ab-01', ' AB-01 '), true);
    assert.equal(isSameSku('AB-01', 'AB-02'), false);
});

test('normalizeSkuList: ตัดซ้ำ + ตัดค่าว่าง', () => {
    const out = normalizeSkuList([' a1 ', 'A1', '', null, 'b2']);
    // เทียบผ่าน JSON เพราะ array มาจาก VM sandbox (prototype คนละตัว)
    assert.deepEqual(JSON.parse(JSON.stringify(out)), ['A1', 'B2']);
});
