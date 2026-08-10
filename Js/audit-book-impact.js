// =============================================================================
//  Audit Book Impact — "แถวนับทับซ้อน ทำให้ยอด Match เพี้ยนเท่าไหร่"
//
//  บริบท (docs/sql/013_audit_warnings.sql):
//    refresh_reconciliation_for_cycle รวมยอดด้วย `SUM(counted_qty)` **ต่อ SKU ต่อรอบ**
//    → ทุกแถวของ SKU เดียวกันในรอบเดียวกันถูกบวกรวมหมด ไม่สนตำแหน่ง
//
//  ที่ตำแหน่งเดียวกันมีหลายแถว จึงมีได้ทั้งสองแบบ และ **ระบบตัดสินแทนคนไม่ได้**:
//    ✅ ทยอยนับ/แยกกล่อง — เช่น BNP20 @ B2-01 = 70 + 200 = 270 = Book 270 เป๊ะ
//    ❌ คีย์ผิดแล้วคีย์ใหม่ แถวเก่าค้าง — เช่น BNP298 @ B1-01 = 51 + 1 ทั้งที่ Book = 1
//
//  โมดูลนี้จึงทำแค่ "รายงานข้อเท็จจริง" แล้วส่งให้คนตัดสิน:
//    1. ชี้ว่าตำแหน่งไหนมีหลายแถว (overlapLocations)
//    2. ยอดรวมของ SKU นี้เทียบกับ Book เป็นเท่าไหร่
//
//  ⛔ นโยบายจาก admin (2026-08-10): **ระบบห้ามลบหรือแก้จำนวนเอง และห้ามแนะนำให้ลบ**
//     นับมายังไงเก็บอย่างนั้น — หน้าที่ของระบบคือชี้ให้ดู แล้วให้คนกด "ยืนยันว่าปกติ"
//
//  เทส: tests/unit/audit-book-impact.test.mjs (ตัวเลขทุกเคสมาจากข้อมูลจริง)
// =============================================================================

(function () {
    'use strict';

    function normLoc(s) {
        return (s ?? '').toString().trim().toUpperCase();
    }

    /** ค่าจาก PostgREST เป็น numeric → มาเป็น string ("193.0000") ต้องแปลงก่อนเทียบเสมอ */
    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function timeOf(row) {
        const t = row.created_at ? new Date(row.created_at).getTime() : NaN;
        return Number.isNaN(t) ? null : t;
    }

    /** เรียงเก่า → ใหม่ · เวลาเท่ากันหรือไม่มีเวลา ใช้ id ต่อ (deterministic เหมือน audit-dedupe) */
    function byTimeThenId(a, b) {
        const ta = timeOf(a), tb = timeOf(b);
        if (ta != null && tb != null && ta !== tb) return ta - tb;
        if (ta == null && tb != null) return 1;
        if (tb == null && ta != null) return -1;
        return String(a.id).localeCompare(String(b.id));
    }

    /**
     * @param {Array} rowsOfSku แถว inventory_counts ของ SKU เดียว ในรอบเดียว
     * @param {object|null} recLine แถวจาก reconciliation_lines ของ SKU+รอบนั้น
     *                              (null = รอบนี้ยังไม่ได้กด "คำนวณ Match")
     * @returns {{
     *   totalCounted:number, bookQty:number|null, effectiveBookQty:number|null,
     *   variance:number|null, matchStatus:string|null, hasMatchData:boolean, staleMatch:boolean,
     *   overlapLocations:Array<{location:string, rows:Array, sameQty:boolean, sum:number}>
     * }}
     */
    function computeSkuImpact(rowsOfSku, recLine) {
        const rows = (rowsOfSku || []).filter(Boolean);
        const totalCounted = rows.reduce((s, r) => s + (Number(r.counted_qty) || 0), 0);

        // จัดกลุ่มตามตำแหน่ง — เก็บลำดับที่เจอไว้ เพื่อให้ผลลัพธ์เสถียร
        const byLoc = new Map();
        for (const r of rows) {
            const k = normLoc(r.location);
            if (!byLoc.has(k)) byLoc.set(k, []);
            byLoc.get(k).push(r);
        }

        const overlapLocations = [];
        for (const [loc, list] of byLoc) {
            if (list.length < 2) continue;
            const sorted = [...list].sort(byTimeThenId);
            overlapLocations.push({
                location: loc,
                rows: sorted.map(r => ({
                    id: String(r.id),
                    qty: Number(r.counted_qty) || 0,
                    counter_name: (r.counter_name ?? '').toString().trim(),
                    created_at: r.created_at || null
                })),
                sameQty: new Set(sorted.map(r => Number(r.counted_qty) || 0)).size === 1,
                sum: sorted.reduce((s, r) => s + (Number(r.counted_qty) || 0), 0)
            });
        }

        const bookQty = recLine ? num(recLine.book_qty) : null;
        const effectiveBookQty = recLine
            ? (num(recLine.effective_book_qty) ?? num(recLine.book_qty))
            : null;
        const hasMatchData = !!recLine && effectiveBookQty !== null;
        const variance = hasMatchData ? totalCounted - effectiveBookQty : null;
        const recCounted = recLine ? num(recLine.counted_qty) : null;

        return {
            totalCounted,
            bookQty,
            effectiveBookQty,
            variance,
            matchStatus: recLine ? (recLine.match_status || null) : null,
            hasMatchData,
            // Match ที่คำนวณไว้ไม่ตรงกับข้อมูลปัจจุบันแล้ว (มีคนแก้/ลบหลังกดคำนวณ)
            staleMatch: hasMatchData && recCounted !== null && recCounted !== totalCounted,
            overlapLocations
        };
    }

    /**
     * การยืนยัน "ตรวจแล้วปกติ" ที่บันทึกไว้ ยังใช้กับข้อมูลชุดปัจจุบันได้อยู่ไหม
     *
     * ยืนยันแล้วต้องเงียบ — แต่ถ้าข้อมูลเปลี่ยนหลังยืนยัน (มีแถวเพิ่ม/จำนวนเปลี่ยน)
     * การยืนยันเดิมใช้ไม่ได้แล้ว ต้องกลับมาเตือนให้ตรวจใหม่ ไม่งั้นของใหม่จะแอบผ่าน
     *
     * @param {{rowCount:number, totalQty:number}} current สภาพข้อมูลตอนนี้
     * @param {object|null} acceptance แถวจาก inventory_count_acceptances
     * @returns {{state:'none'|'accepted'|'stale', acceptedBy:string, acceptedAt:string|null,
     *            note:string, wasRowCount:number|null, wasTotalQty:number|null}}
     */
    function classifyAcceptance(current, acceptance) {
        const base = { state: 'none', acceptedBy: '', acceptedAt: null, note: '', wasRowCount: null, wasTotalQty: null };
        if (!acceptance) return base;

        const wasRowCount = num(acceptance.row_count);
        const wasTotalQty = num(acceptance.total_qty);
        const same = wasRowCount === (Number(current?.rowCount) || 0)
            && wasTotalQty === (Number(current?.totalQty) || 0);

        return {
            state: same ? 'accepted' : 'stale',
            acceptedBy: (acceptance.accepted_by ?? '').toString().trim(),
            acceptedAt: acceptance.accepted_at || null,
            note: (acceptance.note ?? '').toString().trim(),
            wasRowCount,
            wasTotalQty
        };
    }

    const api = { computeSkuImpact, classifyAcceptance };

    if (typeof window !== 'undefined') window.AuditBookImpact = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
