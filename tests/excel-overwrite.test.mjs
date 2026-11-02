import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildOverwrittenRawdata, parseFrameFile } from '../src/lib/excel.js'

test('buildOverwrittenRawdata overwrites closed-end Other code and keeps Verbatim aligned to the assigned Codeframe label', () => {
  const rawdata = {
    headers: ['SbjNum', 'q1', 'q1_oth'],
    rows: [
      ['001', '99', 'กาแฟพิเศษ'],
      ['002', '1', ''],
    ],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 'q1', label: 'q1', index: 1, columns: [1] },
      { id: 'q1_oth', label: 'q1_oth', index: 2, columns: [2] },
    ],
  }
  const codebook = {
    byVar: {
      q1: {
        values: [
          { value: '1', label: 'ร้านกาแฟ' },
          { value: '99', label: 'อื่นๆ ระบุ' },
        ],
      },
    },
  }
  const codeframe = {
    sheets: [{
      name: 'q1',
      questionIds: ['q1', 'q1_oth'],
      assignments: { 'กาแฟพิเศษ': ['c1'] },
      nets: [{ id: 'n1', level: 0, codes: [
        { id: 'c1', codeNo: '1', thai: 'ร้านกาแฟ' },
        { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' },
      ] }],
    }],
  }

  const result = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  // Code เดิม (ไม่ใช่ manualNew/aiNew) → ลบ Verbatim ออก
  assert.equal(result.rows[0][1], '1')
  assert.equal(result.rows[0][2], '')
  assert.equal(result.editLog[0].action, 'overwrite_other_code')
  assert.equal(result.editLog[0].codeColumn, 'q1')
  assert.equal(result.editLog.some((e) => e.action === 'clear_coded_verbatim'), true)
})

test('buildOverwrittenRawdata keeps MA group compact while applying assigned Other text code', () => {
  const rawdata = {
    headers: ['SbjNum', 'q1_01', 'q1_02', 'q1_02_oth'],
    rows: [['001', '1', '99', 'กาแฟพิเศษ']],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 'q1_01', label: 'q1_01', index: 1, columns: [1] },
      { id: 'q1_02', label: 'q1_02', index: 2, columns: [2] },
      { id: 'q1_02_oth', label: 'q1_02_oth', index: 3, columns: [3] },
    ],
  }
  const codebook = {
    byVar: {
      q1_01: { values: [{ value: '1', label: 'ร้านกาแฟ' }, { value: '99', label: 'อื่นๆ ระบุ' }] },
      q1_02: { values: [{ value: '1', label: 'ร้านกาแฟ' }, { value: '99', label: 'อื่นๆ ระบุ' }] },
    },
  }
  const codeframe = {
    sheets: [{
      name: 'q1',
      questionIds: ['q1_01', 'q1_02', 'q1_02_oth'],
      assignments: { 'กาแฟพิเศษ': ['c1'] },
      nets: [{ id: 'n1', level: 0, codes: [
        { id: 'c1', codeNo: '1', thai: 'ร้านกาแฟ' },
        { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' },
      ] }],
    }],
  }

  const result = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  assert.equal(result.rows[0][1], '1')
  assert.equal(result.rows[0][2], '1')
  // Code เดิม → ลบ Verbatim
  assert.equal(result.rows[0][3], '')
  assert.equal(result.editLog.some((e) => e.action === 'overwrite_other_code'), true)
})

test('manual recode follows source closed-code when rule source points at Oth text column', () => {
  const rawdata = {
    headers: ['SbjNum', 'q41a', 'q41a_oth', 'q41b'],
    rows: [
      ['001', '141', 'ไม่มี', '141'],
      ['002', '141', 'ไม่มี', '141'],
    ],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 'q41a', label: 'q41a', index: 1, columns: [1] },
      { id: 'q41a_oth', label: 'q41a_oth', index: 2, columns: [2] },
      { id: 'q41b', label: 'q41b', index: 3, columns: [3] },
    ],
  }
  const codebook = {
    byVar: {
      q41a: { values: [{ value: '141', label: 'อื่นๆ ระบุ' }] },
      // q41b intentionally has no value-label metadata in this fixture.
      // Real jobs can have target headers/codebook that don't map cleanly, but Codeframe still knows 141 is Other.
    },
  }
  const codeframe = {
    sheets: [{
      name: 'Code q41_q41a1b',
      questionIds: ['q41a', 'q41a_oth', 'q41b'],
      assignments: { 'ไม่มี': ['c99'] },
      manualRecodeRules: [{
        id: 'r1',
        questionId: 'q41b',
        sourceQuestionId: 'q41a_oth',
        sourceCodeId: 'c99',
        codeId: 'c99',
      }],
      nets: [{ id: 'n1', level: 0, codes: [
        { id: 'c99', codeNo: '99', thai: 'ไม่มี' },
        { id: 'c141', codeNo: '141', thai: 'อื่นๆ ระบุ' },
      ] }],
    }],
  }

  const result = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  assert.equal(result.rows[0][2], '')
  assert.equal(result.rows[1][2], '')
  assert.equal(result.rows[0][3], '99')
  assert.equal(result.rows[1][3], '99')
  assert.equal(result.editLog.some((e) => e.action === 'manual_cross_question_follow_source_code' || e.action === 'manual_cross_question_recode'), true)
})

test('manual recode follows generic Oth source order like q41a_oth1 for code 141', () => {
  const rawdata = {
    headers: ['SbjNum', 'q41a', 'q41a_oth1', 'q41a_oth2', 'q41a_oth3', 'q41b'],
    rows: [
      ['001', '99', 'ไม่มี', '', '', '141'],
      ['002', '1', 'ไม่มี', '', '', '141'],
    ],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 'q41a', label: 'q41a', index: 1, columns: [1] },
      { id: 'q41a_oth1', label: 'q41a_oth1', index: 2, columns: [2] },
      { id: 'q41a_oth2', label: 'q41a_oth2', index: 3, columns: [3] },
      { id: 'q41a_oth3', label: 'q41a_oth3', index: 4, columns: [4] },
      { id: 'q41b', label: 'q41b', index: 5, columns: [5] },
    ],
  }
  const codebook = { byVar: {
    q41a: { values: [
      { value: '141', label: 'อื่น ๆ (ระบุ____)' },
      { value: '142', label: 'อื่น ๆ (ระบุ____)' },
      { value: '143', label: 'อื่น ๆ (ระบุ____)' },
    ] },
    q41b: { values: [
      { value: '141', label: 'อื่น ๆ (ระบุ____)' },
      { value: '142', label: 'อื่น ๆ (ระบุ____)' },
      { value: '143', label: 'อื่น ๆ (ระบุ____)' },
    ] },
  } }
  const codeframe = { sheets: [{
    name: 'q41 q41a b',
    questionIds: ['q41a', 'q41a_oth1', 'q41a_oth2', 'q41a_oth3', 'q41b'],
    assignments: { 'ไม่มี': ['c99'] },
    manualRecodeRules: [{ id: 'r1', questionId: 'q41b', sourceQuestionId: 'q41a', sourceCodeId: 'c141', codeId: 'c141' }],
    nets: [{ id: 'n1', level: 0, codes: [
      { id: 'c141', codeNo: '141', thai: 'อื่น ๆ (ระบุ____)' },
      { id: 'c142', codeNo: '142', thai: 'อื่น ๆ (ระบุ____)' },
      { id: 'c143', codeNo: '143', thai: 'อื่น ๆ (ระบุ____)' },
      { id: 'c99', codeNo: '99', thai: 'ไม่มี' },
    ] }],
  }] }

  const result = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  assert.equal(result.rows[0][2], 'ไม่มี')
  assert.equal(result.rows[1][2], 'ไม่มี')
  assert.equal(result.rows[0][5], '99')
  assert.equal(result.rows[1][5], '1')
  assert.equal(result.editLog.filter((e) => e.question === 'q41b').length, 2)
})

test('buildOverwrittenRawdata keeps Verbatim as the Codeframe label for a newly created code', () => {
  const rawdata = {
    headers: ['SbjNum', 'sn3_O1', 'sn3_oth1'],
    rows: [['001', '91', 'strepsils promax']],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 'sn3', label: 'sn3', index: 1, columns: [1] },
      { id: 'sn3_oth1', label: 'sn3_oth1', index: 2, columns: [2] },
    ],
  }
  const codebook = {
    byVar: {
      sn3: { values: [{ value: '9', label: 'สเตรปซิล แม็กซ์โปร Strepsils MaxPro' }, { value: '91', label: 'อื่น ๆ (ระบุ)' }] },
    },
  }
  const codeframe = { sheets: [{
    name: 'sn3',
    questionIds: ['sn3', 'sn3_oth1'],
    assignments: { 'strepsils promax': ['c9'] },
    nets: [{ id: 'n1', level: 0, codes: [
      { id: 'c9', codeNo: '9', thai: 'สเตรปซิล แม็กซ์โปร Strepsils MaxPro', manualNew: true },
      { id: 'c91', codeNo: '91', thai: 'อื่น ๆ (ระบุ)' },
    ] }],
  }] }

  const result = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  assert.equal(result.rows[0][1], '9')
  assert.equal(result.rows[0][2], 'สเตรปซิล แม็กซ์โปร Strepsils MaxPro')
  assert.equal(result.editLog.some((e) => e.action === 'replace_verbatim_with_code_label'), true)
})

test('buildOverwrittenRawdata restores legacy-cleared Verbatim from Original Rawdata and aligns it to Codeframe', () => {
  const originalRawdata = {
    headers: ['SbjNum', 'q16f', 'q16f_ot'],
    rows: [['001', '99', 'คำตอบเดิม']],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 'q16f', label: 'q16f', index: 1, columns: [1] },
      { id: 'q16f_ot', label: 'q16f_ot', index: 2, columns: [2] },
    ],
  }
  const workingRawdata = { ...originalRawdata, rows: [['001', '7', '']] }
  const codebook = { byVar: { q16f: { values: [{ value: '7', label: 'คำตอบที่จัดแล้ว' }, { value: '99', label: 'อื่นๆ ระบุ' }] } } }
  const codeframe = { sheets: [{
    name: 'q16f', questionIds: ['q16f', 'q16f_ot'],
    assignments: { 'คำตอบเดิม': ['c7'] },
    nets: [{ id: 'n1', level: 0, codes: [
      { id: 'c7', codeNo: '7', thai: 'คำตอบที่จัดแล้ว', manualNew: true },
      { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' },
    ] }],
  }] }

  const result = buildOverwrittenRawdata(workingRawdata, codeframe, codebook, { sourceRawdata: originalRawdata })
  assert.equal(result.rows[0][1], '7')
  // Code ที่สร้างใหม่ (manualNew) → เก็บ Verbatim ไว้เป็นชื่อ Code ใหม่
  assert.equal(result.rows[0][2], 'คำตอบที่จัดแล้ว')
  assert.equal(result.editLog.some((e) => e.action === 'restore_legacy_cleared_verbatim'), true)
})

test('buildOverwrittenRawdata preserves unassigned and still-Other verbatim text', () => {
  const rawdata = {
    headers: ['SbjNum', 'q74_01', 'q74_oth'],
    rows: [['001', '99', 'ยังไม่จัด'], ['002', '99', 'ยังเป็นอื่นๆ']],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 'q74', label: 'q74_01', index: 1, columns: [1] },
      { id: 'q74_oth', label: 'q74_oth', index: 2, columns: [2] },
    ],
  }
  const codebook = { byVar: { q74_01: { values: [{ value: '4', label: 'ญาติ' }, { value: '99', label: 'อื่นๆ ระบุ' }] } } }
  const codeframe = { sheets: [{
    name: 'q74', questionIds: ['q74', 'q74_oth'],
    assignments: { 'ยังเป็นอื่นๆ': ['c99'] },
    nets: [{ id: 'n1', level: 0, codes: [
      { id: 'c4', codeNo: '4', thai: 'ญาติ' },
      { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' },
    ] }],
  }] }

  const result = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  assert.equal(result.rows[0][2], 'ยังไม่จัด')
  assert.equal(result.rows[1][2], 'ยังเป็นอื่นๆ')
})

test('buildOverwrittenRawdata highlights persisted deleted Verbatim and linked Other code cells', () => {
  const rawdata = {
    headers: ['SbjNum', 's13_1_03', 's13_1_211_oth', 's13_2_O1'],
    rows: [['001', '', '', '']],
    questions: [
      { id: 'id', label: 'SbjNum', index: 0, columns: [0] },
      { id: 's13_1_03', label: 's13_1_03', index: 1, columns: [1] },
      { id: 's13_1_211_oth', label: 's13_1_211_oth', index: 2, columns: [2] },
      { id: 's13_2_O1', label: 's13_2_O1', index: 3, columns: [3] },
    ],
  }
  const codebook = { byVar: { s13_1_03: { values: [{ value: '211', label: 'อื่นๆ ระบุ' }] } } }
  const codeframe = {
    sheets: [{
      name: 's13',
      questionIds: ['s13_1_03', 's13_1_211_oth', 's13_2_O1'],
      assignments: {},
      rawdataEditLog: [{
        action: 'delete_verbatim_row_summary',
        rowIndex0: 0,
        cols: [1, 2, 3],
        otherText: 'กาแฟแมวรำไทย',
      }],
      nets: [{ id: 'n1', level: 0, codes: [{ id: 'c211', codeNo: '211', thai: 'อื่นๆ ระบุ' }] }],
    }],
  }

  const result = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  assert.equal(result.editMaskRows[0].has(1), true)
  assert.equal(result.editMaskRows[0].has(2), true)
  assert.equal(result.editMaskRows[0].has(3), true)
  assert.equal(result.editedCols.has(2), true)
  assert.equal(result.editLog.some((e) => e.action === 'delete_verbatim_row_summary'), true)
})

test('parseFrameFile imports COF-exported sheet after question rows without fake question codes', async () => {
  const aoa = [
    ['q41a', 'โจทย์ตัวอย่าง', '', ''],
    ['q41b', 'โจทย์อีกข้อ', '', ''],
    ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English'],
    ['', 'Net : กลุ่มหลัก', '', ''],
    [1, 'โทรทัศน์', '', 'TV'],
    [99, 'ไม่มี', '', 'None'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Code q41')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const file = new File([buf], 'sheet.xlsx')
  let i = 0
  const nets = await parseFrameFile(file, () => `id${++i}`)
  const codes = nets.flatMap((n) => n.codes)
  assert.equal(codes.length, 2)
  assert.equal(codes.some((c) => c.codeNo === 'q41a'), false)
  assert.equal(String(codes[0].codeNo), '1')
  assert.equal(codes[1].thai, 'ไม่มี')
})
