// โหลดก่อนรันเทสต์ (node --import) — ทำให้ไฟล์ใน src/ ที่อ้าง import.meta.env (ของ Vite) รันบน Node ได้
// ค่า env ที่ใช้ในเทสต์มาจาก process.env (เฉพาะคีย์ VITE_*) ไม่อ่าน .env จริง
import { register } from 'node:module'

register('./env-loader.mjs', import.meta.url)
