// =============================================================================
//  Live Count Wall — จอแยกซ้ายรอนับ / ขวาส่งแล้ว + Realtime + Toast
// =============================================================================

(function () {
    const RS = window.reconcileService;
    /** Polling เมื่อ Realtime ไม่พร้อม — แหล่งหลัก */
    const POLL_MS_FAST = 15000;
    /** Polling เมื่อ Realtime ทำงาน — sync สำรองเป็นครั้งคราว (ไม่โหลดซ้ำกับ event ทุก 12 วินาที) */
    const POLL_MS_SLOW = 90000;
    /** โหลด sku_master ใหม่ทุก N ครั้งของ poll ช้า (master เปลี่ยนไม่บ่อย) */
    const SKU_MASTER_RELOAD_EVERY_SLOW_POLLS = 3;
    const MAX_SUBMITTED_DISPLAY = 300;
    const STANDARD_WAREHOUSES = ['ตึกกันตนา', 'หน้าไลฟ์(บางกรวย)', 'คลังอะไหล่'];
    const STORAGE_WH = 'live_wall_warehouse';
    const STORAGE_CYCLE = 'live_wall_cycle_id';

    let client = null;
    let realtimeChannel = null;
    let skuMasterAll = [];
    let countRowsAll = [];
    let cyclesList = [];
    let selectedCycleId = '';
    let scopeWarehouse = '';
    let knownIds = new Set();
    let isLoading = false;
    let realtimeOk = false;
    let pollTimer = null;
    let slowPollTick = 0;

    const els = {};

    function $(id) {
        return document.getElementById(id);
    }

    function normalizeSku(value) {
        // ใช้ shared utility (UPPERCASE + trim) เพื่อความสอดคล้องทั้งระบบ
        if (typeof window !== 'undefined' && window.SkuUtils?.normalizeSku) {
            return window.SkuUtils.normalizeSku(value);
        }
        return String(value ?? '').trim().toUpperCase();
    }

    function normalizeId(value) {
        if (value == null || value === '') return '';
        return String(value);
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    function isTodayInThailand(isoString) {
        if (!isoString) return false;
        const thaiDate = new Date(isoString).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        return thaiDate === today;
    }

    function bangkokTodayRange() {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        const m = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const start = m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+07:00';
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const dt = new Date(Date.UTC(y, mo - 1, d + 1));
        const ey = dt.getUTCFullYear();
        const em = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const ed = String(dt.getUTCDate()).padStart(2, '0');
        const end = ey + '-' + em + '-' + ed + 'T00:00:00+07:00';
        return { start: start, end: end };
    }

    function getSelectedCycle() {
        if (!selectedCycleId) return null;
        return cyclesList.find(function (c) { return c.id === selectedCycleId; }) || null;
    }

    function rowMatchesScope(row) {
        if (!row) return false;
        const cycle = getSelectedCycle();
        if (cycle) {
            if (row.cycle_id && row.cycle_id !== cycle.id) return false;
            if (!row.cycle_id && cycle.id) {
                const range = RS.getCycleLinkRange(cycle);
                if (range?.start && range?.end) {
                    const t = row.created_at ? new Date(row.created_at).getTime() : 0;
                    const s = new Date(range.start).getTime();
                    const e = new Date(range.end).getTime();
                    if (t < s || t >= e) return false;
                }
            }
            if (!RS.isAllWarehousesCycle(cycle)) {
                const list = RS.parseCycleWarehouses(cycle);
                if (list?.length && !list.includes(row.warehouse)) return false;
            }
        }
        if (scopeWarehouse) {
            return normalizeSku(row.warehouse) === normalizeSku(scopeWarehouse);
        }
        return true;
    }

    function skuMatchesScope(sku) {
        if (!scopeWarehouse) return true;
        return normalizeSku(sku.warehouse) === normalizeSku(scopeWarehouse);
    }

    function getScopedCounts() {
        return countRowsAll.filter(rowMatchesScope);
    }

    function getScopedMaster() {
        return skuMasterAll.filter(skuMatchesScope);
    }

    function getCountedSkuSet(rows) {
        const set = new Set();
        rows.forEach(function (r) {
            const k = normalizeSku(r.sku_id);
            if (k) set.add(k);
        });
        return set;
    }

    function buildSkuNameMap(master) {
        const map = {};
        master.forEach(function (s) {
            const k = normalizeSku(s.sku_name);
            if (k) map[k] = s.name_pro || '';
        });
        return map;
    }

    function computePending() {
        const counts = getScopedCounts();
        const master = getScopedMaster();
        const counted = getCountedSkuSet(counts);
        return master
            .filter(function (s) {
                return !counted.has(normalizeSku(s.sku_name));
            })
            .sort(function (a, b) {
                return String(a.sku_name || '').localeCompare(String(b.sku_name || ''), 'th');
            });
    }

    function computeSubmitted() {
        return getScopedCounts()
            .slice()
            .sort(function (a, b) {
                const at = a.created_at ? new Date(a.created_at).getTime() : 0;
                const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
                return bt - at;
            })
            .slice(0, MAX_SUBMITTED_DISPLAY);
    }

    function renderLists(opts) {
        opts = opts || {};
        const nameMap = buildSkuNameMap(getScopedMaster());
        const pending = computePending();
        const submitted = computeSubmitted();
        const todayCount = submitted.filter(function (r) { return isTodayInThailand(r.created_at); }).length;

        if (els.pendingCount) els.pendingCount.textContent = pending.length.toLocaleString();
        if (els.submittedCount) els.submittedCount.textContent = submitted.length.toLocaleString();
        if (els.todayCount) els.todayCount.textContent = todayCount.toLocaleString();

        if (els.pendingList) {
            if (!pending.length) {
                els.pendingList.innerHTML =
                    '<div class="wall-empty"><i data-lucide="check-circle-2"></i><p>นับครบทุก SKU ในขอบเขตแล้ว</p></div>';
            } else {
                els.pendingList.innerHTML = pending.map(function (s, i) {
                    return (
                        '<article class="wall-card wall-card-pending">' +
                        '<span class="wall-card-rank">' + (i + 1) + '</span>' +
                        '<div class="wall-card-body">' +
                        '<strong class="wall-card-sku">' + escapeHtml(s.sku_name) + '</strong>' +
                        (s.name_pro ? '<span class="wall-card-name">' + escapeHtml(s.name_pro) + '</span>' : '') +
                        '<span class="wall-card-meta">' + escapeHtml(s.warehouse || '-') + '</span>' +
                        '</div></article>'
                    );
                }).join('');
            }
        }

        if (els.submittedList) {
            if (!submitted.length) {
                els.submittedList.innerHTML =
                    '<div class="wall-empty"><i data-lucide="inbox"></i><p>ยังไม่มีรายการส่งเข้ามาในขอบเขตนี้</p></div>';
            } else {
                els.submittedList.innerHTML = submitted.map(function (r) {
                    const skuKey = normalizeSku(r.sku_id);
                    const name = nameMap[skuKey] || '';
                    const isNew = opts.highlightId && String(r.id) === String(opts.highlightId);
                    const isToday = isTodayInThailand(r.created_at);
                    return (
                        '<article class="wall-card wall-card-done' + (isNew ? ' wall-card-flash' : '') + '" data-id="' + escapeHtml(r.id) + '">' +
                        '<div class="wall-card-body">' +
                        '<strong class="wall-card-sku">' + escapeHtml(r.sku_id) + '</strong>' +
                        (name ? '<span class="wall-card-name">' + escapeHtml(name) + '</span>' : '') +
                        '<span class="wall-card-meta">' +
                        escapeHtml(r.counter_name || '-') + ' · ' +
                        escapeHtml(r.warehouse || '-') + ' / ' + escapeHtml(r.location || '-') +
                        '</span>' +
                        '<span class="wall-card-meta">' + formatThaiDateTime(r.created_at) +
                        (isToday ? ' <em class="wall-tag-today">วันนี้</em>' : '') +
                        '</span>' +
                        '</div>' +
                        '<span class="wall-card-qty">' + Number(r.counted_qty || 0).toLocaleString() + '</span>' +
                        '</article>'
                    );
                }).join('');
            }
        }

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    const TOAST_META = {
        INSERT: { title: 'เพิ่มรายการนับ', icon: 'plus-circle', className: 'wall-toast-insert' },
        UPDATE: { title: 'แก้ไขรายการนับ', icon: 'pencil', className: 'wall-toast-update' },
        DELETE: { title: 'ลบรายการนับ', icon: 'trash-2', className: 'wall-toast-delete' }
    };

    function showToast(row, eventType, oldRow) {
        const stack = els.toastStack;
        if (!stack || !row) return;

        const meta = TOAST_META[eventType] || TOAST_META.INSERT;
        const nameMap = buildSkuNameMap(getScopedMaster());
        const skuKey = normalizeSku(row.sku_id);
        const name = nameMap[skuKey] || '';

        let qtyLine = 'จำนวน <b>' + Number(row.counted_qty || 0).toLocaleString() + '</b>';
        if (eventType === 'UPDATE' && oldRow && Number(oldRow.counted_qty) !== Number(row.counted_qty)) {
            qtyLine = 'จำนวน <b>' + Number(oldRow.counted_qty || 0).toLocaleString() +
                '</b> → <b>' + Number(row.counted_qty || 0).toLocaleString() + '</b>';
        }
        if (eventType === 'DELETE') {
            qtyLine = 'จำนวนที่ลบ <b>' + Number(row.counted_qty || 0).toLocaleString() + '</b>';
        }

        const el = document.createElement('div');
        el.className = 'wall-toast ' + meta.className;
        el.innerHTML =
            '<div class="wall-toast-icon"><i data-lucide="' + meta.icon + '"></i></div>' +
            '<div class="wall-toast-body">' +
            '<strong>' + meta.title + '</strong>' +
            '<p>' + escapeHtml(row.counter_name || 'ไม่ระบุผู้นับ') + ' · ' + escapeHtml(row.sku_id) + '</p>' +
            (name ? '<p class="wall-toast-sub">' + escapeHtml(name) + '</p>' : '') +
            '<p class="wall-toast-sub">' + escapeHtml(row.warehouse || '-') + ' / ' + escapeHtml(row.location || '-') +
            ' · ' + qtyLine + '</p>' +
            '</div>' +
            '<button type="button" class="wall-toast-close" aria-label="ปิด">&times;</button>';

        const close = function () {
            el.classList.add('wall-toast-out');
            setTimeout(function () { el.remove(); }, 280);
        };

        el.querySelector('.wall-toast-close').addEventListener('click', close);
        stack.prepend(el);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        while (stack.children.length > 5) {
            stack.lastElementChild?.remove();
        }

        setTimeout(close, 8000);
    }

    function upsertRow(row) {
        if (!row?.id) return false;
        const sid = normalizeId(row.id);
        const idx = countRowsAll.findIndex(function (r) { return normalizeId(r.id) === sid; });
        if (idx >= 0) {
            countRowsAll[idx] = row;
        } else {
            countRowsAll.unshift(row);
        }
        knownIds.add(normalizeId(row.id));
        return true;
    }

    function getCachedRowById(id) {
        const sid = normalizeId(id);
        if (!sid) return null;
        return countRowsAll.find(function (r) { return normalizeId(r.id) === sid; }) || null;
    }

    /** Realtime DELETE มักส่ง old แค่ { id } — ใช้แถวจาก cache แทน */
    function resolveRowForEvent(partial, preferId) {
        const id = partial?.id || preferId;
        if (!id) return partial || null;
        const cached = getCachedRowById(id);
        if (cached) return Object.assign({}, cached, partial, { id: id });
        return partial?.id ? partial : null;
    }

    function removeRowById(id) {
        const sid = normalizeId(id);
        if (!sid) return false;
        const idx = countRowsAll.findIndex(function (r) { return normalizeId(r.id) === sid; });
        if (idx < 0) return false;
        countRowsAll.splice(idx, 1);
        knownIds.delete(sid);
        return true;
    }

    function handleInsert(row, fromRealtime) {
        if (!rowMatchesScope(row)) return;
        upsertRow(row);
        renderLists({ highlightId: row.id });
        if (fromRealtime) showToast(row, 'INSERT');
        updateLiveBadge(true);
    }

    function handleUpdate(oldRow, newRow, fromRealtime) {
        const effectiveOld = resolveRowForEvent(oldRow);
        const wasInScope = effectiveOld && rowMatchesScope(effectiveOld);
        const isInScope = newRow && rowMatchesScope(newRow);

        if (wasInScope && effectiveOld?.id) removeRowById(effectiveOld.id);

        if (isInScope) {
            upsertRow(newRow);
            renderLists({ highlightId: newRow.id });
            if (fromRealtime) showToast(newRow, 'UPDATE', effectiveOld);
        } else {
            renderLists();
        }
        updateLiveBadge(true);
    }

    function handleDelete(oldRow, fromRealtime) {
        const id = oldRow?.id;
        if (!id) return;

        const cached = getCachedRowById(id);
        const displayRow = cached || resolveRowForEvent(oldRow, id);

        if (!displayRow) {
            removeRowById(id);
            renderLists();
            return;
        }

        const inScope = rowMatchesScope(displayRow);
        const removed = removeRowById(id);

        renderLists();

        if (fromRealtime && removed && inScope) {
            showToast(displayRow, 'DELETE');
        }
        updateLiveBadge(true);
    }

    function handleRealtimePayload(payload, fromRealtime) {
        const eventType = payload.eventType;
        if (eventType === 'INSERT') {
            handleInsert(payload.new, fromRealtime);
        } else if (eventType === 'UPDATE') {
            handleUpdate(payload.old, payload.new, fromRealtime);
        } else if (eventType === 'DELETE') {
            handleDelete(payload.old, fromRealtime);
        }
    }

    function updateLiveBadge(on) {
        if (!els.liveBadge) return;
        els.liveBadge.classList.toggle('wall-live-on', !!on);
        if (!on) {
            els.liveBadge.textContent = 'Offline';
            return;
        }
        if (realtimeOk) {
            const sec = Math.round(POLL_MS_SLOW / 1000);
            els.liveBadge.textContent = 'Live · Realtime (sync ทุก ' + sec + ' วินาที)';
        } else {
            const sec = Math.round(POLL_MS_FAST / 1000);
            els.liveBadge.textContent = 'Live · Polling ทุก ' + sec + ' วินาที';
        }
    }

    async function loadPagedSkuMaster() {
        const c = client;
        if (!c) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
        let rows = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
            const { data, error } = await c
                .from('sku_master')
                .select('sku_name, name_pro, warehouse')
                .order('sku_name', { ascending: true })
                .range(from, from + pageSize - 1);
            if (error) throw error;
            rows = rows.concat(data || []);
            if (!data || data.length < pageSize) break;
            from += pageSize;
        }
        return rows;
    }

    async function loadCounts() {
        const cycle = getSelectedCycle();
        const opts = { maxRows: 50000 };
        if (cycle) {
            opts.cycle = cycle;
            opts.cycleId = cycle.id;
        } else {
            const ym = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
            const monthRange = RS.yearMonthToRangeISO(ym);
            if (monthRange) opts.range = monthRange;
            if (scopeWarehouse) opts.warehouseValue = scopeWarehouse;
        }
        return RS.loadInventoryCountsForDashboard(opts);
    }

    function detectDeletedRowsOnPoll(prevRows, nextRows) {
        const nextIdSet = new Set(
            nextRows.map(function (r) { return normalizeId(r.id); }).filter(Boolean)
        );
        prevRows.forEach(function (row) {
            const id = normalizeId(row.id);
            if (!id || nextIdSet.has(id)) return;
            if (rowMatchesScope(row)) showToast(row, 'DELETE');
        });
    }

    async function reloadAll(silent, opts) {
        opts = opts || {};
        if (isLoading) return;
        isLoading = true;
        if (els.btnRefresh) els.btnRefresh.disabled = true;
        if (!silent && els.statusText) els.statusText.textContent = 'กำลังโหลด...';

        const prevRows = silent && countRowsAll.length ? countRowsAll.slice() : [];
        const reloadMaster = opts.reloadMaster !== false;

        try {
            let master = skuMasterAll;
            let counts;
            if (reloadMaster) {
                const pair = await Promise.all([loadPagedSkuMaster(), loadCounts()]);
                master = pair[0];
                counts = pair[1];
                skuMasterAll = master;
            } else {
                counts = await loadCounts();
            }
            if (silent && prevRows.length) {
                detectDeletedRowsOnPoll(prevRows, counts);
            }
            countRowsAll = counts;
            knownIds = new Set(counts.map(function (r) { return normalizeId(r.id); }).filter(Boolean));
            renderLists();
            if (reloadMaster) populateWarehouseSelect();
            const modeLabel = realtimeOk ? 'Realtime + sync สำรอง' : 'Polling';
            if (els.statusText) {
                els.statusText.textContent =
                    'อัปเดตล่าสุด ' + formatThaiDateTime(new Date().toISOString()) + ' · ' + modeLabel;
            }
        } catch (err) {
            console.error('[LiveWall]', err);
            if (els.statusText) els.statusText.textContent = 'โหลดไม่สำเร็จ: ' + (err.message || err);
        } finally {
            isLoading = false;
            if (els.btnRefresh) els.btnRefresh.disabled = false;
        }
    }

    function teardownRealtime() {
        if (realtimeChannel && client) {
            client.removeChannel(realtimeChannel);
        }
        realtimeChannel = null;
        realtimeOk = false;
    }

    function setupRealtime() {
        teardownRealtime();
        if (!client) return;

        const tableFilter = { schema: 'public', table: 'inventory_counts' };

        realtimeChannel = client
            .channel('live-count-wall-' + Date.now())
            .on('postgres_changes', { event: 'INSERT', ...tableFilter }, function (payload) {
                handleRealtimePayload(payload, true);
            })
            .on('postgres_changes', { event: 'UPDATE', ...tableFilter }, function (payload) {
                handleRealtimePayload(payload, true);
            })
            .on('postgres_changes', { event: 'DELETE', ...tableFilter }, function (payload) {
                handleRealtimePayload(payload, true);
            })
            .subscribe(function (status) {
                const prevOk = realtimeOk;
                realtimeOk = status === 'SUBSCRIBED';
                if (prevOk !== realtimeOk) {
                    slowPollTick = 0;
                    reschedulePolling();
                }
                updateLiveBadge(realtimeOk || !!pollTimer);
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn('[LiveWall] Realtime:', status, '— ใช้ polling ถี่ขึ้นแทน');
                    reschedulePolling();
                }
            });
    }

    function getPollIntervalMs() {
        return realtimeOk ? POLL_MS_SLOW : POLL_MS_FAST;
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    /** ตั้ง polling ตามสถานะ Realtime — ไม่รันถี่คู่กับ event แบบเดิม */
    function reschedulePolling() {
        stopPolling();
        const ms = getPollIntervalMs();
        pollTimer = setInterval(function () {
            if (document.hidden) return;

            let reloadMaster = true;
            if (realtimeOk) {
                slowPollTick += 1;
                reloadMaster = slowPollTick % SKU_MASTER_RELOAD_EVERY_SLOW_POLLS === 0;
            }
            reloadAll(true, { reloadMaster: reloadMaster });
        }, ms);
        updateLiveBadge(true);
    }

    function setupPolling() {
        reschedulePolling();
    }

    function populateWarehouseSelect() {
        if (!els.filterWarehouse) return;
        const merged = STANDARD_WAREHOUSES.slice();
        skuMasterAll.forEach(function (s) {
            const w = String(s.warehouse || '').trim();
            if (w && !merged.includes(w)) merged.push(w);
        });
        const opts = ['<option value="">ทุกคลัง</option>'];
        merged.forEach(function (w) {
            opts.push('<option value="' + escapeHtml(w) + '">' + escapeHtml(w) + '</option>');
        });
        els.filterWarehouse.innerHTML = opts.join('');
        if (scopeWarehouse) els.filterWarehouse.value = scopeWarehouse;
    }

    async function populateCycleSelect() {
        if (!els.filterCycle || !client) return;
        try {
            cyclesList = await RS.fetchCycles(null);
            const opts = ['<option value="">— วันนี้ (ไม่กรองรอบ) —</option>'];
            cyclesList.forEach(function (c) {
                opts.push(
                    '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(RS.formatCycleLabel(c)) + '</option>'
                );
            });
            els.filterCycle.innerHTML = opts.join('');
            if (selectedCycleId && cyclesList.some(function (c) { return c.id === selectedCycleId; })) {
                els.filterCycle.value = selectedCycleId;
            } else {
                const active = RS.getActiveCycle();
                if (active?.id && cyclesList.some(function (c) { return c.id === active.id; })) {
                    selectedCycleId = active.id;
                    els.filterCycle.value = selectedCycleId;
                } else {
                    selectedCycleId = '';
                }
            }
        } catch (e) {
            console.warn('[LiveWall] cycles', e);
        }
    }

    function bindEvents() {
        if (els.btnRefresh) {
            els.btnRefresh.addEventListener('click', function () { reloadAll(false); });
        }
        if (els.filterWarehouse) {
            els.filterWarehouse.addEventListener('change', function () {
                scopeWarehouse = els.filterWarehouse.value || '';
                localStorage.setItem(STORAGE_WH, scopeWarehouse);
                reloadAll(false);
            });
        }
        if (els.filterCycle) {
            els.filterCycle.addEventListener('change', function () {
                selectedCycleId = els.filterCycle.value || '';
                if (selectedCycleId) localStorage.setItem(STORAGE_CYCLE, selectedCycleId);
                else localStorage.removeItem(STORAGE_CYCLE);
                reloadAll(false);
            });
        }
        if (els.btnFullscreen) {
            els.btnFullscreen.addEventListener('click', function () {
                document.body.classList.toggle('wall-fullscreen');
                const on = document.body.classList.contains('wall-fullscreen');
                els.btnFullscreen.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                stopPolling();
                return;
            }
            reloadAll(true, { reloadMaster: true });
            reschedulePolling();
        });
    }

    function cacheElements() {
        els.pendingList = $('wallPendingList');
        els.submittedList = $('wallSubmittedList');
        els.pendingCount = $('wallPendingCount');
        els.submittedCount = $('wallSubmittedCount');
        els.todayCount = $('wallTodayCount');
        els.toastStack = $('wallToastStack');
        els.filterWarehouse = $('wallFilterWarehouse');
        els.filterCycle = $('wallFilterCycle');
        els.btnRefresh = $('wallBtnRefresh');
        els.btnFullscreen = $('wallBtnFullscreen');
        els.statusText = $('wallStatusText');
        els.liveBadge = $('wallLiveBadge');
    }

    async function init() {
        cacheElements();
        scopeWarehouse = localStorage.getItem(STORAGE_WH) || '';
        selectedCycleId = localStorage.getItem(STORAGE_CYCLE) || '';

        bindEvents();

        const ok = await window.checkSupabaseConnection?.();
        client = window.apiService?.getClient?.();
        if (!ok || !client) {
            if (els.statusText) els.statusText.textContent = 'เชื่อมต่อ Supabase ไม่ได้ — ไปที่หน้าตั้งค่า';
            return;
        }

        if (RS?.ensureSchemaReadyWithNotice) {
            await RS.ensureSchemaReadyWithNotice(msg => {
                console.warn('[Schema]', msg);
                if (els.statusText) els.statusText.textContent = msg;
            });
        }

        await populateCycleSelect();
        await reloadAll(false);
        populateWarehouseSelect();
        setupRealtime();
        setupPolling();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.liveCountWall = { reload: reloadAll };
})();
