// เทียบข้อความ Original ↔ Clean เพื่อไฮไลต์จุดที่แก้ (ภาษาไทยไม่มีเว้นวรรค จึงตัดคำด้วย Intl.Segmenter)
// diffText(a, b) → [{ type: 'eq' | 'del' | 'ins', text }]
//   ต่อ eq+del กลับได้ a เสมอ และ eq+ins กลับได้ b เสมอ
// ขั้นตอน: ตัด prefix/suffix ที่เหมือนกัน → LCS ระดับคำ → ช่วงที่ลบ+เพิ่มติดกันและสั้น ให้ละเอียดลงระดับตัวอักษร (grapheme)

const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
const wordSeg = hasSegmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null
const graphemeSeg = hasSegmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null

export function wordTokens(s) {
  const str = String(s ?? '')
  if (!str) return []
  if (wordSeg) return Array.from(wordSeg.segment(str), (x) => x.segment)
  return str.match(/\s+|[A-Za-z0-9]+|[^\sA-Za-z0-9]/gu) ?? []
}

function graphemes(s) {
  const str = String(s ?? '')
  if (!str) return []
  if (graphemeSeg) return Array.from(graphemeSeg.segment(str), (x) => x.segment)
  return Array.from(str)
}

const MAX_CELLS = 250_000 // n*m สูงสุดของตาราง LCS (กันข้อความยาวมากทำให้ค้าง)

function push(out, type, text) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.type === type) last.text += text
  else out.push({ type, text })
}

// LCS diff บน token array
function lcsDiff(a, b) {
  const out = []
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  push(out, 'eq', a.slice(0, start).join(''))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  if (!n || !m || n * m > MAX_CELLS) {
    push(out, 'del', midA.join(''))
    push(out, 'ins', midB.join(''))
  } else {
    // dp[i][j] = LCS ของ midA[i..] กับ midB[j..]
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { push(out, 'eq', midA[i]); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push(out, 'del', midA[i]); i++ }
      else { push(out, 'ins', midB[j]); j++ }
    }
    while (i < n) push(out, 'del', midA[i++])
    while (j < m) push(out, 'ins', midB[j++])
  }
  push(out, 'eq', a.slice(endA).join(''))
  return out
}

// รวมส่วนที่ติดกันเป็นกลุ่ม del/ins (ลำดับใดก็ได้) แล้วถ้าสั้นพอ diff ละเอียดระดับตัวอักษร
const REFINE_MAX = 40

function refine(parts) {
  const out = []
  let i = 0
  while (i < parts.length) {
    if (parts[i].type === 'eq') { push(out, 'eq', parts[i].text); i++; continue }
    let del = ''
    let ins = ''
    while (i < parts.length && parts[i].type !== 'eq') {
      if (parts[i].type === 'del') del += parts[i].text
      else ins += parts[i].text
      i++
    }
    const gd = graphemes(del)
    const gi = graphemes(ins)
    if (gd.length && gi.length && gd.length <= REFINE_MAX && gi.length <= REFINE_MAX) {
      const fine = lcsDiff(gd, gi)
      const same = fine.filter((p) => p.type === 'eq').reduce((n, p) => n + graphemes(p.text).length, 0)
      // ใช้ผลละเอียดเฉพาะเมื่อคล้ายกันพอ (ไม่งั้นจะเห็นตัวอักษรกระจัดกระจาย อ่านยาก)
      if (same * 2 >= Math.min(gd.length, gi.length)) {
        for (const p of fine) push(out, p.type, p.text)
        continue
      }
    }
    push(out, 'del', del)
    push(out, 'ins', ins)
  }
  return out
}

export function diffText(a, b) {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  if (sa === sb) return sa ? [{ type: 'eq', text: sa }] : []
  if (!sa) return [{ type: 'ins', text: sb }]
  if (!sb) return [{ type: 'del', text: sa }]
  return refine(lcsDiff(wordTokens(sa), wordTokens(sb)))
}

// cache เล็ก ๆ — ตารางเรนเดอร์ซ้ำบ่อย (พิมพ์แก้ทีละตัว) แต่คู่ข้อความส่วนใหญ่เหมือนเดิม
const cache = new Map()
const CACHE_MAX = 5000
export function diffTextCached(a, b) {
  const key = `${a ?? ''}\u0000${b ?? ''}`
  let v = cache.get(key)
  if (!v) {
    v = diffText(a, b)
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(key, v)
  }
  return v
}
