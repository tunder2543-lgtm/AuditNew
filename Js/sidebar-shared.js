// =============================================================================
//  Sidebar — กลุ่มเมนูเปิด/ปิดได้ (ใช้ร่วมทุกหน้า)
// =============================================================================

(function () {
    const STORAGE_KEY = 'sidebar_groups_open_v1';

    /**
     * เวอร์ชันไฟล์สำหรับ cache-buster ของ asset ที่ inject แบบ dynamic
     * ⚠️ ต้อง bump ให้ตรงกับ ?v= ใน <script> ของทุกหน้า HTML ทุกครั้งที่แก้ shared JS/CSS
     */
    const ASSET_VER = '20260813c';

    /** จอที่แคบกว่านี้ เมนูซ้ายทำงานเป็นลิ้นชักสไลด์ — ต้องตรงกับ @media ใน Css/style.css */
    const MOBILE_QUERY = '(max-width: 900px)';

    // -------------------------------------------------------------------------
    //  ธีม Light/Dark — ค่าจริงถูก set ตั้งแต่ boot script ใน <head> ของทุกหน้า
    //  (กัน flash ธีมผิดก่อน CSS โหลด) ที่นี่มีแค่ปุ่มสลับ + ประกาศ event
    //  หน้าที่ inline style ยังไม่แปลงเป็น token จะไม่มี data-theme-ready บน <html>
    //  → boot script บังคับ dark และปุ่มนี้จะ disabled
    // -------------------------------------------------------------------------
    const THEME_KEY = 'theme_v1';

    function currentTheme() {
        return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ }
        updateThemeToggleUi();
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
    }

    function updateThemeToggleUi() {
        const btn = document.getElementById('sidebarThemeToggle');
        if (!btn) return;
        const light = currentTheme() === 'light';
        const label = btn.querySelector('.sidebar-theme-label');
        if (label) label.textContent = light ? 'โหมดมืด' : 'โหมดสว่าง';
        btn.setAttribute('aria-pressed', light ? 'true' : 'false');
    }

    /** หน้าเหล่านี้: เปิดทุกกลุ่มเป็นค่าเริ่มต้น (ยังพับได้) — ไม่ซ่อนรายการย่อยแบบพับปิดตลอด */
    const FLAT_PAGES = new Set(['index', 'import_counts', 'settings']);

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
                { id: 'adjust_history', label: 'ประวัติการปรับ', icon: 'history' },
                { id: 'book_explorer', label: 'Book Explorer', icon: 'book-copy' },
                { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
                { id: 'live_count_wall', label: 'จอนับสด', icon: 'monitor' }
            ]
        },
        {
            id: 'settings',
            label: 'ตั้งค่า',
            icon: 'settings',
            items: [
                { id: 'settings', label: 'ตั้งค่า', icon: 'settings' },
                { id: 'cycle_config', label: 'ตั้งค่ารอบ', icon: 'calendar-range' },
                { id: 'chat', label: 'หน้าต่างสนทนา', icon: 'messages-square' }
            ]
        }
    ];

    const PAGE_FILES = {
        index: 'index.html',
        import_counts: 'import_counts.html',
        audit_check: 'audit_check.html',
        count_search: 'count_search.html',
        reconcile: 'reconcile.html',
        adjust_history: 'adjust_history.html',
        book_explorer: 'book_explorer.html',
        dashboard: 'dashboard.html',
        live_count_wall: 'live_count_wall.html',
        settings: 'settings.html',
        cycle_config: 'cycle_config.html',
        chat: 'chat.html'
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

        // ปุ่มสลับธีมท้ายเมนู — ข้อความ/สถานะ set ทีหลังผ่าน updateThemeToggleUi()
        const themeReady = document.documentElement.hasAttribute('data-theme-ready');
        html += '<button type="button" class="sidebar-theme-toggle" id="sidebarThemeToggle"'
            + (themeReady ? '' : ' disabled title="หน้านี้ยังไม่รองรับโหมดสว่าง"') + '>'
            + '<i data-lucide="sun" class="icon-sun"></i>'
            + '<i data-lucide="moon" class="icon-moon"></i>'
            + '<span class="sidebar-theme-label"></span></button>';

        aside.innerHTML = html;

        const themeBtn = aside.querySelector('.sidebar-theme-toggle');
        if (themeBtn && !themeBtn.disabled) {
            themeBtn.addEventListener('click', function () {
                applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
            });
        }
        updateThemeToggleUi();

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

        // เลือกเมนูแล้วปิดลิ้นชักทันที (ไม่ต้องรอหน้าใหม่โหลด — จอเล็กจะได้ไม่ค้างมืด)
        aside.querySelectorAll('.sidebar-nav-item').forEach(function (link) {
            link.addEventListener('click', function () { setDrawer(false); });
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();

        if (window.chatNotifyShared) {
            window.chatNotifyShared.updateBadge();
        }
    }

    // -------------------------------------------------------------------------
    //  ลิ้นชักเมนูสำหรับจอเล็ก — แถบบน + ปุ่ม ☰ + ฉากมืด
    //  ไม่จำสถานะข้ามหน้า: เปิดหน้าใหม่ลิ้นชักต้องปิดเสมอ
    // -------------------------------------------------------------------------
    function pageLabel(pageId) {
        for (const g of GROUPS) {
            const found = g.items.find(function (it) { return it.id === pageId; });
            if (found) return found.label;
        }
        return 'เมนู';
    }

    function isDrawerOpen() {
        return document.body.classList.contains('sidebar-open');
    }

    function setDrawer(open) {
        const btn = document.getElementById('sidebarToggle');
        if (!open && !isDrawerOpen()) return;

        document.body.classList.toggle('sidebar-open', open);

        if (btn) {
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
        }

        if (open) {
            const aside = getSidebarEl();
            const first = aside && aside.querySelector('.sidebar-group-head, .sidebar-nav-item');
            if (first) first.focus();
        } else if (btn && btn.offsetParent !== null) {
            // คืนโฟกัสให้ปุ่ม ☰ เฉพาะตอนที่ปุ่มยังโชว์อยู่จริง —
            // ถ้าปิดเพราะขยายจอพ้น 900px ปุ่มถูก display:none แล้ว การ focus จะทำให้โฟกัสหลุดไปที่ body
            btn.focus();
        }
    }

    function renderMobileChrome(activePage) {
        let bar = document.querySelector('.sidebar-mobile-bar');

        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'sidebar-mobile-bar';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sidebar-toggle';
            btn.id = 'sidebarToggle';
            btn.setAttribute('aria-label', 'เปิดเมนู');
            btn.setAttribute('aria-controls', 'appSidebar');
            btn.setAttribute('aria-expanded', 'false');
            const icon = document.createElement('i');
            icon.dataset.lucide = 'menu';
            btn.appendChild(icon);

            const title = document.createElement('span');
            title.className = 'sidebar-mobile-title';

            bar.appendChild(btn);
            bar.appendChild(title);

            const scrim = document.createElement('div');
            scrim.className = 'sidebar-scrim';
            scrim.id = 'sidebarScrim';

            document.body.insertBefore(scrim, document.body.firstChild);
            document.body.insertBefore(bar, document.body.firstChild);

            btn.addEventListener('click', function () { setDrawer(!isDrawerOpen()); });
            scrim.addEventListener('click', function () { setDrawer(false); });

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && isDrawerOpen()) setDrawer(false);
            });

            // ขยายหน้าต่าง/หมุนจอจนพ้นจอเล็ก → บังคับปิด กันฉากมืดกับ overflow:hidden ค้าง
            if (window.matchMedia) {
                const mq = window.matchMedia(MOBILE_QUERY);
                const onChange = function (e) { if (!e.matches) setDrawer(false); };
                if (mq.addEventListener) mq.addEventListener('change', onChange);
                else if (mq.addListener) mq.addListener(onChange);
            }
        }

        // ใช้ textContent (ไม่ใช่ innerHTML) ตามกฎ escape ของโปรเจกต์
        const titleEl = bar.querySelector('.sidebar-mobile-title');
        if (titleEl) titleEl.textContent = pageLabel(activePage);
    }

    function loadChatNotifyModule() {
        const base = inHtmlFolder() ? '../' : '';

        if (!document.querySelector('link[data-chat-notify-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = base + 'Css/chat-notify.css?v=' + ASSET_VER;
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

        function loadScript(srcRaw, cb) {
            // เติม cache-buster ให้ไฟล์ในโปรเจกต์ (CDN ไม่ต้อง) — ไม่งั้นเบราว์เซอร์ใช้ไฟล์เก่าค้าง
            const src = /^https?:/i.test(srcRaw) ? srcRaw : srcRaw + '?v=' + ASSET_VER;
            // prefix match — script tag ของหน้าเว็บมี cache-buster ต่อท้าย (?v=...) จึงเทียบเต็มไม่ได้
            const bare = srcRaw;
            const existing = document.querySelector('script[src="' + bare + '"], script[src^="' + bare + '?"]');
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
        renderMobileChrome(activePage);   // ก่อน render เมนู เพื่อให้ lucide.createIcons() ท้ายฟังก์ชันวาดไอคอน ☰ ให้ด้วย
        renderGroupedSidebar(aside, activePage, { defaultOpenAll: defaultOpenAll });
    }

    window.sidebarShared = {
        init: renderSidebar,
        GROUPS: GROUPS,
        FLAT_PAGES: FLAT_PAGES,
        pageHref: pageHref,
        getActivePage: getActivePagePublic,
        getTheme: currentTheme        // ให้โค้ดกราฟ/หน้าอื่นอ่านธีมปัจจุบัน (คู่กับ event 'themechange')
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
