// จุดที่แก้ใน Rawdata ชุดเดียวกัน (ทั้งจาก CE และ Verbatim) — ใช้ไฮไลต์ในหน้า Rawdata และตอน Export Excel
//   'code'     = ลง/แก้ Code (CE เขียนทับ หรือค่าตัวเลขที่ต่างจากต้นฉบับ) → เหลือง
//   'verbatim' = แก้ข้อความในข้อที่อยู่กล่อง Verbatim → เขียว
//   'text'     = แก้ข้อความอื่น ๆ (เช่น แก้/รวม/ลบ Verbatim จากหน้า Codeframe) → เขียว
import { cellValue, isEditable, makeOrigRowAt, textKey, verbatimQuestions } from './verbatim.js'

const isNumberLike = (s) => /^-?\d+(?:\.\d+)?$/.test(s)

// คอลัมน์ของข้อ Verbatim + คอลัมน์ SbjNum ตามที่ตั้งไว้ในกล่อง Verbatim
export function verbatimContext(rawdata, verbatimCfg) {
  const questions = rawdata?.questions ?? []
  const sbjQ = verbatimCfg?.sbjNumId ? questions.find((q) => q.id === verbatimCfg.sbjNumId) ?? null : null
  const verbatimCols = new Map() // col → question
  for (const q of verbatimQuestions(verbatimCfg, questions)) {
    if (isEditable(q)) verbatimCols.set(q.index, q)
  }
  return {
    sbjQ,
    verbatimCols,
    aiFixed: new Set(verbatimCfg?.aiFixed ?? []),
  }
}

// rows = แถวที่จะแสดง/ส่งออก (หลัง CE ลง Code แล้ว) · original = Rawdata ต้นฉบับ (ไม่มีก็ได้)
// ceMaskRows = Set<col> ต่อแถว จาก buildOverwrittenRawdata (จุดที่ CE เขียนทับ)
// → { kinds: Map<col, kind>[] (เรียงตาม rows), editedCols: Set<col>, log: [...] (เฉพาะจุดแก้ข้อความ), counts }
export function buildEditOverlay({ rows, original, headers = [], ceMaskRows = null, sbjQ = null, verbatimCols = new Map(), aiFixed = new Set() }) {
  const origRowAt = makeOrigRowAt(original, sbjQ)
  const kinds = []
  const editedCols = new Set()
  const log = []
  const counts = { code: 0, verbatim: 0, text: 0 }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? []
    const m = new Map()
    const ce = ceMaskRows?.[i]
    if (ce) for (const c of ce) m.set(c, 'code')
    if (original) {
      const o = origRowAt(row, i) ?? []
      const width = Math.max(row.length, o.length)
      for (let c = 0; c < width; c++) {
        if (m.has(c)) continue
        const cur = String(row[c] ?? '').trim()
        const orig = String(o[c] ?? '').trim()
        if (cur === orig) continue
        const vq = verbatimCols.get(c)
        const kind = vq ? 'verbatim' : isNumberLike(cur || orig) ? 'code' : 'text'
        m.set(c, kind)
        if (kind !== 'code') {
          log.push({
            row: i + 1,
            sbj: sbjQ ? cellValue(row, sbjQ) : '',
            col: c,
            header: headers[c] ?? `คอลัมน์ ${c + 1}`,
            original: orig,
            current: cur,
            source: vq
              ? `Verbatim · ${aiFixed.has(textKey(c, cur)) ? 'AI แก้' : 'Human แก้'}`
              : 'แก้ข้อความ (Codeframe / อื่น ๆ)',
          })
        }
      }
    }
    for (const [c, k] of m) { editedCols.add(c); counts[k]++ }
    kinds.push(m)
  }
  return { kinds, editedCols, log, counts }
}
