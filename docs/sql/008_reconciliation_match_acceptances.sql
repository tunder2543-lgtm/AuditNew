-- ยืนยัน SKU เป็นสถานะ「ถูกต้อง」โดยไม่ปรับยอด Book / ผลนับ
-- รันครั้งเดียวใน Supabase SQL Editor

CREATE TABLE IF NOT EXISTS reconciliation_match_acceptances (
    cycle_id    UUID NOT NULL REFERENCES count_cycles(id) ON DELETE CASCADE,
    sku_id      TEXT NOT NULL,
    note        TEXT,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_by TEXT,
    PRIMARY KEY (cycle_id, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_recon_match_accept_cycle
    ON reconciliation_match_acceptances (cycle_id);

COMMENT ON TABLE reconciliation_match_acceptances IS
    'ยืนยันถูกต้องโดยไม่แก้ book_qty / counted_qty / adjustment — ใช้แสดงสถานะ match ใน UI';

-- สิทธิ์สำหรับ client (ถ้าโปรเจกต์เปิด RLS ให้เพิ่ม policy ตามนโยบายของคุณ)
GRANT SELECT, INSERT, UPDATE, DELETE ON reconciliation_match_acceptances TO anon, authenticated, service_role;
