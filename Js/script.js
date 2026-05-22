// ==========================================
//  Count_Stock — script.js
//  Supabase URL/KEY อ่านจาก localStorage
//  + SKU Autocomplete จาก Table sku_master
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    // =============================================
    //  SUPABASE INIT
    // =============================================
    let supabaseClient = null;
    let skuMasterList  = []; // Cache SKU list { sku_name, name_pro, warehouse } ตามคลังที่เลือก
    let allRecords     = []; // Cache inventory_counts records for audit log context
    let supabaseDataLoaded = false;

    const STANDARD_WAREHOUSES = ['ตึกกันตนา', 'หน้าไลฟ์(บางกรวย)', 'คลังอะไหล่'];

    function initSupabase() {
        if (!window.apiService) {
            console.error('apiService not found! Please check api.js import.');
            updateBadge(false);
            return false;
        }
        
        supabaseClient = window.apiService.getClient();
        
        if (supabaseClient) {
            console.log('[Supabase] Client initialized ✓');
            updateBadge(true);
            if (!supabaseDataLoaded) {
                supabaseDataLoaded = true;
                loadAllData();
            }
            return true;
        } else {
            console.error('[Supabase] Init failed or not configured');
            updateBadge(false);
            return false;
        }
    }

    // =============================================
    //  CONNECTION BADGE
    // =============================================
    function updateBadge(connected) {
        if (typeof window.updateConnectionBadge === 'function') {
            window.updateConnectionBadge(connected);
            return;
        }
        const badge = document.getElementById('connectionBadge');
        const icon  = document.getElementById('badgeIcon');
        const text  = document.getElementById('badgeText');
        if (!badge) return;
        if (connected) {
            badge.className = 'connection-badge badge-connected connection-badge-status';
            if (icon) icon.setAttribute('data-lucide', 'wifi');
            if (text) text.textContent = 'เชื่อมต่อแล้ว';
        } else {
            badge.className = 'connection-badge badge-disconnected connection-badge-status';
            if (icon) icon.setAttribute('data-lucide', 'wifi-off');
            if (text) text.textContent = 'ไม่ได้เชื่อมต่อ';
        }
        lucide.createIcons();
    }

    // =============================================
    //  LIVE CLOCK
    // =============================================
    function updateClock() {
        const clockEl = document.getElementById('liveClock');
        const subtitleEl = document.getElementById('monthSubtitle');
        if (!clockEl) return;
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = now.toLocaleDateString('th-TH', options);
        const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        clockEl.innerHTML = `<span style="font-size: 0.9em;">${dateStr}</span> <span style="color: var(--primary); margin-left: 0.5rem;">${timeStr}</span>`;
        
        if (subtitleEl) {
            const currentMonth = now.toLocaleDateString('th-TH', { month: 'long' });
            subtitleEl.textContent = `นับสต็อกเดือน${currentMonth}`;
        }
    }
    setInterval(updateClock, 1000);
    updateClock();

    // =============================================
    //  INITIAL DATA LOADING (SKU Master + Existing Records)
    // =============================================
    async function loadAllData() {
        await loadSkuMaster();
        await loadExistingRecords();
    }

    function getActiveWarehouse() {
        if (!warehouseInput) return '';
        if (warehouseInput.value === 'custom') {
            return warehouseCustom ? warehouseCustom.value.trim() : '';
        }
        return (warehouseInput.value || '').trim();
    }

    function filterRecordsByWarehouse(records) {
        const wh = getActiveWarehouse();
        if (!wh) return records || [];
        return (records || []).filter(r => String(r.warehouse || '').trim() === wh);
    }

    function getWarehouseScopedRecords() {
        return filterRecordsByWarehouse(allRecords);
    }

    async function loadSkuMaster() {
        if (!supabaseClient) return;
        const wh = getActiveWarehouse();
        try {
            let allRows = [];
            let from = 0;
            const PAGE = 1000;
            while (true) {
                let query = supabaseClient
                    .from('sku_master')
                    .select('sku_name, name_pro, warehouse')
                    .order('sku_name', { ascending: true });
                if (wh) query = query.eq('warehouse', wh);
                const { data, error } = await query.range(from, from + PAGE - 1);
                if (error) throw error;
                allRows = allRows.concat(data || []);
                if (!data || data.length < PAGE) break;
                from += PAGE;
            }
            skuMasterList = allRows;
            console.log(`[SKU Master] Loaded ${skuMasterList.length} items (${wh || 'ทุกคลัง'}) ✓`);
        } catch (err) {
            console.warn('[SKU Master] Load failed:', err.message);
            skuMasterList = [];
        }
    }

    async function onWarehouseContextChanged() {
        hideSkuInfo();
        if (skuDropdown) skuDropdown.style.display = 'none';
        activeDropIdx = -1;
        await loadSkuMaster();
        await loadExistingRecords();
        updateStats();
    }

    async function loadPagedInventoryCounts() {
        if (!supabaseClient) return [];
        const wh = getActiveWarehouse();
        let rows = [];
        let from = 0;
        const PAGE = 1000;
        while (true) {
            let query = supabaseClient
                .from('inventory_counts')
                .select('*')
                .order('created_at', { ascending: false });
            if (wh) query = query.eq('warehouse', wh);
            const { data, error } = await query.range(from, from + PAGE - 1);
            if (error) throw error;
            rows = rows.concat(data || []);
            if (!data || data.length < PAGE) break;
            from += PAGE;
        }
        return rows;
    }

    function recordBelongsToActiveWarehouse(rec) {
        const wh = getActiveWarehouse();
        if (!wh) return true;
        return String(rec?.warehouse || '').trim() === wh;
    }

    function normalizeSkuKey(value) {
        return String(value || '').toLowerCase().trim();
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isTodayInThailand(isoString) {
        if (!isoString) return false;
        const thaiDate = new Date(isoString).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        return thaiDate === today;
    }

    function renderRecentRecordsList(records) {
        const listEl = document.getElementById('recordList');
        if (!listEl) return;
        if (!records || records.length === 0) {
            listEl.innerHTML = `
                <li class="empty-state">
                    <i data-lucide="package-open" style="width:48px;height:48px;stroke-width:1;"></i>
                    <p>ยังไม่มีรายการบันทึกในเซสชันนี้</p>
                </li>`;
            lucide.createIcons();
            return;
        }

        listEl.innerHTML = records.map(row => {
            const found = skuMasterList.find(s => normalizeSkuKey(s.sku_name) === normalizeSkuKey(row.sku_id));
            const proName = found ? found.name_pro : '';
            return `
                <li class="record-item" id="record-${row.id}">
                    <div class="record-main">
                        <span class="record-sku">${row.sku_id}</span>
                        ${proName ? `<span class="record-pro-name">${proName}</span>` : ''}
                        <span class="record-loc" id="loc-${row.id}">
                            <i data-lucide="warehouse"></i> ${escapeHtml(row.warehouse || '-')} &nbsp;|&nbsp;
                            <i data-lucide="map-pin"></i> ${escapeHtml(row.location || '-')}
                        </span>
                    </div>
                    <div class="record-actions" style="display: flex; gap: 0.5rem; align-items: center;">
                        <span class="record-qty" id="qty-${row.id}">+${row.counted_qty}</span>
                        <button class="icon-btn" onclick="openEditModal('${row.id}')" title="แก้ไขรายการ" style="padding: 0.25rem; color: var(--text-muted);">
                            <i data-lucide="edit-2" style="width: 16px; height: 16px;"></i>
                        </button>
                        <button class="icon-btn" onclick="openDeleteModal('${row.id}', '${row.sku_id}', ${row.counted_qty})" title="ลบรายการ" style="padding: 0.25rem; color: #ef4444;">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </li>`;
        }).join('');
        lucide.createIcons();
    }

    async function loadExistingRecords() {
        if (!supabaseClient) return;
        try {
            const data = await loadPagedInventoryCounts();
            allRecords = data;
            console.log(`[Inventory Counts] Loaded ${allRecords.length} records ✓`);
            renderRecentRecordsList(getWarehouseScopedRecords().slice(0, MAX_RECENT_RECORDS));
            updateStats();
        } catch (err) {
            console.warn('[Existing Records] Load failed:', err.message);
        }
    }

    // Filter SKU จาก cache
    function searchSku(query) {
        if (!query || query.length < 1) return [];
        const q = query.toLowerCase();
        return skuMasterList
            .filter(item =>
                (item.sku_name || '').toLowerCase().includes(q) ||
                (item.name_pro || '').toLowerCase().includes(q)
            )
            .slice(0, 8); // แสดงสูงสุด 8 รายการ
    }

    // =============================================
    //  DOM ELEMENTS
    // =============================================
    const form             = document.getElementById('stockForm');
    const counterNameInput = document.getElementById('counter_name');
    const warehouseInput   = document.getElementById('warehouse');
    const locationInput    = document.getElementById('location');
    const skuInput         = document.getElementById('sku');
    const quantityInput    = document.getElementById('quantity');
    const submitBtn        = document.getElementById('submitBtn');
    const recordList       = document.getElementById('recordList');
    const totalScannedEl   = document.getElementById('totalScanned');
    const clearListBtn     = document.getElementById('clearList');
    const toastContainer   = document.getElementById('toastContainer');
    const skuDropdown      = document.getElementById('skuDropdown');
    const skuNameTag       = document.getElementById('skuNameTag');
    const skuNameText      = document.getElementById('skuNameText');
    const skuNotFound      = document.getElementById('skuNotFound');

    const MAX_RECENT_RECORDS = 100;
    let activeDropIdx = -1; // keyboard nav index
    let dashboardChart = null;
    let exportMenuVisible = false;
    let dashboardFilters = { counter: '', startDate: '', endDate: '' };
    let dashboardRecordsCache = [];

    // Restore context
    if (localStorage.getItem('saved_counter_name')) counterNameInput.value = localStorage.getItem('saved_counter_name');
    if (localStorage.getItem('saved_location'))     locationInput.value     = localStorage.getItem('saved_location');

    const warehouseCustom = document.getElementById('warehouseCustom');
    const warehouseCustomContainer = document.getElementById('warehouseCustomContainer');
    const savedWarehouse = localStorage.getItem('saved_warehouse');

    window.resetWarehouseSelect = function() {
        if (warehouseInput && warehouseCustomContainer) {
            warehouseCustomContainer.style.display = 'none';
            warehouseInput.style.display = 'block';
            warehouseInput.value = 'ตึกกันตนา';
            if (warehouseCustom) warehouseCustom.value = '';
            onWarehouseContextChanged();
        }
    };

    if (savedWarehouse && warehouseInput) {
        if (STANDARD_WAREHOUSES.includes(savedWarehouse)) {
            warehouseInput.value = savedWarehouse;
            if (warehouseCustomContainer) warehouseCustomContainer.style.display = 'none';
            warehouseInput.style.display = 'block';
        } else {
            warehouseInput.value = 'custom';
            warehouseInput.style.display = 'none';
            if (warehouseCustomContainer) {
                warehouseCustomContainer.style.display = 'block';
                if (warehouseCustom) warehouseCustom.value = savedWarehouse;
            }
        }
    }

    if (warehouseInput) {
        warehouseInput.addEventListener('change', async () => {
            if (warehouseInput.value === 'custom') {
                warehouseInput.style.display = 'none';
                if (warehouseCustomContainer) {
                    warehouseCustomContainer.style.display = 'block';
                    if (warehouseCustom) warehouseCustom.focus();
                }
                return;
            }
            localStorage.setItem('saved_warehouse', warehouseInput.value);
            await onWarehouseContextChanged();
        });
    }

    if (warehouseCustom) {
        warehouseCustom.addEventListener('change', async () => {
            const wh = warehouseCustom.value.trim();
            if (wh) {
                if (!STANDARD_WAREHOUSES.includes(wh)) {
                    showToast('ชื่อคลังไม่ตรง 3 คลังมาตรฐาน — ข้อมูลอาจแยกจากรายงานหลัก', 'error');
                }
                localStorage.setItem('saved_warehouse', wh);
            }
            await onWarehouseContextChanged();
        });
    }

    if (savedWarehouse && !STANDARD_WAREHOUSES.includes(savedWarehouse) && warehouseInput?.value === 'custom') {
        console.warn('[Warehouse] ใช้ชื่อคลังนอกมาตรฐาน:', savedWarehouse);
    }

    // Smart focus
    if (!counterNameInput.value)      counterNameInput.focus();
    else if (!warehouseInput.value)   warehouseInput.focus();
    else if (!locationInput.value)    locationInput.focus();
    else                              skuInput.focus();

    // =============================================
    //  SKU INPUT — Autocomplete Events
    // =============================================
    skuInput.addEventListener('input', () => {
        const val = skuInput.value.trim();
        activeDropIdx = -1;

        // ซ่อน name tag ขณะพิมพ์ใหม่
        hideSkuInfo();

        if (val.length === 0) {
            closeDropdown();
            return;
        }

        const results = searchSku(val);
        if (results.length > 0) {
            renderDropdown(results);
        } else {
            closeDropdown();
        }
    });

    // Keyboard navigation
    skuInput.addEventListener('keydown', (e) => {
        const items = skuDropdown.querySelectorAll('.sku-drop-item');
        if (skuDropdown.style.display === 'none' || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeDropIdx = Math.min(activeDropIdx + 1, items.length - 1);
            highlightItem(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeDropIdx = Math.max(activeDropIdx - 1, 0);
            highlightItem(items);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (activeDropIdx >= 0 && items[activeDropIdx]) {
                e.preventDefault();
                items[activeDropIdx].click();
            }
        } else if (e.key === 'Escape') {
            closeDropdown();
        }
    });

    // ปิด dropdown เมื่อคลิกข้างนอก
    document.addEventListener('click', (e) => {
        if (!skuInput.contains(e.target) && !skuDropdown.contains(e.target)) {
            closeDropdown();
            validateSkuOnBlur();
        }
    });

    skuInput.addEventListener('blur', () => {
        // Delay เล็กน้อยเพื่อให้ click dropdown ทำงานก่อน
        setTimeout(() => {
            if (document.activeElement !== skuInput) validateSkuOnBlur();
        }, 200);
    });

    function renderDropdown(results) {
        skuDropdown.innerHTML = results.map((item, i) => {
            const skuHtml  = highlightMatch(item.sku_name  || '', skuInput.value);
            const nameHtml = highlightMatch(item.name_pro  || '', skuInput.value);
            return `
                <div class="sku-drop-item" data-sku="${item.sku_name}" data-name="${item.name_pro}" data-idx="${i}">
                    <span class="drop-sku">${skuHtml}</span>
                    <span class="drop-name">${nameHtml}</span>
                </div>
            `;
        }).join('');

        skuDropdown.querySelectorAll('.sku-drop-item').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault(); // ป้องกัน blur ก่อน click
                selectSku(el.dataset.sku, el.dataset.name);
            });
        });

        skuDropdown.style.display = 'block';
    }

    function highlightMatch(text, query) {
        if (!query) return escHtml(text);
        const regex = new RegExp(`(${escRegex(query)})`, 'gi');
        return escHtml(text).replace(regex, '<mark>$1</mark>');
    }

    function highlightItem(items) {
        items.forEach((el, i) => {
            el.classList.toggle('active', i === activeDropIdx);
            if (i === activeDropIdx) el.scrollIntoView({ block: 'nearest' });
        });
    }

    function selectSku(sku, name) {
        skuInput.value = sku;
        closeDropdown();
        showSkuName(name);
        quantityInput.focus();
    }

    function showSkuName(name) {
        skuNameTag.style.display = 'flex';
        skuNameText.textContent  = name;
        skuNotFound.style.display = 'none';
        lucide.createIcons();
    }

    function hideSkuInfo() {
        skuNameTag.style.display  = 'none';
        skuNotFound.style.display = 'none';
        skuNameText.textContent   = '';
    }

    function closeDropdown() {
        skuDropdown.style.display = 'none';
        skuDropdown.innerHTML     = '';
        activeDropIdx = -1;
    }

    function validateSkuOnBlur() {
        const val = skuInput.value.trim();
        if (!val) return;
        // ถ้า name tag ยังไม่แสดง ให้ตรวจสอบว่า SKU ตรงกับ list ไหม
        if (skuNameTag.style.display === 'none') {
            const found = skuMasterList.find(
                item => (item.sku_name || '').toLowerCase() === val.toLowerCase()
            );
            if (found) {
                showSkuName(found.name_pro);
            } else if (skuMasterList.length > 0) {
                // มี list แล้วแต่ไม่เจอ → แสดง warning (ยังบันทึกได้)
                skuNotFound.style.display = 'flex';
                skuNameTag.style.display  = 'none';
                lucide.createIcons();
            }
        }
    }

    // Helpers
    function escHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function escRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async function logAudit(actionType, recordId, sku, oldQty, newQty, warehouse, location, counterName) {
        if (!supabaseClient) return;
        try {
            await supabaseClient.from('inventory_audit_logs').insert([{
                action_type: actionType,
                record_id: String(recordId),
                sku_id: sku,
                old_qty: oldQty,
                new_qty: newQty,
                warehouse: warehouse || '',
                location: location || '',
                counter_name: counterName || document.getElementById('counter_name')?.value || 'Unknown'
            }]);
        } catch (err) {
            console.warn('[Audit Log] Failed to log action:', err.message);
        }
    }

    // =============================================
    //  MODE SWITCH & GROUP LOGIC
    // =============================================
    let currentMode = 'group';
    let groupItems = [];
    let isGroupSubmitting = false;
    let groupSubmitPromise = null;
    let isSingleSubmitting = false;
    const maxGroupItems = 25;

    window.setMode = function(mode) {
        currentMode = mode;
        const btnSingle = document.getElementById('btnModeSingle');
        const btnGroup = document.getElementById('btnModeGroup');
        const singleAction = document.getElementById('singleActionGroup');
        const groupAction = document.getElementById('groupActionGroup');
        const groupContainer = document.getElementById('groupContainer');

        if (mode === 'single') {
            btnSingle.classList.add('active');
            btnGroup.classList.remove('active');
            singleAction.style.display = 'block';
            groupAction.style.display = 'none';
            groupContainer.style.display = 'none';
            if (submitBtn) submitBtn.type = 'submit';
        } else {
            btnGroup.classList.add('active');
            btnSingle.classList.remove('active');
            singleAction.style.display = 'none';
            groupAction.style.display = 'block';
            groupContainer.style.display = 'block';
            if (submitBtn) submitBtn.type = 'button';
        }
    };

    setMode('group');

    window.addGroupItem = function() {
        if (groupItems.length >= maxGroupItems) {
            showToast(`ไม่สามารถเพิ่มได้เกิน ${maxGroupItems} รายการใน 1 กลุ่ม`, 'error');
            return;
        }

        const sku = skuInput.value.trim();
        const quantity = parseInt(quantityInput.value.trim(), 10);
        let proName = skuNameText.textContent || '';
        if (!proName) proName = 'ไม่พบชื่อรหัสสินค้า';

        if (!sku || Number.isNaN(quantity) || quantity < 0) {
            showToast('กรุณาระบุรหัสสินค้าและจำนวน (0 ขึ้นไป)', 'error');
            return;
        }

        groupItems.unshift({ sku, quantity, name: proName });
        renderGroupList();
        
        // เคลียร์ค่า input
        skuInput.value = '';
        quantityInput.value = '1';
        hideSkuInfo();
        closeDropdown();
        skuInput.focus();
    };

    window.removeGroupItem = function(index) {
        groupItems.splice(index, 1);
        renderGroupList();
    };

    function renderGroupList() {
        const groupList = document.getElementById('groupList');
        const groupCountText = document.getElementById('groupCountText');
        const submitGroupBtn = document.getElementById('submitGroupBtn');
        const addGroupBtn = document.getElementById('addGroupBtn');

        groupCountText.textContent = `(${groupItems.length}/${maxGroupItems})`;

        if (groupItems.length === 0) {
            groupList.innerHTML = `
                <div class="empty-state" style="padding: 1.5rem 1rem;" id="groupEmptyState">
                    <i data-lucide="layers" style="width: 32px; height: 32px;"></i>
                    <p style="font-size: 0.85rem;">ยังไม่มีรายการในกลุ่ม</p>
                </div>`;
            submitGroupBtn.disabled = true;
            addGroupBtn.disabled = false;
        } else {
            groupList.innerHTML = groupItems.map((item, idx) => `
                <div class="record-item" style="padding: 0.75rem 1rem; margin-bottom: 0;">
                    <div class="record-main" style="flex-direction: row; justify-content: space-between; align-items: center; width: 100%;">
                        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                            <span class="record-sku">${item.sku}</span>
                            ${item.name ? `<span class="record-pro-name" style="font-size: 0.75rem;">${item.name}</span>` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <span class="record-qty" style="padding: 0.25rem 0.75rem; font-size: 0.9rem;">+${item.quantity}</span>
                            <button type="button" class="icon-btn" onclick="removeGroupItem(${idx})" style="padding: 0.2rem; color: var(--danger);">
                                <i data-lucide="x" style="width: 16px; height: 16px;"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');
            
            submitGroupBtn.disabled = false;
            addGroupBtn.disabled = groupItems.length >= maxGroupItems;
        }
        lucide.createIcons();
    }

    window.submitGroup = async function() {
        if (groupSubmitPromise) return groupSubmitPromise;

        if (!supabaseClient) { initSupabase(); }
        if (!supabaseClient) {
            showToast('กรุณาตั้งค่า Supabase URL/KEY ก่อน', 'error');
            goToSettingsPage();
            return;
        }

        const counter_name = counterNameInput.value.trim();
        const warehouse    = (warehouseInput.value === 'custom' ? document.getElementById('warehouseCustom').value.trim() : warehouseInput.value.trim());
        const location     = locationInput.value.trim();

        if (!counter_name || !warehouse || !location) {
            showToast('กรุณาระบุชื่อผู้นับ, คลัง และตำแหน่งให้ครบถ้วน', 'error');
            return;
        }

        const snapshot = [...groupItems];
        if (snapshot.length === 0) {
            showToast('ไม่มีรายการสินค้าให้ส่งออก', 'error');
            return;
        }

        const submitGroupBtn = document.getElementById('submitGroupBtn');
        const itemCount = snapshot.length;

        groupSubmitPromise = (async () => {
            isGroupSubmitting = true;
            submitGroupBtn.disabled = true;
            const orig = submitGroupBtn.innerHTML;
            submitGroupBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> กำลังส่งข้อมูล...`;
            lucide.createIcons();

            try {
                const reversedItems = [...snapshot].reverse();

                const payloads = reversedItems.map(item => ({
                    warehouse,
                    location,
                    sku_id: item.sku,
                    counted_qty: item.quantity,
                    counter_name
                }));

                const { data, error } = await supabaseClient
                    .from('inventory_counts')
                    .insert(payloads)
                    .select();

                if (error) throw error;

                groupItems = [];
                renderGroupList();

                let totalQtyInGroup = 0;
                const insertedRows = data && data.length > 0 ? data : [];
                const bySku = new Map();
                insertedRows.forEach(row => {
                    const key = normalizeSkuKey(row.sku_id);
                    if (!bySku.has(key)) bySku.set(key, []);
                    bySku.get(key).push(row);
                });

                const groupSkuDetails = reversedItems.map(item => `${item.sku} (x${item.quantity})`).join(', ');

                reversedItems.forEach(originalItem => {
                    const key = normalizeSkuKey(originalItem.sku);
                    const queue = bySku.get(key);
                    const row = queue && queue.length ? queue.shift() : null;
                    const insertedId = row ? row.id : null;
                    if (!insertedId) return;

                    allRecords.unshift({
                        id: insertedId,
                        sku_id: originalItem.sku,
                        counted_qty: originalItem.quantity,
                        warehouse: warehouse,
                        location: location,
                        counter_name: counter_name,
                        created_at: row.created_at || new Date().toISOString()
                    });

                    addRecord(insertedId, originalItem.sku, originalItem.name, originalItem.quantity, location, warehouse);
                    totalQtyInGroup += originalItem.quantity;
                });

                logAudit('GROUP_INSERT', 'multiple', groupSkuDetails, null, totalQtyInGroup, warehouse, location, counter_name);

                localStorage.setItem('saved_counter_name', counter_name);
                localStorage.setItem('saved_warehouse', warehouse);
                localStorage.setItem('saved_location', location);

                updateStats();

                showToast(`✓ บันทึกกลุ่มสำเร็จ ${itemCount} รายการ`, 'success');

                locationInput.value = '';
                localStorage.removeItem('saved_location');
                locationInput.focus();

            } catch (err) {
                console.error('[Insert Group Error]', err);
                groupItems = snapshot;
                renderGroupList();
                showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
                submitGroupBtn.disabled = false;
            } finally {
                isGroupSubmitting = false;
                groupSubmitPromise = null;
                submitGroupBtn.innerHTML = orig;
                if (groupItems.length === 0) {
                    submitGroupBtn.disabled = true;
                }
                lucide.createIcons();
            }
        })();

        return groupSubmitPromise;
    };

    // =============================================
    //  FORM SUBMIT
    // =============================================
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (currentMode === 'group') {
            addGroupItem();
            return;
        }

        // --- SINGLE MODE LOGIC ---
        if (!supabaseClient) { initSupabase(); }
        if (!supabaseClient) {
            showToast('กรุณาตั้งค่า Supabase URL/KEY ก่อน', 'error');
            goToSettingsPage();
            return;
        }

        const counter_name = counterNameInput.value.trim();
        const warehouse    = (warehouseInput.value === 'custom' ? document.getElementById('warehouseCustom').value.trim() : warehouseInput.value.trim());
        const location     = locationInput.value.trim();
        const sku          = skuInput.value.trim();
        const quantity     = parseInt(quantityInput.value.trim(), 10);
        let proName      = skuNameText.textContent || '';
        if (!proName) proName = 'ไม่พบชื่อรหัสสินค้า';

        if (!counter_name || !warehouse || !sku || Number.isNaN(quantity) || quantity < 0 || !location) {
            showToast('กรุณากรอกข้อมูลให้ครบทุกช่อง', 'error');
            return;
        }

        if (isSingleSubmitting) return;

        isSingleSubmitting = true;
        submitBtn.disabled = true;
        const orig = submitBtn.innerHTML;
        submitBtn.innerHTML = `<i data-lucide="loader-2"></i><span>กำลังบันทึก...</span>`;
        lucide.createIcons();

        try {
            const { data, error } = await supabaseClient
                .from('inventory_counts')
                .insert([{ warehouse, location, sku_id: sku, counted_qty: quantity, counter_name }])
                .select();
            if (error) throw error;

            const insertedId = data && data[0] ? data[0].id : Date.now();

            const insertedRow = data && data[0] ? data[0] : {};
            allRecords.unshift({
                id: insertedId,
                sku_id: sku,
                counted_qty: quantity,
                warehouse: warehouse,
                location: location,
                counter_name: counter_name,
                created_at: insertedRow.created_at || new Date().toISOString()
            });

            logAudit('INSERT', insertedId, sku, null, quantity, warehouse, location, counter_name);

            localStorage.setItem('saved_counter_name', counter_name);
            localStorage.setItem('saved_warehouse', warehouse);
            localStorage.setItem('saved_location', location);

            addRecord(insertedId, sku, proName, quantity, location, warehouse);
            updateStats();
            showToast(`✓ ${sku}${proName ? ' — ' + proName : ''} x${quantity} บันทึกแล้ว!`, 'success');

            // เคลียร์เฉพาะ SKU + qty
            skuInput.value      = '';
            quantityInput.value = '1';
            hideSkuInfo();
            closeDropdown();
            skuInput.focus();

        } catch (err) {
            console.error('[Insert Error]', err);
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
            updateBadge(false);
        } finally {
            isSingleSubmitting = false;
            submitBtn.disabled  = false;
            submitBtn.innerHTML = orig;
            lucide.createIcons();
        }
    });

    const submitGroupBtnEl = document.getElementById('submitGroupBtn');
    if (submitGroupBtnEl) {
        submitGroupBtnEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.submitGroup();
        });
    }

    // =============================================
    //  ADD RECORD TO LIST (with Edit/Delete Actions)
    // =============================================
    function trimRecentRecords() {
        const items = recordList.querySelectorAll('.record-item');
        for (let i = items.length - 1; i >= MAX_RECENT_RECORDS; i--) {
            if (items[i]) items[i].remove();
        }
    }

    function addRecord(id, sku, proName, quantity, location, warehouse) {
        const emptyState = recordList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        const li = document.createElement('li');
        li.className = 'record-item';
        li.id = `record-${id}`;
        li.innerHTML = `
            <div class="record-main">
                <span class="record-sku">${sku}</span>
                ${proName ? `<span class="record-pro-name">${proName}</span>` : ''}
                <span class="record-loc" id="loc-${id}">
                    <i data-lucide="warehouse"></i> ${escapeHtml(warehouse || '-')} &nbsp;|&nbsp;
                    <i data-lucide="map-pin"></i> ${escapeHtml(location || '-')}
                </span>
            </div>
            <div class="record-actions" style="display: flex; gap: 0.5rem; align-items: center;">
                <span class="record-qty" id="qty-${id}">+${quantity}</span>
                <button class="icon-btn" onclick="openEditModal('${id}')" title="แก้ไขรายการ" style="padding: 0.25rem; color: var(--text-muted);">
                    <i data-lucide="edit-2" style="width: 16px; height: 16px;"></i>
                </button>
                <button class="icon-btn" onclick="openDeleteModal('${id}', '${sku}', ${quantity})" title="ลบรายการ" style="padding: 0.25rem; color: #ef4444;">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </div>`;
        recordList.insertBefore(li, recordList.firstChild);
        trimRecentRecords();
        lucide.createIcons();
    }

    function updateStats() {
        const scopedRecords = getWarehouseScopedRecords();
        const allCountedSkus = new Set(scopedRecords.map(r => normalizeSkuKey(r.sku_id)).filter(Boolean));

        const todayRecords = scopedRecords.filter(r => isTodayInThailand(r.created_at));
        const todaySkus = new Set(todayRecords.map(r => normalizeSkuKey(r.sku_id)).filter(Boolean));
        const todayQty = todayRecords.reduce((sum, row) => sum + (Number(row.counted_qty) || 0), 0);

        if (totalScannedEl) {
            totalScannedEl.textContent = `${todaySkus.size.toLocaleString()} / ${todayQty.toLocaleString()}`;
        }

        const uncountedEl = document.getElementById('totalUncounted');
        const progressEl = document.getElementById('progressPercent');
        const totalItems = skuMasterList.length;
        const countedSkuTotal = allCountedSkus.size;
        const uncountedCount = totalItems > 0
            ? skuMasterList.filter(s => !allCountedSkus.has(normalizeSkuKey(s.sku_name))).length
            : 0;

        if (uncountedEl) {
            uncountedEl.textContent = uncountedCount.toLocaleString();
        }

        if (progressEl) {
            if (totalItems === 0) {
                progressEl.textContent = '0%';
            } else {
                const percent = Math.floor((countedSkuTotal / totalItems) * 100);
                progressEl.textContent = `${percent}%`;
            }
        }

        refreshDashboardSummary();
    }

    // =============================================
    //  TOAST
    // =============================================
    function showToast(message, type = 'success') {
        const toast    = document.createElement('div');
        toast.className = `toast ${type}`;
        const iconName  = type === 'success' ? 'check-circle-2' : 'alert-circle';
        toast.innerHTML = `<i data-lucide="${iconName}"></i><span>${message}</span>`;
        toastContainer.appendChild(toast);
        lucide.createIcons();
        setTimeout(() => {
            toast.classList.add('toast-closing');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    // =============================================
    //  SETTINGS MODAL (global scope)
    // =============================================
    window.toggleModal = function(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        const isOpen = modal.classList.contains('open');
        if (isOpen) {
            modal.classList.remove('open');
        } else {
            modal.classList.add('open');
            lucide.createIcons();
        }
    };

    // =============================================
    //  EDIT / DELETE 2-STEP CONFIRMATION MODAL
    // =============================================
    let edState = {
        mode: '', id: null, sku: '', oldQty: 0, newQty: 0,
        oldLocation: '', newLocation: '', step: 1,
        warehouse: '', location: '', counterName: ''
    };

    function updateRecordRowDom(state) {
        const liEl = document.getElementById(`record-${state.id}`);
        if (!liEl) return;
        const qtyEl = document.getElementById(`qty-${state.id}`);
        const locEl = document.getElementById(`loc-${state.id}`);
        const wh = state.warehouse || '-';
        const loc = state.location || '-';
        if (qtyEl) qtyEl.textContent = `+${state.qty}`;
        if (locEl) {
            locEl.innerHTML = `
                <i data-lucide="warehouse"></i> ${escapeHtml(wh)} &nbsp;|&nbsp;
                <i data-lucide="map-pin"></i> ${escapeHtml(loc)}`;
        }
        const editBtn = liEl.querySelector('button[title="แก้ไขรายการ"]');
        const delBtn = liEl.querySelector('button[title="ลบรายการ"]');
        if (editBtn) editBtn.setAttribute('onclick', `openEditModal('${state.id}')`);
        if (delBtn) delBtn.setAttribute('onclick', `openDeleteModal('${state.id}', '${state.sku}', ${state.qty})`);
        lucide.createIcons();
    }

    window.openEditModal = function(id) {
        const rec = allRecords.find(r => String(r.id) === String(id));
        if (!rec) {
            showToast('ไม่พบรายการในระบบ', 'error');
            return;
        }
        if (!recordBelongsToActiveWarehouse(rec)) {
            showToast('รายการนี้อยู่คลังอื่น — เปลี่ยนคลังให้ตรงก่อนแก้ไข', 'error');
            return;
        }
        const sku = rec.sku_id || '';
        const oldQty = Number(rec.counted_qty) || 0;
        const oldLocation = rec.location || '';
        edState = {
            mode: 'edit', id, sku, oldQty, newQty: oldQty,
            oldLocation, newLocation: oldLocation, step: 1,
            warehouse: rec.warehouse || '', location: oldLocation,
            counterName: rec.counter_name || ''
        };
        document.getElementById('edModalTitle').innerHTML = `<i data-lucide="edit"></i> แก้ไขรายการ (ขั้นที่ 1/2)`;
        document.getElementById('edModalDesc').innerHTML =
            `แก้ไขจำนวนและตำแหน่งสำหรับ <strong>${escapeHtml(sku)}</strong><br>` +
            `<span style="color:var(--text-muted);font-size:0.9rem;">จำนวนเดิม: ${oldQty} · ตำแหน่งเดิม: ${escapeHtml(oldLocation || '-')}</span>`;
        document.getElementById('edInputGroup').style.display = 'block';
        document.getElementById('edNewQty').value = oldQty;
        document.getElementById('edNewLoc').value = oldLocation;
        document.getElementById('edWarningBox').style.display = 'none';
        document.getElementById('edConfirmBtn').innerHTML = `ยืนยันขั้นที่ 1`;
        document.getElementById('edConfirmBtn').className = `cs-btn-save`;
        document.getElementById('editDeleteModal').classList.add('open');
        lucide.createIcons();
    };

    window.openDeleteModal = function(id, sku, qty) {
        const rec = allRecords.find(r => String(r.id) === String(id));
        if (rec && !recordBelongsToActiveWarehouse(rec)) {
            showToast('รายการนี้อยู่คลังอื่น — เปลี่ยนคลังให้ตรงก่อนลบ', 'error');
            return;
        }
        edState = { mode: 'delete', id, sku, oldQty: qty, step: 1, warehouse: rec?.warehouse, location: rec?.location, counterName: rec?.counter_name };
        document.getElementById('edModalTitle').innerHTML = `<i data-lucide="trash-2"></i> ยืนยันการลบรายการ (ขั้นที่ 1/2)`;
        document.getElementById('edModalDesc').innerHTML = `คุณต้องการลบรายการสแกน <strong>${sku}</strong> (จำนวน: ${qty} ชิ้น) ใช่หรือไม่?`;
        document.getElementById('edInputGroup').style.display = 'none';
        document.getElementById('edWarningBox').style.display = 'none';
        document.getElementById('edConfirmBtn').innerHTML = `ยืนยันขั้นที่ 1`;
        document.getElementById('edConfirmBtn').className = `cs-btn-save`;
        document.getElementById('editDeleteModal').classList.add('open');
        lucide.createIcons();
    };

    window.closeEdModal = function() {
        document.getElementById('editDeleteModal').classList.remove('open');
        edState = {
            mode: '', id: null, sku: '', oldQty: 0, newQty: 0,
            oldLocation: '', newLocation: '', step: 1,
            warehouse: '', location: '', counterName: ''
        };
    };

    window.handleEdConfirm = async function() {
        if (!supabaseClient) return;

        if (edState.mode === 'edit') {
            if (edState.step === 1) {
                const newQty = parseInt(document.getElementById('edNewQty').value, 10);
                const newLocation = (document.getElementById('edNewLoc').value || '').trim();
                if (Number.isNaN(newQty) || newQty < 0) {
                    showToast('กรุณาระบุจำนวนที่ถูกต้อง (0 ขึ้นไป)', 'error');
                    return;
                }
                if (!newLocation) {
                    showToast('กรุณาระบุตำแหน่ง', 'error');
                    return;
                }
                const qtyChanged = newQty !== edState.oldQty;
                const locChanged = newLocation.toUpperCase() !== String(edState.oldLocation || '').trim().toUpperCase();
                if (!qtyChanged && !locChanged) {
                    showToast('ไม่มีการเปลี่ยนแปลง', 'error');
                    return;
                }
                edState.newQty = newQty;
                edState.newLocation = newLocation;
                edState.step = 2;

                const changes = [];
                if (qtyChanged) changes.push(`จำนวน: <strong>${edState.oldQty}</strong> → <strong>${newQty}</strong> ชิ้น`);
                if (locChanged) changes.push(`ตำแหน่ง: <strong>${escapeHtml(edState.oldLocation || '-')}</strong> → <strong>${escapeHtml(newLocation)}</strong>`);

                document.getElementById('edModalTitle').innerHTML = `<i data-lucide="edit"></i> ยืนยันการแก้ไข (ขั้นที่ 2/2)`;
                document.getElementById('edModalDesc').innerHTML =
                    `ยืนยันการแก้ไข <strong>${escapeHtml(edState.sku)}</strong><br>${changes.join('<br>')}`;
                document.getElementById('edInputGroup').style.display = 'none';
                document.getElementById('edWarningText').textContent = `ข้อมูลในฐานข้อมูล Supabase จะถูกอัปเดตทันที`;
                document.getElementById('edWarningBox').style.display = 'flex';
                document.getElementById('edConfirmBtn').innerHTML = `<i data-lucide="check"></i> ยืนยันการแก้ไขจริง`;
                lucide.createIcons();
            } else if (edState.step === 2) {
                try {
                    const payload = {};
                    if (edState.newQty !== edState.oldQty) payload.counted_qty = edState.newQty;
                    if (edState.newLocation.toUpperCase() !== String(edState.oldLocation || '').trim().toUpperCase()) {
                        payload.location = edState.newLocation;
                    }

                    let updateQuery = supabaseClient
                        .from('inventory_counts')
                        .update(payload)
                        .eq('id', edState.id);
                    if (edState.warehouse) {
                        updateQuery = updateQuery.eq('warehouse', edState.warehouse);
                    }
                    const { error } = await updateQuery;
                    if (error) throw error;

                    const rec = allRecords.find(r => String(r.id) === String(edState.id));
                    if (rec) {
                        if (payload.counted_qty !== undefined) rec.counted_qty = edState.newQty;
                        if (payload.location !== undefined) rec.location = edState.newLocation;
                    }

                    updateRecordRowDom({
                        id: edState.id,
                        sku: edState.sku,
                        qty: edState.newQty,
                        warehouse: edState.warehouse,
                        location: edState.newLocation
                    });

                    logAudit(
                        'UPDATE', edState.id, edState.sku,
                        edState.oldQty, edState.newQty,
                        edState.warehouse, edState.newLocation, edState.counterName
                    );

                    updateStats();

                    const parts = [];
                    if (payload.counted_qty !== undefined) parts.push(`จำนวน ${edState.newQty}`);
                    if (payload.location !== undefined) parts.push(`ตำแหน่ง ${edState.newLocation}`);
                    showToast(`✓ อัปเดต ${edState.sku}: ${parts.join(' · ')}`, 'success');
                    closeEdModal();
                } catch (err) {
                    console.error('[Update Error]', err);
                    showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
                }
            }
        } else if (edState.mode === 'delete') {
            if (edState.step === 1) {
                edState.step = 2;
                document.getElementById('edModalTitle').innerHTML = `<i data-lucide="trash-2"></i> ยืนยันการลบ (ขั้นที่ 2/2)`;
                document.getElementById('edModalDesc').innerHTML = `คุณแน่ใจหรือไม่ที่จะลบ <strong>${edState.sku}</strong> ออกจากระบบ?`;
                document.getElementById('edWarningText').textContent = `⚠️ คำเตือน: ข้อมูลจะถูกลบออกจากฐานข้อมูล Supabase ทันทีและไม่สามารถกู้คืนได้`;
                document.getElementById('edWarningBox').style.display = 'flex';
                document.getElementById('edConfirmBtn').innerHTML = `<i data-lucide="trash-2"></i> ยืนยันการลบจริง`;
                document.getElementById('edConfirmBtn').className = `cs-btn-test`; // red style
                lucide.createIcons();
            } else if (edState.step === 2) {
                try {
                    let deleteQuery = supabaseClient
                        .from('inventory_counts')
                        .delete()
                        .eq('id', edState.id);
                    if (edState.warehouse) {
                        deleteQuery = deleteQuery.eq('warehouse', edState.warehouse);
                    }
                    const { error } = await deleteQuery;
                    if (error) throw error;

                    // Remove DOM
                    const liEl = document.getElementById(`record-${edState.id}`);
                    if (liEl) liEl.remove();

                    // Update allRecords cache
                    allRecords = allRecords.filter(r => String(r.id) !== String(edState.id));

                    logAudit('DELETE', edState.id, edState.sku, edState.oldQty, null, edState.warehouse, edState.location, edState.counterName);

                    // Check if list empty
                    const recordList = document.getElementById('recordList');
                    if (recordList && recordList.children.length === 0) {
                        recordList.innerHTML = `
                            <li class="empty-state">
                                <i data-lucide="package-open" style="width:48px;height:48px;stroke-width:1;"></i>
                                <p>ยังไม่มีรายการบันทึกในเซสชันนี้</p>
                            </li>`;
                        lucide.createIcons();
                    }

                    updateStats();

                    showToast(`✓ ลบรายการ ${edState.sku} ออกจากระบบเรียบร้อย`, 'success');
                    closeEdModal();
                } catch (err) {
                    console.error('[Delete Error]', err);
                    showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
                }
            }
        }
    };

    // =============================================
    //  AUDIT LOG DRAWER
    // =============================================
    window.openLogDrawer = async function() {
        document.getElementById('logDrawerOverlay').classList.add('open');
        document.getElementById('logDrawer').classList.add('open');
        lucide.createIcons();
        await loadAuditLogs();
    };

    window.closeLogDrawer = function() {
        document.getElementById('logDrawerOverlay').classList.remove('open');
        document.getElementById('logDrawer').classList.remove('open');
    };

    async function loadAuditLogs() {
        const container = document.getElementById('logListContainer');
        if (!container) return;

        if (!supabaseClient) {
            container.innerHTML = `<div class="empty-state"><p>กรุณาเชื่อมต่อ Supabase ก่อน</p></div>`;
            return;
        }

        container.innerHTML = `<div class="empty-state"><i data-lucide="loader-2" class="spin" style="animation: spin 1s linear infinite;"></i><p>กำลังโหลดประวัติ...</p></div>`;
        lucide.createIcons();

        try {
            const { data, error } = await supabaseClient
                .from('inventory_audit_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            if (!data || data.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i data-lucide="inbox" style="width:48px;height:48px;stroke-width:1;"></i>
                        <p>ยังไม่มีประวัติการทำงาน</p>
                    </div>`;
                lucide.createIcons();
                return;
            }

            container.innerHTML = data.map(log => {
                // แปลงเวลาเป็นเวลาไทย (Buddhist/Thai Locale หรือ Timezone Asia/Bangkok)
                const dateObj = new Date(log.created_at);
                const thaiTime = dateObj.toLocaleDateString('th-TH', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

                let detailHtml = '';
                if (log.action_type === 'INSERT') {
                    detailHtml = `เพิ่มสินค้าจำนวน <strong>+${log.new_qty}</strong> ชิ้น`;
                } else if (log.action_type === 'UPDATE') {
                    detailHtml = `แก้ไขจำนวนจาก <strong>${log.old_qty}</strong> เป็น <strong>${log.new_qty}</strong> ชิ้น`;
                } else if (log.action_type === 'DELETE') {
                    detailHtml = `ลบรายการ (จำนวนเดิม <strong>${log.old_qty}</strong> ชิ้น)`;
                } else if (log.action_type === 'GROUP_INSERT') {
                    detailHtml = `เพิ่มสินค้าแบบกลุ่มรวม <strong>+${log.new_qty}</strong> ชิ้น`;
                }

                let badgeType = log.action_type;
                let badgeText = log.action_type;
                if (log.action_type === 'GROUP_INSERT') {
                    badgeType = 'INSERT';
                    badgeText = 'GROUP';
                }

                let skuHtml = `<div class="log-sku" style="word-break: break-all; white-space: normal; line-height: 1.4;">${log.sku_id}</div>`;
                if (log.action_type === 'GROUP_INSERT') {
                    const skuArray = log.sku_id.split(', ');
                    const itemCount = skuArray.length;
                    
                    const detailsList = skuArray.map(s => {
                        return `<div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.05);"><i data-lucide="package" style="width:12px;height:12px;color:var(--text-muted);"></i> ${s}</div>`;
                    }).join('');

                    skuHtml = `
                        <div class="log-sku group-sku-toggle" style="cursor: pointer; color: var(--primary); font-weight: 500; display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.6rem; background: rgba(59, 130, 246, 0.1); border-radius: 6px; margin: 0.25rem 0; transition: all 0.2s;" onclick="toggleGroupDetails(this)">
                            <i data-lucide="layers" style="width: 14px; height: 14px;"></i>
                            <span>ดูรายการสินค้า (${itemCount} รายการ)</span>
                            <i data-lucide="chevron-down" class="group-toggle-icon" style="width: 14px; height: 14px; transition: transform 0.2s; margin-left: 0.25rem;"></i>
                        </div>
                        <div class="group-sku-details" style="display: none; padding: 0.5rem 0.75rem; background: rgba(0,0,0,0.2); border-radius: 8px; margin-top: 0.25rem; font-size: 0.85rem; line-height: 1.4; color: var(--text-muted); border: 1px solid var(--card-border);">
                            ${detailsList}
                        </div>
                    `;
                }

                return `
                    <div class="log-item">
                        <div class="log-item-header">
                            <span class="log-badge ${badgeType}">${badgeText}</span>
                            <span class="log-time"><i data-lucide="clock" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> ${thaiTime}</span>
                        </div>
                        ${skuHtml}
                        <div class="log-details">${detailHtml}</div>
                        <div class="log-meta">
                            <span><i data-lucide="user" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> ${log.counter_name || 'Unknown'}</span>
                            <span><i data-lucide="map-pin" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> ${log.warehouse || ''} / ${log.location || ''}</span>
                        </div>
                    </div>`;
            }).join('');

            lucide.createIcons();

        } catch (err) {
            console.error('[Audit Log Load Error]', err);
            container.innerHTML = `<div class="empty-state"><p style="color:#f87171;">เกิดข้อผิดพลาด: ${err.message}</p></div>`;
        }
    }

    // Toggle Group Details function
    window.toggleGroupDetails = function(element) {
        const detailsContainer = element.nextElementSibling;
        const icon = element.querySelector('.group-toggle-icon');
        
        if (detailsContainer.style.display === 'none') {
            detailsContainer.style.display = 'block';
            element.style.background = 'rgba(59, 130, 246, 0.2)';
            if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
            detailsContainer.style.display = 'none';
            element.style.background = 'rgba(59, 130, 246, 0.1)';
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    };

    // =============================================
    //  EXPORT AUDIT LOGS TO EXCEL
    // =============================================
    window.exportAuditLogs = async function() {
        if (!supabaseClient) {
            showToast('กรุณาเชื่อมต่อ Supabase ก่อนทำการส่งออก', 'error');
            return;
        }

        showToast('กำลังเตรียมข้อมูล Audit Logs สำหรับส่งออก...');

        try {
            let allLogs = [];
            let from = 0;
            const PAGE = 1000;
            while (true) {
                const { data, error } = await supabaseClient
                    .from('inventory_audit_logs')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .range(from, from + PAGE - 1);

                if (error) throw error;
                allLogs = allLogs.concat(data || []);
                if (!data || data.length < PAGE) break;
                from += PAGE;
            }

            if (allLogs.length === 0) {
                showToast('ไม่มีข้อมูล Audit Logs สำหรับส่งออก', 'error');
                return;
            }

            const exportData = allLogs.map((log, index) => {
                const dateObj = new Date(log.created_at);
                const thaiTime = dateObj.toLocaleDateString('th-TH', {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });

                let actionName = log.action_type;
                if (actionName === 'GROUP_INSERT') actionName = 'INSERT (Group)';

                return {
                    '#': index + 1,
                    'วัน-เวลา (Date)': thaiTime,
                    'ประเภท (Action)': actionName,
                    'รายละเอียด (SKU/Group Info)': log.sku_id,
                    'จำนวนเดิม (Old Qty)': log.old_qty !== null ? log.old_qty : '-',
                    'จำนวนใหม่ (New Qty)': log.new_qty !== null ? log.new_qty : '-',
                    'คลัง (Warehouse)': log.warehouse || '-',
                    'ตำแหน่ง (Location)': log.location || '-',
                    'ผู้บันทึก (Counter)': log.counter_name || '-'
                };
            });

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Audit_Logs");

            ws['!cols'] = [
                { wch: 8 },  // #
                { wch: 25 }, // Date
                { wch: 15 }, // Action
                { wch: 20 }, // SKU
                { wch: 15 }, // Old Qty
                { wch: 15 }, // New Qty
                { wch: 20 }, // Warehouse
                { wch: 15 }, // Location
                { wch: 20 }  // Counter
            ];

            XLSX.writeFile(wb, `Audit_Logs_${new Date().toISOString().split('T')[0]}.xlsx`);
            showToast(`ดาวน์โหลดไฟล์ Excel สำเร็จ (${allLogs.length} รายการ)`);

        } catch (err) {
            console.error('[Export Audit Logs Error]', err);
            showToast(`ส่งออกล้มเหลว: ${err.message}`, 'error');
        }
    };

    // =============================================
    //  UNCOUNTED DRAWER LOGIC
    // =============================================
    let uncountedItemsCache = [];

    window.openUncountedDrawer = function() {
        document.getElementById('uncountedDrawerOverlay').classList.add('open');
        document.getElementById('uncountedDrawer').classList.add('open');
        refreshUncounted();
    };

    window.closeUncountedDrawer = function() {
        document.getElementById('uncountedDrawerOverlay').classList.remove('open');
        document.getElementById('uncountedDrawer').classList.remove('open');
    };

    window.refreshUncounted = function() {
        const container = document.getElementById('uncountedListContainer');
        if (container) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="loader-2" class="spin"></i><p>กำลังคำนวณ...</p></div>`;
            lucide.createIcons();
        }
        
        const scopedRecords = getWarehouseScopedRecords();
        const allCountedSkus = new Set(scopedRecords.map(r => normalizeSkuKey(r.sku_id)).filter(Boolean));
        uncountedItemsCache = skuMasterList.filter(s => !allCountedSkus.has(normalizeSkuKey(s.sku_name)));
        
        // Update badge
        const uncountedEl = document.getElementById('totalUncounted');
        if (uncountedEl) {
            uncountedEl.textContent = uncountedItemsCache.length.toLocaleString();
        }

        renderUncountedList(uncountedItemsCache);
    };

    window.filterUncounted = function() {
        const query = (document.getElementById('uncountedSearch').value || '').toLowerCase().trim();
        if (!query) {
            renderUncountedList(uncountedItemsCache);
            return;
        }
        
        const filtered = uncountedItemsCache.filter(item => 
            (item.sku_name || '').toLowerCase().includes(query) ||
            (item.name_pro || '').toLowerCase().includes(query)
        );
        renderUncountedList(filtered);
    };

    function renderUncountedList(items) {
        const container = document.getElementById('uncountedListContainer');
        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="check-circle" style="color: var(--success); width: 32px; height: 32px; margin-bottom: 0.5rem;"></i>
                    <p>เยี่ยมมาก! นับสินค้าครบทุกรายการแล้ว</p>
                </div>`;
            lucide.createIcons();
            return;
        }

        container.innerHTML = items.map(item => `
            <div class="log-item" style="border-left: 3px solid #fca5a5;">
                <div class="log-sku" style="color: #fca5a5; margin-bottom: 0.25rem;">${item.sku_name}</div>
                <div class="log-details" style="font-size: 0.85rem;">${item.name_pro || '-'}</div>
            </div>
        `).join('');
    }

    function escapeFileName(value) {
        return String(value || '')
            .replace(/[\\/:*?"<>|]+/g, '_')
            .trim();
    }

    function formatThaiDateTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function parseDateStart(value) {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    }

    function parseDateEnd(value) {
        if (!value) return null;
        const date = new Date(`${value}T23:59:59.999`);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    }

    function getFilteredDashboardRows() {
        const counter = (dashboardFilters.counter || '').trim().toLowerCase();
        const startDate = parseDateStart(dashboardFilters.startDate);
        const endDate = parseDateEnd(dashboardFilters.endDate);

        return getWarehouseScopedRecords().filter(row => {
            const rowCounter = String(row.counter_name || '').trim().toLowerCase();
            const rowDate = row.created_at ? new Date(row.created_at) : null;

            if (counter && rowCounter !== counter) return false;
            if (startDate && (!rowDate || rowDate < startDate)) return false;
            if (endDate && (!rowDate || rowDate > endDate)) return false;
            return true;
        });
    }

    function getCountedSkuSet(rows) {
        return new Set(rows.map(r => String(r.sku_id || '').toLowerCase().trim()).filter(Boolean));
    }

    function sumQuantity(rows) {
        return rows.reduce((sum, row) => sum + (Number(row.counted_qty) || 0), 0);
    }

    function getUncountedCountFromRows(rows) {
        const countedSet = getCountedSkuSet(rows);
        return skuMasterList.filter(s => !countedSet.has(String(s.sku_name || '').toLowerCase().trim())).length;
    }

    function getCounterOptions() {
        const counters = new Set();
        getWarehouseScopedRecords().forEach(row => {
            const value = String(row.counter_name || '').trim();
            if (value) counters.add(value);
        });
        return Array.from(counters).sort((a, b) => a.localeCompare(b, 'th'));
    }

    function setDashboardScopeLabel() {
        const label = document.getElementById('dashboardScopeLabel');
        if (!label) return;

        const parts = [];
        if (dashboardFilters.counter) parts.push(`ผู้นับ: ${dashboardFilters.counter}`);
        if (dashboardFilters.startDate) parts.push(`เริ่ม: ${dashboardFilters.startDate}`);
        if (dashboardFilters.endDate) parts.push(`ถึง: ${dashboardFilters.endDate}`);

        label.textContent = parts.length ? parts.join(' | ') : 'ทั้งหมด';
    }

    function populateDashboardCounterFilter() {
        const select = document.getElementById('dashboardCounterFilter');
        if (!select) return;

        const current = dashboardFilters.counter || '';
        const options = getCounterOptions();
        select.innerHTML = `<option value="">ทั้งหมด</option>` + options.map(name => `<option value="${name}">${name}</option>`).join('');
        select.value = current;
    }

    function getChartContext() {
        const canvas = document.getElementById('dashboardChart');
        if (!canvas) return null;
        return canvas.getContext('2d');
    }

    function renderDashboardChart(rows) {
        const ctx = getChartContext();
        if (!ctx || !window.Chart) return;

        const counterMap = new Map();
        rows.forEach(row => {
            const key = String(row.counter_name || 'Unknown').trim() || 'Unknown';
            counterMap.set(key, (counterMap.get(key) || 0) + 1);
        });

        const sorted = Array.from(counterMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);

        const labels = sorted.length ? sorted.map(([name]) => name) : ['ไม่มีข้อมูล'];
        const values = sorted.length ? sorted.map(([, count]) => count) : [0];

        if (dashboardChart) {
            dashboardChart.destroy();
        }

        dashboardChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'จำนวนรายการที่ส่ง',
                    data: values,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    borderRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#18181b',
                        borderColor: '#3f3f46',
                        borderWidth: 1,
                        titleColor: '#fafafa',
                        bodyColor: '#fafafa'
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#a1a1aa' },
                        grid: { color: 'rgba(63, 63, 70, 0.35)' }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#a1a1aa', precision: 0 },
                        grid: { color: 'rgba(63, 63, 70, 0.35)' }
                    }
                }
            }
        });
    }

    function renderDashboardSubmissionList(rows) {
        const container = document.getElementById('dashboardSubmissionList');
        const tableBody = document.getElementById('dashboardSubmissionTableBody');
        const countEl = document.getElementById('dashboardListCount');

        if (!container || !tableBody || !countEl) return;

        countEl.textContent = `${rows.length.toLocaleString()} รายการ`;

        if (rows.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 2rem 1rem;">
                    <i data-lucide="inbox"></i>
                    <p>ไม่พบข้อมูลตามฟิลเตอร์</p>
                </div>`;
            tableBody.innerHTML = '';
            lucide.createIcons();
            return;
        }

        const ordered = [...rows].sort((a, b) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            return bTime - aTime;
        });

        container.innerHTML = ordered.slice(0, 12).map(row => {
            const skuName = skuMasterList.find(s => String(s.sku_name || '').toLowerCase().trim() === String(row.sku_id || '').toLowerCase().trim())?.name_pro || '';
            return `
                <div class="dashboard-submission-item">
                    <strong>${row.counter_name || 'Unknown'} • ${row.sku_id || '-'}</strong>
                    <small>${skuName ? `${skuName}<br>` : ''}${row.warehouse || '-'} / ${row.location || '-'}<br>${formatThaiDateTime(row.created_at)} • จำนวน ${row.counted_qty || 0}</small>
                </div>`;
        }).join('');

        tableBody.innerHTML = ordered.slice(0, 20).map(row => {
            const isRecent = row.created_at ? new Date(row.created_at).getTime() >= (Date.now() - (24 * 60 * 60 * 1000)) : false;
            return `
                <tr>
                    <td>${row.counter_name || 'Unknown'}</td>
                    <td>${formatThaiDateTime(row.created_at)}</td>
                    <td>${row.sku_id || '-'} <span class="progress-pill">${row.counted_qty || 0}</span></td>
                    <td>${isRecent ? 'วันนี้' : 'ก่อนหน้า'}</td>
                </tr>`;
        }).join('');
    }

    function refreshDashboardSummary() {
        const modal = document.getElementById('dashboardModal');
        if (!modal || !modal.classList.contains('open')) return;

        const rows = getFilteredDashboardRows();
        dashboardRecordsCache = rows;

        const countedSkus = getCountedSkuSet(rows);
        const countedQty = sumQuantity(rows);
        const totalSkus = skuMasterList.length;
        const uncountedCount = getUncountedCountFromRows(rows);
        const progressPercent = totalSkus > 0 ? Math.floor((countedSkus.size / totalSkus) * 100) : 0;
        const remainingPercent = totalSkus > 0 ? Math.max(0, 100 - progressPercent) : 0;
        const totalRecords = getWarehouseScopedRecords().length;
        const sendRate = totalRecords > 0 ? Math.floor((rows.length / totalRecords) * 100) : 0;

        const countedSkuEl = document.getElementById('dashboardCountedSku');
        const countedQtyEl = document.getElementById('dashboardCountedQty');
        const uncountedSkuEl = document.getElementById('dashboardUncountedSku');
        const remainingPctEl = document.getElementById('dashboardRemainingPct');
        const progressEl = document.getElementById('dashboardProgress');
        const progressQtyEl = document.getElementById('dashboardProgressQty');
        const rateEl = document.getElementById('dashboardRate');
        const rateHintEl = document.getElementById('dashboardRateHint');

        if (countedSkuEl) countedSkuEl.textContent = countedSkus.size.toLocaleString();
        if (countedQtyEl) countedQtyEl.textContent = `${countedQty.toLocaleString()} ชิ้น`;
        if (uncountedSkuEl) uncountedSkuEl.textContent = uncountedCount.toLocaleString();
        if (remainingPctEl) remainingPctEl.textContent = `${remainingPercent}%`;
        if (progressEl) progressEl.textContent = `${progressPercent}%`;
        if (progressQtyEl) progressQtyEl.textContent = `${countedSkus.size.toLocaleString()} / ${totalSkus.toLocaleString()} SKU`;
        if (rateEl) rateEl.textContent = `${sendRate}%`;
        if (rateHintEl) rateHintEl.textContent = `${rows.length.toLocaleString()} / ${totalRecords.toLocaleString()} รายการ`;

        setDashboardScopeLabel();
        populateDashboardCounterFilter();
        renderDashboardChart(rows);
        renderDashboardSubmissionList(rows);
        lucide.createIcons();
    }

    window.openExportMenu = function(event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('exportMenu');
        if (!menu) return;
        exportMenuVisible = !exportMenuVisible;
        menu.style.display = exportMenuVisible ? 'flex' : 'none';
    };

    window.exportInventory = function(format) {
        const scopedExport = getWarehouseScopedRecords();
        if (!scopedExport.length) {
            showToast('ไม่มีข้อมูล inventory_counts สำหรับส่งออก (คลังที่เลือก)', 'error');
            return;
        }

        const exportRows = scopedExport.map((row, index) => {
            const skuName = skuMasterList.find(s => String(s.sku_name || '').toLowerCase().trim() === String(row.sku_id || '').toLowerCase().trim())?.name_pro || '';
            return {
                '#': index + 1,
                sku_id: row.sku_id || '-',
                name_pro: skuName || '-',
                counted_qty: row.counted_qty || 0,
                warehouse: row.warehouse || '-',
                location: row.location || '-',
                counter_name: row.counter_name || '-',
                created_at: formatThaiDateTime(row.created_at)
            };
        });

        const whSuffix = escapeFileName(getActiveWarehouse()) || 'all';
        const baseName = `inventory_counts_${whSuffix}_${new Date().toISOString().split('T')[0]}`;

        try {
            if (format === 'csv') {
                const ws = XLSX.utils.json_to_sheet(exportRows);
                const csv = XLSX.utils.sheet_to_csv(ws);
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName}.csv`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast(`ดาวน์โหลดไฟล์ CSV สำเร็จ (${exportRows.length} รายการ)`);
                return;
            }

            const ws = XLSX.utils.json_to_sheet(exportRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'inventory_counts');
            ws['!cols'] = [
                { wch: 8 },
                { wch: 24 },
                { wch: 28 },
                { wch: 14 },
                { wch: 22 },
                { wch: 18 },
                { wch: 22 },
                { wch: 24 }
            ];
            XLSX.writeFile(wb, `${baseName}.xlsx`);
            showToast(`ดาวน์โหลดไฟล์ Excel สำเร็จ (${exportRows.length} รายการ)`);
        } catch (err) {
            console.error('[Export Inventory Error]', err);
            showToast(`ส่งออกล้มเหลว: ${err.message}`, 'error');
        }
    };

    window.openDashboard = function() {
        exportMenuVisible = false;
        const menu = document.getElementById('exportMenu');
        if (menu) menu.style.display = 'none';
        window.location.href = 'Html/dashboard.html';
    };

    window.closeDashboard = function() {
        const modal = document.getElementById('dashboardModal');
        if (!modal) return;
        modal.classList.remove('open');
    };

    window.applyDashboardFilters = function() {
        const counterSelect = document.getElementById('dashboardCounterFilter');
        const startInput = document.getElementById('dashboardStartDate');
        const endInput = document.getElementById('dashboardEndDate');

        dashboardFilters.counter = counterSelect ? counterSelect.value : '';
        dashboardFilters.startDate = startInput ? startInput.value : '';
        dashboardFilters.endDate = endInput ? endInput.value : '';
        refreshDashboardSummary();
    };

    window.resetDashboardFilters = function() {
        dashboardFilters = { counter: '', startDate: '', endDate: '' };
        const counterSelect = document.getElementById('dashboardCounterFilter');
        const startInput = document.getElementById('dashboardStartDate');
        const endInput = document.getElementById('dashboardEndDate');
        if (counterSelect) counterSelect.value = '';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        refreshDashboardSummary();
    };

    window.exportUncountedExcel = function() {
        if (!uncountedItemsCache || uncountedItemsCache.length === 0) {
            showToast('ไม่มีรายการที่ยังไม่ได้นับให้ส่งออก', 'error');
            return;
        }

        showToast('กำลังเตรียมข้อมูลสำหรับส่งออก Excel...');

        try {
            const exportData = uncountedItemsCache.map((item, index) => {
                return {
                    '#': index + 1,
                    'รหัสสินค้า (SKU)': item.sku_name || '-',
                    'ชื่อสินค้า (Product Name)': item.name_pro || '-'
                };
            });

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Uncounted_Items");

            ws['!cols'] = [
                { wch: 8 },
                { wch: 30 },
                { wch: 50 }
            ];

            const whSuffix = escapeFileName(getActiveWarehouse()) || 'all';
            const dateStr = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `Uncounted_Items_${whSuffix}_${dateStr}.xlsx`);
            showToast(`ดาวน์โหลดไฟล์ Excel สำเร็จ (${uncountedItemsCache.length} รายการ)`);

        } catch (err) {
            console.error('[Export Uncounted Items Error]', err);
            showToast(`ส่งออกล้มเหลว: ${err.message}`, 'error');
        }
    };

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('exportMenu');
        if (!menu) return;
        const button = e.target.closest && e.target.closest('[title="ส่งออกข้อมูล inventory_counts"]');
        if (!button && !menu.contains(e.target)) {
            menu.style.display = 'none';
            exportMenuVisible = false;
        }
    });

    const dashboardModal = document.getElementById('dashboardModal');
    if (dashboardModal) {
        dashboardModal.addEventListener('click', function(e) {
            if (e.target === this) closeDashboard();
        });
    }

    const dashboardCounterFilter = document.getElementById('dashboardCounterFilter');
    if (dashboardCounterFilter) {
        dashboardCounterFilter.addEventListener('change', applyDashboardFilters);
    }

    initSupabase();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && supabaseClient) {
            loadAllData();
        }
    });
});
