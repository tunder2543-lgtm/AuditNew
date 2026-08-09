# chat.html — แชทภายในทีม

> ไฟล์: `Html/chat.html` (~886 บรรทัด) + `Js/chat-notify-shared.js` (~366 บรรทัด — ระบบแจ้งเตือนข้ามหน้า)
> ห้องแชทเดียว (`room_id = 'main'`) แนบไฟล์ได้ถึง 50 MB, realtime, export JSON, ปุ่มล้างทั้งห้อง

## หน้าที่และฟีเจอร์

### หน้าแชท (inline script)
- ตั้งชื่อผู้ใช้ + station (จำใน localStorage; override ได้ผ่าน `?station=` / `?machine=` / `?terminal=` — `:363-369`)
- โหลด 200 ข้อความล่าสุด (`:707-712`), ส่งข้อความ (`:646`), แนบไฟล์อัปโหลดเข้า Storage bucket `chat-attachments` (`:631`) แล้วแชร์เป็น **public URL** (`:388`)
- Realtime channel `chat_room_main` — INSERT พร้อม filter `room_id=eq.main` ฝั่ง server (`:698-703`)
- Mirror ข้อความลง `localStorage.audit_chat_v2` (จำกัด 500 — `:487`)
- ประกาศ join ครั้งเดียวต่อ session (`sessionStorage.join_sent_main`)
- Export JSON, **ล้างแชททั้งห้อง** (ลบ `chat_messages` ของห้อง + ไล่ลบไฟล์ใน Storage สูงสุด 500 ไฟล์ — `:554-595`)

### Js/chat-notify-shared.js (โหลดอัตโนมัติทุกหน้าผ่าน sidebar)
- ถูก inject โดย `sidebar-shared.js` (`:194-261`) พร้อม `Css/chat-notify.css` — หน้าที่ไม่มี supabase-js จะโหลดจาก CDN ให้ก่อน
- Realtime channel `chat_notify_global_main` — INSERT ทั้งตาราง **ไม่มี filter ฝั่ง server** กรอง room ฝั่ง client (`:297-303`)
- Polling fallback: 8 วิเมื่อ realtime ล่ม / 60 วิเมื่อปกติ (`:270-277`), seed `seenIds` จาก 80 ข้อความล่าสุด
- Toast แจ้งเตือน + badge ตัวเลขบน sidebar (`sidebar-chat-badge`)
- ขอ `Notification` permission ทันทีตอน init โดยไม่ถาม (`:346-348`)
- Retry init สูงสุด 20 ครั้ง ทุก 1.5 วิ ระหว่างรอ client (`:12-13, 320-328`)

## ตาราง Supabase ที่ใช้

| แหล่ง | Operations |
|---|---|
| `chat_messages` | SELECT 200 ล่าสุด, INSERT, DELETE ทั้งห้อง |
| Storage `chat-attachments` | upload, getPublicUrl, list + remove (ตอนล้าง) |
| Realtime | 2 channels: `chat_room_main` (หน้าแชท) + `chat_notify_global_main` (notify) — **หน้าแชทเปิดซ้อน 2 channel บนตารางเดียวกัน** |

## Shared JS ที่โหลด (`:288-290`)

`sidebar-shared`, `api`, `ui-confirm-modal` (+ `Css/ui-confirm.css`) — ไม่โหลด settings-shared/db-errors/sku-utils; `chat-notify-shared` มาทาง sidebar

## localStorage / sessionStorage keys

| Key | ใช้ทำอะไร |
|---|---|
| `audit_chat_v2` | mirror ข้อความ (จำกัด 500) |
| `audit_chat_name_v1` / `audit_chat_station_v1` | ชื่อ/สถานีผู้ใช้ |
| `audit_chat_session_v1` | session id ของแท็บ |
| `audit_chat_unread_v1` | ตัวเลข badge ยังไม่อ่าน |
| `audit_chat_last_read_v1` | เวลาอ่านล่าสุด |
| `sessionStorage.join_sent_main` | กันประกาศ join ซ้ำ |

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **ไม่มี authorization ใด ๆ**: ใครก็ตั้งชื่อเป็นใครก็ได้ และปุ่มล้างแชทลบประวัติ+ไฟล์ของทุกคนถาวร
- **[ยืนยันแล้ว] `okLabel` ผิด key**: ui-confirm อ่าน `confirmLabel` — ปุ่มยืนยันลบทั้งห้องแสดงข้อความ default "ยืนยัน" แทน "ล้างแชท" (`:545` vs `ui-confirm-modal.js:145`)
- **[ยืนยันแล้ว] ล้างแชทตอนไม่มี client**: ไม่มี else — ข้อความสถานะค้าง "กำลังล้างแชท..." (`:552-599`)
- ล้าง Storage `.list(limit 500)` ไม่มี pagination — เกิน 500 ไฟล์เหลือ orphan เงียบ ๆ (`:565`)
- ไฟล์แนบเป็น public URL ไม่หมดอายุ — ใครมีลิงก์ก็เปิดได้
- Badge ยังไม่อ่านเพิ่มทีละ 1 **ต่อแท็บที่เปิด** (read-modify-write บน localStorage — `chat-notify-shared.js:207`) และเพิ่มแม้กำลังอ่านหน้าแชทอยู่ (`:209-214`)
- `message: text || (fileMeta ? '' : '')` — สอง branch ค่าเดียวกัน (`:611`)
