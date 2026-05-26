-- -----------------------------------------------------------------------------
-- แนบไฟล์แชท — Storage bucket + คอลัมน์ metadata (สูงสุด 50MB)
-- รันหลัง 004 / 005
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS file_mime TEXT;

-- Bucket 50MB (52428800 bytes)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', true, 52428800)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

-- อ่านไฟล์ได้ (public bucket)
DROP POLICY IF EXISTS "chat_attachments_select" ON storage.objects;
CREATE POLICY "chat_attachments_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-attachments');

-- อัปโหลดได้
DROP POLICY IF EXISTS "chat_attachments_insert" ON storage.objects;
CREATE POLICY "chat_attachments_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-attachments');

-- ลบได้ (ตอนล้างแชท)
DROP POLICY IF EXISTS "chat_attachments_delete" ON storage.objects;
CREATE POLICY "chat_attachments_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-attachments');
