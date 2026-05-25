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



        return {

            rows: items,

            validRows: items.filter(r => r.valid),

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



    async function importBookStockLines(cycleId, validRows, fileName, { replaceExisting = true } = {}) {

        const client = getClient();

        if (!validRows.length) throw new Error('ไม่มีแถวที่นำเข้าได้');



        if (replaceExisting) {

            const { error: delErr } = await client

                .from('book_stock_lines')

                .delete()

                .eq('cycle_id', cycleId);

            if (delErr) throw delErr;

        }



        const payloads = validRows.map(r => ({

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



        await client

            .from('count_cycles')

            .update({

                book_source: fileName || null,

                book_imported_at: new Date().toISOString(),

                updated_at: new Date().toISOString()

            })

            .eq('id', cycleId);



        return inserted;

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

            reason: reason || 'manual',

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

                reason: item.reason || 'reconcile',

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

        deleteCycle,

        parseBookExcelRows,

        countBookLines,

        countLinkedInventory,

        previewLinkInventoryCounts,

        fetchLinkableInventoryRows,

        linkInventoryCountsToCycle,

        importBookStockLines,

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

        deleteDraftAdjustment,

        formatCycleLabel,

        statusLabel

    };

})();


