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

- ~~`okLabel` ผิด key~~ / ~~ล้างแชทตอนไม่มี client แล้วค้าง~~ / ~~Storage list 500 ไม่มี pagination~~ **แก้แล้ว (H8, 2026-08-09)** — ดูหัวข้อ "ปุ่มล้างแชท" ข้างล่าง
- **ยังไม่มีระบบยืนยันตัวตนจริง**: ใครก็ตั้งชื่อเป็นใครก็ได้ (H8 เพิ่มได้แค่แรงเสียดทาน + ร่องรอย ไม่ใช่ authorization) — ถ้าต้องการของจริงต้องมี Supabase Auth + RLS ต่อ role
- ไฟล์แนบเป็น public URL ไม่หมดอายุ — ใครมีลิงก์ก็เปิดได้
- Badge ยังไม่อ่านเพิ่มทีละ 1 **ต่อแท็บที่เปิด** (read-modify-write บน localStorage — `chat-notify-shared.js:207`) และเพิ่มแม้กำลังอ่านหน้าแชทอยู่ (`:209-214`)
- `message: text || (fileMeta ? '' : '')` — สอง branch ค่าเดียวกัน (`:611`)

## ปุ่มล้างแชท (หลัง H8, 2026-08-09)

`clearAllChat()` คุมเฉพาะ "ด่าน" · `runClearNow()` เป็นตัวลบจริง — แยกกันเพื่อให้เทสตรึงลำดับได้

| ด่าน | ทำอะไร | ล้มเหลวแล้วยังไง |
|---|---|---|
| 1. ระบุตัวตน | ไม่มีชื่อ = เปิด modal ตั้งชื่อ ไม่ลบ | return ทันที |
| 2. ยืนยัน + สำรอง | `uiConfirm.show` (ข้อความเปลี่ยนตามว่ามี client ไหม) → `fetchAllRoomMessages()` อ่านทั้งห้องแบบแบ่งหน้า เทียบกับ `count:'exact'` → `downloadChatJson()` | **สำรองไม่ครบ/ไม่ได้ = ไม่ลบอะไรเลย** |
| 3. พิมพ์คำยืนยัน | `#clearConfirmModal` ต้องพิมพ์ `ล้างแชท` ให้ตรง (ไม่มี placeholder ให้ก๊อป) ปุ่ม disabled จนกว่าจะตรง | ทุกทางออกที่ไม่ใช่การยืนยัน resolve `false` |

หลังผ่านครบ: `DELETE ... .select('id')` (นับแถวจริง — RLS บล็อกจะได้ 0 แถวโดยไม่ error) → วนลบไฟล์ใน Storage จนหมด (เพดาน `MAX_ROUNDS` 40 หน้า, เช็ค `data` ของ `remove()` เพราะ policy บล็อกแล้วคืน `[]` เงียบ ๆ) → `writeClearTrace()` เขียนข้อความระบุผู้ล้าง → สรุปผล

- `statusHoldUntil` กัน `updateHint` (ที่ถูกเรียกทุกครั้งที่มีข้อความไหลเข้ามาทาง realtime) เขียนทับคำเตือน — ก่อนหน้านี้ข้อความ "เซิร์ฟเวอร์ลบ 0 แถว ตรวจสิทธิ์ RLS" หายภายในไม่ถึงวินาที
- `clearInProgress` กันกดปุ่มซ้ำระหว่างด่าน 3 (คีย์บอร์ด tab ทะลุ overlay ไปถึงปุ่มได้) ซึ่งจะทำให้โปรมิสของรอบก่อนค้างถาวร
- โหมด local (ไม่มี client) ลบเฉพาะ mirror ในเครื่อง และบอกชัดว่าข้อมูลบนเซิร์ฟเวอร์ยังอยู่
- เทสคุ้มกัน: `tests/unit/chat-clear-guard.test.mjs` (16 ข้อ) — รวมข้อที่ตรวจว่า option ที่ส่งให้ `uiConfirm` ทุกไฟล์ในระบบเป็น key ที่ modal อ่านจริง (ต้นตอของบั๊ก `okLabel`)
