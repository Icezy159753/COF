import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

function blockFor(header) {
  const start = rules.indexOf(header)
  assert.notEqual(start, -1, `missing rules block: ${header}`)
  const rest = rules.slice(start)
  const end = rest.indexOf('\n    }')
  assert.notEqual(end, -1, `missing block end: ${header}`)
  return rest.slice(0, end)
}

test('public CI review codeframe writes are token-bound and field-whitelisted', () => {
  const codeframesBlock = blockFor('match /codeframes/{docId} {')
  assert.equal(codeframesBlock.includes('allow update: if approved() || safePublicCodeframeReviewUpdate(docId);'), true)
  assert.equal(rules.includes('tokenOwnsCodeframe(request.resource.data.reviewWriteToken, docId)'), true)
  assert.equal(rules.includes("'reviewWriteToken'"), true)
  assert.equal(rules.includes("'sheetsJson'"), true)
  assert.equal(rules.includes("'reviewFreqByCode'"), true)
})

test('public CI review link confirm and audit create are token-bound and whitelisted', () => {
  const reviewLinksBlock = blockFor('match /review_links/{token} {')
  const reviewAuditBlock = blockFor('match /review_audit/{auditId} {')
  assert.equal(reviewLinksBlock.includes('allow update: if approved() || safePublicReviewLinkUpdate(token);'), true)
  assert.equal(reviewAuditBlock.includes('allow create: if safePublicReviewAuditCreate() || approved();'), true)
  assert.equal(rules.includes('tokenOwnsCodeframe(request.resource.data.token, request.resource.data.codeframeId)'), true)
  assert.equal(rules.includes("'review_confirm'"), true)
  assert.equal(rules.includes("'code_comment'"), true)
})
