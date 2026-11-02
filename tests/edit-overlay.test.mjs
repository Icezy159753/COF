// src/lib/editOverlay.js — ไฮไลต์จุดที่แก้ใน Rawdata ชุดเดียวกัน (CE ลง Code + แก้ข้อความจาก Verbatim/Codeframe)
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEditOverlay, verbatimContext } from '../src/lib/editOverlay.js'
import { textKey } from '../src/lib/verbatim.js'

const rawdata = {
  headers: ['SbjNum', 'Q1', 'Q1_oth', 'Q2_text'],
  questions: [
    { id: 'sbj', label: 'SbjNum', index: 0 },
    { id: 'q1', label: 'Q1', index: 1 },
    { id: 'q1o', label: 'Q1_oth', index: 2 },
    { id: 'q2', label: 'Q2_text', index: 3 },
  ],
}
const cfg = { sbjNumId: 'sbj', questionIds: ['q2'], aiFixed: [textKey(3, 'รู้สึกดี')] }
const original = { rows: [['1', '99', 'แบรนด์เอ', 'รุ้สึกดี'], ['2', '1', '', 'ราคาถูก'], ['3', '2', '', 'อร่อย']] }

describe('buildEditOverlay', () => {
  test('classifies CE code stamps, Verbatim edits (AI/Human) and other text edits', () => {
    const ctx = verbatimContext(rawdata, cfg)
    // แถว 1: CE ลง Code 99→5 (mask) + Verbatim AI แก้ · แถว 2: Verbatim คนแก้ · แถว 3: แก้ข้อความ Q1_oth จากหน้า Codeframe
    const rows = [['1', '5', 'แบรนด์เอ', 'รู้สึกดี'], ['2', '1', '', 'ราคาถูกมาก'], ['3', '2', 'เพิ่มเอง', 'อร่อย']]
    const o = buildEditOverlay({ rows, original, headers: rawdata.headers, ceMaskRows: [new Set([1]), null, null], ...ctx })
    assert.equal(o.kinds[0].get(1), 'code')
    assert.equal(o.kinds[0].get(3), 'verbatim')
    assert.equal(o.kinds[1].get(3), 'verbatim')
    assert.equal(o.kinds[2].get(2), 'text')
    assert.equal(o.kinds[2].size, 1)
    assert.deepEqual([...o.editedCols].sort(), [1, 2, 3])
    assert.deepEqual(o.counts, { code: 1, verbatim: 2, text: 1 })
    assert.deepEqual(o.log.map((e) => [e.row, e.sbj, e.header, e.original, e.current, e.source]), [
      [1, '1', 'Q2_text', 'รุ้สึกดี', 'รู้สึกดี', 'Verbatim · AI แก้'],
      [2, '2', 'Q2_text', 'ราคาถูก', 'ราคาถูกมาก', 'Verbatim · Human แก้'],
      [3, '3', 'Q1_oth', '', 'เพิ่มเอง', 'แก้ข้อความ (Codeframe / อื่น ๆ)'],
    ])
  })

  test('matches original rows by SbjNum when the order differs', () => {
    const ctx = verbatimContext(rawdata, cfg)
    const rows = [['3', '2', '', 'อร่อย'], ['1', '99', 'แบรนด์เอ', 'รุ้สึกดี']]
    const o = buildEditOverlay({ rows, original, headers: rawdata.headers, ...ctx })
    assert.equal(o.editedCols.size, 0, 'same content in a different order is not an edit')
  })

  test('without original only CE masks are highlighted', () => {
    const o = buildEditOverlay({ rows: [['1', '5']], original: null, ceMaskRows: [new Set([1])] })
    assert.equal(o.kinds[0].get(1), 'code')
    assert.equal(o.log.length, 0)
  })
})
