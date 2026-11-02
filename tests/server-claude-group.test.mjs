// Characterization tests for server/claudeGroup.mjs
// - OpenRouter path: import โมดูลจริง + stub globalThis.fetch (ไม่มี network)
// - Claude/Codex CLI path: โหลด source ผ่าน vm.compileFunction แล้ว inject spawn/readFile ปลอม
//   (ไม่ spawn process จริง ไม่อ่านไฟล์จริง ไม่ใช้ timer จริง)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import {
  runClaudeGrouping, runClaudeCoding, runClaudeReview, runClaudeSpellcheck,
  runClaudeAssign, runClaudeGroupCE, listOpenRouterModels,
} from '../server/claudeGroup.mjs'

const SOURCE_URL = new URL('../server/claudeGroup.mjs', import.meta.url)
const OR_OPTS = { provider: 'openrouter', model: 'test/model', apiKey: 'sk-test-key' }

// ---------- fetch stub helpers ----------
function okJson(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }
}
function chat(content) { return okJson({ choices: [{ message: { content } }] }) }
async function withFetch(impl, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init, calls.length) }
  try { return await fn(calls) } finally { globalThis.fetch = original }
}
const promptOf = (call) => JSON.parse(call.init.body).messages[1].content

// ============================================================
// OpenRouter provider (real module, stubbed fetch)
// ============================================================

test('OpenRouter request: endpoint, auth header, system+user messages, temperature 0', async () => {
  await withFetch(() => chat('{"nets":[]}'), async (calls) => {
    await runClaudeGrouping([{ text: 'a', count: 1 }], OR_OPTS)
    assert.equal(calls.length, 1)
    const { url, init } = calls[0]
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.Authorization, 'Bearer sk-test-key')
    assert.equal(init.headers['Content-Type'], 'application/json')
    assert.equal(init.headers['X-Title'], 'Codeframe Studio')
    assert.equal(init.headers['HTTP-Referer'], 'http://localhost:5173')
    assert.ok(init.signal, 'request must be abortable')
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'test/model')
    assert.equal(body.temperature, 0)
    assert.equal(body.messages.length, 2)
    assert.equal(body.messages[0].role, 'system')
    assert.match(body.messages[0].content, /output only a single JSON object/)
    assert.equal(body.messages[1].role, 'user')
  })
})

test('runClaudeGrouping: prompt lists codes as "<index> (x<count>) <text>" (missing count -> x0)', async () => {
  await withFetch(() => chat('{"nets":[]}'), async (calls) => {
    await runClaudeGrouping([{ text: 'ราคาแพง', count: 5 }, { text: 'ไกล' }], OR_OPTS)
    const prompt = promptOf(calls[0])
    assert.match(prompt, /\n0 \(x5\) ราคาแพง\n1 \(x0\) ไกล$/)
    assert.match(prompt, /\{"nets":\[\{"name":"<thai theme>","codeIndexes":\[<indexes>\]\}\]\}/)
  })
})

test('runClaudeGrouping: extracts JSON wrapped in prose and normalizes nets', async () => {
  const content = 'Sure! ```json\n' + JSON.stringify({
    nets: [
      { name: '  ราคา  ', codeIndexes: [0, '1', 99, -1, 1.5] }, // out-of-range/float dropped, "1" coerced
      { name: '', codeIndexes: [2] }, //                                  empty name -> 'กลุ่ม'
      { name: 'ซ้ำ', codeIndexes: [0, 1] }, //                            all already used -> net dropped
      { name: 'ไม่มี index' },
    ],
  }) + '\n``` hope this helps'
  await withFetch(() => chat(content), async () => {
    const codes = [0, 1, 2, 3, 4].map((i) => ({ text: `c${i}`, count: 1 }))
    const out = await runClaudeGrouping(codes, OR_OPTS)
    assert.deepEqual(out, {
      nets: [
        { name: 'ราคา', codeIndexes: [0, 1] },
        { name: 'กลุ่ม', codeIndexes: [2] },
        { name: 'อื่น ๆ', codeIndexes: [3, 4] }, // leftovers always collected
      ],
    })
  })
})

test('runClaudeGrouping: an index repeated inside the same net should appear once', {
  todo: 'normalizeGrouping only adds to `seen` after filtering a net, so duplicates within one net survive (server/claudeGroup.mjs:56-59) — violates "every index exactly once"',
}, async () => {
  await withFetch(() => chat('{"nets":[{"name":"a","codeIndexes":[0,0,1]}]}'), async () => {
    const out = await runClaudeGrouping([{ text: 'x' }, { text: 'y' }], OR_OPTS)
    assert.deepEqual(out, { nets: [{ name: 'a', codeIndexes: [0, 1] }] })
  })
})

test('OpenRouter errors are wrapped with the per-mode Thai prefix', async () => {
  const cases = [
    [runClaudeGrouping, [[{ text: 'a' }]], 'จัดกลุ่มด้วย AI ไม่สำเร็จ: '],
    [runClaudeCoding, [[{ text: 'a' }]], 'โค้ดดิ้งด้วย AI ไม่สำเร็จ: '],
    [runClaudeReview, [[{ text: 'a' }]], 'รีวิวด้วย AI ไม่สำเร็จ: '],
    [runClaudeSpellcheck, [[{ i: 0, text: 'a' }]], 'ตรวจตัวสะกดด้วย AI ไม่สำเร็จ: '],
    [runClaudeAssign, [[{ i: 0, label: 'x' }], [{ i: 0, text: 'a' }]], 'จับ verbatim เข้ารหัสด้วย AI ไม่สำเร็จ: '],
    [runClaudeGroupCE, [[{ i: 0, label: 'x' }], [{ i: 0, text: 'a' }]], 'Group CE ด้วย AI ไม่สำเร็จ: '],
  ]
  await withFetch(() => chat('no json here'), async () => {
    for (const [fn, args, prefix] of cases) {
      await assert.rejects(fn(...args, OR_OPTS), (e) => {
        assert.equal(e.message, `${prefix}no JSON object in model output`)
        return true
      })
    }
  })
})

test('OpenRouter: missing apiKey / model fail before any network call', async () => {
  await withFetch(() => chat('{}'), async (calls) => {
    await assert.rejects(runClaudeGrouping([{ text: 'a' }], { provider: 'openrouter', model: 'm' }),
      { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: ยังไม่ได้ตั้งค่า OpenRouter API key' })
    await assert.rejects(runClaudeGrouping([{ text: 'a' }], { provider: 'openrouter', apiKey: 'k' }),
      { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: ยังไม่ได้เลือกโมเดล OpenRouter' })
    assert.equal(calls.length, 0)
  })
})

test('OpenRouter: HTTP error includes status and first 300 chars of body', async () => {
  const longBody = 'x'.repeat(400)
  await withFetch(() => ({ ok: false, status: 429, text: async () => longBody }), async () => {
    await assert.rejects(runClaudeGrouping([{ text: 'a' }], OR_OPTS), (e) => {
      assert.equal(e.message, `จัดกลุ่มด้วย AI ไม่สำเร็จ: OpenRouter HTTP 429: ${'x'.repeat(300)}`)
      return true
    })
  })
})

test('OpenRouter: empty content and AbortError map to Thai messages', async () => {
  await withFetch(() => chat(''), async () => {
    await assert.rejects(runClaudeGrouping([{ text: 'a' }], OR_OPTS), { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: OpenRouter ไม่มีผลลัพธ์กลับมา' })
  })
  await withFetch(() => okJson({}), async () => {
    await assert.rejects(runClaudeGrouping([{ text: 'a' }], OR_OPTS), { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: OpenRouter ไม่มีผลลัพธ์กลับมา' })
  })
  await withFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }, async () => {
    await assert.rejects(runClaudeGrouping([{ text: 'a' }], OR_OPTS), { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: OpenRouter หมดเวลา (timeout)' })
  })
})

test('runClaudeCoding: normalizes codes (label/text, net/netName fallbacks) and assign arrays', async () => {
  const content = JSON.stringify({
    codes: [
      { label: ' ไกล ', net: ' ระยะทาง ' },
      { text: 'แพง', netName: 'ราคา' },
      { label: 'ไม่มี net' },
      { label: 'net ว่าง', net: '   ' },
    ],
    assign: [[0, 1, 1, 9, -1], 2, null, ['3', 'x']],
  })
  await withFetch(() => chat(content), async (calls) => {
    const verbatims = [{ text: 'v0', count: 2 }, { text: 'v1' }, { text: 'v2' }, { text: 'v3' }, { text: 'v4' }]
    const out = await runClaudeCoding(verbatims, OR_OPTS)
    assert.deepEqual(out, {
      codes: [
        { label: 'ไกล', net: 'ระยะทาง' },
        { label: 'แพง', net: 'ราคา' },
        { label: 'ไม่มี net', net: 'อื่น ๆ' },
        { label: 'net ว่าง', net: 'อื่น ๆ' },
      ],
      assign: [[0, 1], [2], [], [3], []], // always one entry per verbatim
    })
    assert.match(promptOf(calls[0]), /\nVerbatims:\n0 \(x2\) v0\n1 \(x0\) v1/)
  })
})

test('runClaudeCoding: non-array codes/assign yield empty codes and empty assignments', async () => {
  await withFetch(() => chat('{"codes":"nope","assign":{}}'), async () => {
    assert.deepEqual(await runClaudeCoding([{ text: 'a' }, { text: 'b' }], OR_OPTS), { codes: [], assign: [[], []] })
  })
})

test('runClaudeCoding: codes dropped for empty label should not shift assign indexes', {
  todo: 'normalizeCoding filters empty-label codes BEFORE resolving assign indexes, so model index 1 (code "A") becomes out of range and is lost (server/claudeGroup.mjs:303-317)',
}, async () => {
  await withFetch(() => chat(JSON.stringify({ codes: [{ label: '' }, { label: 'A', net: 'N' }], assign: [[1]] })), async () => {
    const out = await runClaudeCoding([{ text: 'v' }], OR_OPTS)
    assert.deepEqual(out.codes, [{ label: 'A', net: 'N' }])
    assert.deepEqual(out.assign, [[0]])
  })
})

test('runClaudeReview: prompt includes current draft codes ("—" when none) and reuses coding normalization', async () => {
  await withFetch(() => chat('{"codes":[{"label":"A","net":"N"}],"assign":[[0]]}'), async (calls) => {
    const out = await runClaudeReview([
      { text: 'v0', count: 3, current: ['เดิม1', '', 'เดิม2'] },
      { text: 'v1' },
    ], OR_OPTS)
    const prompt = promptOf(calls[0])
    assert.match(prompt, /\n0 \(x3\) \[draft: เดิม1 \/ เดิม2\] v0\n1 \(x0\) \[draft: —\] v1/)
    assert.deepEqual(out, { codes: [{ label: 'A', net: 'N' }], assign: [[0], []] })
  })
})

test('runClaudeAssign: invalid entries become -1; result length equals verbatim count', async () => {
  await withFetch(() => chat('{"assign":[1,"0",5,-1,2.5,"x"]}'), async (calls) => {
    const codes = [{ i: 0, label: 'ก' }, { i: 1, label: 'ข' }]
    const verbatims = Array.from({ length: 7 }, (_, i) => ({ i, text: `v${i}`, count: i }))
    const out = await runClaudeAssign(codes, verbatims, OR_OPTS)
    assert.deepEqual(out, { assign: [1, 0, -1, -1, -1, -1, -1] })
    const prompt = promptOf(calls[0])
    assert.match(prompt, /Existing codes \(index: label\):\n0: ก\n1: ข\n/)
    assert.match(prompt, /\n0 \(x0\) v0\n1 \(x1\) v1/)
  })
})

test('runClaudeAssign: null / "" / false from the model should mean "no match" (-1), not code 0', {
  todo: 'normalizeAssign uses Number(raw[i]); Number(null), Number("") and Number(false) are 0, so they silently map to code index 0 (server/claudeGroup.mjs:453)',
}, async () => {
  await withFetch(() => chat('{"assign":[null,"",false]}'), async () => {
    const out = await runClaudeAssign([{ i: 0, label: 'ก' }], [{ i: 0, text: 'a' }, { i: 1, text: 'b' }, { i: 2, text: 'c' }], OR_OPTS)
    assert.deepEqual(out, { assign: [-1, -1, -1] })
  })
})

test('runClaudeGroupCE: numbers -> {existing}, non-empty strings -> {neo}, anything else -> null', async () => {
  await withFetch(() => chat('{"assign":[0," ใหม่ ","1",3,1.5,"  ",{"existing":0},null]}'), async () => {
    const codes = [{ i: 0, label: 'ก' }, { i: 1, label: 'ข' }]
    const verbatims = Array.from({ length: 9 }, (_, i) => ({ i, text: `v${i}` }))
    const out = await runClaudeGroupCE(codes, verbatims, OR_OPTS)
    assert.deepEqual(out.assign, [
      { existing: 0 },
      { neo: 'ใหม่' },
      { neo: '1' }, // numeric strings are treated as NEW labels, not indexes
      null, null, null,
      null, //         object form is not accepted here (unlike scripts/ai-runner.mjs)
      null, null,
    ])
  })
})

test('runClaudeSpellcheck: keeps only fixes for known indexes with non-empty text', async () => {
  const content = JSON.stringify({
    fixes: [
      { i: 0, fixed: ' โรงพยาบาล ', reason: ' สะกด ' },
      { i: '2', fixed: 'คลินิก' },
      { i: 5, fixed: 'unknown index' },
      { i: 0.5, fixed: 'float' },
      { i: 2, fixed: '   ' },
    ],
  })
  await withFetch(() => chat(content), async (calls) => {
    const out = await runClaudeSpellcheck([{ i: 0, text: 'โรงพยาบาน' }, { i: '2', text: 'คลีนิค' }], OR_OPTS)
    assert.deepEqual(out, { fixes: [{ i: 0, fixed: 'โรงพยาบาล', reason: 'สะกด' }, { i: 2, fixed: 'คลินิก', reason: '' }] })
    assert.match(promptOf(calls[0]), /\nLines:\n0\tโรงพยาบาน\n2\tคลีนิค$/)
  })
})

test('listOpenRouterModels: public endpoint, free detection, sorted by id, entries without id dropped', async () => {
  const data = {
    data: [
      { id: 'z/paid', name: 'Z', pricing: { prompt: '0.001', completion: '0.002' } },
      { id: 'a/free:free', pricing: { prompt: '1', completion: '1' } },
      { id: 'm/zero', name: 'M', pricing: { prompt: '0', completion: 0 } },
      { id: 'b/nopricing' }, // missing pricing counts as free
      { name: 'no id' },
    ],
  }
  await withFetch(() => okJson(data), async (calls) => {
    const models = await listOpenRouterModels()
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/models')
    assert.equal(calls[0].init, undefined, 'no auth header / options sent')
    assert.deepEqual(models, [
      { id: 'a/free:free', name: 'a/free:free', free: true },
      { id: 'b/nopricing', name: 'b/nopricing', free: true },
      { id: 'm/zero', name: 'M', free: true },
      { id: 'z/paid', name: 'Z', free: false },
    ])
  })
  await withFetch(() => ({ ok: false, status: 503 }), async () => {
    await assert.rejects(listOpenRouterModels(), { message: 'OpenRouter HTTP 503' })
  })
})

// ============================================================
// CLI providers (claude / codex) — source loaded with fake spawn
// ============================================================

function loadWithFakes({ env = {}, platform = 'linux', existing = [], spawnPlan = {}, readFileImpl } = {}) {
  let src = fs.readFileSync(SOURCE_URL, 'utf8')
  const importCount = (src.match(/^import .*$/gm) || []).length
  assert.equal(importCount, 5, 'claudeGroup.mjs import list changed — update the test loader')
  src = src.replace(/^import .*$/gm, '').replace(/^export /gm, '')
  src += '\nreturn { runClaudeGrouping, runClaudeCoding, runClaudeReview, runClaudeSpellcheck, runClaudeAssign, runClaudeGroupCE, resolveClaudeExe, resolveCodexExe, SYSTEM_PROMPT }'

  const spawnCalls = []
  const timers = []
  const fs_ = { reads: [], unlinks: [] }
  function spawn(exe, args, opts) {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const stdinChunks = []
    child.killed = false
    child.kill = () => { child.killed = true }
    child.stdin = {
      write: (b) => stdinChunks.push(Buffer.from(b)),
      end: () => {
        queueMicrotask(() => {
          if (spawnPlan.error) return child.emit('error', spawnPlan.error)
          if (spawnPlan.hang) return
          if (spawnPlan.stdout != null) child.stdout.emit('data', spawnPlan.stdout)
          if (spawnPlan.stderr != null) child.stderr.emit('data', spawnPlan.stderr)
          child.emit('close', spawnPlan.code ?? 0)
        })
      },
    }
    spawnCalls.push({ exe, args, opts, child, stdin: () => Buffer.concat(stdinChunks).toString('utf8') })
    return child
  }
  const fakeProcess = { platform, env }
  const mod = vm.compileFunction(src, ['spawn', 'existsSync', 'readFile', 'unlink', 'tmpdir', 'join', 'process', 'setTimeout', 'clearTimeout', 'fetch'])(
    spawn,
    (p) => existing.includes(p),
    async (p, enc) => { fs_.reads.push([p, enc]); return readFileImpl ? readFileImpl(p) : '' },
    async (p) => { fs_.unlinks.push(p) },
    () => '/fake-tmp',
    (...parts) => parts.join('/'),
    fakeProcess,
    (cb, ms) => { const t = { cb, ms, cleared: false }; timers.push(t); return t },
    (t) => { if (t) t.cleared = true },
    async () => { throw new Error('network disabled in tests') },
  )
  return { mod, spawnCalls, timers, fs: fs_ }
}

const envelope = (result, extra = {}) => JSON.stringify({ type: 'result', result, ...extra })

test('claude provider (default): on Linux the fallback "claude" exe is spawned WITHOUT a shell, default model per mode', async () => {
  const expectations = [
    ['runClaudeGrouping', [[{ text: 'a' }]], 'sonnet', '{"nets":[]}'],
    ['runClaudeCoding', [[{ text: 'a' }]], 'haiku', '{"codes":[]}'],
    ['runClaudeReview', [[{ text: 'a' }]], 'haiku', '{"codes":[]}'],
    ['runClaudeAssign', [[], [{ i: 0, text: 'a' }]], 'haiku', '{"assign":[]}'],
    ['runClaudeGroupCE', [[], [{ i: 0, text: 'a' }]], 'sonnet', '{"assign":[]}'],
    ['runClaudeSpellcheck', [[{ i: 0, text: 'a' }]], 'sonnet', '{"fixes":[]}'],
  ]
  for (const [name, args, model, json] of expectations) {
    const { mod, spawnCalls, timers } = loadWithFakes({ spawnPlan: { stdout: envelope(json) } })
    await mod[name](...args)
    assert.equal(spawnCalls.length, 1, name)
    const call = spawnCalls[0]
    assert.equal(call.exe, 'claude', name)
    assert.deepEqual(call.args.slice(0, 5), ['-p', '--output-format', 'json', '--model', model], name)
    assert.ok(call.args.includes('--system-prompt'), 'no shell → trimmed-overhead flags are passed')
    assert.equal(call.opts.shell, false, name)
    assert.equal(call.opts.windowsHide, true, name)
    assert.equal(timers.length, 1)
    assert.equal(timers[0].cleared, true, 'timeout timer is cleared on close')
  }
})

test('claude provider: timeout defaults (300s; 240s for assign/spellcheck; caller override wins)', async () => {
  const run = async (name, args, opts) => {
    const { mod, timers } = loadWithFakes({ spawnPlan: { stdout: envelope('{}') } })
    await mod[name](...args, opts)
    return timers[0].ms
  }
  assert.equal(await run('runClaudeGrouping', [[{ text: 'a' }]]), 300000)
  assert.equal(await run('runClaudeAssign', [[], []]), 240000)
  assert.equal(await run('runClaudeSpellcheck', [[]]), 240000)
  assert.equal(await run('runClaudeSpellcheck', [[]], { timeoutMs: 5 }), 5)
})

test('claude provider: prompt goes to stdin as UTF-8; envelope result is parsed', async () => {
  const { mod, spawnCalls } = loadWithFakes({ spawnPlan: { stdout: envelope('prefix {"nets":[{"name":"ก","codeIndexes":[0]}]}') } })
  const out = await mod.runClaudeGrouping([{ text: 'ภาษาไทย', count: 2 }])
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { nets: [{ name: 'ก', codeIndexes: [0] }] })
  assert.match(spawnCalls[0].stdin(), /\n0 \(x2\) ภาษาไทย$/)
})

test('claude provider: CLAUDE_BIN that exists is spawned directly (no shell) with trimmed-down flags', async () => {
  const { mod, spawnCalls } = loadWithFakes({
    env: { CLAUDE_BIN: '/opt/claude' }, existing: ['/opt/claude'], spawnPlan: { stdout: envelope('{"nets":[]}') },
  })
  await mod.runClaudeGrouping([{ text: 'a' }], { model: 'opus' })
  const { exe, args, opts } = spawnCalls[0]
  assert.equal(exe, '/opt/claude')
  assert.equal(opts.shell, false)
  assert.deepEqual(args, [
    '-p', '--output-format', 'json', '--model', 'opus',
    '--system-prompt', mod.SYSTEM_PROMPT,
    '--tools', '',
    '--disable-slash-commands', '--strict-mcp-config', '--exclude-dynamic-system-prompt-sections',
  ])
})

test('claude provider: CLAUDE_BIN that does not exist falls back to "claude"; win32 APPDATA path is probed', () => {
  assert.equal(loadWithFakes({ env: { CLAUDE_BIN: '/missing' } }).mod.resolveClaudeExe(), 'claude')
  const winExe = 'C:/AppData/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
  assert.equal(loadWithFakes({ platform: 'win32', env: { APPDATA: 'C:/AppData' }, existing: [winExe] }).mod.resolveClaudeExe(), winExe)
  assert.equal(loadWithFakes({ platform: 'linux', env: { APPDATA: 'C:/AppData' }, existing: [winExe] }).mod.resolveClaudeExe(), 'claude')
})

test('claude provider: is_error envelope, non-zero exit, spawn error and timeout are reported', async () => {
  let f = loadWithFakes({ spawnPlan: { stdout: envelope('rate limited', { is_error: true }) } })
  await assert.rejects(f.mod.runClaudeGrouping([{ text: 'a' }]), { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: rate limited' })

  f = loadWithFakes({ spawnPlan: { code: 2, stderr: 'E'.repeat(400) } })
  await assert.rejects(f.mod.runClaudeGrouping([{ text: 'a' }]), { message: `จัดกลุ่มด้วย AI ไม่สำเร็จ: claude ออกด้วยรหัส 2: ${'E'.repeat(300)}` })

  f = loadWithFakes({ spawnPlan: { error: new Error('ENOENT') } })
  await assert.rejects(f.mod.runClaudeGrouping([{ text: 'a' }]), { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: เรียก claude ไม่สำเร็จ: ENOENT' })

  f = loadWithFakes({ spawnPlan: { stdout: 'not json' } })
  await assert.rejects(f.mod.runClaudeGrouping([{ text: 'a' }]), /^Error: จัดกลุ่มด้วย AI ไม่สำเร็จ: /)

  f = loadWithFakes({ spawnPlan: { hang: true } })
  const pending = f.mod.runClaudeGrouping([{ text: 'a' }])
  await new Promise((r) => setImmediate(r))
  f.timers[0].cb() // fire the fake timeout
  await assert.rejects(pending, { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: Claude CLI หมดเวลา (timeout)' })
  assert.equal(f.spawnCalls[0].child.killed, true)
})

test('codex provider: runs "codex exec" read-only, prompt = SYSTEM_PROMPT + prompt on stdin, result read from --output-last-message file', async () => {
  const f = loadWithFakes({ readFileImpl: () => '{"nets":[{"name":"x","codeIndexes":[0]}]}' })
  const out = await f.mod.runClaudeGrouping([{ text: 'a' }], { provider: 'codex', model: 'gpt-5' })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { nets: [{ name: 'x', codeIndexes: [0] }] })
  const { exe, args, opts, stdin } = f.spawnCalls[0]
  assert.equal(exe, 'codex')
  assert.equal(opts.shell, false, 'Linux: codex is spawned directly, never through a shell')
  const outFile = args[args.indexOf('--output-last-message') + 1]
  assert.match(outFile, /^\/fake-tmp\/codex-out-\d+-\d+\.txt$/)
  assert.deepEqual(args, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'model_reasoning_effort=low', '--output-last-message', outFile, '-m', 'gpt-5', '-'])
  assert.ok(stdin().startsWith(`${f.mod.SYSTEM_PROMPT}\n\n`))
  assert.deepEqual(f.fs.reads, [[outFile, 'utf8']])
  assert.deepEqual(f.fs.unlinks, [outFile])
})

test('codex provider: no model -> no -m flag; CODEX_BIN .exe runs without shell', async () => {
  let f = loadWithFakes({ readFileImpl: () => '{}' })
  await f.mod.runClaudeGrouping([{ text: 'a' }], { provider: 'codex' })
  assert.ok(!f.spawnCalls[0].args.includes('-m'))
  f = loadWithFakes({ env: { CODEX_BIN: 'C:/bin/codex.exe' }, existing: ['C:/bin/codex.exe'], readFileImpl: () => '{}' })
  await f.mod.runClaudeGrouping([{ text: 'a' }], { provider: 'codex' })
  assert.equal(f.spawnCalls[0].exe, 'C:/bin/codex.exe')
  assert.equal(f.spawnCalls[0].opts.shell, false)
})

test('codex provider: empty output file and unreadable output file are errors', async () => {
  let f = loadWithFakes({ readFileImpl: () => '  \n', spawnPlan: { code: 1, stderr: 'boom' } })
  await assert.rejects(f.mod.runClaudeGrouping([{ text: 'a' }], { provider: 'codex' }), { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: codex ไม่มีผลลัพธ์ (exit 1): boom' })
  f = loadWithFakes({ readFileImpl: () => { throw new Error('ENOENT') }, spawnPlan: { code: 3 } })
  await assert.rejects(f.mod.runClaudeGrouping([{ text: 'a' }], { provider: 'codex' }), { message: 'จัดกลุ่มด้วย AI ไม่สำเร็จ: อ่านผลลัพธ์ codex ไม่สำเร็จ (exit 3): ' })
})

test('claude provider: model from request must not reach a shell unescaped', async () => {
  const f = loadWithFakes({ spawnPlan: { stdout: envelope('{"nets":[]}') } })
  await f.mod.runClaudeGrouping([{ text: 'a' }], { model: 'sonnet; touch /tmp/pwned' }).catch(() => {})
  const unsafe = f.spawnCalls.some((c) => c.opts.shell && c.args.some((a) => /[;&|`$<>]/.test(a)))
  assert.equal(unsafe, false)
})

test('codex provider: model from request must not reach a shell unescaped', async () => {
  const f = loadWithFakes({ readFileImpl: () => '{}' })
  await f.mod.runClaudeGrouping([{ text: 'a' }], { provider: 'codex', model: 'x $(id)' }).catch(() => {})
  const unsafe = f.spawnCalls.some((c) => c.opts.shell && c.args.some((a) => /[;&|`$<>]/.test(a)))
  assert.equal(unsafe, false)
})


// ---------- security fix 2026-11: model allow-list + shell only on Windows ----------
test('unsafe model names are rejected before anything is spawned (claude + codex, Linux + Windows)', async () => {
  const bad = ['sonnet; touch /tmp/pwned', 'x $(id)', 'a`id`', 'a|b', 'a&b', '--dangerously-skip-permissions', '-m', 'a b', 'a\nb', 'x'.repeat(200), { toString: () => 'sonnet' }]
  for (const platform of ['linux', 'win32']) {
    for (const provider of ['claude', 'codex']) {
      for (const model of bad) {
        const f = loadWithFakes({ platform, env: { APPDATA: 'C:/AppData' }, spawnPlan: { stdout: envelope('{"nets":[]}') }, readFileImpl: () => '{}' })
        await assert.rejects(f.mod.runClaudeGrouping([{ text: 'a' }], { provider, model }), /model ไม่ถูกต้อง/, `${platform}/${provider}/${String(model).slice(0, 20)}`)
        assert.equal(f.spawnCalls.length, 0)
      }
    }
  }
})

test('safe model names (aliases, provider/model ids, versions) are accepted', async () => {
  for (const model of ['sonnet', 'haiku', 'claude-sonnet-4-5', 'gpt-5.5', 'anthropic/claude-3.5:beta', 'org/model@v1']) {
    const f = loadWithFakes({ spawnPlan: { stdout: envelope('{"nets":[]}') } })
    await f.mod.runClaudeGrouping([{ text: 'a' }], { model })
    assert.equal(f.spawnCalls[0].args[f.spawnCalls[0].args.indexOf('--model') + 1], model)
  }
})

test('Windows keeps the shell fallback only for non-.exe binaries (model already validated)', async () => {
  const f = loadWithFakes({ platform: 'win32', env: { APPDATA: 'C:/AppData' }, spawnPlan: { stdout: envelope('{"nets":[]}') } })
  await f.mod.runClaudeGrouping([{ text: 'a' }], { model: 'sonnet' })
  assert.equal(f.spawnCalls[0].exe, 'claude')
  assert.equal(f.spawnCalls[0].opts.shell, true)
})
