// Characterization tests for functions/index.js (Firebase Cloud Functions, CommonJS)
// ไม่ require firebase-admin/firebase-functions จริง (จะพยายามหา credentials/เชื่อมต่อ GCP)
// → โหลด source ผ่าน vm.compileFunction ด้วย CommonJS wrapper แล้วส่ง require ปลอม:
//   - firebase-functions/v2/https.onRequest ปลอม: คืน handler + เก็บ options
//   - firebase-admin ปลอม: Firestore in-memory (review_links / codeframes / review_audit)
//   - sav-reader: ของจริงจาก functions/node_modules
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SOURCE_URL = new URL('../functions/index.js', import.meta.url)
const SOURCE_PATH = fileURLToPath(SOURCE_URL)
const SOURCE = fs.readFileSync(SOURCE_URL, 'utf8')
const realRequire = createRequire(SOURCE_PATH)

// users / idTokens: ใช้ทดสอบ parseSav ที่ต้องเป็นผู้ใช้ที่อนุมัติแล้ว (ค่าเริ่ม: good-token → u1 approved)
function loadFunctions({ links = {}, codeframes = {}, appsInitialized = false, users = { u1: { status: 'approved' } }, idTokens = { 'good-token': 'u1' } } = {}) {
  const db = { review_links: new Map(Object.entries(links)), codeframes: new Map(Object.entries(codeframes)), users: new Map(Object.entries(users)) }
  const state = { initCalls: 0, updates: [], audits: [], gets: [], requires: [] }
  const firestoreInstance = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              state.gets.push([name, id])
              const data = db[name]?.get(id)
              return { exists: data !== undefined, id, data: () => structuredClone(data) }
            },
            async update(u) { state.updates.push({ collection: name, id, update: u }) },
          }
        },
        async add(doc) { state.audits.push({ collection: name, doc }) },
      }
    },
  }
  const firestore = Object.assign(() => firestoreInstance, { FieldValue: { serverTimestamp: () => '__SERVER_TS__' } })
  const auth = () => ({
    async verifyIdToken(token) {
      state.verifyCalls = (state.verifyCalls || 0) + 1
      if (!Object.hasOwn(idTokens, token)) throw new Error('auth/argument-error')
      return { uid: idTokens[token] }
    },
  })
  const admin = { apps: appsInitialized ? [{}] : [], initializeApp: () => { state.initCalls++ }, firestore, auth }
  const https = { onRequest: (opts, handler) => Object.assign(handler, { __opts: opts }) }
  const fakeRequire = (id) => {
    state.requires.push(id)
    if (id === 'firebase-functions/v2/https') return https
    if (id === 'firebase-admin') return admin
    if (id === 'sav-reader') return realRequire('sav-reader')
    throw new Error(`test: unexpected require(${id})`)
  }
  const module = { exports: {} }
  vm.compileFunction(SOURCE, ['exports', 'require', 'module', '__filename', '__dirname'])(
    module.exports, fakeRequire, module, SOURCE_PATH, path.dirname(SOURCE_PATH),
  )
  return { exports: module.exports, state }
}

function fakeRes() {
  const res = { statusCode: null, body: null, headers: {} }
  res.status = (c) => { res.statusCode = c; return res }
  res.send = (b) => { res.body = b; return res }
  res.set = (k, v) => { res.headers[k] = v; return res }
  res.json = () => JSON.parse(res.body)
  return res
}
async function call(handler, req) {
  const res = fakeRes()
  await handler({ headers: { authorization: 'Bearer good-token' }, ...req }, res)
  return res
}

// ---------- synthetic .sav ----------
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b }
const f64 = (n) => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b }
const fixedStr = (s, len) => { const b = Buffer.alloc(len, 0x20); Buffer.from(s, 'utf8').copy(b); return b }
const padTo = (buf, m) => Buffer.concat([buf, Buffer.alloc((m - (buf.length % m)) % m, 0x20)])
function tinySav() {
  const header = Buffer.concat([Buffer.from('$FL2'), fixedStr('synthetic', 60), i32(2), i32(-1), i32(0), i32(0), i32(0), f64(100), fixedStr('01 Jan 26', 9), fixedStr('00:00:00', 8), fixedStr('', 64), Buffer.alloc(3)])
  const label = Buffer.from('ความพึงพอใจ', 'utf8')
  const v = Buffer.concat([i32(2), i32(0), i32(1), i32(0), i32(0x050802), i32(0x050802), fixedStr('SAT', 8), i32(label.length), padTo(label, 4)])
  const s = Buffer.concat([i32(2), i32(8), i32(0), i32(0), i32(0x010800), i32(0x010800), fixedStr('OTH', 8)])
  const lbl = (t) => { const b = Buffer.from(t, 'utf8'); return padTo(Buffer.concat([Buffer.from([b.length]), b]), 8) }
  const vl = Buffer.concat([i32(3), i32(2), f64(1), lbl('พอใจ'), f64(2), lbl(' ไม่พอใจ '), i32(4), i32(1), i32(1)])
  return Buffer.concat([header, v, s, vl, i32(999), i32(0)])
}

// ---------- fixtures ----------
const TOKEN = 'tok_abc'
function fixtures(overrides = {}) {
  return {
    links: {
      [TOKEN]: {
        status: 'active', projectId: 'p1', projectName: 'Proj', codeframeId: 'cf1', codeframeName: 'CF',
        permissions: { comment: true }, emailInvite: { editEmail: 'edit@x.io', ciEmail: 'ci@x.io' },
        secretOwnerUid: 'uid-should-not-leak', createdBy: 'someone@x.io',
        ...overrides.link,
      },
    },
    codeframes: {
      cf1: {
        projectId: 'p1', name: 'Codeframe 1', box: 'oe', clientReviewEnabled: true,
        sheetsJson: JSON.stringify([{ name: 'Q1', codes: [] }]), checkpointsJson: '[]',
        ownerUid: 'owner-should-not-leak', rawdataJson: '{"rows":["secret"]}',
        ...overrides.cf,
      },
    },
  }
}

// ============================================================
// Module wiring
// ============================================================

test('module: initializes firebase-admin once, exports exactly parseSav + reviewCodeframe with region/runtime options', () => {
  const { exports, state } = loadFunctions()
  assert.equal(state.initCalls, 1)
  assert.deepEqual(Object.keys(exports).sort(), ['parseSav', 'reviewCodeframe'])
  for (const fn of Object.values(exports)) {
    assert.deepEqual(fn.__opts, { region: 'asia-southeast1', cors: true, timeoutSeconds: 60, memory: '512MiB' })
  }
  assert.deepEqual(state.requires, ['firebase-functions/v2/https', 'firebase-admin', 'sav-reader'])
  assert.equal(loadFunctions({ appsInitialized: true }).state.initCalls, 0)
})

// ============================================================
// parseSav
// ============================================================

test('parseSav: non-POST -> 405', async () => {
  const { exports } = loadFunctions()
  const res = await call(exports.parseSav, { method: 'GET' })
  assert.deepEqual([res.statusCode, res.json()], [405, { error: 'Method Not Allowed' }])
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
})

test('parseSav: empty body -> 400', async () => {
  const { exports } = loadFunctions()
  for (const req of [{ method: 'POST' }, { method: 'POST', rawBody: Buffer.alloc(0) }, { method: 'POST', body: '' }]) {
    const res = await call(exports.parseSav, req)
    assert.deepEqual([res.statusCode, res.json()], [400, { error: 'ไม่มีไฟล์ .sav' }])
  }
})

test('parseSav: parses a synthetic .sav from rawBody', async () => {
  const { exports } = loadFunctions()
  const res = await call(exports.parseSav, { method: 'POST', rawBody: tinySav() })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), {
    byVar: {
      SAT: { label: 'ความพึงพอใจ', type: 'numeric', values: [{ value: 1, label: 'พอใจ' }, { value: 2, label: 'ไม่พอใจ' }] },
      OTH: { label: '', type: 'string', values: [] },
    },
    varCount: 2,
  })
})

test('parseSav: falls back to req.body when rawBody is absent', async () => {
  const { exports } = loadFunctions()
  const res = await call(exports.parseSav, { method: 'POST', body: tinySav() })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().varCount, 2)
})

test('parseSav: invalid file -> 500 with reason', async () => {
  const { exports } = loadFunctions()
  const res = await call(exports.parseSav, { method: 'POST', rawBody: Buffer.from('not a sav file at all') })
  assert.equal(res.statusCode, 500)
  assert.equal(res.json().error, 'อ่านไฟล์ .sav ไม่สำเร็จ: Not a valid .sav file:not ')
})

test('parseSav: truncated file error message should contain the reason', {
  todo: 'sav-reader rejects truncated input with a plain string; handler uses e.message so the client sees "อ่านไฟล์ .sav ไม่สำเร็จ: undefined" (functions/index.js:164)',
}, async () => {
  const { exports } = loadFunctions()
  const res = await call(exports.parseSav, { method: 'POST', rawBody: tinySav().subarray(0, 60) })
  assert.equal(res.statusCode, 500)
  assert.doesNotMatch(res.json().error, /undefined/)
})

// ============================================================
// reviewCodeframe
// ============================================================

test('reviewCodeframe: OPTIONS preflight -> 204 with permissive CORS', async () => {
  const { exports } = loadFunctions()
  const res = await call(exports.reviewCodeframe, { method: 'OPTIONS' })
  assert.equal(res.statusCode, 204)
  assert.equal(res.body, '')
  assert.deepEqual(res.headers, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  })
})

test('reviewCodeframe: non-POST -> 405', async () => {
  const { exports } = loadFunctions()
  const res = await call(exports.reviewCodeframe, { method: 'GET' })
  assert.deepEqual([res.statusCode, res.json()], [405, { error: 'Method Not Allowed' }])
})

test('reviewCodeframe: token / link / codeframe gatekeeping', async () => {
  const run = async (fx, body) => {
    const { exports } = loadFunctions(fx)
    const res = await call(exports.reviewCodeframe, { method: 'POST', body })
    return [res.statusCode, res.json().error]
  }
  assert.deepEqual(await run(fixtures(), { action: 'get' }), [400, 'Missing review token'])
  assert.deepEqual(await run(fixtures(), { action: 'get', token: '   ' }), [400, 'Missing review token'])
  assert.deepEqual(await run(fixtures(), { action: 'get', token: 'nope' }), [404, 'ลิงก์ Review นี้ไม่ถูกต้องหรือถูกปิดแล้ว'])
  assert.deepEqual(await run(fixtures({ link: { status: 'revoked' } }), { action: 'get', token: TOKEN }), [403, 'ลิงก์ Review นี้ถูกปิดใช้งานแล้ว'])
  assert.deepEqual(await run(fixtures({ link: { codeframeId: '' } }), { action: 'get', token: TOKEN }), [400, 'Review link ไม่มี codeframeId'])
  assert.deepEqual(await run(fixtures({ link: { codeframeId: 'missing' } }), { action: 'get', token: TOKEN }), [404, 'ไม่พบ Codeframe'])
  assert.deepEqual(await run(fixtures({ cf: { clientReviewEnabled: 'true' } }), { action: 'get', token: TOKEN }), [403, 'Codeframe นี้ยังไม่ได้เปิด CI Review'])
  assert.deepEqual(await run(fixtures(), { action: 'bogus', token: TOKEN }), [400, 'Invalid action'])
  assert.deepEqual(await run(fixtures(), { token: TOKEN }), [400, 'Invalid action'])
})

test('reviewCodeframe: token is trimmed before lookup', async () => {
  const { exports, state } = loadFunctions(fixtures())
  const res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'get', token: `  ${TOKEN}  ` } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(state.gets, [['review_links', TOKEN], ['codeframes', 'cf1']])
})

test('reviewCodeframe: link with no status field should not be treated as active', {
}, async () => {
  const { exports } = loadFunctions(fixtures({ link: { status: undefined } }))
  const res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'get', token: TOKEN } })
  assert.equal(res.statusCode, 403)
})

test('reviewCodeframe get: returns sanitized link and codeframe only (no extra fields)', async () => {
  const { exports } = loadFunctions(fixtures())
  const res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'get', token: TOKEN } })
  assert.equal(res.statusCode, 200)
  const out = res.json()
  assert.deepEqual(out.link, {
    token: '', status: 'active', projectId: 'p1', projectName: 'Proj', codeframeId: 'cf1', codeframeName: 'CF',
    reviewSheetQuestions: {}, emailInvite: { editEmail: 'edit@x.io', ciEmail: 'ci@x.io' }, permissions: { comment: true },
    confirmedAt: null, confirmedBy: '', confirmStatus: '', confirmNote: '',
  })
  assert.deepEqual(out.codeframe, {
    id: 'cf1', projectId: 'p1', box: 'oe', name: 'Codeframe 1', createdAt: null,
    sheetsJson: '[{"name":"Q1","codes":[]}]', checkpointsJson: '[]', clientReviewEnabled: true,
    reviewFreqByCode: {}, reviewSheetStatusMap: {}, reviewSheetQuestions: {}, reviewProjectName: '', reviewUpdatedAt: null,
    sheets: [{ name: 'Q1', codes: [] }], checkpoints: [],
  })
  assert.ok(!res.body.includes('should-not-leak'))
  assert.ok(!res.body.includes('rawdata'))
  assert.ok(!res.body.includes('someone@x.io'))
})

test('reviewCodeframe get: invalid sheetsJson degrades to empty sheets', async () => {
  const { exports } = loadFunctions(fixtures({ cf: { sheetsJson: '{broken', checkpointsJson: '[1]' } }))
  const out = (await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'get', token: TOKEN } })).json()
  assert.deepEqual(out.codeframe.sheets, [])
  assert.deepEqual(out.codeframe.checkpoints, [1])
})

test('reviewCodeframe: JSON body accepted as object, rawBody Buffer, or string', async () => {
  const body = JSON.stringify({ action: 'get', token: TOKEN })
  for (const req of [{ body: JSON.parse(body) }, { body: Buffer.from(body), rawBody: Buffer.from(body) }, { body }]) {
    const { exports } = loadFunctions(fixtures())
    const res = await call(exports.reviewCodeframe, { method: 'POST', ...req })
    assert.equal(res.statusCode, 200)
  }
})

test('reviewCodeframe: malformed JSON body should be a 400 client error', {
  todo: 'parseJsonBody throws SyntaxError without a status, so malformed JSON is reported as HTTP 500 (functions/index.js:42,240)',
}, async () => {
  const { exports } = loadFunctions(fixtures())
  const res = await call(exports.reviewCodeframe, { method: 'POST', rawBody: Buffer.from('{oops'), body: Buffer.from('{oops') })
  assert.equal(res.statusCode, 400)
})

test('reviewCodeframe saveCodeframe: validates sheets and audit action', async () => {
  const { exports, state } = loadFunctions(fixtures())
  let res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'saveCodeframe', token: TOKEN, sheets: 'x', auditAction: 'rename_code' } })
  assert.deepEqual([res.statusCode, res.json()], [400, { error: 'Invalid sheets payload' }])
  res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'saveCodeframe', token: TOKEN, sheets: [], auditAction: 'delete_everything' } })
  assert.deepEqual([res.statusCode, res.json()], [400, { error: 'Invalid audit action' }])
  assert.deepEqual(state.updates, [])
  assert.deepEqual(state.audits, [])
})

test('reviewCodeframe saveCodeframe: writes sheetsJson + review maps and logs an audit entry', async () => {
  const { exports, state } = loadFunctions(fixtures())
  const sheets = [{ name: 'Q1', codes: [{ code: 1, label: 'ก' }] }]
  const res = await call(exports.reviewCodeframe, {
    method: 'POST',
    body: {
      action: 'saveCodeframe', token: TOKEN, sheets, auditAction: ' rename_code ', reviewer: '  ',
      reviewFreqByCode: { 1: 3 }, reviewSheetStatusMap: 'not-an-object', payload: { from: 'a', to: 'b' },
    },
  })
  assert.equal(res.statusCode, 200)
  const out = res.json()
  assert.equal(out.ok, true)
  assert.equal(typeof out.update.reviewUpdatedAt, 'number')
  assert.equal(state.updates.length, 1)
  const { collection, id, update } = state.updates[0]
  assert.deepEqual([collection, id], ['codeframes', 'cf1'])
  assert.deepEqual({ ...update, reviewUpdatedAt: 0 }, {
    sheetsJson: JSON.stringify(sheets), reviewFreqByCode: { 1: 3 }, reviewSheetStatusMap: {}, reviewUpdatedAt: 0,
  })
  assert.deepEqual(state.audits, [{
    collection: 'review_audit',
    doc: { token: TOKEN, codeframeId: 'cf1', projectId: 'p1', action: 'rename_code', reviewer: 'CI Reviewer', payload: { from: 'a', to: 'b' }, createdAt: '__SERVER_TS__' },
  }])
})

test('reviewCodeframe: allowed audit actions list', () => {
  const m = SOURCE.match(/const ALLOWED_REVIEW_ACTIONS = new Set\(\[([\s\S]*?)\]\)/)
  const actions = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  assert.deepEqual(actions, [
    'edit_code_cell', 'rename_net', 'rename_code', 'move_code_top', 'move_code_bottom', 'move_code_up',
    'move_code_down', 'merge_code', 'move_code', 'export_codeframe', 'code_comment', 'review_confirm',
  ])
})

test('reviewCodeframe audit: logs allowed actions only; projectId falls back to codeframe', async () => {
  const { exports, state } = loadFunctions(fixtures({ link: { projectId: '' } }))
  let res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'audit', token: TOKEN, auditAction: 'code_comment', reviewer: ' Ann ', payload: { c: 1 } } })
  assert.deepEqual([res.statusCode, res.json()], [200, { ok: true }])
  assert.deepEqual(state.audits[0].doc, { token: TOKEN, codeframeId: 'cf1', projectId: 'p1', action: 'code_comment', reviewer: 'Ann', payload: { c: 1 }, createdAt: '__SERVER_TS__' })
  res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'audit', token: TOKEN, auditAction: 'nope' } })
  assert.deepEqual([res.statusCode, res.json()], [400, { error: 'Invalid review action' }])
  assert.equal(state.audits.length, 1)
})

test('reviewCodeframe confirm: updates link with sending status and logs review_confirm', async () => {
  const { exports, state } = loadFunctions(fixtures())
  const res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'confirm', token: TOKEN, reviewer: 'Bob', note: '  ' } })
  assert.equal(res.statusCode, 200)
  const out = res.json()
  assert.equal(out.editEmail, 'edit@x.io')
  assert.equal(out.ciEmail, 'ci@x.io')
  const { collection, id, update } = state.updates[0]
  assert.deepEqual([collection, id], ['review_links', TOKEN])
  assert.equal(typeof update.confirmedAt, 'number')
  assert.deepEqual({ ...update, confirmedAt: 0 }, {
    confirmedAt: 0, confirmedBy: 'Bob', confirmEmailTo: 'edit@x.io', confirmNote: 'ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ', confirmStatus: 'sending',
  })
  assert.equal(state.audits[0].doc.action, 'review_confirm')
  assert.deepEqual(state.audits[0].doc.payload, { confirmedBy: 'Bob', editEmail: 'edit@x.io', ciEmail: 'ci@x.io', note: 'ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ' })
})

test('reviewCodeframe confirm: legacy link.editEmail is used; no e-mail -> no_edit_email', async () => {
  let { exports, state } = loadFunctions(fixtures({ link: { emailInvite: null, editEmail: 'legacy@x.io' } }))
  await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'confirm', token: TOKEN } })
  assert.equal(state.updates[0].update.confirmEmailTo, 'legacy@x.io')
  assert.equal(state.updates[0].update.confirmedBy, 'CI Reviewer')
  ;({ exports, state } = loadFunctions(fixtures({ link: { emailInvite: {} } })))
  const res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'confirm', token: TOKEN } })
  assert.equal(res.json().editEmail, '')
  assert.equal(state.updates[0].update.confirmStatus, 'no_edit_email')
})

test('reviewCodeframe confirmEmailStatus: whitelist of statuses and field mapping', async () => {
  const { exports, state } = loadFunctions(fixtures({ link: { confirmNote: 'stored note' } }))
  let res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'confirmEmailStatus', token: TOKEN, status: 'sending' } })
  assert.deepEqual([res.statusCode, res.json()], [400, { error: 'Invalid confirm status' }])

  res = await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'confirmEmailStatus', token: TOKEN, status: 'emailed', emailId: 42 } })
  assert.deepEqual([res.statusCode, res.json()], [200, { ok: true }])
  const emailed = state.updates[0].update
  assert.equal(typeof emailed.confirmEmailSentAt, 'number')
  assert.deepEqual({ ...emailed, confirmEmailSentAt: 0 }, { confirmStatus: 'emailed', confirmEmailSentAt: 0, confirmEmailId: '42', confirmNote: 'stored note' })

  await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'confirmEmailStatus', token: TOKEN, status: ' email_failed ', error: 'smtp' } })
  assert.deepEqual(state.updates[1].update, { confirmStatus: 'email_failed', confirmError: 'smtp' })
  await call(exports.reviewCodeframe, { method: 'POST', body: { action: 'confirmEmailStatus', token: TOKEN, status: 'no_edit_email' } })
  assert.deepEqual(state.updates[2].update, { confirmStatus: 'no_edit_email', confirmError: '' })
  assert.equal(state.audits.length, 0, 'status updates are not audited')
})

test('reviewCodeframe: unexpected errors (no status) surface as 500 with the error message', async () => {
  const { exports } = loadFunctions(fixtures())
  // JSON body "null" -> body.action throws TypeError inside the handler
  const res = await call(exports.reviewCodeframe, { method: 'POST', body: null, rawBody: Buffer.from('null') })
  assert.equal(res.statusCode, 500)
  assert.match(res.json().error, /Cannot read properties of null/)
})


// ---------- security fix 2026-11: parseSav requires an approved, logged-in user ----------
test('parseSav: missing / malformed / invalid token -> 401 and the file is never parsed', async () => {
  for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer nope' }]) {
    const { exports, state } = loadFunctions()
    const res = await call(exports.parseSav, { method: 'POST', headers, rawBody: tinySav() })
    assert.equal(res.statusCode, 401, JSON.stringify(headers))
    assert.ok(!state.gets.some(([c]) => c === 'users'), 'no profile lookup without a verified token')
  }
})

test('parseSav: valid token but user not approved (pending / missing profile) -> 403', async () => {
  for (const users of [{ u1: { status: 'pending' } }, { u1: { status: 'rejected' } }, {}]) {
    const { exports } = loadFunctions({ users })
    const res = await call(exports.parseSav, { method: 'POST', rawBody: tinySav() })
    assert.equal(res.statusCode, 403, JSON.stringify(users))
    assert.match(res.json().error, /ยังไม่ได้รับอนุมัติ/)
  }
})

test('parseSav: approved user is allowed and the profile lookup uses the token uid', async () => {
  const { exports, state } = loadFunctions()
  const res = await call(exports.parseSav, { method: 'POST', rawBody: tinySav() })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(state.gets.find(([c]) => c === 'users'), ['users', 'u1'])
})
