import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ============================================================
// เรียก Claude CLI (ล็อกอินด้วย subscription บนเครื่อง) แบบ headless
// ให้ช่วยจัดกลุ่ม "รหัสคำตอบ" เป็น Net (หมวดหมู่) ตามความหมาย
//
// ⚠️ บน Windows: claude.exe ถอดรหัส stdin ตาม codepage ของ console
//    ถ้า process แม่ (vite) อยู่ใน console ที่ไม่ใช่ UTF-8 ภาษาไทยจะเพี้ยน
//    → บังคับ `chcp 65001` (UTF-8) ก่อนเรียก claude เพื่อให้ถอดรหัส stdin ถูกต้อง
// ============================================================

function resolveClaudeExe() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN
  if (process.platform === 'win32' && process.env.APPDATA) {
    const p = join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existsSync(p)) return p
  }
  return 'claude'
}

function buildPrompt(codes) {
  const lines = codes.map((c, i) => `${i} (x${c.count ?? 0}) ${c.text}`)
  return [
    'You are an expert at coding open-ended (OE) survey responses in Thai.',
    'Below is a list of answer "codes" (de-duplicated short answer texts), each with an index and a respondent count.',
    'Group these codes into Nets (thematic categories) by MEANING — not by spelling.',
    'Rules:',
    '- Every index must appear in EXACTLY ONE net.',
    '- Net names must be concise Thai labels describing the theme.',
    '- Aim for a sensible number of nets (roughly 3–15); merge closely-related codes, keep distinct themes apart.',
    '- Order nets and codes from most to least common when possible.',
    'Return ONLY a JSON object, no markdown fences, no prose:',
    '{"nets":[{"name":"<thai theme>","codeIndexes":[<indexes>]}]}',
    '',
    'Codes:',
    ...lines,
  ].join('\n')
}

function extractJson(text) {
  if (!text) throw new Error('empty model output')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in model output')
  return JSON.parse(text.slice(start, end + 1))
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

const SYSTEM_PROMPT =
  'You are a precise text classifier for coding Thai open-ended (OE) survey responses. ' +
  'You output only a single JSON object — no prose, no markdown.'

function spawnClaude(prompt, model, timeoutMs) {
  const exe = resolveClaudeExe()
  const useShell = exe === 'claude' // ใช้ shell เฉพาะตอน fallback (หา exe ตรง ๆ ไม่เจอ)

  // spawn .exe ตรง ๆ (ไม่ผ่าน cmd shell) → เร็วกว่ามาก และ stdin ภาษาไทยไม่เพี้ยน
  // ตัด overhead ของ Claude Code: แทน system prompt เป็นตัวเล็ก, ปิด tools/skills/MCP
  // (ใส่ flag เหล่านี้เฉพาะตอน spawn exe ตรง — ถ้าไป shell args ที่มีช่องว่าง/ค่าว่างจะเพี้ยน)
  const baseArgs = ['-p', '--output-format', 'json', '--model', model]
  const trimArgs = useShell
    ? []
    : [
        '--system-prompt', SYSTEM_PROMPT,
        '--tools', '',
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--exclude-dynamic-system-prompt-sections',
      ]
  const args = [...baseArgs, ...trimArgs]

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { shell: useShell, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude CLI หมดเวลา (timeout)'))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`เรียก claude ไม่สำเร็จ: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`claude ออกด้วยรหัส ${code}: ${err.slice(0, 300)}`))
      else resolve(out)
    })
    child.stdin.write(Buffer.from(prompt, 'utf8'))
    child.stdin.end()
  })
}

// ============================================================
// เรียก Codex CLI (OpenAI) แบบ headless ด้วย `codex exec`
//   - อ่าน prompt จาก stdin (ผ่าน '-') · เขียน "ข้อความสุดท้าย" ลงไฟล์ด้วย --output-last-message
//   - --sandbox read-only กัน codex ไปแก้ไฟล์ · --skip-git-repo-check รันนอก git repo ได้
//   - ใช้ subscription (ChatGPT) ที่ `codex login` ไว้บนเครื่อง — ไม่ต้องใช้ API key
// ============================================================
function resolveCodexExe() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN
  if (process.platform === 'win32' && process.env.APPDATA) {
    for (const name of ['codex.exe', 'codex.cmd']) {
      const p = join(process.env.APPDATA, 'npm', name)
      if (existsSync(p)) return p
    }
  }
  return 'codex'
}

function spawnCodex(prompt, model, timeoutMs) {
  const exe = resolveCodexExe()
  const useShell = !exe.toLowerCase().endsWith('.exe') // .cmd / 'codex' ต้องผ่าน shell บน Windows
  const outFile = join(tmpdir(), `codex-out-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`)

  // reasoning effort ต่ำ → เร็วขึ้น/ประหยัด token (งานเราเป็น classification ไม่ต้องคิดเยอะ)
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-c', 'model_reasoning_effort=low',
    '--output-last-message', outFile,
  ]
  if (model) args.push('-m', model)
  args.push('-') // อ่าน prompt จาก stdin

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { shell: useShell, windowsHide: true })
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Codex CLI หมดเวลา (timeout)'))
    }, timeoutMs)
    child.stderr.on('data', (d) => (err += d))
    child.stdout.on('data', () => {}) // ไม่ใช้ stream log — อ่านผลจากไฟล์ --output-last-message แทน
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`เรียก codex ไม่สำเร็จ: ${e.message} (ติดตั้ง/ล็อกอิน codex แล้วหรือยัง?)`))
    })
    child.on('close', async (code) => {
      clearTimeout(timer)
      try {
        const text = await readFile(outFile, 'utf8')
        unlink(outFile).catch(() => {})
        if (text.trim()) return resolve(text)
        reject(new Error(`codex ไม่มีผลลัพธ์ (exit ${code}): ${err.slice(0, 300)}`))
      } catch {
        reject(new Error(`อ่านผลลัพธ์ codex ไม่สำเร็จ (exit ${code}): ${err.slice(0, 300)}`))
      }
    })
    child.stdin.write(Buffer.from(prompt, 'utf8'))
    child.stdin.end()
  })
}

// ============================================================
// Provider abstraction: เรียกโมเดลแล้วคืน "ข้อความผลลัพธ์" (string) ไม่ว่าจะมาจาก
//   - claude     : Claude Code CLI (subscription บนเครื่อง)
//   - openrouter : OpenRouter Chat Completions API (ต้องมี apiKey + model id)
// ตัวเรียกแต่ละโหมด (runClaude*) ทำหน้าที่ build prompt + extract JSON เหมือนเดิม
// ============================================================
async function callOpenRouter(prompt, { model, apiKey, timeoutMs }) {
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า OpenRouter API key')
  if (!model) throw new Error('ยังไม่ได้เลือกโมเดล OpenRouter')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Codeframe Studio',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 300)}`)
    }
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text) throw new Error('OpenRouter ไม่มีผลลัพธ์กลับมา')
    return text
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('OpenRouter หมดเวลา (timeout)')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ดึงรายชื่อโมเดลทั้งหมดจาก OpenRouter (endpoint สาธารณะ ไม่ต้องใช้ API key)
export async function listOpenRouterModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`)
  const data = await res.json()
  const isFree = (m) => {
    if (/:free$/i.test(m.id || '')) return true
    const p = m.pricing || {}
    const zero = (v) => v == null || Number(v) === 0
    return zero(p.prompt) && zero(p.completion)
  }
  return (data?.data ?? [])
    .map((m) => ({ id: m.id, name: m.name || m.id, free: isFree(m) }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id))
}

// คืน "ข้อความผลลัพธ์" จากโมเดล · claudeDefault = alias ที่ใช้เมื่อไม่ได้ระบุ model (เฉพาะ claude)
async function callModel(prompt, { provider = 'claude', model, apiKey, timeoutMs = 300000 } = {}, claudeDefault = 'sonnet') {
  if (provider === 'openrouter') {
    return await callOpenRouter(prompt, { model, apiKey, timeoutMs })
  }
  if (provider === 'codex') {
    // codex exec ไม่มี --system-prompt → prepend system prompt เข้ากับ prompt
    return await spawnCodex(`${SYSTEM_PROMPT}\n\n${prompt}`, model, timeoutMs)
  }
  const out = await spawnClaude(prompt, model || claudeDefault, timeoutMs)
  const env = JSON.parse(out) // Claude CLI ห่อด้วย --output-format json
  if (env.is_error) throw new Error(env.result || 'model error')
  return env.result
}

export async function runClaudeGrouping(codes, opts = {}) {
  try {
    const text = await callModel(buildPrompt(codes), opts, 'sonnet')
    const grouping = extractJson(text)
    return normalizeGrouping(grouping, codes.length)
  } catch (e) {
    throw new Error(`จัดกลุ่มด้วย AI ไม่สำเร็จ: ${e.message}`)
  }
}

// ============================================================
// โหมด "coding ละเอียด": อ่าน verbatim ดิบ แล้วให้ Claude
//   1) สร้าง codeframe (codes + net)  2) จับแต่ละ verbatim เข้าได้ "หลายโค้ด"
// เหมาะกับคำตอบยาวที่มีหลายเหตุผลในประโยคเดียว (เช่น ไกลที่พัก + รพ.อื่นดีกว่า)
// verbatims = [{ text, count }] → คืน { codes:[{label,net}], assign:[[codeIdx,...], ...] }
// ============================================================
function buildCodingPrompt(verbatims) {
  const lines = verbatims.map((v, i) => `${i} (x${v.count ?? 0}) ${v.text}`)
  return [
    'You are an expert at coding open-ended (OE) survey responses in Thai.',
    'Build a codeframe AND assign each verbatim answer to one OR MORE codes.',
    '',
    'IMPORTANT: a single verbatim often contains MULTIPLE distinct reasons.',
    'Split compound answers and assign the verbatim to ALL codes that apply.',
    'Example: "บ้านอยู่ไกล เดินทางลำบาก และโรงพยาบาลอื่นบริการดีกว่า"',
    '  → assign to BOTH a [ระยะทาง/เดินทางไกล] code AND a [รพ.อื่นดีกว่า] code.',
    '',
    'Steps:',
    '1. Read every verbatim below (each has an index and a respondent count).',
    '2. Create a list of codes. Each code = ONE specific reason/idea, with a concise Thai label',
    '   and a Net (theme) name. Be granular — keep distinct reasons as separate codes.',
    '3. For each verbatim, list the indexes of ALL codes that apply (at least one).',
    '',
    'Rules:',
    '- Net names and code labels must be concise Thai.',
    '- "assign" MUST have exactly one array per verbatim, in the SAME ORDER as the input.',
    '- Code indexes in "assign" refer to positions in your "codes" array (0-based).',
    '- Aim for a sensible number of nets (roughly 3–15).',
    'Return ONLY a JSON object, no markdown fences, no prose:',
    '{"codes":[{"label":"<thai code text>","net":"<thai net name>"}],"assign":[[<codeIndex>,...]]}',
    '',
    'Verbatims:',
    ...lines,
  ].join('\n')
}

function normalizeCoding(parsed, verbatimCount) {
  const rawCodes = Array.isArray(parsed?.codes) ? parsed.codes : []
  const codes = rawCodes
    .map((c) => ({
      label: String(c?.label ?? c?.text ?? '').trim(),
      net: String(c?.net ?? c?.netName ?? 'อื่น ๆ').trim() || 'อื่น ๆ',
    }))
    .filter((c) => c.label)
  const codeCount = codes.length

  const rawAssign = Array.isArray(parsed?.assign) ? parsed.assign : []
  const assign = []
  for (let i = 0; i < verbatimCount; i++) {
    const entry = rawAssign[i]
    const idxs = (Array.isArray(entry) ? entry : entry == null ? [] : [entry])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < codeCount)
    assign.push([...new Set(idxs)])
  }
  return { codes, assign }
}

export async function runClaudeCoding(verbatims, opts = {}) {
  try {
    const text = await callModel(buildCodingPrompt(verbatims), opts, 'haiku')
    const parsed = extractJson(text)
    return normalizeCoding(parsed, verbatims.length)
  } catch (e) {
    throw new Error(`โค้ดดิ้งด้วย AI ไม่สำเร็จ: ${e.message}`)
  }
}

// ============================================================
// โหมด "รีวิว": รับโครงร่าง (draft) ที่สร้างด้วย rule แล้วให้ Claude ตรวจ/แก้
//   verbatims = [{ text, count, current: [<โค้ดเดิม>] }]
// คืนรูปแบบเดียวกับ coding: { codes:[{label,net}], assign:[[codeIdx,...]] }
// ============================================================
function buildReviewPrompt(verbatims) {
  const lines = verbatims.map((v, i) => {
    const cur = (v.current ?? []).filter(Boolean).join(' / ')
    return `${i} (x${v.count ?? 0}) [draft: ${cur || '—'}] ${v.text}`
  })
  return [
    'You are an expert at coding Thai open-ended (OE) survey responses.',
    'A rule-based system produced a DRAFT codeframe + assignments. REVIEW and CORRECT it.',
    'For each verbatim you are given its current draft code(s) in [draft: ...] — they may be wrong, duplicated, or incomplete.',
    '',
    'Your job:',
    '- Build a clean, DE-DUPLICATED codeframe: merge near-duplicate codes into one concise Thai label.',
    '- Organize codes under Nets (themes) with concise Thai net names.',
    '- A single verbatim often contains MULTIPLE distinct reasons → assign it to ALL applicable codes.',
    '- Fix wrong or missing assignments. Assign every verbatim that has clear meaning to at least one code.',
    '- Be granular: keep genuinely different reasons as separate codes, but do not create near-duplicates.',
    '',
    'Rules:',
    '- "assign" MUST have exactly one array per verbatim, in the SAME ORDER as the input.',
    '- Code indexes in "assign" refer to positions in your "codes" array (0-based).',
    'Return ONLY a JSON object, no markdown fences, no prose:',
    '{"codes":[{"label":"<thai code text>","net":"<thai net name>"}],"assign":[[<codeIndex>,...]]}',
    '',
    'Verbatims:',
    ...lines,
  ].join('\n')
}

export async function runClaudeReview(verbatims, opts = {}) {
  try {
    const text = await callModel(buildReviewPrompt(verbatims), opts, 'haiku')
    const parsed = extractJson(text)
    return normalizeCoding(parsed, verbatims.length)
  } catch (e) {
    throw new Error(`รีวิวด้วย AI ไม่สำเร็จ: ${e.message}`)
  }
}

// ============================================================
// โหมด "ตรวจตัวสะกด/รูปประโยค": รับข้อความ verbatim (มี index) ให้ Claude
//   แก้เฉพาะ "ตัวสะกด/วรรคตอน/รูปประโยค" ภาษาไทย โดย "ห้ามเปลี่ยนความหมาย"
// items = [{ i, text }] → คืน { fixes: [{ i, fixed, reason }] } เฉพาะรายการที่แก้จริง
// ============================================================
function buildSpellcheckPrompt(items) {
  const lines = items.map((it) => `${it.i}\t${it.text}`)
  return [
    'You are a meticulous Thai-language proofreader for open-ended survey responses.',
    'Correct spelling, typos, missing/extra characters, tone marks, punctuation, spacing,',
    'grammar, and awkward/unnatural sentence structure & word order.',
    'Be THOROUGH: actively look for and fix every error you can find — do not be overly conservative.',
    'Rules:',
    '- Preserve the MEANING and all information. Do NOT add new ideas or remove the writer\'s points.',
    '- Keep Thai as Thai. Keep numbers intact.',
    '- FIX clearly misspelled words EVEN inside place/hospital/brand names',
    '  (e.g. "โรงพยาบาน"→"โรงพยาบาล", "ศิรราช"→"ศิริราช", "จุฬาลงกรน์"→"จุฬาลงกรณ์").',
    '- NORMALIZE common loanword/transliteration spellings to the standard Thai Royal Institute form',
    '  (e.g. "คลีนิค"→"คลินิก", "อพาร์ทเม้นท์"→"อพาร์ตเมนต์", "เซ็นเตอร์"→"เซนเตอร์", "เมเนเจอร์"→"เมเนเจอร์").',
    '- Rewrite awkward or ungrammatical phrasing into natural, fluent Thai WITHOUT changing the meaning',
    '  or the respondent\'s tone (keep it concise; do not formalize casual speech beyond fixing errors).',
    '- A word/name that is already spelled correctly must be left EXACTLY as-is.',
    '- If a line is already fully correct and natural, OMIT it from the output entirely.',
    'Input below is tab-separated: <index>\\t<text>. Return corrected lines only.',
    'Return ONLY a JSON object, no markdown fences, no prose:',
    '{"fixes":[{"i":<index>,"fixed":"<corrected thai text>","reason":"<short thai note>"}]}',
    '',
    'Lines:',
    ...lines,
  ].join('\n')
}

function normalizeSpellcheck(parsed, validIndexes) {
  const fixes = []
  for (const f of parsed?.fixes ?? []) {
    const i = Number(f?.i)
    const fixed = String(f?.fixed ?? '').trim()
    if (Number.isInteger(i) && validIndexes.has(i) && fixed) {
      fixes.push({ i, fixed, reason: String(f?.reason ?? '').trim() })
    }
  }
  return { fixes }
}

// ============================================================
// โหมด "จับ verbatim เข้า code เดิม": มีโครง code อยู่แล้ว (จาก SPSS value labels)
//   ให้ Claude อ่าน verbatim 'อื่นๆ ระบุ' แล้วจับเข้า "รหัสที่มีอยู่" ที่ตรงความหมายที่สุด
//   ถ้าไม่มีรหัสไหนเข้ากันได้ → -1 (ปล่อยให้คนตัดสินใจ/สร้างรหัสใหม่เอง)
// codes = [{i,label}] · verbatims = [{i,text}] → คืน { assign: [<codeIndex|-1>, ...] } เรียงตาม verbatim
// ============================================================
function buildAssignPrompt(codes, verbatims) {
  const codeLines = codes.map((c) => `${c.i}: ${c.label}`)
  const vLines = verbatims.map((v) => `${v.i} (x${v.count ?? 0}) ${v.text}`)
  return [
    'You are an expert at coding Thai open-ended ("other, specify") survey responses.',
    'There is an EXISTING codeframe (fixed list of codes). For each verbatim answer,',
    'choose the index of the SINGLE existing code whose MEANING matches best.',
    'If no existing code reasonably fits the verbatim, output -1 for that verbatim.',
    'Match by meaning, not spelling. Do NOT invent new codes.',
    '',
    'Existing codes (index: label):',
    ...codeLines,
    '',
    'Verbatims (index (xcount) text):',
    ...vLines,
    '',
    '"assign" MUST have exactly one entry per verbatim, in the SAME ORDER as the input,',
    'each entry = the chosen code index (from the codes list) or -1.',
    'Return ONLY a JSON object, no markdown fences, no prose:',
    '{"assign":[<codeIndex or -1>, ...]}',
  ].join('\n')
}

function normalizeAssign(parsed, codeCount, verbatimCount) {
  const raw = Array.isArray(parsed?.assign) ? parsed.assign : []
  const assign = []
  for (let i = 0; i < verbatimCount; i++) {
    const n = Number(raw[i])
    assign.push(Number.isInteger(n) && n >= 0 && n < codeCount ? n : -1)
  }
  return { assign }
}

export async function runClaudeAssign(codes, verbatims, opts = {}) {
  try {
    const text = await callModel(buildAssignPrompt(codes, verbatims), { timeoutMs: 240000, ...opts }, 'haiku')
    const parsed = extractJson(text)
    return normalizeAssign(parsed, codes.length, verbatims.length)
  } catch (e) {
    throw new Error(`จับ verbatim เข้ารหัสด้วย AI ไม่สำเร็จ: ${e.message}`)
  }
}

// ============================================================
// โหมด "Group CE อัตโนมัติ": อ่าน Code ที่มีอยู่ + คำตอบ "อื่นๆ ระบุ" ที่ยังไม่จัด
//   - ถ้าความหมายตรงกับ Code เดิม → คืน index ของ Code นั้น (number)
//   - ถ้าไม่มี Code ไหนตรง → สร้างชื่อ Code ใหม่ (string) · ใช้ชื่อเดียวกันถ้าความหมายเดียวกัน
// codes = [{i,label}] · verbatims = [{i,text,count}] → คืน { assign: [<index|"new label">, ...] }
// ============================================================
function buildGroupCEPrompt(codes, verbatims) {
  const codeLines = codes.map((c) => `${c.i}: ${c.label}`)
  const vLines = verbatims.map((v) => `${v.i} (x${v.count ?? 0}) ${v.text}`)
  return [
    'You are an expert at coding Thai open-ended ("other, specify") survey responses.',
    'There is an EXISTING codeframe (a fixed list of codes). For EACH verbatim answer below, decide:',
    '- If its MEANING matches one of the existing codes → output that code INDEX (a number).',
    '- If NO existing code fits → CREATE a new concise Thai code label for it (output a STRING).',
    '  Use the SAME new label string for verbatims that mean the same thing (so they group together).',
    'Rules:',
    '- Match by MEANING, not spelling. Prefer reusing an existing code when reasonable.',
    '- New labels must be concise Thai (a brand/answer name), no quotes inside.',
    '',
    'Existing codes (index: label):',
    ...codeLines,
    '',
    'Verbatims (index (xcount) text):',
    ...vLines,
    '',
    '"assign" MUST have exactly one entry per verbatim, in the SAME ORDER as the input.',
    'Each entry = an existing code index (number) OR a new code label (string).',
    'Return ONLY a JSON object, no markdown fences, no prose:',
    '{"assign":[<index number or "new label">, ...]}',
  ].join('\n')
}

function normalizeGroupCE(parsed, codeCount, verbatimCount) {
  const raw = Array.isArray(parsed?.assign) ? parsed.assign : []
  const assign = []
  for (let i = 0; i < verbatimCount; i++) {
    const v = raw[i]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < codeCount) {
      assign.push({ existing: v })
    } else if (typeof v === 'string' && v.trim()) {
      assign.push({ neo: v.trim() })
    } else {
      assign.push(null)
    }
  }
  return { assign }
}

export async function runClaudeGroupCE(codes, verbatims, opts = {}) {
  try {
    const text = await callModel(buildGroupCEPrompt(codes, verbatims), opts, 'sonnet')
    const parsed = extractJson(text)
    return normalizeGroupCE(parsed, codes.length, verbatims.length)
  } catch (e) {
    throw new Error(`Group CE ด้วย AI ไม่สำเร็จ: ${e.message}`)
  }
}

export async function runClaudeSpellcheck(items, opts = {}) {
  try {
    const text = await callModel(buildSpellcheckPrompt(items), { timeoutMs: 240000, ...opts }, 'sonnet')
    const parsed = extractJson(text)
    return normalizeSpellcheck(parsed, new Set(items.map((it) => Number(it.i))))
  } catch (e) {
    throw new Error(`ตรวจตัวสะกดด้วย AI ไม่สำเร็จ: ${e.message}`)
  }
}
