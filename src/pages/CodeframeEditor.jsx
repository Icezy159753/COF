/* eslint-disable no-unused-vars, react-hooks/set-state-in-effect */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Download, Upload, Wand2, ListTree, Group,
  Settings2, X, FileSpreadsheet, CornerDownRight, Sparkles, Link2, ChevronDown,
  Pencil, Combine, FolderInput, FolderPlus, CheckSquare, Square, Check, HelpCircle,
  ChevronUp, ChevronsUp, ChevronsDown, MoreHorizontal, Bell, MessageSquare, Undo2, Redo2,
} from 'lucide-react'
import { useStore, useRawdata, uid, LoadingAnimation } from '../store.jsx'
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { isLocalUxPreview } from '../lib/auth.jsx'
import { parseFrameFile, exportCodeframe, exportCodeframeSheet, exportCodedData, exportQuestionList, buildOverwrittenRawdata } from '../lib/excel.js'
import {
  uniqueAnswers, autoAssign, buildCodeframeFromAnswers,
  assembleNetsFromGrouping, assembleCodingResult, buildCodeframeAdvanced, previewAdvanced,
} from '../lib/answers.js'
import { aiGroupCodes, aiCodeAnswers, aiReviewAnswers, aiGroupCE } from '../lib/aiGroup.js'
import { findOtherColumns, scopedVerbatimQuestionIds, isOtherLabel, shortSheetName, closedQuestionGroupColumns, closedQuestionGroup, questionGroupBase, otherColumnsForCode, otherCodeFromColumnLabel } from '../lib/boxes.js'
import {
  Button, Modal, Field, TextInput, Badge, BoxBadge, ConfirmDelete, Toast,
} from '../components/ui.jsx'

const nowMs = () => Date.now()
const normalizeRuleText = (v) => String(v ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()

// สีสถานะของแต่ละชีท (ตาม "อื่นๆ ระบุ") — ใช้กับแท็บชีทและคำอธิบาย
const SHEET_STATUS = {
  orange: {
    label: 'มีคำตอบ "อื่นๆ" รอจัดเข้า Code',
    desc: 'มีคนตอบ "อื่นๆ ระบุ" และมีข้อความรอจัดกลุ่ม — ยังไม่ได้โยกเข้า Codeframe',
    dot: 'bg-amber-500',
    tab: 'border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400',
    active: 'border-amber-500 bg-amber-500 text-white shadow-sm',
    swatch: 'bg-amber-400',
  },
  red: {
    label: 'มีคนตอบ "อื่นๆ" แต่ไม่มีช่องข้อความ',
    desc: 'มีความถี่ของ Code "อื่นๆ ระบุ" แต่ไม่มีข้อ Text ต่อท้าย — โค้ดข้อความไม่ได้ ควรตรวจสอบ',
    dot: 'bg-rose-500',
    tab: 'border-rose-300 bg-rose-50 text-rose-900 hover:border-rose-400',
    active: 'border-rose-500 bg-rose-500 text-white shadow-sm',
    swatch: 'bg-rose-500',
  },
  gray: {
    label: 'ไม่มีคนตอบ "อื่นๆ" (มีช่องข้อความ)',
    desc: 'มี Code "อื่นๆ ระบุ" + มีข้อ Text ต่อท้าย แต่ไม่มีความถี่ (ไม่มีใครเลือกอื่นๆ) — ไม่ต้องทำอะไร',
    dot: 'bg-slate-400',
    tab: 'border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300',
    active: 'border-slate-500 bg-slate-500 text-white shadow-sm',
    swatch: 'bg-slate-400',
  },
  maroon: {
    label: 'ไม่มีคนตอบ "อื่นๆ" (ไม่มีช่องข้อความ)',
    desc: 'มี Code "อื่นๆ ระบุ" แต่ไม่มีข้อ Text ต่อท้าย และไม่มีความถี่ — ไม่ต้องทำอะไร',
    dot: 'bg-rose-800',
    tab: 'border-stone-300 bg-stone-100 text-rose-900/80 hover:border-stone-400',
    active: 'border-rose-900 bg-rose-900 text-white shadow-sm',
    swatch: 'bg-rose-800',
  },
  green: {
    label: 'จัด Code "อื่นๆ" ครบแล้ว',
    desc: 'คำตอบ "อื่นๆ" ถูกจัดเข้า Codeframe หมดแล้ว ✓',
    dot: 'bg-emerald-500',
    tab: 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-emerald-400',
    active: 'border-emerald-500 bg-emerald-500 text-white shadow-sm',
    swatch: 'bg-emerald-500',
  },
  hidden: {
    label: 'ซ่อน Codeframe แล้ว',
    desc: 'ซ่อนชีทที่ยังไม่ต้องดูไว้ก่อน — ถ้าอัปชุดใหม่แล้วมี Other/Frequency จะเปลี่ยนสีจริงและเด้งออกมาเอง',
    dot: 'bg-slate-500',
    tab: 'border-slate-300 bg-slate-200 text-slate-500 opacity-80 hover:border-slate-400',
    active: 'border-slate-600 bg-slate-600 text-white shadow-sm',
    swatch: 'bg-slate-500',
  },
  none: {
    label: 'ไม่มี Code "อื่นๆ ระบุ"',
    desc: 'ชีทนี้ไม่มีตัวเลือก "อื่นๆ ระบุ"',
    dot: 'bg-slate-300',
    tab: 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300',
    active: 'border-indigo-500 bg-indigo-600 text-white shadow-sm',
    swatch: 'bg-slate-300',
  },
}

// hex สีของแต่ละสถานะ — ใช้ลงสีแถบชีท (tab) ในไฟล์ Excel ที่ export
const STATUS_HEX = { orange: 'F59E0B', red: 'EF4444', maroon: '9F1239', gray: '94A3B8', hidden: '64748B', green: '10B981', none: 'CBD5E1' }

// ลำดับชั้นของ Net (1=Net … 5=Subsubsubsubnet) · level 0 = ยังไม่จัด Net (ไม่มีหัวข้อ)
const NET_LEVELS = [
  { level: 1, label: 'Net' },
  { level: 2, label: 'Subnet' },
  { level: 3, label: 'Subsubnet' },
  { level: 4, label: 'Subsubsubnet' },
  { level: 5, label: 'Subsubsubsubnet' },
]
const NET_LABEL = { 1: 'Net', 2: 'Subnet', 3: 'Subsubnet', 4: 'Subsubsubnet', 5: 'Subsubsubsubnet' }

function normalizeCodeLabel(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9ก-๙]/g, '')
}

function aiTokens(value) {
  return String(value ?? '')
    .trim()
    .replace(/^(คุณ|นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ดร\.?|ครู|อาจารย์)\s*/i, '')
    .replace(/(พรีเซ็นเตอร์|presenter|ชื่อ|คนชื่อ|คือ|เป็น|น่าจะ|น่าจะเป็น)/gi, ' ')
    .replace(/[()[\]{}"'“”‘’.,;:!?/\\|_+=*#@~`<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && normalizeCodeLabel(t).length >= 2)
}

function canonicalAiNeoLabel(value) {
  const first = aiTokens(value)[0]
  return first || String(value ?? '').trim() || 'อื่น ๆ'
}

function looseAiKey(value) {
  return normalizeCodeLabel(value)
    .replace(/[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/g, '')
    .replace(/[ญย]/g, 'ย')
    .replace(/^บ/, 'ป')
}

function isNonAnswerLabel(value) {
  const norm = normalizeCodeLabel(value)
  return /(ไม่ทราบ|ไม่รู้|จำไม่ได้|จำไมได้|นึกไม่ออก|ไม่แน่ใจ|ไม่ระบุ|ไม่ได้ระบุ|dontknow|donotknow|dk|unknown|notremember|notstated|notspecified)/i.test(norm)
}

function aiNeoMatchesCode(neoLabel, codeLabel) {
  // Code non-answer เช่น “ไม่ทราบ/จำไม่ได้” ใช้ได้เฉพาะเมื่อคำตอบเองเป็น non-answer เท่านั้น
  // ไม่ให้ชื่อคน/แบรนด์อย่าง “บอนด์” ถูกตบเข้า code 99
  if (isNonAnswerLabel(codeLabel)) return isNonAnswerLabel(neoLabel)
  if (isNonAnswerLabel(neoLabel)) return false
  const a = looseAiKey(neoLabel)
  const b = looseAiKey(codeLabel)
  if (!a || !b) return false
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 3 && (longer.startsWith(shorter) || longer.includes(shorter)) && longer.length - shorter.length <= 4
}

function pickBestExistingCodeForText(text, reusableCodes, countByCode = {}) {
  if (isNonAnswerLabel(text)) return null
  const candidates = [canonicalAiNeoLabel(text), ...aiTokens(text), String(text ?? '').trim()]
    .filter(Boolean)
  return reusableCodes
    .filter(({ code }) => !isNonAnswerLabel(code.thai || code.codeNo))
    .map((item) => {
      const label = item.code.thai || item.code.codeNo
      const matched = candidates.some((token) => aiNeoMatchesCode(token, label)) || aiNeoMatchesCode(text, label)
      if (!matched) return null
      const count = countByCode[item.code.id] ?? 0
      const exact = candidates.some((token) => looseAiKey(token) === looseAiKey(label)) ? 1 : 0
      return { ...item, _score: exact * 1_000_000 + count * 100 - String(label).length }
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score)[0] || null
}

function canonicalFullAiLabel(value) {
  const tokens = aiTokens(value)
  if (tokens.length < 2) return ''
  return tokens.slice(0, 2).join(' ')
}

function shouldPromoteCodeLabel(currentLabel, candidateLabel) {
  if (!candidateLabel || isNonAnswerLabel(currentLabel) || isNonAnswerLabel(candidateLabel)) return false
  const curTokens = aiTokens(currentLabel)
  const candTokens = aiTokens(candidateLabel)
  if (candTokens.length < 2 || candTokens.length <= curTokens.length) return false
  const cur = curTokens[0] || currentLabel
  return candTokens.some((t) => aiNeoMatchesCode(t, cur)) || aiNeoMatchesCode(cur, candTokens[0])
}

function codeLooksLikeAliasOf(aliasLabel, mainLabel) {
  if (!aliasLabel || !mainLabel || isNonAnswerLabel(aliasLabel) || isNonAnswerLabel(mainLabel)) return false
  if (aiNeoMatchesCode(aliasLabel, mainLabel)) return true
  const aliasTokens = aiTokens(aliasLabel)
  const mainTokens = aiTokens(mainLabel)
  if (!aliasTokens.length || !mainTokens.length) return false
  return aliasTokens.some((a) => mainTokens.some((m) => aiNeoMatchesCode(a, m) || aiNeoMatchesCode(m, a)))
}

function isGenericAiMatchCode(code) {
  const label = String(code?.thai || code?.label || '').trim()
  const norm = normalizeCodeLabel(label)
  if (!norm) return true
  if (isOtherLabel(label)) return true
  // SPSS/CE placeholder rows like "ระบุ................" are containers for free text,
  // not semantic codes. Never let AI match every verbatim into these.
  if (norm === 'ระบุ' || norm === 'โปรดระบุ' || norm === 'อื่นๆระบุ' || norm === 'อื่นระบุ') return true
  // Non-answer / DK codes are valid semantic targets only for non-answer verbatims;
  // keep them as candidates, but aiNeoMatchesCode / existing validation will prevent misuse.
  if (/^ระบุ[._\s…-]*$/i.test(label)) return true
  return false
}

// จัดลำดับ codes ในกลุ่มเดียว ตามรหัสที่เลือก (sel) + ทิศทาง up/down/top/bottom
function reorderCodes(codes, sel, dir) {
  if (!codes.some((c) => sel.has(c.id))) return codes
  if (dir === 'top') return [...codes.filter((c) => sel.has(c.id)), ...codes.filter((c) => !sel.has(c.id))]
  if (dir === 'bottom') return [...codes.filter((c) => !sel.has(c.id)), ...codes.filter((c) => sel.has(c.id))]
  const arr = [...codes]
  if (dir === 'up') {
    for (let i = 1; i < arr.length; i++) {
      if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]] }
    }
  } else {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) { [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]] }
    }
  }
  return arr
}

// ช่องแก้ไขในตาราง Codeframe — แสดงเป็นข้อความ, ดับเบิลคลิกจึงแก้ได้ (กันแก้โดนตอนคลิกเลือก)
function CodeCell({ editing, value, placeholder, mono, onStart, onChange, onStop }) {
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={onStop}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onStop() } }}
        className={`w-full rounded border border-indigo-300 bg-white px-1.5 py-1 outline-none ring-2 ring-indigo-100 ${mono ? 'font-mono font-semibold text-slate-700' : 'text-slate-700'}`}
      />
    )
  }
  return (
    <span
      onDoubleClick={(e) => { e.stopPropagation(); onStart() }}
      title="ดับเบิลคลิกเพื่อแก้ไข"
      className={`block w-full cursor-text truncate rounded px-1.5 py-1 ${value ? (mono ? 'font-mono font-semibold text-slate-700' : 'text-slate-700') : 'text-slate-300'}`}
    >
      {value || placeholder}
    </span>
  )
}

export default function CodeframeEditor() {
  const { projectId, box, codeframeId } = useParams()
  const { state, updateCodeframe, patchRawdata, loadOriginalRawdata, restoreRawdataUndo, restoreRawdataRedo } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const cf = state.codeframes.find((c) => c.id === codeframeId)
  const { rawdata, loading: rawLoading, error: rawError, reload: reloadRawdata } = useRawdata(projectId)

  const [activeSheetId, setActiveSheetId] = useState(cf?.sheets[0]?.id ?? null)
  const [mode, setMode] = useState('frame') // 'frame' | 'grouped'
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [deletingSheet, setDeletingSheet] = useState(null)
  const [renamingSheetId, setRenamingSheetId] = useState(null) // ชีทที่กำลังแก้ชื่อ inline
  const [renamingCodeframe, setRenamingCodeframe] = useState(false)
  const [codeframeNameDraft, setCodeframeNameDraft] = useState(cf?.name ?? '')
  const [importError, setImportError] = useState('')
  const [autoMenuOpen, setAutoMenuOpen] = useState(false)
  const [buildOpen, setBuildOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [ciComments, setCiComments] = useState([])
  const [ciCommentsOpen, setCiCommentsOpen] = useState(false)
  // เลือกหลายรหัสในโครงเพื่อรวม/ย้าย
  const [selectMode, setSelectMode] = useState(false)
  const [selectedCodeIds, setSelectedCodeIds] = useState(() => new Set())
  const [moveOpen, setMoveOpen] = useState(false)
  const [lastClickedCodeId, setLastClickedCodeId] = useState(null) // anchor สำหรับ Shift+คลิกเลือกช่วง
  const [codeCtx, setCodeCtx] = useState(null) // เมนูคลิกขวา { x, y }
  // มุมมองคำตอบด้านขวา: 'unassigned' (เฉพาะที่ยังไม่จัดกลุ่ม) | 'all'
  const [answerFilter, setAnswerFilter] = useState('unassigned')
  // แก้ wording ของคำตอบ (เขียนทับ Rawdata) — เก็บ key เดิมที่กำลังแก้ + ข้อความร่าง
  const [editingAnswer, setEditingAnswer] = useState(null) // { key, draft } | null
  const [answerDetail, setAnswerDetail] = useState(null) // คำตอบที่กำลังดูรายละเอียด (ตอบ CE มาอะไรบ้าง)
  const [deletingAnswer, setDeletingAnswer] = useState(null) // คำตอบที่จะลบออกจาก Rawdata (ยืนยันก่อน) { texts }
  const [answerCtx, setAnswerCtx] = useState(null) // เมนูคลิกขวาที่คำตอบ { x, y, answers }
  const [answersPopupOpen, setAnswersPopupOpen] = useState(false) // Sheet เต็มจอสำหรับแก้ Verbatim / ลง Code แบบ Excel
  const [selectedPopupAnswerKeys, setSelectedPopupAnswerKeys] = useState(() => new Set())
  const [lastPopupAnswerKey, setLastPopupAnswerKey] = useState(null)
  const [popupEditingAnswer, setPopupEditingAnswer] = useState(null) // { key, draft } | null
  const [mergeInspect, setMergeInspect] = useState(null) // { key } — popup ดูรายการ Verbatim ที่ถูกรวม
  const [answersPopupFilter, setAnswersPopupFilter] = useState('all') // all | unassigned | assigned
  const [answersPopupSearch, setAnswersPopupSearch] = useState('')
  const [aiBusy, setAiBusy] = useState(null) // ข้อความสถานะระหว่างเรียก AI (null = ไม่ทำงาน)
  const [aiElapsed, setAiElapsed] = useState(0)
  const [legendOpen, setLegendOpen] = useState(false) // popover อธิบายสีแถบชีท
  const [addNetOpen, setAddNetOpen] = useState(false) // dropdown เลือกชั้น Net
  const [insertMenu, setInsertMenu] = useState(null) // { codeId } — เมนูแทรก Net เหนือแถว
  const [titleModalOpen, setTitleModalOpen] = useState(false) // popup ดูโจทย์ทุกข้อในชีท
  const [recodeQuestionPicker, setRecodeQuestionPicker] = useState(null) // { codeId } — เลือกข้อที่จะให้ Code นี้ไปลงแทน Other
  const [editingCell, setEditingCell] = useState(null) // { codeId, field } — ช่องที่กำลังแก้ (ดับเบิลคลิก)
  // คลิกคำตอบ → เลื่อนไปที่รหัสในโครงด้านซ้าย + ไฮไลต์ชั่วคราว
  const [flashCodeIds, setFlashCodeIds] = useState(() => new Set())
  const [newCodeIds, setNewCodeIds] = useState(() => new Set()) // Code ที่ AI สร้างใหม่ (ไฮไลต์ค้าง)
  const [qaOpen, setQaOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [checkpointOpen, setCheckpointOpen] = useState(false)
  const [checkpointName, setCheckpointName] = useState('')
  const [codeSearch, setCodeSearch] = useState('')
  const [codeFilter, setCodeFilter] = useState('all') // all | freq | new | zero
  const [freqDrawer, setFreqDrawer] = useState(null) // { code }
  const codeRowRefs = useRef({})
  const netRowRefs = useRef({})
  const flashTimer = useRef(null)
  const importRef = useRef(null)
  const scrollBoxRef = useRef(null) // กล่อง scroll ของตาราง Codeframe
  const sheetTabsRef = useRef(null) // แถบชีทด้านล่าง
  const scrollSheetTabs = (dir) => {
    const el = sheetTabsRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(240, Math.floor(el.clientWidth * 0.65)), behavior: 'smooth' })
  }
  const [undoStack, setUndoStack] = useState([]) // snapshots ของชีทก่อนแก้ไขล่าสุด
  const [redoStack, setRedoStack] = useState([]) // snapshots สำหรับทำซ้ำหลัง undo
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    if (!renamingCodeframe) setCodeframeNameDraft(cf?.name ?? '')
  }, [cf?.id, cf?.name, renamingCodeframe])

  useEffect(() => {
    if (cf?.name === 'CE — อื่นๆ ระบุ (auto)') {
      updateCodeframe(cf.id, (c) => ({ ...c, name: 'Codeframe CE other' }))
    }
  }, [cf?.id, cf?.name, updateCodeframe])

  // ย้ายลำดับ "เฉพาะ Code ที่เลือก" ขึ้น/ลง/บนสุด/ล่างสุด (ภายในกลุ่มของมัน)
  const moveSelectedCodes = (dir) => {
    if (!selectedCodeIds.size) return
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) => ({ ...n, codes: reorderCodes(n.codes, selectedCodeIds, dir) })),
    }))
  }

  const jumpToCodes = (codeIds) => {
    if (!codeIds?.length) return
    setFlashCodeIds(new Set(codeIds))
    requestAnimationFrame(() => {
      codeRowRefs.current[codeIds[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashCodeIds(new Set()), 1800)
  }

  // นับเวลาที่ผ่านไประหว่างรอ AI (กันให้ดูเหมือนค้าง)
  useEffect(() => {
    if (!aiBusy) return
    setAiElapsed(0)
    const t = setInterval(() => setAiElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [aiBusy])

  // เปลี่ยน codeframe (route param เปลี่ยนแต่ component ไม่ unmount) → ล้าง state ค้าง
  useEffect(() => {
    setActiveSheetId((prev) =>
      cf?.sheets.some((s) => s.id === prev) ? prev : (cf?.sheets[0]?.id ?? null),
    )
    setSelectedAnswer(null)
    setMode('frame')
    setSelectMode(false)
    setSelectedCodeIds(new Set())
    setEditingAnswer(null)
    setAnswerCtx(null)
    setAnswersPopupOpen(false)
    setSelectedPopupAnswerKeys(new Set())
    setLastPopupAnswerKey(null)
    setPopupEditingAnswer(null)
    setMergeInspect(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeframeId])

  // เปลี่ยนชีท → ล้างการเลือกรหัส (รหัสคนละชุดกัน)
  useEffect(() => {
    setSelectedCodeIds(new Set())
    setEditingAnswer(null)
    setAnswerCtx(null)
    setSelectedPopupAnswerKeys(new Set())
    setLastPopupAnswerKey(null)
    setPopupEditingAnswer(null)
    setMergeInspect(null)
    setFlashCodeIds(new Set())
    setNewCodeIds(new Set())
  }, [activeSheetId])

  // เคลียร์ตัวจับเวลาไฮไลต์ตอน unmount
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  useEffect(() => {
    if (!cf?.id || isLocalUxPreview()) return undefined
    const q = query(collection(db, 'review_audit'), where('codeframeId', '==', cf.id))
    return onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => row.action === 'code_comment')
        .sort((a, b) => {
          const ta = typeof a.createdAt?.toMillis === 'function' ? a.createdAt.toMillis() : (a.createdAt || 0)
          const tb = typeof b.createdAt?.toMillis === 'function' ? b.createdAt.toMillis() : (b.createdAt || 0)
          return tb - ta
        })
      setCiComments(rows)
    }, (err) => {
      console.warn('CI comment listener failed', err)
    })
  }, [cf?.id])

  const formatCiCommentTime = (ts) => {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts || nowMs())
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
  }

  const ciOpenComments = useMemo(
    () => ciComments.filter((c) => c.status !== 'done' && !c.done),
    [ciComments],
  )

  const ciDoneComments = useMemo(
    () => ciComments.filter((c) => c.status === 'done' || c.done),
    [ciComments],
  )

  const ciCommentCountByCode = useMemo(() => {
    const m = new Map()
    for (const c of ciComments) {
      if (c.status === 'done' || c.done) continue
      const id = c.payload?.codeId
      if (id) m.set(id, (m.get(id) || 0) + 1)
    }
    return m
  }, [ciComments])

  const toggleCiCommentDone = async (comment, done = true) => {
    if (!comment?.id) return
    try {
      await updateDoc(doc(db, 'review_audit', comment.id), done ? {
        status: 'done',
        done: true,
        resolvedAt: serverTimestamp(),
        resolvedBy: 'Edit',
        updatedAt: serverTimestamp(),
      } : {
        status: 'open',
        done: false,
        resolvedAt: null,
        resolvedBy: null,
        updatedAt: serverTimestamp(),
      })
      setToast({
        type: 'success',
        title: done ? 'ติ๊ก Done แล้ว' : 'เปิด Comment กลับมาแล้ว',
        message: done ? 'แถวนี้จะถูกขีดฆ่าและไม่นับใน badge pending' : 'Comment นี้กลับไปอยู่ในรายการรอแก้',
        duration: 1800,
      })
    } catch (e) {
      console.error('toggle CI comment done failed', e)
      setToast({ type: 'error', title: 'อัปเดตสถานะ CI Comment ไม่สำเร็จ', message: e?.message || 'ลองใหม่อีกครั้ง' })
    }
  }

  const sheet = cf?.sheets.find((s) => s.id === activeSheetId) ?? cf?.sheets[0]

  // ซ่อม Codeframe เก่าที่สร้างก่อนรองรับ multi-Oth:
  // ถ้าชีทมีข้อปลายปิดที่มี Other/specify หลายช่อง แต่ sheet.questionIds มีแค่ช่องแรก ให้เติมช่องที่ขาดอัตโนมัติ
  useEffect(() => {
    if (!rawdata || !cf?.id || !sheet || !project?.codebook) return
    const byId = new Map(rawdata.questions.map((q) => [q.id, q]))
    const existing = new Set(sheet.questionIds ?? [])
    const additions = []
    for (const qid of sheet.questionIds ?? []) {
      const q = byId.get(qid)
      if (!q) continue
      const cb = project.codebook?.byVar?.[q.label]
      if (!(cb?.values?.length)) continue
      for (const otherQ of findOtherColumns(rawdata, q, project.codebook)) {
        if (!existing.has(otherQ.id)) {
          existing.add(otherQ.id)
          additions.push(otherQ.id)
        }
      }
    }
    if (!additions.length) return
    updateCodeframe(cf.id, (cur) => ({
      ...cur,
      sheets: cur.sheets.map((s) => (s.id === sheet.id ? { ...s, questionIds: [...(s.questionIds ?? []), ...additions] } : s)),
    }))
  }, [rawdata, cf?.id, sheet, project?.codebook, updateCodeframe])

  // ข้อที่ "ต้องเอามาจัดกลุ่ม" = คอลัมน์ข้อความอิสระ ("อื่นๆ ระบุ" / OE) เท่านั้น
  //   ข้อปลายปิด (มี value labels ในโค้ดบุ๊ก) ถูกลงโค้ดไว้แล้ว — ไม่ต้องเอามาจัดกลุ่มซ้ำ
  //   ถ้าไม่มีโค้ดบุ๊ก (เช่นงาน OE ล้วน) → ถือว่าทุกข้อเป็นข้อความอิสระ (พฤติกรรมเดิม)
  const openQuestionIds = useMemo(() => {
    if (!rawdata || !sheet) return []
    const preserveIds = (sheet.manualRecodeRules ?? [])
      .flatMap((rule) => [rule.sourceQuestionId, rule.questionId])
      .filter(Boolean)
    return scopedVerbatimQuestionIds(rawdata, sheet.questionIds, project?.codebook, preserveIds)
  }, [rawdata, sheet, project])

  // answers = คำตอบ "ที่ต้องจัดกลุ่ม" (เฉพาะข้อความอิสระ) — ใช้ในแผงขวา + ปุ่ม AI/Group
  const answers = useMemo(
    () => (rawdata && sheet ? uniqueAnswers(rawdata, openQuestionIds) : []),
    [rawdata, sheet, openQuestionIds],
  )
  // allAnswers = ทุกคำตอบรวมปลายปิด — ใช้มุมมอง "จัดกลุ่มแล้ว" ให้เห็นค่าปลายปิดครบ
  const allAnswers = useMemo(
    () => (rawdata && sheet ? uniqueAnswers(rawdata, sheet.questionIds) : []),
    [rawdata, sheet],
  )

  const autoCodedCodeNos = useMemo(() => {
    const set = new Set()
    if (!rawdata || !sheet) return set
    try {
      const { editLog } = buildOverwrittenRawdata(rawdata, { sheets: [sheet] }, project?.codebook)
      for (const e of editLog ?? []) {
        const action = String(e?.action ?? '')
        const newCode = String(e?.newCode ?? '').trim()
        const originalCode = String(e?.originalCode ?? '').trim()
        if (!newCode || newCode === originalCode) continue
        // Show the Auto badge only for codes created by coding real Other/specify text.
        // Manual "follow source code" rules can write normal closed-ended source codes (e.g. 1/2)
        // into another target question, but those codes themselves are not auto-created Other codes.
        if (action === 'overwrite_other_code' || action === 'manual_cross_question_recode' || action === 'manual_cross_question_insert_code') {
          set.add(newCode)
        }
      }
    } catch (err) {
      console.warn('auto-code highlight calculation failed', err)
    }
    return set
  }, [rawdata, sheet, project])
  // สถานะ/สีของแต่ละชีท ตามสถานะ "อื่นๆ ระบุ" (ดู SHEET_STATUS)
  //   gray  = มี Code อื่นๆ แต่ไม่มีใครเลือก (freq=0) → ไม่ต้องทำ
  //   red   = มีคนเลือกอื่นๆ (freq>0) แต่ไม่มีช่องข้อความต่อท้าย → โค้ดไม่ได้
  //   orange= มีคนเลือกอื่นๆ + มีช่องข้อความ แต่ยังจัดกลุ่มไม่หมด
  //   green = จัดคำตอบอื่นๆ เข้า Code ครบแล้ว
  const sheetStatusMap = useMemo(() => {
    const map = {}
    if (!rawdata) return map
    const cbBy = project?.codebook?.byVar
    let statusRawdata = rawdata
    try {
      statusRawdata = { ...rawdata, rows: buildOverwrittenRawdata(rawdata, { sheets: cf?.sheets ?? [] }, project?.codebook).rows }
    } catch (err) {
      console.warn('sheet status coded rows calculation failed', err)
    }
    for (const sh of cf?.sheets ?? []) {
      const otherIds = new Set(
        sh.nets.flatMap((n) => n.codes).filter((c) => isOtherLabel(c.thai)).map((c) => c.id),
      )
      if (!otherIds.size) { map[sh.id] = 'none'; continue }
      const openIds = sh.questionIds.filter((qid) => {
        const q = rawdata.questions.find((x) => x.id === qid)
        return q && !(cbBy?.[q.label]?.values?.length)
      })
      const hasText = openIds.length > 0
      const sourceTextsForRuleLocal = (rule) => {
        const sourceTexts = new Set()
        if (rule?.sourceText) sourceTexts.add(normalizeRuleText(rule.sourceText))
        if (rule?.sourceCodeId) {
          for (const [text, ids] of Object.entries(sh.assignments ?? {})) {
            if ((ids ?? []).includes(rule.sourceCodeId)) sourceTexts.add(normalizeRuleText(text))
          }
          const sourceCode = findCode(sh, rule.sourceCodeId)
          const sourceQuestions = rule.sourceQuestionId ? [rawdata.questions.find((x) => x.id === rule.sourceQuestionId)].filter(Boolean) : (sh.questionIds ?? []).map((qid) => rawdata.questions.find((x) => x.id === qid)).filter(Boolean)
          for (const sourceQ of sourceQuestions) {
            for (const otherQ of otherColumnsForCode(rawdata, sourceQ, project?.codebook, sourceCode?.codeNo).filter((oq) => (sh.questionIds ?? []).includes(oq.id))) {
              for (const c of otherQ.columns ?? [otherQ.index]) {
                for (const row of statusRawdata.rows ?? []) {
                  const text = normalizeRuleText(row[c])
                  if (text) sourceTexts.add(text)
                }
              }
            }
          }
        }
        return sourceTexts
      }
      // ใช้ rawdata จริงสำหรับ open/verbatim assignments เพราะ sh.assignments keyed ด้วยข้อความต้นฉบับ
      // ถ้าใช้ statusRawdata ที่ถูก buildOverwrittenRawdata แปลงข้อความเป็น label ใหม่แล้ว key จะไม่ตรง
      // และทำให้ชีทค้างสีส้มทั้งที่แผงขวา/ตาราง Freq เห็น Oth = 0 แล้ว
      const statusOpenAnswers = uniqueAnswers(rawdata, openIds)
      const sourceTextsByOtherCodeId = new Map()
      const sourceTextsForOtherCode = (codeId) => {
        if (!sourceTextsByOtherCodeId.has(codeId)) {
          sourceTextsByOtherCodeId.set(codeId, sourceTextsForRuleLocal({ sourceCodeId: codeId }))
        }
        return sourceTextsByOtherCodeId.get(codeId)
      }
      // ใช้ residual Other ตามที่ตาราง Frequency แสดงจริง:
      // - ยังไม่ assign เลย = ยังเหลือ
      // - assign กลับเข้า Code อื่นๆ ตัวเดิม = เหลือ เฉพาะเมื่อยังไม่ได้ใช้ลง rule ตามข้อแล้ว
      // - assign ไป Code ปกติแล้ว = ไม่ควรนับให้สีชีทแดง/ส้มค้าง
      const residualOtherTextRows = statusOpenAnswers.reduce((sum, a) => {
        const ids = sh.assignments[a.key] ?? []
        if (!ids.length) return sum + a.count
        const keyText = normalizeRuleText(a.key)
        const stillInOtherCode = ids.some((id) => {
          if (!otherIds.has(id)) return false
          return !sourceTextsForOtherCode(id).has(keyText)
        })
        return stillInOtherCode ? sum + a.count : sum
      }, 0)
      // ข้อความ "อื่นๆ" ที่ยังไม่ถูกจัดกลุ่ม
      const ungrouped = statusOpenAnswers
        .filter((a) => !(sh.assignments[a.key] ?? []).length).length
      const grouped = statusOpenAnswers
        .filter((a) => (sh.assignments[a.key] ?? []).length).length
      const hasCompletedOtherWork = grouped > 0 || (sh.manualRecodeRules ?? []).length > 0

      // ข้อปลายปิดที่มี Other/specify แต่ไม่มี Verbatim ของตัวเองในชีทนี้
      // ถ้ายังมี raw Other ที่ยังไม่ได้ลง rule ตามข้อครบ ห้ามเขียว
      const textColsForRuleLocal = (rule) => {
        if (rule?.sourceQuestionId) {
          const sourceQ = rawdata.questions.find((x) => x.id === rule.sourceQuestionId)
          if (!sourceQ) return []
          const sourceCb = cbBy?.[sourceQ.label]
          if (!(sourceCb?.values?.length)) return sourceQ.columns ?? [sourceQ.index]
          return findOtherColumns(rawdata, sourceQ, project?.codebook)
            .filter((otherQ) => (sh.questionIds ?? []).includes(otherQ.id))
            .flatMap((otherQ) => otherQ.columns ?? [otherQ.index])
        }
        return openIds.flatMap((qid) => {
          const tq = rawdata.questions.find((x) => x.id === qid)
          return tq ? (tq.columns ?? [tq.index]) : []
        })
      }
      const coveredRowsForNoVerbatimLocal = (q) => {
        const cb = cbBy?.[q.label]
        const otherValues = new Set((cb?.values ?? []).filter((v) => isOtherLabel(v.label)).map((v) => String(v.value).trim()))
        const rows = new Set()
        if (!otherValues.size) return rows
        const closedCols = closedQuestionGroupColumns(rawdata, q, project?.codebook)
        for (const rule of (sh.manualRecodeRules ?? []).filter((r) => r.questionId === q.id)) {
          const sourceTexts = sourceTextsForRuleLocal(rule)
          const sourceCols = textColsForRuleLocal(rule)
          if (!sourceTexts.size || !sourceCols.length) continue
          for (let r = 0; r < statusRawdata.rows.length; r++) {
            const row = statusRawdata.rows[r]
            const hasOther = closedCols.some((c) => otherValues.has(String(row[c] ?? '').trim()))
            if (!hasOther) continue
            const hasSourceText = sourceCols.some((c) => sourceTexts.has(normalizeRuleText(row[c])))
            if (hasSourceText) rows.add(r)
          }
        }
        return rows
      }
      const missingVerbatimPending = (sh.questionIds ?? []).reduce((sum, qid) => {
        const q = rawdata.questions.find((x) => x.id === qid)
        const cb = cbBy?.[q?.label]
        if (!q || !(cb?.values?.length)) return sum
        const otherValues = new Set((cb.values ?? []).filter((v) => isOtherLabel(v.label)).map((v) => String(v.value).trim()))
        if (!otherValues.size) return sum
        const hasOwnVerbatim = findOtherColumns(rawdata, q, project?.codebook).some((otherQ) => (sh.questionIds ?? []).includes(otherQ.id))
        if (hasOwnVerbatim) return sum
        const coveredRows = coveredRowsForNoVerbatimLocal(q)
        const cols = closedQuestionGroupColumns(rawdata, q, project?.codebook)
        let pending = 0
        for (let r = 0; r < statusRawdata.rows.length; r++) {
          if (coveredRows.has(r)) continue
          if (cols.some((c) => otherValues.has(String(statusRawdata.rows[r]?.[c] ?? '').trim()))) pending += 1
        }
        return sum + pending
      }, 0)

      const actionableTextLeft = hasText && ungrouped > 0
      const codedOtherLeft = residualOtherTextRows > 0 || missingVerbatimPending > 0

      let status
      // เคสงานจริง: มี Verbatim source ในแผงขวา, ทุกคำตอบถูก assign แล้ว,
      // และ Frequency ของ Code อื่นๆ เหลือ 0 → ต้องเขียว แม้ตัวตรวจ no-Verbatim จะเจอ raw Other เก่าค้างอยู่
      // ตัวอย่าง q41/q41a: q41a_oth1 = "ไม่มี" ถูกลง Code 99 ครบแล้ว, 141/142/143 = 0
      if (hasText && grouped > 0 && ungrouped === 0 && residualOtherTextRows === 0) status = 'green'
      // ถ้าไม่มี Verbatim/Other ที่ต้องจัดเหลือแล้ว อย่าให้แดงค้างจาก assignment/raw closed-end เก่า
      // เช่น Frequency ของ Code อื่นๆ = 0 และแผงขวาเหลือ 0 → เสร็จแล้วต้องเขียว
      else if (!codedOtherLeft && !actionableTextLeft) status = hasCompletedOtherWork ? 'green' : (hasText ? 'gray' : 'maroon')
      else if (missingVerbatimPending > 0 && residualOtherTextRows === 0) status = 'red'
      else if (!hasText && codedOtherLeft) status = 'red'
      else if (actionableTextLeft || residualOtherTextRows > 0) status = 'orange'
      else status = 'green'
      map[sh.id] = status
    }
    return map
     
  }, [rawdata, cf, project])

  // selectedAnswer ต้องเป็นคำตอบที่อยู่ในชีทปัจจุบันจริงเท่านั้น กันเขียน assignment ผี
  const validSelected =
    selectedAnswer && answers.some((a) => a.key === selectedAnswer) ? selectedAnswer : null

  if (!project || !cf || !sheet) {
    return (
      <div className="px-5 py-16 text-center text-slate-400">
        ไม่พบ Codeframe นี้ — <Link to="/" className="text-indigo-600 underline">กลับหน้าหลัก</Link>
      </div>
    )
  }

  // หลัง refresh ตรงหน้า editor: อย่า render count เป็น 0 ก่อน rawdata chunks โหลดเสร็จ
  // เพราะจะทำให้ sheet tabs/คำตอบดูเหมือนข้อมูลหาย ต้องรอ rawdata ให้พร้อมก่อนคำนวณทุกอย่าง
  const canLoadRawChunks = (project.rawMeta?.chunkCount ?? 0) > 0
  if (project.rawMeta && canLoadRawChunks && !rawdata) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50">
        {rawError ? (
          <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-rose-700">โหลด Rawdata ไม่สำเร็จ</p>
            <p className="mt-2 text-xs text-rose-600">{rawError.message}</p>
            <button onClick={reloadRawdata} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              โหลด Rawdata อีกครั้ง
            </button>
          </div>
        ) : (
          <LoadingAnimation full={false} label={rawLoading ? 'กำลังโหลด Rawdata และคำนวณ Code count' : 'เตรียม Rawdata'} />
        )}
      </div>
    )
  }

  // ---------- mutation helpers ----------
  const updateSheet = (fn, label = 'แก้ไข Codeframe') => {
    const snapshot = JSON.parse(JSON.stringify(sheet))
    setUndoStack((prev) => [...prev.slice(-24), { at: nowMs(), label, sheet: snapshot }])
    setRedoStack([])
    updateCodeframe(cf.id, (c) => ({
      ...c,
      sheets: c.sheets.map((s) => (s.id === sheet.id ? fn(s) : s)),
    }))
  }

  const saveCodeframeName = () => {
    const next = codeframeNameDraft.trim() || 'Codeframe CE other'
    setCodeframeNameDraft(next)
    updateCodeframe(cf.id, (c) => ({ ...c, name: next }))
    setRenamingCodeframe(false)
  }

  const restoreSheetSnapshot = (snapshot) => {
    updateCodeframe(cf.id, (c) => ({
      ...c,
      sheets: c.sheets.map((s) => (s.id === snapshot.sheet.id ? snapshot.sheet : s)),
    }))
  }

  const undoSheetLast = () => {
    const last = undoStack[undoStack.length - 1]
    if (!last || !sheet) return false
    const current = { at: nowMs(), label: last.label, sheet: JSON.parse(JSON.stringify(sheet)) }
    restoreSheetSnapshot(last)
    setUndoStack((prev) => prev.slice(0, -1))
    setRedoStack((prev) => [...prev.slice(-24), current])
    setToast({ type: 'success', title: 'Undo โครงแล้ว', message: `ย้อนกลับ: ${last.label}` })
    return true
  }

  const redoSheetLast = () => {
    const last = redoStack[redoStack.length - 1]
    if (!last || !sheet) return false
    const current = { at: nowMs(), label: last.label, sheet: JSON.parse(JSON.stringify(sheet)) }
    restoreSheetSnapshot(last)
    setRedoStack((prev) => prev.slice(0, -1))
    setUndoStack((prev) => [...prev.slice(-24), current])
    setToast({ type: 'success', title: 'Redo โครงแล้ว', message: `ทำซ้ำ: ${last.label}` })
    return true
  }

  const latestRawUndo = project?.rawMeta?.undoStack?.[0]
  const latestRawRedo = project?.rawMeta?.redoStack?.[0]
  const latestSheetUndo = undoStack[undoStack.length - 1]
  const latestSheetRedo = redoStack[redoStack.length - 1]
  const canUndoStep = !!latestRawUndo || !!latestSheetUndo
  const canRedoStep = !!latestRawRedo || !!latestSheetRedo
  const undoStepTitle = latestRawUndo || latestSheetUndo
    ? `Undo: ${(Number(latestRawUndo?.createdAt ?? 0) >= Number(latestSheetUndo?.at ?? 0)) ? (latestRawUndo?.title || 'Rawdata') : (latestSheetUndo?.label || 'Codeframe')}`
    : 'ยังไม่มี step ให้ Undo'
  const redoStepTitle = latestRawRedo || latestSheetRedo
    ? `Redo: ${(Number(latestRawRedo?.redoneAt ?? latestRawRedo?.createdAt ?? 0) >= Number(latestSheetRedo?.at ?? 0)) ? (latestRawRedo?.title || 'Rawdata') : (latestSheetRedo?.label || 'Codeframe')}`
    : 'ยังไม่มี step ให้ Redo'

  const undoLast = async () => {
    const rawAt = Number(latestRawUndo?.createdAt ?? 0)
    const sheetAt = Number(latestSheetUndo?.at ?? 0)
    if (rawAt >= sheetAt && latestRawUndo) {
      try { await restoreRawdataUndo(projectId) } catch (err) { setToast({ type: 'warning', title: 'Undo Rawdata ไม่สำเร็จ', message: err.message || String(err), duration: 8000 }) }
      return
    }
    undoSheetLast()
  }

  const redoLast = async () => {
    const rawAt = Number(latestRawRedo?.redoneAt ?? latestRawRedo?.createdAt ?? 0)
    const sheetAt = Number(latestSheetRedo?.at ?? 0)
    if (rawAt >= sheetAt && latestRawRedo) {
      try { await restoreRawdataRedo(projectId) } catch (err) { setToast({ type: 'warning', title: 'Redo Rawdata ไม่สำเร็จ', message: err.message || String(err), duration: 8000 }) }
      return
    }
    redoSheetLast()
  }

  const saveCheckpoint = (name = '') => {
    const label = name.trim() || `${sheet.name} · ${new Date().toLocaleString('th-TH')}`
    const checkpoint = { id: uid(), at: nowMs(), label, sheet: JSON.parse(JSON.stringify(sheet)) }
    updateCodeframe(cf.id, (c) => ({ ...c, checkpoints: [checkpoint, ...(c.checkpoints ?? [])].slice(0, 20) }))
    setCheckpointName('')
    setToast({ type: 'success', title: 'Save Checkpoint แล้ว', message: label })
  }

  const restoreCheckpoint = (checkpoint) => {
    if (!checkpoint?.sheet) return
    updateCodeframe(cf.id, (c) => ({
      ...c,
      sheets: c.sheets.map((s) => (s.id === checkpoint.sheet.id ? checkpoint.sheet : s)),
    }))
    setCheckpointOpen(false)
    setToast({ type: 'success', title: 'Restore Checkpoint แล้ว', message: checkpoint.label })
  }

  const addNet = (level = 1) => {
    setAddNetOpen(false)
    const newNetId = uid()
    updateSheet((s) => ({
      ...s,
      nets: [...s.nets, { id: newNetId, name: '', level, codes: [] }],
    }))
    requestAnimationFrame(() => {
      netRowRefs.current[newNetId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setToast({ type: 'success', title: `เพิ่ม ${NET_LABEL[level] || 'Net'} แล้ว`, message: 'เพิ่มหัวกลุ่มใหม่ท้ายตารางแล้ว ดับเบิลคลิกที่ชื่อเพื่อแก้ไข' })
  }
  // ระดับสูงสุดของ Net ที่มีอยู่ในชีท (เฉพาะ "หัวข้อจริง" คือ level ≥ 1; undefined/0 = ไม่มีหัว)
  const maxNetLevel = sheet.nets.reduce((m, n) => Math.max(m, n.level >= 1 ? n.level : 0), 0)

  // แทรกหัว Net เหนือรหัสที่ระบุ (อยู่ในตารางเดียวกัน ไม่สร้างกล่องใหม่ข้างล่าง)
  const insertNetAbove = (codeId, level = 1) => {
    setInsertMenu(null)
    updateSheet((s) => {
      const nets = s.nets.map((n) => ({ ...n, codes: [...n.codes] }))
      for (let i = 0; i < nets.length; i++) {
        const idx = nets[i].codes.findIndex((c) => c.id === codeId)
        if (idx < 0) continue
        const net = nets[i]
        if (idx === 0) {
          if (!(net.level >= 1)) nets[i] = { ...net, level } // ให้กลุ่มนี้มีหัว Net
          else nets.splice(i, 0, { id: uid(), name: '', level, codes: [] })
        } else {
          const after = net.codes.slice(idx)
          nets[i] = { ...net, codes: net.codes.slice(0, idx) }
          nets.splice(i + 1, 0, { id: uid(), name: '', level, codes: after })
        }
        break
      }
      return { ...s, nets }
    })
  }

  // ลบเฉพาะ "หัว Net" (รวมรหัสกลับเข้ากลุ่มก่อนหน้า — ไม่ลบรหัส)
  const removeNetHeader = (netId) => {
    updateSheet((s) => {
      const i = s.nets.findIndex((n) => n.id === netId)
      if (i < 0) return s
      const nets = s.nets.map((n) => ({ ...n, codes: [...n.codes] }))
      if (i === 0) { nets[0] = { ...nets[0], level: 0, name: '' } } // กลุ่มแรก → กลายเป็นไม่มีหัว
      else { nets[i - 1].codes.push(...nets[i].codes); nets.splice(i, 1) }
      return { ...s, nets }
    })
  }

  // ระดับ Net สูงสุดที่ "อยู่เหนือ" ตำแหน่งของรหัสนี้ (ไว้ตรวจว่าจะแทรกชั้นไหนได้)
  const maxLevelAbove = (codeId) => {
    let maxLv = 0
    for (const net of sheet.nets) {
      const lv = net.level >= 1 ? net.level : 0
      if (net.codes.some((c) => c.id === codeId)) return maxLv
      if (lv > maxLv) maxLv = lv
    }
    return maxLv
  }

  const updateNet = (netId, patch) => {
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) => (n.id === netId ? { ...n, ...patch } : n)),
    }))
  }

  const deleteNet = (netId) => {
    updateSheet((s) => {
      const removed = s.nets.find((n) => n.id === netId)
      const removedIds = new Set(removed?.codes.map((c) => c.id) ?? [])
      return {
        ...s,
        nets: s.nets.filter((n) => n.id !== netId),
        assignments: cleanAssignments(s.assignments, removedIds),
      }
    })
  }

  const addCode = (netId) => {
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) =>
        n.id === netId
          ? { ...n, codes: [...n.codes, { id: uid(), codeNo: nextCodeNo(s), thai: '', thai2: '', eng: '', manualNew: true }] }
          : n,
      ),
    }))
  }

  const updateCode = (netId, codeId, patch) => {
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) =>
        n.id === netId
          ? { ...n, codes: n.codes.map((c) => (c.id === codeId ? { ...c, ...patch } : c)) }
          : n,
      ),
    }))
  }

  const deleteCode = (netId, codeId) => {
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) =>
        n.id === netId ? { ...n, codes: n.codes.filter((c) => c.id !== codeId) } : n,
      ),
      assignments: cleanAssignments(s.assignments, new Set([codeId])),
    }))
  }

  // แทรกรหัสเปล่าก่อนหน้าแถวที่ระบุ (เมนูคลิกขวา)
  const insertCodeBefore = (codeId) => {
    updateSheet((s) => {
      const nets = s.nets.map((n) => ({ ...n, codes: [...n.codes] }))
      for (const n of nets) {
        const idx = n.codes.findIndex((c) => c.id === codeId)
        if (idx >= 0) { n.codes.splice(idx, 0, { id: uid(), codeNo: nextCodeNo(s), thai: '', thai2: '', eng: '', manualNew: true }); break }
      }
      return { ...s, nets }
    })
  }

  // เอาเครื่องหมาย "Code ใหม่จาก AI" ออก (ตรวจแล้ว) — ลบ flag aiNew ของรหัสที่เลือก
  const clearAiNew = (codeIds) => {
    const ids = new Set(codeIds)
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) => ({
        ...n,
        codes: n.codes.map((c) => (ids.has(c.id) && c.aiNew ? { ...c, aiNew: false } : c)),
      })),
    }))
    setNewCodeIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next })
  }

  // ลบรหัสนี้ (เมนูคลิกขวา) — หา net เอง
  const deleteCodeById = (codeId) => {
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) => ({ ...n, codes: n.codes.filter((c) => c.id !== codeId) })),
      assignments: cleanAssignments(s.assignments, new Set([codeId])),
    }))
  }

  const toggleAssign = (codeId) => {
    if (!validSelected) return
    updateSheet((s) => {
      const cur = s.assignments[validSelected] ?? []
      const next = cur.includes(codeId) ? cur.filter((x) => x !== codeId) : [...cur, codeId]
      const assignments = { ...s.assignments }
      if (next.length) assignments[validSelected] = next
      else delete assignments[validSelected]
      return { ...s, assignments }
    })
    setSelectedAnswer(null) // วางเสร็จแล้ว → เคลียร์การเลือก กลับสู่ปกติ (ไม่เด้งไปเด้งกลับ)
  }

  const unassign = (answerKey, codeId) => {
    updateSheet((s) => {
      const next = (s.assignments[answerKey] ?? []).filter((x) => x !== codeId)
      const assignments = { ...s.assignments }
      if (next.length) assignments[answerKey] = next
      else delete assignments[answerKey]
      return { ...s, assignments }
    })
  }

  // คลิกขวาที่คำตอบ → เปิดเมนูจัดเข้ารหัสทันที (รองรับหลายแถวจาก Sheet เต็มจอ)
  const openAnswerCtx = (e, answerOrAnswers) => {
    const answersForCtx = Array.isArray(answerOrAnswers) ? answerOrAnswers : [answerOrAnswers]
    if (!answersForCtx.length || answersForCtx.some((a) => editingAnswer?.key === a?.key || popupEditingAnswer?.key === a?.key)) return
    e.preventDefault()
    setSelectedAnswer(null)
    setAnswerCtx({ x: e.clientX, y: e.clientY, answers: answersForCtx })
  }

  // Insert NewCode: สร้างรหัสใหม่จากข้อความคำตอบ แล้ว assign คำตอบนี้เข้ารหัสใหม่ทันที
  const insertNewCodeFromAnswer = (answerOrAnswers) => {
    const answersForCode = Array.isArray(answerOrAnswers) ? answerOrAnswers : [answerOrAnswers]
    const valid = answersForCode.filter(Boolean)
    if (!valid.length) return
    let newId = null
    let newNo = ''
    const first = valid[0]
    updateSheet((s) => {
      newId = uid()
      newNo = String(nextCodeNo(s))
      const label = valid.length === 1 ? first.text : `รวม ${valid.length} Verbatim`
      const newCode = { id: newId, codeNo: newNo, thai: label, thai2: '', eng: '', manualNew: true }
      const assignments = { ...s.assignments }
      valid.forEach((a) => { assignments[a.key] = [newId] })
      const nets = s.nets.length
        ? s.nets.map((n, i) => (i === s.nets.length - 1 ? { ...n, codes: [...n.codes, newCode] } : { ...n, codes: [...n.codes] }))
        : [{ id: uid(), name: '', level: 0, codes: [newCode] }]
      return { ...s, nets, assignments }
    })
    setAnswerCtx(null)
    setAnswerFilter('all')
    if (newId) {
      setNewCodeIds((prev) => new Set([...prev, newId]))
      requestAnimationFrame(() => codeRowRefs.current[newId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }
    setToast({
      type: 'success',
      title: `Insert NewCode ${newNo} แล้ว`,
      message: valid.length === 1
        ? `สร้าง Code จาก “${first.text}” และวางคำตอบนี้เข้า Code ใหม่เรียบร้อย`
        : `สร้าง Code ใหม่และวาง ${valid.length} Verbatim เข้า Code นี้แล้ว`,
    })
  }

  // Move to Code: ย้าย/วางคำตอบเข้า Code ที่เลือก (แทน assignment เดิมของคำตอบนี้)
  const moveAnswerToCode = (answerOrAnswers, codeId) => {
    const valid = (Array.isArray(answerOrAnswers) ? answerOrAnswers : [answerOrAnswers]).filter(Boolean)
    if (!valid.length || !codeId) return
    const code = findCode(sheet, codeId)
    updateSheet((s) => {
      const assignments = { ...s.assignments }
      valid.forEach((a) => { assignments[a.key] = [codeId] })
      return { ...s, assignments }
    })
    setAnswerCtx(null)
    setAnswerFilter('all')
    jumpToCodes([codeId])
    setToast({
      type: 'success',
      title: valid.length === 1 ? 'วางคำตอบเข้า Code แล้ว' : `วาง ${valid.length} Verbatim เข้า Code แล้ว`,
      message: code ? `→ Code ${code.codeNo} ${code.thai || ''}` : 'จัดกลุ่มแล้ว',
    })
  }

  const moveContextAnswersToCode = (answerOrAnswers, codeId) => {
    const valid = (Array.isArray(answerOrAnswers) ? answerOrAnswers : [answerOrAnswers]).filter(Boolean)
    if (!valid.length || !codeId) return
    const code = findCode(sheet, codeId)
    updateSheet((s) => {
      const assignments = { ...s.assignments }
      valid.forEach((a) => { assignments[a.key] = [codeId] })
      return { ...s, assignments }
    })
    setAnswerCtx(null)
    setAnswerFilter('all')
    setToast({
      type: 'success',
      title: valid.length === 1 ? 'วางคำตอบเข้า Code แล้ว' : `วาง ${valid.length} Verbatim เข้า Code แล้ว`,
      message: code ? `→ Code ${code.codeNo} ${code.thai || ''}` : 'จัดกลุ่มแล้ว',
    })
  }

  // Clear Code: ล้าง assignment ของ Verbatim ที่เลือก ให้กลับไปอยู่สถานะยังไม่ลง Code
  const clearAnswerCode = (answerOrAnswers) => {
    const valid = (Array.isArray(answerOrAnswers) ? answerOrAnswers : [answerOrAnswers]).filter(Boolean)
    if (!valid.length) return
    updateSheet((s) => {
      const assignments = { ...s.assignments }
      valid.forEach((a) => { delete assignments[a.key] })
      return { ...s, assignments }
    })
    setAnswerCtx(null)
    setAnswerFilter('all')
    setToast({
      type: 'success',
      title: valid.length === 1 ? 'Clear Code แล้ว' : `Clear Code ${valid.length} Verbatim แล้ว`,
      message: 'ล้าง Code ที่ลงไว้ให้กลับไปรอจัดกลุ่มใหม่แล้ว',
      duration: 2200,
    })
  }

  // โหมด A: จับคู่คำตอบเข้ารหัสที่ "มีอยู่แล้ว" ในโครง
  const runAutoGroup = () => {
    setAutoMenuOpen(false)
    if (!answers.length) {
      setToast({ type: 'warning', title: 'ยังไม่มีคำตอบให้จัดกลุ่ม', message: 'เลือก "ข้อในชีทนี้" ด้านบนก่อน เพื่อดึงคำตอบจาก Rawdata' })
      return
    }
    if (!codeCount) {
      setToast({
        type: 'warning',
        title: 'ยังไม่มีรหัสในโครงให้จับคู่',
        message: 'โหมดนี้ใช้จับคำตอบเข้ารหัสที่มีอยู่แล้ว — ถ้ายังไม่มีโครง ให้เลือก "สร้างรหัสจากคำตอบ" แทน',
      })
      return
    }
    let matched = 0
    updateSheet((s) => {
      const res = autoAssign(answers, s.nets, s.assignments)
      matched = res.matched
      return { ...s, assignments: res.assignments }
    })
    setToast(
      matched > 0
        ? { type: 'success', title: `จับคู่สำเร็จ ${matched} คำตอบ`, message: 'คำตอบที่ตรงกับรหัสถูกจัดกลุ่มให้แล้ว ที่เหลือจัดเองได้โดยคลิกคำตอบ → คลิกรหัส' }
        : { type: 'info', title: 'ไม่พบคำตอบที่ตรงกับรหัสในโครง', message: 'งาน OE คำตอบมักไม่ตรงกับชื่อรหัสตรงๆ — ลองใช้ "สร้างรหัสจากคำตอบ" เพื่อให้ระบบร่างรหัสให้' },
    )
  }

  // Group CE อัตโนมัติด้วย AI: อ่าน Code ปัจจุบัน + คำตอบที่ยังไม่จัด
  //   → จับเข้า Code เดิม (ถ้าความหมายตรง) · สร้าง Code ใหม่ + ลงให้ (ถ้าไม่มี) + ไฮไลต์ตัวใหม่
  const runGroupCE = async () => {
    const flatCodes = sheet.nets.flatMap((n) => n.codes)
    const genericCodeIds = new Set(flatCodes.filter(isGenericAiMatchCode).map((c) => c.id))
    const aiCreatedCodeIds = new Set(flatCodes.filter((c) => c.aiNew).map((c) => c.id))
    const codeById = new Map(flatCodes.map((c) => [c.id, c]))
    const countByCodeForAI = {}
    for (const a of allAnswers) {
      for (const cid of sheet.assignments[a.key] ?? []) {
        countByCodeForAI[cid] = (countByCodeForAI[cid] ?? 0) + a.count
      }
    }

    // หา code alias ที่ควรถูกทบทวนใหม่: token หลังใน phrase หรือ typo ที่คล้าย code หลักแต่ฐานเล็กกว่า
    // เช่น "บอนด์ ณราวิชย์" ทำให้ code "ณราวิชย์" เป็น alias ของ "บอนด์"
    const suspiciousAliasCodeIds = new Set()
    const aliasPreferredCodeId = new Map()
    const semanticCodes = flatCodes.filter((c) => !isGenericAiMatchCode(c))
    for (const a of allAnswers) {
      const tokens = aiTokens(a.text)
      if (tokens.length < 2) continue
      const primary = tokens[0]
      const primaryCode = semanticCodes
        .filter((c) => aiNeoMatchesCode(primary, c.thai || c.codeNo))
        .sort((x, y) => (countByCodeForAI[y.id] ?? 0) - (countByCodeForAI[x.id] ?? 0) || String(x.thai || x.codeNo).length - String(y.thai || y.codeNo).length)[0]
      if (!primaryCode) continue
      for (const alias of tokens.slice(1)) {
        for (const c of semanticCodes) {
          if (c.id === primaryCode.id) continue
          if (aiNeoMatchesCode(alias, c.thai || c.codeNo) && (countByCodeForAI[primaryCode.id] ?? 0) >= (countByCodeForAI[c.id] ?? 0)) {
            suspiciousAliasCodeIds.add(c.id)
            aliasPreferredCodeId.set(c.id, primaryCode.id)
          }
        }
      }
    }
    for (let i = 0; i < semanticCodes.length; i++) {
      for (let j = i + 1; j < semanticCodes.length; j++) {
        const a = semanticCodes[i]
        const b = semanticCodes[j]
        if (!codeLooksLikeAliasOf(a.thai || a.codeNo, b.thai || b.codeNo)) continue
        const ca = countByCodeForAI[a.id] ?? 0
        const cb = countByCodeForAI[b.id] ?? 0
        if (ca > cb) {
          suspiciousAliasCodeIds.add(b.id)
          aliasPreferredCodeId.set(b.id, a.id)
        } else if (cb > ca) {
          suspiciousAliasCodeIds.add(a.id)
          aliasPreferredCodeId.set(a.id, b.id)
        }
      }
    }

    const targets = answers.filter((a) => {
      const ids = sheet.assignments[a.key] ?? []
      const wronglyInNonAnswer = ids.some((id) => {
        const c = codeById.get(id)
        return c && isNonAnswerLabel(c.thai || c.codeNo) && !isNonAnswerLabel(a.text)
      })
      return !ids.length || ids.every((id) => genericCodeIds.has(id)) || ids.some((id) => aiCreatedCodeIds.has(id)) || ids.some((id) => suspiciousAliasCodeIds.has(id)) || wronglyInNonAnswer
    })
    if (!targets.length) {
      setToast({ type: 'info', title: 'จัดกลุ่มครบแล้ว', message: 'ไม่มีคำตอบที่ยังไม่ได้จัดกลุ่มเหลือให้ทำ' })
      return
    }
    const reusableCodes = flatCodes
      .map((code, originalIndex) => ({ code, originalIndex }))
      .filter(({ code }) => !isGenericAiMatchCode(code))
    const skippedGeneric = flatCodes.length - reusableCodes.length
    const codeItems = reusableCodes.map(({ code }, i) => ({ i, label: code.thai || code.codeNo, count: countByCodeForAI[code.id] ?? 0 }))
    const vItems = targets.map((a, i) => ({ i, text: a.text, count: a.count }))

    saveCheckpoint('Auto backup ก่อน Group CE ด้วย AI')
    setAiBusy('AI กำลังจัดกลุ่ม')
    try {
      const { assign } = await aiGroupCE(codeItems, vItems)
      // คำนวณ assignment + Code ใหม่ (dedupe ตามชื่อ)
      const newByLabel = new Map()
      const newCodes = []
      let codeNo = parseInt(nextCodeNo(sheet), 10) || 1
      const addAssign = {}
      let matched = 0
      let fallbackCreated = 0
      targets.forEach((target, i) => {
        const directPrimaryCode = pickBestExistingCodeForText(target.text, reusableCodes, countByCodeForAI)
        if (directPrimaryCode?.code) {
          addAssign[target.key] = [directPrimaryCode.code.id]
          matched += 1
          return
        }
        const currentPreferredCodeId = (sheet.assignments[target.key] ?? [])
          .map((id) => aliasPreferredCodeId.get(id))
          .find(Boolean)
        if (currentPreferredCodeId && (!isNonAnswerLabel(findCode(sheet, currentPreferredCodeId)?.thai || '') || isNonAnswerLabel(target.text))) {
          addAssign[target.key] = [currentPreferredCodeId]
          matched += 1
          return
        }
        const entry = assign?.[i]
        const key = target.key
        if (entry?.existing != null && reusableCodes[entry.existing]?.code) {
          const targetCode = reusableCodes[entry.existing].code
          const targetCodeLabel = targetCode.thai || targetCode.codeNo
          if (!isNonAnswerLabel(targetCodeLabel) || isNonAnswerLabel(target.text)) {
            addAssign[key] = [targetCode.id]
            matched += 1
            return
          }
          // AI เลือก code ไม่ทราบ/จำไม่ได้ให้คำตอบที่เป็นเนื้อหา → ไม่รับผลนี้ ให้ fallback หา code จริงแทน
        }

        // สำคัญ: Group CE ต้องไม่ปล่อยคำตอบตกหล่น
        // ถ้า AI ตอบ null / ไม่ครบ / index ผิด ให้สร้าง Code ใหม่จากคำตอบนั้นทันที
        // เพื่อให้รายการด้านขวาถูกจัดครบ 100% ทุกครั้ง
        const fallbackLabel = canonicalAiNeoLabel(entry?.neo || target.text || 'อื่น ๆ')
        const matchedReusable = reusableCodes
          .filter(({ code }) => aiNeoMatchesCode(fallbackLabel, code.thai || code.codeNo))
          .sort((a, b) => (countByCodeForAI[b.code.id] ?? 0) - (countByCodeForAI[a.code.id] ?? 0) || String(a.code.thai || a.code.codeNo).length - String(b.code.thai || b.code.codeNo).length)[0]
        if (matchedReusable?.code) {
          addAssign[key] = [matchedReusable.code.id]
          matched += 1
          return
        }
        let id = newByLabel.get(fallbackLabel)
        if (!id) {
          id = uid()
          newByLabel.set(fallbackLabel, id)
          // aiNew: true → เก็บลง DB เป็นเครื่องหมาย "Code ที่ AI สร้างใหม่" (ไฮไลต์ถาวร)
          newCodes.push({ id, codeNo: String(codeNo++), thai: fallbackLabel, thai2: '', eng: '', aiNew: true })
        }
        if (!entry?.neo) fallbackCreated += 1
        addAssign[key] = [id]
      })
      const newIds = newCodes.map((c) => c.id)
      const targetKeys = new Set(targets.map((a) => a.key))
      updateSheet((s) => {
        const nets = s.nets.length ? s.nets.map((n) => ({ ...n, codes: [...n.codes] })) : [{ id: uid(), name: '', level: 0, codes: [] }]
        const last = nets[nets.length - 1]
        last.codes.push(...newCodes) // Code ใหม่ต่อท้ายกลุ่มสุดท้าย
        const assignments = { ...s.assignments }
        for (const key of targetKeys) delete assignments[key]
        let nextAssignments = { ...assignments, ...addAssign }
        nextAssignments = Object.fromEntries(
          Object.entries(nextAssignments).map(([key, ids]) => [
            key,
            [...new Set((ids ?? []).map((id) => aliasPreferredCodeId.get(id) || id))],
          ]),
        )
        const fullLabelByCode = new Map()
        for (const a of allAnswers) {
          const label = canonicalFullAiLabel(a.text)
          if (!label) continue
          for (const cid of nextAssignments[a.key] ?? []) {
            const prev = fullLabelByCode.get(cid)
            const prevScore = prev ? (prev.count * 100 + prev.label.length) : -1
            const score = (a.count || 0) * 100 + label.length
            if (score > prevScore) fullLabelByCode.set(cid, { label, count: a.count || 0 })
          }
        }
        const promotedNets = nets.map((n) => ({
          ...n,
          codes: n.codes.map((c) => {
            const candidate = fullLabelByCode.get(c.id)?.label
            return shouldPromoteCodeLabel(c.thai || c.codeNo, candidate) ? { ...c, thai: candidate } : c
          }),
        }))
        const usedIds = new Set(Object.values(nextAssignments).flat())
        const cleanedNets = promotedNets.map((n) => ({
          ...n,
          codes: n.codes.filter((c) => usedIds.has(c.id) || (!c.aiNew && !suspiciousAliasCodeIds.has(c.id))),
        }))
        return { ...s, nets: cleanedNets, assignments: nextAssignments }
      })
      // ไฮไลต์ Code ที่สร้างใหม่ — ค้างไว้จนกว่าจะเปลี่ยนชีท + เลื่อนไปหาตัวแรก
      if (newIds.length) {
        setNewCodeIds(new Set(newIds))
        requestAnimationFrame(() => codeRowRefs.current[newIds[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      }
      setToast({
        type: 'success',
        title: 'Group CE เสร็จแล้ว',
        message: `จับเข้า Code เดิม ${matched} คำตอบ · สร้าง Code ใหม่ ${newCodes.length} รหัส${fallbackCreated ? ` · กันตกหล่น ${fallbackCreated} คำตอบ` : ''}${skippedGeneric ? ` · ข้าม Code placeholder ${skippedGeneric} รหัส` : ''} (ไฮไลต์เหลืองให้แล้ว)`,
        duration: 7000,
      })
    } catch (err) {
      setToast({ type: 'warning', title: 'Group CE ไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setAiBusy(null)
    }
  }

  // โหมด B: สร้างรหัสใหม่จากการจัดกลุ่มคำตอบ (rule) — รองรับ Net อัตโนมัติ + 1 คำตอบหลายโค้ด
  const runBuildFromAnswers = (opts) => {
    setBuildOpen(false)
    setAutoMenuOpen(false)
    const targets = answers.filter((a) => !(sheet.assignments[a.key] ?? []).length)
    if (!targets.length) {
      setToast({ type: 'info', title: 'ทุกคำตอบถูกจัดกลุ่มแล้ว', message: 'ไม่มีคำตอบที่ยังไม่ได้จัดกลุ่มเหลือให้สร้างรหัส' })
      return
    }
    const { nets, assignments, codeCount } = buildCodeframeAdvanced(targets, uid, opts)
    const multi = targets.filter((a) => (assignments[a.key] ?? []).length > 1).length
    updateSheet((s) => ({
      ...s,
      nets: [...s.nets, ...nets],
      assignments: { ...s.assignments, ...assignments },
    }))
    setToast({
      type: 'success',
      title: `สร้าง ${codeCount} รหัสใน ${nets.length} Net จาก ${targets.length} คำตอบ`,
      message: multi
        ? `มี ${multi} คำตอบที่ถูกแตกเข้าหลายโค้ด — แก้ชื่อ/รวม/ย้าย หรือกด "ให้ Claude รีวิว" เพื่อตรวจ-แก้ต่อได้`
        : 'ร่างรหัสและจัดคำตอบให้แล้ว — แก้ชื่อ/รวม/ย้าย หรือกด "ให้ Claude รีวิว" เพื่อตรวจ-แก้ต่อได้',
      duration: 6000,
    })
  }

  // ให้ Claude รีวิว & แก้โครงทั้งชีท: ส่งคำตอบ + โค้ดเดิมที่จัดไว้ → แทนที่ Net/assignment ด้วยผลที่แก้แล้ว
  const runReviewWithAI = async () => {
    setAutoMenuOpen(false)
    if (!answers.length) {
      setToast({ type: 'warning', title: 'ยังไม่มีคำตอบให้รีวิว', message: 'เลือก "ข้อในชีทนี้" ด้านบนก่อน เพื่อดึงคำตอบจาก Rawdata' })
      return
    }
    if (!codeCount) {
      setToast({ type: 'warning', title: 'ยังไม่มีโครงให้รีวิว', message: 'สร้างรหัสก่อน (เช่น "สร้างรหัสจากคำตอบ (rule)") แล้วจึงให้ Claude รีวิวได้' })
      return
    }
    // ส่งทุกคำตอบในชีท พร้อมแนบโค้ดเดิมที่จัดไว้เป็น hint ให้ Claude ตรวจ
    const targets = answers
    const verbatims = targets.map((a) => ({
      text: a.text,
      count: a.count,
      current: (sheet.assignments[a.key] ?? []).map((cid) => findCode(sheet, cid)?.thai).filter(Boolean),
    }))

    setAiBusy(`Claude กำลังรีวิว & แก้โครงจาก ${verbatims.length} คำตอบ…`)
    try {
      const result = await aiReviewAnswers(verbatims)
      const { nets, assignments, codeCount: cc } = assembleCodingResult(targets, result, uid)
      if (!cc) throw new Error('AI ไม่ได้ส่งรหัสที่แก้แล้วกลับมา')
      const multi = targets.filter((a) => (assignments[a.key] ?? []).length > 1).length
      // แทนที่โครงทั้งชีทด้วยผลที่รีวิวแล้ว (คำตอบที่ไม่มีโค้ดจะกลายเป็นยังไม่จัดกลุ่ม)
      updateSheet((s) => ({ ...s, nets, assignments }))
      setToast({
        type: 'success',
        title: `Claude รีวิวแล้ว: ${cc} รหัสใน ${nets.length} Net`,
        message: `ตรวจ/รวมโค้ดซ้ำ/ย้าย Net และจัดกลุ่มใหม่ให้แล้ว${multi ? ` (มี ${multi} คำตอบลงหลายโค้ด)` : ''} — โครงเดิมถูกแทนที่ด้วยผลที่แก้แล้ว`,
        duration: 7000,
      })
    } catch (err) {
      setToast({ type: 'warning', title: 'รีวิวด้วย AI ไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setAiBusy(null)
    }
  }

  // โหมด C: coding ละเอียด — ส่ง verbatim ดิบให้ Claude สร้าง codeframe
  //          และจับ "หลายโค้ดต่อ 1 คำตอบ" (คำตอบที่มีหลายเหตุผลจะถูกแตกเข้าหลายรหัส)
  const runBuildWithAI = async () => {
    setBuildOpen(false)
    setAutoMenuOpen(false)
    const targets = answers.filter((a) => !(sheet.assignments[a.key] ?? []).length)
    if (!targets.length) {
      setToast({ type: 'info', title: 'ทุกคำตอบถูกจัดกลุ่มแล้ว', message: 'ไม่มีคำตอบที่ยังไม่ได้จัดกลุ่มเหลือให้สร้างรหัส' })
      return
    }
    const verbatims = targets.map((a) => ({ text: a.text, count: a.count }))

    setAiBusy(`Claude กำลังโค้ดดิ้ง ${verbatims.length} คำตอบ (แตกได้หลายโค้ดต่อคำตอบ)…`)
    try {
      const coding = await aiCodeAnswers(verbatims)
      const { nets, assignments, codeCount } = assembleCodingResult(targets, coding, uid)
      if (!codeCount) throw new Error('AI ไม่ได้สร้างรหัสกลับมา')
      // นับคำตอบที่ถูกแตกเข้ามากกว่า 1 โค้ด (ไว้อวดผลให้ผู้ใช้เห็น)
      const multi = targets.filter((a) => (assignments[a.key] ?? []).length > 1).length
      updateSheet((s) => ({
        ...s,
        nets: [...s.nets, ...nets],
        assignments: { ...s.assignments, ...assignments },
      }))
      setToast({
        type: 'success',
        title: `AI สร้าง ${codeCount} รหัสใน ${nets.length} Net`,
        message: multi
          ? `จาก ${targets.length} คำตอบ — มี ${multi} คำตอบที่ถูกแตกเข้าหลายโค้ด แก้ชื่อ/ย้าย/รวมได้ตามต้องการ`
          : `จาก ${targets.length} คำตอบ — แก้ชื่อ Net / ย้ายรหัส / รวม-แยกกลุ่มได้ตามต้องการ`,
        duration: 6500,
      })
    } catch (err) {
      // ล้มเหลว → fallback เป็น rule แบบ 1 คำตอบ 1 โค้ด ไม่ให้งานหาย
      const { net, assignments } = buildCodeframeFromAnswers(targets, uid, { threshold: 0.5 })
      updateSheet((s) => ({
        ...s,
        nets: [...s.nets, net],
        assignments: { ...s.assignments, ...assignments },
      }))
      setToast({
        type: 'warning',
        title: 'เรียก AI ไม่สำเร็จ — ใช้แบบ rule แทนชั่วคราว',
        message: `${err.message} (สร้างรหัสแบบ 1 คำตอบ 1 โค้ดไว้ให้ จัดกลุ่มเองต่อได้)`,
        duration: 8000,
      })
    } finally {
      setAiBusy(null)
    }
  }

  // โหมด D: เอา "รหัสที่มีอยู่แล้ว" ในชีทมาจัดเป็น Net ใหม่ด้วย AI (assignment เดิมคงไว้)
  const runReorganizeWithAI = async () => {
    setAutoMenuOpen(false)
    const flatCodes = sheet.nets.flatMap((n) => n.codes)
    if (!flatCodes.length) {
      setToast({ type: 'warning', title: 'ยังไม่มีรหัสให้จัดระเบียบ', message: 'สร้างรหัสก่อน (เช่น "สร้างรหัส + จัดกลุ่มด้วย AI") แล้วจึงจัดระเบียบเป็น Net ได้' })
      return
    }
    const countByCode = {}
    for (const a of allAnswers) {
      for (const cid of sheet.assignments[a.key] ?? []) {
        countByCode[cid] = (countByCode[cid] ?? 0) + a.count
      }
    }
    const codesForAI = flatCodes.map((c) => ({ text: c.thai || c.codeNo, count: countByCode[c.id] ?? 0 }))

    setAiBusy(`Claude กำลังจัด ${codesForAI.length} รหัสที่มีอยู่ให้เป็นหมวดหมู่…`)
    try {
      const grouping = await aiGroupCodes(codesForAI)
      const nets = assembleNetsFromGrouping(flatCodes, grouping, uid)
      // แทนที่ Net เดิมทั้งหมดด้วย Net ที่จัดใหม่ — assignment (answerKey→codeId) ไม่เปลี่ยน เพราะ code.id เดิม
      updateSheet((s) => ({ ...s, nets }))
      setToast({
        type: 'success',
        title: `จัดใหม่เป็น ${nets.length} Net จาก ${codesForAI.length} รหัส`,
        message: 'Claude จัดรหัสเดิมเข้าหมวดตามความหมายให้แล้ว โดยคำตอบที่จัดกลุ่มไว้ยังอยู่ครบ',
        duration: 6000,
      })
    } catch (err) {
      setToast({ type: 'warning', title: 'เรียก AI ไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setAiBusy(null)
    }
  }

  const handleImportFrame = async (file) => {
    if (!file) return
    setImportError('')
    try {
      const nets = await parseFrameFile(file, uid)
      // Import เฉพาะชีท: แทนโครง nets ของชีทปัจจุบัน แต่คง questionIds / assignments / rules เดิมไว้
      updateSheet((s) => ({ ...s, nets }))
      setToast({ type: 'success', title: 'นำเข้าโครงเฉพาะชีทแล้ว', message: `แทนโครงของชีท ${sheet.name} ด้วย ${nets.reduce((n, net) => n + (net.codes?.length ?? 0), 0)} Code`, duration: 5000 })
    } catch (err) {
      setImportError(err.message)
    }
  }

  const addSheet = () => {
    const newSheet = {
      id: uid(),
      name: `ชีท ${cf.sheets.length + 1}`,
      questionIds: [],
      nets: [],
      assignments: {},
    }
    updateCodeframe(cf.id, (c) => ({ ...c, sheets: [...c.sheets, newSheet] }))
    setActiveSheetId(newSheet.id)
  }

  const removeSheet = (sheetId) => {
    updateCodeframe(cf.id, (c) => ({ ...c, sheets: c.sheets.filter((s) => s.id !== sheetId) }))
    if (activeSheetId === sheetId) setActiveSheetId(cf.sheets.find((s) => s.id !== sheetId)?.id ?? null)
  }

  const renameSheet = (sheetId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateCodeframe(cf.id, (c) => ({
      ...c,
      sheets: c.sheets.map((s) => (s.id === sheetId ? { ...s, name: trimmed } : s)),
    }))
  }

  const statusKeyForSheet = (s) => {
    const real = sheetStatusMap[s.id] ?? 'none'
    const hasNewWork = ['orange', 'red', 'maroon'].includes(real)
    return s.hiddenCodeframe && !hasNewWork ? 'hidden' : real
  }

  const graySheets = (cf.sheets ?? []).filter((s) => (sheetStatusMap[s.id] ?? 'none') === 'gray')
  const hiddenGraySheetCount = graySheets.filter((s) => s.hiddenCodeframe).length
  const graySheetCount = graySheets.length
  const visibleSheetTabs = (cf.sheets ?? []).filter((s) => statusKeyForSheet(s) !== 'hidden')

  const toggleHideGraySheets = () => {
    const shouldUnhide = hiddenGraySheetCount > 0
    const grayIds = new Set(graySheets.map((s) => s.id))
    const nextActiveSheetId = (!shouldUnhide && grayIds.has(activeSheetId))
      ? ((cf.sheets ?? []).find((s) => !grayIds.has(s.id))?.id ?? activeSheetId)
      : activeSheetId
    updateCodeframe(cf.id, (c) => ({
      ...c,
      sheets: c.sheets.map((s) => {
        if (!grayIds.has(s.id)) return s
        return { ...s, hiddenCodeframe: shouldUnhide ? false : true, hiddenAt: shouldUnhide ? null : Date.now() }
      }),
    }))
    if (nextActiveSheetId !== activeSheetId) {
      setActiveSheetId(nextActiveSheetId)
      setSelectedAnswer(null)
    }
  }

  // ---------- เลือก/รวม/ย้ายหลายรหัส (โครงที่ Group แล้ว) ----------
  const toggleSelectCode = (codeId) => {
    setSelectedCodeIds((prev) => {
      const next = new Set(prev)
      next.has(codeId) ? next.delete(codeId) : next.add(codeId)
      return next
    })
  }

  const toggleSelectNet = (net) => {
    const ids = net.codes.map((c) => c.id)
    const allChosen = ids.length > 0 && ids.every((id) => selectedCodeIds.has(id))
    setSelectedCodeIds((prev) => {
      const next = new Set(prev)
      if (allChosen) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  const clearSelection = () => setSelectedCodeIds(new Set())

  const getDuplicateCodeGroups = () => {
    const buckets = new Map()
    for (const code of sheet.nets.flatMap((n) => n.codes)) {
      const key = normalizeCodeLabel(code.thai || code.eng || code.thai2 || '')
      if (!key || key.length < 2) continue
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(code)
    }
    return [...buckets.values()].filter((g) => g.length > 1)
  }

  const selectDuplicateGroup = (group) => {
    setSelectedCodeIds(new Set(group.map((c) => c.id)))
    setDuplicateOpen(false)
    requestAnimationFrame(() => codeRowRefs.current[group[0]?.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    setToast({ type: 'info', title: `เลือก ${group.length} Code ที่คล้าย/ซ้ำแล้ว`, message: 'ตรวจปลายทาง แล้วกดคลิกขวา → รวมเป็นรหัสเดียว หรือกดปุ่มรวมจากเมนู' })
  }

  // ลำดับ id ของรหัสทั้งหมดในชีท (ข้าม Net) — ใช้คำนวณช่วงตอน Shift+คลิก
  const flatCodeIds = () => sheet.nets.flatMap((n) => n.codes.map((c) => c.id))

  // เลือกรหัสเป็น "ช่วง" จาก anchor → รหัสที่คลิก (Shift+คลิก)
  const selectRange = (anchorId, targetId) => {
    const flat = flatCodeIds()
    const i1 = flat.indexOf(anchorId)
    const i2 = flat.indexOf(targetId)
    if (i1 < 0 || i2 < 0) return
    const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1]
    const range = flat.slice(lo, hi + 1)
    setSelectedCodeIds((prev) => new Set([...prev, ...range]))
  }

  // คลิกที่แถวรหัสเพื่อเลือก: คลิกธรรมดา = เลือกตัวเดียว · Ctrl/Cmd = สลับเพิ่ม-ลบ · Shift = เลือกช่วง
  const onCodeClick = (e, codeId) => {
    if (e.shiftKey && lastClickedCodeId) {
      selectRange(lastClickedCodeId, codeId)
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelectCode(codeId)
      setLastClickedCodeId(codeId)
    } else {
      setSelectedCodeIds(new Set([codeId]))
      setLastClickedCodeId(codeId)
    }
  }

  // คลิกขวาที่รหัส → ถ้ายังไม่ถูกเลือก ให้เลือกรหัสนี้ก่อน แล้วเปิดเมนู
  const openCodeCtx = (e, codeId) => {
    e.preventDefault()
    setSelectedCodeIds((prev) => (prev.has(codeId) ? prev : new Set([codeId])))
    setLastClickedCodeId(codeId)
    setCodeCtx({ x: e.clientX, y: e.clientY, codeId })
  }

  // รวมรหัสที่เลือกเป็นรหัสเดียว — ใช้รหัสตัวแรก (ตามลำดับในโครง) เป็นปลายทาง
  // คำตอบที่จัดไว้กับรหัสที่ถูกรวมจะย้ายมาที่รหัสปลายทางทั้งหมด
  const mergeSelectedCodes = () => {
    if (selectedCodeIds.size < 2) return
    const flat = sheet.nets.flatMap((n) => n.codes)
    const targetId = flat.find((c) => selectedCodeIds.has(c.id))?.id
    if (!targetId) return
    const removeIds = new Set([...selectedCodeIds].filter((id) => id !== targetId))
    updateSheet((s) => {
      // ย้าย assignment ของรหัสที่ถูกรวม → รหัสปลายทาง (ไม่ให้ซ้ำ)
      const assignments = {}
      for (const [key, ids] of Object.entries(s.assignments)) {
        const mapped = ids.map((id) => (removeIds.has(id) ? targetId : id))
        assignments[key] = [...new Set(mapped)]
      }
      return {
        ...s,
        nets: s.nets.map((n) => ({ ...n, codes: n.codes.filter((c) => !removeIds.has(c.id)) })),
        assignments,
      }
    })
    clearSelection()
    setToast({
      type: 'success',
      title: `รวม ${removeIds.size + 1} รหัสเป็นรหัสเดียวแล้ว`,
      message: 'คำตอบที่จัดกลุ่มของรหัสที่ถูกรวมถูกย้ายมารวมที่รหัสปลายทางให้แล้ว',
    })
  }

  // ย้ายรหัสที่เลือกเข้า Net ปลายทาง (targetNetId = '__new__' = สร้าง Net ใหม่)
  const moveSelectedCodesToNet = (targetNetId, newNetName) => {
    if (!selectedCodeIds.size) return
    updateSheet((s) => {
      const moving = []
      const nets = s.nets.map((n) => ({
        ...n,
        codes: n.codes.filter((c) => {
          if (selectedCodeIds.has(c.id)) { moving.push(c); return false }
          return true
        }),
      }))
      if (targetNetId === '__new__') {
        nets.push({ id: uid(), name: (newNetName || '').trim() || 'กลุ่มใหม่', codes: moving })
      } else {
        const idx = nets.findIndex((n) => n.id === targetNetId)
        if (idx >= 0) nets[idx] = { ...nets[idx], codes: [...nets[idx].codes, ...moving] }
        else nets.push({ id: uid(), name: 'กลุ่มใหม่', codes: moving })
      }
      // ทิ้ง Net ที่ว่างหลังย้ายออก (ยกเว้นปลายทาง)
      return { ...s, nets: nets.filter((n) => n.codes.length > 0) }
    })
    const count = selectedCodeIds.size
    clearSelection()
    setMoveOpen(false)
    setToast({ type: 'success', title: `ย้าย ${count} รหัสเข้ากลุ่มใหม่แล้ว`, message: 'คำตอบที่จัดกลุ่มไว้กับรหัสเหล่านี้ยังอยู่ครบ' })
  }

  // ---------- แก้ wording ของคำตอบ → เขียนทับ Rawdata จริง (ทั้ง Job) ----------
  const applyWordingEditMany = (oldKeys, rawNew) => {
    const keys = [...new Set((Array.isArray(oldKeys) ? oldKeys : [oldKeys]).map((v) => String(v ?? '').trim()).filter(Boolean))]
    const newText = String(rawNew ?? '').trim()
    if (!newText || !keys.length || (keys.length === 1 && newText === keys[0])) {
      setEditingAnswer(null)
      setPopupEditingAnswer(null)
      return
    }
    if (!rawdata) {
      setEditingAnswer(null)
      setPopupEditingAnswer(null)
      return
    }

    const oldSet = new Set(keys)
    const mergeMembersByKey = new Map(keys.map((k) => [k, { key: k, cells: [], count: 0 }]))
    // 1) แทนข้อความในทุกเซลล์ของ Rawdata ที่ตรงกับคำตอบเดิมแบบเป๊ะ
    let changed = 0
    const rows = rawdata.rows.map((row, ri) => {
      let copy = null
      for (let c = 0; c < row.length; c++) {
        const oldText = String(row[c] ?? '').trim()
        if (oldSet.has(oldText)) {
          if (!copy) copy = row.slice()
          copy[c] = newText
          const member = mergeMembersByKey.get(oldText)
          if (member) {
            member.cells.push([ri, c])
            member.count += 1
          }
          changed += 1
        }
      }
      return copy ?? row
    })
    if (!changed) {
      setEditingAnswer(null)
      setPopupEditingAnswer(null)
      return
    }

    // 2) ย้าย assignment ที่ใช้ข้อความเดิมเป็น key → key ใหม่ ในทุกชีทของทุก Codeframe ใน Project นี้
    const mergeMembers = [...mergeMembersByKey.values()].filter((m) => m.cells.length)
    const shouldRecordMerge = mergeMembers.length > 1 || (mergeMembers.length === 1 && mergeMembers[0].key !== newText)
    for (const c of state.codeframes.filter((cf2) => cf2.projectId === projectId)) {
      updateCodeframe(c.id, (cur) => ({
        ...cur,
        sheets: cur.sheets.map((s) => {
          const nextSheet = keys.reduce((next, oldKey) => migrateAssignKey(next, oldKey, newText), s)
          if (!shouldRecordMerge || c.id !== cf.id || s.id !== sheet.id) return nextSheet
          const oldGroups = nextSheet.verbatimMergeGroups ?? []
          const remainingGroups = oldGroups.filter((g) => g.key !== newText)
          const priorMembers = oldGroups
            .filter((g) => g.key === newText)
            .flatMap((g) => g.members ?? [])
          const memberMap = new Map()
          for (const m of priorMembers) memberMap.set(m.key, { ...m, cells: [...(m.cells ?? [])], count: m.count ?? (m.cells?.length ?? 0) })
          for (const m of mergeMembers) {
            const prev = memberMap.get(m.key)
            memberMap.set(m.key, {
              key: m.key,
              cells: [...(prev?.cells ?? []), ...m.cells],
              count: (prev?.count ?? 0) + m.count,
            })
          }
          const mergedGroup = {
            id: uid(),
            key: newText,
            createdAt: nowMs(),
            members: [...memberMap.values()].filter((m) => m.key !== newText || (m.cells?.length ?? 0) > 0),
          }
          return { ...nextSheet, verbatimMergeGroups: [...remainingGroups, mergedGroup] }
        }),
      }))
    }
    if (selectedAnswer && oldSet.has(selectedAnswer)) setSelectedAnswer(newText)
    setSelectedPopupAnswerKeys((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => next.delete(k))
      next.add(newText)
      return next
    })
    setLastPopupAnswerKey(newText)
    setEditingAnswer(null)
    setPopupEditingAnswer(null)
    const undoSnapshot = buildRawdataUndoSnapshot(rawdata, rows, 'edit_verbatim', `แก้ Verbatim → ${newText}`)
    stampRawdataCells(undoSnapshot).catch((err) => {
      setToast({ type: 'warning', title: 'ซิงก์ Rawdata ไป Firebase ไม่สำเร็จ', message: err.message, duration: 8000 })
    })
  }

  const applyWordingEdit = (oldKey, rawNew) => applyWordingEditMany([oldKey], rawNew)

  // คอลัมน์ปลายปิด/ข้อความ ของชีท + map codeNo → label (ไว้แสดงรายละเอียดคำตอบ CE)
  const sheetColInfo = () => {
    const cbBy = project?.codebook?.byVar
    const closedQs = []
    const textCols = []
    for (const qid of sheet.questionIds) {
      const q = rawdata?.questions.find((x) => x.id === qid)
      if (!q) continue
      const cols = q.columns ?? [q.index]
      if (cbBy?.[q.label]?.values?.length) closedQs.push({ q, cols })
      else textCols.push(...cols)
    }
    const valueLabel = new Map() // codeNo(string) → label จาก codebook (เผื่อ code ในโครงยังไม่มี)
    for (const { q } of closedQs) {
      for (const v of cbBy?.[q.label]?.values ?? []) valueLabel.set(String(v.value), v.label)
    }
    // โครงในชีทมี label ที่อาจแก้แล้ว → ใช้ก่อน
    for (const c of sheet.nets.flatMap((n) => n.codes)) if (c.thai) valueLabel.set(String(c.codeNo), c.thai)
    return { closedQs, textCols, valueLabel }
  }

  // หา respondent (แถว) ที่ตอบ verbatim นี้ + ค่าที่ตอบ "แยกตามข้อ" (เช่น d4_1 → 1, d4_2 → 99)
  const answerRespondents = (text) => {
    if (!rawdata) return { rows: [], info: sheetColInfo() }
    const info = sheetColInfo()
    const out = []
    rawdata.rows.forEach((row, ri) => {
      if (!info.textCols.some((c) => String(row[c] ?? '').trim() === text)) return
      const perQ = info.closedQs
        .map(({ q }) => ({
          qLabel: q.label,
          vals: (q.columns ?? [q.index]).map((c) => String(row[c] ?? '').trim()).filter(Boolean),
        }))
        .filter((pq) => pq.vals.length)
      out.push({ ri, sbj: String(row[0] ?? ri + 1), perQ })
    })
    return { rows: out, info }
  }

  const baseFromOtherTextColumnLabel = (label) => String(label ?? '')
    .replace(/[_\-.]\d+[_\-.]*(?:oth|other|others?|specify).*$/i, '')
    .replace(/[_\-.]*(?:oth|other|others?|specify).*$/i, '')

  const compactClosedCols = (row, cols) => {
    if ((cols ?? []).length <= 1) return []
    const before = cols.map((c) => String(row[c] ?? '').trim())
    const values = before.filter(Boolean)
    const after = [...values, ...Array(Math.max(0, cols.length - values.length)).fill('')]
    const changedCols = []
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]
      if (String(row[c] ?? '').trim() === after[i]) continue
      row[c] = after[i]
      changedCols.push(c)
    }
    return changedCols
  }

  // Stamp เฉพาะเซลล์ที่แก้ลง Rawdata ชุดเดียวกับกล่อง Verbatim (บน Rawdata ล่าสุด ไม่ทับจุดที่คนอื่นแก้)
  const stampRawdataCells = (undoSnapshot) => (undoSnapshot
    ? patchRawdata(projectId, undoSnapshot.cells, { undoSnapshot })
    : Promise.resolve())

  const buildRawdataUndoSnapshot = (beforeRawdata, afterRows, kind, title) => {
    const cells = []
    const beforeRows = beforeRawdata?.rows ?? []
    for (let r = 0; r < beforeRows.length; r++) {
      const beforeRow = beforeRows[r] ?? []
      const afterRow = afterRows?.[r] ?? []
      const width = Math.max(beforeRow.length, afterRow.length)
      for (let c = 0; c < width; c++) {
        const before = String(beforeRow[c] ?? '')
        const after = String(afterRow[c] ?? '')
        if (before === after) continue
        cells.push({ r, c, v: before, next: after, h: beforeRawdata?.headers?.[c] || '' })
      }
    }
    if (!cells.length) return null
    return {
      id: uid(),
      kind,
      title,
      createdAt: nowMs(),
      cells,
    }
  }

  // ลบ "คำตอบอื่นๆ + ค่า code อื่นๆ" ออกจาก Rawdata (ทุก respondent ที่ตอบ text นี้)
  const requestDeleteAnswers = (answerOrAnswers) => {
    const texts = [...new Set((Array.isArray(answerOrAnswers) ? answerOrAnswers : [answerOrAnswers])
      .map((a) => String(a?.text ?? a?.key ?? a ?? '').trim())
      .filter(Boolean))]
    if (!texts.length) return
    setAnswerCtx(null)
    setDeletingAnswer({ texts })
  }

  const deleteAnswersFromRawdata = async (textsInput) => {
    const texts = [...new Set((Array.isArray(textsInput) ? textsInput : [textsInput]).map((v) => String(v ?? '').trim()).filter(Boolean))]
    if (!rawdata || !texts.length) { setDeletingAnswer(null); return }
    const info = sheetColInfo()
    const textSet = new Set(texts)
    const otherValues = new Set(
      sheet.nets.flatMap((n) => n.codes).filter((c) => isOtherLabel(c.thai)).map((c) => String(c.codeNo).trim()),
    )
    const questionByCol = new Map()
    for (const q of rawdata.questions ?? []) for (const c of q.columns ?? [q.index]) questionByCol.set(c, q)
    const closedByBase = new Map()
    for (const { q, cols } of info.closedQs) {
      const base = questionGroupBase(q.label)
      if (!closedByBase.has(base)) closedByBase.set(base, [])
      closedByBase.get(base).push({ q, cols })
    }
    const pendingEditLogs = []
    let changed = 0
    let clearedOtherCodes = 0
    const rows = rawdata.rows.map((row, ri) => {
      const matchedTextCols = info.textCols.filter((c) => textSet.has(String(row[c] ?? '').trim()))
      if (!matchedTextCols.length) return row
      const copy = row.slice()
      const rowLogCols = new Set()
      // ลบข้อความในช่องระบุ + จำตำแหน่งไว้ highlight ใน Rawdata+Code
      for (const c of matchedTextCols) {
        const oldText = String(copy[c] ?? '').trim()
        if (!textSet.has(oldText)) continue
        copy[c] = ''
        changed += 1
        rowLogCols.add(c)
        pendingEditLogs.push({
          action: 'delete_verbatim_text',
          rowIndex0: ri,
          cols: [c],
          textQuestion: questionByCol.get(c)?.label || rawdata.headers?.[c] || '',
          textColumn: rawdata.headers?.[c] || `คอลัมน์ ${c + 1}`,
          textColumnIndex: c + 1,
          otherText: oldText,
        })
      }
      const specificTextCols = matchedTextCols.filter((tc) => {
        const tq = questionByCol.get(tc)
        const textLabel = tq?.label || rawdata.headers?.[tc] || ''
        return !!otherCodeFromColumnLabel(textLabel)
      })
      // ลบค่า "อื่นๆ" ในข้อปลายปิดของ row เดียวกันด้วย
      // ถ้าคอลัมน์ Verbatim ระบุ code อยู่แล้ว เช่น s13_1_211_oth ให้ลบเฉพาะ code 211 เท่านั้น
      // ห้าม fallback ไปเคลียร์ Other slot/code อื่น เช่น 13 เพราะเป็นคำตอบอื่นเดิมคนละความหมาย
      if (!specificTextCols.length) {
        for (const { q, cols } of info.closedQs) {
          for (const c of cols) {
            if (!otherValues.has(String(copy[c] ?? '').trim())) continue
            const oldCode = String(copy[c] ?? '').trim()
            copy[c] = ''
            clearedOtherCodes += 1
            rowLogCols.add(c)
            pendingEditLogs.push({
              action: 'delete_linked_other_code',
              rowIndex0: ri,
              cols: [c],
              question: q.label || '',
              codeColumn: rawdata.headers?.[c] || `คอลัมน์ ${c + 1}`,
              codeColumnIndex: c + 1,
              originalCode: oldCode,
              newCode: '',
            })
          }
        }
      }
      // code-specific: จากชื่อคอลัมน์เช่น s13_1_211_oth ต้องลบ code 211 เท่านั้น ไม่ลบ 13/Other slot อื่น
      for (const tc of specificTextCols) {
        const tq = questionByCol.get(tc)
        const textLabel = tq?.label || rawdata.headers?.[tc] || ''
        const linkedCode = otherCodeFromColumnLabel(textLabel)
        const linkedBase = baseFromOtherTextColumnLabel(textLabel)
        if (!linkedCode || !linkedBase) continue
        const targetGroups = [...closedByBase.entries()]
          .filter(([base]) => base === linkedBase)
          .flatMap(([, items]) => items)
        for (const { q, cols } of targetGroups) {
          let touched = false
          const touchedCols = []
          for (const c of cols) {
            if (String(copy[c] ?? '').trim() !== linkedCode) continue
            copy[c] = ''
            touched = true
            touchedCols.push(c)
            rowLogCols.add(c)
            clearedOtherCodes += 1
            pendingEditLogs.push({
              action: 'delete_linked_specific_other_code',
              rowIndex0: ri,
              cols: [c],
              question: q.label || linkedBase,
              textQuestion: textLabel,
              codeColumn: rawdata.headers?.[c] || `คอลัมน์ ${c + 1}`,
              codeColumnIndex: c + 1,
              textColumn: rawdata.headers?.[tc] || `คอลัมน์ ${tc + 1}`,
              textColumnIndex: tc + 1,
              otherText: String(row[tc] ?? '').trim(),
              originalCode: linkedCode,
              newCode: '',
              ruleCode: linkedCode,
            })
          }
          if (touched) {
            for (const c of compactClosedCols(copy, cols)) {
              rowLogCols.add(c)
              pendingEditLogs.push({
                action: 'compact_after_delete_linked_other_code',
                rowIndex0: ri,
                cols: [c],
                question: q.label || linkedBase,
                codeColumn: rawdata.headers?.[c] || `คอลัมน์ ${c + 1}`,
                codeColumnIndex: c + 1,
              })
            }
            // ถ้า compact ย้ายค่ามา ให้ highlight ทั้ง group ที่เกี่ยวเพื่อให้เห็นว่าชุดนี้ถูกปรับ
            for (const c of touchedCols) rowLogCols.add(c)
          }
        }
      }
      if (rowLogCols.size) {
        pendingEditLogs.push({
          action: 'delete_verbatim_row_summary',
          rowIndex0: ri,
          cols: [...rowLogCols],
          otherText: texts.join(' | '),
        })
      }
      return copy
    })
    // ลบ assignment ของคำตอบนี้ในทุกชีท และจด rawdataEditLog ในชีทปัจจุบันเพื่อให้ Rawdata+Code highlight ช่องที่ลบ
    for (const c of state.codeframes.filter((cf2) => cf2.projectId === projectId)) {
      updateCodeframe(c.id, (cur) => ({
        ...cur,
        sheets: cur.sheets.map((s) => {
          const assignments = { ...(s.assignments ?? {}) }
          let touched = false
          for (const text of texts) {
            if (assignments[text]?.length) { delete assignments[text]; touched = true }
          }
          const deletedCodes = new Set(pendingEditLogs.map((e) => String(e.ruleCode || e.originalCode || '').trim()).filter(Boolean))
          const manualRecodeRules = (s.manualRecodeRules ?? []).filter((r) => {
            if (texts.includes(String(r.sourceText ?? '').trim())) return false
            const sourceCode = findCode(s, r.sourceCodeId)?.codeNo
            const targetCode = findCode(s, r.codeId)?.codeNo
            return !deletedCodes.has(String(sourceCode ?? '').trim()) && !deletedCodes.has(String(targetCode ?? '').trim())
          })
          const base = (touched || manualRecodeRules.length !== (s.manualRecodeRules ?? []).length) ? { ...s, assignments, manualRecodeRules } : s
          if (c.id !== cf.id || s.id !== sheet.id || !pendingEditLogs.length) return base
          return {
            ...base,
            rawdataEditLog: [
              ...(base.rawdataEditLog ?? []).filter((e) => e.action !== 'delete_verbatim_row_summary' || !texts.includes(e.otherText)),
              ...pendingEditLogs.map((e) => ({ ...e, id: uid(), createdAt: nowMs() })),
            ].slice(-500),
          }
        }),
      }))
    }
    setDeletingAnswer(null)
    if (selectedAnswer && textSet.has(selectedAnswer)) setSelectedAnswer(null)
    setSelectedPopupAnswerKeys((prev) => {
      const next = new Set(prev)
      texts.forEach((t) => next.delete(t))
      return next
    })
    setToast({
      type: 'success',
      title: texts.length === 1 ? 'ลบ Verbatim แล้ว' : `ลบ Verbatim ${texts.length} รายการแล้ว`,
      message: `ลบข้อความ ${changed} จุด + ลบ Code อื่นๆ ระบุ ${clearedOtherCodes} จุดจาก Rawdata`,
      duration: 2600,
    })
    const undoSnapshot = buildRawdataUndoSnapshot(
      rawdata,
      rows,
      'delete_verbatim',
      texts.length === 1 ? `ลบ Verbatim: ${texts[0]}` : `ลบ Verbatim ${texts.length} รายการ`,
    )
    stampRawdataCells(undoSnapshot).catch((err) => {
      setToast({ type: 'warning', title: 'ซิงก์ Rawdata ไม่สำเร็จ', message: err.message, duration: 8000 })
    })
  }

  const deleteAnswerFromRawdata = (text) => deleteAnswersFromRawdata([text])

  const otherCodes = () => sheet.nets.flatMap((n) => n.codes).filter((c) => isOtherLabel(c.thai) || isOtherLabel(c.eng) || isOtherLabel(c.thai2))

  const deleteOtherCodesFromSheet = () => {
    const codes = otherCodes()
    if (!codes.length) {
      setAnswerCtx(null)
      setToast({ type: 'info', title: 'ไม่พบ Code อื่นๆ ระบุ', message: 'ชีทนี้ไม่มี Code ที่ label เป็น Other/specify ให้ลบ', duration: 3000 })
      return
    }
    const ids = new Set(codes.map((c) => c.id))
    updateSheet((s) => ({
      ...s,
      nets: s.nets.map((n) => ({ ...n, codes: n.codes.filter((c) => !ids.has(c.id)) })).filter((n) => n.codes.length > 0),
      assignments: cleanAssignments(s.assignments ?? {}, ids),
      manualRecodeRules: (s.manualRecodeRules ?? []).filter((r) => !ids.has(r.codeId) && !ids.has(r.sourceCodeId)),
    }))
    setSelectedCodeIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
    setAnswerCtx(null)
    setToast({
      type: 'success',
      title: codes.length === 1 ? 'ลบ Code อื่นๆ ระบุแล้ว' : `ลบ Code อื่นๆ ระบุ ${codes.length} Code แล้ว`,
      message: 'ลบ Code อื่นๆ/specify ออกจาก Codeframe พร้อมเคลียร์ assignment/rule ที่อ้างถึงแล้ว',
      duration: 4500,
    })
  }

  // ---------- derived ----------
  const assignedCount = Object.keys(sheet.assignments).filter((k) =>
    answers.some((a) => a.key === k),
  ).length
  const codeCount = sheet.nets.reduce((sum, n) => sum + n.codes.length, 0)
  // Sample Size N = จำนวนผู้ตอบทั้งหมดในชุดข้อมูล (ฐานสำหรับคิด frequency/%)
  const baseN = project?.rawMeta?.rowCount ?? 0

  const assignedAnswersOf = (codeId) =>
    allAnswers.filter((a) => (sheet.assignments[a.key] ?? []).includes(codeId))

  // Code "อื่นๆ ระบุ" ในชีท — รวม label แบบ "ระบุ..." เช่น "กาแฟดำผสมผลไม้ (ระบุผลไม้)" ด้วย
  const otherCodeIds = new Set(
    sheet.nets.flatMap((n) => n.codes).filter((c) => isOtherLabel(c.thai)).map((c) => c.id),
  )
  const normalizeCodeNo = (v) => String(v ?? '').trim().replace(/\.0$/, '')
  const otherSourceLabelsByCodeNo = (() => {
    const map = new Map()
    if (!rawdata || !project?.codebook || !sheet) return map
    const byId = new Map(rawdata.questions.map((q) => [q.id, q]))
    const sheetQuestions = (sheet.questionIds ?? []).map((qid) => byId.get(qid)).filter(Boolean)
    const sheetTextQuestions = sheetQuestions.filter((q) => !(project.codebook?.byVar?.[q.label]?.values?.length))
    const sheetClosedQuestions = sheetQuestions.filter((q) => project.codebook?.byVar?.[q.label]?.values?.length)

    const addLabel = (codeNo, label) => {
      if (!map.has(codeNo)) map.set(codeNo, new Set())
      map.get(codeNo).add(label)
    }

    const codeNoRegex = (codeNo) => {
      const esc = codeNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // จับเฉพาะเลข code ที่เป็นส่วนของชื่อ Oth จริง เช่น s13_1_211_oth / s13_1_13_other
      // ห้ามให้ code 1 ไป match prefix s13_1_211_oth
      return new RegExp(`(?:^|[_\\-.])${esc}(?=[_\\-.]*(?:oth|other|others?|specify)(?:$|[_\\-.\\d]))`, 'i')
    }

    // 1) จับคู่จากชื่อ Oth column ในชีทโดยตรงกับ codeNo ทุกตัวในโครง
    //    สำคัญกับไฟล์จริงที่ MA แตกเป็นหลายตัวแปรย่อย และ code label ในโครงอาจถูกแก้จน detect คำว่า "ระบุ" ไม่ได้
    for (const code of sheet.nets.flatMap((n) => n.codes ?? [])) {
      const codeNo = normalizeCodeNo(code.codeNo)
      if (!codeNo) continue
      const codeNoRe = codeNoRegex(codeNo)
      const byName = sheetTextQuestions.filter((oq) => codeNoRe.test(String(oq.label ?? '')))
      for (const oq of byName) addLabel(codeNo, oq.label)
    }

    // 2) fallback จาก codebook values เฉพาะ Other/specify สำหรับไฟล์ที่ Oth อยู่ถัดจากข้อหลักแต่ชื่อ column ไม่ใส่ codeNo ชัดเจน
    // รองรับชื่อ generic แบบ q157a_oth1 / q157a_oth2 ที่เลขท้ายคือ "ลำดับช่องระบุ" ไม่ใช่ codeNo จริง:
    // ให้จับตามลำดับ Other/specify value ใน codebook เช่น 15→oth1, 16→oth2, 17→oth3
    for (const q of sheetClosedQuestions) {
      const cb = project.codebook?.byVar?.[q?.label]
      const otherValueList = (cb?.values ?? [])
        .filter((v) => isOtherLabel(v.label))
        .map((v) => normalizeCodeNo(v.value))
        .filter(Boolean)
      const byPositionAll = findOtherColumns(rawdata, q, project.codebook)
      const genericByOrder = byPositionAll.filter((oq) => !otherCodeFromColumnLabel(oq.label))
      for (const v of cb?.values ?? []) {
        if (!isOtherLabel(v.label)) continue
        const codeNo = normalizeCodeNo(v.value)
        const codeNoRe = codeNoRegex(codeNo)
        const byName = sheetTextQuestions.filter((oq) => codeNoRe.test(String(oq.label ?? '')))
        for (const oq of byName) addLabel(codeNo, oq.label)

        if (!byName.length) {
          const exact = byPositionAll.filter((oq) => codeNoRe.test(String(oq.label ?? '')))
          const orderIndex = otherValueList.indexOf(codeNo)
          const orderedGeneric = orderIndex >= 0 ? [genericByOrder[orderIndex]].filter(Boolean) : []
          const targets = exact.length ? exact : (orderedGeneric.length ? orderedGeneric : (byPositionAll.length === 1 ? byPositionAll : []))
          for (const oq of targets) addLabel(codeNo, oq.label)
        }
      }
    }
    return map
  })()

  const manualRuleSourceTextsForCode = (codeId, sh = sheet) => {
    const texts = new Set()
    for (const rule of sh.manualRecodeRules ?? []) {
      if (rule.sourceCodeId !== codeId) continue
      for (const text of sourceTextsForRule(rule, sh)) texts.add(text)
    }
    return texts
  }

  const residualOtherTextCount = (code) => {
    const labels = otherSourceLabelsByCodeNo.get(normalizeCodeNo(code.codeNo))
    if (!labels?.size) return 0
    const coveredSourceTexts = manualRuleSourceTextsForCode(code.id)
    return answers.reduce((sum, a) => {
      const ids = sheet.assignments[a.key] ?? []
      // สำหรับ code ระบุ/Oth ให้แสดงเฉพาะ Oth text ที่ยังค้างจริง:
      // - ยังไม่ assign เลย → ยังเหลือ
      // - assign กลับเข้า code Oth ตัวเดิม → เหลือจนกว่าจะถูกใช้ลง rule ตามข้อแล้ว
      // - assign ไป code อื่นแล้ว → ไม่เหลือใน code Oth นี้
      const stillInThisOtherCode = ids.length === 0 || ids.includes(code.id)
      if (!stillInThisOtherCode) return sum
      if (coveredSourceTexts.has(normalizeRuleText(a.key))) return sum
      return sum + [...labels].reduce((s, label) => s + (a.sourceCounts?.[label] ?? 0), 0)
    }, 0)
  }

  const hasOtherSourceForCode = (code) => otherSourceLabelsByCodeNo.has(normalizeCodeNo(code.codeNo))

  const noVerbatimPendingCountForCodeQuestion = (code, q, sh = sheet) => {
    if (!rawdata || !project?.codebook || !code || !q) return 0
    const codeNo = normalizeCodeNo(code.codeNo)
    if (!codeNo) return 0
    const cb = project.codebook?.byVar?.[q?.label]
    if (!(cb?.values?.length)) return 0
    const hasActiveRule = (sh.manualRecodeRules ?? []).some((r) => r.questionId === q.id && r.sourceCodeId === code.id)
    if (hasActiveRule) return 0
    const isThisCodeOtherValue = (cb.values ?? []).some((v) => normalizeCodeNo(v.value) === codeNo && isOtherLabel(v.label))
    if (!isThisCodeOtherValue) return 0
    const hasOwnVerbatim = findOtherColumns(rawdata, q, project.codebook).some((otherQ) => (sh.questionIds ?? []).includes(otherQ.id))
    if (hasOwnVerbatim) return 0
    const coveredRows = manualRuleCoveredRowsForQuestion(q, sh)
    const cols = closedQuestionGroupColumns(rawdata, q, project.codebook)
    let total = 0
    for (let r = 0; r < rawdata.rows.length; r++) {
      if (coveredRows.has(r)) continue
      if (cols.some((c) => normalizeCodeNo(rawdata.rows[r]?.[c]) === codeNo)) total += 1
    }
    return total
  }

  const noVerbatimPendingCountForCode = (code, sh = sheet) => {
    if (!rawdata || !project?.codebook || !code) return 0
    return (sh.questionIds ?? [])
      .map((qid) => rawdata.questions.find((x) => x.id === qid))
      .filter(Boolean)
      .reduce((sum, q) => sum + noVerbatimPendingCountForCodeQuestion(code, q, sh), 0)
  }

  // frequency ที่แสดงต่อ Code ใน 1 หน้า/ชีทต้องรวมทุกข้อในหน้านั้น:
  // - Oth text residual จากข้อที่มี Verbatim
  // - raw Other ของข้อในชีทเดียวกันที่ไม่มี Verbatim และยังไม่ได้เลือก rule
  // - Code ปกติ = rows ของคำตอบที่ assign เข้า code นั้น
  const freqOf = (code) => {
    const noVerbatimPending = noVerbatimPendingCountForCode(code)
    if (otherCodeIds.has(code.id) || hasOtherSourceForCode(code) || noVerbatimPending > 0) {
      return residualOtherTextCount(code) + noVerbatimPending
    }
    return assignedAnswersOf(code.id).reduce((s, a) => s + a.count, 0)
  }

  const codeVisible = (code) => {
    const q = codeSearch.trim().toLowerCase()
    const hay = `${code.codeNo ?? ''} ${code.thai ?? ''} ${code.thai2 ?? ''} ${code.eng ?? ''}`.toLowerCase()
    if (q && !hay.includes(q)) return false
    const isNew = !!code.aiNew || !!code.manualNew || newCodeIds.has(code.id)
    const n = freqOf(code)
    if (codeFilter === 'freq') return n > 0
    if (codeFilter === 'new') return isNew
    if (codeFilter === 'zero') return n === 0
    return true
  }

  const unassignedAnswers = answers.filter((a) => !(sheet.assignments[a.key] ?? []).length)
  const totalAnswerRows = answers.reduce((sum, a) => sum + a.count, 0)
  const assignedAnswerRows = answers
    .filter((a) => (sheet.assignments[a.key] ?? []).length)
    .reduce((sum, a) => sum + a.count, 0)
  const unassignedAnswerRows = unassignedAnswers.reduce((sum, a) => sum + a.count, 0)

  // คำตอบที่จะแสดงในแผงด้านขวา ตามปุ่มสลับ (เฉพาะที่ยังไม่จัดกลุ่ม / ทั้งหมด)
  const displayedAnswers =
    answerFilter === 'unassigned' ? unassignedAnswers : answers

  const popupAnswers = answers.filter((a) => {
    const assigned = !!(sheet.assignments[a.key] ?? []).length
    if (answersPopupFilter === 'unassigned' && assigned) return false
    if (answersPopupFilter === 'assigned' && !assigned) return false
    const q = answersPopupSearch.trim().toLowerCase()
    if (q && !`${a.text} ${(a.questions ?? []).join(' ')}`.toLowerCase().includes(q)) return false
    return true
  })
  const selectedPopupAnswers = popupAnswers.filter((a) => selectedPopupAnswerKeys.has(a.key))
  const popupSelectionFor = (answer) => {
    const selected = selectedPopupAnswers.length ? selectedPopupAnswers : (answer ? [answer] : [])
    return selected.length ? selected : []
  }
  const togglePopupAnswerSelection = (answer, e = {}) => {
    if (!answer) return
    const visibleKeys = popupAnswers.map((a) => a.key)
    const lastIndex = visibleKeys.indexOf(lastPopupAnswerKey)
    const thisIndex = visibleKeys.indexOf(answer.key)
    const rangeKeys = (lastIndex >= 0 && thisIndex >= 0)
      ? visibleKeys.slice(Math.min(lastIndex, thisIndex), Math.max(lastIndex, thisIndex) + 1)
      : [answer.key]
    setSelectedPopupAnswerKeys((prev) => {
      const next = (e.ctrlKey || e.metaKey || e.shiftKey) ? new Set(prev) : new Set()
      if (e.shiftKey) rangeKeys.forEach((k) => next.add(k))
      else if (e.ctrlKey || e.metaKey) {
        if (next.has(answer.key)) next.delete(answer.key)
        else next.add(answer.key)
      } else next.add(answer.key)
      return next
    })
    setLastPopupAnswerKey(answer.key)
  }
  const selectAllPopupAnswers = () => {
    setSelectedPopupAnswerKeys(new Set(popupAnswers.map((a) => a.key)))
    setLastPopupAnswerKey(popupAnswers[popupAnswers.length - 1]?.key ?? null)
  }
  const clearPopupSelection = () => {
    setSelectedPopupAnswerKeys(new Set())
    setLastPopupAnswerKey(null)
  }
  const startPopupEdit = (answer) => {
    if (!answer) return
    if (!selectedPopupAnswerKeys.has(answer.key)) {
      setSelectedPopupAnswerKeys(new Set([answer.key]))
      setLastPopupAnswerKey(answer.key)
    }
    setPopupEditingAnswer({ key: answer.key, draft: answer.text })
  }
  const commitPopupEdit = () => {
    if (!popupEditingAnswer) return
    const keys = selectedPopupAnswerKeys.has(popupEditingAnswer.key) && selectedPopupAnswerKeys.size > 1
      ? [...selectedPopupAnswerKeys]
      : [popupEditingAnswer.key]
    applyWordingEditMany(keys, popupEditingAnswer.draft)
  }
  const mergeGroupsForKey = (key) => (sheet.verbatimMergeGroups ?? [])
    .filter((g) => g.key === key && (g.members ?? []).some((m) => m.key !== key))
  const mergeInspectGroups = mergeInspect?.key ? mergeGroupsForKey(mergeInspect.key) : []
  const restoreMergedVerbatim = (groupId, memberKey) => {
    if (!rawdata || !mergeInspect?.key) return
    const group = (sheet.verbatimMergeGroups ?? []).find((g) => g.id === groupId)
    const member = group?.members?.find((m) => m.key === memberKey)
    if (!group || !member) return
    const memberCells = member.cells ?? []
    const rows = rawdata.rows.map((row) => row.slice())
    let restored = 0
    for (const [ri, ci] of memberCells) {
      if (!rows[ri]) continue
      if (String(rows[ri][ci] ?? '').trim() === group.key) {
        rows[ri][ci] = member.key
        restored += 1
      }
    }
    if (!restored) {
      setToast({ type: 'info', title: 'ไม่พบแถวที่จะแยกออก', message: 'รายการนี้อาจถูกแก้ไปแล้ว', duration: 3000 })
      return
    }
    updateSheet((s) => {
      const assignments = { ...(s.assignments ?? {}) }
      const groupIds = assignments[group.key] ?? []
      if (groupIds.length) assignments[member.key] = [...new Set([...(assignments[member.key] ?? []), ...groupIds])]
      const groups = (s.verbatimMergeGroups ?? []).map((g) => {
        if (g.id !== groupId) return g
        return { ...g, members: (g.members ?? []).filter((m) => m.key !== member.key) }
      }).filter((g) => (g.members ?? []).some((m) => m.key !== g.key))
      return { ...s, assignments, verbatimMergeGroups: groups }
    })
    setSelectedPopupAnswerKeys((prev) => new Set([...prev, member.key]))
    setLastPopupAnswerKey(member.key)
    const undoSnapshot = buildRawdataUndoSnapshot(rawdata, rows, 'split_verbatim', `แยก Verbatim กลับ: ${member.key}`)
    stampRawdataCells(undoSnapshot).catch((err) => {
      setToast({ type: 'warning', title: 'ซิงก์ Rawdata ไป Firebase ไม่สำเร็จ', message: err.message, duration: 8000 })
    })
    setToast({ type: 'success', title: 'แยก Verbatim ออกมาแล้ว', message: `คืน “${member.key}” ${restored} rows`, duration: 2600 })
  }
  const answerAssignedLabel = (a) => (sheet.assignments[a.key] ?? [])
    .map((cid) => findCode(sheet, cid))
    .filter(Boolean)
    .map((c) => `${c.codeNo} ${c.thai || ''}`.trim())
    .join(', ')

  const sourceQuestionOptionsForTarget = (targetQ, sh = sheet) => {
    if (!rawdata || !targetQ) return []
    return (sh.questionIds ?? [])
      .map((qid) => rawdata.questions.find((x) => x.id === qid))
      .filter((q) => q && q.id !== targetQ.id && project?.codebook?.byVar?.[q.label]?.values?.length)
      .map((q) => ({ q, otherQs: findOtherColumns(rawdata, q, project?.codebook).filter((otherQ) => (sh.questionIds ?? []).includes(otherQ.id)) }))
      .filter((x) => x.otherQs.length > 0)
  }

  const sheetTextQuestionCols = (sh = sheet, sourceQuestionId = null) => {
    if (!rawdata) return []
    if (sourceQuestionId) {
      const sourceQ = rawdata.questions.find((x) => x.id === sourceQuestionId)
      if (!sourceQ) return []
      const sourceCb = project?.codebook?.byVar?.[sourceQ.label]
      // If the stored source is already the Oth/Verbatim text column (e.g. q41a_oth),
      // use it directly. If it is the closed owner (q41a), use its paired Oth columns.
      if (!(sourceCb?.values?.length)) return sourceQ.columns ?? [sourceQ.index]
      return findOtherColumns(rawdata, sourceQ, project?.codebook)
        .filter((otherQ) => (sh.questionIds ?? []).includes(otherQ.id))
        .flatMap((otherQ) => otherQ.columns ?? [otherQ.index])
    }
    return (sh.questionIds ?? []).flatMap((qid) => {
      const tq = rawdata.questions.find((x) => x.id === qid)
      if (!tq) return []
      const tcb = project?.codebook?.byVar?.[tq.label]
      return tcb?.values?.length ? [] : (tq.columns ?? [tq.index])
    })
  }

  const sourceTextsForRule = (rule, sh = sheet) => {
    const sourceTexts = new Set()
    if (rule?.sourceText) sourceTexts.add(normalizeRuleText(rule.sourceText))
    if (rule?.sourceCodeId) {
      for (const [text, ids] of Object.entries(sh.assignments ?? {})) {
        if ((ids ?? []).includes(rule.sourceCodeId)) sourceTexts.add(normalizeRuleText(text))
      }
      const sourceCode = findCode(sh, rule.sourceCodeId)
      const sourceQuestions = rule.sourceQuestionId ? [rawdata?.questions.find((x) => x.id === rule.sourceQuestionId)].filter(Boolean) : (sh.questionIds ?? []).map((qid) => rawdata?.questions.find((x) => x.id === qid)).filter(Boolean)
      for (const sourceQ of sourceQuestions) {
        for (const otherQ of otherColumnsForCode(rawdata, sourceQ, project?.codebook, sourceCode?.codeNo).filter((oq) => (sh.questionIds ?? []).includes(oq.id))) {
          for (const c of otherQ.columns ?? [otherQ.index]) {
            for (const row of rawdata?.rows ?? []) {
              const text = normalizeRuleText(row[c])
              if (text) sourceTexts.add(text)
            }
          }
        }
      }
    }
    return sourceTexts
  }

  const assignableSourceRowCountForCode = (codeId, sh = sheet, sourceQuestionId = null) => {
    if (!rawdata || !codeId) return 0
    const texts = sourceTextsForRule({ sourceCodeId: codeId }, sh)
    if (!texts.size) return 0
    const cols = sheetTextQuestionCols(sh, sourceQuestionId)
    if (!cols.length) return 0
    return rawdata.rows.filter((row) => cols.some((c) => texts.has(normalizeRuleText(row[c])))).length
  }

  const manualRuleCoveredRowsForQuestion = (q, sh = sheet) => {
    if (!rawdata || !q) return new Set()
    const cb = project?.codebook?.byVar?.[q.label]
    const otherValues = new Set((cb?.values ?? []).filter((v) => isOtherLabel(v.label)).map((v) => String(v.value).trim()))
    if (!otherValues.size) return new Set()
    const closedCols = closedQuestionGroupColumns(rawdata, q, project?.codebook)
    const rows = new Set()
    for (const rule of (sh.manualRecodeRules ?? []).filter((r) => r.questionId === q.id)) {
      const sourceTexts = sourceTextsForRule(rule, sh)
      const sourceCols = sheetTextQuestionCols(sh, rule.sourceQuestionId)
      if (!sourceTexts.size || !sourceCols.length) continue
      for (let r = 0; r < rawdata.rows.length; r++) {
        const row = rawdata.rows[r]
        const hasOther = closedCols.some((c) => otherValues.has(String(row[c] ?? '').trim()))
        if (!hasOther) continue
        const hasSourceText = sourceCols.some((c) => sourceTexts.has(normalizeRuleText(row[c])))
        if (hasSourceText) rows.add(r)
      }
    }
    return rows
  }

  const questionOtherInfo = (q, sh = sheet) => {
    const cb = project?.codebook?.byVar?.[q?.label]
    const otherValues = new Set((cb?.values ?? []).filter((v) => isOtherLabel(v.label)).map((v) => String(v.value).trim()))
    const hasOtherCode = otherValues.size > 0
    const cols = closedQuestionGroupColumns(rawdata, q, project?.codebook)
    const otherRows = rawdata && hasOtherCode
      ? rawdata.rows.map((row, idx) => ({ row, idx })).filter(({ row }) => cols.some((c) => otherValues.has(String(row[c] ?? '').trim())))
      : []
    const otherFreq = otherRows.length
    const coveredRows = manualRuleCoveredRowsForQuestion(q, sh)
    const pendingOtherFreq = otherRows.filter(({ idx }) => !coveredRows.has(idx)).length
    const otherQs = rawdata && q ? findOtherColumns(rawdata, q, project?.codebook) : []
    const includedOtherQs = otherQs.filter((otherQ) => (sh.questionIds ?? []).includes(otherQ.id))
    const hasVerbatim = includedOtherQs.length > 0
    const activeRules = (sh.manualRecodeRules ?? []).filter((r) => r.questionId === q?.id)
    const activeRule = activeRules[0]
    return { hasOtherCode, otherFreq, pendingOtherFreq, coveredOtherFreq: coveredRows.size, otherQs: includedOtherQs, hasVerbatim, missingVerbatim: hasOtherCode && pendingOtherFreq > 0 && !hasVerbatim, activeRule, activeRules }
  }

  const selectedAnswerCodeIds = validSelected ? (sheet.assignments[validSelected] ?? []) : []
  const applySelectedAnswerCodeToQuestion = (q) => {
    if (!validSelected || !selectedAnswerCodeIds.length) {
      setToast({ type: 'warning', title: 'ยังไม่ได้เลือกคำตอบที่ลง Code แล้ว', message: 'ให้คลิกคำตอบ/Verbatim ที่ลง Code แล้วก่อน จากนั้นกลับมากดใช้ Code กับข้อนี้', duration: 5000 })
      return
    }
    const codeId = selectedAnswerCodeIds[0]
    const code = findCode(sheet, codeId)
    updateSheet((s) => {
      const rules = (s.manualRecodeRules ?? []).filter((r) => !(r.questionId === q.id && r.sourceText === validSelected))
      return {
        ...s,
        manualRecodeRules: [...rules, { id: uid(), questionId: q.id, sourceText: validSelected, codeId, createdAt: nowMs() }],
      }
    }, 'เพิ่มกฎลง Code ข้ามข้อ')
    setToast({ type: 'success', title: 'ตั้งกฎลง Code ข้ามข้อแล้ว', message: `${q.label}: ถ้า respondent มี “${validSelected}” จะลงเป็น ${code?.codeNo || ''} ${code?.thai || ''}`.trim(), duration: 7000 })
  }

  const clearManualRecodeRule = (ruleId) => {
    updateSheet((s) => ({ ...s, manualRecodeRules: (s.manualRecodeRules ?? []).filter((r) => r.id !== ruleId) }), 'ลบกฎลง Code ข้ามข้อ')
    setToast({ type: 'info', title: 'ลบกฎแล้ว', message: 'ยกเลิกกฎลง Code ข้ามข้อในชีทนี้แล้ว', duration: 3000 })
  }

  const applyCodeToQuestion = (codeId, q, sourceQuestionId = null) => {
    const code = findCode(sheet, codeId)
    if (!code) return
    const sourceOptions = sourceQuestionOptionsForTarget(q)
    const finalSourceQuestionId = sourceQuestionId || (sourceOptions.length === 1 ? sourceOptions[0].q.id : null)
    if (sourceOptions.length > 1 && !finalSourceQuestionId) {
      setToast({ type: 'warning', title: 'ต้องเลือกข้อที่มี Verbatim ก่อน', message: 'โครงนี้มี Verbatim หลายข้อ ให้เลือกว่าจะให้ข้อที่ไม่มี Verbatim ตามข้อไหน', duration: 6000 })
      return
    }
    const sourceRows = assignableSourceRowCountForCode(codeId, sheet, finalSourceQuestionId) + noVerbatimPendingCountForCode(code)
    if (sourceRows <= 0) {
      setToast({ type: 'warning', title: 'Code นี้ยังไม่มี respondent source', message: 'เลือก Code ที่มี text/verbatim assign อยู่ก่อน หรือมี raw Other ค้างในข้อไม่มี Verbatim', duration: 5000 })
      return
    }
    updateSheet((s) => {
      const rules = (s.manualRecodeRules ?? []).filter((r) => !(r.questionId === q.id && r.sourceCodeId === codeId && (r.sourceQuestionId || null) === (finalSourceQuestionId || null)))
      return {
        ...s,
        manualRecodeRules: [...rules, { id: uid(), questionId: q.id, sourceQuestionId: finalSourceQuestionId, sourceCodeId: codeId, codeId, createdAt: nowMs() }],
      }
    }, 'เพิ่มกฎลง Code ตามข้อที่เลือก')
    setRecodeQuestionPicker(null)
    const sourceLabel = finalSourceQuestionId ? (rawdata?.questions.find((x) => x.id === finalSourceQuestionId)?.label || 'ข้อ Verbatim') : 'ข้อ Verbatim ในโครงนี้'
    setToast({ type: 'success', title: 'ตั้งกฎลง Code ตามข้อแล้ว', message: `${q.label}: ตาม ${sourceLabel} → Code ${code.codeNo} ${code.thai || ''} (${sourceRows.toLocaleString('th-TH')} source rows)`, duration: 8000 })
  }

  const applyCodeToQuestionsBulk = (codeId, targetItems, sourceQuestionId = null) => {
    const code = findCode(sheet, codeId)
    if (!code || !targetItems?.length) return
    const prepared = []
    for (const item of targetItems) {
      const q = item.q?.rawQuestion || item.rawQuestion
      if (!q) continue
      const sourceOptions = sourceQuestionOptionsForTarget(q)
      const finalSourceQuestionId = sourceQuestionId || (sourceOptions.length === 1 ? sourceOptions[0].q.id : null)
      if (sourceOptions.length > 1 && !finalSourceQuestionId) {
        setToast({ type: 'warning', title: 'ต้องเลือกข้อที่มี Verbatim ก่อน', message: 'โครงนี้มี Verbatim หลายข้อ ให้เลือกว่าจะลงตามข้อไหน', duration: 6000 })
        return
      }
      prepared.push({ q, sourceQuestionId: finalSourceQuestionId })
    }
    if (!prepared.length) return
    updateSheet((s) => {
      const removeKeys = new Set(prepared.map((x) => `${x.q.id}::${x.sourceQuestionId || ''}`))
      const rules = (s.manualRecodeRules ?? []).filter((r) => !(r.sourceCodeId === codeId && removeKeys.has(`${r.questionId}::${r.sourceQuestionId || ''}`)))
      return {
        ...s,
        manualRecodeRules: [
          ...rules,
          ...prepared.map(({ q, sourceQuestionId }) => ({ id: uid(), questionId: q.id, sourceQuestionId, sourceCodeId: codeId, codeId, createdAt: nowMs() })),
        ],
      }
    }, 'เพิ่มกฎลง Code ตามข้อทั้งหมด')
    setCodeCtx(null)
    setRecodeQuestionPicker(null)
    const sourceLabel = prepared[0].sourceQuestionId ? (rawdata?.questions.find((x) => x.id === prepared[0].sourceQuestionId)?.label || 'ข้อ Verbatim') : 'ข้อ Verbatim ในโครงนี้'
    setToast({ type: 'success', title: 'ลง Code ตามข้อทั้งหมดแล้ว', message: `Code ${code.codeNo} ${code.thai || ''}: ลง ${prepared.length} ข้อ ตาม ${sourceLabel}`, duration: 8000 })
  }

  // ข้อปลายปิด (โจทย์) ทั้งหมดในชีท → [{ code (สั้นจาก SPSS), label (โจทย์เต็ม), column (หัวคอลัมน์ Excel) }]
  const getSheetQuestions = (sh) => {
    const cbBy = project?.codebook?.byVar
    return sh.questionIds
      .map((id) => rawdata?.questions.find((x) => x.id === id))
      .filter((q) => q && cbBy?.[q.label]?.values?.length)
      .map((q) => ({ id: q.id, rawQuestion: q, code: cbBy[q.label]?.code || q.label, label: cbBy[q.label]?.label || '', column: q.label }))
  }
  // จำนวนข้อที่โชว์บนแท็บชีท: นับเฉพาะข้อหลัก/ปลายปิด ไม่รวมคอลัมน์ Text "อื่นๆ ระบุ"
  const getSheetQuestionCount = (sh) => {
    if (project?.codebook?.byVar) return getSheetQuestions(sh).length
    return sh.questionIds.length
  }

  // แถวบนสุดของชีท Excel: รหัสข้อ (variable) + ข้อความโจทย์ (จาก codebook) — ใช้ข้อแรก
  const getSheetTitle = (sh) => {
    const qs = getSheetQuestions(sh)
    return qs[0] ?? { code: sh.name, label: '' }
  }

  // Frequency ต่อ Code แยกตามข้อ — ใช้ตอน Export Codeframe ให้ตรงกับตาราง Freq ในหน้าเว็บ
  //   perQuestion[sheetId][codeId][questionColumn] = จำนวน rows ของข้อนั้น
  //   total[sheetId][codeId] = รวมทุกข้อในชีท
  //   Code ปกติ: นับจากค่าจริงใน coded rows (buildOverwrittenRawdata) ของชีทนั้น แหล่งเดียว
  //     → ครอบคลุมทั้ง Code เดิมที่ respondent ตอบเอง, assignment ที่ยังไม่ถูกเขียนทับ,
  //       และ Code ใหม่ที่ Verbatim ถูกแทนที่ด้วย label แล้ว (จึงไม่โดน 0 เหมือนเดิม)
  //   Code อื่นๆ/ระบุ: นับจาก text ที่ยังค้าง (ยังไม่ assign หรือ assign กลับเข้า Other ตัวเดิม)
  const buildSheetFreqMaps = (sh) => {
    const freqByCode = {}
    const freqByCodeByQuestion = {}
    if (!rawdata || !sh) return { freqByCode, freqByCodeByQuestion }
    const qs = getSheetQuestions(sh)
    const sheetAnswers = uniqueAnswers(rawdata, sh.questionIds ?? [])
    const otherIds = new Set(
      (sh.nets ?? []).flatMap((n) => n.codes ?? []).filter((c) => isOtherLabel(c.thai)).map((c) => c.id),
    )
    let codedRows = null
    try {
      codedRows = buildOverwrittenRawdata(rawdata, { sheets: [sh] }, project?.codebook).rows
    } catch { codedRows = null }
    // ช่องปลายปิดของแต่ละข้อ (คอลัมน์รหัส ไม่ใช่คอลัมน์ text)
    const closedColsByQ = new Map()
    for (const q of qs) {
      const rq = rawdata.questions.find((x) => x.id === q.id)
      closedColsByQ.set(q.column, rq ? (rq.columns ?? [rq.index]) : [])
    }
    for (const net of sh.nets ?? []) {
      for (const code of net.codes ?? []) {
        const perQ = {}
        for (const q of qs) perQ[q.column] = 0
        let total = 0
        if (otherIds.has(code.id)) {
          // Code อื่นๆ/ระบุ: นับ text ต้นฉบับที่ยังค้างใน Code นี้
          for (const a of sheetAnswers) {
            const ids = sh.assignments?.[a.key] ?? []
            const stillInThisOtherCode = ids.length === 0 || ids.includes(code.id)
            if (!stillInThisOtherCode) continue
            for (const q of qs) {
              const n = a.sourceCounts?.[q.column] ?? 0
              if (n) { perQ[q.column] += n; total += n }
            }
          }
        } else if (codedRows) {
          // Code ปกติ: นับจากค่าใน coded rows โดยตรง (แหล่งเดียว ไม่มี double count)
          const codeNo = String(code.codeNo ?? '').trim()
          if (codeNo) {
            for (const q of qs) {
              const cols = closedColsByQ.get(q.column) ?? []
              for (let r = 0; r < codedRows.length; r++) {
                if (cols.some((col) => String(codedRows[r]?.[col] ?? '').trim() === codeNo)) {
                  perQ[q.column] += 1
                  total += 1
                }
              }
            }
          }
        } else {
          // สำรองเมื่อคำนวณ coded rows ไม่ได้: นับจาก assignments
          for (const a of sheetAnswers) {
            if (!(sh.assignments?.[a.key] ?? []).includes(code.id)) continue
            for (const q of qs) {
              const n = a.sourceCounts?.[q.column] ?? 0
              if (n) { perQ[q.column] += n; total += n }
            }
          }
        }
        freqByCode[code.id] = total
        freqByCodeByQuestion[code.id] = perQ
      }
    }
    return { freqByCode, freqByCodeByQuestion }
  }

  // Export 1: เฉพาะ Codeframe (โครงล้วน — ไม่มีชีท Rawdata/คำตอบ) + สีแถบชีทตามสถานะ
  //   แนบ Frequency เสมอ — ชีทมีหลายข้อจะแยกคอลัมน์ "Frequency (ข้อ)" ต่อข้อ + คอลัมน์รวมท้ายสุด
  const handleExportCodeframe = () => {
    const freqByCode = {}
    const freqByCodeByQuestion = {}
    for (const sh of cf.sheets ?? []) {
      const maps = buildSheetFreqMaps(sh)
      freqByCode[sh.id] = maps.freqByCode
      freqByCodeByQuestion[sh.id] = maps.freqByCodeByQuestion
    }
    exportCodeframe(
      cf,
      { jobNo: '', name: project.name },
      (sh) => STATUS_HEX[statusKeyForSheet(sh) ?? 'none'],
      (sh) => ({ name: sh.name, questions: getSheetQuestions(sh) }), // ชื่อชีท + โจทย์ทุกข้อ
      { freqByCode, freqByCodeByQuestion },
    ).catch((err) => setToast({ type: 'warning', title: 'Export Codeframe ไม่สำเร็จ', message: err.message, duration: 8000 }))
  }

  const handleExportCurrentSheet = () => {
    const maps = buildSheetFreqMaps(sheet)
    exportCodeframeSheet(
      cf,
      sheet,
      { jobNo: '', name: project.name },
      (sh) => STATUS_HEX[statusKeyForSheet(sh) ?? 'none'],
      (sh) => ({ name: sh.name, questions: getSheetQuestions(sh) }),
      { freqByCode: { [sheet.id]: maps.freqByCode }, freqByCodeByQuestion: { [sheet.id]: maps.freqByCodeByQuestion } },
    ).then(() => setToast({ type: 'success', title: 'Export เฉพาะชีทแล้ว', message: `ส่งออกโครง ${sheet.name} พร้อม Frequency แยกตามข้อ`, duration: 5000 }))
      .catch((err) => setToast({ type: 'warning', title: 'Export เฉพาะชีทไม่สำเร็จ', message: err.message, duration: 8000 }))
  }

  const handleExportCustomerCodeframe = () => {
    const freqByCode = {}
    const freqByCodeByQuestion = {}
    for (const sh of cf.sheets ?? []) {
      const maps = buildSheetFreqMaps(sh)
      freqByCode[sh.id] = maps.freqByCode
      freqByCodeByQuestion[sh.id] = maps.freqByCodeByQuestion
    }
    exportCodeframe(
      cf,
      { jobNo: '', name: project.name },
      (sh) => STATUS_HEX[statusKeyForSheet(sh) ?? 'none'],
      (sh) => ({ name: sh.name, questions: getSheetQuestions(sh) }),
      { preset: 'customer', freqByCode, freqByCodeByQuestion },
    ).catch((err) => setToast({ type: 'warning', title: 'Export Codeframe ลูกค้าไม่สำเร็จ', message: err.message, duration: 8000 }))
  }


  const handleExportQuestions = () => {
    const rows = (cf.sheets ?? []).flatMap((sh, sheetIndex) => {
      const qs = getSheetQuestions(sh)
      const codeCount = (sh.nets ?? []).reduce((sum, net) => sum + (net.codes?.length ?? 0), 0)
      const status = SHEET_STATUS[statusKeyForSheet(sh) ?? 'none']?.label ?? ''
      const base = {
        sheetNo: sheetIndex + 1,
        sheetName: sh.name,
        codeCount,
        status,
      }
      if (!qs.length) {
        return [{ ...base, variable: shortSheetName(sh.name), column: sh.name, question: '— (ไม่พบข้อความโจทย์ใน codebook)' }]
      }
      return qs.map((q) => ({
        ...base,
        variable: q.code || q.column || sh.name,
        column: q.column || '',
        question: q.label || '— (ไม่มีข้อความโจทย์ใน codebook)',
      }))
    })
    const safeName = `${project?.name || cf.name || 'COF'}_questions.xlsx`.replace(/[\\/:*?"<>|]/g, '_')
    exportQuestionList(rows, safeName)
      .then(() => setToast({ type: 'success', title: 'Export โจทย์สำเร็จ', message: `ส่งออก ${rows.length} รายการโจทย์แล้ว`, duration: 5000 }))
      .catch((err) => setToast({ type: 'warning', title: 'Export โจทย์ไม่สำเร็จ', message: err.message, duration: 8000 }))
  }

  // Export 2: เฉพาะ Rawdata ที่ลง Code แล้ว (เขียนทับค่าอื่นๆ + ไฮไลต์จุดที่แก้)
  const handleExportData = async () => {
    try {
      if (!rawdata) {
        setToast({ type: 'warning', title: 'ยังโหลดข้อมูลไม่เสร็จ', message: 'กรุณารอสักครู่แล้วลองใหม่' })
        return
      }
      const base = (project.rawMeta?.fileName ?? project.name ?? 'rawdata').replace(/\.(xlsx|xls|csv)$/i, '')
      // ต้นฉบับ → ไฮไลต์จุดที่แก้ข้อความ (กล่อง Verbatim / หน้านี้) ในไฟล์เดียวกับจุดลง Code
      let original = null
      if ((project.rawMeta?.originalChunkCount ?? 0) > 0) {
        try { original = await loadOriginalRawdata(projectId) } catch (err) { console.warn('load original rawdata for export failed', err) }
      }
      await exportCodedData(rawdata, cf, project.codebook, `${base}_coded.xlsx`, { original, verbatimCfg: project.boxes?.verbatim })
    } catch (err) {
      setToast({ type: 'warning', title: 'Export Data ไม่สำเร็จ', message: err.message, duration: 8000 })
    }
  }

  const getQaIssuesForSheet = (targetSheet) => {
    const issues = []
    const seen = new Map()
    const normSeen = new Map()
    const numericCodes = []
    const openIds = rawdata ? (targetSheet.questionIds ?? []).filter((qid) => {
      const q = rawdata.questions.find((x) => x.id === qid)
      const cb = project?.codebook?.byVar?.[q?.label]
      return q && !(cb?.values?.length)
    }) : []
    const targetAnswers = rawdata ? uniqueAnswers(rawdata, openIds) : []
    const allSheetAnswers = rawdata ? uniqueAnswers(rawdata, targetSheet.questionIds ?? []) : []
    const targetOtherCodeIds = new Set(
      (targetSheet.nets ?? []).flatMap((n) => n.codes ?? []).filter((c) => isOtherLabel(c.thai)).map((c) => c.id),
    )
    const frequencyForCode = (code) => {
      const source = targetOtherCodeIds.has(code.id) ? allSheetAnswers : targetAnswers
      return source
        .filter((a) => (targetSheet.assignments?.[a.key] ?? []).includes(code.id))
        .reduce((sum, a) => sum + a.count, 0)
    }
    const sheetName = targetSheet.name || 'ชีทไม่ระบุ'
    const push = (type, detail, extra = {}) => issues.push({ sheetId: targetSheet.id, sheetName, type, detail, ...extra })

    for (const q of getSheetQuestions(targetSheet)) {
      const info = questionOtherInfo(q.rawQuestion, targetSheet)
      if (info.missingVerbatim) {
        push(
          'Other ไม่มี Verbatim ยังไม่เลือก Code',
          `${q.code || q.column}: ค้างลง Code ${info.pendingOtherFreq.toLocaleString('th-TH')} / ${info.otherFreq.toLocaleString('th-TH')} rows — ต้องกดเลือก Code ให้ข้อที่ไม่มี Verbatim เอง`,
        )
      }
    }

    for (const net of targetSheet.nets ?? []) {
      if (net.level >= 1 && !String(net.name || '').trim()) push('Net ว่าง', 'มีหัว Net/Subnet ที่ยังไม่ตั้งชื่อ')
      if (net.level >= 1 && !(net.codes ?? []).length) push('Net ไม่มี Code', net.name || '(ยังไม่ตั้งชื่อ)')
      for (const code of net.codes ?? []) {
        const no = String(code.codeNo ?? '').trim()
        const norm = normalizeCodeLabel(code.thai || code.eng || code.thai2 || '')
        if (!no) push('Code No. ว่าง', code.thai || code.id, { codeId: code.id })
        else if (seen.has(no)) push('Code No. ซ้ำ', `${no} ซ้ำกับ ${seen.get(no)}`, { codeId: code.id })
        else seen.set(no, code.thai || '(ไม่มี label)')
        if (/^-?\d+$/.test(no)) numericCodes.push(Number(no))
        if (norm && normSeen.has(norm)) push('Label คล้าย/ซ้ำ', `Code ${no} ${code.thai} คล้ายกับ ${normSeen.get(norm)}`, { codeId: code.id })
        else if (norm) normSeen.set(norm, `Code ${no} ${code.thai}`)
        if (!String(code.thai || '').trim()) push('Label ว่าง', `Code ${no || code.id}`, { codeId: code.id })
        if (isGenericAiMatchCode(code)) push('Placeholder code', `Code ${no} ${code.thai || '(ว่าง)'}`, { codeId: code.id })
        if ((code.aiNew || code.manualNew) && String(code.thai || '').trim()) push('Code ใหม่ยังไฮไลต์', `Code ${no} ${code.thai}`, { codeId: code.id })
        if (frequencyForCode(code) === 0 && !isOtherLabel(code.thai)) push('Frequency = 0', `Code ${no} ${code.thai}`, { codeId: code.id })
      }
    }
    const sorted = [...new Set(numericCodes)].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > 1 && sorted[i - 1] >= 100) push('Code No. มีช่องว่าง', `${sorted[i - 1]} → ${sorted[i]} ขาดเลขระหว่างกลาง`)
    }
    for (const [key, ids] of Object.entries(targetSheet.assignments ?? {})) {
      const bad = ids.map((id) => findCode(targetSheet, id)).filter(Boolean).filter(isGenericAiMatchCode)
      if (bad.length) push('Assignment เข้า placeholder', `“${key}” → ${bad.map((c) => `${c.codeNo} ${c.thai}`).join(', ')}`)
    }
    const unassigned = targetAnswers.filter((a) => !(targetSheet.assignments?.[a.key] ?? []).length)
    if (unassigned.length) push('คำตอบยังไม่จัดกลุ่ม', `${unassigned.length} คำตอบ unique / ${unassigned.reduce((sum, a) => sum + a.count, 0)} rows`)
    return issues
  }

  const getQaIssues = () => getQaIssuesForSheet(sheet)
  const getAllQaIssues = () => (cf.sheets ?? []).flatMap((sh) => getQaIssuesForSheet(sh))

  const escapeCsvCell = (value) => {
    const text = String(value ?? '')
    const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }

  const exportQaReport = () => {
    const issues = getAllQaIssues()
    const rows = [['sheet', 'type', 'detail'], ...issues.map((it) => [it.sheetName, it.type, it.detail])]
    const csv = rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${cf.name || 'codeframe'}_qa_report_all_sheets.csv`.replace(/[\\/:*?"<>|]/g, '_')
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setToast({ type: 'success', title: 'Export QA Report แล้ว', message: `ส่งออก ${issues.length} รายการจากทุกชีท`, duration: 4000 })
  }

  const currentQaIssues = getQaIssues()
  const allQaIssues = getAllQaIssues()
  const unassignedUnique = answers.filter((a) => !(sheet.assignments?.[a.key] ?? []).length).length
  const exportReady = rawdata && unassignedUnique === 0 && !allQaIssues.some((it) => ['Code No. ว่าง', 'Code No. ซ้ำ', 'Label ว่าง', 'Assignment เข้า placeholder'].includes(it.type))

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ===== Toolbar ===== */}
      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/projects/${projectId}/${box}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
          >
            <ArrowLeft size={15} /> {project.name}
          </Link>
          <span className="text-slate-300">/</span>
          <BoxBadge box={box} />
          {renamingCodeframe ? (
            <input
              autoFocus
              value={codeframeNameDraft}
              onChange={(e) => setCodeframeNameDraft(e.target.value)}
              onBlur={saveCodeframeName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveCodeframeName() }
                if (e.key === 'Escape') { e.preventDefault(); setCodeframeNameDraft(cf.name); setRenamingCodeframe(false) }
              }}
              className="min-w-[16rem] rounded-xl border border-indigo-300 bg-white px-3 py-1.5 text-lg font-bold text-slate-900 outline-none ring-2 ring-indigo-100"
            />
          ) : (
            <button
              type="button"
              onClick={() => setRenamingCodeframe(true)}
              title="คลิกเพื่อแก้ชื่อ Codeframe"
              className="rounded-xl px-2 py-1 text-left text-lg font-bold text-slate-900 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {cf.name || 'Codeframe CE other'}
            </button>
          )}

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCiCommentsOpen(true)}
              className={`relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-black shadow-sm ${ciOpenComments.length ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : ciDoneComments.length ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'}`}
              title="ดู CI Comment ที่ส่งมาจาก Review Link"
            >
              <Bell size={13} /> CI Comment
              {ciOpenComments.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{ciOpenComments.length}</span>}
              {!ciOpenComments.length && ciDoneComments.length > 0 && <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] text-white">Done</span>}
            </button>
            <div className="relative">
              <Button size="sm" variant="secondary" onClick={() => setOptionsOpen((v) => !v)}>
                <MoreHorizontal size={14} /> Option
              </Button>
              {optionsOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setOptionsOpen(false)} />
                  <div className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                    <button onClick={() => { setOptionsOpen(false); undoLast() }} disabled={!undoStack.length} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50">
                      <span>Undo</span><span className="text-slate-400">{undoStack.length || ''}</span>
                    </button>
                    <button onClick={() => { setOptionsOpen(false); saveCheckpoint('Manual checkpoint') }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      Save Checkpoint
                    </button>
                    <button onClick={() => { setOptionsOpen(false); setCheckpointOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      Restore
                    </button>
                    <button onClick={() => { setOptionsOpen(false); setHistoryOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      History
                    </button>
                    <button onClick={() => { setOptionsOpen(false); setQaOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      QA Check
                    </button>
                    <button onClick={() => { setOptionsOpen(false); setDuplicateOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      หา Code ซ้ำ
                    </button>
                  </div>
                </>
              )}
            </div>
            <Button size="sm" variant="secondary" className="!border-violet-200 !bg-violet-50 !text-violet-700 hover:!bg-violet-100" onClick={() => setExportOpen(true)}>
              <Download size={14} /> Export Presets
            </Button>
            <Button size="sm" variant="secondary" className="!border-indigo-200 !bg-indigo-50 !text-indigo-700 hover:!bg-indigo-100" onClick={handleExportCodeframe}>
              <Download size={14} /> Export Codeframe
            </Button>
            <Button size="sm" className="shadow-sm" onClick={handleExportData}>
              <Download size={14} /> Export Data
            </Button>
          </div>
        </div>

        {/* Sheet tabs moved to bottom bar */}
      </div>

      {/* ===== Body ===== */}
      {mode === 'frame' ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* ----- Frame builder ----- */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-4 py-3 xl:px-5">
            <div className="mb-3 flex min-w-0 shrink-0 flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
                โครง Codeframe <span className="text-slate-400">({sheet.nets.filter((n) => n.level >= 1).length} Net · {codeCount} Code)</span>
                {baseN > 0 && (
                  <span
                    title="Sample Size — จำนวนผู้ตอบทั้งหมด (ฐานคำนวณ %)"
                    className="rounded-lg bg-indigo-50 px-2.5 py-1 text-base font-extrabold text-slate-700"
                  >
                    <span className="text-indigo-600">N</span> = {baseN.toLocaleString()}
                  </span>
                )}
              </h2>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTitleModalOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-100 bg-sky-50 px-2.5 text-[11px] font-black text-sky-700 shadow-sm hover:border-sky-200 hover:bg-sky-100"
                  title="ดูรายการข้อ/โจทย์ที่อยู่ในชีทนี้"
                >
                  <ListTree size={13} /> ดูข้อ ({getSheetQuestionCount(sheet)})
                </button>
                <button
                  type="button"
                  onClick={() => setQuestionsOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 text-[11px] font-black text-indigo-700 shadow-sm hover:border-indigo-200 hover:bg-indigo-100"
                  title="เพิ่ม/เอาข้อออกจากชีทนี้"
                >
                  <Plus size={13} /> เพิ่มข้อ
                </button>
              </div>
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                {/* ปุ่มย้ายลำดับ "Code ที่เลือก": ขึ้นสุด / ขึ้น / ลง / ลงสุด */}
                {(() => {
                  const moveCls = 'cursor-pointer px-1.5 py-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent'
                  const noSel = selectedCodeIds.size === 0
                  const title = noSel ? ' (เลือก Code ก่อน)' : ''
                  return (
                    <div className="flex items-center overflow-hidden rounded-lg border border-slate-200" title={noSel ? 'เลือก Code ในตารางก่อน แล้วใช้ปุ่มนี้ย้ายลำดับ' : 'ย้ายลำดับ Code ที่เลือก'}>
                      <button disabled={noSel} onClick={() => moveSelectedCodes('top')} title={`ย้ายขึ้นบนสุด${title}`} className={moveCls}>
                        <ChevronsUp size={14} />
                      </button>
                      <button disabled={noSel} onClick={() => moveSelectedCodes('up')} title={`ย้ายขึ้น${title}`} className={`border-l border-slate-200 ${moveCls}`}>
                        <ChevronUp size={14} />
                      </button>
                      <button disabled={noSel} onClick={() => moveSelectedCodes('down')} title={`ย้ายลง${title}`} className={`border-l border-slate-200 ${moveCls}`}>
                        <ChevronDown size={14} />
                      </button>
                      <button disabled={noSel} onClick={() => moveSelectedCodes('bottom')} title={`ย้ายลงล่างสุด${title}`} className={`border-l border-slate-200 ${moveCls}`}>
                        <ChevronsDown size={14} />
                      </button>
                    </div>
                  )
                })()}
                <input
                  ref={importRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => { handleImportFrame(e.target.files?.[0]); e.target.value = '' }}
                />
                <Button variant="secondary" size="sm" onClick={handleExportCurrentSheet}>
                  <Download size={13} /> Export ชีทนี้
                </Button>
                <Button variant="secondary" size="sm" onClick={() => importRef.current?.click()}>
                  <Upload size={13} /> นำเข้าโครงชีทนี้
                </Button>
                <div className="relative">
                  <Button variant="soft" size="sm" onClick={() => setAddNetOpen((v) => !v)}>
                    <Plus size={13} /> เพิ่ม Net (กลุ่ม)
                    <ChevronDown size={13} className={addNetOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </Button>
                  {addNetOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setAddNetOpen(false)} />
                      <div className="absolute right-0 z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                        <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold text-slate-400">เลือกชั้นของกลุ่มที่จะเพิ่ม</p>
                        {NET_LEVELS.map(({ level, label }) => {
                          const allowed = level === 1 || maxNetLevel >= level - 1
                          return (
                            <button
                              key={level}
                              onClick={() => allowed && addNet(level)}
                              disabled={!allowed}
                              title={allowed ? '' : `ต้องมี ${NET_LABEL[level - 1]} ก่อน จึงเพิ่ม ${label} ได้`}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                            >
                              <span style={{ paddingLeft: `${(level - 1) * 10}px` }} className="font-semibold text-indigo-700">
                                {label} :
                              </span>
                              {!allowed && <span className="ml-auto text-[10px] text-slate-400">ต้องมี {NET_LABEL[level - 1]} ก่อน</span>}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {importError && (
              <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{importError}</p>
            )}

            {sheet.nets.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/70 p-10 text-center">
                <p className="text-sm font-semibold text-slate-600">ยังไม่มีโครงในชีทนี้</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
                  แก้โครงใน Excel ได้: กด <b>Export ชีทนี้</b> แล้ว copy/เลื่อนแถวข้างนอก จากนั้น <b>นำเข้าโครงชีทนี้</b> กลับมา
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="secondary" size="sm" onClick={handleExportCurrentSheet}>
                    <Download size={13} /> Export ชีทนี้
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => importRef.current?.click()}>
                    <Upload size={13} /> นำเข้าโครงชีทนี้
                  </Button>
                  <Button size="sm" onClick={() => addNet(1)}>
                    <Plus size={13} /> เพิ่ม Net แรก
                  </Button>
                </div>
              </div>
            ) : (
              // กล่อง scroll: พื้นสีฟ้า (สีหัวตาราง) → gutter+มุมโค้งกลมกลืน + เป็น scroller โดยตรง
              <div ref={scrollBoxRef} className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-[#dbe5f1] shadow-sm">
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
                    {sheet.nets.map((net) => {
                      const lv = net.level >= 1 ? net.level : 0
                      const netEditing = editingCell?.codeId === net.id && editingCell?.field === 'netname'
                      return (
                        <Fragment key={net.id}>
                          {lv >= 1 && (
                            <tr
                              ref={(el) => {
                                if (el) netRowRefs.current[net.id] = el
                                else delete netRowRefs.current[net.id]
                              }}
                              className="bg-indigo-50/70"
                            >
                              <td colSpan={6} className="px-3 py-2">
                                <div className="flex items-center gap-2" style={lv > 1 ? { paddingLeft: `${(lv - 1) * 20}px` } : undefined}>
                                  <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500">{NET_LABEL[lv]} :</span>
                                  {netEditing ? (
                                    <input
                                      autoFocus
                                      value={net.name}
                                      placeholder={`ชื่อ ${NET_LABEL[lv]}…`}
                                      onChange={(e) => updateNet(net.id, { name: e.target.value })}
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
                                      {net.name || `ชื่อ ${NET_LABEL[lv]}…`}
                                    </span>
                                  )}
                                  <Badge color="indigo">{net.codes.length} Code</Badge>
                                  <button title="ลบหัว Net นี้ (รหัสยังอยู่)" onClick={() => removeNetHeader(net.id)} className="cursor-pointer rounded-lg p-1 text-indigo-300 hover:bg-rose-50 hover:text-rose-500">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {net.codes.filter(codeVisible).map((code) => {
                            // frequency จริง (Code "อื่นๆ" หักจำนวนที่โค้ดออกไปแล้ว)
                            const n = freqOf(code)
                            const isOtherResidualCode = otherCodeIds.has(code.id) || hasOtherSourceForCode(code)
                            const selectedAssigned =
                              validSelected && (sheet.assignments[validSelected] ?? []).includes(code.id)
                            const isChosen = selectedCodeIds.has(code.id)
                            const isFlash = flashCodeIds.has(code.id)
                            const isNew = !!code.aiNew || !!code.manualNew || newCodeIds.has(code.id)
                            const isAutoCoded = autoCodedCodeNos.has(String(code.codeNo ?? '').trim())
                            const editingField = editingCell?.codeId === code.id ? editingCell.field : null
                            const startEdit = (field) => setEditingCell({ codeId: code.id, field })
                            const stopEdit = () => setEditingCell(null)
                            return (
                              <tr
                                key={code.id}
                                ref={(el) => {
                                  if (el) codeRowRefs.current[code.id] = el
                                  else delete codeRowRefs.current[code.id]
                                }}
                                onClick={(e) => {
                                  if (validSelected && !e.shiftKey && !e.ctrlKey && !e.metaKey) toggleAssign(code.id)
                                  else onCodeClick(e, code.id)
                                }}
                                onContextMenu={(e) => openCodeCtx(e, code.id)}
                                className={`group/row cursor-pointer select-none transition-colors ${
                                  isFlash
                                    ? 'bg-amber-100 outline outline-2 -outline-offset-2 outline-amber-400'
                                    : isChosen
                                      ? 'bg-indigo-100'
                                      : isAutoCoded
                                        ? 'bg-amber-100/90 [&_td:first-child]:border-l-4 [&_td:first-child]:border-l-amber-500 hover:bg-amber-200'
                                        : isNew
                                        ? 'bg-amber-100 [&_td:first-child]:border-l-4 [&_td:first-child]:border-l-amber-500 hover:bg-amber-200'
                                        : validSelected
                                          ? selectedAssigned
                                            ? 'bg-emerald-50 hover:bg-emerald-100'
                                            : 'hover:bg-indigo-50'
                                          : 'hover:bg-slate-50'
                                }`}
                              >
                                <td className="px-3 py-1">
                                  <div className="flex items-center gap-1">
                                    <button
                                      title="แทรก Net เหนือแถวนี้"
                                      onClick={(e) => { e.stopPropagation(); setInsertMenu(insertMenu?.codeId === code.id ? null : { codeId: code.id, x: e.clientX, y: e.clientY }) }}
                                      className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold text-slate-300 opacity-0 transition-opacity hover:bg-indigo-100 hover:text-indigo-600 group-hover/row:opacity-100"
                                    >
                                      <Plus size={11} />Net
                                    </button>
                                    <CodeCell
                                      mono
                                      editing={editingField === 'codeNo'}
                                      value={code.codeNo}
                                      placeholder="—"
                                      onStart={() => startEdit('codeNo')}
                                      onStop={stopEdit}
                                      onChange={(v) => updateCode(net.id, code.id, { codeNo: v })}
                                    />
                                    {isAutoCoded && <span className="rounded bg-amber-500 px-1 py-0.5 text-[8px] font-black text-white shadow-sm">Auto</span>}
                                  </div>
                                </td>
                                <td className="px-2 py-1">
                                  <CodeCell
                                    editing={editingField === 'thai'}
                                    value={code.thai}
                                    placeholder="ข้อความรหัส (ภาษาไทย)"
                                    onStart={() => startEdit('thai')}
                                    onStop={stopEdit}
                                    onChange={(v) => updateCode(net.id, code.id, { thai: v })}
                                  />
                                </td>
                                <td className="hidden px-2 py-1 lg:table-cell">
                                  <CodeCell
                                    editing={editingField === 'thai2'}
                                    value={code.thai2 ?? ''}
                                    placeholder="—"
                                    onStart={() => startEdit('thai2')}
                                    onStop={stopEdit}
                                    onChange={(v) => updateCode(net.id, code.id, { thai2: v })}
                                  />
                                </td>
                                <td className="hidden px-2 py-1 xl:table-cell">
                                  <CodeCell
                                    editing={editingField === 'eng'}
                                    value={code.eng ?? ''}
                                    placeholder="English label"
                                    onStart={() => startEdit('eng')}
                                    onStop={stopEdit}
                                    onChange={(v) => updateCode(net.id, code.id, { eng: v })}
                                  />
                                </td>
                                <td className="px-2 py-1 text-center">
                                  {validSelected ? (
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                      selectedAssigned ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-600'
                                    }`}>
                                      {selectedAssigned ? '✓ จัดแล้ว' : '+ วางที่นี่'}
                                    </span>
                                  ) : n > 0 ? (
                                    <button onClick={(e) => { e.stopPropagation(); setFreqDrawer({ code }) }} title={isOtherResidualCode ? 'Oth residual: นับเฉพาะข้อความระบุที่ยังค้างใน code นี้' : 'คลิกเพื่อดูคำตอบที่เข้า Code นี้'} className="inline-flex flex-col items-center gap-0.5">
                                      <Badge color="emerald">{n}</Badge>
                                      {isOtherResidualCode && <span className="rounded bg-amber-100 px-1 text-[8px] font-black text-amber-700">Oth</span>}
                                    </button>
                                  ) : (
                                    <button onClick={(e) => { e.stopPropagation(); setFreqDrawer({ code }) }} className="inline-flex flex-col items-center gap-0.5 text-slate-200 hover:text-indigo-400" title={isOtherResidualCode ? 'Oth residual: ไม่มีข้อความระบุค้างใน code นี้' : 'ดูคำตอบใน Code นี้'}>
                                      <span>0</span>
                                      {isOtherResidualCode && <span className="rounded bg-amber-50 px-1 text-[8px] font-black text-amber-500">Oth</span>}
                                    </button>
                                  )}
                                </td>
                                <td className="px-1 py-1 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {ciCommentCountByCode.get(code.id) ? (
                                      <button
                                        type="button"
                                        title={`${ciCommentCountByCode.get(code.id)} CI Comment`}
                                        onClick={(e) => { e.stopPropagation(); setCiCommentsOpen(true) }}
                                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-black text-amber-700 ring-1 ring-amber-200 hover:bg-amber-200"
                                      >
                                        <MessageSquare size={10} />{ciCommentCountByCode.get(code.id)}
                                      </button>
                                    ) : null}
                                  <button
                                    title="ลบรหัสนี้"
                                    onClick={(e) => { e.stopPropagation(); deleteCode(net.id, code.id) }}
                                    className="cursor-pointer rounded p-1 text-slate-200 hover:bg-rose-50 hover:text-rose-500"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
                <button
                  onClick={() => addCode(sheet.nets[sheet.nets.length - 1]?.id)}
                  className="flex w-full cursor-pointer items-center gap-1.5 border-t border-slate-100 bg-white px-4 py-2 text-xs font-medium text-slate-400 hover:bg-indigo-50/50 hover:text-indigo-600"
                >
                  <Plus size={13} /> เพิ่มรหัส
                </button>
              </div>
            )}

            {/* เมนูแทรก Net เหนือแถว (เลือกชั้น) */}
            {insertMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setInsertMenu(null)} />
                <div
                  className="fixed z-40 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                  style={{ left: Math.min(insertMenu.x, window.innerWidth - 250), top: insertMenu.y + 6 }}
                >
                  <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold text-slate-400">แทรกหัวกลุ่มเหนือแถวนี้</p>
                  {NET_LEVELS.map(({ level, label }) => {
                    const allowed = level === 1 || maxLevelAbove(insertMenu.codeId) >= level - 1
                    return (
                      <button
                        key={level}
                        onClick={() => allowed && insertNetAbove(insertMenu.codeId, level)}
                        disabled={!allowed}
                        className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-xs hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <span style={{ paddingLeft: `${(level - 1) * 10}px` }} className="font-semibold text-indigo-700">{label} :</span>
                        {!allowed && <span className="ml-auto text-[10px] text-slate-400">ต้องมี {NET_LABEL[level - 1]} ก่อน</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* ===== Excel-style sheet tabs inside Codeframe box ===== */}
            <div className="mt-2 shrink-0 border-t border-slate-200 bg-slate-100 px-2 pt-1">
              <div className="flex h-9 max-w-full items-end gap-2">
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
                <div ref={sheetTabsRef} className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scroll-smooth pr-2 [scrollbar-width:thin]">
          {visibleSheetTabs.map((s) => {
            const realStatusKey = sheetStatusMap[s.id] ?? 'none'
            const statusKey = statusKeyForSheet(s)
            const st = SHEET_STATUS[statusKey]
            const active = s.id === sheet.id
            const isHidden = !!s.hiddenCodeframe
            const autoShown = isHidden && statusKey !== 'hidden'
            return (
            <div
              key={s.id}
              onClick={() => { setActiveSheetId(s.id); setSelectedAnswer(null) }}
              onDoubleClick={() => { setActiveSheetId(s.id); setRenamingSheetId(s.id) }}
              title={`${getSheetQuestions(s)[0]?.label || s.name} — ${st.label}${autoShown ? ` (เคยซ่อน แต่มีงานใหม่: ${SHEET_STATUS[realStatusKey]?.label || ''})` : ''} (ดับเบิลคลิกเพื่อเปลี่ยนชื่อชีท)`}
              className={`group relative flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-t-md border border-b-0 px-2.5 text-[11px] font-semibold shadow-sm transition-colors ${
                active ? `${st.active} -mb-px h-8 px-3 shadow-md` : `${st.tab} hover:-translate-y-0.5 hover:shadow`
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-white/85' : st.dot}`} />
              {renamingSheetId === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { renameSheet(s.id, e.target.value); setRenamingSheetId(null) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { renameSheet(s.id, e.target.value); setRenamingSheetId(null) }
                    if (e.key === 'Escape') setRenamingSheetId(null)
                  }}
                  className="h-5 w-24 rounded bg-white/95 px-1.5 text-[11px] font-semibold text-slate-800 outline-none ring-1 ring-indigo-300"
                />
              ) : (
                <span className="max-w-28 truncate">Code {shortSheetName(s.name)}</span>
              )}
              {autoShown && <span className="rounded bg-white/70 px-1 text-[9px] font-black text-amber-700">NEW</span>}
              {cf.sheets.length > 1 && (
                <X
                  size={10}
                  className={`ml-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${active ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-rose-500'}`}
                  onClick={(e) => { e.stopPropagation(); setDeletingSheet(s) }}
                />
              )}
            </div>
            )
          })}
          <button
            onClick={addSheet}
            className="mb-0.5 flex h-6 w-7 shrink-0 cursor-pointer items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
            title="เพิ่มชีท"
          >
            <Plus size={13} />
          </button>
                </div>

                <div className="mb-0.5 flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={toggleHideGraySheets}
            disabled={graySheetCount === 0}
            title={hiddenGraySheetCount > 0 ? `Unhide ชีทสีเทา ${hiddenGraySheetCount} ชีท` : `Hide ทุกชีทสีเทา ${graySheetCount} ชีท`}
            className="flex h-6 cursor-pointer items-center gap-1 rounded border border-slate-300 bg-slate-100 px-2 text-[11px] font-bold text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {hiddenGraySheetCount > 0 ? 'Show สีเทา' : 'Hide สีเทา'}
            <span className="rounded bg-white px-1 text-[10px] font-black text-slate-500">{hiddenGraySheetCount > 0 ? hiddenGraySheetCount : graySheetCount}</span>
          </button>
          {/* ปุ่มอธิบายสีแถบชีท */}
          <div className="relative mb-0.5 shrink-0">
            <button
              onClick={() => setLegendOpen((v) => !v)}
              className="flex h-6 cursor-pointer items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
            >
              <HelpCircle size={12} /> สี
            </button>
            {legendOpen && (
              <>
                <div className="fixed inset-0 z-[100] bg-slate-900/30" onClick={() => setLegendOpen(false)} />
                <div className="fixed left-1/2 top-1/2 z-[110] w-[24rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-800">สีแถบชีท = สถานะ “อื่นๆ ระบุ”</p>
                    <button onClick={() => setLegendOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15} /></button>
                  </div>
                  <div className="space-y-2.5">
                    {['orange', 'red', 'maroon', 'gray', 'hidden', 'green'].map((k) => (
                      <div key={k} className="flex items-start gap-2">
                        <span className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${SHEET_STATUS[k].swatch}`} />
                        <div>
                          <p className="text-[11px] font-bold text-slate-700">{SHEET_STATUS[k].label}</p>
                          <p className="text-[11px] leading-snug text-slate-500">{SHEET_STATUS[k].desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setQuestionsOpen(true)}
              title="ดู/แก้ไขข้อที่อยู่ในชีทนี้"
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 text-[11px] font-bold text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-100"
            >
              <Settings2 size={13} /> ข้อในชีทนี้
              {sheet.questionIds.length ? (
                <Badge color="indigo">{sheet.questionIds.length}</Badge>
              ) : (
                <span className="text-rose-500">ยังไม่ได้เลือก</span>
              )}
            </button>
          </div>
        </div>
      </div>
            </div>

          </div>

          {/* ----- Answers panel ----- */}
          <div className="flex w-[26rem] shrink-0 flex-col border-l border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex flex-nowrap items-center justify-between gap-2">
                <h2 className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-bold text-slate-700">
                  <FileSpreadsheet size={15} className="text-emerald-500" />
                  คำตอบจาก Rawdata
                </h2>
                <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAnswersPopupOpen(true)}
                    disabled={!answers.length}
                    title="เปิดตารางคำตอบเต็มจอ คลิกขวาที่แถวเพื่อลง Code"
                    className="inline-flex h-8 animate-pulse items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-500 px-2.5 text-[11px] font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:animate-none hover:bg-emerald-600 hover:shadow-emerald-300 disabled:cursor-not-allowed disabled:animate-none disabled:opacity-50"
                  >
                    <ListTree size={13} /> คลิกเปิดตาราง
                  </button>
                  <button
                    type="button"
                    onClick={runGroupCE}
                    disabled={!answers.length || !!aiBusy}
                    title="ให้ AI อ่านคำตอบที่ยังไม่จัด → จับเข้า Code เดิมถ้าตรง / สร้าง Code ใหม่ถ้าไม่มี"
                    className="inline-flex h-8 animate-pulse items-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-300 bg-violet-600 px-2.5 text-[11px] font-black text-white shadow-lg shadow-violet-200 transition-all hover:-translate-y-0.5 hover:animate-none hover:bg-violet-700 hover:shadow-violet-300 disabled:cursor-not-allowed disabled:animate-none disabled:opacity-50"
                  >
                    <Sparkles size={13} /> Group CE
                    <span className="rounded bg-white/20 px-1 py-0.5 text-[8px] font-black text-white ring-1 ring-white/30">Agent</span>
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {rawLoading ? (
                  'กำลังโหลดคำตอบจาก Firebase…'
                ) : !rawdata && project.rawMeta ? (
                  `Rawdata โปรเจกต์นี้เป็นรูปแบบเก่า/legacy (chunkCount=${project.rawMeta.chunkCount ?? '—'}) — ถ้าต้องการคำนวณสดหลัง refresh กรุณาอัปโหลด Rawdata อีกครั้งเพื่อแปลงเป็นระบบ chunk`
                ) : answers.length ? (
                  <>
                    {answers.length} unique / {totalAnswerRows.toLocaleString('th-TH')} rows · จัดกลุ่มแล้ว{' '}
                    <span className="font-bold text-emerald-600">{assignedCount} unique / {assignedAnswerRows.toLocaleString('th-TH')} rows</span> · เหลือ{' '}
                    <span className="font-bold text-amber-600">{unassignedAnswers.length} unique / {unassignedAnswerRows.toLocaleString('th-TH')} rows</span>
                    {' — '}คลิกคำตอบ แล้วคลิกรหัสในโครงด้านซ้ายเพื่อจัดกลุ่ม
                  </>
                ) : sheet.questionIds.length ? (
                  'ไม่มีคำตอบในข้อที่เลือก'
                ) : (
                  'เลือก "ข้อในชีทนี้" ด้านบนก่อน เพื่อดึงคำตอบจาก Rawdata'
                )}
              </p>
              {/* progress bar */}
              {answers.length > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
                    style={{ width: `${(assignedCount / answers.length) * 100}%` }}
                  />
                </div>
              )}
              {/* ปุ่มสลับมุมมองคำตอบ */}
              {answers.length > 0 && (
                <div className="mt-2.5 flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
                  <button
                    onClick={() => setAnswerFilter('unassigned')}
                    className={`flex-1 cursor-pointer rounded-md px-2 py-1 transition-colors ${
                      answerFilter === 'unassigned' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    ยังไม่จัดกลุ่ม ({unassignedAnswers.length} unique / {unassignedAnswerRows.toLocaleString('th-TH')} rows)
                  </button>
                  <button
                    onClick={() => setAnswerFilter('all')}
                    className={`flex-1 cursor-pointer rounded-md px-2 py-1 transition-colors ${
                      answerFilter === 'all' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    ทั้งหมด ({answers.length} unique / {totalAnswerRows.toLocaleString('th-TH')} rows)
                  </button>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {displayedAnswers.length === 0 && answers.length > 0 && (
                <p className="px-2 py-8 text-center text-xs text-slate-400">
                  {answerFilter === 'unassigned'
                    ? 'จัดกลุ่มครบทุกคำตอบแล้ว ✓ — กด "ทั้งหมด" เพื่อดูคำตอบที่จัดแล้ว'
                    : 'ไม่มีคำตอบ'}
                </p>
              )}
              {displayedAnswers.map((a) => {
                const codeIds = sheet.assignments[a.key] ?? []
                const isSelected = selectedAnswer === a.key
                const isEditing = editingAnswer?.key === a.key
                return (
                  <div
                    key={a.key}
                    onClick={() => {
                      if (isEditing) return
                      setSelectedAnswer(isSelected ? null : a.key)
                      if (codeIds.length) jumpToCodes(codeIds)
                    }}
                    onDoubleClick={() => { if (!isEditing) setAnswerDetail(a) }}
                    onContextMenu={(e) => openAnswerCtx(e, a)}
                    title="คลิกขวาเพื่อ Insert NewCode / วางเข้า Code · ดับเบิลคลิกเพื่อดูว่า respondent ตอบข้อนี้มาอะไรบ้าง"
                    className={`group/answer mb-2 block w-full rounded-xl border p-3 text-left transition-all ${
                      isEditing ? 'cursor-default' : 'cursor-pointer'
                    } ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 shadow-md ring-2 ring-indigo-200'
                        : codeIds.length
                          ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                          : 'border-slate-200 bg-white hover:border-indigo-300'
                    }`}
                  >
                    {isEditing ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <textarea
                          autoFocus
                          rows={2}
                          value={editingAnswer.draft}
                          onChange={(e) => setEditingAnswer({ key: a.key, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) applyWordingEdit(a.key, editingAnswer.draft)
                            if (e.key === 'Escape') setEditingAnswer(null)
                          }}
                          className="w-full resize-none rounded-lg border border-indigo-300 bg-white px-2 py-1.5 text-xs leading-relaxed text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <Button size="sm" onClick={() => applyWordingEdit(a.key, editingAnswer.draft)}>
                            <Check size={13} /> บันทึก
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingAnswer(null)}>
                            ยกเลิก
                          </Button>
                          <span className="ml-auto text-[10px] text-slate-400">เขียนทับ Rawdata จริง</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs leading-relaxed text-slate-700">{a.text}</p>
                          <div className="flex shrink-0 items-center gap-1">
                            <Pencil
                              size={12}
                              title="แก้ข้อความคำตอบ (เขียนทับ Rawdata)"
                              className="cursor-pointer text-slate-300 opacity-0 transition-opacity hover:text-indigo-500 group-hover/answer:opacity-100"
                              onClick={(e) => { e.stopPropagation(); setEditingAnswer({ key: a.key, draft: a.text }) }}
                            />
                            <X
                              size={13}
                              title="ลบคำตอบ 'อื่นๆ' นี้ออกจาก Rawdata (ลบทั้งข้อความและค่า Code อื่นๆ)"
                              className="cursor-pointer text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover/answer:opacity-100"
                              onClick={(e) => { e.stopPropagation(); setDeletingAnswer(a) }}
                            />
                            <Badge color={codeIds.length ? 'emerald' : 'slate'}>×{a.count}</Badge>
                          </div>
                        </div>
                        {a.questions?.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-slate-400">จากข้อ:</span>
                            {[...new Set(a.questions.map((q) => shortSheetName(q)))].map((q) => (
                              <span key={q} title={a.questions.join(', ')} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                {q}
                              </span>
                            ))}
                          </div>
                        )}
                        {codeIds.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {codeIds.map((cid) => {
                              const code = findCode(sheet, cid)
                              if (!code) return null
                              return (
                                <span
                                  key={cid}
                                  className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700"
                                >
                                  <span
                                    title="ไปที่รหัสนี้ในโครง"
                                    className="cursor-pointer hover:underline"
                                    onClick={(e) => { e.stopPropagation(); jumpToCodes([cid]) }}
                                  >
                                    {code.codeNo} {code.thai.slice(0, 18)}{code.thai.length > 18 ? '…' : ''}
                                  </span>
                                  <X
                                    size={10}
                                    className="cursor-pointer hover:text-rose-500"
                                    onClick={(e) => { e.stopPropagation(); unassign(a.key, cid) }}
                                  />
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ===== Grouped view ===== */
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto max-w-4xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">
                คำตอบ Rawdata จัดกลุ่มตาม Codeframe — {sheet.name}
              </h2>
              <Badge color={unassignedAnswers.length ? 'amber' : 'emerald'}>
                {unassignedAnswers.length ? `ยังไม่จัดกลุ่ม ${unassignedAnswers.length} คำตอบ` : 'จัดกลุ่มครบทุกคำตอบ ✓'}
              </Badge>
            </div>

            {sheet.nets.map((net) => (
              <div key={net.id} className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-bold text-white">
                  Net : {net.name}
                </div>
                <div className="divide-y divide-slate-100">
                  {net.codes.map((code) => {
                    const list = assignedAnswersOf(code.id)
                    return (
                      <div key={code.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-600">
                            {code.codeNo || '—'}
                          </span>
                          <span className="text-sm font-semibold text-slate-800">{code.thai || '(ยังไม่มีข้อความ)'}</span>
                          {code.eng && <span className="text-xs text-slate-400">· {code.eng}</span>}
                          <Badge color={list.length ? 'emerald' : 'slate'} className="ml-auto">
                            {list.reduce((s, a) => s + a.count, 0)} คำตอบ
                          </Badge>
                        </div>
                        {list.length > 0 && (
                          <div className="mt-1.5 space-y-1 pl-6">
                            {list.map((a) => (
                              <div key={a.key} className="flex items-start gap-1.5 text-xs text-slate-500">
                                <CornerDownRight size={12} className="mt-0.5 shrink-0 text-slate-300" />
                                <span>{a.text}</span>
                                <span className="ml-auto shrink-0 font-semibold text-slate-300">×{a.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {unassignedAnswers.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
                <div className="bg-amber-400/90 px-4 py-2.5 text-sm font-bold text-amber-950">
                  ยังไม่จัดกลุ่ม (Unassigned)
                </div>
                <div className="space-y-1 px-4 py-3">
                  {unassignedAnswers.map((a) => (
                    <div key={a.key} className="flex items-start gap-1.5 text-xs text-slate-500">
                      <CornerDownRight size={12} className="mt-0.5 shrink-0 text-amber-300" />
                      <span>{a.text}</span>
                      <span className="ml-auto shrink-0 font-semibold text-slate-300">×{a.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sheet.nets.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-400">
                ยังไม่มีโครงในชีทนี้ — กลับไปที่ "จัดการโครง" เพื่อสร้าง Net และรหัสก่อน
              </p>
            )}
          </div>
        </div>
      )}



      {/* ===== เลือกข้อในชีท ===== */}
      <SheetQuestionsModal
        open={questionsOpen}
        onClose={() => setQuestionsOpen(false)}
        project={project}
        sheet={sheet}
        updateSheet={updateSheet}
      />

      <Modal open={titleModalOpen} onClose={() => setTitleModalOpen(false)} title={`โจทย์ในชีท "${sheet.name}"`} wide>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-semibold leading-relaxed text-sky-700">
          <span className="min-w-0 flex-1">ดูข้อ/โจทย์ทั้งหมดที่ถูกผูกกับชีทนี้ ถ้าต้องการเพิ่มหรือลบข้อให้กดปุ่ม “เพิ่ม/แก้ข้อ”</span>
          <button
            type="button"
            onClick={() => { setTitleModalOpen(false); setQuestionsOpen(true) }}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white shadow-sm hover:bg-indigo-700"
          >
            + เพิ่ม/แก้ข้อ
          </button>
        </div>
        <div className="mb-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold leading-relaxed text-rose-700">
          แถวสีแดง = ข้อนี้มีคนเลือก “อื่นๆ ระบุ” แต่ไม่มีช่อง Verbatim ของข้อนี้ในชีทนี้ ระบบจะไม่เดา/ไม่ auto ลง Code ให้ ต้องกดเลือกเองว่าจะใช้ Code ไหนกับข้อไหน — เมื่อเลือกครบ Other freq ค้างจะเป็น 0
        </div>
        <div className="space-y-2">
          {getSheetQuestions(sheet).map((q) => {
            const info = questionOtherInfo(q.rawQuestion, sheet)
            const activeCode = info.activeRule ? findCode(sheet, info.activeRule.codeId) : null
            return (
              <div
                key={q.code}
                className={`rounded-lg border px-3 py-2 ${info.missingVerbatim ? 'border-rose-300 bg-rose-50 ring-1 ring-rose-100' : 'border-slate-200 bg-slate-50'}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${info.missingVerbatim ? 'bg-rose-600 text-white' : 'bg-indigo-100 text-indigo-600'}`}>{q.code}</span>
                  <div className="min-w-0 flex-1">
                    <span className={`text-sm leading-relaxed ${info.missingVerbatim ? 'font-bold text-rose-800' : 'text-slate-700'}`}>{q.label || '— (ไม่มีข้อความโจทย์ในโค้ดบุ๊ก)'}</span>
                    {info.hasOtherCode && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                        <span className={info.missingVerbatim ? 'text-rose-600' : 'text-emerald-600'}>ค้างลง Code: {info.pendingOtherFreq.toLocaleString('th-TH')} / {info.otherFreq.toLocaleString('th-TH')}</span>
                        <span className={info.coveredOtherFreq ? 'text-emerald-600' : 'text-slate-400'}>ลงแล้ว: {info.coveredOtherFreq.toLocaleString('th-TH')}</span>
                        <span className={info.hasVerbatim ? 'text-emerald-600' : 'text-rose-600'}>{info.hasVerbatim ? `มี Verbatim ${info.otherQs.length} ช่อง: ${info.otherQs.map((x) => x.label).join(', ')}` : 'ไม่มี Verbatim ของข้อนี้'}</span>
                      </div>
                    )}
                    {info.activeRules?.length > 0 && (
                      <div className="mt-2 space-y-1 rounded-xl border border-emerald-100 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-700">
                        {info.activeRules.map((rule) => {
                          const ruleCode = findCode(sheet, rule.codeId)
                          const sourceCode = rule.sourceCodeId ? findCode(sheet, rule.sourceCodeId) : null
                          return (
                            <div key={rule.id} className="flex flex-wrap items-center gap-2">
                              <span>Rule: {rule.sourceText ? `ถ้า respondent มี “${rule.sourceText}”` : `respondent source จาก Code ${sourceCode?.codeNo || ''} ${sourceCode?.thai || ''}`} → ลง {ruleCode?.codeNo || ''} {ruleCode?.thai || ''}</span>
                              <button type="button" onClick={() => clearManualRecodeRule(rule.id)} className="rounded-lg bg-rose-50 px-2 py-1 text-rose-600 hover:bg-rose-100">ลบ rule</button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {info.missingVerbatim && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-10">
                    <button
                      type="button"
                      onClick={() => applySelectedAnswerCodeToQuestion(q.rawQuestion)}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-black text-white shadow-sm shadow-rose-200 hover:bg-rose-700"
                    >
                      ใช้ Code จากคำตอบที่เลือกกับข้อนี้
                    </button>
                    <span className="text-[11px] font-semibold text-rose-500">ใช้กับกรณีข้อไม่มี Verbatim แต่ respondent เดียวกันมีคำตอบในข้ออื่น</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Modal>

      <Modal
        open={!!recodeQuestionPicker}
        onClose={() => setRecodeQuestionPicker(null)}
        title={`ลง Code นี้ตามข้อที่เลือก`}
        wide
      >
        {(() => {
          const code = recodeQuestionPicker ? findCode(sheet, recodeQuestionPicker.codeId) : null
          const codeFreq = code ? freqOf(code) : 0
          const sourceRows = code ? assignableSourceRowCountForCode(code.id) + noVerbatimPendingCountForCode(code) : 0
          return (
            <div>
              <div className="mb-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold leading-relaxed text-emerald-800">
                เลือกข้อปลายปิดที่มี “อื่นๆ ระบุ” แล้วไม่มี Verbatim ของตัวเอง ระบบจะไม่ auto ลงให้ ต้องเลือกข้อเองทีละข้อ/ทีละ Code แล้วตัวเลข “ค้างลง Code” จะลดลงจนเป็น 0 เมื่อครบ
                <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-700">
                  Code ที่เลือก: <b>{code?.codeNo || '—'} {code?.thai || ''}</b> · Display Frequency {codeFreq.toLocaleString('th-TH')} · respondent source {sourceRows.toLocaleString('th-TH')} rows
                </div>
              </div>
              <div className="space-y-2">
                {getSheetQuestions(sheet)
                  .map((q) => ({ ...q, codePending: code ? noVerbatimPendingCountForCodeQuestion(code, q.rawQuestion, sheet) : 0 }))
                  .filter((q) => !code || q.codePending > 0)
                  .map((q) => {
                  const info = questionOtherInfo(q.rawQuestion, sheet)
                  const activeRule = (sheet.manualRecodeRules ?? []).find((r) => r.questionId === q.id && r.sourceCodeId === code?.id)
                  const sourceOptions = sourceQuestionOptionsForTarget(q.rawQuestion, sheet)
                  return (
                    <div key={q.code} className={`rounded-xl border px-3 py-2 ${info.missingVerbatim ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="flex flex-wrap items-start gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-black ${info.missingVerbatim ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{q.code}</span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-semibold ${info.missingVerbatim ? 'text-rose-800' : 'text-slate-700'}`}>{q.label || q.column}</p>
                          <p className="mt-1 text-[11px] font-bold text-slate-500">
                            Code นี้ค้างในข้อนี้ {q.codePending.toLocaleString('th-TH')} rows · ข้อรวม {info.pendingOtherFreq.toLocaleString('th-TH')} / {info.otherFreq.toLocaleString('th-TH')} · ลงแล้ว {info.coveredOtherFreq.toLocaleString('th-TH')} · {info.hasVerbatim ? `มี Verbatim ${info.otherQs.length} ช่อง: ${info.otherQs.map((x) => x.label).join(', ')}` : 'ไม่มี Verbatim ของข้อนี้'}
                          </p>
                          {activeRule && <p className="mt-1 text-[11px] font-black text-emerald-700">ตั้ง rule นี้ไว้แล้ว</p>}
                        </div>
                        {sourceOptions.length <= 1 ? (
                          <button
                            type="button"
                            disabled={!info.missingVerbatim || !code || sourceRows <= 0}
                            onClick={() => applyCodeToQuestion(code.id, q.rawQuestion, sourceOptions[0]?.q.id || null)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            เลือกข้อนี้{sourceOptions[0]?.q?.label ? ` ตาม ${sourceOptions[0].q.label}` : ''}
                          </button>
                        ) : (
                          <div className="flex max-w-xs flex-wrap gap-1.5">
                            {sourceOptions.map((src) => (
                              <button
                                key={src.q.id}
                                type="button"
                                disabled={!info.missingVerbatim || !code || assignableSourceRowCountForCode(code.id, sheet, src.q.id) <= 0}
                                onClick={() => applyCodeToQuestion(code.id, q.rawQuestion, src.q.id)}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                              >
                                ตาม {src.q.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ===== Sheet เต็มจอ: ตารางคำตอบ Rawdata แบบ Excel สำหรับแก้ Verbatim / ลง Code เร็ว ===== */}
      {answersPopupOpen && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-white">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600">Coding Sheet</p>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{project?.name || 'Rawdata'}</span>
                <label className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600">
                  Sheet
                  <select
                    value={sheet.id}
                    onChange={(e) => { setActiveSheetId(e.target.value); setSelectedAnswer(null); setAnswerCtx(null); clearPopupSelection(); setPopupEditingAnswer(null) }}
                    className="max-w-56 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-800 outline-none"
                  >
                    {cf.sheets.map((s) => (
                      <option key={s.id} value={s.id}>{shortSheetName(s.name)} · {getSheetQuestionCount(s)} ข้อ</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1 py-1">
                  <button
                    type="button"
                    onClick={undoLast}
                    disabled={!canUndoStep}
                    title={undoStepTitle}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-black text-slate-600 transition hover:bg-white hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Undo2 size={13} /> Undo
                  </button>
                  <button
                    type="button"
                    onClick={redoLast}
                    disabled={!canRedoStep}
                    title={redoStepTitle}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-black text-slate-600 transition hover:bg-white hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Redo2 size={13} /> Redo
                  </button>
                </div>
              </div>
              <p className="mt-1 max-w-full truncate whitespace-nowrap text-xs text-slate-500">
                {popupAnswers.length} unique / {popupAnswers.reduce((sum, a) => sum + a.count, 0).toLocaleString('th-TH')} rows · เลือกแล้ว {selectedPopupAnswerKeys.size} แถว · คลิกแถวเพื่อเลือก · Ctrl+คลิก เพิ่ม/ยกเลิก · Shift หรือ Ctrl+Shift เลือกช่วง · คลิกขวา Edit Verbatim / ดับเบิลคลิก Verbatim เพื่อแก้
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={answersPopupSearch}
                onChange={(e) => setAnswersPopupSearch(e.target.value)}
                placeholder="ค้นหาทุกคอลัมน์..."
                className="h-9 w-72 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              />
              {[
                ['all', `ทั้งหมด ${answers.length}`],
                ['unassigned', `ยังไม่ลง ${unassignedAnswers.length}`],
                ['assigned', `ลงแล้ว ${assignedCount}`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setAnswersPopupFilter(key); clearPopupSelection(); setPopupEditingAnswer(null) }}
                  className={`h-9 rounded-lg px-3 text-xs font-black transition ${answersPopupFilter === key ? 'bg-emerald-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {label}
                </button>
              ))}
              <button onClick={selectAllPopupAnswers} className="h-9 rounded-lg bg-indigo-50 px-3 text-xs font-black text-indigo-700 hover:bg-indigo-100">เลือกทั้งหมด</button>
              <button onClick={() => { clearPopupSelection(); setPopupEditingAnswer(null) }} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black text-slate-600 hover:bg-slate-200">ล้างเลือก</button>
              <button onClick={() => setAnswersPopupOpen(false)} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800">ปิด</button>
            </div>
          </div>


          <div className="min-h-0 flex-1 overflow-auto bg-slate-100">
            <table className="min-w-[72rem] w-full border-separate border-spacing-0 bg-white text-sm">
              <thead className="sticky top-0 z-20 bg-slate-800 text-left text-[11px] font-black uppercase tracking-wide text-white shadow-sm">
                <tr>
                  <th className="w-12 border-r border-slate-700 px-2 py-2 text-right">#</th>
                  <th className="w-[38rem] border-r border-slate-700 px-3 py-2">Verbatim</th>
                  <th className="w-20 border-r border-slate-700 px-2 py-2 text-center">Freq</th>
                  <th className="w-44 border-r border-slate-700 px-2 py-2">Source</th>
                  <th className="w-72 border-r border-slate-700 px-2 py-2">Code ที่ลงอยู่</th>
                  <th className="w-32 border-r border-slate-700 px-2 py-2 text-center">Action</th>
                  <th className="w-32 px-2 py-2 text-center">Clear Code</th>
                </tr>
              </thead>
              <tbody>
                {popupAnswers.map((a, idx) => {
                  const codeIds = sheet.assignments[a.key] ?? []
                  const assigned = answerAssignedLabel(a)
                  const selected = selectedPopupAnswerKeys.has(a.key)
                  const editing = popupEditingAnswer?.key === a.key
                  return (
                    <tr
                      key={a.key}
                      onClick={(e) => {
                        if (editing) return
                        togglePopupAnswerSelection(a, e)
                      }}
                      onContextMenu={(e) => {
                        const targets = selectedPopupAnswerKeys.has(a.key) ? popupSelectionFor(a) : [a]
                        if (!selectedPopupAnswerKeys.has(a.key)) {
                          setSelectedPopupAnswerKeys(new Set([a.key]))
                          setLastPopupAnswerKey(a.key)
                        }
                        openAnswerCtx(e, targets)
                      }}
                      className={`h-9 cursor-cell select-none ${selected ? 'bg-indigo-100 ring-1 ring-inset ring-indigo-300' : codeIds.length ? 'bg-emerald-50/60 hover:bg-emerald-100' : 'bg-white hover:bg-slate-50'}`}
                      title="คลิกแถวเพื่อเลือก · Ctrl+คลิก เลือกหลายแถว · Shift คลิกเลือกช่วง · คลิกขวา Edit Verbatim · ดับเบิลคลิก Verbatim เพื่อแก้"
                    >
                      <td className="border-b border-r border-slate-200 px-2 py-1 text-right align-middle font-mono text-xs font-bold text-slate-400">{idx + 1}</td>
                      <td className="border-b border-r border-slate-200 px-2 py-1 align-middle">
                        {editing ? (
                          <div onClick={(e) => e.stopPropagation()}>
                            <textarea
                              autoFocus
                              rows={selectedPopupAnswerKeys.size > 1 && selected ? 3 : 2}
                              value={popupEditingAnswer.draft}
                              onChange={(e) => setPopupEditingAnswer({ key: a.key, draft: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitPopupEdit()
                                if (e.key === 'Escape') setPopupEditingAnswer(null)
                              }}
                              className="w-full resize-y rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm leading-relaxed text-slate-800 outline-none ring-2 ring-indigo-100"
                            />
                            <div className="mt-1 flex items-center gap-1.5">
                              <button onClick={commitPopupEdit} className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-black text-white hover:bg-indigo-700">
                                บันทึก{selectedPopupAnswerKeys.size > 1 && selected ? ` ${selectedPopupAnswerKeys.size} แถว` : ''}
                              </button>
                              <button onClick={() => setPopupEditingAnswer(null)} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200">ยกเลิก</button>
                              <span className="ml-auto text-[10px] text-slate-400">Ctrl+Enter = Save</span>
                            </div>
                          </div>
                        ) : (
                          <div
                            onDoubleClick={(e) => { e.stopPropagation(); startPopupEdit(a) }}
                            className="block w-full truncate whitespace-nowrap rounded px-1.5 py-1 leading-snug text-slate-800 hover:bg-indigo-50 hover:text-indigo-700"
                            title="คลิกแถวเพื่อเลือก · คลิกขวา Edit Verbatim · ดับเบิลคลิกเพื่อแก้"
                          >
                            {a.text || <span className="text-slate-300">(ว่าง)</span>}
                          </div>
                        )}
                      </td>
                      <td className="border-b border-r border-slate-200 px-2 py-1 text-center align-middle">
                        <span className="inline-flex min-w-10 items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-700">×{a.count}</span>
                      </td>
                      <td className="border-b border-r border-slate-200 px-2 py-1 align-middle text-xs text-slate-500">
                        <div className="flex flex-nowrap gap-1 overflow-hidden">
                          {[...new Set(a.questions?.map((q) => shortSheetName(q)) ?? [])].slice(0, 4).map((q) => (
                            <span key={q} className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-500">{q}</span>
                          ))}
                        </div>
                      </td>
                      <td className="border-b border-r border-slate-200 px-2 py-1 align-middle">
                        {assigned ? <span className="inline-block max-w-full truncate rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-700">{assigned}</span> : <span className="inline-block max-w-full truncate rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-700">ยังไม่ลง Code</span>}
                      </td>
                      <td className="border-b border-r border-slate-200 px-2 py-1 text-center align-middle">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const targets = selectedPopupAnswerKeys.has(a.key) ? popupSelectionFor(a) : [a]
                            if (!selectedPopupAnswerKeys.has(a.key)) {
                              setSelectedPopupAnswerKeys(new Set([a.key]))
                              setLastPopupAnswerKey(a.key)
                            }
                            openAnswerCtx(e, targets)
                          }}
                          className="inline-flex h-7 min-w-20 items-center justify-center rounded-lg bg-indigo-600 px-2.5 text-xs font-black text-white hover:bg-indigo-700"
                        >
                          ลง Code{selectedPopupAnswerKeys.has(a.key) && selectedPopupAnswerKeys.size > 1 ? ` ${selectedPopupAnswerKeys.size}` : ''}
                        </button>
                      </td>
                      <td className="border-b border-slate-200 px-2 py-1 text-center align-middle">
                        <button
                          disabled={!codeIds.length}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!codeIds.length) return
                            const targets = selectedPopupAnswerKeys.has(a.key) ? popupSelectionFor(a) : [a]
                            if (!selectedPopupAnswerKeys.has(a.key)) {
                              setSelectedPopupAnswerKeys(new Set([a.key]))
                              setLastPopupAnswerKey(a.key)
                            }
                            clearAnswerCode(targets)
                          }}
                          className="inline-flex h-7 min-w-20 items-center justify-center rounded-lg bg-rose-50 px-2.5 text-xs font-black text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300 disabled:ring-slate-100 disabled:hover:bg-slate-50"
                        >
                          Clear Code
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!popupAnswers.length && <p className="py-12 text-center text-sm text-slate-400">ไม่พบคำตอบตามเงื่อนไข</p>}
          </div>
        </div>
      )}

      {/* รายละเอียดคำตอบ: respondent ตอบข้อปลายปิดมาอะไรบ้าง */}
      <Modal open={!!answerDetail} onClose={() => setAnswerDetail(null)} title="คำตอบของผู้ตอบ (CE)" wide>
        {answerDetail && (() => {
          const { rows, info } = answerRespondents(answerDetail.text)
          return (
            <div>
              <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                ข้อความ "อื่นๆ ระบุ": <b className="text-slate-800">{answerDetail.text}</b>
                <span className="ml-2 text-xs text-slate-400">· {rows.length} ผู้ตอบ</span>
              </p>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                {rows.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">ไม่พบผู้ตอบในข้อมูล</p>
                ) : rows.map((rr) => (
                  <div key={rr.ri} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="mb-1.5 text-[11px] font-bold text-slate-400">SbjNum: {rr.sbj}</p>
                    {rr.perQ.length ? (
                      <div className="space-y-1">
                        {rr.perQ.map((pq) => (
                          <div key={pq.qLabel} className="flex items-start gap-2 text-xs">
                            <span className="mt-0.5 w-40 shrink-0 truncate font-semibold text-slate-500" title={pq.qLabel}>{pq.qLabel}</span>
                            <div className="flex flex-wrap gap-1">
                              {pq.vals.map((v, i) => (
                                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                                  <span className="font-mono">{v}</span>
                                  <span className="font-normal text-indigo-500">{info.valueLabel.get(v) || ''}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <span className="text-xs text-slate-400">— ไม่มีค่าปลายปิด</span>}
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </Modal>

      <ConfirmDelete
        open={!!deletingAnswer}
        onClose={() => setDeletingAnswer(null)}
        onConfirm={() => deleteAnswersFromRawdata(deletingAnswer?.texts ?? [])}
        what={(() => {
          const texts = deletingAnswer?.texts ?? []
          if (texts.length <= 1) return `Verbatim — "${texts[0] || ''}" (จะลบทั้งข้อความและค่า Code อื่นๆ ระบุออกจาก Rawdata จริง)`
          return `Verbatim ${texts.length} รายการ (จะลบข้อความที่เลือกทั้งหมดและค่า Code อื่นๆ ระบุที่เกี่ยวข้องออกจาก Rawdata จริง)`
        })()}
      />

      <ConfirmDelete
        open={!!deletingSheet}
        onClose={() => setDeletingSheet(null)}
        onConfirm={() => removeSheet(deletingSheet.id)}
        what={`"${deletingSheet?.name}"`}
      />

      <BuildFromAnswersModal
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        answers={answers.filter((a) => !(sheet.assignments[a.key] ?? []).length)}
        onBuild={runBuildFromAnswers}
      />

      <MoveCodesModal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        nets={sheet.nets}
        count={selectedCodeIds.size}
        onMove={moveSelectedCodesToNet}
      />

      {freqDrawer && (() => {
        const code = freqDrawer.code
        const sourceLabels = otherSourceLabelsByCodeNo.get(normalizeCodeNo(code.codeNo)) ?? new Set()
        const isOtherResidual = otherCodeIds.has(code.id) || sourceLabels.size > 0
        const sourceCols = (() => {
          if (!rawdata || !sourceLabels.size) return []
          const labels = new Set(sourceLabels)
          return rawdata.questions
            .filter((q) => labels.has(q.label))
            .flatMap((q) => (q.columns ?? [q.index]).map((col) => ({ label: q.label, col })))
        })()
        const sourceCountOf = (a) => isOtherResidual
          ? [...sourceLabels].reduce((s, label) => s + (a.sourceCounts?.[label] ?? 0), 0)
          : a.count
        const items = isOtherResidual
          ? answers.filter((a) => {
            const ids = sheet.assignments[a.key] ?? []
            const stillInThisOtherCode = ids.length === 0 || ids.includes(code.id)
            return stillInThisOtherCode && sourceCountOf(a) > 0
          })
          : assignedAnswersOf(code.id)
        const drawerRows = items.reduce((s, a) => s + sourceCountOf(a), 0)
        const sourceExamplesOf = (a) => {
          if (!rawdata || !sourceCols.length) return []
          const out = []
          for (let r = 0; r < rawdata.rows.length && out.length < 20; r++) {
            for (const src of sourceCols) {
              if (String(rawdata.rows[r]?.[src.col] ?? '').trim() === a.text) {
                out.push({ row: r + 1, label: src.label })
                break
              }
            }
          }
          return out
        }
        return (
          <>
            <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={() => setFreqDrawer(null)} />
            <div className="fixed right-0 top-14 z-50 flex h-[calc(100vh-3.5rem)] w-[28rem] max-w-[94vw] flex-col border-l border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-bold text-slate-400">ที่มาของ Frequency</p>
                <h3 className="mt-1 text-sm font-bold text-slate-800">{code.codeNo} · {code.thai || '(ไม่มี label)'}</h3>
                <p className="mt-1 text-xs text-slate-500">รวม {drawerRows.toLocaleString('th-TH')} rows · {items.length} text unique</p>
                {isOtherResidual && (
                  <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                    <p className="font-black">Oth residual source</p>
                    <p className="mt-0.5 break-words">นับจาก: {[...sourceLabels].join(', ') || 'ไม่พบ source column'}</p>
                    <p className="mt-0.5 text-amber-700">ถ้า text ถูกย้ายไป Code อื่นแล้ว จะไม่ถูกนับใน Code นี้</p>
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {items.length ? items.map((a) => {
                  const examples = sourceExamplesOf(a)
                  return (
                    <div key={a.key} className="mb-2 rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm font-semibold text-slate-700">{a.text}</p>
                        <Badge color="emerald">{sourceCountOf(a)}</Badge>
                      </div>
                      {isOtherResidual && (
                        <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                          <p><b>Source count:</b> {[...sourceLabels].map((label) => `${label} ×${a.sourceCounts?.[label] ?? 0}`).filter((x) => !x.endsWith('×0')).join(' · ') || '—'}</p>
                          <p><b>อยู่แถว:</b> {examples.length ? examples.map((e) => `row ${e.row} (${e.label})`).join(', ') : 'ไม่พบตัวอย่าง row'}</p>
                        </div>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => { setSelectedAnswer(a.key); setFreqDrawer(null) }} className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100">เลือกเพื่อย้าย</button>
                        {!isOtherResidual && <button onClick={() => unassign(a.key, code.id)} className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-100">Unassign</button>}
                      </div>
                    </div>
                  )
                }) : <p className="py-10 text-center text-sm text-slate-400">ไม่มี text ที่ยังนับอยู่ใน Code นี้</p>}
              </div>
              <div className="border-t border-slate-100 p-3">
                <Button variant="secondary" className="w-full" onClick={() => setFreqDrawer(null)}>ปิด</Button>
              </div>
            </div>
          </>
        )
      })()}

      <Modal open={checkpointOpen} onClose={() => setCheckpointOpen(false)} title="Checkpoint / Restore" wide>
        <div className="mb-4 flex gap-2">
          <TextInput value={checkpointName} onChange={(e) => setCheckpointName(e.target.value)} placeholder="ชื่อ checkpoint เช่น ก่อนแก้ d4" />
          <Button onClick={() => saveCheckpoint(checkpointName)}>Save</Button>
        </div>
        {(cf.checkpoints ?? []).length ? (
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
            {(cf.checkpoints ?? []).map((cp) => (
              <div key={cp.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold text-slate-700">{cp.label}</p>
                  <p className="text-xs text-slate-400">{new Date(cp.at).toLocaleString('th-TH')}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => restoreCheckpoint(cp)}>Restore</Button>
              </div>
            ))}
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-400">ยังไม่มี checkpoint ถาวร</p>}
      </Modal>

      <Modal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} title="Suggest Merge / Duplicate Codes" wide>
        {(() => {
          const groups = getDuplicateCodeGroups()
          return groups.length ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">พบ Code ที่ label เหมือน/ใกล้กันแบบ exact-normalized {groups.length} กลุ่ม — กดเลือกแล้วค่อยรวม</p>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {groups.map((g, i) => (
                  <button key={i} onClick={() => selectDuplicateGroup(g)} className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50">
                    <p className="mb-2 text-xs font-bold text-indigo-600">กลุ่มที่ {i + 1} · {g.length} Code</p>
                    <div className="flex flex-wrap gap-1.5">
                      {g.map((c) => <span key={c.id} className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{c.codeNo} · {c.thai}</span>)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-emerald-50 px-4 py-8 text-center text-emerald-700">
              <p className="text-lg font-bold">ยังไม่พบ Code ซ้ำแบบชัดเจน</p>
              <p className="mt-1 text-sm">ถ้าต้องรวมเอง ให้ Ctrl/Shift คลิกเลือกหลาย Code แล้วคลิกขวา → รวมเป็นรหัสเดียว</p>
            </div>
          )
        })()}
      </Modal>

      <Modal open={qaOpen} onClose={() => setQaOpen(false)} title="QA Check ก่อน Export · ทุกชีท" wide>
        {(() => {
          const issues = getAllQaIssues()
          return issues.length ? (
            <>
              <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">พบจุดที่ควรตรวจ {issues.length} รายการ</div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
                {issues.map((it, i) => (
                  <div key={i} className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">{it.sheetName}</span>
                      <p className="font-bold text-slate-700">{it.type}</p>
                    </div>
                    <p className="text-xs text-slate-500">{it.detail}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={exportQaReport}>Export QA Report</Button>
                <Button onClick={() => setQaOpen(false)}>ปิด</Button>
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-emerald-50 px-4 py-8 text-center text-emerald-700">
              <p className="text-lg font-bold">ผ่าน QA เบื้องต้นแล้ว</p>
              <p className="mt-1 text-sm">ไม่พบ Code ซ้ำ/ว่าง/คำตอบค้างในทุกชีท</p>
            </div>
          )
        })()}
      </Modal>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Export Presets" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => { handleExportCodeframe(); setExportOpen(false) }} className="rounded-xl border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50">
            <p className="font-bold text-slate-800">Codeframe พร้อมสีตรวจงาน</p>
            <p className="mt-1 text-xs text-slate-500">มีสีชีทตามสถานะ + ไฮไลต์ Code ใหม่</p>
          </button>
          <button onClick={() => { handleExportCustomerCodeframe(); setExportOpen(false) }} className="rounded-xl border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50">
            <p className="font-bold text-slate-800">Codeframe แบบลูกค้า</p>
            <p className="mt-1 text-xs text-slate-500">format สวยสะอาด พร้อมส่งลูกค้า และยังไฮไลต์ Code เพิ่มใหม่ด้วยสีเหลือง</p>
          </button>
          <button onClick={() => { handleExportQuestions(); setExportOpen(false) }} className="rounded-xl border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50">
            <p className="font-bold text-slate-800">รายการโจทย์ / Questions</p>
            <p className="mt-1 text-xs text-slate-500">Excel รวมโจทย์ที่แสดงในหน้าเว็บ แยกตามชีท พร้อม variable, column, จำนวน code และสถานะ</p>
          </button>
          <button onClick={() => { handleExportData(); setExportOpen(false) }} className="rounded-xl border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50">
            <p className="font-bold text-slate-800">Rawdata + Code</p>
            <p className="mt-1 text-xs text-slate-500">เขียนทับ Other/specify + ไฮไลต์จุดที่เปลี่ยน</p>
          </button>
          <button onClick={() => { exportQaReport(); setExportOpen(false) }} className="rounded-xl border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50">
            <p className="font-bold text-slate-800">QA Report</p>
            <p className="mt-1 text-xs text-slate-500">CSV รายการที่ควรตรวจจากทุกชีท</p>
          </button>
        </div>
      </Modal>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="History / Undo ล่าสุด" wide>
        {undoStack.length ? (
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
            {[...undoStack].reverse().map((h, i) => (
              <div key={`${h.at}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold text-slate-700">{h.label}</p>
                  <p className="text-xs text-slate-400">{new Date(h.at).toLocaleString('th-TH')}</p>
                </div>
                {i === 0 && <Badge color="amber">Undo ถัดไป</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">ยังไม่มีประวัติการแก้ในชีทนี้</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setHistoryOpen(false)}>ปิด</Button>
          <Button onClick={() => { undoLast(); setHistoryOpen(false) }} disabled={!undoStack.length}>Undo ล่าสุด</Button>
        </div>
      </Modal>

      <Modal open={ciCommentsOpen} onClose={() => setCiCommentsOpen(false)} title={`CI Comment (${ciOpenComments.length} รอแก้${ciDoneComments.length ? ` · Done ${ciDoneComments.length}` : ''})`} wide>
        {ciComments.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-400">ยังไม่มี Comment จาก CI</p>
        ) : (
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              <span>รอ Edit แก้: <b>{ciOpenComments.length}</b> รายการ</span>
              <span className="text-emerald-700">Done แล้ว: <b>{ciDoneComments.length}</b> รายการ</span>
            </div>
            <div className="sticky top-0 z-10 grid grid-cols-[4.8rem_minmax(11rem,1.1fr)_5.5rem_minmax(8rem,1fr)_7rem_5.5rem] gap-1 rounded-t-xl border border-amber-100 bg-amber-100/90 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-amber-700 backdrop-blur">
              <span>ชีท</span>
              <span>Code + ความหมาย</span>
              <span>ชื่อ CI</span>
              <span>คอมเม้น</span>
              <span>วันที่+เวลา</span>
              <span className="text-center">สถานะ</span>
            </div>
            {ciComments.map((c) => {
              const p = c.payload || {}
              const done = c.status === 'done' || c.done
              return (
                <div key={c.id} className={`grid min-h-9 grid-cols-[4.8rem_minmax(11rem,1.1fr)_5.5rem_minmax(8rem,1fr)_7rem_5.5rem] items-center gap-1 border-x border-b px-2 py-1.5 text-xs first:rounded-t-none last:rounded-b-xl ${done ? 'border-emerald-100 bg-emerald-50/60 text-slate-400 opacity-75' : 'border-amber-100 bg-amber-50/60 odd:bg-white'}`}>
                  <div className={`min-w-0 ${done ? 'line-through decoration-emerald-500 decoration-2' : ''}`}>
                    {p.sheetId && p.sheetId !== activeSheetId ? (
                      <button
                        type="button"
                        onClick={() => { setActiveSheetId(p.sheetId); setCiCommentsOpen(false); setToast({ type: 'info', title: 'ไปยังชีทที่มี Comment แล้ว', message: p.sheetName || p.sheetId, duration: 2500 }) }}
                        className="max-w-full truncate rounded bg-white px-2 py-0.5 text-[11px] font-black text-indigo-600 ring-1 ring-indigo-100 hover:bg-indigo-50"
                        title={p.sheetName || p.sheetId || '—'}
                      >
                        {p.sheetName || p.sheetId || '—'}
                      </button>
                    ) : (
                      <span className="block truncate text-[11px] font-black text-slate-500" title={p.sheetName || p.sheetId || '—'}>{p.sheetName || p.sheetId || '—'}</span>
                    )}
                  </div>
                  <div className={`flex min-w-0 items-center gap-1.5 ${done ? 'line-through decoration-emerald-500 decoration-2' : ''}`}>
                    <span className="shrink-0 rounded bg-white px-2 py-0.5 font-mono text-[11px] font-black text-amber-700 ring-1 ring-amber-100">Code {p.codeNo || '—'}</span>
                    <span className="min-w-0 truncate font-bold text-slate-700" title={p.label || 'ไม่มี label'}>{p.label || 'ไม่มี label'}</span>
                  </div>
                  <span className={`truncate text-[11px] font-semibold text-slate-600 ${done ? 'line-through decoration-emerald-500 decoration-2' : ''}`} title={c.reviewer || 'CI'}>{c.reviewer || 'CI'}</span>
                  <span className={`min-w-0 truncate font-semibold text-slate-900 ${done ? 'line-through decoration-emerald-500 decoration-2' : ''}`} title={p.comment}>{p.comment}</span>
                  <span className={`truncate text-[11px] font-semibold text-slate-400 ${done ? 'line-through decoration-emerald-500 decoration-2' : ''}`} title={formatCiCommentTime(c.createdAt)}>{formatCiCommentTime(c.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => toggleCiCommentDone(c, !done)}
                    className={`inline-flex h-7 items-center justify-center rounded-lg border px-2 text-[11px] font-black transition ${done ? 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50' : 'border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700'}`}
                    title={done ? 'ยกเลิก Done ให้กลับไปรอแก้' : 'ติ๊ก Done หลัง Edit แก้ตามคอมเมนต์แล้ว'}
                  >
                    {done ? 'Undo' : '✓ Done'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal open={!!mergeInspect} onClose={() => setMergeInspect(null)} title="รายการ Verbatim ที่รวมไว้" wide>
        {mergeInspect ? (
          <div>
            <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
              <p className="text-xs font-bold text-amber-700">Verbatim ปัจจุบัน</p>
              <p className="mt-0.5 text-sm font-black text-slate-800">{mergeInspect.key}</p>
              <p className="mt-1 text-[11px] text-amber-700">เลือก “แยกออก” เพื่อคืน Verbatim เดิมออกมาเป็นแถวใหม่ใน Coding Sheet และยังคง Code assignment เดิมไว้</p>
            </div>
            {mergeInspectGroups.length ? (
              <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200">
                {mergeInspectGroups.flatMap((group) => (group.members ?? [])
                  .filter((member) => member.key !== group.key)
                  .map((member) => (
                    <div key={`${group.id}-${member.key}`} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800" title={member.key}>{member.key}</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{(member.count ?? member.cells?.length ?? 0).toLocaleString('th-TH')} rows</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => restoreMergedVerbatim(group.id, member.key)}
                        className="inline-flex h-8 items-center justify-center rounded-lg bg-rose-50 px-3 text-xs font-black text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                      >
                        แยกออก
                      </button>
                    </div>
                  ))) }
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-400">ยังไม่มีรายการรวมที่บันทึกไว้สำหรับ Verbatim นี้</p>
            )}
            <div className="mt-3 flex justify-end">
              <Button variant="secondary" onClick={() => setMergeInspect(null)}>ปิด</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* เมนูคลิกขวาที่คำตอบ: Insert NewCode หรือวางเข้า Code ที่มีอยู่ */}
      {answerCtx && (() => {
        const ctxAnswers = (answerCtx.answers ?? []).map((a) => ({
          key: a?.key,
          text: a?.text,
          count: a?.count ?? 0,
        })).filter((a) => a.key)
        const first = ctxAnswers[0]
        const totalRows = ctxAnswers.reduce((sum, a) => sum + (a?.count ?? 0), 0)
        const firstMergeGroups = first?.key ? mergeGroupsForKey(first.key) : []
        return (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setAnswerCtx(null)} onContextMenu={(e) => { e.preventDefault(); setAnswerCtx(null) }} />
          <div
            className="fixed z-[120] flex max-h-[82vh] w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            style={{ left: Math.min(answerCtx.x, window.innerWidth - 330), top: Math.max(8, Math.min(answerCtx.y, window.innerHeight - 520)) }}
          >
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-[11px] font-bold text-slate-400">จัดคำตอบเข้า Code</p>
              <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-700">
                {ctxAnswers.length === 1 ? `“${first?.text ?? ''}”` : `เลือก ${ctxAnswers.length} Verbatim`} <span className="text-slate-400">×{totalRows}</span>
              </p>
            </div>
            <button
              onClick={() => { startPopupEdit(first); setAnswerCtx(null) }}
              className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-indigo-50"
            >
              <Pencil size={15} /> Edit Verbatim{ctxAnswers.length > 1 ? ` (${ctxAnswers.length} แถว)` : ''}
            </button>
            <button
              onClick={() => requestDeleteAnswers(ctxAnswers)}
              className="flex w-full items-center gap-2 border-b border-rose-100 px-3 py-2.5 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50"
            >
              <Trash2 size={15} /> {ctxAnswers.length === 1 ? 'ลบ Verbatim นี้' : `ลบ Verbatim ${ctxAnswers.length} แถว`}
            </button>
            {ctxAnswers.length === 1 && (
              <button
                onClick={() => { setMergeInspect({ key: first.key }); setAnswerCtx(null) }}
                className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-sm font-semibold hover:bg-amber-50 ${firstMergeGroups.length ? 'text-amber-700' : 'text-slate-500'}`}
              >
                <ListTree size={15} /> ดูรายการที่รวม{firstMergeGroups.length ? ` (${firstMergeGroups.reduce((sum, g) => sum + (g.members?.filter((m) => m.key !== g.key).length ?? 0), 0)})` : ' (ยังไม่มีประวัติ)'}
              </button>
            )}
            <button
              onClick={() => insertNewCodeFromAnswer(ctxAnswers)}
              className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              <Plus size={15} /> {ctxAnswers.length === 1 ? 'Insert NewCode จากคำตอบนี้' : `Insert NewCode จาก ${ctxAnswers.length} แถว`}
            </button>
            {otherCodes().length > 0 && (
              <button
                onClick={deleteOtherCodesFromSheet}
                className="flex w-full items-center gap-2 border-b border-rose-100 px-3 py-2.5 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                <Trash2 size={15} /> ลบ Code อื่นๆ ระบุ ({otherCodes().length})
              </button>
            )}
            <div className="min-h-0 overflow-y-auto py-1">
              <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold text-slate-400">หรือวางไว้ที่ Code เดิม</p>
              {sheet.nets.flatMap((net) => [
                net.level >= 1 ? (
                  <div key={`net-${net.id}`} className="bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {NET_LABEL[net.level]} : {net.name || '(ยังไม่ตั้งชื่อ)'}
                  </div>
                ) : null,
                ...net.codes.map((code) => (
                  <button
                    key={code.id}
                    onClick={() => moveContextAnswersToCode(ctxAnswers, code.id)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-emerald-50"
                  >
                    <span className="mt-0.5 min-w-9 rounded bg-slate-100 px-1.5 py-0.5 text-center font-mono text-[11px] font-bold text-slate-600">
                      {code.codeNo || '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-700">{code.thai || '(ยังไม่มีข้อความ)'}</span>
                      {code.eng && <span className="block truncate text-[10px] text-slate-400">{code.eng}</span>}
                    </span>
                    {ctxAnswers.length === 1 && (sheet.assignments[first?.key] ?? []).includes(code.id) && (
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                    )}
                  </button>
                )),
              ])}
              {!codeCount && (
                <p className="px-3 py-4 text-center text-xs text-slate-400">ยังไม่มี Code เดิม — ใช้ Insert NewCode ได้เลย</p>
              )}
            </div>
            <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
              เลือก Code แล้วระบบจะย้าย assignment ของคำตอบที่เลือกไป Code นั้นทันที
            </div>
          </div>
        </>
        )
      })()}

      {/* เมนูคลิกขวาที่รหัส: รวม / ย้ายเข้า Net */}
      {codeCtx && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setCodeCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCodeCtx(null) }} />
          <div
            className="fixed z-50 max-h-[90vh] w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-2xl"
            style={{ left: Math.min(codeCtx.x, window.innerWidth - 330), top: Math.max(8, Math.min(codeCtx.y, window.innerHeight - 420)) }}
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400">
              เลือก {selectedCodeIds.size} Code
            </div>
            <button
              disabled={selectedCodeIds.size < 2}
              onClick={() => { mergeSelectedCodes(); setCodeCtx(null) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <Combine size={15} /> รวมเป็นรหัสเดียว
            </button>
            <button
              onClick={() => { setMoveOpen(true); setCodeCtx(null) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50"
            >
              <FolderInput size={15} /> ย้ายเข้า Net…
            </button>
            <button
              disabled={freqOf(findCode(sheet, codeCtx.codeId) ?? {}) <= 0}
              onClick={() => { setRecodeQuestionPicker({ codeId: codeCtx.codeId }); setCodeCtx(null) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <Link2 size={15} /> ลง Code นี้ตามข้อ…
            </button>
            {(() => {
              const ctxCode = findCode(sheet, codeCtx.codeId)
              const sourceRows = ctxCode ? assignableSourceRowCountForCode(ctxCode.id) + noVerbatimPendingCountForCode(ctxCode) : 0
              const targets = ctxCode ? getSheetQuestions(sheet)
                .map((q) => ({ q, info: questionOtherInfo(q.rawQuestion, sheet), codePending: noVerbatimPendingCountForCodeQuestion(ctxCode, q.rawQuestion, sheet) }))
                .filter(({ info, codePending }) => info.missingVerbatim && codePending > 0) : []
              if (!ctxCode || !targets.length) return null
              return (
                <div className="border-y border-emerald-100 bg-emerald-50/70 py-1">
                  <p className="px-3 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                    เลือกข้อที่จะลง Code {ctxCode.codeNo || '—'} · source {sourceRows.toLocaleString('th-TH')} rows
                  </p>
                  {(() => {
                    const allSourceOptions = targets.map(({ q }) => sourceQuestionOptionsForTarget(q.rawQuestion, sheet))
                    const uniqueSourceIds = [...new Set(allSourceOptions.flatMap((opts) => opts.map((src) => src.q.id)))]
                    const allSingleSource = allSourceOptions.every((opts) => opts.length <= 1)
                    if (allSingleSource) {
                      const firstSourceId = allSourceOptions.find((opts) => opts[0])?.[0]?.q.id || null
                      const firstSourceLabel = firstSourceId ? (rawdata?.questions.find((x) => x.id === firstSourceId)?.label || 'ข้อ Verbatim เดียว') : 'ข้อ Verbatim เดียว'
                      return (
                        <button
                          type="button"
                          disabled={sourceRows <= 0}
                          onClick={() => applyCodeToQuestionsBulk(ctxCode.id, targets, firstSourceId)}
                          className="mx-2 mb-1 flex w-[calc(100%-1rem)] items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          ลงตาม {firstSourceLabel} ทั้งหมด {targets.length} ข้อ
                        </button>
                      )
                    }
                    if (uniqueSourceIds.length > 1) {
                      return (
                        <div className="mx-2 mb-1 flex flex-wrap gap-1.5 rounded-lg bg-white/60 p-1.5">
                          {uniqueSourceIds.map((sid) => {
                            const sq = rawdata?.questions.find((x) => x.id === sid)
                            return (
                              <button
                                key={sid}
                                type="button"
                                onClick={() => applyCodeToQuestionsBulk(ctxCode.id, targets, sid)}
                                className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-black text-white hover:bg-emerald-800"
                              >
                                ลงตาม {sq?.label || sid} ทั้งหมด
                              </button>
                            )
                          })}
                        </div>
                      )
                    }
                    return null
                  })()}
                  {targets.map(({ q, info, codePending }) => {
                    const sourceOptions = sourceQuestionOptionsForTarget(q.rawQuestion, sheet)
                    const activeRule = (sheet.manualRecodeRules ?? []).find((r) => r.questionId === q.id && r.sourceCodeId === ctxCode.id)
                    const sourceLabel = sourceOptions.length === 1 ? sourceOptions[0].q.label : null
                    return (
                      <div key={q.id} className="px-2 py-1.5 text-xs hover:bg-emerald-100">
                        {sourceOptions.length <= 1 ? (
                          <button
                            type="button"
                            disabled={sourceRows <= 0 || !!activeRule}
                            onClick={() => { applyCodeToQuestion(ctxCode.id, q.rawQuestion, sourceOptions[0]?.q.id || null); setCodeCtx(null) }}
                            className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                            title={q.label || q.column}
                          >
                            <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-black text-emerald-700 ring-1 ring-emerald-100">{q.code}</span>
                            <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700">Freq {codePending.toLocaleString('th-TH')}</span>
                            <span className="min-w-0 flex-1 truncate text-[11px] font-black text-emerald-700">{activeRule ? 'ตั้ง rule แล้ว' : `ลงตาม ${sourceLabel || 'ข้อ Verbatim เดียว'}`}</span>
                          </button>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5 rounded-lg px-1.5 py-1">
                            <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-black text-emerald-700 ring-1 ring-emerald-100">{q.code}</span>
                            <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700">Freq {codePending.toLocaleString('th-TH')}</span>
                            {sourceOptions.map((src) => (
                              <button
                                key={src.q.id}
                                type="button"
                                disabled={assignableSourceRowCountForCode(ctxCode.id, sheet, src.q.id) <= 0 || !!activeRule}
                                onClick={() => { applyCodeToQuestion(ctxCode.id, q.rawQuestion, src.q.id); setCodeCtx(null) }}
                                className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                              >
                                ตาม {src.q.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            <div className="my-1 h-px bg-slate-100" />
            <button
              onClick={() => { insertCodeBefore(codeCtx.codeId); setCodeCtx(null) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50"
            >
              <Plus size={15} /> แทรกรหัสก่อนหน้านี้
            </button>
            <button
              onClick={() => { setInsertMenu({ x: codeCtx.x, y: codeCtx.y, codeId: codeCtx.codeId }); setCodeCtx(null) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50"
            >
              <FolderPlus size={15} /> แทรก Net (กลุ่ม) ก่อนหน้านี้…
            </button>
            <button
              onClick={() => { deleteCodeById(codeCtx.codeId); setCodeCtx(null) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
            >
              <Trash2 size={15} /> ลบรหัสนี้
            </button>
            {[...selectedCodeIds, codeCtx.codeId].some((id) => findCode(sheet, id)?.aiNew) && (
              <button
                onClick={() => { clearAiNew(selectedCodeIds.size ? [...selectedCodeIds] : [codeCtx.codeId]); setCodeCtx(null) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"
              >
                <Check size={15} /> ตรวจแล้ว (เอาไฮไลต์ใหม่ออก)
              </button>
            )}
            <div className="my-1 h-px bg-slate-100" />
            <button
              onClick={() => { clearSelection(); setCodeCtx(null) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50"
            >
              <X size={15} /> ล้างที่เลือก
            </button>
            <p className="px-3 py-1.5 text-[10px] text-slate-400">เคล็ดลับ: Shift+คลิก เพื่อเลือกเป็นช่วง</p>
          </div>
        </>
      )}

      {aiBusy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="mx-4 flex max-w-sm flex-col items-center gap-4 rounded-2xl bg-white px-8 py-7 text-center shadow-2xl">
            <div className="relative flex h-12 w-12 items-center justify-center">
              <div className="absolute h-12 w-12 animate-spin rounded-full border-[3px] border-violet-100 border-t-violet-600" />
              <Sparkles size={20} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{aiBusy}</p>
              <p className="mt-1 text-xs text-slate-400">
                กำลังอ่านคำตอบและจัดเป็นหมวดหมู่ตามความหมาย — คำตอบจำนวนมากอาจใช้เวลาสักครู่ กรุณารอ
              </p>
              <p className="mt-2 font-mono text-xs font-semibold text-violet-600">
                ⏱ {aiElapsed} วินาที
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Modal: สร้างรหัสจากคำตอบ (เลือกระดับการรวมกลุ่ม + preview)
function BuildFromAnswersModal({ open, onClose, answers, onBuild }) {
  // 0 = ละเอียด (รวมน้อย, รหัสเยอะ) ... 100 = หยาบ (รวมมาก, รหัสน้อย)
  const [level, setLevel] = useState(45)
  const [multiTopic, setMultiTopic] = useState(true)
  const [groupIntoNets, setGroupIntoNets] = useState(true)
  const [netLevel, setNetLevel] = useState(30) // ต่ำ = Net น้อย/กว้าง, สูง = Net เยอะ

  // map slider → threshold: ละเอียด=0.85, หยาบ=0.2
  const threshold = useMemo(() => 0.85 - (level / 100) * 0.65, [level])
  const netThreshold = useMemo(() => 0.08 + (netLevel / 100) * 0.32, [netLevel])

  const preview = useMemo(
    () =>
      open && answers.length
        ? previewAdvanced(answers, { threshold, multiTopic, groupIntoNets, netThreshold })
        : { codeCount: 0, netCount: 0 },
    [open, answers, threshold, multiTopic, groupIntoNets, netThreshold],
  )

  return (
    <Modal open={open} onClose={onClose} title="สร้างรหัสจากคำตอบอัตโนมัติ">
      <p className="mb-4 text-sm text-slate-500">
        ระบบจะอ่านคำตอบที่ <b className="text-slate-700">ยังไม่ได้จัดกลุ่ม {answers.length} คำตอบ</b>{' '}
        นำคำตอบที่ข้อความคล้ายกันมารวมเป็นรหัส แล้วสร้างเป็นกลุ่ม (Net) ในชีทนี้ —
        ค่อยมาแก้ชื่อ/รวม/แยก หรือกด "ให้ Claude รีวิว" ภายหลังได้
      </p>

      <Field
        label="ระดับการรวมเป็นรหัส"
        hint="ไปทาง 'รวมมาก' = รหัสน้อยลง (กลุ่มกว้าง) · ไปทาง 'แยกละเอียด' = รหัสมากขึ้น"
      >
        <input
          type="range" min={0} max={100} value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="w-full cursor-pointer accent-indigo-600"
        />
        <div className="mt-1 flex justify-between text-[11px] font-medium text-slate-400">
          <span>แยกละเอียด (รหัสเยอะ)</span>
          <span>รวมมาก (รหัสน้อย)</span>
        </div>
      </Field>

      {/* ตัวเลือกแยก Net + 1 คำตอบหลายโค้ด */}
      <div className="mb-4 space-y-2.5">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 hover:border-indigo-300">
          <input
            type="checkbox" checked={groupIntoNets}
            onChange={(e) => setGroupIntoNets(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-indigo-600"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-700">จัดเป็น Net อัตโนมัติ</span>
            <span className="block text-[11px] leading-snug text-slate-400">
              จับรหัสที่ความหมายใกล้กันเข้าเป็นกลุ่ม (Net) เดียวกัน แทนที่จะรวมไว้ Net เดียว
            </span>
          </span>
        </label>

        {groupIntoNets && (
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <span className="mb-1 block text-xs font-semibold text-slate-600">ระดับการรวมเป็น Net</span>
            <input
              type="range" min={0} max={100} value={netLevel}
              onChange={(e) => setNetLevel(Number(e.target.value))}
              className="w-full cursor-pointer accent-indigo-600"
            />
            <div className="mt-1 flex justify-between text-[11px] font-medium text-slate-400">
              <span>Net น้อย (กว้าง)</span>
              <span>Net เยอะ (แคบ)</span>
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 hover:border-indigo-300">
          <input
            type="checkbox" checked={multiTopic}
            onChange={(e) => setMultiTopic(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-indigo-600"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-700">1 คำตอบลงได้หลายโค้ด</span>
            <span className="block text-[11px] leading-snug text-slate-400">
              แตกคำตอบยาวที่มีหลายเรื่อง (คั่นด้วย "และ / รวมถึง / ,") เป็นประโยคย่อย แล้วลงได้หลายรหัส
            </span>
          </span>
        </label>
      </div>

      <div className="mb-5 flex items-center justify-center gap-2 rounded-xl bg-violet-50 py-3 text-sm">
        <Sparkles size={16} className="text-violet-500" />
        <span className="text-slate-600">จะได้ประมาณ</span>
        <span className="text-lg font-bold text-violet-700">{preview.codeCount}</span>
        <span className="text-slate-600">Code</span>
        {groupIntoNets && (
          <>
            <span className="text-slate-300">·</span>
            <span className="text-lg font-bold text-indigo-700">{preview.netCount}</span>
            <span className="text-slate-600">Net</span>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button
          className="!bg-violet-600 hover:!bg-violet-700 !shadow-violet-200"
          onClick={() => onBuild({ threshold, multiTopic, groupIntoNets, netThreshold })}
          disabled={!answers.length}
        >
          <Sparkles size={15} /> สร้าง {preview.codeCount} Code
        </Button>
      </div>
    </Modal>
  )
}

// ============================================================
// Modal: ย้ายรหัสที่เลือกเข้า Net อื่น (หรือสร้าง Net ใหม่)
function MoveCodesModal({ open, onClose, nets, count, onMove }) {
  const [target, setTarget] = useState('__new__')
  const [newName, setNewName] = useState('')

  // ตั้งค่าเริ่มต้นใหม่ทุกครั้งที่เปิด
  useEffect(() => {
    if (open) {
      setTarget(nets[0]?.id ?? '__new__')
      setNewName('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} onClose={onClose} title={`ย้าย ${count} รหัสเข้ากลุ่ม`}>
      <Field label="เลือกกลุ่ม (Net) ปลายทาง">
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {nets.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setTarget(n.id)}
              className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                target === n.id ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
              }`}
            >
              <span className="truncate font-semibold">{n.name}</span>
              <Badge color="slate">{n.codes.length} รหัส</Badge>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTarget('__new__')}
            className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm transition-colors ${
              target === '__new__' ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-white text-slate-500 hover:border-indigo-400'
            }`}
          >
            <Plus size={14} /> สร้าง Net ใหม่
          </button>
        </div>
      </Field>

      {target === '__new__' && (
        <Field label="ชื่อ Net ใหม่">
          <TextInput
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="เช่น ราคา / การเดินทาง / บริการ"
          />
        </Field>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={() => onMove(target, newName)}>
          <FolderInput size={15} /> ย้าย {count} Code
        </Button>
      </div>
    </Modal>
  )
}

// ============================================================
function SheetQuestionsModal({ open, onClose, project, sheet, updateSheet }) {
  const questions = project.rawMeta?.questions ?? []
  const toggle = (qid) => {
    updateSheet((s) => ({
      ...s,
      questionIds: s.questionIds.includes(qid)
        ? s.questionIds.filter((x) => x !== qid)
        : [...s.questionIds, qid],
    }))
  }

  return (
    <Modal open={open} onClose={onClose} title={`ข้อที่รวมใน "${sheet.name}"`} wide>
      <Field
        label={`เลือกข้อจาก Rawdata (เลือกแล้ว ${sheet.questionIds.length} ข้อ)`}
        hint="คำตอบของข้อที่เลือกจะถูกนำมารวมกันและ Group ตามโครงของชีทนี้"
      >
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
          {questions.map((q) => {
            const checked = sheet.questionIds.includes(q.id)
            return (
              <button
                type="button"
                key={q.id}
                onClick={() => toggle(q.id)}
                title={q.type === 'MA' ? `${q.label} (MA · ${q.columns.length} คอลัมน์)` : q.label}
                className={`flex cursor-pointer items-center justify-between gap-1 truncate rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  checked
                    ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                }`}
              >
                <span className="truncate">{q.label}</span>
                {q.type === 'MA' && (
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${checked ? 'bg-white/25 text-white' : 'bg-violet-100 text-violet-600'}`}>
                    MA
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="ชื่อชีท">
        <TextInput
          value={sheet.name}
          onChange={(e) => updateSheet((s) => ({ ...s, name: e.target.value }))}
        />
      </Field>
      <div className="flex justify-end">
        <Button onClick={onClose}>เสร็จสิ้น</Button>
      </div>
    </Modal>
  )
}

// ============================================================
function findCode(sheet, codeId) {
  for (const net of sheet.nets) {
    const code = net.codes.find((c) => c.id === codeId)
    if (code) return code
  }
  return null
}

// ย้าย key ของ assignment (ข้อความคำตอบเดิม → ใหม่) ในชีทเดียว — รวมกับ key ใหม่ถ้ามีอยู่แล้ว
function migrateAssignKey(sheet, oldKey, newKey) {
  if (!(oldKey in (sheet.assignments ?? {}))) return sheet
  const assignments = { ...sheet.assignments }
  const moved = assignments[oldKey]
  delete assignments[oldKey]
  const existing = assignments[newKey] ?? []
  assignments[newKey] = [...new Set([...existing, ...moved])]
  return { ...sheet, assignments }
}

function cleanAssignments(assignments, removedCodeIds) {
  const next = {}
  for (const [key, ids] of Object.entries(assignments)) {
    const kept = ids.filter((id) => !removedCodeIds.has(id))
    if (kept.length) next[key] = kept
  }
  return next
}

function nextCodeNo(sheet) {
  let max = 0
  for (const net of sheet.nets) {
    for (const code of net.codes) {
      const n = parseInt(code.codeNo, 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
  }
  return String(max + 1)
}
