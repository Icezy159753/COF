const { onRequest } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { SavBufferReader } = require('sav-reader')

if (!admin.apps.length) admin.initializeApp()
const firestore = admin.firestore()

const ALLOWED_REVIEW_ACTIONS = new Set([
  'edit_code_cell',
  'rename_net',
  'rename_code',
  'move_code_top',
  'move_code_bottom',
  'move_code_up',
  'move_code_down',
  'merge_code',
  'move_code',
  'export_codeframe',
  'code_comment',
  'review_confirm',
])

function sendJson(res, status, payload) {
  res.status(status).send(JSON.stringify(payload))
}

function allowCors(req, res) {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Content-Type', 'application/json; charset=utf-8')
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return true
  }
  return false
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  const text = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.body || '')
  return text ? JSON.parse(text) : {}
}

function parseCodeframeDoc(data = {}) {
  let sheets = data.sheets ?? []
  if ((!sheets || !sheets.length) && data.sheetsJson) {
    try { sheets = JSON.parse(data.sheetsJson) } catch { sheets = [] }
  }
  let checkpoints = data.checkpoints ?? []
  if ((!checkpoints || !checkpoints.length) && data.checkpointsJson) {
    try { checkpoints = JSON.parse(data.checkpointsJson) } catch { checkpoints = [] }
  }
  return { ...data, sheets, checkpoints }
}

function sanitizeLink(link = {}) {
  return {
    token: link.token || '',
    status: link.status || '',
    projectId: link.projectId || '',
    projectName: link.projectName || '',
    codeframeId: link.codeframeId || '',
    codeframeName: link.codeframeName || '',
    reviewSheetQuestions: link.reviewSheetQuestions || {},
    emailInvite: link.emailInvite || null,
    permissions: link.permissions || {},
    confirmedAt: link.confirmedAt || null,
    confirmedBy: link.confirmedBy || '',
    confirmStatus: link.confirmStatus || '',
    confirmNote: link.confirmNote || '',
  }
}

function sanitizeCodeframe(cf = {}) {
  return parseCodeframeDoc({
    id: cf.id || '',
    projectId: cf.projectId || '',
    box: cf.box || 'oe',
    name: cf.name || '',
    createdAt: cf.createdAt || null,
    sheetsJson: cf.sheetsJson || '[]',
    checkpointsJson: cf.checkpointsJson || '[]',
    clientReviewEnabled: cf.clientReviewEnabled === true,
    reviewFreqByCode: cf.reviewFreqByCode || {},
    reviewSheetStatusMap: cf.reviewSheetStatusMap || {},
    reviewSheetQuestions: cf.reviewSheetQuestions || {},
    reviewProjectName: cf.reviewProjectName || '',
    reviewUpdatedAt: cf.reviewUpdatedAt || null,
  })
}

async function loadActiveReview(token) {
  const cleanToken = String(token || '').trim()
  if (!cleanToken) throw Object.assign(new Error('Missing review token'), { status: 400 })
  const linkRef = firestore.collection('review_links').doc(cleanToken)
  const linkSnap = await linkRef.get()
  if (!linkSnap.exists) throw Object.assign(new Error('ลิงก์ Review นี้ไม่ถูกต้องหรือถูกปิดแล้ว'), { status: 404 })
  const link = { id: linkSnap.id, ...linkSnap.data() }
  // ต้องเป็น 'active' ชัด ๆ เท่านั้น (ลิงก์ที่ไม่มี status ถือว่าปิด — fail closed เหมือน firestore.rules)
  if (link.status !== 'active') throw Object.assign(new Error('ลิงก์ Review นี้ถูกปิดใช้งานแล้ว'), { status: 403 })
  if (!link.codeframeId) throw Object.assign(new Error('Review link ไม่มี codeframeId'), { status: 400 })
  const cfRef = firestore.collection('codeframes').doc(link.codeframeId)
  const cfSnap = await cfRef.get()
  if (!cfSnap.exists) throw Object.assign(new Error('ไม่พบ Codeframe'), { status: 404 })
  const cf = { id: cfSnap.id, ...cfSnap.data() }
  if (cf.clientReviewEnabled !== true) throw Object.assign(new Error('Codeframe นี้ยังไม่ได้เปิด CI Review'), { status: 403 })
  return { token: cleanToken, linkRef, link, cfRef, cf }
}

async function logReviewAudit({ token, link, cf, action, reviewer, payload }) {
  if (!ALLOWED_REVIEW_ACTIONS.has(action)) throw Object.assign(new Error('Invalid review action'), { status: 400 })
  await firestore.collection('review_audit').add({
    token,
    codeframeId: cf.id,
    projectId: link.projectId || cf.projectId || '',
    action,
    reviewer: String(reviewer || '').trim() || 'CI Reviewer',
    payload: payload || {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

async function parseSavBuffer(buffer) {
  const sav = new SavBufferReader(buffer)
  await sav.open()

  const byVar = {}
  for (const v of sav.meta.sysvars ?? []) {
    if (v.__is_child_string_var) continue
    const values = (() => {
      try {
        const entries = sav.meta.getValueLabels(v.name) ?? []
        return entries
          .map((e) => ({ value: e.val, label: String(e.label ?? '').trim() }))
          .filter((e) => e.label !== '')
      } catch {
        return []
      }
    })()
    byVar[v.name] = {
      label: String(v.label ?? '').trim(),
      type: v.type === 1 ? 'string' : 'numeric',
      values,
    }
  }
  return { byVar, varCount: Object.keys(byVar).length }
}

// ต้องเป็นผู้ใช้ที่ล็อกอิน (Firebase ID token) และได้รับอนุมัติแล้ว (users/{uid}.status == 'approved')
async function requireApprovedUser(req) {
  const m = String(req.get?.('authorization') || req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)
  if (!m) throw Object.assign(new Error('ต้องเข้าสู่ระบบก่อนใช้งาน (ไม่มี token)'), { status: 401 })
  let decoded
  try {
    decoded = await admin.auth().verifyIdToken(m[1].trim())
  } catch {
    throw Object.assign(new Error('Token ไม่ถูกต้องหรือหมดอายุ'), { status: 401 })
  }
  const snap = await firestore.collection('users').doc(decoded.uid).get()
  if (!snap.exists || snap.data()?.status !== 'approved') throw Object.assign(new Error('บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน'), { status: 403 })
  return decoded
}

exports.parseSav = onRequest({ region: 'asia-southeast1', cors: true, timeoutSeconds: 60, memory: '512MiB' }, async (req, res) => {
  res.set('Content-Type', 'application/json; charset=utf-8')
  if (req.method !== 'POST') {
    res.status(405).send(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }
  try {
    await requireApprovedUser(req)
  } catch (e) {
    res.status(e.status || 401).send(JSON.stringify({ error: e.message }))
    return
  }
  try {
    const raw = req.rawBody || Buffer.from(req.body || '')
    if (!raw?.length) {
      res.status(400).send(JSON.stringify({ error: 'ไม่มีไฟล์ .sav' }))
      return
    }
    const result = await parseSavBuffer(raw)
    res.status(200).send(JSON.stringify(result))
  } catch (e) {
    res.status(500).send(JSON.stringify({ error: `อ่านไฟล์ .sav ไม่สำเร็จ: ${e.message}` }))
  }
})

exports.reviewCodeframe = onRequest({ region: 'asia-southeast1', cors: true, timeoutSeconds: 60, memory: '512MiB' }, async (req, res) => {
  if (allowCors(req, res)) return
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' })

  try {
    const body = parseJsonBody(req)
    const action = String(body.action || '').trim()
    const review = await loadActiveReview(body.token)

    if (action === 'get') {
      return sendJson(res, 200, { link: sanitizeLink(review.link), codeframe: sanitizeCodeframe(review.cf) })
    }

    if (action === 'saveCodeframe') {
      const reviewer = String(body.reviewer || '').trim() || 'CI Reviewer'
      const auditAction = String(body.auditAction || '').trim()
      const sheets = Array.isArray(body.sheets) ? body.sheets : null
      if (!sheets) return sendJson(res, 400, { error: 'Invalid sheets payload' })
      if (!ALLOWED_REVIEW_ACTIONS.has(auditAction)) return sendJson(res, 400, { error: 'Invalid audit action' })

      const update = {
        sheetsJson: JSON.stringify(sheets),
        reviewFreqByCode: body.reviewFreqByCode && typeof body.reviewFreqByCode === 'object' ? body.reviewFreqByCode : {},
        reviewSheetStatusMap: body.reviewSheetStatusMap && typeof body.reviewSheetStatusMap === 'object' ? body.reviewSheetStatusMap : {},
        reviewUpdatedAt: Date.now(),
      }
      await review.cfRef.update(update)
      await logReviewAudit({ token: review.token, link: review.link, cf: review.cf, action: auditAction, reviewer, payload: body.payload || {} })
      return sendJson(res, 200, { ok: true, update })
    }

    if (action === 'audit') {
      await logReviewAudit({
        token: review.token,
        link: review.link,
        cf: review.cf,
        action: String(body.auditAction || '').trim(),
        reviewer: body.reviewer,
        payload: body.payload || {},
      })
      return sendJson(res, 200, { ok: true })
    }

    if (action === 'confirm') {
      const reviewer = String(body.reviewer || '').trim() || 'CI Reviewer'
      const note = String(body.note || '').trim() || 'ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ'
      const editEmail = review.link?.emailInvite?.editEmail || review.link?.editEmail || ''
      const ciEmail = review.link?.emailInvite?.ciEmail || ''
      const update = {
        confirmedAt: Date.now(),
        confirmedBy: reviewer,
        confirmEmailTo: editEmail || '',
        confirmNote: note,
        confirmStatus: editEmail ? 'sending' : 'no_edit_email',
      }
      await review.linkRef.update(update)
      await logReviewAudit({ token: review.token, link: review.link, cf: review.cf, action: 'review_confirm', reviewer, payload: { confirmedBy: reviewer, editEmail: editEmail || '', ciEmail: ciEmail || '', note } })
      return sendJson(res, 200, { ok: true, editEmail, ciEmail, update })
    }

    if (action === 'confirmEmailStatus') {
      const status = String(body.status || '').trim()
      if (!['emailed', 'email_failed', 'no_edit_email'].includes(status)) return sendJson(res, 400, { error: 'Invalid confirm status' })
      const update = status === 'emailed'
        ? { confirmStatus: status, confirmEmailSentAt: Date.now(), confirmEmailId: String(body.emailId || ''), confirmNote: String(body.note || review.link.confirmNote || '') }
        : { confirmStatus: status, confirmError: String(body.error || '') }
      await review.linkRef.update(update)
      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 400, { error: 'Invalid action' })
  } catch (e) {
    const status = Number(e.status || 500)
    return sendJson(res, status, { error: e.message || String(e) })
  }
})
