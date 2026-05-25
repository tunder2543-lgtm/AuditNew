-- =============================================================================
-- Migration 004: Dashboard — aggregate อัตราการส่งงานต่อช่วงเวลา
-- รันหลัง 002_reconciliation_schema.sql (optional — ใช้เมื่อข้อมูล inventory_counts มาก)
-- =============================================================================

CREATE OR REPLACE FUNCTION submission_rate_buckets(
    p_start timestamptz,
    p_end timestamptz,
    p_warehouse text DEFAULT NULL,
    p_cycle_id uuid DEFAULT NULL,
    p_interval_minutes int DEFAULT 30
)
RETURNS TABLE (
    bucket_start timestamptz,
    record_count bigint,
    rate_per_minute numeric
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT created_at
        FROM inventory_counts ic
        WHERE ic.created_at >= p_start
          AND ic.created_at < p_end
          AND (p_cycle_id IS NULL OR ic.cycle_id = p_cycle_id)
          AND (
              p_warehouse IS NULL
              OR p_warehouse = ''
              OR ic.warehouse = p_warehouse
              OR (p_warehouse LIKE '%|%' AND ic.warehouse = ANY (
                  string_to_array(p_warehouse, '|')
              ))
          )
    ),
    bucketed AS (
        SELECT
            to_timestamp(
                floor(extract(epoch FROM created_at AT TIME ZONE 'Asia/Bangkok')
                    / (GREATEST(p_interval_minutes, 1) * 60))
                * (GREATEST(p_interval_minutes, 1) * 60)
            ) AT TIME ZONE 'Asia/Bangkok' AS bucket_start,
            COUNT(*)::bigint AS record_count
        FROM filtered
        GROUP BY 1
    )
    SELECT
        bucket_start,
        record_count,
        ROUND(record_count::numeric / GREATEST(p_interval_minutes, 1), 4) AS rate_per_minute
    FROM bucketed
    ORDER BY bucket_start;
$$;

COMMENT ON FUNCTION submission_rate_buckets IS
    'Dashboard: จำนวนรายการต่อ bucket เวลาไทย — รองรับ cycle_id และคลังเดียว/หลายคลัง (คั่น |)';
