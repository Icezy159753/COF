// Characterization tests for scripts/ai-runner.mjs
// ไฟล์นี้ listen port + อ่าน secret ตอน import → ห้าม import ตรง ๆ
// เลยโหลด source ผ่าน vm.compileFunction แล้ว inject http/fs/execFile/fetch/process ปลอม:
//   - http.createServer ปลอม: เก็บ request handler ไว้ทดสอบด้วย req/res ปลอม (ไม่เปิด port)
//   - existsSync/readFileSync ปลอม: ไม่แตะ .openrouter.env จริง
//   - execFile (curl → Resend) ปลอม, fetch (OpenRouter) ปลอม, setTimeout ปลอม
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { createVerify, generateKeyPairSync, createSign } from 'node:crypto'

const SOURCE_URL = new URL('../scripts/ai-runner.mjs', import.meta.url)
const SOURCE = fs.readFileSync(SOURCE_URL, 'utf8')
const FAKE_ENV_FILE = '/nonexistent/test/.openrouter.env'
const REVIEW_URL = 'https://codeframe-dp.web.app/#/review/tok123'
const CONFIRM_TOKEN = 'mh1a2b3cd4e5f6'
const CONFIRM_URL = `https://codeframe-dp.web.app/#/review/${CONFIRM_TOKEN}`
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/codeframe-dbd8d/databases/(default)/documents'
// Firestore REST ปลอมสำหรับ review_links/{token}
function reviewLinkFetch({ status = 'active', editEmail = 'edit@x.io', httpStatus = 200 } = {}) {
  return (url) => {
    if (!String(url).startsWith(`${FIRESTORE}/review_links/`)) throw new Error(`test: unexpected fetch ${url}`)
    if (httpStatus !== 200) return { ok: false, status: httpStatus, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ fields: { status: { stringValue: status }, emailInvite: { mapValue: { fields: { editEmail: { stringValue: editEmail } } } } } }) }
  }
}

const EXPORTS = [
  'handleGroup', 'handleCode', 'handleReview', 'handleSpellcheck', 'handleAssign', 'handleGroupCE',
  'callOpenRouter', 'loadSecret', 'loadEnvValue', 'isEmail', 'parseEmailList', 'escHtml', 'extractJson',
  'normalizeGroup', 'normalizeCoding', 'simplifyThaiLabel', 'firstMeaningfulToken', 'normalizeClusterKey',
  'levenshtein', 'closeEnoughKey', 'isNonAnswerText', 'fallbackGroupCEAssign', 'corsOrigin', 'send',
  'readBody', 'readRawBody', 'parseSavBuffer', 'sendCiConfirmEmail', 'sendCiReviewEmail',
  'listOpenRouterModels', 'ROUTES', 'ALLOWED_ORIGINS', 'PORT', 'DEFAULT_MODEL', 'TIMEOUT_MS', 'ENV_FILE',
  'SYSTEM_PROMPT', 'DEFAULT_RESEND_FROM',
]

// auth: false (ค่าเริ่ม) → ปิดการตรวจ token เพื่อทดสอบ logic อื่น · auth: true → ทดสอบระบบยืนยันตัวตนจริง
function loadRunner({ env = { OPENROUTER_API_KEY: 'backend-key', OPENROUTER_ENV_FILE: FAKE_ENV_FILE }, auth = false, files = {}, fetchImpl, curlImpl } = {}) {
  env = auth ? env : { AI_RUNNER_REQUIRE_AUTH: '0', ...env }
  let src = SOURCE.replace(/^#!.*\n/, '')
  assert.equal((src.match(/^import .*$/gm) || []).length, 6, 'ai-runner.mjs import list changed — update the test loader')
  src = src.replace(/^import .*$/gm, '').replace(/import\.meta\.url/g, '__importMetaUrl')
  src += `\nreturn { ${EXPORTS.join(', ')}, verifyFirebaseIdToken, loadActiveReviewLink, REQUIRE_AUTH }`

  const state = { server: null, listen: null, fetchCalls: [], curlCalls: [], existsCalls: [], readCalls: [], timers: [], errors: [] }
  const http = {
    createServer(handler) {
      state.server = handler
      return { listen: (port, host, cb) => { state.listen = { port, host, cb } } }
    },
  }
  const existsSync = (p) => { state.existsCalls.push(p); return Object.hasOwn(files, p) }
  const readFileSync = (p) => {
    state.readCalls.push(p)
    if (!Object.hasOwn(files, p)) throw new Error(`test: unexpected read of ${p}`)
    return files[p]
  }
  const execFileAsync = async (file, args, opts) => {
    state.curlCalls.push({ file, args, opts })
    if (!curlImpl) throw new Error('test: curl not stubbed')
    return curlImpl(file, args, opts)
  }
  const fetch = async (url, init) => {
    state.fetchCalls.push({ url, init })
    if (!fetchImpl) throw new Error('test: fetch not stubbed')
    return fetchImpl(url, init, state.fetchCalls.length)
  }
  const silentConsole = { log() {}, error: (e) => state.errors.push(e), warn() {} }
  const mod = vm.compileFunction(src, [
    'http', 'readFileSync', 'existsSync', 'execFile', 'promisify', 'createRequire', '__importMetaUrl',
    'process', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'createVerify',
  ])(
    http, readFileSync, existsSync, () => {}, () => execFileAsync, createRequire, SOURCE_URL.href,
    { env }, fetch, silentConsole,
    (cb, ms) => { const t = { cb, ms, cleared: false }; state.timers.push(t); return t },
    (t) => { if (t) t.cleared = true },
    createVerify,
  )
  return { mod, state }
}

// ---------- fake HTTP plumbing ----------
function okJson(data) { return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } }
function chat(content) { return okJson({ choices: [{ message: { content } }] }) }
function httpErr(status, body = '') { return { ok: false, status, text: async () => body } }

function fakeReq({ method = 'POST', url = '/', headers = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:8787', ...headers }
  req.destroyed = false
  req.destroy = () => { req.destroyed = true }
  return req
}
function fakeRes() {
  const res = { status: null, headers: null, body: null }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.end = (body) => { res.body = body }
  res.json = () => JSON.parse(res.body)
  return res
}
async function request(state, { method = 'POST', url, headers, body } = {}) {
  const req = fakeReq({ method, url, headers })
  const res = fakeRes()
  const done = state.server(req, res)
  // เหมือน stream จริงของ Node: ข้อมูลรอจนกว่าจะมีตัวอ่าน (handler ตรวจสิทธิ์แบบ async ก่อนค่อยอ่าน body)
  let settled = false
  done.finally(() => { settled = true })
  for (let i = 0; i < 200 && !settled && req.listenerCount('end') === 0; i++) await new Promise((r) => setImmediate(r))
  if (body !== undefined) req.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
  req.emit('end')
  await done
  return res
}

// ---------- synthetic .sav (same layout as tests/server-sav-codebook.test.mjs) ----------
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b }
const f64 = (n) => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b }
const fixedStr = (s, len) => { const b = Buffer.alloc(len, 0x20); Buffer.from(s, 'utf8').copy(b); return b }
const padTo = (buf, m) => Buffer.concat([buf, Buffer.alloc((m - (buf.length % m)) % m, 0x20)])
function tinySav() {
  const header = Buffer.concat([Buffer.from('$FL2'), fixedStr('synthetic', 60), i32(2), i32(-1), i32(0), i32(0), i32(0), f64(100), fixedStr('01 Jan 26', 9), fixedStr('00:00:00', 8), fixedStr('', 64), Buffer.alloc(3)])
  const label = Buffer.from('ยี่ห้อ', 'utf8')
  const v = Buffer.concat([i32(2), i32(0), i32(1), i32(0), i32(0x050802), i32(0x050802), fixedStr('Q1', 8), i32(label.length), padTo(label, 4)])
  const vlLabel = Buffer.from('ก', 'utf8')
  const vl = Buffer.concat([i32(3), i32(1), f64(1), padTo(Buffer.concat([Buffer.from([vlLabel.length]), vlLabel]), 8), i32(4), i32(1), i32(1)])
  return Buffer.concat([header, v, vl, i32(999), i32(0)])
}

// ============================================================
// Module wiring / startup
// ============================================================

test('startup: listens on 127.0.0.1 only, default port 8787; env overrides PORT/model/timeout', () => {
  const { mod, state } = loadRunner()
  assert.deepEqual([state.listen.port, state.listen.host], [8787, '127.0.0.1'])
  assert.equal(mod.DEFAULT_MODEL, 'qwen/qwen3-235b-a22b-2507')
  assert.equal(mod.TIMEOUT_MS, 240000)
  const custom = loadRunner({ env: { PORT: '9999', OPENROUTER_MODEL: 'x/y', OPENROUTER_TIMEOUT_MS: '5000', OPENROUTER_ENV_FILE: FAKE_ENV_FILE } })
  assert.deepEqual([custom.state.listen.port, custom.state.listen.host], [9999, '127.0.0.1'])
  assert.equal(custom.mod.DEFAULT_MODEL, 'x/y')
  assert.equal(custom.mod.TIMEOUT_MS, 5000)
})

test('startup: default secret file path and AI route table', () => {
  const { mod } = loadRunner({ env: {} })
  assert.equal(mod.ENV_FILE, '/home/horari/projects/COF/.openrouter.env')
  assert.deepEqual([...mod.ROUTES.keys()], ['/api/ai-group', '/api/ai-code', '/api/ai-review', '/api/ai-spellcheck', '/api/ai-assign', '/api/ai-group-ce'])
})

test('startup: does not read secrets at import time', () => {
  const { state } = loadRunner({ env: {} })
  assert.deepEqual(state.existsCalls, [])
  assert.deepEqual(state.readCalls, [])
})

// ============================================================
// Secrets
// ============================================================

test('loadSecret / loadEnvValue: process.env wins; else parsed from env file with quotes stripped; else empty', () => {
  const files = { [FAKE_ENV_FILE]: '# comment\nOPENROUTER_API_KEY="file-key"\nRESEND_API_KEY=\'re_123\'\nRESEND_FROM=Team <t@x.io>\n' }
  let { mod, state } = loadRunner({ env: { OPENROUTER_ENV_FILE: FAKE_ENV_FILE }, files })
  assert.equal(mod.loadSecret(), 'file-key')
  assert.equal(mod.loadEnvValue('RESEND_API_KEY'), 're_123')
  assert.equal(mod.loadEnvValue('RESEND_FROM'), 'Team <t@x.io>')
  assert.equal(mod.loadEnvValue('MISSING'), '')
  assert.ok(state.readCalls.every((p) => p === FAKE_ENV_FILE))
  ;({ mod } = loadRunner({ env: { OPENROUTER_ENV_FILE: FAKE_ENV_FILE, OPENROUTER_API_KEY: 'env-key' }, files }))
  assert.equal(mod.loadSecret(), 'env-key')
  ;({ mod } = loadRunner({ env: { OPENROUTER_ENV_FILE: FAKE_ENV_FILE } }))
  assert.equal(mod.loadSecret(), '')
  assert.equal(mod.loadEnvValue('RESEND_API_KEY'), '')
})

// ============================================================
// HTTP handler: CORS, health, routing
// ============================================================

test('CORS: allow-listed origins are echoed, others get the production origin', async () => {
  const { mod, state } = loadRunner()
  for (const origin of mod.ALLOWED_ORIGINS) {
    const res = await request(state, { method: 'OPTIONS', url: '/api/ai-group', headers: { origin } })
    assert.equal(res.headers['Access-Control-Allow-Origin'], origin)
  }
  assert.deepEqual([...mod.ALLOWED_ORIGINS], [
    'https://codeframe-dp.web.app', 'https://codeframe-dp.firebaseapp.com',
    'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174',
  ])
  const evil = await request(state, { method: 'OPTIONS', url: '/x', headers: { origin: 'https://evil.example', 'access-control-request-headers': 'X-Custom' } })
  assert.equal(evil.status, 204)
  assert.equal(evil.body, '')
  assert.equal(evil.headers['Access-Control-Allow-Origin'], 'https://codeframe-dp.web.app')
  assert.equal(evil.headers['Access-Control-Allow-Headers'], 'X-Custom')
  assert.equal(evil.headers['Access-Control-Allow-Methods'], 'GET,POST,OPTIONS')
  assert.equal(evil.headers.Vary, 'Origin')
})

test('send(): JSON body with UTF-8 byte Content-Length', () => {
  const { mod } = loadRunner()
  const res = fakeRes()
  mod.send(res, 200, { t: 'ไทย' })
  assert.equal(res.body, '{"t":"ไทย"}')
  assert.equal(res.headers['Content-Length'], Buffer.byteLength('{"t":"ไทย"}'))
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
})

test('GET /health reports config without leaking the key', async () => {
  const { state } = loadRunner()
  const res = await request(state, { method: 'GET', url: '/health' })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json(), { ok: true, provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507', keyConfigured: true, authRequired: false })
  assert.ok(!res.body.includes('backend-key'))
  const noKey = loadRunner({ env: { OPENROUTER_ENV_FILE: FAKE_ENV_FILE } })
  assert.equal((await request(noKey.state, { method: 'GET', url: '/health' })).json().keyConfigured, false)
})

test('routing: unknown paths and GET on AI routes are 404', async () => {
  const { state } = loadRunner()
  for (const [method, url] of [['GET', '/api/ai-group'], ['POST', '/nope'], ['PUT', '/api/ai-code'], ['GET', '/']]) {
    const res = await request(state, { method, url })
    assert.equal(res.status, 404, `${method} ${url}`)
    assert.deepEqual(res.json(), { error: 'Not found' })
  }
})

test('GET /api/openrouter-models: public model list wrapped in {models}; errors -> 500', async () => {
  let { state } = loadRunner({ fetchImpl: () => okJson({ data: [{ id: 'b/x', pricing: { prompt: '1', completion: '1' } }, { id: 'a/y:free' }] }) })
  let res = await request(state, { method: 'GET', url: '/api/openrouter-models' })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json(), { models: [{ id: 'a/y:free', name: 'a/y:free', free: true }, { id: 'b/x', name: 'b/x', free: false }] })
  assert.equal(state.fetchCalls[0].url, 'https://openrouter.ai/api/v1/models')
  ;({ state } = loadRunner({ fetchImpl: () => httpErr(502) }))
  res = await request(state, { method: 'GET', url: '/api/openrouter-models' })
  assert.equal(res.status, 500)
  assert.deepEqual(res.json(), { error: 'OpenRouter HTTP 502' })
})

test('AI routes ignore client-supplied apiKey; backend secret is the only credential', async () => {
  const { state } = loadRunner({ fetchImpl: () => chat('{"nets":[{"name":"n","codeIndexes":[0]}]}') })
  const res = await request(state, {
    url: '/api/ai-group',
    body: { codes: [{ text: 'a' }], ai: { apiKey: 'client-key', model: 'client/model' } },
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json(), { nets: [{ name: 'n', codeIndexes: [0] }] })
  const { init } = state.fetchCalls[0]
  assert.equal(init.headers.Authorization, 'Bearer backend-key')
  assert.ok(!init.body.includes('client-key'))
  assert.equal(JSON.parse(init.body).model, 'client/model', 'client may still choose the model')
  assert.match(SOURCE, /if \(body\.ai\) delete body\.ai\.apiKey/)
})

test('AI routes: validation errors are returned as 500 with the Thai message', async () => {
  const { state } = loadRunner()
  const cases = [
    ['/api/ai-group', {}, 'ไม่มีรหัสให้จัดกลุ่ม'],
    ['/api/ai-group', { codes: [] }, 'ไม่มีรหัสให้จัดกลุ่ม'],
    ['/api/ai-code', { verbatims: [] }, 'ไม่มีคำตอบให้โค้ดดิ้ง'],
    ['/api/ai-review', {}, 'ไม่มีคำตอบให้โค้ดดิ้ง'],
    ['/api/ai-spellcheck', { items: 'x' }, 'ไม่มีข้อความให้ตรวจ'],
    ['/api/ai-assign', { verbatims: [{}] }, 'ต้องมีทั้งรหัสและคำตอบ'],
    ['/api/ai-group-ce', { codes: [], verbatims: [] }, 'ต้องมีรหัสและคำตอบ'],
  ]
  for (const [url, body, error] of cases) {
    const res = await request(state, { url, body })
    assert.equal(res.status, 500, url)
    assert.deepEqual(res.json(), { error }, url)
  }
  assert.equal(state.fetchCalls.length, 0)
})

test('AI routes: empty body is treated as {}', async () => {
  const { state } = loadRunner()
  const res = await request(state, { url: '/api/ai-group' })
  assert.deepEqual([res.status, res.json()], [500, { error: 'ไม่มีรหัสให้จัดกลุ่ม' }])
})

test('AI routes: malformed JSON body returns 400 instead of crashing the runner', async () => {
  const { state } = loadRunner()
  for (const body of ['{not json', '[1,2]', '"str"', 'null']) {
    const res = await request(state, { url: '/api/ai-group', body })
    assert.equal(res.status, 400, `body ${body}`)
    assert.match(res.json().error, /JSON ไม่ถูกต้อง/)
  }
  assert.equal(state.fetchCalls.length, 0)
})

test('readBody: bodies over 10MB are rejected', async () => {
  const { mod } = loadRunner()
  const req = fakeReq()
  const p = mod.readBody(req)
  req.emit('data', 'x'.repeat(10_000_001))
  await assert.rejects(p, { message: 'Request too large' })
})

// ============================================================
// /api/parse-sav
// ============================================================

test('POST /api/parse-sav: parses a synthetic .sav body', async () => {
  const { state } = loadRunner()
  const res = await request(state, { url: '/api/parse-sav', body: tinySav() })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json(), { byVar: { Q1: { label: 'ยี่ห้อ', type: 'numeric', values: [{ value: 1, label: 'ก' }] } }, varCount: 1 })
})

test('POST /api/parse-sav: empty -> 400; invalid/truncated -> 500 with reason', async () => {
  const { state } = loadRunner()
  let res = await request(state, { url: '/api/parse-sav' })
  assert.deepEqual([res.status, res.json()], [400, { error: 'ไม่มีไฟล์ .sav' }])
  res = await request(state, { url: '/api/parse-sav', body: Buffer.from('PK\u0003\u0004 zip not sav') })
  assert.equal(res.status, 500)
  assert.match(res.json().error, /^อ่านไฟล์ \.sav ไม่สำเร็จ: Not a valid \.sav file:/)
  res = await request(state, { url: '/api/parse-sav', body: tinySav().subarray(0, 50) })
  assert.equal(res.status, 500)
  assert.match(res.json().error, /^อ่านไฟล์ \.sav ไม่สำเร็จ: No data read/, 'string rejections are stringified')
})

test('readRawBody: enforces size limit, destroys request, ignores later chunks', async () => {
  const { mod } = loadRunner()
  const req = fakeReq()
  const p = mod.readRawBody(req, 2 * 1024 * 1024)
  req.emit('data', Buffer.alloc(1024 * 1024))
  req.emit('data', Buffer.alloc(1024 * 1024 + 1))
  req.emit('data', Buffer.alloc(10))
  req.emit('end')
  await assert.rejects(p, { message: 'ไฟล์ .sav ใหญ่เกินไป (2MB) — จำกัดไม่เกิน 2MB' })
  assert.equal(req.destroyed, true)
  assert.match(SOURCE, /function readRawBody\(req, limit = 120_000_000\)/)
})

// ============================================================
// OpenRouter client
// ============================================================

test('callOpenRouter: request shape (json_object response format, backend referer/title, abortable)', async () => {
  const { mod, state } = loadRunner({ fetchImpl: () => chat('{"ok":1}') })
  assert.equal(await mod.callOpenRouter('PROMPT'), '{"ok":1}')
  const { url, init } = state.fetchCalls[0]
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(init.method, 'POST')
  assert.deepEqual(init.headers, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer backend-key',
    'HTTP-Referer': 'https://codeframe-dp.web.app',
    'X-Title': 'COF Codeframe Studio',
  })
  const body = JSON.parse(init.body)
  assert.deepEqual(body, {
    model: 'qwen/qwen3-235b-a22b-2507',
    messages: [{ role: 'system', content: mod.SYSTEM_PROMPT }, { role: 'user', content: 'PROMPT' }],
    temperature: 0,
    response_format: { type: 'json_object' },
  })
  assert.equal(state.timers[0].ms, 240000)
  assert.equal(state.timers[0].cleared, true)
})

test('callOpenRouter: retries once with openrouter/free on 429/5xx/network/timeout, not on 4xx', async () => {
  const retryable = [
    () => httpErr(429, 'slow down'),
    () => httpErr(503),
    () => { throw new TypeError('fetch failed') },
    () => { const e = new Error('x'); e.name = 'AbortError'; throw e },
  ]
  for (const first of retryable) {
    const { mod, state } = loadRunner({ fetchImpl: (u, i, n) => (n === 1 ? first() : chat('ok')) })
    assert.equal(await mod.callOpenRouter('p', { model: 'm/a' }), 'ok')
    assert.deepEqual(state.fetchCalls.map((c) => JSON.parse(c.init.body).model), ['m/a', 'openrouter/free'])
  }
  const { mod, state } = loadRunner({ fetchImpl: () => httpErr(400, 'bad request') })
  await assert.rejects(mod.callOpenRouter('p', { model: 'm/a' }), { message: 'OpenRouter HTTP 400: bad request' })
  assert.equal(state.fetchCalls.length, 1)
})

test('callOpenRouter: openrouter/free is not retried; last error surfaces; missing key never fetches', async () => {
  let { mod, state } = loadRunner({ fetchImpl: () => httpErr(500, 'down') })
  await assert.rejects(mod.callOpenRouter('p', { model: 'openrouter/free' }), { message: 'OpenRouter HTTP 500: down' })
  assert.equal(state.fetchCalls.length, 1)
  ;({ mod, state } = loadRunner({ fetchImpl: (u, i, n) => httpErr(n === 1 ? 429 : 502, `e${n}`) }))
  await assert.rejects(mod.callOpenRouter('p'), { message: 'OpenRouter HTTP 502: e2' })
  assert.equal(state.fetchCalls.length, 2)
  ;({ mod, state } = loadRunner({ fetchImpl: () => okJson({ choices: [] }) }))
  await assert.rejects(mod.callOpenRouter('p', { model: 'openrouter/free' }), { message: 'OpenRouter returned no content' })
  assert.equal(state.fetchCalls.length, 1)
  ;({ mod, state } = loadRunner({ env: { OPENROUTER_ENV_FILE: FAKE_ENV_FILE }, fetchImpl: () => chat('x') }))
  await assert.rejects(mod.callOpenRouter('p'), { message: 'OPENROUTER_API_KEY is not configured on backend' })
  assert.equal(state.fetchCalls.length, 0)
})

test('extractJson: slices first "{" to last "}" and reports a preview when missing', () => {
  const { mod } = loadRunner()
  assert.deepEqual(JSON.parse(JSON.stringify(mod.extractJson('noise {"a":{"b":1}} trailing'))), { a: { b: 1 } })
  assert.throws(() => mod.extractJson(''), { message: 'empty model output' })
  assert.throws(() => mod.extractJson('x'.repeat(300)), { message: `no JSON object in model output: ${'x'.repeat(240)}` })
  assert.throws(() => mod.extractJson('} {'), /no JSON object/)
})

// ============================================================
// AI handlers (stubbed OpenRouter)
// ============================================================

const promptOf = (state, n = 0) => JSON.parse(state.fetchCalls[n].init.body).messages[1].content

test('handleGroup: prompt embeds compact input JSON; nets normalized with leftovers in "อื่น ๆ"', async () => {
  const { mod, state } = loadRunner({ fetchImpl: () => chat('{"nets":[{"name":" A ","codeIndexes":[1,"0",7]},{"codeIndexes":[2]},{"name":"dup","codeIndexes":[1]}]}') })
  const out = await mod.handleGroup({ codes: [{ text: 'x' }, { text: 'y' }, { text: 'z' }, { text: 'w' }] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { nets: [{ name: 'A', codeIndexes: [1, 0] }, { name: 'กลุ่ม', codeIndexes: [2] }, { name: 'อื่น ๆ', codeIndexes: [3] }] })
  const prompt = promptOf(state)
  assert.ok(prompt.startsWith('Return ONLY valid compact JSON. No markdown, no explanation.\nSchema: {"nets":'))
  assert.ok(prompt.endsWith('Input JSON:\n{"codes":[{"text":"x"},{"text":"y"},{"text":"z"},{"text":"w"}]}'))
})

test('handleCode / handleReview: same normalization (scalar assign wrapped, dedupe, bounds)', async () => {
  const reply = '{"codes":[{"label":"A"},{"text":"B","netName":"N"},{"label":""}],"assign":[[0,0,1,5],1,null]}'
  for (const name of ['handleCode', 'handleReview']) {
    const { mod } = loadRunner({ fetchImpl: () => chat(reply) })
    const out = await mod[name]({ verbatims: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] })
    assert.deepEqual(JSON.parse(JSON.stringify(out)), {
      codes: [{ label: 'A', net: 'อื่น ๆ' }, { label: 'B', net: 'N' }],
      assign: [[0, 1], [1], [], []],
    }, name)
  }
})

test('handleSpellcheck: filters to known indexes with non-empty fixes', async () => {
  const { mod } = loadRunner({ fetchImpl: () => chat('{"fixes":[{"i":"1","fixed":" ok ","reason":" r "},{"i":9,"fixed":"x"},{"i":1,"fixed":" "}]}') })
  const out = await mod.handleSpellcheck({ items: [{ i: 1, text: 't' }] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { fixes: [{ i: 1, fixed: 'ok', reason: 'r' }] })
})

test('handleAssign: out-of-range / non-integer -> -1, length matches verbatims', async () => {
  const { mod } = loadRunner({ fetchImpl: () => chat('{"assign":[1,"0",-1,4,1.5]}') })
  const out = await mod.handleAssign({ codes: [{}, {}], verbatims: [{}, {}, {}, {}, {}, {}] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { assign: [1, 0, -1, -1, -1, -1] })
})

test('handleAssign: null from the model should mean -1, not code 0', {
  todo: 'Number(null) === 0, so a null "no match" entry is assigned to code index 0 (scripts/ai-runner.mjs:554)',
}, async () => {
  const { mod } = loadRunner({ fetchImpl: () => chat('{"assign":[null]}') })
  const out = await mod.handleAssign({ codes: [{}], verbatims: [{}] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { assign: [-1] })
})

test('handleGroupCE: accepts number, string, {existing}, {neo}; neo labels reduced to first meaningful token; gaps filled', async () => {
  const reply = JSON.stringify({ assign: [1, 'คุณปอนด์ ณธาวิจย์', { existing: '0' }, { neo: ' กอล์ฟ ณคุณดี ' }, { existing: 9 }, null] })
  const { mod, state } = loadRunner({ fetchImpl: () => chat(reply) })
  const out = await mod.handleGroupCE({
    codes: [{ i: 0, label: 'ปอนด์' }, { i: 1, label: 'กอล์ฟ' }],
    verbatims: ['a', 'b', 'c', 'd', 'สมชาย ใจดี', 'นายสมศักดิ์ รักไทย', 'extra'].map((text) => ({ text })),
  })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), {
    assign: [
      { existing: 1 },
      { neo: 'ปอนด์' },
      { existing: 0 },
      { neo: 'กอล์ฟ' },
      { neo: 'ใจดี' }, //   invalid object -> per-item fallback (picks the SHORTEST token, see todo below)
      { neo: 'รักไทย' }, // null -> per-item fallback
      { neo: 'extra' }, //  missing entry -> per-item fallback
    ],
  })
  assert.match(promptOf(state), /NEVER output null and NEVER omit an item/)
})

test('handleGroupCE: per-item fallback label should be the first meaningful token (name), not the surname', {
  todo: 'fallbackGroupCEAssign([single]) unions all tokens and picks the shortest label on equal score, so "สมชาย ใจดี" becomes neo "ใจดี" while the rest of the code labels by first token (scripts/ai-runner.mjs:702,743)',
}, async () => {
  const { mod } = loadRunner({ fetchImpl: () => chat('{"assign":[null]}') })
  const out = await mod.handleGroupCE({ codes: [], verbatims: [{ text: 'สมชาย ใจดี' }] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { assign: [{ neo: 'สมชาย' }] })
})

test('handleGroupCE: provider failure falls back to rule-based clustering instead of failing', async () => {
  const { mod } = loadRunner({ fetchImpl: () => httpErr(401, 'bad key') })
  const out = await mod.handleGroupCE({ codes: [{ i: 0, label: 'ปอนด์' }], verbatims: [{ text: 'บอนด์' }, { text: 'สมชาย' }] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), {
    assign: [{ existing: 0 }, { neo: 'สมชาย' }],
    fallback: true,
    reason: 'OpenRouter HTTP 401: bad key',
  })
})

// ============================================================
// Rule-based CE clustering helpers
// ============================================================

test('simplifyThaiLabel / firstMeaningfulToken / normalizeClusterKey', () => {
  const { mod } = loadRunner()
  assert.equal(mod.simplifyThaiLabel('คุณปอนด์ ณธาวิจย์'), 'ปอนด์ ณธาวิจย์')
  assert.equal(mod.simplifyThaiLabel('นางสาว กอล์ฟ!'), 'กอล์ฟ')
  assert.equal(mod.simplifyThaiLabel('  a,b;c  '), 'a b c')
  assert.equal(mod.firstMeaningfulToken('คุณปอนด์ ณธาวิจย์'), 'ปอนด์')
  assert.equal(mod.firstMeaningfulToken('...'), 'อื่น ๆ')
  assert.equal(mod.normalizeClusterKey('ปอนด์'), 'ปอนด')
  assert.equal(mod.normalizeClusterKey('บอนด์'), 'บอนด')
  assert.equal(mod.normalizeClusterKey('Hello World'), 'hello')
})

test('simplifyThaiLabel: honorific inside leading punctuation should still be stripped', {
  todo: 'prefix regex runs before punctuation removal, so "(ดร.สมชาย)" yields first token "ดร" instead of "สมชาย" (scripts/ai-runner.mjs:567-568)',
}, () => {
  const { mod } = loadRunner()
  assert.equal(mod.firstMeaningfulToken('(ดร.สมชาย)'), 'สมชาย')
})

test('levenshtein and closeEnoughKey', () => {
  const { mod } = loadRunner()
  assert.equal(mod.levenshtein('kitten', 'sitting'), 3)
  assert.equal(mod.levenshtein('', 'abc'), 3)
  assert.equal(mod.closeEnoughKey('บอนด', 'ปอนด'), true) // บ/ป leading typo
  assert.equal(mod.closeEnoughKey('abc', 'abcdefgh'), true) // substring >= 3 chars (no length bound)
  assert.equal(mod.closeEnoughKey('ab', 'abc'), false)
  assert.equal(mod.closeEnoughKey('abcd', 'abce'), true) // edit distance 1
  assert.equal(mod.closeEnoughKey('abcd', 'wxyz'), false)
  assert.equal(mod.closeEnoughKey('', ''), false)
})

test('isNonAnswerText: Thai/English "don\'t know" variants', () => {
  const { mod } = loadRunner()
  for (const t of ['ไม่ทราบ', 'ไม่ทราบค่ะ', 'จำไม่ได้', 'ไม่ระบุ', 'นึกไม่ออก', "don't know", 'Unknown', 'DK']) assert.equal(mod.isNonAnswerText(t), true, t)
  for (const t of ['ปอนด์', 'กอล์ฟ', 'โรงพยาบาล']) assert.equal(mod.isNonAnswerText(t), false, t)
})

test('isNonAnswerText: substantive answers containing the letters "dk" are not non-answers', {
  todo: 'the /dk/ alternative is unanchored, so "Vodka", "DKNY" etc. are classified as non-answers and mapped to the ไม่ทราบ code (scripts/ai-runner.mjs:630-631)',
}, () => {
  const { mod } = loadRunner()
  assert.equal(mod.isNonAnswerText('Vodka'), false)
  assert.equal(mod.isNonAnswerText('dkny'), false)
})

test('fallbackGroupCEAssign: alias graph merges name variants into existing codes; non-answers go to the non-answer code', () => {
  const { mod } = loadRunner()
  const codes = [{ i: 0, label: 'ปอนด์', count: 10 }, { i: 1, label: 'ไม่ทราบ', count: 3 }, { i: 2, label: 'กอล์ฟ', count: 2 }]
  const verbatims = ['ปอนด์ ณธาวิจย์', 'ณธาวิจย์', 'บอนด์', 'คุณบอนด์', 'ไม่ทราบค่ะ', 'จำไม่ได้', 'สมชาย ใจดี', 'สมชาย', 'กอล์ฟ ณคุณดี']
    .map((text) => ({ text, count: 1 }))
  assert.deepEqual(JSON.parse(JSON.stringify(mod.fallbackGroupCEAssign(verbatims, codes))), [
    { existing: 0 }, { existing: 0 }, { existing: 0 }, { existing: 0 },
    { existing: 1 }, { existing: 1 },
    { neo: 'สมชาย' }, { neo: 'สมชาย' },
    { existing: 2 },
  ])
})

test('fallbackGroupCEAssign: without codes everything becomes a neo label (non-answers included)', () => {
  const { mod } = loadRunner()
  assert.deepEqual(JSON.parse(JSON.stringify(mod.fallbackGroupCEAssign([{ text: 'สมชาย ใจดี' }, { text: 'สมชาย' }, { text: 'ไม่ทราบ' }]))), [
    { neo: 'สมชาย' }, { neo: 'สมชาย' }, { neo: 'ไม่ทราบ' },
  ])
})

// ============================================================
// Resend e-mail endpoints (curl stubbed)
// ============================================================

const RESEND_ENV = { OPENROUTER_API_KEY: 'backend-key', OPENROUTER_ENV_FILE: FAKE_ENV_FILE, RESEND_API_KEY: 're_test' }
const resendOk = (id = 'em_1') => async () => ({ stdout: JSON.stringify({ id }) })
const payloadOf = (call) => JSON.parse(call.args[call.args.indexOf('--data-binary') + 1])

test('helpers: isEmail, parseEmailList, escHtml', () => {
  const { mod } = loadRunner()
  assert.equal(mod.isEmail(' a@b.co '), true)
  for (const bad of ['', 'a@b', 'a b@c.d', '@b.co', null]) assert.equal(mod.isEmail(bad), false, String(bad))
  assert.deepEqual(mod.parseEmailList('a@x.io, b@x.io;a@x.io\nc@x.io'), ['a@x.io', 'b@x.io', 'c@x.io'])
  assert.deepEqual(mod.parseEmailList(['a@x.io', 'b@x.io,c@x.io']), ['a@x.io', 'b@x.io', 'c@x.io'])
  assert.deepEqual(mod.parseEmailList(undefined), [])
  assert.equal(mod.escHtml('<a href="x">&</a>\''), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;\'')
  assert.equal(mod.escHtml(null), '')
})

test('send-ci-review-email: requires backend RESEND_API_KEY', async () => {
  const { state } = loadRunner()
  const res = await request(state, { url: '/api/send-ci-review-email', body: { ciEmails: 'a@x.io', reviewUrl: REVIEW_URL } })
  assert.deepEqual([res.status, res.json()], [500, { error: 'RESEND_API_KEY is not configured on backend' }])
  assert.equal(state.curlCalls.length, 0)
})

test('sendCiReviewEmail: input validation (recipients, cc, reply-to, review link allow-list)', async () => {
  const { mod, state } = loadRunner({ env: RESEND_ENV, curlImpl: resendOk() })
  const base = { ciEmails: 'a@x.io', reviewUrl: REVIEW_URL }
  const cases = [
    [{ ...base, ciEmails: '' }, 'กรุณาใส่ Email CI อย่างน้อย 1 เมล'],
    [{ ...base, ciEmails: 'a@x.io, nope' }, 'CI Email ไม่ถูกต้อง: nope'],
    [{ ...base, ccEmails: 'bad@' }, 'Cc Email ไม่ถูกต้อง: bad@'],
    [{ ...base, editEmail: 'edit' }, 'Edit Reply-To Email ไม่ถูกต้อง'],
    [{ ...base, reviewUrl: 'https://evil.example/#/review/x' }, 'Review link ไม่ถูกต้อง'],
    [{ ...base, reviewUrl: 'javascript:alert(1)//https://codeframe-dp.web.app/#/review/' }, 'Review link ไม่ถูกต้อง'],
    [{ ...base, reviewUrl: 'https://codeframe-dp.web.app.evil.example/#/review/x' }, 'Review link ไม่ถูกต้อง'],
  ]
  for (const [body, message] of cases) await assert.rejects(mod.sendCiReviewEmail(body), { message })
  assert.equal(state.curlCalls.length, 0)
})

test('sendCiReviewEmail: builds Resend payload via curl --ipv4 with HTML-escaped content', async () => {
  const { mod, state } = loadRunner({ env: RESEND_ENV, curlImpl: resendOk('em_42') })
  const out = await mod.sendCiReviewEmail({
    ciEmails: 'ci1@x.io; ci2@x.io, ci1@x.io', ccEmails: ['cc@x.io'], editEmail: 'edit@x.io',
    jobName: '<script>alert(1)</script>', codeframeName: 'CF "1"', reviewUrl: REVIEW_URL, message: 'line1\n<b>line2</b>',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), {
    ok: true, id: 'em_42', to: ['ci1@x.io', 'ci2@x.io'], cc: ['cc@x.io'], replyTo: 'edit@x.io',
    from: 'Codeframe Review <codeframe@dpdata-tools.com>', transport: 'curl-ipv4',
  })
  const call = state.curlCalls[0]
  assert.equal(call.file, 'curl')
  assert.deepEqual(call.args.slice(0, 12), [
    '--ipv4', '-sS', '-m', '45', '-X', 'POST', 'https://api.resend.com/emails',
    '-H', 'Authorization: Bearer re_test', '-H', 'Content-Type: application/json', '--data-binary',
  ])
  assert.deepEqual(call.opts, { timeout: 55000, maxBuffer: 2_000_000 })
  const payload = payloadOf(call)
  assert.deepEqual(payload.to, ['ci1@x.io', 'ci2@x.io'])
  assert.deepEqual(payload.cc, ['cc@x.io'])
  assert.equal(payload.reply_to, 'edit@x.io')
  assert.equal(payload.subject, '[COF] CI Review: <script>alert(1)</script>')
  assert.ok(!payload.html.includes('<script>'))
  assert.ok(payload.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(payload.html.includes('CF &quot;1&quot;'))
  assert.ok(payload.html.includes('line1<br>&lt;b&gt;line2&lt;/b&gt;'))
  assert.ok(payload.html.includes(`href="${REVIEW_URL}"`))
  assert.ok(payload.text.includes(`Review link: ${REVIEW_URL}`))
})

test('sendCiReviewEmail: optional cc/reply_to omitted; custom subject and RESEND_FROM honored', async () => {
  const { mod, state } = loadRunner({ env: { ...RESEND_ENV, RESEND_FROM: 'Team <t@x.io>' }, curlImpl: resendOk() })
  await mod.sendCiReviewEmail({ ciEmail: 'a@x.io', reviewUrl: REVIEW_URL, subject: 'Custom' })
  const payload = payloadOf(state.curlCalls[0])
  assert.equal(payload.from, 'Team <t@x.io>')
  assert.equal(payload.subject, 'Custom')
  assert.ok(!('cc' in payload))
  assert.ok(!('reply_to' in payload))
})

test('Resend error mapping: testing-mode, generic error, missing id, curl failure', async () => {
  const body = { ciEmails: 'a@x.io', reviewUrl: REVIEW_URL }
  const cases = [
    [async () => ({ stdout: '{"message":"You can only send testing emails to your own address"}' }), /^เชื่อมต่อ Resend ไม่สำเร็จ: Resend ยังเป็นโหมดทดสอบ/],
    [async () => ({ stdout: '{"error":"invalid from"}' }), /^เชื่อมต่อ Resend ไม่สำเร็จ: invalid from$/],
    [async () => ({ stdout: '{}' }), /^เชื่อมต่อ Resend ไม่สำเร็จ: Resend ไม่ส่ง id กลับมา: \{\}$/],
    [async () => { throw new Error('Could not resolve host') }, /^เชื่อมต่อ Resend ไม่สำเร็จ: Could not resolve host$/],
  ]
  for (const [curlImpl, re] of cases) {
    for (const fn of ['sendCiReviewEmail', 'sendCiConfirmEmail']) {
      const { mod } = loadRunner({ env: RESEND_ENV, curlImpl })
      const args = fn === 'sendCiReviewEmail' ? body : { editEmail: 'e@x.io', reviewUrl: REVIEW_URL }
      await assert.rejects(mod[fn](args), { message: re }, fn)
    }
  }
})

test('sendCiConfirmEmail: validation', async () => {
  const { mod, state } = loadRunner({ env: RESEND_ENV, curlImpl: resendOk() })
  await assert.rejects(mod.sendCiConfirmEmail({ reviewUrl: REVIEW_URL }), /Send from Email ของ Edit/)
  await assert.rejects(mod.sendCiConfirmEmail({ editEmail: 'e@x.io', reviewerEmail: 'bad', reviewUrl: REVIEW_URL }), { message: 'CI Email ไม่ถูกต้อง' })
  await assert.rejects(mod.sendCiConfirmEmail({ editEmail: 'e@x.io', reviewUrl: 'http://codeframe-dp.web.app/#/review/x' }), { message: 'Review link ไม่ถูกต้อง' })
  assert.equal(state.curlCalls.length, 0)
  const noKey = loadRunner()
  await assert.rejects(noKey.mod.sendCiConfirmEmail({ editEmail: 'e@x.io', reviewUrl: REVIEW_URL }), /^Error: เชื่อมต่อ Resend|RESEND_API_KEY is not configured on backend/)
})

test('POST /api/send-ci-confirm-email: sends to Edit, reply-to CI, escaped note, defaults', async () => {
  const { state } = loadRunner({ env: RESEND_ENV, curlImpl: resendOk('em_c'), fetchImpl: reviewLinkFetch({ status: 'active', editEmail: 'Edit@x.io' }) })
  const res = await request(state, {
    url: '/api/send-ci-confirm-email',
    body: { editEmail: 'edit@x.io', reviewer: '  ', ciEmail: 'ci@x.io', jobName: 'J<1>', reviewUrl: CONFIRM_URL, note: 'a\n<i>b</i>', confirmedAt: '1 Jan' },
  })
  assert.equal(res.status, 200)
  assert.equal(state.fetchCalls[0].url, `${FIRESTORE}/review_links/${CONFIRM_TOKEN}`)
  assert.equal(state.fetchCalls[0].init, undefined, 'review link is read without credentials (public rules)')
  assert.deepEqual(res.json(), { ok: true, id: 'em_c', to: ['Edit@x.io'], replyTo: 'ci@x.io', from: 'Codeframe Review <codeframe@dpdata-tools.com>', transport: 'curl-ipv4' })
  const payload = payloadOf(state.curlCalls[0])
  assert.deepEqual(payload.to, ['Edit@x.io'], 'sends to the editEmail stored on the review link')
  assert.equal(payload.reply_to, 'ci@x.io')
  assert.equal(payload.subject, '[COF] CI Confirmed: J<1>')
  assert.ok(payload.html.includes('J&lt;1&gt;'))
  assert.ok(payload.html.includes('a<br>&lt;i&gt;b&lt;/i&gt;'))
  assert.ok(payload.html.includes('CI Reviewer &lt;ci@x.io&gt;'), 'blank reviewer -> "CI Reviewer"')
  assert.ok(payload.text.includes('1 Jan'))
})

test('sendCiConfirmEmail: default note and no reply_to without CI email', async () => {
  const { mod, state } = loadRunner({ env: RESEND_ENV, curlImpl: resendOk() })
  const out = await mod.sendCiConfirmEmail({ editEmail: 'edit@x.io', reviewUrl: REVIEW_URL, confirmedAt: 'now' })
  assert.equal(out.replyTo, '')
  const payload = payloadOf(state.curlCalls[0])
  assert.ok(!('reply_to' in payload))
  assert.ok(payload.text.includes('ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ'))
})

// ---------- same normalizer quirks as server/claudeGroup.mjs ----------
test('handleCode: codes dropped for empty label should not shift assign indexes', {
  todo: 'normalizeCoding filters empty-label codes before resolving assign indexes, so index 1 ("A") is lost (scripts/ai-runner.mjs:521-525)',
}, async () => {
  const { mod } = loadRunner({ fetchImpl: () => chat('{"codes":[{"label":""},{"label":"A","net":"N"}],"assign":[[1]]}') })
  const out = await mod.handleCode({ verbatims: [{ text: 'v' }] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { codes: [{ label: 'A', net: 'N' }], assign: [[0]] })
})

test('handleGroup: an index repeated inside the same net should appear once', {
  todo: 'normalizeGroup adds to `seen` only after filtering a net, so duplicates inside one net survive (scripts/ai-runner.mjs:503-504)',
}, async () => {
  const { mod } = loadRunner({ fetchImpl: () => chat('{"nets":[{"name":"a","codeIndexes":[0,0,1]}]}') })
  const out = await mod.handleGroup({ codes: [{ text: 'x' }, { text: 'y' }] })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { nets: [{ name: 'a', codeIndexes: [0, 1] }] })
})


// ============================================================
// Auth: Firebase ID token + approved user (2026-11 security fix)
// ============================================================
const AUTH_KID = 'test-kid'
const { privateKey: AUTH_PRIV, publicKey: AUTH_PUB } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const OTHER_PRIV = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function signToken(claims = {}, { kid = AUTH_KID, key = AUTH_PRIV, alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { aud: 'codeframe-dbd8d', iss: 'https://securetoken.google.com/codeframe-dbd8d', sub: 'uid-1', iat: now - 10, auth_time: now - 10, exp: now + 3600, ...claims }
  const head = `${b64u({ alg, kid, typ: 'JWT' })}.${b64u(payload)}`
  const sig = createSign('RSA-SHA256').update(head).sign(key).toString('base64url')
  return `${head}.${sig}`
}
// fetch ปลอม: ใบรับรอง Google + users/{uid} + OpenRouter
function authFetch({ userStatus = 'approved', userHttp = 200, chatContent = '{"nets":[]}' } = {}) {
  return (url) => {
    url = String(url)
    if (url === CERTS_URL) return { ok: true, status: 200, headers: { get: () => 'public, max-age=3600' }, json: async () => ({ [AUTH_KID]: AUTH_PUB.export({ type: 'spki', format: 'pem' }) }) }
    if (url.startsWith(`${FIRESTORE}/users/`)) {
      if (userHttp !== 200) return { ok: false, status: userHttp, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ fields: { status: { stringValue: userStatus } } }) }
    }
    if (url.startsWith('https://openrouter.ai/')) return chat(chatContent)
    throw new Error(`test: unexpected fetch ${url}`)
  }
}
const AUTH_ENV = { OPENROUTER_API_KEY: 'backend-key', OPENROUTER_ENV_FILE: FAKE_ENV_FILE }
const aiCall = (state, token, body = { codes: [{ text: 'x' }] }) =>
  request(state, { url: '/api/ai-group', headers: token ? { authorization: `Bearer ${token}` } : {}, body })

test('auth: enabled by default; /health stays public and reports it', async () => {
  const { mod, state } = loadRunner({ env: AUTH_ENV, auth: true, fetchImpl: authFetch() })
  assert.equal(mod.REQUIRE_AUTH, true)
  const res = await request(state, { method: 'GET', url: '/health' })
  assert.equal(res.status, 200)
  assert.equal(res.json().authRequired, true)
  assert.equal(state.fetchCalls.length, 0)
})

test('auth: every non-public endpoint rejects requests without a token (401) and never spends the OpenRouter key', async () => {
  const { state } = loadRunner({ env: AUTH_ENV, auth: true, fetchImpl: authFetch(), curlImpl: resendOk() })
  const cases = [
    ['POST', '/api/ai-group'], ['POST', '/api/ai-code'], ['POST', '/api/ai-review'], ['POST', '/api/ai-spellcheck'],
    ['POST', '/api/ai-assign'], ['POST', '/api/ai-group-ce'], ['GET', '/api/openrouter-models'], ['POST', '/api/parse-sav'],
    ['POST', '/api/send-ci-review-email'], ['POST', '/api/unknown'],
  ]
  for (const [method, url] of cases) {
    const res = await request(state, { method, url, body: method === 'POST' ? {} : undefined })
    assert.equal(res.status, 401, `${method} ${url}`)
    assert.match(res.json().error, /ต้องเข้าสู่ระบบ/)
  }
  assert.equal(state.fetchCalls.length, 0)
  assert.equal(state.curlCalls.length, 0)
})

test('auth: approved user with a valid Firebase ID token is allowed; approval is cached', async () => {
  const { state } = loadRunner({ env: AUTH_ENV, auth: true, fetchImpl: authFetch() })
  const token = signToken()
  const res = await aiCall(state, token)
  assert.equal(res.status, 200, JSON.stringify(res.json()))
  const userCall = state.fetchCalls.find((c) => String(c.url).startsWith(`${FIRESTORE}/users/`))
  assert.equal(userCall.url, `${FIRESTORE}/users/uid-1`)
  assert.equal(userCall.init.headers.Authorization, `Bearer ${token}`, 'profile read uses the user\'s own token')
  const before = state.fetchCalls.length
  assert.equal((await aiCall(state, token)).status, 200)
  const newCalls = state.fetchCalls.slice(before).map((c) => String(c.url))
  assert.ok(!newCalls.some((u) => u === CERTS_URL || u.startsWith(`${FIRESTORE}/users/`)), 'certs and approval cached')
})

test('auth: pending / missing users are rejected with 403', async () => {
  for (const opts of [{ userStatus: 'pending' }, { userStatus: 'rejected' }, { userHttp: 403 }, { userHttp: 404 }]) {
    const { state } = loadRunner({ env: AUTH_ENV, auth: true, fetchImpl: authFetch(opts) })
    const res = await aiCall(state, signToken())
    assert.equal(res.status, 403, JSON.stringify(opts))
    assert.ok(!state.fetchCalls.some((c) => String(c.url).startsWith('https://openrouter.ai/')))
  }
})

test('auth: forged, expired, wrong-project and malformed tokens are rejected with 401', async () => {
  const now = Math.floor(Date.now() / 1000)
  const bad = {
    garbage: 'not-a-jwt',
    wrongKey: signToken({}, { key: OTHER_PRIV }),
    unknownKid: signToken({}, { kid: 'other-kid' }),
    alg: signToken({}, { alg: 'HS256' }),
    expired: signToken({ exp: now - 1 }),
    wrongAud: signToken({ aud: 'other-project' }),
    wrongIss: signToken({ iss: 'https://securetoken.google.com/other-project' }),
    noSub: signToken({ sub: '' }),
    future: signToken({ iat: now + 3600 }),
    tampered: (() => { const [h, , sig] = signToken().split('.'); return `${h}.${b64u({ aud: 'codeframe-dbd8d', iss: 'https://securetoken.google.com/codeframe-dbd8d', sub: 'admin', exp: now + 3600, iat: now })}.${sig}` })(),
  }
  for (const [name, token] of Object.entries(bad)) {
    const { state } = loadRunner({ env: AUTH_ENV, auth: true, fetchImpl: authFetch() })
    const res = await aiCall(state, token)
    assert.equal(res.status, 401, name)
    assert.ok(!state.fetchCalls.some((c) => String(c.url).startsWith(`${FIRESTORE}/users/`)), `${name}: no profile lookup`)
  }
})

test('auth: AI_RUNNER_REQUIRE_AUTH=0 is the only way to disable it', async () => {
  const { mod } = loadRunner({ env: { ...AUTH_ENV, AI_RUNNER_REQUIRE_AUTH: 'false' }, auth: true })
  assert.equal(mod.REQUIRE_AUTH, true)
  const off = loadRunner({ env: { ...AUTH_ENV, AI_RUNNER_REQUIRE_AUTH: '0' }, auth: true })
  assert.equal(off.mod.REQUIRE_AUTH, false)
})

test('confirm email (public CI): needs an active review link and only sends to the editEmail stored on it', async () => {
  const body = { editEmail: 'edit@x.io', reviewer: 'CI', reviewUrl: CONFIRM_URL, confirmedAt: 'now' }
  // ไม่ต้องมี token (CI ไม่ได้ล็อกอิน)
  const ok = loadRunner({ env: RESEND_ENV, auth: true, curlImpl: resendOk(), fetchImpl: reviewLinkFetch() })
  assert.equal((await request(ok.state, { url: '/api/send-ci-confirm-email', body })).status, 200)

  const cases = [
    ['other recipient', { ...body, editEmail: 'attacker@evil.io' }, reviewLinkFetch(), 403],
    ['link without editEmail', body, reviewLinkFetch({ editEmail: '' }), 403],
    ['closed link', body, reviewLinkFetch({ status: 'closed' }), 403],
    ['missing link', body, reviewLinkFetch({ httpStatus: 403 }), 403],
    ['bad url', { ...body, reviewUrl: 'https://codeframe-dp.web.app/#/review/x' }, reviewLinkFetch(), 400],
    ['foreign url', { ...body, reviewUrl: `https://evil.io/#/review/${CONFIRM_TOKEN}` }, reviewLinkFetch(), 400],
  ]
  for (const [name, b, fetchImpl, status] of cases) {
    const { state } = loadRunner({ env: RESEND_ENV, auth: true, curlImpl: resendOk(), fetchImpl })
    const res = await request(state, { url: '/api/send-ci-confirm-email', body: b })
    assert.equal(res.status, status, name)
    assert.equal(state.curlCalls.length, 0, `${name}: no email sent`)
  }
})

test('confirm email: rate limited per review token (5 per 10 minutes)', async () => {
  const { state } = loadRunner({ env: RESEND_ENV, auth: true, curlImpl: resendOk(), fetchImpl: reviewLinkFetch() })
  const body = { editEmail: 'edit@x.io', reviewUrl: CONFIRM_URL, confirmedAt: 'now' }
  for (let i = 0; i < 5; i++) assert.equal((await request(state, { url: '/api/send-ci-confirm-email', body })).status, 200)
  const res = await request(state, { url: '/api/send-ci-confirm-email', body })
  assert.equal(res.status, 429)
  assert.equal(state.curlCalls.length, 5)
})

test('auth project matches the frontend Firebase Auth/Firestore project (not the Hosting project)', () => {
  const cfg = fs.readFileSync(new URL('../src/lib/firebaseConfig.js', import.meta.url), 'utf8')
  const frontendProject = cfg.match(/projectId:\s*env\.VITE_FIREBASE_PROJECT_ID\s*\|\|\s*'([^']+)'/)?.[1]
  const runnerProject = SOURCE.match(/FIREBASE_PROJECT_ID = process\.env\.FIREBASE_PROJECT_ID \|\| '([^']+)'/)?.[1]
  assert.ok(frontendProject && runnerProject)
  assert.equal(runnerProject, frontendProject)
  assert.notEqual(runnerProject, 'codeframe-dp', 'codeframe-dp is Hosting only')
})
