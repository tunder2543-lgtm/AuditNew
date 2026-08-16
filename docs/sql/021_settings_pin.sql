-- 021: รหัสปลดล็อกส่วน "Supabase Config" ในหน้าตั้งค่า (2026-08-16)
--
-- ⛔ ตัวรหัสจริงไม่อยู่ในไฟล์นี้และห้ามใส่ลงรีโปเด็ดขาด (รีโปเป็น public)
--    admin ตั้ง/เปลี่ยนรหัสใน SQL Editor ของ Supabase dashboard ด้วย:
--      update public.app_settings_pin
--      set pin_hash = extensions.crypt('<รหัสใหม่>', extensions.gen_salt('bf')), updated_at = now()
--      where id = 1;
--
-- หลักการ: ตารางเปิด RLS แบบ "ไม่มี policy เลย" = anon/authenticated อ่าน-เขียนตรง ๆ
-- ไม่ได้แม้แต่ค่า hash · หน้าเว็บตรวจรหัสได้ทางเดียวคือ RPC ที่ตอบ จริง/เท็จ เท่านั้น

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_settings_pin (
    id smallint primary key default 1 check (id = 1), -- บังคับแถวเดียวทั้งตาราง
    pin_hash text,                                    -- bcrypt hash · NULL = ยังไม่ตั้งรหัส → verify คืน false เสมอ
    updated_at timestamptz not null default now()
);

alter table public.app_settings_pin enable row level security;
-- ตั้งใจไม่ create policy ใด ๆ — ห้ามเข้าถึงผ่าน API ทุกกรณี
revoke all on table public.app_settings_pin from anon, authenticated;

insert into public.app_settings_pin (id, pin_hash) values (1, null)
on conflict (id) do nothing;

-- ⛔ invariant ข้อ 12: RPC ที่แตะตารางซึ่ง anon ไม่มีสิทธิ์ ต้องเป็น SECURITY DEFINER + SET search_path
--    และ CREATE OR REPLACE จะล้าง attribute ทั้งชุด — ประกาศครบในตัวทุกครั้ง ห้ามพึ่ง ALTER ภายหลัง
create or replace function public.verify_settings_pin(p_pin text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
    select coalesce(
        (select pin_hash is not null and crypt(p_pin, pin_hash) = pin_hash
           from public.app_settings_pin
          where id = 1),
        false
    );
$$;

revoke all on function public.verify_settings_pin(text) from public;
grant execute on function public.verify_settings_pin(text) to anon, authenticated;
