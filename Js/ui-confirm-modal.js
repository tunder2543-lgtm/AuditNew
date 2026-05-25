/**
 * Shared confirm modal — replaces window.confirm() across AuditNew
 */
(function () {
    const MODAL_ID = 'uiConfirmModal';
    let resolvePending = null;

    const VARIANTS = {
        primary: { titleClass: 'title-primary', icon: 'help-circle', box: 'primary', btn: 'primary' },
        amber: { titleClass: 'title-amber', icon: 'alert-triangle', box: 'amber', btn: 'amber' },
        danger: { titleClass: 'title-danger', icon: 'trash-2', box: 'danger', btn: 'danger' },
        green: { titleClass: 'title-green', icon: 'check-circle', box: 'green', btn: 'green' }
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureModal() {
        if (document.getElementById(MODAL_ID)) return;

        const wrap = document.createElement('div');
        wrap.innerHTML = `
<div class="cs-modal" id="${MODAL_ID}" role="dialog" aria-labelledby="uiConfirmTitle" aria-modal="true">
    <div class="cs-modal-content" style="max-width: 520px;">
        <div class="cs-modal-header">
            <h2 id="uiConfirmTitle" class="title-primary">
                <i data-lucide="help-circle" id="uiConfirmTitleIcon"></i>
                <span id="uiConfirmTitleText">ยืนยัน</span>
                <span class="ui-confirm-step-badge" id="uiConfirmStepBadge" style="display:none;"></span>
            </h2>
            <button type="button" class="icon-btn" id="uiConfirmBtnClose" aria-label="ปิด">
                <i data-lucide="x"></i>
            </button>
        </div>
        <p class="ui-confirm-intro" id="uiConfirmIntro"></p>
        <div class="ui-confirm-box primary" id="uiConfirmBox">
            <ul class="ui-confirm-bullets" id="uiConfirmBullets"></ul>
        </div>
        <p class="ui-confirm-note warn" id="uiConfirmNote" style="display:none;"></p>
        <div class="ui-confirm-actions">
            <button type="button" class="cs-btn-test" id="uiConfirmBtnCancel">ยกเลิก</button>
            <button type="button" class="ui-confirm-btn-ok primary" id="uiConfirmBtnOk">
                <i data-lucide="check" id="uiConfirmOkIcon"></i>
                <span id="uiConfirmOkLabel">ยืนยัน</span>
            </button>
        </div>
    </div>
</div>`;
        document.body.appendChild(wrap.firstElementChild);

        const modal = document.getElementById(MODAL_ID);
        document.getElementById('uiConfirmBtnCancel').addEventListener('click', () => close(false));
        document.getElementById('uiConfirmBtnClose').addEventListener('click', () => close(false));
        document.getElementById('uiConfirmBtnOk').addEventListener('click', () => close(true));
        modal.addEventListener('click', (e) => {
            if (e.target.id === MODAL_ID) close(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('open')) close(false);
        });
    }

    function close(confirmed) {
        const modal = document.getElementById(MODAL_ID);
        if (modal) modal.classList.remove('open');
        if (resolvePending) {
            resolvePending(confirmed);
            resolvePending = null;
        }
    }

    /**
     * @param {Object} opts
     * @param {string} [opts.title]
     * @param {string} [opts.intro]
     * @param {string[]} [opts.bullets]
     * @param {string} [opts.note]
     * @param {'primary'|'amber'|'danger'|'green'} [opts.variant]
     * @param {number} [opts.step]
     * @param {number} [opts.stepTotal]
     * @param {string} [opts.confirmLabel]
     * @param {string} [opts.cancelLabel]
     * @param {string} [opts.noteVariant] — warn | safe | danger
     * @param {boolean} [opts.hideBulletsBox]
     * @returns {Promise<boolean>}
     */
    function show(opts = {}) {
        ensureModal();
        const v = VARIANTS[opts.variant] || VARIANTS.primary;
        const modal = document.getElementById(MODAL_ID);
        const titleEl = document.getElementById('uiConfirmTitle');
        const titleText = document.getElementById('uiConfirmTitleText');
        const titleIcon = document.getElementById('uiConfirmTitleIcon');
        const stepBadge = document.getElementById('uiConfirmStepBadge');
        const introEl = document.getElementById('uiConfirmIntro');
        const boxEl = document.getElementById('uiConfirmBox');
        const bulletsEl = document.getElementById('uiConfirmBullets');
        const noteEl = document.getElementById('uiConfirmNote');
        const okBtn = document.getElementById('uiConfirmBtnOk');
        const okLabel = document.getElementById('uiConfirmOkLabel');
        const okIcon = document.getElementById('uiConfirmOkIcon');
        const cancelBtn = document.getElementById('uiConfirmBtnCancel');

        titleEl.className = v.titleClass;
        titleText.textContent = opts.title || 'ยืนยัน';
        titleIcon.setAttribute('data-lucide', opts.icon || v.icon);

        if (opts.step && opts.stepTotal) {
            stepBadge.style.display = '';
            stepBadge.textContent = `${opts.step}/${opts.stepTotal}`;
            stepBadge.className = 'ui-confirm-step-badge' + (opts.variant === 'amber' ? ' amber' : '');
        } else {
            stepBadge.style.display = 'none';
        }

        introEl.textContent = opts.intro || '';
        introEl.style.display = opts.intro ? '' : 'none';

        const bullets = opts.bullets || [];
        if (bullets.length && !opts.hideBulletsBox) {
            boxEl.style.display = '';
            boxEl.className = `ui-confirm-box ${v.box}`;
            bulletsEl.innerHTML = bullets.map((b) =>
                `<li>${escapeHtml(b)}</li>`
            ).join('');
        } else {
            boxEl.style.display = 'none';
            bulletsEl.innerHTML = '';
        }

        if (opts.note) {
            noteEl.style.display = '';
            noteEl.textContent = opts.note;
            noteEl.className = 'ui-confirm-note ' + (opts.noteVariant || 'warn');
        } else {
            noteEl.style.display = 'none';
        }

        okBtn.className = `ui-confirm-btn-ok ${v.btn}`;
        okLabel.textContent = opts.confirmLabel || 'ยืนยัน';
        okIcon.setAttribute('data-lucide', opts.confirmIcon || 'check');
        if (cancelBtn) cancelBtn.textContent = opts.cancelLabel || 'ยกเลิก';

        return new Promise((resolve) => {
            resolvePending = resolve;
            modal.classList.add('open');
            if (typeof lucide !== 'undefined') lucide.createIcons();
            setTimeout(() => document.getElementById('uiConfirmBtnOk')?.focus(), 80);
        });
    }

    /**
     * @param {Object} opts
     * @param {string} [opts.title]
     * @param {Object} opts.step1
     * @param {Object} opts.step2
     * @param {'primary'|'amber'|'danger'|'green'} [opts.variant]
     * @returns {Promise<boolean>}
     */
    async function twoStep(opts = {}) {
        const variant = opts.variant || 'primary';
        const s1 = await show({
            title: opts.title,
            variant,
            step: 1,
            stepTotal: 2,
            confirmLabel: opts.step1?.confirmLabel || 'ดำเนินการต่อ',
            confirmIcon: 'arrow-right',
            ...opts.step1
        });
        if (!s1) return false;
        return show({
            title: opts.title || opts.step2?.title,
            variant,
            step: 2,
            stepTotal: 2,
            confirmLabel: opts.step2?.confirmLabel || 'ยืนยัน',
            confirmIcon: opts.step2?.confirmIcon || 'check',
            hideBulletsBox: opts.step2?.hideBulletsBox !== false ? !!opts.step2?.hideBulletsBox : true,
            ...opts.step2
        });
    }

    /** Parse multiline confirm message into intro + bullets */
    function parseMessage(msg) {
        const lines = String(msg || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const bullets = [];
        let intro = '';
        for (const line of lines) {
            const cleaned = line.replace(/^[·•]\s*/, '');
            if (/^ยืนยัน/.test(cleaned) && !intro) {
                intro = cleaned;
            } else if (/^[·•]/.test(line) || cleaned.startsWith('•')) {
                bullets.push(cleaned.replace(/^•\s*/, ''));
            } else if (!intro) {
                intro = cleaned;
            } else {
                bullets.push(cleaned);
            }
        }
        return { intro, bullets };
    }

    window.uiConfirm = { show, twoStep, parseMessage };
})();
