// ---------- ตั้งค่า AI Provider (SuperAdmin กำหนด, เก็บใน settings/global) ----------
export const AI_PROVIDERS = ['claude', 'openrouter', 'codex', 'omniroute']

export const DEFAULT_AI_CONFIG = {
  provider: 'openrouter', // 'claude' | 'openrouter' | 'codex' | 'omniroute'
  claudeModel: 'sonnet', // alias ของ Claude CLI: 'sonnet' | 'haiku' | 'opus'
  openrouterApiKey: '',
  openrouterModel: 'qwen/qwen3-235b-a22b-2507',
  codexModel: '', // ว่าง = ใช้โมเดลเริ่มต้นของ Codex (เช่น gpt-5.5)
  omnirouteModel: '', // model id ของ OmniRoute บน runner (key/URL ตั้งที่ server เท่านั้น)
}

import { authHeaders } from './apiAuth.js'

const AI_API_BASE = (import.meta.env.VITE_AI_API_BASE || '').replace(/\/$/, '')
const ALLOW_DIRECT_OPENROUTER = import.meta.env.VITE_OPENROUTER_DIRECT_FALLBACK === '1'
function apiUrl(path) {
  return `${AI_API_BASE}${path}`
}

// ดึงรายชื่อโมเดลทั้งหมดที่ OpenRouter รองรับ
// ถ้ามี backend/runner ให้ผ่าน proxy; ถ้าเป็น Firebase Hosting static ให้ยิง OpenRouter public endpoint ตรง
export async function fetchOpenRouterModels() {
  const res = await fetch(apiUrl('/api/openrouter-models'), { headers: await authHeaders() })
  if (!res.ok) {
    let msg = `เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status}`
    try {
      msg = (await res.json()).error || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return (await res.json()).models || []
}

// รายชื่อโมเดลจาก OmniRoute บน runner (ต้องตั้ง OMNIROUTE_API_KEY ที่ server ก่อน)
export async function fetchOmniRouteModels() {
  const res = await fetch(apiUrl('/api/omniroute-models'), { headers: await authHeaders() })
  if (!res.ok) {
    let msg = `เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status}`
    try {
      msg = (await res.json()).error || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return (await res.json()).models || []
}

// แปลง config (ที่ SuperAdmin ตั้ง) → payload ที่ส่งให้ server ต่อ 1 request
export function toAiPayload(cfg) {
  const c = { ...DEFAULT_AI_CONFIG, ...(cfg || {}) }
  if (c.provider === 'openrouter') {
    return { provider: 'openrouter', model: c.openrouterModel, ...(ALLOW_DIRECT_OPENROUTER ? { apiKey: c.openrouterApiKey } : {}) }
  }
  if (c.provider === 'omniroute') {
    return { provider: 'omniroute', model: c.omnirouteModel || undefined }
  }
  if (c.provider === 'codex') {
    return { provider: 'codex', model: c.codexModel || undefined }
  }
  return { provider: 'claude', model: c.claudeModel }
}

// config ที่ active อยู่ตอนนี้ (store จะ sync ให้ทุกครั้งที่โหลด/เปลี่ยน) → แนบไปกับทุก request
let activeAiPayload = toAiPayload(DEFAULT_AI_CONFIG)
export function setActiveAiPayload(payload) {
  activeAiPayload = payload || toAiPayload(DEFAULT_AI_CONFIG)
}

// เรียก backend (/api/ai-group) ที่สั่ง AI ช่วยจัดกลุ่มรหัสคำตอบเป็น Net
// codes = [{ text, count }] → คืน { nets: [{ name, codeIndexes }] }
export async function aiGroupCodes(codes) {
  return postJson('/api/ai-group', { codes })
}

// โค้ดดิ้งละเอียด: ส่ง verbatim ดิบให้ Claude สร้าง codeframe + จับ "หลายโค้ดต่อ 1 คำตอบ"
// verbatims = [{ text, count }] → คืน { codes: [{label, net}], assign: [[codeIdx,...], ...] }
export async function aiCodeAnswers(verbatims) {
  return postJson('/api/ai-code', { verbatims })
}

// รีวิว: ส่งโครงร่าง (พร้อมโค้ดเดิมต่อคำตอบ) ให้ Claude ตรวจ/แก้
// verbatims = [{ text, count, current: [<โค้ดเดิม>] }] → คืน { codes, assign } เหมือน aiCodeAnswers
export async function aiReviewAnswers(verbatims) {
  return postJson('/api/ai-review', { verbatims })
}

// ตรวจตัวสะกดของ Verbatim (ไม่เปลี่ยนความหมาย) + ชี้คำตอบที่มั่ว/อ่านไม่ออก/ไม่ได้ใจความ ให้คนเช็ค
// items = [{ i, text }] · question = โจทย์ของข้อ (ถ้ามี ใช้ดูว่าตอบไม่ตรงคำถาม)
//   → คืน { fixes: [{ i, fixed, reason }], flags: [{ i, reason }] }
export async function aiSpellcheck(items, question = '') {
  return postJson('/api/ai-spellcheck', { items, question })
}

// จับ verbatim 'อื่นๆ ระบุ' เข้ารหัสที่มีอยู่ (จาก SPSS value labels)
// codes = [{ i, label }] · verbatims = [{ i, text, count }] → คืน { assign: [<codeIndex|-1>, ...] }
export async function aiAssignToFrame(codes, verbatims) {
  return postJson('/api/ai-assign', { codes, verbatims })
}

// Group CE อัตโนมัติ: จับ verbatim เข้า Code เดิม (ถ้าตรง) + สร้าง Code ใหม่ (ถ้าไม่มี)
// codes = [{ i, label }] · verbatims = [{ i, text, count }]
//   → คืน { assign: [{ existing: <index> } | { neo: '<new label>' } | null, ...] }
export async function aiGroupCE(codes, verbatims) {
  return postJson('/api/ai-group-ce', { codes, verbatims })
}

// ทดสอบการเชื่อมต่อ provider/model ที่ระบุ (เรียกโมเดลจริง 1 ครั้งด้วย dummy เล็ก ๆ)
export async function aiTestConnection(aiPayload) {
  if (ALLOW_DIRECT_OPENROUTER && !AI_API_BASE && aiPayload?.provider === 'openrouter') {
    return runOpenRouterDirect('/api/ai-group', { codes: [{ text: 'ทดสอบการเชื่อมต่อ', count: 1 }] }, aiPayload)
  }
  const res = await fetch(apiUrl('/api/ai-group'), {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ codes: [{ text: 'ทดสอบการเชื่อมต่อ', count: 1 }], ai: aiPayload }),
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
  return res.json()
}


function extractJson(text) {
  if (!text) throw new Error('empty model output')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in model output')
  return JSON.parse(text.slice(start, end + 1))
}

async function callOpenRouterDirect() {
  throw new Error('OpenRouter direct mode is disabled; backend AI runner is required')
}

function buildGroupPrompt(codes) {
  const lines = codes.map((c, i) => `${i} (x${c.count ?? 0}) ${c.text}`)
  return [
    'You are an expert at coding open-ended (OE) survey responses in Thai.',
    'Group these answer codes into Nets by MEANING — not spelling.',
    'Every index must appear in exactly one net. Net names must be concise Thai labels.',
    'Return ONLY JSON: {"nets":[{"name":"<thai theme>","codeIndexes":[<indexes>]}]}',
    '', 'Codes:', ...lines,
  ].join('\n')
}

function normalizeGrouping(grouping, codeCount) {
  const seen = new Set()
  const nets = []
  for (const net of grouping?.nets ?? []) {
    const idxs = (net.codeIndexes ?? [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < codeCount && !seen.has(n))
    idxs.forEach((n) => seen.add(n))
    if (idxs.length) nets.push({ name: String(net.name || 'กลุ่ม').trim(), codeIndexes: idxs })
  }
  const leftover = []
  for (let i = 0; i < codeCount; i++) if (!seen.has(i)) leftover.push(i)
  if (leftover.length) nets.push({ name: 'อื่น ๆ', codeIndexes: leftover })
  return { nets }
}

function buildCodingPrompt(verbatims) {
  const lines = verbatims.map((v, i) => `${i} (x${v.count ?? 0}) ${v.text}`)
  return [
    'You are an expert at coding Thai open-ended survey responses.',
    'Build a codeframe and assign each verbatim to one or more codes. Split compound answers into all applicable reasons.',
    'Return ONLY JSON: {"codes":[{"label":"<thai code text>","net":"<thai net name>"}],"assign":[[<codeIndex>,...]]}',
    '', 'Verbatims:', ...lines,
  ].join('\n')
}

function normalizeCoding(parsed, verbatimCount) {
  const codes = (Array.isArray(parsed?.codes) ? parsed.codes : [])
    .map((c) => ({ label: String(c?.label ?? c?.text ?? '').trim(), net: String(c?.net ?? c?.netName ?? 'อื่น ๆ').trim() || 'อื่น ๆ' }))
    .filter((c) => c.label)
  const assign = []
  for (let i = 0; i < verbatimCount; i++) {
    const entry = parsed?.assign?.[i]
    const idxs = (Array.isArray(entry) ? entry : entry == null ? [] : [entry])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < codes.length)
    assign.push([...new Set(idxs)])
  }
  return { codes, assign }
}

function buildAssignPrompt(codes, verbatims) {
  const codeLines = codes.map((c) => `${c.i}: ${c.label}`)
  const vLines = verbatims.map((v) => `${v.i} (x${v.count ?? 0}) ${v.text}`)
  return [
    'You are an expert at coding Thai open-ended "other, specify" survey responses.',
    'For each verbatim, choose the SINGLE existing code index whose meaning matches best. If none fits, output -1.',
    'Return ONLY JSON: {"assign":[<codeIndex or -1>, ...]}',
    '', 'Existing codes:', ...codeLines, '', 'Verbatims:', ...vLines,
  ].join('\n')
}

function normalizeAssign(parsed, codeCount, verbatimCount) {
  const raw = Array.isArray(parsed?.assign) ? parsed.assign : []
  return { assign: Array.from({ length: verbatimCount }, (_, i) => {
    const n = Number(raw[i])
    return Number.isInteger(n) && n >= 0 && n < codeCount ? n : -1
  }) }
}

function buildGroupCEPrompt(codes, verbatims) {
  const codeLines = codes.map((c) => `${c.i}: ${c.label}`)
  const vLines = verbatims.map((v) => `${v.i} (x${v.count ?? 0}) ${v.text}`)
  return [
    'You are an expert at coding Thai open-ended "other, specify" survey responses.',
    'There is an existing codeframe. For each verbatim:',
    '- If meaning matches an existing code, output that code INDEX number.',
    '- If no existing code fits, create a new concise Thai code label string.',
    'Use the SAME new label string for verbatims that mean the same thing.',
    'Return ONLY JSON: {"assign":[<index number or "new label">, ...]}',
    '', 'Existing codes:', ...codeLines, '', 'Verbatims:', ...vLines,
  ].join('\n')
}

function normalizeGroupCE(parsed, codeCount, verbatimCount) {
  const raw = Array.isArray(parsed?.assign) ? parsed.assign : []
  const assign = []
  for (let i = 0; i < verbatimCount; i++) {
    const v = raw[i]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < codeCount) assign.push({ existing: v })
    else if (typeof v === 'string' && v.trim()) assign.push({ neo: v.trim() })
    else assign.push(null)
  }
  return { assign }
}

function buildSpellcheckPrompt(items, question = '') {
  const lines = items.map((it) => `${it.i}\t${it.text}`)
  return [
    'You are a meticulous Thai proofreader for survey answers. Fix ONLY spelling/tone marks/obvious typos without changing meaning.',
    'Also flag answers a human must review: gibberish, unreadable, not meaningful, or clearly unrelated to the question. Do not flag short meaningful answers. Flagged lines must not be in fixes.',
    'Omit lines already correct. Return ONLY JSON: {"fixes":[{"i":<index>,"fixed":"<corrected thai text>","reason":"<short thai note>"}],"flags":[{"i":<index>,"reason":"<short thai note>"}]}',
    ...(question ? ['', `Question: ${String(question).slice(0, 500)}`] : []),
    '', 'Lines:', ...lines,
  ].join('\n')
}

function normalizeSpellcheck(parsed, validIndexes) {
  const fixes = []
  for (const f of parsed?.fixes ?? []) {
    const i = Number(f?.i)
    const fixed = String(f?.fixed ?? '').trim()
    if (Number.isInteger(i) && validIndexes.has(i) && fixed) fixes.push({ i, fixed, reason: String(f?.reason ?? '').trim() })
  }
  const flags = []
  for (const f of parsed?.flags ?? []) {
    const i = Number(f?.i)
    if (Number.isInteger(i) && validIndexes.has(i)) flags.push({ i, reason: String(f?.reason ?? '').trim().slice(0, 80) })
  }
  const flagged = new Set(flags.map((f) => f.i))
  return { fixes: fixes.filter((f) => !flagged.has(f.i)), flags }
}

async function runOpenRouterDirect(url, body, ai) {
  if (url === '/api/ai-group') {
    const parsed = extractJson(await callOpenRouterDirect(buildGroupPrompt(body.codes ?? []), ai))
    return normalizeGrouping(parsed, (body.codes ?? []).length)
  }
  if (url === '/api/ai-code') {
    const parsed = extractJson(await callOpenRouterDirect(buildCodingPrompt(body.verbatims ?? []), ai))
    return normalizeCoding(parsed, (body.verbatims ?? []).length)
  }
  if (url === '/api/ai-review') {
    const parsed = extractJson(await callOpenRouterDirect(buildCodingPrompt(body.verbatims ?? []), ai))
    return normalizeCoding(parsed, (body.verbatims ?? []).length)
  }
  if (url === '/api/ai-assign') {
    const parsed = extractJson(await callOpenRouterDirect(buildAssignPrompt(body.codes ?? [], body.verbatims ?? []), ai))
    return normalizeAssign(parsed, (body.codes ?? []).length, (body.verbatims ?? []).length)
  }
  if (url === '/api/ai-group-ce') {
    const parsed = extractJson(await callOpenRouterDirect(buildGroupCEPrompt(body.codes ?? [], body.verbatims ?? []), ai))
    return normalizeGroupCE(parsed, (body.codes ?? []).length, (body.verbatims ?? []).length)
  }
  if (url === '/api/ai-spellcheck') {
    const items = body.items ?? []
    const parsed = extractJson(await callOpenRouterDirect(buildSpellcheckPrompt(items, body.question), ai))
    return normalizeSpellcheck(parsed, new Set(items.map((it) => Number(it.i))))
  }
  throw new Error(`ยังไม่รองรับ OpenRouter direct สำหรับ ${url}`)
}

async function postJson(url, body) {
  const ai = activeAiPayload
  if (ALLOW_DIRECT_OPENROUTER && !AI_API_BASE && ai?.provider === 'openrouter') {
    return runOpenRouterDirect(url, body, ai)
  }
  const res = await fetch(apiUrl(url), {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...body, ai }),
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
  return res.json()
}
