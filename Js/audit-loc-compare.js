// =============================================================================
//  Audit Loc Compare — เทียบตำแหน่งใน DB กับไฟล์ Excel (โหมด "Import เทียบตำแหน่ง")
//
//  Excel มี 2 คอลัมน์: A = SKU, B = ตำแหน่ง — ไม่มีคลัง ไม่มีจำนวน
//  จึงเทียบได้ทีละคลัง และ **แก้เฉพาะคอลัมน์ `location`** ของแถวที่มีอยู่แล้ว
//  ไม่สร้างแถวใหม่ ไม่ลบ ไม่แตะจำนวน (invariant 1/3 ใน CLAUDE.md)
//
//  ⚠️ บทเรียนที่ทำให้ต้องแยกไฟล์นี้ออกมา:
//  ผู้เรียกเคย SELECT ข้อมูลมาโดยไม่เอา `counted_qty` → โมดูลเดิมแปลงเป็น `''` เงียบ ๆ
//  → ตัวเช็คชนปลายทางได้ qty เป็น NaN → **บล็อกทุกแถว 100%** ด้วยข้อความที่อ่านไม่รู้เรื่อง
//  → ฟีเจอร์นี้ใช้งานไม่ได้เลยตั้งแต่แรกโดยไม่มีใครรู้
//  ตอนนี้แถวที่ข้อมูลไม่ครบจะไปอยู่ใน `missingQty` เพื่อให้ "ดัง" แทนที่จะเงียบ
//
//  เทส: tests/unit/audit-loc-compare.test.mjs
// =============================================================================

(function () {
    'use strict';

    function norm(s) {
        return (s ?? '').toString().trim().toUpperCase();
    }

    /** โซน = อักษร A–Z ตัวแรกในตำแหน่ง (เช่น G2-05 → G) */
    function getLocationZone(loc) {
        const m = norm(loc).match(/[A-Z]/);
        return m ? m[0] : '';
    }

    /**
     * จำนวนที่ใช้ได้จริงของแถว — ต้องเป็นตัวเลขจำกัดเท่านั้น
     * `0` เป็นค่าที่ถูกต้อง (นับแล้วไม่เจอของ) ห้ามตกไปเป็น "ไม่มีค่า"
     */
    function usableQty(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * @param {Array} dbRows แถวจาก inventory_counts — ต้องมี id, sku_id, location, warehouse,
     *                       **counted_qty** และ (ถ้ามี) cycle_id
     * @param {string} zone โซนที่เลือก (A–Z) — เทียบเฉพาะ SKU ที่ตำแหน่งใน Excel อยู่โซนนี้
     * @param {Map<string,string>} excelBySku คีย์ = SKU normalize แล้ว, ค่า = ตำแหน่งจาก Excel
     * @param {{warehouse?: string, skuLabelOf?: (normSku:string)=>string}} [opts]
     *        warehouse = คลังที่เทียบ (ว่าง = ไม่กรองคลัง) · เดิมโมดูลอ่าน DOM เองจึงเทสไม่ได้
     * @returns {{mismatches:Array, matchedOk:number, notInSystem:Array,
     *            dbAmbiguous:Array, missingQty:Array}}
     */
    function buildLocComparePlan(dbRows, zone, excelBySku, opts) {
        const scopeWh = norm(opts?.warehouse || '');
        const labelOf = typeof opts?.skuLabelOf === 'function' ? opts.skuLabelOf : (s => s);

        const mismatches = [];
        const notInSystem = [];
        const dbAmbiguous = [];
        const missingQty = [];
        let matchedOk = 0;

        /** @type {Map<string, Array>} SKU (normalize) → แถวในขอบเขต */
        const bySkuInScope = new Map();
        for (const rec of dbRows || []) {
            if (!rec) continue;
            if (scopeWh && norm(rec.warehouse) !== scopeWh) continue;
            const sku = norm(rec.sku_id);
            if (!sku) continue;
            if (!bySkuInScope.has(sku)) bySkuInScope.set(sku, []);
            bySkuInScope.get(sku).push(rec);
        }

        (excelBySku || new Map()).forEach((excelLoc, sku) => {
            if (getLocationZone(excelLoc) !== zone) return;

            const recs = bySkuInScope.get(sku);
            if (!recs || !recs.length) {
                notInSystem.push({ sku: labelOf(sku), excelLocation: excelLoc });
                return;
            }

            // SKU เดียวกันอยู่หลายตำแหน่งใน DB — ระบบตัดสินแทนคนไม่ได้ว่าจะย้ายแถวไหน จึงข้าม
            const distinctLocs = new Set(recs.map(r => norm((r.location || '').trim())));
            if (distinctLocs.size > 1) {
                dbAmbiguous.push({ sku: recs[0].sku_id, locations: [...distinctLocs] });
                return;
            }

            for (const rec of recs) {
                const dbLoc = (rec.location || '').trim();
                if (norm(dbLoc) === norm(excelLoc)) {
                    matchedOk += 1;
                    continue;
                }

                // ไม่มีจำนวน = ข้อมูลที่โหลดมาไม่ครบ ห้ามปล่อยผ่านแบบเงียบ ๆ
                const qty = usableQty(rec.counted_qty);
                if (qty === null) {
                    missingQty.push({
                        id: rec.id,
                        sku: rec.sku_id,
                        dbLocation: dbLoc,
                        newLocation: excelLoc,
                        warehouse: rec.warehouse || ''
                    });
                    continue;
                }

                mismatches.push({
                    id: rec.id,
                    sku: rec.sku_id,
                    dbLocation: dbLoc,
                    newLocation: excelLoc,
                    warehouse: rec.warehouse || '',
                    counted_qty: qty,
                    cycle_id: rec.cycle_id ?? null
                });
            }
        });

        return { mismatches, matchedOk, notInSystem, dbAmbiguous, missingQty };
    }

    const api = { buildLocComparePlan, getLocationZone };

    if (typeof window !== 'undefined') window.AuditLocCompare = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
