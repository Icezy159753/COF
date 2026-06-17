// อ่าน metadata (Value + Label) จากไฟล์ SPSS .sav ฝั่ง Node
// ใช้ sav-reader (SavBufferReader) — อ่านเฉพาะ metadata (open) ไม่ต้องโหลด data records
// คืน { byVar: { <varName>: { label, type, values:[{value,label}] } }, varCount }
// หมายเหตุ: sav-reader เป็น CommonJS (exports เฉพาะ "require") → โหลดด้วย createRequire
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { SavBufferReader } = require('sav-reader')

export async function parseSavBuffer(buffer) {
  const sav = new SavBufferReader(buffer)
  await sav.open() // โหลดเฉพาะ metadata (ชื่อข้อ + label + value labels)

  const byVar = {}
  for (const v of sav.meta.sysvars ?? []) {
    // ข้าม sysvar ภายในที่เป็น "ส่วนต่อของ string ยาว" (ไม่ใช่ตัวแปรจริง)
    if (v.__is_child_string_var) continue
    let values = []
    try {
      const entries = sav.meta.getValueLabels(v.name) ?? []
      values = entries
        .map((e) => ({ value: e.val, label: String(e.label ?? '').trim() }))
        .filter((e) => e.label !== '')
    } catch {
      values = []
    }
    byVar[v.name] = {
      label: String(v.label ?? '').trim(),
      type: v.type === 1 ? 'string' : 'numeric',
      values,
    }
  }
  return { byVar, varCount: Object.keys(byVar).length }
}
