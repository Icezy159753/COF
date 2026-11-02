// Characterization tests for src/lib/spss.js — ล็อกพฤติกรรมปัจจุบันของทุก export
// - parseSavCodebook: stub fetch (ไม่มี network จริง) ใช้ Blob/File ปลอม ไม่ต้องมีไฟล์ .sav จริง
// - VITE_AI_API_BASE ถูกอ่านตอนโหลดโมดูล → โหลดสำเนาผ่าน data: URL พร้อมแทน import.meta.env แบบเดียวกับ
//   tests/support/env-loader.mjs (ตั้ง process.env ตอนรันไม่ถึง loader thread) · spss.js ไม่มี import อื่น
// - ข้อมูลสังเคราะห์ทั้งหมด
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as spss from '../src/lib/spss.js'

const API_AUTH_URL = new URL('../src/lib/apiAuth.js', import.meta.url).href
const SOURCE = readFileSync(new URL('../src/lib/spss.js', import.meta.url), 'utf8')
async function loadSpss(tag, viteEnv = {}) {
  const env = { MODE: 'test', DEV: false, PROD: false, ...viteEnv }
  const code = `// case: ${tag}\n` + SOURCE.replaceAll('import.meta.env', `(${JSON.stringify(env)})`)
    // data: URL resolve relative import ไม่ได้ → ชี้ apiAuth.js ด้วย file URL (ใช้ instance เดียวกับเทสต์)
    .replaceAll("from './apiAuth.js'", `from '${API_AUTH_URL}'`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const spssDefault = await loadSpss('default')
const spssBase = await loadSpss('base', { VITE_AI_API_BASE: 'https://runner.example.test/' })

const NOW = 1_700_000_000_000
const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const textResponse = (text, status = 200) => new Response(text, { status })

function stubFetch(t, responder) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init })
    return responder(url, init)
  })
  return calls
}

const fakeSav = (name = 'synthetic.sav') => new File([new Uint8Array([0x24, 0x46, 0x4c, 0x32, 1, 2, 3])], name)

describe('parseSavCodebook', () => {
  test('POSTs the file itself as octet-stream to /api/parse-sav', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW })
    const calls = stubFetch(t, () => jsonResponse({ byVar: {}, varCount: 0 }))
    const file = fakeSav()
    await spssDefault.parseSavCodebook(file)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/parse-sav')
    assert.equal(calls[0].init.method, 'POST')
    assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/octet-stream' })
    assert.equal(calls[0].init.body, file) // ส่ง File ตรง ๆ ไม่แปลง
  })

  test('prefixes VITE_AI_API_BASE (trailing slash stripped)', async (t) => {
    const calls = stubFetch(t, () => jsonResponse({ byVar: {} }))
    await spssBase.parseSavCodebook(fakeSav())
    assert.equal(calls[0].url, 'https://runner.example.test/api/parse-sav')
  })

  test('normalizes byVar and computes counts / metadata', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW })
    stubFetch(t, () =>
      jsonResponse({
        byVar: {
          Q1: { label: 'เพศ', type: 'numeric', values: [{ value: 1, label: 'ชาย' }, { value: 2, label: 'หญิง' }] },
          Q1_oth: { label: 'อื่นๆ ระบุ', type: 'string', values: [] },
          Q2: { label: 123, type: 'numeric', values: 'not-an-array', extra: 'dropped' },
          Q3: { type: 'string' },
          Q4: null,
        },
        varCount: 99,
        somethingElse: true,
      }),
    )
    const out = await spssDefault.parseSavCodebook(fakeSav('wave1.sav'))
    assert.deepEqual(out, {
      byVar: {
        Q1: { label: 'เพศ', values: [{ value: 1, label: 'ชาย' }, { value: 2, label: 'หญิง' }], type: 'numeric' },
        Q1_oth: { label: 'อื่นๆ ระบุ', values: [], type: 'string' },
        Q2: { label: '123', values: [], type: 'numeric' },
        Q3: { label: '', values: [], type: 'string' },
        Q4: { label: '', values: [], type: undefined },
      },
      varCount: 99, // ใช้ค่าจาก server ถ้ามี (แม้ไม่ตรงกับจำนวน key)
      valueLabelCount: 1,
      fileName: 'wave1.sav',
      updatedAt: NOW,
    })
    assert.deepEqual(Object.keys(out.byVar), ['Q1', 'Q1_oth', 'Q2', 'Q3', 'Q4']) // คงลำดับตัวแปร
  })

  test('varCount falls back to number of byVar keys; varCount 0 is kept (??)', async (t) => {
    stubFetch(t, () => jsonResponse({ byVar: { A: {}, B: {} } }))
    assert.equal((await spssDefault.parseSavCodebook(fakeSav())).varCount, 2)
    t.mock.restoreAll()
    stubFetch(t, () => jsonResponse({ byVar: { A: {}, B: {} }, varCount: 0 }))
    assert.equal((await spssDefault.parseSavCodebook(fakeSav())).varCount, 0)
    t.mock.restoreAll()
    stubFetch(t, () => jsonResponse({ byVar: { A: {} }, varCount: null }))
    assert.equal((await spssDefault.parseSavCodebook(fakeSav())).varCount, 1)
  })

  test('missing byVar → empty codebook', async (t) => {
    stubFetch(t, () => jsonResponse({}))
    const out = await spssDefault.parseSavCodebook(fakeSav())
    assert.deepEqual(out.byVar, {})
    assert.equal(out.varCount, 0)
    assert.equal(out.valueLabelCount, 0)
  })

  test('Blob without name → fileName undefined', async (t) => {
    stubFetch(t, () => jsonResponse({ byVar: {} }))
    const out = await spssDefault.parseSavCodebook(new Blob([new Uint8Array([1])]))
    assert.equal(out.fileName, undefined)
  })

  test('updatedAt is Date.now() at parse time', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 42 })
    stubFetch(t, () => jsonResponse({ byVar: {} }))
    assert.equal((await spssDefault.parseSavCodebook(fakeSav())).updatedAt, 42)
  })

  test('HTML response (even with leading whitespace) → Thai "endpoint not ready" error', async (t) => {
    stubFetch(t, () => textResponse('  \n<!doctype html><html><body>SPA fallback</body></html>'))
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), {
      message: 'เซิร์ฟเวอร์ตอบกลับเป็น HTML ไม่ใช่ JSON — endpoint /api/parse-sav ยังไม่พร้อมบนเว็บสด',
    })
  })

  test('HTTP error with JSON {error} → Error(error)', async (t) => {
    stubFetch(t, () => jsonResponse({ error: 'ไฟล์ .sav เสีย' }, 422))
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), { name: 'Error', message: 'ไฟล์ .sav เสีย' })
  })

  test('HTTP error with non-JSON / no error field → generic message with status', async (t) => {
    stubFetch(t, () => textResponse('<html>413</html>', 413))
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 413' })
    t.mock.restoreAll()
    stubFetch(t, () => jsonResponse({ detail: 'x' }, 500))
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), { message: 'เซิร์ฟเวอร์ตอบกลับ HTTP 500' })
  })

  test('success with malformed / empty JSON → SyntaxError', async (t) => {
    stubFetch(t, () => textResponse('{"byVar": '))
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), SyntaxError)
    t.mock.restoreAll()
    stubFetch(t, () => textResponse(''))
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), SyntaxError)
  })

  test('success with JSON null body → TypeError (data.byVar on null)', async (t) => {
    stubFetch(t, () => textResponse('null'))
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), TypeError)
  })

  test('network failure propagates the original error', async (t) => {
    const boom = new TypeError('fetch failed')
    t.mock.method(globalThis, 'fetch', async () => {
      throw boom
    })
    await assert.rejects(spssDefault.parseSavCodebook(fakeSav()), (err) => err === boom)
  })
})

// codebook สังเคราะห์: ตัวแปร .sav ตามลำดับคอลัมน์ 0..4
const YESNO = [{ value: 1, label: 'ใช่' }, { value: 2, label: 'ไม่ใช่' }]
const makeCodebook = () => ({
  byVar: {
    S1: { label: 'เพศ', type: 'numeric', values: [{ value: 1, label: 'ชาย' }, { value: 2, label: 'หญิง' }] },
    B6_1: { label: 'เหตุผล (1)', type: 'numeric', values: YESNO },
    B6_2: { label: 'เหตุผล (2)', type: 'numeric', values: YESNO },
    B6_oth: { label: 'อื่นๆ ระบุ', type: 'string', values: [] },
    AGE: { label: 'อายุ', type: 'numeric' },
  },
  varCount: 5,
  fileName: 'synthetic.sav',
  updatedAt: 1,
})

describe('remapCodebookByPosition', () => {
  test('no questions → ok:false with "upload Rawdata first" error', () => {
    const err = { ok: false, error: 'ยังไม่มี Rawdata (Excel) ในโปรเจกต์นี้ — กรุณาอัปโหลด Rawdata ก่อนแนบ .sav' }
    assert.deepEqual(spss.remapCodebookByPosition(makeCodebook(), []), err)
    assert.deepEqual(spss.remapCodebookByPosition(makeCodebook(), null), err)
    assert.deepEqual(spss.remapCodebookByPosition(makeCodebook(), undefined), err)
    assert.deepEqual(spss.remapCodebookByPosition(null, []), err)
  })

  test('maps by column position (not by name); MA uses its first (lowest) column', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW })
    const questions = [
      { label: 'gender', index: 0, columns: [0] },
      { label: 'B6', index: 1, columns: [2, 1] }, // MA, ลำดับใน columns ไม่มีผล ใช้ min
      { label: 'B6 อื่นๆ', index: 3, columns: [3] },
      { label: 'age', index: 4 }, // ไม่มี columns → ใช้ index
    ]
    const res = spss.remapCodebookByPosition(makeCodebook(), questions)
    assert.equal(res.ok, true)
    assert.deepEqual(res.codebook, {
      byVar: {
        gender: { label: 'เพศ', values: makeCodebook().byVar.S1.values, code: 'S1', type: 'numeric' },
        B6: { label: 'เหตุผล (1)', values: YESNO, code: 'B6_1', type: 'numeric' },
        'B6 อื่นๆ': { label: 'อื่นๆ ระบุ', values: [], code: 'B6_oth', type: 'string' },
        age: { label: 'อายุ', values: undefined, code: 'AGE', type: 'numeric' },
      },
      varCount: 4,
      valueLabelCount: 2, // gender + B6 (B6 อื่นๆ ว่าง, age ไม่มี values)
      fileName: 'synthetic.sav',
      updatedAt: NOW,
    })
  })

  test('values array is shared by reference with the source codebook', () => {
    const cb = makeCodebook()
    const res = spss.remapCodebookByPosition(cb, [{ label: 'x', columns: [0, 1, 2, 3, 4] }])
    assert.equal(res.codebook.byVar.x.values, cb.byVar.S1.values)
  })

  test('does not mutate the input codebook', () => {
    const cb = makeCodebook()
    const before = structuredClone(cb)
    spss.remapCodebookByPosition(cb, [{ label: 'x', columns: [0, 1, 2, 3, 4] }])
    assert.deepEqual(cb, before)
  })

  test('column count = max column index + 1 across all questions (gaps allowed)', () => {
    // คอลัมน์ 1-3 ไม่มีข้อใดอ้าง แต่ max=4 → 5 คอลัมน์ ตรงกับ 5 ตัวแปร
    const res = spss.remapCodebookByPosition(makeCodebook(), [
      { label: 'a', index: 0 },
      { label: 'b', index: 4 },
    ])
    assert.equal(res.ok, true)
    assert.deepEqual(Object.keys(res.codebook.byVar), ['a', 'b'])
    assert.equal(res.codebook.byVar.b.code, 'AGE')
  })

  test('variable/column count mismatch → ok:false with both counts in the message', () => {
    const res = spss.remapCodebookByPosition(makeCodebook(), [{ label: 'a', index: 0, columns: [0, 1, 2] }])
    assert.deepEqual(res, {
      ok: false,
      error:
        'จำนวนตัวแปรไม่เท่ากัน — Excel มี 3 คอลัมน์ แต่ .sav มี 5 ตัวแปร ' +
        'จึงแมพตามลำดับไม่ได้ กรุณาตรวจสอบให้ไฟล์ Excel กับ .sav มีจำนวน/ลำดับตัวแปรตรงกัน',
    })
    const more = spss.remapCodebookByPosition(makeCodebook(), [{ label: 'a', index: 7 }])
    assert.equal(more.ok, false)
    assert.match(more.error, /Excel มี 8 คอลัมน์ แต่ \.sav มี 5 ตัวแปร/)
  })

  test('null codebook with questions → mismatch (0 variables)', () => {
    const res = spss.remapCodebookByPosition(null, [{ label: 'a', index: 0 }])
    assert.equal(res.ok, false)
    assert.match(res.error, /Excel มี 1 คอลัมน์ แต่ \.sav มี 0 ตัวแปร/)
  })

  test('question without columns or index → NaN column count → mismatch error mentioning NaN', () => {
    const res = spss.remapCodebookByPosition(makeCodebook(), [{ label: 'a' }])
    assert.equal(res.ok, false)
    assert.match(res.error, /Excel มี NaN คอลัมน์/)
  })

  test('question with empty columns [] is skipped (no variable at Infinity)', () => {
    const res = spss.remapCodebookByPosition(makeCodebook(), [
      { label: 'empty', index: 0, columns: [] },
      { label: 'last', index: 4, columns: [4] },
    ])
    assert.equal(res.ok, true)
    assert.deepEqual(Object.keys(res.codebook.byVar), ['last'])
    assert.equal(res.codebook.varCount, 1)
  })

  test('duplicate question labels: last wins in byVar but valueLabelCount counts both', () => {
    const res = spss.remapCodebookByPosition(makeCodebook(), [
      { label: 'dup', index: 0 },
      { label: 'dup', index: 1 },
      { label: 'z', index: 4 },
    ])
    assert.equal(res.ok, true)
    assert.equal(res.codebook.byVar.dup.code, 'B6_1')
    assert.equal(res.codebook.varCount, 2)
    assert.equal(res.codebook.valueLabelCount, 2) // ไม่สอดคล้องกับ varCount (ดูรายงาน)
  })

  test('empty codebook and zero-column questions → ok with empty byVar', () => {
    const res = spss.remapCodebookByPosition({ byVar: {}, fileName: 'e.sav' }, [{ label: 'a', columns: [] }])
    assert.equal(res.ok, true)
    assert.deepEqual(res.codebook.byVar, {})
    assert.equal(res.codebook.varCount, 0)
    assert.equal(res.codebook.fileName, 'e.sav')
  })
})

describe('codebookForQuestion', () => {
  const cb = makeCodebook()

  test('returns the byVar entry (same reference) keyed by question.label', () => {
    assert.equal(spss.codebookForQuestion(cb, { label: 'S1' }), cb.byVar.S1)
  })

  test('unknown label → null', () => {
    assert.equal(spss.codebookForQuestion(cb, { label: 'NOPE' }), null)
    assert.equal(spss.codebookForQuestion(cb, {}), null)
  })

  test('missing codebook / byVar / question → null', () => {
    assert.equal(spss.codebookForQuestion(null, { label: 'S1' }), null)
    assert.equal(spss.codebookForQuestion(undefined, { label: 'S1' }), null)
    assert.equal(spss.codebookForQuestion({}, { label: 'S1' }), null)
    assert.equal(spss.codebookForQuestion({ byVar: null }, { label: 'S1' }), null)
    assert.equal(spss.codebookForQuestion(cb, null), null)
    assert.equal(spss.codebookForQuestion(cb, undefined), null)
  })

  test('entry explicitly undefined/null → null', () => {
    assert.equal(spss.codebookForQuestion({ byVar: { A: undefined, B: null } }, { label: 'A' }), null)
    assert.equal(spss.codebookForQuestion({ byVar: { A: undefined, B: null } }, { label: 'B' }), null)
  })

  test('does not match by code, only by label key', () => {
    const remapped = { byVar: { gender: { label: 'เพศ', code: 'S1', values: [] } } }
    assert.equal(spss.codebookForQuestion(remapped, { label: 'S1' }), null)
    assert.equal(spss.codebookForQuestion(remapped, { label: 'gender' }), remapped.byVar.gender)
  })
})

describe('valueSignature', () => {
  test('empty / missing values → null', () => {
    assert.equal(spss.valueSignature(undefined), null)
    assert.equal(spss.valueSignature(null), null)
    assert.equal(spss.valueSignature([]), null)
  })

  test('format: value\\u0001label pairs, sorted, joined by \\u0002', () => {
    assert.equal(
      spss.valueSignature([{ value: 2, label: 'ไม่ใช่' }, { value: 1, label: 'ใช่' }]),
      '1\u0001ใช่\u00022\u0001ไม่ใช่',
    )
  })

  test('order-insensitive', () => {
    const a = [{ value: 1, label: 'A' }, { value: 2, label: 'B' }, { value: 3, label: 'C' }]
    assert.equal(spss.valueSignature(a), spss.valueSignature([...a].reverse()))
  })

  test('numeric and string values with the same text are equal', () => {
    assert.equal(spss.valueSignature([{ value: 1, label: 'x' }]), spss.valueSignature([{ value: '1', label: 'x' }]))
  })

  test('different label or value → different signature', () => {
    const base = spss.valueSignature([{ value: 1, label: 'ใช่' }])
    assert.notEqual(base, spss.valueSignature([{ value: 1, label: 'ใช่ ' }]))
    assert.notEqual(base, spss.valueSignature([{ value: 2, label: 'ใช่' }]))
    assert.notEqual(base, spss.valueSignature([{ value: 1, label: 'ใช่' }, { value: 2, label: 'ไม่' }]))
  })

  test('separator prevents value/label boundary collisions', () => {
    assert.notEqual(
      spss.valueSignature([{ value: '1', label: '0A' }]),
      spss.valueSignature([{ value: '10', label: 'A' }]),
    )
  })

  test('duplicates are kept (multiset, not set)', () => {
    const one = spss.valueSignature([{ value: 1, label: 'A' }])
    const two = spss.valueSignature([{ value: 1, label: 'A' }, { value: 1, label: 'A' }])
    assert.notEqual(one, two)
  })

  test('sort is lexicographic on the combined string (not numeric)', () => {
    assert.equal(
      spss.valueSignature([{ value: 2, label: 'b' }, { value: 10, label: 'a' }]),
      '10\u0001a\u00022\u0001b',
    )
  })

  test('missing value/label are stringified ("undefined"/"null")', () => {
    assert.equal(spss.valueSignature([{}]), 'undefined\u0001undefined')
    assert.equal(spss.valueSignature([{ value: null, label: null }]), 'null\u0001null')
  })

  test('does not mutate input array order', () => {
    const vals = [{ value: 2, label: 'b' }, { value: 1, label: 'a' }]
    spss.valueSignature(vals)
    assert.deepEqual(vals, [{ value: 2, label: 'b' }, { value: 1, label: 'a' }])
  })
})

describe('findSameFrameQuestions', () => {
  const SAT = [{ value: 1, label: 'พอใจ' }, { value: 2, label: 'ไม่พอใจ' }]
  const cb = {
    byVar: {
      Q3: { values: [...SAT].reverse() }, // ลำดับต่างแต่โครงเดียวกัน
      Q1: { values: SAT },
      Q2: { values: [{ value: 1, label: 'พอใจ' }] },
      Q4: { values: SAT },
      Q5: { values: [] },
      Q6: {},
    },
  }
  const q1 = { label: 'Q1', index: 1 }
  const q2 = { label: 'Q2', index: 2 }
  const q3 = { label: 'Q3', index: 0 }
  const q4 = { label: 'Q4', index: 9 }
  const q5 = { label: 'Q5', index: 5 }
  const q6 = { label: 'Q6', index: 6 }
  const qNo = { label: 'NotInCodebook', index: 7 }
  const questions = [q4, q2, q1, q5, q6, qNo, q3]

  test('returns all questions with identical value frame (incl. itself), sorted by index', () => {
    const res = spss.findSameFrameQuestions(cb, questions, q1)
    assert.deepEqual(res, [q3, q1, q4])
    assert.equal(res[1], q1) // same object references
  })

  test('result is a new array; input questions untouched', () => {
    const copy = [...questions]
    const res = spss.findSameFrameQuestions(cb, questions, q4)
    assert.notEqual(res, questions)
    assert.deepEqual(questions, copy)
  })

  test('unique frame → only itself', () => {
    assert.deepEqual(spss.findSameFrameQuestions(cb, questions, q2), [q2])
  })

  test('no value labels (empty / missing / not in codebook) → [question]', () => {
    assert.deepEqual(spss.findSameFrameQuestions(cb, questions, q5), [q5])
    assert.deepEqual(spss.findSameFrameQuestions(cb, questions, q6), [q6])
    assert.deepEqual(spss.findSameFrameQuestions(cb, questions, qNo), [qNo])
  })

  test('missing codebook / byVar → [question]; missing question → [question] (i.e. [null]/[undefined])', () => {
    assert.deepEqual(spss.findSameFrameQuestions(null, questions, q1), [q1])
    assert.deepEqual(spss.findSameFrameQuestions({}, questions, q1), [q1])
    assert.deepEqual(spss.findSameFrameQuestions(cb, questions, null), [null])
    assert.deepEqual(spss.findSameFrameQuestions(cb, questions, undefined), [undefined])
  })

  test('selected question not present in the questions list → only the other matches (self not added)', () => {
    assert.deepEqual(spss.findSameFrameQuestions(cb, [q4, q2], q1), [q4])
    assert.deepEqual(spss.findSameFrameQuestions(cb, [], q1), [])
  })

  test('missing index sorts as 0; ties keep original order (stable sort)', () => {
    const a = { label: 'Q1' }
    const b = { label: 'Q4', index: 0 }
    const c = { label: 'Q3', index: -1 }
    assert.deepEqual(spss.findSameFrameQuestions(cb, [a, b, c], a), [c, a, b])
  })

  test('questions arg is required when a signature exists (null → TypeError)', () => {
    assert.throws(() => spss.findSameFrameQuestions(cb, null, q1), TypeError)
  })

  test('works with a remapped codebook (keys are question labels)', () => {
    const questionsRaw = [
      { label: 'gender', index: 0, columns: [0] },
      { label: 'B6', index: 1, columns: [1, 2] },
      { label: 'B6 อื่นๆ', index: 3, columns: [3] },
      { label: 'age', index: 4 },
    ]
    const cbYes = makeCodebook()
    cbYes.byVar.S1.values = YESNO // ให้ S1 ใช้โครงเดียวกับ B6
    const { codebook } = spss.remapCodebookByPosition(cbYes, questionsRaw)
    assert.deepEqual(
      spss.findSameFrameQuestions(codebook, questionsRaw, questionsRaw[1]).map((q) => q.label),
      ['gender', 'B6'],
    )
  })
})


test('parseSavCodebook attaches the Firebase ID token from apiAuth', async (t) => {
  const apiAuth = await import(API_AUTH_URL)
  apiAuth.setApiTokenProvider(() => 'sav-token')
  t.after(() => apiAuth.setApiTokenProvider(null))
  let seen
  t.mock.method(globalThis, 'fetch', async (url, init) => { seen = init; return new Response(JSON.stringify({ byVar: {} }), { status: 200 }) })
  const spss = await import('../src/lib/spss.js')
  await spss.parseSavCodebook(new Blob([new Uint8Array([1, 2, 3])]))
  assert.equal(seen.headers.Authorization, 'Bearer sav-token')
  assert.equal(seen.headers['Content-Type'], 'application/octet-stream')
})
