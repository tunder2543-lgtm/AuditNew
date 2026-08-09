// =============================================================================
//  Audit Dedupe — นิยาม "แถวซ้ำ" ของ inventory_counts (ใช้ในหน้า audit_check)
//
//  บริบท (docs/sql/011_drop_strict_inventory_counts_index.sql):
//    แถวที่มี (warehouse, sku, location, qty) เหมือนกัน **เป็นข้อมูลที่ถูกต้อง**
//    ถ้าเกิดจากการนับจริง — เช่น counter คนละคน, re-count เพื่อยืนยัน, คนละรอบนับ
//    ระบบกันซ้ำจาก retry ด้วย client_request_id ที่ระดับ DB อยู่แล้ว
//
//  ดังนั้น "ซ้ำโดยไม่ตั้งใจ" ที่ควรลบได้ ต้องเข้าเงื่อนไข **ทุกข้อ**:
//    1. warehouse + sku + location + qty เหมือนกัน
//    2. อยู่รอบนับ (cycle_id) เดียวกัน       ← คนละรอบ = นับคนละครั้ง ห้ามลบ
//    3. ผู้นับ (counter_name) คนเดียวกัน      ← คนละคน = สองคนยืนยัน ห้ามลบ
//    4. เวลาห่างกันไม่เกิน WINDOW นาที        ← ห่างกันนาน = ตั้งใจนับใหม่ ห้ามลบ
//    5. created_at **ไม่ตรงกันเป๊ะ**          ← ดูหมายเหตุด้านล่าง
//    6. ไม่ได้มาจากไฟล์นำเข้าเดียวกัน (import_batch_id)
//
//  ⚠️ หมายเหตุสำคัญ (ข้อ 5): Postgres `now()` = เวลาเริ่ม transaction จึงคงที่ทั้ง statement
//  → การ insert หลายแถวครั้งเดียว (group submit ในหน้านับ / นำเข้า Excel) ทำให้ทุกแถว
//  ได้ `created_at` **ตรงกันถึงไมโครวินาที** = คนละบรรทัดในชุดเดียวกัน ไม่ใช่การกดซ้ำ
//  ส่วนการกดบันทึกซ้ำจริงคือคนละ request คนละ transaction → เวลาต่างกันเสมอ
//
//  แยกไฟล์ออกมาจาก audit_check.html เพื่อให้เขียนเทสคุ้มกันได้ (ดู tests/unit/audit-dedupe.test.mjs)
// =============================================================================

(function () {
    'use strict';

    /** ช่วงเวลาที่ถือว่าเป็นการกดซ้ำโดยไม่ตั้งใจ (นาที) */
    const DEFAULT_WINDOW_MINUTES = 10;

    function norm(s) {
        return (s ?? '').toString().trim().toUpperCase();
    }

    /** คีย์จัดกลุ่ม — รวม cycle_id และ counter_name ตามนโยบาย migration 011 */
    function groupKey(row) {
        return [
            norm(row.warehouse),
            norm(row.sku_id),
            norm(row.location),
            String(Number(row.counted_qty) || 0),
            row.cycle_id == null ? '(no-cycle)' : String(row.cycle_id),
            norm(row.counter_name)
        ].join('|');
    }

    function timeOf(row) {
        const t = row.created_at ? new Date(row.created_at).getTime() : NaN;
        return Number.isNaN(t) ? null : t;
    }

    /** สองแถวมาจากไฟล์นำเข้าเดียวกันหรือไม่ (= คนละบรรทัดในไฟล์ ห้ามมองว่าซ้ำ) */
    function sameImportBatch(a, b) {
        return !!a.import_batch_id && String(a.import_batch_id) === String(b.import_batch_id);
    }

    /**
     * หาแถวที่ซ้ำโดยไม่ตั้งใจ
     * @param {Array} rows แถวจาก inventory_counts (ต้องมี id, warehouse, sku_id, location,
     *                     counted_qty, created_at, cycle_id, counter_name)
     * @param {{windowMinutes?: number}} opts
     * @returns {{groups: Array, toDelete: Array, keptSeparate: Array, stats: object}}
     *   groups       = กลุ่มที่มีแถวซ้ำจริง (แต่ละกลุ่ม { keep, remove[] })
     *   toDelete     = แถวที่จะลบทั้งหมด (เก็บแถวเก่าสุดของแต่ละกลุ่มไว้)
     *   keptSeparate = กลุ่มที่ค่าเหมือนกันแต่ **ไม่ลบ** พร้อมเหตุผล (ไว้แสดงให้ผู้ใช้เห็น)
     */
    function findAccidentalDuplicates(rows, opts) {
        const windowMs = Math.max(0, Number(opts?.windowMinutes ?? DEFAULT_WINDOW_MINUTES)) * 60 * 1000;

        // จัดกลุ่มแบบเข้ม (รวม cycle + counter)
        const strict = new Map();
        // จัดกลุ่มแบบหลวม (แบบเดิม) — ใช้อธิบายว่าอะไรถูกกันไว้ไม่ลบ
        const loose = new Map();

        for (const r of rows || []) {
            const k = groupKey(r);
            if (!strict.has(k)) strict.set(k, []);
            strict.get(k).push(r);

            const lk = [norm(r.warehouse), norm(r.sku_id), norm(r.location), String(Number(r.counted_qty) || 0)].join('|');
            if (!loose.has(lk)) loose.set(lk, []);
            loose.get(lk).push(r);
        }

        const groups = [];
        const toDelete = [];

        for (const list of strict.values()) {
            if (list.length < 2) continue;
            // เรียงเก่า → ใหม่ · เวลาเท่ากันหรือไม่มีเวลา ใช้ id เรียงต่อ (deterministic)
            const sorted = [...list].sort((a, b) => {
                const ta = timeOf(a), tb = timeOf(b);
                if (ta != null && tb != null && ta !== tb) return ta - tb;
                if (ta == null && tb != null) return 1;
                if (tb == null && ta != null) return -1;
                return String(a.id).localeCompare(String(b.id));
            });
            const keep = sorted[0];
            const keepT = timeOf(keep);
            const keepId = String(keep.id);
            const remove = [];
            for (let i = 1; i < sorted.length; i++) {
                const r = sorted[i];
                const t = timeOf(r);
                if (keepT == null || t == null) continue;      // ไม่มีเวลาให้เทียบ = ไม่กล้าลบ
                if (String(r.id) === keepId) continue;          // กัน id ซ้ำไม่ให้ลบตัวที่เก็บไว้
                if (t === keepT) continue;                      // insert ชุดเดียวกัน (ดูหมายเหตุข้อ 5)
                if (sameImportBatch(keep, r)) continue;         // คนละบรรทัดในไฟล์นำเข้าเดียวกัน
                if (t - keepT <= windowMs) remove.push(r);
            }
            if (remove.length) groups.push({ keep, remove });
            toDelete.push(...remove);
        }

        // กลุ่มที่ "ค่าเหมือนกัน" แต่ไม่เข้าเกณฑ์ลบ — อธิบายเหตุผลให้ผู้ใช้
        const deleteIds = new Set(toDelete.map(r => String(r.id)));
        const keptSeparate = [];
        for (const list of loose.values()) {
            if (list.length < 2) continue;
            const survivors = list.filter(r => !deleteIds.has(String(r.id)));
            if (survivors.length < 2) continue;
            const cycles = new Set(survivors.map(r => (r.cycle_id == null ? '(ไม่มีรอบ)' : String(r.cycle_id))));
            const counters = new Set(survivors.map(r => norm(r.counter_name)));
            const times = new Set(survivors.map(r => timeOf(r)));
            const batches = survivors.map(r => r.import_batch_id).filter(Boolean);
            const reasons = [];
            if (cycles.size > 1) reasons.push('คนละรอบนับ');
            if (counters.size > 1) reasons.push('คนละผู้นับ');
            if (times.size === 1 && survivors.length > 1) reasons.push('บันทึกมาในชุดเดียวกัน');
            if (batches.length > 1 && new Set(batches).size === 1) reasons.push('มาจากไฟล์นำเข้าเดียวกัน');
            if (!reasons.length) reasons.push('เวลาห่างกันเกินช่วงที่ถือว่ากดซ้ำ');
            keptSeparate.push({ rows: survivors, reasons });
        }

        // นับเฉพาะ "แถวส่วนเกิน" ที่กันไว้ไม่ลบ — ไม่นับแถวแรกของกลุ่ม (แถวนั้นไม่เคยถูกพิจารณาลบอยู่แล้ว)
        const keptExtraRowCount = keptSeparate.reduce((s, g) => s + (g.rows.length - 1), 0);

        return {
            groups,
            toDelete,
            keptSeparate,
            stats: {
                scanned: (rows || []).length,
                groupCount: groups.length,
                deleteCount: toDelete.length,
                keptGroupCount: keptSeparate.length,
                keptRowCount: keptExtraRowCount,
                windowMinutes: windowMs / 60000
            }
        };
    }

    /**
     * ใช้ตอน verify แถวในตาราง — แถวอ้างอิงหลายแถวที่ค่าเหมือนกัน
     * เป็น "ปัญหา" (ควรเตือน) หรือ "ปกติ" (นับหลายครั้งโดยชอบ)?
     * @returns {{ suspicious: boolean, reason: string }}
     */
    function classifyRefDuplicate(rowsInEntry, opts) {
        const list = rowsInEntry || [];
        if (list.length < 2) return { suspicious: false, reason: '' };
        const cycles = new Set(list.map(r => (r.cycle_id == null ? '(ไม่มีรอบ)' : String(r.cycle_id))));
        const counters = new Set(list.map(r => norm(r.counter_name)));
        if (cycles.size > 1) return { suspicious: false, reason: 'นับคนละรอบ' };
        if (counters.size > 1) return { suspicious: false, reason: 'ผู้นับหลายคนยืนยันตรงกัน' };
        const found = findAccidentalDuplicates(list, opts);
        return found.toDelete.length
            ? { suspicious: true, reason: 'น่าจะกดบันทึกซ้ำ (เวลาใกล้กันมาก)' }
            : { suspicious: false, reason: 'นับซ้ำเพื่อยืนยัน (คนละเวลา)' };
    }

    const api = {
        DEFAULT_WINDOW_MINUTES,
        groupKey,
        sameImportBatch,
        findAccidentalDuplicates,
        classifyRefDuplicate
    };

    if (typeof window !== 'undefined') window.AuditDedupe = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
