/* eslint-disable no-unused-vars, react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Upload, CheckCircle2, Table2, RefreshCcw, Plus,
  Layers, ListTree, MessageSquareText, ChevronRight, Download,
  Clock3, StickyNote, Pencil, Trash2, X, Save, PlusCircle, Activity, HelpCircle,
  Link2, Copy, Mail,
} from 'lucide-react'
import { Database, Lock } from 'lucide-react'
import { uid, useStore } from '../store.jsx'
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { parseRawdataFile, exportQuestionCodeList } from '../lib/excel.js'
import { uniqueAnswers } from '../lib/answers.js'
import { parseSavCodebook, remapCodebookByPosition } from '../lib/spss.js'
import { BOX_META, newRowCount, freqByValue, isOtherLabel } from '../lib/boxes.js'
import { Button, Badge, NewRowsBadge, Toast } from '../components/ui.jsx'
import { authHeaders } from '../lib/apiAuth.js'

const nowMs = () => Date.now()

const AI_API_BASE = (import.meta.env.VITE_AI_API_BASE || '').replace(/\/$/, '')
const apiUrl = (path) => `${AI_API_BASE}${path}`

// คลาสสีแบบ static (Tailwind ต้องเห็น string เต็ม — interpolate ไม่ได้)
const BOX_CLS = {
  ce: { num: 'bg-sky-100 text-sky-600', icon: 'bg-sky-50 text-sky-500' },
  oe: { num: 'bg-violet-100 text-violet-600', icon: 'bg-violet-50 text-violet-500' },
  verbatim: { num: 'bg-amber-100 text-violet-500', icon: 'bg-amber-50 text-violet-1000' },
}

const KEY_HEADER_CANDIDATES = [
  'sbjnum', 'subjnum', 'sbjno', 'subjno', 'sbj', 'subjectid', 'subject_id',
  'respondentid', 'respondent_id', 'responseid', 'response_id', 'recordid',
  'record_id', 'sampleid', 'sample_id', 'userid', 'user_id', 'id', 'key',
]

const normalizeHeader = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const rowSignature = (row) => row.map((v) => String(v ?? '').trim()).join('\u001f')


function MailReviewLogo({ size = 'md', spinning = false }) {
  const box = size === 'lg' ? 'h-16 w-16 rounded-[1.35rem] p-1.5' : size === 'sm' ? 'h-7 w-7 rounded-lg p-0.5' : 'h-10 w-10 rounded-xl p-1'
  return (
    <span className={`${box} inline-flex shrink-0 items-center justify-center bg-white shadow-md shadow-indigo-200 ring-1 ring-indigo-200/80 ${spinning ? 'animate-pulse' : ''}`}>
      <img src="/icons/email-opened-svgrepo-com.svg" alt="Email invite" className="h-full w-full object-contain" />
    </span>
  )
}

function detectKeyColumn(rawdata) {
  const headers = rawdata?.headers ?? []
  const normalized = headers.map(normalizeHeader)
  let index = normalized.findIndex((h) => KEY_HEADER_CANDIDATES.includes(h))
  if (index < 0) index = normalized.findIndex((h) => KEY_HEADER_CANDIDATES.some((k) => h.includes(k)))
  if (index < 0) return null
  return { index, label: headers[index], norm: normalized[index] }
}

function keyedRawdataAudit(oldRawdata, newRawdata) {
  const oldKey = detectKeyColumn(oldRawdata)
  const newKey = detectKeyColumn(newRawdata)
  if (!oldKey || !newKey || oldKey.norm !== newKey.norm) {
    return { mode: 'no-key', oldKey: oldKey?.label, newKey: newKey?.label }
  }
  const makeMap = (rawdata, col) => {
    const map = new Map()
    let blank = 0
    let duplicate = 0
    rawdata.rows.forEach((row, index) => {
      const key = String(row[col] ?? '').trim()
      if (!key) { blank += 1; return }
      if (map.has(key)) duplicate += 1
      map.set(key, { row, index })
    })
    return { map, blank, duplicate }
  }
  const oldMap = makeMap(oldRawdata, oldKey.index)
  const newMap = makeMap(newRawdata, newKey.index)
  let added = 0
  let removed = 0
  let moved = 0
  let changed = 0
  for (const [key, n] of newMap.map) {
    const o = oldMap.map.get(key)
    if (!o) { added += 1; continue }
    if (o.index !== n.index) moved += 1
    if (rowSignature(o.row) !== rowSignature(n.row)) changed += 1
  }
  for (const key of oldMap.map.keys()) if (!newMap.map.has(key)) removed += 1
  return {
    mode: 'key',
    keyLabel: newKey.label,
    added,
    removed,
    moved,
    changed,
    duplicate: oldMap.duplicate + newMap.duplicate,
    blank: oldMap.blank + newMap.blank,
  }
}

function keyAuditMessage(audit) {
  if (!audit) return ''
  if (audit.mode === 'no-key') {
    return ` · ยังไม่เจอ Key เดียวกัน (${audit.oldKey || 'เดิมไม่มี'} → ${audit.newKey || 'ใหม่ไม่มี'}) เลย sync จากหัวคอลัมน์+คำตอบ`
  }
  return (
    ` · ตรวจด้วย ${audit.keyLabel}: เพิ่ม ${audit.added} ชุด` +
    ` · หาย ${audit.removed} ชุด · ย้ายแถว ${audit.moved} ชุด · ข้อมูลเปลี่ยน ${audit.changed} ชุด` +
    (audit.duplicate ? ` · พบ Key ซ้ำ/ชน ${audit.duplicate} แถว` : '') +
    (audit.blank ? ` · Key ว่าง ${audit.blank} แถว` : '')
  )
}

const STATUS_VALUE_KEYWORDS = [
  'approved', 'requiresapproval', 'requireapproval', 'requires', 'approval', 'pending', 'rejected', 'reject',
  'complete', 'completed', 'incomplete', 'screenout', 'terminate', 'terminated', 'quota',
  'qualified', 'disqualified', 'valid', 'invalid', 'checked', 'checking', 'pass', 'fail',
]

function findStatusColumn(rawdata) {
  const headers = rawdata?.headers ?? []
  const rows = rawdata?.rows ?? []
  const norm = (v) => normalizeHeader(String(v ?? '').replace(/^\ufeff/, ''))
  const candidates = headers.map((h, index) => ({ index, label: String(h ?? '').trim(), norm: norm(h) }))
  let found = candidates.find((c) => c.norm === 'status')
  if (!found) found = candidates.find((c) => c.norm.endsWith('status') || c.norm.includes('status'))
  if (found) return found

  // fallback: บางไฟล์ถูก parse เป็น questions แล้ว label/index ยังอยู่ แม้ headers จะเพี้ยน
  const q = (rawdata?.questions ?? []).find((x) => {
    const n = norm(x.label)
    return n === 'status' || n.endsWith('status') || n.includes('status')
  })
  if (q) return { index: q.index, label: q.label, norm: norm(q.label) }

  // fallback ลึก: ถ้าหัวคอลัมน์ไม่ได้ชื่อ Status แต่ค่าข้างในเป็นสถานะ เช่น Approved / Requires Approval
  const maxCols = Math.max(headers.length, ...rows.slice(0, 500).map((r) => r.length))
  let best = null
  for (let index = 0; index < maxCols; index += 1) {
    let nonBlank = 0
    let hits = 0
    const distinct = new Set()
    for (const row of rows.slice(0, 1000)) {
      const value = String(row[index] ?? '').trim()
      if (!value) continue
      nonBlank += 1
      distinct.add(value.toLowerCase())
      const n = norm(value)
      if (STATUS_VALUE_KEYWORDS.some((kw) => n === kw || n.includes(kw))) hits += 1
    }
    if (!nonBlank) continue
    const ratio = hits / nonBlank
    // สถานะควรมีค่าซ้ำไม่กี่แบบ และ match คำสถานะพอสมควร
    // ผ่อน threshold สำหรับไฟล์ที่หัว Status เพี้ยน/มีช่องว่างแปลก ๆ
    const distinctPenalty = Math.max(0, distinct.size - 8) * 0.08
    const score = hits * Math.max(ratio, 0.15) - distinctPenalty
    const looksLikeStatus = hits >= 1 && ratio >= 0.12 && distinct.size <= 30
    if (looksLikeStatus && (!best || score > best.score)) {
      best = { index, label: headers[index] || `คอลัมน์ ${index + 1}`, norm: 'statusvalues', inferred: true, score }
    }
  }
  return best
}

function summarizeStatus(rawdata) {
  const statusCol = findStatusColumn(rawdata)
  if (!statusCol || statusCol.index == null) {
    return { found: false, label: '', total: rawdata?.rows?.length ?? 0, items: [], debugHeaders: rawdata?.headers ?? [] }
  }
  const counts = new Map()
  for (const row of rawdata.rows ?? []) {
    const text = String(row[statusCol.index] ?? '').trim() || '(ว่าง)'
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  const items = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'))
  return { found: true, label: statusCol.label || 'Status', total: rawdata.rows?.length ?? 0, items, debugHeaders: rawdata?.headers ?? [] }
}

export default function ProjectHub() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { state, setRawdata, appendRawdata, loadRawdata, restoreRawdataUndo, updateCodeframe, addCodeframe, setCodebook, updateProject } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const raw = project?.rawMeta
  const codeframes = state.codeframes.filter((c) => c.projectId === projectId)

  const fileRef = useRef(null)
  const appendRef = useRef(null)
  const savRef = useRef(null)
  const restoreRef = useRef(null)
  const [busy, setBusy] = useState('') // '' | 'upload' | 'append' | 'sav'
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [wiggle, setWiggle] = useState(null) // key ของกล่อง Coming Soon ที่กำลังเล่น animation
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [statusSummary, setStatusSummary] = useState({ loading: false, found: false, label: '', total: 0, items: [] })
  const [reviewEmailModal, setReviewEmailModal] = useState(null) // codeframe ที่กำลัง Genlink+ส่งเมล
  const [reviewEmailDraft, setReviewEmailDraft] = useState({ ciEmail: '', ccEmail: '', editEmail: '', message: 'รบกวนตรวจ Codeframe และใส่ Comment ที่ Code ที่ต้องแก้ค่ะ' })
  const [reviewEmailSuccess, setReviewEmailSuccess] = useState(null) // msgbox ส่งเมลสำเร็จ
  const [reviewEmailSending, setReviewEmailSending] = useState(null) // overlay กำลังส่งเมล
  const [restorePreview, setRestorePreview] = useState(null) // { data, fileName, summary }
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityFilter, setActivityFilter] = useState('all')
  const [reviewAuditRows, setReviewAuditRows] = useState([])
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpStep, setHelpStep] = useState(0)
  const wiggleTimer = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (!raw) {
      setStatusSummary({ loading: false, found: false, label: '', total: 0, items: [] })
      return () => { cancelled = true }
    }
    setStatusSummary((prev) => ({ ...prev, loading: true }))
    loadRawdata(projectId)
      .then((rd) => {
        if (!cancelled) setStatusSummary({ ...summarizeStatus(rd), loading: false })
      })
      .catch(() => {
        if (!cancelled) setStatusSummary({ loading: false, found: false, label: '', total: raw.rowCount ?? 0, items: [] })
      })
    return () => { cancelled = true }
  }, [projectId, raw?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId) return undefined
    const q = query(collection(db, 'review_audit'), where('projectId', '==', projectId))
    return onSnapshot(q, (snap) => {
      setReviewAuditRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    }, (err) => {
      console.warn('review audit activity listener failed', err)
      setReviewAuditRows([])
    })
  }, [projectId])

  useEffect(() => {
    try {
      if (window.localStorage.getItem('cof-project-tour-autostart') === '1') {
        window.localStorage.removeItem('cof-project-tour-autostart')
        setHelpStep(0)
        setHelpOpen(true)
      }
    } catch { /* ignore */ }
  }, [])

  // คลิกกล่อง "Coming Soon" → เล่น animation สั่น + เด้ง (ยังเข้าไม่ได้)
  const pokeComingSoon = (key, label) => {
    clearTimeout(wiggleTimer.current)
    setWiggle(key)
    wiggleTimer.current = setTimeout(() => setWiggle(null), 600)
    setToast({ type: 'info', title: `${label} · เร็วๆ นี้`, message: 'ฟีเจอร์นี้กำลังพัฒนา จะเปิดให้ใช้เร็วๆ นี้ 🚧', duration: 2500 })
  }

  const exportQuestions = async () => {
    if (!raw || !project?.codebook) {
      setToast({ type: 'warning', title: 'ยัง Export โจทย์ไม่ได้', message: 'ต้องมี Rawdata และแนบ Codebook (.sav) ก่อน', duration: 3500 })
      return
    }
    setBusy('export')
    try {
      const rawdata = await loadRawdata(projectId)
      const cbByLabel = project.codebook?.byVar ?? {}
      const rows = []
      rawdata.questions.forEach((question, questionIndex) => {
        const cb = cbByLabel[question.label]
        const freqMap = freqByValue(rawdata, question)
        const cols = question.columns ?? [question.index]
        const baseTotal = rawdata.rows.filter((row) => cols.some((c) => String(row?.[c] ?? '').trim() !== '')).length
        const variable = cb?.code || question.label
        rows.push({
          kind: 'question',
          no: questionIndex + 1,
          variable,
          text: cb?.label || '— ไม่มี variable label ใน .sav —',
          frequency: baseTotal,
          baseTotal,
        })
        if (cb?.values?.length) {
          cb.values.forEach((v) => {
            const value = String(v.value)
            rows.push({
              kind: 'code',
              no: '',
              variable: '',
              text: `${value} ${v.label}`,
              frequency: freqMap.get(value) ?? 0,
            })
          })
        }
      })
      const safeName = `${project.name || 'COF'}_${rawdata.questions.length}_questions_codes_simple.xlsx`.replace(/[\\/:*?"<>|]/g, '_')
      await exportQuestionCodeList(rows, safeName)
      setToast({ type: 'success', title: 'Export โจทย์แล้ว', message: safeName, duration: 3000 })
    } catch (err) {
      setToast({ type: 'warning', title: 'Export โจทย์ไม่สำเร็จ', message: err.message, duration: 6000 })
    } finally {
      setBusy('')
    }
  }

  const buildReviewSnapshot = async (cf) => {
    try {
      const rawdata = await loadRawdata(projectId)
      const freqBySheet = {}
      const statusBySheet = {}
      const questionsBySheet = {}
      const cbBy = project?.codebook?.byVar
      for (const sh of cf.sheets ?? []) {
        const questionRows = (sh.questionIds ?? [])
          .map((qid) => rawdata.questions.find((q) => q.id === qid))
          .filter(Boolean)
          .filter((q) => {
            const name = String(q.label || '').toLowerCase()
            const cb = cbBy?.[q.label]
            // Do not treat open-text / other-specify columns as worksheet question rows.
            // These are support columns for coding, not the Edit-page Codeframe question header.
            if (/(?:^|[_-])(oth\d*|other|spec\d*|specify|text|open)(?:$|[_-]|\d)/i.test(name)) return false
            if (/(?:^|[_-])oth\d*/i.test(name) || name.includes('_oth')) return false
            return !!(cb?.values?.length)
          })
          .map((q) => ({
            id: q.id,
            column: q.label,
            code: cbBy?.[q.label]?.code || q.label,
            label: cbBy?.[q.label]?.label || q.text || q.question || q.label || '',
          }))
        const seenQuestionLabels = new Set()
        questionsBySheet[sh.id] = questionRows.filter((q) => {
          const key = `${String(q.code || q.column || '').trim()}::${String(q.label || '').trim()}`
          if (seenQuestionLabels.has(key)) return false
          seenQuestionLabels.add(key)
          return true
        })
        const answers = uniqueAnswers(rawdata, sh.questionIds ?? [])
        const byCode = {}
        for (const answer of answers) {
          for (const codeId of sh.assignments?.[answer.key] ?? []) {
            byCode[codeId] = (byCode[codeId] ?? 0) + answer.count
          }
        }
        freqBySheet[sh.id] = byCode

        const otherIds = new Set(
          (sh.nets ?? []).flatMap((n) => n.codes ?? []).filter((c) => isOtherLabel(c.thai)).map((c) => c.id),
        )
        if (!otherIds.size) { statusBySheet[sh.id] = 'none'; continue }
        const openIds = (sh.questionIds ?? []).filter((qid) => {
          const q = rawdata.questions.find((x) => x.id === qid)
          return q && !(cbBy?.[q.label]?.values?.length)
        })
        const hasText = openIds.length > 0
        const otherFreq = answers
          .filter((a) => (sh.assignments?.[a.key] ?? []).some((id) => otherIds.has(id)))
          .reduce((sum, a) => sum + a.count, 0)
        const ungrouped = uniqueAnswers(rawdata, openIds)
          .filter((a) => !(sh.assignments?.[a.key] ?? []).length).length
        if (otherFreq === 0) statusBySheet[sh.id] = hasText ? 'gray' : 'maroon'
        else if (!hasText) statusBySheet[sh.id] = 'red'
        else if (ungrouped > 0) statusBySheet[sh.id] = 'orange'
        else statusBySheet[sh.id] = 'green'
      }
      return { reviewFreqByCode: freqBySheet, reviewSheetStatusMap: statusBySheet, reviewSheetQuestions: questionsBySheet }
    } catch {
      return { reviewFreqByCode: cf.reviewFreqByCode ?? {}, reviewSheetStatusMap: cf.reviewSheetStatusMap ?? {}, reviewSheetQuestions: cf.reviewSheetQuestions ?? {} }
    }
  }

  const latestReviewLink = (cf) => cf.reviewLinks?.filter((l) => l.status !== 'revoked' && l.url).slice(-1)[0] || null

  const showReviewEmailSuccess = ({ sent, url, reused }) => {
    const sentAt = nowMs()
    setReviewEmailSuccess({
      to: sent.to,
      cc: sent.cc || [],
      replyTo: sent.replyTo,
      from: sent.from,
      url,
      reused,
      sentAt,
    })
  }

  const sendCiReviewEmail = async ({ cf, url, ciEmail, ccEmail, editEmail, message }) => {
    const startedAt = nowMs()
    setReviewEmailSending({
      to: ciEmail,
      replyTo: editEmail,
      cc: ccEmail || '',
      jobName: project.name || projectId,
      codeframeName: cf.name || 'Codeframe Review',
      startedAt,
    })
    try {
      const res = await fetch(apiUrl('/api/send-ci-review-email'), {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ciEmail,
          editEmail,
          ccEmail,
          message,
          reviewUrl: url,
          jobName: project.name || projectId,
          codeframeName: cf.name || 'Codeframe Review',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `ส่งอีเมลไม่สำเร็จ HTTP ${res.status}`)
      return data
    } finally {
      setReviewEmailSending(null)
    }
  }

  const genReviewLink = async (cf, emailOptions = null) => {
    setBusy(`review-${cf.id}`)
    try {
      const existing = emailOptions?.ciEmail ? latestReviewLink(cf) : null
      if (existing?.url) {
        await navigator.clipboard?.writeText(existing.url).catch(() => {})
        try {
          const sent = await sendCiReviewEmail({ cf, url: existing.url, ...emailOptions })
          if (existing.token) {
            const reviewUpdatedAt = nowMs()
            const { reviewFreqByCode, reviewSheetStatusMap, reviewSheetQuestions } = await buildReviewSnapshot(cf)
            await setDoc(doc(db, 'codeframes', cf.id), { reviewFreqByCode, reviewSheetStatusMap, reviewSheetQuestions, reviewUpdatedAt }, { merge: true })
            await setDoc(doc(db, 'review_links', existing.token), {
              reviewSheetQuestions,
              emailInvite: { ciEmail: emailOptions.ciEmail || '', ccEmail: emailOptions.ccEmail || '', editEmail: emailOptions.editEmail || '', sentAt: reviewUpdatedAt },
            }, { merge: true })
            updateCodeframe(cf.id, (cur) => ({ ...cur, reviewFreqByCode, reviewSheetStatusMap, reviewSheetQuestions, reviewUpdatedAt }))
          }
          showReviewEmailSuccess({ sent, url: existing.url, reused: true })
        } catch (mailErr) {
          setToast({ type: 'warning', title: 'ใช้ลิงก์เดิมแล้ว แต่ส่ง Email ไม่สำเร็จ', message: `${mailErr.message || mailErr} · ลิงก์ถูกคัดลอกแล้ว: ${existing.url}`, duration: 14000 })
        }
        return existing.url
      }
      const token = uid()
      const createdAt = nowMs()
      const { reviewFreqByCode, reviewSheetStatusMap, reviewSheetQuestions } = await buildReviewSnapshot(cf)
      const url = `${window.location.origin}${window.location.pathname}#/review/${token}`
      const nextLinks = [...(cf.reviewLinks ?? []), { token, url, createdAt, status: 'active' }].slice(-12)
      // Persist codeframe first, then publish the review link. This avoids a race where CI opens
      // the link while clientReviewEnabled/review data has not reached Firestore yet.
      await setDoc(doc(db, 'codeframes', cf.id), {
        id: cf.id,
        projectId: cf.projectId,
        box: cf.box ?? 'oe',
        name: cf.name,
        createdAt: cf.createdAt,
        sheetsJson: JSON.stringify(cf.sheets ?? []),
        checkpointsJson: JSON.stringify(cf.checkpoints ?? []),
        clientReviewEnabled: true,
        reviewFreqByCode,
        reviewSheetStatusMap,
        reviewSheetQuestions,
        reviewLinks: nextLinks,
        reviewProjectName: project.name || '',
        reviewUpdatedAt: createdAt,
      }, { merge: true })
      await setDoc(doc(db, 'review_links', token), {
        token,
        status: 'active',
        projectId,
        projectName: project.name || '',
        codeframeId: cf.id,
        codeframeName: cf.name || '',
        reviewSheetQuestions,
        createdAt,
        emailInvite: emailOptions ? { ciEmail: emailOptions.ciEmail || '', ccEmail: emailOptions.ccEmail || '', editEmail: emailOptions.editEmail || '', sentAt: createdAt } : null,
        permissions: { view: true, comment: true, rename: true, move: true, merge: true, showRawdata: false },
      })
      updateCodeframe(cf.id, (cur) => ({
        ...cur,
        clientReviewEnabled: true,
        reviewFreqByCode,
        reviewSheetStatusMap,
        reviewSheetQuestions,
        reviewLinks: nextLinks,
        reviewProjectName: project.name || '',
        reviewUpdatedAt: createdAt,
      }))
      await navigator.clipboard?.writeText(url).catch(() => {})
      if (emailOptions?.ciEmail) {
        try {
          const sent = await sendCiReviewEmail({ cf, url, ...emailOptions })
          showReviewEmailSuccess({ sent, url, reused: false })
        } catch (mailErr) {
          setToast({ type: 'warning', title: 'สร้างลิงก์แล้ว แต่ส่ง Email ไม่สำเร็จ', message: `${mailErr.message || mailErr} · ลิงก์ถูกคัดลอกแล้ว: ${url}`, duration: 14000 })
        }
      } else {
        setToast({ type: 'success', title: 'Genlink Codeframe แล้ว', message: `คัดลอกลิงก์ CI Review แล้ว: ${url}`, duration: 9000 })
      }
      return url
    } catch (err) {
      setToast({ type: 'warning', title: 'Genlink ไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setBusy('')
    }
  }

  const copyReviewLink = async (url) => {
    await navigator.clipboard?.writeText(url)
    setToast({ type: 'success', title: 'Copy link แล้ว', message: url, duration: 4000 })
  }

  const downloadJsonFile = (data, fileName) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const createProjectBackup = async () => {
    if (!project) return
    setBusy('backup')
    try {
      const rawdata = raw ? await loadRawdata(projectId) : null
      const backup = {
        app: 'Codeframe Studio',
        type: 'project-backup',
        version: 1,
        exportedAt: nowMs(),
        projectId,
        project: { ...project, rawdata: undefined },
        rawdata,
        codeframes: codeframes.map((cf) => ({ ...cf })),
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const safeProject = String(project.name || projectId || 'project').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
      downloadJsonFile(backup, `${safeProject}_backup_${stamp}.json`)
      setToast({ type: 'success', title: 'Backup สำเร็จ', message: `สำรอง Project + Rawdata + Codeframe ${codeframes.length} รายการแล้ว`, duration: 5000 })
    } catch (err) {
      setToast({ type: 'warning', title: 'Backup ไม่สำเร็จ', message: err.message || String(err), duration: 8000 })
    } finally {
      setBusy('')
    }
  }

  const handleRestoreBackup = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (data?.app !== 'Codeframe Studio' || data?.type !== 'project-backup' || data?.version !== 1 || !data.project || !Array.isArray(data.codeframes)) {
        throw new Error('ไฟล์นี้ไม่ใช่ Backup ของ Codeframe Studio หรือ version ไม่รองรับ')
      }
      if (data.rawdata && (!Array.isArray(data.rawdata.rows) || !Array.isArray(data.rawdata.questions))) {
        throw new Error('โครงสร้าง Rawdata ในไฟล์ Backup ไม่ถูกต้อง')
      }
      const collisions = data.codeframes.filter((backupCf) =>
        state.codeframes.some((cf) => cf.id === backupCf.id && cf.projectId !== projectId),
      ).length
      const summary = {
        projectName: data.project?.name || data.projectId || 'Project backup',
        rawRows: data.rawdata?.rows?.length ?? 0,
        rawQuestions: data.rawdata?.questions?.length ?? 0,
        codeframes: data.codeframes.length,
        collisions,
        exportedAt: data.exportedAt,
      }
      setRestorePreview({ data, fileName: file.name, summary })
    } catch (err) {
      setToast({ type: 'warning', title: 'อ่านไฟล์ Restore ไม่สำเร็จ', message: err.message || String(err), duration: 8000 })
    }
  }

  const applyRestoreBackup = async () => {
    if (!restorePreview?.data || !project) return
    const data = restorePreview.data
    setBusy('restore')
    try {
      const backupProject = data.project || {}
      const projectPatch = {
        name: backupProject.name ?? project.name,
        client: backupProject.client ?? project.client ?? '',
        programmer: backupProject.programmer ?? project.programmer ?? '',
        clientDueDate: backupProject.clientDueDate ?? project.clientDueDate ?? '',
        programmerDueDate: backupProject.programmerDueDate ?? project.programmerDueDate ?? '',
        boxes: backupProject.boxes ?? project.boxes,
        notes: Array.isArray(backupProject.notes) ? backupProject.notes : (project.notes ?? []),
        restoredAt: nowMs(),
        restoredFromBackup: restorePreview.fileName,
        // Security-sensitive fields intentionally preserved from the current project:
        // ownerUid/ownerEmail/sharedWithUids/sharedWithEmails are never restored from imported JSON.
      }
      updateProject(projectId, projectPatch)
      if (backupProject.codebook) await setCodebook(projectId, backupProject.codebook)
      if (data.rawdata) await setRawdata(projectId, { ...data.rawdata })
      let added = 0
      let updated = 0
      let reminted = 0
      for (const backupCf of data.codeframes ?? []) {
        const crossProjectCollision = state.codeframes.some((cf) => cf.id === backupCf.id && cf.projectId !== projectId)
        const nextId = crossProjectCollision ? uid() : backupCf.id
        const nextCf = {
          ...backupCf,
          id: nextId,
          projectId,
          name: crossProjectCollision ? `${backupCf.name || 'Codeframe'} (restored)` : backupCf.name,
          ...(crossProjectCollision ? { clientReviewEnabled: false, reviewLinks: [], reviewUpdatedAt: null } : {}),
        }
        const existsInCurrentProject = codeframes.some((cf) => cf.id === nextCf.id)
        if (existsInCurrentProject) { updateCodeframe(nextCf.id, () => nextCf); updated += 1 }
        else { addCodeframe(nextCf); added += 1; if (crossProjectCollision) reminted += 1 }
      }
      setRestorePreview(null)
      setToast({ type: 'success', title: 'Restore สำเร็จ', message: `กู้คืน Rawdata + Codeframe แล้ว (อัปเดต ${updated}, เพิ่ม ${added}${reminted ? `, เปลี่ยน id กันชน ${reminted}` : ''})`, duration: 7000 })
    } catch (err) {
      setToast({ type: 'warning', title: 'Restore ไม่สำเร็จ', message: err.message || String(err), duration: 9000 })
    } finally {
      setBusy('')
    }
  }

  const restoreLatestRawdataUndo = async () => {
    if (!project?.rawMeta?.undoStack?.length) {
      setToast({ type: 'info', title: 'ยังไม่มีประวัติให้กู้คืน', message: 'ระบบจะเริ่มจำรายการลบ/แก้ Verbatim ตั้งแต่เวอร์ชันนี้เป็นต้นไป', duration: 5000 })
      return
    }
    setBusy('undo')
    try {
      await restoreRawdataUndo(projectId)
    } catch (err) {
      setToast({ type: 'warning', title: 'กู้คืน Rawdata ไม่สำเร็จ', message: err.message || String(err), duration: 9000 })
    } finally {
      setBusy('')
    }
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-16 text-center text-slate-400">
        ไม่พบโปรเจกต์นี้ — <Link to="/" className="text-indigo-600 underline">กลับหน้าหลัก</Link>
      </div>
    )
  }

  // อัปโหลด/เปลี่ยนไฟล์ (แทนที่ทั้งก้อน) — latest data เป็น source of truth
  // - จับคู่ข้อเดิมกับข้อใหม่ด้วย "ชื่อหัวคอลัมน์"
  // - เก็บ Code/Codeframe เดิมไว้
  // - เก็บ assignment เดิมเฉพาะ key ที่ยังอยู่ในไฟล์ใหม่ หรือเป็น key ของ code ปลายปิดเดิม
  //   → ถ้า respondent ถูกแก้ข้อความ "อื่นๆ" ในไฟล์ใหม่ ข้อความใหม่จะกลับไปอยู่คิว "ยังไม่จัดกลุ่ม"
  const handleReplace = async (file) => {
    if (!file) return
    setError('')
    setBusy('upload')
    try {
      const rawdata = await parseRawdataFile(file)
      const oldRawdata = raw ? await loadRawdata(projectId) : null
      let sync = null
      if (raw && codeframes.length) {
        const keyAudit = oldRawdata ? keyedRawdataAudit(oldRawdata, rawdata) : null
        const oldIdToLabel = new Map(raw.questions.map((q) => [q.id, q.label]))
        const labelToNewId = new Map(rawdata.questions.map((q) => [q.label, q.id]))
        const cbBy = project.codebook?.byVar
        sync = { dropped: 0, carried: 0, pending: 0, removed: 0, keyAudit }
        codeframes.forEach((cf) => {
          updateCodeframe(cf.id, (c) => ({
            ...c,
            sheets: c.sheets.map((s) => {
              const mapped = s.questionIds
                .map((qid) => labelToNewId.get(oldIdToLabel.get(qid)))
                .filter(Boolean)
              sync.dropped += s.questionIds.length - mapped.length

              const validAnswerKeys = new Set(uniqueAnswers(rawdata, mapped).map((a) => a.key))
              const codeIds = new Set(s.nets.flatMap((n) => n.codes.map((code) => code.id)))
              const codeNoKeys = new Set(
                s.nets.flatMap((n) => n.codes.map((code) => String(code.codeNo ?? '').trim()).filter(Boolean)),
              )
              const assignments = {}
              for (const [key, ids] of Object.entries(s.assignments ?? {})) {
                const cleanIds = ids.filter((id) => codeIds.has(id))
                if (!cleanIds.length) { sync.removed += 1; continue }
                // codeNoKeys = mapping ปลายปิดจาก codebook เช่น 1,2,99 ต้องอยู่เสมอ
                // validAnswerKeys = คำตอบ/verbatim ที่ยังมีอยู่จริงใน latest rawdata
                if (codeNoKeys.has(String(key).trim()) || validAnswerKeys.has(key)) {
                  assignments[key] = cleanIds
                  sync.carried += 1
                } else {
                  sync.removed += 1
                }
              }

              const openIds = mapped.filter((qid) => {
                const q = rawdata.questions.find((x) => x.id === qid)
                return q && !(cbBy?.[q.label]?.values?.length)
              })
              sync.pending += uniqueAnswers(rawdata, openIds)
                .filter((a) => !(assignments[a.key] ?? []).length).length

              return { ...s, questionIds: mapped, assignments }
            }),
          }))
        })
      }
      await setRawdata(projectId, rawdata)
      if (sync) {
        setToast({
          type: sync.dropped ? 'warning' : 'success',
          title: `อัปเดต Rawdata ล่าสุดแล้ว (${rawdata.rows.length} แถว)`,
          message:
            `ใช้ไฟล์ใหม่แทนที่ทั้งก้อน · คง Code เดิม ${sync.carried} mapping · ` +
            `รอลง Code ${sync.pending} คำตอบ · ล้าง mapping เก่าที่ไม่อยู่ในไฟล์ใหม่ ${sync.removed}` +
            keyAuditMessage(sync.keyAudit) +
            (sync.dropped ? ` · ไฟล์ใหม่ไม่มีบางข้อที่ Codeframe เดิมใช้ ${sync.dropped} รายการ` : ''),
          duration: 9000,
        })
      }
    } catch (err) {
      setError(`อ่าน/อัปโหลดไฟล์ไม่สำเร็จ: ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  // เพิ่มก้อนข้อมูลใหม่ (ต่อแถวเข้าก้อนเดิม) — แต่ละกล่องจะขึ้น badge "แถวใหม่"
  const handleAppend = async (file) => {
    if (!file) return
    setError('')
    setBusy('append')
    try {
      const incoming = await parseRawdataFile(file)
      const { added, total } = await appendRawdata(projectId, incoming)
      setToast({
        type: 'success',
        title: `เพิ่มก้อนข้อมูลแล้ว +${added} แถว`,
        message: `รวมเป็น ${total} แถว — กล่อง CE/OE/Verbatim จะขึ้นป้าย "แถวใหม่" จนกว่าจะเปิดตรวจ`,
        duration: 6000,
      })
    } catch (err) {
      setError(`เพิ่มก้อนข้อมูลไม่สำเร็จ: ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  // แนบไฟล์ SPSS .sav → ดึง Value+Label (codebook) เก็บลง project (ครั้งเดียว)
  const handleSav = async (file) => {
    if (!file) return
    setError('')
    setBusy('sav')
    try {
      if (!project.rawMeta?.questions?.length) {
        setToast({ type: 'warning', title: 'ยังไม่มี Rawdata', message: 'กรุณาอัปโหลด Rawdata (Excel) ก่อน แล้วจึงแนบ .sav (ระบบแมพตามลำดับคอลัมน์)', duration: 7000 })
        return
      }
      const raw = await parseSavCodebook(file)
      // แมพตามลำดับคอลัมน์ + เช็คจำนวนตัวแปรต้องเท่ากัน
      const res = remapCodebookByPosition(raw, project.rawMeta.questions)
      if (!res.ok) {
        setToast({ type: 'warning', title: 'แนบ .sav ไม่สำเร็จ — ตัวแปรไม่ตรงกัน', message: res.error, duration: 10000 })
        return
      }
      const codebook = res.codebook
      setCodebook(projectId, codebook)
      setToast({
        type: 'success',
        title: `แนบ Codebook แล้ว (${codebook.varCount} ข้อ)`,
        message: `แมพตามลำดับคอลัมน์สำเร็จ · มี Value Label ${codebook.valueLabelCount} ข้อ — ดู/สร้าง Codeframe จาก Code ได้ในกล่อง CE`,
        duration: 6000,
      })
    } catch (err) {
      setError(`อ่านไฟล์ .sav ไม่สำเร็จ: ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  const codebook = project.codebook

  const notes = [...(project.notes ?? [])].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
  const latestNote = notes[0]

  const resetNoteEditor = () => {
    setNoteDraft('')
    setEditingNoteId(null)
  }
  const saveNote = () => {
    const text = noteDraft.trim()
    if (!text) return
    const now = new Date().getTime()
    const currentNotes = project.notes ?? []
    const nextNotes = editingNoteId
      ? currentNotes.map((n) => (n.id === editingNoteId ? { ...n, text, updatedAt: now } : n))
      : [{ id: uid(), text, createdAt: now, updatedAt: now }, ...currentNotes]
    updateProject(projectId, { notes: nextNotes })
    resetNoteEditor()
    setToast({ type: 'success', title: editingNoteId ? 'แก้ไข Note แล้ว' : 'เพิ่ม Note แล้ว', message: 'บันทึกพร้อม timestamp วันที่+เวลาเรียบร้อย', duration: 2500 })
  }
  const editNote = (note) => {
    setEditingNoteId(note.id)
    setNoteDraft(note.text)
  }
  const deleteNote = (noteId) => {
    updateProject(projectId, { notes: (project.notes ?? []).filter((n) => n.id !== noteId) })
    if (editingNoteId === noteId) resetNoteEditor()
    setToast({ type: 'warning', title: 'ลบ Note แล้ว', message: 'ลบรายการบันทึกของโปรเจกต์นี้แล้ว', duration: 2200 })
  }

  const auditTime = (value) => {
    if (!value) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    if (value instanceof Date) return value.getTime()
    const n = Number(value)
    if (Number.isFinite(n)) return n
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : 0
  }

  const auditActionLabel = (action) => ({
    code_comment: 'CI Comment',
    edit_code_cell: 'CI แก้ข้อความ Code',
    rename_code: 'CI เปลี่ยนชื่อ Code',
    rename_net: 'CI เปลี่ยนชื่อ Net',
    merge_code: 'CI รวม Code',
    move_code: 'CI ย้าย Code',
    move_code_top: 'CI ย้าย Code ขึ้นบนสุด',
    move_code_bottom: 'CI ย้าย Code ลงล่างสุด',
    move_code_up: 'CI ย้าย Code ขึ้น',
    move_code_down: 'CI ย้าย Code ลง',
    export_codeframe: 'Export Codeframe',
    export_data: 'Export Data',
    review_confirm: 'CI ยืนยันตรวจแล้ว',
    review_open: 'CI เปิด Review Link',
  }[action] || 'กิจกรรมจาก CI')

  const shortText = (value, fallback = '—', max = 140) => {
    const text = String(value ?? '').trim()
    if (!text) return fallback
    return text.length > max ? `${text.slice(0, max)}…` : text
  }

  const describeAuditPayload = (row) => {
    const payload = row.payload || {}
    const cfName = codeframeNameById(row.codeframeId)
    if (row.action === 'code_comment') {
      return `${payload.sheetName || 'ไม่ระบุชีท'} · Code ${payload.codeNo || '—'} ${shortText(payload.label, '', 80)} · Comment: ${shortText(payload.comment, 'ไม่มีข้อความ', 160)}`
    }
    if (row.action === 'export_codeframe') {
      return `${shortText(payload.file || payload.fileName || cfName, 'Codeframe')} · ${payload.sheetCount ? `${payload.sheetCount} ชีท` : 'ไม่ระบุจำนวนชีท'}${payload.sharedExporter ? ' · ส่งออกผ่านหน้าร่วมรีวิว' : ''}`
    }
    if (row.action === 'export_data') {
      return `${shortText(payload.file || payload.fileName || 'Rawdata coded')} · Export ข้อมูลที่ลง Code แล้ว`
    }
    if (row.action === 'review_confirm') {
      const who = payload.confirmBy || payload.reviewer || row.reviewer || payload.ciEmail || 'CI Reviewer'
      const msg = payload.message || payload.comment || payload.confirmMessage || ''
      return `${who} ยืนยันตรวจงานแล้ว${msg ? ` · “${shortText(msg, '', 160)}”` : ''}`
    }
    if (row.action === 'edit_code_cell') {
      const before = payload.before || {}
      const patch = payload.patch || {}
      const codeNo = before.codeNo || payload.codeNo || '—'
      const from = before.thai || before.eng || before.english || before.label || ''
      const to = patch.thai || patch.eng || patch.english || patch.label || ''
      return `Code ${codeNo}: ${shortText(from, '(เดิมว่าง)', 80)} → ${shortText(to, '(ใหม่ว่าง)', 80)}`
    }
    if (row.action === 'rename_code') {
      const before = payload.before || {}
      const after = payload.after || {}
      return `Code ${before.codeNo || payload.codeNo || '—'}: ${shortText(before.thai || before.eng || '', '(เดิมว่าง)', 80)} → ${shortText(after.thai || after.eng || after.english || '', '(ใหม่ว่าง)', 80)}`
    }
    if (row.action === 'rename_net') {
      return `เปลี่ยนชื่อ Net เป็น “${shortText(payload.name, 'ยังไม่ตั้งชื่อ', 100)}”`
    }
    if (row.action === 'merge_code') {
      const sources = (payload.sources || []).map((c) => `${c.codeNo || ''} ${c.thai || c.eng || ''}`.trim()).filter(Boolean)
      const target = payload.target ? `${payload.target.codeNo || ''} ${payload.target.thai || payload.target.eng || ''}`.trim() : ''
      return `รวม ${sources.length || 0} Code${target ? ` เข้า “${shortText(target, '', 120)}”` : ''}${sources.length ? ` · จาก: ${shortText(sources.join(', '), '', 180)}` : ''}`
    }
    if ((row.action || '').startsWith('move_code')) {
      const count = Array.isArray(payload.codes) ? payload.codes.length : 1
      return `ย้ายลำดับ/ตำแหน่ง Code ${count} รายการ${payload.direction ? ` · ${payload.direction}` : ''}`
    }
    const pairs = Object.entries(payload)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .map(([k, v]) => `${k}: ${shortText(v, '', 80)}`)
    return pairs.length ? pairs.slice(0, 4).join(' · ') : 'มีการอัปเดตจากหน้า CI Review'
  }

  const codeframeNameById = (id) => codeframes.find((cf) => cf.id === id)?.name || 'Codeframe'

  const activityItems = (() => {
    const items = []
    const push = (item) => {
      if (!item.at) return
      items.push({ id: `${item.type}-${item.id || items.length}-${item.at}`, ...item })
    }
    push({ type: 'system', at: project.createdAt, title: 'สร้าง Project', detail: project.name || projectId, actor: project.ownerEmail || project.ownerName || 'Owner' })
    if (project.rawMeta?.updatedAt) {
      push({ type: 'data', at: project.rawMeta.updatedAt, title: 'อัปเดต Rawdata', detail: `${project.rawMeta.fileName || 'Rawdata'} · ${(project.rawMeta.rowCount ?? 0).toLocaleString('th-TH')} แถว · ${(project.rawMeta.questions?.length ?? 0).toLocaleString('th-TH')} ข้อ`, actor: 'Edit' })
    }
    if (project.codebookMeta?.updatedAt) {
      push({ type: 'data', at: project.codebookMeta.updatedAt, title: 'แนบ/อัปเดต Codebook', detail: `${project.codebookMeta.fileName || '.sav'} · ${(project.codebookMeta.varCount ?? 0).toLocaleString('th-TH')} ตัวแปร`, actor: 'Edit' })
    }
    if (project.restoredAt) {
      push({ type: 'system', at: project.restoredAt, title: 'Restore Backup', detail: project.restoredFromBackup || 'Backup file', actor: 'Edit' })
    }
    ;(project.notes ?? []).forEach((note) => {
      push({ type: 'note', id: note.id, at: note.createdAt, title: 'เพิ่ม Note', detail: note.text, actor: 'Edit' })
      if (note.updatedAt && note.updatedAt !== note.createdAt) {
        push({ type: 'note', id: `${note.id}-u`, at: note.updatedAt, title: 'แก้ไข Note', detail: note.text, actor: 'Edit' })
      }
    })
    codeframes.forEach((cf) => {
      push({ type: 'codeframe', id: cf.id, at: cf.createdAt, title: 'สร้าง Codeframe', detail: cf.name || 'Codeframe', actor: 'Edit' })
      if (cf.reviewUpdatedAt) push({ type: 'ci', id: `${cf.id}-review`, at: cf.reviewUpdatedAt, title: 'อัปเดต CI Review Snapshot', detail: cf.name || 'Codeframe', actor: 'Edit' })
      ;(cf.reviewLinks ?? []).forEach((link, index) => push({ type: 'ci', id: `${cf.id}-link-${index}`, at: link.createdAt, title: 'สร้าง Review Link', detail: `${cf.name || 'Codeframe'} · ${link.status || 'active'}`, actor: 'Edit' }))
      ;(cf.checkpoints ?? []).forEach((cp) => push({ type: 'codeframe', id: cp.id, at: cp.at, title: 'Save Checkpoint', detail: `${cf.name || 'Codeframe'} · ${cp.label || ''}`, actor: 'Edit' }))
    })
    reviewAuditRows.forEach((row) => {
      push({ type: 'ci', id: row.id, at: auditTime(row.createdAt), title: auditActionLabel(row.action), detail: describeAuditPayload(row), actor: row.reviewer || row.payload?.confirmBy || 'CI Reviewer' })
    })
    return items.sort((a, b) => b.at - a.at)
  })()

  const filteredActivityItems = activityFilter === 'all' ? activityItems : activityItems.filter((item) => item.type === activityFilter)

  const exportActivityLog = () => {
    const escape = (value) => {
      const text = String(value ?? '')
      const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
      return `"${safe.replace(/"/g, '""')}"`
    }
    const rows = [
      ['time', 'type', 'title', 'actor', 'detail'],
      ...filteredActivityItems.map((item) => [new Date(item.at).toLocaleString('th-TH'), item.type, item.title, item.actor, item.detail]),
    ]
    const csv = rows.map((r) => r.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.name || projectId}_activity_log.csv`.replace(/[\\/:*?"<>|]/g, '_')
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const ceFrames = codeframes.filter((c) => c.box === 'ce')

  const boxCards = [
    {
      key: 'ce',
      icon: Layers,
      to: `/projects/${projectId}/ce`,
      count: ceFrames.length,
      picked: project.boxes.ce.questionIds.length,
    },
    {
      key: 'oe',
      icon: ListTree,
      to: `/projects/${projectId}/oe`,
      count: codeframes.filter((c) => c.box === 'oe').length,
      picked: project.boxes.oe.questionIds.length,
      comingSoon: true, // ยังไม่เปิดใช้ — รอพัฒนาต่อ
    },
    {
      key: 'verbatim',
      icon: MessageSquareText,
      to: `/projects/${projectId}/verbatim`,
      count: project.boxes.verbatim.questionIds.length,
      picked: project.boxes.verbatim.questionIds.length,
      comingSoon: true, // ยังไม่เปิดใช้ — รอพัฒนาต่อ
    },
  ]

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eef2ff_0,#f8fafc_36%,#f8fafc_100%)]">
      <div className="mx-auto max-w-7xl px-5 py-5">
        <Link
          to="/"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft size={15} /> โปรเจกต์ทั้งหมด
        </Link>

        <section className="mb-4 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div data-tour="workboxes" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Job health</h2>
                <p className="text-xs text-slate-400">สถานะหลักของงานนี้ก่อนเริ่ม coding/review/export</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {boxCards.map((b, i) => (
                <WorkBoxCard
                  key={b.key}
                  b={b}
                  index={i}
                  project={project}
                  raw={raw}
                  wiggle={wiggle}
                  onComingSoon={pokeComingSoon}
                />
              ))}
            </div>
          </div>

          <button
            data-tour="notes"
            type="button"
            onClick={() => setNotesOpen(true)}
            className="group relative overflow-hidden rounded-[1.75rem] border border-indigo-100/80 bg-white p-0 text-left shadow-[0_18px_50px_rgba(79,70,229,0.10)] ring-1 ring-white/80 transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_24px_70px_rgba(79,70,229,0.18)] active:translate-y-0"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400" />
            <span className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-indigo-100/70 blur-2xl transition-transform group-hover:scale-125" />
            <span className="pointer-events-none absolute -bottom-16 -left-16 h-36 w-36 rounded-full bg-sky-100/60 blur-2xl" />

            <div className="relative flex h-full flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200 transition-transform group-hover:scale-105">
                    <StickyNote size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-400">Notebook</p>
                    <h2 className="mt-0.5 text-base font-black text-slate-950">Project notes</h2>
                    <p className="mt-1 line-clamp-1 text-xs text-slate-400">บันทึกสิ่งที่ทำแล้ว / สิ่งที่ต้องตามต่อ</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-600 shadow-sm">
                  {notes.length.toLocaleString('th-TH')} note
                </span>
              </div>

              <div className="mt-3 rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-3 shadow-inner shadow-slate-100/70 transition-colors group-hover:from-indigo-50/70 group-hover:to-white">
                {latestNote ? (
                  <div className="flex gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 ring-4 ring-emerald-100" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-black text-slate-500">Latest note</p>
                        <p className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-400">
                          <Clock3 size={12} /> {formatNoteTime(latestNote.updatedAt ?? latestNote.createdAt)}
                        </p>
                      </div>
                      <p className="line-clamp-3 break-words text-sm font-bold leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{latestNote.text}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                      <Pencil size={15} />
                    </span>
                    <div>
                      <p className="text-sm font-black text-slate-700">ยังไม่มี Note ของโปรเจกต์นี้</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">คลิกเพื่อจดสถานะ เช่น “ลง Code CE ครบแล้ว” หรือ “รอตรวจ Other”</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="relative mt-3 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-400">คลิกเพื่อเปิดกระดาน Note</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-black text-white shadow-lg shadow-slate-200 transition-transform group-hover:translate-x-0.5">
                  <PlusCircle size={14} /> เปิด / เพิ่ม
                </span>
              </div>
            </div>
          </button>
        </section>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => { handleReplace(e.target.files?.[0]); e.target.value = '' }}
      />
      <input
        ref={appendRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => { handleAppend(e.target.files?.[0]); e.target.value = '' }}
      />
      <input
        ref={savRef}
        type="file"
        accept=".sav"
        className="hidden"
        onChange={(e) => { handleSav(e.target.files?.[0]); e.target.value = '' }}
      />
      <input
        ref={restoreRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => { handleRestoreBackup(e.target.files?.[0]); e.target.value = '' }}
      />

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setActivityOpen(true)}>
          <Activity size={14} /> Activity Log
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={restoreLatestRawdataUndo}
          disabled={!!busy || !(project.rawMeta?.undoStack?.length)}
          title={project.rawMeta?.undoStack?.length ? `กู้คืนล่าสุด: ${project.rawMeta.undoStack[0].title}` : 'ยังไม่มีประวัติลบ/แก้ Verbatim ให้กู้คืน'}
        >
          <RefreshCcw size={14} /> {busy === 'undo' ? 'กำลังกู้คืน…' : `กู้คืนที่ลบล่าสุด${project.rawMeta?.undoStack?.length ? ` (${project.rawMeta.undoStack.length})` : ''}`}
        </Button>
        <Button variant="secondary" size="sm" onClick={createProjectBackup} disabled={!!busy} title="ดาวน์โหลด Backup เป็น JSON (มีข้อมูล respondent/review links ควรเก็บให้ปลอดภัย)">
          <Download size={14} /> {busy === 'backup' ? 'Backup…' : 'Backup'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => restoreRef.current?.click()} disabled={!!busy} title="Restore จากไฟล์ Backup JSON">
          <Upload size={14} /> Restore
        </Button>
      </div>

      {/* ===== กล่อง 1: Rawdata (ศูนย์กลางข้อมูล) ===== */}
      <section data-tour="rawdata" className="mb-3">
        <h2 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100 text-[11px] text-emerald-600">1</span>
          กล่องศูนย์กลางข้อมูล
        </h2>
        {!raw ? (
          <div
            onClick={() => busy !== 'upload' && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (!busy) handleReplace(e.dataTransfer.files?.[0]) }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 px-6 py-12 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50"
          >
            <div className="mb-3 rounded-2xl bg-white p-3 text-indigo-500 shadow-sm">
              {busy === 'upload' ? (
                <div className="h-[26px] w-[26px] animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
              ) : (
                <Upload size={26} />
              )}
            </div>
            <p className="text-sm font-semibold text-slate-700">
              {busy === 'upload' ? 'กำลังอัปโหลดขึ้น Firebase…' : 'อัปโหลดไฟล์ Rawdata (.xlsx)'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              คลิกเลือกไฟล์ หรือลากมาวางที่นี่ — แถวแรกต้องเป็นชื่อข้อ (เช่น SbjNum, Q28_1, P15_1)
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(8.75rem,14rem)] gap-3 md:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600">
                  <CheckCircle2 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{raw.fileName}</p>
                  <p className="text-xs text-slate-400">
                    {raw.questions.length} ข้อ (คอลัมน์) · {raw.rowCount} แถวคำตอบ ·
                    อัปเดตล่าสุด {new Date(raw.updatedAt).toLocaleString('th-TH')}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${projectId}/rawdata`)}
                  className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-100 bg-white/90 px-2.5 py-1.5 text-[11px] font-black text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow-md"
                >
                  <Table2 size={13} className="text-indigo-500 group-hover:text-indigo-700" />
                  ดู Data
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!!busy}
                  className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-100 bg-white/90 px-2.5 py-1.5 text-[11px] font-black text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCcw size={13} className="text-violet-1000 group-hover:text-amber-700" />
                  {busy === 'upload' ? 'กำลังอัปโหลด…' : 'โหลดไฟล์ Data เพิ่ม'}
                </button>
                <button
                  type="button"
                  onClick={exportQuestions}
                  disabled={!!busy}
                  className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-100 bg-white/90 px-2.5 py-1.5 text-[11px] font-black text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={13} className="text-sky-500 group-hover:text-sky-700" />
                  {busy === 'export' ? 'กำลัง Export…' : 'Export โจทย์'}
                </button>
              </div>
            </div>
            <StatusSummaryCard statusSummary={statusSummary} />
          </div>
        )}
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

        {/* Codebook (SPSS .sav) — Value+Label สำหรับงาน CE */}
        <div data-tour="codebook" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <Database size={15} className="text-sky-500" />
          <span className="text-sm font-semibold text-slate-700">Codebook (SPSS .sav):</span>
          {codebook ? (
            <span className="text-xs text-slate-500">
              <b className="text-slate-700">{codebook.fileName}</b> · {codebook.varCount} ข้อ ·{' '}
              {Object.values(codebook.byVar).filter((v) => v.values.length).length} ข้อมี Value Label
            </span>
          ) : (
            <span className="text-xs text-slate-400">ยังไม่ได้แนบ — ใช้ดึง Value+Label มาทำ Code ในกล่อง CE</span>
          )}
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => savRef.current?.click()} disabled={!!busy}>
            <Database size={14} /> {busy === 'sav' ? 'กำลังอ่าน…' : codebook ? 'เปลี่ยน .sav' : 'แนบ Codebook (.sav)'}
          </Button>
        </div>
      </section>

      <section className="mb-3 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[16rem] flex-1">
            <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
              <MailReviewLogo />
              CI Review Link / Genlink Codeframe
            </h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">สร้างลิงก์ให้ CI ดู/แก้ Codeframe แบบ Realtime โดยไม่โชว์ Rawdata หรือคำตอบรายแถว</p>
          </div>
          {codeframes.length ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {codeframes.map((cf) => {
                const latest = cf.reviewLinks?.filter((l) => l.status !== 'revoked').slice(-1)[0]
                return (
                  <div key={cf.id} className="flex flex-wrap items-center justify-end gap-2">
                    {latest?.url ? (
                      <button type="button" title={cf.name || 'Codeframe'} onClick={() => copyReviewLink(latest.url)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-black text-violet-700 hover:bg-violet-50">
                        <Copy size={13} /> Copy Link
                      </button>
                    ) : null}
                    <button type="button" title={cf.name || 'Codeframe'} onClick={() => genReviewLink(cf)} disabled={busy === `review-${cf.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-black text-violet-700 hover:bg-violet-50 disabled:opacity-50">
                      <Link2 size={13} /> {busy === `review-${cf.id}` ? 'Generating…' : 'Genlink อย่างเดียว'}
                    </button>
                    <button type="button" title={cf.name || 'Codeframe'} onClick={() => { setReviewEmailModal(cf); setReviewEmailDraft((d) => ({ ...d, editEmail: project?.editEmail || d.editEmail || '' })) }} disabled={busy === `review-${cf.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1.5 text-xs font-black text-white shadow-sm shadow-indigo-200 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50">
                      <MailReviewLogo size="sm" /> ส่งเมลให้ CI
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-violet-200 bg-white/70 px-4 py-2 text-xs font-semibold text-slate-400">ยังไม่มี Codeframe ให้สร้างลิงก์</p>
          )}
        </div>
      </section>

      {!raw && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
          <Plus size={13} /> อัปโหลด Rawdata ที่กล่องศูนย์กลางก่อน จึงจะเปิดกล่อง CE / OE / Verbatim ได้
        </p>
      )}


      {reviewEmailSending && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 px-4 py-6 backdrop-blur-md">
          <div className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/20 bg-white shadow-2xl shadow-indigo-950/40">
            <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-violet-200/70 blur-3xl" />
            <div className="absolute -bottom-20 -left-12 h-44 w-44 rounded-full bg-sky-200/70 blur-3xl" />
            <div className="relative px-6 py-7 text-center">
              <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-[1.7rem] bg-white shadow-2xl shadow-indigo-200">
                <span className="absolute inset-0 rounded-[1.7rem] border-4 border-violet-100" />
                <span className="absolute inset-0 animate-spin rounded-[1.7rem] border-4 border-transparent border-t-violet-600 border-r-indigo-500" />
                <MailReviewLogo size="lg" spinning />
              </div>
              <p className="mt-5 text-[11px] font-black uppercase tracking-[0.22em] text-violet-500">Sending email</p>
              <h3 className="mt-1 text-xl font-black text-slate-950">กำลังส่งเมลให้ CI</h3>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500">ระบบกำลังส่งลิงก์ Review ไปที่</p>
              <p className="mt-1 break-all rounded-2xl bg-slate-50 px-3 py-2 text-sm font-black text-slate-800">{reviewEmailSending.to}</p>
              <div className="mt-4 overflow-hidden rounded-full bg-slate-100">
                <div className="h-2 w-1/2 animate-[pulse_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-sky-400" />
              </div>
              <p className="mt-4 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">กรุณารอสักครู่ ห้ามปิดหน้านี้หรือคลิกส่วนอื่นจนกว่าจะส่งเสร็จ</p>
            </div>
          </div>
        </div>
      )}

      {reviewEmailSuccess && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl shadow-emerald-950/20">
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-5 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 shadow-lg">
                  <CheckCircle2 size={26} />
                </span>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100">Email sent</p>
                  <h3 className="text-lg font-black">ส่งเมลให้ CI สำเร็จแล้ว</h3>
                </div>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm font-semibold text-slate-600">
              <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-emerald-700">
                {reviewEmailSuccess.reused ? 'ใช้ลิงก์เดิม ไม่ได้ Genlink ใหม่' : 'สร้างลิงก์ใหม่และส่งเมลเรียบร้อย'}
              </p>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                <p><b className="text-slate-800">To:</b> {Array.isArray(reviewEmailSuccess.to) ? reviewEmailSuccess.to.join(', ') : reviewEmailSuccess.to}</p>
                {reviewEmailSuccess.cc?.length ? <p><b className="text-slate-800">Cc:</b> {reviewEmailSuccess.cc.join(', ')}</p> : null}
                {reviewEmailSuccess.replyTo ? <p><b className="text-slate-800">Send from:</b> {reviewEmailSuccess.replyTo}</p> : null}
                <p className="break-all"><b className="text-slate-800">Link:</b> {reviewEmailSuccess.url}</p>
              </div>
            </div>
            <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button type="button" onClick={() => setReviewEmailSuccess(null)} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white shadow-sm shadow-emerald-200 hover:bg-emerald-700">
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl shadow-slate-900/25">
            <div className="bg-gradient-to-r from-indigo-800 via-violet-700 to-purple-700 px-5 py-4 text-white">
              <div className="flex items-start gap-3">
<MailReviewLogo size="lg" />
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-100">Genlink Codeframe + Email Invite</p>
                  <h3 className="mt-1 truncate text-lg font-black">ส่ง CI Review Link</h3>
                  <p className="mt-1 truncate text-xs font-semibold text-violet-100">{project.name || projectId} · {reviewEmailModal.name || 'Codeframe'}</p>
                </div>
              </div>
            </div>
            <div className="space-y-3 bg-gradient-to-b from-violet-50/70 to-white px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-xs font-black text-slate-500">Email CI ผู้รับลิงก์ (ใส่ได้หลายเมล)</span>
                <textarea value={reviewEmailDraft.ciEmail} onChange={(e) => setReviewEmailDraft((d) => ({ ...d, ciEmail: e.target.value }))} rows={2} placeholder="ci1@office.com, ci2@office.com" className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100" />
                <span className="mt-1 block text-[11px] font-semibold text-slate-400">คั่นด้วย comma, space, semicolon หรือขึ้นบรรทัดใหม่ได้</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-slate-500">Cc Email เพิ่มเติม (ถ้ามี)</span>
                <textarea value={reviewEmailDraft.ccEmail} onChange={(e) => setReviewEmailDraft((d) => ({ ...d, ccEmail: e.target.value }))} rows={2} placeholder="manager@office.com, team@office.com" className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-slate-500">Send from Email ของ Edit</span>
                <input value={reviewEmailDraft.editEmail} onChange={(e) => setReviewEmailDraft((d) => ({ ...d, editEmail: e.target.value }))} placeholder="edit@office.com" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-slate-500">ข้อความถึง CI</span>
                <textarea value={reviewEmailDraft.message} onChange={(e) => setReviewEmailDraft((d) => ({ ...d, message: e.target.value }))} rows={4} className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
              {latestReviewLink(reviewEmailModal)?.url ? (
                <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">มีลิงก์ CI Review อยู่แล้ว ระบบจะส่งเมลด้วยลิงก์เดิม ไม่ Genlink ใหม่</p>
              ) : null}
              <p className="rounded-2xl bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">From: Codeframe Review &lt;codeframe@dpdata-tools.com&gt; · Send from เป็นเมล Edit ที่กรอก</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button type="button" onClick={() => setReviewEmailModal(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-100">ยกเลิก</button>
              <button type="button" onClick={async () => { const cf = reviewEmailModal; setReviewEmailModal(null); await genReviewLink(cf) }} className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-black text-violet-700 hover:bg-violet-50">สร้างลิงก์อย่างเดียว</button>
              <button type="button" disabled={!reviewEmailDraft.ciEmail.trim() || busy === `review-${reviewEmailModal.id}`} onClick={async () => { const cf = reviewEmailModal; const opts = { ...reviewEmailDraft, ciEmail: reviewEmailDraft.ciEmail.trim(), ccEmail: reviewEmailDraft.ccEmail.trim(), editEmail: reviewEmailDraft.editEmail.trim() }; setReviewEmailModal(null); await genReviewLink(cf, opts) }} className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-sm shadow-indigo-200 hover:from-indigo-700 hover:to-violet-700 disabled:cursor-not-allowed disabled:opacity-40">{latestReviewLink(reviewEmailModal)?.url ? 'ส่ง Email ด้วยลิงก์เดิม' : 'สร้างลิงก์ + ส่ง Email'}</button>
            </div>
          </div>
        </div>
      )}

      <ActivityLogModal
        open={activityOpen}
        items={filteredActivityItems}
        totalCount={activityItems.length}
        filter={activityFilter}
        setFilter={setActivityFilter}
        onExport={exportActivityLog}
        onClose={() => setActivityOpen(false)}
      />

      {restorePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl shadow-slate-900/25">
            <div className="bg-gradient-to-r from-indigo-700 via-violet-700 to-sky-600 px-5 py-5 text-white">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-100">Restore backup</p>
              <h3 className="mt-1 text-xl font-black">ยืนยันกู้คืน Backup</h3>
              <p className="mt-1 text-xs font-semibold text-indigo-100">ไฟล์: {restorePreview.fileName}</p>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm font-semibold text-slate-600">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-3">
                <p><b className="text-slate-900">Project:</b> {restorePreview.summary.projectName}</p>
                <p><b className="text-slate-900">Rawdata:</b> {restorePreview.summary.rawRows.toLocaleString('th-TH')} แถว · {restorePreview.summary.rawQuestions.toLocaleString('th-TH')} ข้อ</p>
                <p><b className="text-slate-900">Codeframe:</b> {restorePreview.summary.codeframes.toLocaleString('th-TH')} รายการ</p>
                {restorePreview.summary.collisions ? <p className="text-amber-700"><b>พบ id ชนโปรเจกต์อื่น:</b> {restorePreview.summary.collisions.toLocaleString('th-TH')} รายการ · ระบบจะสร้าง id ใหม่และปิด review links ให้</p> : null}
                <p><b className="text-slate-900">Exported:</b> {restorePreview.summary.exportedAt ? new Date(restorePreview.summary.exportedAt).toLocaleString('th-TH') : '-'}</p>
              </div>
              <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                Restore จะเขียนทับ Project/Rawdata/Codebook และอัปเดต Codeframe ที่ id ตรงกัน ถ้าเป็น Codeframe ใหม่จะเพิ่มให้ แต่จะไม่ลบ Codeframe ที่มีอยู่แล้วโดยอัตโนมัติเพื่อกันข้อมูลหาย
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button type="button" onClick={() => setRestorePreview(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-100">ยกเลิก</button>
              <button type="button" onClick={applyRestoreBackup} disabled={busy === 'restore'} className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-sm shadow-indigo-200 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50">
                {busy === 'restore' ? 'กำลังกู้คืน…' : 'ยืนยัน Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProjectNotesModal
        open={notesOpen}
        notes={notes}
        draft={noteDraft}
        editingNoteId={editingNoteId}
        onDraftChange={setNoteDraft}
        onSave={saveNote}
        onEdit={editNote}
        onDelete={deleteNote}
        onCancelEdit={resetNoteEditor}
        onClose={() => { setNotesOpen(false); resetNoteEditor() }}
      />


      <button
        type="button"
        onClick={() => { setHelpStep(0); setHelpOpen(true) }}
        className="fixed bottom-5 right-5 z-[80] flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-2xl shadow-indigo-300 ring-4 ring-white/80 transition hover:-translate-y-0.5 hover:shadow-indigo-400"
        aria-label="เปิดคู่มือแนะนำเมนู Job"
        title="คู่มือแนะนำ"
      >
        <HelpCircle size={26} />
      </button>

      <ProjectHelpGuide
        open={helpOpen}
        step={helpStep}
        setStep={setHelpStep}
        onClose={() => setHelpOpen(false)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    </div>
  )
}

const ACTIVITY_FILTERS = [
  ['all', 'ทั้งหมด'],
  ['data', 'Data'],
  ['codeframe', 'Codeframe'],
  ['ci', 'CI Review'],
  ['note', 'Notes'],
  ['system', 'System'],
]

const ACTIVITY_STYLE = {
  data: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  codeframe: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  ci: 'bg-violet-50 text-violet-700 ring-violet-100',
  note: 'bg-amber-50 text-amber-700 ring-amber-100',
  system: 'bg-slate-100 text-slate-700 ring-slate-200',
}

function ActivityLogModal({ open, items, totalCount, filter, setFilter, onExport, onClose }) {
  if (!open) return null
  const typeCount = items.reduce((m, item) => ({ ...m, [item.type]: (m[item.type] || 0) + 1 }), {})
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl shadow-slate-900/25">
        <div className="relative overflow-hidden bg-gradient-to-r from-slate-950 via-indigo-900 to-violet-800 px-6 py-5 text-white">
          <span className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-sky-400/25 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 shadow-lg ring-1 ring-white/20">
                <Activity size={24} />
              </span>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-indigo-100">Activity Log</p>
                <h3 className="mt-1 text-2xl font-black">ประวัติงานทั้งหมดของ Project</h3>
                <p className="mt-1 text-sm font-semibold text-indigo-100">รวม Data / Codeframe / CI Review / Notes / Backup Restore</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-2xl bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white" aria-label="ปิด Activity Log">
              <X size={19} />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${filter === id ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200' : 'border border-slate-200 bg-white text-slate-500 hover:bg-indigo-50 hover:text-indigo-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-white px-3 py-1.5 text-xs font-black text-slate-500 ring-1 ring-slate-200">
                แสดง {items.length.toLocaleString('th-TH')} / {totalCount.toLocaleString('th-TH')} รายการ
              </span>
              <Button variant="secondary" size="sm" onClick={onExport} disabled={!items.length}>
                <Download size={14} /> Download CSV
              </Button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="border-b border-slate-100 bg-white p-4 lg:border-b-0 lg:border-r">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Summary</p>
            <div className="grid grid-cols-2 gap-2 lg:block lg:space-y-2">
              {ACTIVITY_FILTERS.filter(([id]) => id !== 'all').map(([id, label]) => (
                <div key={id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="text-xs font-bold text-slate-500">{label}</span>
                  <span className="font-black text-slate-900">{(typeCount[id] || 0).toLocaleString('th-TH')}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold leading-relaxed text-amber-700">
              Log นี้รวมข้อมูลจากสถานะ Project, Codeframe และ CI audit ที่บันทึกใน Firestore
            </p>
          </aside>

          <div className="min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_top,#f8fafc_0,#ffffff_68%)] p-4">
            {items.length ? (
              <div className="relative space-y-3 before:absolute before:bottom-3 before:left-4 before:top-3 before:w-px before:bg-slate-200">
                {items.map((item) => (
                  <div key={item.id} className="relative flex gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                    <span className={`relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ring-4 ${ACTIVITY_STYLE[item.type] || ACTIVITY_STYLE.system}`}>
                      {item.type === 'ci' ? 'CI' : item.type === 'data' ? 'D' : item.type === 'note' ? 'N' : item.type === 'codeframe' ? 'C' : 'S'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ring-1 ${ACTIVITY_STYLE[item.type] || ACTIVITY_STYLE.system}`}>{item.type}</span>
                          <h4 className="truncate text-sm font-black text-slate-900">{item.title}</h4>
                        </div>
                        <span className="shrink-0 text-[11px] font-bold text-slate-400">{formatNoteTime(item.at)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-slate-600 [overflow-wrap:anywhere]">{item.detail || '—'}</p>
                      <p className="mt-2 text-[11px] font-bold text-slate-400">โดย: {item.actor || 'System'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/70 p-8 text-center">
                <Activity size={34} className="text-slate-300" />
                <p className="mt-3 text-sm font-black text-slate-600">ยังไม่มี Activity ใน filter นี้</p>
                <p className="mt-1 text-xs text-slate-400">ลองเลือก “ทั้งหมด” หรือทำงานเพิ่มใน Project นี้ก่อน</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusSummaryCard({ statusSummary }) {
  return (
    <div data-tour="status" className="h-full min-w-0 rounded-2xl border border-cyan-100 bg-white p-3 shadow-sm ring-1 ring-cyan-50">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
            <Activity size={16} />
          </span>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-500">Status</p>
            <p className="text-sm font-black text-slate-800">สถานะจาก Excel</p>
          </div>
        </div>
        <Badge color={statusSummary.found ? 'emerald' : 'slate'}>
          {statusSummary.loading ? 'กำลังอ่าน…' : statusSummary.found ? `${statusSummary.items.length} สถานะ` : 'ไม่พบ'}
        </Badge>
      </div>
      {statusSummary.found ? (
        <div className="grid grid-cols-2 gap-2">
          {statusSummary.items.slice(0, 6).map((item, i) => {
            const pct = statusSummary.total ? Math.round((item.count / statusSummary.total) * 100) : 0
            return (
              <div key={item.name} className="rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-black text-slate-700" title={item.name}>{item.name}</span>
                  <span className="text-xs font-black text-slate-900">{item.count.toLocaleString('th-TH')}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white">
                  <div className={`${['bg-emerald-400', 'bg-cyan-400', 'bg-indigo-400', 'bg-amber-400', 'bg-fuchsia-400', 'bg-slate-400'][i % 6]} h-full rounded-full`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{pct}%</p>
              </div>
            )
          })}
          {statusSummary.items.length > 6 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-400">
              +{statusSummary.items.length - 6} สถานะอื่น
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-400">
          <p>ยังไม่พบคอลัมน์ชื่อ <b>Status</b> ในไฟล์ Excel นี้</p>
          {statusSummary.debugHeaders?.length > 0 && (
            <p className="mt-1 line-clamp-2">หัวคอลัมน์ที่อ่านได้: {statusSummary.debugHeaders.slice(0, 24).join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function formatNoteTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function postItClass(i) {
  const styles = [
    'rotate-[-1.2deg] bg-amber-100 ring-amber-200/80',
    'rotate-[1deg] bg-lime-100 ring-lime-200/80',
    'rotate-[-0.6deg] bg-sky-100 ring-sky-200/80',
    'rotate-[1.3deg] bg-rose-100 ring-rose-200/80',
    'rotate-[-1deg] bg-violet-100 ring-violet-200/80',
  ]
  return styles[i % styles.length]
}

function postItFlatClass(i) {
  return postItClass(i).replace(/rotate-\[[^\]]+\]\s*/g, '')
}

function ProjectNotesModal({ open, notes, draft, editingNoteId, onDraftChange, onSave, onEdit, onDelete, onCancelEdit, onClose }) {
  const [expandedNoteId, setExpandedNoteId] = useState(null)
  if (!open) return null
  const editing = notes.find((n) => n.id === editingNoteId)
  const expandedIndex = notes.findIndex((n) => n.id === expandedNoteId)
  const expandedNote = expandedIndex >= 0 ? notes[expandedIndex] : null
  const handleDelete = (noteId) => {
    if (expandedNoteId === noteId) setExpandedNoteId(null)
    onDelete(noteId)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl shadow-slate-900/25">
        <div className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-6">
          <span className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-indigo-200/40" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-500">Project notebook</p>
              <h3 className="mt-1 text-2xl font-black text-slate-950">Notes ของโปรเจกต์นี้</h3>
              <p className="mt-1 text-sm text-slate-500">เพิ่ม / ลบ / แก้ไขได้ พร้อม Auto stamp วันที่และเวลาให้ User เห็นทุก Note</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="ปิด Notes"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[1fr_1.15fr]">
          <div className="border-b border-slate-100 bg-slate-50/70 p-5 md:border-b-0 md:border-r">
            <label className="text-xs font-black uppercase tracking-wide text-slate-400">
              {editingNoteId ? 'แก้ไข Note' : 'เพิ่ม Note ใหม่'}
            </label>
            {editing && (
              <p className="mt-1 text-xs text-slate-400">กำลังแก้ไขรายการจาก {formatNoteTime(editing.createdAt)}</p>
            )}
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="เช่น ลง Code CE ครบแล้ว / รอ QC รอบ 2 / อัปโหลด data ก้อนใหม่แล้ว"
              className="mt-3 h-40 w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium leading-relaxed text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={onSave} disabled={!draft.trim()}>
                <Save size={14} /> {editingNoteId ? 'บันทึกการแก้ไข' : 'เพิ่ม Note'}
              </Button>
              {editingNoteId && (
                <Button variant="secondary" size="sm" onClick={onCancelEdit}>ยกเลิกแก้ไข</Button>
              )}
            </div>
            <p className="mt-4 rounded-2xl bg-white p-3 text-xs leading-relaxed text-slate-400">
              Tip: ใช้เป็น log งานสั้น ๆ เช่น “ลง Code CE ครบแล้ว”, “รอเช็ค Other”, “ส่งไฟล์ export ให้ลูกค้าแล้ว”
            </p>
          </div>

          <div className="min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_top,#f8fafc_0,#f1f5f9_75%)] p-5">
            {notes.length ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {notes.map((note, i) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => setExpandedNoteId(note.id)}
                    className={`group relative min-h-44 rounded-[1.6rem] p-4 pt-7 text-left shadow-lg shadow-slate-300/50 ring-1 transition-all hover:-translate-y-1 hover:rotate-0 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-indigo-200 ${postItClass(i)}`}
                  >
                    <span className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 -rotate-2 rounded-sm bg-white/55 shadow-sm backdrop-blur-[1px]" />
                    <div className="absolute right-3 top-3 flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(note) }} className="rounded-xl bg-white/45 p-2 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-indigo-600" aria-label="แก้ไข Note">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(note.id) }} className="rounded-xl bg-white/45 p-2 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-rose-600" aria-label="ลบ Note">
                          <Trash2 size={14} />
                        </button>
                    </div>
                    <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words pr-2 text-sm font-bold leading-relaxed text-slate-800 [overflow-wrap:anywhere]">
                      {note.text}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-black/5 pt-3 text-[11px] font-black text-slate-500/80">
                      <span className="rounded-full bg-white/45 px-2.5 py-1 shadow-sm">สร้าง: {formatNoteTime(note.createdAt)}</span>
                      {note.updatedAt !== note.createdAt && (
                        <span className="rounded-full bg-white/45 px-2.5 py-1 text-indigo-600 shadow-sm">แก้ไข: {formatNoteTime(note.updatedAt)}</span>
                      )}
                    </div>
                    <span className="mt-3 inline-flex text-[11px] font-black text-slate-500/70">คลิกเพื่อขยาย</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
                <div className="rounded-3xl bg-indigo-50 p-4 text-indigo-500">
                  <StickyNote size={30} />
                </div>
                <p className="mt-4 font-bold text-slate-700">ยังไม่มี Note</p>
                <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-400">เพิ่มบันทึกแรกเพื่อเก็บสถานะโปรเจกต์นี้ไว้ให้ทีมเห็นได้เลย</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {expandedNote && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]"
          onClick={() => setExpandedNoteId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`relative flex max-h-[82vh] w-full max-w-xl rotate-0 flex-col rounded-[2rem] p-7 pt-10 shadow-2xl shadow-slate-950/30 ring-1 ring-black/5 ${postItFlatClass(expandedIndex)}`}
          >
            <span className="absolute left-1/2 top-3 h-7 w-36 -translate-x-1/2 -rotate-2 rounded-sm bg-white/55 shadow-sm backdrop-blur-[1px]" />
            <button
              type="button"
              onClick={() => setExpandedNoteId(null)}
              className="absolute right-4 top-4 rounded-2xl bg-white/55 p-2 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-900"
              aria-label="ปิด Post-it"
            >
              <X size={18} />
            </button>
            <div className="mb-4 flex flex-wrap items-center gap-2 pr-10 text-[11px] font-black text-slate-500/80">
              <span className="rounded-full bg-white/45 px-3 py-1.5 shadow-sm">สร้าง: {formatNoteTime(expandedNote.createdAt)}</span>
              {expandedNote.updatedAt !== expandedNote.createdAt && (
                <span className="rounded-full bg-white/45 px-3 py-1.5 text-indigo-600 shadow-sm">แก้ไข: {formatNoteTime(expandedNote.updatedAt)}</span>
              )}
            </div>
            <div className="min-h-40 overflow-y-auto rounded-2xl bg-white/20 p-4 shadow-inner">
              <p className="whitespace-pre-wrap break-words text-lg font-black leading-relaxed text-slate-800 [overflow-wrap:anywhere]">
                {expandedNote.text}
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-black/5 pt-4">
              <Button variant="secondary" size="sm" onClick={() => { onEdit(expandedNote); setExpandedNoteId(null) }}>
                <Pencil size={14} /> แก้ไข
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleDelete(expandedNote.id)}>
                <Trash2 size={14} /> ลบ
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const HELP_GUIDE_STEPS = [
  {
    label: '01',
    target: 'box-ce',
    title: 'กล่อง CE',
    text: 'จุดเริ่มงานหลักของ CE กดการ์ดนี้เพื่อเข้าไปสร้าง/แก้ Codeframe และเริ่ม Coding',
    iconClass: 'bg-sky-500 text-white shadow-sky-200',
    chipClass: 'bg-sky-50 text-sky-700',
  },
  {
    label: '02',
    target: 'notes',
    title: 'Project notes',
    text: 'บันทึกสถานะงาน สิ่งที่ทำแล้ว หรือสิ่งที่ต้องตามต่อ เปิดดู/เพิ่ม/แก้ไข note ได้จากการ์ดนี้',
    iconClass: 'bg-indigo-500 text-white shadow-indigo-200',
    chipClass: 'bg-indigo-50 text-indigo-700',
  },
  {
    label: '03',
    target: 'rawdata',
    title: 'Rawdata / กล่องศูนย์กลางข้อมูล',
    text: 'จัดการไฟล์ข้อมูลหลัก ดู Data โหลดไฟล์เพิ่ม และ Export โจทย์จากจุดนี้',
    iconClass: 'bg-emerald-500 text-white shadow-emerald-200',
    chipClass: 'bg-emerald-50 text-emerald-700',
  },
  {
    label: '04',
    target: 'status',
    title: 'Status จาก Excel',
    text: 'สรุปจำนวนสถานะในไฟล์ เช่น Approved / Requires Approval เพื่อเช็กภาพรวมงานเร็ว ๆ',
    iconClass: 'bg-cyan-500 text-white shadow-cyan-200',
    chipClass: 'bg-cyan-50 text-cyan-700',
  },
  {
    label: '05',
    target: 'codebook',
    title: 'Codebook (.sav)',
    text: 'แนบไฟล์ SPSS .sav เพื่อดึง Value Label มาช่วยลง Code ในกล่อง CE ได้แม่นขึ้น',
    iconClass: 'bg-amber-500 text-white shadow-indigo-200',
    chipClass: 'bg-amber-50 text-amber-700',
  },
  {
    label: '06',
    target: 'box-oe',
    title: 'OE / Verbatim',
    text: 'สองกล่องนี้ยังเป็น Coming Soon ถ้าคลิกจะมี Msgbox แจ้งเตือน ไม่พาเข้าผิดขั้นตอน',
    iconClass: 'bg-violet-500 text-white shadow-violet-200',
    chipClass: 'bg-violet-50 text-violet-700',
  },
]

function ProjectHelpGuide({ open, step, setStep, onClose }) {
  const [spot, setSpot] = useState(null)
  const current = HELP_GUIDE_STEPS[step] ?? HELP_GUIDE_STEPS[0]
  const isLast = step >= HELP_GUIDE_STEPS.length - 1

  useEffect(() => {
    if (!open) return undefined
    let mounted = true
    const updateSpot = () => {
      const el = document.querySelector(`[data-tour="${current.target}"]`)
      if (!el) {
        if (mounted) setSpot(null)
        return
      }
      const rect = el.getBoundingClientRect()
      const pad = 8
      if (mounted) {
        setSpot({
          top: Math.max(10, rect.top - pad),
          left: Math.max(10, rect.left - pad),
          width: Math.min(window.innerWidth - 20, rect.width + pad * 2),
          height: Math.min(window.innerHeight - 20, rect.height + pad * 2),
          bottom: rect.bottom + pad,
        })
      }
    }
    const el = document.querySelector(`[data-tour="${current.target}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    const t1 = window.setTimeout(updateSpot, 120)
    const t2 = window.setTimeout(updateSpot, 420)
    window.addEventListener('resize', updateSpot)
    window.addEventListener('scroll', updateSpot, true)
    return () => {
      mounted = false
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', updateSpot)
      window.removeEventListener('scroll', updateSpot, true)
    }
  }, [open, current.target])

  if (!open) return null

  const modalStyle = spot
    ? (() => {
        const modalHeight = 235
        const margin = 12
        const modalWidth = Math.min(window.innerWidth - margin * 2, 416)
        const belowTop = spot.bottom + 14
        const aboveTop = spot.top - modalHeight - 14
        const useAbove = belowTop + modalHeight > window.innerHeight && aboveTop > margin
        const top = Math.max(margin, Math.min(window.innerHeight - modalHeight - margin, useAbove ? aboveTop : belowTop))
        const desiredLeft = spot.left + spot.width / 2 - modalWidth / 2
        const left = Math.max(margin, Math.min(window.innerWidth - modalWidth - margin, desiredLeft))
        return {
          top: `${top}px`,
          left: `${left}px`,
          width: `${modalWidth}px`,
        }
      })()
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  return (
    <div className="fixed inset-0 z-[95] pointer-events-none">
      <div
        className="absolute rounded-[1.6rem] border-2 border-white bg-transparent shadow-[0_0_0_9999px_rgba(15,23,42,0.55),0_18px_70px_rgba(79,70,229,0.35)] ring-4 ring-indigo-400/70 transition-all duration-300"
        style={spot ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height } : { display: 'none' }}
      />

      <div
        className="pointer-events-auto fixed overflow-hidden rounded-[1.7rem] border border-white/80 bg-white shadow-2xl shadow-slate-950/25 [animation:cs-pop_.22s_ease-out]"
        style={modalStyle}
      >
        <div className="h-2 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400" />
        <div className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg ${current.iconClass}`}>
                <HelpCircle size={23} />
              </span>
              <div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${current.chipClass}`}>{current.label}</span>
                <h3 className="mt-1 text-base font-black text-slate-950">{current.title}</h3>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label="ปิดคู่มือ">
              <X size={18} />
            </button>
          </div>

          <p className="rounded-2xl bg-slate-50 p-3 text-sm font-semibold leading-relaxed text-slate-600">
            {current.text}
          </p>

          <div className="mt-3 flex items-center justify-center gap-1.5">
            {HELP_GUIDE_STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                className={`h-2 rounded-full transition-all ${i === step ? 'w-7 bg-indigo-600' : 'w-2 bg-slate-200 hover:bg-slate-300'}`}
                aria-label={`ไปคำแนะนำ ${i + 1}`}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              Skip
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button type="button" onClick={() => setStep(step - 1)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => (isLast ? onClose() : setStep(step + 1))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-indigo-200"
              >
                {isLast ? 'Done' : 'Next'}
                <ChevronRight size={15} className="ce-cta-float" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function WorkBoxCard({ b, index, project, raw, wiggle, onComingSoon }) {
  const meta = BOX_META[b.key]
  const cls = BOX_CLS[b.key]
  const Icon = b.icon
  const newRows = newRowCount(project, b.key)
  const comingSoon = !!b.comingSoon
  const disabled = !raw || comingSoon
  const isCeActive = b.key === 'ce' && !disabled
  const card = (
    <div
      data-tour={`box-${b.key}`}
      className={`group relative flex min-h-56 flex-col overflow-hidden rounded-2xl border bg-white p-5 text-left shadow-sm transition-all ${
        comingSoon
          ? `cursor-pointer border-slate-200 hover:opacity-100 hover:shadow-md ${wiggle === b.key ? 'cs-wiggle' : ''}`
          : disabled
            ? 'cursor-not-allowed border-slate-200 opacity-60'
            : isCeActive
              ? 'cursor-pointer ce-pretty-card ce-card-glow hover:-translate-y-0.5 hover:shadow-xl'
              : 'cursor-pointer border-slate-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg'
      }`}
    >
      {comingSoon && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/60 backdrop-blur-[2px] transition-all group-hover:bg-white/45">
          <span className="text-lg font-extrabold tracking-tight text-slate-700">{meta.label}</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg transition-transform group-hover:scale-105 ${wiggle === b.key ? 'cs-pop' : ''}`}
          >
            <Lock size={13} className="transition-transform group-hover:-rotate-12" /> เร็วๆ นี้ · Coming Soon
          </span>
        </div>
      )}
      <span className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-slate-50 transition-transform duration-300 group-hover:scale-125" />
      <div className="relative flex items-center gap-2">
        <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${cls.num}`}>
          {index + 1}
        </span>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cls.icon}`}>
          <Icon size={19} />
        </div>
        <div className="ml-auto"><NewRowsBadge count={disabled ? 0 : newRows} /></div>
      </div>
      <h3 className="relative mt-4 text-base font-black text-slate-900 group-hover:text-indigo-700">
        {meta.label}
      </h3>
      <p className="relative mt-1 min-h-10 text-xs leading-snug text-slate-500">{meta.desc}</p>
      <div className="relative mt-auto flex items-center gap-3 pt-4 text-sm text-slate-500">
        {b.key === 'verbatim' ? (
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareText size={15} className={b.picked ? 'text-violet-1000' : 'text-slate-300'} />
            {b.picked ? `${b.picked} ข้อ Verbatim` : 'ยังไม่ได้เลือกข้อ'}
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={15} className={b.count ? 'text-indigo-500' : 'text-slate-300'} />
              {b.count} Codeframe
            </span>
            <span className="text-slate-300">·</span>
            <span>{b.picked} ข้อที่เลือก</span>
          </>
        )}
        <ChevronRight size={16} className={`ml-auto text-slate-300 group-hover:text-indigo-400 ${isCeActive ? 'ce-cta-float text-sky-500' : ''}`} />
      </div>
      {isCeActive && (
        <div className="relative mt-3 flex items-center justify-between rounded-xl border border-sky-100 bg-white/80 px-3 py-2 shadow-sm backdrop-blur-sm">
          <span className="text-[11px] font-bold text-slate-500">พร้อมเริ่มงาน Coding</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-600 px-2.5 py-1.5 text-[11px] font-black text-white shadow-md shadow-sky-200">
            เริ่มทำ CE
            <ChevronRight size={13} className="ce-cta-float" />
          </span>
        </div>
      )}
    </div>
  )

  if (comingSoon) {
    return (
      <button
        type="button"
        onClick={() => onComingSoon(b.key, meta.label)}
        className="block h-full w-full select-none"
      >
        {card}
      </button>
    )
  }
  return disabled ? (
    <div>{card}</div>
  ) : (
    <Link to={b.to} className="block h-full">{card}</Link>
  )
}
