// ส่งไฟล์ SPSS .sav ไปให้ backend (/api/parse-sav) อ่าน metadata
// คืน { byVar: { <varName>: { label, type, values:[{value,label}] } }, varCount }
export async function parseSavCodebook(file) {
  const res = await fetch('/api/parse-sav', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file, // ส่ง File เป็น binary ตรงๆ
  })
  if (!res.ok) {
    let msg = `เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status}`
    try {
      msg = (await res.json()).error || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const data = await res.json()
  // เก็บเฉพาะที่จำเป็น: ชื่อข้อ → { label (โจทย์), values (Value Label), type (string/numeric) }
  //   type ใช้รู้ว่าคอลัมน์ถัดไปเป็น "ช่องระบุ" (String) แม้จะว่าง
  const byVar = {}
  let valueLabelCount = 0
  for (const [name, v] of Object.entries(data.byVar ?? {})) {
    const values = Array.isArray(v?.values) ? v.values : []
    byVar[name] = { label: String(v?.label ?? ''), values, type: v?.type }
    if (values.length) valueLabelCount += 1
  }
  return {
    byVar,
    varCount: data.varCount ?? Object.keys(byVar).length,
    valueLabelCount,
    fileName: file.name,
    updatedAt: Date.now(),
  }
}

// แมพ codebook (.sav) เข้ากับคอลัมน์ Excel "ตามลำดับ" (position) ไม่ใช่ตามชื่อ
//   เหตุผล: ชื่อตัวแปรใน Excel/SPSS อาจไม่ตรงกัน (เช่นข้อลูป B6_1) แต่ลำดับคอลัมน์ตรงกันเป๊ะ
//   - questions = rawdata.questions (มี columns = ดัชนีคอลัมน์ของแต่ละข้อ)
//   - คืน { ok, codebook } หรือ { ok:false, error } ถ้าจำนวนตัวแปรไม่เท่ากับจำนวนคอลัมน์
export function remapCodebookByPosition(codebook, questions) {
  const spssNames = Object.keys(codebook?.byVar ?? {}) // เรียงตามลำดับใน .sav
  if (!questions?.length) {
    return { ok: false, error: 'ยังไม่มี Rawdata (Excel) ในโปรเจกต์นี้ — กรุณาอัปโหลด Rawdata ก่อนแนบ .sav' }
  }
  // จำนวนคอลัมน์จริงของ Excel = ดัชนีคอลัมน์สูงสุด + 1
  const colCount = questions.reduce((m, q) => Math.max(m, ...(q.columns ?? [q.index])), -1) + 1
  if (spssNames.length !== colCount) {
    return {
      ok: false,
      error:
        `จำนวนตัวแปรไม่เท่ากัน — Excel มี ${colCount} คอลัมน์ แต่ .sav มี ${spssNames.length} ตัวแปร ` +
        `จึงแมพตามลำดับไม่ได้ กรุณาตรวจสอบให้ไฟล์ Excel กับ .sav มีจำนวน/ลำดับตัวแปรตรงกัน`,
    }
  }
  // แมพตามตำแหน่ง: คอลัมน์ i ↔ ตัวแปร .sav ตำแหน่ง i · ข้อ MA ใช้ตัวแปรของคอลัมน์แรก
  const byVar = {}
  let valueLabelCount = 0
  for (const q of questions) {
    const firstCol = Math.min(...(q.columns ?? [q.index]))
    const v = codebook.byVar[spssNames[firstCol]]
    if (v) {
      // เก็บชื่อตัวแปร .sav (code สั้น) ไว้ใช้ตั้งชื่อชีท · label = โจทย์เต็ม · type = string/numeric
      byVar[q.label] = { label: v.label, values: v.values, code: spssNames[firstCol], type: v.type }
      if (v.values?.length) valueLabelCount += 1
    }
  }
  return {
    ok: true,
    codebook: {
      byVar,
      varCount: Object.keys(byVar).length,
      valueLabelCount,
      fileName: codebook.fileName,
      updatedAt: Date.now(),
    },
  }
}

// หา codebook ของข้อ (จับคู่ด้วยชื่อข้อ = ชื่อ variable ใน .sav)
export function codebookForQuestion(codebook, question) {
  if (!codebook?.byVar || !question) return null
  return codebook.byVar[question.label] ?? null
}

// ลายเซ็นของชุด value labels (value+label) — ไว้เทียบว่า "โครงเหมือนกันเป๊ะ"
// เรียงตาม value ก่อน เพื่อให้ลำดับไม่มีผล
export function valueSignature(values) {
  if (!values?.length) return null
  return values
    .map((v) => `${String(v.value)}${String(v.label)}`)
    .sort()
    .join('')
}

// หา "ทุกข้อที่ใช้โครง code เหมือนกันเป๊ะ" กับข้อที่เลือก (รวมตัวมันเอง)
// คืน array ของ question (เรียงตามตำแหน่งคอลัมน์ในไฟล์)
export function findSameFrameQuestions(codebook, questions, question) {
  if (!codebook?.byVar || !question) return [question]
  const sig = valueSignature(codebook.byVar[question.label]?.values)
  if (!sig) return [question]
  return questions
    .filter((q) => valueSignature(codebook.byVar[q.label]?.values) === sig)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
}
