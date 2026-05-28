// =============================================================================
//  Sidebar — กลุ่มเมนูเปิด/ปิดได้ (ใช้ร่วมทุกหน้า)
// =============================================================================

(function () {
    const STORAGE_KEY = 'sidebar_groups_open_v1';

    /** หน้าเหล่านี้: เปิดทุกกลุ่มเป็นค่าเริ่มต้น (ยังพับได้) — ไม่ซ่อนรายการย่อยแบบพับปิดตลอด */
    const FLAT_PAGES = new Set(['index', 'import_counts', 'sku_master', 'settings']);

    const GROUPS = [
        {
            id: 'stock',
            label: 'เมนูนับสต็อก',
            icon: 'clipboard-list',
            items: [
                { id: 'index', label: 'นับสต็อก', icon: 'clipboard-list' },
                { id: 'import_counts', label: 'Import นับ', icon: 'file-input' }
            ]
        },
        {
            id: 'audit',
            label: 'เมนูตรวจสอบ',
            icon: 'shield-check',
            items: [
                { id: 'audit_check', label: 'ตรวจสอบ', icon: 'shield-check' },
                { id: 'count_search', label: 'ค้นหาผลนับ', icon: 'search' },
                { id: 'reconcile', label: 'Match ยอด', icon: 'scale' },
                { id: 'book_explorer', label: 'Book Explorer', icon: 'book-copy' },
                { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
                { id: 'live_count_wall', label: 'จอนับสด', icon: 'monitor' }
            ]
        },
        {
            id: 'database',
            label: 'ฐานข้อมูล',
            icon: 'database',
            items: [
                { id: 'sku_master', label: 'SKU Master', icon: 'database' }
            ]
        },
        {
            id: 'settings',
            label: 'ตั้งค่า',
            icon: 'settings',
            items: [
                { id: 'settings', label: 'ตั้งค่า', icon: 'settings' },
                { id: 'cycle_config', label: 'ตั้งค่ารอบ', icon: 'calendar-range' },
                { id: 'chat', label: 'หน้าต่างสนทนา', icon: 'messages-square' },
                { id: 'user_manual', label: 'คู่มือ', icon: 'book-open' }
            ]
        }
    ];

    const PAGE_FILES = {
        index: 'index.html',
        import_counts: 'import_counts.html',
        audit_check: 'audit_check.html',
        count_search: 'count_search.html',
        reconcile: 'reconcile.html',
        book_explorer: 'book_explorer.html',
        dashboard: 'dashboard.html',
        live_count_wall: 'live_count_wall.html',
        sku_master: 'sku_master.html',
        settings: 'settings.html',
        cycle_config: 'cycle_config.html',
        chat: 'chat.html',
        user_manual: 'user_manual.html'
    };

    function inHtmlFolder() {
        const p = window.location.pathname.replace(/\\/g, '/');
        return /\/Html\//i.test(p);
    }

    function pageHref(pageId) {
        const file = PAGE_FILES[pageId] || (pageId + '.html');
        if (pageId === 'index') {
            return inHtmlFolder() ? '../index.html' : 'index.html';
        }
        return inHtmlFolder() ? file : ('Html/' + file);
    }

    function findGroupForPage(pageId) {
        for (const g of GROUPS) {
            if (g.items.some(function (it) { return it.id === pageId; })) return g.id;
        }
        return null;
    }

    function getSidebarEl() {
        return document.getElementById('appSidebar') || document.querySelector('aside.sidebar');
    }

    function getActivePage() {
        const aside = getSidebarEl();
        if (aside && aside.dataset.activePage) return aside.dataset.activePage;
        const name = window.location.pathname.split('/').pop() || 'index.html';
        const base = name.replace(/\.html$/i, '') || 'index';
        return base === 'index' ? 'index' : base;
    }

    function getActivePagePublic() {
        return getActivePage();
    }

    function loadOpenState() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function saveOpenState(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function usesFlatMenu(aside, activePage) {
        if (aside?.dataset?.sidebarMode === 'flat') return true;
        return FLAT_PAGES.has(activePage);
    }

    function isGroupOpen(group, activeGroup, openState, defaultOpenAll) {
        if (openState[group.id] === true) return true;
        if (openState[group.id] === false) return false;
        if (defaultOpenAll) return true;
        return group.id === activeGroup;
    }

    function renderGroupedSidebar(aside, activePage, opts) {
        opts = opts || {};
        const defaultOpenAll = !!opts.defaultOpenAll;
        const activeGroup = findGroupForPage(activePage);
        const openState = loadOpenState();

        let html = '<div class="sidebar-brand">เมนู</div><nav class="sidebar-nav" aria-label="เมนูหลัก">';

        GROUPS.forEach(function (group) {
            if (group.items.length === 1) {
                const item = group.items[0];
                const href = pageHref(item.id);
                const isActive = item.id === activePage;
                html += '<a href="' + href + '" class="sidebar-nav-item' + (isActive ? ' active' : '') + '" data-nav-page="' + item.id + '">';
                html += '<i data-lucide="' + item.icon + '"></i><span>' + item.label + '</span>';
                if (item.id === 'chat') html += '<span class="sidebar-chat-badge" hidden>0</span>';
                html += '</a>';
                return;
            }

            const isOpen = isGroupOpen(group, activeGroup, openState, defaultOpenAll);
            html += '<div class="sidebar-group' + (isOpen ? ' open' : '') + '" data-group="' + group.id + '">';
            html += '<button type="button" class="sidebar-group-head" aria-expanded="' + (isOpen ? 'true' : 'false') + '">';
            html += '<span class="sidebar-group-left"><i data-lucide="' + group.icon + '"></i><span>' + group.label + '</span></span>';
            html += '<i data-lucide="chevron-down" class="sidebar-group-chevron"></i></button>';
            html += '<div class="sidebar-group-items">';

            group.items.forEach(function (item) {
                const href = pageHref(item.id);
                const isActive = item.id === activePage;
                html += '<a href="' + href + '" class="sidebar-nav-item sidebar-nav-sub' + (isActive ? ' active' : '') + '" data-nav-page="' + item.id + '">';
                html += '<i data-lucide="' + item.icon + '"></i><span>' + item.label + '</span>';
                if (item.id === 'chat') html += '<span class="sidebar-chat-badge" hidden>0</span>';
                html += '</a>';
            });

            html += '</div></div>';
        });

        html += '</nav>';
        aside.innerHTML = html;

        aside.querySelectorAll('.sidebar-group-head').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const groupEl = btn.closest('.sidebar-group');
                const gid = groupEl && groupEl.dataset.group;
                if (!gid) return;
                const nowOpen = !groupEl.classList.contains('open');
                groupEl.classList.toggle('open', nowOpen);
                btn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
                const state = loadOpenState();
                state[gid] = nowOpen;
                saveOpenState(state);
            });
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();

        if (window.chatNotifyShared) {
            window.chatNotifyShared.updateBadge();
        }
    }

    function loadChatNotifyModule() {
        const base = inHtmlFolder() ? '../' : '';

        if (!document.querySelector('link[data-chat-notify-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = base + 'Css/chat-notify.css';
            link.dataset.chatNotifyCss = '1';
            document.head.appendChild(link);
        }

        function scriptReady(src, el) {
            if (el && el.dataset.loaded === '1') return true;
            if (/api\.js/i.test(src) && window.apiService) return true;
            if (/chat-notify-shared\.js/i.test(src) && window.chatNotifyShared) return true;
            if (/supabase-js/i.test(src) && (window.supabase || window.supabaseJs)) return true;
            return false;
        }

        function loadScript(src, cb) {
            const existing = document.querySelector('script[src="' + src + '"]');
            if (existing) {
                if (scriptReady(src, existing)) {
                    existing.dataset.loaded = '1';
                    cb();
                    return;
                }
                existing.addEventListener('load', function () {
                    existing.dataset.loaded = '1';
                    cb();
                }, { once: true });
                setTimeout(function () {
                    if (scriptReady(src, existing)) {
                        existing.dataset.loaded = '1';
                        cb();
                    }
                }, 0);
                return;
            }
            const s = document.createElement('script');
            s.src = src;
            s.onload = function () { s.dataset.loaded = '1'; cb(); };
            s.onerror = function () { console.warn('[chat-notify] โหลดสคริปต์ไม่สำเร็จ:', src); };
            document.body.appendChild(s);
        }

        function bootNotify() {
            loadScript(base + 'Js/chat-notify-shared.js', function () {
                window.chatNotifyShared?.init?.();
            });
        }

        function bootApiThenNotify() {
            loadScript(base + 'Js/api.js', bootNotify);
        }

        if (window.apiService) {
            bootNotify();
            return;
        }

        if (window.supabase || window.supabaseJs) {
            bootApiThenNotify();
            return;
        }

        loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', bootApiThenNotify);
    }

    function renderSidebar() {
        const aside = getSidebarEl();
        if (!aside) return;
        if (!aside.id) aside.id = 'appSidebar';

        const activePage = getActivePage();
        const defaultOpenAll = usesFlatMenu(aside, activePage);
        renderGroupedSidebar(aside, activePage, { defaultOpenAll: defaultOpenAll });
    }

    window.sidebarShared = {
        init: renderSidebar,
        GROUPS: GROUPS,
        FLAT_PAGES: FLAT_PAGES,
        pageHref: pageHref,
        getActivePage: getActivePagePublic
    };

    function bootSidebar() {
        renderSidebar();
        loadChatNotifyModule();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootSidebar);
    } else {
        bootSidebar();
    }
})();
