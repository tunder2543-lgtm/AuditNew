// =============================================================================
//  แจ้งเตือนผลนับข้ามทุกหน้า — realtime popup มุมขวาบน (เพิ่ม/แก้ไข/ลบ)
// =============================================================================
//
// ต่างจาก chat-notify-shared.js ตรงที่ **ไม่มี polling สำรอง** โดยตั้งใจ:
// ผลนับเข้าถี่กว่าข้อความแชทมาก ถ้าให้ทุกหน้า×ทุกแท็บ poll จะกินโควตา Supabase
// ฟรีโดยใช่เหตุ · realtime ใช้ไม่ได้เมื่อไหร่ = ไม่มี popup เงียบ ๆ (ข้อมูลไม่หาย)
//
// ห้ามใช้ innerHTML ทั้งไฟล์ (invariant ข้อ 7) — สร้าง DOM ด้วย textContent เท่านั้น
// ⛔ หน้า live_count_wall มี popup ของตัวเองอยู่แล้ว ต้องข้าม ไม่งั้นเด้งซ้อน 2 อัน
(function () {
    'use strict';

    var ENABLED_KEY = 'count_notify_enabled_v1';
    var TOAST_MS = 6000;
    var MAX_TOASTS = 5;
    var INIT_RETRY_MS = 1500;
    var INIT_RETRY_MAX = 20;
    /** รวบเหตุการณ์ที่มาติด ๆ กันก่อนวาด — สั้นพอที่คนไม่รู้สึกหน่วง */
    var COALESCE_MS = 400;
    /** มาพร้อมกันตั้งแต่เท่านี้ = สรุปกล่องเดียวแทนการเด้งทีละอัน */
    var SUMMARY_MIN = 4;
    var SUMMARY_WORD = { INSERT: 'เพิ่ม', UPDATE: 'แก้ไข', DELETE: 'ลบ' };

    var client = null;
    var channel = null;
    var stackEl = null;
    var initRetryTimer = null;
    var initRetryCount = 0;
    var pending = [];
    var flushTimer = null;

    var META = {
        INSERT: { title: 'เพิ่มรายการนับ', className: 'count-notify-insert' },
        UPDATE: { title: 'แก้ไขรายการนับ', className: 'count-notify-update' },
        DELETE: { title: 'ลบรายการนับ', className: 'count-notify-delete' }
    };

    /** เปิดใช้งานอยู่ไหม — ค่าเริ่มต้นคือ "เปิด" (ไม่เคยตั้ง = เปิด) */
    function isEnabled() {
        try {
            return localStorage.getItem(ENABLED_KEY) !== '0';
        } catch (e) {
            return true; // อ่าน localStorage ไม่ได้ (โหมดส่วนตัว) = ใช้ค่าเริ่มต้น
        }
    }

    function setEnabled(on) {
        try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
        if (!on) {
            pending = []; // ปิดแล้วต้องไม่มีของค้างคิวโผล่ทีหลัง
            clearAllToasts();
        }
        return isEnabled();
    }

    /** หน้าจอนับสดมี popup ของตัวเองแล้ว — ต้องไม่เด้งซ้อน */
    function isOnLiveWallPage() {
        var page = (window.sidebarShared && window.sidebarShared.getActivePage
            && window.sidebarShared.getActivePage()) || '';
        if (page === 'live_count_wall') return true;
        return /live_count_wall\.html/i.test(window.location.pathname || '');
    }

    function toQty(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function fmtQty(v) {
        var n = toQty(v);
        return n === null ? '-' : n.toLocaleString();
    }

    /**
     * แปลง payload ของ realtime เป็นข้อมูลสำหรับวาด popup
     * คืน null = ไม่ต้องเด้ง (ชนิดเหตุการณ์ที่ไม่รู้จัก หรือไม่มีข้อมูลแถว)
     *
     * ⚠️ DELETE ของ Postgres ส่งมาแต่ค่าใน replica identity — บางคอลัมน์อาจว่าง
     *    จึงต้องทนกับ field ที่หายไปทุกตัว ห้ามโยน error
     */
    function buildToastModel(eventType, newRow, oldRow) {
        var type = String(eventType || '').toUpperCase();
        var meta = META[type];
        if (!meta) return null;
        var row = (type === 'DELETE' ? oldRow : newRow) || null;
        if (!row) return null;

        // 🔴 REPLICA IDENTITY ของ inventory_counts เป็นค่าเริ่มต้น ⇒ DELETE/UPDATE ส่ง old
        //    มาแค่ { id } (ยืนยันกับฐานจริง 2026-08-16 · 022 เปลี่ยนเป็น FULL แล้ว แต่ยังต้อง
        //    ทนกับกรณีนี้เผื่อโดน reset) · ถ้าไม่มีอะไรให้เล่าเลย ห้ามยัด "-" หลอกว่าเป็นข้อมูล
        var hasDetail = ['sku_id', 'counted_qty', 'warehouse', 'location', 'counter_name']
            .some(function (k) { return row[k] !== undefined && row[k] !== null && row[k] !== ''; });
        if (!hasDetail) {
            return {
                type: type, title: meta.title, className: meta.className,
                hasDetail: false, who: '', sku: '', place: '', qtyText: ''
            };
        }

        var qtyText;
        if (type === 'UPDATE') {
            var before = toQty(oldRow && oldRow.counted_qty);
            var after = toQty(row.counted_qty);
            qtyText = (before !== null && after !== null && before !== after)
                ? 'จำนวน ' + before.toLocaleString() + ' → ' + after.toLocaleString()
                : 'จำนวน ' + fmtQty(row.counted_qty);
        } else if (type === 'DELETE') {
            qtyText = 'จำนวนที่ลบ ' + fmtQty(row.counted_qty);
        } else {
            qtyText = 'จำนวน ' + fmtQty(row.counted_qty);
        }

        return {
            type: type,
            title: meta.title,
            className: meta.className,
            hasDetail: true,
            who: String(row.counter_name || 'ไม่ระบุผู้นับ'),
            sku: String(row.sku_id || '-'),
            place: String(row.warehouse || '-') + ' / ' + String(row.location || '-'),
            qtyText: qtyText
        };
    }

    // ---------- DOM ----------

    function ensureStack() {
        if (stackEl && document.body.contains(stackEl)) return stackEl;
        stackEl = document.createElement('div');
        stackEl.className = 'count-notify-stack';
        stackEl.setAttribute('aria-live', 'polite');
        stackEl.setAttribute('aria-label', 'แจ้งเตือนผลนับ');
        document.body.appendChild(stackEl);
        return stackEl;
    }

    /**
     * วาง popup ผลนับต่อ "ใต้" กองของแชท — ทั้งคู่ยึดมุมขวาบนตำแหน่งเดียวกัน
     * ถ้าไม่เลื่อนจะทับกันมิด (กองแชทสูงไม่คงที่ จึงต้องวัดตอนเด้งจริงทุกครั้ง)
     */
    function syncStackOffset() {
        if (!stackEl) return;
        var gap = 8;
        // จอเล็ก (≤900px) มีแถบเมนูบน — วางที่ 16px จะทับปุ่ม ☰ แล้ว toast กลืน tap
        // (บทเรียนเดียวกับ .chat-notify-stack ใน chat-notify.css)
        var top = 16;
        if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches) {
            var barRaw = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-bar-h');
            var barH = parseFloat(barRaw);
            top = (Number.isFinite(barH) ? barH : 52) + gap;
        }
        var chat = document.querySelector('.chat-notify-stack');
        if (chat && chat.children.length > 0) {
            var r = chat.getBoundingClientRect();
            if (r.height > 0) top = Math.max(top, r.bottom + gap);
        }
        stackEl.style.top = top + 'px';
    }

    function clearAllToasts() {
        if (stackEl) stackEl.textContent = '';
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function showToast(model) {
        if (!model) return null;
        var stack = ensureStack();
        var box = el('div', 'count-notify-toast ' + model.className);

        var body = el('div', 'count-notify-body');
        body.appendChild(el('strong', null, model.title));
        if (model.hasDetail === false) {
            body.appendChild(el('p', 'count-notify-sub', 'ไม่ทราบรายละเอียด — ฐานข้อมูลไม่ได้ส่งข้อมูลแถวเดิมมา'));
        } else {
            body.appendChild(el('p', null, model.who + ' · ' + model.sku));
            body.appendChild(el('p', 'count-notify-sub', model.place + ' · ' + model.qtyText));
        }
        box.appendChild(body);

        var closeBtn = el('button', 'count-notify-close', '×');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'ปิด');
        var closed = false;
        var close = function () {
            if (closed) return;
            closed = true;
            box.classList.add('count-notify-out');
            setTimeout(function () { box.remove(); }, 260);
        };
        closeBtn.addEventListener('click', close);
        box.appendChild(closeBtn);

        stack.prepend(box);
        syncStackOffset();
        setTimeout(close, TOAST_MS);

        while (stack.children.length > MAX_TOASTS) {
            if (stack.lastElementChild) stack.lastElementChild.remove();
            else break;
        }
        return box;
    }

    /** สรุปเหตุการณ์เป็นกล่องเดียว — ใช้เมื่อมาพร้อมกันเกิน SUMMARY_MIN */
    function showSummaryToast(models) {
        var stack = ensureStack();
        var box = el('div', 'count-notify-toast count-notify-bulk');
        var body = el('div', 'count-notify-body');
        body.appendChild(el('strong', null, 'ผลนับเปลี่ยนแปลง ' + models.length.toLocaleString() + ' รายการ'));

        var parts = [];
        ['INSERT', 'UPDATE', 'DELETE'].forEach(function (t) {
            var n = models.filter(function (m) { return m.type === t; }).length;
            if (n > 0) parts.push(SUMMARY_WORD[t] + ' ' + n.toLocaleString());
        });
        body.appendChild(el('p', 'count-notify-sub', parts.join(' · ')));
        box.appendChild(body);

        var closeBtn = el('button', 'count-notify-close', '×');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'ปิด');
        closeBtn.addEventListener('click', function () { box.remove(); });
        box.appendChild(closeBtn);

        stack.prepend(box);
        syncStackOffset();
        setTimeout(function () { box.remove(); }, TOAST_MS);
        return box;
    }

    /**
     * ปล่อยเหตุการณ์ที่คั่งไว้ออกเป็น popup
     * เดี่ยว/ไม่กี่รายการ = กล่องละเอียดเหมือนเดิม · มาพร้อมกันเยอะ = สรุปกล่องเดียว
     * (นำเข้า Excel 3,000 แถว = Postgres ยิง 3,000 event ต่อแท็บ ถ้าเด้งทีละอันจอตาย)
     */
    function flushPending() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        var batch = pending;
        pending = [];
        if (!batch.length) return 0;
        if (batch.length < SUMMARY_MIN) {
            batch.forEach(showToast);
        } else {
            showSummaryToast(batch);
        }
        return batch.length;
    }

    /** ทางเข้าหลัก: realtime → คิว → popup · คืน true เมื่อรับไว้เด้ง (ให้เทสตรวจได้) */
    function handlePayload(payload) {
        if (!isEnabled()) return false;
        if (isOnLiveWallPage()) return false;
        var p = payload || {};
        var model = buildToastModel(p.eventType || p.type, p.new, p.old);
        if (!model) return false;
        pending.push(model);
        if (!flushTimer) flushTimer = setTimeout(flushPending, COALESCE_MS);
        return true;
    }

    // ---------- realtime ----------

    function getClient() {
        try {
            return (window.apiService && window.apiService.getClient()) || null;
        } catch (e) {
            return null;
        }
    }

    function setupRealtime() {
        if (!client) return;
        if (channel) {
            try { client.removeChannel(channel); } catch (e) { /* ignore */ }
            channel = null;
        }
        var filter = { schema: 'public', table: 'inventory_counts' };
        channel = client
            .channel('count_notify_global')
            .on('postgres_changes', Object.assign({ event: 'INSERT' }, filter), handlePayload)
            .on('postgres_changes', Object.assign({ event: 'UPDATE' }, filter), handlePayload)
            .on('postgres_changes', Object.assign({ event: 'DELETE' }, filter), handlePayload)
            .subscribe(function (status) {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn('[CountNotify] realtime ใช้ไม่ได้:', status);
                }
            });
    }

    function scheduleInitRetry() {
        if (initRetryCount >= INIT_RETRY_MAX) return;
        if (initRetryTimer) return;
        initRetryTimer = setTimeout(function () {
            initRetryTimer = null;
            initRetryCount++;
            init();
        }, INIT_RETRY_MS);
    }

    function init() {
        client = getClient();
        if (!client) {
            scheduleInitRetry();
            return;
        }
        initRetryCount = 0;
        setupRealtime();
    }

    window.countNotifyShared = {
        init: init,
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        handlePayload: handlePayload,
        flushPending: flushPending,
        buildToastModel: buildToastModel
    };
})();
