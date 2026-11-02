// Characterization tests for src/lib/answers.js — lock in CURRENT behavior.
// Synthetic data only. IDs are produced by an injected deterministic counter.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  uniqueAnswers,
  autoAssign,
  buildCodeframeFromAnswers,
  splitTopics,
  buildCodeframeAdvanced,
  previewAdvanced,
  assembleNetsFromGrouping,
  assembleCodingResult,
  previewClusterCount,
} from '../src/lib/answers.js'

const idMaker = () => {
  let i = 0
  const fn = () => `id${++i}`
  fn.calls = () => i
  return fn
}
const A = (text, count = 1, key = text) => ({ key, text, count })

describe('uniqueAnswers', () => {
  const rawdata = {
    questions: [
      { id: 'q1', label: 'Q1', index: 0 },
      { id: 'q2', label: 'Q2', index: 1, columns: [1, 2] },
    ],
    rows: [
      ['ราคาแพง', 'ราคาแพง', ' รสชาติดี '],
      [' ราคาแพง ', '', 'ราคาแพง'],
      [null, 'Good', 5],
      ['good', undefined, ''],
    ],
  }

  test('merges trimmed answers across questions and MA columns with per-source counts', () => {
    const res = uniqueAnswers(rawdata, ['q1', 'q2'])
    assert.deepEqual(res[0], {
      key: 'ราคาแพง',
      text: 'ราคาแพง',
      count: 4,
      questions: ['Q1', 'Q2'],
      sourceCounts: { Q1: 2, Q2: 2 },
    })
    assert.equal(res.length, 5)
  })

  test('keys are the trimmed text; case-sensitive; numbers stringified; blanks/nullish skipped', () => {
    const res = uniqueAnswers(rawdata, ['q1', 'q2'])
    const byKey = Object.fromEntries(res.map((a) => [a.key, a]))
    assert.deepEqual(Object.keys(byKey).sort(), ['5', 'Good', 'good', 'รสชาติดี', 'ราคาแพง'].sort())
    assert.deepEqual(byKey['รสชาติดี'].sourceCounts, { Q2: 1 })
    assert.deepEqual(byKey.good.questions, ['Q1'])
    assert.deepEqual(byKey.Good.questions, ['Q2'])
    assert.equal(byKey['5'].text, '5')
  })

  test('sorted by count desc, then by Thai-locale text compare', () => {
    const res = uniqueAnswers(rawdata, ['q1', 'q2'])
    assert.equal(res[0].key, 'ราคาแพง')
    const ties = res.slice(1).map((a) => a.text)
    assert.deepEqual(ties, [...ties].sort((a, b) => a.localeCompare(b, 'th')))
    const thai = {
      questions: [{ id: 'q', label: 'Q', index: 0 }],
      rows: [['ค'], ['ก'], ['ข'], ['ข']],
    }
    assert.deepEqual(uniqueAnswers(thai, ['q']).map((a) => a.text), ['ข', 'ก', 'ค'])
  })

  test('question order in "questions" follows first appearance by questionIds order', () => {
    const res = uniqueAnswers(rawdata, ['q2', 'q1'])
    assert.deepEqual(res.find((a) => a.key === 'ราคาแพง').questions, ['Q2', 'Q1'])
  })

  test('unknown ids are ignored; nullish rawdata or no ids → []', () => {
    assert.deepEqual(uniqueAnswers(rawdata, ['nope']), [])
    assert.deepEqual(uniqueAnswers(rawdata, []), [])
    assert.deepEqual(uniqueAnswers(null, ['q1']), [])
    assert.deepEqual(uniqueAnswers(undefined, ['q1']), [])
  })

  test('duplicate question ids are not double-counted', {
    todo: 'answers.js:7 iterates questionIds without dedupe — ["q","q"] doubles every count',
  }, () => {
    const rd = { questions: [{ id: 'q', label: 'Q', index: 0 }], rows: [['x']] }
    assert.equal(uniqueAnswers(rd, ['q', 'q'])[0].count, 1)
  })
})

describe('autoAssign', () => {
  const nets = [
    {
      codes: [
        { id: 'c1', thai: 'ราคาแพง/แพง' },
        { id: 'c2', thai: 'รสชาติอร่อย' },
        { id: 'c3', thai: 'x' },
        { id: 'c4', thai: '' },
        { id: 'c5', thai: 'Fast Service' },
      ],
    },
    { codes: [{ id: 'c6', thai: 'ราคา' }] },
  ]

  test('substring match on any "/" variant, both directions, in net/code order', () => {
    const answers = [A('ราคาแพงมาก'), A('แพงไป'), A('อร่อย')]
    const { assignments, matched } = autoAssign(answers, nets)
    assert.deepEqual(assignments, {
      'ราคาแพงมาก': ['c1', 'c6'],
      'แพงไป': ['c1'],
      'อร่อย': ['c2'], // answer is a substring of the code text
    })
    assert.equal(matched, 3)
  })

  test('normalisation ignores case, whitespace and punctuation', () => {
    const { assignments } = autoAssign([A('fast-service!!'), A('FAST service')], nets)
    assert.deepEqual(assignments, { 'fast-service!!': ['c5'], 'FAST service': ['c5'] })
  })

  test('codes with no variant of length >= 2 are skipped; unmatched answers are left out', () => {
    const { assignments, matched } = autoAssign([A('x'), A('ไม่มีความเห็น')], nets)
    assert.deepEqual(assignments, {})
    assert.equal(matched, 0)
    const shortOnly = autoAssign([A('ก')], [{ codes: [{ id: 'k', thai: 'ก/ข' }] }])
    assert.deepEqual(shortOnly.assignments, {})
  })

  test('short variants inside a "/" list are dropped individually', () => {
    const { assignments } = autoAssign([A('a'), A('bcd')], [{ codes: [{ id: 'k', thai: ' a / bc ' }] }])
    assert.deepEqual(assignments, { bcd: ['k'] })
  })

  test('existing non-empty assignments are kept and not counted; empty ones are re-evaluated', () => {
    const existing = { 'แพงไป': ['manual'], 'อร่อย': [] }
    const res = autoAssign([A('แพงไป'), A('อร่อย')], nets, existing)
    assert.deepEqual(res.assignments, { 'แพงไป': ['manual'], 'อร่อย': ['c2'] })
    assert.equal(res.matched, 1)
    assert.deepEqual(existing, { 'แพงไป': ['manual'], 'อร่อย': [] }, 'input not mutated')
  })

  test('fuzzy bigram Jaccard fallback with configurable threshold (default 0.6)', () => {
    const fuzzNets = [{ codes: [{ id: 'cf', thai: 'coffee' }] }]
    // coffee vs cofee → Jaccard 4/5 = 0.8
    assert.deepEqual(autoAssign([A('cofee')], fuzzNets).assignments, { cofee: ['cf'] })
    assert.deepEqual(autoAssign([A('cofee')], fuzzNets, {}, { fuzzy: 0.8 }).assignments, { cofee: ['cf'] })
    assert.deepEqual(autoAssign([A('cofee')], fuzzNets, {}, { fuzzy: 0.81 }).assignments, {})
  })

  test('empty inputs', () => {
    assert.deepEqual(autoAssign([], nets), { assignments: {}, matched: 0 })
    assert.deepEqual(autoAssign([A('ราคาแพง')], []), { assignments: {}, matched: 0 })
    assert.deepEqual(autoAssign([A('ราคาแพง')], [], { k: ['z'] }), { assignments: { k: ['z'] }, matched: 0 })
  })

  test('punctuation-only answers ("-", "...") are not assigned to every code', {
    todo: 'answers.js:86 normalize("-") is "" and vn.includes("") is always true → hits every code',
  }, () => {
    const { assignments, matched } = autoAssign([A('-'), A('...')], nets)
    assert.deepEqual(assignments, {})
    assert.equal(matched, 0)
  })
})

describe('buildCodeframeFromAnswers', () => {
  const answers = [A('coffees', 2), A('tea', 5), A('coffee', 2), A('cofee', 1)]

  test('greedy clusters similar answers; rep = most frequent then shortest; codes get ids before the net', () => {
    const makeId = idMaker()
    const res = buildCodeframeFromAnswers(answers, makeId)
    assert.deepEqual(res, {
      net: {
        id: 'id3',
        name: 'รหัสจากคำตอบ (สร้างอัตโนมัติ)',
        codes: [
          { id: 'id1', codeNo: '1', thai: 'coffee', thai2: '', eng: '' },
          { id: 'id2', codeNo: '2', thai: 'tea', thai2: '', eng: '' },
        ],
      },
      assignments: { coffees: ['id1'], coffee: ['id1'], cofee: ['id1'], tea: ['id2'] },
      clusterCount: 2,
    })
    assert.equal(makeId.calls(), 3)
  })

  test('clusters sorted by total member count desc (ties keep creation order)', () => {
    const res = buildCodeframeFromAnswers([A('coffee', 2), A('tea', 6), A('coffees', 3)], idMaker())
    assert.deepEqual(res.net.codes.map((c) => [c.codeNo, c.thai]), [['1', 'tea'], ['2', 'coffees']])
  })

  test('higher count wins representative even if longer', () => {
    const res = buildCodeframeFromAnswers([A('coffee', 1), A('coffees', 9)], idMaker())
    assert.equal(res.net.codes[0].thai, 'coffees')
  })

  test('threshold controls merging; custom netName', () => {
    const strict = buildCodeframeFromAnswers(answers, idMaker(), { threshold: 0.9, netName: 'เครื่องดื่ม' })
    assert.equal(strict.net.name, 'เครื่องดื่ม')
    assert.equal(strict.clusterCount, 4)
    assert.equal(new Set(Object.values(strict.assignments).map((v) => v[0])).size, 4)
  })

  test('identical text after normalisation always merges (Thai, case, punctuation)', () => {
    const res = buildCodeframeFromAnswers([A('ราคาแพง!', 1), A('ราคา แพง', 1), A('Good', 1), A('good.', 1)], idMaker(), { threshold: 1 })
    assert.equal(res.clusterCount, 2)
  })

  test('empty answers → net with no codes, still consumes one id', () => {
    const makeId = idMaker()
    assert.deepEqual(buildCodeframeFromAnswers([], makeId), {
      net: { id: 'id1', name: 'รหัสจากคำตอบ (สร้างอัตโนมัติ)', codes: [] },
      assignments: {},
      clusterCount: 0,
    })
  })
})

describe('splitTopics', () => {
  test('splits on Thai connectors and separators, trimming parts', () => {
    assert.deepEqual(
      splitTopics('ราคาแพง และ รสชาติแย่, บริการช้า / ที่จอดรถน้อย'),
      ['ราคาแพง', 'รสชาติแย่', 'บริการช้า', 'ที่จอดรถน้อย'],
    )
  })

  test('each connector word splits', () => {
    for (const w of ['แล้วก็', 'รวมถึง', 'รวมทั้ง', 'อีกทั้ง', 'ตลอดจน', 'นอกจากนี้', 'อีกอย่าง']) {
      assert.deepEqual(splitTopics(`ราคาแพง${w}รสชาติแย่`), ['ราคาแพง', 'รสชาติแย่'], w)
    }
  })

  test('full-width comma, semicolon, ideographic comma and newline split', () => {
    assert.deepEqual(splitTopics('ab，cd;ef、gh\nij'), ['ab', 'cd', 'ef', 'gh', 'ij'])
  })

  test('drops parts with < 2 normalised chars', () => {
    assert.deepEqual(splitTopics('ก และ ราคาแพง'), ['ราคาแพง'])
    assert.deepEqual(splitTopics('ราคาแพง, -, !!'), ['ราคาแพง'])
  })

  test('falls back to the whole trimmed text when no part survives', () => {
    assert.deepEqual(splitTopics('a'), ['a'])
    assert.deepEqual(splitTopics(' a/b '), ['a/b'])
    assert.deepEqual(splitTopics(','), [','])
  })

  test('empty / whitespace / nullish → []', () => {
    assert.deepEqual(splitTopics(''), [])
    assert.deepEqual(splitTopics('   '), [])
    assert.deepEqual(splitTopics(undefined), [])
    assert.deepEqual(splitTopics(null), [])
  })

  test('text without separators is returned as one part', () => {
    assert.deepEqual(splitTopics('  รสชาติดีมาก  '), ['รสชาติดีมาก'])
  })

  test('"และก็" is removed as a whole connector', {
    todo: 'answers.js:162 alternation lists "และ" before "และก็", so "และก็" leaves "ก็..." on the next part',
  }, () => {
    assert.deepEqual(splitTopics('ราคาแพงและก็รสชาติแย่'), ['ราคาแพง', 'รสชาติแย่'])
  })
})

describe('buildCodeframeAdvanced', () => {
  test('default options behave like a single auto net', () => {
    const answers = [A('coffees', 2), A('tea', 5), A('coffee', 2), A('cofee', 1)]
    const res = buildCodeframeAdvanced(answers, idMaker())
    assert.deepEqual(res, {
      nets: [{
        id: 'id3',
        name: 'รหัสจากคำตอบ (สร้างอัตโนมัติ)',
        codes: [
          { id: 'id1', codeNo: '1', thai: 'coffee', thai2: '', eng: '' },
          { id: 'id2', codeNo: '2', thai: 'tea', thai2: '', eng: '' },
        ],
      }],
      assignments: { coffees: ['id1'], coffee: ['id1'], cofee: ['id1'], tea: ['id2'] },
      codeCount: 2,
    })
  })

  test('multiTopic: one answer can get several codes; duplicates per answer collapse', () => {
    const answers = [
      A('ราคาแพง และ รสชาติแย่', 2, 'k1'),
      A('ราคาแพง', 3, 'k2'),
      A('ราคาแพง, ราคาแพงมาก', 1, 'k3'),
    ]
    const res = buildCodeframeAdvanced(answers, idMaker(), { multiTopic: true })
    assert.equal(res.codeCount, 2)
    assert.deepEqual(res.nets[0].codes.map((c) => [c.id, c.codeNo, c.thai]), [['id1', '1', 'ราคาแพง'], ['id2', '2', 'รสชาติแย่']])
    assert.equal(res.nets[0].id, 'id3')
    assert.deepEqual(res.assignments, { k1: ['id1', 'id2'], k2: ['id1'], k3: ['id1'] })
  })

  test('multiTopic off keeps the long answer as one unit', () => {
    const res = buildCodeframeAdvanced([A('ราคาแพง และ รสชาติแย่', 1, 'k1')], idMaker())
    assert.equal(res.codeCount, 1)
    assert.equal(res.nets[0].codes[0].thai, 'ราคาแพง และ รสชาติแย่')
  })

  test('groupIntoNets: similar codes share a net; codeNo continues across nets; net ids after code ids', () => {
    const answers = [A('coffees', 5), A('coffee', 3), A('tea', 2), A('teas', 1)]
    const res = buildCodeframeAdvanced(answers, idMaker(), { threshold: 0.95, groupIntoNets: true, netThreshold: 0.5 })
    assert.equal(res.codeCount, 4)
    assert.deepEqual(res.nets, [
      {
        id: 'id5',
        name: 'coffee', // equal count (1) at net level → shorter text becomes the net name
        codes: [
          { id: 'id1', codeNo: '1', thai: 'coffees', thai2: '', eng: '' },
          { id: 'id2', codeNo: '2', thai: 'coffee', thai2: '', eng: '' },
        ],
      },
      {
        id: 'id6',
        name: 'tea',
        codes: [
          { id: 'id3', codeNo: '3', thai: 'tea', thai2: '', eng: '' },
          { id: 'id4', codeNo: '4', thai: 'teas', thai2: '', eng: '' },
        ],
      },
    ])
    assert.deepEqual(res.assignments, { coffees: ['id1'], coffee: ['id2'], tea: ['id3'], teas: ['id4'] })
  })

  test('groupIntoNets with no answers falls back to one empty default net', () => {
    const makeId = idMaker()
    assert.deepEqual(buildCodeframeAdvanced([], makeId, { groupIntoNets: true }), {
      nets: [{ id: 'id1', name: 'รหัสจากคำตอบ (สร้างอัตโนมัติ)', codes: [] }],
      assignments: {},
      codeCount: 0,
    })
  })
})

describe('previewAdvanced', () => {
  test('counts codes and nets without generating ids', () => {
    const answers = [A('coffees', 5), A('coffee', 3), A('tea', 2), A('teas', 1)]
    assert.deepEqual(
      previewAdvanced(answers, { threshold: 0.95, multiTopic: false, groupIntoNets: true, netThreshold: 0.5 }),
      { codeCount: 4, netCount: 2 },
    )
    assert.deepEqual(
      previewAdvanced(answers, { threshold: 0.5, multiTopic: false, groupIntoNets: false, netThreshold: 0.5 }),
      { codeCount: 2, netCount: 1 },
    )
  })

  test('multiTopic splits answers before counting', () => {
    const answers = [A('ราคาแพง และ รสชาติแย่', 2), A('ราคาแพง', 3)]
    assert.equal(previewAdvanced(answers, { threshold: 0.5, multiTopic: true }).codeCount, 2)
    assert.equal(previewAdvanced(answers, { threshold: 0.5, multiTopic: false }).codeCount, 2)
    assert.equal(previewAdvanced([A('ราคาแพง และ รสชาติแย่', 2)], { threshold: 0.5, multiTopic: true }).codeCount, 2)
    assert.equal(previewAdvanced([A('ราคาแพง และ รสชาติแย่', 2)], { threshold: 0.5, multiTopic: false }).codeCount, 1)
  })

  test('netCount is 1 when not grouping or when there is nothing to group', () => {
    assert.deepEqual(previewAdvanced([], { threshold: 0.5, groupIntoNets: true, netThreshold: 0.2 }), { codeCount: 0, netCount: 1 })
  })

  test('options object is required', () => {
    assert.throws(() => previewAdvanced([A('x')]), TypeError)
  })

  test('agrees with buildCodeframeAdvanced on code count', () => {
    const answers = [A('ราคาแพง', 4), A('ราคาแพงมาก', 2), A('รสชาติดี', 3), A('รสชาติดีมาก', 1), A('บริการช้า', 1)]
    for (const threshold of [0.3, 0.5, 0.8]) {
      const opts = { threshold, multiTopic: true, groupIntoNets: true, netThreshold: 0.18 }
      assert.equal(previewAdvanced(answers, opts).codeCount, buildCodeframeAdvanced(answers, idMaker(), opts).codeCount)
    }
  })

  test('netCount matches the number of nets buildCodeframeAdvanced actually creates', {
    todo: 'answers.js:270 net clustering runs on unsorted clusters, build (answers.js:236) runs on count-sorted codes → greedy result differs',
  }, () => {
    const answers = [A('bef', 1, 'k0'), A('abe', 2, 'k1'), A('feca', 4, 'k2'), A('babed', 3, 'k3')]
    const opts = { threshold: 0.99, multiTopic: false, groupIntoNets: true, netThreshold: 0.3 }
    assert.equal(previewAdvanced(answers, opts).netCount, buildCodeframeAdvanced(answers, idMaker(), opts).nets.length)
  })
})

describe('assembleNetsFromGrouping', () => {
  const codes = [
    { id: 'a', codeNo: '9', thai: 'A', eng: 'x' },
    { id: 'b', codeNo: '9', thai: 'B' },
    { id: 'c', codeNo: '9', thai: 'C' },
  ]

  test('builds nets in grouping order, renumbers codeNo across nets, drops bad indexes and empty nets', () => {
    const makeId = idMaker()
    const grouping = {
      nets: [
        { name: 'N1', codeIndexes: [2, 0] },
        { name: '', codeIndexes: [5, 1] },
        { name: 'Empty', codeIndexes: [7] },
      ],
    }
    assert.deepEqual(assembleNetsFromGrouping(codes, grouping, makeId), [
      {
        id: 'id1',
        name: 'N1',
        codes: [
          { id: 'c', codeNo: '1', thai: 'C' },
          { id: 'a', codeNo: '2', thai: 'A', eng: 'x' },
        ],
      },
      { id: 'id2', name: 'กลุ่ม', codes: [{ id: 'b', codeNo: '3', thai: 'B' }] },
    ])
    assert.equal(makeId.calls(), 3, 'an id is consumed even for the filtered empty net')
  })

  test('does not mutate the input codes', () => {
    assembleNetsFromGrouping(codes, { nets: [{ name: 'N', codeIndexes: [0, 1, 2] }] }, idMaker())
    assert.deepEqual(codes.map((c) => c.codeNo), ['9', '9', '9'])
  })

  test('no nets → []', () => {
    assert.deepEqual(assembleNetsFromGrouping(codes, { nets: [] }, idMaker()), [])
  })
})

describe('assembleCodingResult', () => {
  test('groups codes into nets by first-seen net name and renumbers in net order', () => {
    const targets = [{ key: 'k1' }, { key: 'k2' }, { key: 'k3' }, { key: 'k4' }]
    const coding = {
      codes: [
        { label: ' ราคาแพง ', net: 'ราคา' },
        { label: 'รสชาติดี', net: 'รสชาติ' },
        { label: 'ราคาถูก', net: ' ราคา ' },
        { label: 'บริการ' },
        { label: 5, net: '  ' },
      ],
      assign: [[0, 2, 0], [1, 99], []],
    }
    const makeId = idMaker()
    assert.deepEqual(assembleCodingResult(targets, coding, makeId), {
      nets: [
        {
          id: 'id6',
          name: 'ราคา',
          codes: [
            { id: 'id1', codeNo: '1', thai: 'ราคาแพง', thai2: '', eng: '' },
            { id: 'id3', codeNo: '2', thai: 'ราคาถูก', thai2: '', eng: '' },
          ],
        },
        { id: 'id7', name: 'รสชาติ', codes: [{ id: 'id2', codeNo: '3', thai: 'รสชาติดี', thai2: '', eng: '' }] },
        {
          id: 'id8',
          name: 'อื่น ๆ', // missing or blank net → default bucket
          codes: [
            { id: 'id4', codeNo: '4', thai: 'บริการ', thai2: '', eng: '' },
            { id: 'id5', codeNo: '5', thai: '5', thai2: '', eng: '' },
          ],
        },
      ],
      assignments: { k1: ['id1', 'id3'], k2: ['id2'] }, // deduped; out-of-range dropped; empty omitted
      codeCount: 5,
    })
  })

  test('missing codes / assign → empty result', () => {
    assert.deepEqual(assembleCodingResult([{ key: 'k' }], {}, idMaker()), { nets: [], assignments: {}, codeCount: 0 })
    const res = assembleCodingResult([{ key: 'k' }], { codes: [{ label: 'A' }] }, idMaker())
    assert.deepEqual(res.assignments, {})
    assert.equal(res.codeCount, 1)
  })

  test('blank labels are dropped from the codeframe', () => {
    const res = assembleCodingResult([], { codes: [{ label: '  ' }, { label: null }, { label: 'A' }] }, idMaker())
    assert.equal(res.codeCount, 1)
    assert.deepEqual(res.nets.map((n) => n.codes.map((c) => c.thai)), [['A']])
  })

  test('assign indexes keep pointing at the AI code they named when a blank-label code is dropped', {
    todo: 'answers.js:326 indexes resolve against the filtered codes array, so dropping a blank label shifts later indexes onto the wrong code',
  }, () => {
    const coding = { codes: [{ label: '' }, { label: 'A' }, { label: 'B' }], assign: [[1]] }
    const res = assembleCodingResult([{ key: 'k' }], coding, idMaker())
    const idA = res.nets[0].codes.find((c) => c.thai === 'A').id
    assert.deepEqual(res.assignments, { k: [idA] })
  })
})

describe('previewClusterCount', () => {
  test('counts greedy clusters for a threshold', () => {
    const answers = [A('coffees', 2), A('tea', 5), A('coffee', 2), A('cofee', 1)]
    assert.equal(previewClusterCount(answers, 0.5), 2)
    assert.equal(previewClusterCount(answers, 0.9), 4)
  })

  test('empty → 0; identical after normalisation merge even at threshold 1', () => {
    assert.equal(previewClusterCount([], 0.5), 0)
    assert.equal(previewClusterCount([A('Coffee!'), A('coffee'), A('ราคา แพง'), A('ราคาแพง')], 1), 2)
  })

  test('no shared bigram never merges, even at threshold 0', () => {
    assert.equal(previewClusterCount([A('abc'), A('xyz')], 0), 2)
    assert.equal(previewClusterCount([A('abc'), A('abx')], 0), 1)
  })

  test('agrees with buildCodeframeFromAnswers when representatives do not change', () => {
    const answers = [A('ราคาแพง', 4), A('ราคาแพงมาก', 2), A('รสชาติดี', 3), A('บริการช้า', 1)]
    for (const t of [0.2, 0.5, 0.8]) {
      assert.equal(previewClusterCount(answers, t), buildCodeframeFromAnswers(answers, idMaker(), { threshold: t }).clusterCount)
    }
  })

  test('matches buildCodeframeFromAnswers even when a later member becomes the representative', {
    todo: 'answers.js:341 preview compares to the first member only; build (answers.js:120) moves the representative',
  }, () => {
    const answers = [A('abcd', 1), A('abcdefgh', 5), A('efghijkl', 1)]
    assert.equal(previewClusterCount(answers, 0.25), buildCodeframeFromAnswers(answers, idMaker(), { threshold: 0.25 }).clusterCount)
  })
})
