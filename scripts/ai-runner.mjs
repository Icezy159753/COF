#!/usr/bin/env node
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { createVerify } from 'node:crypto'
const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const { SavBufferReader } = require('sav-reader')

const PORT = Number(process.env.PORT || 8787)
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'qwen/qwen3-235b-a22b-2507'
const TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 240000)
const ENV_FILE = process.env.OPENROUTER_ENV_FILE || '/home/horari/projects/COF/.openrouter.env'
const DEFAULT_RESEND_FROM = 'Codeframe Review <codeframe@dpdata-tools.com>'

function loadSecret() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  if (!existsSync(ENV_FILE)) return ''
  const env = readFileSync(ENV_FILE, 'utf8')
  const m = env.match(/^OPENROUTER_API_KEY=(.+)$/m)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

function loadEnvValue(name) {
  if (process.env[name]) return process.env[name]
  if (!existsSync(ENV_FILE)) return ''
  const env = readFileSync(ENV_FILE, 'utf8')
  const re = new RegExp(`^${name}=(.+)$`, 'm')
  const m = env.match(re)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

// ---------- Auth: ทุก endpoint (ยกเว้น /health และ Confirm ของ CI) ต้องมี Firebase ID token ของผู้ใช้ที่อนุมัติแล้ว ----------
// ตรวจลายเซ็น RS256 กับใบรับรองสาธารณะของ Google (ไม่ต้องใช้ service account) แล้วอ่าน users/{uid}
// ผ่าน Firestore REST ด้วย token ของผู้ใช้เอง (rules อนุญาตให้อ่านโปรไฟล์ตัวเอง) → ต้อง status == 'approved'
// Auth/Firestore อยู่คนละ project กับ Hosting: Hosting = codeframe-dp · Auth/Firestore = codeframe-dbd8d (ดู src/lib/firebaseConfig.js)
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'codeframe-dbd8d'
const FIRESTORE_DOCS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`
const SECURETOKEN_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
// ปิดได้เฉพาะกรณีฉุกเฉิน/ทดสอบในเครื่อง: AI_RUNNER_REQUIRE_AUTH=0
const REQUIRE_AUTH = process.env.AI_RUNNER_REQUIRE_AUTH !== '0'

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

let certCache = { expiresAt: 0, certs: null }
async function getSecuretokenCerts() {
  if (certCache.certs && Date.now() < certCache.expiresAt) return certCache.certs
  const r = await fetch(SECURETOKEN_CERTS_URL)
  if (!r.ok) throw new HttpError(503, `โหลดใบรับรอง Firebase ไม่สำเร็จ HTTP ${r.status}`)
  const certs = await r.json()
  const maxAge = Number((r.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600)
  certCache = { certs, expiresAt: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 }
  return certs
}

const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

async function verifyFirebaseIdToken(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new HttpError(401, 'Token ไม่ถูกต้อง')
  let header, payload
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]) } catch { throw new HttpError(401, 'Token ไม่ถูกต้อง') }
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'Token ไม่ถูกต้อง')
  const certs = await getSecuretokenCerts()
  const cert = certs[header.kid]
  if (!cert) throw new HttpError(401, 'Token หมดอายุหรือไม่ถูกต้อง — กรุณา Refresh แล้วลองใหม่')
  const ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(cert, Buffer.from(parts[2], 'base64url'))
  if (!ok) throw new HttpError(401, 'Token ไม่ถูกต้อง')
  const now = Math.floor(Date.now() / 1000)
  if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new HttpError(401, 'Token ไม่ใช่ของระบบนี้')
  if (!payload.sub || typeof payload.sub !== 'string') throw new HttpError(401, 'Token ไม่ถูกต้อง')
  if (!(payload.exp > now)) throw new HttpError(401, 'Token หมดอายุ — กรุณา Refresh แล้วลองใหม่')
  if (payload.iat > now + 300 || (payload.auth_time && payload.auth_time > now + 300)) throw new HttpError(401, 'Token ไม่ถูกต้อง')
  return payload
}

const approvedCache = new Map() // uid → expiresAt (เฉพาะคนที่อนุมัติแล้ว)
async function assertApprovedUser(uid, idToken) {
  const hit = approvedCache.get(uid)
  if (hit && hit > Date.now()) return
  const r = await fetch(`${FIRESTORE_DOCS}/users/${encodeURIComponent(uid)}`, { headers: { Authorization: `Bearer ${idToken}` } })
  if (r.status === 403 || r.status === 404) throw new HttpError(403, 'บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน')
  if (!r.ok) throw new HttpError(503, `ตรวจสิทธิ์ผู้ใช้ไม่สำเร็จ HTTP ${r.status}`)
  const data = await r.json().catch(() => ({}))
  if (data?.fields?.status?.stringValue !== 'approved') throw new HttpError(403, 'บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน')
  approvedCache.set(uid, Date.now() + 5 * 60 * 1000)
}

async function requireApprovedUser(req) {
  if (!REQUIRE_AUTH) return null
  const m = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)
  if (!m) throw new HttpError(401, 'ต้องเข้าสู่ระบบก่อนใช้งาน (ไม่มี token)')
  const payload = await verifyFirebaseIdToken(m[1].trim())
  await assertApprovedUser(payload.sub, m[1].trim())
  return payload
}

// Confirm ของ CI (ไม่ได้ล็อกอิน): ยืนยันด้วย review token ที่ยัง active และส่งเมลไปหา Edit ที่บันทึกไว้ในลิงก์เท่านั้น
const confirmRate = new Map() // token → [timestamps]
async function loadActiveReviewLink(reviewUrl) {
  const token = String(reviewUrl || '').match(/^https:\/\/codeframe-dp\.web\.app\/#\/review\/([A-Za-z0-9_-]{8,200})$/)?.[1]
  if (!token) throw new HttpError(400, 'Review link ไม่ถูกต้อง')
  const r = await fetch(`${FIRESTORE_DOCS}/review_links/${encodeURIComponent(token)}`)
  if (r.status === 403 || r.status === 404) throw new HttpError(403, 'ลิงก์ Review นี้ไม่ถูกต้องหรือถูกปิดแล้ว')
  if (!r.ok) throw new HttpError(503, `ตรวจลิงก์ Review ไม่สำเร็จ HTTP ${r.status}`)
  const doc = await r.json().catch(() => ({}))
  const f = doc?.fields || {}
  if (f.status?.stringValue !== 'active') throw new HttpError(403, 'ลิงก์ Review นี้ถูกปิดใช้งานแล้ว')
  const editEmail = f.emailInvite?.mapValue?.fields?.editEmail?.stringValue || ''
  return { token, editEmail }
}
function checkConfirmRate(token, limit = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now()
  const recent = (confirmRate.get(token) || []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) throw new HttpError(429, 'ส่งเมล Confirm ถี่เกินไป กรุณารอสักครู่')
  recent.push(now)
  confirmRate.set(token, recent)
}

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()) }
function parseEmailList(v) {
  const raw = Array.isArray(v) ? v.join(',') : String(v || '')
  return [...new Set(raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))]
}
function escHtml(v) { return String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])) }

async function deliverResendEmail(payload) {
  const apiKey = loadEnvValue('RESEND_API_KEY')
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured on backend')
  try {
    const { stdout } = await execFileAsync('curl', [
      '--ipv4', '-sS', '-m', '45', '-X', 'POST', 'https://api.resend.com/emails',
      '-H', `Authorization: Bearer ${apiKey}`,
      '-H', 'Content-Type: application/json',
      '--data-binary', JSON.stringify(payload),
    ], { timeout: 55000, maxBuffer: 2_000_000 })
    const data = JSON.parse(stdout || '{}')
    const resendMsg = data?.message || data?.error || ''
    if (!data?.id && resendMsg) {
      if (/only send testing emails|verify a domain|resend\.com\/domains/i.test(resendMsg)) {
        throw new Error('Resend ยังเป็นโหมดทดสอบ: ส่งได้เฉพาะเมลเจ้าของบัญชีเท่านั้น ถ้าจะส่งหา CI คนอื่นต้อง Verify domain dpdata-tools.com ใน Resend ก่อน')
      }
      throw new Error(resendMsg)
    }
    if (!data?.id) throw new Error(`Resend ไม่ส่ง id กลับมา: ${JSON.stringify(data).slice(0, 300)}`)
    return data
  } catch (curlErr) {
    throw new Error(`เชื่อมต่อ Resend ไม่สำเร็จ: ${curlErr.message || 'curl failed'}`)
  }
}

async function sendCiConfirmEmail(body = {}) {
  const editEmail = String(body.editEmail || '').trim()
  const reviewer = String(body.reviewer || 'CI Reviewer').trim() || 'CI Reviewer'
  const reviewerEmail = String(body.reviewerEmail || body.ciEmail || '').trim()
  const jobName = String(body.jobName || 'COF Job')
  const codeframeName = String(body.codeframeName || 'Codeframe Review')
  const reviewUrl = String(body.reviewUrl || '')
  const confirmedAt = String(body.confirmedAt || new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))
  const note = String(body.note || '').trim() || 'ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ'
  if (!isEmail(editEmail)) throw new Error('ไม่พบ/ไม่ถูกต้อง: Send from Email ของ Edit สำหรับส่งเมล Confirm กลับ')
  if (reviewerEmail && !isEmail(reviewerEmail)) throw new Error('CI Email ไม่ถูกต้อง')
  if (!/^https:\/\/codeframe-dp\.web\.app\/#\/review\//.test(reviewUrl)) throw new Error('Review link ไม่ถูกต้อง')
  const from = loadEnvValue('RESEND_FROM') || DEFAULT_RESEND_FROM
  const safeJob = escHtml(jobName)
  const safeCodeframe = escHtml(codeframeName)
  const safeReviewer = escHtml(reviewer)
  const safeReviewerEmail = escHtml(reviewerEmail || '-')
  const safeConfirmedAt = escHtml(confirmedAt)
  const safeReviewUrl = escHtml(reviewUrl)
  const safeNote = escHtml(note).replace(/\n/g, '<br>')
  const subject = body.subject || `[COF] CI Confirmed: ${jobName}`
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2ff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(135deg,#eef2ff 0%,#f8fafc 48%,#ecfeff 100%);padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;border-radius:28px;overflow:hidden;background:#ffffff;box-shadow:0 22px 55px rgba(30,41,59,.14);border:1px solid #e0e7ff">
        <tr><td style="padding:28px;background:linear-gradient(135deg,#10b981 0%,#14b8a6 52%,#4f46e5 100%);color:#ffffff">
          <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Codeframe Studio</div>
          <h1 style="margin:16px 0 0;font-size:28px;line-height:1.2;font-weight:900">CI Confirmed Review</h1>
          <p style="margin:8px 0 0;color:#dcfce7;font-size:14px;font-weight:700">CI ยืนยันว่าตรวจ Codeframe เสร็จแล้ว และส่งข้อความตอบกลับถึงทีม Edit</p>
        </td></tr>
        <tr><td style="padding:24px 28px 8px"><div style="border-radius:22px;background:#f8fafc;border:1px solid #e2e8f0;padding:18px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr><td style="padding:0 0 12px;width:128px;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase">Job</td><td style="padding:0 0 12px;font-size:16px;font-weight:800">${safeJob}</td></tr>
            <tr><td style="padding:0 0 12px;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase">Codeframe</td><td style="padding:0 0 12px;font-size:16px;font-weight:800">${safeCodeframe}</td></tr>
            <tr><td style="padding:0 0 12px;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase">CI</td><td style="padding:0 0 12px;font-size:15px;font-weight:800;color:#059669">${safeReviewer}${reviewerEmail ? ` &lt;${safeReviewerEmail}&gt;` : ''}</td></tr>
            <tr><td style="padding:0;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase">Confirmed</td><td style="padding:0;font-size:15px;font-weight:800">${safeConfirmedAt}</td></tr>
          </table>
        </div></td></tr>
        <tr><td style="padding:14px 28px 4px"><div style="border-left:5px solid #10b981;border-radius:18px;background:#ecfdf5;padding:14px 16px;color:#065f46;font-size:15px;line-height:1.7"><div style="font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#047857;margin-bottom:6px">ข้อความตอบกลับจาก CI ถึง Edit</div><div style="font-size:16px;font-weight:800;color:#064e3b">${safeNote}</div></div></td></tr>
        <tr><td align="center" style="padding:22px 28px 18px"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td bgcolor="#4f46e5" align="center" style="border-radius:16px;background:#4f46e5;mso-padding-alt:15px 28px;box-shadow:0 12px 26px rgba(79,70,229,.25)"><a href="${safeReviewUrl}" target="_blank" style="display:inline-block;padding:15px 28px;border-radius:16px;background:#4f46e5;color:#ffffff;font-size:16px;font-weight:900;text-decoration:none">เปิดหน้า CI Review</a></td></tr></table><div style="margin-top:12px;color:#64748b;font-size:12px;line-height:1.5;word-break:break-all">${safeReviewUrl}</div></td></tr>
        <tr><td style="padding:18px 28px;background:#0f172a;color:#cbd5e1;font-size:12px;line-height:1.55"><b style="color:#ffffff">Codeframe Review</b> · CI Confirm notification</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
  const text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CI CONFIRMED REVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CI ยืนยันว่าตรวจ Codeframe เสร็จแล้ว

📌 Job
${jobName}

📘 Codeframe
${codeframeName}

👤 CI ผู้ยืนยัน
${reviewer}${reviewerEmail ? ` <${reviewerEmail}>` : ''}

🕒 เวลายืนยัน
${confirmedAt}

💬 ข้อความจาก CI
${note}

🔗 เปิดหน้า CI Review
${reviewUrl}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Codeframe Review · CI Confirm notification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  const payload = { from, to: [editEmail], subject, html, text, ...(reviewerEmail ? { reply_to: reviewerEmail } : {}) }
  const data = await deliverResendEmail(payload)
  return { ok: true, id: data.id || '', to: [editEmail], replyTo: reviewerEmail, from, transport: 'curl-ipv4' }
}


async function sendCiReviewEmail(body = {}) {
  const apiKey = loadEnvValue('RESEND_API_KEY')
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured on backend')
  const toList = parseEmailList(body.ciEmails ?? body.ciEmail)
  const ccList = parseEmailList(body.ccEmails ?? body.ccEmail)
  const replyTo = String(body.editEmail || '').trim()
  if (!toList.length) throw new Error('กรุณาใส่ Email CI อย่างน้อย 1 เมล')
  const badTo = toList.find((e) => !isEmail(e))
  const badCc = ccList.find((e) => !isEmail(e))
  if (badTo) throw new Error(`CI Email ไม่ถูกต้อง: ${badTo}`)
  if (badCc) throw new Error(`Cc Email ไม่ถูกต้อง: ${badCc}`)
  if (replyTo && !isEmail(replyTo)) throw new Error('Edit Reply-To Email ไม่ถูกต้อง')
  const jobName = String(body.jobName || 'COF Job')
  const codeframeName = String(body.codeframeName || 'Codeframe Review')
  const reviewUrl = String(body.reviewUrl || '')
  if (!/^https:\/\/codeframe-dp\.web\.app\/#\/review\//.test(reviewUrl)) throw new Error('Review link ไม่ถูกต้อง')
  const message = String(body.message || 'รบกวนตรวจ Codeframe และใส่ Comment ที่ Code ที่ต้องแก้ค่ะ')
  const subject = body.subject || `[COF] CI Review: ${jobName}`
  const preheader = `รบกวนตรวจ Codeframe: ${jobName} / ${codeframeName}`
  const safeMessage = escHtml(message).replace(/\n/g, '<br>')
  const safeJob = escHtml(jobName)
  const safeCodeframe = escHtml(codeframeName)
  const safeReplyTo = escHtml(replyTo || '-')
  const safeReviewUrl = escHtml(reviewUrl)
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>CI Codeframe Review</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2ff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#0f172a">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(135deg,#eef2ff 0%,#f8fafc 48%,#ecfeff 100%);padding:28px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;border-radius:28px;overflow:hidden;background:#ffffff;box-shadow:0 22px 55px rgba(30,41,59,.14);border:1px solid #e0e7ff">
            <tr>
              <td style="padding:0;background:#312e81">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 55%,#06b6d4 100%)">
                  <tr>
                    <td style="padding:28px 28px 24px">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="width:76px;vertical-align:top;padding-right:16px">
                            <table role="presentation" width="66" height="66" cellspacing="0" cellpadding="0" style="width:66px;height:66px;border-radius:22px;background:#5b55d7;border:1px solid rgba(255,255,255,.24);box-shadow:0 16px 34px rgba(15,23,42,.24)">
                              <tr>
                                <td align="center" valign="middle" style="padding:11px">
                                  <table role="presentation" width="44" height="44" cellspacing="5" cellpadding="0" style="width:44px;height:44px;background:#5b55d7;border-radius:14px">
                                    <tr>
                                      <td width="17" height="17" style="background:#ffffff;border:2px solid #eef2ff;border-radius:4px;font-size:0;line-height:0">&nbsp;</td>
                                      <td width="17" height="17" style="background:#ffffff;border:2px solid #eef2ff;border-radius:4px;font-size:0;line-height:0">&nbsp;</td>
                                    </tr>
                                    <tr>
                                      <td width="17" height="17" style="background:#ffffff;border:2px solid #eef2ff;border-radius:4px;font-size:0;line-height:0">&nbsp;</td>
                                      <td width="17" height="17" style="background:#ffffff;border:2px solid #eef2ff;border-radius:4px;font-size:0;line-height:0">&nbsp;</td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </td>
                          <td style="vertical-align:top">
                            <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.18);color:#eef2ff;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Codeframe Studio</div>
                            <h1 style="margin:16px 0 8px;color:#ffffff;font-size:30px;line-height:1.15;font-weight:900">CI Codeframe Review</h1>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px">
                <div style="border-radius:22px;background:#f8fafc;border:1px solid #e2e8f0;padding:18px 18px 6px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="padding:0 0 12px;width:128px;color:#64748b;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">Job</td>
                      <td style="padding:0 0 12px;color:#0f172a;font-size:16px;font-weight:800;line-height:1.4">${safeJob}</td>
                    </tr>
                    <tr>
                      <td style="padding:0 0 12px;color:#64748b;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">Codeframe</td>
                      <td style="padding:0 0 12px;color:#0f172a;font-size:16px;font-weight:800;line-height:1.4">${safeCodeframe}</td>
                    </tr>
                    ${replyTo ? `<tr><td style="padding:0 0 12px;color:#64748b;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">Send from</td><td style="padding:0 0 12px;color:#4f46e5;font-size:15px;font-weight:800;line-height:1.4">${safeReplyTo}</td></tr>` : ''}
                  </table>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 6px">
                <div style="border-left:5px solid #8b5cf6;border-radius:18px;background:#faf5ff;padding:14px 16px;color:#334155;font-size:15px;line-height:1.7">${safeMessage}</div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 28px 18px">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto">
                  <tr>
                    <td bgcolor="#4f46e5" align="center" style="border-radius:16px;background:#4f46e5;mso-padding-alt:16px 30px;box-shadow:0 12px 26px rgba(79,70,229,.28)">
                      <a href="${safeReviewUrl}" target="_blank" style="display:inline-block;padding:16px 30px;border-radius:16px;background:#4f46e5;color:#ffffff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:17px;font-weight:900;line-height:1.2;text-decoration:none;text-align:center">
                        คลิกเปิดลิงก์ CI Review
                      </a>
                    </td>
                  </tr>
                </table>
                <div style="margin-top:12px;color:#64748b;font-size:12px;line-height:1.5">กดปุ่มด้านบนเพื่อเปิดหน้า Review และเริ่มตรวจ Codeframe</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px">
                  <tr>
                    <td style="width:38px;vertical-align:top"><div style="width:28px;height:28px;line-height:28px;border-radius:9px;background:#eef2ff;color:#4f46e5;text-align:center;font-weight:900">1</div></td>
                    <td style="color:#334155;font-size:14px;line-height:1.55"><b>เปิดลิงก์ Review</b> แล้วตรวจสีชีท/Code ที่ต้องดู</td>
                  </tr>
                  <tr>
                    <td style="width:38px;vertical-align:top"><div style="width:28px;height:28px;line-height:28px;border-radius:9px;background:#eef2ff;color:#4f46e5;text-align:center;font-weight:900">2</div></td>
                    <td style="color:#334155;font-size:14px;line-height:1.55"><b>คลิกขวาที่ Code</b> → เลือก <b>เพิ่ม Comment ให้ Code นี้</b></td>
                  </tr>
                  <tr>
                    <td style="width:38px;vertical-align:top"><div style="width:28px;height:28px;line-height:28px;border-radius:9px;background:#eef2ff;color:#4f46e5;text-align:center;font-weight:900">3</div></td>
                    <td style="color:#334155;font-size:14px;line-height:1.55"><b>ส่ง Comment</b> แล้วทีม Edit จะเห็นแจ้งเตือนใน Codeframe Edit</td>
                  </tr>
                </table>
                <div style="margin-top:8px;border-radius:16px;background:#f1f5f9;padding:12px 14px;color:#64748b;font-size:12px;line-height:1.55;word-break:break-all">
                  หากปุ่มเปิดไม่ได้ ให้คัดลอกลิงก์นี้:<br><span style="color:#4f46e5;font-weight:700">${safeReviewUrl}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#0f172a;color:#cbd5e1;font-size:12px;line-height:1.55">
                <b style="color:#ffffff">Codeframe Review</b> · ส่งโดยระบบ Codeframe Studio<br>
                เมลนี้ตั้งค่า Send from เป็นทีม Edit เพื่อให้ CI เห็นผู้ประสานงานได้ชัดเจน
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
  const text = `CI Codeframe Review

${message}

Job: ${jobName}
Codeframe: ${codeframeName}
Review link: ${reviewUrl}

วิธี Comment:
1. เปิดลิงก์ Review
2. คลิกขวาที่ Code → เพิ่ม Comment ให้ Code นี้
3. ส่ง Comment แล้วทีม Edit จะเห็นแจ้งเตือน`
  const from = loadEnvValue('RESEND_FROM') || DEFAULT_RESEND_FROM
  const payload = { from, to: toList, subject, html, text, ...(ccList.length ? { cc: ccList } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }
  try {
    const { stdout } = await execFileAsync('curl', [
      '--ipv4', '-sS', '-m', '45', '-X', 'POST', 'https://api.resend.com/emails',
      '-H', `Authorization: Bearer ${apiKey}`,
      '-H', 'Content-Type: application/json',
      '--data-binary', JSON.stringify(payload),
    ], { timeout: 55000, maxBuffer: 2_000_000 })
    const data = JSON.parse(stdout || '{}')
    const resendMsg = data?.message || data?.error || ''
    if (!data?.id && resendMsg) {
      if (/only send testing emails|verify a domain|resend\.com\/domains/i.test(resendMsg)) {
        throw new Error('Resend ยังเป็นโหมดทดสอบ: ส่งได้เฉพาะเมลเจ้าของบัญชีเท่านั้น ถ้าจะส่งหา CI คนอื่นต้อง Verify domain dpdata-tools.com ใน Resend ก่อน')
      }
      throw new Error(resendMsg)
    }
    if (!data?.id) throw new Error(`Resend ไม่ส่ง id กลับมา: ${JSON.stringify(data).slice(0, 300)}`)
    return { ok: true, id: data.id || '', to: toList, cc: ccList, replyTo, from, transport: 'curl-ipv4' }
  } catch (curlErr) {
    throw new Error(`เชื่อมต่อ Resend ไม่สำเร็จ: ${curlErr.message || 'curl failed'}`)
  }
}

const ROUTES = new Map([
  ['/api/ai-group', handleGroup],
  ['/api/ai-code', handleCode],
  ['/api/ai-review', handleReview],
  ['/api/ai-spellcheck', handleSpellcheck],
  ['/api/ai-assign', handleAssign],
  ['/api/ai-group-ce', handleGroupCE],
])

const SYSTEM_PROMPT = 'You are a precise text classifier for coding Thai open-ended survey responses. Output only one valid JSON object — no prose, no markdown.'

const ALLOWED_ORIGINS = new Set([
  'https://codeframe-dp.web.app',
  'https://codeframe-dp.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
])

function corsOrigin(req) {
  const origin = req?.headers?.origin || ''
  return ALLOWED_ORIGINS.has(origin) ? origin : 'https://codeframe-dp.web.app'
}

function send(res, status, data, req = null) {
  const body = status === 204 ? '' : JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': corsOrigin(req),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': req?.headers?.['access-control-request-headers'] || 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  })
  res.end(body)
}

function readBody(req, limit = 10_000_000) {
  return new Promise((resolve, reject) => {
    let body = ''
    let done = false
    const fail = (err) => { if (!done) { done = true; reject(err) } }
    req.on('data', (chunk) => {
      if (done) return
      body += chunk
      if (body.length > limit) {
        fail(new HttpError(413, 'Request too large'))
        req.destroy?.() // หยุดรับข้อมูลที่เหลือ ไม่บัฟเฟอร์ต่อ
      }
    })
    req.on('end', () => {
      if (done) return
      try {
        const parsed = body ? JSON.parse(body) : {}
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        done = true
        resolve(parsed)
      } catch {
        fail(new HttpError(400, 'JSON ไม่ถูกต้อง'))
      }
    })
    req.on('error', fail)
  })
}
function readRawBody(req, limit = 120_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let failed = false
    req.on('data', (chunk) => {
      if (failed) return
      size += chunk.length
      if (size > limit) {
        failed = true
        reject(new Error(`ไฟล์ .sav ใหญ่เกินไป (${Math.round(size / 1024 / 1024)}MB) — จำกัดไม่เกิน ${Math.round(limit / 1024 / 1024)}MB`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks))
    })
    req.on('error', (err) => {
      if (!failed) reject(err)
    })
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


function extractJson(text) {
  if (!text) throw new Error('empty model output')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error(`no JSON object in model output: ${text.slice(0, 240)}`)
  return JSON.parse(text.slice(start, end + 1))
}

// ---------- OmniRoute (AI gateway แบบ OpenAI-compatible ที่ติดตั้งบนเครื่อง runner) ----------
// ตั้งค่าบน server เท่านั้น (env หรือไฟล์ ENV_FILE): OMNIROUTE_API_KEY, OMNIROUTE_BASE_URL (ค่าเริ่มต้น http://127.0.0.1:20128/v1)
function omniRouteBase() {
  return (loadEnvValue('OMNIROUTE_BASE_URL') || 'http://127.0.0.1:20128/v1').replace(/\/+$/, '')
}
async function callOmniRoute(prompt, ai = {}) {
  const apiKey = loadEnvValue('OMNIROUTE_API_KEY')
  if (!apiKey) throw new Error('OMNIROUTE_API_KEY is not configured on backend')
  const model = String(ai.model || loadEnvValue('OMNIROUTE_MODEL') || '').trim()
  if (!model) throw new Error('ยังไม่ได้เลือกโมเดลของ OmniRoute')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(`${omniRouteBase()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      throw new Error(`OmniRoute HTTP ${r.status}: ${body.slice(0, 300)}`)
    }
    const data = await r.json()
    const out = data?.choices?.[0]?.message?.content
    if (!out) throw new Error('OmniRoute returned no content')
    return out
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('OmniRoute timeout')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
async function listOmniRouteModels() {
  const apiKey = loadEnvValue('OMNIROUTE_API_KEY')
  if (!apiKey) throw new Error('OMNIROUTE_API_KEY is not configured on backend')
  const r = await fetch(`${omniRouteBase()}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!r.ok) throw new Error(`OmniRoute HTTP ${r.status}`)
  const data = await r.json()
  return { models: (data?.data || []).map((m) => ({ id: String(m.id || ''), name: String(m.name || m.id || '') })).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id)) }
}

// เลือกเส้นทางตาม provider ที่ Admin ตั้งไว้ (ค่าอื่น ๆ ใช้ OpenRouter เหมือนเดิม)
function callAi(prompt, ai = {}) {
  return ai?.provider === 'omniroute' ? callOmniRoute(prompt, ai) : callOpenRouter(prompt, ai)
}

async function callOpenRouter(prompt, ai = {}) {
  const requested = ai.model || DEFAULT_MODEL
  const candidates = [requested]
  if (requested !== 'openrouter/free') candidates.push('openrouter/free')
  let lastError = null
  for (const model of candidates) {
    try {
      return await callOpenRouterOnce(prompt, model)
    } catch (e) {
      lastError = e
      if (!/OpenRouter HTTP (429|5\d\d)|fetch failed|timeout/i.test(e.message || '')) break
    }
  }
  throw lastError
}

async function callOpenRouterOnce(prompt, model) {
  const apiKey = loadSecret()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured on backend')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://codeframe-dp.web.app',
        'X-Title': 'COF Codeframe Studio',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      throw new Error(`OpenRouter HTTP ${r.status}: ${body.slice(0, 300)}`)
    }
    const data = await r.json()
    const out = data?.choices?.[0]?.message?.content
    if (!out) throw new Error('OpenRouter returned no content')
    return out
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('OpenRouter timeout')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function compact(value) { return JSON.stringify(value).slice(0, 180000) }
function promptHeader(schema, input) {
  return `Return ONLY valid compact JSON. No markdown, no explanation.\nSchema: ${schema}\nInput JSON:\n${compact(input)}`
}

function buildGroupPrompt(body) {
  return promptHeader('{"nets":[{"name":"net name","codeIndexes":[0,1]}]} codeIndexes are zero-based indexes of input codes; every input index appears exactly once', { codes: body.codes || [] })
}
function normalizeGroup(parsed, count) {
  const seen = new Set(); const nets = []
  for (const n of parsed?.nets || []) {
    const idxs = (n.codeIndexes || []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < count && !seen.has(i))
    idxs.forEach((i) => seen.add(i))
    if (idxs.length) nets.push({ name: String(n.name || 'กลุ่ม').trim(), codeIndexes: idxs })
  }
  const left = []
  for (let i = 0; i < count; i++) if (!seen.has(i)) left.push(i)
  if (left.length) nets.push({ name: 'อื่น ๆ', codeIndexes: left })
  return { nets }
}
async function handleGroup(body) {
  if (!Array.isArray(body.codes) || !body.codes.length) throw new Error('ไม่มีรหัสให้จัดกลุ่ม')
  return normalizeGroup(extractJson(await callAi(buildGroupPrompt(body), body.ai || {})), body.codes.length)
}

function buildCodePrompt(body) {
  return promptHeader('{"codes":[{"label":"code label","net":"net name"}],"assign":[[0,1],[]]} assign length equals verbatims length; split compound answers into all applicable codes', { verbatims: body.verbatims || [] })
}
function normalizeCoding(parsed, count) {
  const codes = (parsed?.codes || []).map((c) => ({ label: String(c.label || c.text || '').trim(), net: String(c.net || c.netName || 'อื่น ๆ').trim() || 'อื่น ๆ' })).filter((c) => c.label)
  const assign = []
  for (let i = 0; i < count; i++) {
    const entry = parsed?.assign?.[i]
    const idxs = (Array.isArray(entry) ? entry : entry == null ? [] : [entry]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < codes.length)
    assign.push([...new Set(idxs)])
  }
  return { codes, assign }
}
async function handleCode(body) {
  if (!Array.isArray(body.verbatims) || !body.verbatims.length) throw new Error('ไม่มีคำตอบให้โค้ดดิ้ง')
  return normalizeCoding(extractJson(await callAi(buildCodePrompt(body), body.ai || {})), body.verbatims.length)
}
async function handleReview(body) { return handleCode(body) }

function buildSpellPrompt(body) {
  return promptHeader(
    '{"fixes":[{"i":0,"fixed":"full corrected text","reason":"short Thai note"}],"flags":[{"i":3,"reason":"short Thai note"}]} You are a meticulous Thai proofreader for market-research verbatims (open-ended survey answers). Task 1 "fixes": for each item fix ONLY spelling mistakes, wrong tone marks/vowels (e.g. รุ้สึก -> รู้สึก), accidental duplicated words and obvious typos. Do NOT rephrase, summarise, translate, change meaning, change slang/brand names, or add/remove content. Keep intentional emphasis as typed (repeated letters like มากก/ดีมากกก, ๆ, 555, emoji). Keep the original punctuation, slashes (/), dashes, line breaks and spacing style. "fixed" must be the whole corrected text. Include ONLY items that actually need a change. Task 2 "flags": list items a human coder must review because the answer has no usable meaning: random keyboard mashing or gibberish (e.g. "asdfgh", "ฟหกดฟหก"), unreadable broken text, a sentence that cannot be understood, or (when "question" is given) an answer clearly unrelated to the question. Do NOT flag short but meaningful answers (e.g. "ไม่มี", "ไม่ทราบ", "ราคาถูก", "อร่อย", a brand name), slang, or answers with only spelling mistakes. A flagged item must NOT appear in fixes. Items that are fine go in neither list. reason = short Thai explanation (e.g. "พิมพ์มั่ว อ่านไม่ออก", "ไม่ได้ใจความ", "ตอบไม่ตรงคำถาม").',
    { question: String(body.question || '').slice(0, 500), items: body.items || [] },
  )
}
async function handleSpellcheck(body) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error('ไม่มีข้อความให้ตรวจ')
  const parsed = extractJson(await callAi(buildSpellPrompt(body), body.ai || {}))
  const valid = new Set(body.items.map((it) => Number(it.i)))
  const flags = (parsed.flags || []).filter((f) => valid.has(Number(f.i))).map((f) => ({ i: Number(f.i), reason: String(f.reason || '').trim().slice(0, 80) }))
  const flagged = new Set(flags.map((f) => f.i))
  return {
    fixes: (parsed.fixes || []).filter((f) => valid.has(Number(f.i)) && !flagged.has(Number(f.i)) && String(f.fixed || '').trim()).map((f) => ({ i: Number(f.i), fixed: String(f.fixed).trim(), reason: String(f.reason || '').trim() })),
    flags,
  }
}

function buildAssignPrompt(body) {
  return promptHeader('{"assign":[0,-1,2]} assign length equals verbatims length; values are code index or -1', { codes: body.codes || [], verbatims: body.verbatims || [] })
}
async function handleAssign(body) {
  if (!Array.isArray(body.codes) || !Array.isArray(body.verbatims) || !body.verbatims.length) throw new Error('ต้องมีทั้งรหัสและคำตอบ')
  const parsed = extractJson(await callAi(buildAssignPrompt(body), body.ai || {}))
  const raw = Array.isArray(parsed.assign) ? parsed.assign : []
  return { assign: Array.from({ length: body.verbatims.length }, (_, i) => {
    const n = Number(raw[i]); return Number.isInteger(n) && n >= 0 && n < body.codes.length ? n : -1
  }) }
}

function buildGroupCePrompt(body) {
  return promptHeader(
    '{"assign":[{"existing":0},{"neo":"new code label"},{"neo":"another new code label"}]} You are doing professional Thai market-research Codeframe grouping. assign length MUST equal verbatims length. NEVER output null and NEVER omit an item. Prefer existing codes whenever the answer is the same person/brand/concept, including nickname, first name, surname, typo, honorific, partial mention, or phonetic spelling. Non-answer codes such as ไม่ทราบ, ไม่รู้, จำไม่ได้, ไม่ระบุ, นึกไม่ออก, dont know, unknown are allowed ONLY when the verbatim itself is a non-answer (e.g. "ไม่ทราบ" -> existing ไม่ทราบ/จำไม่ได้). Do NOT assign substantive answers (names/brands/reasons) to non-answer codes; create/use a real semantic code instead. Example: if existing code is "ปอนด์", then "ปอนด์ ณธาวิจย์", "ณธาวิจย์", "บอนด์", "บอน", "คุณบอนด์", "บอนด์ ณธาวิจญ์", "ปังปอนด์" should all use {"existing": index_of_ปอนด์}; do NOT create separate codes. Example: if existing code is "กอล์ฟ", then "กอล์ฟ ณคุณดี" should use existing กอล์ฟ. Create {"neo":"concise Thai code label"} only when no existing code is semantically suitable. Cluster similar verbatims into the same neo label; make concise Thai code labels.',
    { codes: body.codes || [], verbatims: body.verbatims || [] },
  )
}
function simplifyThaiLabel(text) {
  return String(text || '')
    .trim()
    .replace(/^(คุณ|นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ดร\.?|ครู|อาจารย์)\s*/i, '')
    .replace(/[()[\]{}"'“”‘’.,;:!?/\\|_+=*#@~`<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstMeaningfulToken(text) {
  const cleaned = simplifyThaiLabel(text)
  const parts = cleaned.split(' ').filter(Boolean)
  if (!parts.length) return 'อื่น ๆ'
  // งาน CE other ที่เป็นชื่อคน/แบรนด์มักพิมพ์ “ชื่อ + นามสกุล/รายละเอียด”
  // ใช้ token แรกเป็น label เพื่อรวม “ปอนด์ ณธาวิจย์” กับ “ปอนด์ ...”
  return parts[0]
}

function normalizeClusterKey(text) {
  return firstMeaningfulToken(text)
    .toLowerCase()
    .replace(/[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/g, '') // ตัดวรรณยุกต์/สระลอย/การันต์บางส่วน เพื่อลด typo
    .replace(/[^a-z0-9ก-๙]/g, '')
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}

function looseThaiKey(key) {
  // บ/ป typo is common in Thai name spellings, e.g. บอนด์ vs ปอนด์.
  return key.replace(/^บ/, 'ป').replace(/^ป/, 'ป')
}

function closeEnoughKey(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length >= 3 && longer.startsWith(shorter) && longer.length - shorter.length <= 2) return true
  if (shorter.length >= 3 && longer.includes(shorter)) return true
  const la = looseThaiKey(a)
  const lb = looseThaiKey(b)
  if (la === lb) return true
  const [ls, ll] = la.length <= lb.length ? [la, lb] : [lb, la]
  if (ls.length >= 3 && (ll.startsWith(ls) || ll.includes(ls)) && ll.length - ls.length <= 3) return true
  return Math.min(a.length, b.length) >= 4 && Math.abs(a.length - b.length) <= 2 && levenshtein(la, lb) <= 1
}

function tokensForCluster(text) {
  return simplifyThaiLabel(text).split(' ').map((t) => t.trim()).filter((t) => normalizeClusterKey(t).length >= 2)
}

function isNonAnswerText(value) {
  const raw = String(value || '').toLowerCase().replace(/[^a-z0-9ก-๙]/g, '')
  const loose = normalizeClusterKey(value)
  return /(ไม่ทราบ|ไม่รู้|จำไม่ได้|จำไมได้|จําไม่ได้|จำไมได|จําไมได|นึกไม่ออก|ไม่แน่ใจ|ไม่ระบุ|ไม่ได้ระบุ|dontknow|donotknow|dk|unknown|notremember|notstated|notspecified)/i.test(raw)
    || /(ไมทราบ|ไมรู|จำไมได|จําไมได|นกไมออก|ไมแนใจ|ไมระบ|ไมไดระบ|dontknow|donotknow|dk|unknown|notremember|notstated|notspecified)/i.test(loose)
}

function fallbackGroupCEAssign(verbatims, codes = []) {
  // Build a tiny alias graph from all answers. Multi-token answers like
  // “ปอนด์ ณธาวิจย์” connect ปอนด์ <-> ณธาวิจย์, so a later answer
  // “ณธาวิจย์” maps back to ปอนด์ instead of creating a separate code.
  const parent = new Map()
  const labelByKey = new Map()
  const scoreByKey = new Map()
  const existingByKey = new Map()
  const existingMetaByKey = new Map()
  const nonAnswerExisting = []
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)))
    return parent.get(x)
  }
  const union = (a, b) => {
    const ra = find(a); const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  const touch = (label, score = 1) => {
    const key = normalizeClusterKey(label)
    if (!key) return null
    find(key)
    if (!labelByKey.has(key) || String(label).length < String(labelByKey.get(key)).length) labelByKey.set(key, label)
    scoreByKey.set(key, (scoreByKey.get(key) || 0) + score)
    return key
  }

  for (const c of codes) {
    const label = c.label || c.text || c.thai || ''
    const index = Number(c.i)
    if (isNonAnswerText(label)) nonAnswerExisting.push({ index, count: Number(c.count) || 0, label })
    const key = touch(firstMeaningfulToken(label), 100000) // prefer existing code strongly
    if (key) {
      existingByKey.set(key, index)
      existingMetaByKey.set(key, { index, label: firstMeaningfulToken(label), count: Number(c.count) || 0 })
    }
  }
  for (const v of verbatims) {
    const tokens = tokensForCluster(v.text)
    const keys = tokens.map((t) => touch(t, Number(v.count) || 1)).filter(Boolean)
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i])
  }

  const keys = [...parent.keys()]
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (closeEnoughKey(keys[i], keys[j])) union(keys[i], keys[j])
    }
  }

  const groups = new Map()
  for (const key of keys) {
    const root = find(key)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(key)
  }
  const repByRoot = new Map()
  const existingRepByRoot = new Map()
  for (const [root, groupKeys] of groups) {
    const existingKeys = groupKeys.filter((k) => existingByKey.has(k))
    const existingKey = existingKeys.sort((a, b) => {
      const ma = existingMetaByKey.get(a) || { count: 0, label: a }
      const mb = existingMetaByKey.get(b) || { count: 0, label: b }
      // Prefer the already stronger/main code: larger frequency first, then shorter label.
      return (mb.count || 0) - (ma.count || 0) || String(ma.label || a).length - String(mb.label || b).length
    })[0]
    if (existingKey) existingRepByRoot.set(root, existingByKey.get(existingKey))
    const best = [...groupKeys].sort((a, b) => (scoreByKey.get(b) || 0) - (scoreByKey.get(a) || 0) || String(labelByKey.get(a) || a).length - String(labelByKey.get(b) || b).length)[0]
    repByRoot.set(root, labelByKey.get(existingKey || best) || existingKey || best || 'อื่น ๆ')
  }

  const bestNonAnswer = nonAnswerExisting
    .filter((x) => Number.isInteger(x.index))
    .sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.label).length - String(b.label).length)[0]

  return verbatims.map((v) => {
    if (isNonAnswerText(v.text) && bestNonAnswer) return { existing: bestNonAnswer.index }
    const tokens = tokensForCluster(v.text)
    const key = tokens.map((t) => normalizeClusterKey(t)).find((k) => parent.has(k)) || touch(firstMeaningfulToken(v.text))
    const root = find(key)
    if (existingRepByRoot.has(root)) {
      const idx = existingRepByRoot.get(root)
      const code = codes.find((c) => Number(c.i) === idx)
      if (!code || !isNonAnswerText(code.label || code.text || code.thai || '') || isNonAnswerText(v.text)) return { existing: idx }
    }
    return { neo: repByRoot.get(root) || firstMeaningfulToken(v.text) || 'อื่น ๆ' }
  })
}

async function handleGroupCE(body) {
  if (!Array.isArray(body.codes) || !Array.isArray(body.verbatims) || !body.verbatims.length) throw new Error('ต้องมีรหัสและคำตอบ')
  let parsed
  try {
    parsed = extractJson(await callAi(buildGroupCePrompt(body), body.ai || {}))
  } catch (e) {
    // Group CE ต้องไม่ล้มแล้วปล่อยงานค้าง: ถ้า AI/Provider ล่ม ให้ cluster แบบ rule/fuzzy แล้วสร้าง code ให้ครบทุก verbatim
    return { assign: fallbackGroupCEAssign(body.verbatims, body.codes), fallback: true, reason: e.message || String(e) }
  }
  const raw = Array.isArray(parsed.assign) ? parsed.assign : []
  return { assign: Array.from({ length: body.verbatims.length }, (_, i) => {
    const v = raw[i]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < body.codes.length) return { existing: v }
    if (typeof v === 'string' && v.trim()) return { neo: firstMeaningfulToken(v) }
    if (v && typeof v === 'object') {
      const existing = Number(v.existing)
      if (Number.isInteger(existing) && existing >= 0 && existing < body.codes.length) return { existing }
      if (typeof v.neo === 'string' && v.neo.trim()) return { neo: firstMeaningfulToken(v.neo) }
    }
    return { neo: fallbackGroupCEAssign([body.verbatims[i]])[0].neo }
  }) }
}

async function listOpenRouterModels() {
  const r = await fetch('https://openrouter.ai/api/v1/models')
  if (!r.ok) throw new Error(`OpenRouter HTTP ${r.status}`)
  const data = await r.json()
  const isFree = (m) => {
    if (/:free$/i.test(m.id || '')) return true
    const p = m.pricing || {}; const zero = (v) => v == null || Number(v) === 0
    return zero(p.prompt) && zero(p.completion)
  }
  return { models: (data?.data || []).map((m) => ({ id: m.id, name: m.name || m.id, free: isFree(m) })).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id)) }
}

const errStatus = (e) => (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 ? e.status : 500)

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {}, req)
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, provider: 'openrouter', model: DEFAULT_MODEL, keyConfigured: !!loadSecret(), omnirouteConfigured: !!loadEnvValue('OMNIROUTE_API_KEY'), authRequired: REQUIRE_AUTH }, req)
  // Confirm ของ CI ใช้ review token แทนการล็อกอิน — endpoint อื่นทั้งหมดต้องเป็นผู้ใช้ที่อนุมัติแล้ว
  if (url.pathname !== '/api/send-ci-confirm-email') {
    try {
      await requireApprovedUser(req)
    } catch (e) {
      const status = errStatus(e)
      if (status >= 500) console.error(e)
      return send(res, status === 500 ? 503 : status, { error: e.message || String(e) }, req)
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/omniroute-models') {
    try { return send(res, 200, await listOmniRouteModels(), req) } catch (e) { return send(res, 500, { error: e.message || String(e) }, req) }
  }
  if (req.method === 'GET' && url.pathname === '/api/openrouter-models') {
    try { return send(res, 200, await listOpenRouterModels(), req) } catch (e) { return send(res, 500, { error: e.message || String(e) }, req) }
  }
  if (req.method === 'POST' && url.pathname === '/api/parse-sav') {
    try {
      const buf = await readRawBody(req)
      if (!buf?.length) return send(res, 400, { error: 'ไม่มีไฟล์ .sav' }, req)
      return send(res, 200, await parseSavBuffer(buf), req)
    } catch (e) {
      console.error(e)
      return send(res, errStatus(e), { error: `อ่านไฟล์ .sav ไม่สำเร็จ: ${e?.message || String(e)}` }, req)
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/send-ci-review-email') {
    try {
      const body = await readBody(req)
      return send(res, 200, await sendCiReviewEmail(body), req)
    } catch (e) {
      console.error(e)
      return send(res, errStatus(e), { error: e.message || String(e) }, req)
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/send-ci-confirm-email') {
    try {
      const body = await readBody(req)
      const link = await loadActiveReviewLink(body.reviewUrl)
      // ส่งได้เฉพาะ Edit email ที่บันทึกไว้ในลิงก์ — กันการใช้ endpoint นี้ส่งเมลหาใครก็ได้
      if (!link.editEmail || String(body.editEmail || '').trim().toLowerCase() !== link.editEmail.trim().toLowerCase()) {
        throw new HttpError(403, 'Send from Email ไม่ตรงกับที่บันทึกไว้ในลิงก์ Review')
      }
      checkConfirmRate(link.token)
      return send(res, 200, await sendCiConfirmEmail({ ...body, editEmail: link.editEmail }), req)
    } catch (e) {
      console.error(e)
      return send(res, errStatus(e), { error: e.message || String(e) }, req)
    }
  }
  if (req.method !== 'POST' || !ROUTES.has(url.pathname)) return send(res, 404, { error: 'Not found' }, req)
  try {
    const body = await readBody(req)
    // API key is intentionally ignored from request body. Backend secret/env is the only source.
    if (body.ai) delete body.ai.apiKey
    const result = await ROUTES.get(url.pathname)(body)
    return send(res, 200, result, req)
  } catch (e) {
    console.error(e)
    return send(res, errStatus(e), { error: e.message || String(e) }, req)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OpenRouter AI runner listening on http://127.0.0.1:${PORT} (auth ${REQUIRE_AUTH ? 'required' : 'DISABLED'})`)
})
