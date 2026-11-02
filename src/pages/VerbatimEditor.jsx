/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, MessageSquareText, Settings2, Sparkles, Search, X, Check,
  CheckCircle2, Save, Loader2, ListChecks,
} from 'lucide-react'
import { useStore, useRawdata } from '../store.jsx'
import { guessSbjNum, detectTextQuestions, newRowCount } from '../lib/boxes.js'
import { aiSpellcheck } from '../lib/aiGroup.js'
import {
  Button, Modal, Field, Toast,
} from '../components/ui.jsx'

export default function VerbatimEditor() {
  const { projectId } = useParams()
  const { state, setRawdata, updateProjectBox, markBoxSeen } = useStore()
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

  // sync เมื่อ rawdata จาก store เปลี่ยน (โหลดเสร็จ / กล่องอื่นแก้)
  useEffect(() => { if (rawdata && !dirty) setDraft(rawdata) }, [rawdata, dirty])

  const [editing, setEditing] = useState(null) // { rowIdx, col }
  const [editDraft, setEditDraft] = useState('')
  const [query, setQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState(null)

  // AI ตรวจสะกด
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiProgress, setAiProgress] = useState(null) // { done, total }
  const [aiFixes, setAiFixes] = useState(null) // [{ original, fixed, reason, accepted }]

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
  const verbatimQs = (cfg?.questionIds ?? []).map((id) => byId.get(id)).filter(Boolean)
  const refQs = (cfg?.refQuestionIds ?? []).map((id) => byId.get(id)).filter(Boolean)

  // ค่าเซลล์ของข้อ (รวมหลายคอลัมน์ของ MA ด้วย ' | ')
  const cellValue = (row, q) => (q.columns ?? [q.index]).map((c) => String(row?.[c] ?? '').trim()).filter(Boolean).join(' | ')
  const isEditable = (q) => (q.columns?.length ?? 1) === 1 // แก้ได้เฉพาะข้อคอลัมน์เดียว

  // กรองแถวด้วยคำค้น (ทุกคอลัมน์ที่แสดง)
  const displayCols = [sbjQ, ...verbatimQs, ...refQs].filter(Boolean)
  const rowsAll = draft?.rows ?? []
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const idx = rowsAll.map((row, i) => [row, i])
    if (!q) return idx
    return idx.filter(([row]) => displayCols.some((dc) => cellValue(row, dc).toLowerCase().includes(q)))
  }, [rowsAll, query, cfg?.sbjNumId, cfg?.questionIds, cfg?.refQuestionIds])

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
      await setRawdata(projectId, data)
      setDirty(false)
    } catch (err) {
      setToast({ type: 'warning', title: 'บันทึกไม่สำเร็จ', message: err.message, duration: 8000 })
    } finally {
      setSaving(false)
    }
  }

  // ---------- แก้ค่าเซลล์เดียว ----------
  const commitEdit = () => {
    if (!editing) return
    const { rowIdx, col } = editing
    const newText = editDraft.trim()
    setEditing(null)
    const cur = String(draft.rows[rowIdx]?.[col] ?? '').trim()
    if (newText === cur) return
    const rows2 = draft.rows.map((r, i) => {
      if (i !== rowIdx) return r
      const copy = r.slice()
      copy[col] = newText
      return copy
    })
    const next = { ...draft, rows: rows2 }
    setDraft(next)
    scheduleSave(next)
  }

  // ---------- AI ตรวจสะกด ----------
  const runSpellcheck = async () => {
    const cols = verbatimQs.filter(isEditable)
    if (!cols.length) {
      setToast({ type: 'warning', title: 'ยังไม่มีข้อ Verbatim ให้ตรวจ', message: 'เลือกข้อ Verbatim ที่ตั้งค่า (ปุ่มตั้งค่า)' })
      return
    }
    // เก็บข้อความไม่ซ้ำจากคอลัมน์ verbatim ที่เลือก
    const uniq = new Map() // text -> true
    for (const [row] of rows) {
      for (const q of cols) {
        const v = String(row?.[q.index] ?? '').trim()
        if (v) uniq.set(v, true)
      }
    }
    const texts = [...uniq.keys()]
    if (!texts.length) {
      setToast({ type: 'info', title: 'ไม่มีข้อความให้ตรวจ', message: 'คอลัมน์ที่เลือกว่างเปล่า' })
      return
    }
    // claude CLI มี cold-start ~10-20 วิ/ครั้ง → จ่ายครั้งเดียวคุ้มสุด
    // ส่งทั้งหมดในก้อนเดียว (เช่น 323 ประโยค = 1 ครั้ง) — เกิน 400 ค่อยซอย + ยิงขนาน
    const CHUNK = 400
    const CONCURRENCY = 3
    const chunks = []
    for (let s = 0; s < texts.length; s += CHUNK) chunks.push(texts.slice(s, s + CHUNK))

    setAiOpen(true)
    setAiBusy(true)
    setAiFixes(null)
    setAiProgress({ done: 0, total: texts.length })
    const collected = []
    let done = 0
    let nextIdx = 0
    const worker = async () => {
      while (nextIdx < chunks.length) {
        const chunk = chunks[nextIdx++]
        const { fixes } = await aiSpellcheck(chunk.map((text, i) => ({ i, text })))
        for (const f of fixes) {
          const original = chunk[f.i]
          if (original && f.fixed && original !== f.fixed) {
            collected.push({ original, fixed: f.fixed, reason: f.reason, accepted: true })
          }
        }
        done += chunk.length
        setAiProgress({ done, total: texts.length })
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker))
      setAiFixes(collected)
      if (!collected.length) {
        setAiOpen(false)
        setToast({ type: 'success', title: 'ตรวจแล้ว — ไม่พบจุดที่ต้องแก้', message: `ตรวจ ${texts.length} ข้อความ สะกดถูกต้องดีแล้ว` })
      }
    } catch (err) {
      // ถ้าได้ผลบางส่วนแล้ว ให้แสดงเท่าที่ได้ ไม่ทิ้งทั้งหมด
      if (collected.length) {
        setAiFixes(collected)
        setToast({ type: 'warning', title: 'ตรวจได้บางส่วน', message: `${err.message} — แสดงผลเท่าที่ตรวจเสร็จ ${collected.length} รายการ`, duration: 8000 })
      } else {
        setAiOpen(false)
        setToast({ type: 'warning', title: 'ตรวจด้วย AI ไม่สำเร็จ', message: err.message, duration: 8000 })
      }
    } finally {
      setAiBusy(false)
      setAiProgress(null)
    }
  }

  // นำผลที่ติ๊กไว้ไปแทนทุกเซลล์ (ในคอลัมน์ verbatim) ที่ข้อความตรงกับ original
  const applyFixes = () => {
    const accepted = (aiFixes ?? []).filter((f) => f.accepted)
    if (!accepted.length) { setAiOpen(false); return }
    const map = new Map(accepted.map((f) => [f.original, f.fixed]))
    const cols = verbatimQs.filter(isEditable).map((q) => q.index)
    let changed = 0
    const rows2 = draft.rows.map((r) => {
      let copy = null
      for (const c of cols) {
        const v = String(r?.[c] ?? '').trim()
        if (map.has(v)) {
          if (!copy) copy = r.slice()
          copy[c] = map.get(v)
          changed += 1
        }
      }
      return copy ?? r
    })
    const next = { ...draft, rows: rows2 }
    setDraft(next)
    scheduleSave(next)
    setAiOpen(false)
    setToast({ type: 'success', title: `แก้ตามผล AI แล้ว ${changed} จุด`, message: `จาก ${accepted.length} ข้อความ — ซิงค์เข้าทุกกล่องให้อัตโนมัติ` })
  }

  if (!project) {
    return (
      <div className="px-5 py-16 text-center text-slate-400">
        ไม่พบโปรเจกต์นี้ — <Link to="/" className="text-indigo-600 underline">กลับหน้าหลัก</Link>
      </div>
    )
  }

  const newRows = newRowCount(project, 'verbatim')

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ===== Toolbar ===== */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <Link
          to={`/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft size={15} /> {project.name}
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <MessageSquareText size={16} className="text-amber-500" /> Verbatim
        </h1>
        {draft && (
          <span className="text-xs text-slate-400">
            {verbatimQs.length} ข้อ Verbatim · {rowsAll.length} แถว
            {query && <> · กรองเหลือ <b className="text-indigo-600">{rows.length}</b></>}
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

        <div className="ml-auto flex items-center gap-2">
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
          <Button size="sm" onClick={runSpellcheck} disabled={aiBusy || !verbatimQs.length}>
            <Sparkles size={13} /> {aiBusy ? 'กำลังตรวจ…' : 'ตรวจสะกดด้วย AI'}
          </Button>
        </div>
      </div>

      {/* ===== Table ===== */}
      <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
        {loading && !draft ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 size={18} className="animate-spin" /> กำลังโหลดข้อมูล…
          </div>
        ) : !draft || !displayCols.length ? (
          <div className="p-8 text-center text-sm text-slate-400">
            ยังไม่ได้ตั้งค่าคอลัมน์ Verbatim —{' '}
            <button onClick={() => setSettingsOpen(true)} className="text-indigo-600 underline">ตั้งค่าคอลัมน์</button>
          </div>
        ) : (
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100 text-left text-xs font-bold text-slate-600">
                <th className="w-12 border-b border-r border-slate-200 px-2 py-2 text-center text-slate-400">#</th>
                {sbjQ && <th className="border-b border-r border-slate-200 px-3 py-2">{sbjQ.label}</th>}
                {verbatimQs.map((q) => (
                  <th key={q.id} className="min-w-[16rem] border-b border-r border-slate-200 bg-amber-50 px-3 py-2 text-amber-800">
                    {q.label} <span className="font-normal text-amber-400">· แก้ได้</span>
                  </th>
                ))}
                {refQs.map((q) => (
                  <th key={q.id} className="border-b border-r border-slate-200 bg-sky-50 px-3 py-2 text-sky-700">
                    {q.label} <span className="font-normal text-sky-400">· อ้างอิง</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([row, rowIdx]) => {
                const isNew = rowIdx >= seenRowCount && newRows > 0
                return (
                  <tr key={rowIdx} className={isNew ? 'bg-amber-50/40' : rowIdx % 2 ? 'bg-white' : 'bg-slate-50/30'}>
                    <td className="border-b border-r border-slate-100 px-2 py-1.5 text-center text-[11px] text-slate-400">
                      {rowIdx + 1}
                    </td>
                    {sbjQ && (
                      <td className="border-b border-r border-slate-100 px-3 py-1.5 font-mono text-xs text-slate-600">
                        {cellValue(row, sbjQ)}
                      </td>
                    )}
                    {verbatimQs.map((q) => {
                      const editable = isEditable(q)
                      const col = q.index
                      const isEdit = editing && editing.rowIdx === rowIdx && editing.col === col
                      const val = cellValue(row, q)
                      return (
                        <td
                          key={q.id}
                          className="border-b border-r border-slate-100 px-1 py-1 align-top"
                          onClick={() => {
                            if (!editable || isEdit) return
                            setEditing({ rowIdx, col })
                            setEditDraft(String(row?.[col] ?? ''))
                          }}
                        >
                          {isEdit ? (
                            <textarea
                              autoFocus
                              rows={2}
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit() }
                                if (e.key === 'Escape') setEditing(null)
                              }}
                              className="w-full resize-y rounded border border-indigo-300 bg-white px-2 py-1 text-sm text-slate-800 outline-none ring-2 ring-indigo-100"
                            />
                          ) : (
                            <div
                              className={`min-h-[1.75rem] rounded px-2 py-1 text-slate-700 ${editable ? 'cursor-text hover:bg-indigo-50' : 'text-slate-400'}`}
                              title={editable ? 'คลิกเพื่อแก้ไข' : 'ข้อหลายคอลัมน์ (MA) แก้ไม่ได้'}
                            >
                              {val || <span className="text-slate-300">—</span>}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    {refQs.map((q) => (
                      <td key={q.id} className="border-b border-r border-slate-100 px-3 py-1.5 text-xs text-slate-500">
                        {cellValue(row, q) || <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ColumnSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        questions={questions}
        rawdata={draft}
        value={cfg}
        onSave={(patch) => updateProjectBox(projectId, 'verbatim', patch)}
      />

      <SpellcheckModal
        open={aiOpen}
        busy={aiBusy}
        progress={aiProgress}
        fixes={aiFixes}
        onToggle={(i) => setAiFixes((f) => f.map((x, j) => (j === i ? { ...x, accepted: !x.accepted } : x)))}
        onToggleAll={(v) => setAiFixes((f) => f.map((x) => ({ ...x, accepted: v })))}
        onApply={applyFixes}
        onClose={() => setAiOpen(false)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

// ============================================================
// ตั้งค่าคอลัมน์: SbjNum / ข้อ Verbatim (แก้ได้) / คอลัมน์อ้างอิง CE
// ============================================================
function ColumnSettings({ open, onClose, questions, rawdata, value, onSave }) {
  const [sbjNumId, setSbjNumId] = useState(value?.sbjNumId ?? null)
  const [verbatimIds, setVerbatimIds] = useState(value?.questionIds ?? [])
  const [refIds, setRefIds] = useState(value?.refQuestionIds ?? [])

  useEffect(() => {
    if (open) {
      setSbjNumId(value?.sbjNumId ?? null)
      setVerbatimIds(value?.questionIds ?? [])
      setRefIds(value?.refQuestionIds ?? [])
    }
  }, [open, value])

  const toggle = (list, setList, id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const autoText = () => setVerbatimIds(detectTextQuestions(rawdata))

  return (
    <Modal open={open} onClose={onClose} title="ตั้งค่าคอลัมน์ Verbatim" wide>
      <Field label="ข้อที่ใช้เป็น SbjNum (รหัสผู้ตอบ)">
        <select
          value={sbjNumId ?? ''}
          onChange={(e) => setSbjNumId(e.target.value || null)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
        >
          <option value="">— ไม่ระบุ —</option>
          {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
        </select>
      </Field>

      <Field label={`ข้อ Verbatim ที่จะแก้ไขได้ (เลือกแล้ว ${verbatimIds.length})`} hint="ค่าที่แก้จะเขียนลงดาต้าจริงและซิงค์ทุกกล่อง">
        <div className="mb-2">
          <Button variant="soft" size="sm" onClick={autoText} disabled={!rawdata}>
            <ListChecks size={14} /> เลือกข้อ text อัตโนมัติ
          </Button>
        </div>
        <QGrid questions={questions} selected={verbatimIds} onPick={(id) => toggle(verbatimIds, setVerbatimIds, id)} />
      </Field>

      <Field label={`คอลัมน์ CE มาดูประกอบ (อ้างอิง อ่านอย่างเดียว — เลือกแล้ว ${refIds.length})`}>
        <QGrid questions={questions} selected={refIds} onPick={(id) => toggle(refIds, setRefIds, id)} exclude={verbatimIds} />
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={() => { onSave({ sbjNumId, questionIds: verbatimIds, refQuestionIds: refIds }); onClose() }}>
          บันทึกการตั้งค่า
        </Button>
      </div>
    </Modal>
  )
}

// ตารางปุ่มเลือกข้อ (ใช้ซ้ำใน ColumnSettings)
function QGrid({ questions, selected, onPick, exclude = [] }) {
  return (
    <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2 sm:grid-cols-3">
      {questions.filter((q) => !exclude.includes(q.id)).map((q) => {
        const checked = selected.includes(q.id)
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onPick(q.id)}
            className={`truncate rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
              checked ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
            }`}
            title={q.label}
          >
            {q.label}{q.type === 'MA' ? ' · MA' : ''}
          </button>
        )
      })}
    </div>
  )
}

// ============================================================
// แผงผลตรวจสะกด AI: diff เดิม→ที่แก้ + ติ๊กยอมรับ
// ============================================================
function SpellcheckModal({ open, busy, progress, fixes, onToggle, onToggleAll, onApply, onClose }) {
  const acceptedCount = (fixes ?? []).filter((f) => f.accepted).length
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <Modal open={open} onClose={onClose} title="ผลตรวจตัวสะกด / รูปประโยค (AI)" wide>
      {busy ? (
        <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
          <Loader2 size={28} className="animate-spin text-violet-500" />
          <p className="text-sm">Claude กำลังตรวจตัวสะกด… (ไม่เปลี่ยนความหมาย)</p>
          {progress && (
            progress.done > 0 ? (
              <div className="w-64">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-center text-xs text-slate-400">
                  ตรวจแล้ว {progress.done}/{progress.total} ข้อความ ({pct}%)
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                ส่ง {progress.total} ประโยคในครั้งเดียว (sonnet ตรวจละเอียด) — รอประมาณ 1 นาที
              </p>
            )
          )}
        </div>
      ) : !fixes ? (
        <p className="py-8 text-center text-sm text-slate-400">—</p>
      ) : fixes.length === 0 ? (
        <p className="py-8 text-center text-sm text-emerald-600">ไม่พบจุดที่ต้องแก้ — สะกดถูกต้องดีแล้ว ✓</p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-slate-500">พบ {fixes.length} ข้อความที่ AI แนะนำให้แก้ — ติ๊กเลือกที่จะนำไปใช้</p>
            <div className="flex gap-2 text-xs">
              <button onClick={() => onToggleAll(true)} className="cursor-pointer font-semibold text-indigo-600 hover:underline">เลือกทั้งหมด</button>
              <button onClick={() => onToggleAll(false)} className="cursor-pointer font-semibold text-slate-400 hover:underline">ไม่เลือก</button>
            </div>
          </div>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {fixes.map((f, i) => (
              <button
                key={i}
                onClick={() => onToggle(i)}
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                  f.accepted ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${f.accepted ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-300'}`}>
                  {f.accepted && <Check size={13} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-400 line-through">{f.original}</p>
                  <p className="text-sm font-semibold text-slate-800">{f.fixed}</p>
                  {f.reason && <p className="mt-0.5 text-[11px] text-violet-500">{f.reason}</p>}
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
            <Button onClick={onApply} disabled={!acceptedCount}>
              <Check size={15} /> นำไปใช้ {acceptedCount} รายการ
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
