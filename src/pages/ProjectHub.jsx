import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Upload, CheckCircle2, Table2, RefreshCcw, Plus,
  Layers, ListTree, MessageSquareText, ChevronRight, FolderPlus,
} from 'lucide-react'
import { Database, Lock } from 'lucide-react'
import { useStore } from '../store.jsx'
import { parseRawdataFile } from '../lib/excel.js'
import { parseSavCodebook, remapCodebookByPosition } from '../lib/spss.js'
import { BOX_META, newRowCount } from '../lib/boxes.js'
import { Button, Badge, NewRowsBadge, Toast } from '../components/ui.jsx'

// คลาสสีแบบ static (Tailwind ต้องเห็น string เต็ม — interpolate ไม่ได้)
const BOX_CLS = {
  ce: { num: 'bg-sky-100 text-sky-600', icon: 'bg-sky-50 text-sky-500' },
  oe: { num: 'bg-violet-100 text-violet-600', icon: 'bg-violet-50 text-violet-500' },
  verbatim: { num: 'bg-amber-100 text-amber-600', icon: 'bg-amber-50 text-amber-500' },
}

export default function ProjectHub() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { state, setRawdata, appendRawdata, updateCodeframe, setCodebook } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const codeframes = state.codeframes.filter((c) => c.projectId === projectId)

  const fileRef = useRef(null)
  const appendRef = useRef(null)
  const savRef = useRef(null)
  const [busy, setBusy] = useState('') // '' | 'upload' | 'append' | 'sav'
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [wiggle, setWiggle] = useState(null) // key ของกล่อง Coming Soon ที่กำลังเล่น animation
  const wiggleTimer = useRef(null)

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

  const raw = project.rawMeta

  // อัปโหลด/เปลี่ยนไฟล์ (แทนที่ทั้งก้อน) — ถ้ามี codeframe เดิม จับคู่ข้อใหม่ด้วย "ชื่อข้อ"
  const handleReplace = async (file) => {
    if (!file) return
    setError('')
    setBusy('upload')
    try {
      const rawdata = await parseRawdataFile(file)
      if (raw && codeframes.length) {
        const oldIdToLabel = new Map(raw.questions.map((q) => [q.id, q.label]))
        const labelToNewId = new Map(rawdata.questions.map((q) => [q.label, q.id]))
        let dropped = 0
        codeframes.forEach((cf) => {
          updateCodeframe(cf.id, (c) => ({
            ...c,
            sheets: c.sheets.map((s) => {
              const mapped = s.questionIds
                .map((qid) => labelToNewId.get(oldIdToLabel.get(qid)))
                .filter(Boolean)
              dropped += s.questionIds.length - mapped.length
              return { ...s, questionIds: mapped }
            }),
          }))
        })
        if (dropped > 0) {
          setToast({
            type: 'warning',
            title: `ไฟล์ใหม่ไม่มีบางข้อที่ Codeframe เดิมใช้อยู่`,
            message: `เอาออกจากชีทแล้ว ${dropped} รายการ — ตรวจ "ข้อในชีทนี้" ของแต่ละ Codeframe อีกครั้ง`,
            duration: 7000,
          })
        }
      }
      await setRawdata(projectId, rawdata)
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
    <div className="mx-auto max-w-6xl px-5 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft size={15} /> โปรเจกต์ทั้งหมด
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {project.client ? `ลูกค้า: ${project.client} · ` : ''}
          {raw ? `${raw.questions.length} ข้อ · ${raw.rowCount} แถวคำตอบ` : 'ยังไม่มี Rawdata'}
        </p>
      </div>

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
      <section className="mb-5">
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
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-5 shadow-sm">
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
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {raw.questions.slice(0, 10).map((q) => (
                    <Badge key={q.id} color={q.type === 'MA' ? 'violet' : 'slate'}>
                      {q.label}{q.type === 'MA' ? ` · MA×${q.columns.length}` : ''}
                    </Badge>
                  ))}
                  {raw.questions.length > 10 && <Badge color="slate">+{raw.questions.length - 10}</Badge>}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
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

      {/* ===== กล่อง 2/3/4 ===== */}
      <h2 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
        งานบนข้อมูลก้อนเดียวกัน
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {boxCards.map((b, i) => {
          const meta = BOX_META[b.key]
          const cls = BOX_CLS[b.key]
          const Icon = b.icon
          const newRows = newRowCount(project, b.key)
          const comingSoon = !!b.comingSoon
          const disabled = !raw || comingSoon
          const card = (
            <div
              className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-all ${
                comingSoon
                  ? `cursor-pointer border-slate-200 hover:opacity-100 hover:shadow-md ${wiggle === b.key ? 'cs-wiggle' : ''}`
                  : disabled
                    ? 'cursor-not-allowed border-slate-200 opacity-60'
                    : 'cursor-pointer border-slate-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md'
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
              <div className="flex items-center gap-2">
                <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] ${cls.num}`}>
                  {i + 2}
                </span>
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${cls.icon}`}>
                  <Icon size={18} />
                </div>
                <div className="ml-auto"><NewRowsBadge count={disabled ? 0 : newRows} /></div>
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-900 group-hover:text-indigo-700">
                {meta.label} <span className="text-sm font-normal text-slate-400">— {meta.desc}</span>
              </h3>
              <div className="mt-3 flex items-center gap-3 text-sm text-slate-500">
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
              <div
                key={b.key}
                onClick={() => pokeComingSoon(b.key, meta.label)}
                className="block h-full select-none"
              >
                {card}
              </div>
            )
          }
          return disabled ? (
            <div key={b.key}>{card}</div>
          ) : (
            <Link key={b.key} to={b.to} className="block h-full">{card}</Link>
          )
        })}
      </div>

      {!raw && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
          <Plus size={13} /> อัปโหลด Rawdata ที่กล่องศูนย์กลางก่อน จึงจะเปิดกล่อง CE / OE / Verbatim ได้
        </p>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
