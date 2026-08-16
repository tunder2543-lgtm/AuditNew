// ล็อกส่วน "Supabase Config" ในหน้าตั้งค่า — ใช้เฉพาะ Html/settings.html
//
// รหัสไม่อยู่ในโค้ด/รีโปแม้แต่ในรูป hash (รีโปเป็น public) — เก็บเป็น bcrypt hash
// ใน Supabase ตาราง app_settings_pin (RLS ไม่มี policy = อ่านตรง ๆ ไม่ได้)
// หน้าเว็บตรวจได้ทางเดียวผ่าน RPC verify_settings_pin (docs/sql/021) ซึ่งตอบแค่ จริง/เท็จ
//
// ปลดล็อกจำเฉพาะแท็บ (sessionStorage) — ปิดแท็บแล้วกลับมาล็อกใหม่
// ข้อจำกัดที่รู้กัน: กันได้ระดับพนักงานทั่วไป ไม่ใช่คนรู้เทคนิคที่ตั้งใจอ้อม
//
// กติกา: ห้าม innerHTML ทั้งไฟล์ (invariant ข้อ 7) — มีเทสยามบังคับ
(function () {
    'use strict';

    var UNLOCK_KEY = 'settings_config_unlocked_v1';

    /** สลับกล่องล็อก/ฟอร์มตามสถานะ — จุดเดียวที่แตะ display ของทั้งคู่ */
    function applyLockState(unlocked) {
        var lock = document.getElementById('sbConfigLock');
        var form = document.getElementById('sbConfigForm');
        if (!lock || !form) return;
        lock.style.display = unlocked ? 'none' : '';
        form.style.display = unlocked ? '' : 'none';
    }

    /** เรียกจากปุ่ม "ปลดล็อก" (onclick แบบไม่มี argument — ตามกติกา ห้ามต่อค่าใน onclick) */
    async function runUnlockSettings() {
        var input = document.getElementById('sbPinInput');
        var msg = document.getElementById('sbPinMsg');
        var btn = document.getElementById('sbPinBtn');
        var pin = input ? String(input.value || '').trim() : '';
        if (!msg || !input) return;
        if (!pin) {
            msg.textContent = 'กรุณาใส่รหัสก่อน';
            return;
        }
        if (btn) btn.disabled = true;
        msg.textContent = 'กำลังตรวจรหัส…';
        try {
            var client = window.apiService.getClient();
            var res = await client.rpc('verify_settings_pin', { p_pin: pin });
            if (res.error) throw res.error;
            if (res.data === true) {
                // sessionStorage อาจโดนบล็อก (โหมดส่วนตัวบางแบบ) — พังแค่ "จำสถานะ" ห้ามพังการปลดล็อก
                try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch (e) { /* จำไม่ได้ก็ปลดล็อกรอบนี้ได้ */ }
                msg.textContent = '';
                input.value = '';
                applyLockState(true);
            } else {
                msg.textContent = 'รหัสไม่ถูกต้อง';
                input.value = '';
            }
        } catch (e) {
            msg.textContent = 'ตรวจรหัสไม่ได้ — เชื่อมต่อ Supabase ไม่สำเร็จ (ลองใหม่อีกครั้ง)';
        } finally {
            if (btn) btn.disabled = false;
        }
    }
    window.runUnlockSettings = runUnlockSettings;

    function initSettingsPinGate() {
        var unlocked = false;
        try { unlocked = sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { /* อ่านไม่ได้ = ถือว่าล็อก */ }
        applyLockState(unlocked);
        var input = document.getElementById('sbPinInput');
        if (input) {
            input.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    runUnlockSettings();
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettingsPinGate);
    } else {
        initSettingsPinGate();
    }
})();
