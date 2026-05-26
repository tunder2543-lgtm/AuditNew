-- -----------------------------------------------------------------------------
-- Chat messages (no-login) + Realtime
-- รองรับทั้ง: สร้างตารางใหม่ และ ตารางเก่าที่มีอยู่แล้ว (ไม่มี room_id)
-- -----------------------------------------------------------------------------

-- 1) สร้างตารางขั้นต่ำถ้ายังไม่มี
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) เพิ่มคอลัมน์ที่หน้า chat.html ใช้ (ถ้ายังไม่มี)
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS room_id TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS client_session_id TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS client_msg_id TEXT;

-- 3) ย้ายข้อมูลจากคอลัมน์เก่า (ถ้ามี schema เดิม)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'session_id'
    ) THEN
        UPDATE public.chat_messages
        SET client_session_id = session_id
        WHERE client_session_id IS NULL AND session_id IS NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'role'
    ) THEN
        UPDATE public.chat_messages
        SET event_type = CASE
            WHEN role IN ('sys', 'join') THEN 'join'
            ELSE 'message'
        END
        WHERE event_type IS NULL;
    END IF;
END $$;

-- 4) ค่าเริ่มต้นสำหรับแถวเก่า
UPDATE public.chat_messages SET room_id = 'main' WHERE room_id IS NULL;
UPDATE public.chat_messages SET event_type = 'message' WHERE event_type IS NULL;
UPDATE public.chat_messages SET message = COALESCE(message, '') WHERE message IS NULL;

ALTER TABLE public.chat_messages ALTER COLUMN room_id SET DEFAULT 'main';
ALTER TABLE public.chat_messages ALTER COLUMN event_type SET DEFAULT 'message';

-- 5) NOT NULL (หลังเติมค่าแล้ว)
ALTER TABLE public.chat_messages ALTER COLUMN room_id SET NOT NULL;
ALTER TABLE public.chat_messages ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE public.chat_messages ALTER COLUMN message SET NOT NULL;

-- 6) check constraint event_type
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_messages_event_type_check'
          AND conrelid = 'public.chat_messages'::regclass
    ) THEN
        ALTER TABLE public.chat_messages
            ADD CONSTRAINT chat_messages_event_type_check
            CHECK (event_type IN ('message', 'join'));
    END IF;
END $$;

-- 7) index
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created
    ON public.chat_messages (room_id, created_at);

-- 8) เปิด Realtime (ถ้ายังไม่ได้เพิ่มใน publication)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'chat_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        NULL; -- บางโปรเจกต์อาจไม่มี publication ชื่อนี้ — เปิด Realtime จาก Dashboard แทน
END $$;

-- หมายเหตุ:
-- - ถ้า step 8 ไม่ทำงาน ให้ไป Supabase Dashboard → Database → Replication/Realtime → เปิดตาราง chat_messages
-- - ถ้าใช้ anon key ควรตั้ง RLS/policy แยก (โปรเจกต์นี้ใช้ key จากหน้าตั้งค่า)
