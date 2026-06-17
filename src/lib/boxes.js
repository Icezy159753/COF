// ข้อมูลประจำกล่องทั้ง 4 (ใช้ทำหัวข้อ/สี/ป้าย ให้สม่ำเสมอทั้งแอป)
export const BOX_META = {
  rawdata: { key: 'rawdata', label: 'Rawdata', desc: 'ศูนย์กลางข้อมูล', color: 'emerald' },
  ce: { key: 'ce', label: 'CE', desc: 'Coding & Editing', color: 'sky' },
  oe: { key: 'oe', label: 'OE', desc: 'Open-Ended', color: 'violet' },
  verbatim: { key: 'verbatim', label: 'Verbatim', desc: 'แก้ข้อความ + ตรวจ AI', color: 'amber' },
}

export const isWorkBox = (box) => box === 'ce' || box === 'oe'

// ย่อชื่อชีทให้สั้น (ใช้ทั้งหน้าเว็บและ Excel ให้ตรงกัน)
//   - ชื่อไทยยาว "รสแรก..._d4" → ดึงรหัสท้าย → "d4"
//   - ตัด suffix ตัวแปร MA: "s12_O1" → "s12" · "I_1_d5_O1" → "I_1_d5"
//   - ชื่อ ASCII สั้นปล่อยไว้: "a1.1-a2.2" → "a1.1-a2.2" · "a1_1_1" → "a1_1_1"
export function shortSheetName(name) {
  let s = String(name ?? '').split(',')[0].trim()
  if (/[฀-๿]/.test(s)) {
    // มีอักษรไทยปน → เอาเฉพาะรหัสท้าย (โรมัน/ตัวเลข/_)
    const m = s.match(/[A-Za-z0-9_]+$/)
    if (m) s = m[0]
  }
  s = s.replace(/^_+/, '').replace(/(?:_O\d+|\$\d+)$/i, '') // ตัด _ นำ + suffix MA
  return s || String(name ?? '').trim()
}

// จำนวนแถวใหม่ที่กล่องยังไม่ได้ดู (rowCount ปัจจุบัน - watermark ที่เคยดู)
export function newRowCount(project, box) {
  const total = project?.rawMeta?.rowCount ?? 0
  const seen = project?.boxes?.[box]?.seenRowCount ?? 0
  return Math.max(0, total - seen)
}

// ---------- ตรวจจับชนิดข้อจาก Rawdata ----------
// สุ่มดูค่าของแต่ละข้อ แล้วเดาว่าเป็น "ข้อความอิสระ (verbatim)" หรือ "ปลายปิด/ตัวเลข"
//   verbatim = ค่าส่วนใหญ่ไม่ใช่ตัวเลขล้วน และมีความยาวเฉลี่ยพอสมควร
const SAMPLE = 80
const isNumericLike = (v) => /^-?\d+(\.\d+)?$/.test(String(v).trim())

function questionStats(rawdata, q) {
  const cols = q.columns ?? [q.index]
  let n = 0
  let numeric = 0
  let lenSum = 0
  let distinct = new Set()
  for (let r = 0; r < rawdata.rows.length && n < SAMPLE; r++) {
    for (const c of cols) {
      const v = String(rawdata.rows[r]?.[c] ?? '').trim()
      if (!v) continue
      n += 1
      if (isNumericLike(v)) numeric += 1
      lenSum += v.length
      distinct.add(v)
      if (n >= SAMPLE) break
    }
  }
  return {
    samples: n,
    numericRatio: n ? numeric / n : 0,
    avgLen: n ? lenSum / n : 0,
    distinctRatio: n ? distinct.size / n : 0,
  }
}

export function isTextQuestion(rawdata, q) {
  const s = questionStats(rawdata, q)
  if (!s.samples) return false
  // ข้อความอิสระ: ส่วนใหญ่ไม่ใช่ตัวเลข + ยาวพอ + ค่าหลากหลาย
  return s.numericRatio < 0.4 && s.avgLen >= 4 && s.distinctRatio > 0.4
}

// คืน id ของข้อที่น่าจะเป็น verbatim (ข้อความอิสระ) ทั้งหมด
export function detectTextQuestions(rawdata) {
  if (!rawdata) return []
  return rawdata.questions.filter((q) => isTextQuestion(rawdata, q)).map((q) => q.id)
}

// มีค่าข้อความ (ไม่ใช่ตัวเลข) อย่างน้อย 1 ค่าในคอลัมน์ไหม — ใช้จับช่อง "อื่นๆ ระบุ" ที่คนกรอกน้อย
function columnHasText(rawdata, q) {
  const cols = q.columns ?? [q.index]
  for (const row of rawdata.rows) {
    for (const c of cols) {
      const v = String(row?.[c] ?? '').trim()
      if (v && !isNumericLike(v)) return true
    }
  }
  return false
}

// ตรวจว่า value label เป็นตัวเลือก "อื่นๆ ระบุ" หรือไม่ — รองรับทุกรูปแบบ:
//   อื่นๆ · อื่น ๆ · อื่นๆระบุ · อื่นๆ ระบุ · อื่นๆ_____ระบุ · อื่นๆ (โปรดระบุ)
//   Other · Others · Other specify · Other (specify) · Pls specify · โปรดระบุ
//   ❌ ยกเว้น "ไม่ระบุ" / "not specified" (ไม่ใช่ช่องอื่นๆ ระบุ)
export function isOtherLabel(label) {
  const s = String(label ?? '').toLowerCase().trim()
  if (!s) return false
  // ตัวที่ "ไม่ใช่" ช่องระบุ แม้จะมีคำคล้าย (ไม่ระบุ / ไม่ทราบ / unspecified / not specified)
  if (/ไม่ระบุ|ไม่ทราบ|unspecified|not\s*specif/i.test(s)) return false
  // มีคำว่า "ระบุ" / "specify" → เป็นช่องระบุแน่นอน (เช่น "อื่นๆ ระบุ", "โปรดระบุ", "Other (specify)")
  if (/ระบุ|specify/i.test(s)) return true
  // เป็นตัวเลือก "อื่นๆ"/"other" สั้น ๆ เท่านั้น — กันหมวดยาวที่บังเอิญมีคำว่า "อื่น"
  //   (เช่น "พนักงานบริษัทฯ ในตำแหน่งอื่นๆ" จะไม่ถูกนับเป็น "อื่นๆ ระบุ")
  const compact = s.replace(/[\s().,_/\\\-–—…ๆ"'`]/g, '')
  return /^(อื่น|others?)$/.test(compact)
}

// regex เดิม (เผื่อมีที่อื่นเรียกใช้) — แต่แนะนำให้ใช้ isOtherLabel แทน
export const OTHER_LABEL_RE = /อื่น|other|specify|โปรดระบุ/i

// มีตัวเลือก "อื่นๆ ระบุ" ใน value labels ของข้อนี้ไหม
export function hasOtherOption(cb) {
  return !!cb?.values?.some((v) => isOtherLabel(v.label))
}

// หาข้อ "อื่นๆ โปรดระบุ" ของข้อปลายปิด = คอลัมน์ "ถัดไปในไฟล์" (ขวาของข้อ)
// คืน question ของคอลัมน์ถัดไป "เฉพาะเมื่อ" ข้อนี้มีตัวเลือก "อื่นๆ ระบุ" จริงในโค้ดบุ๊ก
//   → กันการเผลอจับคอลัมน์ข้อความข้างๆ (เช่น URL/แพลตฟอร์ม) ของข้อที่ไม่มี "อื่นๆ ระบุ"
//   ⚠️ ช่อง "อื่นๆ ระบุ" มักมีคนกรอกน้อยมาก (sparse) → ยอมรับถ้าคอลัมน์ถัดไปไม่มี value labels
//      (เป็น string เปล่า) และมีข้อความอย่างน้อย 1 ค่า
export function findOtherColumn(rawdata, question, codebook) {
  if (!rawdata || !question) return null
  // ต้องเป็นข้อที่ "มีตัวเลือกอื่นๆ ระบุ" จริงก่อน — ไม่งั้นไม่ถือว่ามีช่องระบุ
  if (!hasOtherOption(codebook?.byVar?.[question.label])) return null
  const lastCol = Math.max(...(question.columns ?? [question.index]))
  const nextIndex = lastCol + 1
  const next = rawdata.questions.find((q) => (q.columns ?? [q.index]).includes(nextIndex))
  if (!next || next.id === question.id) return null
  const nextCb = codebook?.byVar?.[next.label]
  // ข้อถัดไปเป็นข้อปลายปิด (มี value labels) → ไม่ใช่ช่อง "อื่นๆ ระบุ"
  if (nextCb?.values?.length) return null
  if (isTextQuestion(rawdata, next)) return next
  // ข้อถัดไปเป็นคอลัมน์ String (ช่องระบุ) → รับเป็นช่อง "อื่นๆ" แม้จะยังว่าง (คนตอบอื่นๆ น้อย)
  if (nextCb?.type === 'string') return next
  return columnHasText(rawdata, next) ? next : null
}

// นับความถี่ของแต่ละค่าในข้อ (เช่น code 1/2/3 ของข้อปลายปิด) → Map<valueString, count>
export function freqByValue(rawdata, question) {
  const counts = new Map()
  if (!rawdata || !question) return counts
  const cols = question.columns ?? [question.index]
  for (const row of rawdata.rows) {
    for (const c of cols) {
      const v = String(row?.[c] ?? '').trim()
      if (!v) continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
  }
  return counts
}

// เดาข้อ SbjNum (รหัสผู้ตอบ): หัวคอลัมน์ที่ดูเหมือน id / sbjnum / serial
const SBJ_RE = /^(sbj?\.?\s*num|sbjnum|subject|serial|respondent|id|no\.?|ลำดับ|เลขที่)$/i
export function guessSbjNum(rawdata) {
  if (!rawdata) return null
  const byName = rawdata.questions.find((q) => SBJ_RE.test(String(q.label).trim()))
  if (byName) return byName.id
  // ไม่เจอตามชื่อ → ใช้ข้อแรกที่เป็นตัวเลข/ค่าไม่ซ้ำ (น่าจะเป็นรหัสผู้ตอบ)
  const numericId = rawdata.questions.find((q) => {
    const s = questionStats(rawdata, q)
    return s.samples > 0 && s.numericRatio > 0.8 && s.distinctRatio > 0.8
  })
  return numericId?.id ?? rawdata.questions[0]?.id ?? null
}
