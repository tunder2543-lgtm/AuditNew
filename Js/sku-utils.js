// =============================================================================
//  SKU Utilities — Shared SKU normalization across the entire app
//  มาตรฐานเดียวสำหรับ "การทำให้ SKU เป็นรูปแบบมาตรฐาน" ทั้งตอนเก็บลง DB
//  และตอนเปรียบเทียบ/ค้นหา เพื่อกัน mismatch เช่น "ABC123" vs " abc123 "
//
//  มาตรฐาน: UPPERCASE + trim (รหัสสินค้าคือตัวพิมพ์ใหญ่เสมอ ตัดช่องว่างหัว/ท้าย)
// =============================================================================

(function () {
    'use strict';

    /**
     * แปลง SKU ให้เป็นรูปแบบมาตรฐาน (UPPERCASE + trim)
     * ใช้ได้ทั้งตอน save ลง DB และตอน compare/lookup
     * @param {*} value - ค่าใดๆ (string, number, null, undefined)
     * @returns {string} SKU ที่ trim และเปลี่ยนเป็นตัวพิมพ์ใหญ่ (string ว่างถ้า input ว่าง)
     */
    function normalizeSku(value) {
        return String(value ?? '').trim().toUpperCase();
    }

    /**
     * เปรียบเทียบ SKU 2 ค่าว่าตรงกันหรือไม่ (case-insensitive, trim ทั้ง 2 ฝั่ง)
     * @param {*} a
     * @param {*} b
     * @returns {boolean}
     */
    function isSameSku(a, b) {
        return normalizeSku(a) === normalizeSku(b);
    }

    /**
     * แปลง array ของ SKU ทั้งชุด (ตัด empty + dedupe)
     * @param {Array<*>} values
     * @returns {string[]}
     */
    function normalizeSkuList(values) {
        const out = new Set();
        for (const v of Array.isArray(values) ? values : []) {
            const k = normalizeSku(v);
            if (k) out.add(k);
        }
        return Array.from(out);
    }

    const api = {
        normalizeSku,
        isSameSku,
        normalizeSkuList,
    };

    if (typeof window !== 'undefined') {
        window.SkuUtils = api;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
