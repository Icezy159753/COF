// Characterization tests for server/savCodebook.mjs (parseSavBuffer)
// ใช้ไฟล์ .sav สังเคราะห์ที่สร้างในเทสต์เอง (ไม่มีข้อมูลจริง) ตาม layout ของ SPSS system file ($FL2, uncompressed)
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSavBuffer } from '../server/savCodebook.mjs'

// ---------- synthetic .sav builder ----------
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b }
const f64 = (n) => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b }
const fixed = (s, len) => { const b = Buffer.alloc(len, 0x20); Buffer.from(s, 'utf8').copy(b); return b }
const padTo = (buf, m) => Buffer.concat([buf, Buffer.alloc((m - (buf.length % m)) % m, 0x20)])

function varRec({ type, name, label }) {
  const parts = [i32(2), i32(type), i32(label != null ? 1 : 0), i32(0), i32(0x050802), i32(0x050802), fixed(name, 8)]
  if (label != null) {
    const lb = Buffer.from(label, 'utf8')
    parts.push(i32(lb.length), padTo(lb, 4))
  }
  return Buffer.concat(parts)
}
function valueLabels(entries, varIndexes) {
  const parts = [i32(3), i32(entries.length)]
  for (const { value, label } of entries) {
    parts.push(typeof value === 'string' ? fixed(value, 8) : f64(value))
    const lb = Buffer.from(label, 'utf8')
    parts.push(padTo(Buffer.concat([Buffer.from([lb.length]), lb]), 8))
  }
  parts.push(i32(4), i32(varIndexes.length), ...varIndexes.map(i32))
  return Buffer.concat(parts)
}
function infoRec(subType, str) {
  const b = Buffer.from(str, 'latin1')
  return Buffer.concat([i32(7), i32(subType), i32(1), i32(b.length), b])
}
function buildSav(records, magic = '$FL2') {
  const header = Buffer.concat([
    Buffer.from(magic), fixed('@(#) SPSS DATA FILE synthetic test', 60),
    i32(2), i32(-1), i32(0), i32(0), i32(0), f64(100),
    fixed('01 Jan 26', 9), fixed('00:00:00', 8), fixed('', 64), Buffer.alloc(3),
  ])
  return Buffer.concat([header, ...records, i32(999), i32(0)])
}

function sampleSav() {
  return buildSav([
    varRec({ type: 0, name: 'Q1', label: 'เพศ  ' }), // vrec #1 (label มีช่องว่างท้าย)
    varRec({ type: 0, name: 'Q2' }), //                 vrec #2 (ไม่มี label)
    varRec({ type: 16, name: 'NAME', label: 'Name' }), // vrec #3 string 16
    varRec({ type: -1, name: '' }), //                  vrec #4 string continuation (ต้องไม่โผล่เป็นตัวแปร)
    varRec({ type: 8, name: 'CITY', label: 'City' }), //  vrec #5 string 8
    valueLabels([{ value: 1, label: 'ชาย' }, { value: 2, label: 'หญิง ' }, { value: 99, label: '' }], [1]),
    valueLabels([{ value: 'BKK', label: 'Bangkok' }], [5]),
    infoRec(13, 'Q1=Gender\tQ2=Age'), // long variable names
  ])
}

test('parseSavBuffer: reads variable labels, types and value labels from a synthetic .sav', async () => {
  const result = await parseSavBuffer(sampleSav())
  assert.deepEqual(result, {
    byVar: {
      Gender: { label: 'เพศ', type: 'numeric', values: [{ value: 1, label: 'ชาย' }, { value: 2, label: 'หญิง' }] },
      Age: { label: '', type: 'numeric', values: [] },
      NAME: { label: 'Name', type: 'string', values: [] },
      CITY: { label: 'City', type: 'string', values: [{ value: 'BKK', label: 'Bangkok' }] },
    },
    varCount: 4,
  })
})

test('parseSavBuffer: long variable names replace short names as byVar keys', async () => {
  const { byVar } = await parseSavBuffer(sampleSav())
  assert.deepEqual(Object.keys(byVar), ['Gender', 'Age', 'NAME', 'CITY'])
  assert.equal(byVar.Q1, undefined)
})

test('parseSavBuffer: value labels with empty label text are dropped and labels are trimmed', async () => {
  const { byVar } = await parseSavBuffer(sampleSav())
  assert.ok(!byVar.Gender.values.some((v) => v.value === 99))
  assert.equal(byVar.Gender.values[1].label, 'หญิง')
})

test('parseSavBuffer: string continuation records do not produce variables', async () => {
  const { byVar, varCount } = await parseSavBuffer(sampleSav())
  assert.equal(varCount, Object.keys(byVar).length)
  assert.ok(!Object.keys(byVar).includes(''))
})

test('parseSavBuffer: file with zero variables returns empty map', async () => {
  assert.deepEqual(await parseSavBuffer(buildSav([])), { byVar: {}, varCount: 0 })
})

test('parseSavBuffer: rejects non-.sav buffers with "Not a valid .sav file"', async () => {
  await assert.rejects(parseSavBuffer(Buffer.from('hello world, not spss')), /Not a valid \.sav file:hell/)
})

test('parseSavBuffer: rejects ZLIB ($FL3) files as unsupported', async () => {
  await assert.rejects(parseSavBuffer(buildSav([], '$FL3')), /ZLIB compressed data not supported/)
})

test('parseSavBuffer: truncated/empty buffers reject (sav-reader rejects with a plain string, not an Error)', async () => {
  for (const buf of [Buffer.alloc(0), sampleSav().subarray(0, 100)]) {
    let caught
    try { await parseSavBuffer(buf) } catch (e) { caught = e }
    assert.equal(typeof caught, 'string')
    assert.match(caught, /No data read/)
  }
})
