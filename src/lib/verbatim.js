// ตรรกะร่วมของกล่อง Verbatim — ใช้ทั้งหน้าสรุป (VerbatimHub) และหน้าแก้ (VerbatimEditor) ให้นับสถานะตรงกัน

// ค่าเซลล์ของข้อ (รวมหลายคอลัมน์ของ MA ด้วย ' | ')
export const cellValue = (row, q) => (q.columns ?? [q.index]).map((c) => String(row?.[c] ?? '').trim()).filter(Boolean).join(' | ')

// แก้ได้เฉพาะข้อคอลัมน์เดียว
export const isEditable = (q) => (q.columns?.length ?? 1) === 1

// key ของ (คอลัมน์, ข้อความ) แบบสั้น (FNV-1a 32 บิต) — เก็บสถานะ AI ลงเอกสารโปรเจกต์โดยไม่ต้องเก็บข้อความเต็ม
export const textKey = (col, text) => {
  let h = 0x811c9dc5
  const s = String(text ?? '')
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return `${col}:${(h >>> 0).toString(36)}`
}

// ข้อ Verbatim ตามที่ตั้งค่าไว้ (ไม่รวมข้อที่เป็น SbjNum)
export function verbatimQuestions(cfg, questions) {
  const byId = new Map((questions ?? []).map((q) => [q.id, q]))
  return (cfg?.questionIds ?? []).filter((id) => id !== cfg?.sbjNumId).map((id) => byId.get(id)).filter(Boolean)
}

// จับคู่แถวปัจจุบันกับแถวต้นฉบับ (ตามลำดับ ถ้า SbjNum ไม่ตรงค่อยหาตาม SbjNum)
// ไม่มีต้นฉบับ → ถือว่าค่าปัจจุบันคือต้นฉบับ (ไม่มีเซลล์ที่ "แก้แล้ว")
export function makeOrigRowAt(origData, sbjQ) {
  if (!origData) return (row) => row
  let bySbj = null
  if (sbjQ) {
    bySbj = new Map()
    for (const r of origData.rows ?? []) { const k = cellValue(r, sbjQ); if (k && !bySbj.has(k)) bySbj.set(k, r) }
  }
  return (row, i) => {
    const byIdx = origData.rows?.[i]
    if (!sbjQ) return byIdx ?? row
    const k = cellValue(row, sbjQ)
    if (byIdx && cellValue(byIdx, sbjQ) === k) return byIdx
    return bySbj.get(k) ?? row
  }
}

// สถานะของ 1 เซลล์: '' (ว่าง) | 'human' | 'ai' | 'hok' (คนดูแล้ว OK) | 'flag' (AI ให้คนเช็ค: มั่ว/ไม่ได้ใจความ)
//   | 'ok' (AI ตรวจแล้ว OK) | 'pending' | 'locked' (ข้อหลายคอลัมน์ที่แก้ไม่ได้)
// aiFlag = Set หรือ Map ของ textKey ที่ AI ชี้ให้คนเช็ค
export function cellStatus(q, orig, clean, aiOk, aiFixed, humanOk, aiFlag) {
  if (!orig && !clean) return ''
  if (orig !== clean) return aiFixed?.has(textKey(q.index, clean)) ? 'ai' : 'human'
  if (!isEditable(q)) return 'locked'
  if (!clean) return ''
  // ข้อความที่ AI ตรวจแล้ว OK หรือเป็นข้อความที่ AI แก้ให้แล้ว (เช่น ไม่มีสำเนาต้นฉบับให้เทียบ) = ตรวจแล้ว
  const k = textKey(q.index, clean)
  if (humanOk?.has(k)) return 'hok' // คนดูแล้ว (เช่น วางทั้งคอลัมน์กลับมาแล้วข้อความเหมือนต้นฉบับ)
  if (aiFlag?.has(k)) return 'flag' // AI ดูแล้วว่าตอบมั่ว/อ่านไม่ออก → รอคนเช็ค (ยังไม่นับว่าครบ)
  return aiOk?.has(k) || aiFixed?.has(k) ? 'ok' : 'pending'
}

// สรุปต่อข้อ: { answered, human, ai, hok, ok, flag, pending, locked, done } — ครบ = ไม่มีทั้งค้างตรวจและรอคนเช็ค
export function computeVerbatimStats({ rows, qs, origRowAt, aiOk, aiFixed, humanOk, aiFlag }) {
  const out = new Map()
  for (const q of qs) {
    const s = { answered: 0, human: 0, ai: 0, hok: 0, ok: 0, flag: 0, pending: 0, locked: 0 }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const st = cellStatus(q, cellValue(origRowAt(row, i), q), cellValue(row, q), aiOk, aiFixed, humanOk, aiFlag)
      if (!st) continue
      s.answered++
      s[st]++
    }
    s.done = s.pending === 0 && s.flag === 0
    out.set(q.id, s)
  }
  return out
}

// ---------- คัดลอก/วางทั้งคอลัมน์กับ Excel (TSV) ----------
// ข้อความที่มี tab / ขึ้นบรรทัด / " ต้องครอบด้วย "..." (Excel ทำแบบนี้ทั้งตอนคัดลอกและวาง) เพื่อให้ 1 เซลล์ยังเป็น 1 เซลล์
export function toTsvColumn(values) {
  return values.map((v) => {
    const s = String(v ?? '')
    return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join('\r\n')
}

// แปลงข้อความ TSV (จาก Excel/Sheets) → แถวของคอลัมน์ [[c1, c2, ...], ...]
export function parseTsv(text) {
  const src = String(text ?? '')
  const rows = []
  let row = []
  let cell = ''
  let i = 0
  let quoted = false
  let atCellStart = true
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      cell += ch; i++; continue
    }
    if (ch === '"' && atCellStart) { quoted = true; atCellStart = false; i++; continue }
    if (ch === '\t') { row.push(cell); cell = ''; atCellStart = true; i++; continue }
    if (ch === '\r' || ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; atCellStart = true
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      continue
    }
    cell += ch; atCellStart = false; i++
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}
