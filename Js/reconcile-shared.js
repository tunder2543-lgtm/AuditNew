// =============================================================================

//  Reconcile / Count Cycle — Shared helpers

//  กฎ: ห้าม UPDATE inventory_counts.counted_qty จาก module นี้

// =============================================================================



(function () {

    const ACTIVE_CYCLE_KEY = 'active_count_cycle_v1';

    const ALL_WAREHOUSES = 'คลังทั้งหมด';

    const WAREHOUSE_MULTI_SEP = '|';

    let STANDARD_WAREHOUSES = ['ตึกกันตนา', 'หน้าไลฟ์(บางกรวย)', 'คลังอะไหล่'];

    const BOOK_CHUNK = 200;

    /** แบ่ง skuIds เป็น chunk สำหรับ .in() — ลด URL/query ใหญ่เกิน */
    function uniqueSkuIds(skuIds) {
        return [...new Set((skuIds || []).map(normalizeSku).filter(Boolean))];
    }

    const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    const ALLOWED_ADJUSTMENT_REASONS = new Set(['reconcile', 'manual', 'damage', 'found', 'other']);



    /** ค่า reason ที่ DB รองรับ — แปลง accept_count / ค่าผิดเป็น manual */
    function normalizeAdjustmentReason(reason) {
        const r = String(reason || 'manual').trim().toLowerCase();
        if (ALLOWED_ADJUSTMENT_REASONS.has(r)) return r;
        if (r === 'accept_count' || r === 'accept-count') return 'manual';
        return 'manual';
    }



    function getClient() {

        return window.apiService?.getClient?.() || null;

    }



    function escapeHtml(value) {

        return String(value ?? '')

            .replace(/&/g, '&amp;')

            .replace(/</g, '&lt;')

            .replace(/>/g, '&gt;')

            .replace(/"/g, '&quot;')

            .replace(/'/g, '&#39;');

    }



    function normalizeSku(value) {

        // ใช้ shared utility (UPPERCASE + trim) เพื่อความสอดคล้องทั้งระบบ

        if (typeof window !== 'undefined' && window.SkuUtils?.normalizeSku) {

            return window.SkuUtils.normalizeSku(value);

        }

        return String(value ?? '').trim().toUpperCase();

    }



    function parseYearMonth(value) {

        const m = String(value ?? '').trim().match(/^(\d{4})-(\d{2})$/);

        if (!m) return null;

        const y = Number(m[1]);

        const mo = Number(m[2]);

        if (mo < 1 || mo > 12) return null;

        return { year: y, month: mo, yearMonth: `${m[1]}-${m[2]}` };

    }



    function isAllWarehousesCycle(cycleOrWarehouse) {

        const wh = typeof cycleOrWarehouse === 'string'

            ? cycleOrWarehouse

            : cycleOrWarehouse?.warehouse;

        return String(wh ?? '').trim() === ALL_WAREHOUSES;

    }



    /** คลังในรอบ — null = ทุกคลัง (คลังทั้งหมด), array = คลังเดียวหรือหลายคลัง */

    function parseCycleWarehouses(cycleOrWarehouse) {

        const raw = typeof cycleOrWarehouse === 'string'

            ? cycleOrWarehouse

            : cycleOrWarehouse?.warehouse;

        const wh = String(raw ?? '').trim();

        if (!wh || isAllWarehousesCycle(wh)) return null;

        if (wh.includes(WAREHOUSE_MULTI_SEP)) {

            return wh.split(WAREHOUSE_MULTI_SEP).map(s => s.trim()).filter(Boolean);

        }

        return [wh];

    }



    /**
     * รวมชุดคลังเป็นสตริงเดียวสำหรับเก็บใน `count_cycles.warehouse`
     *
     * ⚠️ ต้อง **เสถียร**: ชุดคลังเดียวกันต้องได้สตริงเดียวกันเสมอ ไม่ว่าจะส่งมาลำดับไหน
     * เพราะ DB มองความซ้ำของรอบจากสตริงนี้ตรง ๆ — ถ้าไม่เสถียร "A|B" กับ "B|A"
     * จะกลายเป็น 2 รอบแยกกัน แล้วผลนับกระจายคนละรอบ Match เพี้ยนทั้งคู่ (M19)
     *
     * เดิมคลังที่ไม่อยู่ใน STANDARD_WAREHOUSES ถูก map เป็น 99 เท่ากันหมด ⇒ comparator
     * คืน 0 ⇒ Array.sort ของ V8 เสถียร จึงคงลำดับ input ไว้ = ไม่เสถียรในเชิงชุด
     *
     * ลำดับคลังมาตรฐานยังยึดตาม registry เหมือนเดิม (ห้ามเปลี่ยน — รอบเก่าใน DB
     * เก็บสตริงตามลำดับนั้นอยู่ ถ้าสลับจะกลายเป็นสร้างรอบซ้ำเสียเอง)
     * ที่เพิ่มคือ tiebreak ด้วยชื่อสำหรับคลังนอกรายการ + ตัดชื่อซ้ำทิ้ง
     */
    function encodeCycleWarehouses(warehouses) {
        if (!warehouses?.length) return ALL_WAREHOUSES;
        const unique = [...new Set(warehouses.map(w => String(w ?? '').trim()).filter(Boolean))];
        if (!unique.length) return ALL_WAREHOUSES;
        const sorted = unique.sort((a, b) => {
            const ia = STANDARD_WAREHOUSES.indexOf(a);
            const ib = STANDARD_WAREHOUSES.indexOf(b);
            if (ia >= 0 && ib >= 0) return ia - ib;      // มาตรฐานทั้งคู่ → ตาม registry
            if (ia >= 0) return -1;                       // มาตรฐานมาก่อนเสมอ
            if (ib >= 0) return 1;
            return a.localeCompare(b, 'th');              // นอกรายการทั้งคู่ → เรียงตามชื่อ
        });

        if (sorted.length === 1) return sorted[0];

        return sorted.join(WAREHOUSE_MULTI_SEP);

    }

    async function refreshStandardWarehousesFromRegistry() {
        try {
            const list = await window.warehouseService?.getWarehouseList?.({ force: true }) || [];
            if (list.length) {
                STANDARD_WAREHOUSES = [...list];
            }
        } catch (err) {
            console.warn('[ReconcileShared] load warehouse registry failed:', err?.message || err);
        }
        return STANDARD_WAREHOUSES;
    }



    function formatWarehouseDisplay(cycleOrWarehouse) {

        if (isAllWarehousesCycle(cycleOrWarehouse)) return ALL_WAREHOUSES;

        const list = parseCycleWarehouses(cycleOrWarehouse);

        if (!list?.length) return ALL_WAREHOUSES;

        if (list.length === 1) return list[0];

        return list.join(' + ');

    }



    function warehouseMatchesCycle(cycle, warehouse) {

        const wh = String(warehouse ?? '').trim();

        if (!wh) return false;

        if (isAllWarehousesCycle(cycle)) return true;

        const list = parseCycleWarehouses(cycle);

        return list ? list.includes(wh) : false;

    }



    function cycleMatchesWarehouseFilter(cycle, filterWh) {

        const f = String(filterWh ?? '').trim();

        if (!f) return true;

        if (f === ALL_WAREHOUSES) return isAllWarehousesCycle(cycle);

        return warehouseMatchesCycle(cycle, f);

    }



    function applyWarehouseFilter(query, cycle) {

        if (isAllWarehousesCycle(cycle)) return query;

        const list = parseCycleWarehouses(cycle);

        if (!list?.length) return query;

        if (list.length === 1) return query.eq('warehouse', list[0]);

        return query.in('warehouse', list);

    }



    function applyWarehouseFilterValue(query, warehouseValue) {

        if (!warehouseValue || isAllWarehousesCycle(warehouseValue)) return query;

        const list = parseCycleWarehouses(warehouseValue);

        if (!list?.length) return query;

        if (list.length === 1) return query.eq('warehouse', list[0]);

        return query.in('warehouse', list);

    }



    /** ช่วงเวลา created_at ตามปฏิทินไทย (+07:00) — ทั้งเดือน */

    function yearMonthToRangeISO(yearMonth) {

        const parsed = parseYearMonth(yearMonth);

        if (!parsed) return null;

        const { year, month } = parsed;

        const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00+07:00`;

        let endYear = year;

        let endMonth = month + 1;

        if (endMonth > 12) {

            endMonth = 1;

            endYear += 1;

        }

        const end = `${endYear}-${String(endMonth).padStart(2, '0')}-01T00:00:00+07:00`;

        return { start, end };

    }



    /** แปลง YYYY-MM-DD → ISO start/end ของวันนั้น (+07) */

    function dateToBangkokStartISO(dateStr) {

        const m = String(dateStr ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (!m) return null;

        return `${m[1]}-${m[2]}-${m[3]}T00:00:00+07:00`;

    }



    function dateToBangkokEndExclusiveISO(dateStr) {

        const m = String(dateStr ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (!m) return null;

        const y = Number(m[1]);

        const mo = Number(m[2]);

        const d = Number(m[3]);

        const dt = new Date(Date.UTC(y, mo - 1, d + 1));

        const ey = dt.getUTCFullYear();

        const em = String(dt.getUTCMonth() + 1).padStart(2, '0');

        const ed = String(dt.getUTCDate()).padStart(2, '0');

        return `${ey}-${em}-${ed}T00:00:00+07:00`;

    }



    /** แปลง TIMESTAMPTZ → YYYY-MM-DD ตามปฏิทินไทย (+07) */

    function isoToBangkokYmd(iso) {

        const parts = new Intl.DateTimeFormat('en-CA', {

            timeZone: 'Asia/Bangkok',

            year: 'numeric', month: '2-digit', day: '2-digit'

        }).formatToParts(new Date(iso));

        const get = t => parts.find(p => p.type === t)?.value || '';

        return `${get('year')}-${get('month')}-${get('day')}`;

    }



    function bangkokYmdMinusOneDay(ymd) {

        const dt = new Date(`${ymd}T12:00:00+07:00`);

        dt.setDate(dt.getDate() - 1);

        return isoToBangkokYmd(dt.toISOString());

    }



    /** สร้าง TIMESTAMPTZ สำหรับ count_start_at / count_end_at จาก input date */

    function buildCycleTimestamps({ year_month, count_start_date, count_end_date }) {

        if (!count_start_date || !count_end_date) {

            return { count_start_at: null, count_end_at: null };

        }

        const startISO = dateToBangkokStartISO(count_start_date);

        const endISO = dateToBangkokEndExclusiveISO(count_end_date);

        if (!startISO || !endISO) {

            throw new Error('รูปแบบวันที่ไม่ถูกต้อง (ใช้ YYYY-MM-DD)');

        }

        if (startISO >= endISO) {

            throw new Error('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');

        }

        const ym = parseYearMonth(year_month);

        if (!ym) throw new Error('รูปแบบปี-เดือนไม่ถูกต้อง');

        const monthPrefix = `${ym.year}-${String(ym.month).padStart(2, '0')}`;

        if (!count_start_date.startsWith(monthPrefix) || !count_end_date.startsWith(monthPrefix)) {

            throw new Error(`วันที่ต้องอยู่ในเดือน ${monthPrefix}`);

        }

        return {

            count_start_at: startISO,

            count_end_at: endISO

        };

    }

    /** ช่วงผูกผลนับ — ใช้ count_start/end ถ้ามี ไม่งั้นเต็มเดือน */

    function getCycleLinkRange(cycle) {

        if (cycle?.count_start_at && cycle?.count_end_at) {

            return {

                start: cycle.count_start_at,

                end: cycle.count_end_at,

                isDateRange: true

            };

        }

        const range = yearMonthToRangeISO(cycle?.year_month);

        if (!range) return null;

        return { ...range, isDateRange: false };

    }



    function formatDateRangeLabel(cycle) {

        if (!cycle?.count_start_at || !cycle?.count_end_at) return 'ทั้งเดือน';

        const start = isoToBangkokYmd(cycle.count_start_at);

        const endExclusiveBangkok = isoToBangkokYmd(cycle.count_end_at);

        const end = bangkokYmdMinusOneDay(endExclusiveBangkok);

        const fmt = (iso) => {

            const [, m, d] = iso.split('-');

            return `${Number(d)} ${THAI_MONTHS_SHORT[Number(m) - 1]}`;

        };

        if (start === end) return fmt(start);

        return `${fmt(start)}–${fmt(end)}`;

    }



    function getActiveCycle() {

        try {

            const raw = localStorage.getItem(ACTIVE_CYCLE_KEY);

            if (!raw) return null;

            const obj = JSON.parse(raw);

            if (!obj?.id || !obj?.warehouse || !obj?.year_month) return null;

            return obj;

        } catch {

            return null;

        }

    }



    function setActiveCycle(cycle) {

        if (!cycle?.id) return false;

        localStorage.setItem(ACTIVE_CYCLE_KEY, JSON.stringify({

            id: cycle.id,

            warehouse: cycle.warehouse,

            year_month: cycle.year_month,

            label: cycle.label || '',

            status: cycle.status || 'open',

            count_start_at: cycle.count_start_at || null,

            count_end_at: cycle.count_end_at || null

        }));

        return true;

    }



    function clearActiveCycle() {

        localStorage.removeItem(ACTIVE_CYCLE_KEY);

    }



    /** YYYY-MM ของ "ตอนนี้" ตามปฏิทินไทย (+07) */
    function bangkokYearMonthNow(now) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit'
        }).formatToParts(now instanceof Date ? now : new Date());
        const get = t => parts.find(p => p.type === t)?.value || '';
        return `${get('year')}-${get('month')}`;
    }

    /**
     * รอบนี้ยังใช้แนบกับผลนับที่บันทึก "ตอนนี้" ได้หรือไม่ — ผ่านข้อใดข้อหนึ่ง:
     *   1) year_month ของรอบ = เดือนปัจจุบัน (รองรับการกรอกย้อนหลังไม่กี่วันในเดือนเดียวกัน
     *      แม้ช่วงวันของรอบจะจบไปแล้ว)
     *   2) เวลาปัจจุบันอยู่ในช่วง count_start_at..count_end_at (รองรับรอบที่คร่อมเดือน)
     * กันเคส active cycle ของเดือนเก่าค้างใน localStorage แล้วถูกแนบให้ผลนับเดือนใหม่
     */
    /** สถานะที่ถือว่า "ปิดรับผลนับแล้ว" — ห้ามแนบ cycle_id ให้แถวใหม่ (M24) */
    const CLOSED_CYCLE_STATUSES = ['closed', 'archived'];

    function isCycleClosed(cycle) {
        return CLOSED_CYCLE_STATUSES.includes(String(cycle?.status ?? '').trim().toLowerCase());
    }

    function isCycleRelevantNow(cycle, now) {
        if (!cycle) return false;
        // ⚠️ รอบที่ปิดแล้วต้องไม่รับผลนับใหม่ แม้จะยังอยู่ในเดือนปัจจุบัน — ไม่งั้นข้อมูล
        //    ไหลเข้ารอบที่ reconcile/ปรับยอดไปแล้ว ทำให้ยอดที่สรุปไปแล้วเปลี่ยนย้อนหลัง (M24)
        if (isCycleClosed(cycle)) return false;
        const at = now instanceof Date ? now : new Date();
        if (cycle.year_month && cycle.year_month === bangkokYearMonthNow(at)) return true;
        const range = getCycleLinkRange(cycle);
        if (!range?.start || !range?.end) return false;
        const start = new Date(range.start).getTime();
        const end = new Date(range.end).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) return false;
        const t = at.getTime();
        return t >= start && t < end;
    }

    function getCycleIdForWarehouse(warehouse, opts = {}) {

        const wh = String(warehouse ?? '').trim();

        const active = getActiveCycle();

        if (!active || !wh) return null;

        if (!isCycleRelevantNow(active, opts.now)) return null;

        if (isAllWarehousesCycle(active)) return active.id;

        if (warehouseMatchesCycle(active, wh)) return active.id;

        return null;

    }



    function attachCycleToPayload(payload, warehouse, opts = {}) {

        const cycleId = getCycleIdForWarehouse(warehouse, opts);

        if (!cycleId) return payload;

        return { ...payload, cycle_id: cycleId };

    }



    async function checkSchemaReady(client) {

        const c = client || getClient();

        if (!c) return { ok: false, message: 'ยังไม่ได้เชื่อมต่อ Supabase' };

        try {

            const { error } = await c.from('count_cycles').select('id').limit(1);

            if (error) {

                if (/does not exist|relation|schema cache/i.test(error.message)) {

                    return {

                        ok: false,

                        message: 'ยังไม่มีตาราง count_cycles — รัน docs/sql/002_reconciliation_schema.sql ใน Supabase ก่อน'

                    };

                }

                return { ok: false, message: error.message };

            }

            return { ok: true };

        } catch (err) {

            return { ok: false, message: err.message };

        }

    }



    async function fetchCycles(warehouse) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        let query = client

            .from('count_cycles')

            .select('*')

            .order('year_month', { ascending: false })

            .order('warehouse', { ascending: true })

            .order('count_start_at', { ascending: true, nullsFirst: true });



        const { data, error } = await query;

        if (error) throw error;

        let rows = data || [];

        if (warehouse) {

            rows = rows.filter(c => cycleMatchesWarehouseFilter(c, warehouse));

        }

        return rows;

    }



    async function fetchCycleById(cycleId) {

        const client = getClient();

        const { data, error } = await client

            .from('count_cycles')

            .select('*')

            .eq('id', cycleId)

            .maybeSingle();

        if (error) throw error;

        return data;

    }



    async function createCycle({ warehouse, year_month, label, status, notes, count_start_at, count_end_at, count_start_date, count_end_date }) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const wh = String(warehouse ?? '').trim();

        if (!wh) throw new Error('กรุณาเลือกคลัง');



        const ym = parseYearMonth(year_month);

        if (!ym) throw new Error('รูปแบบปี-เดือนไม่ถูกต้อง (ใช้ YYYY-MM)');



        let startAt = count_start_at || null;

        let endAt = count_end_at || null;



        if (count_start_date || count_end_date) {

            const ts = buildCycleTimestamps({

                year_month: ym.yearMonth,

                count_start_date: count_start_date,

                count_end_date: count_end_date

            });

            startAt = ts.count_start_at;

            endAt = ts.count_end_at;

        }



        if (isAllWarehousesCycle(wh) && (!startAt || !endAt)) {

            throw new Error('รอบ "คลังทั้งหมด" ต้องกำหนดวันที่เริ่มและสิ้นสุด');

        }



        const payload = {

            warehouse: wh,

            year_month: ym.yearMonth,

            label: (label || '').trim() || null,

            status: status || 'open',

            notes: (notes || '').trim() || null,

            count_start_at: startAt,

            count_end_at: endAt,

            updated_at: new Date().toISOString()

        };



        const { data, error } = await client

            .from('count_cycles')

            .insert([payload])

            .select('*')

            .single();



        if (error) {

            if (/duplicate|unique/i.test(error.message)) {

                const rangeHint = startAt ? ` · ${formatDateRangeLabel(payload)}` : '';

                throw new Error(`มีรอบ ${payload.warehouse} · ${payload.year_month}${rangeHint} อยู่แล้ว`);

            }

            throw error;

        }

        return data;

    }



    async function updateCycleWarehouses(cycleId, warehouse) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const wh = String(warehouse ?? '').trim();

        if (!wh) throw new Error('กรุณาเลือกคลัง');



        const { data, error } = await client

            .from('count_cycles')

            .update({ warehouse: wh, updated_at: new Date().toISOString() })

            .eq('id', cycleId)

            .select('*')

            .single();



        if (error) {

            if (/duplicate|unique/i.test(error.message)) {

                throw new Error(`มีรอบคลัง/เดือน/ช่วงวันที่นี้อยู่แล้ว — ลองเปลี่ยนชุดคลังหรือช่วงวันที่`);

            }

            throw error;

        }

        return data;

    }



    /** วันเริ่ม/สิ้นสุด (YYYY-MM-DD ไทย) สำหรับแก้ไข UI — null = ทั้งเดือน */

    function getCycleEditDates(cycle) {

        if (!cycle?.count_start_at || !cycle?.count_end_at) {

            return { start: null, end: null };

        }

        const start = isoToBangkokYmd(cycle.count_start_at);

        const endExclusive = isoToBangkokYmd(cycle.count_end_at);

        return { start, end: bangkokYmdMinusOneDay(endExclusive) };

    }



    async function updateCycleDateRange(cycleId, { count_start_date, count_end_date }) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const cycle = await fetchCycleById(cycleId);

        if (!cycle) throw new Error('ไม่พบรอบ');



        let startAt = null;

        let endAt = null;



        if (count_start_date || count_end_date) {

            if (!count_start_date || !count_end_date) {

                throw new Error('กรุณาเลือกทั้งวันเริ่มและวันสิ้นสุด (หรือเว้นทั้งคู่ = ทั้งเดือน)');

            }

            const ts = buildCycleTimestamps({

                year_month: cycle.year_month,

                count_start_date,

                count_end_date

            });

            startAt = ts.count_start_at;

            endAt = ts.count_end_at;

        }



        if (isAllWarehousesCycle(cycle.warehouse) && (!startAt || !endAt)) {

            throw new Error('รอบ "คลังทั้งหมด" ต้องกำหนดช่วงวันที่เริ่มและสิ้นสุด');

        }



        const { data, error } = await client

            .from('count_cycles')

            .update({

                count_start_at: startAt,

                count_end_at: endAt,

                updated_at: new Date().toISOString()

            })

            .eq('id', cycleId)

            .select('*')

            .single();



        if (error) {

            if (/duplicate|unique/i.test(error.message)) {

                throw new Error('มีรอบช่วงวันที่นี้ในคลัง/เดือนเดียวกันอยู่แล้ว — ลองเปลี่ยนช่วงวัน');

            }

            throw error;

        }



        const active = getActiveCycle();

        if (active?.id === data.id) setActiveCycle(data);



        return data;

    }



    /** ลบรอบ — Book/Match/adjustments ถูกลบตาม CASCADE; ผลนับคงอยู่ (cycle_id = null) */

    async function deleteCycle(cycleId) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        if (!cycleId) throw new Error('ไม่พบรอบที่จะลบ');



        const cycle = await fetchCycleById(cycleId);

        if (!cycle) throw new Error('ไม่พบรอบนี้ในระบบ');



        const preservedCountRows = await countLinkedInventory(cycleId);



        const { error: unlinkErr } = await client

            .from('inventory_counts')

            .update({ cycle_id: null })

            .eq('cycle_id', cycleId);

        if (unlinkErr) throw unlinkErr;



        const { error } = await client

            .from('count_cycles')

            .delete()

            .eq('id', cycleId);

        if (error) throw error;



        const active = getActiveCycle();

        if (active?.id === cycleId) clearActiveCycle();



        return { cycle, preservedCountRows };

    }



    /**
     * รวมแถว validRows ที่ SKU ซ้ำกันเป็น 1 แถวต่อรหัส (qty รวม, namePro เอาแถวแรก)
     * คืน array ใหม่เรียงตาม rowNo แรกสุดของแต่ละ SKU
     */
    function aggregateBookRowsBySku(validItems) {
        const byKey = new Map();
        (validItems || []).forEach(r => {
            const key = normalizeSku(r.sku);
            if (!key) return;
            const existing = byKey.get(key);
            if (!existing) {
                byKey.set(key, {
                    rowNo: r.rowNo,
                    sku: r.sku,
                    qty: Number(r.qty) || 0,
                    namePro: r.namePro || '',
                    valid: true,
                    error: '',
                    mergedFrom: 1
                });
                return;
            }
            existing.qty += Number(r.qty) || 0;
            existing.mergedFrom = (existing.mergedFrom || 1) + 1;
            if (!existing.namePro && r.namePro) existing.namePro = r.namePro;
            if (r.rowNo < existing.rowNo) existing.rowNo = r.rowNo;
        });
        return Array.from(byKey.values());
    }

    /** อ่านไฟล์ Excel แผ่นแรกเป็น array of rows (ใช้ XLSX ที่โหลดใน window) */
    async function readBookExcelSheetRows(file) {
        if (!file) throw new Error('ไม่พบไฟล์');
        const buf = await file.arrayBuffer();
        const XLSX_ = window.XLSX;
        if (!XLSX_) throw new Error('XLSX library ไม่พร้อม');
        const wb = XLSX_.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        return XLSX_.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    }

    /**
     * สถานะ Match จากตัวเลข — ใช้ร่วมกันระหว่าง UI และ preview Import
     * ส่ง { bookQty, adjustmentTotal, countedQty, hasCountRecord, inBookSkuSet }
     */
    function computeMatchStatus({
        bookQty = 0,
        adjustmentTotal = 0,
        countedQty = 0,
        hasCountRecord = true,
        inBookSkuSet = true,
        fallbackStatus = null
    } = {}) {
        const EPS = 1e-6;
        const b = Number(bookQty) || 0;
        const c = Number(countedQty) || 0;
        const a = Number(adjustmentTotal) || 0;
        const effective = b + a;

        if (effective === 0 && c > 0) {
            return inBookSkuSet ? 'over' : 'count_only';
        }
        if (effective > 0 && c === 0 && !hasCountRecord) return 'book_only';
        if (Math.abs(effective - c) < EPS) return 'match';
        if (c < effective) return 'short';
        if (c > effective) return 'over';
        return fallbackStatus || 'match';
    }



    function parseBookExcelRows(sheetRows) {

        const items = [];

        const skuTotals = new Map();



        for (let i = 0; i < sheetRows.length; i++) {

            const row = sheetRows[i];

            const sku = normalizeSku(row[0] ?? row['sku'] ?? row['SKU'] ?? row['รหัส'] ?? '');

            const qtyRaw = row[1] ?? row['qty'] ?? row['จำนวน'] ?? row['book_qty'] ?? '';

            // ⚠️ ห้ามใช้ normalizeSku กับชื่อสินค้า — มันเป็น UPPERCASE ซึ่งเป็นมาตรฐานของ "รหัส"
            // ไม่ใช่ของ "ชื่อ" (invariant ข้อ 2 พูดถึง SKU เท่านั้น) · ชื่อต้องคงตัวพิมพ์เดิมไว้
            const namePro = String(row[2] ?? row['name'] ?? row['ชื่อ'] ?? '').trim();



            if (!sku && (qtyRaw === '' || qtyRaw == null)) continue;

            if (/^(sku|รหัส|#|คอลัมน์)/i.test(sku)) continue;



            if (!sku) {

                items.push({ rowNo: i + 1, sku: '', qty: null, namePro, valid: false, error: 'ไม่มี SKU' });

                continue;

            }



            const qty = qtyRaw === '' || qtyRaw == null ? NaN : Number(qtyRaw);

            if (Number.isNaN(qty) || !Number.isFinite(qty) || qty < 0) {

                items.push({ rowNo: i + 1, sku, qty: null, namePro, valid: false, error: 'จำนวนไม่ถูกต้อง' });

                continue;

            }



            const floored = Math.floor(qty);

            items.push({ rowNo: i + 1, sku, qty: floored, namePro, valid: true, error: '' });



            const key = sku;

            skuTotals.set(key, (skuTotals.get(key) || 0) + floored);

        }



        const duplicates = [];

        skuTotals.forEach((total, key) => {

            const rows = items.filter(r => r.valid && r.sku === key);

            if (rows.length > 1) {

                duplicates.push({ sku: rows[0].sku, rows: rows.length, total });

            }

        });



        const rawValidRows = items.filter(r => r.valid);

        return {

            rows: items,

            validRows: aggregateBookRowsBySku(rawValidRows),

            rawValidRows,

            invalidRows: items.filter(r => !r.valid),

            duplicateSkus: duplicates

        };

    }



    async function countBookLines(cycleId) {

        const client = getClient();

        const { count, error } = await client

            .from('book_stock_lines')

            .select('id', { count: 'exact', head: true })

            .eq('cycle_id', cycleId);

        if (error) throw error;

        return count || 0;

    }



    /** ลบรายการ Book ตาม SKU (ทุก location) + ปรับยอดของ SKU นั้น แล้วรีเฟรช Match */

    async function deleteBookStockBySku(cycleId, skuId) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const sku = normalizeSku(skuId);

        if (!sku) throw new Error('SKU ไม่ถูกต้อง');



        const { data: bookRows, error: selErr } = await client

            .from('book_stock_lines')

            .select('id')

            .eq('cycle_id', cycleId)

            .eq('sku_id', sku);

        if (selErr) throw selErr;

        if (!bookRows?.length) {

            throw new Error(`ไม่พบรายการ Book สำหรับ ${sku}`);

        }



        // ลบยอดปรับของ SKU นี้ด้วย — ต้อง log ก่อนลบเหมือนกับตอน Import (docs/ISSUES.md H6)

        // และต้องอยู่ **ก่อน** ลบ book_stock_lines ด้วย ไม่งั้นถ้า log พังจะได้สภาพ

        // "Book หายแล้ว แต่ยอดปรับยังอยู่ และไม่ได้ refresh" ซึ่งย้อนกลับไม่ได้

        const { data: doomedAdj, error: adjSelErr } = await client

            .from('stock_adjustments')

            .select('id, sku_id, status, adjustment_qty, reason, note')

            .eq('cycle_id', cycleId)

            .eq('sku_id', sku);

        if (adjSelErr) throw adjSelErr;

        const adjLog = await logAdjustmentsBeforeDelete(client, cycleId, doomedAdj || [], { source: 'reconcile_delete_book' });



        const { error: bookDelErr } = await client

            .from('book_stock_lines')

            .delete()

            .eq('cycle_id', cycleId)

            .eq('sku_id', sku);

        if (bookDelErr) {

            await rollbackAuditEntries(client, adjLog.writtenIds);

            throw bookDelErr;

        }



        const { error: adjDelErr } = await client

            .from('stock_adjustments')

            .delete()

            .eq('cycle_id', cycleId)

            .eq('sku_id', sku);

        if (adjDelErr) {

            // Book ถูกลบไปแล้วย้อนไม่ได้ แต่ยอดปรับยังอยู่ — log จึงเป็นเท็จ ต้องถอนทิ้ง

            await rollbackAuditEntries(client, adjLog.writtenIds);

            throw adjDelErr;

        }



        await refreshReconciliation(cycleId);



        return { sku, deletedBookRows: bookRows.length };

    }



    /** ชุด SKU ที่มีแถวใน book_stock_lines ของรอบนี้แล้ว */

    async function fetchBookSkuIds(cycleId) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const set = new Set();

        let from = 0;

        const PAGE = 1000;



        while (true) {

            const to = from + PAGE - 1;

            const { data, error } = await client

                .from('book_stock_lines')

                .select('sku_id')

                .eq('cycle_id', cycleId)

                .order('id', { ascending: true })

                .range(from, to);

            if (error) throw error;

            const chunk = data || [];

            chunk.forEach(r => {

                const sku = normalizeSku(r.sku_id);

                if (sku) set.add(sku);

            });

            if (chunk.length < PAGE) break;

            from += PAGE;

        }



        return set;

    }



    async function bookSkuExists(cycleId, skuId) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        const sku = normalizeSku(skuId);

        if (!sku) return false;



        const { data, error } = await client

            .from('book_stock_lines')

            .select('id')

            .eq('cycle_id', cycleId)

            .eq('sku_id', sku)

            .limit(1);

        if (error) throw error;

        return !!(data && data.length);

    }



    function buildBookInsertPayload(cycleId, skuId, namePro) {

        return {

            cycle_id: cycleId,

            sku_id: String(skuId).trim(),

            location: null,

            book_qty: 0,

            name_pro: namePro ? String(namePro).trim() : null,

            row_no: null

        };

    }



    /**

     * ชื่อสินค้าจาก book_stock_lines ของ "ทุกรอบ" — ใช้เติม name_pro ตอนสร้างแถว Book

     * จาก count_only (SKU ที่นับเจอแต่ไม่มีใน Book ของรอบนี้)

     *

     * แทนที่ fetchSkuMasterNamesBySkus เดิมที่อ่านจากตาราง sku_master — ถอดฟีเจอร์

     * SKU Master ออกจากเว็บ 2026-08-10 (ตารางยังอยู่ในฐาน แต่ไม่มีโค้ดใดเรียกอีก)

     * แหล่งใหม่กว้างกว่าเดิม เป็นคอลัมน์ความหมายเดียวกัน (name_pro -> name_pro)

     *

     * จงใจ **ไม่กรองคลังและไม่กรองรอบ** — ชื่อสินค้าไม่ขึ้นกับคลัง และเป้าหมายคือหาชื่อ

     * จากรอบไหนก็ได้ที่เคยมี (SKU ที่กดปุ่มได้คือ SKU ที่ไม่อยู่ใน Book ของรอบปัจจุบัน)

     * หมายเหตุ: `book_stock_lines` ไม่มีคอลัมน์ warehouse อยู่แล้ว — คลังผูกที่ `count_cycles`

     *

     * เรียง created_at DESC + id DESC แล้วเก็บตัวแรก = ชื่อจากรอบล่าสุดเสมอ

     * (`.order('id')` เป็น tiebreak บังคับตาม invariant ข้อ 13 เพราะมี `.range()`)

     */

    async function fetchBookNamesBySkusAnyCycle(skus) {

        const client = getClient();

        const map = {};

        if (!client || !skus?.length) return map;



        const unique = [...new Set(skus.map(s => normalizeSku(s)).filter(Boolean))];

        // chunk เล็กโดยตั้งใจ — SKU หนึ่งตัวมีได้หลายแถวข้ามรอบ ยิ่ง chunk ใหญ่

        // ยิ่งเสี่ยงชน max-rows ของ PostgREST (ดีฟอลต์ 1,000) ตั้งแต่หน้าแรก

        const CHUNK = 25;

        const PAGE = 1000;

        const MAX_PAGES = 5;   // กันลูปยาวเกินจำเป็น — ชื่อสินค้าไม่คุ้มกับการไล่ทั้งตาราง



        for (let i = 0; i < unique.length; i += CHUNK) {

            const chunk = unique.slice(i, i + CHUNK);

            let from = 0;



            for (let page = 0; page < MAX_PAGES; page++) {

                const { data, error } = await client

                    .from('book_stock_lines')

                    .select('sku_id, name_pro')

                    .in('sku_id', chunk)

                    .not('name_pro', 'is', null)

                    .order('created_at', { ascending: false })

                    .order('id', { ascending: false })

                    .range(from, from + PAGE - 1);

                if (error) {

                    // ชื่อสินค้าไม่ใช่ข้อมูลบังคับ — ห้ามบล็อกการสร้างแถว Book

                    console.warn('fetchBookNamesBySkusAnyCycle', error);

                    break;

                }



                (data || []).forEach(r => {

                    const sku = normalizeSku(r.sku_id);

                    const nm = r.name_pro ? String(r.name_pro).trim() : '';

                    if (sku && nm && !map[sku]) map[sku] = nm;   // first-wins = รอบล่าสุด

                });



                // ครบทุก SKU ในก้อนนี้แล้ว หรือข้อมูลหมด → ไม่ต้องดึงหน้าถัดไป

                if (chunk.every(s => map[s]) || !data || data.length < PAGE) break;

                from += PAGE;

            }

        }



        return map;

    }



    /** สร้างแถว Book (ยอด 0) จาก count_only — รอบเดียวกับ cycleId */

    async function addBookFromCountOnly(cycleId, { skuId, namePro }) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const sku = normalizeSku(skuId);

        if (!sku) throw new Error('SKU ไม่ถูกต้อง');



        if (await bookSkuExists(cycleId, sku)) {

            throw new Error(`SKU ${sku} มีใน Book ของรอบนี้แล้ว`);

        }



        const { error } = await client

            .from('book_stock_lines')

            .insert([buildBookInsertPayload(cycleId, sku, namePro)]);

        if (error) throw error;



        await refreshReconciliation(cycleId);

        return { sku };

    }



    /** สร้าง Book หลาย SKU (ยอด 0) — ข้าม SKU ที่มีใน Book แล้ว */

    async function addBookFromCountOnlyBatch(cycleId, items) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        if (!items?.length) return { inserted: 0, skipped: 0 };



        const existing = await fetchBookSkuIds(cycleId);

        const payloads = [];

        let skipped = 0;



        for (const item of items) {

            const sku = normalizeSku(item?.skuId);

            if (!sku) {

                skipped++;

                continue;

            }

            if (existing.has(sku)) {

                skipped++;

                continue;

            }

            existing.add(sku);

            payloads.push(buildBookInsertPayload(cycleId, sku, item.namePro));

        }



        if (!payloads.length) return { inserted: 0, skipped };



        for (let i = 0; i < payloads.length; i += BOOK_CHUNK) {

            const chunk = payloads.slice(i, i + BOOK_CHUNK);

            const { error } = await client.from('book_stock_lines').insert(chunk);

            if (error) throw error;

        }



        await refreshReconciliation(cycleId);

        return { inserted: payloads.length, skipped };

    }



    async function countLinkedInventory(cycleId) {

        const client = getClient();

        const { count, error } = await client

            .from('inventory_counts')

            .select('id', { count: 'exact', head: true })

            .eq('cycle_id', cycleId);

        if (error) throw error;

        return count || 0;

    }



    function formatLinkPreviewText(cycle, prev) {

        const whLabel = isAllWarehousesCycle(cycle) ? 'ทุกคลัง' : formatWarehouseDisplay(cycle);

        const rangeLabel = formatDateRangeLabel(cycle);

        return `ช่วง ${rangeLabel} · ${whLabel}: ผลนับในระบบ ${prev.totalInRange} แถว · ผูกแล้ว ${prev.alreadyLinked} · รอผูก ${prev.linkableNull} แถว`;

    }



    async function previewLinkInventoryCounts(cycle) {

        const client = getClient();

        const range = getCycleLinkRange(cycle);

        if (!range) throw new Error('year_month ไม่ถูกต้อง');



        let q1 = client

            .from('inventory_counts')

            .select('id', { count: 'exact', head: true })

            .gte('created_at', range.start)

            .lt('created_at', range.end);

        q1 = applyWarehouseFilter(q1, cycle);

        const { count: totalInRange, error: e1 } = await q1;

        if (e1) throw e1;



        const { count: alreadyLinked, error: e2 } = await client

            .from('inventory_counts')

            .select('id', { count: 'exact', head: true })

            .eq('cycle_id', cycle.id);

        if (e2) throw e2;



        let q3 = client

            .from('inventory_counts')

            .select('id', { count: 'exact', head: true })

            .gte('created_at', range.start)

            .lt('created_at', range.end)

            .is('cycle_id', null);

        q3 = applyWarehouseFilter(q3, cycle);

        const { count: linkableNull, error: e3 } = await q3;

        if (e3) throw e3;



        return {

            range,

            totalInRange: totalInRange || 0,

            alreadyLinked: alreadyLinked || 0,

            linkableNull: linkableNull || 0

        };

    }



    /** ดึงแถวรอผูก (ช่วงวัน + คลัง + cycle_id null) — ใช้แสดงรายการ / Export */

    async function fetchLinkableInventoryRows(cycle, { maxRows = 50000 } = {}) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        const range = getCycleLinkRange(cycle);

        if (!range) throw new Error('year_month ไม่ถูกต้อง');



        const selectCols = 'id, sku_id, location, warehouse, counted_qty, counter_name, created_at';

        const all = [];

        let from = 0;



        while (all.length < maxRows) {

            const to = from + COUNT_PAGE_SIZE - 1;

            let query = client

                .from('inventory_counts')

                .select(selectCols)

                .gte('created_at', range.start)

                .lt('created_at', range.end)

                .is('cycle_id', null)

                // tiebreak ด้วย id — created_at ซ้ำกันได้จาก insert ชุดเดียว (ดูหมายเหตุใน loadInventoryCountsForDashboard)
                .order('created_at', { ascending: false })

                .order('id', { ascending: false });

            query = applyWarehouseFilter(query, cycle);

            const { data, error } = await query.range(from, to);

            if (error) throw error;

            const chunk = data || [];

            all.push(...chunk);

            if (chunk.length < COUNT_PAGE_SIZE) break;

            from += COUNT_PAGE_SIZE;

        }



        return all.slice(0, maxRows);

    }



    /** ผูก cycle_id เท่านั้น — ไม่แก้ counted_qty */

    async function linkInventoryCountsToCycle(cycle, { relinkOthers = false } = {}) {

        const client = getClient();

        const range = getCycleLinkRange(cycle);

        if (!range) throw new Error('year_month ไม่ถูกต้อง');



        let query = client

            .from('inventory_counts')

            .update({ cycle_id: cycle.id })

            .gte('created_at', range.start)

            .lt('created_at', range.end);



        query = applyWarehouseFilter(query, cycle);



        if (!relinkOthers) {

            query = query.is('cycle_id', null);

        }



        const { data, error } = await query.select('id');

        if (error) throw error;

        return (data || []).length;

    }



    /** helper: insert payloads เป็น chunk แล้วคืนจำนวนที่ insert สำเร็จ */
    async function insertBookStockPayloads(cycleId, mergedRows) {
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        const payloads = mergedRows.map(r => ({
            cycle_id: cycleId,
            sku_id: r.sku,
            location: null,
            book_qty: r.qty,
            name_pro: r.namePro || null,
            row_no: r.rowNo
        }));
        let inserted = 0;
        for (let i = 0; i < payloads.length; i += BOOK_CHUNK) {
            const chunk = payloads.slice(i, i + BOOK_CHUNK);
            const { data, error } = await client
                .from('book_stock_lines')
                .insert(chunk)
                .select('id');
            if (error) throw error;
            inserted += (data || []).length;
        }
        return inserted;
    }

    /** helper: อัปเดต book_source บน count_cycles */
    async function touchCycleBookSource(cycleId, fileName) {
        const client = getClient();
        if (!client) return;
        await client
            .from('count_cycles')
            .update({
                book_source: fileName || null,
                book_imported_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', cycleId);
    }

    /**
     * นำเข้า Book (legacy — ลบก่อน insert แยก 2 request ไม่ atomic)
     * ใช้เมื่อ DB ยังไม่มีฟังก์ชัน import_book_stock_lines_atomic
     */
    async function importBookStockLinesLegacy(cycleId, mergedRows, fileName, mode) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        if (mode === 'replace') {
            const { error: delErr } = await client
                .from('book_stock_lines')
                .delete()
                .eq('cycle_id', cycleId);
            if (delErr) throw delErr;
        } else {
            const skuIds = mergedRows.map(r => normalizeSku(r.sku)).filter(Boolean);
            if (skuIds.length) {
                const { error: delErr } = await client
                    .from('book_stock_lines')
                    .delete()
                    .eq('cycle_id', cycleId)
                    .in('sku_id', skuIds);
                if (delErr) throw delErr;
            }
        }

        const inserted = await insertBookStockPayloads(cycleId, mergedRows);
        await touchCycleBookSource(cycleId, fileName);

        if (mode === 'merge') {
            const skuIds = mergedRows.map(r => normalizeSku(r.sku)).filter(Boolean);
            return { inserted, skuIds, skuCount: mergedRows.length };
        }
        return inserted;

    }



    function bookRowsToRpcPayload(mergedRows) {
        return mergedRows.map(r => ({
            sku_id: normalizeSku(r.sku),
            book_qty: r.qty,
            name_pro: r.namePro || null,
            row_no: r.rowNo ?? null,
            location: null
        }));
    }



    function isMissingRpcError(err) {
        const msg = String(err?.message || err?.details || '').toLowerCase();
        return /function.*does not exist|could not find the function|schema cache/i.test(msg);
    }



    /**
     * นำเข้า Book
     *   mode: 'replace' — ลบ Book ทั้งรอบแล้ว insert (atomic ผ่าน RPC)
     *   mode: 'merge'   — ลบเฉพาะ SKU ในไฟล์แล้ว insert (atomic ผ่าน RPC)
     * รองรับ replaceExisting (legacy) เพื่อ backward-compat กับ cycle_config
     * validRows จะถูกรวม SKU ซ้ำก่อน insert เสมอ
     */
    async function importBookStockLines(cycleId, validRows, fileName, options = {}) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        let mode = options.mode;
        if (!mode) {
            mode = options.replaceExisting === false ? 'merge' : 'replace';
        }

        const mergedRows = aggregateBookRowsBySku(
            (validRows || []).filter(r => r && r.sku != null && r.qty != null)
        );
        if (!mergedRows.length) throw new Error('ไม่มีแถวที่นำเข้าได้');

        const rpcPayload = bookRowsToRpcPayload(mergedRows);

        const { data, error } = await client.rpc('import_book_stock_lines_atomic', {
            p_cycle_id: cycleId,
            p_rows: rpcPayload,
            p_mode: mode,
            p_book_source: fileName || null
        });

        if (error) {
            if (isMissingRpcError(error)) {
                console.warn(
                    '[importBookStockLines] RPC import_book_stock_lines_atomic ไม่พบ — ใช้ legacy (ไม่ atomic). รัน docs/sql/012_import_book_stock_atomic.sql'
                );
                return importBookStockLinesLegacy(cycleId, mergedRows, fileName, mode);
            }
            throw error;
        }

        const inserted = Number(data) || 0;
        if (inserted !== mergedRows.length) {
            console.warn(
                `[importBookStockLines] คาด insert ${mergedRows.length} แต่ DB รายงาน ${inserted}`
            );
        }

        if (mode === 'merge') {
            const skuIds = mergedRows.map(r => normalizeSku(r.sku)).filter(Boolean);
            return { inserted, skuIds, skuCount: mergedRows.length };
        }
        return inserted;

    }



    /**
     * SKU ที่มีอย่างน้อย 1 แถวใน inventory_counts (ผูกรอบแล้ว หรือยังไม่ผูกแต่อยู่ในช่วงรอบ)
     * ใช้กำหนดว่า "นับแล้ว" แม้ SUM(counted_qty) = 0
     */
    async function fetchInventoryCountPresenceBySku(cycle) {

        const client = getClient();

        if (!client || !cycle?.id) return new Map();

        const presence = new Map();

        const mark = (skuId) => {

            const k = normalizeSku(skuId);

            if (!k) return;

            presence.set(k, (presence.get(k) || 0) + 1);

        };



        async function pageSkuIds(buildQuery) {

            let from = 0;

            while (true) {

                const to = from + COUNT_PAGE_SIZE - 1;

                const { data, error } = await buildQuery(from, to);

                if (error) throw error;

                const chunk = data || [];

                chunk.forEach(r => mark(r.sku_id));

                if (chunk.length < COUNT_PAGE_SIZE) break;

                from += COUNT_PAGE_SIZE;

            }

        }



        await pageSkuIds((from, to) =>

            client

                .from('inventory_counts')

                .select('sku_id')

                .eq('cycle_id', cycle.id)

                .order('id', { ascending: true })
                .range(from, to)

        );



        const range = getCycleLinkRange(cycle);

        if (range) {

            await pageSkuIds((from, to) => {

                let query = client

                    .from('inventory_counts')

                    .select('sku_id')

                    .is('cycle_id', null)

                    .gte('created_at', range.start)

                    .lt('created_at', range.end);

                query = applyWarehouseFilter(query, cycle);

                return query.order('id', { ascending: true }).range(from, to);

            });

        }



        return presence;

    }



    async function refreshReconciliation(cycleId) {

        const client = getClient();

        const { data, error } = await client.rpc('refresh_reconciliation_for_cycle', {

            p_cycle_id: cycleId

        });

        if (error) throw error;

        return data;

    }



    /**
     * M34: โค้ดอ่าน "เดือน/วันที่มีข้อมูลนับ" ย้ายไป `Js/count-scan-shared.js` แล้ว
     * เพราะ audit_check ก็มีชุดเดียวกันอยู่ ⇒ แก้บั๊กตัวเดียวกันต้องแก้ 2 ที่ตลอดไป
     * ที่นี่คง export ชื่อเดิมไว้เพื่อไม่ให้ call site ทั้ง 3 หน้าต้องแก้
     * ⚠️ ลำดับ <script> สำคัญ: count-scan-shared.js ต้องมาก่อนไฟล์นี้
     */
    function countScan() {
        const svc = window.countScanService;
        if (!svc) throw new Error('ยังไม่ได้โหลด Js/count-scan-shared.js (ต้องมาก่อน reconcile-shared.js)');
        return svc;
    }

    const fetchCountMonths = (warehouse) => countScan().fetchCountMonths(warehouse);
    const fetchCountDaysInMonth = (warehouse, yearMonth) => countScan().fetchCountDaysInMonth(warehouse, yearMonth);

    const RECON_PAGE_SIZE = 1000;



    /** ดึง reconciliation_lines ทั้งหมด — ครั้งละ 1000 แถว (ข้าม limit ของ Supabase) */

    async function fetchReconciliationLines(cycleId, { onProgress } = {}) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const all = [];

        let from = 0;



        while (true) {

            const to = from + RECON_PAGE_SIZE - 1;

            const { data, error } = await client

                .from('reconciliation_lines')

                .select('*')

                .eq('cycle_id', cycleId)

                .order('sku_id')

                .order('id', { ascending: true })

                .range(from, to);

            if (error) throw error;

            const chunk = data || [];

            all.push(...chunk);

            if (onProgress) onProgress({ loaded: all.length, chunkSize: chunk.length });

            if (chunk.length < RECON_PAGE_SIZE) break;

            from += RECON_PAGE_SIZE;

        }



        return all;

    }



    /** สรุป Match ต่อรอบ — จาก view v_cycle_reconciliation_summary */

    async function fetchCycleSummary(cycleId) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const { data, error } = await client

            .from('v_cycle_reconciliation_summary')

            .select('*')

            .eq('cycle_id', cycleId)

            .maybeSingle();



        if (error) throw error;

        return data;

    }



    /** แถว reconciliation ตามสถานะ (สำหรับตาราง Top ขาด/เกิน) */

    async function fetchReconciliationLinesTop(cycleId, { status, limit = 50 } = {}) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        let query = client

            .from('reconciliation_lines')

            .select('sku_id, book_qty, counted_qty, effective_book_qty, variance_qty, match_status')

            .eq('cycle_id', cycleId);



        if (status) query = query.eq('match_status', status);



        const { data, error } = await query

            .order('variance_qty', { ascending: false })

            .limit(limit);



        if (error) throw error;

        return data || [];

    }



    const COUNT_PAGE_SIZE = 1000;



    /** โหลด inventory_counts แบบจำกัดช่วง — รองรับรอบ / เดือน / คลัง */

    async function loadInventoryCountsForDashboard({

        cycle = null,

        cycleId = null,

        range = null,

        warehouseValue = null,

        maxRows = 50000,

        onProgress

    } = {}) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const all = [];

        let from = 0;



        while (all.length < maxRows) {

            const to = from + COUNT_PAGE_SIZE - 1;

            let query = client

                .from('inventory_counts')

                .select('*')

                // เรียง created_at อย่างเดียวไม่พอ — การ insert ชุดเดียว (group submit / นำเข้า Excel)
                // ทำให้หลายแถวมี created_at เท่ากันเป๊ะ ลำดับจึงไม่คงที่ระหว่างหน้า
                // → .range() จะข้ามบางแถวและซ้ำบางแถว ต้อง tiebreak ด้วย id เสมอ
                .order('created_at', { ascending: false })

                .order('id', { ascending: false });



            if (cycleId) {

                query = query.eq('cycle_id', cycleId);

            } else if (cycle) {

                const linkRange = getCycleLinkRange(cycle);

                if (linkRange) {

                    query = query

                        .gte('created_at', linkRange.start)

                        .lt('created_at', linkRange.end);

                }

                query = applyWarehouseFilter(query, cycle);

            } else if (range?.start && range?.end) {

                query = query

                    .gte('created_at', range.start)

                    .lt('created_at', range.end);

                if (warehouseValue) query = applyWarehouseFilterValue(query, warehouseValue);

            }



            const { data, error } = await query.range(from, to);

            if (error) throw error;

            const chunk = data || [];

            all.push(...chunk);

            if (onProgress) onProgress({ loaded: all.length, chunkSize: chunk.length });

            if (chunk.length < COUNT_PAGE_SIZE) break;

            from += COUNT_PAGE_SIZE;

        }



        return all.slice(0, maxRows);

    }



    /** Aggregate อัตราส่งงานฝั่ง DB — ต้องรัน docs/sql/004_dashboard_submission_buckets.sql */

    async function fetchSubmissionBuckets({ start, end, warehouseValue, cycleId, intervalMinutes = 30 }) {

        const client = getClient();

        if (!client || !start || !end) return null;



        try {

            const { data, error } = await client.rpc('submission_rate_buckets', {

                p_start: start,

                p_end: end,

                p_warehouse: warehouseValue || null,

                p_cycle_id: cycleId || null,

                p_interval_minutes: intervalMinutes

            });

            if (error) return null;

            return (data || []).map(row => ({

                ms: new Date(row.bucket_start).getTime(),

                label: new Date(row.bucket_start).toLocaleString('th-TH', {

                    timeZone: 'Asia/Bangkok',

                    month: 'short',

                    day: '2-digit',

                    hour: '2-digit',

                    minute: '2-digit'

                }),

                count: Number(row.record_count) || 0,

                ratePerMin: Number(row.rate_per_minute) || 0

            }));

        } catch {

            return null;

        }

    }



    /** ชื่อสินค้าจาก book_stock_lines (สำหรับแสดง/กรอง) */

    async function fetchBookSkuNames(cycleId) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        const map = {};

        let from = 0;

        while (true) {

            const to = from + RECON_PAGE_SIZE - 1;

            const { data, error } = await client

                .from('book_stock_lines')

                .select('sku_id, name_pro')

                .eq('cycle_id', cycleId)

                .order('id', { ascending: true })
                .range(from, to);

            if (error) throw error;

            const chunk = data || [];

            chunk.forEach(r => {

                const sku = normalizeSku(r.sku_id);

                if (sku && r.name_pro && !map[sku]) map[sku] = String(r.name_pro).trim();

            });

            if (chunk.length < RECON_PAGE_SIZE) break;

            from += RECON_PAGE_SIZE;

        }

        return map;

    }



    async function fetchAdjustments(cycleId) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        const { data, error } = await client

            .from('stock_adjustments')

            .select('*')

            .eq('cycle_id', cycleId)

            .order('created_at', { ascending: false });

        if (error) throw error;

        return data || [];

    }



    async function createStockAdjustment({ cycleId, skuId, adjustmentQty, varianceBefore, note, reason = 'manual' }) {

        const client = getClient();

        const payload = {

            cycle_id: cycleId,

            sku_id: normalizeSku(skuId),

            adjustment_qty: Number(adjustmentQty),

            variance_before: varianceBefore != null ? Number(varianceBefore) : null,

            reason: normalizeAdjustmentReason(reason),

            status: 'draft',

            note: note || null

        };

        if (!payload.sku_id) throw new Error('กรุณาระบุ SKU');

        if (!Number.isFinite(payload.adjustment_qty) || payload.adjustment_qty === 0) {

            throw new Error('จำนวนปรับยอดไม่ถูกต้อง');

        }

        const { data, error } = await client

            .from('stock_adjustments')

            .insert(payload)

            .select('*')

            .single();

        if (error) throw error;

        return data;

    }



    /** สร้าง draft ปรับยอดหลายรายการพร้อมกัน */

    async function createStockAdjustmentsBatch(items) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        if (!items?.length) return [];



        const payloads = items.map(item => {

            const sku = normalizeSku(item.skuId);

            const qty = Number(item.adjustmentQty);

            if (!sku) throw new Error('กรุณาระบุ SKU');

            if (!Number.isFinite(qty) || qty === 0) throw new Error(`จำนวนปรับยอดไม่ถูกต้อง: ${sku}`);

            return {

                cycle_id: item.cycleId,

                sku_id: sku,

                adjustment_qty: qty,

                variance_before: item.varianceBefore != null ? Number(item.varianceBefore) : null,

                reason: normalizeAdjustmentReason(item.reason || 'reconcile'),

                status: 'draft',

                note: item.note || null

            };

        });



        const { data, error } = await client

            .from('stock_adjustments')

            .insert(payloads)

            .select('*');

        if (error) throw error;

        return data || [];

    }



    async function applyStockAdjustment(adjustmentId, appliedBy) {

        const client = getClient();

        const { error } = await client.rpc('apply_stock_adjustment', {

            p_adjustment_id: adjustmentId,

            p_applied_by: appliedBy || null

        });

        if (error) throw error;

    }



    /** Apply draft ทั้งรอบ — refresh reconciliation ครั้งเดียว (A11) */
    async function applyAllDraftsForCycle(cycleId, appliedBy) {
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        if (!cycleId) throw new Error('ไม่พบรอบ');

        const { data, error } = await client.rpc('apply_all_drafts_for_cycle', {
            p_cycle_id: cycleId,
            p_applied_by: appliedBy || null
        });

        if (error) {
            if (/apply_all_drafts_for_cycle|function.*does not exist/i.test(error.message)) {
                throw new Error(
                    'ฟังก์ชัน apply_all_drafts_for_cycle ยังไม่มี — รัน docs/sql/013_audit_warnings.sql ใน Supabase'
                );
            }
            throw error;
        }

        return Number(data) || 0;
    }



    async function ensureSchemaReadyWithNotice(showToastFn) {
        const ready = await checkSchemaReady();
        if (!ready.ok) {
            console.warn('[Schema]', ready.message);
            if (typeof showToastFn === 'function') {
                showToastFn(ready.message, 'error');
            }
        }
        return ready;
    }



    /** ยอมรับผลนับเป็นยอดถูกต้อง — สร้างปรับยอดแล้ว Apply ทันที (reason: reconcile) */

    async function acceptCountedQtyAsMatch({ cycleId, skuId, adjustmentQty, varianceBefore, note }) {

        const created = await createStockAdjustment({

            cycleId,

            skuId,

            adjustmentQty,

            varianceBefore,

            note: note || 'ยอมรับผลนับ',

            reason: 'manual'

        });

        await applyStockAdjustment(created.id);

        return { adjustmentId: created.id, skuId: created.sku_id };

    }



    /** ดึงรายการที่ยืนยันเป็นถูกต้องแล้ว (ไม่ปรับยอด) */
    async function fetchMatchAcceptanceMap(cycleId) {
        const client = getClient();
        if (!client || !cycleId) return new Map();
        const { data, error } = await client
            .from('reconciliation_match_acceptances')
            .select('sku_id, note, accepted_at, accepted_by')
            .eq('cycle_id', cycleId);
        if (error) {
            if (/does not exist|relation|schema cache/i.test(error.message)) {
                console.warn('[fetchMatchAcceptanceMap] ตารางยังไม่มี — รัน docs/sql/008_reconciliation_match_acceptances.sql');
                return new Map();
            }
            throw error;
        }
        const map = new Map();
        (data || []).forEach(row => {
            const sku = normalizeSku(row.sku_id);
            if (sku) map.set(sku, row);
        });
        return map;
    }

    /** ยืนยันเป็นถูกต้อง — ไม่แตะ book / adjustment / counted */
    async function acceptReconciliationAsMatch({ cycleId, skuId, note }) {
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        const sku = normalizeSku(skuId);
        if (!sku) throw new Error('กรุณาระบุ SKU');
        const { error } = await client
            .from('reconciliation_match_acceptances')
            .upsert({
                cycle_id: cycleId,
                sku_id: sku,
                note: note || null,
                accepted_at: new Date().toISOString()
            }, { onConflict: 'cycle_id,sku_id' });
        if (error) throw error;
        return { skuId: sku };
    }


    /** action_type ใน inventory_audit_logs สำหรับการล้างยอดปรับตอน Import Excel (docs/ISSUES.md H6) */
    const ADJ_CLEAR_ACTION = 'RECONCILE_ADJ_CLEAR';
    const AUDIT_LOG_CHUNK = 100;
    const AUDIT_DETAIL_MAX = 200;

    /** ใครเป็นคนทำ — reconcile ไม่มีช่องกรอกชื่อ จึงยืมชื่อผู้นับล่าสุดของเครื่องนี้ + ต่อท้ายที่มา */
    function resolveReconcileActor(suffix) {
        const tag = suffix || 'reconcile_import';
        try {
            const saved = localStorage.getItem('saved_counter_name');
            if (saved && saved.trim()) return `${saved.trim()} (${tag})`;
        } catch { /* localStorage อ่านไม่ได้ */ }
        return tag;
    }

    function auditQtyOrNull(v) {
        // '' และ null = "ไม่รู้จำนวน" ไม่ใช่ 0 (Number('') === 0)
        if (v === '' || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
    }

    /**
     * เขียน inventory_audit_logs ให้ทุกแถว stock_adjustments ที่กำลังจะถูกลบ
     *
     * ต้องเขียน **ก่อน** ลบเสมอ — ลบแล้วสร้าง log ย้อนหลังไม่ได้ (แนวเดียวกับ Js/audit-log.js)
     * ถ้าเขียนไม่สำเร็จ จะย้อน log ที่เพิ่งเขียนแล้ว throw เพื่อ **ยกเลิกการลบ** ไม่ให้ยอดปรับ
     * ที่ apply ไปแล้วหายโดยไม่มีหลักฐาน (docs/ISSUES.md H6)
     *
     * คืน `writtenIds` มาด้วยเสมอ เพราะผู้เรียกต้องถอน log ทิ้งเองถ้า **การลบ** พังทีหลัง
     * (log บอกว่าลบแล้วทั้งที่ข้อมูลยังอยู่ = หลักฐานเท็จ อันตรายกว่าไม่มี log)
     * @returns {Promise<{count:number, writtenIds:Array}>}
     */
    async function logAdjustmentsBeforeDelete(client, cycleId, rows, { source = 'reconcile_import' } = {}) {
        const list = (rows || []).filter(Boolean);
        if (!list.length) return { count: 0, writtenIds: [] };

        const actor = resolveReconcileActor(source);
        const entries = list.map(r => {
            const detail = `stock_adjustments ${r.status || '-'} · qty=${r.adjustment_qty} · cycle=${cycleId} · ${r.note || r.reason || ''}`;
            return {
                action_type: ADJ_CLEAR_ACTION,
                record_id: r.id == null ? '' : String(r.id),
                sku_id: normalizeSku(r.sku_id) || '-',
                old_qty: auditQtyOrNull(r.adjustment_qty),
                new_qty: null,                      // ลบ = ไม่มีค่าใหม่
                warehouse: '',                      // stock_adjustments ไม่มีมิติคลัง
                location: detail.slice(0, AUDIT_DETAIL_MAX),
                counter_name: actor
            };
        });

        const writtenIds = [];
        for (let i = 0; i < entries.length; i += AUDIT_LOG_CHUNK) {
            const chunk = entries.slice(i, i + AUDIT_LOG_CHUNK);
            const { data, error } = await client.from('inventory_audit_logs').insert(chunk).select('id');
            if (error) {
                // ย้อน log ที่เขียนไปแล้ว ไม่งั้นจะเหลือหลักฐานเท็จว่า "ลบแล้ว" ทั้งที่ยังไม่ได้ลบ
                await rollbackAuditEntries(client, writtenIds);
                throw new Error(`บันทึกประวัติยอดปรับไม่สำเร็จ จึงยกเลิกการล้างยอดปรับเพื่อรักษาหลักฐาน: ${error.message}`);
            }
            (data || []).forEach(r => { if (r?.id != null) writtenIds.push(r.id); });
        }
        return { count: entries.length, writtenIds };
    }

    /** ถอน audit log ที่เพิ่งเขียน (ใช้เมื่อการลบจริงไม่สำเร็จ — ไม่ throw ต่อ) */
    async function rollbackAuditEntries(client, writtenIds) {
        const ids = (writtenIds || []).filter(v => v != null);
        if (!client || !ids.length) return false;
        try {
            const { error } = await client.from('inventory_audit_logs').delete().in('id', ids);
            if (error) throw error;
            return true;
        } catch (err) {
            console.warn('[reconcile] ย้อน audit log ไม่สำเร็จ:', err?.message || err);
            return false;
        }
    }

    /**
     * ล้าง adjustment + การยืนยันถูกต้องเดิม ของ SKU ในรอบ
     *
     * ต้องล้างจริง (ไม่ใช่เฉพาะ draft) เพราะ `effective_book_qty = book_qty + SUM(applied)`
     * ถ้าเหลือยอดปรับเก่าไว้หลัง Import Book ใหม่ จะกลายเป็นนับซ้ำ — แต่ทุกแถวที่ลบ
     * ต้องมี audit log กำกับก่อนเสมอ (docs/ISSUES.md H6)
     * @returns {Promise<{deleted:number, logged:number}>}
     */
    async function clearAdjustmentsAndMatchAcceptancesForSkus(cycleId, skuIds, { onProgress } = {}) {
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        const ids = uniqueSkuIds(skuIds);
        if (!ids.length) return { deleted: 0, logged: 0 };

        let done = 0;
        let deleted = 0;
        let logged = 0;
        for (let i = 0; i < ids.length; i += BOOK_CHUNK) {
            const chunk = ids.slice(i, i + BOOK_CHUNK);

            // อ่านแถวที่กำลังจะหายก่อน แล้วเขียน log — ลำดับนี้ห้ามสลับ
            const { data: doomed, error: readErr } = await client
                .from('stock_adjustments')
                .select('id, sku_id, status, adjustment_qty, reason, note')
                .eq('cycle_id', cycleId)
                .in('sku_id', chunk);
            if (readErr) throw readErr;
            const chunkLog = await logAdjustmentsBeforeDelete(client, cycleId, doomed || []);
            logged += chunkLog.count;

            const { error: adjErr } = await client
                .from('stock_adjustments')
                .delete()
                .eq('cycle_id', cycleId)
                .in('sku_id', chunk);
            if (adjErr) {
                // ลบไม่สำเร็จ = log ของ chunk นี้กลายเป็นหลักฐานเท็จ ต้องถอนก่อนโยน error ออกไป
                await rollbackAuditEntries(client, chunkLog.writtenIds);
                throw adjErr;
            }
            deleted += (doomed || []).length;

            try {
                const { error: accErr } = await client
                    .from('reconciliation_match_acceptances')
                    .delete()
                    .eq('cycle_id', cycleId)
                    .in('sku_id', chunk);
                if (accErr) throw accErr;
            } catch {
                // ตารางอาจยังไม่ถูกสร้าง
            }
            done += chunk.length;
            if (typeof onProgress === 'function') {
                onProgress({ done, total: ids.length, phase: 'clear' });
            }
        }
        return { deleted, logged };
    }

    function computeStatusFromEffective(effective, counted) {
        return computeMatchStatus({
            bookQty: 0,
            adjustmentTotal: Number(effective) || 0,
            countedQty: Number(counted) || 0,
            hasCountRecord: true,
            inBookSkuSet: true
        });
    }

    /** แปลง validRows → { [sku]: qty } โดยรวม SKU ซ้ำก่อน (ใช้ใน Import reconcile) */
    function targetsMapFromValidRows(validRows) {
        const map = {};
        aggregateBookRowsBySku(validRows || []).forEach(r => {
            const sku = normalizeSku(r.sku);
            if (sku) map[sku] = Number(r.qty);
        });
        return map;
    }

    /** Preview ปรับตามเป้าหมาย effective จากไฟล์ (ก่อน apply) */
    async function previewAdjustmentsToBookTargets(cycleId, targetsBySku, { onProgress } = {}) {
        const client = getClient();
        if (!client || !cycleId) return [];

        const entries = Object.entries(targetsBySku || {})
            .map(([sku, qty]) => ({ skuId: normalizeSku(sku), targetEffective: Number(qty) }))
            .filter(e => e.skuId && Number.isFinite(e.targetEffective));
        if (!entries.length) return [];

        const skuIds = [...new Set(entries.map(e => e.skuId))];
        const reconMap = new Map();
        const draftMap = new Map();
        const bookQtyMap = new Map();

        let done = 0;
        for (let i = 0; i < skuIds.length; i += BOOK_CHUNK) {
            const chunk = skuIds.slice(i, i + BOOK_CHUNK);

            const { data: reconRows, error: reconErr } = await client
                .from('reconciliation_lines')
                .select('sku_id, book_qty, adjustment_applied, effective_book_qty, counted_qty')
                .eq('cycle_id', cycleId)
                .in('sku_id', chunk);
            if (reconErr) throw reconErr;
            (reconRows || []).forEach(r => {
                const sku = normalizeSku(r.sku_id);
                if (sku) reconMap.set(sku, r);
            });

            const { data: draftRows, error: draftErr } = await client
                .from('stock_adjustments')
                .select('sku_id, adjustment_qty')
                .eq('cycle_id', cycleId)
                .eq('status', 'draft')
                .in('sku_id', chunk);
            if (draftErr) throw draftErr;
            (draftRows || []).forEach(r => {
                const sku = normalizeSku(r.sku_id);
                if (sku) draftMap.set(sku, (draftMap.get(sku) || 0) + Number(r.adjustment_qty || 0));
            });

            const { data: bookRows, error: bookErr } = await client
                .from('book_stock_lines')
                .select('sku_id, book_qty')
                .eq('cycle_id', cycleId)
                .in('sku_id', chunk);
            if (bookErr) throw bookErr;
            (bookRows || []).forEach(r => {
                const sku = normalizeSku(r.sku_id);
                if (!sku) return;
                bookQtyMap.set(sku, (bookQtyMap.get(sku) || 0) + Number(r.book_qty || 0));
            });

            done += chunk.length;
            if (typeof onProgress === 'function') {
                onProgress({ done, total: skuIds.length, phase: 'preview' });
            }
        }

        return entries.map(e => {
            const sku = e.skuId;
            const targetEffective = e.targetEffective;
            const recon = reconMap.get(sku);
            const countedQty = recon ? Number(recon.counted_qty || 0) : 0;
            const bookQty = Number(bookQtyMap.get(sku) ?? (recon ? Number(recon.book_qty) : 0));
            const effectiveApplied = recon ? Number(recon.effective_book_qty || 0) : bookQty;
            const currentEffective = effectiveApplied + (draftMap.get(sku) || 0);
            const requiredAdjustmentQty = targetEffective - bookQty;
            const afterEffective = bookQty + requiredAdjustmentQty;

            return {
                skuId: sku,
                targetEffective,
                bookQty,
                countedQty,
                currentEffective,
                deltaEffective: afterEffective - currentEffective,
                requiredAdjustmentQty,
                statusBefore: recon ? computeStatusFromEffective(currentEffective, countedQty) : 'book_only',
                statusAfter: computeStatusFromEffective(afterEffective, countedQty)
            };
        });
    }

    /**
     * Import Book จาก Excel แล้ว **ปล่อยให้สถานะคำนวณเองตามจริง** (docs/ISSUES.md H6)
     *
     * ของเดิม: merge Book → สร้าง adjustment (ซึ่ง `target − bookQty = 0` เสมอเพราะเพิ่ง merge
     * ไปแล้ว จึงเป็น dead path) → `acceptReconciliationAsMatchBatch` (ลบทิ้งแล้ว 2026-08-11) **force ทุก SKU ในไฟล์
     * เป็น "ถูกต้อง" โดยไม่ดูผลนับ** ทำให้ KPI สวยเกินจริง
     *
     * ของใหม่ ลำดับคือ:
     *   1. preview ก่อน merge (ตอนนี้ยังเห็นยอดเดิม จึงเทียบ "ก่อน → หลัง" ได้จริง)
     *   2. merge Book ตามไฟล์
     *   3. ล้าง adjustment + acceptance เดิมของ SKU ในไฟล์ (เขียน audit log ก่อนลบ)
     *      — จำเป็นเพราะ effective = book + SUM(applied) ถ้าไม่ล้างจะนับซ้ำกับ Book ใหม่
     *   4. refresh ให้ DB คำนวณสถานะใหม่จาก Book ใหม่ vs ผลนับจริง
     *
     * @returns {Promise<{imported:number, skuIds:string[], preview:Array, cleared:{deleted:number,logged:number}}>}
     */
    async function importBookAndRecompute(cycleId, validRows, fileName, { onProgress } = {}) {
        const client = getClient();
        if (!client || !cycleId) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        const rows = (validRows || []).filter(r => r && r.sku != null && r.qty != null);
        if (!rows.length) throw new Error('ไม่มีแถวที่นำเข้าได้');

        const targets = targetsMapFromValidRows(rows);
        const skuIds = uniqueSkuIds(Object.keys(targets));
        const progress = (phase, done, total) => {
            if (typeof onProgress === 'function') onProgress({ phase, done, total });
        };

        progress('preview', 0, skuIds.length);
        const preview = await previewAdjustmentsToBookTargets(cycleId, targets, {
            onProgress: ({ done, total }) => progress('preview', done, total)
        });

        // ล้างยอดปรับเก่า **ก่อน** merge เสมอ — ผลลัพธ์ปลายทางเหมือนกัน แต่ถ้าล้มกลางทาง
        // สภาพที่เหลือต่างกันมาก: ถ้า merge ก่อนแล้ว clear พัง จะได้ Book ใหม่ + ยอดปรับเก่า
        // = `effective = book + SUM(applied)` นับซ้ำเงียบ ๆ (ยอดพองโดยไม่มีใครรู้)
        // ส่วนลำดับนี้ถ้าพังจะได้ Book เดิม + ไม่มียอดปรับ ซึ่งเห็นชัดและมี audit log กำกับ
        progress('clear', 0, skuIds.length);
        const cleared = await clearAdjustmentsAndMatchAcceptancesForSkus(cycleId, skuIds, {
            onProgress: ({ done, total }) => progress('clear', done, total)
        });

        progress('import', 0, 1);
        const importRes = await importBookStockLines(cycleId, rows, fileName, { mode: 'merge' });
        const imported = typeof importRes === 'number' ? importRes : Number(importRes?.inserted || 0);
        progress('import', 1, 1);

        progress('refresh', 0, 1);
        await refreshReconciliation(cycleId);
        progress('refresh', 1, 1);

        return { imported, skuIds, preview, cleared };
    }

    async function deleteDraftAdjustment(adjustmentId) {

        const client = getClient();

        const { error } = await client

            .from('stock_adjustments')

            .delete()

            .eq('id', adjustmentId)

            .eq('status', 'draft');

        if (error) throw error;

    }



    function formatCycleLabel(cycle) {

        if (!cycle) return '-';

        const label = cycle.label ? ` · ${cycle.label}` : '';

        const range = formatDateRangeLabel(cycle);

        const rangePart = range !== 'ทั้งเดือน' ? ` · ${range}` : '';

        return `${formatWarehouseDisplay(cycle)} · ${cycle.year_month}${rangePart}${label}`;

    }



    function statusLabel(status) {

        const map = {

            draft: 'ร่าง',

            open: 'เปิด',

            counting: 'กำลังนับ',

            reconciling: 'กำลัง Match',

            closed: 'ปิดรอบ',

            archived: 'เก็บถาวร'

        };

        return map[status] || status || '-';

    }



    /** Template Excel สำหรับ Import Book — คอลัมน์ A=SKU, B=จำนวน, C=ชื่อสินค้า (parseBookExcelRows) */
    function downloadBookImportTemplate(filename = 'Template_Match_Book.xlsx') {
        const XLSX_ = window.XLSX;
        if (!XLSX_) throw new Error('XLSX library ไม่พร้อม');
        const ws = XLSX_.utils.aoa_to_sheet([
            ['SKU', 'จำนวน (ยอดก่อนนับ)', 'ชื่อสินค้า'],
            ['ZA001', 100, 'ตัวอย่าง A'],
            ['XY100', 50, '']
        ]);
        const wb = XLSX_.utils.book_new();
        XLSX_.utils.book_append_sheet(wb, ws, 'Book');
        XLSX_.writeFile(wb, filename);
    }



    /** min/max สำหรับ input type=date ตาม year_month */

    function getMonthDateBounds(yearMonth) {

        const ym = parseYearMonth(yearMonth);

        if (!ym) return null;

        const lastDay = new Date(ym.year, ym.month, 0).getDate();

        const prefix = `${ym.year}-${String(ym.month).padStart(2, '0')}`;

        return {

            min: `${prefix}-01`,

            max: `${prefix}-${String(lastDay).padStart(2, '0')}`

        };

    }



    /**
     * รวม "ยอดปรับ" + "การยืนยันเป็นถูกต้อง" ของรอบ เป็นรายการเดียว เรียงใหม่ → เก่า
     *
     * ⚠️ ห้ามคัดลอกตรรกะนี้ไปไว้ในหน้า HTML — เดิมเคยเป็น inline ใน reconcile.html
     * แล้วหน้า adjust_history ต้องใช้ด้วย ⇒ ยกขึ้นมาที่เดียว (บทเรียนเดียวกับ M34 / M8)
     * `detail` คำนวณจาก field ดิบในนี้เสมอ เพื่อให้ข้อความบนทุกหน้าจอตรงกันเป๊ะ
     *
     * @param {Array} adjustments แถวจาก stock_adjustments
     * @param {Map}   acceptanceMap ผลจาก fetchMatchAcceptanceMap
     * @returns {Array<{type:string,sku:string,qty:number|null,status:string|null,note:string,detail:string,by:string,at:string|null}>}
     */
    function buildAdjustHistoryEntries(adjustments, acceptanceMap) {
        const out = [];
        (adjustments || []).forEach(a => {
            const qty = Number(a.adjustment_qty);
            const status = a.status === 'draft' ? 'draft' : 'applied';
            const note = a.note || a.reason || '';
            out.push({
                type: 'adj',
                sku: a.sku_id,
                qty: Number.isFinite(qty) ? qty : null,
                status,
                note,
                detail: `${qty > 0 ? '+' : ''}${qty} (${status})${note ? ` — ${note}` : ''}`,
                by: a.created_by || '',
                at: a.applied_at || a.created_at || null
            });
        });
        if (acceptanceMap) {
            for (const [sku, r] of acceptanceMap) {
                const note = r.note || '';
                out.push({
                    type: 'ack',
                    sku,
                    qty: null,
                    status: null,
                    note,
                    detail: `ยืนยันเป็นถูกต้อง (ไม่ปรับยอด)${note ? ` — ${note}` : ''}`,
                    by: r.accepted_by || '',
                    at: r.accepted_at || null
                });
            }
        }
        out.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
        return out;
    }

    window.reconcileService = {

        ACTIVE_CYCLE_KEY,

        ALL_WAREHOUSES,

        STANDARD_WAREHOUSES,

        getClient,

        escapeHtml,

        parseYearMonth,

        yearMonthToRangeISO,

        isoToBangkokYmd,

        dateToBangkokStartISO,

        dateToBangkokEndExclusiveISO,

        isAllWarehousesCycle,

        WAREHOUSE_MULTI_SEP,

        parseCycleWarehouses,

        encodeCycleWarehouses,

        refreshStandardWarehousesFromRegistry,


        formatWarehouseDisplay,

        warehouseMatchesCycle,

        cycleMatchesWarehouseFilter,

        applyWarehouseFilterValue,

        getCycleLinkRange,

        buildCycleTimestamps,

        formatDateRangeLabel,

        getCycleEditDates,

        formatLinkPreviewText,

        getMonthDateBounds,

        getActiveCycle,

        setActiveCycle,

        clearActiveCycle,

        getCycleIdForWarehouse,

        isCycleRelevantNow,
        isCycleClosed,
        fetchCountMonths,
        fetchCountDaysInMonth,

        attachCycleToPayload,

        checkSchemaReady,

        fetchCycles,

        fetchCycleById,

        createCycle,


        updateCycleWarehouses,

        updateCycleDateRange,

        deleteCycle,

        parseBookExcelRows,

        aggregateBookRowsBySku,

        readBookExcelSheetRows,

        computeMatchStatus,

        targetsMapFromValidRows,

        countBookLines,

        deleteBookStockBySku,

        fetchBookSkuIds,

        bookSkuExists,

        addBookFromCountOnly,

        addBookFromCountOnlyBatch,

        fetchBookNamesBySkusAnyCycle,

        countLinkedInventory,

        previewLinkInventoryCounts,

        fetchLinkableInventoryRows,

        linkInventoryCountsToCycle,

        importBookStockLines,


        insertBookStockPayloads,

        normalizeSku,

        fetchInventoryCountPresenceBySku,

        refreshReconciliation,

        fetchReconciliationLines,

        fetchCycleSummary,

        fetchReconciliationLinesTop,

        loadInventoryCountsForDashboard,

        fetchSubmissionBuckets,

        fetchBookSkuNames,

        fetchAdjustments,

        createStockAdjustment,

        createStockAdjustmentsBatch,

        applyStockAdjustment,

        applyAllDraftsForCycle,

        ensureSchemaReadyWithNotice,

        acceptCountedQtyAsMatch,

        fetchMatchAcceptanceMap,

        buildAdjustHistoryEntries,

        acceptReconciliationAsMatch,


        clearAdjustmentsAndMatchAcceptancesForSkus,


        previewAdjustmentsToBookTargets,


        importBookAndRecompute,

        deleteDraftAdjustment,

        formatCycleLabel,

        statusLabel,

        downloadBookImportTemplate

    };

})();


