// src/lib/verbatim.js — สถานะเซลล์/สรุปรายข้อของกล่อง Verbatim (หน้าสรุป + หน้าแก้ใช้ร่วมกัน)
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, cellStatus, computeVerbatimStats, isEditable, makeOrigRowAt, parseTsv, textKey, toTsvColumn, verbatimQuestions } from '../src/lib/verbatim.js'

const Q1 = { id: 'q1', label: 'Q1', index: 1 }
const Q2 = { id: 'q2', label: 'Q2', index: 2 }
const SBJ = { id: 'sbj', label: 'SbjNum', index: 0 }
const MA = { id: 'ma', label: 'MA', index: 3, columns: [3, 4] }

describe('verbatim helpers', () => {
  test('textKey is stable, short and depends on column + text', () => {
    assert.equal(textKey(1, 'ดีมาก'), textKey(1, 'ดีมาก'))
    assert.notEqual(textKey(1, 'ดีมาก'), textKey(2, 'ดีมาก'))
    assert.notEqual(textKey(1, 'ดีมาก'), textKey(1, 'ดีมากๆ'))
    assert.match(textKey(7, 'x'.repeat(5000)), /^7:[0-9a-z]{1,7}$/)
  })

  test('cellValue joins MA columns and trims; isEditable only for single column', () => {
    assert.equal(cellValue(['', ' a ', '', 'x', 'y'], MA), 'x | y')
    assert.equal(cellValue(['', ' a '], Q1), 'a')
    assert.equal(isEditable(Q1), true)
    assert.equal(isEditable(MA), false)
  })

  test('verbatimQuestions keeps configured order and drops SbjNum / unknown ids', () => {
    const qs = verbatimQuestions({ questionIds: ['q2', 'sbj', 'nope', 'q1'], sbjNumId: 'sbj' }, [SBJ, Q1, Q2])
    assert.deepEqual(qs.map((q) => q.id), ['q2', 'q1'])
  })

  test('makeOrigRowAt matches by index, then by SbjNum, else current row', () => {
    const orig = { rows: [['1', 'a'], ['2', 'b'], ['3', 'c']] }
    const at = makeOrigRowAt(orig, SBJ)
    assert.deepEqual(at(['1', 'A'], 0), ['1', 'a'])
    assert.deepEqual(at(['3', 'C'], 1), ['3', 'c']) // index ไม่ตรง SbjNum → หาตาม SbjNum
    const fresh = ['9', 'new']
    assert.equal(at(fresh, 5), fresh) // แถวใหม่ที่ไม่มีในต้นฉบับ
    assert.equal(makeOrigRowAt(null, SBJ)(fresh, 0), fresh)
  })

  test('cellStatus covers every label', () => {
    const aiOk = new Set([textKey(1, 'ok text')])
    const aiFixed = new Set([textKey(1, 'fixed')])
    assert.equal(cellStatus(Q1, '', '', aiOk, aiFixed), '')
    assert.equal(cellStatus(Q1, 'fxied', 'fixed', aiOk, aiFixed), 'ai')
    assert.equal(cellStatus(Q1, 'old', 'typed by hand', aiOk, aiFixed), 'human')
    assert.equal(cellStatus(Q1, 'ok text', 'ok text', aiOk, aiFixed), 'ok')
    assert.equal(cellStatus(Q1, 'other', 'other', aiOk, aiFixed), 'pending')
    assert.equal(cellStatus(MA, 'x | y', 'x | y', aiOk, aiFixed), 'locked')
    assert.equal(cellStatus(Q1, 'old', '', aiOk, aiFixed), 'human') // ลบข้อความทิ้ง = คนแก้
    // ไม่มีต้นฉบับให้เทียบ แต่ข้อความตรงกับที่ AI แก้ให้ → นับว่าตรวจแล้ว (ไม่ค้าง)
    assert.equal(cellStatus(Q1, 'fixed', 'fixed', aiOk, aiFixed), 'ok')
    // คนดูแล้ว (วางทั้งคอลัมน์กลับมาเหมือนต้นฉบับ) → Human ดูแล้ว OK และไม่ค้าง
    assert.equal(cellStatus(Q1, 'other', 'other', aiOk, aiFixed, new Set([textKey(1, 'other')])), 'hok')
    // AI ชี้ว่ามั่ว/ไม่ได้ใจความ → รอคนเช็ค · คนกด OK แล้ว → Human ดูแล้ว OK · คนแก้ข้อความ → Human แก้
    const aiFlag = new Map([[textKey(1, 'ฟหกดฟหก'), 'พิมพ์มั่ว']])
    assert.equal(cellStatus(Q1, 'ฟหกดฟหก', 'ฟหกดฟหก', aiOk, aiFixed, new Set(), aiFlag), 'flag')
    assert.equal(cellStatus(Q1, 'ฟหกดฟหก', 'ฟหกดฟหก', aiOk, aiFixed, new Set([textKey(1, 'ฟหกดฟหก')]), aiFlag), 'hok')
    assert.equal(cellStatus(Q1, 'ฟหกดฟหก', 'ไม่ระบุ', aiOk, aiFixed, new Set(), aiFlag), 'human')
  })

  test('TSV column round-trips Excel-style quoting (newline, tab, quotes, empty)', () => {
    const vals = ['ธรรมดา', 'สอง\nบรรทัด', 'มี "คำพูด"', 'มี\ttab', '', 'ท้าย']
    const back = parseTsv(toTsvColumn(vals)).map((r) => r[0])
    assert.deepEqual(back, vals)
    // แบบที่ Excel ส่งมา: CRLF ท้ายบรรทัด + เซลล์หลายบรรทัดครอบด้วย "
    assert.deepEqual(parseTsv('a\r\n"b\nc"\r\nd\r\n').map((r) => r[0]), ['a', 'b\nc', 'd'])
    assert.deepEqual(parseTsv('x\ty\r\nz\tw'), [['x', 'y'], ['z', 'w']])
  })

  test('computeVerbatimStats counts per question and done = no pending', () => {
    const orig = { rows: [['1', 'aa', 'x'], ['2', 'bb', 'y'], ['3', '', 'z']] }
    const rows = [['1', 'aa', 'x!'], ['2', 'bb', 'y'], ['3', '', 'z']]
    const stats = computeVerbatimStats({
      rows,
      qs: [Q1, Q2],
      origRowAt: makeOrigRowAt(orig, SBJ),
      aiOk: new Set([textKey(1, 'aa'), textKey(1, 'bb'), textKey(2, 'y')]),
      aiFixed: new Set([textKey(2, 'x!')]),
      aiFlag: new Map([[textKey(2, 'z'), 'ไม่ได้ใจความ']]),
    })
    assert.deepEqual(stats.get('q1'), { answered: 2, human: 0, ai: 0, hok: 0, ok: 2, flag: 0, pending: 0, locked: 0, done: true })
    assert.deepEqual(stats.get('q2'), { answered: 3, human: 0, ai: 1, hok: 0, ok: 1, flag: 1, pending: 0, locked: 0, done: false })
  })
})
