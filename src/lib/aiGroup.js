// ---------- ตั้งค่า AI Provider (SuperAdmin กำหนด, เก็บใน settings/global) ----------
export const AI_PROVIDERS = ['claude', 'openrouter', 'codex']

export const DEFAULT_AI_CONFIG = {
  provider: 'claude', // 'claude' | 'openrouter' | 'codex'
  claudeModel: 'sonnet', // alias ของ Claude CLI: 'sonnet' | 'haiku' | 'opus'
  openrouterApiKey: '',
  openrouterModel: 'anthropic/claude-3.5-sonnet',
  codexModel: '', // ว่าง = ใช้โมเดลเริ่มต้นของ Codex (เช่น gpt-5.5)
}

// ดึงรายชื่อโมเดลทั้งหมดที่ OpenRouter รองรับ (ผ่าน proxy ของ server)
export async function fetchOpenRouterModels() {
  const res = await fetch(apiUrl('/api/openrouter-models'))
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
    return { provider: 'openrouter', model: c.openrouterModel, apiKey: c.openrouterApiKey }
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

const AI_API_BASE = (import.meta.env.VITE_AI_API_BASE || '').replace(/\/$/, '')
function apiUrl(path) {
  return `${AI_API_BASE}${path}`
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

// ตรวจตัวสะกด/รูปประโยคของ Verbatim (ไม่เปลี่ยนความหมาย)
// items = [{ i, text }] → คืน { fixes: [{ i, fixed, reason }] } เฉพาะรายการที่แก้
export async function aiSpellcheck(items) {
  return postJson('/api/ai-spellcheck', { items })
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
  const res = await fetch(apiUrl('/api/ai-group'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function postJson(url, body) {
  const res = await fetch(apiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ai: activeAiPayload }),
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
