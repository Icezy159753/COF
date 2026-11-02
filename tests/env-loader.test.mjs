import test from 'node:test'
import assert from 'node:assert/strict'

test('test env loader lets Vite modules using import.meta.env load in Node', async () => {
  const spss = await import('../src/lib/spss.js')
  const ai = await import('../src/lib/aiGroup.js')
  assert.equal(typeof spss.parseSavCodebook, 'function')
  assert.equal(typeof ai.toAiPayload, 'function')
})
