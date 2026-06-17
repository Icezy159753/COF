// ดึงคำตอบ (ไม่ซ้ำ) ของข้อที่เลือกจาก Rawdata
// คืนค่า [{ key, text, count, questions: [label] }]
export function uniqueAnswers(rawdata, questionIds) {
  if (!rawdata) return []
  const byId = new Map(rawdata.questions.map((q) => [q.id, q]))
  const map = new Map()
  for (const qid of questionIds) {
    const q = byId.get(qid)
    if (!q) continue
    // ข้อ MA ครอบคลุมหลายคอลัมน์ → ดึงคำตอบจากทุกคอลัมน์ย่อยมารวมกัน
    const columns = q.columns ?? [q.index]
    for (const col of columns) {
      for (const row of rawdata.rows) {
        const text = String(row[col] ?? '').trim()
        if (!text) continue
        const key = text
        if (!map.has(key)) map.set(key, { key, text, count: 0, questions: new Set() })
        const item = map.get(key)
        item.count += 1
        item.questions.add(q.label)
      }
    }
  }
  return [...map.values()]
    .map((a) => ({ ...a, questions: [...a.questions] }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'th'))
}

// ---------- เครื่องมือวัดความคล้ายของข้อความ (character bi-gram Jaccard) ----------
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s.,!?;:"'`()\[\]{}…\-—–/\\]+/g, '')
}

function bigrams(text) {
  const t = normalize(text)
  const set = new Set()
  if (t.length <= 1) {
    if (t) set.add(t)
    return set
  }
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
  return set
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

// ---------- จับคู่อัตโนมัติ: เอาคำตอบเข้ารหัสที่ "มีอยู่แล้ว" ในโครง ----------
// match เมื่อข้อความรหัส (หรือคำใดคำหนึ่งที่คั่นด้วย "/") เป็นส่วนหนึ่งของคำตอบ
// หรือคล้ายกันเกิน threshold (กันงาน OE ที่พิมพ์ต่างกันเล็กน้อย)
// คืนค่า { assignments, matched } — matched = จำนวนคำตอบที่จับเข้ารหัสได้ในรอบนี้
export function autoAssign(answers, nets, existing = {}, { fuzzy = 0.6 } = {}) {
  const assignments = { ...existing }
  const codeList = []
  for (const net of nets) {
    for (const code of net.codes) {
      const variants = String(code.thai || '')
        .split('/')
        .map((v) => v.trim())
        .filter((v) => v.length >= 2)
      if (!variants.length) continue
      codeList.push({
        id: code.id,
        variants,
        grams: bigrams(code.thai),
      })
    }
  }

  let matched = 0
  for (const a of answers) {
    if (assignments[a.key]?.length) continue
    const aNorm = normalize(a.text)
    const aGrams = bigrams(a.text)
    const hits = []
    for (const c of codeList) {
      const substr = c.variants.some((v) => {
        const vn = normalize(v)
        return vn && (aNorm.includes(vn) || vn.includes(aNorm))
      })
      if (substr || jaccard(aGrams, c.grams) >= fuzzy) hits.push(c.id)
    }
    if (hits.length) {
      assignments[a.key] = hits
      matched += 1
    }
  }
  return { assignments, matched }
}

// ---------- สร้างโครง Codeframe จากคำตอบอัตโนมัติ (เหมาะกับงาน OE) ----------
// จัดกลุ่มคำตอบที่คล้ายกันด้วย greedy clustering แล้วสร้าง 1 Net + 1 รหัสต่อกลุ่ม
// threshold สูง = รวมเฉพาะที่คล้ายมาก (ได้รหัสเยอะ), ต่ำ = รวมเป็นกลุ่มใหญ่ (ได้รหัสน้อย)
// คืนค่า { net, assignments, clusterCount }
//   assignments = { answerKey: [codeId] } พร้อม assign คำตอบเข้ารหัสที่สร้างให้เลย
export function buildCodeframeFromAnswers(answers, makeId, { threshold = 0.5, netName } = {}) {
  const items = answers.map((a) => ({ ...a, grams: bigrams(a.text) }))
  const clusters = [] // { repText, repGrams, repCount, members: [item] }

  for (const item of items) {
    let best = null
    let bestSim = 0
    for (const c of clusters) {
      const sim = jaccard(item.grams, c.repGrams)
      if (sim > bestSim) {
        bestSim = sim
        best = c
      }
    }
    if (best && bestSim >= threshold) {
      best.members.push(item)
      // ใช้คำตอบที่พบบ่อยสุดเป็นตัวแทนชื่อรหัส (เสมอกัน → สั้นกว่า)
      if (
        item.count > best.repCount ||
        (item.count === best.repCount && item.text.length < best.repText.length)
      ) {
        best.repText = item.text
        best.repGrams = item.grams
        best.repCount = item.count
      }
    } else {
      clusters.push({
        repText: item.text,
        repGrams: item.grams,
        repCount: item.count,
        members: [item],
      })
    }
  }

  // เรียงกลุ่มตามจำนวนคำตอบรวม (มาก → น้อย)
  clusters.sort(
    (a, b) =>
      b.members.reduce((s, m) => s + m.count, 0) -
      a.members.reduce((s, m) => s + m.count, 0),
  )

  const assignments = {}
  const codes = clusters.map((c, i) => {
    const id = makeId()
    for (const m of c.members) assignments[m.key] = [id]
    return { id, codeNo: String(i + 1), thai: c.repText, thai2: '', eng: '' }
  })

  const net = {
    id: makeId(),
    name: netName || 'รหัสจากคำตอบ (สร้างอัตโนมัติ)',
    codes,
  }
  return { net, assignments, clusterCount: clusters.length }
}

// ---------- แตกคำตอบยาวเป็น "ประโยคย่อย" (สำหรับโหมด 1 คำตอบหลายเรื่อง) ----------
// ตัดด้วยคำเชื่อม/เครื่องหมายที่มักคั่นคนละเรื่อง (และ / รวมถึง / , / ฯลฯ)
const TOPIC_SPLIT = /\s*(?:และ|แล้วก็|และก็|รวมถึง|รวมทั้ง|อีกทั้ง|ตลอดจน|นอกจากนี้|อีกอย่าง|[,，;、/\n])\s*/g
export function splitTopics(text) {
  const parts = String(text || '')
    .split(TOPIC_SPLIT)
    .map((p) => p.trim())
    .filter((p) => normalize(p).length >= 2)
  return parts.length ? parts : [String(text || '').trim()].filter(Boolean)
}

// greedy cluster ของ "หน่วย" ที่มี grams แล้ว — คืน clusters [{repText, repGrams, repCount, members}]
function clusterUnits(units, threshold) {
  const clusters = []
  for (const u of units) {
    let best = null
    let bestSim = 0
    for (const c of clusters) {
      const sim = jaccard(u.grams, c.repGrams)
      if (sim > bestSim) { bestSim = sim; best = c }
    }
    if (best && bestSim >= threshold) {
      best.members.push(u)
      if (u.count > best.repCount || (u.count === best.repCount && u.text.length < best.repText.length)) {
        best.repText = u.text; best.repGrams = u.grams; best.repCount = u.count
      }
    } else {
      clusters.push({ repText: u.text, repGrams: u.grams, repCount: u.count, members: [u] })
    }
  }
  return clusters
}

// ---------- สร้างโครงแบบละเอียด: รองรับ Net อัตโนมัติ + 1 คำตอบหลายโค้ด ----------
// opts:
//   threshold     = ระดับรวมคำตอบ→รหัส (สูง=รหัสเยอะ)
//   multiTopic    = true → แตกคำตอบยาวเป็นประโยคย่อย แล้ว 1 คำตอบลงได้หลายรหัส
//   groupIntoNets = true → จับรหัสที่คล้ายกันเข้าเป็น Net เดียวกัน
//   netThreshold  = ระดับรวมรหัส→Net (ต่ำ=Net น้อย/กว้าง)
// คืน { nets, assignments, codeCount } — assignments[answerKey] = [codeId,...]
export function buildCodeframeAdvanced(
  answers,
  makeId,
  { threshold = 0.5, multiTopic = false, groupIntoNets = false, netThreshold = 0.18 } = {},
) {
  // 1) สร้างหน่วยที่จะ cluster — ทั้งคำตอบ หรือประโยคย่อย (พก​ answerKey ไว้ map กลับ)
  const units = []
  for (const a of answers) {
    const pieces = multiTopic ? splitTopics(a.text) : [a.text]
    for (const text of pieces) {
      units.push({ key: a.key, text, count: a.count, grams: bigrams(text) })
    }
  }

  // 2) cluster หน่วย → รหัส
  const clusters = clusterUnits(units, threshold)
  clusters.sort(
    (x, y) =>
      y.members.reduce((s, m) => s + m.count, 0) - x.members.reduce((s, m) => s + m.count, 0),
  )
  const codeObjs = clusters.map((c) => ({ id: makeId(), grams: c.repGrams, thai: c.repText }))

  // assignments: ทุกหน่วยของคำตอบ → code id (set ต่อ answerKey → ได้หลายโค้ด)
  const assignByKey = new Map()
  clusters.forEach((c, ci) => {
    for (const m of c.members) {
      if (!assignByKey.has(m.key)) assignByKey.set(m.key, new Set())
      assignByKey.get(m.key).add(codeObjs[ci].id)
    }
  })
  const assignments = {}
  for (const [key, set] of assignByKey) assignments[key] = [...set]

  // 3) จัดรหัสเป็น Net
  let nets
  if (groupIntoNets && codeObjs.length) {
    const netClusters = clusterUnits(
      codeObjs.map((c) => ({ text: c.thai, count: 1, grams: c.grams, _id: c.id })),
      netThreshold,
    )
    let codeNo = 1
    nets = netClusters.map((nc) => ({
      id: makeId(),
      name: nc.repText,
      codes: nc.members.map((m) => {
        const co = codeObjs.find((c) => c.id === m._id)
        return { id: co.id, codeNo: String(codeNo++), thai: co.thai, thai2: '', eng: '' }
      }),
    }))
  } else {
    nets = [{
      id: makeId(),
      name: 'รหัสจากคำตอบ (สร้างอัตโนมัติ)',
      codes: codeObjs.map((c, i) => ({ id: c.id, codeNo: String(i + 1), thai: c.thai, thai2: '', eng: '' })),
    }]
  }

  return { nets, assignments, codeCount: codeObjs.length }
}

// preview จำนวนรหัส/Net สำหรับ modal (ไม่สร้าง id จริง)
export function previewAdvanced(answers, { threshold, multiTopic, groupIntoNets, netThreshold }) {
  const units = []
  for (const a of answers) {
    const pieces = multiTopic ? splitTopics(a.text) : [a.text]
    for (const text of pieces) units.push({ text, count: a.count, grams: bigrams(text) })
  }
  const clusters = clusterUnits(units, threshold)
  let netCount = 1
  if (groupIntoNets && clusters.length) {
    netCount = clusterUnits(
      clusters.map((c) => ({ text: c.repText, count: 1, grams: c.repGrams })),
      netThreshold,
    ).length
  }
  return { codeCount: clusters.length, netCount }
}

// ---------- ประกอบ Net จากผลจัดกลุ่มของ AI ----------
// codes = รหัสที่ rule cluster ไว้แล้ว (มี id เดิม → assignment ยังใช้ได้)
// grouping = { nets: [{ name, codeIndexes }] } (index อ้างถึงตำแหน่งใน codes)
// คืน array ของ Net พร้อมรหัสที่ไล่หมายเลขใหม่ต่อเนื่องข้าม Net
export function assembleNetsFromGrouping(codes, grouping, makeId) {
  let codeNo = 1
  return grouping.nets
    .map((net) => ({
      id: makeId(),
      name: net.name || 'กลุ่ม',
      codes: net.codeIndexes
        .map((idx) => codes[idx])
        .filter(Boolean)
        .map((c) => ({ ...c, codeNo: String(codeNo++) })),
    }))
    .filter((net) => net.codes.length)
}

// ---------- ประกอบผล "coding ละเอียด" จาก AI (1 คำตอบ → ได้หลายโค้ด) ----------
// targets = [{ key, text, count }] เรียงลำดับเดียวกับที่ส่งให้ AI
// coding  = { codes: [{ label, net }], assign: [[codeIdx,...], ...] }
// คืน { nets, assignments, codeCount } — assignments[answerKey] = [codeId, ...]
export function assembleCodingResult(targets, coding, makeId) {
  const codes = (coding.codes ?? [])
    .map((c) => ({ id: makeId(), label: String(c.label ?? '').trim(), net: String(c.net ?? 'อื่น ๆ').trim() || 'อื่น ๆ' }))
    .filter((c) => c.label)

  // จัดโค้ดเป็น Net ตามชื่อ net (คงลำดับที่พบครั้งแรก)
  const netOrder = []
  const netMap = new Map()
  codes.forEach((c) => {
    if (!netMap.has(c.net)) {
      netMap.set(c.net, [])
      netOrder.push(c.net)
    }
    netMap.get(c.net).push(c)
  })
  let codeNo = 1
  const nets = netOrder.map((name) => ({
    id: makeId(),
    name,
    codes: netMap.get(name).map((c) => ({ id: c.id, codeNo: String(codeNo++), thai: c.label, thai2: '', eng: '' })),
  }))

  // assign: verbatim ตำแหน่ง i → code id หลายตัวได้
  const assignments = {}
  const assign = coding.assign ?? []
  targets.forEach((t, i) => {
    const ids = (assign[i] ?? []).map((idx) => codes[idx]?.id).filter(Boolean)
    if (ids.length) assignments[t.key] = [...new Set(ids)]
  })

  return { nets, assignments, codeCount: codes.length }
}

// นับว่าถ้าใช้ threshold นี้จะได้กี่กลุ่ม (สำหรับ preview ใน modal)
export function previewClusterCount(answers, threshold) {
  const items = answers.map((a) => ({ grams: bigrams(a.text) }))
  const clusters = []
  for (const item of items) {
    let bestSim = 0
    let best = null
    for (const c of clusters) {
      const sim = jaccard(item.grams, c.grams)
      if (sim > bestSim) {
        bestSim = sim
        best = c
      }
    }
    if (best && bestSim >= threshold) best.members += 1
    else clusters.push({ grams: item.grams, members: 1 })
  }
  return clusters.length
}
