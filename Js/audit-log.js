// =============================================================================
//  Audit Log — สร้าง/เขียนบันทึกการเปลี่ยนแปลง inventory_audit_logs
//
//  Invariant ข้อ 1 ของระบบ: `inventory_counts` คือหลักฐานผลนับ
//  การแก้/ลบทุกครั้ง **ต้อง** ทิ้งร่องรอยไว้ใน inventory_audit_logs เสมอ
//  (ดู docs/ISSUES.md ข้อ H3 — เดิมหน้า audit_check แก้/ลบจำนวนมากโดยไม่บันทึกเลย)
//
//  ลำดับการเขียนที่ใช้:
//    - DELETE : เขียน log **ก่อน** ลบ (ลบแล้วข้อมูลหาย สร้าง log ย้อนหลังไม่ได้)
//               ถ้าเขียน log ไม่สำเร็จ → ยกเลิกการลบ
//    - UPDATE : แก้ก่อน แล้วค่อยเขียน log เฉพาะแถวที่สำเร็จ
//               (ถ้า log พังจะเตือนผู้ใช้ แต่ย้อนข้อมูลกลับไม่ได้แล้ว)
//
//  schema ของตารางไม่มีคอลัมน์ note จึงเก็บรายละเอียด "ค่าเดิม → ค่าใหม่"
//  ไว้ในคอลัมน์ location (ข้อความ) เพื่อให้ตามรอยย้อนหลังได้
// =============================================================================

(function () {
    'use strict';

    /** action_type ที่หน้า audit_check ใช้ — แยกจาก INSERT/UPDATE/DELETE ของหน้านับ */
    const ACTIONS = {
        EDIT_LOC: 'AUDIT_EDIT_LOC',       // แก้ตำแหน่ง (โหมดแก้ Location)
        SWAP: 'AUDIT_SWAP',               // สลับ SKU ↔ Location
        LOC_COMPARE: 'AUDIT_LOC_COMPARE', // แก้ตำแหน่งจากการเทียบไฟล์ Excel
        DELETE: 'AUDIT_DELETE',           // ลบแถวที่เลือกในตาราง
        DEDUPE: 'AUDIT_DEDUPE'            // ลบแถวที่กดบันทึกซ้ำ
    };

    const CHUNK = 100;

    function str(v) {
        return v == null ? '' : String(v);
    }

    /** ความยาวสูงสุดของข้อความสรุปการเปลี่ยนแปลง (กัน insert พังเพราะค่ายาวเกินคอลัมน์) */
    const MAX_DETAIL = 200;

    function intOrNull(v) {
        // '' และ null ต้องเป็น "ไม่รู้จำนวน" (null) ไม่ใช่ 0 — Number('') === 0 จึงต้องกันก่อน
        if (v === '' || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
    }

    /**
     * ใครเป็นคนทำ — หน้า audit_check ไม่มีช่องกรอกชื่อ จึงยืมชื่อผู้นับล่าสุดของเครื่องนี้
     * ⚠️ ต่อท้ายด้วย "(audit_check)" เสมอ เพื่อไม่ให้เข้าใจผิดว่าคนนั้นเป็นผู้กดแก้/ลบเอง
     */
    function resolveActor(fallback) {
        const suffix = fallback || 'audit_check';
        try {
            const saved = localStorage.getItem('saved_counter_name');
            if (saved && saved.trim()) return `${saved.trim()} (${suffix})`;
        } catch { /* localStorage อ่านไม่ได้ */ }
        return suffix;
    }

    /**
     * สร้าง payload 1 แถวสำหรับ inventory_audit_logs
     * @param {object} o
     * @param {string} o.action  ค่าจาก ACTIONS
     * @param {object} o.row     แถวเดิมใน inventory_counts (ต้องมี id, sku_id, ...)
     * @param {object} [o.after] ค่าใหม่ (เช่น { location, sku_id }) — ใส่เฉพาะตอน UPDATE
     * @param {string} [o.actor]
     */
    function buildEntry({ action, row, after, actor }) {
        const beforeSku = str(row?.sku_id);
        const beforeLoc = str(row?.location);
        const afterSku = after && after.sku_id != null ? str(after.sku_id) : beforeSku;
        const afterLoc = after && after.location != null ? str(after.location) : beforeLoc;

        // สรุปการเปลี่ยนแปลงลงคอลัมน์ location (schema ไม่มีช่อง note)
        let detail;
        if (!after) {
            detail = beforeLoc || '-';
        } else if (afterSku !== beforeSku && afterLoc !== beforeLoc) {
            detail = `${beforeSku}@${beforeLoc || '-'} → ${afterSku}@${afterLoc || '-'}`;
        } else if (afterLoc !== beforeLoc) {
            detail = `${beforeLoc || '-'} → ${afterLoc || '-'}`;
        } else if (afterSku !== beforeSku) {
            detail = `SKU ${beforeSku} → ${afterSku}`;
        } else {
            detail = afterLoc || '-';
        }

        const qty = intOrNull(row?.counted_qty);
        const isDelete = action === ACTIONS.DELETE || action === ACTIONS.DEDUPE;

        return {
            action_type: action,
            record_id: str(row?.id),
            sku_id: afterSku || beforeSku || '-',
            old_qty: qty,
            new_qty: isDelete ? null : qty,   // ลบ = ไม่มีค่าใหม่ · แก้ตำแหน่ง = จำนวนไม่เปลี่ยน
            warehouse: str(row?.warehouse),
            location: detail.slice(0, MAX_DETAIL),
            counter_name: resolveActor(actor)
        };
    }

    /**
     * เขียน log เป็นชุด — แบ่ง chunk ละ 100
     * **หยุดทันทีที่ chunk แรกพัง** เพื่อไม่ให้เหลือ log ครึ่ง ๆ ที่อาจกลายเป็นหลักฐานเท็จ
     * (เช่น เขียนสำเร็จ 900 แถวแล้ว abort การลบ → log บอกว่าลบแล้วทั้งที่ข้อมูลยังอยู่)
     * @returns {Promise<{ok, failed, error, writtenIds}>} ไม่ throw
     */
    async function writeEntries(client, entries) {
        const list = (entries || []).filter(Boolean);
        if (!client || !list.length) return { ok: 0, failed: 0, error: null, writtenIds: [] };

        let ok = 0;
        let error = null;
        const writtenIds = [];

        for (let i = 0; i < list.length; i += CHUNK) {
            const chunk = list.slice(i, i + CHUNK);
            try {
                const res = await client.from('inventory_audit_logs').insert(chunk).select('id');
                if (res.error) throw res.error;
                (res.data || []).forEach(r => { if (r?.id != null) writtenIds.push(r.id); });
                ok += chunk.length;
            } catch (err) {
                error = err;
                console.warn('[AuditLog] เขียน log ไม่สำเร็จ:', err?.message || err);
                break;   // หยุดทันที ไม่เขียนต่อ
            }
        }
        return { ok, failed: list.length - ok, error, writtenIds };
    }

    /** ลบ log ที่เพิ่งเขียนไป (ใช้ตอนต้อง abort เพื่อไม่ให้เหลือหลักฐานเท็จ) */
    async function rollbackEntries(client, writtenIds) {
        const ids = (writtenIds || []).filter(v => v != null);
        if (!client || !ids.length) return true;
        try {
            const { error } = await client.from('inventory_audit_logs').delete().in('id', ids);
            if (error) throw error;
            return true;
        } catch (err) {
            console.warn('[AuditLog] ย้อน log ไม่สำเร็จ:', err?.message || err);
            return false;
        }
    }

    const api = { ACTIONS, MAX_DETAIL, buildEntry, writeEntries, rollbackEntries, resolveActor };

    if (typeof window !== 'undefined') window.AuditLog = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
