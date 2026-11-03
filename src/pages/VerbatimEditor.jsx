/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, MessageSquareText, Settings2, Sparkles, Search, X, Check, CheckCircle2, Save, Loader2, RotateCcw, ChevronDown,
  Filter, FilterX, ArrowDownAZ, ArrowDownZA, Copy, ClipboardPaste, Columns2, AlertTriangle,
} from 'lucide-react'
import { useStore, useRawdata, uid } from '../store.jsx'
import { guessSbjNum, detectTextQuestions, newRowCount } from '../lib/boxes.js'
import { aiSpellcheck } from '../lib/aiGroup.js'
import { diffTextCached } from '../lib/textDiff.js'
import { cellValue, cellStatus, isEditable, textKey, toTsvColumn, parseTsv } from '../lib/verbatim.js'
import { codebookForQuestion } from '../lib/spss.js'
import ColumnSettings from '../components/VerbatimColumnSettings.jsx'
import {
  Button, Modal, Toast,
} from '../components/ui.jsx'

const AI_MARK_MAX = 20000 // จำนวน key สูงสุดที่เก็บต่อชนิด (กันเอกสารโปรเจกต์ใหญ่เกิน)

// จำมุมมอง (ทีละข้อ/หลายข้อ + ข้อที่เลือก) ไว้ในเครื่องผู้ใช้ — ไม่สำคัญถ้าหาย
const readView = (key) => { try { return JSON.parse(window.localStorage.getItem(key) || 'null') } catch { return null } }
const writeView = (key, v) => { try { window.localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ } }

export default function VerbatimEditor() {
  const { projectId } = useParams()
  const { state, patchRawdata, updateProjectBox, markBoxSeen, loadOriginalRawdata } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const { rawdata, loading } = useRawdata(projectId)

  const cfg = project?.boxes?.verbatim
  const seenRowCount = cfg?.seenRowCount ?? 0

  // working copy ของ rawdata (แก้ในเครื่องก่อน แล้ว debounce เขียนขึ้น Firestore)
  const [draft, setDraft] = useState(rawdata)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const saveTimer = useRef(null)
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  // ข้อมูลล่าสุดที่บันทึกแล้ว — ใช้ diff หาเซลล์ที่แก้ เพื่อเก็บประวัติให้กดกู้คืน (Undo) ได้จากหน้า Project
  const savedRef = useRef(rawdata)

  // sync เมื่อ rawdata จาก store เปลี่ยน (โหลดเสร็จ / กล่องอื่นแก้)
  useEffect(() => {
    if (rawdata && !dirty) { setDraft(rawdata); savedRef.current = rawdata }
  }, [rawdata, dirty])

  // ---------- Rawdata ต้นฉบับ (Original) ไว้เทียบกับค่าที่ Clean แล้ว ----------
  const [original, setOriginal] = useState({ projectId: null, data: null, fallback: false })
  const originalChunkCount = project?.rawMeta?.originalChunkCount ?? 0
  useEffect(() => {
    if (!rawdata) return undefined
    let cancelled = false
    // ไม่มีสำเนาต้นฉบับ → ใช้ค่าตอนเปิดหน้าครั้งแรก และคงไว้ (ไม่ให้ Original เปลี่ยนตามการแก้ที่เพิ่งบันทึก)
    const fallbackToSnapshot = () => {
      if (cancelled) return
      setOriginal((prev) => (prev.projectId === projectId && prev.data ? prev : { projectId, data: rawdata, fallback: true }))
    }
    if (!(originalChunkCount > 0)) { fallbackToSnapshot(); return () => { cancelled = true } }
    loadOriginalRawdata(projectId)
      .then((d) => { if (cancelled) return; if (d) setOriginal({ projectId, data: d, fallback: false }); else fallbackToSnapshot() })
      .catch((err) => { console.error('load original rawdata for Verbatim failed', err); fallbackToSnapshot() })
    return () => { cancelled = true }
  }, [projectId, originalChunkCount, !!rawdata])
  const origData = original.projectId === projectId ? original.data : null

  const [editing, setEditing] = useState(null) // { rowIdx, col }
  const [editDraft, setEditDraft] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all | changed | same
  const [hideEmpty, setHideEmpty] = useState(true)
  // ตัวกรองหัวคอลัมน์แบบ Excel: key (`sbj` | `ref|id` | `orig|id` | `clean|id` | `status|id`) → ค่าที่เลือก · sortBy = { key, dir }
  const [colFilters, setColFilters] = useState({})
  const [sortBy, setSortBy] = useState(null)
  const [filterMenu, setFilterMenu] = useState(null) // { key, title, kind, top, left, values }
  // เลือกทั้งคอลัมน์ Clean → คัดลอกไป Excel / วางกลับ (เทียบกับ Original ให้อัตโนมัติ)
  const [colSel, setColSel] = useState(null) // question id
  const [clipMsg, setClipMsg] = useState('')
  const [pasteDraft, setPasteDraft] = useState(null) // { qid, col, targets: rowIdx[], values: string[], multiCol, fromCopy }
  const copySnap = useRef(null) // { qid, idxs } แถวตามลำดับตอนคัดลอก (ไว้วางกลับให้ตรงแถว)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState(null)
  // สถานะจาก AI — เก็บถาวรในกล่อง verbatim ของโปรเจกต์ (cfg.aiFixed / cfg.aiOk เป็น textKey)
  //   aiFixed: ข้อความ (หลังแก้) ที่ Stamp ตาม AI → ป้าย "AI แก้"
  //   aiOk:    ข้อความที่ AI ตรวจแล้วไม่ต้องแก้ → ป้าย "AI ตรวจแล้ว OK"
  const [aiFixed, setAiFixed] = useState(() => new Set(cfg?.aiFixed ?? []))
  const [aiOk, setAiOk] = useState(() => new Set(cfg?.aiOk ?? []))
  //   humanOk: ข้อความที่คนดูแล้ว เหมือนต้นฉบับ (เช่น วางทั้งคอลัมน์กลับมา) → ป้าย "Human ดูแล้ว OK"
  const [humanOk, setHumanOk] = useState(() => new Set(cfg?.humanOk ?? []))
  //   aiFlag:  ข้อความที่ AI ชี้ว่าตอบมั่ว/อ่านไม่ออก/ไม่ได้ใจความ → ป้าย "ให้คนเช็ค" (Map textKey → เหตุผล)
  const [aiFlag, setAiFlag] = useState(() => new Map(Object.entries(cfg?.aiFlag ?? {})))
  const aiMarksDirty = useRef(false)
  const addAiMarks = (setter, keys) => {
    if (!keys.length) return
    aiMarksDirty.current = true
    setter((prev) => {
      const next = new Set(prev)
      for (const k of keys) { next.delete(k); next.add(k) }
      if (next.size <= AI_MARK_MAX) return next
      return new Set([...next].slice(next.size - AI_MARK_MAX))
    })
  }
  // set: [[key, reason]] = ให้คนเช็ค · clear: [key] = AI ตรวจรอบใหม่แล้วว่า OK → เอาป้ายออก
  const updateFlags = (set = [], clear = []) => {
    if (!set.length && !clear.length) return
    setAiFlag((prev) => {
      if (!set.length && !clear.some((k) => prev.has(k))) return prev
      const next = new Map(prev)
      for (const k of clear) next.delete(k)
      for (const [k, why] of set) { next.delete(k); next.set(k, why) }
      while (next.size > AI_MARK_MAX) next.delete(next.keys().next().value)
      aiMarksDirty.current = true
      return next
    })
  }

  // AI ตรวจสะกด — แบ่งเป็นชุด ๆ ให้จิ้มดูผล/Stamp ลง Rawdata ทีละชุดได้ระหว่างที่ชุดอื่นยังตรวจอยู่
  const [aiBusy, setAiBusy] = useState(false)
  // aiRun = { label, cols, total, done, eta, batches: [{ id, texts, status: queued|running|done|error|applied, fixes, error, stamped }] }
  const [aiRun, setAiRun] = useState(null)
  const [aiListOpen, setAiListOpen] = useState(false)
  const [aiBatchId, setAiBatchId] = useState(null)
  const [aiMenuOpen, setAiMenuOpen] = useState(false)

  // ตั้งค่าเริ่มต้น (เดา SbjNum + ข้อ text) ครั้งแรกถ้ายังไม่เคยตั้ง
  useEffect(() => {
    if (!rawdata || !project) return
    if (cfg.sbjNumId == null && !cfg.questionIds.length) {
      updateProjectBox(projectId, 'verbatim', {
        sbjNumId: guessSbjNum(rawdata),
        questionIds: detectTextQuestions(rawdata),
      })
    }
  }, [rawdata, project?.id])

  // หมายเหตุ: ไม่ auto-mark seen ที่นี่ — ให้ผู้ใช้เห็นแถวใหม่ (ไฮไลต์) ก่อน
  // แล้วกดปุ่ม "ตรวจแล้ว" เพื่อล้างป้ายเอง (markBoxSeen)

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const questions = draft?.questions ?? []
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])

  const sbjQ = cfg?.sbjNumId ? byId.get(cfg.sbjNumId) : null
  const verbatimQs = (cfg?.questionIds ?? []).filter((id) => id !== cfg?.sbjNumId).map((id) => byId.get(id)).filter(Boolean)
  const refQs = (cfg?.refQuestionIds ?? []).map((id) => byId.get(id)).filter(Boolean)
  const verbatimKey = verbatimQs.map((q) => q.id).join('|')

  // ---------- เลือกข้อที่จะดู: ทีละข้อ หรือหลายข้อ ----------
  const viewKey = `cof-verbatim-view-${projectId}`
  const [viewMode, setViewMode] = useState(() => readView(viewKey)?.mode === 'multi' ? 'multi' : 'single')
  const [pickedIds, setPickedIds] = useState(() => readView(viewKey)?.ids ?? [])
  useEffect(() => { writeView(viewKey, { mode: viewMode, ids: pickedIds }) }, [viewKey, viewMode, pickedIds])
  // มาจากหน้าสรุป: ?q=<id> เปิดข้อนั้น · ?settings=1 เปิดตั้งค่าคอลัมน์
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const q = searchParams.get('q')
    const settings = searchParams.get('settings') === '1'
    if (!q && !settings) return
    if (q) { setViewMode('single'); setPickedIds([q]) }
    if (settings) setSettingsOpen(true)
    setSearchParams({}, { replace: true })
  }, [searchParams])

  // โหลดสถานะ AI ที่บันทึกไว้ เมื่อเปิดโปรเจกต์ (หรือเอกสารโปรเจกต์โหลดเสร็จทีหลัง)
  const aiMarksLoadedFor = useRef(null)
  useEffect(() => {
    if (!cfg || aiMarksLoadedFor.current === projectId || aiMarksDirty.current) return
    aiMarksLoadedFor.current = projectId
    setAiFixed(new Set(cfg.aiFixed ?? []))
    setAiOk(new Set(cfg.aiOk ?? []))
    setHumanOk(new Set(cfg.humanOk ?? []))
    setAiFlag(new Map(Object.entries(cfg.aiFlag ?? {})))
  }, [projectId, cfg])
  // บันทึกสถานะ AI ลงกล่อง verbatim (debounce — ตอนตรวจหลายชุดจะได้ไม่เขียนถี่)
  const aiMarksRef = useRef(null)
  useEffect(() => { aiMarksRef.current = { projectId, aiFixed, aiOk, humanOk, aiFlag } }, [projectId, aiFixed, aiOk, humanOk, aiFlag])
  const flushAiMarks = () => {
    if (!aiMarksDirty.current) return
    aiMarksDirty.current = false
    const m = aiMarksRef.current
    aiMarksLoadedFor.current = m.projectId
    updateProjectBox(m.projectId, 'verbatim', {
      aiFixed: [...m.aiFixed], aiOk: [...m.aiOk], humanOk: [...m.humanOk], aiFlag: Object.fromEntries(m.aiFlag),
    })
  }
  useEffect(() => {
    if (!aiMarksDirty.current) return
    const t = setTimeout(flushAiMarks, 1500)
    return () => clearTimeout(t)
  }, [aiFixed, aiOk, humanOk, aiFlag])
  useEffect(() => () => flushAiMarks(), []) // ออกจากหน้าก่อนครบเวลา debounce ก็ยังบันทึก
  const pickedKey = pickedIds.join('|')
  const shownQs = useMemo(() => {
    const valid = verbatimQs.filter((q) => pickedIds.includes(q.id))
    if (viewMode === 'single') return [valid[0] ?? verbatimQs[0]].filter(Boolean)
    return valid.length ? valid : verbatimQs.slice(0, 1)
  }, [verbatimKey, pickedKey, viewMode])
  const pickQuestion = (id) => {
    if (viewMode === 'single') { setPickedIds([id]); return }
    const cur = shownQs.map((q) => q.id)
    if (cur.includes(id)) { if (cur.length > 1) setPickedIds(cur.filter((x) => x !== id)) }
    else setPickedIds([...cur, id])
  }
  const switchMode = (mode) => {
    setViewMode(mode)
    if (mode === 'single') setPickedIds(shownQs.slice(0, 1).map((q) => q.id))
  }

  // ---------- จับคู่แถวกับต้นฉบับ (ตามลำดับ ถ้า SbjNum ไม่ตรงค่อยหาตาม SbjNum) ----------
  const rowsAll = draft?.rows ?? []
  const origBySbj = useMemo(() => {
    if (!origData || !sbjQ) return null
    const m = new Map()
    for (const r of origData.rows ?? []) { const k = cellValue(r, sbjQ); if (k && !m.has(k)) m.set(k, r) }
    return m
  }, [origData, sbjQ?.id])
  const origRowAt = (row, i) => {
    if (!origData) return row
    const byIdx = origData.rows?.[i]
    if (!sbjQ) return byIdx ?? row
    const k = cellValue(row, sbjQ)
    if (byIdx && cellValue(byIdx, sbjQ) === k) return byIdx
    return origBySbj?.get(k) ?? row // แถวที่ไม่มีในต้นฉบับ → ถือว่าค่าปัจจุบันคือต้นฉบับ
  }

  // จำนวนเซลล์ที่แก้แล้วต่อข้อ (โชว์บนปุ่มเลือกข้อ)
  const changedByQ = useMemo(() => {
    const m = new Map()
    for (const q of verbatimQs) {
      let n = 0
      for (let i = 0; i < rowsAll.length; i++) {
        const row = rowsAll[i]
        if (cellValue(row, q) !== cellValue(origRowAt(row, i), q)) n++
      }
      m.set(q.id, n)
    }
    return m
  }, [rowsAll, origData, verbatimKey, sbjQ?.id])

  // เซลล์ "ยังไม่แก้" = มีข้อความ แต่คนยังไม่แก้ และ AI ยังไม่ได้ตรวจว่า OK
  //   (ข้อหลายคอลัมน์แก้ไม่ได้ → ไม่นับว่าค้าง)
  const isPending = (q, [o, c]) => {
    if (!isEditable(q) || !c || o !== c) return false
    const k = textKey(q.index, c)
    return !aiOk.has(k) && !aiFixed.has(k) && !humanOk.has(k) && !aiFlag.has(k)
  }
  // AI ชี้ให้คนเช็ค (มั่ว/ไม่ได้ใจความ) และคนยังไม่ได้ดู/แก้
  const isFlagged = (q, [o, c]) => {
    if (!isEditable(q) || !c || o !== c) return false
    const k = textKey(q.index, c)
    return aiFlag.has(k) && !humanOk.has(k)
  }

  // ค่าของคอลัมน์ตาม key (ใช้ทั้งกรองและเรียง)
  const colValue = (key, row, orow) => {
    if (key === 'sbj') return sbjQ ? cellValue(row, sbjQ) : ''
    const cut = key.indexOf('|')
    const kind = key.slice(0, cut)
    const q = byId.get(key.slice(cut + 1))
    if (!q) return ''
    if (kind === 'ref') return cellValue(row, q)
    const o = cellValue(orow, q)
    const c = cellValue(row, q)
    if (kind === 'orig') return o
    if (kind === 'clean') return c
    if (kind === 'status') return cellStatus(q, o, c, aiOk, aiFixed, humanOk, aiFlag)
    return ''
  }
  // ใช้เฉพาะตัวกรองของคอลัมน์ที่แสดงอยู่ (ข้ออื่นที่ซ่อนไว้ไม่กระทบ)
  const shownColIds = [...shownQs, ...refQs].map((q) => q.id).join('|')
  const activeFilters = useMemo(() => {
    const ids = new Set(shownColIds.split('|'))
    return Object.entries(colFilters)
      .filter(([k]) => (k === 'sbj' ? !!sbjQ : ids.has(k.slice(k.indexOf('|') + 1))))
      .map(([k, vals]) => [k, new Set(vals)])
  }, [colFilters, shownColIds, sbjQ?.id])
  const sortActive = sortBy && (sortBy.key === 'sbj' ? !!sbjQ : shownColIds.split('|').includes(sortBy.key.slice(sortBy.key.indexOf('|') + 1)))

  // กรองแถว: ซ่อนแถวว่าง / สถานะ / คำค้น / ตัวกรองหัวคอลัมน์ (exceptKey = ไม่นับตัวกรองของคอลัมน์นั้น ใช้ตอนเปิดเมนู)
  const displayCols = [sbjQ, ...shownQs, ...refQs].filter(Boolean)
  const qText = query.trim().toLowerCase()
  const rowPasses = (row, orow, exceptKey) => {
    const pairs = shownQs.map((q) => [cellValue(orow, q), cellValue(row, q)])
    if (hideEmpty && pairs.every(([o, c]) => !o && !c)) return false
    const anyChanged = pairs.some(([o, c]) => o !== c)
    if (statusFilter === 'changed' && !anyChanged) return false
    // ยังไม่แก้ = ยังไม่มีใครดู: มีข้อความ + คนยังไม่แก้ + AI ยังไม่ได้ตรวจ
    if (statusFilter === 'same' && !shownQs.some((q, k) => isPending(q, pairs[k]))) return false
    if (statusFilter === 'flag' && !shownQs.some((q, k) => isFlagged(q, pairs[k]))) return false
    if (qText) {
      const hit = displayCols.some((dc) => cellValue(row, dc).toLowerCase().includes(qText))
        || pairs.some(([o]) => o.toLowerCase().includes(qText))
      if (!hit) return false
    }
    for (const [k, set] of activeFilters) if (k !== exceptKey && !set.has(colValue(k, row, orow))) return false
    return true
  }
  const rows = useMemo(() => {
    const out = []
    for (let i = 0; i < rowsAll.length; i++) {
      const row = rowsAll[i]
      if (rowPasses(row, origRowAt(row, i))) out.push([row, i])
    }
    if (sortActive) {
      const { key, dir } = sortBy
      const val = ([row, i]) => {
        const v = colValue(key, row, origRowAt(row, i))
        return key.startsWith('status|') ? String(STATUS_ORDER.indexOf(v)).padStart(2, '0') : v
      }
      const keyed = out.map((r) => [val(r), r])
      keyed.sort((a, b) => {
        if (!a[0] && b[0]) return 1 // ค่าว่างไว้ท้ายเสมอ
        if (a[0] && !b[0]) return -1
        return a[0].localeCompare(b[0], 'th', { numeric: true }) * dir
      })
      return keyed.map(([, r]) => r)
    }
    return out
  }, [rowsAll, origData, query, statusFilter, hideEmpty, shownQs, cfg?.sbjNumId, cfg?.refQuestionIds, aiOk, aiFixed, humanOk, aiFlag, activeFilters, sortBy, sortActive])

  // เปิดเมนูกรองของคอลัมน์: รวมค่าที่มี (จากแถวที่ผ่านตัวกรองอื่น ๆ) พร้อมจำนวน
  const openFilterMenu = (key, title, e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const counts = new Map()
    for (let i = 0; i < rowsAll.length; i++) {
      const row = rowsAll[i]
      const orow = origRowAt(row, i)
      if (!rowPasses(row, orow, key)) continue
      const v = colValue(key, row, orow)
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    // ค่าที่เคยเลือกไว้แต่ตอนนี้ไม่มีแล้ว ก็ยังให้เห็น (count 0)
    for (const v of colFilters[key] ?? []) if (!counts.has(v)) counts.set(v, 0)
    const isStatus = key.startsWith('status|')
    const values = [...counts.entries()].map(([v, count]) => ({ v, count }))
    values.sort((a, b) => (isStatus
      ? STATUS_ORDER.indexOf(a.v) - STATUS_ORDER.indexOf(b.v)
      : (!a.v) - (!b.v) || a.v.localeCompare(b.v, 'th', { numeric: true })))
    const width = 340
    setFilterMenu({
      key, title, isStatus, values,
      top: Math.min(r.bottom + 4, window.innerHeight - 120),
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
      width,
    })
  }
  const filterBtn = (key, title) => (
    <FilterButton
      active={activeFilters.some(([k]) => k === key)}
      sortDir={sortActive && sortBy.key === key ? sortBy.dir : 0}
      onClick={(e) => openFilterMenu(key, title, e)}
    />
  )
  const colFilterCount = activeFilters.length + (sortActive ? 1 : 0)

  // ---------- คัดลอก / วาง ทั้งคอลัมน์ Clean ----------
  const selQ = colSel ? shownQs.find((q) => q.id === colSel && isEditable(q)) ?? null : null
  useEffect(() => { if (colSel && !selQ) setColSel(null) }, [colSel, selQ])
  const copyColumn = async () => {
    if (!selQ) return
    const idxs = rows.map(([, i]) => i)
    const text = toTsvColumn(rows.map(([row]) => cellValue(row, selQ)))
    copySnap.current = { qid: selQ.id, idxs }
    let ok
    try { await navigator.clipboard.writeText(text); ok = true } catch { ok = legacyCopy(text) }
    setClipMsg(ok ? `คัดลอก ${idxs.length} แถวแล้ว ✓ ไปวางใน Excel แก้เสร็จแล้วคัดลอกทั้งคอลัมน์กลับมากด วาง` : 'คัดลอกไม่สำเร็จ — ลองกด Ctrl+C อีกครั้ง')
  }
  const startPaste = (text) => {
    if (!selQ) return
    const recs = parseTsv(text)
    if (!recs.length) { setClipMsg('คลิปบอร์ดว่าง — คัดลอกคอลัมน์จาก Excel ก่อน'); return }
    const values = recs.map((r) => String(r[0] ?? '').replace(/\r\n?/g, '\n').trim())
    const snap = copySnap.current
    const fromCopy = !!snap && snap.qid === selQ.id && snap.idxs.length === values.length
    const targets = fromCopy ? snap.idxs : rows.map(([, i]) => i)
    setPasteDraft({ qid: selQ.id, col: selQ.index, targets, values, multiCol: recs.some((r) => r.length > 1), fromCopy })
  }
  const pasteFromButton = async () => {
    try {
      const t = await navigator.clipboard.readText()
      startPaste(t)
    } catch {
      setClipMsg('เบราว์เซอร์ไม่ให้อ่านคลิปบอร์ด — กด Ctrl+V (มือถือ: กดค้างแล้ววาง) แทน')
    }
  }
  // สรุปก่อนวาง: เทียบกับ Clean ปัจจุบัน + Original
  const pastePlan = useMemo(() => {
    if (!pasteDraft || !draft) return null
    const q = byId.get(pasteDraft.qid)
    if (!q) return null
    const n = Math.min(pasteDraft.targets.length, pasteDraft.values.length)
    const items = []
    let changed = 0
    let humanEdit = 0
    let sameOrig = 0
    for (let k = 0; k < n; k++) {
      const i = pasteDraft.targets[k]
      const row = draft.rows[i]
      const orig = cellValue(origRowAt(row, i), q)
      const cur = cellValue(row, q)
      const next = pasteDraft.values[k]
      if (next !== cur) changed++
      if (next !== orig) humanEdit++
      else if (next) sameOrig++
      items.push({ i, orig, cur, next, sbj: sbjQ ? cellValue(row, sbjQ) : '' })
    }
    return { q, n, items, changed, humanEdit, sameOrig }
  }, [pasteDraft, draft, origData])
  const applyPaste = () => {
    if (!pastePlan) return
    const { q, items } = pastePlan
    const col = q.index
    const map = new Map(items.map((x) => [x.i, x.next]))
    const base = draftRef.current
    const rows2 = base.rows.map((r, i) => {
      if (!map.has(i) || String(r?.[col] ?? '').trim() === map.get(i)) return r
      const copy = r.slice()
      copy[col] = map.get(i)
      return copy
    })
    const next = { ...base, rows: rows2 }
    setDraft(next)
    draftRef.current = next
    scheduleSave(next)
    // เหมือนต้นฉบับ = คนดูแล้ว OK · ต่างจากต้นฉบับ = Human แก้ (คิดจากการเทียบอัตโนมัติ)
    addAiMarks(setHumanOk, items.filter((x) => x.next && x.next === x.orig).map((x) => textKey(col, x.next)))
    setPasteDraft(null)
    setClipMsg(`วางแล้ว ${pastePlan.n} แถว ✓ Human แก้ ${pastePlan.humanEdit} · Human ดูแล้ว OK ${pastePlan.sameOrig}`)
  }
  // คีย์ลัด: Ctrl/Cmd+C คัดลอก · Ctrl/Cmd+V วาง · Esc ยกเลิกเลือก (เฉพาะตอนเลือกคอลัมน์อยู่ และไม่ได้พิมพ์ในช่องข้อความ)
  const clipHandlers = useRef({})
  useEffect(() => { clipHandlers.current = { copyColumn, startPaste } })
  useEffect(() => {
    if (!colSel) return undefined
    const typing = (e) => {
      const t = e.target
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const onKey = (e) => {
      if (typing(e)) return
      if (e.key === 'Escape') { setColSel(null); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !String(window.getSelection?.() ?? '')) {
        e.preventDefault()
        clipHandlers.current.copyColumn()
      }
    }
    const onPaste = (e) => {
      if (typing(e)) return
      const t = e.clipboardData?.getData('text/plain')
      if (t) { e.preventDefault(); clipHandlers.current.startPaste(t) }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('paste', onPaste)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('paste', onPaste) }
  }, [colSel])

  // จำนวนเซลล์ที่ยังไม่มีใครดู ต่อข้อ (สีแท็บชีท: ค้าง = ส้ม · ครบ = เขียว) + รวมของข้อที่แสดง (ตัวกรอง "ยังไม่แก้")
  //   flagByQ = ช่องที่ AI ให้คนเช็ค (ยังนับว่าค้าง จนกว่าคนจะกด OK หรือแก้)
  const [pendingByQ, flagByQ] = useMemo(() => {
    const m = new Map()
    const f = new Map()
    for (const q of verbatimQs) {
      let n = 0
      let nf = 0
      for (let i = 0; i < rowsAll.length; i++) {
        const row = rowsAll[i]
        const pair = [cellValue(origRowAt(row, i), q), cellValue(row, q)]
        if (isPending(q, pair)) n++
        else if (isFlagged(q, pair)) nf++
      }
      m.set(q.id, n)
      f.set(q.id, nf)
    }
    return [m, f]
  }, [rowsAll, origData, verbatimKey, aiOk, aiFixed, humanOk, aiFlag, sbjQ?.id])
  const leftByQ = useMemo(() => new Map(verbatimQs.map((q) => [q.id, (pendingByQ.get(q.id) ?? 0) + (flagByQ.get(q.id) ?? 0)])), [pendingByQ, flagByQ])
  const shownPending = shownQs.reduce((n, q) => n + (pendingByQ.get(q.id) ?? 0), 0)
  const shownFlag = shownQs.reduce((n, q) => n + (flagByQ.get(q.id) ?? 0), 0)

  // ---------- บันทึก (debounce) ----------
  const scheduleSave = (next) => {
    setDirty(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(next), 1000)
  }
  const persist = async (next) => {
    const data = next ?? draftRef.current
    if (!data) return
    setSaving(true)
    try {
      // updateOriginal: false = ไม่เขียนทับ Rawdata ต้นฉบับ (ใช้เทียบ/กู้คืน) — เหมือนการแก้จากหน้า Codeframe
      // เขียนเฉพาะเซลล์ที่แก้ ลงบน Rawdata ล่าสุด (ไม่ทับสิ่งที่ CE / คนอื่นแก้ไว้ในจุดอื่น)
      const undoSnapshot = buildUndoSnapshot(savedRef.current, data.rows)
      if (undoSnapshot) await patchRawdata(projectId, undoSnapshot.cells, { undoSnapshot })
      savedRef.current = data
      if (draftRef.current === data) setDirty(false)
    } catch (err) {
      setToast({ type: 'warning', title: 'บันทึกไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setSaving(false)
    }
  }

  const writeCell = (rowIdx, col, text) => {
    const base = draftRef.current
    const cur = String(base.rows[rowIdx]?.[col] ?? '').trim()
    if (text === cur) return false
    const rows2 = base.rows.map((r, i) => {
      if (i !== rowIdx) return r
      const copy = r.slice()
      copy[col] = text
      return copy
    })
    const next = { ...base, rows: rows2 }
    setDraft(next)
    draftRef.current = next
    scheduleSave(next)
    return true
  }

  // ---------- แก้ค่าเซลล์เดียว ----------
  const startEdit = (rowIdx, col) => {
    setEditing({ rowIdx, col })
    setEditDraft(String(draftRef.current?.rows[rowIdx]?.[col] ?? ''))
  }
  const commitEdit = () => {
    if (!editing) return
    const { rowIdx, col } = editing
    setEditing(null)
    writeCell(rowIdx, col, editDraft.trim())
  }
  const revertCell = (rowIdx, col, origText) => {
    if (editing?.rowIdx === rowIdx && editing?.col === col) setEditing(null)
    writeCell(rowIdx, col, origText)
  }

  // ---------- AI ตรวจสะกด: scope 'page' = ข้อที่แสดงอยู่ (ตามตัวกรอง) · 'all' = ทุกข้อ Verbatim ทุกแถว ----------
  const patchBatch = (id, patch) =>
    setAiRun((r) => (r ? { ...r, batches: r.batches.map((b) => (b.id === id ? { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } : b)) } : r))

  // โจทย์ของข้อ (จาก .sav ถ้ามี) — ส่งให้ AI ดูว่าคำตอบตรงคำถามไหม
  const questionText = (q) => {
    const fromSav = codebookForQuestion(project?.codebook, q)?.label
    return [q.label, fromSav || (q.text && q.text !== q.label ? q.text : '')].filter(Boolean).join(' — ')
  }
  // ตรวจ 1 ชุด → { fixes: [{ original, fixed, reason, accepted }], flags: [{ text, reason }] }
  const checkTexts = async (texts, question) => {
    const items = texts.map((text, i) => ({ i, text }))
    let res
    try {
      res = await aiSpellcheck(items, question)
    } catch {
      await new Promise((r) => setTimeout(r, 1500))
      res = await aiSpellcheck(items, question) // ลองใหม่ 1 ครั้ง
    }
    const flags = []
    const flagged = new Set()
    for (const f of res?.flags ?? []) {
      const text = texts[f.i]
      if (text && !flagged.has(text)) { flagged.add(text); flags.push({ text, reason: f.reason || 'ไม่ได้ใจความ' }) }
    }
    const fixes = []
    for (const f of res?.fixes ?? []) {
      const original = texts[f.i]
      if (original && !flagged.has(original) && f.fixed && original !== f.fixed) fixes.push({ original, fixed: f.fixed, reason: f.reason, accepted: true })
    }
    return { fixes, flags }
  }

  // จำผลตรวจ: ไม่มีจุดแก้ → "AI ตรวจแล้ว OK" · มั่ว/ไม่ได้ใจความ → "ให้คนเช็ค"
  const markChecked = (texts, { fixes, flags }, col) => {
    const skip = new Set([...fixes.map((f) => f.original), ...flags.map((f) => f.text)])
    const okKeys = texts.filter((t) => !skip.has(t)).map((t) => textKey(col, t))
    addAiMarks(setAiOk, okKeys)
    updateFlags(flags.map((f) => [textKey(col, f.text), f.reason]), okKeys)
  }
  // คนดูแล้ว OK (เช่น ช่องที่ AI ให้คนเช็ค แต่คนอ่านแล้วว่าใช้ได้)
  const markHumanOk = (col, text) => addAiMarks(setHumanOk, [textKey(col, text)])

  const runSpellcheck = async (scope = 'page') => {
    setAiMenuOpen(false)
    const cols = (scope === 'all' ? verbatimQs : shownQs).filter(isEditable)
    if (!cols.length) {
      setToast({ type: 'warning', title: 'ยังไม่มีข้อ Verbatim ให้ตรวจ', message: 'เลือกข้อ Verbatim ที่แก้ได้ (ข้อคอลัมน์เดียว)' })
      return
    }
    // เก็บข้อความไม่ซ้ำแยกตามข้อ (ส่งโจทย์ของข้อไปด้วย ให้ AI ดูว่าตอบตรงคำถามไหม)
    const scopeRows = scope === 'all' ? rowsAll.map((r, i) => [r, i]) : rows
    const perQ = cols.map((q) => {
      const uniq = new Set()
      for (const [row] of scopeRows) {
        const v = String(row?.[q.index] ?? '').trim()
        if (v) uniq.add(v)
      }
      return { q, texts: [...uniq] }
    }).filter((x) => x.texts.length)
    const totalTexts = perQ.reduce((n, x) => n + x.texts.length, 0)
    if (!totalTexts) {
      setToast({ type: 'info', title: 'ไม่มีข้อความให้ตรวจ', message: 'คอลัมน์ที่เลือกว่างเปล่า' })
      return
    }
    // แบ่งเป็นชุดเล็ก (จำนวน + ความยาวรวม) — ชุดใหญ่ทำให้โมเดลตอบไม่ทัน (timeout / ไม่มีผลลัพธ์)
    const MAX_ITEMS = 20
    const MAX_CHARS = 3000
    const CONCURRENCY = 8
    const chunks = [] // [{ q, texts }]
    for (const { q, texts: qTexts } of perQ) {
      let cur = []
      let curChars = 0
      for (const t of qTexts) {
        if (cur.length && (cur.length >= MAX_ITEMS || curChars + t.length > MAX_CHARS)) {
          chunks.push({ q, texts: cur })
          cur = []
          curChars = 0
        }
        cur.push(t)
        curChars += t.length
      }
      if (cur.length) chunks.push({ q, texts: cur })
    }
    const texts = { length: totalTexts }

    const label = scope === 'all' ? `ทุกข้อ (${cols.length} ข้อ)` : cols.map((q) => q.label).join(', ')
    setAiRun({
      label,
      total: totalTexts,
      done: 0,
      eta: null,
      batches: chunks.map((c, n) => ({
        id: n, col: c.q.index, qLabel: c.q.label, question: questionText(c.q), texts: c.texts,
        status: 'queued', fixes: [], flags: [], error: '', stamped: 0,
      })),
    })
    setAiBatchId(null)
    setAiListOpen(true)
    setAiBusy(true)
    // eslint-disable-next-line react-hooks/purity -- เรียกตอนกดปุ่ม ไม่ใช่ตอน render
    const startedAt = Date.now()
    let done = 0
    let failed = 0
    let found = 0
    let flaggedN = 0
    let lastError = ''
    let nextIdx = 0
    const worker = async () => {
      while (nextIdx < chunks.length) {
        const id = nextIdx++
        patchBatch(id, { status: 'running' })
        const { q, texts: bTexts } = chunks[id]
        try {
          const res = await checkTexts(bTexts, questionText(q))
          found += res.fixes.length
          flaggedN += res.flags.length
          markChecked(bTexts, res, q.index)
          patchBatch(id, { status: 'done', ...res })
        } catch (err) {
          failed += bTexts.length
          lastError = err?.message || String(err)
          patchBatch(id, { status: 'error', error: lastError })
        }
        done += bTexts.length
        // เวลาที่เหลือโดยประมาณ (วินาที) จากความเร็วที่ผ่านมา
        const eta = done < texts.length ? Math.round(((Date.now() - startedAt) / done) * (texts.length - done) / 1000) : 0
        setAiRun((r) => (r ? { ...r, done, eta } : r))
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker))
      if (failed >= texts.length) {
        setAiListOpen(false)
        setAiRun(null)
        setToast({ type: 'warning', title: 'ตรวจด้วย AI ไม่สำเร็จ', message: lastError || 'AI ไม่ตอบกลับ', duration: 8000 })
      } else if (!found && !failed && !flaggedN) {
        setAiListOpen(false)
        setAiRun(null)
        setToast({ type: 'success', title: 'ตรวจแล้ว — ไม่พบจุดที่ต้องแก้', message: `ตรวจ ${texts.length} ข้อความ สะกดถูกต้องและได้ใจความดีแล้ว` })
      } else if (!found && !failed) {
        setAiListOpen(false)
        setAiRun(null)
        setStatusFilter('flag')
        setToast({ type: 'warning', title: `AI ให้คนเช็ค ${flaggedN} ข้อความ`, message: 'ตอบมั่ว/อ่านไม่ออก/ไม่ได้ใจความ — เปิดตัวกรอง "ให้คนเช็ค" ให้แล้ว', duration: 8000 })
      }
    } finally {
      setAiBusy(false)
    }
  }

  // ลองตรวจชุดที่ล้มเหลวใหม่
  const retryBatch = async (id) => {
    const b = aiRun?.batches.find((x) => x.id === id)
    if (!b) return
    patchBatch(id, { status: 'running', error: '' })
    try {
      const res = await checkTexts(b.texts, b.question)
      markChecked(b.texts, res, b.col)
      patchBatch(id, { status: 'done', ...res })
    } catch (err) {
      patchBatch(id, { status: 'error', error: err?.message || String(err) })
    }
  }

  // Stamp ผลที่ติ๊กไว้ลง Rawdata ชุดเดียวกัน (แทนทุกเซลล์ในข้อที่ตรวจ ที่ข้อความตรงกับ original) → คืนจำนวนเซลล์ที่แก้
  //   fixList = [{ col, original, fixed }] — แทนเฉพาะในคอลัมน์ของข้อที่ชุดนั้นตรวจ
  const stampFixes = (fixList) => {
    if (!fixList.length || !aiRun) return 0
    const byCol = new Map()
    for (const f of fixList) {
      if (!byCol.has(f.col)) byCol.set(f.col, new Map())
      byCol.get(f.col).set(f.original, f.fixed)
    }
    const base = draftRef.current
    const touched = []
    const rows2 = base.rows.map((r) => {
      let copy = null
      for (const [c, map] of byCol) {
        const v = String(r?.[c] ?? '').trim()
        if (map.has(v)) {
          if (!copy) copy = r.slice()
          copy[c] = map.get(v)
          touched.push(textKey(c, String(map.get(v)).trim()))
        }
      }
      return copy ?? r
    })
    if (!touched.length) return 0
    const next = { ...base, rows: rows2 }
    setDraft(next)
    draftRef.current = next
    scheduleSave(next)
    addAiMarks(setAiFixed, [...new Set(touched)])
    return touched.length
  }
  const stampBatch = (id) => {
    const b = aiRun?.batches.find((x) => x.id === id)
    if (!b) return
    const n = stampFixes(b.fixes.filter((f) => f.accepted).map((f) => ({ ...f, col: b.col })))
    patchBatch(id, { status: 'applied', stamped: n })
    setAiBatchId(null)
  }
  const stampAllDone = () => {
    const ready = (aiRun?.batches ?? []).filter((b) => b.status === 'done' && b.fixes.length)
    const n = stampFixes(ready.flatMap((b) => b.fixes.filter((f) => f.accepted).map((f) => ({ ...f, col: b.col }))))
    const ids = new Set(ready.map((b) => b.id))
    setAiRun((r) => (r ? { ...r, batches: r.batches.map((b) => (ids.has(b.id) ? { ...b, status: 'applied', stamped: -1 } : b)) } : r))
    setAiListOpen(false)
    setToast({ type: 'success', title: `Stamp ลง Rawdata แล้ว ${n} เซลล์`, message: `จาก ${ready.length} ชุด — ดูได้ที่ตัวกรอง "แก้แล้ว"` })
  }
  const toggleFix = (id, i) => patchBatch(id, (b) => ({ fixes: b.fixes.map((f, j) => (j === i ? { ...f, accepted: !f.accepted } : f)) }))
  const toggleAllFixes = (id, v) => patchBatch(id, (b) => ({ fixes: b.fixes.map((f) => ({ ...f, accepted: v })) }))

  // จำนวนเซลล์ใน Rawdata ที่แต่ละข้อความในชุดที่เปิดอยู่จะถูก Stamp
  const openBatch = aiRun?.batches.find((b) => b.id === aiBatchId) ?? null
  const batchOcc = useMemo(() => {
    const m = new Map()
    if (!openBatch || !draft) return m
    const want = new Set([...openBatch.fixes.map((f) => f.original), ...(openBatch.flags ?? []).map((f) => f.text)])
    for (const r of draft.rows) {
      const v = String(r?.[openBatch.col] ?? '').trim()
      if (want.has(v)) m.set(v, (m.get(v) ?? 0) + 1)
    }
    return m
  }, [openBatch, draft])

  if (!project) {
    return (
      <div className="px-5 py-16 text-center text-slate-400">
        ไม่พบโปรเจกต์นี้ — <Link to="/" className="text-indigo-600 underline">กลับหน้าหลัก</Link>
      </div>
    )
  }

  const newRows = newRowCount(project, 'verbatim')
  const shownChanged = shownQs.reduce((n, q) => n + (changedByQ.get(q.id) ?? 0), 0)

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* ===== Toolbar ===== */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <Link
          to={`/projects/${projectId}/verbatim`}
          title="กลับหน้าสรุปกล่อง Verbatim"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft size={15} /> {project.name} · Verbatim
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <MessageSquareText size={16} className="text-amber-500" /> Clean Verbatim
        </h1>
        {draft && (
          <span className="text-xs text-slate-400">
            {verbatimQs.length} ข้อ Verbatim · {rowsAll.length} แถว · แสดง <b className="text-indigo-600">{rows.length}</b>
          </span>
        )}
        {newRows > 0 && (
          <button
            onClick={() => { markBoxSeen(projectId, 'verbatim'); setToast({ type: 'success', title: 'ทำเครื่องหมายว่าตรวจแล้ว', message: `ล้างป้ายแถวใหม่ ${newRows} แถว` }) }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-200"
            title="ล้างป้ายแถวใหม่ของกล่อง Verbatim"
          >
            ● {newRows} แถวใหม่ · ตรวจแล้ว ✓
          </button>
        )}
        <AiProgressPill
          busy={aiBusy}
          run={aiRun}
          onOpenList={() => setAiListOpen(true)}
          onOpenBatch={(id) => setAiBatchId(id)}
          onDiscard={() => { setAiRun(null); setAiListOpen(false) }}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-slate-400">
            {saving ? (
              <><Loader2 size={13} className="animate-spin" /> กำลังบันทึก…</>
            ) : dirty ? (
              <>มีการแก้ยังไม่บันทึก</>
            ) : (
              <><CheckCircle2 size={13} className="text-emerald-500" /> บันทึกแล้ว</>
            )}
          </span>
          {dirty && (
            <Button variant="secondary" size="sm" onClick={() => persist()}>
              <Save size={13} /> บันทึกเดี๋ยวนี้
            </Button>
          )}
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหา Verbatim…"
              className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-rose-500">
                <X size={14} />
              </button>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={13} /> ตั้งค่าคอลัมน์
          </Button>
          <div className="relative">
            <Button size="sm" onClick={() => setAiMenuOpen((v) => !v)} disabled={aiBusy || !verbatimQs.length}>
              <Sparkles size={13} /> {aiBusy ? 'กำลังตรวจ…' : 'ตรวจสะกดด้วย AI'} <ChevronDown size={13} />
            </Button>
            {aiMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAiMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold text-slate-400">ให้ AI Clean ข้อไหน?</p>
                  <AiScopeOption
                    onClick={() => runSpellcheck('page')}
                    title={shownQs.length > 1 ? `เฉพาะข้อที่แสดง (${shownQs.length} ข้อ)` : 'เฉพาะข้อนี้'}
                    detail={`${shownQs.map((q) => q.label).join(', ')} · ${rows.length} แถวตามตัวกรอง`}
                  />
                  <AiScopeOption
                    onClick={() => runSpellcheck('all')}
                    title={`ทุกข้อ (${verbatimQs.length} ข้อ)`}
                    detail={`ทุกแถว ${rowsAll.length} แถว · ใช้เวลานานกว่า`}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== เลือกข้อ + ตัวกรอง ===== */}
      {verbatimQs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-2">
          <Segmented
            value={viewMode}
            onChange={switchMode}
            options={[{ value: 'single', label: 'ทีละข้อ' }, { value: 'multi', label: 'เลือกหลายข้อ' }]}
          />
          <span className="hidden text-[11px] text-slate-400 sm:inline">
            {viewMode === 'multi' ? 'ติ๊กเลือกข้อที่แถบชีทด้านล่าง' : 'เลือกข้อที่แถบชีทด้านล่าง'}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {colFilterCount > 0 && (
              <button
                type="button"
                onClick={() => { setColFilters({}); setSortBy(null) }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-rose-50 hover:text-rose-600"
                title="ล้างตัวกรอง/การเรียงบนหัวคอลัมน์ทั้งหมด"
              >
                <FilterX size={13} /> ล้างตัวกรองคอลัมน์ ({colFilterCount})
              </button>
            )}
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'ทั้งหมด' },
                { value: 'changed', label: `แก้แล้ว${shownChanged ? ` ${shownChanged}` : ''}` },
                { value: 'same', label: `ยังไม่แก้${shownPending ? ` ${shownPending}` : ''}` },
                { value: 'flag', label: `ให้คนเช็ค${shownFlag ? ` ${shownFlag}` : ''}` },
              ]}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="accent-indigo-600" />
              ซ่อนแถวว่าง
            </label>
          </div>
        </div>
      )}

      {/* ===== Table ===== */}
      <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
        {loading && !draft ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 size={18} className="animate-spin" /> กำลังโหลดข้อมูล…
          </div>
        ) : !draft || !verbatimQs.length ? (
          <div className="p-8 text-center text-sm text-slate-400">
            ยังไม่ได้เลือกข้อ Verbatim —{' '}
            <button onClick={() => setSettingsOpen(true)} className="text-indigo-600 underline">ตั้งค่าคอลัมน์</button>
          </div>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                <th className="sticky left-0 z-10 w-12 border-b border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-slate-400">#</th>
                {sbjQ && (
                  <th className="sticky left-12 z-10 border-b border-r border-slate-200 bg-slate-100 px-3 py-2 normal-case">
                    <span className="flex items-center justify-between gap-2">{sbjQ.label} {filterBtn('sbj', sbjQ.label)}</span>
                  </th>
                )}
                {refQs.map((q) => (
                  <th key={q.id} className="border-b border-r border-slate-200 bg-sky-50 px-3 py-2 normal-case text-sky-700">
                    <span className="flex items-center justify-between gap-2">
                      <span>{q.label} <span className="font-normal text-sky-400">· อ้างอิง</span></span>
                      {filterBtn(`ref|${q.id}`, `${q.label} (อ้างอิง)`)}
                    </span>
                  </th>
                ))}
                {shownQs.map((q) => (
                  <HeaderTriple
                    key={q.id}
                    q={q}
                    multi={shownQs.length > 1}
                    selected={colSel === q.id}
                    onSelect={() => { setColSel((cur) => (cur === q.id ? null : q.id)); setClipMsg('') }}
                    btn={(kind, name) => filterBtn(`${kind}|${q.id}`, `${q.label} · ${name}`)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([row, rowIdx]) => {
                const isNew = rowIdx >= seenRowCount && newRows > 0
                const orow = origRowAt(row, rowIdx)
                const bg = 'bg-white' // พื้นขาวทุกแถว (แถวใหม่บอกด้วยจุดเล็กที่เลขแถวแทน)
                return (
                  <tr key={rowIdx} className={`${bg} align-top`}>
                    <td className={`sticky left-0 z-[1] border-b border-r border-slate-100 px-2 py-2 text-center text-[11px] text-slate-400 ${bg}`}>
                      {isNew && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" title="แถวใหม่ที่ยังไม่ได้ดู" />}
                      {rowIdx + 1}
                    </td>
                    {sbjQ && (
                      <td className={`sticky left-12 z-[1] border-b border-r border-slate-100 px-3 py-2 font-mono text-xs text-slate-600 ${bg}`}>
                        {cellValue(row, sbjQ)}
                      </td>
                    )}
                    {refQs.map((q) => (
                      <td key={q.id} className="max-w-[14rem] border-b border-r border-slate-100 px-3 py-2 text-xs text-slate-500">
                        {cellValue(row, q) || <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    {shownQs.map((q) => {
                      const editable = isEditable(q)
                      const col = q.index
                      const isEdit = !!editing && editing.rowIdx === rowIdx && editing.col === col
                      const origText = cellValue(orow, q)
                      const cleanText = isEdit ? editDraft.trim() : cellValue(row, q)
                      const parts = diffTextCached(origText, cleanText)
                      const changed = origText !== cleanText
                      const isAi = changed && aiFixed.has(textKey(col, cleanText))
                      const ck = textKey(col, cleanText)
                      const okBy = changed ? null : humanOk.has(ck) ? 'human' : aiFlag.has(ck) ? 'flag' : aiOk.has(ck) || aiFixed.has(ck) ? 'ai' : null
                      return (
                        <VerbatimCells
                          key={q.id}
                          wide={shownQs.length === 1}
                          parts={parts}
                          origText={origText}
                          cleanText={cleanText}
                          changed={changed}
                          isAi={isAi}
                          okBy={okBy}
                          flagWhy={okBy === 'flag' ? aiFlag.get(ck) : ''}
                          onHumanOk={() => markHumanOk(col, cleanText)}
                          selected={colSel === q.id}
                          editable={editable}
                          isEdit={isEdit}
                          editDraft={editDraft}
                          onEditDraft={setEditDraft}
                          onStart={() => editable && !isEdit && startEdit(rowIdx, col)}
                          onCommit={commitEdit}
                          onCancel={() => setEditing(null)}
                          onRevert={() => revertCell(rowIdx, col, origText)}
                        />
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {draft && verbatimQs.length > 0 && rows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">ไม่มีแถวที่ตรงกับตัวกรอง</p>
        )}
        {original.fallback && draft && verbatimQs.length > 0 && (
          <p className="px-5 py-3 text-center text-[11px] text-slate-400">
            โปรเจกต์นี้ยังไม่มีสำเนา Rawdata ต้นฉบับ — ใช้ค่าตอนเปิดหน้านี้เป็น Original
          </p>
        )}
      </div>

      {/* ===== แถบคำสั่งตอนเลือกทั้งคอลัมน์ Clean ===== */}
      {selQ && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-900">
          <Columns2 size={15} className="text-indigo-500" />
          <span className="font-bold">เลือกคอลัมน์ Clean · {selQ.label} · {rows.length} แถว</span>
          <Button size="sm" onClick={copyColumn}><Copy size={13} /> คัดลอก (Ctrl+C)</Button>
          <Button size="sm" variant="secondary" onClick={pasteFromButton}><ClipboardPaste size={13} /> วาง (Ctrl+V)</Button>
          <span className="min-w-0 flex-1 truncate text-indigo-700">
            {clipMsg || 'คัดลอกไปแก้ใน Excel แล้ววางกลับ — ระบบเทียบกับ Original ให้: ต่าง = Human แก้ · เหมือน = Human ดูแล้ว OK'}
          </span>
          <button type="button" onClick={() => setColSel(null)} className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 font-semibold text-indigo-500 hover:bg-white hover:text-rose-600" title="ยกเลิกเลือก (Esc)">
            <X size={13} /> ยกเลิกเลือก
          </button>
        </div>
      )}

      {/* ===== แถบชีท (ข้อ Verbatim) ด้านล่าง แบบ Excel ===== */}
      {verbatimQs.length > 0 && (
        <SheetTabs
          qs={verbatimQs}
          shownIds={shownQs.map((q) => q.id)}
          changedByQ={changedByQ}
          pendingByQ={leftByQ}
          flagByQ={flagByQ}
          multi={viewMode === 'multi'}
          onPick={pickQuestion}
          onPickAll={() => setPickedIds(verbatimQs.map((q) => q.id))}
        />
      )}

      <ColumnSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        questions={questions}
        rawdata={draft}
        value={cfg}
        onSave={(patch) => updateProjectBox(projectId, 'verbatim', patch)}
      />

      <AiBatchesModal
        open={aiListOpen && aiBatchId == null && !!aiRun}
        busy={aiBusy}
        run={aiRun}
        onOpenBatch={(id) => setAiBatchId(id)}
        onStampAll={stampAllDone}
        onClose={() => setAiListOpen(false)}
      />
      <AiBatchModal
        batch={openBatch}
        occ={batchOcc}
        onToggle={(i) => toggleFix(aiBatchId, i)}
        onToggleAll={(v) => toggleAllFixes(aiBatchId, v)}
        onStamp={() => stampBatch(aiBatchId)}
        onRetry={() => retryBatch(aiBatchId)}
        onClose={() => setAiBatchId(null)}
      />

      <PasteConfirmModal plan={pastePlan} draft={pasteDraft} onApply={applyPaste} onClose={() => setPasteDraft(null)} />

      {filterMenu && (
        <ColumnFilterMenu
          key={filterMenu.key}
          menu={filterMenu}
          selected={colFilters[filterMenu.key]}
          sortDir={sortActive && sortBy.key === filterMenu.key ? sortBy.dir : 0}
          onSort={(dir) => { setSortBy(dir ? { key: filterMenu.key, dir } : null); setFilterMenu(null) }}
          onApply={(vals) => {
            setColFilters((prev) => {
              const next = { ...prev }
              if (vals) next[filterMenu.key] = vals
              else delete next[filterMenu.key]
              return next
            })
            setFilterMenu(null)
          }}
          onClose={() => setFilterMenu(null)}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

function AiScopeOption({ onClick, title, detail }) {
  return (
    <button type="button" onClick={onClick} className="block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left hover:bg-indigo-50">
      <span className="block text-sm font-bold text-slate-800">{title}</span>
      <span className="block truncate text-[11px] text-slate-500" title={detail}>{detail}</span>
    </button>
  )
}

function HeaderTriple({ q, multi, selected, onSelect, btn }) {
  const editable = isEditable(q)
  return (
    <>
      <th className="border-b border-r border-slate-200 bg-slate-100 px-3 py-1.5 text-slate-500">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {multi && <span className="truncate rounded bg-slate-700 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-white" title={q.text || q.label}>{q.label}</span>}
            Original
          </span>
          {btn('orig', 'Original')}
        </span>
      </th>
      <th className={`border-b border-r px-3 py-1.5 ${selected ? 'border-indigo-300 bg-indigo-100 text-indigo-800' : 'border-slate-200 bg-emerald-50 text-emerald-700'}`}>
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            Clean
            {editable ? (
              <button
                type="button"
                onClick={onSelect}
                title="เลือกทั้งคอลัมน์ Clean เพื่อคัดลอกไปแก้ใน Excel แล้ววางกลับ"
                className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal ${
                  selected ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-emerald-200 bg-white text-emerald-700 hover:border-indigo-300 hover:text-indigo-700'
                }`}
              >
                <Columns2 size={11} /> {selected ? 'เลือกทั้งคอลัมน์อยู่' : 'เลือกทั้งคอลัมน์'}
              </button>
            ) : (
              <span className="font-normal normal-case text-slate-400">· MA แก้ไม่ได้</span>
            )}
          </span>
          {btn('clean', 'Clean')}
        </span>
      </th>
      <th className="w-28 border-b border-r border-slate-200 bg-slate-100 px-2 py-1.5 text-slate-500">
        <span className="flex items-center justify-center gap-1">สถานะ {btn('status', 'สถานะ')}</span>
      </th>
    </>
  )
}

// สำรองเมื่อ navigator.clipboard ใช้ไม่ได้ (http / สิทธิ์ไม่พอ)
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// ยืนยันก่อนวางทั้งคอลัมน์: สรุปจำนวน + ตัวอย่างจุดที่ต่างจาก Original
function PasteConfirmModal({ plan, draft, onApply, onClose }) {
  if (!plan || !draft) return null
  const mismatch = draft.values.length !== draft.targets.length
  const diffs = plan.items.filter((x) => x.next !== x.cur)
  return (
    <Modal open onClose={onClose} title={`วางทั้งคอลัมน์ Clean — ${plan.q.label}`} wide>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">จะวาง</p>
          <p className="text-lg font-bold text-slate-800">{plan.n} แถว</p>
          <p className="text-[11px] text-slate-400">เปลี่ยนจาก Clean ปัจจุบัน {plan.changed} แถว</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[11px] text-emerald-700">ต่างจาก Original → Human แก้</p>
          <p className="text-lg font-bold text-emerald-700">{plan.humanEdit} แถว</p>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
          <p className="text-[11px] text-teal-700">เหมือน Original → Human ดูแล้ว OK</p>
          <p className="text-lg font-bold text-teal-700">{plan.sameOrig} แถว</p>
        </div>
      </div>
      {(mismatch || draft.multiCol || !draft.fromCopy) && (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {mismatch && <p>⚠ จำนวนไม่เท่ากัน: วางมา {draft.values.length} ค่า แต่ตารางมี {draft.targets.length} แถว — จะวางเฉพาะ {plan.n} แถวแรกตามลำดับที่แสดง</p>}
          {draft.multiCol && <p>⚠ ข้อมูลที่วางมีหลายคอลัมน์ — ใช้เฉพาะคอลัมน์แรก</p>}
          {!draft.fromCopy && !mismatch && <p>วางตามลำดับแถวที่แสดงอยู่ตอนนี้ (ตัวกรอง/การเรียงปัจจุบัน)</p>}
        </div>
      )}
      <p className="mb-1.5 mt-4 text-xs font-semibold text-slate-500">
        แถวที่จะเปลี่ยน ({diffs.length}){diffs.length > 50 ? ' — แสดง 50 แถวแรก' : ''}
      </p>
      <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
        {diffs.slice(0, 50).map((x) => {
          const parts = diffTextCached(x.orig, x.next)
          return (
            <div key={x.i} className="grid gap-2 rounded-lg border border-slate-200 p-2 text-xs md:grid-cols-[4rem_1fr_1fr]">
              <span className="font-mono text-[11px] text-slate-400">#{x.i + 1}{x.sbj ? ` · ${x.sbj}` : ''}</span>
              <span className="text-slate-500"><span className="mb-0.5 block text-[10px] font-bold text-rose-500">Original</span><DiffText parts={parts} side="orig" /></span>
              <span className="text-slate-800"><span className="mb-0.5 block text-[10px] font-bold text-emerald-600">ที่วาง</span>{x.next ? <DiffText parts={parts} side="clean" /> : <span className="italic text-slate-400">(ว่าง)</span>}</span>
            </div>
          )
        })}
        {!diffs.length && <p className="py-4 text-center text-xs text-slate-400">ข้อความที่วางเหมือน Clean ปัจจุบันทุกแถว — จะติดป้าย Human ดูแล้ว OK ให้แถวที่เหมือน Original</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={onApply}><ClipboardPaste size={15} /> วาง {plan.n} แถว</Button>
      </div>
    </Modal>
  )
}

// ปุ่มกรองบนหัวคอลัมน์ (เหมือนลูกศรกรองของ Excel)
function FilterButton({ active, sortDir, onClick }) {
  const Icon = sortDir === 1 ? ArrowDownAZ : sortDir === -1 ? ArrowDownZA : Filter
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? 'มีตัวกรองอยู่ — กดเพื่อแก้' : 'กรอง / เรียงคอลัมน์นี้'}
      className={`inline-grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded border normal-case transition-colors ${
        active || sortDir
          ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
          : 'border-slate-300 bg-white text-slate-400 hover:border-indigo-400 hover:text-indigo-600'
      }`}
    >
      <Icon size={11} strokeWidth={2.5} fill={active && !sortDir ? 'currentColor' : 'none'} />
    </button>
  )
}

const STATUS_ORDER = ['flag', 'pending', 'human', 'hok', 'ai', 'ok', 'locked', '']
const STATUS_TEXT = { flag: 'AI ให้คนเช็ค', pending: 'ยังไม่ตรวจ', human: 'Human แก้แล้ว', hok: 'Human ดูแล้ว OK', ai: 'AI แก้', ok: 'AI ตรวจแล้ว OK', locked: 'แก้ไม่ได้ (MA)', '': '(ว่าง)' }

// เมนูกรองแบบ Excel: เรียง ก→ฮ / ฮ→ก · ค้นหา · ติ๊กเลือกค่า (พร้อมจำนวน) · ล้างตัวกรอง
function ColumnFilterMenu({ menu, selected, sortDir, onApply, onSort, onClose }) {
  const [search, setSearch] = useState('')
  const [checked, setChecked] = useState(() => new Set(selected ?? menu.values.map((x) => x.v)))
  const label = (v) => (menu.isStatus ? STATUS_TEXT[v] ?? v : v || '(ว่าง)')
  const s = search.trim().toLowerCase()
  const visible = s ? menu.values.filter((x) => label(x.v).toLowerCase().includes(s)) : menu.values
  const LIMIT = 300
  const allVisibleChecked = visible.length > 0 && visible.every((x) => checked.has(x.v))
  const toggle = (v) => setChecked((prev) => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n })
  const toggleAllVisible = () => setChecked((prev) => {
    const n = new Set(prev)
    for (const x of visible) { if (allVisibleChecked) n.delete(x.v); else n.add(x.v) }
    return n
  })
  const apply = () => {
    // ถ้าพิมพ์ค้นหาแล้วกดตกลง = เอาเฉพาะที่ติ๊กในผลค้นหา (เหมือน Excel)
    const pool = s ? visible : menu.values
    const pick = pool.filter((x) => checked.has(x.v)).map((x) => x.v)
    onApply(pick.length === menu.values.length ? null : pick)
  }
  return (
    <>
      <div className="fixed inset-0 z-[150]" onClick={onClose} />
      <div
        className="fixed z-[151] flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs font-normal normal-case tracking-normal text-slate-700 shadow-2xl"
        style={{ top: menu.top, left: menu.left, width: menu.width }}
      >
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="truncate text-[11px] font-bold text-slate-500">{menu.title}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => onSort(sortDir === 1 ? 0 : 1)} className={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 font-semibold ${sortDir === 1 ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 hover:bg-slate-50'}`}>
              <ArrowDownAZ size={13} /> เรียง ก → ฮ
            </button>
            <button type="button" onClick={() => onSort(sortDir === -1 ? 0 : -1)} className={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 font-semibold ${sortDir === -1 ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 hover:bg-slate-50'}`}>
              <ArrowDownZA size={13} /> เรียง ฮ → ก
            </button>
          </div>
        </div>
        <div className="px-3 pt-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') onClose() }}
              placeholder="ค้นหาในคอลัมน์นี้…"
              className="w-full rounded-lg border border-slate-300 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 font-semibold hover:bg-slate-50">
            <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} className="accent-indigo-600" />
            {s ? `(เลือกผลค้นหาทั้งหมด · ${visible.length})` : `(เลือกทั้งหมด · ${menu.values.length})`}
          </label>
          {visible.slice(0, LIMIT).map((x) => (
            <label key={x.v} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
              <input type="checkbox" checked={checked.has(x.v)} onChange={() => toggle(x.v)} className="mt-0.5 shrink-0 accent-indigo-600" />
              <span className={`line-clamp-2 min-w-0 flex-1 ${x.v ? '' : 'italic text-slate-400'}`}>{label(x.v)}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{x.count}</span>
            </label>
          ))}
          {visible.length > LIMIT && (
            <p className="px-1.5 py-1 text-[11px] text-slate-400">แสดง {LIMIT} จาก {visible.length} ค่า — พิมพ์ค้นหาเพื่อหาค่าอื่น</p>
          )}
          {!visible.length && <p className="px-1.5 py-3 text-center text-slate-400">ไม่พบค่าที่ค้นหา</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
          <button type="button" onClick={() => onApply(null)} className="inline-flex cursor-pointer items-center gap-1 font-semibold text-rose-500 hover:underline">
            <FilterX size={13} /> ล้างตัวกรอง
          </button>
          <div className="flex gap-1.5">
            <Button variant="secondary" size="sm" onClick={onClose}>ยกเลิก</Button>
            <Button size="sm" onClick={apply}>ตกลง</Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ข้อความที่ไฮไลต์ส่วนต่าง: ฝั่ง Original โชว์ส่วนที่ถูกลบ (ขีดฆ่าแดง) · ฝั่ง Clean โชว์ส่วนที่เพิ่ม (เขียว)
function DiffText({ parts, side }) {
  const mark = side === 'orig' ? 'del' : 'ins'
  return parts.map((p, i) => {
    if (p.type === 'eq') return <span key={i}>{p.text}</span>
    if (p.type !== mark) return null
    return side === 'orig'
      ? <del key={i} className="rounded-sm bg-rose-100 text-rose-700 decoration-rose-500 decoration-2">{p.text}</del>
      : <ins key={i} className="rounded-sm bg-emerald-100 font-semibold text-emerald-800 no-underline">{p.text}</ins>
  })
}

function VerbatimCells({ wide, parts, origText, cleanText, changed, isAi, okBy, flagWhy, onHumanOk, selected, editable, isEdit, editDraft, onEditDraft, onStart, onCommit, onCancel, onRevert }) {
  const w = wide ? 'min-w-[22rem]' : 'min-w-[17rem] max-w-[26rem]'
  return (
    <>
      <td className={`${w} border-b border-r border-slate-100 bg-slate-50/60 px-3 py-2 leading-relaxed text-slate-500`}>
        <div className="whitespace-pre-wrap break-words">
          {origText ? <DiffText parts={parts} side="orig" /> : <span className="text-slate-300">—</span>}
        </div>
      </td>
      <td
        className={`${w} border-b border-r px-1.5 py-1.5 leading-relaxed ${isEdit ? 'bg-indigo-50/60' : selected ? 'border-indigo-200 bg-indigo-50/70' : 'border-slate-100'}`}
        onClick={onStart}
      >
        {isEdit ? (
          <div>
            <AutoTextarea value={editDraft} onChange={onEditDraft} onCommit={onCommit} onCancel={onCancel} />
            <div className="mt-1 flex items-center justify-between gap-2 px-0.5 text-[10px] text-slate-400">
              <span>Enter บันทึก · Shift+Enter ขึ้นบรรทัด · Esc ยกเลิก</span>
              <span className="flex gap-1">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel} className="cursor-pointer rounded px-1.5 py-0.5 font-semibold text-slate-500 hover:bg-slate-200">ยกเลิก</button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCommit} className="cursor-pointer rounded bg-indigo-600 px-1.5 py-0.5 font-semibold text-white hover:bg-indigo-700">บันทึก</button>
              </span>
            </div>
          </div>
        ) : (
          <div
            className={`min-h-[1.75rem] whitespace-pre-wrap break-words rounded-md px-1.5 py-0.5 text-slate-800 ${editable ? 'cursor-text hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200' : 'text-slate-400'}`}
            title={editable ? 'คลิกเพื่อแก้ไข' : 'ข้อหลายคอลัมน์ (MA) แก้ไม่ได้'}
          >
            {cleanText ? <DiffText parts={parts} side="clean" /> : <span className="text-slate-300">—</span>}
          </div>
        )}
      </td>
      <td className="w-24 border-b border-r border-slate-100 px-2 py-2 text-center">
        {!origText && !cleanText ? null : !changed && okBy === 'human' ? (
          <span className="inline-flex flex-col items-center rounded-lg bg-teal-100 px-2 py-0.5 text-[11px] font-bold leading-tight text-teal-700" title="คนดูแล้ว ข้อความเหมือนต้นฉบับ ไม่ต้องแก้">
            <span>Human ดูแล้ว</span>
            <span className="inline-flex items-center gap-0.5"><Check size={11} /> OK</span>
          </span>
        ) : !changed && okBy === 'flag' ? (
          <div className="flex flex-col items-center gap-1" data-flag="1">
            <span className="inline-flex flex-col items-center rounded-lg bg-rose-100 px-2 py-0.5 text-[11px] font-bold leading-tight text-rose-700" title={`AI: ${flagWhy || 'ไม่ได้ใจความ'} — คนช่วยอ่าน แล้วแก้ข้อความ หรือกด OK ถ้าใช้ได้`}>
              <span className="inline-flex items-center gap-0.5"><AlertTriangle size={11} /> ให้คนเช็ค</span>
              {flagWhy && <span className="max-w-[6.5rem] truncate text-[10px] font-semibold text-rose-500">{flagWhy}</span>}
            </span>
            {editable && !isEdit && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onHumanOk() }}
                title="อ่านแล้วใช้ได้ ไม่ต้องแก้ → Human ดูแล้ว OK"
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-full border border-teal-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-teal-700 hover:bg-teal-50"
              >
                <Check size={10} /> ดูแล้ว OK
              </button>
            )}
          </div>
        ) : !changed && okBy === 'ai' ? (
          <span className="inline-flex flex-col items-center rounded-lg bg-sky-100 px-2 py-0.5 text-[11px] font-bold leading-tight text-sky-700" title="AI ตรวจข้อความนี้แล้ว ไม่พบจุดที่ต้องแก้">
            <span>AI ตรวจแล้ว</span>
            <span className="inline-flex items-center gap-0.5"><Check size={11} /> OK</span>
          </span>
        ) : !changed ? (
          <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500" title="ยังไม่มีใครแก้ และ AI ยังไม่ได้ตรวจ">ยังไม่ตรวจ</span>
        ) : (
          <div className="flex flex-col items-center gap-1">
            {isAi ? (
              <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">AI แก้</span>
            ) : (
              <span className="inline-flex flex-col items-center rounded-lg bg-emerald-100 px-2 py-0.5 text-[11px] font-bold leading-tight text-emerald-700" title="คนแก้เอง">
                <span>Human</span>
                <span>แก้แล้ว</span>
              </span>
            )}
            {editable && !isEdit && (
              <button
                type="button"
                onClick={onRevert}
                title="คืนค่าเป็นข้อความต้นฉบับ"
                className="inline-flex cursor-pointer items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-rose-600"
              >
                <RotateCcw size={10} /> คืนต้นฉบับ
              </button>
            )}
          </div>
        )}
      </td>
    </>
  )
}

// textarea ที่ขยายสูงตามเนื้อหา (ไม่ต้องเลื่อนในช่องเล็ก ๆ)
function AutoTextarea({ value, onChange, onCommit, onCancel }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight + 2, 72)}px`
  }, [value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onCommit() }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
      className="block w-full resize-none overflow-hidden rounded-md border border-indigo-300 bg-white px-2 py-1.5 text-sm leading-relaxed text-slate-800 shadow-sm outline-none ring-2 ring-indigo-100"
    />
  )
}

// แถบชีทด้านล่างแบบ Excel — 1 แท็บต่อ 1 ข้อ Verbatim (โหมดหลายข้อ = ติ๊กเลือกได้หลายแท็บ)
function SheetTabs({ qs, shownIds, changedByQ, pendingByQ, flagByQ, multi, onPick, onPickAll }) {
  const scrollRef = useRef(null)
  const shown = new Set(shownIds)
  const firstShown = shownIds[0]
  // เลื่อนให้เห็นแท็บที่เลือกอยู่เสมอ (เช่น เปิดหน้ามาแล้วข้อที่เลือกอยู่ท้าย ๆ)
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-sheet="${CSS.escape(String(firstShown ?? ''))}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [firstShown])
  const scrollBy = (dx) => scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' })
  return (
    <div className="flex shrink-0 items-start gap-1 border-t border-slate-200 bg-slate-100/90 px-1.5 pb-2">
      <div className="flex shrink-0 items-center gap-0.5 pt-1.5">
        <button type="button" onClick={() => scrollBy(-240)} className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm" title="เลื่อนซ้าย">
          <ChevronDown size={15} className="rotate-90" />
        </button>
        <button type="button" onClick={() => scrollBy(240)} className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm" title="เลื่อนขวา">
          <ChevronDown size={15} className="-rotate-90" />
        </button>
      </div>
      <div ref={scrollRef} className="flex min-w-0 flex-1 items-start gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {qs.map((q) => {
          const on = shown.has(q.id)
          const n = changedByQ.get(q.id) ?? 0
          const left = pendingByQ.get(q.id) ?? 0 // ยังไม่ตรวจ + ให้คนเช็ค
          const flags = flagByQ?.get(q.id) ?? 0
          const done = left === 0
          // ค้าง = ส้ม · ครบ = เขียว · แท็บที่เปิดอยู่ = พื้นขาวยกขึ้น ต่อกับตาราง + ขอบสีตามสถานะ
          const tone = on
            ? `z-10 bg-white pt-2.5 font-bold shadow-md ring-2 ${done ? 'text-emerald-700 ring-emerald-400' : 'text-orange-700 ring-orange-400'}`
            : done
              ? 'mt-0 bg-emerald-50 pt-2 font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
              : 'mt-0 bg-orange-50 pt-2 font-semibold text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100'
          return (
            <button
              key={q.id}
              type="button"
              data-sheet={q.id}
              data-done={done ? '1' : '0'}
              onClick={() => onPick(q.id)}
              title={`${q.text && q.text !== q.label ? `${q.label} — ${q.text}` : q.label}\n${done ? 'ตรวจ/แก้ครบแล้ว' : `ค้าง ${left} ช่อง${flags ? ` (AI ให้คนเช็ค ${flags})` : ''}`}${n ? ` · แก้แล้ว ${n}` : ''}`}
              className={`relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-b-xl px-3.5 pb-2 text-xs ring-inset transition-all ${tone}`}
            >
              {multi && (
                <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-400 bg-white'}`}>
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
              )}
              {q.label}
              {done ? (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white"><Check size={10} strokeWidth={3.5} /></span>
              ) : (
                <span className="min-w-[1.25rem] rounded-full bg-orange-500 px-1.5 text-center text-[10px] font-bold leading-4 text-white">{left}</span>
              )}
              {flags > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-4 text-white" title={`AI ให้คนเช็ค ${flags} ช่อง`}>
                  <AlertTriangle size={9} strokeWidth={3} />{flags}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {multi && (
        <button type="button" onClick={onPickAll} className="mt-1.5 shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-white hover:shadow-sm">
          เลือกทุกข้อ
        </button>
      )}
    </div>
  )
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
            value === o.value ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// diff เซลล์ที่เปลี่ยน (รูปแบบเดียวกับ CodeframeEditor) → undo snapshot สำหรับ restoreRawdataUndo
function buildUndoSnapshot(before, afterRows) {
  const cells = []
  const beforeRows = before?.rows ?? []
  for (let r = 0; r < beforeRows.length; r++) {
    const b = beforeRows[r] ?? []
    const a = afterRows?.[r] ?? []
    if (a === b) continue
    const width = Math.max(b.length, a.length)
    for (let c = 0; c < width; c++) {
      const v = String(b[c] ?? '')
      const next = String(a[c] ?? '')
      if (v !== next) cells.push({ r, c, v, next, h: before?.headers?.[c] || '' })
    }
  }
  if (!cells.length) return null
  return { id: uid(), kind: 'edit_verbatim', title: `แก้ Verbatim ${cells.length} เซลล์`, createdAt: Date.now(), cells }
}

// ============================================================
// แผงผลตรวจสะกด AI: diff เดิม→ที่แก้ + ติ๊กยอมรับ
// ============================================================
function formatEta(sec) {
  if (sec == null) return ''
  if (sec < 60) return `~${Math.max(5, Math.round(sec / 5) * 5)} วินาที`
  return `~${Math.round(sec / 60)} นาที`
}

// สีของชุดตามสถานะ
function batchTone(b) {
  if (b.status === 'queued') return { bar: 'bg-slate-200', card: 'border-slate-200 bg-slate-50 text-slate-400', text: 'รอคิว' }
  if (b.status === 'running') return { bar: 'bg-violet-400 animate-pulse', card: 'border-violet-200 bg-violet-50 text-violet-600', text: 'กำลังตรวจ…' }
  if (b.status === 'error') return { bar: 'bg-rose-400', card: 'border-rose-200 bg-rose-50 text-rose-600', text: 'ตรวจไม่สำเร็จ' }
  if (b.status === 'applied') return { bar: 'bg-indigo-500', card: 'border-indigo-200 bg-indigo-50 text-indigo-600', text: 'Stamp แล้ว ✓' }
  const nf = b.flags?.length ?? 0
  if (b.fixes.length) return { bar: 'bg-emerald-500', card: 'border-emerald-300 bg-emerald-50 text-emerald-700', text: `พบ ${b.fixes.length} จุด${nf ? ` · ให้คนเช็ค ${nf}` : ''} — จิ้มดู` }
  if (nf) return { bar: 'bg-rose-400', card: 'border-rose-200 bg-rose-50 text-rose-600', text: `ให้คนเช็ค ${nf} — จิ้มดู` }
  return { bar: 'bg-emerald-200', card: 'border-slate-200 bg-white text-slate-400', text: 'ไม่มีจุดแก้' }
}

function runStats(run) {
  const bs = run?.batches ?? []
  return {
    pct: run?.total ? Math.round((run.done / run.total) * 100) : 0,
    ready: bs.filter((b) => b.status === 'done' && b.fixes.length),
    flags: bs.reduce((n, b) => n + (b.flags?.length ?? 0), 0),
    errors: bs.filter((b) => b.status === 'error').length,
    applied: bs.filter((b) => b.status === 'applied').length,
  }
}

// แถบความคืบหน้าเล็ก ๆ บน toolbar — แต่ละช่องคือ 1 ชุด จิ้มชุดที่เสร็จแล้วเพื่อดูผล/Stamp ได้เลย
function AiProgressPill({ busy, run, onOpenList, onOpenBatch, onDiscard }) {
  if (!run) return null
  const { pct, ready, errors, flags } = runStats(run)
  if (!busy && !ready.length && !errors && !flags) return null
  const fixCount = ready.reduce((n, b) => n + b.fixes.length, 0)
  return (
    <div className={`flex min-w-[15rem] max-w-full flex-col gap-1 rounded-lg border px-2.5 py-1.5 ${busy ? 'border-violet-200 bg-violet-50' : 'border-emerald-200 bg-emerald-50'}`}>
      <div className="flex items-center gap-1.5">
        <button onClick={onOpenList} className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-[11px] font-semibold ${busy ? 'text-violet-700' : 'text-emerald-700'}`}>
          {busy ? <Loader2 size={12} className="shrink-0 animate-spin" /> : <Sparkles size={12} className="shrink-0" />}
          <span className="truncate">
            {busy ? `AI ตรวจ ${run.done}/${run.total} (${pct}%)` : 'AI ตรวจเสร็จ'}
            {fixCount ? ` · รอ Stamp ${fixCount} จุด` : ''}
            {flags ? ` · ให้คนเช็ค ${flags}` : ''}
            {busy && run.eta ? ` · เหลือ ${formatEta(run.eta)}` : ''}
            {busy && !run.done ? ' · กำลังเริ่ม…' : ''}
          </span>
        </button>
        {!busy && (
          <button onClick={onDiscard} title="ปิด/ทิ้งผลตรวจที่ยังไม่ Stamp" className="cursor-pointer rounded p-0.5 text-emerald-500 hover:bg-emerald-100 hover:text-rose-500">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full">
        {run.batches.map((b) => {
          const tone = batchTone(b)
          const clickable = b.status !== 'queued'
          return (
            <button
              key={b.id}
              disabled={!clickable}
              onClick={() => onOpenBatch(b.id)}
              title={`ชุด ${b.id + 1} · ${b.texts.length} ข้อความ · ${tone.text}`}
              className={`min-w-[3px] flex-1 ${tone.bar} ${clickable ? 'cursor-pointer hover:opacity-70' : ''}`}
            />
          )
        })}
      </div>
    </div>
  )
}

// หน้าต่างรวมทุกชุด — จิ้มชุดไหนก็เปิดดูได้ทันที ไม่ต้องรอครบทุกชุด
function AiBatchesModal({ open, busy, run, onOpenBatch, onStampAll, onClose }) {
  if (!run) return null
  const { pct, ready, errors, applied, flags } = runStats(run)
  const readyFixes = ready.reduce((n, b) => n + b.fixes.filter((f) => f.accepted).length, 0)
  return (
    <Modal open={open} onClose={onClose} title="ผลตรวจด้วย AI (ตัวสะกด + ความหมาย) — แยกเป็นชุด" wide>
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span className="min-w-0 truncate">ตรวจ: <b className="text-slate-700">{run.label}</b></span>
          <span>
            {busy && <Loader2 size={12} className="mr-1 inline animate-spin text-violet-500" />}
            {run.done}/{run.total} ข้อความ ({pct}%){busy && run.eta ? ` · เหลือ ${formatEta(run.eta)}` : ''}{!busy ? ' · เสร็จแล้ว' : ''}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          จิ้มชุดที่เสร็จแล้วเพื่อดูข้อมูลเดิม ↔ ที่แก้ แล้วกด Stamp ลง Rawdata ได้ทีละชุด ระหว่างนี้ชุดอื่นตรวจต่อ (อย่าออกจากหน้านี้)
        </p>
      </div>
      <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
        {run.batches.map((b) => {
          const tone = batchTone(b)
          return (
            <button
              key={b.id}
              disabled={b.status === 'queued'}
              onClick={() => onOpenBatch(b.id)}
              className={`rounded-xl border p-2.5 text-left transition-colors ${tone.card} ${b.status === 'queued' ? '' : 'cursor-pointer hover:brightness-95'}`}
            >
              <p className="flex items-center gap-1 text-xs font-bold text-slate-700">
                {b.status === 'running' && <Loader2 size={11} className="animate-spin text-violet-500" />}
                ชุด {b.id + 1}
              </p>
              <p className="truncate text-[11px] text-slate-400">{b.qLabel ? `${b.qLabel} · ` : ''}{b.texts.length} ข้อความ</p>
              <p className="mt-1 text-[11px] font-semibold">{tone.text}</p>
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          รอ Stamp {ready.length} ชุด · Stamp แล้ว {applied} ชุด{errors ? ` · ไม่สำเร็จ ${errors} ชุด (จิ้มเพื่อลองใหม่)` : ''}
          {flags ? ` · AI ให้คนเช็ค ${flags} ข้อความ (ดูที่ตัวกรอง "ให้คนเช็ค")` : ''}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>{busy ? 'ซ่อน — ให้ AI ทำงานต่อ' : 'ปิด'}</Button>
          <Button size="sm" onClick={onStampAll} disabled={!readyFixes}>
            <Check size={13} /> Stamp ทุกชุดที่เสร็จ ({readyFixes} จุด)
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// หน้าต่างของชุดเดียว — ข้อมูลเดิม vs ที่แก้ ชัด ๆ แล้ว Stamp ลง Rawdata
function AiBatchModal({ batch, occ, onToggle, onToggleAll, onStamp, onRetry, onClose }) {
  if (!batch) return null
  const acceptedCount = batch.fixes.filter((f) => f.accepted).length
  const cells = batch.fixes.filter((f) => f.accepted).reduce((n, f) => n + (occ.get(f.original) ?? 0), 0)
  const applied = batch.status === 'applied'
  const flags = batch.flags ?? []
  // คำตอบที่ AI ชี้ว่ามั่ว/อ่านไม่ออก/ไม่ได้ใจความ — ไม่แก้ให้ ติดป้าย "ให้คนเช็ค" ในตารางแทน
  const flagList = flags.length ? (
    <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3" data-flag-list="1">
      <p className="mb-2 flex items-center gap-1 text-xs font-bold text-rose-700">
        <AlertTriangle size={13} /> AI ให้คนเช็ค {flags.length} ข้อความ — ตอบมั่ว / อ่านไม่ออก / ไม่ได้ใจความ (ติดป้ายในตารางแล้ว)
      </p>
      <div className="max-h-[22vh] space-y-1.5 overflow-y-auto pr-1">
        {flags.map((f, i) => (
          <div key={i} className="flex items-start justify-between gap-3 rounded-lg bg-white px-2.5 py-1.5 text-sm">
            <span className="min-w-0 whitespace-pre-wrap break-words text-slate-700">{f.text}</span>
            <span className="shrink-0 text-right text-[11px] text-rose-500">{f.reason}<br /><span className="text-slate-400">{occ.get(f.text) ?? 0} เซลล์</span></span>
          </div>
        ))}
      </div>
    </div>
  ) : null
  return (
    <Modal open onClose={onClose} title={`ชุด ${batch.id + 1}${batch.qLabel ? ` · ${batch.qLabel}` : ''} — ${batch.texts.length} ข้อความ`} wide>
      {batch.status === 'running' || batch.status === 'queued' ? (
        <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
          <Loader2 size={24} className="animate-spin text-violet-500" />
          <p className="text-sm">AI กำลังตรวจชุดนี้…</p>
        </div>
      ) : batch.status === 'error' ? (
        <div className="py-6 text-center">
          <p className="text-sm font-semibold text-rose-600">ตรวจชุดนี้ไม่สำเร็จ</p>
          <p className="mt-1 text-xs text-slate-400">{batch.error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>กลับ</Button>
            <Button size="sm" onClick={onRetry}><RotateCcw size={13} /> ลองชุดนี้ใหม่</Button>
          </div>
        </div>
      ) : !batch.fixes.length ? (
        <div className="py-4">
          {flagList}
          <p className={`text-center text-sm ${flagList ? 'mt-4 text-slate-500' : 'py-4 text-emerald-600'}`}>
            {flagList ? 'ไม่มีจุดสะกดผิดที่ต้อง Stamp' : 'ชุดนี้สะกดถูกต้องและได้ใจความดีแล้ว ✓'}
          </p>
          <div className="mt-4 text-center"><Button variant="secondary" size="sm" onClick={onClose}>กลับ</Button></div>
        </div>
      ) : (
        <>
          {flagList && <div className="mb-4">{flagList}</div>}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {applied
                ? `Stamp ลง Rawdata แล้ว${batch.stamped > 0 ? ` ${batch.stamped} เซลล์` : ''} ✓`
                : `AI แนะนำให้แก้ ${batch.fixes.length} ข้อความ — ติ๊กเลือกที่จะ Stamp`}
            </p>
            {!applied && (
              <div className="flex gap-3 text-xs">
                <button onClick={() => onToggleAll(true)} className="cursor-pointer font-semibold text-indigo-600 hover:underline">เลือกทั้งหมด</button>
                <button onClick={() => onToggleAll(false)} className="cursor-pointer font-semibold text-slate-400 hover:underline">ไม่เลือก</button>
              </div>
            )}
          </div>
          <div className="max-h-[58vh] space-y-2.5 overflow-y-auto pr-1">
            {batch.fixes.map((f, i) => {
              const parts = diffTextCached(f.original, f.fixed)
              const n = occ.get(f.original) ?? 0
              return (
                <button
                  key={i}
                  disabled={applied}
                  onClick={() => onToggle(i)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                    f.accepted ? 'border-emerald-300 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'
                  } ${applied ? '' : 'cursor-pointer'}`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${f.accepted ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-300'}`}>
                    {f.accepted && <Check size={13} />}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
                    <div className="rounded-lg bg-rose-50/60 p-2">
                      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-500">ข้อมูลเดิม</p>
                      <p className="text-sm leading-relaxed text-slate-700"><DiffText parts={parts} side="orig" /></p>
                    </div>
                    <div className="rounded-lg bg-emerald-50/70 p-2">
                      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600">ที่แก้</p>
                      <p className="text-sm leading-relaxed text-slate-800"><DiffText parts={parts} side="clean" /></p>
                    </div>
                    <p className="text-[11px] text-slate-400 md:col-span-2">
                      {f.reason && <span className="text-violet-500">{f.reason} · </span>}
                      {applied ? 'Stamp แล้ว' : `จะ Stamp ลง ${n} เซลล์`}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>กลับ</Button>
            {!applied && (
              <Button onClick={onStamp} disabled={!acceptedCount}>
                <Check size={15} /> Stamp ลง Rawdata ({acceptedCount} ข้อความ · {cells} เซลล์)
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
