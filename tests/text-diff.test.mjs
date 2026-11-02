// src/lib/textDiff.js — Original ↔ Clean highlighting for the Verbatim box
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { diffText, diffTextCached, wordTokens } from '../src/lib/textDiff.js'

const side = (parts, keep) => parts.filter((p) => p.type === 'eq' || p.type === keep).map((p) => p.text).join('')
const changed = (parts, type) => parts.filter((p) => p.type === type).map((p) => p.text)

describe('diffText', () => {
  test('identical / empty inputs', () => {
    assert.deepEqual(diffText('', ''), [])
    assert.deepEqual(diffText('abc', 'abc'), [{ type: 'eq', text: 'abc' }])
    assert.deepEqual(diffText(null, undefined), [])
    assert.deepEqual(diffText('', 'ใหม่'), [{ type: 'ins', text: 'ใหม่' }])
    assert.deepEqual(diffText('เก่า', ''), [{ type: 'del', text: 'เก่า' }])
  })

  test('Thai typo fix highlights only the changed grapheme, not the whole sentence', () => {
    const a = 'ทำให้รุ้สึกปริมาณกาแฟน้อย'
    const b = 'ทำให้รู้สึกปริมาณกาแฟน้อย'
    const parts = diffText(a, b)
    assert.equal(side(parts, 'del'), a)
    assert.equal(side(parts, 'ins'), b)
    assert.deepEqual(changed(parts, 'del'), ['รุ้'])
    assert.deepEqual(changed(parts, 'ins'), ['รู้'])
  })

  test('removed duplicated words show as a deletion only', () => {
    const a = 'ปริมาณกาแฟของกาแฟน่าจะน้อย'
    const b = 'ปริมาณกาแฟน่าจะน้อย'
    const parts = diffText(a, b)
    assert.equal(side(parts, 'del'), a)
    assert.equal(side(parts, 'ins'), b)
    assert.equal(changed(parts, 'ins').length, 0)
    assert.equal(changed(parts, 'del').join(''), 'ของกาแฟ')
  })

  test('English word replacement', () => {
    const parts = diffText('the colour is nice', 'the color is nice')
    assert.equal(side(parts, 'del'), 'the colour is nice')
    assert.equal(side(parts, 'ins'), 'the color is nice')
    assert.ok(changed(parts, 'del').join('').length <= 6)
  })

  test('completely different text = one del + one ins (no confetti)', () => {
    const parts = diffText('แพ็กเกจสวย', 'ราคาถูกมาก')
    assert.equal(side(parts, 'del'), 'แพ็กเกจสวย')
    assert.equal(side(parts, 'ins'), 'ราคาถูกมาก')
    assert.ok(parts.length <= 4, JSON.stringify(parts))
  })

  test('adjacent parts never share a type', () => {
    const parts = diffText('a b c d e f', 'a x c y e z')
    for (let i = 1; i < parts.length; i++) assert.notEqual(parts[i].type, parts[i - 1].type)
  })

  test('very long texts fall back without hanging and still reconstruct', () => {
    const a = 'ก ข '.repeat(2000)
    const b = 'ข ก '.repeat(2000)
    const t = Date.now()
    const parts = diffText(a, b)
    assert.ok(Date.now() - t < 2000)
    assert.equal(side(parts, 'del'), a)
    assert.equal(side(parts, 'ins'), b)
  })

  test('randomised: both sides always reconstruct exactly', () => {
    const alphabet = ['ก', 'า', 'ร', 'ู้', 'ุ้', ' ', 'a', 'b', '/', 'น', 'ำ', 'เ']
    let seed = 7
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const make = () => Array.from({ length: rnd(30) }, () => alphabet[rnd(alphabet.length)]).join('')
    for (let k = 0; k < 300; k++) {
      const a = make()
      const b = rnd(3) === 0 ? a : make()
      const parts = diffText(a, b)
      assert.equal(side(parts, 'del'), a, `del side for ${JSON.stringify([a, b])}`)
      assert.equal(side(parts, 'ins'), b, `ins side for ${JSON.stringify([a, b])}`)
    }
  })

  test('cached version returns the same result', () => {
    assert.deepEqual(diffTextCached('ทดสอบ', 'ทดลอง'), diffText('ทดสอบ', 'ทดลอง'))
    assert.equal(diffTextCached('x', 'y'), diffTextCached('x', 'y'))
  })

  test('wordTokens joins back to the input', () => {
    const s = 'กระป๋องเล็กไป / ราคาแพง 17 บาท'
    assert.equal(wordTokens(s).join(''), s)
    assert.ok(wordTokens(s).length > 3)
  })
})
