# user_manual.html — คู่มือการใช้งาน (แก้ไขได้ในเบราว์เซอร์)

> ไฟล์: `Html/user_manual.html` (~740 บรรทัด) + `Js/manual-editor.js` (~259 บรรทัด)
> คู่มือปฏิบัติงานแบบ self-contained: โหมดอ่าน/แก้ไข, ทุกย่อหน้าแก้ได้ (`contentEditable`), ช่องรูป (`.manual-figure-slot`) อัปโหลด screenshot ได้ — เนื้อหาครอบคลุม DFD Level 0–1 และ flow F0–F7

## หน้าที่และฟีเจอร์

- สลับโหมด อ่าน ↔ แก้ไข (จำโหมดใน localStorage)
- แก้ข้อความ inline + วางรูปลง slot (เก็บเป็น base64 data URL)
- Autosave debounce 800ms (`manual-editor.js:7, 56-59`) + flush ตอน `beforeunload` (`:234-236`)
- ปุ่ม "สำรอง" export JSON (`exportManualBackup:205-218`), ปุ่ม "รีเซ็ต" ล้าง storage ผ่าน uiConfirm (`:190-203`)

## Supabase: **ไม่ใช้เลย** — ทุกอย่างอยู่ใน localStorage

(api.js/supabase-js ถูกโหลด lazy ผ่าน sidebar เพียงเพื่อให้ chat badge ทำงาน)

## Shared JS ที่โหลด (`:735-737`)

`sidebar-shared`, `ui-confirm-modal` (+ `Css/ui-confirm.css`), `manual-editor`

## localStorage keys

| Key | เนื้อหา |
|---|---|
| `stock_audit_user_manual_v2` | `{html, images, updatedAt}` — เนื้อหาคู่มือทั้งหมด |
| `stock_audit_manual_mode_v1` | `'read'` หรือ `'edit'` |

## ข้อสังเกต / จุดเปราะบาง (ดู [ISSUES.md](../ISSUES.md))

- **รูปถูกเก็บ 2 ชุด**: base64 อยู่ทั้งใน `state.html` (ฝังใน `img.src`) และใน `state.images` (`manual-editor.js:37-41, 132`) — กินโควตา localStorage เท่าตัว ทั้งที่หน้าเองเตือนเรื่องพื้นที่เต็ม (`user_manual.html:727`)
- **Backup export ได้แต่ import ไม่ได้** — ไม่มีเส้นทางกู้ไฟล์ JSON กลับ (`:205-218`) และถ้าจะทำต้อง sanitize เพราะ restore เป็น `innerHTML` ตรง ๆ (`:243`)
- ตอน QuotaExceeded toast ไม่แสดงเพราะ `window.showToast` ไม่มีนิยามบนหน้านี้ (`:44-53`) — ผู้ใช้แก้ต่อโดยไม่รู้ว่าบันทึกไม่ได้
- `exportManualBackup` เรียก `loadState()` ก่อน export — ทับ state ในหน่วยความจำ อาจทิ้ง edit ที่ debounce ค้างอยู่ (`:206`)
- เนื้อหาล้าสมัย: สอนให้ใส่ "anon public key" (`:314`) ขณะที่ระบบ seed service_role; hardcode "3 คลัง" (`:184, 341`) ทั้งที่ registry เป็น dynamic
- พิมพ์ผิด: "ภาคผนิ" → "ภาคผนวก" (`:220`)
