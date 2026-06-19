import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Download, Upload, Wand2, ListTree, Group,
  Settings2, X, FileSpreadsheet, CornerDownRight, Sparkles, Link2, ChevronDown,
  Pencil, Combine, FolderInput, FolderPlus, CheckSquare, Square, Check, HelpCircle,
  ChevronUp, ChevronsUp, ChevronsDown,
} from 'lucide-react'
import { useStore, useRawdata, uid } from '../store.jsx'
import { parseFrameFile, exportCodeframe, exportCodedData } from '../lib/excel.js'
import {
  uniqueAnswers, autoAssign, buildCodeframeFromAnswers,
  assembleNetsFromGrouping, assembleCodingResult, buildCodeframeAdvanced, previewAdvanced,
} from '../lib/answers.js'
import { aiGroupCodes, aiCodeAnswers, aiReviewAnswers, aiGroupCE } from '../lib/aiGroup.js'
import { isOtherLabel, shortSheetName } from '../lib/boxes.js'
import {
  Button, Modal, Field, TextInput, Badge, BoxBadge, ConfirmDelete, Toast,
} from '../components/ui.jsx'

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
const STATUS_HEX = { orange: 'F59E0B', red: 'EF4444', maroon: '9F1239', gray: '94A3B8', green: '10B981', none: 'CBD5E1' }

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

function isGenericAiMatchCode(code) {
  const label = String(code?.thai || code?.label || '').trim()
  const norm = normalizeCodeLabel(label)
  if (!norm) return true
  if (isOtherLabel(label)) return true
  // SPSS/CE placeholder rows like "ระบุ................" are containers for free text,
  // not semantic codes. Never let AI match every verbatim into these.
  if (norm === 'ระบุ' || norm === 'โปรดระบุ' || norm === 'อื่นๆระบุ' || norm === 'อื่นระบุ') return true
  if (/^ระบุ[\.\-_\s…]*$/i.test(label)) return true
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
  const { state, updateCodeframe, setRawdata } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const cf = state.codeframes.find((c) => c.id === codeframeId)
  const { rawdata, loading: rawLoading } = useRawdata(projectId)

  const [activeSheetId, setActiveSheetId] = useState(cf?.sheets[0]?.id ?? null)
  const [mode, setMode] = useState('frame') // 'frame' | 'grouped'
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [deletingSheet, setDeletingSheet] = useState(null)
  const [renamingSheetId, setRenamingSheetId] = useState(null) // ชีทที่กำลังแก้ชื่อ inline
  const [importError, setImportError] = useState('')
  const [autoMenuOpen, setAutoMenuOpen] = useState(false)
  const [buildOpen, setBuildOpen] = useState(false)
  const [toast, setToast] = useState(null)
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
  const [savingAnswer, setSavingAnswer] = useState(false)
  const [answerDetail, setAnswerDetail] = useState(null) // คำตอบที่กำลังดูรายละเอียด (ตอบ CE มาอะไรบ้าง)
  const [deletingAnswer, setDeletingAnswer] = useState(null) // คำตอบที่จะลบออกจาก Rawdata (ยืนยันก่อน)
  const [aiBusy, setAiBusy] = useState(null) // ข้อความสถานะระหว่างเรียก AI (null = ไม่ทำงาน)
  const [aiElapsed, setAiElapsed] = useState(0)
  const [legendOpen, setLegendOpen] = useState(false) // popover อธิบายสีแถบชีท
  const [addNetOpen, setAddNetOpen] = useState(false) // dropdown เลือกชั้น Net
  const [insertMenu, setInsertMenu] = useState(null) // { codeId } — เมนูแทรก Net เหนือแถว
  const [titleModalOpen, setTitleModalOpen] = useState(false) // popup ดูโจทย์ทุกข้อในชีท
  const [editingCell, setEditingCell] = useState(null) // { codeId, field } — ช่องที่กำลังแก้ (ดับเบิลคลิก)
  // คลิกคำตอบ → เลื่อนไปที่รหัสในโครงด้านซ้าย + ไฮไลต์ชั่วคราว
  const [flashCodeIds, setFlashCodeIds] = useState(() => new Set())
  const [newCodeIds, setNewCodeIds] = useState(() => new Set()) // Code ที่ AI สร้างใหม่ (ไฮไลต์ค้าง)
  const codeRowRefs = useRef({})
  const flashTimer = useRef(null)
  const importRef = useRef(null)
  const scrollBoxRef = useRef(null) // กล่อง scroll ของตาราง Codeframe

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeframeId])

  // เปลี่ยนชีท → ล้างการเลือกรหัส (รหัสคนละชุดกัน)
  useEffect(() => {
    setSelectedCodeIds(new Set())
    setEditingAnswer(null)
    setFlashCodeIds(new Set())
    setNewCodeIds(new Set())
  }, [activeSheetId])

  // เคลียร์ตัวจับเวลาไฮไลต์ตอน unmount
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const sheet = cf?.sheets.find((s) => s.id === activeSheetId) ?? cf?.sheets[0]

  // ข้อที่ "ต้องเอามาจัดกลุ่ม" = คอลัมน์ข้อความอิสระ ("อื่นๆ ระบุ" / OE) เท่านั้น
  //   ข้อปลายปิด (มี value labels ในโค้ดบุ๊ก) ถูกลงโค้ดไว้แล้ว — ไม่ต้องเอามาจัดกลุ่มซ้ำ
  //   ถ้าไม่มีโค้ดบุ๊ก (เช่นงาน OE ล้วน) → ถือว่าทุกข้อเป็นข้อความอิสระ (พฤติกรรมเดิม)
  const openQuestionIds = useMemo(() => {
    if (!rawdata || !sheet) return []
    const cbBy = project?.codebook?.byVar
    return sheet.questionIds.filter((qid) => {
      const q = rawdata.questions.find((x) => x.id === qid)
      if (!q) return false
      const cb = cbBy?.[q.label]
      return !(cb?.values?.length) // มี value labels = ปลายปิด → ตัดออก
    })
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
  // สถานะ/สีของแต่ละชีท ตามสถานะ "อื่นๆ ระบุ" (ดู SHEET_STATUS)
  //   gray  = มี Code อื่นๆ แต่ไม่มีใครเลือก (freq=0) → ไม่ต้องทำ
  //   red   = มีคนเลือกอื่นๆ (freq>0) แต่ไม่มีช่องข้อความต่อท้าย → โค้ดไม่ได้
  //   orange= มีคนเลือกอื่นๆ + มีช่องข้อความ แต่ยังจัดกลุ่มไม่หมด
  //   green = จัดคำตอบอื่นๆ เข้า Code ครบแล้ว
  const sheetStatusMap = useMemo(() => {
    const map = {}
    if (!rawdata) return map
    const cbBy = project?.codebook?.byVar
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
      // ความถี่ของ Code "อื่นๆ ระบุ" = ผลรวมผู้ตอบที่ถูกจัดเข้ารหัสอื่นๆ (ค่าปลายปิดที่ = อื่นๆ)
      const otherFreq = uniqueAnswers(rawdata, sh.questionIds)
        .filter((a) => (sh.assignments[a.key] ?? []).some((id) => otherIds.has(id)))
        .reduce((s, a) => s + a.count, 0)
      // ข้อความ "อื่นๆ" ที่ยังไม่ถูกจัดกลุ่ม
      const ungrouped = uniqueAnswers(rawdata, openIds)
        .filter((a) => !(sh.assignments[a.key] ?? []).length).length

      let status
      if (otherFreq === 0) status = hasText ? 'gray' : 'maroon' // ไม่มีคนตอบอื่นๆ → เทา / แดงเข้มโทนเทา
      else if (!hasText) status = 'red'
      else if (ungrouped > 0) status = 'orange'
      else status = 'green'
      map[sh.id] = status
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---------- mutation helpers ----------
  const updateSheet = (fn) => {
    updateCodeframe(cf.id, (c) => ({
      ...c,
      sheets: c.sheets.map((s) => (s.id === sheet.id ? fn(s) : s)),
    }))
  }

  const addNet = (level = 1) => {
    setAddNetOpen(false)
    updateSheet((s) => ({
      ...s,
      nets: [...s.nets, { id: uid(), name: '', level, codes: [] }],
    }))
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
          ? { ...n, codes: [...n.codes, { id: uid(), codeNo: nextCodeNo(s), thai: '', thai2: '', eng: '' }] }
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
        if (idx >= 0) { n.codes.splice(idx, 0, { id: uid(), codeNo: nextCodeNo(s), thai: '', thai2: '', eng: '' }); break }
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
    const targets = answers.filter((a) => !(sheet.assignments[a.key] ?? []).length)
    if (!targets.length) {
      setToast({ type: 'info', title: 'จัดกลุ่มครบแล้ว', message: 'ไม่มีคำตอบที่ยังไม่ได้จัดกลุ่มเหลือให้ทำ' })
      return
    }
    const flatCodes = sheet.nets.flatMap((n) => n.codes)
    const reusableCodes = flatCodes
      .map((code, originalIndex) => ({ code, originalIndex }))
      .filter(({ code }) => !isGenericAiMatchCode(code))
    const skippedGeneric = flatCodes.length - reusableCodes.length
    const codeItems = reusableCodes.map(({ code }, i) => ({ i, label: code.thai || code.codeNo }))
    const vItems = targets.map((a, i) => ({ i, text: a.text, count: a.count }))

    setAiBusy('AI กำลังจัดกลุ่ม')
    try {
      const { assign } = await aiGroupCE(codeItems, vItems)
      // คำนวณ assignment + Code ใหม่ (dedupe ตามชื่อ)
      const newByLabel = new Map()
      const newCodes = []
      let codeNo = parseInt(nextCodeNo(sheet), 10) || 1
      const addAssign = {}
      let matched = 0
      assign.forEach((entry, i) => {
        if (!entry) return
        const key = targets[i].key
        if (entry.existing != null && reusableCodes[entry.existing]?.code) {
          addAssign[key] = [reusableCodes[entry.existing].code.id]
          matched += 1
        } else if (entry.neo) {
          let id = newByLabel.get(entry.neo)
          if (!id) {
            id = uid()
            newByLabel.set(entry.neo, id)
            // aiNew: true → เก็บลง DB เป็นเครื่องหมาย "Code ที่ AI สร้างใหม่" (ไฮไลต์ถาวร)
            newCodes.push({ id, codeNo: String(codeNo++), thai: entry.neo, thai2: '', eng: '', aiNew: true })
          }
          addAssign[key] = [id]
        }
      })
      const newIds = newCodes.map((c) => c.id)
      updateSheet((s) => {
        const nets = s.nets.length ? s.nets.map((n) => ({ ...n, codes: [...n.codes] })) : [{ id: uid(), name: '', level: 0, codes: [] }]
        const last = nets[nets.length - 1]
        last.codes.push(...newCodes) // Code ใหม่ต่อท้ายกลุ่มสุดท้าย
        return { ...s, nets, assignments: { ...s.assignments, ...addAssign } }
      })
      // ไฮไลต์ Code ที่สร้างใหม่ — ค้างไว้จนกว่าจะเปลี่ยนชีท + เลื่อนไปหาตัวแรก
      if (newIds.length) {
        setNewCodeIds(new Set(newIds))
        requestAnimationFrame(() => codeRowRefs.current[newIds[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      }
      setToast({
        type: 'success',
        title: 'Group CE เสร็จแล้ว',
        message: `จับเข้า Code เดิม ${matched} คำตอบ · สร้าง Code ใหม่ ${newCodes.length} รหัส${skippedGeneric ? ` · ข้าม Code placeholder ${skippedGeneric} รหัส` : ''} (ไฮไลต์เหลืองให้แล้ว)`,
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
      updateSheet((s) => ({ ...s, nets: [...s.nets, ...nets] }))
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
  const applyWordingEdit = async (oldKey, rawNew) => {
    const newText = rawNew.trim()
    if (!newText || newText === oldKey) { setEditingAnswer(null); return }
    if (!rawdata) { setEditingAnswer(null); return }

    // 1) แทนข้อความในทุกเซลล์ของ Rawdata ที่ตรงกับคำตอบเดิมแบบเป๊ะ
    let changed = 0
    const rows = rawdata.rows.map((row) => {
      let copy = null
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] ?? '').trim() === oldKey) {
          if (!copy) copy = row.slice()
          copy[c] = newText
          changed += 1
        }
      }
      return copy ?? row
    })
    if (!changed) { setEditingAnswer(null); return }

    // 2) ย้าย assignment ที่ใช้ข้อความเดิมเป็น key → key ใหม่ ในทุกชีทของทุก Codeframe ใน Project นี้
    for (const c of state.codeframes.filter((c) => c.projectId === projectId)) {
      updateCodeframe(c.id, (cur) => ({
        ...cur,
        sheets: cur.sheets.map((s) => migrateAssignKey(s, oldKey, newText)),
      }))
    }
    if (selectedAnswer === oldKey) setSelectedAnswer(newText)
    setEditingAnswer(null)
    setSavingAnswer(true)
    try {
      await setRawdata(projectId, { ...rawdata, rows })
      setToast({
        type: 'success',
        title: 'แก้คำตอบและอัปเดต Rawdata แล้ว',
        message: `เปลี่ยนข้อความ ${changed} จุดใน Rawdata และย้ายการจัดกลุ่มให้อัตโนมัติ`,
      })
    } catch (err) {
      setToast({ type: 'warning', title: 'บันทึก Rawdata ไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setSavingAnswer(false)
    }
  }

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

  // ลบ "คำตอบอื่นๆ + ค่า code อื่นๆ" ออกจาก Rawdata (ทุก respondent ที่ตอบ text นี้)
  const deleteAnswerFromRawdata = async (text) => {
    if (!rawdata) { setDeletingAnswer(null); return }
    const info = sheetColInfo()
    const otherValues = new Set(
      sheet.nets.flatMap((n) => n.codes).filter((c) => isOtherLabel(c.thai)).map((c) => String(c.codeNo).trim()),
    )
    let changed = 0
    const rows = rawdata.rows.map((row) => {
      if (!info.textCols.some((c) => String(row[c] ?? '').trim() === text)) return row
      const copy = row.slice()
      // ลบข้อความในช่องระบุ
      for (const c of info.textCols) if (String(copy[c] ?? '').trim() === text) { copy[c] = ''; changed += 1 }
      // ลบค่า "อื่นๆ" ในข้อปลายปิด (1 ช่องต่อข้อ)
      for (const { cols } of info.closedQs) {
        const oc = cols.find((c) => otherValues.has(String(copy[c] ?? '').trim()))
        if (oc != null) copy[oc] = ''
      }
      return copy
    })
    // ลบ assignment ของคำตอบนี้ในทุกชีท
    for (const c of state.codeframes.filter((cf2) => cf2.projectId === projectId)) {
      updateCodeframe(c.id, (cur) => ({
        ...cur,
        sheets: cur.sheets.map((s) => {
          if (!(s.assignments[text]?.length)) return s
          const assignments = { ...s.assignments }
          delete assignments[text]
          return { ...s, assignments }
        }),
      }))
    }
    setDeletingAnswer(null)
    if (selectedAnswer === text) setSelectedAnswer(null)
    setSavingAnswer(true)
    try {
      await setRawdata(projectId, { ...rawdata, rows })
      setToast({ type: 'success', title: 'ลบคำตอบ "อื่นๆ" แล้ว', message: `ลบข้อความ + ค่า Code อื่นๆ ออกจาก Rawdata (${changed} จุด)` })
    } catch (err) {
      setToast({ type: 'warning', title: 'ลบไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setSavingAnswer(false)
    }
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

  // Code "อื่นๆ ระบุ" ในชีท + จำนวน verbatim ที่ถูกโค้ดออกไปแล้ว (ไว้หักลบ freq ของ "อื่นๆ")
  const otherCodeIds = new Set(
    sheet.nets.flatMap((n) => n.codes).filter((c) => isOtherLabel(c.thai)).map((c) => c.id),
  )
  const codedOtherCount = answers
    .filter((a) => (sheet.assignments[a.key] ?? []).some((id) => !otherCodeIds.has(id)))
    .reduce((s, a) => s + a.count, 0)
  // frequency ที่แสดงต่อ Code: ถ้าเป็น Code "อื่นๆ" หักจำนวนที่โค้ดออกไปแล้ว
  const freqOf = (code) => {
    const base = assignedAnswersOf(code.id).reduce((s, a) => s + a.count, 0)
    return otherCodeIds.has(code.id) ? Math.max(0, base - codedOtherCount) : base
  }

  const unassignedAnswers = answers.filter((a) => !(sheet.assignments[a.key] ?? []).length)

  // คำตอบที่จะแสดงในแผงด้านขวา ตามปุ่มสลับ (เฉพาะที่ยังไม่จัดกลุ่ม / ทั้งหมด)
  const displayedAnswers =
    answerFilter === 'unassigned' ? unassignedAnswers : answers

  // ข้อปลายปิด (โจทย์) ทั้งหมดในชีท → [{ code (สั้นจาก SPSS), label (โจทย์เต็ม), column (หัวคอลัมน์ Excel) }]
  const getSheetQuestions = (sh) => {
    const cbBy = project?.codebook?.byVar
    return sh.questionIds
      .map((id) => rawdata?.questions.find((x) => x.id === id))
      .filter((q) => q && cbBy?.[q.label]?.values?.length)
      .map((q) => ({ code: cbBy[q.label]?.code || q.label, label: cbBy[q.label]?.label || '', column: q.label }))
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

  // Export 1: เฉพาะ Codeframe (โครงล้วน — ไม่มีชีท Rawdata/คำตอบ) + สีแถบชีทตามสถานะ
  const handleExportCodeframe = () => {
    exportCodeframe(
      cf,
      { jobNo: '', name: project.name },
      (sh) => STATUS_HEX[sheetStatusMap[sh.id] ?? 'none'],
      (sh) => ({ name: sh.name, questions: getSheetQuestions(sh) }), // ชื่อชีท + โจทย์ทุกข้อ
    ).catch((err) => setToast({ type: 'warning', title: 'Export Codeframe ไม่สำเร็จ', message: err.message, duration: 8000 }))
  }

  // Export 2: เฉพาะ Rawdata ที่ลง Code แล้ว (เขียนทับค่าอื่นๆ + ไฮไลต์จุดที่แก้)
  const handleExportData = () => {
    try {
      if (!rawdata) {
        setToast({ type: 'warning', title: 'ยังโหลดข้อมูลไม่เสร็จ', message: 'กรุณารอสักครู่แล้วลองใหม่' })
        return
      }
      const base = (project.rawMeta?.fileName ?? project.name ?? 'rawdata').replace(/\.(xlsx|xls|csv)$/i, '')
      exportCodedData(rawdata, cf, project.codebook, `${base}_coded.xlsx`)
    } catch (err) {
      setToast({ type: 'warning', title: 'Export Data ไม่สำเร็จ', message: err.message, duration: 8000 })
    }
  }

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
          <h1 className="text-lg font-bold text-slate-900">{cf.name}</h1>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={handleExportCodeframe}>
              <Download size={14} /> Export Codeframe
            </Button>
            <Button size="sm" onClick={handleExportData}>
              <Download size={14} /> Export Data
            </Button>
          </div>
        </div>

        {/* ===== Sheet tabs ===== */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {cf.sheets.map((s) => {
            const st = SHEET_STATUS[sheetStatusMap[s.id] ?? 'none']
            return (
            <div
              key={s.id}
              onClick={() => { setActiveSheetId(s.id); setSelectedAnswer(null) }}
              onDoubleClick={() => { setActiveSheetId(s.id); setRenamingSheetId(s.id) }}
              title={`${getSheetQuestions(s)[0]?.label || s.name} — ${st.label} (ดับเบิลคลิกเพื่อเปลี่ยนชื่อชีท)`}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                s.id === sheet.id ? st.active : st.tab
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.id === sheet.id ? 'bg-white/80' : st.dot}`} />
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
                  className="w-28 rounded bg-white/95 px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none ring-2 ring-indigo-300"
                />
              ) : (
                <>
                  <span className="max-w-[11rem] truncate">{shortSheetName(s.name)}</span>
                  <Pencil
                    size={11}
                    className={`opacity-0 transition-opacity group-hover:opacity-100 ${s.id === sheet.id ? 'text-white/60 hover:text-white' : 'text-slate-300 hover:text-indigo-500'}`}
                    onClick={(e) => { e.stopPropagation(); setActiveSheetId(s.id); setRenamingSheetId(s.id) }}
                  />
                </>
              )}
              <span className={s.id === sheet.id ? 'text-white/70' : 'text-slate-400'}>
                {getSheetQuestionCount(s)} ข้อ
              </span>
              {cf.sheets.length > 1 && (
                <X
                  size={12}
                  className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-400"
                  onClick={(e) => { e.stopPropagation(); setDeletingSheet(s) }}
                />
              )}
            </div>
            )
          })}
          <button
            onClick={addSheet}
            className="flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:border-indigo-400 hover:text-indigo-600"
          >
            <Plus size={12} /> เพิ่มชีท
          </button>

          {/* ปุ่มอธิบายสีแถบชีท */}
          <div className="relative">
            <button
              onClick={() => setLegendOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
            >
              <HelpCircle size={13} /> สีแถบหมายถึง?
            </button>
            {legendOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setLegendOpen(false)} />
                <div className="absolute left-0 z-40 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                  <p className="mb-2 text-xs font-bold text-slate-700">สีแถบชีท = สถานะ "อื่นๆ ระบุ"</p>
                  <div className="space-y-2">
                    {['orange', 'red', 'maroon', 'gray', 'green'].map((k) => (
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

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setQuestionsOpen(true)}
              title="ดู/แก้ไขข้อที่อยู่ในชีทนี้"
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
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

      {/* ===== Body ===== */}
      {mode === 'frame' ? (
        <div className="flex min-h-0 flex-1">
          {/* ----- Frame builder ----- */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-5 py-4">
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
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
              <div className="ml-auto flex items-center gap-2">
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
                <Button variant="secondary" size="sm" onClick={() => importRef.current?.click()}>
                  <Upload size={13} /> นำเข้าโครงจาก Excel
                </Button>
                <div className="relative">
                  <Button variant="soft" size="sm" onClick={() => setAddNetOpen((v) => !v)}>
                    <Plus size={13} /> เพิ่ม Net (กลุ่ม)
                    <ChevronDown size={13} className={addNetOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </Button>
                  {addNetOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAddNetOpen(false)} />
                      <div className="absolute right-0 z-20 mt-1.5 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
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

            {/* โจทย์ (จาก codebook) — แสดงเป็นหัวเรื่องของกล่อง ไม่ใช่ Net (คลิกดูทุกข้อได้) */}
            {(() => {
              const qs = getSheetQuestions(sheet)
              if (!qs.length) return null
              const first = qs[0]
              return (
                <div className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-slate-400">โจทย์{qs.length > 1 ? ` · ${qs.length} ข้อในชีทนี้` : ''}</p>
                    {qs.length > 1 && (
                      <button onClick={() => setTitleModalOpen(true)} className="cursor-pointer text-[11px] font-semibold text-indigo-600 hover:underline">
                        ดูโจทย์ทุกข้อ →
                      </button>
                    )}
                  </div>
                  <p className="text-sm font-bold text-slate-800">
                    <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-600">{first.code}</span>
                    {first.label || '—'}
                  </p>
                </div>
              )
            })()}

            {sheet.nets.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/70 p-10 text-center">
                <p className="text-sm font-semibold text-slate-600">ยังไม่มีโครงในชีทนี้</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
                  เริ่มจากการ <b>เพิ่ม Net (กลุ่ม)</b> เช่น "กลิ่น", "สถานการณ์", "ประเภทผ้า"
                  แล้วเพิ่มรหัสในแต่ละกลุ่ม หรือ <b>นำเข้าโครงจาก Excel</b> (รูปแบบเดียวกับ Test_Code.xlsx)
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => importRef.current?.click()}>
                    <Upload size={13} /> นำเข้าโครงจาก Excel
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
                            <tr className="bg-indigo-50/70">
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
                          {net.codes.map((code) => {
                            // frequency จริง (Code "อื่นๆ" หักจำนวนที่โค้ดออกไปแล้ว)
                            const n = freqOf(code)
                            const selectedAssigned =
                              validSelected && (sheet.assignments[validSelected] ?? []).includes(code.id)
                            const isChosen = selectedCodeIds.has(code.id)
                            const isFlash = flashCodeIds.has(code.id)
                            const isNew = !!code.aiNew || newCodeIds.has(code.id)
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
                                    <Badge color="emerald">{n}</Badge>
                                  ) : (
                                    <span className="text-slate-200">0</span>
                                  )}
                                </td>
                                <td className="px-1 py-1 text-center">
                                  <button
                                    title="ลบรหัสนี้"
                                    onClick={(e) => { e.stopPropagation(); deleteCode(net.id, code.id) }}
                                    className="cursor-pointer rounded p-1 text-slate-200 hover:bg-rose-50 hover:text-rose-500"
                                  >
                                    <Trash2 size={13} />
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

          </div>

          {/* ----- Answers panel ----- */}
          <div className="flex w-[26rem] shrink-0 flex-col border-l border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                  <FileSpreadsheet size={15} className="text-emerald-500" />
                  คำตอบจาก Rawdata
                </h2>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={runGroupCE}
                  disabled={!answers.length || !!aiBusy}
                  title="ให้ AI อ่านคำตอบที่ยังไม่จัด → จับเข้า Code เดิมถ้าตรง / สร้าง Code ใหม่ถ้าไม่มี"
                >
                  <Sparkles size={13} /> Group CE ด้วย AI
                  <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold text-white">Agent</span>
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {rawLoading ? (
                  'กำลังโหลดคำตอบจาก Firebase…'
                ) : answers.length ? (
                  <>
                    {answers.length} คำตอบ (ไม่ซ้ำ) · จัดกลุ่มแล้ว{' '}
                    <span className="font-bold text-emerald-600">{assignedCount}</span> · เหลือ{' '}
                    <span className="font-bold text-amber-600">{answers.length - assignedCount}</span>
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
                    ยังไม่จัดกลุ่ม ({unassignedAnswers.length})
                  </button>
                  <button
                    onClick={() => setAnswerFilter('all')}
                    className={`flex-1 cursor-pointer rounded-md px-2 py-1 transition-colors ${
                      answerFilter === 'all' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    ทั้งหมด ({answers.length})
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
                    title="ดับเบิลคลิกเพื่อดูว่า respondent ตอบข้อนี้มาอะไรบ้าง"
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
        <div className="space-y-2">
          {getSheetQuestions(sheet).map((q) => (
            <div key={q.code} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-600">{q.code}</span>
              <span className="text-sm leading-relaxed text-slate-700">{q.label || '— (ไม่มีข้อความโจทย์ในโค้ดบุ๊ก)'}</span>
            </div>
          ))}
        </div>
      </Modal>

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
        onConfirm={() => deleteAnswerFromRawdata(deletingAnswer.text)}
        what={`คำตอบ "อื่นๆ" — "${deletingAnswer?.text}" (จะลบทั้งข้อความและค่า Code อื่นๆ ออกจาก Rawdata จริง)`}
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

      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* เมนูคลิกขวาที่รหัส: รวม / ย้ายเข้า Net */}
      {codeCtx && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setCodeCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCodeCtx(null) }} />
          <div
            className="fixed z-50 max-h-[90vh] w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-2xl"
            style={{ left: Math.min(codeCtx.x, window.innerWidth - 230), top: Math.max(8, Math.min(codeCtx.y, window.innerHeight - 320)) }}
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

      {savingAnswer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-2xl bg-white px-6 py-4 shadow-2xl">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600" />
            <p className="text-sm font-semibold text-slate-700">กำลังอัปเดต Rawdata บน Firebase…</p>
          </div>
        </div>
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
