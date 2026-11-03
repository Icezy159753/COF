// Characterization tests for src/lib/aiGroup.js — ล็อกพฤติกรรมปัจจุบันของทุก export
// - ไม่มี network จริง: stub globalThis.fetch ต่อเทสต์ (t.mock.method คืนค่าเดิมให้อัตโนมัติ)
// - ค่า env (VITE_AI_API_BASE / VITE_OPENROUTER_DIRECT_FALLBACK) ถูกอ่านตอนโหลดโมดูล จึงต้องโหลดโมดูลใหม่ต่อชุด env
//   หมายเหตุ: ตั้ง process.env แล้ว import ใหม่ "ไม่ได้ผล" เพราะ hook ของ tests/support/env-loader.mjs
//   รันใน loader thread แยก (เห็น process.env แค่ snapshot ตอนเริ่ม process) และ regex /\.(m?js)$/
//   ไม่ match URL ที่มี query string · จึงทำการแทนที่ import.meta.env แบบเดียวกับ env-loader เอง
//   แล้ว import ผ่าน data: URL (aiGroup.js ไม่มี import อื่น จึงโหลดแบบนี้ได้)
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const API_AUTH_URL = new URL('../src/lib/apiAuth.js', import.meta.url).href
const SOURCE = readFileSync(new URL('../src/lib/aiGroup.js', import.meta.url), 'utf8')

async function loadAi(tag, viteEnv = {}) {
  const env = { MODE: 'test', DEV: false, PROD: false, ...viteEnv }
  const code = `// case: ${tag}\n` + SOURCE.replaceAll('import.meta.env', `(${JSON.stringify(env)})`)
    // data: URL resolve relative import ไม่ได้ → ชี้ apiAuth.js ด้วย file URL (ใช้ instance เดียวกับเทสต์)
    .replaceAll("from './apiAuth.js'", `from '${API_AUTH_URL}'`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const textResponse = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/html' } })

// stub fetch ของเทสต์นี้ · เก็บ url/init/body(JSON) ทุกครั้งที่ถูกเรียก
function stubFetch(t, responder) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({
      url,
      init,
      method: init?.method,
      headers: init?.headers,
      rawBody: init?.body,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return responder(url, init)
  })
  return calls
}

const FAKE_KEY = 'sk-or-v1-FAKE-TEST-KEY-0000'

// ---------- โมดูลชุดต่าง ๆ ตาม env ----------
const ai = await loadAi('default') // ไม่มี base, ไม่เปิด direct fallback (ค่า production ปกติ)
const aiBase = await loadAi('base', { VITE_AI_API_BASE: 'https://runner.example.test/' })
const aiDirect = await loadAi('direct', { VITE_OPENROUTER_DIRECT_FALLBACK: '1' })
const aiDirectBase = await loadAi('directbase', {
  VITE_OPENROUTER_DIRECT_FALLBACK: '1',
  VITE_AI_API_BASE: 'https://runner.example.test',
})
const aiFlagTrue = await loadAi('flagtrue', { VITE_OPENROUTER_DIRECT_FALLBACK: 'true' })

const DIRECT_DISABLED = /OpenRouter direct mode is disabled; backend AI runner is required/

// export ที่ยิง POST ผ่าน postJson: [ชื่อ, args, path, body ที่คาดหวัง (ไม่รวม ai)]
const POST_CASES = [
  ['aiGroupCodes', [[{ text: 'ราคาแพง', count: 3 }]], '/api/ai-group', { codes: [{ text: 'ราคาแพง', count: 3 }] }],
  ['aiCodeAnswers', [[{ text: 'รสชาติดี ราคาถูก', count: 2 }]], '/api/ai-code', { verbatims: [{ text: 'รสชาติดี ราคาถูก', count: 2 }] }],
  [
    'aiReviewAnswers',
    [[{ text: 'ส่งช้า', count: 1, current: ['บริการ'] }]],
    '/api/ai-review',
    { verbatims: [{ text: 'ส่งช้า', count: 1, current: ['บริการ'] }] },
  ],
  ['aiSpellcheck', [[{ i: 0, text: 'อร่อยมากก' }], 'ชอบอะไร'], '/api/ai-spellcheck', { items: [{ i: 0, text: 'อร่อยมากก' }], question: 'ชอบอะไร' }],
  [
    'aiAssignToFrame',
    [[{ i: 0, label: 'ราคา' }], [{ i: 0, text: 'แพงไป', count: 4 }]],
    '/api/ai-assign',
    { codes: [{ i: 0, label: 'ราคา' }], verbatims: [{ i: 0, text: 'แพงไป', count: 4 }] },
  ],
  [
    'aiGroupCE',
    [[{ i: 0, label: 'ราคา' }], [{ i: 0, text: 'แพงไป', count: 4 }]],
    '/api/ai-group-ce',
    { codes: [{ i: 0, label: 'ราคา' }], verbatims: [{ i: 0, text: 'แพงไป', count: 4 }] },
  ],
]

describe('module loading', () => {
  test('real module (via tests/support env-loader) exposes the same API as the data: URL copies', async () => {
    const real = await import('../src/lib/aiGroup.js')
    assert.deepEqual(Object.keys(real).sort(), Object.keys(ai).sort())
    assert.deepEqual(real.AI_PROVIDERS, ai.AI_PROVIDERS)
    assert.deepEqual(real.DEFAULT_AI_CONFIG, ai.DEFAULT_AI_CONFIG)
  })

  test(
    'real module behaves like the default-env copy when no VITE_* AI vars are set',
    { skip: process.env.VITE_AI_API_BASE || process.env.VITE_OPENROUTER_DIRECT_FALLBACK ? 'VITE_* AI env set in shell' : false },
    async (t) => {
      const real = await import('../src/lib/aiGroup.js')
      assert.deepEqual(real.toAiPayload({ openrouterApiKey: FAKE_KEY }), ai.toAiPayload({ openrouterApiKey: FAKE_KEY }))
      const calls = stubFetch(t, () => jsonResponse({}))
      await real.aiGroupCodes([])
      assert.equal(calls[0].url, '/api/ai-group')
    },
  )
})

describe('constants', () => {
  test('AI_PROVIDERS lists the supported providers in order', () => {
    assert.deepEqual(ai.AI_PROVIDERS, ['claude', 'openrouter', 'codex', 'omniroute'])
  })

  test('DEFAULT_AI_CONFIG snapshot', () => {
    assert.deepEqual(ai.DEFAULT_AI_CONFIG, {
      provider: 'openrouter',
      claudeModel: 'sonnet',
      openrouterApiKey: '',
      openrouterModel: 'qwen/qwen3-235b-a22b-2507',
      codexModel: '',
      omnirouteModel: '',
    })
  })

  test('toAiPayload: omniroute sends only provider + model (key stays on the server)', () => {
    assert.deepEqual(ai.toAiPayload({ provider: 'omniroute', omnirouteModel: 'kr/claude-sonnet-4.5', openrouterApiKey: 'x' }), { provider: 'omniroute', model: 'kr/claude-sonnet-4.5' })
    assert.deepEqual(ai.toAiPayload({ provider: 'omniroute' }), { provider: 'omniroute', model: undefined })
  })

  test('DEFAULT_AI_CONFIG provider is one of AI_PROVIDERS', () => {
    assert.ok(ai.AI_PROVIDERS.includes(ai.DEFAULT_AI_CONFIG.provider))
  })
})

describe('toAiPayload (default env: no direct fallback)', () => {
  test('null / undefined / {} fall back to DEFAULT_AI_CONFIG (openrouter, no apiKey)', () => {
    const expected = { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507' }
    assert.deepEqual(ai.toAiPayload(), expected)
    assert.deepEqual(ai.toAiPayload(null), expected)
    assert.deepEqual(ai.toAiPayload({}), expected)
    assert.deepEqual(ai.toAiPayload(ai.DEFAULT_AI_CONFIG), expected)
  })

  test('openrouter never includes apiKey when direct fallback is off (key stays out of browser requests)', () => {
    const p = ai.toAiPayload({ provider: 'openrouter', openrouterModel: 'meta/llama-x', openrouterApiKey: FAKE_KEY })
    assert.deepEqual(p, { provider: 'openrouter', model: 'meta/llama-x' })
    assert.equal('apiKey' in p, false)
  })

  test('claude maps claudeModel → model and ignores other provider fields', () => {
    assert.deepEqual(ai.toAiPayload({ provider: 'claude', claudeModel: 'haiku', openrouterApiKey: FAKE_KEY }), {
      provider: 'claude',
      model: 'haiku',
    })
    assert.deepEqual(ai.toAiPayload({ provider: 'claude' }), { provider: 'claude', model: 'sonnet' })
  })

  test('codex maps codexModel → model; empty codexModel becomes undefined (server default)', () => {
    assert.deepEqual(ai.toAiPayload({ provider: 'codex', codexModel: 'gpt-x' }), { provider: 'codex', model: 'gpt-x' })
    const p = ai.toAiPayload({ provider: 'codex' })
    assert.equal(p.provider, 'codex')
    assert.ok('model' in p)
    assert.equal(p.model, undefined)
    assert.equal(JSON.stringify(p), '{"provider":"codex"}')
  })

  test('openrouter with empty model passes the empty string through', () => {
    assert.deepEqual(ai.toAiPayload({ provider: 'openrouter', openrouterModel: '' }), { provider: 'openrouter', model: '' })
  })

  test('unknown provider falls through to claude', () => {
    assert.deepEqual(ai.toAiPayload({ provider: 'gemini' }), { provider: 'claude', model: 'sonnet' })
    assert.deepEqual(ai.toAiPayload({ provider: '' }), { provider: 'claude', model: 'sonnet' })
  })

  test('explicit provider: undefined overrides the default and falls through to claude', () => {
    // spread ของ key ที่เป็น undefined ทับค่า default → ไม่ใช่ openrouter
    assert.deepEqual(ai.toAiPayload({ provider: undefined }), { provider: 'claude', model: 'sonnet' })
  })

  test('does not mutate the input config or DEFAULT_AI_CONFIG', () => {
    const cfg = { provider: 'codex', codexModel: '' }
    const snapshot = structuredClone(cfg)
    const defSnapshot = structuredClone(ai.DEFAULT_AI_CONFIG)
    ai.toAiPayload(cfg)
    assert.deepEqual(cfg, snapshot)
    assert.deepEqual(ai.DEFAULT_AI_CONFIG, defSnapshot)
  })

  test('VITE_OPENROUTER_DIRECT_FALLBACK other than "1" (e.g. "true") keeps apiKey out', () => {
    assert.deepEqual(aiFlagTrue.toAiPayload({ provider: 'openrouter', openrouterApiKey: FAKE_KEY }), {
      provider: 'openrouter',
      model: 'qwen/qwen3-235b-a22b-2507',
    })
  })
})

describe('toAiPayload (VITE_OPENROUTER_DIRECT_FALLBACK=1)', () => {
  test('openrouter includes apiKey (even the empty default)', () => {
    assert.deepEqual(aiDirect.toAiPayload({ provider: 'openrouter', openrouterApiKey: FAKE_KEY }), {
      provider: 'openrouter',
      model: 'qwen/qwen3-235b-a22b-2507',
      apiKey: FAKE_KEY,
    })
    assert.deepEqual(aiDirect.toAiPayload(), { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507', apiKey: '' })
  })

  test('claude / codex never carry apiKey', () => {
    assert.deepEqual(aiDirect.toAiPayload({ provider: 'claude', openrouterApiKey: FAKE_KEY }), { provider: 'claude', model: 'sonnet' })
    assert.deepEqual(aiDirect.toAiPayload({ provider: 'codex', codexModel: 'c1', openrouterApiKey: FAKE_KEY }), {
      provider: 'codex',
      model: 'c1',
    })
  })
})

describe('fetchOpenRouterModels', () => {
  test('GETs /api/openrouter-models (relative, auth headers only) and returns models', async (t) => {
    const models = [{ id: 'a/b', name: 'A B' }]
    const calls = stubFetch(t, () => jsonResponse({ models }))
    assert.deepEqual(await ai.fetchOpenRouterModels(), models)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/openrouter-models')
    assert.deepEqual(calls[0].init, { headers: {} }, 'no token provider set → no Authorization header')
  })

  test('prefixes VITE_AI_API_BASE with trailing slash stripped', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({ models: [] }))
    await aiBase.fetchOpenRouterModels()
    assert.equal(calls[0].url, 'https://runner.example.test/api/openrouter-models')
  })

  test('direct-fallback flag does not change the endpoint (always via proxy)', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({ models: [] }))
    await aiDirect.fetchOpenRouterModels()
    assert.equal(calls[0].url, '/api/openrouter-models')
  })

  test('missing / null models → []', async (t) => {
    stubFetch(t, () => jsonResponse({}))
    assert.deepEqual(await ai.fetchOpenRouterModels(), [])
    t.mock.restoreAll()
    stubFetch(t, () => jsonResponse({ models: null }))
    assert.deepEqual(await ai.fetchOpenRouterModels(), [])
  })

  test('HTTP error with JSON {error} → Error(error)', async (t) => {
    stubFetch(t, () => jsonResponse({ error: 'OpenRouter ล่ม' }, 503))
    await assert.rejects(ai.fetchOpenRouterModels(), { name: 'Error', message: 'OpenRouter ล่ม' })
  })

  test('HTTP error with non-JSON body → generic Thai message with status', async (t) => {
    stubFetch(t, () => textResponse('<html>bad gateway</html>', 502))
    await assert.rejects(ai.fetchOpenRouterModels(), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 502' })
  })

  test('HTTP error with JSON lacking / empty error → generic message', async (t) => {
    stubFetch(t, () => jsonResponse({ error: '' }, 500))
    await assert.rejects(ai.fetchOpenRouterModels(), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 500' })
  })

  test('success with malformed JSON → SyntaxError propagates', async (t) => {
    stubFetch(t, () => textResponse('{not json', 200))
    await assert.rejects(ai.fetchOpenRouterModels(), SyntaxError)
  })

  test('network failure propagates the original error', async (t) => {
    const boom = new TypeError('fetch failed')
    t.mock.method(globalThis, 'fetch', async () => {
      throw boom
    })
    await assert.rejects(ai.fetchOpenRouterModels(), (err) => err === boom)
  })
})

describe('postJson-based helpers (default env)', () => {
  // ทุกเทสต์เริ่ม/จบด้วย active payload = default
  test.beforeEach(() => ai.setActiveAiPayload(null))
  test.afterEach(() => ai.setActiveAiPayload(null))

  for (const [name, args, path, expectedBody] of POST_CASES) {
    test(`${name} POSTs JSON to ${path} with body + active ai payload and returns response JSON verbatim`, async (t) => {
      const reply = { anything: [1, 2], weird: { shape: true } }
      const calls = stubFetch(t, () => jsonResponse(reply))
      const result = await ai[name](...args)
      assert.deepEqual(result, reply) // ไม่มี normalize ฝั่ง client เมื่อผ่าน backend
      assert.equal(calls.length, 1)
      const c = calls[0]
      assert.equal(c.url, path)
      assert.equal(c.method, 'POST')
      assert.deepEqual(c.headers, { 'Content-Type': 'application/json' })
      assert.deepEqual(c.body, { ...expectedBody, ai: { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507' } })
    })
  }

  for (const [name, args, path] of POST_CASES) {
    test(`${name} is prefixed with VITE_AI_API_BASE`, async (t) => {
      const calls = stubFetch(t, () => jsonResponse({}))
      await aiBase[name](...args)
      assert.equal(calls[0].url, `https://runner.example.test${path}`)
    })
  }

  test('setActiveAiPayload changes the ai field attached to every request', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({ ok: 1 }))
    ai.setActiveAiPayload({ provider: 'claude', model: 'opus' })
    await ai.aiGroupCodes([])
    await ai.aiSpellcheck([])
    assert.deepEqual(calls[0].body.ai, { provider: 'claude', model: 'opus' })
    assert.deepEqual(calls[1].body.ai, { provider: 'claude', model: 'opus' })
  })

  test('setActiveAiPayload(null/undefined) resets to the default payload', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    ai.setActiveAiPayload({ provider: 'codex', model: 'c' })
    ai.setActiveAiPayload(undefined)
    await ai.aiGroupCodes([])
    assert.deepEqual(calls[0].body.ai, { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507' })
  })

  test('setActiveAiPayload stores the payload as-is (no validation, extra fields forwarded)', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    ai.setActiveAiPayload({ provider: 'mystery', model: 7, extra: 'x' })
    await ai.aiCodeAnswers([])
    assert.deepEqual(calls[0].body.ai, { provider: 'mystery', model: 7, extra: 'x' })
  })

  test('active payload is read at call time, not at module load', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    const p1 = ai.aiGroupCodes([])
    ai.setActiveAiPayload({ provider: 'claude', model: 'haiku' })
    await p1
    await ai.aiGroupCodes([])
    assert.equal(calls[0].body.ai.provider, 'openrouter')
    assert.equal(calls[1].body.ai.provider, 'claude')
  })

  test('OpenRouter API key from config is not sent from the browser (no apiKey, no Authorization header)', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    ai.setActiveAiPayload(ai.toAiPayload({ provider: 'openrouter', openrouterApiKey: FAKE_KEY }))
    for (const [name, args] of POST_CASES) await ai[name](...args)
    assert.equal(calls.length, POST_CASES.length)
    for (const c of calls) {
      assert.equal(c.rawBody.includes(FAKE_KEY), false)
      assert.equal('apiKey' in c.body.ai, false)
      assert.deepEqual(Object.keys(c.headers), ['Content-Type'])
      assert.ok(!/^https?:\/\/openrouter\.ai/.test(c.url))
    }
  })

  test('undefined arguments are dropped by JSON.stringify (body only has ai)', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    await ai.aiGroupCodes(undefined)
    await ai.aiAssignToFrame(undefined, undefined)
    assert.deepEqual(Object.keys(calls[0].body), ['ai'])
    assert.deepEqual(Object.keys(calls[1].body), ['ai'])
  })

  test('HTTP error with JSON {error} → Error(error)', async (t) => {
    stubFetch(t, () => jsonResponse({ error: 'AI runner timeout' }, 504))
    await assert.rejects(ai.aiGroupCE([], []), { name: 'Error', message: 'AI runner timeout' })
  })

  test('HTTP error with HTML body → generic message with status', async (t) => {
    stubFetch(t, () => textResponse('<!doctype html><title>404</title>', 404))
    await assert.rejects(ai.aiAssignToFrame([], []), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 404' })
  })

  test('HTTP error with JSON but no error field → generic message', async (t) => {
    stubFetch(t, () => jsonResponse({ detail: 'nope' }, 400))
    await assert.rejects(ai.aiReviewAnswers([]), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 400' })
  })

  test('HTTP error with empty body → generic message', async (t) => {
    stubFetch(t, () => new Response(null, { status: 500 }))
    await assert.rejects(ai.aiSpellcheck([]), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 500' })
  })

  test('success with malformed JSON → SyntaxError propagates', async (t) => {
    stubFetch(t, () => textResponse('model said: {oops', 200))
    await assert.rejects(ai.aiCodeAnswers([]), SyntaxError)
  })

  test('network failure propagates the original error', async (t) => {
    const boom = new TypeError('fetch failed')
    t.mock.method(globalThis, 'fetch', async () => {
      throw boom
    })
    await assert.rejects(ai.aiGroupCodes([]), (err) => err === boom)
  })
})

describe('postJson-based helpers (VITE_OPENROUTER_DIRECT_FALLBACK=1, no base)', () => {
  test.beforeEach(() => aiDirect.setActiveAiPayload(null))
  test.afterEach(() => aiDirect.setActiveAiPayload(null))

  for (const [name, args] of POST_CASES) {
    test(`${name} with openrouter payload rejects (direct mode disabled) without calling fetch`, async (t) => {
      const calls = stubFetch(t, () => jsonResponse({}))
      await assert.rejects(aiDirect[name](...args), DIRECT_DISABLED)
      assert.equal(calls.length, 0)
    })
  }

  test('default active payload (openrouter) also takes the direct path → rejects', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    await assert.rejects(aiDirect.aiGroupCodes([{ text: 'x', count: 1 }]), DIRECT_DISABLED)
    assert.equal(calls.length, 0)
  })

  test('non-openrouter providers still go through the backend', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({ nets: [] }))
    aiDirect.setActiveAiPayload({ provider: 'claude', model: 'sonnet' })
    assert.deepEqual(await aiDirect.aiGroupCodes([]), { nets: [] })
    assert.equal(calls[0].url, '/api/ai-group')
    assert.deepEqual(calls[0].body.ai, { provider: 'claude', model: 'sonnet' })
  })

  test('setActiveAiPayload(null) payload is openrouter → direct path', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    aiDirect.setActiveAiPayload({ provider: 'codex' })
    aiDirect.setActiveAiPayload(null)
    await assert.rejects(aiDirect.aiSpellcheck([]), DIRECT_DISABLED)
    assert.equal(calls.length, 0)
  })
})

describe('postJson-based helpers (VITE_OPENROUTER_DIRECT_FALLBACK=1 + VITE_AI_API_BASE)', () => {
  test.afterEach(() => aiDirectBase.setActiveAiPayload(null))

  test('base URL wins over direct mode: openrouter goes to the backend and apiKey is forwarded to it', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({ assign: [] }))
    aiDirectBase.setActiveAiPayload(aiDirectBase.toAiPayload({ provider: 'openrouter', openrouterApiKey: FAKE_KEY }))
    await aiDirectBase.aiAssignToFrame([], [])
    assert.equal(calls[0].url, 'https://runner.example.test/api/ai-assign')
    assert.deepEqual(calls[0].body.ai, { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507', apiKey: FAKE_KEY })
  })
})

describe('aiTestConnection', () => {
  const TEST_CODES = [{ text: 'ทดสอบการเชื่อมต่อ', count: 1 }]

  test('POSTs a dummy code to /api/ai-group with the GIVEN payload (not the active one)', async (t) => {
    ai.setActiveAiPayload({ provider: 'claude', model: 'opus' })
    t.after(() => ai.setActiveAiPayload(null))
    const calls = stubFetch(t, () => jsonResponse({ nets: [{ name: 'ทดสอบ', codeIndexes: [0] }] }))
    const payload = { provider: 'codex', model: 'gpt-x' }
    const result = await ai.aiTestConnection(payload)
    assert.deepEqual(result, { nets: [{ name: 'ทดสอบ', codeIndexes: [0] }] })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/ai-group')
    assert.equal(calls[0].method, 'POST')
    assert.deepEqual(calls[0].headers, { 'Content-Type': 'application/json' })
    assert.deepEqual(calls[0].body, { codes: TEST_CODES, ai: payload })
  })

  test('undefined payload → ai omitted from body', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    await ai.aiTestConnection()
    assert.deepEqual(calls[0].body, { codes: TEST_CODES })
  })

  test('openrouter payload in default env goes to backend; payload forwarded verbatim', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({ ok: true }))
    const payload = ai.toAiPayload({ provider: 'openrouter', openrouterApiKey: FAKE_KEY })
    await ai.aiTestConnection(payload)
    assert.deepEqual(calls[0].body.ai, { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507' })
    assert.equal(calls[0].rawBody.includes(FAKE_KEY), false)
  })

  test('prefixes VITE_AI_API_BASE', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    await aiBase.aiTestConnection({ provider: 'claude', model: 'sonnet' })
    assert.equal(calls[0].url, 'https://runner.example.test/api/ai-group')
  })

  test('HTTP error with {error} → Error(error)', async (t) => {
    stubFetch(t, () => jsonResponse({ error: 'Invalid model' }, 400))
    await assert.rejects(ai.aiTestConnection({ provider: 'claude', model: 'x' }), { message: 'Invalid model' })
  })

  test('HTTP error with non-JSON → generic message', async (t) => {
    stubFetch(t, () => textResponse('Service Unavailable', 503))
    await assert.rejects(ai.aiTestConnection({ provider: 'claude' }), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 503' })
  })

  test('success with malformed JSON → SyntaxError', async (t) => {
    stubFetch(t, () => textResponse('<html>', 200))
    await assert.rejects(ai.aiTestConnection({ provider: 'claude' }), SyntaxError)
  })

  test('network failure propagates the original error', async (t) => {
    const boom = new Error('ECONNREFUSED')
    t.mock.method(globalThis, 'fetch', async () => {
      throw boom
    })
    await assert.rejects(ai.aiTestConnection({ provider: 'claude' }), (err) => err === boom)
  })

  test('direct mode (flag=1, no base) + openrouter payload → rejects without fetch', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    await assert.rejects(aiDirect.aiTestConnection({ provider: 'openrouter', model: 'm', apiKey: FAKE_KEY }), DIRECT_DISABLED)
    assert.equal(calls.length, 0)
  })

  test('direct mode + non-openrouter / missing payload → backend', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    await aiDirect.aiTestConnection({ provider: 'claude', model: 'haiku' })
    await aiDirect.aiTestConnection(undefined)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, '/api/ai-group')
    assert.deepEqual(calls[0].body.ai, { provider: 'claude', model: 'haiku' })
    assert.deepEqual(calls[1].body, { codes: TEST_CODES })
  })

  test('direct flag + base → openrouter goes to backend', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({}))
    await aiDirectBase.aiTestConnection({ provider: 'openrouter', model: 'm', apiKey: FAKE_KEY })
    assert.equal(calls[0].url, 'https://runner.example.test/api/ai-group')
    assert.equal(calls[0].body.ai.apiKey, FAKE_KEY)
  })
})


// ---------- Firebase ID token ถูกแนบไปกับทุก request ที่ไป AI backend (security fix 2026-11) ----------
describe('Authorization header from apiAuth token provider', () => {
  test('attached to GET and every POST helper when a provider is set; never the OpenRouter key', async (t) => {
    const apiAuth = await import(API_AUTH_URL)
    apiAuth.setApiTokenProvider(async () => 'id-token-123')
    t.after(() => apiAuth.setApiTokenProvider(null))
    const calls = stubFetch(t, () => jsonResponse({ models: [], nets: [] }))
    await ai.fetchOpenRouterModels()
    for (const [name, args] of POST_CASES) await ai[name](...args)
    await ai.aiTestConnection({ provider: 'claude' })
    assert.ok(calls.length >= POST_CASES.length + 2)
    for (const c of calls) {
      assert.equal(c.headers.Authorization, 'Bearer id-token-123', c.url)
      assert.ok(!JSON.stringify(c.headers).includes(FAKE_KEY))
    }
    assert.equal(calls[1].headers['Content-Type'], 'application/json')
  })

  test('a failing or empty provider sends no Authorization header instead of throwing', async (t) => {
    const apiAuth = await import(API_AUTH_URL)
    t.after(() => apiAuth.setApiTokenProvider(null))
    for (const provider of [async () => { throw new Error('signed out') }, () => null, async () => '']) {
      apiAuth.setApiTokenProvider(provider)
      const calls = stubFetch(t, () => jsonResponse({ nets: [] }))
      await ai.aiGroupCodes([{ text: 'x' }])
      assert.equal(calls.at(-1).headers.Authorization, undefined)
      t.mock.restoreAll()
    }
  })
})
