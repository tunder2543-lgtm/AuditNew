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
    let skuMasterList  = []; // Cache SKU list { SKU_NAME, NAME_PRO }
    let allRecords     = []; // Cache inventory_counts records for audit log context

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
            loadAllData(); // โหลดข้อมูล SKU และบันทึกการนับทั้งหมด
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
        const badge = document.getElementById('connectionBadge');
        const icon  = document.getElementById('badgeIcon');
        const text  = document.getElementById('badgeText');
        if (!badge) return;
        if (connected) {
            badge.className = 'connection-badge badge-connected';
            icon.setAttribute('data-lucide', 'wifi');
            text.textContent = 'Connected';
        } else {
            badge.className = 'connection-badge badge-disconnected';
            icon.setAttribute('data-lucide', 'wifi-off');
            text.textContent = 'ไม่ได้เชื่อมต่อ';
        }
        lucide.createIcons();
    }

    initSupabase();

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

    async function loadSkuMaster() {
        if (!supabaseClient) return;
        try {
            // ดึงทั้งหมดในครั้งเดียว (cache ไว้ใน memory)
            let allRows = [];
            let from = 0;
            const PAGE = 1000;
            while (true) {
                const { data, error } = await supabaseClient
                    .from('sku_master')
                    .select('sku_name, name_pro')
                    .range(from, from + PAGE - 1);
                if (error) throw error;
                allRows = allRows.concat(data || []);
                if (!data || data.length < PAGE) break;
                from += PAGE;
            }
            skuMasterList = allRows;
            console.log(`[SKU Master] Loaded ${skuMasterList.length} items ✓`);
        } catch (err) {
            console.warn('[SKU Master] Load failed:', err.message);
        }
    }

    async function loadExistingRecords() {
        if (!supabaseClient) return;
        try {
            const { data, error } = await supabaseClient
                .from('inventory_counts')
                .select('*')
                .order('created_at', { ascending: false }); // ล่าสุดอยู่บนสุด
            if (error) throw error;

            if (data && data.length > 0) {
                allRecords = data;
                totalScanned = data.reduce((sum, row) => sum + (row.counted_qty || 0), 0);
                updateStats();

                recordList.innerHTML = data.map(row => {
                    const found = skuMasterList.find(s => (s.sku_name || '').toLowerCase() === (row.sku_id || '').toLowerCase());
                    const proName = found ? found.name_pro : '';
                    return `
                        <li class="record-item" id="record-${row.id}">
                            <div class="record-main">
                                <span class="record-sku">${row.sku_id}</span>
                                ${proName ? `<span class="record-pro-name">${proName}</span>` : ''}
                                <span class="record-loc">
                                    <i data-lucide="warehouse"></i> ${row.warehouse} &nbsp;|&nbsp;
                                    <i data-lucide="map-pin"></i> ${row.location}
                                </span>
                            </div>
                            <div class="record-actions" style="display: flex; gap: 0.5rem; align-items: center;">
                                <span class="record-qty" id="qty-${row.id}">+${row.counted_qty}</span>
                                <button class="icon-btn" onclick="openEditModal('${row.id}', '${row.sku_id}', ${row.counted_qty})" title="แก้ไขจำนวน" style="padding: 0.25rem; color: var(--text-muted);">
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

    let totalScanned  = 0;
    let activeDropIdx = -1; // keyboard nav index

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
            warehouseInput.value = 'หน้าไลฟ์(บางกรวย)';
            if (warehouseCustom) warehouseCustom.value = '';
        }
    };

    if (savedWarehouse && warehouseInput) {
        if (savedWarehouse === 'หน้าไลฟ์(บางกรวย)' || savedWarehouse === 'ตึกกันตนา') {
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
        warehouseInput.addEventListener('change', () => {
            if (warehouseInput.value === 'custom') {
                warehouseInput.style.display = 'none';
                if (warehouseCustomContainer) {
                    warehouseCustomContainer.style.display = 'block';
                    if (warehouseCustom) warehouseCustom.focus();
                }
            }
        });
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
                counter_name: counterName || document.getElementById('counterName')?.value || 'Unknown'
            }]);
        } catch (err) {
            console.warn('[Audit Log] Failed to log action:', err.message);
        }
    }

    // =============================================
    //  MODE SWITCH & GROUP LOGIC
    // =============================================
    let currentMode = 'single';
    let groupItems = [];
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
            btnSingle.style.background = 'var(--card)';
            btnSingle.style.color = 'var(--text)';
            btnSingle.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
            
            btnGroup.classList.remove('active');
            btnGroup.style.background = 'transparent';
            btnGroup.style.color = 'var(--text-muted)';
            btnGroup.style.boxShadow = 'none';

            singleAction.style.display = 'block';
            groupAction.style.display = 'none';
            groupContainer.style.display = 'none';
        } else {
            btnGroup.classList.add('active');
            btnGroup.style.background = 'var(--card)';
            btnGroup.style.color = 'var(--text)';
            btnGroup.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
            
            btnSingle.classList.remove('active');
            btnSingle.style.background = 'transparent';
            btnSingle.style.color = 'var(--text-muted)';
            btnSingle.style.boxShadow = 'none';

            singleAction.style.display = 'none';
            groupAction.style.display = 'block';
            groupContainer.style.display = 'block';
        }
    };

    window.addGroupItem = function() {
        if (groupItems.length >= maxGroupItems) {
            showToast(`ไม่สามารถเพิ่มได้เกิน ${maxGroupItems} รายการใน 1 กลุ่ม`, 'error');
            return;
        }

        const sku = skuInput.value.trim();
        const quantity = parseInt(quantityInput.value.trim(), 10);
        let proName = skuNameText.textContent || '';
        if (!proName) proName = 'ไม่พบชื่อรหัสสินค้า';

        if (!sku || !quantity || quantity < 1) {
            showToast('กรุณาระบุรหัสสินค้าและจำนวนให้ถูกต้อง', 'error');
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
        if (!supabaseClient) { initSupabase(); }
        if (!supabaseClient) {
            showToast('กรุณาตั้งค่า Supabase URL/KEY ก่อน', 'error');
            toggleModal('settingsModal');
            return;
        }

        const counter_name = counterNameInput.value.trim();
        const warehouse    = (warehouseInput.value === 'custom' ? document.getElementById('warehouseCustom').value.trim() : warehouseInput.value.trim());
        const location     = locationInput.value.trim();

        if (!counter_name || !warehouse || !location) {
            showToast('กรุณาระบุชื่อผู้นับ, คลัง และตำแหน่งให้ครบถ้วน', 'error');
            return;
        }

        if (groupItems.length === 0) {
            showToast('ไม่มีรายการสินค้าให้ส่งออก', 'error');
            return;
        }

        const submitGroupBtn = document.getElementById('submitGroupBtn');
        submitGroupBtn.disabled = true;
        const orig = submitGroupBtn.innerHTML;
        submitGroupBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> กำลังส่งข้อมูล...`;
        lucide.createIcons();

        try {
            // เรียงลำดับจากเก่าไปใหม่สำหรับ insert (เพราะเรา unshift ตอนรับ)
            const reversedItems = [...groupItems].reverse();
            
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

            let totalQtyInGroup = 0;
            const insertedRows = (data && data.length > 0) ? data : reversedItems.map((_, i) => ({ id: Date.now() + i }));
            
            // รวบรวมข้อมูลเพื่อเขียนลง Log เดียว
            const groupSkuDetails = reversedItems.map(item => `${item.sku} (x${item.quantity})`).join(', ');
            
            insertedRows.forEach((row, idx) => {
                const insertedId = row.id;
                const originalItem = reversedItems[idx];

                allRecords.unshift({
                    id: insertedId,
                    sku_id: originalItem.sku,
                    counted_qty: originalItem.quantity,
                    warehouse: warehouse,
                    location: location,
                    counter_name: counter_name
                });
                
                addRecord(insertedId, originalItem.sku, originalItem.name, originalItem.quantity, location, warehouse);
                totalQtyInGroup += originalItem.quantity;
            });
            
            // บันทึก Log เดียวแบบกลุ่ม
            logAudit('GROUP_INSERT', 'multiple', groupSkuDetails, null, totalQtyInGroup, warehouse, location, counter_name);

            localStorage.setItem('saved_counter_name', counter_name);
            localStorage.setItem('saved_warehouse', warehouse);
            localStorage.setItem('saved_location', location);

            totalScanned += totalQtyInGroup;
            updateStats();
            
            showToast(`✓ บันทึกกลุ่มสำเร็จ ${groupItems.length} รายการ`, 'success');

            groupItems = [];
            renderGroupList();
            
            // เคลียร์ตำแหน่งหลังจากกดส่งกลุ่ม
            locationInput.value = '';
            localStorage.removeItem('saved_location');
            locationInput.focus();

        } catch (err) {
            console.error('[Insert Group Error]', err);
            showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
        } finally {
            submitGroupBtn.disabled = false;
            submitGroupBtn.innerHTML = orig;
            lucide.createIcons();
        }
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
            toggleModal('settingsModal');
            return;
        }

        const counter_name = counterNameInput.value.trim();
        const warehouse    = (warehouseInput.value === 'custom' ? document.getElementById('warehouseCustom').value.trim() : warehouseInput.value.trim());
        const location     = locationInput.value.trim();
        const sku          = skuInput.value.trim();
        const quantity     = parseInt(quantityInput.value.trim(), 10);
        let proName      = skuNameText.textContent || '';
        if (!proName) proName = 'ไม่พบชื่อรหัสสินค้า';

        if (!counter_name || !warehouse || !sku || !quantity || !location) {
            showToast('กรุณากรอกข้อมูลให้ครบทุกช่อง', 'error');
            return;
        }

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

            allRecords.unshift({
                id: insertedId,
                sku_id: sku,
                counted_qty: quantity,
                warehouse: warehouse,
                location: location,
                counter_name: counter_name
            });

            logAudit('INSERT', insertedId, sku, null, quantity, warehouse, location, counter_name);

            localStorage.setItem('saved_counter_name', counter_name);
            localStorage.setItem('saved_warehouse', warehouse);
            localStorage.setItem('saved_location', location);

            addRecord(insertedId, sku, proName, quantity, location, warehouse);
            totalScanned += quantity;
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
            submitBtn.disabled  = false;
            submitBtn.innerHTML = orig;
            lucide.createIcons();
        }
    });

    // =============================================
    //  ADD RECORD TO LIST (with Edit/Delete Actions)
    // =============================================
    function addRecord(id, sku, proName, quantity, location, warehouse) {
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        const li = document.createElement('li');
        li.className = 'record-item';
        li.id = `record-${id}`;
        li.innerHTML = `
            <div class="record-main">
                <span class="record-sku">${sku}</span>
                ${proName ? `<span class="record-pro-name">${proName}</span>` : ''}
                <span class="record-loc">
                    <i data-lucide="warehouse"></i> ${warehouse} &nbsp;|&nbsp;
                    <i data-lucide="map-pin"></i> ${location}
                </span>
            </div>
            <div class="record-actions" style="display: flex; gap: 0.5rem; align-items: center;">
                <span class="record-qty" id="qty-${id}">+${quantity}</span>
                <button class="icon-btn" onclick="openEditModal('${id}', '${sku}', ${quantity})" title="แก้ไขจำนวน" style="padding: 0.25rem; color: var(--text-muted);">
                    <i data-lucide="edit-2" style="width: 16px; height: 16px;"></i>
                </button>
                <button class="icon-btn" onclick="openDeleteModal('${id}', '${sku}', ${quantity})" title="ลบรายการ" style="padding: 0.25rem; color: #ef4444;">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </div>`;
        recordList.insertBefore(li, recordList.firstChild);
        lucide.createIcons();
        // ไม่จำกัดจำนวนรายการ แสดงทั้งหมดตามที่ผู้ใช้ต้องการ
    }

    function updateStats() {
        const countedSkus = new Set(allRecords.map(r => String(r.sku_id).toLowerCase().trim()));
        
        totalScannedEl.textContent = `${countedSkus.size.toLocaleString()} / ${totalScanned.toLocaleString()}`;
        
        const uncounted = skuMasterList.filter(s => !countedSkus.has(String(s.sku_name || '').toLowerCase().trim()));
        const uncountedEl = document.getElementById('totalUncounted');
        const progressEl = document.getElementById('progressPercent');
        
        if (uncountedEl) {
            uncountedEl.textContent = uncounted.length.toLocaleString();
        }
        
        if (progressEl) {
            const totalItems = skuMasterList.length;
            if (totalItems === 0) {
                progressEl.textContent = '0%';
            } else {
                const countedCount = totalItems - uncounted.length;
                const percent = Math.floor((countedCount / totalItems) * 100);
                progressEl.textContent = `${percent}%`;
            }
        }
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
            if (id === 'settingsModal') {
                document.getElementById('sbUrl').value = localStorage.getItem('SB_URL') || '';
                document.getElementById('sbKey').value = localStorage.getItem('SB_KEY') || '';
                const ts = document.getElementById('testStatus');
                ts.style.display = 'none';
                ts.textContent   = '';
            }
            modal.classList.add('open');
            lucide.createIcons();
        }
    };

    window.saveSettings = function() {
        const url = document.getElementById('sbUrl').value.trim();
        const key = document.getElementById('sbKey').value.trim();
        if (!url || !key) { alert('กรุณากรอก URL และ API Key ให้ครบ'); return; }
        localStorage.setItem('SB_URL', url);
        localStorage.setItem('SB_KEY', key);
        supabaseClient = null;
        initSupabase();
        toggleModal('settingsModal');
        showToast('✓ บันทึกการตั้งค่าสำเร็จ!', 'success');
    };

    window.testConnection = async function() {
        const url      = document.getElementById('sbUrl').value.trim();
        const key      = document.getElementById('sbKey').value.trim();
        const statusEl = document.getElementById('testStatus');

        const setStatus = (bg, color, border, msg) => {
            statusEl.style.cssText = `display:block;padding:0.75rem 1rem;border-radius:10px;font-size:0.85rem;margin-bottom:1rem;background:${bg};color:${color};border:1px solid ${border};`;
            statusEl.textContent   = msg;
        };

        if (!url || !key) { setStatus('rgba(239,68,68,0.1)','#fca5a5','rgba(239,68,68,0.3)','❌ กรุณากรอก URL และ API Key ก่อน'); return; }
        setStatus('rgba(99,102,241,0.1)','#a5b4fc','rgba(99,102,241,0.3)','🔄 กำลังทดสอบ...');

        try {
            const res = await fetch(`${url}/rest/v1/inventory_counts?select=id&limit=1`, {
                headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
            });
            if (res.ok) setStatus('rgba(16,185,129,0.1)','#6ee7b7','rgba(16,185,129,0.3)','✅ เชื่อมต่อสำเร็จ! Table inventory_counts พร้อมใช้งาน');
            else throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            setStatus('rgba(239,68,68,0.1)','#fca5a5','rgba(239,68,68,0.3)',`❌ ไม่สามารถเชื่อมต่อได้: ${err.message}`);
        }
    };

    window.toggleKeyVisibility = function() {
        const input = document.getElementById('sbKey');
        const icon  = document.getElementById('eyeIcon');
        if (input.type === 'password') { input.type = 'text';     icon.setAttribute('data-lucide', 'eye-off'); }
        else                           { input.type = 'password'; icon.setAttribute('data-lucide', 'eye');     }
        lucide.createIcons();
    };

    document.getElementById('settingsModal').addEventListener('click', function(e) {
        if (e.target === this) toggleModal('settingsModal');
    });

    // =============================================
    //  EDIT / DELETE 2-STEP CONFIRMATION MODAL
    // =============================================
    let edState = { mode: '', id: null, sku: '', oldQty: 0, step: 1, warehouse: '', location: '', counterName: '' };

    window.openEditModal = function(id, sku, oldQty) {
        const rec = allRecords.find(r => String(r.id) === String(id));
        edState = { mode: 'edit', id, sku, oldQty, step: 1, warehouse: rec?.warehouse, location: rec?.location, counterName: rec?.counter_name };
        document.getElementById('edModalTitle').innerHTML = `<i data-lucide="edit"></i> แก้ไขจำนวนสินค้า (ขั้นที่ 1/2)`;
        document.getElementById('edModalDesc').innerHTML = `ระบุจำนวนใหม่สำหรับรหัสสินค้า <strong>${sku}</strong> (จำนวนเดิม: ${oldQty})`;
        document.getElementById('edInputGroup').style.display = 'block';
        document.getElementById('edNewQty').value = oldQty;
        document.getElementById('edWarningBox').style.display = 'none';
        document.getElementById('edConfirmBtn').innerHTML = `ยืนยันขั้นที่ 1`;
        document.getElementById('edConfirmBtn').className = `cs-btn-save`;
        document.getElementById('editDeleteModal').classList.add('open');
        lucide.createIcons();
    };

    window.openDeleteModal = function(id, sku, qty) {
        const rec = allRecords.find(r => String(r.id) === String(id));
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
        edState = { mode: '', id: null, sku: '', oldQty: 0, step: 1, warehouse: '', location: '', counterName: '' };
    };

    window.handleEdConfirm = async function() {
        if (!supabaseClient) return;

        if (edState.mode === 'edit') {
            if (edState.step === 1) {
                const newQty = parseInt(document.getElementById('edNewQty').value, 10);
                if (!newQty || newQty < 1) {
                    showToast('กรุณาระบุจำนวนที่ถูกต้อง (1 ขึ้นไป)', 'error');
                    return;
                }
                edState.newQty = newQty;
                edState.step = 2;
                document.getElementById('edModalTitle').innerHTML = `<i data-lucide="edit"></i> ยืนยันการแก้ไข (ขั้นที่ 2/2)`;
                document.getElementById('edModalDesc').innerHTML = `คุณต้องการเปลี่ยนจำนวน <strong>${edState.sku}</strong> จาก <strong>${edState.oldQty}</strong> เป็น <strong>${newQty}</strong> ชิ้น ใช่หรือไม่?`;
                document.getElementById('edInputGroup').style.display = 'none';
                document.getElementById('edWarningText').textContent = `ข้อมูลในฐานข้อมูล Supabase จะถูกอัปเดตทันที`;
                document.getElementById('edWarningBox').style.display = 'flex';
                document.getElementById('edConfirmBtn').innerHTML = `<i data-lucide="check"></i> ยืนยันการแก้ไขจริง`;
                lucide.createIcons();
            } else if (edState.step === 2) {
                try {
                    const { error } = await supabaseClient
                        .from('inventory_counts')
                        .update({ counted_qty: edState.newQty })
                        .eq('id', edState.id);
                    if (error) throw error;

                    // Update DOM
                    const qtyEl = document.getElementById(`qty-${edState.id}`);
                    if (qtyEl) qtyEl.textContent = `+${edState.newQty}`;
                    
                    // Update button onclick to reflect new oldQty
                    const liEl = document.getElementById(`record-${edState.id}`);
                    if (liEl) {
                        const editBtn = liEl.querySelector('button[title="แก้ไขจำนวน"]');
                        const delBtn = liEl.querySelector('button[title="ลบรายการ"]');
                        if (editBtn) editBtn.setAttribute('onclick', `openEditModal('${edState.id}', '${edState.sku}', ${edState.newQty})`);
                        if (delBtn) delBtn.setAttribute('onclick', `openDeleteModal('${edState.id}', '${edState.sku}', ${edState.newQty})`);
                    }

                    // Update allRecords cache
                    const rec = allRecords.find(r => String(r.id) === String(edState.id));
                    if (rec) rec.counted_qty = edState.newQty;

                    logAudit('UPDATE', edState.id, edState.sku, edState.oldQty, edState.newQty, edState.warehouse, edState.location, edState.counterName);

                    // Update stats
                    const diff = edState.newQty - edState.oldQty;
                    totalScanned += diff;
                    updateStats();

                    showToast(`✓ อัปเดตจำนวน ${edState.sku} เป็น ${edState.newQty} ชิ้นเรียบร้อย`, 'success');
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
                    const { error } = await supabaseClient
                        .from('inventory_counts')
                        .delete()
                        .eq('id', edState.id);
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

                    // Update stats
                    totalScanned -= edState.oldQty;
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
        
        // Calculate uncounted
        const countedSkus = new Set(allRecords.map(r => String(r.sku_id).toLowerCase().trim()));
        uncountedItemsCache = skuMasterList.filter(s => !countedSkus.has(String(s.sku_name || '').toLowerCase().trim()));
        
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
                { wch: 8 },  // #
                { wch: 30 }, // SKU
                { wch: 50 }  // Product Name
            ];

            const dateStr = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `Uncounted_Items_${dateStr}.xlsx`);
            showToast(`ดาวน์โหลดไฟล์ Excel สำเร็จ (${uncountedItemsCache.length} รายการ)`);

        } catch (err) {
            console.error('[Export Uncounted Items Error]', err);
            showToast(`ส่งออกล้มเหลว: ${err.message}`, 'error');
        }
    };
});
