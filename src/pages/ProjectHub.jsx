import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Upload, CheckCircle2, Table2, RefreshCcw, Plus,
  Layers, ListTree, MessageSquareText, ChevronRight, FolderPlus,
  Clock3, StickyNote, Pencil, Trash2, X, Save, PlusCircle, Activity,
} from 'lucide-react'
import { Database, Lock } from 'lucide-react'
import { uid, useStore } from '../store.jsx'
import { parseRawdataFile } from '../lib/excel.js'
import { uniqueAnswers } from '../lib/answers.js'
import { parseSavCodebook, remapCodebookByPosition } from '../lib/spss.js'
import { BOX_META, newRowCount } from '../lib/boxes.js'
import { Button, Badge, NewRowsBadge, Toast } from '../components/ui.jsx'

// คลาสสีแบบ static (Tailwind ต้องเห็น string เต็ม — interpolate ไม่ได้)
const BOX_CLS = {
  ce: { num: 'bg-sky-100 text-sky-600', icon: 'bg-sky-50 text-sky-500' },
  oe: { num: 'bg-violet-100 text-violet-600', icon: 'bg-violet-50 text-violet-500' },
  verbatim: { num: 'bg-amber-100 text-amber-600', icon: 'bg-amber-50 text-amber-500' },
}

const KEY_HEADER_CANDIDATES = [
  'sbjnum', 'subjnum', 'sbjno', 'subjno', 'sbj', 'subjectid', 'subject_id',
  'respondentid', 'respondent_id', 'responseid', 'response_id', 'recordid',
  'record_id', 'sampleid', 'sample_id', 'userid', 'user_id', 'id', 'key',
]

const normalizeHeader = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const rowSignature = (row) => row.map((v) => String(v ?? '').trim()).join('\u001f')

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

function summarizeStatus(rawdata) {
  const headers = rawdata?.headers ?? []
  const statusIndex = headers.findIndex((h) => normalizeHeader(h) === 'status')
  if (statusIndex < 0) return { found: false, label: '', total: rawdata?.rows?.length ?? 0, items: [] }
  const counts = new Map()
  for (const row of rawdata.rows ?? []) {
    const text = String(row[statusIndex] ?? '').trim() || '(ว่าง)'
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  const items = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'))
  return { found: true, label: headers[statusIndex], total: rawdata.rows?.length ?? 0, items }
}

export default function ProjectHub() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { state, setRawdata, appendRawdata, loadRawdata, updateCodeframe, setCodebook, updateProject } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const raw = project?.rawMeta
  const codeframes = state.codeframes.filter((c) => c.projectId === projectId)

  const fileRef = useRef(null)
  const appendRef = useRef(null)
  const savRef = useRef(null)
  const [busy, setBusy] = useState('') // '' | 'upload' | 'append' | 'sav'
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [wiggle, setWiggle] = useState(null) // key ของกล่อง Coming Soon ที่กำลังเล่น animation
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [statusSummary, setStatusSummary] = useState({ loading: false, found: false, label: '', total: 0, items: [] })
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

  // คลิกกล่อง "Coming Soon" → เล่น animation สั่น + เด้ง (ยังเข้าไม่ได้)
  const pokeComingSoon = (key, label) => {
    clearTimeout(wiggleTimer.current)
    setWiggle(key)
    wiggleTimer.current = setTimeout(() => setWiggle(null), 600)
    setToast({ type: 'info', title: `${label} · เร็วๆ นี้`, message: 'ฟีเจอร์นี้กำลังพัฒนา จะเปิดให้ใช้เร็วๆ นี้ 🚧', duration: 2500 })
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

  const boxCards = [
    {
      key: 'ce',
      icon: Layers,
      to: `/projects/${projectId}/ce`,
      count: codeframes.filter((c) => c.box === 'ce').length,
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
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Job health</h2>
                <p className="text-xs text-slate-400">สถานะหลักของงานนี้ก่อนเริ่ม coding/review/export</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => navigate(`/projects/${projectId}/rawdata`)} disabled={!raw}>
                <Table2 size={14} /> เปิด Rawdata
              </Button>
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

      {/* ===== กล่อง 1: Rawdata (ศูนย์กลางข้อมูล) ===== */}
      <section className="mb-3">
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
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-4 shadow-sm">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="min-w-0">
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
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {raw.questions.slice(0, 9).map((q) => (
                        <Badge key={q.id} color={q.type === 'MA' ? 'violet' : 'slate'}>
                          {q.label}{q.type === 'MA' ? ` · MA×${q.columns.length}` : ''}
                        </Badge>
                      ))}
                      {raw.questions.length > 9 && <Badge color="slate">+{raw.questions.length - 9}</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="soft" size="sm" onClick={() => navigate(`/projects/${projectId}/rawdata`)}>
                    <Table2 size={14} /> ดูตัวอย่างข้อมูล
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => appendRef.current?.click()} disabled={!!busy}>
                    <FolderPlus size={14} /> {busy === 'append' ? 'กำลังเพิ่ม…' : 'เพิ่มก้อนข้อมูล'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                    <RefreshCcw size={14} /> {busy === 'upload' ? 'กำลังอัปโหลด…' : 'เปลี่ยนไฟล์ทั้งก้อน'}
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-100 bg-white/85 p-3 shadow-sm ring-1 ring-white">
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
                  <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-400">
                    ยังไม่พบคอลัมน์ชื่อ <b>Status</b> ในไฟล์ Excel นี้
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

        {/* Codebook (SPSS .sav) — Value+Label สำหรับงาน CE */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
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

      {!raw && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
          <Plus size={13} /> อัปโหลด Rawdata ที่กล่องศูนย์กลางก่อน จึงจะเปิดกล่อง CE / OE / Verbatim ได้
        </p>
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

      <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
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

function WorkBoxCard({ b, index, project, raw, wiggle, onComingSoon }) {
  const meta = BOX_META[b.key]
  const cls = BOX_CLS[b.key]
  const Icon = b.icon
  const newRows = newRowCount(project, b.key)
  const comingSoon = !!b.comingSoon
  const disabled = !raw || comingSoon
  const card = (
    <div
      className={`group relative flex min-h-56 flex-col overflow-hidden rounded-2xl border bg-white p-5 text-left shadow-sm transition-all ${
        comingSoon
          ? `cursor-pointer border-slate-200 hover:opacity-100 hover:shadow-md ${wiggle === b.key ? 'cs-wiggle' : ''}`
          : disabled
            ? 'cursor-not-allowed border-slate-200 opacity-60'
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
            <MessageSquareText size={15} className={b.picked ? 'text-amber-500' : 'text-slate-300'} />
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
        <ChevronRight size={16} className="ml-auto text-slate-300 group-hover:text-indigo-400" />
      </div>
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
