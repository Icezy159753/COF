/* eslint-disable no-unused-vars */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { ArrowDown, ArrowRightLeft, ArrowUp, Check, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Download, GitMerge, MessageSquare, MoreHorizontal, Pencil, ShieldCheck, X } from 'lucide-react'
import { db } from '../lib/firebase.js'
import { exportCodeframe } from '../lib/excel.js'

const nowMs = () => Date.now()

const AI_API_BASE = (import.meta.env.VITE_AI_API_BASE || '').replace(/\/$/, '')
const apiUrl = (path) => `${AI_API_BASE}${path}`

function flatCodes(sheet) {
  return (sheet?.nets ?? []).flatMap((net) => (net.codes ?? []).map((code) => ({ ...code, netId: net.id, netName: net.name || net.label || 'Main' })))
}

function formatDate(ts) {
  if (!ts) return '—'
  const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

function parseCodeframeDoc(data) {
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

function safeExcelSheetName(name = 'Codeframe') {
  const cleaned = String(name || 'Codeframe').replace(/[\\/*?:[\]]/g, ' ').trim() || 'Codeframe'
  return cleaned.slice(0, 31)
}

function safeFileName(name = 'codeframe') {
  return String(name || 'codeframe').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'codeframe'
}


function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} ใช้เวลานานเกินไป กรุณากด Refresh หรือตรวจว่า Link ยัง active`)), ms)),
  ])
}

const REVIEW_SHEET_STATUS = {
  orange: { dot: 'bg-amber-500', tab: 'border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400', active: 'border-amber-500 bg-amber-500 text-white shadow-sm' },
  red: { dot: 'bg-rose-500', tab: 'border-rose-300 bg-rose-50 text-rose-900 hover:border-rose-400', active: 'border-rose-500 bg-rose-500 text-white shadow-sm' },
  gray: { dot: 'bg-slate-400', tab: 'border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300', active: 'border-slate-500 bg-slate-500 text-white shadow-sm' },
  maroon: { dot: 'bg-red-900', tab: 'border-red-200 bg-red-50 text-red-900 hover:border-red-300', active: 'border-red-900 bg-red-900 text-white shadow-sm' },
  green: { dot: 'bg-emerald-500', tab: 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300', active: 'border-emerald-500 bg-emerald-500 text-white shadow-sm' },
  none: { dot: 'bg-slate-300', tab: 'border-slate-200 bg-white text-slate-500 hover:border-slate-300', active: 'border-slate-500 bg-slate-600 text-white shadow-sm' },
}
const STATUS_HEX = { orange: 'F59E0B', red: 'EF4444', maroon: '9F1239', gray: '94A3B8', green: '10B981', none: 'CBD5E1' }


function CodeCell({ value, placeholder, editing, mono, onStart, onStop, onChange }) {
  if (editing) {
    return (
      <input
        autoFocus
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onStop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onStop() }
        }}
        className={`w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-xs text-slate-800 outline-none ring-2 ring-indigo-100 ${mono ? 'font-mono font-bold' : 'font-semibold'}`}
      />
    )
  }
  return (
    <span
      onDoubleClick={(e) => { e.stopPropagation(); onStart() }}
      title="ดับเบิลคลิกเพื่อแก้ไข"
      className={`block min-h-[1.35rem] cursor-text truncate rounded px-1 py-0.5 hover:bg-indigo-50 ${mono ? 'font-mono font-black text-slate-700' : value ? 'font-semibold text-slate-700' : 'text-slate-300'}`}
    >
      {value || placeholder || '—'}
    </span>
  )
}

export default function CodeframeReview() {
  const { token } = useParams()
  const [link, setLink] = useState(null)
  const [cf, setCf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSheetId, setActiveSheetId] = useState('')
  const [reviewer, setReviewer] = useState(() => localStorage.getItem('cof-reviewer-name') || '')
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState(null) // { codeId, draft }
  const [mergeOpen, setMergeOpen] = useState(null) // source code id
  const [moveOpen, setMoveOpen] = useState(null) // code id
  const [contextMenu, setContextMenu] = useState(null) // { x, y, codeId }
  const [codeSearch, setCodeSearch] = useState('')
  const [codeFilter, setCodeFilter] = useState('all')
  const [editingCell, setEditingCell] = useState(null) // { codeId, field }
  const [selectedCodeIds, setSelectedCodeIds] = useState(() => new Set())
  const [lastClickedCodeId, setLastClickedCodeId] = useState('')
  const [commentModal, setCommentModal] = useState(null) // { code }
  const [commentDraft, setCommentDraft] = useState('')
  const [confirmSending, setConfirmSending] = useState(false)
  const [confirmNotice, setConfirmNotice] = useState(null)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [confirmNote, setConfirmNote] = useState('ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ')
  const sheetTabsRef = useRef(null)
  const scrollSheetTabs = (dir) => {
    const el = sheetTabsRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(240, Math.floor(el.clientWidth * 0.65)), behavior: 'smooth' })
  }

  useEffect(() => {
    if (!token) return undefined
    let cancelled = false
    let unsubLink = null
    let unsubCf = null

    const applyCodeframeSnap = (snap) => {
      if (!snap.exists()) throw new Error('ไม่พบ Codeframe')
      const data = parseCodeframeDoc({ id: snap.id, ...snap.data() })
      setCf(data)
      setActiveSheetId((prev) => data.sheets?.some((s) => s.id === prev) ? prev : (data.sheets?.[0]?.id || ''))
      setLoading(false)
    }

    const loadFastThenRealtime = async () => {
      setLoading(true)
      setError('')
      try {
        const linkRef = doc(db, 'review_links', token)
        const linkSnap = await withTimeout(getDoc(linkRef), 8000, 'โหลด Review Link')
        if (cancelled) return
        if (!linkSnap.exists()) throw new Error('ลิงก์ Review นี้ไม่ถูกต้องหรือถูกปิดแล้ว')
        const linkData = { id: linkSnap.id, ...linkSnap.data() }
        if (linkData.status && linkData.status !== 'active') throw new Error('ลิงก์ Review นี้ถูกปิดใช้งานแล้ว')
        setLink(linkData)

        const cfRef = doc(db, 'codeframes', linkData.codeframeId)
        const cfSnap = await withTimeout(getDoc(cfRef), 8000, 'โหลด Codeframe')
        if (cancelled) return
        applyCodeframeSnap(cfSnap)

        unsubLink = onSnapshot(linkRef, (snap) => {
          if (!snap.exists()) { setError('ลิงก์ Review นี้ไม่ถูกต้องหรือถูกปิดแล้ว'); return }
          const data = { id: snap.id, ...snap.data() }
          if (data.status && data.status !== 'active') { setError('ลิงก์ Review นี้ถูกปิดใช้งานแล้ว'); return }
          setLink(data)
        })
        unsubCf = onSnapshot(cfRef, (snap) => {
          try { applyCodeframeSnap(snap) } catch (err) { setError(err.message || 'โหลด Codeframe ไม่สำเร็จ') }
        })
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'โหลด CI Review ไม่สำเร็จ')
          setLoading(false)
        }
      }
    }

    loadFastThenRealtime()
    return () => {
      cancelled = true
      if (unsubLink) unsubLink()
      if (unsubCf) unsubCf()
    }
  }, [token])

  const sheet = useMemo(() => cf?.sheets?.find((s) => s.id === activeSheetId) || cf?.sheets?.[0], [cf, activeSheetId])
  const codes = useMemo(() => flatCodes(sheet), [sheet])
  const freqByCode = cf?.reviewFreqByCode?.[sheet?.id] ?? {}
  const nets = sheet?.nets ?? []
  const codeCount = nets.reduce((sum, n) => sum + (n.codes?.length || 0), 0)
  const freqOf = (code) => freqByCode[code.id] || 0
  const codeVisible = (code) => {
    const q = codeSearch.trim().toLowerCase()
    const hay = `${code.codeNo ?? ''} ${code.thai ?? ''} ${code.thai2 ?? ''} ${code.eng ?? ''} ${code.english ?? ''}`.toLowerCase()
    if (q && !hay.includes(q)) return false
    const n = freqOf(code)
    const isNew = !!code.aiNew || !!code.manualNew
    if (codeFilter === 'freq') return n > 0
    if (codeFilter === 'new') return isNew
    if (codeFilter === 'zero') return n === 0
    return true
  }
  const shortSheetName = (name = '') => String(name).replace(/^code\s+/i, '').replace(/_\d+$/i, '').trim() || name
  const sheetTitle = sheet ? { code: shortSheetName(sheet.name), label: sheet.title || sheet.questionText || sheet.questionLabel || '' } : null
  const sheetHasNewCode = (sh) => (sh?.nets ?? []).some((net) => (net.codes ?? []).some((code) => !!code.aiNew || !!code.manualNew))
  const visibleCodeIds = () => nets.flatMap((n) => (n.codes || []).filter(codeVisible).map((c) => c.id))
  const selectSingleOrRange = (e, codeId) => {
    if (e.shiftKey && lastClickedCodeId) {
      const ids = visibleCodeIds()
      const a = ids.indexOf(lastClickedCodeId)
      const b = ids.indexOf(codeId)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelectedCodeIds((prev) => new Set([...prev, ...ids.slice(lo, hi + 1)]))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedCodeIds((prev) => {
        const next = new Set(prev)
        next.has(codeId) ? next.delete(codeId) : next.add(codeId)
        return next
      })
      setLastClickedCodeId(codeId)
      return
    }
    setSelectedCodeIds(new Set([codeId]))
    setLastClickedCodeId(codeId)
  }
  const openCodeMenu = (e, codeId) => {
    e.preventDefault()
    setSelectedCodeIds((prev) => prev.has(codeId) ? prev : new Set([codeId]))
    setLastClickedCodeId(codeId)
    setContextMenu({ x: e.clientX, y: e.clientY, codeId })
  }

  const logAudit = async (action, payload) => {
    await addDoc(collection(db, 'review_audit'), {
      token,
      codeframeId: cf.id,
      projectId: link?.projectId || cf.projectId || '',
      action,
      reviewer: reviewer.trim() || 'CI Reviewer',
      payload,
      createdAt: serverTimestamp(),
    })
  }

  const saveCf = async (nextCf, action, payload) => {
    setBusy(action)
    try {
      await updateDoc(doc(db, 'codeframes', cf.id), {
        sheetsJson: JSON.stringify(nextCf.sheets ?? []),
        reviewFreqByCode: nextCf.reviewFreqByCode || {},
        reviewSheetStatusMap: nextCf.reviewSheetStatusMap || cf.reviewSheetStatusMap || {},
        reviewUpdatedAt: nowMs(),
        reviewWriteToken: token,
      })
      await logAudit(action, payload)
    } finally {
      setBusy('')
    }
  }

  const startEdit = (code) => {
    setEditing({ codeId: code.id, draft: { thai: code.thai || '', thai2: code.thai2 || '', eng: code.eng || code.english || '' } })
    setEditingCell({ codeId: code.id, field: 'thai' })
    setContextMenu(null)
  }

  const updateCodeField = async (netId, codeId, patch) => {
    const before = codes.find((c) => c.id === codeId)
    const nextSheets = cf.sheets.map((sh) => sh.id !== sheet.id ? sh : {
      ...sh,
      nets: sh.nets.map((net) => net.id === netId ? {
        ...net,
        codes: net.codes.map((code) => code.id === codeId ? { ...code, ...patch } : code),
      } : net),
    })
    await saveCf({ ...cf, sheets: nextSheets }, 'edit_code_cell', { sheetId: sheet.id, before, patch })
  }

  const updateNetName = async (netId, name) => {
    const nextSheets = cf.sheets.map((sh) => sh.id !== sheet.id ? sh : {
      ...sh,
      nets: sh.nets.map((net) => net.id === netId ? { ...net, name } : net),
    })
    await saveCf({ ...cf, sheets: nextSheets }, 'rename_net', { sheetId: sheet.id, netId, name })
  }

  const activeSelectionFor = (codeId) => {
    if (selectedCodeIds.has(codeId) && selectedCodeIds.size > 1) return new Set(selectedCodeIds)
    return new Set([codeId])
  }

  const reorderCode = async (codeId, direction) => {
    const ids = activeSelectionFor(codeId)
    const movingCodes = codes.filter((c) => ids.has(c.id))
    if (!movingCodes.length) return
    const nextSheets = cf.sheets.map((sh) => {
      if (sh.id !== sheet.id) return sh
      const netsCopy = sh.nets.map((n) => ({ ...n, codes: [...(n.codes || [])] }))
      for (const net of netsCopy) {
        if (direction === 'top') {
          net.codes = [...net.codes.filter((c) => ids.has(c.id)), ...net.codes.filter((c) => !ids.has(c.id))]
        } else if (direction === 'bottom') {
          net.codes = [...net.codes.filter((c) => !ids.has(c.id)), ...net.codes.filter((c) => ids.has(c.id))]
        } else if (direction === 'up') {
          for (let i = 1; i < net.codes.length; i++) {
            if (ids.has(net.codes[i].id) && !ids.has(net.codes[i - 1].id)) {
              const tmp = net.codes[i - 1]
              net.codes[i - 1] = net.codes[i]
              net.codes[i] = tmp
            }
          }
        } else {
          for (let i = net.codes.length - 2; i >= 0; i--) {
            if (ids.has(net.codes[i].id) && !ids.has(net.codes[i + 1].id)) {
              const tmp = net.codes[i + 1]
              net.codes[i + 1] = net.codes[i]
              net.codes[i] = tmp
            }
          }
        }
      }
      return { ...sh, nets: netsCopy }
    })
    await saveCf({ ...cf, sheets: nextSheets }, direction === 'top' ? 'move_code_top' : direction === 'bottom' ? 'move_code_bottom' : direction === 'up' ? 'move_code_up' : 'move_code_down', { sheetId: sheet.id, codes: movingCodes, direction })
    setContextMenu(null)
  }

  const renameCode = async (codeId, draft) => {
    const before = codes.find((c) => c.id === codeId)
    if (!before) return
    const nextSheets = cf.sheets.map((sh) => sh.id !== sheet.id ? sh : {
      ...sh,
      nets: sh.nets.map((net) => ({
        ...net,
        codes: net.codes.map((code) => code.id === codeId ? { ...code, ...draft } : code),
      })),
    })
    await saveCf({ ...cf, sheets: nextSheets }, 'rename_code', { sheetId: sheet.id, before, after: draft })
    setEditing(null)
  }

  const mergeCode = async (sourceId, targetId) => {
    if (!sourceId || !targetId) return
    const sourceIds = activeSelectionFor(sourceId)
    sourceIds.delete(targetId)
    if (!sourceIds.size) return
    const sources = codes.filter((c) => sourceIds.has(c.id))
    const target = codes.find((c) => c.id === targetId)
    if (!sources.length || !target) return
    const nextFreq = { ...(cf.reviewFreqByCode || {}) }
    const sheetFreq = { ...(nextFreq[sheet.id] || {}) }
    for (const sid of sourceIds) {
      sheetFreq[targetId] = (sheetFreq[targetId] || 0) + (sheetFreq[sid] || 0)
      delete sheetFreq[sid]
    }
    nextFreq[sheet.id] = sheetFreq
    const nextSheets = cf.sheets.map((sh) => sh.id !== sheet.id ? sh : {
      ...sh,
      assignments: Object.fromEntries(Object.entries(sh.assignments || {}).map(([key, ids]) => [key, [...new Set((ids || []).map((id) => sourceIds.has(id) ? targetId : id))]])),
      nets: sh.nets.map((net) => ({ ...net, codes: net.codes.filter((code) => !sourceIds.has(code.id)) })),
    })
    await saveCf({ ...cf, sheets: nextSheets, reviewFreqByCode: nextFreq }, 'merge_code', { sheetId: sheet.id, sources, target })
    setSelectedCodeIds(new Set([targetId]))
    setMergeOpen(null)
    setContextMenu(null)
  }

  const moveCode = async (codeId, targetNetId) => {
    const ids = activeSelectionFor(codeId)
    const movingCodes = codes.filter((c) => ids.has(c.id))
    const targetNet = nets.find((n) => n.id === targetNetId)
    if (!movingCodes.length || !targetNet) return
    const nextSheets = cf.sheets.map((sh) => sh.id !== sheet.id ? sh : {
      ...sh,
      nets: sh.nets.map((net) => {
        if (net.id === targetNetId) return { ...net, codes: [...(net.codes || []).filter((c) => !ids.has(c.id)), ...movingCodes.map((c) => ({ ...c, netId: undefined, netName: undefined }))] }
        return { ...net, codes: (net.codes || []).filter((c) => !ids.has(c.id)) }
      }),
    })
    await saveCf({ ...cf, sheets: nextSheets }, 'move_code', { sheetId: sheet.id, codes: movingCodes, toNetId: targetNetId })
    setSelectedCodeIds(new Set([...ids]))
    setMoveOpen(null)
    setContextMenu(null)
  }

  const openCodeComment = (code) => {
    if (!code) return
    setCommentDraft('')
    setCommentModal({ code })
    setContextMenu(null)
  }

  const submitCodeComment = async () => {
    const code = commentModal?.code
    if (!code || !commentDraft.trim()) return
    const name = reviewer.trim() || localStorage.getItem('cof-reviewer-name') || 'CI Reviewer'
    setBusy('code_comment')
    try {
      await addDoc(collection(db, 'review_audit'), {
        token,
        codeframeId: cf.id,
        projectId: link?.projectId || cf.projectId || '',
        action: 'code_comment',
        reviewer: name,
        payload: {
          sheetId: sheet?.id || '',
          sheetName: sheet?.name || '',
          codeId: code.id,
          codeNo: code.codeNo || '',
          label: code.thai || code.eng || code.english || '',
          comment: commentDraft.trim(),
        },
        createdAt: serverTimestamp(),
      })
      localStorage.setItem('cof-reviewer-name', name)
      setReviewer(name)
      setCommentDraft('')
      setCommentModal(null)
    } finally {
      setBusy('')
    }
  }


  const cleanReviewQuestions = (items = [], sh = {}) => {
    const seen = new Set()
    const isOth = (v) => /(?:^|[_-])(oth\d*|other|spec\d*|specify|text|open)(?:$|[_-]|\d)/i.test(String(v || '')) || String(v || '').toLowerCase().includes('_oth')
    return (Array.isArray(items) ? items : [])
      .filter((q) => !isOth(q?.code) && !isOth(q?.column) && !isOth(q?.label))
      .map((q) => ({ column: q.code || q.column || q.label || sh.name, label: q.label || q.question || q.text || '' }))
      .filter((q) => {
        const key = `${String(q.column || '').trim()}::${String(q.label || '').trim()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  const exportReviewCodeframe = async () => {
    if (!cf?.sheets?.length) return
    await exportCodeframe(
      cf,
      { jobNo: '', name: jobName },
      (sh) => STATUS_HEX[sheetHasNewCode(sh) ? 'green' : 'gray'],
      (sh) => {
        const snapshotQs = cleanReviewQuestions(cf.reviewSheetQuestions?.[sh.id] || link?.reviewSheetQuestions?.[sh.id] || [], sh)
        const sheetQs = cleanReviewQuestions(sh.questions || [], sh)
        const textQs = cleanReviewQuestions(sh.questionTexts || [], sh)
        const fallbackQ = cleanReviewQuestions([{
          column: shortSheetName(sh.name || sh.title || ''),
          label: sh.title || sh.questionText || sh.questionLabel || sh.label || sh.question || '',
        }], sh)
        const qs = snapshotQs.length ? snapshotQs : sheetQs.length ? sheetQs : textQs.length ? textQs : fallbackQ
        return { name: sh.name, questions: qs }
      },
      { freqByCode: cf.reviewFreqByCode || {} },
    )
    await logAudit('export_codeframe', { file: `${codeframeName}.xlsx`, sheetCount: cf.sheets.length, sharedExporter: true }).catch(() => {})
  }

  const confirmReviewDone = async (noteText = confirmNote) => {
    const name = reviewer.trim() || localStorage.getItem('cof-reviewer-name') || 'CI Reviewer'
    const editEmail = link?.emailInvite?.editEmail || link?.editEmail || ''
    const ciEmail = link?.emailInvite?.ciEmail || ''
    const confirmedAtText = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
    const note = String(noteText || '').trim() || 'ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ'
    setConfirmSending(true)
    try {
      localStorage.setItem('cof-reviewer-name', name)
      setReviewer(name)
      await updateDoc(doc(db, 'review_links', token), {
        confirmedAt: nowMs(),
        confirmedBy: name,
        confirmEmailTo: editEmail || '',
        confirmNote: note,
        confirmStatus: editEmail ? 'sending' : 'no_edit_email',
      })
      await logAudit('review_confirm', { confirmedBy: name, editEmail: editEmail || '', ciEmail: ciEmail || '', note })
      if (!editEmail) {
        setConfirmNotice({ type: 'warning', title: 'บันทึก Confirm แล้ว', message: 'แต่ลิงก์นี้ยังไม่มี Send from Email ของ Edit จึงยังส่งเมลกลับไม่ได้' })
        await updateDoc(doc(db, 'review_links', token), { confirmStatus: 'no_edit_email' })
        return
      }
      const res = await fetch(apiUrl('/api/send-ci-confirm-email'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editEmail,
          reviewer: name,
          ciEmail,
          reviewUrl: `${window.location.origin}${window.location.pathname}#/review/${token}`,
          jobName,
          codeframeName,
          confirmedAt: confirmedAtText,
          note,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `ส่งเมล Confirm ไม่สำเร็จ HTTP ${res.status}`)
      await updateDoc(doc(db, 'review_links', token), {
        confirmStatus: 'emailed',
        confirmEmailSentAt: nowMs(),
        confirmEmailId: data.id || '',
        confirmNote: note,
      })
      setConfirmModalOpen(false)
      setConfirmNotice({ type: 'success', title: 'ยืนยันการตรวจเสร็จแล้ว', message: `ส่งเมลแจ้ง Edit แล้ว: ${editEmail}` })
    } catch (err) {
      try { await updateDoc(doc(db, 'review_links', token), { confirmStatus: 'email_failed', confirmError: err.message || String(err) }) } catch { /* ignore secondary status update failure */ }
      setConfirmNotice({ type: 'warning', title: 'บันทึก Confirm แล้ว แต่ส่งเมลไม่สำเร็จ', message: err.message || String(err) })
    } finally {
      setConfirmSending(false)
    }
  }


  if (loading) return <div className="min-h-screen bg-slate-50 p-8 text-center text-slate-500">กำลังโหลด CI Review…</div>
  if (error) return <div className="min-h-screen bg-slate-50 p-8 text-center text-rose-600">{error}</div>
  if (!cf || !sheet) return <div className="min-h-screen bg-slate-50 p-8 text-center text-slate-500">ไม่พบ Codeframe</div>

  const jobName = link?.projectName || cf.reviewProjectName || cf.projectName || link?.projectId || cf.projectId || 'Job'
  const codeframeName = link?.codeframeName || cf.name || 'Codeframe Review'
  const confirmedAt = link?.confirmedAt
  const editEmailForConfirm = link?.emailInvite?.editEmail || link?.editEmail || ''

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 xl:px-5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-200">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-500">CI Codeframe Review · Rawdata Hidden</p>
            <h1 className="truncate text-base font-black text-slate-900">{jobName}</h1>
            <p className="truncate text-xs font-bold text-slate-500">{codeframeName}</p>
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {confirmedAt ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Confirmed · {formatDate(confirmedAt)}</span>
            ) : (
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">Realtime</span>
            )}
            <button
              type="button"
              disabled={confirmSending || !!confirmedAt}
              onClick={() => { setConfirmNote('ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ'); setConfirmModalOpen(true) }}
              title={editEmailForConfirm ? `ส่งเมลยืนยันกลับไปที่ ${editEmailForConfirm}` : 'ลิงก์นี้ยังไม่มี Send from Email ของ Edit'}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2 text-xs font-black text-white shadow-sm shadow-emerald-200 hover:from-emerald-600 hover:to-teal-600 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Check size={14} /> {confirmSending ? 'กำลังยืนยัน…' : confirmedAt ? 'ยืนยันแล้ว' : 'ยืนยันว่าตรวจเสร็จแล้ว'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex h-[calc(100vh-4.25rem)] max-w-7xl min-w-0 flex-col px-4 py-4 xl:px-5 xl:py-5">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
            <div className="mb-3 flex min-w-0 shrink-0 flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
                โครง Codeframe <span className="text-slate-400">({nets.filter((n) => n.level >= 1).length} Net · {codeCount} Code)</span>
              </h2>
              <div className="flex items-center overflow-hidden rounded-lg border border-slate-200" title={selectedCodeIds.size ? 'ย้ายลำดับ Code ที่เลือก' : 'เลือก Code ก่อน แล้วใช้ปุ่มนี้ย้ายลำดับ'}>
                <button disabled={!selectedCodeIds.size} onClick={() => reorderCode([...selectedCodeIds][0], 'top')} title="ย้ายขึ้นบนสุด" className="cursor-pointer px-1.5 py-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"><ChevronsUp size={14} /></button>
                <button disabled={!selectedCodeIds.size} onClick={() => reorderCode([...selectedCodeIds][0], 'up')} title="ย้ายขึ้น" className="cursor-pointer border-l border-slate-200 px-1.5 py-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"><ChevronUp size={14} /></button>
                <button disabled={!selectedCodeIds.size} onClick={() => reorderCode([...selectedCodeIds][0], 'down')} title="ย้ายลง" className="cursor-pointer border-l border-slate-200 px-1.5 py-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"><ChevronDown size={14} /></button>
                <button disabled={!selectedCodeIds.size} onClick={() => reorderCode([...selectedCodeIds][0], 'bottom')} title="ย้ายลงล่างสุด" className="cursor-pointer border-l border-slate-200 px-1.5 py-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"><ChevronsDown size={14} /></button>
              </div>
              <button
                type="button"
                onClick={exportReviewCodeframe}
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-2 text-xs font-black text-white shadow-sm shadow-indigo-200 hover:from-indigo-700 hover:to-violet-700 active:scale-[0.99]"
                title="Export เฉพาะ Codeframe/Frequency ไม่มี Rawdata"
              >
                <Download size={14} /> Export Codeframe
              </button>
              <p className="text-[11px] font-semibold text-slate-400">Ctrl/Shift เลือกหลาย Code ได้ · ดับเบิลคลิกแก้ cell · คลิกขวาเปิดเมนู · Rawdata hidden</p>
              {selectedCodeIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCodeIds(new Set())}
                  className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700 hover:bg-indigo-100"
                >
                  เลือกอยู่ {selectedCodeIds.size} Code · ล้าง
                </button>
              )}
            </div>

            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <input
                value={codeSearch}
                onChange={(e) => setCodeSearch(e.target.value)}
                placeholder="Search Code No. / Thai / English…"
                className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              {[
                ['all', 'ทั้งหมด'],
                ['freq', 'มี Frequency'],
                ['new', 'Code ใหม่'],
                ['zero', 'Freq = 0'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setCodeFilter(id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${codeFilter === id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {label}
                </button>
              ))}
              {(codeSearch || codeFilter !== 'all') && (
                <button onClick={() => { setCodeSearch(''); setCodeFilter('all') }} className="text-xs font-bold text-slate-400 hover:text-rose-500">ล้าง</button>
              )}
            </div>

            {sheetTitle && (
              <div className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                <p className="text-[11px] font-semibold text-slate-400">โจทย์</p>
                <p className="text-sm font-bold text-slate-800">
                  <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-600">{sheetTitle.code}</span>
                  {sheetTitle.label || sheet.name}
                </p>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-[#dbe5f1] shadow-sm">
              <table className="w-full border-separate border-spacing-0 bg-white text-left text-xs [&_td]:border-b [&_td]:border-r [&_td]:border-slate-100 [&_th]:border-r [&_th]:border-slate-200">
                <thead>
                  <tr className="text-[11px] font-bold text-slate-600">
                    <th className="sticky top-0 z-20 w-28 border-b border-slate-200 bg-[#dbe5f1] px-3 py-2">Code No.</th>
                    <th className="sticky top-0 z-20 border-b border-slate-200 bg-[#dbe5f1] px-2 py-2">ThaiGroup</th>
                    <th className="sticky top-0 z-20 hidden border-b border-slate-200 bg-[#dbe5f1] px-2 py-2 lg:table-cell">ThaiGroup2</th>
                    <th className="sticky top-0 z-20 hidden border-b border-slate-200 bg-[#dbe5f1] px-2 py-2 xl:table-cell">English</th>
                    <th className="sticky top-0 z-20 w-24 border-b border-slate-200 bg-[#dbe5f1] px-2 py-2 text-center">คำตอบ</th>
                    <th className="sticky top-0 z-20 w-9 border-b border-slate-200 bg-[#dbe5f1]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {nets.map((net) => {
                    const lv = net.level >= 1 ? net.level : 0
                    const netEditing = editingCell?.codeId === net.id && editingCell?.field === 'netname'
                    return (
                      <Fragment key={net.id}>
                        {lv >= 1 && (
                          <tr className="bg-indigo-50/70">
                            <td colSpan={6} className="px-3 py-2">
                              <div className="flex items-center gap-2" style={lv > 1 ? { paddingLeft: `${(lv - 1) * 20}px` } : undefined}>
                                <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500">Net :</span>
                                {netEditing ? (
                                  <input
                                    autoFocus
                                    value={net.name || ''}
                                    placeholder="ชื่อ Net…"
                                    onChange={(e) => updateNetName(net.id, e.target.value)}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditingCell(null) } }}
                                    className="min-w-0 flex-1 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-bold text-indigo-900 outline-none ring-2 ring-indigo-100"
                                  />
                                ) : (
                                  <span
                                    onDoubleClick={() => setEditingCell({ codeId: net.id, field: 'netname' })}
                                    title="ดับเบิลคลิกเพื่อแก้ไข"
                                    className={`min-w-0 flex-1 cursor-text truncate text-sm font-bold ${net.name ? 'text-indigo-900' : 'text-indigo-300'}`}
                                  >
                                    {net.name || 'ชื่อ Net…'}
                                  </span>
                                )}
                                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-600">{net.codes.length} Code</span>
                              </div>
                            </td>
                          </tr>
                        )}
                        {net.codes.filter(codeVisible).map((code) => {
                          const n = freqOf(code)
                          const isNew = !!code.aiNew || !!code.manualNew
                          const editingField = editingCell?.codeId === code.id ? editingCell.field : null
                          const startCellEdit = (field) => setEditingCell({ codeId: code.id, field })
                          const stopEdit = () => setEditingCell(null)
                          return (
                            <tr
                              key={code.id}
                              onClick={(e) => selectSingleOrRange(e, code.id)}
                              onContextMenu={(e) => openCodeMenu(e, code.id)}
                              className={`group/row cursor-pointer select-none transition-colors ${selectedCodeIds.has(code.id) ? 'bg-indigo-100 outline outline-1 -outline-offset-1 outline-indigo-300' : isNew ? 'bg-amber-100 [&_td:first-child]:border-l-4 [&_td:first-child]:border-l-amber-500 hover:bg-amber-200' : 'hover:bg-slate-50'}`}
                            >
                              <td className="px-3 py-1">
                                <CodeCell mono editing={editingField === 'codeNo'} value={code.codeNo} placeholder="—" onStart={() => startCellEdit('codeNo')} onStop={stopEdit} onChange={(v) => updateCodeField(net.id, code.id, { codeNo: v })} />
                              </td>
                              <td className="px-2 py-1">
                                <CodeCell editing={editingField === 'thai'} value={code.thai} placeholder="ข้อความรหัส (ภาษาไทย)" onStart={() => startCellEdit('thai')} onStop={stopEdit} onChange={(v) => updateCodeField(net.id, code.id, { thai: v })} />
                              </td>
                              <td className="hidden px-2 py-1 lg:table-cell">
                                <CodeCell editing={editingField === 'thai2'} value={code.thai2 ?? ''} placeholder="—" onStart={() => startCellEdit('thai2')} onStop={stopEdit} onChange={(v) => updateCodeField(net.id, code.id, { thai2: v })} />
                              </td>
                              <td className="hidden px-2 py-1 xl:table-cell">
                                <CodeCell editing={editingField === 'eng'} value={code.eng ?? code.english ?? ''} placeholder="English label" onStart={() => startCellEdit('eng')} onStop={stopEdit} onChange={(v) => updateCodeField(net.id, code.id, { eng: v, english: v })} />
                              </td>
                              <td className="px-2 py-1 text-center">
                                {n > 0 ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-700">{n.toLocaleString('th-TH')}</span> : <span className="text-slate-200">0</span>}
                              </td>
                              <td className="px-1 py-1 text-center">
                                <button
                                  type="button"
                                  title="คลิกขวา / เมนู"
                                  onClick={(e) => { setSelectedCodeIds((prev) => prev.has(code.id) ? prev : new Set([code.id])); setLastClickedCodeId(code.id); setContextMenu({ x: e.clientX - 220, y: e.clientY + 8, codeId: code.id }) }}
                                  className="cursor-pointer rounded p-1 text-slate-200 opacity-0 hover:bg-indigo-50 hover:text-indigo-600 group-hover/row:opacity-100"
                                >
                                  <MoreHorizontal size={13} />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 shrink-0 border-t border-slate-200 bg-slate-100 px-2 pt-1">
              <div className="flex h-9 max-w-full min-w-0 items-end gap-2">
                <div className="mb-0.5 flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => scrollSheetTabs(-1)}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border border-slate-300 bg-white text-sm font-black text-slate-600 shadow-sm hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 active:scale-95"
                    title="เลื่อนชีทไปทางซ้าย"
                  >‹</button>
                  <button
                    type="button"
                    onClick={() => scrollSheetTabs(1)}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border border-slate-300 bg-white text-sm font-black text-slate-600 shadow-sm hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 active:scale-95"
                    title="เลื่อนชีทไปทางขวา"
                  >›</button>
                </div>
                <div
                  ref={sheetTabsRef}
                  className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scroll-smooth pr-2 [scrollbar-width:thin]"
                >
                  {(cf.sheets || []).map((s) => {
                    const active = s.id === sheet.id
                    const status = sheetHasNewCode(s) ? 'green' : 'gray'
                    const st = REVIEW_SHEET_STATUS[status] || REVIEW_SHEET_STATUS.gray
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setActiveSheetId(s.id)}
                        className={`group relative flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-t-md border border-b-0 px-2.5 text-[11px] font-semibold shadow-sm transition-colors ${active ? `${st.active} -mb-px h-8 px-3 shadow-md` : `${st.tab} hover:-translate-y-0.5 hover:shadow`}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-white/85' : st.dot}`} />
                        <span className="max-w-28 truncate">Code {shortSheetName(s.name)}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="mb-0.5 flex shrink-0 items-center gap-1.5">
                  <span className="flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-500">Rawdata hidden</span>
                </div>
              </div>
            </div>
          </div>
        </section>



        {confirmModalOpen && !confirmSending && (
          <div className="fixed inset-0 z-[74] grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmModalOpen(false) }}>
            <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl shadow-slate-950/25">
              <div className="bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500 px-5 py-5 text-white">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/25">
                    <Check size={26} />
                  </span>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/80">CI Confirm</p>
                    <h3 className="text-lg font-black">ยืนยันว่าตรวจเสร็จแล้ว</h3>
                  </div>
                </div>
              </div>
              <div className="space-y-4 px-5 py-5">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-relaxed text-emerald-900">
                  ข้อความนี้จะถูกบันทึกไว้ในระบบ และส่งกลับไปหา Edit: <span className="font-black">{editEmailForConfirm || 'ยังไม่มี Send from Email ของ Edit'}</span>
                </div>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">คำอธิบายจาก CI</span>
                  <textarea
                    autoFocus
                    value={confirmNote}
                    onChange={(e) => setConfirmNote(e.target.value)}
                    rows={5}
                    placeholder="เช่น ตรวจเรียบร้อยแล้วค่ะ ขอบคุณค่ะ"
                    className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold leading-relaxed text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
                <button type="button" onClick={() => setConfirmModalOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-100">ยกเลิก</button>
                <button type="button" onClick={() => confirmReviewDone(confirmNote)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2 text-sm font-black text-white shadow-sm shadow-emerald-200 hover:from-emerald-600 hover:to-teal-600">
                  <Check size={16} /> ส่งยืนยันให้ Edit
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmSending && (
          <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/50 px-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl border border-white/30 bg-white p-6 text-center shadow-2xl shadow-emerald-950/25">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                <span className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
              </div>
              <h3 className="mt-4 text-lg font-black text-slate-900">กำลังส่ง Confirm ให้ Edit</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">กรุณารอสักครู่ ระบบกำลังบันทึกและส่งอีเมล</p>
            </div>
          </div>
        )}

        {confirmNotice && (
          <div className="fixed inset-0 z-[76] grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl shadow-slate-950/25">
              <div className={`px-5 py-5 text-white ${confirmNotice.type === 'success' ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-gradient-to-r from-amber-500 to-orange-500'}`}>
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20">
                    <Check size={26} />
                  </span>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/80">CI Confirm</p>
                    <h3 className="text-lg font-black">{confirmNotice.title}</h3>
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 text-sm font-semibold leading-relaxed text-slate-600">
                {confirmNotice.message}
              </div>
              <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-3">
                <button type="button" onClick={() => setConfirmNotice(null)} className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-black text-white hover:bg-slate-700">OK</button>
              </div>
            </div>
          </div>
        )}

        {commentModal && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/35 px-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) setCommentModal(null) }}>
            <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-indigo-100 bg-white shadow-2xl shadow-indigo-950/20">
              <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-4 text-white">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                    <MessageSquare size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-100">CI Code Comment</p>
                    <h3 className="truncate text-base font-black">เพิ่ม Comment ให้ Code นี้</h3>
                    <p className="mt-1 truncate text-xs font-semibold text-indigo-100">Code {commentModal.code.codeNo || '—'} · {commentModal.code.thai || commentModal.code.eng || commentModal.code.english || 'ไม่มี label'}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3 px-5 py-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-black text-slate-500">ชื่อผู้รีวิว / CI</span>
                  <input
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    placeholder="เช่น CI Team / ชื่อลูกค้า"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-black text-slate-500">Comment</span>
                  <textarea
                    autoFocus
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="พิมพ์ Comment ของ CI สำหรับ Code นี้…"
                    rows={5}
                    className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium leading-relaxed text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitCodeComment()
                      if (e.key === 'Escape') setCommentModal(null)
                    }}
                  />
                </label>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  Comment นี้จะไปขึ้นแจ้งเตือนในหน้า Codeframe Edit ที่ Code เดียวกันแบบ realtime
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setCommentModal(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={submitCodeComment}
                  disabled={busy === 'code_comment' || !commentDraft.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <MessageSquare size={15} /> {busy === 'code_comment' ? 'กำลังส่ง…' : 'ส่ง Comment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {contextMenu ? (() => {
          const code = codes.find((c) => c.id === contextMenu.codeId)
          if (!code) return null
          const itemCls = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-black text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
          return (
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)}>
              <div
                className="absolute w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-300/50"
                style={{ left: Math.min(contextMenu.x, window.innerWidth - 240), top: Math.min(contextMenu.y, window.innerHeight - 260) }}
                onClick={(e) => e.stopPropagation()}
              >
                <p className="mb-1 truncate px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-indigo-400">Code {code.codeNo || '—'}</p>
                <button className={itemCls} onClick={() => startEdit(code)}><Pencil size={14} /> แก้ Code / Label</button>
                <button className={itemCls} onClick={() => openCodeComment(code)}><MessageSquare size={14} /> เพิ่ม Comment ให้ Code นี้</button>
                <button className={itemCls} onClick={() => reorderCode(code.id, 'up')}><ArrowUp size={14} /> โยกขึ้น</button>
                <button className={itemCls} onClick={() => reorderCode(code.id, 'down')}><ArrowDown size={14} /> โยกลง</button>
                <div className="my-1 border-t border-slate-100" />
                <label className="block px-3 py-1 text-[11px] font-black text-amber-600">ย้ายไป Net อื่น</label>
                <select
                  defaultValue=""
                  onChange={(e) => moveCode(code.id, e.target.value)}
                  className="mb-2 w-full rounded-lg border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-800 outline-none"
                >
                  <option value="" disabled>เลือก Net…</option>
                  {nets.filter((n) => n.id !== code.netId).map((n) => <option key={n.id} value={n.id}>{n.name || n.label || 'Main'}</option>)}
                </select>
                <label className="block px-3 py-1 text-[11px] font-black text-violet-600">รวม Code</label>
                <select
                  defaultValue=""
                  onChange={(e) => mergeCode(code.id, e.target.value)}
                  className="w-full rounded-lg border border-violet-100 bg-violet-50 px-2 py-1.5 text-xs font-bold text-violet-800 outline-none"
                >
                  <option value="" disabled>รวมเข้า Code…</option>
                  {codes.filter((c) => c.id !== code.id).map((c) => <option key={c.id} value={c.id}>{c.codeNo} · {c.thai || c.eng || c.english || '—'}</option>)}
                </select>
              </div>
            </div>
          )
        })() : null}
      </main>
    </div>
  )
}
