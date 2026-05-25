// =============================================================================
//  Dashboard — Shared helpers (submission buckets, Match KPI labels, charts)
// =============================================================================

(function () {

    const MATCH_STATUS_LABELS = {
        match:      { th: 'ถูกต้อง', icon: 'check', cls: 'match', color: '#1ec98a' },
        short:      { th: 'ขาด', icon: 'arrow-down', cls: 'short', color: '#ff5b6e' },
        over:       { th: 'เกิน', icon: 'arrow-up', cls: 'over', color: '#ffb020' },
        count_only: { th: 'นับเจอ แต่ไม่พบSKUในExcel', icon: 'scan-barcode', cls: 'other', color: '#94a3b8' },
        book_only:  { th: 'ยังไม่ได้นับ', icon: 'file-spreadsheet', cls: 'other', color: '#94a3b8' }
    };

    const BUCKET_OPTIONS = [
        { id: '1m', minutes: 1, label: '1 นาที' },
        { id: '10m', minutes: 10, label: '10 นาที' },
        { id: '30m', minutes: 30, label: '30 นาที' },
        { id: '1h', minutes: 60, label: '1 ชม.' }
    ];

    function formatBucketLabel(ms) {
        const d = new Date(ms);
        return d.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function bucketSubmissionsByInterval(rows, intervalMinutes) {
        const mins = Math.max(1, Number(intervalMinutes) || 30);
        const sizeMs = mins * 60 * 1000;
        const map = new Map();

        (rows || []).forEach(row => {
            const t = row.created_at ? new Date(row.created_at).getTime() : NaN;
            if (Number.isNaN(t)) return;
            const bucketStart = Math.floor(t / sizeMs) * sizeMs;
            map.set(bucketStart, (map.get(bucketStart) || 0) + 1);
        });

        return [...map.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([ms, count]) => ({
                ms,
                label: formatBucketLabel(ms),
                count,
                ratePerMin: count / mins
            }));
    }

    function computeSubmissionRateStats(rows, intervalMinutes) {
        const buckets = bucketSubmissionsByInterval(rows, intervalMinutes);
        if (!buckets.length) {
            return { buckets, avgPerMin: 0, peakPerMin: 0, peakLabel: '-', totalRecords: 0 };
        }
        const rates = buckets.map(b => b.ratePerMin);
        const peak = Math.max(...rates);
        const peakBucket = buckets.find(b => b.ratePerMin === peak);
        const total = buckets.reduce((s, b) => s + b.count, 0);
        const spanMin = buckets.length * (Number(intervalMinutes) || 30);
        const avgPerMin = spanMin > 0 ? total / spanMin : 0;

        return {
            buckets,
            avgPerMin,
            peakPerMin: peak,
            peakLabel: peakBucket ? peakBucket.label : '-',
            totalRecords: (rows || []).length
        };
    }

    function aggregateMatchFromSummary(summary) {
        if (!summary) {
            return {
                hasData: false,
                match: 0, short: 0, over: 0, book_only: 0, count_only: 0,
                total: 0, matchPct: null, totalVariance: 0
            };
        }
        const match = Number(summary.sku_match) || 0;
        const short = Number(summary.sku_short) || 0;
        const over = Number(summary.sku_over) || 0;
        const book_only = Number(summary.sku_book_only) || 0;
        const count_only = Number(summary.sku_count_only) || 0;
        const total = Number(summary.sku_total) || (match + short + over + book_only + count_only);
        return {
            hasData: total > 0,
            match, short, over, book_only, count_only, other: book_only + count_only,
            total,
            matchPct: summary.match_pct != null ? Number(summary.match_pct) : null,
            totalVariance: Number(summary.total_variance_pcs) || 0
        };
    }

    function destroyChart(chart) {
        if (chart) chart.destroy();
        return null;
    }

    function buildSubmissionLineChart(canvas, buckets, existingChart) {
        if (!canvas || !window.Chart) return existingChart;
        const labels = buckets.length ? buckets.map(b => b.label) : ['ไม่มีข้อมูล'];
        const counts = buckets.length ? buckets.map(b => b.count) : [0];
        const rates = buckets.length ? buckets.map(b => b.ratePerMin) : [0];

        let chart = destroyChart(existingChart);
        chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'จำนวนรายการ',
                        data: counts,
                        borderColor: '#4f8cff',
                        backgroundColor: 'rgba(79,140,255,0.12)',
                        fill: true,
                        tension: 0.25,
                        yAxisID: 'y'
                    },
                    {
                        label: 'รายการ/นาที',
                        data: rates,
                        borderColor: '#1ec98a',
                        backgroundColor: 'transparent',
                        tension: 0.25,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#dbe2ea', usePointStyle: true, boxWidth: 10 }
                    },
                    tooltip: {
                        backgroundColor: '#121316',
                        borderColor: '#353b47',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#9aa4b2', maxRotation: 45, autoSkip: true, maxTicksLimit: 24 },
                        grid: { color: 'rgba(255,255,255,.04)' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        beginAtZero: true,
                        ticks: { color: '#9aa4b2', precision: 0 },
                        grid: { color: 'rgba(255,255,255,.06)' },
                        title: { display: true, text: 'รายการ', color: '#9aa4b2' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        ticks: { color: '#7af0bf' },
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'รายการ/นาที', color: '#7af0bf' }
                    }
                }
            }
        });
        return chart;
    }

    function buildMatchDoughnutChart(canvas, kpis, existingChart) {
        if (!canvas || !window.Chart) return existingChart;
        const data = [
            kpis.match,
            kpis.short,
            kpis.over,
            kpis.book_only,
            kpis.count_only
        ];
        const labels = [
            MATCH_STATUS_LABELS.match.th,
            MATCH_STATUS_LABELS.short.th,
            MATCH_STATUS_LABELS.over.th,
            MATCH_STATUS_LABELS.book_only.th,
            MATCH_STATUS_LABELS.count_only.th
        ];
        const colors = [
            MATCH_STATUS_LABELS.match.color,
            MATCH_STATUS_LABELS.short.color,
            MATCH_STATUS_LABELS.over.color,
            MATCH_STATUS_LABELS.book_only.color,
            MATCH_STATUS_LABELS.count_only.color
        ];

        let chart = destroyChart(existingChart);
        const hasAny = data.some(v => v > 0);
        chart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: hasAny ? labels : ['ไม่มีข้อมูล Match'],
                datasets: [{
                    data: hasAny ? data : [1],
                    backgroundColor: hasAny ? colors : ['#353b47'],
                    borderColor: '#101319',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '55%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#dbe2ea', usePointStyle: true, boxWidth: 10 }
                    }
                }
            }
        });
        return chart;
    }

    window.dashboardShared = {
        MATCH_STATUS_LABELS,
        BUCKET_OPTIONS,
        formatBucketLabel,
        bucketSubmissionsByInterval,
        computeSubmissionRateStats,
        aggregateMatchFromSummary,
        buildSubmissionLineChart,
        buildMatchDoughnutChart,
        destroyChart
    };

})();
