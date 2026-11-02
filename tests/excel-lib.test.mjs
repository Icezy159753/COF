// Characterization tests for src/lib/excel.js — lock in current behaviour of every export.
// Synthetic data only (Q1/Q2/... + Thai/English labels). No disk writes: xlsx-js-style writeFile
// is redirected to an in-memory buffer, and browser download APIs (document/URL) are stubbed.
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import {
  buildOverwrittenRawdata,
  buildCodedRawdataAoA,
  freqHeadersForQuestions,
  parseRawdataFile,
  parseFrameFile,
  exportRawdataWithEdits,
  exportCodedData,
  exportRawdataXlsx,
  exportCodeframe,
  exportCodeframeSheet,
  exportQuestionList,
  exportQuestionCodeList,
} from '../src/lib/excel.js'

// ---------------------------------------------------------------- helpers

// Same object excel.js gets via its cjsNs() helper (module.exports of xlsx-js-style).
const XS = (await import('xlsx-js-style')).default
const ORIGINAL_WRITE_FILE = XS.writeFile

// Redirect XLSXStyle.writeFile → capture { wb, name, buf } instead of writing to disk.
async function captureStyleWrites(fn) {
  const orig = XS.writeFile
  const calls = []
  XS.writeFile = (wb, name) => {
    calls.push({ wb, name, buf: XS.write(wb, { type: 'buffer', bookType: 'xlsx' }) })
  }
  try {
    await fn()
  } finally {
    XS.writeFile = orig
  }
  return calls
}

// Stub browser download path (Blob → URL.createObjectURL → <a download>.click()).
async function captureDownloads(fn) {
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const prevDocument = globalThis.document
  const prevCreate = URL.createObjectURL
  const prevRevoke = URL.revokeObjectURL
  const blobs = new Map()
  const anchors = []
  const revoked = []
  let n = 0
  URL.createObjectURL = (blob) => {
    const url = `blob:test/${++n}`
    blobs.set(url, blob)
    return url
  }
  URL.revokeObjectURL = (url) => { revoked.push(url) }
  globalThis.document = {
    createElement(tag) {
      const a = { tag, href: '', download: '', clicks: 0, click() { this.clicks += 1 } }
      anchors.push(a)
      return a
    },
  }
  try {
    await fn()
  } finally {
    URL.createObjectURL = prevCreate
    URL.revokeObjectURL = prevRevoke
    if (hadDocument) globalThis.document = prevDocument
    else delete globalThis.document
  }
  const out = []
  for (const a of anchors) {
    const blob = blobs.get(a.href)
    out.push({
      tag: a.tag,
      name: a.download,
      clicks: a.clicks,
      type: blob?.type,
      revoked: revoked.includes(a.href),
      buf: blob ? Buffer.from(await blob.arrayBuffer()) : null,
    })
  }
  return out
}

async function loadExcel(buf) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return wb
}

const sheetAoA = (buf, sheetName) => {
  const wb = XLSX.read(buf)
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName ?? wb.SheetNames[0]], { header: 1, defval: '' })
}

const rowValues = (ws, r) => {
  const v = ws.getRow(r).values // exceljs: 1-based sparse array
  return v.slice(1).map((x) => (x == null ? '' : x))
}

const fillArgb = (cell) => (cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? cell.fill.fgColor?.argb : null)

const fakeFile = (aoaBySheet, name = 'input.xlsx') => {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(aoaBySheet)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return { name, arrayBuffer: async () => buf }
}

const idMaker = () => {
  let i = 0
  return () => `id${++i}`
}

// ---------------------------------------------------------------- fixtures

// SA closed question Q1 + its Verbatim column Q1_oth
function saFixture() {
  const rawdata = {
    headers: ['SbjNum', 'Q1', 'Q1_oth'],
    rows: [
      ['R001', '99', 'ชาเขียว'], // assigned to existing code 1 → overwrite + clear Verbatim
      ['R002', '2', ''], // untouched
      ['R003', '99', 'ไม่รู้'], // unassigned → untouched
      ['R004', '99', '  น้ำส้มคั้น  '], // assigned (trimmed key) to NEW code 5 → Verbatim = code label
    ],
    questions: [
      { id: 'q0', label: 'SbjNum', index: 0, type: 'single', columns: [0] },
      { id: 'q1', label: 'Q1', index: 1, type: 'single', columns: [1] },
      { id: 'q2', label: 'Q1_oth', index: 2, type: 'single', columns: [2] },
    ],
  }
  const codebook = {
    byVar: {
      Q1: { values: [{ value: '1', label: 'ชา' }, { value: '2', label: 'กาแฟ' }, { value: '99', label: 'อื่นๆ ระบุ' }] },
    },
  }
  const codeframe = {
    sheets: [{
      id: 's1',
      name: 'Q1 sheet',
      questionIds: ['q1', 'q2'],
      assignments: { 'ชาเขียว': ['c1'], 'น้ำส้มคั้น': ['c5'] },
      nets: [{ id: 'n1', level: 0, codes: [
        { id: 'c1', codeNo: '1', thai: 'ชา', eng: 'Tea' },
        { id: 'c2', codeNo: '2', thai: 'กาแฟ', eng: 'Coffee' },
        { id: 'c5', codeNo: '5', thai: 'น้ำผลไม้', eng: 'Juice', manualNew: true },
        { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ', eng: 'Other (specify)' },
      ] }],
    }],
  }
  return { rawdata, codebook, codeframe }
}

// MA closed question Q2 (one question spanning 3 slot columns) + Q2_oth
function maFixture() {
  const rawdata = {
    headers: ['SbjNum', 'Q2_O1', 'Q2_O2', 'Q2_O3', 'Q2_oth'],
    rows: [
      ['R1', '2', '99', '', 'กาแฟดำ'], // → new code 1 written into the Other slot
      ['R2', '2', '99', '', 'ชาไทย'], // → code 2 already present → Other slot cleared
      ['R3', '', '3', '', ''], // no Other: gap is still compacted
      ['R4', '99', '1', '', 'น้ำแร่'], // assigned back to Other 99 → untouched
    ],
    questions: [
      { id: 'q0', label: 'SbjNum', index: 0, type: 'single', columns: [0] },
      { id: 'q1', label: 'Q2', index: 1, type: 'MA', columns: [1, 2, 3] },
      { id: 'q4', label: 'Q2_oth', index: 4, type: 'single', columns: [4] },
    ],
  }
  const codebook = {
    byVar: {
      Q2: { values: [{ value: '1', label: 'Coffee' }, { value: '2', label: 'Tea' }, { value: '3', label: 'Milk' }, { value: '99', label: 'Other (specify)' }] },
    },
  }
  const codeframe = {
    sheets: [{
      id: 's2',
      name: 'Q2',
      questionIds: ['q1', 'q4'],
      assignments: { 'กาแฟดำ': ['c1'], 'ชาไทย': ['c2'], 'น้ำแร่': ['c99'] },
      nets: [{ id: 'n1', level: 0, codes: [
        { id: 'c1', codeNo: '1', thai: 'กาแฟ', eng: 'Coffee' },
        { id: 'c2', codeNo: '2', thai: 'ชา', eng: 'Tea' },
        { id: 'c3', codeNo: '3', thai: 'นม', eng: 'Milk' },
        { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ', eng: 'Other' },
      ] }],
    }],
  }
  return { rawdata, codebook, codeframe }
}

// ================================================================ buildOverwrittenRawdata

describe('buildOverwrittenRawdata', () => {
  test('empty / missing inputs return empty structures', () => {
    const res = buildOverwrittenRawdata({}, {}, null)
    assert.deepEqual(res.rows, [])
    assert.deepEqual(res.editMaskRows, [])
    assert.equal(res.editedCols.size, 0)
    assert.deepEqual(res.editLog, [])
  })

  test('codeframe without sheets returns a copy of rows and no edits', () => {
    const { rawdata, codebook } = saFixture()
    const res = buildOverwrittenRawdata(rawdata, { sheets: [] }, codebook)
    assert.deepEqual(res.rows, rawdata.rows)
    assert.notEqual(res.rows[0], rawdata.rows[0])
    assert.equal(res.editMaskRows.length, rawdata.rows.length)
    assert.ok(res.editMaskRows.every((s) => s instanceof Set && s.size === 0))
    assert.equal(res.editedCols.size, 0)
    assert.deepEqual(res.editLog, [])
  })

  test('SA: overwrite Other code, clear Verbatim for existing code, keep label for new code, leave unassigned rows', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    const before = JSON.stringify(rawdata)
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)

    // input is not mutated
    assert.equal(JSON.stringify(rawdata), before)

    assert.deepEqual(res.rows, [
      ['R001', '1', ''],
      ['R002', '2', ''],
      ['R003', '99', 'ไม่รู้'],
      ['R004', '5', 'น้ำผลไม้'],
    ])
    assert.deepEqual(res.editMaskRows.map((s) => [...s].sort()), [[1, 2], [], [], [1, 2]])
    assert.deepEqual([...res.editedCols].sort(), [1, 2])
  })

  test('SA: editLog shape and order (overwrites first, then Verbatim replacements)', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    const { editLog } = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    const common = {
      keyHeader: 'SbjNum',
      sheet: 'Q1 sheet',
      question: 'Q1',
      textQuestion: 'Q1_oth',
      codeColumn: 'Q1',
      codeColumnIndex: 2,
      textColumn: 'Q1_oth',
      textColumnIndex: 3,
    }
    assert.deepEqual(editLog, [
      { rowIndex: 1, rowKey: 'R001', ...common, otherText: 'ชาเขียว', originalCode: '99', newCode: '1', action: 'overwrite_other_code' },
      { rowIndex: 4, rowKey: 'R004', ...common, otherText: 'น้ำส้มคั้น', originalCode: '99', newCode: '5', action: 'overwrite_other_code' },
      {
        rowIndex: 1, rowKey: 'R001', ...common, otherText: 'ชาเขียว', originalCode: '99', newCode: '1',
        ruleCode: '', sourceCodeColumn: '', sourceCodeColumnIndex: '', action: 'clear_coded_verbatim',
      },
      {
        rowIndex: 4, rowKey: 'R004', ...common, otherText: 'น้ำส้มคั้น', originalCode: '99', newCode: '5',
        ruleCode: '', sourceCodeColumn: '', sourceCodeColumnIndex: '', action: 'replace_verbatim_with_code_label',
      },
    ])
  })

  test('aiNew codes behave like manualNew (Verbatim kept as code label, falling back thai → thai2 → eng)', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    const codes = codeframe.sheets[0].nets[0].codes
    codes[2] = { id: 'c5', codeNo: '5', thai: '', thai2: '', eng: 'Fresh juice', aiNew: true }
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.deepEqual(res.rows[3], ['R004', '5', 'Fresh juice'])
  })

  test('missing headers: keyHeader defaults to SbjNum and column names fall back to "คอลัมน์ N"', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    const noHeaders = { ...rawdata, headers: [] }
    const { editLog } = buildOverwrittenRawdata(noHeaders, codeframe, codebook)
    const first = editLog[0]
    assert.equal(first.keyHeader, 'SbjNum')
    assert.equal(first.codeColumn, 'คอลัมน์ 2')
    assert.equal(first.textColumn, 'คอลัมน์ 3')
  })

  test('rowKey falls back to the 1-based row number when the key cell is blank', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    rawdata.rows[0][0] = '   '
    const { editLog } = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.equal(editLog[0].rowKey, '1')
    assert.equal(editLog[0].rowIndex, 1)
  })

  test('unassigned answers, assignments to unknown codes, and assignment to the Other code produce no edits', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    codeframe.sheets[0].assignments = { 'ชาเขียว': ['ghost-code'], 'ไม่รู้': ['c99'], 'น้ำส้มคั้น': [] }
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.deepEqual(res.rows, rawdata.rows)
    assert.deepEqual(res.editLog, [])
    assert.equal(res.editedCols.size, 0)
  })

  test('only the first assigned code of a multi-code answer is written', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    codeframe.sheets[0].assignments = { 'ชาเขียว': ['c2', 'c1'] }
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.equal(res.rows[0][1], '2')
  })

  test('Verbatim column not included in sheet.questionIds → no pair, nothing written', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    codeframe.sheets[0].questionIds = ['q1']
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.deepEqual(res.rows, rawdata.rows)
    assert.deepEqual(res.editLog, [])
  })

  test('MA: writes into Other slot, clears Other slot when code already present, compacts every row of the group', () => {
    const { rawdata, codebook, codeframe } = maFixture()
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.deepEqual(res.rows, [
      ['R1', '2', '1', '', ''],
      ['R2', '2', '', '', ''],
      ['R3', '3', '', '', ''], // compacted even though nothing was coded in this row
      ['R4', '99', '1', '', 'น้ำแร่'],
    ])
    assert.deepEqual(res.editMaskRows.map((s) => [...s].sort()), [[2, 4], [1, 2, 4], [1, 2], []])
    assert.deepEqual([...res.editedCols].sort(), [1, 2, 4])

    const dup = res.editLog.find((e) => e.action === 'clear_original_other_because_new_code_already_exists')
    assert.deepEqual(dup, {
      rowIndex: 2,
      keyHeader: 'SbjNum',
      rowKey: 'R2',
      sheet: 'Q2',
      question: 'Q2',
      textQuestion: 'Q2_oth',
      codeColumn: 'Q2_O2',
      codeColumnIndex: 3,
      textColumn: 'Q2_oth',
      textColumnIndex: 5,
      otherText: 'ชาไทย',
      originalCode: '99',
      newCode: '2',
      action: 'clear_original_other_because_new_code_already_exists',
      duplicateColumn: 'Q2_O1',
      duplicateColumnIndex: 2,
    })
    assert.deepEqual(res.editLog.map((e) => `${e.rowKey}:${e.action}`), [
      'R1:overwrite_other_code',
      'R2:clear_original_other_because_new_code_already_exists',
      'R1:clear_coded_verbatim',
      'R2:clear_coded_verbatim',
    ])
  })

  test('MA: two Other slots in one row each consume one Verbatim column in order', () => {
    const rawdata = {
      headers: ['SbjNum', 'Q3_O1', 'Q3_O2', 'Q3_oth1', 'Q3_oth2'],
      rows: [['R1', '98', '99', 'ปากกา', 'ดินสอ']],
      questions: [
        { id: 'q0', label: 'SbjNum', index: 0, columns: [0] },
        { id: 'q1', label: 'Q3', index: 1, type: 'MA', columns: [1, 2] },
        { id: 'q3', label: 'Q3_oth1', index: 3, columns: [3] },
        { id: 'q4', label: 'Q3_oth2', index: 4, columns: [4] },
      ],
    }
    const codebook = { byVar: { Q3: { values: [
      { value: '1', label: 'Pen' }, { value: '2', label: 'Pencil' },
      { value: '98', label: 'Other 1 (specify)' }, { value: '99', label: 'Other 2 (specify)' },
    ] } } }
    const codeframe = { sheets: [{
      name: 'Q3', questionIds: ['q1', 'q3', 'q4'],
      assignments: { 'ปากกา': ['c1'], 'ดินสอ': ['c2'] },
      nets: [{ codes: [
        { id: 'c1', codeNo: '1', thai: 'ปากกา' }, { id: 'c2', codeNo: '2', thai: 'ดินสอ' },
        { id: 'c98', codeNo: '98', thai: 'อื่นๆ 1 ระบุ' }, { id: 'c99', codeNo: '99', thai: 'อื่นๆ 2 ระบุ' },
      ] }],
    }] }
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.deepEqual(res.rows[0], ['R1', '1', '2', '', ''])
    assert.deepEqual(
      res.editLog.filter((e) => e.action === 'overwrite_other_code').map((e) => [e.codeColumn, e.textColumn, e.newCode]),
      [['Q3_O1', 'Q3_oth1', '1'], ['Q3_O2', 'Q3_oth2', '2']],
    )
  })

  test('per-slot MA (Q2_01..Q2_03 each in codebook): Other in any slot is recoded and no duplicate code is created', {
    todo: 'excel.js:86-89 — pair.closedCols = only the slot adjacent to Q2_oth; Other in earlier slots is ignored and the dup check misses codes in sibling slots (row 3 ends up with code 1 twice)',
  }, () => {
    const vals = { values: [{ value: '1', label: 'A' }, { value: '2', label: 'B' }, { value: '99', label: 'อื่นๆ ระบุ' }] }
    const labels = ['ID', 'Q2_01', 'Q2_02', 'Q2_03', 'Q2_oth']
    const rawdata = {
      headers: labels,
      rows: [['1', '99', '2', '', 'กาแฟ'], ['2', '2', '99', '', 'กาแฟ'], ['3', '2', '1', '99', 'กาแฟ']],
      questions: labels.map((l, i) => ({ id: `q${i}`, label: l, index: i, columns: [i] })),
    }
    const codeframe = { sheets: [{
      name: 'Q2', questionIds: ['q1', 'q2', 'q3', 'q4'], assignments: { 'กาแฟ': ['c1'] },
      nets: [{ codes: [{ id: 'c1', codeNo: '1', thai: 'A' }, { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' }] }],
    }] }
    const res = buildOverwrittenRawdata(rawdata, codeframe, { byVar: { Q2_01: vals, Q2_02: vals, Q2_03: vals } })
    assert.deepEqual(res.rows, [
      ['1', '1', '2', '', ''],
      ['2', '2', '1', '', ''],
      ['3', '2', '1', '', ''],
    ])
  })

  test('fallback pair: closed + text questions without a detectable Other column still get overwritten', () => {
    // Q5 (closed) is between Q1 and the free-text column, so findOtherColumns(Q1) finds nothing.
    const rawdata = {
      headers: ['ID', 'Q1', 'Q5', 'TXT'],
      rows: [['A1', '99', '1', 'ส้มตำ']],
      questions: [
        { id: 'q0', label: 'ID', index: 0, columns: [0] },
        { id: 'q1', label: 'Q1', index: 1, columns: [1] },
        { id: 'q2', label: 'Q5', index: 2, columns: [2] },
        { id: 'q3', label: 'TXT', index: 3, columns: [3] },
      ],
    }
    const codebook = { byVar: {
      Q1: { values: [{ value: '1', label: 'อาหารไทย' }, { value: '99', label: 'อื่นๆ ระบุ' }] },
      Q5: { values: [{ value: '1', label: 'ใช่' }] },
    } }
    const codeframe = { sheets: [{
      name: 'Food', questionIds: ['q1', 'q3'],
      assignments: { 'ส้มตำ': ['c1'] },
      nets: [{ codes: [{ id: 'c1', codeNo: '1', thai: 'อาหารไทย' }, { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' }] }],
    }] }
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.deepEqual(res.rows[0], ['A1', '1', '1', ''])
    const log = res.editLog[0]
    assert.equal(log.question, 'Food') // falls back to sheet name
    assert.equal(log.textQuestion, 'fallback text')
    assert.equal(log.keyHeader, 'ID')
    assert.equal(log.action, 'overwrite_other_code')
  })

  test('code numbers like "99" in codebook are matched as trimmed strings', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    rawdata.rows[0][1] = ' 99 '
    const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.equal(res.rows[0][1], '1')
    assert.equal(res.editLog[0].originalCode, '99')
  })

  test('recovers text from options.sourceRawdata but skips restore for existing (non-new) codes', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    const working = { ...rawdata, rows: [['R001', '1', ''], ['R002', '2', ''], ['R003', '99', 'ไม่รู้'], ['R004', '5', 'น้ำผลไม้']] }
    const res = buildOverwrittenRawdata(working, codeframe, codebook, { sourceRawdata: rawdata })
    // R001 code 1 is an existing code → Verbatim stays cleared, no restore log
    assert.deepEqual(res.rows[0], ['R001', '1', ''])
    assert.equal(res.editLog.some((e) => e.action === 'restore_legacy_cleared_verbatim'), false)
    assert.equal(res.editMaskRows[0].size, 0)
  })

  describe('sheet.rawdataEditLog (persisted Verbatim deletions)', () => {
    test('valid entries mark cells and are copied into editLog with defaults', () => {
      const { rawdata, codebook } = saFixture()
      const codeframe = { sheets: [{
        name: 'Q1 sheet', questionIds: ['q1', 'q2'], assignments: {},
        nets: [{ codes: [{ id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' }] }],
        rawdataEditLog: [
          { rowIndex0: 2, cols: [2, '1'], otherText: 'ไม่รู้', question: 'Q1', textColumn: 'Q1_oth', textColumnIndex: 3 },
          { rowIndex0: 99, cols: [1] }, // out of range
          { rowIndex0: -1, cols: [1] }, // negative
          { rowIndex0: 1, cols: [] }, // no cols
          { rowIndex0: 1, cols: [-2, 'x'] }, // only invalid cols
          { rowIndex0: 'abc', cols: [1] }, // NaN row
        ],
      }] }
      const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
      assert.deepEqual(res.rows, rawdata.rows) // values are not changed by the log
      assert.deepEqual(res.editMaskRows.map((s) => [...s].sort()), [[], [], [1, 2], []])
      assert.deepEqual([...res.editedCols].sort(), [1, 2])
      assert.deepEqual(res.editLog, [{
        rowIndex: 3,
        keyHeader: 'SbjNum',
        rowKey: 'R003',
        sheet: 'Q1 sheet',
        question: 'Q1',
        textQuestion: '',
        codeColumn: '',
        codeColumnIndex: '',
        textColumn: 'Q1_oth',
        textColumnIndex: 3,
        otherText: 'ไม่รู้',
        originalCode: '',
        newCode: '',
        ruleCode: '',
        action: 'rawdata_delete_verbatim',
      }])
    })
  })

  describe('sheet.manualRecodeRules (cross-question recode)', () => {
    // Q1 has Verbatim Q1_oth; Q2 is an MA group (Q2_01, Q2_02) with no Verbatim of its own.
    function manualFixture(rows) {
      const rawdata = {
        headers: ['SbjNum', 'Q1', 'Q1_oth', 'Q2_01', 'Q2_02'],
        rows,
        questions: [
          { id: 'q0', label: 'SbjNum', index: 0, columns: [0] },
          { id: 'q1', label: 'Q1', index: 1, columns: [1] },
          { id: 'q2', label: 'Q1_oth', index: 2, columns: [2] },
          { id: 'q3', label: 'Q2_01', index: 3, columns: [3] },
          { id: 'q4', label: 'Q2_02', index: 4, columns: [4] },
        ],
      }
      const codebook = { byVar: {
        Q1: { values: [{ value: '1', label: 'Brand A' }, { value: '99', label: 'อื่นๆ ระบุ' }] },
        Q2_01: { values: [{ value: '1', label: 'Brand A' }, { value: '98', label: 'อื่นๆ ระบุ' }] },
      } }
      const codeframe = { sheets: [{
        name: 'Q1-Q2', questionIds: ['q1', 'q2', 'q3'],
        assignments: {},
        manualRecodeRules: [{ id: 'r1', questionId: 'q3', sourceText: 'ชอบ  มาก​', codeId: 'c5' }],
        nets: [{ codes: [
          { id: 'c1', codeNo: '1', thai: 'Brand A' },
          { id: 'c5', codeNo: '5', thai: 'ชอบมาก' },
          { id: 'c98', codeNo: '98', thai: 'อื่นๆ ระบุ' },
          { id: 'c99', codeNo: '99', thai: 'อื่นๆ ระบุ' },
        ] }],
      }] }
      return { rawdata, codebook, codeframe }
    }

    test('recode Other slot, insert into empty slot (priority-first), mark existing code', () => {
      const { rawdata, codebook, codeframe } = manualFixture([
        ['R1', '99', 'ชอบ มาก', '98', ''], // Other 98 in target → recode to 5
        ['R2', '99', 'ชอบ มาก', '1', ''], // no Other in target → insert 5, moved first by compaction priority
        ['R3', '99', 'ชอบ มาก', '1', '5'], // code 5 already present → only marked
        ['R4', '99', 'อย่างอื่น', '98', ''], // text does not match the rule
      ])
      const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
      assert.deepEqual(res.rows.map((r) => r.slice(3)), [
        ['5', ''],
        ['5', '1'],
        ['5', '1'],
        ['98', ''],
      ])
      // source Q1 / Q1_oth are untouched (no assignment for the text)
      assert.deepEqual(res.rows.map((r) => r.slice(1, 3)), rawdata.rows.map((r) => r.slice(1, 3)))

      const manual = res.editLog.filter((e) => e.textQuestion === 'manual cross-question source')
      assert.deepEqual(manual.map((e) => [e.rowKey, e.action, e.codeColumn, e.originalCode, e.newCode, e.ruleCode]), [
        ['R1', 'manual_cross_question_recode', 'Q2_01', '98', '5', '5'],
        ['R2', 'manual_cross_question_insert_code', 'Q2_02', '', '5', '5'],
        ['R3', 'manual_cross_question_existing_source_code', 'Q2_02', '5', '5', '5'],
      ])
      const r1 = manual[0]
      assert.equal(r1.question, 'Q2_01')
      assert.equal(r1.otherText, 'ชอบ มาก')
      assert.equal(r1.textColumn, '')
      assert.equal(r1.textColumnIndex, '')
      assert.equal(r1.sourceCodeColumn, '')
      assert.deepEqual(r1.clearedRuleColumns, [])
      assert.equal(res.editMaskRows[3].size, 0)
      assert.ok(res.editMaskRows[2].has(4))
    })

    test('rule with unknown target question or unknown code is ignored', () => {
      const rows = [['R1', '99', 'ชอบ มาก', '98', '']]
      for (const patch of [{ questionId: 'nope' }, { codeId: 'nope' }]) {
        const { rawdata, codebook, codeframe } = manualFixture(rows.map((r) => r.slice()))
        Object.assign(codeframe.sheets[0].manualRecodeRules[0], patch)
        const res = buildOverwrittenRawdata(rawdata, codeframe, codebook)
        assert.deepEqual(res.rows, rows)
        assert.deepEqual(res.editLog, [])
      }
    })
  })

  test('multiple sheets: per-sheet entries in sheet order, Verbatim replacements always last', () => {
    const { rawdata, codebook, codeframe } = saFixture()
    codeframe.sheets.push({
      name: 'Audit', questionIds: [], assignments: {}, nets: [],
      rawdataEditLog: [{ rowIndex0: 1, cols: [2], action: 'manual_delete', otherText: 'x' }],
    })
    const { editLog } = buildOverwrittenRawdata(rawdata, codeframe, codebook)
    assert.deepEqual(editLog.map((e) => `${e.sheet}:${e.rowKey}:${e.action}`), [
      'Q1 sheet:R001:overwrite_other_code',
      'Q1 sheet:R004:overwrite_other_code',
      'Audit:R002:manual_delete',
      'Q1 sheet:R001:clear_coded_verbatim',
      'Q1 sheet:R004:replace_verbatim_with_code_label',
    ])
  })
})

// ================================================================ buildCodedRawdataAoA

describe('buildCodedRawdataAoA', () => {
  const rawdata = {
    headers: ['ID', 'Q1', 'Q2_1', 'Q2_2', 'Q9'],
    rows: [
      ['1', 'สีแดง', 'ร้อน', 'หนาว', 'x'],
      ['2', 'สีฟ้า', 'ร้อน', '', 'y'],
      ['3', '', '', 'อุ่น'], // short row
    ],
    questions: [
      { id: 'q0', label: 'ID', index: 0, columns: [0] },
      { id: 'q1', label: 'Q1', index: 1, columns: [1] },
      { id: 'q2', label: 'Q2_1', index: 2, columns: [2] },
      { id: 'q3', label: 'Q2_2', index: 3, columns: [3] },
      { id: 'q4', label: 'Q9', index: 4, columns: [4] },
    ],
  }

  test('no codeframe sheets → headers + rows unchanged, no code columns', () => {
    const { aoa, codeCols } = buildCodedRawdataAoA(rawdata, {})
    assert.deepEqual(aoa, [
      ['ID', 'Q1', 'Q2_1', 'Q2_2', 'Q9'],
      ['1', 'สีแดง', 'ร้อน', 'หนาว', 'x'],
      ['2', 'สีฟ้า', 'ร้อน', '', 'y'],
      ['3', '', '', 'อุ่น', ''],
    ])
    assert.equal(codeCols.size, 0)
  })

  test('inserts Code columns after each coded block; adjacent coded questions share one block; first sheet wins', () => {
    const codeframe = { sheets: [
      {
        id: 'sA', questionIds: ['q1'],
        assignments: { 'สีแดง': ['a1', 'a2'], 'สีฟ้า': ['a2'] },
        nets: [{ codes: [{ id: 'a1', codeNo: '1' }, { id: 'a2', codeNo: 'A2' }] }],
      },
      {
        id: 'sB', questionIds: ['q2', 'q3', 'q4'],
        assignments: { 'ร้อน': ['b1'], 'หนาว': ['b2'], 'อุ่น': ['b1', 'b2'], 'x': [] },
        nets: [{ codes: [{ id: 'b1', codeNo: '10' }, { id: 'b2', codeNo: '20' }] }],
      },
      { id: 'sC', questionIds: ['q1'], assignments: { 'สีแดง': ['z'] }, nets: [{ codes: [{ id: 'z', codeNo: '777' }] }] },
    ] }
    const { aoa, codeCols } = buildCodedRawdataAoA(rawdata, codeframe)
    // Q1 (col 1), Q2_1 (col 2), Q2_2 (col 3) are contiguous → one block, Code columns after col 3
    // Q9 has no coded answer ('x' → []) → no Code column
    assert.deepEqual(aoa[0], [
      'ID', 'Q1', 'Q2_1', 'Q2_2',
      'Q1_Code1', 'Q1_Code2', 'Q2_1_Code1', 'Q2_2_Code1', 'Q2_2_Code2',
      'Q9',
    ])
    assert.deepEqual(aoa.slice(1), [
      ['1', 'สีแดง', 'ร้อน', 'หนาว', 1, 'A2', 10, 20, '', 'x'],
      ['2', 'สีฟ้า', 'ร้อน', '', 'A2', '', 10, '', '', 'y'],
      ['3', '', '', 'อุ่น', '', '', '', 10, 20, ''],
    ])
    assert.deepEqual([...codeCols].sort((a, b) => a - b), [4, 5, 6, 7, 8])
  })

  test('non-contiguous coded questions each get their own Code columns', () => {
    const codeframe = { sheets: [{
      id: 's', questionIds: ['q1', 'q3'],
      assignments: { 'สีแดง': ['a1'], 'หนาว': ['a2'] },
      nets: [{ codes: [{ id: 'a1', codeNo: '1' }, { id: 'a2', codeNo: '2' }] }],
    }] }
    const { aoa, codeCols } = buildCodedRawdataAoA(rawdata, codeframe)
    assert.deepEqual(aoa[0], ['ID', 'Q1', 'Q1_Code1', 'Q2_1', 'Q2_2', 'Q2_2_Code1', 'Q9'])
    assert.deepEqual(aoa[1], ['1', 'สีแดง', 1, 'ร้อน', 'หนาว', 2, 'x'])
    assert.deepEqual(aoa[2], ['2', 'สีฟ้า', '', 'ร้อน', '', '', 'y'])
    assert.deepEqual([...codeCols], [2, 5])
  })

  test('MA question spanning several columns dedupes codes across its columns', () => {
    const ma = {
      headers: ['ID', 'S1_O1', 'S1_O2'],
      rows: [['1', 'ก', 'ข']],
      questions: [
        { id: 'q0', label: 'ID', index: 0, columns: [0] },
        { id: 'q1', label: 'S1', index: 1, type: 'MA', columns: [1, 2] },
      ],
    }
    const cf = { sheets: [{ id: 's', questionIds: ['q1'], assignments: { 'ก': ['c1'], 'ข': ['c1', 'c2'] }, nets: [{ codes: [{ id: 'c1', codeNo: '1' }, { id: 'c2', codeNo: '2' }] }] }] }
    const { aoa, codeCols } = buildCodedRawdataAoA(ma, cf)
    assert.deepEqual(aoa, [['ID', 'S1_O1', 'S1_O2', 'S1_Code1', 'S1_Code2'], ['1', 'ก', 'ข', 1, 2]])
    assert.deepEqual([...codeCols], [3, 4])
  })

  test('code numbers with leading zeros stay as strings only when not pure digits', () => {
    const one = {
      headers: ['ID', 'Q1'],
      rows: [['1', 'ก']],
      questions: [{ id: 'q0', label: 'ID', index: 0 }, { id: 'q1', label: 'Q1', index: 1 }],
    }
    const cf = { sheets: [{ id: 's', questionIds: ['q1'], assignments: { 'ก': ['c1', 'c2', 'c3'] }, nets: [{ codes: [
      { id: 'c1', codeNo: '007' }, { id: 'c2', codeNo: '1.5' }, { id: 'c3', codeNo: '' },
    ] }] }] }
    const { aoa } = buildCodedRawdataAoA(one, cf)
    // '007' is pure digits → Number(7); '1.5' stays string; empty codeNo is skipped
    assert.deepEqual(aoa[1], ['1', 'ก', 7, '1.5'])
  })
})

// ================================================================ freqHeadersForQuestions

describe('freqHeadersForQuestions', () => {
  test('no questions → ["Frequency"]', () => {
    assert.deepEqual(freqHeadersForQuestions([]), ['Frequency'])
    assert.deepEqual(freqHeadersForQuestions(undefined), ['Frequency'])
    assert.deepEqual(freqHeadersForQuestions(null), ['Frequency'])
    assert.deepEqual(freqHeadersForQuestions([null, undefined]), ['Frequency'])
  })
  test('one question → its column only (no total)', () => {
    assert.deepEqual(freqHeadersForQuestions([{ column: 'Q1', label: 'x' }]), ['Q1'])
    assert.deepEqual(freqHeadersForQuestions([null, { column: 'Q1' }]), ['Q1'])
    assert.deepEqual(freqHeadersForQuestions([{ label: 'no column' }]), [''])
  })
  test('several questions → columns + "รวม"', () => {
    assert.deepEqual(freqHeadersForQuestions([{ column: 'Q1' }, { column: 'Q2' }, { column: 3 }]), ['Q1', 'Q2', '3', 'รวม'])
  })
})

// ================================================================ parseRawdataFile

describe('parseRawdataFile', () => {
  test('reads first sheet, trims, stringifies, skips blank rows, names blank headers, groups MA columns', async () => {
    const file = fakeFile({
      Data: [
        ['SbjNum', ' Q1 ', '', 'S1_O1', 'S1_O2', 'Q5$1', 'q5$2', 's1_o3', 'Q1_oth'],
        [1, 2, 'x', 1, '', 3, 4, 5, '  กาแฟ  '],
        ['', '', '', '', '', '', '', '', ''],
        [2, 99, '', '', 2, '', '', '', 'Tea'],
      ],
      Other: [['ignored']],
    }, 'raw.xlsx')
    const res = await parseRawdataFile(file)
    assert.equal(res.fileName, 'raw.xlsx')
    assert.equal(res.sheetName, 'Data')
    assert.deepEqual(res.headers, ['SbjNum', 'Q1', 'คอลัมน์ 3', 'S1_O1', 'S1_O2', 'Q5$1', 'q5$2', 's1_o3', 'Q1_oth'])
    assert.deepEqual(res.rows, [
      ['1', '2', 'x', '1', '', '3', '4', '5', 'กาแฟ'],
      ['2', '99', '', '', '2', '', '', '', 'Tea'],
    ])
    assert.deepEqual(res.questions, [
      { id: 'q0', index: 0, label: 'SbjNum', type: 'single', columns: [0] },
      { id: 'q1', index: 1, label: 'Q1', type: 'single', columns: [1] },
      { id: 'q2', index: 2, label: 'คอลัมน์ 3', type: 'single', columns: [2] },
      { id: 'q3', index: 3, label: 'S1', type: 'MA', columns: [3, 4] },
      { id: 'q5', index: 5, label: 'Q5', type: 'MA', columns: [5] },
      { id: 'q6', index: 6, label: 'q5', type: 'MA', columns: [6] }, // base match is case-sensitive
      { id: 'q7', index: 7, label: 's1', type: 'MA', columns: [7] },
      { id: 'q8', index: 8, label: 'Q1_oth', type: 'single', columns: [8] },
    ])
  })

  test('short rows are padded; header width follows the sheet range (extra data column gets a generated header)', async () => {
    const file = fakeFile({ S: [['A', 'B'], ['1'], ['1', '2', '3']] })
    const res = await parseRawdataFile(file)
    assert.deepEqual(res.headers, ['A', 'B', 'คอลัมน์ 3'])
    assert.deepEqual(res.rows, [['1', '', ''], ['1', '2', '3']])
  })

  test('empty sheet throws "ไฟล์ว่างเปล่า"', async () => {
    const file = fakeFile({ Empty: [] })
    await assert.rejects(() => parseRawdataFile(file), { message: 'ไฟล์ว่างเปล่า' })
  })

  test('header-only file returns no rows', async () => {
    const res = await parseRawdataFile(fakeFile({ S: [['ID', 'Q1']] }))
    assert.deepEqual(res.rows, [])
    assert.equal(res.questions.length, 2)
  })
})

// ================================================================ parseFrameFile

describe('parseFrameFile', () => {
  test('plain Test_Code layout: Net/Subnet/Grandnet rows, codes, thai2/eng, header and blank rows skipped', async () => {
    const file = fakeFile({ Frame: [
      ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English'],
      ['', 'Net : รสชาติ', '', ''],
      [1, 'อร่อย', 'รสดี', 'Tasty'],
      ['02', ' หวาน ', '', 'Sweet'],
      ['', '', '', ''],
      ['', 'Subnet: ราคา', '', ''],
      [3, 'ถูก', '', 'Cheap'],
      ['', 'GrandNet ภาพรวม', '', ''],
      ['', 'ข้อความอิสระที่ไม่มีรหัส', '', ''],
      ['ข้อ', 'Q1', '', ''],
      ['code', 'should skip', '', ''],
      ['', 'Net', '', ''],
      [99, 'อื่นๆ', '', 'Others'],
    ] })
    const nets = await parseFrameFile(file, idMaker())
    assert.deepEqual(nets, [
      { id: 'id1', name: 'รสชาติ', codes: [
        { id: 'id2', codeNo: '1', thai: 'อร่อย', thai2: 'รสดี', eng: 'Tasty' },
        { id: 'id3', codeNo: '02', thai: 'หวาน', thai2: '', eng: 'Sweet' },
      ] },
      { id: 'id4', name: 'ราคา', codes: [{ id: 'id5', codeNo: '3', thai: 'ถูก', thai2: '', eng: 'Cheap' }] },
      { id: 'id6', name: 'ภาพรวม', codes: [] },
      { id: 'id7', name: 'Net', codes: [{ id: 'id8', codeNo: '99', thai: 'อื่นๆ', thai2: '', eng: 'Others' }] },
    ])
  })

  test('codes before any Net row go into "ไม่ระบุกลุ่ม"', async () => {
    const file = fakeFile({ F: [[1, 'ชา', '', 'Tea'], [2, 'กาแฟ', '', 'Coffee']] })
    const nets = await parseFrameFile(file, idMaker())
    assert.equal(nets.length, 1)
    assert.equal(nets[0].name, 'ไม่ระบุกลุ่ม')
    assert.deepEqual(nets[0].codes.map((c) => c.codeNo), ['1', '2'])
  })

  test('only reads the first sheet', async () => {
    const file = fakeFile({ First: [[1, 'ชา']], Second: [[2, 'กาแฟ'], [3, 'นม']] })
    const nets = await parseFrameFile(file, idMaker())
    assert.deepEqual(nets.flatMap((n) => n.codes.map((c) => c.codeNo)), ['1'])
  })

  test('file with no Net and no code rows throws', async () => {
    const file = fakeFile({ F: [['Code No.', 'ThaiGroup'], ['', 'ข้อความเฉยๆ']] })
    await assert.rejects(() => parseFrameFile(file, idMaker()), /ไม่พบโครง Codeframe/)
  })
})

// ================================================================ exportRawdataWithEdits

describe('exportRawdataWithEdits', () => {
  const headers = ['SbjNum', 'Q1', 'Q1_oth']
  const rows = [
    ['001', '12', 'ข้อความ'],
    ['-3.5', '1e5', '1234567890123456'],
    ['0', '007', ''],
  ]

  test('numeric conversion, sheet name, file name, no log sheet when editLog empty', async () => {
    const calls = await captureStyleWrites(() => exportRawdataWithEdits(headers, rows, [], new Set(), 'out'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'out.xlsx')
    assert.deepEqual(calls[0].wb.SheetNames, ['Rawdata + Code'])
    const aoa = sheetAoA(calls[0].buf, 'Rawdata + Code')
    assert.deepEqual(aoa, [
      ['SbjNum', 'Q1', 'Q1_oth'],
      ['001', 12, 'ข้อความ'], // leading zero → kept as text
      [-3.5, '1e5', '1234567890123456'], // >= 1e15 stays text
      [0, '007', ''],
    ])
    const ws = calls[0].wb.Sheets['Rawdata + Code']
    assert.deepEqual(ws['!cols'].map((c) => c.wch), [7, 5, 17])
  })

  test('.xlsx suffix is not duplicated; null masks/editedCols tolerated', async () => {
    const calls = await captureStyleWrites(() => exportRawdataWithEdits(headers, rows, null, null, 'Edited.xlsx'))
    assert.equal(calls[0].name, 'Edited.xlsx')
  })

  test('edited header cells are indigo, edited data cells yellow, others unstyled; Recode Log sheet appended', async () => {
    const masks = [new Set([1]), new Set(), new Set([2])]
    const editedCols = new Set([1, 2])
    const editLog = [{
      keyHeader: 'SbjNum', rowKey: '001', rowIndex: 1, sheet: 'Q1', question: 'Q1', textQuestion: 'Q1_oth',
      codeColumn: 'Q1', codeColumnIndex: 2, textColumn: 'Q1_oth', textColumnIndex: 3,
      otherText: 'ข้อความ', originalCode: '99', newCode: '12', action: 'overwrite_other_code',
    }]
    const calls = await captureStyleWrites(() => exportRawdataWithEdits(headers, rows, masks, editedCols, 'x', editLog))
    assert.deepEqual(calls[0].wb.SheetNames, ['Rawdata + Code', 'Recode Log'])

    const wb = await loadExcel(calls[0].buf)
    const ws = wb.getWorksheet('Rawdata + Code')
    assert.equal(fillArgb(ws.getCell('A1')), null)
    assert.equal(fillArgb(ws.getCell('B1')), 'FF4F46E5')
    assert.equal(fillArgb(ws.getCell('C1')), 'FF4F46E5')
    assert.equal(ws.getCell('B1').font.bold, true)
    assert.equal(fillArgb(ws.getCell('B2')), 'FFFDE047')
    assert.equal(fillArgb(ws.getCell('C2')), null)
    assert.equal(fillArgb(ws.getCell('C4')), 'FFFDE047') // empty cell is created so it can be highlighted
    assert.equal(fillArgb(ws.getCell('B3')), null)

    const log = sheetAoA(calls[0].buf, 'Recode Log')
    assert.deepEqual(log[0], [
      'row_key_header', 'row_key', 'raw_row_no', 'sheet', 'question', 'text_question',
      'code_column', 'code_column_index', 'text_column', 'text_column_index',
      'other_text', 'original_code', 'new_code', 'rule_code', 'source_code_column', 'source_code_column_index',
      'action', 'duplicate_column', 'duplicate_column_index',
    ])
    assert.deepEqual(log[1], [
      'SbjNum', '001', 1, 'Q1', 'Q1', 'Q1_oth', 'Q1', 2, 'Q1_oth', 3,
      'ข้อความ', '99', '12', '', '', '', 'overwrite_other_code', '', '',
    ])
  })
})

// ================================================================ exportCodedData

describe('exportCodedData', () => {
  test('writes overwritten rawdata with highlights and Recode Log', async () => {
    const { rawdata, codebook, codeframe } = saFixture()
    const calls = await captureStyleWrites(() => exportCodedData(rawdata, codeframe, codebook, 'job42_coded'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'job42_coded.xlsx')
    assert.deepEqual(calls[0].wb.SheetNames, ['Rawdata + Code', 'Recode Log'])
    assert.deepEqual(sheetAoA(calls[0].buf, 'Rawdata + Code'), [
      ['SbjNum', 'Q1', 'Q1_oth'],
      ['R001', 1, ''],
      ['R002', 2, ''],
      ['R003', 99, 'ไม่รู้'],
      ['R004', 5, 'น้ำผลไม้'],
    ])
    const log = sheetAoA(calls[0].buf, 'Recode Log')
    assert.equal(log.length, 1 + 4)
    assert.deepEqual(log.slice(1).map((r) => r[16]), [
      'overwrite_other_code', 'overwrite_other_code', 'clear_coded_verbatim', 'replace_verbatim_with_code_label',
    ])

    const ws = (await loadExcel(calls[0].buf)).getWorksheet('Rawdata + Code')
    assert.equal(fillArgb(ws.getCell('B1')), 'FF4F46E5')
    assert.equal(fillArgb(ws.getCell('C1')), 'FF4F46E5')
    assert.equal(fillArgb(ws.getCell('B2')), 'FFFDE047')
    assert.equal(fillArgb(ws.getCell('C2')), 'FFFDE047')
    assert.equal(fillArgb(ws.getCell('B3')), null)
    assert.equal(fillArgb(ws.getCell('B4')), null)
    assert.equal(fillArgb(ws.getCell('B5')), 'FFFDE047')
  })

  test('nothing coded → single sheet, no highlights', async () => {
    const { rawdata, codebook } = saFixture()
    const calls = await captureStyleWrites(() => exportCodedData(rawdata, { sheets: [] }, codebook, 'plain.xlsx'))
    assert.equal(calls[0].name, 'plain.xlsx')
    assert.deepEqual(calls[0].wb.SheetNames, ['Rawdata + Code'])
    const ws = (await loadExcel(calls[0].buf)).getWorksheet('Rawdata + Code')
    assert.equal(fillArgb(ws.getCell('B1')), null)
  })
})

// ================================================================ exportRawdataXlsx

describe('exportRawdataXlsx', () => {
  test('without codeCols: sheet "Rawdata", numeric conversion, no styles', async () => {
    const calls = await captureStyleWrites(() => exportRawdataXlsx(['ID', 'Q1'], [['01', '3'], ['2', 'abc']], 'raw'))
    assert.equal(calls[0].name, 'raw.xlsx')
    assert.deepEqual(calls[0].wb.SheetNames, ['Rawdata'])
    assert.deepEqual(sheetAoA(calls[0].buf), [['ID', 'Q1'], ['01', 3], [2, 'abc']])
    const ws = (await loadExcel(calls[0].buf)).getWorksheet('Rawdata')
    assert.equal(fillArgb(ws.getCell('A1')), null)
    assert.equal(fillArgb(ws.getCell('B2')), null)
  })

  test('with codeCols: amber header + light amber cells on Code columns only', async () => {
    const headers = ['ID', 'Q1', 'Q1_Code1']
    const rows = [['1', 'ชา', '1'], ['2', 'กาแฟ', '']]
    const calls = await captureStyleWrites(() => exportRawdataXlsx(headers, rows, 'coded.xlsx', new Set([2])))
    assert.equal(calls[0].name, 'coded.xlsx')
    const ws = (await loadExcel(calls[0].buf)).getWorksheet('Rawdata')
    assert.equal(fillArgb(ws.getCell('C1')), 'FFF59E0B')
    assert.equal(ws.getCell('C1').font.bold, true)
    assert.equal(fillArgb(ws.getCell('C2')), 'FFFEF3C7')
    assert.equal(fillArgb(ws.getCell('C3')), 'FFFEF3C7') // blank cell created for highlight
    assert.equal(fillArgb(ws.getCell('B1')), null)
    assert.equal(fillArgb(ws.getCell('B2')), null)
  })

  test('empty codeCols Set behaves like no codeCols', async () => {
    const calls = await captureStyleWrites(() => exportRawdataXlsx(['A'], [['x']], 'e', new Set()))
    const ws = (await loadExcel(calls[0].buf)).getWorksheet('Rawdata')
    assert.equal(fillArgb(ws.getCell('A1')), null)
  })
})

// ================================================================ exportCodeframe

function codeframeFixture() {
  return {
    name: 'Brand Study',
    sheets: [
      {
        id: 's1',
        name: 'ยี่ห้อที่ชอบ_Q1_O1',
        nets: [
          { id: 'n0', level: 0, name: 'ignored level 0', codes: [{ id: 'c1', codeNo: '1', thai: 'ยี่ห้อ A', thai2: '', eng: 'Brand A' }] },
          { id: 'n1', level: 1, name: 'ยี่ห้อต่างประเทศ', codes: [{ id: 'c2', codeNo: '2', thai: 'ยี่ห้อ B', eng: 'Brand B' }] },
          { id: 'n2', level: 2, name: 'ยุโรป', codes: [
            { id: 'c3', codeNo: '03', thai: 'ยี่ห้อ C', thai2: 'ซี', eng: 'Brand C', manualNew: true },
            { id: 'c4', codeNo: 'X1', thai: 'ยี่ห้อ X', eng: 'Brand X', aiNew: true },
          ] },
          { id: 'n3', level: 1, name: '   ', codes: [] }, // blank name → no net row
        ],
      },
      { id: 's2', name: 'Q1/2', nets: [{ id: 'n', level: 0, codes: [{ id: 'd1', codeNo: '1', thai: 'ใช่', eng: 'Yes' }] }] },
      { id: 's3', name: 'Q1:2', nets: [] },
    ],
  }
}

describe('exportCodeframe', () => {
  test('default preset: sheet names, tab colors, question rows, header, nets, codes, file name & download', async () => {
    const cf = codeframeFixture()
    const colors = { s1: '22C55E', s3: 'EF4444' }
    const info = (sh) => (sh.id === 's1'
      ? { name: sh.name, questions: [{ column: 'Q1', label: 'คุณชอบยี่ห้อใด' }] }
      : { name: sh.name, questions: [] })
    const dl = await captureDownloads(() => exportCodeframe(cf, { jobNo: 'J100' }, (sh) => colors[sh.id], info))
    assert.equal(dl.length, 1)
    assert.equal(dl[0].tag, 'a')
    assert.equal(dl[0].name, 'J100_Brand Study.xlsx')
    assert.equal(dl[0].clicks, 1)
    assert.equal(dl[0].revoked, true)
    assert.equal(dl[0].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    const wb = await loadExcel(dl[0].buf)
    // "Q1/2" and "Q1:2" both sanitize to "Code Q1 2" → second one gets " (2)"
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Code Q1', 'Code Q1 2', 'Code Q1 2 (2)'])
    const [ws1, ws2, ws3] = wb.worksheets
    assert.equal(ws1.properties.tabColor?.argb, 'FF22C55E')
    assert.equal(ws2.properties.tabColor, undefined)
    assert.equal(ws3.properties.tabColor?.argb, 'FFEF4444')

    // sheet 1 layout
    assert.deepEqual(rowValues(ws1, 1), ['Q1', 'คุณชอบยี่ห้อใด', 'คุณชอบยี่ห้อใด', 'คุณชอบยี่ห้อใด']) // B:D merged
    assert.equal(fillArgb(ws1.getCell('A1')), 'FFEEF2FF')
    assert.deepEqual(rowValues(ws1, 2), ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English'])
    assert.equal(fillArgb(ws1.getCell('A2')), 'FFDBE5F1')
    assert.equal(ws1.getCell('A2').font.bold, true)
    assert.deepEqual(ws1.views[0], { ...ws1.views[0], state: 'frozen', xSplit: 1, ySplit: 2 })
    assert.deepEqual(rowValues(ws1, 3), [1, 'ยี่ห้อ A', '', 'Brand A']) // level-0 net → no net row
    assert.deepEqual(rowValues(ws1, 4), ['', 'Net : ยี่ห้อต่างประเทศ', '', ''])
    assert.equal(ws1.getCell('B4').font.bold, true)
    assert.deepEqual(rowValues(ws1, 5), [2, 'ยี่ห้อ B', '', 'Brand B'])
    assert.deepEqual(rowValues(ws1, 6), ['', '    Subnet : ยุโรป', '', ''])
    assert.deepEqual(rowValues(ws1, 7), ['03', 'ยี่ห้อ C', 'ซี', 'Brand C']) // leading zero → stays text
    assert.deepEqual(rowValues(ws1, 8), ['X1', 'ยี่ห้อ X', '', 'Brand X'])
    assert.equal(ws1.rowCount, 8)
    // added codes (manualNew / aiNew) get yellow fill + amber left border on col A
    for (const r of [7, 8]) {
      assert.equal(fillArgb(ws1.getCell(r, 1)), 'FFFEF3C7')
      assert.equal(fillArgb(ws1.getCell(r, 4)), 'FFFEF3C7')
      assert.equal(ws1.getCell(r, 1).border.left.style, 'medium')
      assert.equal(ws1.getCell(r, 1).border.left.color.argb, 'FFF59E0B')
      assert.equal(ws1.getCell(r, 2).border.left.style, 'thin')
    }
    assert.equal(fillArgb(ws1.getCell('A5')), null)
    assert.equal(ws1.getCell('A5').border.left.style, 'thin')
    assert.deepEqual(ws1.columns.map((c) => c.width), [14, 60, 22, 30])

    // sheet without info.questions → single question row with the short name
    assert.deepEqual(rowValues(ws2, 1), ['Q1/2', '', '', '']) // question cell keeps the unsanitized short name
    assert.deepEqual(rowValues(ws2, 2), ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English'])
    assert.deepEqual(rowValues(ws2, 3), [1, 'ใช่', '', 'Yes'])
  })

  test('without getSheetInfo/getSheetColor and without job: falls back to sheet.name and plain file name', async () => {
    const cf = { name: 'CF', sheets: [{ id: 'a', name: 'Q7', nets: [{ level: 1, name: 'กลุ่ม', codes: [] }] }] }
    const dl = await captureDownloads(() => exportCodeframe(cf, null))
    assert.equal(dl[0].name, 'CF.xlsx')
    const wb = await loadExcel(dl[0].buf)
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Code Q7'])
    const ws = wb.worksheets[0]
    assert.deepEqual(rowValues(ws, 1), ['Q7', '', '', ''])
    assert.deepEqual(rowValues(ws, 3), ['', 'Net : กลุ่ม', '', ''])
  })

  test('options.fileName overrides and gets .xlsx appended when missing', async () => {
    const cf = { name: 'CF', sheets: [] }
    const dl = await captureDownloads(() => exportCodeframe(cf, { jobNo: 'J1' }, null, null, { fileName: 'custom' }))
    assert.equal(dl[0].name, 'custom.xlsx')
  })

  test('long sheet names are truncated to 31 chars and de-duplicated', async () => {
    const long = 'Q' + 'a'.repeat(40)
    const cf = { name: 'CF', sheets: [{ id: '1', name: long, nets: [] }, { id: '2', name: long, nets: [] }] }
    const dl = await captureDownloads(() => exportCodeframe(cf, null))
    const names = (await loadExcel(dl[0].buf)).worksheets.map((w) => w.name)
    assert.equal(names[0], `Code ${long}`.slice(0, 31))
    assert.equal(names[1], `${`Code ${long}`.slice(0, 27)} (2)`)
  })

  test('freqByCode only → single "Frequency" column with green/grey styling', async () => {
    const cf = { name: 'CF', sheets: [{ id: 's', name: 'Q1', nets: [{ level: 0, codes: [
      { id: 'c1', codeNo: '1', thai: 'ชา' },
      { id: 'c2', codeNo: '2', thai: 'กาแฟ' },
    ] }] }] }
    const dl = await captureDownloads(() => exportCodeframe(cf, null, null,
      () => ({ name: 'Q1', questions: [{ column: 'Q1', label: '' }] }),
      { freqByCode: { s: { c1: 7 } } }))
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.deepEqual(rowValues(ws, 1), ['Q1', '', '', '', ''])
    assert.deepEqual(rowValues(ws, 2), ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English', 'Frequency'])
    assert.deepEqual(rowValues(ws, 3), [1, 'ชา', '', '', 7])
    assert.deepEqual(rowValues(ws, 4), [2, 'กาแฟ', '', '', 0])
    assert.equal(fillArgb(ws.getCell('E3')), 'FFD1FAE5')
    assert.equal(ws.getCell('E3').font.bold, true)
    assert.equal(ws.getCell('E3').font.color.argb, 'FF047857')
    assert.equal(fillArgb(ws.getCell('E4')), 'FFF1F5F9')
    assert.equal(ws.getCell('E4').font.color.argb, 'FF94A3B8')
    assert.equal(ws.columns.length, 5)
  })

  test('multi-question sheet with per-question frequency → one column per question + "รวม"', async () => {
    const cf = { name: 'CF', sheets: [{ id: 's', name: 'Q3', nets: [{ level: 0, codes: [
      { id: 'c1', codeNo: '1', thai: 'ดี' },
      { id: 'c2', codeNo: '2', thai: 'ไม่ดี' },
    ] }] }] }
    const info = () => ({ name: 'Q3', questions: [{ column: 'Q3_1', label: 'ข้อแรก' }, { id: 'qx', column: 'Q3_2', label: 'ข้อสอง' }] })
    const dl = await captureDownloads(() => exportCodeframe(cf, null, null, info, {
      freqByCode: { s: { c1: 9, c2: 0 } },
      freqByCodeByQuestion: { s: { c1: { Q3_1: 4, Q3_2: 5 }, c2: { Q3_1: 0 } } },
    }))
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.equal(rowValues(ws, 1)[0], 'Q3_1')
    assert.equal(rowValues(ws, 2)[0], 'Q3_2')
    assert.deepEqual(rowValues(ws, 3), ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English', 'Q3_1', 'Q3_2', 'รวม'])
    assert.deepEqual(rowValues(ws, 4), [1, 'ดี', '', '', 4, 5, 9])
    assert.deepEqual(rowValues(ws, 5), [2, 'ไม่ดี', '', '', 0, 0, 0])
    assert.equal(fillArgb(ws.getCell('G4')), 'FFA7F3D0') // total column, darker green
    assert.equal(ws.getCell('G4').font.color.argb, 'FF065F46')
    assert.equal(fillArgb(ws.getCell('E4')), 'FFD1FAE5')
    assert.deepEqual(ws.views[0], { ...ws.views[0], ySplit: 3 })
  })

  test('multi-question per-question frequency without freqByCode sums the per-question values', async () => {
    const cf = { name: 'CF', sheets: [{ id: 's', name: 'Q3', nets: [{ level: 0, codes: [{ id: 'c1', codeNo: '1', thai: 'ดี' }] }] }] }
    const info = () => ({ name: 'Q3', questions: [{ column: 'Q3_1' }, { column: 'Q3_2' }] })
    const dl = await captureDownloads(() => exportCodeframe(cf, null, null, info, {
      freqByCodeByQuestion: { s: { c1: { Q3_1: 2, Q3_2: '3' } } },
    }))
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.deepEqual(rowValues(ws, 4), [1, 'ดี', '', '', 2, 3, 5])
  })

  test('single-question sheet with per-question frequency → "Frequency" header, value from freqByCode', async () => {
    const cf = { name: 'CF', sheets: [{ id: 's', name: 'Q4', nets: [{ level: 0, codes: [{ id: 'c1', codeNo: '1', thai: 'ดี' }] }] }] }
    const info = () => ({ name: 'Q4', questions: [{ column: 'Q4', label: 'โจทย์' }] })
    const dl = await captureDownloads(() => exportCodeframe(cf, null, null, info, {
      freqByCode: { s: { c1: 6 } },
      freqByCodeByQuestion: { s: { c1: { Q4: 6 } } },
    }))
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.deepEqual(rowValues(ws, 2), ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English', 'Frequency'])
    assert.deepEqual(rowValues(ws, 3), [1, 'ดี', '', '', 6])
  })

  test('single-question sheet with ONLY freqByCodeByQuestion should still show the per-question count', {
    todo: 'excel.js:851-852 — per=[] when !multiQuestion, so total falls back to 0 and the count is lost (callers currently always pass freqByCode too)',
  }, async () => {
    const cf = { name: 'CF', sheets: [{ id: 's', name: 'Q4', nets: [{ level: 0, codes: [{ id: 'c1', codeNo: '1', thai: 'ดี' }] }] }] }
    const info = () => ({ name: 'Q4', questions: [{ column: 'Q4', label: '' }] })
    const dl = await captureDownloads(() => exportCodeframe(cf, null, null, info, { freqByCodeByQuestion: { s: { c1: { Q4: 6 } } } }))
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.deepEqual(rowValues(ws, 3), [1, 'ดี', '', '', 6])
  })

  test('multi-question sheet: code missing from freqByCodeByQuestion should put its total under "รวม"', {
    todo: 'excel.js:854-855 — returns [total] (one value) so the total lands in the first question column instead of the "รวม" column',
  }, async () => {
    const cf = { name: 'CF', sheets: [{ id: 's', name: 'Q3', nets: [{ level: 0, codes: [
      { id: 'c1', codeNo: '1', thai: 'ดี' }, { id: 'c2', codeNo: '2', thai: 'ใหม่' },
    ] }] }] }
    const info = () => ({ name: 'Q3', questions: [{ column: 'Q3_1' }, { column: 'Q3_2' }] })
    const dl = await captureDownloads(() => exportCodeframe(cf, null, null, info, {
      freqByCode: { s: { c1: 1, c2: 4 } },
      freqByCodeByQuestion: { s: { c1: { Q3_1: 1, Q3_2: 0 } } },
    }))
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.deepEqual(rowValues(ws, 5), [2, 'ใหม่', '', '', 0, 0, 4])
  })

  test('customer preset: title + note rows, dark header, net row fill, wider columns, _customer file name', async () => {
    const cf = { name: 'ลูกค้า CF', sheets: [{ id: 's', name: 'Q1', nets: [
      { level: 1, name: 'กลุ่มหลัก', codes: [
        { id: 'c1', codeNo: '1', thai: 'ชา', eng: 'Tea' },
        { id: 'c2', codeNo: '2', thai: 'กาแฟ', eng: 'Coffee', manualNew: true },
      ] },
    ] }] }
    const info = () => ({ name: 'Q1', questions: [{ column: 'Q1', label: 'ดื่มอะไร' }] })
    const dl = await captureDownloads(() => exportCodeframe(cf, { jobNo: 'J9' }, () => '3B82F6', info, { preset: 'customer', freqByCode: { s: { c1: 3, c2: 1 } } }))
    assert.equal(dl[0].name, 'J9_ลูกค้า CF_customer.xlsx')
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.equal(ws.properties.tabColor.argb, 'FF3B82F6')
    assert.equal(ws.getCell('A1').value, 'ลูกค้า CF')
    assert.equal(ws.getCell('A1').font.size, 16)
    assert.equal(ws.getCell('A2').value, 'หมายเหตุ: แถวสีเหลือง = Code ที่เพิ่มใหม่')
    assert.equal(fillArgb(ws.getCell('A2')), 'FFFFF2CC')
    assert.deepEqual(rowValues(ws, 3), ['', '', '', '', ''])
    assert.deepEqual(rowValues(ws, 4).slice(0, 2), ['Q1', 'ดื่มอะไร'])
    assert.equal(fillArgb(ws.getCell('A4')), 'FFF8FAFC')
    assert.deepEqual(rowValues(ws, 5), ['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English', 'Frequency'])
    assert.equal(fillArgb(ws.getCell('A5')), 'FF1F2937')
    assert.equal(ws.getCell('A5').font.color.argb, 'FFFFFFFF')
    assert.deepEqual(rowValues(ws, 6).slice(0, 2), ['', 'Net : กลุ่มหลัก'])
    assert.equal(fillArgb(ws.getCell('C6')), 'FFE5E7EB')
    assert.deepEqual(rowValues(ws, 7), [1, 'ชา', '', 'Tea', 3])
    assert.deepEqual(rowValues(ws, 8), [2, 'กาแฟ', '', 'Coffee', 1])
    assert.equal(fillArgb(ws.getCell('B8')), 'FFFFF2CC')
    assert.equal(ws.getCell('B7').alignment.wrapText, true)
    assert.equal(ws.getCell('A7').alignment.horizontal, 'center')
    assert.equal(ws.getCell('A7').border.top.color.argb, 'FFD6D3CC')
    assert.deepEqual(ws.columns.map((c) => c.width), [12, 68, 24, 34, 12])
    assert.equal(ws.views[0].ySplit, 5)
  })

  test('default name falls back when job has no jobNo', async () => {
    const dl = await captureDownloads(() => exportCodeframe({ name: 'N', sheets: [] }, { jobNo: '' }, null, null, { preset: 'customer' }))
    assert.equal(dl[0].name, 'N_customer.xlsx')
  })
})

// ================================================================ exportCodeframeSheet

describe('exportCodeframeSheet', () => {
  test('exports only the given sheet with "<codeframe>_<short sheet>" name', async () => {
    const cf = codeframeFixture()
    const target = cf.sheets[0]
    const dl = await captureDownloads(() => exportCodeframeSheet(cf, target, { jobNo: 'J1' }, () => 'F59E0B', (sh) => ({ name: sh.name, questions: [] })))
    assert.equal(dl.length, 1)
    assert.equal(dl[0].name, 'Brand Study_Q1.xlsx')
    const wb = await loadExcel(dl[0].buf)
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Code Q1'])
    assert.equal(wb.worksheets[0].properties.tabColor.argb, 'FFF59E0B')
  })

  test('unsafe filename characters are replaced and missing names fall back', async () => {
    const dl = await captureDownloads(() => exportCodeframeSheet({ sheets: [] }, { id: 'x', name: 'a/b:c*?', nets: [] }, null))
    assert.equal(dl[0].name, 'Codeframe_a_b_c__.xlsx')
    const dl2 = await captureDownloads(() => exportCodeframeSheet({ name: 'CF' }, { id: 'n', nets: [] }, null))
    assert.equal(dl2[0].name, 'CF_sheet.xlsx')
  })

  test('options.fileName overrides; customer preset is forwarded (title row uses combined name)', async () => {
    const sheet = { id: 's', name: 'Q2', nets: [] }
    const dl = await captureDownloads(() => exportCodeframeSheet({ name: 'CF' }, sheet, null, null, null, { fileName: 'mine', preset: 'customer' }))
    assert.equal(dl[0].name, 'mine.xlsx')
    const ws = (await loadExcel(dl[0].buf)).worksheets[0]
    assert.equal(ws.getCell('A1').value, 'CF_Q2')
  })
})

// ================================================================ exportQuestionList

describe('exportQuestionList', () => {
  const rows = [
    { sheetNo: 1, sheetName: 'Q1', variable: 'Q1', column: 'Q1_oth', question: 'คุณชอบดื่มอะไร', codeCount: 5, status: 'done' },
    { sheetNo: 2, sheetName: 'Q2', variable: 'Q2', column: 'Q2_1', question: 'Why?', codeCount: 0, status: '' },
  ]

  test('sheet "Questions" with header, rows, styles, frozen header, autofilter and default file name', async () => {
    const dl = await captureDownloads(() => exportQuestionList(rows))
    assert.equal(dl[0].name, 'questions_export.xlsx')
    assert.equal(dl[0].clicks, 1)
    assert.equal(dl[0].revoked, true)
    const wb = await loadExcel(dl[0].buf)
    assert.equal(wb.creator, 'COF Codeframe Studio')
    const ws = wb.getWorksheet('Questions')
    assert.ok(ws)
    assert.deepEqual(rowValues(ws, 1), ['Sheet No.', 'Sheet Name', 'Variable / Code', 'Rawdata Column', 'Question Text / โจทย์', 'Code Count', 'Status'])
    assert.deepEqual(rowValues(ws, 2), [1, 'Q1', 'Q1', 'Q1_oth', 'คุณชอบดื่มอะไร', 5, 'done'])
    assert.deepEqual(rowValues(ws, 3).slice(0, 6), [2, 'Q2', 'Q2', 'Q2_1', 'Why?', 0])
    assert.equal(ws.rowCount, 3)
    assert.equal(fillArgb(ws.getCell('A1')), 'FF4F46E5')
    assert.equal(fillArgb(ws.getCell('G1')), 'FF4F46E5')
    assert.equal(ws.getCell('A1').font.bold, true)
    assert.equal(ws.getCell('E2').alignment.wrapText, true)
    assert.ok(!ws.getCell('D2').alignment.wrapText)
    assert.equal(fillArgb(ws.getCell('A2')), null)
    assert.equal(ws.views[0].state, 'frozen')
    assert.equal(ws.views[0].ySplit, 1)
    assert.ok(ws.autoFilter)
    assert.deepEqual(ws.columns.map((c) => c.width), [10, 24, 18, 20, 72, 12, 24])
  })

  test('custom file name gets .xlsx appended; empty rows → header only', async () => {
    const dl = await captureDownloads(() => exportQuestionList([], 'list'))
    assert.equal(dl[0].name, 'list.xlsx')
    const ws = (await loadExcel(dl[0].buf)).getWorksheet('Questions')
    assert.equal(ws.rowCount, 1)
  })
})

// ================================================================ exportQuestionCodeList

describe('exportQuestionCodeList', () => {
  const rows = [
    { kind: 'question', no: 1, variable: 'Q1', text: 'คุณชอบดื่มอะไร', frequency: 120 },
    { kind: 'code', no: '', variable: '', text: '1. ชา', frequency: 70 },
    { kind: 'code', no: '', variable: '', text: '2. กาแฟ', frequency: 50 },
  ]

  test('sheet "Questions + Codes": 4 columns, question rows shaded, frequency cell green', async () => {
    const dl = await captureDownloads(() => exportQuestionCodeList(rows))
    assert.equal(dl[0].name, 'questions_and_codes.xlsx')
    const wb = await loadExcel(dl[0].buf)
    const ws = wb.getWorksheet('Questions + Codes')
    assert.ok(ws)
    assert.deepEqual(rowValues(ws, 1), ['No.', 'Variable', 'Question Text / โจทย์', 'Frequency'])
    assert.equal(fillArgb(ws.getCell('D1')), 'FF4F46E5')
    assert.deepEqual(rowValues(ws, 2), [1, 'Q1', 'คุณชอบดื่มอะไร', 120])
    assert.deepEqual(rowValues(ws, 3), ['', '', '1. ชา', 70])
    assert.deepEqual(rowValues(ws, 4), ['', '', '2. กาแฟ', 50])
    // question row
    assert.equal(fillArgb(ws.getCell('A2')), 'FFF8FAFC')
    assert.equal(fillArgb(ws.getCell('C2')), 'FFF8FAFC')
    assert.equal(ws.getCell('C2').font.bold, true)
    assert.equal(fillArgb(ws.getCell('D2')), 'FF92D050')
    assert.equal(ws.getCell('A2').alignment.horizontal, 'right')
    assert.equal(ws.getCell('A2').border.top.style, 'thin')
    // code row
    assert.equal(fillArgb(ws.getCell('C3')), null)
    assert.equal(fillArgb(ws.getCell('D3')), null)
    assert.equal(ws.getCell('D3').alignment.horizontal, 'center')
    assert.equal(ws.getCell('C3').alignment.wrapText, true)
    assert.equal(ws.getCell('C3').border.top.style, 'hair')
    assert.equal(ws.views[0].ySplit, 1)
    assert.deepEqual(ws.columns.map((c) => c.width), [8, 18, 76, 14])
  })

  test('custom file name keeps existing .xlsx', async () => {
    const dl = await captureDownloads(() => exportQuestionCodeList([], 'qc.xlsx'))
    assert.equal(dl[0].name, 'qc.xlsx')
  })
})

test('global stubs are restored after export tests', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.equal(XS.writeFile, ORIGINAL_WRITE_FILE)
})
