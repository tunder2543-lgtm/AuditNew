// =============================================================================

//  Reconcile / Count Cycle — Shared helpers

//  กฎ: ห้าม UPDATE inventory_counts.counted_qty จาก module นี้

// =============================================================================



(function () {

    const ACTIVE_CYCLE_KEY = 'active_count_cycle_v1';

    const ALL_WAREHOUSES = 'คลังทั้งหมด';

    const WAREHOUSE_MULTI_SEP = '|';

    const STANDARD_WAREHOUSES = ['ตึกกันตนา', 'หน้าไลฟ์(บางกรวย)', 'คลังอะไหล่'];

    const BOOK_CHUNK = 200;

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

            .replace(/"/g, '&quot;');

    }



    function normalizeSku(value) {

        return String(value ?? '').trim();

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



    function encodeCycleWarehouses(warehouses) {

        if (!warehouses?.length) return ALL_WAREHOUSES;

        const sorted = [...warehouses].sort((a, b) => {

            const ia = STANDARD_WAREHOUSES.indexOf(a);

            const ib = STANDARD_WAREHOUSES.indexOf(b);

            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);

        });

        if (sorted.length === 1) return sorted[0];

        return sorted.join(WAREHOUSE_MULTI_SEP);

    }



    function isMultiWarehouseCycle(cycleOrWarehouse) {

        const list = parseCycleWarehouses(cycleOrWarehouse);

        return !!list && list.length > 1;

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



    function getCycleIdForWarehouse(warehouse) {

        const wh = String(warehouse ?? '').trim();

        const active = getActiveCycle();

        if (!active || !wh) return null;

        if (isAllWarehousesCycle(active)) return active.id;

        if (warehouseMatchesCycle(active, wh)) return active.id;

        return null;

    }



    function attachCycleToPayload(payload, warehouse) {

        const cycleId = getCycleIdForWarehouse(warehouse);

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



    async function updateCycleStatus(cycleId, status) {

        const client = getClient();

        const { data, error } = await client

            .from('count_cycles')

            .update({ status, updated_at: new Date().toISOString() })

            .eq('id', cycleId)

            .select('*')

            .single();

        if (error) throw error;

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
            const key = normalizeSku(r.sku) || String(r.sku || '').toLowerCase();
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

            const namePro = normalizeSku(row[2] ?? row['name'] ?? row['ชื่อ'] ?? '');



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



            const key = sku.toLowerCase();

            skuTotals.set(key, (skuTotals.get(key) || 0) + floored);

        }



        const duplicates = [];

        skuTotals.forEach((total, key) => {

            const rows = items.filter(r => r.valid && r.sku.toLowerCase() === key);

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



        const sku = String(skuId ?? '').trim();

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



        const { error: bookDelErr } = await client

            .from('book_stock_lines')

            .delete()

            .eq('cycle_id', cycleId)

            .eq('sku_id', sku);

        if (bookDelErr) throw bookDelErr;



        const { error: adjDelErr } = await client

            .from('stock_adjustments')

            .delete()

            .eq('cycle_id', cycleId)

            .eq('sku_id', sku);

        if (adjDelErr) throw adjDelErr;



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

                .range(from, to);

            if (error) throw error;

            const chunk = data || [];

            chunk.forEach(r => {

                const sku = String(r.sku_id ?? '').trim();

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

        const sku = String(skuId ?? '').trim();

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



    async function fetchSkuMasterNamesBySkus(skus) {

        const client = getClient();

        const map = {};

        if (!client || !skus?.length) return map;



        const unique = [...new Set(skus.map(s => String(s).trim()).filter(Boolean))];

        const CHUNK = 200;



        for (let i = 0; i < unique.length; i += CHUNK) {

            const chunk = unique.slice(i, i + CHUNK);

            const { data, error } = await client

                .from('sku_master')

                .select('sku_name, name_pro')

                .in('sku_name', chunk);

            if (error) {

                console.warn('fetchSkuMasterNamesBySkus', error);

                continue;

            }

            (data || []).forEach(r => {

                const sku = String(r.sku_name ?? '').trim();

                if (sku && r.name_pro && !map[sku]) map[sku] = String(r.name_pro).trim();

            });

        }



        return map;

    }



    /** สร้างแถว Book (ยอด 0) จาก count_only — รอบเดียวกับ cycleId */

    async function addBookFromCountOnly(cycleId, { skuId, namePro }) {

        const client = getClient();

        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');



        const sku = String(skuId ?? '').trim();

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

            const sku = String(item?.skuId ?? '').trim();

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

                .order('created_at', { ascending: false });

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
     * นำเข้า Book
     *   mode: 'replace' — ลบ Book ทั้งรอบก่อน insert (default)
     *   mode: 'merge'   — ลบเฉพาะ SKU ในไฟล์แล้ว insert
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

                return query.range(from, to);

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

                .order('created_at', { ascending: false });



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
        try {
            const { data, error } = await client
                .from('reconciliation_match_acceptances')
                .select('sku_id, note, accepted_at, accepted_by')
                .eq('cycle_id', cycleId);
            if (error) {
                if (/does not exist|relation|schema cache/i.test(error.message)) return new Map();
                throw error;
            }
            const map = new Map();
            (data || []).forEach(row => {
                const sku = normalizeSku(row.sku_id);
                if (sku) map.set(sku, row);
            });
            return map;
        } catch {
            return new Map();
        }
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

    /** ล้าง adjustment + การยืนยันถูกต้องเดิม ของ SKU ในรอบ */
    async function clearAdjustmentsAndMatchAcceptancesForSkus(cycleId, skuIds) {
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        const ids = (skuIds || []).map(normalizeSku).filter(Boolean);
        if (!ids.length) return;

        const { error: adjErr } = await client
            .from('stock_adjustments')
            .delete()
            .eq('cycle_id', cycleId)
            .in('sku_id', ids);
        if (adjErr) throw adjErr;

        try {
            const { error: accErr } = await client
                .from('reconciliation_match_acceptances')
                .delete()
                .eq('cycle_id', cycleId)
                .in('sku_id', ids);
            if (accErr) throw accErr;
        } catch {
            // ตารางอาจยังไม่ถูกสร้าง
        }
    }

    async function fetchBookQtySums(cycleId, skuIds) {
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        const ids = (skuIds || []).map(normalizeSku).filter(Boolean);
        if (!ids.length) return new Map();

        const { data, error } = await client
            .from('book_stock_lines')
            .select('sku_id, book_qty')
            .eq('cycle_id', cycleId)
            .in('sku_id', ids);
        if (error) throw error;

        const map = new Map();
        (data || []).forEach(r => {
            const sku = normalizeSku(r.sku_id);
            if (!sku) return;
            map.set(sku, (map.get(sku) || 0) + Number(r.book_qty || 0));
        });
        return map;
    }

    /** @deprecated ใช้ importBookStockLines(..., { mode: 'merge' }) แทน */
    async function importBookStockLinesMerge(cycleId, validRows, fileName) {
        return importBookStockLines(cycleId, validRows, fileName, { mode: 'merge' });
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
            map[r.sku] = Number(r.qty);
        });
        return map;
    }

    /** Preview ปรับตามเป้าหมาย effective จากไฟล์ (ก่อน apply) */
    async function previewAdjustmentsToBookTargets(cycleId, targetsBySku) {
        const client = getClient();
        if (!client || !cycleId) return [];

        const entries = Object.entries(targetsBySku || {})
            .map(([sku, qty]) => ({ skuId: normalizeSku(sku), targetEffective: Number(qty) }))
            .filter(e => e.skuId && Number.isFinite(e.targetEffective));
        if (!entries.length) return [];

        const skuIds = [...new Set(entries.map(e => e.skuId))];

        const { data: reconRows, error: reconErr } = await client
            .from('reconciliation_lines')
            .select('sku_id, book_qty, adjustment_applied, effective_book_qty, counted_qty')
            .eq('cycle_id', cycleId)
            .in('sku_id', skuIds);
        if (reconErr) throw reconErr;

        const reconMap = new Map();
        (reconRows || []).forEach(r => {
            const sku = normalizeSku(r.sku_id);
            if (sku) reconMap.set(sku, r);
        });

        const { data: draftRows, error: draftErr } = await client
            .from('stock_adjustments')
            .select('sku_id, adjustment_qty')
            .eq('cycle_id', cycleId)
            .eq('status', 'draft')
            .in('sku_id', skuIds);
        if (draftErr) throw draftErr;

        const draftMap = new Map();
        (draftRows || []).forEach(r => {
            const sku = normalizeSku(r.sku_id);
            if (sku) draftMap.set(sku, (draftMap.get(sku) || 0) + Number(r.adjustment_qty || 0));
        });

        const bookQtyMap = await fetchBookQtySums(cycleId, skuIds);

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

    /** Apply: เคลียร์ adjustment ของ SKU ในไฟล์ แล้วสร้าง+apply ให้ effective ตรงเป้าหมาย */
    async function applyAdjustmentsToBookTargets(cycleId, targetsBySku, { notePrefix = 'import_excel' } = {}) {
        const client = getClient();
        if (!client || !cycleId) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        const entries = Object.entries(targetsBySku || {})
            .map(([sku, qty]) => ({ skuId: normalizeSku(sku), targetEffective: Number(qty) }))
            .filter(e => e.skuId && Number.isFinite(e.targetEffective));
        if (!entries.length) return { applied: 0, skippedZero: 0, results: [] };

        const skuIds = [...new Set(entries.map(e => e.skuId))];
        await clearAdjustmentsAndMatchAcceptancesForSkus(cycleId, skuIds);

        const preview = await previewAdjustmentsToBookTargets(cycleId, targetsBySku);

        const items = [];
        let skippedZero = 0;
        const EPS = 1e-6;
        const previewBySku = new Map(preview.map(p => [p.skuId, p]));

        for (const e of entries) {
            const p = previewBySku.get(e.skuId);
            const adjustmentQty = p ? p.requiredAdjustmentQty : 0;
            if (Math.abs(adjustmentQty) < EPS) {
                skippedZero++;
                continue;
            }
            items.push({
                cycleId,
                skuId: e.skuId,
                adjustmentQty,
                varianceBefore: p ? (p.currentEffective - p.countedQty) : null,
                reason: 'reconcile',
                note: `${notePrefix}: target=${e.targetEffective}`
            });
        }

        let inserted = [];
        if (items.length) inserted = await createStockAdjustmentsBatch(items);

        let applied = 0;
        const results = [];
        for (let i = 0; i < inserted.length; i++) {
            await applyStockAdjustment(inserted[i].id);
            applied++;
            const p = previewBySku.get(inserted[i].sku_id);
            results.push({
                skuId: inserted[i].sku_id,
                targetEffective: entries.find(x => x.skuId === inserted[i].sku_id)?.targetEffective,
                adjustmentQty: Number(inserted[i].adjustment_qty),
                statusAfter: p?.statusAfter || 'match'
            });
        }

        await refreshReconciliation(cycleId);
        return { applied, skippedZero, results };
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



    window.reconcileService = {

        ACTIVE_CYCLE_KEY,

        ALL_WAREHOUSES,

        STANDARD_WAREHOUSES,

        getClient,

        escapeHtml,

        parseYearMonth,

        yearMonthToRangeISO,

        isAllWarehousesCycle,

        WAREHOUSE_MULTI_SEP,

        parseCycleWarehouses,

        encodeCycleWarehouses,

        isMultiWarehouseCycle,

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

        attachCycleToPayload,

        checkSchemaReady,

        fetchCycles,

        fetchCycleById,

        createCycle,

        updateCycleStatus,

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

        fetchSkuMasterNamesBySkus,

        countLinkedInventory,

        previewLinkInventoryCounts,

        fetchLinkableInventoryRows,

        linkInventoryCountsToCycle,

        importBookStockLines,

        importBookStockLinesMerge,

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

        acceptCountedQtyAsMatch,

        fetchMatchAcceptanceMap,

        acceptReconciliationAsMatch,

        clearAdjustmentsAndMatchAcceptancesForSkus,

        fetchBookQtySums,

        previewAdjustmentsToBookTargets,

        applyAdjustmentsToBookTargets,

        deleteDraftAdjustment,

        formatCycleLabel,

        statusLabel

    };

})();


