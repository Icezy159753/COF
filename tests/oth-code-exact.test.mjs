import test from 'node:test'
import assert from 'node:assert/strict'
import { otherCodeFromColumnLabel, otherColumnsForCode, findOtherColumns, scopedVerbatimQuestionIds } from '../src/lib/boxes.js'

const rawdata = {
  questions: [
    { id: 'q01', label: 's13_1_01', index: 0, columns: [0, 1] },
    { id: 'q13oth', label: 's13_1_13_oth', index: 2, columns: [2] },
    { id: 'q211oth', label: 's13_1_211_oth', index: 3, columns: [3] },
    { id: 'q212oth', label: 's13_1_212_oth', index: 4, columns: [4] },
  ],
  rows: [
    ['13', '211', 'กาแฟ', 'ส้ม', 'ชา'],
  ],
}
const codebook = {
  byVar: {
    s13_1_01: { values: [{ value: '13', label: 'อื่นๆ ระบุ' }, { value: '211', label: 'ส้ม' }, { value: '212', label: 'ชา' }] },
  },
}

test('otherCodeFromColumnLabel maps exact final code before _oth', () => {
  assert.equal(otherCodeFromColumnLabel('s13_1_13_oth'), '13')
  assert.equal(otherCodeFromColumnLabel('s13_1_211_oth'), '211')
  assert.equal(otherCodeFromColumnLabel('s13_1_212_oth'), '212')
  assert.notEqual(otherCodeFromColumnLabel('s13_1_211_oth'), '13')
})

test('otherColumnsForCode returns only exact matching Other text column', () => {
  const question = rawdata.questions[0]
  assert.deepEqual(otherColumnsForCode(rawdata, question, codebook, '13').map((q) => q.label), ['s13_1_13_oth'])
  assert.deepEqual(otherColumnsForCode(rawdata, question, codebook, '211').map((q) => q.label), ['s13_1_211_oth'])
  assert.deepEqual(otherColumnsForCode(rawdata, question, codebook, '212').map((q) => q.label), ['s13_1_212_oth'])
})

test('findOtherColumns stops after explicit Other column instead of absorbing the next OE question', () => {
  const prodLikeRawdata = {
    questions: [
      { id: 'q3825', label: 'q475', index: 0, columns: [0, 1] },
      { id: 'q3855', label: 'q475_oth', index: 2, columns: [2] },
      { id: 'q3856', label: 'q649', index: 3, columns: [3] },
    ],
    rows: [
      ['3', '6', '', 'ขอบยางยืดบริเวณเอวไม่ยืดหยุ่น'],
      ['', '', '', 'หนาเกินไปทำให้ลูกเทอะทะ'],
    ],
  }
  const prodLikeCodebook = {
    byVar: {
      q475: { values: [{ value: '30', label: 'อื่นๆ ระบุ' }] },
    },
  }

  assert.deepEqual(
    findOtherColumns(prodLikeRawdata, prodLikeRawdata.questions[0], prodLikeCodebook).map((q) => q.label),
    ['q475_oth'],
  )
})

test('findOtherColumns rejects a following standalone question even when it contains text', () => {
  const prodLikeRawdata = {
    questions: [
      { id: 'q427', label: 'q427', index: 0, columns: [0] },
      { id: 'q428', label: 'q428', index: 1, columns: [1] },
    ],
    rows: [
      ['17', 'ราคาแพง'],
      ['18', 'ราคาแพงเกินไป'],
    ],
  }
  const prodLikeCodebook = {
    byVar: {
      q427: { values: [{ value: '17', label: 'อื่นๆ ระบุ' }] },
    },
  }

  assert.deepEqual(findOtherColumns(prodLikeRawdata, prodLikeRawdata.questions[0], prodLikeCodebook), [])
})

test('scopedVerbatimQuestionIds keeps CE answers inside their owning Codeframe question', () => {
  const prodLikeRawdata = {
    questions: [
      { id: 'q1154', label: 'q1154', index: 0, columns: [0] },
      { id: 'q1154oth', label: 'q1154_oth', index: 1, columns: [1] },
      { id: 'q1155', label: 'q1155', index: 2, columns: [2] },
    ],
    rows: [['1', '', 'ราคาแพง']],
  }
  const prodLikeCodebook = {
    byVar: {
      q1154: { values: [{ value: '99', label: 'อื่นๆ ระบุ' }] },
    },
  }

  assert.deepEqual(
    scopedVerbatimQuestionIds(prodLikeRawdata, ['q1154', 'q1154oth', 'q1155'], prodLikeCodebook),
    ['q1154oth'],
  )
})

test('CodeframeEditor delete path restricts code-specific Other deletion to same base group', async () => {
  const fs = await import('node:fs')
  const editor = fs.readFileSync(new URL('../src/pages/CodeframeEditor.jsx', import.meta.url), 'utf8')
  assert.match(editor, /otherCodeFromColumnLabel\(textLabel\)/)
  assert.match(editor, /\.filter\(\(\[base\]\) => base === linkedBase\)/)
})

test('CodeframeEditor sheet status ignores Other text already covered by manual recode rule', async () => {
  const fs = await import('node:fs')
  const editor = fs.readFileSync(new URL('../src/pages/CodeframeEditor.jsx', import.meta.url), 'utf8')
  assert.match(editor, /sourceTextsByOtherCodeId/)
  assert.match(editor, /sourceTextsForRuleLocal\(\{ sourceCodeId: codeId \}\)/)
  assert.match(editor, /return !sourceTextsForOtherCode\(id\)\.has\(keyText\)/)
})

test('CodeframeEditor sheet status uses original raw verbatim keys, not overwritten export labels', async () => {
  const fs = await import('node:fs')
  const editor = fs.readFileSync(new URL('../src/pages/CodeframeEditor.jsx', import.meta.url), 'utf8')
  assert.match(editor, /assignments keyed ด้วยข้อความต้นฉบับ/)
  assert.match(editor, /const statusOpenAnswers = uniqueAnswers\(rawdata, openIds\)/)
  assert.doesNotMatch(editor, /const statusOpenAnswers = uniqueAnswers\(statusRawdata, openIds\)/)
})
