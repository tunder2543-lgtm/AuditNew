// =============================================================================
//  ประวัติการปรับ / ยืนยัน — filter / sort / export
//  ใช้โดย Html/adjust_history.html
//
//  ⚠️ ต้องโหลดหลัง Js/reconcile-shared.js (ใช้ RS.normalizeSku, RS.dateToBangkok*)
//  ตัวรวมรายการ (buildAdjustHistoryEntries) อยู่ใน reconcile-shared.js —
//  ห้ามคัดลอกกติกามาไว้ที่นี่ซ้ำ
// =============================================================================

(function () {
    'use strict';

    /** อักขระที่ใช้ในชื่อไฟล์บน Windows ไม่ได้ */
    const BAD_FILENAME_CHARS = /[\\/:*?"<>|]/g;

    function RS() {
        const svc = window.reconcileService;
        if (!svc) throw new Error('ยังไม่ได้โหลด Js/reconcile-shared.js (ต้องมาก่อนไฟล์นี้)');
        return svc;
    }

    /* ── Filter ────────────────────────────────────────────────────────────── */

    /**
     * กรองรายการประวัติ — ทุกเกณฑ์รวมกันแบบ AND, ช่องว่าง = ไม่กรอง
     *
     * @param {Array} entries ผลจาก RS.buildAdjustHistoryEntries
     * @param {Object} c เกณฑ์
     * @param {string} [c.type]     '' | 'adj' | 'adj:draft' | 'adj:applied' | 'ack'
     * @param {string} [c.sku]      ค้นแบบ contains (normalize UPPERCASE ก่อนเทียบ)
     * @param {string} [c.detail]   ค้นข้อความใน detail (case-insensitive)
     * @param {string} [c.dateFrom] YYYY-MM-DD (เวลาไทย, รวมวันนั้น)
     * @param {string} [c.dateTo]   YYYY-MM-DD (เวลาไทย, รวมวันนั้น)
     * @param {number|string} [c.qtyMin]
     * @param {number|string} [c.qtyMax]
     */
    function filterHistoryEntries(entries, c) {
        const crit = c || {};
        const svc = RS();

        const type = String(crit.type || '').trim();
        const skuTerm = svc.normalizeSku(crit.sku || '');
        const detailTerm = String(crit.detail || '').trim().toLowerCase();

        // ตีความวันที่เป็นเวลาไทยเสมอ (invariant ข้อ 5) — ไม่ใช่เวลาเครื่องผู้ใช้
        const fromISO = crit.dateFrom ? svc.dateToBangkokStartISO(crit.dateFrom) : null;
        const toISO = crit.dateTo ? svc.dateToBangkokEndExclusiveISO(crit.dateTo) : null;
        const fromMs = fromISO ? Date.parse(fromISO) : null;
        const toMs = toISO ? Date.parse(toISO) : null;

        const qtyMin = crit.qtyMin === '' || crit.qtyMin == null ? null : Number(crit.qtyMin);
        const qtyMax = crit.qtyMax === '' || crit.qtyMax == null ? null : Number(crit.qtyMax);
        const hasQtyRange = Number.isFinite(qtyMin) || Number.isFinite(qtyMax);

        return (entries || []).filter(e => {
            if (type) {
                if (type === 'adj' && e.type !== 'adj') return false;
                if (type === 'ack' && e.type !== 'ack') return false;
                if (type === 'adj:draft' && !(e.type === 'adj' && e.status === 'draft')) return false;
                if (type === 'adj:applied' && !(e.type === 'adj' && e.status === 'applied')) return false;
            }

            if (skuTerm && !svc.normalizeSku(e.sku).includes(skuTerm)) return false;

            if (detailTerm && !String(e.detail || '').toLowerCase().includes(detailTerm)) return false;

            if (fromMs != null || toMs != null) {
                // ไม่มีเวลา = ตอบไม่ได้ว่าอยู่ในช่วงไหม ⇒ ตัดออกเมื่อผู้ใช้ระบุช่วง (ไม่เดาแทนคน)
                const ms = e.at ? Date.parse(e.at) : NaN;
                if (!Number.isFinite(ms)) return false;
                if (fromMs != null && ms < fromMs) return false;
                if (toMs != null && ms >= toMs) return false;   // end เป็น exclusive
            }

            if (hasQtyRange) {
                // แถว "ยืนยันถูกต้อง" ไม่มีจำนวน — ระบุช่วงจำนวนเมื่อไหร่ก็หลุดออกไป
                if (!Number.isFinite(e.qty)) return false;
                if (Number.isFinite(qtyMin) && e.qty < qtyMin) return false;
                if (Number.isFinite(qtyMax) && e.qty > qtyMax) return false;
            }

            return true;
        });
    }

    /* ── Sort ──────────────────────────────────────────────────────────────── */

    const SORT_KEYS = ['at', 'sku', 'type', 'qty'];

    /** ประเภท: ยอดปรับมาก่อนยืนยันถูกต้อง */
    function typeRank(e) {
        return e.type === 'adj' ? 0 : 1;
    }

    /**
     * เรียงรายการ — คืน array ใหม่เสมอ (ไม่แก้ของเดิม)
     *
     * qty ใช้ **ค่าจริงมีเครื่องหมาย** (+5 > +1 > −3) ให้ตรงกับที่ M3 แก้คอลัมน์ "ต่าง"
     * ให้คืนทิศทางแทนขนาด · แถวที่ไม่มีจำนวน (ack) ไปท้ายเสมอทั้ง asc และ desc
     *
     * @param {Array} entries
     * @param {string} key  'at' | 'sku' | 'type' | 'qty'
     * @param {string} dir  'asc' | 'desc'
     */
    function sortHistoryEntries(entries, key, dir) {
        const k = SORT_KEYS.includes(key) ? key : 'at';
        const sign = dir === 'asc' ? 1 : -1;

        // tiebreak คงที่ ⇒ ผลเรียงเสถียร ไม่สลับตำแหน่งเองระหว่าง render
        const tiebreak = (a, b) =>
            String(a.sku || '').localeCompare(String(b.sku || '')) ||
            String(b.at || '').localeCompare(String(a.at || ''));

        return (entries || []).slice().sort((a, b) => {
            let cmp = 0;
            if (k === 'qty') {
                const av = Number.isFinite(a.qty) ? a.qty : null;
                const bv = Number.isFinite(b.qty) ? b.qty : null;
                // null ไปท้ายเสมอ — ตัดสินก่อนคูณ sign ไม่งั้นสลับทิศแล้วมันเด้งขึ้นหัว
                if (av == null && bv == null) return tiebreak(a, b);
                if (av == null) return 1;
                if (bv == null) return -1;
                cmp = av - bv;
            } else if (k === 'sku') {
                cmp = String(a.sku || '').localeCompare(String(b.sku || ''));
            } else if (k === 'type') {
                cmp = typeRank(a) - typeRank(b);
            } else {
                cmp = String(a.at || '').localeCompare(String(b.at || ''));
            }
            if (cmp !== 0) return cmp * sign;
            return tiebreak(a, b);
        });
    }

    /* ── Export ────────────────────────────────────────────────────────────── */

    const EXPORT_HEADERS = ['ประเภท', 'SKU', 'จำนวน', 'สถานะ', 'รายละเอียด', 'โดย', 'วันเวลา (ไทย)'];

    function typeLabel(e) {
        return e.type === 'adj' ? 'ยอดปรับ' : 'ยืนยันถูกต้อง';
    }

    function statusLabelTh(e) {
        if (e.type !== 'adj') return '';
        return e.status === 'draft' ? 'ร่าง' : 'ปรับแล้ว';
    }

    /** TIMESTAMPTZ → 'YYYY-MM-DD HH:mm' ตามเวลาไทย */
    function fmtBangkokDateTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return String(iso);
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(d);
        const get = t => parts.find(p => p.type === t)?.value || '';
        return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
    }

    /** แปลงรายการเป็นแถวสำหรับ Excel / CSV (คีย์เป็นหัวคอลัมน์ภาษาไทย) */
    function buildHistoryExportRows(entries) {
        return (entries || []).map(e => ({
            [EXPORT_HEADERS[0]]: typeLabel(e),
            [EXPORT_HEADERS[1]]: e.sku || '',
            [EXPORT_HEADERS[2]]: Number.isFinite(e.qty) ? e.qty : '',
            [EXPORT_HEADERS[3]]: statusLabelTh(e),
            [EXPORT_HEADERS[4]]: e.detail || '',
            [EXPORT_HEADERS[5]]: e.by || '',
            [EXPORT_HEADERS[6]]: fmtBangkokDateTime(e.at)
        }));
    }

    /** 'YYYY-MM-DD_HHmm' ตามเวลาไทยจริง — ไม่ใช่ timezone ของเครื่องผู้ใช้ */
    function bangkokStampForFilename(now) {
        // ห้ามใช้ `now instanceof Date` — Date ที่สร้างคนละ realm (vm ของเทส, iframe)
        // จะไม่ผ่าน instanceof แล้วเงียบ ๆ ตกไปใช้เวลาปัจจุบันแทนค่าที่ส่งมา
        const d = now == null ? new Date() : new Date(now);
        if (!Number.isFinite(d.getTime())) return bangkokStampForFilename(null);
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(d);
        const get = t => parts.find(p => p.type === t)?.value || '';
        return `${get('year')}-${get('month')}-${get('day')}_${get('hour')}${get('minute')}`;
    }

    function sanitizeFilePart(value) {
        return String(value ?? '')
            .replace(BAD_FILENAME_CHARS, '-')
            .replace(/\s+/g, ' ')
            .trim() || '-';
    }

    /**
     * ชื่อไฟล์ Export
     * `ประวัติการปรับ-ยืนยัน_<คลัง>_<รอบ>_<YYYY-MM-DD_HHmm>.<ext>`
     *
     * ชื่อฟีเจอร์ในระบบคือ "ประวัติการปรับ / ยืนยัน" แต่ `/` ใช้ในชื่อไฟล์ไม่ได้ → เป็น `-`
     */
    function buildHistoryFileName(cycle, ext, now) {
        const svc = window.reconcileService;
        const wh = svc?.formatWarehouseDisplay
            ? svc.formatWarehouseDisplay(cycle?.warehouse)
            : (cycle?.warehouse || '');
        const parts = [
            'ประวัติการปรับ-ยืนยัน',
            sanitizeFilePart(wh),
            sanitizeFilePart(cycle?.year_month || ''),
            bangkokStampForFilename(now)
        ];
        return `${parts.join('_')}.${String(ext || 'xlsx').replace(/^\./, '')}`;
    }

    /**
     * แปลงแถวเป็น CSV
     * นำหน้าด้วย BOM — ไม่มีแล้ว Excel เปิดภาษาไทยเป็นขยะ (เคยเจอมาแล้ว)
     */
    function toCsv(rows) {
        const list = rows || [];
        const headers = list.length ? Object.keys(list[0]) : EXPORT_HEADERS.slice();
        const cell = v => {
            const s = v == null ? '' : String(v);
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [headers.map(cell).join(',')];
        list.forEach(r => lines.push(headers.map(h => cell(r[h])).join(',')));
        return '﻿' + lines.join('\r\n');
    }

    window.adjustHistoryService = {
        EXPORT_HEADERS,
        SORT_KEYS,
        filterHistoryEntries,
        sortHistoryEntries,
        buildHistoryExportRows,
        buildHistoryFileName,
        bangkokStampForFilename,
        sanitizeFilePart,
        fmtBangkokDateTime,
        typeLabel,
        statusLabelTh,
        toCsv
    };
})();
