/* eslint-disable react-hooks/exhaustive-deps */
// หน้าสรุปกล่อง Verbatim — ธีมเดียวกับกล่อง CE (BoxPage): ภาพรวมความคืบหน้า + การ์ดรายข้อ ก่อนเข้าหน้าแก้
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, MessageSquareText, Table2, Settings2, Sparkles, Loader2, MoreHorizontal, Check,
} from 'lucide-react'
import { useStore, useRawdata } from '../store.jsx'
import { guessSbjNum, detectTextQuestions, newRowCount } from '../lib/boxes.js'
import { computeVerbatimStats, makeOrigRowAt, verbatimQuestions } from '../lib/verbatim.js'
import { Button, EmptyState, BoxBadge, Badge, NewRowsBadge, Toast } from '../components/ui.jsx'
import ColumnSettings from '../components/VerbatimColumnSettings.jsx'

const SEGMENTS = [
  { key: 'human', label: 'Human แก้แล้ว', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'hok', label: 'Human ดูแล้ว OK', bar: 'bg-teal-400', dot: 'bg-teal-400' },
  { key: 'ai', label: 'AI แก้', bar: 'bg-violet-500', dot: 'bg-violet-500' },
  { key: 'ok', label: 'AI ตรวจแล้ว OK', bar: 'bg-sky-400', dot: 'bg-sky-400' },
  { key: 'flag', label: 'AI ให้คนเช็ค', bar: 'bg-rose-400', dot: 'bg-rose-400' },
  { key: 'pending', label: 'ยังไม่ตรวจ', bar: 'bg-orange-300', dot: 'bg-orange-400' },
]
const fmt = (n) => n.toLocaleString('th-TH')

export default function VerbatimHub() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { state, updateProjectBox, loadOriginalRawdata } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const { rawdata, loading } = useRawdata(projectId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState(null)

  const cfg = project?.boxes?.verbatim
  const raw = project?.rawMeta
  const newRows = project ? newRowCount(project, 'verbatim') : 0
  const editUrl = `/projects/${projectId}/verbatim/edit`

  // ตั้งค่าเริ่มต้น (เดา SbjNum + ข้อ text) ครั้งแรกถ้ายังไม่เคยตั้ง — เหมือนหน้าแก้
  useEffect(() => {
    if (!rawdata || !project || !cfg) return
    if (cfg.sbjNumId == null && !(cfg.questionIds ?? []).length) {
      updateProjectBox(projectId, 'verbatim', { sbjNumId: guessSbjNum(rawdata), questionIds: detectTextQuestions(rawdata) })
    }
  }, [rawdata, project?.id])

  // Rawdata ต้นฉบับ — ไว้แยกเซลล์ที่ "แก้แล้ว" (ไม่มีต้นฉบับ = ยังไม่มีเซลล์ที่แก้)
  const [orig, setOrig] = useState({ projectId: null, data: null })
  const originalChunkCount = raw?.originalChunkCount ?? 0
  useEffect(() => {
    if (!(originalChunkCount > 0)) return undefined
    let cancelled = false
    loadOriginalRawdata(projectId)
      .then((d) => { if (!cancelled) setOrig({ projectId, data: d ?? null }) })
      .catch((err) => console.error('load original rawdata for Verbatim summary failed', err))
    return () => { cancelled = true }
  }, [projectId, originalChunkCount])
  const origData = orig.projectId === projectId ? orig.data : null
  const origLoading = originalChunkCount > 0 && orig.projectId !== projectId

  const questions = rawdata?.questions ?? []
  const qs = useMemo(() => verbatimQuestions(cfg, questions), [cfg?.questionIds, cfg?.sbjNumId, questions])
  const sbjQ = cfg?.sbjNumId ? questions.find((q) => q.id === cfg.sbjNumId) : null
  const stats = useMemo(() => {
    if (!rawdata) return new Map()
    return computeVerbatimStats({
      rows: rawdata.rows ?? [],
      qs,
      origRowAt: makeOrigRowAt(origData, sbjQ),
      aiOk: new Set(cfg?.aiOk ?? []),
      aiFixed: new Set(cfg?.aiFixed ?? []),
      humanOk: new Set(cfg?.humanOk ?? []),
      aiFlag: new Map(Object.entries(cfg?.aiFlag ?? {})),
    })
  }, [rawdata, qs, origData, sbjQ?.id, cfg?.aiOk, cfg?.aiFixed, cfg?.humanOk, cfg?.aiFlag])

  const total = useMemo(() => {
    const t = { answered: 0, human: 0, ai: 0, hok: 0, ok: 0, flag: 0, pending: 0, locked: 0, doneQs: 0 }
    for (const s of stats.values()) {
      for (const k of ['answered', 'human', 'ai', 'hok', 'ok', 'flag', 'pending', 'locked']) t[k] += s[k]
      if (s.done) t.doneQs++
    }
    return t
  }, [stats])
  const reviewed = total.human + total.ai + total.hok + total.ok
  const reviewable = reviewed + total.pending + total.flag
  const left = total.pending + total.flag
  const pct = reviewable ? Math.round((reviewed / reviewable) * 100) : 0
  const nextPending = qs.find((q) => !stats.get(q.id)?.done)

  if (!project) {
    return (
      <div className="px-5 py-16 text-center text-slate-400">
        ไม่พบโปรเจกต์นี้ — <Link to="/" className="text-indigo-600 underline">กลับหน้าหลัก</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <Link
        to={`/projects/${projectId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft size={15} /> {project.name}
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <BoxBadge box="verbatim" />
        <h1 className="text-2xl font-bold text-slate-900">
          กล่อง Verbatim <span className="text-base font-normal text-slate-400">— Clean Verbatim + ตรวจสะกดด้วย AI</span>
        </h1>
        <NewRowsBadge count={newRows} />
      </div>

      {!raw ? (
        <EmptyState
          icon={MessageSquareText}
          title="ยังไม่มี Rawdata"
          subtitle="กลับไปอัปโหลด Rawdata ที่กล่องศูนย์กลางก่อน จึงจะทำงานกล่องนี้ได้"
          action={<Button onClick={() => navigate(`/projects/${projectId}`)}>กลับหน้าโปรเจกต์</Button>}
        />
      ) : (
        <>
          {/* ปุ่มลัด: Clean Verbatim | ดูตัวอย่างข้อมูล | ตั้งค่าคอลัมน์ */}
          <div className="mb-5 flex w-full flex-wrap items-center gap-2 text-xs font-semibold">
            <Link
              to={editUrl}
              className="group inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-300 bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-2 font-black text-white shadow-sm shadow-amber-200 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <MessageSquareText size={14} /> Clean Verbatim ({qs.length} ข้อ)
              <ChevronRight size={13} className="ce-cta-float" />
            </Link>
            <Link
              to={`/projects/${projectId}/rawdata`}
              className="group inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-100 bg-white px-3 py-2 font-black text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-md"
            >
              <Table2 size={14} /> ดูตัวอย่างข้อมูล
              <ChevronRight size={13} className="ce-cta-float" />
            </Link>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="group inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-violet-100 bg-white px-3 py-2 font-black text-violet-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50 hover:shadow-md"
            >
              <Settings2 size={14} /> ตั้งค่าคอลัมน์
              <ChevronRight size={13} className="ce-cta-float" />
            </button>
          </div>

          {(loading && !rawdata) || origLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-12 text-sm text-slate-400 shadow-sm">
              <Loader2 size={18} className="animate-spin" /> กำลังโหลดข้อมูล…
            </div>
          ) : !qs.length ? (
            <EmptyState
              icon={MessageSquareText}
              title="ยังไม่ได้เลือกข้อ Verbatim"
              subtitle="เลือกคอลัมน์ข้อความที่จะ Clean ก่อน แล้วจะเห็นความคืบหน้ารายข้อที่นี่"
              action={<Button onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> ตั้งค่าคอลัมน์</Button>}
            />
          ) : (
            <>
              {/* ===== ภาพรวมความคืบหน้า ===== */}
              <div className="mb-5 overflow-hidden rounded-2xl border border-amber-100 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
                    <Sparkles size={17} />
                  </span>
                  <div className="min-w-[14rem] flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-500">Progress</p>
                      {left ? <Badge color="amber">เหลือ {fmt(left)} ช่อง</Badge> : <Badge color="emerald">ครบทุกข้อ ✓</Badge>}
                      {total.flag > 0 && <Badge color="rose">AI ให้คนเช็ค {fmt(total.flag)}</Badge>}
                      <Badge color="emerald">ครบ {total.doneQs}/{qs.length} ข้อ</Badge>
                      <Badge color="slate">{fmt(rawdata?.rows?.length ?? 0)} แถว</Badge>
                    </div>
                    <p className="mt-0.5 text-sm font-bold text-slate-800">
                      ตรวจ/แก้แล้ว {pct}% — {fmt(reviewed)} จาก {fmt(reviewable)} ช่องที่มีข้อความ
                    </p>
                  </div>
                  {nextPending ? (
                    <Button size="sm" onClick={() => navigate(`${editUrl}?q=${encodeURIComponent(nextPending.id)}`)}>
                      ไปข้อที่ยังค้าง: {nextPending.label} <ChevronRight size={14} />
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => navigate(editUrl)}>
                      เปิด Clean Verbatim <ChevronRight size={14} />
                    </Button>
                  )}
                </div>
                <div className="border-t border-amber-50 bg-gradient-to-br from-amber-50/50 via-white to-orange-50/40 px-4 py-3">
                  <StackBar s={total} className="h-3" />
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                    {SEGMENTS.map((seg) => (
                      <span key={seg.key} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <span className={`h-2.5 w-2.5 rounded-full ${seg.dot}`} />
                        {seg.label} <b className="text-slate-700">{fmt(total[seg.key])}</b>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* ===== รายข้อ ===== */}
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
                  <MessageSquareText size={16} /> ข้อ Verbatim ({qs.length})
                </h2>
                <div className="relative">
                  <Button size="sm" variant="secondary" onClick={() => setMenuOpen((v) => !v)}>
                    <MoreHorizontal size={14} /> เมนู
                  </Button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                      <div className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                        <button onClick={() => { setMenuOpen(false); setSettingsOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                          <Settings2 size={14} /> ตั้งค่าคอลัมน์
                        </button>
                        <button onClick={() => navigate(editUrl)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                          <MessageSquareText size={14} /> เปิด Clean Verbatim
                        </button>
                        <button onClick={() => navigate(`/projects/${projectId}/rawdata`)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                          <Table2 size={14} /> ดูตัวอย่างข้อมูล
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {qs.map((q) => {
                  const s = stats.get(q.id) ?? { answered: 0, human: 0, ai: 0, hok: 0, ok: 0, flag: 0, pending: 0, locked: 0, done: true }
                  return (
                    <Link
                      key={q.id}
                      to={`${editUrl}?q=${encodeURIComponent(q.id)}`}
                      data-vq={q.id}
                      data-done={s.done ? '1' : '0'}
                      className={`group relative block overflow-hidden rounded-2xl border bg-white p-4 pl-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                        s.done ? 'border-emerald-200 hover:border-emerald-300' : 'border-orange-200 hover:border-orange-300'
                      }`}
                    >
                      <span className={`absolute inset-y-0 left-0 w-1.5 ${s.done ? 'bg-emerald-400' : 'bg-orange-400'}`} />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-bold text-slate-900 group-hover:text-indigo-700">{q.label}</h3>
                          {q.text && q.text !== q.label && <p className="truncate text-xs text-slate-400">{q.text}</p>}
                        </div>
                        {s.done ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                            <Check size={12} strokeWidth={3} /> ครบแล้ว
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-bold text-white">
                            เหลือ {fmt(s.pending + s.flag)}
                          </span>
                        )}
                      </div>
                      <StackBar s={s} className="mt-3 h-2" />
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <Badge color="slate">ตอบ {fmt(s.answered)}</Badge>
                        {s.human > 0 && <Badge color="emerald">Human {fmt(s.human)}</Badge>}
                        {s.hok > 0 && <Badge color="sky">Human OK {fmt(s.hok)}</Badge>}
                        {s.ai > 0 && <Badge color="violet">AI แก้ {fmt(s.ai)}</Badge>}
                        {s.ok > 0 && <Badge color="sky">AI OK {fmt(s.ok)}</Badge>}
                        {s.flag > 0 && <Badge color="rose">ให้คนเช็ค {fmt(s.flag)}</Badge>}
                        {s.locked > 0 && <Badge color="slate">แก้ไม่ได้ (หลายคอลัมน์)</Badge>}
                        <ChevronRight size={16} className="ml-auto text-slate-300 group-hover:text-indigo-400" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ตั้งค่าคอลัมน์ — เปิดในหน้านี้ บันทึกแล้วอยู่หน้าสรุปต่อ */}
      <ColumnSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        questions={questions}
        rawdata={rawdata}
        value={cfg}
        onSave={(patch) => {
          updateProjectBox(projectId, 'verbatim', patch)
          setToast({ type: 'success', title: 'บันทึกการตั้งค่าคอลัมน์แล้ว', message: `ข้อ Verbatim ${(patch.questionIds ?? []).filter((id) => id !== patch.sbjNumId).length} ข้อ` })
        }}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

// แถบสัดส่วน Human / AI แก้ / AI OK / ยังไม่ตรวจ
function StackBar({ s, className = '' }) {
  const sum = s.human + s.hok + s.ai + s.ok + (s.flag ?? 0) + s.pending
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      {sum > 0 && SEGMENTS.map((seg) => (s[seg.key] > 0 ? (
        <div key={seg.key} className={seg.bar} style={{ width: `${(s[seg.key] / sum) * 100}%` }} title={`${seg.label} ${s[seg.key]}`} />
      ) : null))}
    </div>
  )
}
