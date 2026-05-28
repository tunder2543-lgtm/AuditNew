// =============================================================================
//  Warehouses Shared Service
//  แหล่งข้อมูลคลังกลางจาก Supabase table: warehouses
// =============================================================================

(function () {
    const CACHE_TTL_MS = 30000;
    const FALLBACK_WAREHOUSES = ['ตึกกันตนา', 'หน้าไลฟ์(บางกรวย)', 'คลังอะไหล่'];

    let cacheRows = [];
    let cacheAt = 0;

    function getClient() {
        return window.apiService?.getClient?.() || null;
    }

    function normalizeName(value) {
        return String(value || '').trim();
    }

    function uniqueNames(names) {
        const out = [];
        const seen = new Set();
        (names || []).forEach(raw => {
            const name = normalizeName(raw);
            if (!name) return;
            const key = name.toUpperCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(name);
        });
        return out;
    }

    async function fetchDistinctWarehousesFromData(client) {
        const names = [];
        const collect = (rows, field) => {
            (rows || []).forEach(r => {
                const val = normalizeName(r?.[field]);
                if (val) names.push(val);
            });
        };

        try {
            const [{ data: skuData }, { data: invData }, { data: cycData }] = await Promise.all([
                client.from('sku_master').select('warehouse').limit(1000),
                client.from('inventory_counts').select('warehouse').limit(1000),
                client.from('count_cycles').select('warehouse').limit(1000)
            ]);
            collect(skuData, 'warehouse');
            collect(invData, 'warehouse');
            collect(cycData, 'warehouse');
        } catch (err) {
            console.warn('[WarehouseService] fallback distinct fetch failed:', err?.message || err);
        }

        return uniqueNames(names);
    }

    async function fetchWarehouses(opts = {}) {
        const force = !!opts.force;
        const now = Date.now();
        if (!force && cacheRows.length && now - cacheAt < CACHE_TTL_MS) {
            return [...cacheRows];
        }

        const client = getClient();
        if (!client) {
            cacheRows = FALLBACK_WAREHOUSES.map((name, i) => ({ name, sort_order: i, is_active: true }));
            cacheAt = now;
            return [...cacheRows];
        }

        let rows = [];
        try {
            const { data, error } = await client
                .from('warehouses')
                .select('name, sort_order, is_active')
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true });
            if (error) throw error;
            rows = (data || []).map(r => ({
                name: normalizeName(r.name),
                sort_order: Number(r.sort_order) || 999,
                is_active: r.is_active !== false
            })).filter(r => !!r.name);
        } catch (err) {
            if (!/warehouses|does not exist|schema cache/i.test(String(err?.message || ''))) {
                console.warn('[WarehouseService] fetch warehouses failed:', err?.message || err);
            }
        }

        const base = rows.map(r => r.name);
        const fromData = await fetchDistinctWarehousesFromData(client);
        const merged = uniqueNames([...base, ...fromData, ...FALLBACK_WAREHOUSES]);

        cacheRows = merged.map((name, i) => ({ name, sort_order: i, is_active: true }));
        cacheAt = now;
        return [...cacheRows];
    }

    async function getWarehouseList(opts = {}) {
        const rows = await fetchWarehouses(opts);
        return rows.map(r => r.name);
    }

    async function populateSelect(selectEl, opts = {}) {
        if (!selectEl) return [];
        const includeAll = !!opts.includeAll;
        const allLabel = opts.allLabel || 'ทุกคลัง';
        const selected = normalizeName(opts.selected);

        const names = await getWarehouseList();
        const options = [];
        if (includeAll) {
            options.push(`<option value="">${allLabel}</option>`);
        }
        names.forEach(name => {
            options.push(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
        });
        selectEl.innerHTML = options.join('');
        if (selected) {
            const exists = names.includes(selected);
            selectEl.value = exists ? selected : (includeAll ? '' : names[0] || '');
        } else if (!includeAll && names.length && !selectEl.value) {
            selectEl.value = names[0];
        }
        return names;
    }

    async function renderCheckboxGroup(containerEl, opts = {}) {
        if (!containerEl) return [];
        const className = opts.nameClass || 'wh-chk';
        const checked = uniqueNames(opts.checked || []);
        const names = await getWarehouseList();
        containerEl.innerHTML = names.map((name, idx) => {
            const on = checked.includes(name) || (!checked.length && idx === 0);
            return `<label><input type="checkbox" class="${className}" value="${escapeHtml(name)}"${on ? ' checked' : ''}> ${escapeHtml(name)}</label>`;
        }).join('');
        return names;
    }

    async function addWarehouse(name) {
        const value = normalizeName(name);
        if (!value) throw new Error('กรุณาระบุชื่อคลัง');
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

        const rows = await fetchWarehouses({ force: true });
        const maxOrder = rows.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0);
        const { error } = await client
            .from('warehouses')
            .upsert([{ name: value, sort_order: maxOrder + 1, is_active: true }], { onConflict: 'name' });
        if (error) throw error;
        await fetchWarehouses({ force: true });
        return value;
    }

    async function setWarehouseActive(name, isActive) {
        const value = normalizeName(name);
        if (!value) throw new Error('ไม่พบชื่อคลัง');
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        const { error } = await client
            .from('warehouses')
            .update({ is_active: !!isActive })
            .eq('name', value);
        if (error) throw error;
        await fetchWarehouses({ force: true });
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    window.warehouseService = {
        fetchWarehouses,
        getWarehouseList,
        populateSelect,
        renderCheckboxGroup,
        addWarehouse,
        setWarehouseActive
    };
})();
