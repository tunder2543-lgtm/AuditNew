// สถานะระบบ Supabase Keep-Alive — ใช้เฉพาะหน้า Html/settings.html
//
// แสดง 2 อย่าง: (1) นับถอยหลังถึงรอบ ping ถัดไป — คำนวณในเครื่องล้วน ๆ ทำงานเสมอ
// (2) ประวัติการรันจาก GitHub API — รีโปเป็น public จึงเรียกได้โดยไม่ต้องใส่ token
//     ถ้าดึงไม่ได้ (rate limit / เน็ต / รีโปกลายเป็น private) การ์ดต้องไม่พัง
//     ให้แสดงข้อความบอก + ลิงก์ไปดูบน GitHub แทน
//
// กติกา: ห้ามใช้ innerHTML กับค่า dynamic (invariant ข้อ 7) — ไฟล์นี้สร้าง DOM
// ด้วย createElement + textContent ทั้งหมด (มีเทสยามห้าม innerHTML ทั้งไฟล์)
(function () {
    'use strict';

    var KA_REPO = 'tunder2543-lgtm/AuditNew';
    var KA_WORKFLOW_FILE = 'supabase-keepalive.yml';
    var KA_ACTIONS_URL = 'https://github.com/' + KA_REPO + '/actions/workflows/' + KA_WORKFLOW_FILE;
    var KA_API_URL = 'https://api.github.com/repos/' + KA_REPO + '/actions/workflows/' + KA_WORKFLOW_FILE + '/runs?per_page=5';

    /**
     * ตารางเวลา ping — ⛔ ต้องตรงกับบรรทัด cron ใน .github/workflows/supabase-keepalive.yml
     * ('0 3 * * 1,4' = จันทร์+พฤหัส 03:00 UTC = 10:00 น. ไทย)
     * มีเทสยามอ่าน cron จากไฟล์ workflow จริงมาเทียบกับค่านี้ — แก้ฝั่งไหนต้องแก้อีกฝั่งตาม
     */
    function keepaliveSchedule() {
        return { utcDays: [1, 4], utcHour: 3, utcMinute: 0 };
    }

    /**
     * หาเวลารอบ ping ถัดไปที่ "มากกว่า now อย่างเคร่งครัด"
     * เดินทีละวัน (UTC) ไปข้างหน้าสูงสุด 8 วัน — ตารางมี ≥1 วัน/สัปดาห์ จึงเจอเสมอ
     * ไทยไม่มี DST การคำนวณบน UTC ตรง ๆ จึงปลอดภัย
     */
    function computeNextRun(now) {
        var sch = keepaliveSchedule();
        var nowMs = new Date(now).getTime();
        for (var addDay = 0; addDay <= 8; addDay++) {
            var d = new Date(nowMs + addDay * 86400000);
            var candMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sch.utcHour, sch.utcMinute, 0);
            if (sch.utcDays.indexOf(new Date(candMs).getUTCDay()) !== -1 && candMs > nowMs) {
                return new Date(candMs);
            }
        }
        return null;
    }

    /**
     * แปลงช่วงเวลาที่เหลือเป็นข้อความไทย "อีก X วัน Y ชม. Z นาที"
     * ปัดเศษวินาทีขึ้นเป็นนาที — จะไม่แสดง "อีก 0 นาที" ทั้งที่ยังไม่ถึงเวลา
     */
    function formatRemaining(now, target) {
        var ms = new Date(target).getTime() - new Date(now).getTime();
        if (!(ms > 0)) return { days: 0, hours: 0, minutes: 0, text: 'ถึงเวลาแล้ว — รอ GitHub เริ่มรัน' };
        var totalMin = Math.ceil(ms / 60000);
        var days = Math.floor(totalMin / 1440);
        var hours = Math.floor((totalMin % 1440) / 60);
        var minutes = totalMin % 60;
        var parts = [];
        if (days > 0) parts.push(days + ' วัน');
        if (days > 0 || hours > 0) parts.push(hours + ' ชม.');
        parts.push(minutes + ' นาที');
        return { days: days, hours: hours, minutes: minutes, text: 'อีก ' + parts.join(' ') };
    }

    /** เวลาไทย (UTC+7) เป็นข้อความ เช่น "พฤหัส 14 ส.ค. 10:00 น." — ไม่พึ่ง Intl */
    function formatBkkDateTime(dateLike) {
        var ms = new Date(dateLike).getTime();
        if (!isFinite(ms)) return '—';
        var t = new Date(ms + 7 * 3600000);
        var dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
        var monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        var hh = String(t.getUTCHours());
        if (hh.length < 2) hh = '0' + hh;
        var mm = String(t.getUTCMinutes());
        if (mm.length < 2) mm = '0' + mm;
        return dayNames[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + monthNames[t.getUTCMonth()] + ' ' + hh + ':' + mm + ' น.';
    }

    /**
     * แปลงผลจาก GitHub API (workflow runs) เป็นรายการพร้อมแสดงผล
     * ต้องไม่โยน error ไม่ว่ารูปร่างข้อมูลจะแปลกแค่ไหน — ข้อมูลมาจากภายนอก
     */
    function buildRunsViewModel(apiJson) {
        var runs = (apiJson && Array.isArray(apiJson.workflow_runs)) ? apiJson.workflow_runs : [];
        return runs.map(function (r) {
            r = r || {};
            var key, label;
            if (r.status !== 'completed') {
                key = 'running';
                label = 'กำลังทำงาน';
            } else if (r.conclusion === 'success') {
                key = 'success';
                label = 'สำเร็จ';
            } else {
                key = 'failure';
                label = 'ล้มเหลว (' + String(r.conclusion || 'ไม่ทราบผล') + ')';
            }
            var timeMs = Date.parse(r.run_started_at || r.created_at || '');
            return {
                key: key,
                label: label,
                timeMs: isFinite(timeMs) ? timeMs : null,
                trigger: r.event === 'workflow_dispatch' ? 'กดรันเอง' : 'ตามตาราง'
            };
        });
    }

    // ---------- ส่วน DOM (ไม่ยกไปเทส — เทสคุมเฉพาะ logic ด้านบน) ----------

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function renderCountdown() {
        var cd = document.getElementById('kaCountdown');
        var nt = document.getElementById('kaNextTime');
        if (!cd || !nt) return;
        var now = new Date();
        var next = computeNextRun(now);
        if (!next) {
            cd.textContent = '—';
            return;
        }
        cd.textContent = formatRemaining(now, next).text;
        nt.textContent = formatBkkDateTime(next);
    }

    function renderRuns(rows) {
        var list = document.getElementById('kaRunsList');
        var last = document.getElementById('kaLastStatus');
        var lastTime = document.getElementById('kaLastTime');
        if (!list) return;
        list.textContent = '';
        if (!rows.length) {
            list.appendChild(el('div', 'keepalive-muted', 'ยังไม่มีประวัติการรัน'));
            if (last) last.textContent = 'ยังไม่เคยรัน';
            return;
        }
        if (last) {
            last.textContent = rows[0].label;
            last.className = 'keepalive-status keepalive-' + rows[0].key;
        }
        if (lastTime) lastTime.textContent = rows[0].timeMs === null ? '—' : formatBkkDateTime(rows[0].timeMs);
        rows.forEach(function (row) {
            var line = el('div', 'keepalive-run-row');
            line.appendChild(el('span', 'keepalive-dot keepalive-' + row.key));
            line.appendChild(el('span', 'keepalive-status keepalive-' + row.key, row.label));
            line.appendChild(el('span', 'keepalive-muted', row.timeMs === null ? '—' : formatBkkDateTime(row.timeMs)));
            line.appendChild(el('span', 'keepalive-muted', row.trigger));
            list.appendChild(line);
        });
    }

    function renderRunsError() {
        var list = document.getElementById('kaRunsList');
        var last = document.getElementById('kaLastStatus');
        if (!list) return;
        list.textContent = '';
        list.appendChild(el('div', 'keepalive-muted',
            'ดึงประวัติจาก GitHub ไม่ได้ในตอนนี้ (เน็ตมีปัญหา, เรียกถี่เกิน หรือรีโปถูกตั้งเป็น private) — เปิดดูบน GitHub ได้จากลิงก์ด้านล่าง'));
        if (last) {
            last.textContent = 'ไม่ทราบ';
            last.className = 'keepalive-status';
        }
    }

    function loadRuns() {
        fetch(KA_API_URL, { headers: { Accept: 'application/vnd.github+json' } })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (json) { renderRuns(buildRunsViewModel(json)); })
            .catch(function () { renderRunsError(); });
    }

    function initKeepaliveCard() {
        var link = document.getElementById('kaGithubLink');
        if (link) link.href = KA_ACTIONS_URL;
        renderCountdown();
        setInterval(renderCountdown, 30000);
        loadRuns();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initKeepaliveCard);
    } else {
        initKeepaliveCard();
    }
})();
