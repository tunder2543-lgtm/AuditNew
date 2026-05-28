/**
 * คู่มือการใช้งาน — โหมดอ่าน / แก้ไข + อัปโหลดรูปต่อช่อง (localStorage)
 */
(function () {
    const STORAGE_KEY = 'stock_audit_user_manual_v2';
    const MODE_KEY = 'stock_audit_manual_mode_v1';
    const SAVE_DEBOUNCE_MS = 800;

    let saveTimer = null;
    let state = { html: null, images: {}, updatedAt: null };

    function $(sel, root) {
        return (root || document).querySelector(sel);
    }
    function $$(sel, root) {
        return Array.from((root || document).querySelectorAll(sel));
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                state.images = parsed.images || {};
                state.html = parsed.html || null;
                state.updatedAt = parsed.updatedAt || null;
            }
        } catch (e) {
            console.warn('manual load failed', e);
        }
    }

    function persistState() {
        const root = document.getElementById('manualContentRoot');
        if (!root) return;
        const payload = {
            html: root.innerHTML,
            images: state.images,
            updatedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            state.updatedAt = payload.updatedAt;
            updateSaveHint(true);
        } catch (e) {
            console.warn('manual save failed', e);
            const msg = 'บันทึกคู่มือไม่สำเร็จ — พื้นที่เต็มหรือโหมด Private?';
            updateSaveHint(false, msg);
            if (typeof window.showToast === 'function') {
                window.showToast(msg, 'error');
            }
        }
    }

    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persistState, SAVE_DEBOUNCE_MS);
    }

    function updateSaveHint(ok, msg) {
        const el = document.getElementById('manualSaveHint');
        if (!el) return;
        if (msg) {
            el.textContent = msg;
            el.className = 'manual-save-hint warn';
            return;
        }
        el.textContent = ok
            ? 'บันทึกในเบราว์เซอร์แล้ว (' + (state.updatedAt ? new Date(state.updatedAt).toLocaleString('th-TH') : 'เมื่อสักครู่') + ')'
            : 'ยังไม่ได้บันทึก';
        el.className = 'manual-save-hint' + (ok ? ' ok' : '');
    }

    function getMode() {
        return localStorage.getItem(MODE_KEY) === 'edit' ? 'edit' : 'read';
    }

    function setMode(mode) {
        localStorage.setItem(MODE_KEY, mode === 'edit' ? 'edit' : 'read');
        applyMode(mode);
    }

    function applyMode(mode) {
        mode = mode || getMode();
        document.body.classList.remove('manual-edit-mode', 'manual-read-mode');
        document.body.classList.add(mode === 'edit' ? 'manual-edit-mode' : 'manual-read-mode');

        const btnRead = document.getElementById('btnModeRead');
        const btnEdit = document.getElementById('btnModeEdit');
        if (btnRead) btnRead.classList.toggle('active', mode !== 'edit');
        if (btnEdit) btnEdit.classList.toggle('active', mode === 'edit');

        const editables = $$('#manualContentRoot [data-editable]');
        editables.forEach(function (el) {
            el.contentEditable = mode === 'edit' ? 'true' : 'false';
            el.setAttribute('spellcheck', mode === 'edit' ? 'true' : 'false');
        });

        $$('.manual-figure-slot').forEach(function (slot) {
            syncSlotUi(slot, mode);
        });
    }

    function slotHasImage(img) {
        if (!img || !img.src) return false;
        if (img.classList.contains('slot-empty')) return false;
        if (img.style.display === 'none') return false;
        return img.src.length > 10;
    }

    function syncSlotUi(slot, mode) {
        const img = $('.figure-img', slot);
        const browseWrap = $('.slot-browse-wrap', slot);
        const changeBtn = $('.slot-change-img', slot);
        const hasImage = slotHasImage(img);

        if (browseWrap) {
            browseWrap.style.display = (mode === 'edit' && !hasImage) ? '' : 'none';
        }
        if (changeBtn) {
            changeBtn.style.display = (mode === 'edit' && hasImage) ? '' : 'none';
        }
    }

    function applyImageToSlot(slot, dataUrl) {
        const slotId = slot.getAttribute('data-slot');
        const img = $('.figure-img', slot);
        const placeholder = $('.slot-placeholder', slot);
        if (!img || !slotId) return;

        img.src = dataUrl;
        img.style.display = 'block';
        img.classList.remove('slot-empty');
        if (placeholder) placeholder.style.display = 'none';
        state.images[slotId] = dataUrl;
        syncSlotUi(slot, getMode());
        scheduleSave();
    }

    function bindFigureSlot(slot) {
        const slotId = slot.getAttribute('data-slot');
        const img = $('.figure-img', slot);
        const input = $('.slot-file-input', slot);
        const inputChange = $('.slot-file-input-change', slot);

        if (state.images[slotId]) {
            applyImageToSlot(slot, state.images[slotId]);
        } else if (img && img.getAttribute('data-default-src')) {
            const def = img.getAttribute('data-default-src');
            if (def) {
                img.src = def;
                img.style.display = 'block';
                img.classList.remove('slot-empty');
                const placeholder = $('.slot-placeholder', slot);
                if (placeholder) placeholder.style.display = 'none';
            }
        }

        function onFile(fileInput) {
            const file = fileInput.files && fileInput.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = function () {
                applyImageToSlot(slot, reader.result);
                fileInput.value = '';
            };
            reader.readAsDataURL(file);
        }

        if (input) input.addEventListener('change', function () { onFile(input); });
        if (inputChange) inputChange.addEventListener('change', function () { onFile(inputChange); });

        syncSlotUi(slot, getMode());
    }

    function initFigureSlots() {
        $$('.manual-figure-slot').forEach(bindFigureSlot);
    }

    function bindContentListeners() {
        const root = document.getElementById('manualContentRoot');
        if (!root) return;
        root.addEventListener('input', function (e) {
            if (getMode() !== 'edit') return;
            if (e.target.closest('[data-editable]')) scheduleSave();
        });
    }

    async function resetManual() {
        const ok = await (window.uiConfirm?.show({
            title: 'รีเซ็ตคู่มือ',
            variant: 'danger',
            intro: 'ล้างการแก้ไขและรูปที่บันทึกไว้',
            note: 'กลับเป็นคู่มือเริ่มต้น — ไม่สามารถยกเลิกได้',
            noteVariant: 'danger',
            hideBulletsBox: true,
            confirmLabel: 'รีเซ็ต'
        }) ?? Promise.resolve(false));
        if (!ok) return;
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }

    function exportManualBackup() {
        loadState();
        const root = document.getElementById('manualContentRoot');
        const blob = new Blob([JSON.stringify({
            html: root ? root.innerHTML : '',
            images: state.images,
            exportedAt: new Date().toISOString()
        }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'stock-audit-manual-backup.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function initToolbar() {
        const btnRead = document.getElementById('btnModeRead');
        const btnEdit = document.getElementById('btnModeEdit');
        const btnReset = document.getElementById('btnManualReset');
        const btnExport = document.getElementById('btnManualExport');

        if (btnRead) btnRead.addEventListener('click', function () {
            persistState();
            setMode('read');
        });
        if (btnEdit) btnEdit.addEventListener('click', function () { setMode('edit'); });
        if (btnReset) btnReset.addEventListener('click', resetManual);
        if (btnExport) btnExport.addEventListener('click', exportManualBackup);

        window.addEventListener('beforeunload', function () {
            if (getMode() === 'edit') persistState();
        });
    }

    function init() {
        loadState();
        const root = document.getElementById('manualContentRoot');
        if (root && state.html) {
            root.innerHTML = state.html;
        }
        initFigureSlots();
        bindContentListeners();
        initToolbar();
        applyMode(getMode());
        if (state.updatedAt) updateSaveHint(true);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
