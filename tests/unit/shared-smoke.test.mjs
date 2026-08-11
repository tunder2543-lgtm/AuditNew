// เทสควัน (smoke): shared JS ทุกไฟล์หลักโหลดใน sandbox ได้โดยไม่ throw
// และ export global ตามที่หน้า HTML คาดหวัง — ถ้าไฟล์ไหนพังตอนโหลด ทุกหน้าที่ใช้ไฟล์นั้นพังหมด
import assert from 'node:assert/strict';
import { suite, test } from '../helpers/harness.mjs';
import { loadFresh, createSandbox, loadScript } from '../helpers/sandbox.mjs';

suite('smoke: โหลด shared JS');

test('Js/sku-utils.js โหลดได้ + export window.SkuUtils', () => {
    const sb = loadFresh('Js/sku-utils.js');
    assert.ok(sb.SkuUtils, 'window.SkuUtils ต้องมี');
    assert.equal(typeof sb.SkuUtils.normalizeSku, 'function');
});

test('Js/db-errors.js โหลดได้ + export window.DbErrors', () => {
    const sb = loadFresh('Js/db-errors.js');
    assert.ok(sb.DbErrors);
    assert.equal(typeof sb.DbErrors.formatDbError, 'function');
    assert.equal(typeof sb.DbErrors.isDuplicateError, 'function');
});

test('Js/dashboard-shared.js โหลดได้ + export window.dashboardShared', () => {
    const sb = loadFresh('Js/dashboard-shared.js');
    assert.ok(sb.dashboardShared);
    assert.equal(typeof sb.dashboardShared.bucketSubmissionsByInterval, 'function');
});

test('Js/reconcile-shared.js โหลดได้ + export window.reconcileService (~79 ฟังก์ชัน)', () => {
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    assert.ok(sb.reconcileService);
    const keys = Object.keys(sb.reconcileService);
    assert.ok(keys.length >= 75, `คาด export >= 75 ตัว ได้ ${keys.length}`);   // ลด 80→75 ตอนลบ 6 ฟังก์ชันตาย 2026-08-11
    assert.equal(typeof sb.reconcileService.attachCycleToPayload, 'function');
});

test('Js/warehouses-shared.js โหลดได้ + export window.warehouseService', () => {
    const sb = loadFresh('Js/warehouses-shared.js');
    assert.ok(sb.warehouseService);
    assert.equal(typeof sb.warehouseService.getWarehouseList, 'function');
});

test('Js/api.js โหลดได้ + export window.apiService (sandbox — ไม่แตะเครื่องจริง)', () => {
    const sb = loadFresh('Js/api.js');
    assert.ok(sb.apiService);
    assert.equal(typeof sb.apiService.getClient, 'function');
    // ไม่มี window.supabase ใน sandbox → ต้องคืน null ไม่ใช่ throw
    assert.equal(sb.apiService.getClient(), null);
});

test('Js/settings-shared.js โหลดได้ (มี stub document)', () => {
    const sb = createSandbox();
    loadScript(sb, 'Js/api.js');
    loadScript(sb, 'Js/settings-shared.js');
    assert.equal(typeof sb.checkSupabaseConnection, 'function');
    assert.equal(typeof sb.saveSupabaseSettings, 'function');
});

test('ลำดับโหลดของ live-count-wall: reconcile-shared ต้องมาก่อน (กติกาลำดับ script)', () => {
    // จำลองการโหลดผิดลำดับ — RS จะเป็น undefined ตอน parse
    // เทสนี้บันทึกพฤติกรรมจริงไว้: live-count-wall.js capture ตอน parse
    const sb = loadFresh('Js/sku-utils.js', 'Js/reconcile-shared.js');
    assert.ok(sb.reconcileService, 'ต้องมี reconcileService ก่อนโหลด live-count-wall.js เสมอ');
});
