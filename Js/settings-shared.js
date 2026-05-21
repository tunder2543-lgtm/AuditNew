// ==========================================
//  Shared: Connection Badge + Supabase Settings
// ==========================================

(function () {
    function getBadgeElements() {
        const badges = [];
        const main = document.getElementById('connectionBadge');
        if (main) badges.push(main);
        document.querySelectorAll('[data-connection-badge]').forEach(el => {
            if (!badges.includes(el)) badges.push(el);
        });
        return badges;
    }

    window.updateConnectionBadge = function (connected) {
        getBadgeElements().forEach(badge => {
            const icon = badge.querySelector('[data-badge-icon]') || badge.querySelector('#badgeIcon') || badge.querySelector('i');
            const text = badge.querySelector('[data-badge-text]') || badge.querySelector('#badgeText') || badge.querySelector('span:last-child');

            if (connected) {
                badge.className = 'connection-badge badge-connected';
                badge.title = 'เชื่อมต่อ Supabase แล้ว';
                if (icon) icon.setAttribute('data-lucide', 'wifi');
                if (text) text.textContent = 'เชื่อมต่อแล้ว';
            } else {
                badge.className = 'connection-badge badge-disconnected';
                badge.title = 'ยังไม่ได้เชื่อมต่อ — ไปที่หน้าตั้งค่าเพื่อกรอก URL/KEY';
                if (icon) icon.setAttribute('data-lucide', 'wifi-off');
                if (text) text.textContent = 'ไม่ได้เชื่อมต่อ';
            }
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.checkSupabaseConnection = async function () {
        const client = window.apiService?.getClient?.();
        if (!client) {
            window.updateConnectionBadge(false);
            return false;
        }
        try {
            const { error } = await client.from('inventory_counts').select('id').limit(1);
            const ok = !error;
            window.updateConnectionBadge(ok);
            return ok;
        } catch (err) {
            console.warn('[Connection] check failed:', err);
            window.updateConnectionBadge(false);
            return false;
        }
    };

    window.testSupabaseConnection = async function (url, key) {
        if (!url || !key) {
            return { ok: false, message: '❌ กรุณากรอก URL และ API Key ก่อน' };
        }
        try {
            const res = await fetch(`${url}/rest/v1/inventory_counts?select=id&limit=1`, {
                headers: { apikey: key, Authorization: `Bearer ${key}` }
            });
            if (res.ok) {
                return { ok: true, message: '✅ เชื่อมต่อสำเร็จ! Table inventory_counts พร้อมใช้งาน' };
            }
            throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            return { ok: false, message: `❌ ไม่สามารถเชื่อมต่อได้: ${err.message}` };
        }
    };

    window.saveSupabaseSettings = function (url, key) {
        const u = (url || '').trim();
        const k = (key || '').trim();
        if (!u || !k) return false;
        localStorage.setItem('SB_URL', u);
        localStorage.setItem('SB_KEY', k);
        return true;
    };

    window.goToSettingsPage = function () {
        const path = window.location.pathname.replace(/\\/g, '/');
        if (path.includes('/Html/')) {
            window.location.href = 'settings.html';
        } else {
            window.location.href = 'Html/settings.html';
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('connectionBadge') || document.querySelector('[data-connection-badge]')) {
            window.checkSupabaseConnection();
        }
    });
})();
