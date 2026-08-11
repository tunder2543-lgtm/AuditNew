/**
 * count-scan-shared.js — อ่าน "เดือน/วันที่มีข้อมูลการนับ" จาก `inventory_counts`
 *
 * ⛔ ห้ามใช้ `.limit(n)` กับตารางนี้เด็ดขาด — Supabase hosted จำกัด max-rows ไว้ที่ 1,000
 *    และ **ตัดเงียบ ๆ** `.limit(10000)` จึงได้จริงแค่ 1,000 ⇒ เดือน/วันที่มีการนับจริงหาย
 *    จาก dropdown โดยไม่มีอะไรเตือน (นี่คือรากของ M1)
 *
 * แยกออกมาเป็นไฟล์ร่วมเพราะเดิมมีโค้ดชุดนี้อยู่ 2 ที่ (`reconcile-shared.js` กับ
 * `audit_check.html`) เกือบบรรทัดต่อบรรทัด ⇒ แก้บั๊กตัวเดียวกันต้องแก้ 2 รอบตลอดไป (M34)
 *
 * ต้องโหลด **ก่อน** `reconcile-shared.js` (ตัวนั้น re-export ฟังก์ชันในนี้ต่อ)
 */
(function () {
    'use strict';

    const PAGE = 1000;
    const MISSING_RPC = /get_inventory_count_months|function.*does not exist/i;

    function getClient() {
        return window.apiService?.getClient?.() || null;
    }

    /** 'YYYY-MM-DD' ตามเวลาไทยของ timestamp หนึ่ง ๆ */
    function bangkokYmdOf(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    }

    /** ช่วงเวลาของเดือน 'YYYY-MM' เป็น ISO (ครอบคลุมเวลาไทย) */
    function monthRangeISO(yearMonth) {
        const m = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || '').trim());
        if (!m) return null;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        if (mo < 1 || mo > 12) return null;
        // เวลาไทย = UTC+7 จึงเริ่มนับตั้งแต่ 17:00 UTC ของวันก่อนหน้า
        const start = new Date(Date.UTC(y, mo - 1, 1, -7, 0, 0));
        const end = new Date(Date.UTC(y, mo, 1, -7, 0, 0));
        return { start: start.toISOString(), end: end.toISOString() };
    }

    /**
     * ใส่ตัวกรองคลัง — รองรับทั้งชื่อคลังเดี่ยว, ว่าง (= ทุกคลัง) และค่า encode 'A|B'
     * ใช้ `reconcileService` ถ้ามี (หน้าที่โหลดมัน) ไม่งั้นถือว่าเป็นชื่อคลังเดี่ยว
     */
    function applyWarehouse(query, warehouse) {
        const RS = window.reconcileService;
        if (RS?.applyWarehouseFilterValue) return RS.applyWarehouseFilterValue(query, warehouse);
        const wh = String(warehouse ?? '').trim();
        return wh ? query.eq('warehouse', wh) : query;
    }

    /** แตกค่าคลังเป็นรายชื่อคลังจริง — คืน null แปลว่า "ทุกคลัง" */
    function warehouseList(warehouse) {
        const RS = window.reconcileService;
        if (RS?.parseCycleWarehouses) return RS.parseCycleWarehouses(warehouse);
        const wh = String(warehouse ?? '').trim();
        return wh ? [wh] : null;
    }

    /**
     * เดือนที่มีข้อมูลการนับจริง เรียงใหม่→เก่า
     *
     * ใช้ RPC `get_inventory_count_months` (013) ก่อน — คำนวณฝั่ง DB จึงไม่ติดเพดานแถว
     * ⚠️ RPC เทียบ `warehouse = p_warehouse` ตรง ๆ จึงรับได้แค่ **ชื่อคลังจริงตัวเดียว**
     *    ค่าที่ call site ส่งมาอาจเป็นค่า encode ('คลังทั้งหมด' / 'A|B') ถ้ายัดเข้าไปดิบ ๆ
     *    จะไม่ match อะไรเลย = ได้ 0 เดือนทั้งที่มีข้อมูลเป็นหมื่นแถว
     */
    async function fetchCountMonths(warehouse) {
        const client = getClient();
        if (!client) return [];

        const list = warehouseList(warehouse);            // null = ทุกคลัง
        const targets = list?.length ? list : [null];
        const results = await Promise.all(targets.map(wh =>
            client.rpc('get_inventory_count_months', { p_warehouse: wh })
        ));
        if (results.every(r => !r.error && Array.isArray(r.data))) {
            const months = new Set();
            results.forEach(r => r.data.forEach(row => {
                const ym = row.year_month || row;
                if (ym) months.add(ym);
            }));
            return [...months].sort().reverse();
        }
        const fatal = results.find(r => r.error && !MISSING_RPC.test(r.error.message || ''));
        if (fatal) throw fatal.error;

        const months = new Set();
        let from = 0;
        while (true) {
            let q = client.from('inventory_counts').select('created_at')
                .order('created_at', { ascending: false })
                .order('id', { ascending: false });       // invariant ข้อ 13
            q = applyWarehouse(q, warehouse);
            const { data, error } = await q.range(from, from + PAGE - 1);
            if (error) throw error;
            const rows = data || [];
            rows.forEach(r => {
                const ym = bangkokYmdOf(r.created_at)?.slice(0, 7);
                if (ym) months.add(ym);
            });
            // เดินหน้าตาม "จำนวนแถวที่ได้จริง" ไม่ใช่ขนาดหน้าที่ขอ — ถ้า PostgREST ตั้ง
            // max-rows ต่ำกว่า PAGE การบวกทีละ PAGE จะข้ามแถวกลางหายเงียบ ๆ
            if (!rows.length) break;
            from += rows.length;
        }
        return [...months].sort().reverse();
    }

    /**
     * วันที่ (DD) ที่มีข้อมูลการนับจริงในเดือนนั้น — แบ่งหน้าเสมอ
     * ไม่มี RPC สำหรับ "วัน" จึงต้องไล่อ่าน แต่ต้องไล่ให้ครบ ไม่ใช่ตัดที่ limit เดียว
     */
    async function fetchCountDaysInMonth(warehouse, yearMonth) {
        const client = getClient();
        const range = window.reconcileService?.yearMonthToRangeISO?.(yearMonth) || monthRangeISO(yearMonth);
        if (!client || !range) return [];

        const days = new Set();
        let from = 0;
        while (true) {
            let q = client.from('inventory_counts').select('created_at')
                .gte('created_at', range.start)
                .lt('created_at', range.end)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true });
            q = applyWarehouse(q, warehouse);
            const { data, error } = await q.range(from, from + PAGE - 1);
            if (error) throw error;
            const rows = data || [];
            rows.forEach(r => {
                const ymd = bangkokYmdOf(r.created_at);
                if (ymd && ymd.slice(0, 7) === yearMonth) days.add(ymd.slice(8, 10));
            });
            // ครบทุกวันของเดือนแล้ว ไม่ต้องอ่านต่อ
            if (days.size >= 31 || !rows.length) break;
            from += rows.length;
        }
        return [...days].sort();
    }

    window.countScanService = {
        PAGE,
        bangkokYmdOf,
        monthRangeISO,
        fetchCountMonths,
        fetchCountDaysInMonth
    };
})();
