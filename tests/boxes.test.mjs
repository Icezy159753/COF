// Characterization tests for src/lib/boxes.js — lock in CURRENT behavior.
// Complements tests/oth-code-exact.test.mjs (which already covers the core exact-code
// mapping + production-like findOtherColumns / scopedVerbatimQuestionIds cases).
// Synthetic data only.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOX_META,
  isWorkBox,
  shortSheetName,
  newRowCount,
  isTextQuestion,
  detectTextQuestions,
  isOtherLabel,
  OTHER_LABEL_RE,
  hasOtherOption,
  findOtherColumns,
  scopedVerbatimQuestionIds,
  findOtherColumn,
  questionGroupBase,
  closedQuestionGroup,
  closedQuestionGroupColumns,
  otherCodeFromColumnLabel,
  otherColumnsForCode,
  freqByValue,
  guessSbjNum,
} from '../src/lib/boxes.js'

const OTHER_CB = { values: [{ value: '1', label: 'กาแฟ' }, { value: '99', label: 'อื่นๆ ระบุ' }] }
const PLAIN_CB = { values: [{ value: '1', label: 'กาแฟ' }, { value: '2', label: 'ชา' }] }
const labels = (qs) => qs.map((q) => q.label)
// one-column question helper
const q = (id, label, index, extra = {}) => ({ id, label, index, columns: [index], ...extra })
// build rows from column arrays of equal length
const rowsFromCols = (...cols) => cols[0].map((_, r) => cols.map((c) => c[r]))

describe('BOX_META', () => {
  test('has exactly the four boxes with stable metadata', () => {
    assert.deepEqual(BOX_META, {
      rawdata: { key: 'rawdata', label: 'Rawdata', desc: 'ศูนย์กลางข้อมูล', color: 'emerald' },
      ce: { key: 'ce', label: 'CE', desc: 'Coding & Editing', color: 'sky' },
      oe: { key: 'oe', label: 'OE', desc: 'Open-Ended', color: 'violet' },
      verbatim: { key: 'verbatim', label: 'Verbatim', desc: 'แก้ข้อความ + ตรวจ AI', color: 'amber' },
    })
  })

  test('each entry key matches its object key', () => {
    for (const [k, meta] of Object.entries(BOX_META)) assert.equal(meta.key, k)
  })
})

describe('isWorkBox', () => {
  test('only ce and oe are work boxes', () => {
    assert.equal(isWorkBox('ce'), true)
    assert.equal(isWorkBox('oe'), true)
  })

  test('other boxes, case variants and empty input are not', () => {
    for (const v of ['rawdata', 'verbatim', 'CE', 'OE', ' ce', '', undefined, null]) {
      assert.equal(isWorkBox(v), false, `isWorkBox(${JSON.stringify(v)})`)
    }
  })
})

describe('shortSheetName', () => {
  test('documented examples', () => {
    assert.equal(shortSheetName('รสแรก_d4'), 'd4')
    assert.equal(shortSheetName('s12_O1'), 's12')
    assert.equal(shortSheetName('I_1_d5_O1'), 'I_1_d5')
    assert.equal(shortSheetName('a1.1-a2.2'), 'a1.1-a2.2')
    assert.equal(shortSheetName('a1_1_1'), 'a1_1_1')
  })

  test('Thai name keeps only the trailing ASCII code', () => {
    assert.equal(shortSheetName('รสชาติที่ชอบมากที่สุด q15'), 'q15')
    assert.equal(shortSheetName('ความพึงพอใจ_A3_O2'), 'A3')
  })

  test('Thai name without trailing ASCII code is kept as is', () => {
    assert.equal(shortSheetName('ชื่อไทยล้วน'), 'ชื่อไทยล้วน')
    assert.equal(shortSheetName('abc_ไทย'), 'abc_ไทย')
  })

  test('strips MA suffixes _O<n> (case-insensitive) and $<n>, only the last one', () => {
    assert.equal(shortSheetName('q5$1'), 'q5')
    assert.equal(shortSheetName('q5_o2'), 'q5')
    assert.equal(shortSheetName('q1_O1_O2'), 'q1_O1')
  })

  test('uses part before first comma and trims', () => {
    assert.equal(shortSheetName('Sheet1, extra, more'), 'Sheet1')
    assert.equal(shortSheetName('  s1  '), 's1')
  })

  test('strips leading underscores', () => {
    assert.equal(shortSheetName('__abc'), 'abc')
    assert.equal(shortSheetName('_O1'), 'O1')
  })

  test('falls back to trimmed original when stripping leaves nothing', () => {
    assert.equal(shortSheetName('___'), '___')
    assert.equal(shortSheetName(' ___ '), '___')
  })

  test('null / undefined / numbers', () => {
    assert.equal(shortSheetName(undefined), '')
    assert.equal(shortSheetName(null), '')
    assert.equal(shortSheetName(''), '')
    assert.equal(shortSheetName(123), '123')
  })
})

describe('newRowCount', () => {
  test('rowCount minus the box watermark', () => {
    const project = { rawMeta: { rowCount: 10 }, boxes: { ce: { seenRowCount: 4 } } }
    assert.equal(newRowCount(project, 'ce'), 6)
  })

  test('missing box / watermark → all rows are new', () => {
    const project = { rawMeta: { rowCount: 10 }, boxes: {} }
    assert.equal(newRowCount(project, 'oe'), 10)
    assert.equal(newRowCount({ rawMeta: { rowCount: 3 } }, 'ce'), 3)
  })

  test('never negative', () => {
    const project = { rawMeta: { rowCount: 2 }, boxes: { ce: { seenRowCount: 5 } } }
    assert.equal(newRowCount(project, 'ce'), 0)
  })

  test('missing project / rawMeta → 0', () => {
    assert.equal(newRowCount(undefined, 'ce'), 0)
    assert.equal(newRowCount(null, 'ce'), 0)
    assert.equal(newRowCount({}, 'ce'), 0)
  })
})

describe('isTextQuestion', () => {
  const textVals = ['ราคาแพงมาก', 'รสชาติดี', 'บริการช้า', 'ที่จอดรถน้อย', 'สะอาด ดี']

  test('varied non-numeric text is a text question', () => {
    const rd = { questions: [q('a', 'A', 0)], rows: textVals.map((v) => [v]) }
    assert.equal(isTextQuestion(rd, rd.questions[0]), true)
  })

  test('numeric codes are not text', () => {
    const rd = { questions: [q('a', 'A', 0)], rows: ['1', '2', '3', '-4', '5.5'].map((v) => [v]) }
    assert.equal(isTextQuestion(rd, rd.questions[0]), false)
  })

  test('no non-empty samples → false', () => {
    const rd = { questions: [q('a', 'A', 0)], rows: [[''], ['  '], [null], [undefined]] }
    assert.equal(isTextQuestion(rd, rd.questions[0]), false)
    assert.equal(isTextQuestion({ questions: [], rows: [] }, q('a', 'A', 0)), false)
  })

  test('numericRatio must be strictly < 0.4', () => {
    // 2/5 numeric = 0.4 → false
    const at = { rows: ['1', '2', 'hello', 'world', 'again'].map((v) => [v]) }
    assert.equal(isTextQuestion(at, q('a', 'A', 0)), false)
    // 1/5 numeric = 0.2 → true
    const below = { rows: ['1', 'hello!', 'hello', 'world', 'again'].map((v) => [v]) }
    assert.equal(isTextQuestion(below, q('a', 'A', 0)), true)
  })

  test('avgLen must be >= 4', () => {
    assert.equal(isTextQuestion({ rows: [['abcd'], ['efgh'], ['ijkl']] }, q('a', 'A', 0)), true)
    assert.equal(isTextQuestion({ rows: [['abc'], ['def'], ['ghi']] }, q('a', 'A', 0)), false)
  })

  test('distinctRatio must be strictly > 0.4', () => {
    // 2 distinct / 5 = 0.4 → false
    const at = { rows: ['hello', 'hello', 'hello', 'world', 'world'].map((v) => [v]) }
    assert.equal(isTextQuestion(at, q('a', 'A', 0)), false)
    // 3 distinct / 5 = 0.6 → true
    const above = { rows: ['hello', 'hello', 'hello', 'world', 'again'].map((v) => [v]) }
    assert.equal(isTextQuestion(above, q('a', 'A', 0)), true)
  })

  test('values are trimmed before counting', () => {
    // " 12 " is numeric-like after trim
    const rd = { rows: [[' 12 '], [' 13 '], ['text value']] }
    assert.equal(isTextQuestion(rd, q('a', 'A', 0)), false)
  })

  test('"1,000" and "1e5" are not numeric-like', () => {
    const rd = { rows: [['1,000'], ['2,000'], ['1e5'], ['3,500']] }
    assert.equal(isTextQuestion(rd, q('a', 'A', 0)), true)
  })

  test('reads all MA columns of the question; falls back to q.index', () => {
    const rd = { rows: [['1', 'ราคาแพงมาก', 'สะอาดดี'], ['2', 'รสชาติดี', 'บริการดี']] }
    assert.equal(isTextQuestion(rd, { id: 'm', label: 'M', index: 0, columns: [1, 2] }), true)
    assert.equal(isTextQuestion(rd, { id: 'm', label: 'M', index: 1 }), true)
    assert.equal(isTextQuestion(rd, { id: 'm', label: 'M', index: 0 }), false)
  })

  test('only the first 80 non-empty values are sampled', () => {
    const nums = Array.from({ length: 80 }, (_, i) => [String(i)])
    const texts = Array.from({ length: 100 }, (_, i) => [`คำตอบที่ ${i}`])
    assert.equal(isTextQuestion({ rows: [...nums, ...texts] }, q('a', 'A', 0)), false)
    assert.equal(isTextQuestion({ rows: [...texts, ...nums] }, q('a', 'A', 0)), true)
  })

  test('sparse rows (undefined row) are tolerated', () => {
    const rows = [undefined, ['ราคาแพงมาก'], ['รสชาติดี']]
    assert.equal(isTextQuestion({ rows }, q('a', 'A', 0)), true)
  })
})

describe('detectTextQuestions', () => {
  test('returns ids of text-like questions in questions order', () => {
    const rd = {
      questions: [q('id', 'id', 0), q('t1', 'Q1', 1), q('c', 'Q2', 2), q('t2', 'Q3', 3)],
      rows: rowsFromCols(
        ['1', '2', '3'],
        ['ราคาแพง', 'รสชาติดี', 'บริการช้า'],
        ['1', '1', '2'],
        ['very good', 'not bad', 'excellent'],
      ),
    }
    assert.deepEqual(detectTextQuestions(rd), ['t1', 't2'])
  })

  test('null / undefined rawdata → []', () => {
    assert.deepEqual(detectTextQuestions(null), [])
    assert.deepEqual(detectTextQuestions(undefined), [])
  })

  test('no questions → []', () => {
    assert.deepEqual(detectTextQuestions({ questions: [], rows: [['x']] }), [])
  })
})

describe('isOtherLabel', () => {
  test('recognises all documented "other, please specify" spellings', () => {
    const yes = [
      'อื่นๆ', 'อื่น ๆ', 'อื่นๆระบุ', 'อื่นๆ ระบุ', 'อื่นๆ_____ระบุ', 'อื่นๆ (โปรดระบุ)',
      'Other', 'Others', 'OTHER', 'Other specify', 'Other (specify)', 'Pls specify', 'โปรดระบุ',
      'กาแฟพิเศษ (อื่น____)', 'Other ____', 'อื่นๆ....', '  other  ', 'other.', '（อื่นๆ）',
      'Please SPECIFY',
    ]
    for (const l of yes) assert.equal(isOtherLabel(l), true, `expected other: ${l}`)
  })

  test('rejects "not specified" / "don\'t know" style labels even with other-words', () => {
    const no = ['ไม่ระบุ', 'ไม่ทราบ', 'Unspecified', 'Not specified', 'not specify', 'อื่นๆ ไม่ระบุ', 'Other (not specified)']
    for (const l of no) assert.equal(isOtherLabel(l), false, `expected not other: ${l}`)
  })

  test('rejects long categories that merely contain "อื่น"/"other"', () => {
    const no = ['พนักงานบริษัทฯ ในตำแหน่งอื่นๆ', 'Another', 'Others brand X', 'Brother', 'กาแฟ', 'ชา']
    for (const l of no) assert.equal(isOtherLabel(l), false, `expected not other: ${l}`)
  })

  test('empty / nullish / numeric', () => {
    for (const l of ['', '   ', null, undefined, 99, 0]) assert.equal(isOtherLabel(l), false, `isOtherLabel(${l})`)
  })

  test('"Mother"/"Brother" inside parentheses is not an Other option', {
    todo: 'boxes.js:101 paren regex has no word boundary: "(mother)" matches "other" → true',
  }, () => {
    assert.equal(isOtherLabel('มารดา (Mother)'), false)
    assert.equal(isOtherLabel('Parent (brother)'), false)
  })

  test('"Mother ..." with trailing dots is not an Other option', {
    todo: 'boxes.js:102 /(other)\\s*[_.]{2,}/ has no word boundary: "Mother ..." → true',
  }, () => {
    assert.equal(isOtherLabel('Mother ...'), false)
  })
})

describe('OTHER_LABEL_RE (legacy loose regex)', () => {
  test('matches anything containing อื่น / other / specify / โปรดระบุ, case-insensitive', () => {
    for (const s of ['อื่นๆ', 'Other', 'OTHERS', 'Please specify', 'โปรดระบุ', 'Mother', 'ตำแหน่งอื่น']) {
      assert.equal(OTHER_LABEL_RE.test(s), true, s)
    }
  })

  test('does not match unrelated text', () => {
    for (const s of ['ไม่ระบุ', 'unspecified', 'กาแฟ', '']) assert.equal(OTHER_LABEL_RE.test(s), false, s)
  })

  test('is not global (no lastIndex state between calls)', () => {
    assert.equal(OTHER_LABEL_RE.global, false)
    assert.equal(OTHER_LABEL_RE.flags, 'i')
  })
})

describe('hasOtherOption', () => {
  test('true when any value label is an Other option', () => {
    assert.equal(hasOtherOption(OTHER_CB), true)
  })

  test('false for plain closed lists, empty values and missing codebook entry', () => {
    assert.equal(hasOtherOption(PLAIN_CB), false)
    assert.equal(hasOtherOption({ values: [] }), false)
    assert.equal(hasOtherOption({}), false)
    assert.equal(hasOtherOption(undefined), false)
    assert.equal(hasOtherOption(null), false)
  })

  test('"ไม่ระบุ" value label alone does not count', () => {
    assert.equal(hasOtherOption({ values: [{ value: '9', label: 'ไม่ระบุ' }] }), false)
  })
})

describe('findOtherColumns (extra cases beyond oth-code-exact)', () => {
  test('guards: missing rawdata / question → []', () => {
    const cb = { byVar: { q1: OTHER_CB } }
    assert.deepEqual(findOtherColumns(null, q('q1', 'q1', 0), cb), [])
    assert.deepEqual(findOtherColumns({ questions: [], rows: [] }, null, cb), [])
  })

  test('closed question without an Other option → []', () => {
    const rd = { questions: [q('q1', 'q1', 0), q('o', 'q1_oth', 1)], rows: [['1', 'อะไรก็ได้']] }
    assert.deepEqual(findOtherColumns(rd, rd.questions[0], { byVar: { q1: PLAIN_CB } }), [])
    assert.deepEqual(findOtherColumns(rd, rd.questions[0], undefined), [])
  })

  test('collects consecutive explicit *_oth columns of the same MA group and stops at the next closed question', () => {
    const rd = {
      questions: [
        { id: 'm', label: 's5_01', index: 0, columns: [0, 1] },
        q('o7', 's5_7_oth', 2),
        q('o9', 's5_9_oth', 3),
        q('n', 's6', 4),
        q('late', 's6_oth', 5),
      ],
      rows: [['7', '9', 'ร้านใกล้บ้าน', 'เพื่อนแนะนำ', '1', 'x']],
    }
    const cb = { byVar: { s5_01: OTHER_CB, s6: OTHER_CB } }
    assert.deepEqual(labels(findOtherColumns(rd, rd.questions[0], cb)), ['s5_7_oth', 's5_9_oth'])
  })

  test('stops at an explicit *_oth column owned by a different question', () => {
    const rd = {
      questions: [q('q1', 'q1', 0), q('q1o', 'q1_oth', 1), q('q2o', 'q2_oth', 2)],
      rows: [['99', 'a', 'b']],
    }
    assert.deepEqual(labels(findOtherColumns(rd, rd.questions[0], { byVar: { q1: OTHER_CB } })), ['q1_oth'])
  })

  test('scans by column position, not by questions array order, and skips earlier columns', () => {
    const rd = {
      questions: [q('q1o', 'q1_oth', 2), q('before', 'q0_oth', 0), q('q1', 'q1', 1)],
      rows: [['x', '99', 'ข้อความ']],
    }
    assert.deepEqual(labels(findOtherColumns(rd, rd.questions[2], { byVar: { q1: OTHER_CB } })), ['q1_oth'])
  })

  test('accepts a Thai "ระบุ" text column then treats the next non-explicit column as a new question', () => {
    const rd = {
      questions: [q('q3', 'q3', 0), q('spec', 'ระบุอื่นๆ', 1), q('next', 'ความคิดเห็น', 2)],
      rows: [['99', 'ร้านป้า', 'ดีมาก']],
    }
    assert.deepEqual(labels(findOtherColumns(rd, rd.questions[0], { byVar: { q3: OTHER_CB } })), ['ระบุอื่นๆ'])
  })

  test('accepts same-owner-prefixed string column even when empty (codebook type string)', () => {
    const rd = { questions: [q('q3', 'q3', 0), q('t', 'q3_text', 1)], rows: [['1', '']] }
    const cb = { byVar: { q3: OTHER_CB, q3_text: { type: 'string' } } }
    assert.deepEqual(labels(findOtherColumns(rd, rd.questions[0], cb)), ['q3_text'])
  })

  test('same-owner-prefixed column without any text signal is rejected', () => {
    const rd = { questions: [q('q3', 'q3', 0), q('t', 'q3_text', 1)], rows: [['1', '5'], ['2', '']] }
    assert.deepEqual(findOtherColumns(rd, rd.questions[0], { byVar: { q3: OTHER_CB } }), [])
  })

  test('non-standalone label: accepted if it contains any non-numeric text, rejected if numeric only', () => {
    const withText = { questions: [q('q3', 'q3', 0), q('r', 'remark_col', 1)], rows: [['1', '5'], ['2', 'ok']] }
    const numericOnly = { questions: [q('q3', 'q3', 0), q('r', 'remark_col', 1)], rows: [['1', '5'], ['2', '6']] }
    const cb = { byVar: { q3: OTHER_CB } }
    assert.deepEqual(labels(findOtherColumns(withText, withText.questions[0], cb)), ['remark_col'])
    assert.deepEqual(findOtherColumns(numericOnly, numericOnly.questions[0], cb), [])
  })

  test('an *_oth column that has value labels is a closed question → stop', () => {
    const rd = { questions: [q('q1', 'q1', 0), q('q1o', 'q1_oth', 1)], rows: [['99', '1']] }
    const cb = { byVar: { q1: OTHER_CB, q1_oth: PLAIN_CB } }
    assert.deepEqual(findOtherColumns(rd, rd.questions[0], cb), [])
  })

  test('explicit suffix variants other / others / specify, any case, are recognised', () => {
    const rd = {
      questions: [q('q1', 'q1', 0), q('a', 'q1_1_other', 1), q('b', 'Q1_2_OTHERS', 2), q('c', 'q1-3-specify', 3)],
      rows: [['1', 'a', 'b', 'c']],
    }
    assert.deepEqual(
      labels(findOtherColumns(rd, rd.questions[0], { byVar: { q1: OTHER_CB } })),
      ['q1_1_other', 'Q1_2_OTHERS', 'q1-3-specify'],
    )
  })
})

describe('findOtherColumn', () => {
  const rd = {
    questions: [q('q1', 'q1', 0), q('a', 'q1_1_oth', 1), q('b', 'q1_2_oth', 2)],
    rows: [['1', 'a', 'b']],
  }
  test('returns the first Other column', () => {
    assert.equal(findOtherColumn(rd, rd.questions[0], { byVar: { q1: OTHER_CB } }).id, 'a')
  })

  test('returns null when none', () => {
    assert.equal(findOtherColumn(rd, rd.questions[0], { byVar: { q1: PLAIN_CB } }), null)
    assert.equal(findOtherColumn(null, rd.questions[0], {}), null)
  })
})

describe('scopedVerbatimQuestionIds (extra cases)', () => {
  const rd = {
    questions: [q('c', 'q1', 0), q('co', 'q1_oth', 1), q('oe1', 'q2', 2), q('oe2', 'q3', 3)],
    rows: [['99', 'ร้านป้า', 'ราคาแพง', 'อร่อย']],
  }
  const cb = { byVar: { q1: OTHER_CB } }

  test('null rawdata → []', () => {
    assert.deepEqual(scopedVerbatimQuestionIds(null, ['c'], cb), [])
  })

  test('pure OE sheet (no closed question) keeps all known open ids in given order', () => {
    assert.deepEqual(scopedVerbatimQuestionIds(rd, ['oe2', 'missing', 'oe1', 'co'], cb), ['oe2', 'oe1', 'co'])
  })

  test('undefined / empty questionIds → []', () => {
    assert.deepEqual(scopedVerbatimQuestionIds(rd, undefined, cb), [])
    assert.deepEqual(scopedVerbatimQuestionIds(rd, [], cb), [])
  })

  test('CE sheet keeps only Other columns of its closed questions, never the closed id itself', () => {
    assert.deepEqual(scopedVerbatimQuestionIds(rd, ['c', 'co', 'oe1', 'oe2'], cb), ['co'])
  })

  test('preserveIds keep extra open ids (falsy entries ignored) but only if they are in questionIds', () => {
    assert.deepEqual(scopedVerbatimQuestionIds(rd, ['c', 'co', 'oe1', 'oe2'], cb, ['oe2', '', null]), ['co', 'oe2'])
    assert.deepEqual(scopedVerbatimQuestionIds(rd, ['c', 'co'], cb, ['oe2']), ['co'])
  })

  test('closed question without Other option → nothing open survives (unless preserved)', () => {
    const plain = { byVar: { q1: PLAIN_CB } }
    assert.deepEqual(scopedVerbatimQuestionIds(rd, ['c', 'co', 'oe1'], plain), [])
    assert.deepEqual(scopedVerbatimQuestionIds(rd, ['c', 'co', 'oe1'], plain, ['oe1']), ['oe1'])
  })
})

describe('questionGroupBase', () => {
  test('strips a trailing _NN (2+ digits) slot suffix once', () => {
    assert.equal(questionGroupBase('s13_1_01'), 's13_1')
    assert.equal(questionGroupBase('q5_001'), 'q5')
    assert.equal(questionGroupBase('a_01_02'), 'a_01')
  })

  test('keeps single-digit suffixes and other labels', () => {
    assert.equal(questionGroupBase('q5_1'), 'q5_1')
    assert.equal(questionGroupBase('q5'), 'q5')
    assert.equal(questionGroupBase('q5-01'), 'q5-01')
    assert.equal(questionGroupBase('q5_01_oth'), 'q5_01_oth')
  })

  test('nullish → empty string; numbers stringified', () => {
    assert.equal(questionGroupBase(undefined), '')
    assert.equal(questionGroupBase(null), '')
    assert.equal(questionGroupBase(12), '12')
  })
})

describe('closedQuestionGroup / closedQuestionGroupColumns', () => {
  const rd = {
    questions: [
      { id: 's5_02', label: 's5_02', index: 2, columns: [2] },
      { id: 's5_01', label: 's5_01', index: 0, columns: [0, 1] },
      { id: 's5', label: 's5', index: 5, columns: [5] },
      { id: 's5_1', label: 's5_1', index: 6, columns: [6] },
      { id: 's5_10', label: 's5_10', index: 3 },
      { id: 's6_01', label: 's6_01', index: 4, columns: [4] },
    ],
    rows: [],
  }
  const cb = { byVar: { s5_01: OTHER_CB } }

  test('MA slots sharing the base are grouped and sorted by first column', () => {
    assert.deepEqual(closedQuestionGroup(rd, rd.questions[1], cb).map((x) => x.id), ['s5_01', 's5_02', 's5_10'])
  })

  test('a bare base label is included only when it has value labels itself', () => {
    const cb2 = { byVar: { s5_01: OTHER_CB, s5: PLAIN_CB } }
    assert.deepEqual(closedQuestionGroup(rd, rd.questions[1], cb2).map((x) => x.id), ['s5_01', 's5_02', 's5_10', 's5'])
  })

  test('question without value labels → [question] alone', () => {
    assert.deepEqual(closedQuestionGroup(rd, rd.questions[0], cb), [rd.questions[0]])
    assert.deepEqual(closedQuestionGroup(rd, rd.questions[0], undefined), [rd.questions[0]])
  })

  test('closed question with no matching siblings (not even itself) → [question]', () => {
    const lonely = { id: 'x', label: 'zz', index: 9 }
    assert.deepEqual(closedQuestionGroup(rd, lonely, { byVar: { zz: PLAIN_CB } }), [lonely])
  })

  test('guards → []', () => {
    assert.deepEqual(closedQuestionGroup(null, rd.questions[0], cb), [])
    assert.deepEqual(closedQuestionGroup(rd, null, cb), [])
    assert.deepEqual(closedQuestionGroupColumns(null, rd.questions[0], cb), [])
  })

  test('columns flatten every member (columns or index fallback) in group order', () => {
    assert.deepEqual(closedQuestionGroupColumns(rd, rd.questions[1], cb), [0, 1, 2, 3])
    assert.deepEqual(closedQuestionGroupColumns(rd, rd.questions[3], cb), [6])
  })
})

describe('otherCodeFromColumnLabel (extra cases)', () => {
  test('separators -, ., and no separator at start', () => {
    assert.equal(otherCodeFromColumnLabel('s5-07-other'), '7')
    assert.equal(otherCodeFromColumnLabel('s5.7.specify'), '7')
    assert.equal(otherCodeFromColumnLabel('13oth'), '13')
    assert.equal(otherCodeFromColumnLabel('s5_7__oth'), '7')
  })

  test('strips leading zeros but keeps a lone 0', () => {
    assert.equal(otherCodeFromColumnLabel('s5_007_oth'), '7')
    assert.equal(otherCodeFromColumnLabel('s5_0_oth'), '0')
  })

  test('suffix forms: case-insensitive, others, trailing digit', () => {
    assert.equal(otherCodeFromColumnLabel('S5_7_OTH'), '7')
    assert.equal(otherCodeFromColumnLabel('s5_7_others'), '7')
    assert.equal(otherCodeFromColumnLabel('s5_7_oth2'), '7')
    assert.equal(otherCodeFromColumnLabel('  s5_7_oth  '), '7')
  })

  test('no code token → empty string', () => {
    assert.equal(otherCodeFromColumnLabel('q5_oth'), '')
    assert.equal(otherCodeFromColumnLabel('q13oth'), '')
    assert.equal(otherCodeFromColumnLabel('s5_7_otherwise'), '')
    assert.equal(otherCodeFromColumnLabel('s5_7'), '')
    assert.equal(otherCodeFromColumnLabel(''), '')
    assert.equal(otherCodeFromColumnLabel(null), '')
    assert.equal(otherCodeFromColumnLabel(undefined), '')
  })
})

describe('otherColumnsForCode (extra cases)', () => {
  const rd = {
    questions: [
      { id: 'q01', label: 's13_1_01', index: 0, columns: [0, 1] },
      q('q13oth', 's13_1_13_oth', 2),
      q('q211oth', 's13_1_211_oth', 3),
    ],
    rows: [['13', '211', 'กาแฟ', 'ส้ม']],
  }
  const cb = { byVar: { s13_1_01: { values: [{ value: '13', label: 'อื่นๆ ระบุ' }, { value: '211', label: 'ส้ม' }] } } }
  const forCode = (code) => labels(otherColumnsForCode(rd, rd.questions[0], cb, code))

  test('blank / nullish code → all Other columns', () => {
    for (const c of ['', '  ', null, undefined]) assert.deepEqual(forCode(c), ['s13_1_13_oth', 's13_1_211_oth'])
  })

  test('code is normalised: number, "13.0", leading zeros, whitespace', () => {
    for (const c of [13, '13.0', '013', '0013', ' 13 ']) assert.deepEqual(forCode(c), ['s13_1_13_oth'], String(c))
  })

  test('unknown code → [] (never falls back to all)', () => {
    assert.deepEqual(forCode('999'), [])
    assert.deepEqual(forCode('1'), [])
  })

  test('no Other option on the question → []', () => {
    assert.deepEqual(otherColumnsForCode(rd, rd.questions[0], { byVar: {} }, '13'), [])
  })
})

describe('freqByValue', () => {
  test('counts trimmed non-empty values across all question columns', () => {
    const rd = {
      rows: [
        ['1', ' 2 ', 1],
        ['', '1', 'A'],
        [null, undefined, 'a'],
        undefined,
      ],
    }
    const counts = freqByValue(rd, { id: 'm', label: 'M', index: 0, columns: [0, 1, 2] })
    assert.ok(counts instanceof Map)
    assert.deepEqual([...counts.entries()], [['1', 3], ['2', 1], ['A', 1], ['a', 1]])
  })

  test('falls back to q.index when columns is missing', () => {
    const rd = { rows: [['x', 'y'], ['x', 'z']] }
    assert.deepEqual([...freqByValue(rd, { index: 1 }).entries()], [['y', 1], ['z', 1]])
  })

  test('guards return an empty Map', () => {
    assert.equal(freqByValue(null, { index: 0 }).size, 0)
    assert.equal(freqByValue({ rows: [['1']] }, null).size, 0)
  })
})

describe('guessSbjNum', () => {
  test('matches respondent-id style labels (case/space-insensitive)', () => {
    const names = ['SbjNum', 'sbj num', 'Sbj.Num', 'sbnum', 'Subject', 'SERIAL', 'Respondent', 'ID', 'No.', 'no', ' id ', 'ลำดับ', 'เลขที่']
    for (const name of names) {
      const rd = { questions: [q('a', 'Q1', 0), q('b', name, 1)], rows: [['x', '1']] }
      assert.equal(guessSbjNum(rd), 'b', `label ${JSON.stringify(name)}`)
    }
  })

  test('does not match labels that merely contain id words', () => {
    const rd = { questions: [q('a', 'respondent_id', 0), q('b', 'idea', 1)], rows: [['x', 'y']] }
    assert.equal(guessSbjNum(rd), 'a') // falls through to the first question
  })

  test('first matching label wins', () => {
    const rd = { questions: [q('a', 'Q1', 0), q('b', 'id', 1), q('c', 'SbjNum', 2)], rows: [] }
    assert.equal(guessSbjNum(rd), 'b')
  })

  test('falls back to first mostly-numeric, mostly-distinct question', () => {
    const rd = {
      questions: [q('t', 'Q1', 0), q('dup', 'Q2', 1), q('uniq', 'Q3', 2)],
      rows: rowsFromCols(
        ['ก', 'ข', 'ค', 'ง', 'จ'],
        ['1', '1', '2', '2', '1'],
        ['1001', '1002', '1003', '1004', '1005'],
      ),
    }
    assert.equal(guessSbjNum(rd), 'uniq')
  })

  test('falls back to the first question, then null', () => {
    assert.equal(guessSbjNum({ questions: [q('t', 'Q1', 0)], rows: [['ก'], ['ข']] }), 't')
    assert.equal(guessSbjNum({ questions: [], rows: [] }), null)
    assert.equal(guessSbjNum(null), null)
    assert.equal(guessSbjNum(undefined), null)
  })
})
