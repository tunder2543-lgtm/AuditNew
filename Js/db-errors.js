// =============================================================================
//  DB Error Helpers — แปลง error ของ Supabase/Postgres เป็นข้อความไทยที่ user เข้าใจ
//
//  ใช้คู่กับการ insert/update/delete เพื่อ:
//    - แยก "ซ้ำ" (unique violation) ออกจาก error อื่น ๆ
//    - แสดงข้อความที่ใช้งานได้จริงแทน raw message ภาษาอังกฤษ
//
//  Postgres error codes ที่สำคัญ:
//    23505 = unique_violation        (ข้อมูลซ้ำ)
//    23502 = not_null_violation      (ขาดข้อมูลจำเป็น)
//    23503 = foreign_key_violation   (อ้างถึงข้อมูลที่ไม่มี/ถูกลบ)
//    23514 = check_violation         (ผิดเงื่อนไข CHECK เช่น sku ไม่เป็น UPPER)
//    PGRST = PostgREST error         (ระดับ REST layer ก่อนถึง DB)
// =============================================================================

(function () {
    'use strict';

    const PG_CODE = {
        UNIQUE_VIOLATION: '23505',
        NOT_NULL_VIOLATION: '23502',
        FK_VIOLATION: '23503',
        CHECK_VIOLATION: '23514',
        SERIALIZATION: '40001',
    };

    /**
     * ตรวจว่า error เป็นชนิด "ข้อมูลซ้ำ" (unique constraint violation)
     * รองรับทั้งกรณีที่ error มี code ตรงๆ และกรณีที่ดูจาก message
     */
    function isDuplicateError(err) {
        if (!err) return false;
        if (err.code === PG_CODE.UNIQUE_VIOLATION) return true;
        const msg = String(err.message || err.error_description || '').toLowerCase();
        return /duplicate key|unique constraint|already exists|23505/.test(msg);
    }

    function isNotNullError(err) {
        if (!err) return false;
        if (err.code === PG_CODE.NOT_NULL_VIOLATION) return true;
        return /null value in column|23502/.test(String(err.message || '').toLowerCase());
    }

    function isCheckViolation(err) {
        if (!err) return false;
        if (err.code === PG_CODE.CHECK_VIOLATION) return true;
        return /check constraint|23514/.test(String(err.message || '').toLowerCase());
    }

    function isFKViolation(err) {
        if (!err) return false;
        if (err.code === PG_CODE.FK_VIOLATION) return true;
        return /foreign key|23503/.test(String(err.message || '').toLowerCase());
    }

    function isNetworkError(err) {
        if (!err) return false;
        const msg = String(err.message || '').toLowerCase();
        return /network|fetch|failed to fetch|timeout/.test(msg) || err.name === 'NetworkError';
    }

    /**
     * แปลง error เป็นข้อความไทยที่ user เข้าใจ + ระบุ severity ที่เหมาะสม
     *
     * @param {*} err - error object
     * @param {object} [opts]
     * @param {string} [opts.context] - บริบทการทำงาน เช่น 'บันทึกการนับ', 'นำเข้า Excel'
     * @param {string} [opts.fallback] - ข้อความเริ่มต้นถ้าไม่แมตช์รูปแบบใด
     * @returns {{ message: string, severity: 'info'|'warning'|'error', isDuplicate: boolean }}
     */
    function formatDbError(err, opts = {}) {
        const context = opts.context ? `${opts.context}: ` : '';
        const fallback = opts.fallback || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';

        if (!err) {
            return { message: `${context}${fallback}`, severity: 'error', isDuplicate: false };
        }

        if (isDuplicateError(err)) {
            return {
                message: `${context}ข้อมูลนี้เคยบันทึกไว้แล้ว ระบบไม่บันทึกซ้ำ`,
                severity: 'warning',
                isDuplicate: true,
            };
        }

        if (isNotNullError(err)) {
            return {
                message: `${context}กรอกข้อมูลไม่ครบ — มีช่องที่จำเป็นเว้นว่าง`,
                severity: 'error',
                isDuplicate: false,
            };
        }

        if (isCheckViolation(err)) {
            return {
                message: `${context}รูปแบบข้อมูลไม่ถูกต้องตามที่กำหนด (เช่น SKU ต้องเป็นตัวพิมพ์ใหญ่)`,
                severity: 'error',
                isDuplicate: false,
            };
        }

        if (isFKViolation(err)) {
            return {
                message: `${context}ข้อมูลอ้างอิงถึงรายการที่ไม่มีอยู่ หรือถูกลบไปแล้ว`,
                severity: 'error',
                isDuplicate: false,
            };
        }

        if (isNetworkError(err)) {
            return {
                message: `${context}เชื่อมต่อเครือข่ายไม่ได้ — ลองใหม่อีกครั้ง`,
                severity: 'error',
                isDuplicate: false,
            };
        }

        const raw = String(err.message || err.error_description || err).slice(0, 200);
        return {
            message: `${context}${raw}`,
            severity: 'error',
            isDuplicate: false,
        };
    }

    const api = {
        PG_CODE,
        isDuplicateError,
        isNotNullError,
        isCheckViolation,
        isFKViolation,
        isNetworkError,
        formatDbError,
    };

    if (typeof window !== 'undefined') {
        window.DbErrors = api;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
