// =============================================================================
//  แจ้งเตือนแชททั้งระบบ — Realtime + polling สำรอง + toast + badge
// =============================================================================

(function () {
    const ROOM_ID = 'main';
    const SESSION_KEY = 'audit_chat_session_v1';
    const UNREAD_KEY = 'audit_chat_unread_v1';
    const LAST_READ_KEY = 'audit_chat_last_read_v1';
    const POLL_MS = 8000;
    const INIT_RETRY_MS = 1500;
    const INIT_RETRY_MAX = 20;

    let channel = null;
    let client = null;
    let stackEl = null;
    let pollTimer = null;
    let initRetryTimer = null;
    let initRetryCount = 0;
    let lastPollIso = null;
    let realtimeReady = false;
    const seenIds = new Set();

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getMySessionId() {
        return localStorage.getItem(SESSION_KEY) || '';
    }

    function rowSessionId(row) {
        return row?.client_session_id || row?.session_id || '';
    }

    function messageId(row) {
        return row?.id || `${row?.created_at || ''}_${rowSessionId(row)}_${row?.message || ''}`;
    }

    function isOnChatPage() {
        const page = window.sidebarShared?.getActivePage?.()
            || document.getElementById('appSidebar')?.dataset?.activePage
            || '';
        if (page === 'chat') return true;
        return /chat\.html/i.test(window.location.pathname);
    }

    function getUnread() {
        return Math.max(0, parseInt(localStorage.getItem(UNREAD_KEY) || '0', 10) || 0);
    }

    function setUnread(n) {
        localStorage.setItem(UNREAD_KEY, String(Math.max(0, n)));
        updateBadge();
    }

    function updateBadge() {
        const n = getUnread();
        const badge = document.querySelector('[data-nav-page="chat"] .sidebar-chat-badge');
        if (!badge) return;
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.hidden = n <= 0;
    }

    function markRead() {
        localStorage.setItem(LAST_READ_KEY, new Date().toISOString());
        setUnread(0);
        lastPollIso = new Date().toISOString();
    }

    function chatHref() {
        if (window.sidebarShared?.pageHref) return window.sidebarShared.pageHref('chat');
        return /\/Html\//i.test(window.location.pathname) ? 'chat.html' : 'Html/chat.html';
    }

    function ensureStack() {
        if (stackEl) return stackEl;
        stackEl = document.getElementById('chatNotifyStack');
        if (!stackEl) {
            stackEl = document.createElement('div');
            stackEl.id = 'chatNotifyStack';
            stackEl.className = 'chat-notify-stack';
            stackEl.setAttribute('aria-live', 'polite');
            document.body.appendChild(stackEl);
        }
        return stackEl;
    }

    function formatTime(isoOrTs) {
        try {
            const d = isoOrTs ? new Date(isoOrTs) : new Date();
            return d.toLocaleString('th-TH', { hour12: false });
        } catch {
            return '';
        }
    }

    function truncate(text, max) {
        const t = String(text || '').trim();
        if (t.length <= max) return t;
        return t.slice(0, max - 1) + '…';
    }

    function buildNotifyContent(row) {
        const eventType = row.event_type || (row.role === 'sys' ? 'join' : 'message');
        const name = row.sender_name || 'ผู้ใช้';
        const msg = row.message || '';
        if (eventType === 'join') {
            return {
                kind: 'join',
                title: 'มีคนเข้าแชท',
                text: truncate(msg || `${name} เข้าร่วมแชท`, 120),
                icon: 'user-plus'
            };
        }
        return {
            kind: 'message',
            title: 'ข้อความใหม่',
            text: truncate(name ? `${name}: ${msg}` : msg, 140),
            icon: 'message-circle'
        };
    }

    function showToast(row) {
        const stack = ensureStack();
        const info = buildNotifyContent(row);
        const el = document.createElement('div');
        el.className = 'chat-notify-toast ' + info.kind;
        el.innerHTML = `
            <div class="chat-notify-icon"><i data-lucide="${info.icon}"></i></div>
            <div class="chat-notify-body">
                <div class="chat-notify-title">${escapeHtml(info.title)}</div>
                <div class="chat-notify-text">${escapeHtml(info.text)}</div>
                <div class="chat-notify-time">${escapeHtml(formatTime(row.created_at))}</div>
            </div>`;
        el.addEventListener('click', () => {
            markRead();
            window.location.href = chatHref();
        });
        stack.appendChild(el);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        setTimeout(() => {
            el.classList.add('closing');
            el.addEventListener('animationend', () => el.remove(), { once: true });
        }, 6000);

        while (stack.children.length > 5) {
            stack.firstElementChild?.remove();
        }
    }

    function tryBrowserNotify(row) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const info = buildNotifyContent(row);
        try {
            const n = new Notification(info.title, {
                body: info.text,
                tag: 'audit-chat-' + messageId(row)
            });
            n.onclick = () => {
                window.focus();
                markRead();
                window.location.href = chatHref();
                n.close();
            };
        } catch { /* ignore */ }
    }

    function rememberSeen(row) {
        const id = messageId(row);
        seenIds.add(id);
        if (seenIds.size > 400) {
            const keep = Array.from(seenIds).slice(-300);
            seenIds.clear();
            keep.forEach(k => seenIds.add(k));
        }
    }

    function alreadySeen(row) {
        return seenIds.has(messageId(row));
    }

    function onNewMessage(row, { forceToast } = {}) {
        if (!row) return;
        if (alreadySeen(row)) return;
        rememberSeen(row);

        const sid = rowSessionId(row);
        if (sid && sid === getMySessionId()) return;

        if (row.room_id && row.room_id !== ROOM_ID) return;

        setUnread(getUnread() + 1);

        const skipToast = !forceToast
            && isOnChatPage()
            && document.visibilityState === 'visible';

        if (skipToast) return;

        showToast(row);
        tryBrowserNotify(row);
    }

    function getClient() {
        try {
            return window.apiService?.getClient?.() || null;
        } catch {
            return null;
        }
    }

    async function seedSeenFromHistory() {
        if (!client) return;
        try {
            const { data } = await client
                .from('chat_messages')
                .select('id,created_at,client_session_id,session_id,message,room_id')
                .eq('room_id', ROOM_ID)
                .order('created_at', { ascending: false })
                .limit(80);
            (data || []).forEach(row => rememberSeen(row));
            if (data && data.length) {
                lastPollIso = data[0].created_at;
            }
        } catch { /* ignore */ }
    }

    async function pollNewMessages() {
        if (!client) return;
        const since = lastPollIso || new Date(Date.now() - 120000).toISOString();
        try {
            const { data, error } = await client
                .from('chat_messages')
                .select('id,room_id,event_type,role,sender_name,message,created_at,client_session_id,session_id')
                .eq('room_id', ROOM_ID)
                .gt('created_at', since)
                .order('created_at', { ascending: true })
                .limit(50);
            if (error) return;
            const rows = data || [];
            if (rows.length) {
                lastPollIso = rows[rows.length - 1].created_at;
            }
            rows.forEach(row => onNewMessage(row));
        } catch { /* ignore */ }
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(pollNewMessages, POLL_MS);
    }

    function stopPolling() {
        if (!pollTimer) return;
        clearInterval(pollTimer);
        pollTimer = null;
    }

    function setupRealtime() {
        if (!client) return;

        if (channel) {
            try { client.removeChannel(channel); } catch { /* ignore */ }
            channel = null;
        }

        realtimeReady = false;

        channel = client
            .channel('chat_notify_global_' + ROOM_ID)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages'
            }, (payload) => {
                const row = payload?.new;
                if (row?.room_id && row.room_id !== ROOM_ID) return;
                onNewMessage(row);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    realtimeReady = true;
                } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
                    realtimeReady = false;
                    startPolling();
                }
            });

        startPolling();
    }

    function scheduleInitRetry() {
        if (initRetryCount >= INIT_RETRY_MAX) return;
        if (initRetryTimer) return;
        initRetryTimer = setTimeout(() => {
            initRetryTimer = null;
            initRetryCount++;
            init();
        }, INIT_RETRY_MS);
    }

    async function init() {
        updateBadge();
        client = getClient();

        if (!client) {
            scheduleInitRetry();
            return;
        }

        initRetryCount = 0;
        const lastRead = localStorage.getItem(LAST_READ_KEY);
        if (lastRead) lastPollIso = lastRead;

        await seedSeenFromHistory();
        setupRealtime();

        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    }

    window.chatNotifyShared = {
        init,
        markRead,
        getUnread,
        updateBadge,
        onNewMessage,
        isRealtimeReady: () => realtimeReady
    };
})();
