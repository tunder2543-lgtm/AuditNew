// =============================================================================
//  Sidebar — กลุ่มเมนูเปิด/ปิดได้ (ใช้ร่วมทุกหน้า)
// =============================================================================

(function () {
    const STORAGE_KEY = 'sidebar_groups_open_v1';

    /** หน้าเหล่านี้ใช้เมนูแบน (ไม่มีกลุ่มย่อย) */
    const FLAT_PAGES = new Set(['index', 'import_counts', 'sku_master', 'settings']);

    const FLAT_MENU = [
        { id: 'index', label: 'นับสต็อก', icon: 'clipboard-list', title: 'หน้านับสต็อก' },
        { id: 'import_counts', label: 'Import นับ', icon: 'file-input', title: 'นำเข้าผลการนับจาก Excel' },
        { id: 'audit_check', label: 'ตรวจสอบ', icon: 'shield-check', title: 'ตรวจสอบความถูกต้อง' },
        { id: 'sku_master', label: 'SKU Master', icon: 'database', title: 'จัดการ SKU' },
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', title: 'ภาพรวมและรายงาน' },
        { id: 'settings', label: 'ตั้งค่า', icon: 'settings', title: 'ตั้งค่าและเชื่อมต่อ' }
    ];

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
        dashboard: 'dashboard.html',
        live_count_wall: 'live_count_wall.html',
        sku_master: 'sku_master.html',
        settings: 'settings.html',
        cycle_config: 'cycle_config.html',
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

    function renderFlatSidebar(aside, activePage) {
        let html = '<div class="sidebar-brand">เมนู</div><nav class="sidebar-nav" aria-label="เมนูหลัก">';
        FLAT_MENU.forEach(function (item) {
            const href = pageHref(item.id);
            const isActive = item.id === activePage;
            html += '<a href="' + href + '" class="sidebar-nav-item' + (isActive ? ' active' : '') + '"';
            if (item.title) html += ' title="' + item.title.replace(/"/g, '&quot;') + '"';
            html += '><i data-lucide="' + item.icon + '"></i><span>' + item.label + '</span></a>';
        });
        html += '</nav>';
        aside.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function renderGroupedSidebar(aside, activePage) {
        const activeGroup = findGroupForPage(activePage);
        const openState = loadOpenState();

        let html = '<div class="sidebar-brand">เมนู</div><nav class="sidebar-nav" aria-label="เมนูหลัก">';

        GROUPS.forEach(function (group) {
            const isOpen = openState[group.id] !== false && (openState[group.id] === true || group.id === activeGroup);
            html += '<div class="sidebar-group' + (isOpen ? ' open' : '') + '" data-group="' + group.id + '">';
            html += '<button type="button" class="sidebar-group-head" aria-expanded="' + (isOpen ? 'true' : 'false') + '">';
            html += '<span class="sidebar-group-left"><i data-lucide="' + group.icon + '"></i><span>' + group.label + '</span></span>';
            html += '<i data-lucide="chevron-down" class="sidebar-group-chevron"></i></button>';
            html += '<div class="sidebar-group-items">';

            group.items.forEach(function (item) {
                const href = pageHref(item.id);
                const isActive = item.id === activePage;
                html += '<a href="' + href + '" class="sidebar-nav-item sidebar-nav-sub' + (isActive ? ' active' : '') + '">';
                html += '<i data-lucide="' + item.icon + '"></i><span>' + item.label + '</span></a>';
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
    }

    function renderSidebar() {
        const aside = getSidebarEl();
        if (!aside) return;
        if (!aside.id) aside.id = 'appSidebar';

        const activePage = getActivePage();
        if (usesFlatMenu(aside, activePage)) {
            renderFlatSidebar(aside, activePage);
            return;
        }
        renderGroupedSidebar(aside, activePage);
    }

    window.sidebarShared = {
        init: renderSidebar,
        GROUPS: GROUPS,
        FLAT_MENU: FLAT_MENU,
        FLAT_PAGES: FLAT_PAGES,
        pageHref: pageHref
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderSidebar);
    } else {
        renderSidebar();
    }
})();
