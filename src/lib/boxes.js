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
  // label ยาวแต่มีช่องให้ระบุในวงเล็บ/ขีด เช่น "กาแฟพิเศษ (อื่น____)" / "Other ____"
  if (/[(（][^()）]*(อื่น|other)[^()）]*[)）]/i.test(s)) return true
  if (/(อื่น\s*ๆ?|other)\s*[_.]{2,}/i.test(s)) return true
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

function explicitOtherTextOwnerBase(label) {
  const s = String(label ?? '').trim()
  // q475_oth -> q475; s13_1_211_oth -> s13_1
  // Return null for normal OE question labels such as q649.
  const m = s.match(/^(.*?)(?:[_\-.]\d+)?[_\-.](?:oth|other|others?|specify)(?:$|[_\-.\d])/i)
  return m?.[1] || null
}

function looksLikeStandaloneQuestionKey(label) {
  return /^(?:[a-z]+[_\-.]*)?\d+(?:[_\-.][a-z0-9]+)*$/i.test(String(label ?? '').trim())
}

function looksLikeOtherTextColumn(rawdata, q, cb) {
  if (!q) return false
  // ข้อปลายปิดมี value labels → ไม่ใช่ช่องข้อความ Oth
  if (cb?.values?.length) return false
  const label = String(q.label ?? '')
  // ชื่อคอลัมน์จาก SPSS/Excel มักลงท้าย _oth / oth1001 / other / specify
  if (/(?:^|[_\-.])(?:oth|other|others?|specify)(?:$|[_\-.\d])/i.test(label)) return true
  if (/ระบุ|อื่น/i.test(label) && !/ไม่ระบุ|ไม่ทราบ/i.test(label)) return true
  if (isTextQuestion(rawdata, q)) return true
  // ข้อถัดไปเป็นคอลัมน์ String (ช่องระบุ) → รับเป็นช่อง "อื่นๆ" แม้จะยังว่าง (คนตอบอื่นๆ น้อย)
  if (cb?.type === 'string') return true
  return columnHasText(rawdata, q)
}

// หาข้อ "อื่นๆ โปรดระบุ" ทุกคอลัมน์ของข้อปลายปิด
// รองรับเคสข้อเดียวมีหลาย Oth เช่น s13_1_13_oth, s13_1_211_oth, s13_1_212_oth ...
// โดยเริ่มจากคอลัมน์ถัดจากข้อหลัก แล้วเก็บคอลัมน์ข้อความต่อเนื่องจนเจอข้อปลายปิดถัดไป
export function findOtherColumns(rawdata, question, codebook) {
  if (!rawdata || !question) return []
  // ต้องเป็นข้อที่ "มีตัวเลือกอื่นๆ ระบุ" จริงก่อน — ไม่งั้นไม่ถือว่ามีช่องระบุ
  if (!hasOtherOption(codebook?.byVar?.[question.label])) return []
  const lastCol = Math.max(...(question.columns ?? [question.index]))
  const sorted = [...rawdata.questions]
    .map((q) => ({ q, first: Math.min(...(q.columns ?? [q.index])) }))
    .sort((a, b) => a.first - b.first)

  const result = []
  const ownerBase = questionGroupBase(question.label).toLowerCase()
  for (const { q, first } of sorted) {
    if (first <= lastCol || q.id === question.id) continue
    const cb = codebook?.byVar?.[q.label]
    if (cb?.values?.length) break
    const explicitOwnerBase = explicitOtherTextOwnerBase(q.label)
    if (explicitOwnerBase) {
      // An explicit *_oth column belongs only to the matching closed question/group.
      // Never absorb a later unrelated question merely because it also contains text.
      if (questionGroupBase(explicitOwnerBase).toLowerCase() !== ownerBase) break
    } else {
      const candidateLabel = String(q.label ?? '').trim().toLowerCase()
      const sameOwnerPrefix = candidateLabel === ownerBase || candidateLabel.startsWith(`${ownerBase}_`) || candidateLabel.startsWith(`${ownerBase}.`) || candidateLabel.startsWith(`${ownerBase}-`)
      // q427 -> q428 is a new questionnaire item, not q427's Verbatim.
      if (looksLikeStandaloneQuestionKey(candidateLabel) && !sameOwnerPrefix) break
      if (result.length) {
        // Once an explicit/fallback Other text column was found, the next normal OE
        // question is a new question boundary (production example: q475_oth -> q649).
        break
      }
    }
    if (!looksLikeOtherTextColumn(rawdata, q, cb)) break
    result.push(q)
  }
  return result
}

// จำกัด Verbatim ของชีท CE ให้เป็นช่อง Other/specify ที่เป็นของข้อปลายปิดในชีทนั้นเท่านั้น
// ถ้าเป็นชีท OE ล้วน (ไม่มีข้อปลายปิด) ให้คงข้อข้อความเดิมทั้งหมดไว้
export function scopedVerbatimQuestionIds(rawdata, questionIds, codebook, preserveIds = []) {
  if (!rawdata) return []
  const ids = questionIds ?? []
  const byId = new Map((rawdata.questions ?? []).map((q) => [q.id, q]))
  const closed = ids
    .map((id) => byId.get(id))
    .filter((q) => q && codebook?.byVar?.[q.label]?.values?.length)
  const open = ids
    .map((id) => byId.get(id))
    .filter((q) => q && !(codebook?.byVar?.[q.label]?.values?.length))
  if (!closed.length) return open.map((q) => q.id)

  const allowed = new Set(preserveIds.filter(Boolean))
  for (const q of closed) {
    for (const otherQ of findOtherColumns(rawdata, q, codebook)) allowed.add(otherQ.id)
  }
  return open.filter((q) => allowed.has(q.id)).map((q) => q.id)
}

// compatibility: โค้ดเก่าที่ต้องการตัวแรกยังใช้ได้
export function findOtherColumn(rawdata, question, codebook) {
  return findOtherColumns(rawdata, question, codebook)[0] ?? null
}

export function questionGroupBase(label) {
  const s = String(label ?? '')
  return s.replace(/_\d{2,}$/i, '')
}

export function closedQuestionGroup(rawdata, question, codebook) {
  if (!rawdata || !question) return []
  const cb = codebook?.byVar?.[question.label]
  if (!(cb?.values?.length)) return [question]
  const base = questionGroupBase(question.label)
  const grouped = rawdata.questions
    .filter((q) => {
      const label = String(q.label ?? '')
      if (questionGroupBase(label) !== base) return false
      // MA slots often only have value labels on *_01 in codebook; include sibling *_02, *_03... by raw column name too.
      return /_\d{2,}$/i.test(label) || !!(codebook?.byVar?.[label]?.values?.length)
    })
    .sort((a, b) => Math.min(...(a.columns ?? [a.index])) - Math.min(...(b.columns ?? [b.index])))
  return grouped.length ? grouped : [question]
}

export function closedQuestionGroupColumns(rawdata, question, codebook) {
  return closedQuestionGroup(rawdata, question, codebook).flatMap((q) => q.columns ?? [q.index])
}

export function otherCodeFromColumnLabel(label) {
  const s = String(label ?? '').trim()
  // Exact rule: take the final numeric token immediately before oth/other/specify.
  // Examples: s13_1_13_oth → 13, s13_1_211_oth → 211, s13_1_212_oth → 212.
  // Do NOT use loose substring matching because code 13 must not match 211_oth.
  const m = s.match(/(?:^|[_\-.])(\d+)(?=[_\-.]*(?:oth|other|others?|specify)(?:$|[_\-.\d]))/i)
  return m?.[1]?.replace(/^0+(?=\d)/, '') ?? ''
}

export function otherColumnsForCode(rawdata, question, codebook, codeNo) {
  const all = findOtherColumns(rawdata, question, codebook)
  const normalizedCode = String(codeNo ?? '').trim().replace(/\.0$/, '').replace(/^0+(?=\d)/, '')
  if (!normalizedCode) return all
  // When a code is requested, only return columns explicitly named for that code.
  // If none exist, return [] instead of all; otherwise deleting 211_oth can touch 13_oth.
  return all.filter((q) => otherCodeFromColumnLabel(q.label) === normalizedCode)
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
