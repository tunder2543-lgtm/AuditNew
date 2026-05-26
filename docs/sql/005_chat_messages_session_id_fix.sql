-- แก้ตาราง chat_messages รุ่นเก่าที่มี session_id NOT NULL
-- รันหลัง 004_chat_messages.sql

-- เติม session_id จาก client_session_id ถ้ามีแถวว่าง
UPDATE public.chat_messages
SET session_id = COALESCE(session_id, client_session_id, 'legacy-' || id::text)
WHERE session_id IS NULL;

-- คัดลอกกลับกัน (ถ้ามี client_session_id ว่าง)
UPDATE public.chat_messages
SET client_session_id = session_id
WHERE client_session_id IS NULL AND session_id IS NOT NULL;

-- trigger: insert ครั้งถัดไปไม่ต้องส่ง session_id เองก็ได้
CREATE OR REPLACE FUNCTION public.chat_messages_sync_session_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.session_id IS NULL AND NEW.client_session_id IS NOT NULL THEN
        NEW.session_id := NEW.client_session_id;
    ELSIF NEW.client_session_id IS NULL AND NEW.session_id IS NOT NULL THEN
        NEW.client_session_id := NEW.session_id;
    END IF;
    IF NEW.event_type IS NULL AND NEW.role IS NOT NULL THEN
        NEW.event_type := CASE WHEN NEW.role IN ('sys', 'join') THEN 'join' ELSE 'message' END;
    END IF;
    IF NEW.role IS NULL AND NEW.event_type IS NOT NULL THEN
        NEW.role := CASE WHEN NEW.event_type = 'join' THEN 'sys' ELSE 'me' END;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_sync_session ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_sync_session
    BEFORE INSERT OR UPDATE ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.chat_messages_sync_session_id();
