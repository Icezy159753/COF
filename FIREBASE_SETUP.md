# ตั้งค่า Firebase (เก็บ Job + Rawdata บนคลาวด์ แทน localStorage)

แอปนี้ย้ายจากการเก็บข้อมูลใน `localStorage` (ซึ่งเต็มเมื่อไฟล์ใหญ่) ไปเก็บบน **Firestore** ทั้งหมด:

| ข้อมูล | เก็บที่ |
|--------|---------|
| Projects / Jobs / Codeframes | Firestore (collection `projects`, `jobs`, `codeframes`) |
| Rawdata (ก้อนคำตอบใหญ่จากไฟล์ .xlsx) | Firestore — ซอยเป็น chunk เก็บใน collection `rawdata_chunks` |

> ใช้ Firestore อย่างเดียว ไม่ต้องเปิด Cloud Storage / ไม่ต้องอัปเกรด Blaze — อยู่บน Spark (ฟรี) ได้
> เพราะ Firestore จำกัด 1 document ≤ 1MB เราจึงซอย rawdata JSON เป็นชิ้นละ ~250k ตัวอักษร
> หลาย document แล้วต่อกลับตอนอ่าน

## ขั้นตอน (ทำครั้งเดียว)

### 1) วาง Firebase config — ✅ ทำแล้ว
อยู่ที่ `src/lib/firebaseConfig.js` (โปรเจกต์ `codeframe-dbd8d`)

### 2) เปิด Firestore + ตั้ง Rules — ✅ ทำแล้ว
Console → **Build → Firestore Database** → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
อย่าลืมกด **Publish**

> ⚠️ Rules `if true` = ใครมีลิงก์ก็เข้าถึงได้ เหมาะกับใช้ภายใน/ช่วงทดสอบ
> เมื่อพร้อมค่อยเพิ่ม Firebase Auth แล้วเปลี่ยนเป็น `if request.auth != null`

### 3) รันแอป
```
npm run dev -- --port 5176
```
เปิด http://localhost:5176/ — แอปจะโหลดข้อมูลจาก Firestore ตอนเปิด และบันทึกอัตโนมัติทุกครั้งที่แก้

---

## หมายเหตุ

- **ข้อมูลเดิมใน localStorage** ไม่ถูกย้ายให้อัตโนมัติ — เริ่มอัปโหลด Rawdata ใหม่ในแอปได้เลย
- การพิมพ์แก้ Codeframe จะ **debounce** บันทึกขึ้น Firestore ทุก 600ms (ไม่ยิงเขียนทุกตัวอักษร)
- ปริมาณการใช้ Firestore ฟรี/วัน (Spark): อ่าน 50k, เขียน 20k, ลบ 20k document — เพียงพอสำหรับการใช้งานทั่วไป
  (rawdata 1 ไฟล์ ~1.3MB = ราว 6 chunk = 6 write / 6 read ต่อการเปิด 1 ครั้ง)
