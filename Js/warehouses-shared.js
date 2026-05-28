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

    function nextSortOrder(rows) {
        const active = (rows || []).filter(r => r.is_active !== false);
        if (!active.length) return 0;
        // ไม่นับ sort_order 999+ จากข้อมูลเก่า sync มา
        const managed = active
            .map(r => Number(r.sort_order))
            .filter(n => Number.isFinite(n) && n < 900);
        if (managed.length) return Math.max(...managed) + 1;
        return active.length;
    }

    async function compactActiveSortOrders(client) {
        const rows = await fetchRegistryRows(client);
        const active = rows
            .filter(r => r.is_active !== false)
            .sort((a, b) => {
                const d = (Number(a.sort_order) || 999) - (Number(b.sort_order) || 999);
                return d !== 0 ? d : a.name.localeCompare(b.name, 'th');
            });
        await Promise.all(active.map((row, index) => {
            if (Number(row.sort_order) === index) return Promise.resolve();
            return client.from('warehouses').update({ sort_order: index }).eq('name', row.name);
        }));
    }

    function notifyWarehouseRegistryChanged() {
        window.dispatchEvent(new CustomEvent('warehouseRegistryChanged'));
    }

    function invalidateCache() {
        cacheRows = [];
        cacheAt = 0;
    }

    async function fetchRegistryRows(client) {
        const { data, error } = await client
            .from('warehouses')
            .select('name, sort_order, is_active')
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true });
        if (error) throw error;
        return (data || []).map(r => ({
            name: normalizeName(r.name),
            sort_order: Number(r.sort_order) || 999,
            is_active: r.is_active !== false
        })).filter(r => !!r.name);
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

        /** @type {Array<{name:string, sort_order:number, is_active:boolean}>} */
        let rows = [];
        try {
            rows = await fetchRegistryRows(client);
        } catch (err) {
            if (!/warehouses|does not exist|schema cache/i.test(String(err?.message || ''))) {
                console.warn('[WarehouseService] fetch warehouses failed:', err?.message || err);
            }
        }

        // ใช้เฉพาะตาราง warehouses — ไม่ดึงชื่อจากข้อมูลเก่า (sku_master ฯลฯ)
        // เพื่อไม่ให้รายการที่ลบจาก registry กลับมาแสดงบนหน้าเว็บ
        if (!rows.length) {
            rows = FALLBACK_WAREHOUSES.map((name, i) => ({ name, sort_order: i, is_active: true }));
        }

        cacheRows = rows;
        cacheAt = now;
        return [...cacheRows];
    }

    async function getWarehouseList(opts = {}) {
        const rows = await fetchWarehouses(opts);
        return rows.filter(r => r.is_active !== false).map(r => r.name);
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

        const rows = await fetchRegistryRows(client);
        const sortOrder = nextSortOrder(rows);
        const { error } = await client
            .from('warehouses')
            .upsert([{ name: value, sort_order: sortOrder, is_active: true }], { onConflict: 'name' });
        if (error) throw error;
        await compactActiveSortOrders(client);
        invalidateCache();
        await fetchWarehouses({ force: true });
        notifyWarehouseRegistryChanged();
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
        await compactActiveSortOrders(client);
        invalidateCache();
        await fetchWarehouses({ force: true });
        notifyWarehouseRegistryChanged();
    }

    async function deleteWarehouse(name) {
        const value = normalizeName(name);
        if (!value) throw new Error('ไม่พบชื่อคลัง');
        const client = getClient();
        if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        const { error } = await client
            .from('warehouses')
            .update({ is_active: false })
            .eq('name', value);
        if (error) throw error;
        await compactActiveSortOrders(client);
        invalidateCache();
        await fetchWarehouses({ force: true });
        notifyWarehouseRegistryChanged();
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function fetchRegistryWarehouses(opts = {}) {
        return fetchWarehouses(opts);
    }

    window.warehouseService = {
        fetchWarehouses,
        fetchRegistryWarehouses,
        getWarehouseList,
        populateSelect,
        renderCheckboxGroup,
        addWarehouse,
        setWarehouseActive,
        deleteWarehouse,
        invalidateCache,
        compactActiveSortOrders: async () => {
            const client = getClient();
            if (!client) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
            await compactActiveSortOrders(client);
            invalidateCache();
            await fetchWarehouses({ force: true });
            notifyWarehouseRegistryChanged();
        }
    };
})();
