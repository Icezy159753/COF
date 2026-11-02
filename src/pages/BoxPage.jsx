/* eslint-disable react-hooks/preserve-manual-memoization, react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, ChevronRight, Layers, Settings2, Wand2,
  Database, ListTree, Search, Sparkles, Loader2, CornerDownRight, Table2, Download, MoreHorizontal,
} from 'lucide-react'
import { useStore, useRawdata, uid } from '../store.jsx'
import {
  BOX_META, isWorkBox, detectTextQuestions, newRowCount, findOtherColumns, freqByValue, hasOtherOption, shortSheetName,
} from '../lib/boxes.js'
import { uniqueAnswers } from '../lib/answers.js'
import { aiAssignToFrame } from '../lib/aiGroup.js'
import { exportQuestionCodeList } from '../lib/excel.js'
import { findSameFrameQuestions, valueSignature } from '../lib/spss.js'
import {
  Button, Modal, Field, TextInput, EmptyState, ConfirmDelete, BoxBadge, Badge, NewRowsBadge, Toast,
} from '../components/ui.jsx'

export default function BoxPage() {
  const { projectId, box } = useParams()
  const navigate = useNavigate()
  const { state, addCodeframe, deleteCodeframe, updateProjectBox, markBoxSeen } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const { rawdata } = useRawdata(projectId)

  const [pickOpen, setPickOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [view, setView] = useState('codeframes') // 'codeframes' | 'codebook'
  const [creating, setCreating] = useState(null) // ข้อความสถานะระหว่างสร้าง codeframe (AI)
  const [smartSetupOpen, setSmartSetupOpen] = useState(false)
  const [boxActionsOpen, setBoxActionsOpen] = useState(false)
  const [toast, setToast] = useState(null)

  // เปิดกล่องครั้งแรก → ทำเครื่องหมายว่าดูแถวล่าสุดแล้ว (ล้าง badge แถวใหม่)
  useEffect(() => {
    if (project?.rawMeta) markBoxSeen(projectId, box)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, box, project?.rawMeta?.rowCount])

  const meta = BOX_META[box] ?? {}
  const boxState = project?.boxes?.[box] ?? { questionIds: [] }
  const pickedIds = boxState.questionIds ?? []
  const codeframes = state.codeframes.filter((c) => c.projectId === projectId && c.box === box)
  const raw = project?.rawMeta
  const newRows = project ? newRowCount(project, box) : 0
  const codebook = project?.codebook

  // สร้าง "1 ชีท" จากกลุ่มข้อที่ใช้โครงเดียวกัน (group) + ลง code ปลายปิด + (ทางเลือก) AI จับ 'อื่นๆ'
  //   onProgress(text) = อัปเดตข้อความสถานะระหว่างเรียก AI
  //   skipAExternal = true → ไม่เรียก AI จับ 'อื่นๆ' ตอนสร้าง (สร้างไว ๆ แล้วค่อยกด Group เองในแต่ละข้อ)
  const buildSheetForGroup = async (group, cb, onProgress, { skipAI = false } = {}) => {
    const codes = cb.values.map((v) => ({
      id: uid(), codeNo: String(v.value), thai: v.label, thai2: '', eng: '',
    }))
    const assignments = {}
    cb.values.forEach((v, i) => { assignments[String(v.value)] = [codes[i].id] }) // closed pre-coded

    const questionIds = []
    const otherQs = []
    for (const q of group) {
      questionIds.push(q.id)
      const oqs = rawdata ? findOtherColumns(rawdata, q, codebook) : []
      for (const oq of oqs) {
        if (!questionIds.includes(oq.id)) questionIds.push(oq.id)
        otherQs.push(oq)
      }
    }

    let assignedCount = 0
    let otherCount = 0
    if (otherQs.length) {
      const verbatims = uniqueAnswers(rawdata, otherQs.map((o) => o.id)).filter((a) => a.text.trim())
      otherCount = verbatims.length
      if (verbatims.length && !skipAI) {
        onProgress?.(`AI กำลังจับ ${verbatims.length} คำตอบ 'อื่นๆ' เข้ารหัสเดิม…`)
        const codeItems = codes.map((c, i) => ({ i, label: c.thai }))
        const vItems = verbatims.map((a, i) => ({ i, text: a.text, count: a.count }))
        const { assign } = await aiAssignToFrame(codeItems, vItems)
        assign.forEach((codeIdx, i) => {
          if (codeIdx >= 0 && codes[codeIdx]) {
            assignments[verbatims[i].key] = [codes[codeIdx].id]
            assignedCount += 1
          }
        })
      }
    }

    const sheet = {
      id: uid(),
      // ชื่อชีท = รหัสสั้น (ดึงรหัสท้ายจากชื่อข้อตัวแทน เช่น "...อร่อย_d4" → "d4")
      name: shortSheetName(codebook?.byVar?.[group[0]?.label]?.code || group[0]?.label || ''),
      questionIds,
      // level 0 = ยังไม่จัด Net (ไม่มีหัวข้อ) — ผู้ใช้ค่อยกด "เพิ่ม Net" จัดเองภายหลัง
      nets: [{ id: uid(), name: '', level: 0, codes }],
      assignments,
    }
    return { sheet, otherCount, assignedCount }
  }

  // สร้าง Codeframe จากข้อเดียว (รวมข้อโครงเดียวกันให้)
  const createFromCode = async (question) => {
    const cb = codebook?.byVar?.[question.label]
    if (!cb?.values?.length) return
    const group = rawdata ? findSameFrameQuestions(codebook, rawdata.questions, question) : [question]
    const shortName = cb.code || question.label // code สั้นจาก SPSS (ถ้ามี)
    try {
      const { sheet, otherCount } = await buildSheetForGroup(group, cb, undefined, { skipAI: true })
      const cf = addCodeframe({ projectId, box, name: `Codeframe ${shortName}`, sheets: [sheet] })
      setCreating(null)
      setToast({
        type: 'success',
        title: `สร้าง Codeframe ${shortName} แล้ว`,
        message:
          (group.length > 1 ? `รวม ${group.length} ข้อโครงเดียวกัน · ` : '') +
          `ลงโค้ดปลายปิดอัตโนมัติ` +
          (otherCount ? ` · มี 'อื่นๆ' ${otherCount} คำตอบรอจัดกลุ่ม (กด "Group อัตโนมัติ" ในข้อ)` : ''),
        duration: 4000,
      })
      navigate(`/projects/${projectId}/${box}/codeframes/${cf.id}`)
    } catch (err) {
      setCreating(null)
      setToast({ type: 'warning', title: 'สร้างไม่สำเร็จ', message: err.message, duration: 8000 })
    }
  }

  // ตัวแปรที่ "ไม่ทำ Code" (global) — Auto Codeframe จะข้าม (เทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่)
  const excludedSet = useMemo(
    () => new Set((state.settings?.excludedVars ?? []).map((v) => v.toLowerCase())),
    [state.settings],
  )

  // กลุ่มข้อที่มี "อื่นๆ ระบุ" จัดตามโครง code ที่เหมือนกัน (1 กลุ่ม = 1 ชีท)
  const autoGroups = useMemo(() => {
    if (!codebook?.byVar || !rawdata?.questions) return []
    const cbBy = codebook.byVar
    const bySig = new Map()
    for (const q of rawdata.questions) {
      if (excludedSet.has(String(q.label).toLowerCase())) continue // ข้ามตัวแปรที่ห้ามทำ Code
      const cb = cbBy[q.label]
      if (!cb?.values?.length) continue
      // ดึงมา auto เฉพาะข้อที่ "มีตัวเลือก อื่นๆ ระบุ" จริงในโค้ดบุ๊กเท่านั้น
      if (!hasOtherOption(cb)) continue
      const sig = valueSignature(cb.values)
      if (!bySig.has(sig)) bySig.set(sig, { rep: q, cb, members: [] })
      bySig.get(sig).members.push(q)
    }
    // แต่ละกลุ่ม → ใช้ "ทุกข้อที่โครงเหมือนกัน" (รวมข้อที่ไม่มี other ในโครงเดียวกันด้วย) — ตัดตัวแปรที่ห้ามออก
    return [...bySig.values()]
      .map((g) => ({
        cb: g.cb,
        questions: findSameFrameQuestions(codebook, rawdata.questions, g.rep)
          .filter((q) => !excludedSet.has(String(q.label).toLowerCase())),
        otherMembers: g.members,
      }))
      .filter((g) => g.questions.length)
     
  }, [codebook, rawdata, excludedSet])

  const otherQuestionCount = useMemo(
    () => autoGroups.reduce((s, g) => s + g.otherMembers.length, 0),
    [autoGroups],
  )
  const otherColumnCount = useMemo(() => {
    if (!rawdata || !codebook) return 0
    return autoGroups.reduce((sum, g) => sum + g.questions.reduce((s, q) => s + findOtherColumns(rawdata, q, codebook).length, 0), 0)
  }, [autoGroups, rawdata, codebook])

  // id ของคอลัมน์ "อื่นๆ ระบุ" (ข้อความ) ทั้งหมด — ใช้ "ไม่นับเป็นข้อ" และไม่โชว์ในชิป
  const otherColIds = useMemo(() => {
    const s = new Set()
    if (!rawdata?.questions || !codebook?.byVar) return s
    for (const q of rawdata.questions) {
      if (!codebook.byVar[q.label]?.values?.length) continue
      const ocs = findOtherColumns(rawdata, q, codebook)
      for (const oc of ocs) s.add(oc.id)
    }
    return s
     
  }, [codebook, rawdata])

  if (!isWorkBox(box)) return <Navigate to={`/projects/${projectId}`} replace />
  if (!project) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-16 text-center text-slate-400">
        ไม่พบโปรเจกต์นี้ — <Link to="/" className="text-indigo-600 underline">กลับหน้าหลัก</Link>
      </div>
    )
  }

  // Auto: สร้าง Codeframe เดียว แยกเป็นชีทตามกลุ่มโครง (ทุกข้อที่มี 'อื่นๆ ระบุ')
  //   "สร้างก่อน ยังไม่จับรหัส" → ไม่เรียก AI ตอนสร้าง (เสร็จทันที) แล้วค่อยกด Group เองในแต่ละข้อ
  const autoBuildAll = async () => {
    if (!autoGroups.length) return
    setCreating('กำลังสร้าง Codeframe…')
    try {
      const results = await Promise.all(
        autoGroups.map((g) => buildSheetForGroup(g.questions, g.cb, undefined, { skipAI: true })),
      )
      // คงลำดับชีทตามลำดับกลุ่มเดิม (Promise.all คืนผลตามลำดับ input อยู่แล้ว)
      const sheets = results.map((r) => r.sheet)
      const totalOther = results.reduce((s, r) => r.otherCount + s, 0)
      const cf = addCodeframe({ projectId, box, name: 'Codeframe CE other', sheets })
      setCreating(null)
      setToast({
        type: 'success',
        title: `สร้าง Codeframe อัตโนมัติแล้ว — ${sheets.length} ชีท`,
        message: `ลงโค้ดปลายปิดให้แล้ว · มี 'อื่นๆ ระบุ' ${totalOther} คำตอบรอจัดกลุ่ม — เปิดแต่ละข้อแล้วกด "Group อัตโนมัติ" ให้ AI จับเข้ารหัส`,
        duration: 5000,
      })
      navigate(`/projects/${projectId}/${box}/codeframes/${cf.id}`)
    } catch (err) {
      setCreating(null)
      setToast({ type: 'warning', title: 'สร้างอัตโนมัติไม่สำเร็จ', message: err.message, duration: 8000 })
    }
  }

  const confirmDeleteCodeframe = () => {
    if (!deleting) return
    const remainingInBox = codeframes.filter((cf) => cf.id !== deleting.id)
    deleteCodeframe(deleting.id)
    setDeleting(null)
    if (remainingInBox.length === 0) {
      updateProjectBox(projectId, box, { questionIds: [], seenRowCount: project?.rawMeta?.rowCount ?? 0 })
      setWizardOpen(false)
      setPickOpen(false)
      setToast({ type: 'info', title: 'ล้าง Codeframe แล้ว', message: 'กล่องนี้เริ่มใหม่ ไม่จำข้อ/ค่าเดิมจาก Codeframe ก่อนหน้า', duration: 3500 })
    }
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
        <BoxBadge box={box} />
        <h1 className="text-2xl font-bold text-slate-900">
          กล่อง {meta.label} <span className="text-base font-normal text-slate-400">— {meta.desc}</span>
        </h1>
        <NewRowsBadge count={newRows} />
      </div>

      {!raw ? (
        <EmptyState
          icon={Layers}
          title="ยังไม่มี Rawdata"
          subtitle="กลับไปอัปโหลด Rawdata ที่กล่องศูนย์กลางก่อน จึงจะทำงานกล่องนี้ได้"
          action={<Button onClick={() => navigate(`/projects/${projectId}`)}>กลับหน้าโปรเจกต์</Button>}
        />
      ) : (
        <>
          {/* แท็บ: Codeframe | ดูตัวอย่างข้อมูล | โจทย์ & Code */}
          <div className="mb-5 flex w-full flex-wrap items-center gap-2 text-xs font-semibold">
            <button
              onClick={() => setView('codeframes')}
              className={`group inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 font-black shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                view === 'codeframes'
                  ? 'border-sky-300 bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-sky-200'
                  : 'animate-pulse border-sky-100 bg-white text-sky-700 hover:animate-none hover:border-sky-300 hover:bg-sky-50'
              }`}
            >
              <Layers size={14} /> Codeframe ({codeframes.length})
              <ChevronRight size={13} className="ce-cta-float" />
            </button>
            <Link
              to={`/projects/${projectId}/rawdata`}
              className="group inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-100 bg-white px-3 py-2 font-black text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-md"
            >
              <Table2 size={14} /> ดูตัวอย่างข้อมูล
              <ChevronRight size={13} className="ce-cta-float" />
            </Link>
            <button
              onClick={() => setView('codebook')}
              className={`group inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 font-black shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                view === 'codebook'
                  ? 'border-violet-300 bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-violet-200'
                  : 'animate-pulse border-violet-100 bg-white text-violet-700 hover:animate-none hover:border-violet-300 hover:bg-violet-50'
              }`}
            >
              <Database size={14} /> โจทย์ &amp; Code{codebook ? ` (${codebook.varCount})` : ''}
              <ChevronRight size={13} className="ce-cta-float" />
            </button>
          </div>

          {view === 'codebook' ? (
            <CodebookViewer
              codebook={codebook}
              questions={raw.questions}
              rawdata={rawdata}
              creating={creating}
              onCreate={createFromCode}
              onGoAttach={() => navigate(`/projects/${projectId}`)}
              projectName={project.name}
            />
          ) : (
          <>
          {/* Auto: สร้าง Codeframe เดียวจากทุกข้อที่มี 'อื่นๆ ระบุ' แยกชีทตามกลุ่มโครง */}
          {codebook && autoGroups.length > 0 && (
            <div className="mb-5 overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setSmartSetupOpen((v) => !v)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-indigo-50/50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
                  <Sparkles size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-indigo-400">Smart setup</p>
                    <Badge color="emerald">พร้อมสร้าง</Badge>
                    <Badge color="indigo">{otherQuestionCount} Other Q / {otherColumnCount} Oth cols</Badge>
                    <Badge color="violet">{autoGroups.length} กลุ่ม</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm font-bold text-slate-800">เจอชุดคำถาม “อื่นๆ ระบุ” ที่สร้าง Codeframe ได้ทันที</p>
                </div>
                <ChevronRight size={16} className={`shrink-0 text-slate-400 transition-transform ${smartSetupOpen ? 'rotate-90' : ''}`} />
              </button>

              {smartSetupOpen && (
                <div className="border-t border-indigo-50 bg-gradient-to-br from-indigo-50/55 via-white to-sky-50/45 px-4 py-4">
                  <div className="mb-3 grid gap-3 md:grid-cols-3">
                    {[
                      ['1', 'แยกกลุ่มโครง', `รวมข้อที่ใช้ชุด code เดียวกันเป็น ${autoGroups.length} ชีท`],
                      ['2', 'ลง code ปลายปิด', 'เติมรหัสจาก Codebook ให้ก่อนแบบไม่ต้องรอ AI'],
                      ['3', 'รอจัด Other', 'เปิดแต่ละชีทแล้วกด Group อัตโนมัติให้ AI จัดข้อความ'],
                    ].map(([step, title, desc]) => (
                      <div key={step} className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-sm">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-black text-white">{step}</span>
                          <p className="text-xs font-black text-slate-800">{title}</p>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-500">{desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button disabled={!!creating} onClick={autoBuildAll}>
                      {creating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                      {creating ? 'กำลังสร้าง…' : `สร้าง ${autoGroups.length} ชีท`}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {creating && (
            <p className="mb-3 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-600">{creating}</p>
          )}

          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
              <Layers size={16} /> Codeframe ({codeframes.length})
            </h2>
            <div className="relative">
              <Button size="sm" variant="secondary" onClick={() => setBoxActionsOpen((v) => !v)}>
                <MoreHorizontal size={14} /> เมนู
              </Button>
              {boxActionsOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setBoxActionsOpen(false)} />
                  <div className="absolute right-0 z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                    <button onClick={() => { setBoxActionsOpen(false); setPickOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      <Settings2 size={14} /> เลือกข้อของกล่อง {meta.label}
                    </button>
                    <button onClick={() => { setBoxActionsOpen(false); setWizardOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      <Plus size={14} /> สร้าง Codeframe
                    </button>
                    <button onClick={() => { setBoxActionsOpen(false); navigate(`/projects/${projectId}/rawdata`) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      <Table2 size={14} /> ดูตัวอย่างข้อมูล
                    </button>
                    <button onClick={() => { setBoxActionsOpen(false); setView('codebook') }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                      <Database size={14} /> โจทย์ & Code
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {codeframes.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="ยังไม่มี Codeframe ในกล่องนี้"
              subtitle="สร้าง Codeframe โดยเลือกข้อจากที่กล่องนี้ดูแล แล้วกำหนดว่าชีทแรกจะรวมข้อไหนบ้าง"
              action={
                <Button onClick={() => setWizardOpen(true)}>
                  <Plus size={16} /> สร้าง Codeframe
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {codeframes.map((cf) => {
                const totalCodes = cf.sheets.reduce(
                  (sum, sh) => sum + sh.nets.reduce((s2, n) => s2 + n.codes.length, 0),
                  0,
                )
                // นับเฉพาะ "ข้อจริง" ไม่รวมคอลัมน์ข้อความ 'อื่นๆ ระบุ'
                const totalQuestions = new Set(
                  cf.sheets.flatMap((sh) => sh.questionIds).filter((qid) => !otherColIds.has(qid)),
                ).size
                return (
                  <div
                    key={cf.id}
                    className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md"
                  >
                    <Link to={`/projects/${projectId}/${box}/codeframes/${cf.id}`} className="block">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-700">
                          {cf.name}
                        </h3>
                        <ChevronRight size={16} className="mr-8 text-slate-300 group-hover:text-indigo-400" />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <Badge color="indigo">{cf.sheets.length} ชีท</Badge>
                        <Badge color="emerald">{totalQuestions} ข้อ</Badge>
                        <Badge color="amber">{totalCodes} Code</Badge>
                        <span className="text-slate-300">
                          สร้างเมื่อ {new Date(cf.createdAt).toLocaleDateString('th-TH')}
                        </span>
                      </div>
                    </Link>
                    <button
                      title="ลบ Codeframe"
                      onClick={() => setDeleting(cf)}
                      className="absolute top-4 right-4 cursor-pointer rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          </>
          )}
        </>
      )}

      <QuestionPicker
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        box={box}
        rawdata={rawdata}
        questions={raw?.questions ?? []}
        value={pickedIds}
        onSave={(ids) => updateProjectBox(projectId, box, { questionIds: ids })}
      />

      <CodeframeWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        questions={(raw?.questions ?? []).filter((q) => pickedIds.includes(q.id))}
        allQuestions={raw?.questions ?? []}
        onCreate={(sheets, name) => {
          const cf = addCodeframe({ projectId, box, name, sheets })
          navigate(`/projects/${projectId}/${box}/codeframes/${cf.id}`)
        }}
      />

      <ConfirmDelete
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDeleteCodeframe}
        what={`Codeframe "${deleting?.name}"`}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

// ============================================================
// แท็บ "โจทย์ & Code": เลือกข้อ → ดู variable label (โจทย์) + value labels (Code)
//   จาก SPSS codebook และสร้าง Codeframe จาก Code ได้
// ============================================================
function CodebookViewer({ codebook, questions, rawdata, creating, onCreate, onGoAttach, projectName }) {
  const [query, setQuery] = useState('')
  const [onlyOther, setOnlyOther] = useState(false) // กรองเฉพาะข้อที่มี "อื่นๆ ระบุ"
  const cbByLabel = codebook?.byVar ?? {}

  // ข้อไหนมี "อื่นๆ ระบุ" + ช่อง Oth จริงกี่ช่อง
  const otherMap = useMemo(() => {
    const m = {}
    for (const q of questions) {
      const cb = cbByLabel[q.label]
      const otherQs = rawdata ? findOtherColumns(rawdata, q, codebook) : []
      m[q.id] = { hasOther: hasOtherOption(cb), count: otherQs.length, labels: otherQs.map((x) => x.label) }
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, rawdata, codebook])

  const otherCount = useMemo(
    () => questions.filter((q) => otherMap[q.id]?.hasOther && cbByLabel[q.label]?.values?.length).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, otherMap, codebook],
  )
  const otherColumnCount = useMemo(
    () => questions.reduce((sum, q) => sum + (otherMap[q.id]?.count ?? 0), 0),
    [questions, otherMap],
  )

  // ข้อที่จะแสดงในเมนูซ้าย — คงลำดับตามไฟล์ SPSS/Rawdata จริง ห้าม sort แบบตัวอักษร
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return questions
      .map((question, order) => {
        const cb = cbByLabel[question.label] ?? null
        return { question, cb, order, hasCodes: !!cb?.values?.length, hasOther: !!otherMap[question.id]?.hasOther, otherCount: otherMap[question.id]?.count ?? 0 }
      })
      .filter(({ question, cb, hasOther }) => {
        if (onlyOther && !hasOther) return false
        return !q || question.label.toLowerCase().includes(q) || (cb?.label ?? '').toLowerCase().includes(q)
      })
      .sort((a, b) => a.order - b.order)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, query, onlyOther, otherMap, codebook])

  const [selectedId, setSelectedId] = useState(null)
  const selected = list.find((x) => x.question.id === selectedId) ?? list.find((x) => x.hasCodes) ?? list[0]

  const exportVisibleQuestionCodes = () => {
    const rows = []
    list.forEach(({ question, cb }, questionIndex) => {
      const freqMap = rawdata ? freqByValue(rawdata, question) : new Map()
      const cols = question.columns ?? [question.index]
      const baseTotal = rawdata
        ? rawdata.rows.filter((row) => cols.some((c) => String(row?.[c] ?? '').trim() !== '')).length
        : 0
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
    const suffix = onlyOther ? '_other_only' : ''
    const safeName = `${projectName || 'COF'}_${list.length}_questions_codes_simple${suffix}.xlsx`.replace(/[\\/:*?"<>|]/g, '_')
    exportQuestionCodeList(rows, safeName)
  }

  // ความถี่ของแต่ละค่า + ข้อ 'อื่นๆ ระบุ' หลายคอลัมน์ของข้อที่เลือก
  const freq = useMemo(
    () => (selected && rawdata ? freqByValue(rawdata, selected.question) : new Map()),
    [selected, rawdata],
  )
  const otherQs = useMemo(
    () => {
      if (!selected || !rawdata) return []
      return findOtherColumns(rawdata, selected.question, codebook)
    },
    [selected, rawdata, codebook],
  )
  // ข้ออื่นที่ใช้โครง code เหมือนกันเป๊ะ (จะถูก auto รวมเข้าโครงเดียวกันตอนสร้าง)
  const sameGroup = useMemo(
    () => (selected?.hasCodes && rawdata ? findSameFrameQuestions(codebook, rawdata.questions, selected.question) : []),
    [selected, rawdata, codebook],
  )

  if (!codebook) {
    return (
      <EmptyState
        icon={Database}
        title="ยังไม่ได้แนบ Codebook (.sav)"
        subtitle="แนบไฟล์ SPSS .sav ที่หน้าโปรเจกต์ (กล่องศูนย์กลางข้อมูล) เพื่อดึง Value+Label มาดูโจทย์และสร้าง Code"
        action={<Button onClick={onGoAttach}><Database size={16} /> ไปแนบ .sav</Button>}
      />
    )
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[24rem] gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* เมนูซ้าย: รายการข้อ */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-100 pr-3">
        <div className="relative mb-2">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาข้อ / โจทย์…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        {/* ปุ่มกรองเฉพาะข้อที่มี "อื่นๆ ระบุ" (งาน CE) */}
        <button
          onClick={() => setOnlyOther((v) => !v)}
          className={`mb-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            onlyOther ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
          }`}
          title="ข้อที่มีช่อง 'อื่นๆ โปรดระบุ' ให้ลงโค้ด"
        >
          <CornerDownRight size={13} />
          {onlyOther ? 'แสดงทุกข้อ' : `เฉพาะข้อที่มี "อื่นๆ ระบุ"`}
          <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${onlyOther ? 'bg-white/25 text-white' : 'bg-amber-200 text-amber-800'}`}>
            {otherCount} Q / {otherColumnCount} cols
          </span>
        </button>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {list.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400">
              {onlyOther ? 'ไม่มีข้อที่มี "อื่นๆ ระบุ"' : 'ไม่พบข้อที่ตรงกับคำค้น'}
            </p>
          ) : (
            list.map(({ question, cb, hasCodes, hasOther, otherCount }) => {
              const active = selected?.question.id === question.id
              return (
                <button
                  key={question.id}
                  onClick={() => setSelectedId(question.id)}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                    active ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50'
                  }`}
                  title={cb?.label || question.label}
                >
                  <span className="truncate font-medium">{question.label}</span>
                  {hasOther && (
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700'}`}>
                      Oth{otherCount ? ` x${otherCount}` : ''}
                    </span>
                  )}
                  {hasCodes ? (
                    <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-600'}`}>
                      {cb.values.length}
                    </span>
                  ) : (
                    <span className={`ml-auto shrink-0 text-[10px] ${active ? 'text-indigo-200' : 'text-slate-300'}`}>—</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ขวา: โจทย์ + Code ของข้อที่เลือก */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <p className="py-10 text-center text-sm text-slate-400">เลือกข้อจากเมนูด้านซ้าย</p>
        ) : (
          <>
            <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-400">ข้อ {selected.question.label} — โจทย์</p>
                <h3 className="text-base font-bold text-slate-800">
                  {selected.cb?.label || <span className="text-slate-400">— ไม่มี variable label ใน .sav —</span>}
                </h3>
                {sameGroup.length > 1 && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-indigo-600">
                    <Layers size={12} /> ใช้โครงเดียวกับอีก {sameGroup.length - 1} ข้อ:{' '}
                    <b className="truncate">{sameGroup.filter((q) => q.id !== selected.question.id).map((q) => q.label).join(', ')}</b>{' '}
                    <span className="text-indigo-400">(auto รวมให้)</span>
                  </p>
                )}
                {otherQs.length > 0 && (
                  <p className="mt-1 inline-flex max-w-full items-center gap-1 text-[11px] font-medium text-sky-600">
                    <CornerDownRight size={12} /> มีข้อ "อื่นๆ ระบุ" {otherQs.length} ช่อง:
                    <b className="truncate">{otherQs.map((q) => q.label).join(', ')}</b>
                    <span>(สร้างก่อน แล้วกด "Group อัตโนมัติ" ให้ AI จับเข้ารหัส)</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={exportVisibleQuestionCodes} disabled={!list.length}>
                  <Download size={14} /> Export โจทย์ & Code
                </Button>
                {selected.hasCodes && (
                  <Button size="sm" disabled={!!creating} onClick={() => onCreate(selected.question)}>
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {creating ? 'กำลังสร้าง…' : 'สร้าง Codeframe จาก Code นี้'}
                  </Button>
                )}
              </div>
            </div>

            {creating && (
              <p className="mb-2 shrink-0 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-600">
                {creating}
              </p>
            )}

            {selected.hasCodes ? (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-slate-200 bg-slate-100 text-xs font-bold text-slate-500">
                      <th className="w-24 px-3 py-2">Value (Code)</th>
                      <th className="px-3 py-2">Label</th>
                      <th className="w-24 px-3 py-2 text-right">Frequency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {selected.cb.values.map((v, i) => {
                      const n = freq.get(String(v.value)) ?? 0
                      return (
                        <tr key={i} className={i % 2 ? 'bg-slate-50/40' : 'bg-white'}>
                          <td className="px-3 py-1.5 font-mono font-semibold text-amber-700">{String(v.value)}</td>
                          <td className="px-3 py-1.5 text-slate-700">{v.label}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-slate-500">
                            {n || <span className="text-slate-300">0</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
                <ListTree size={26} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-500">ข้อนี้ไม่มี Value Label ใน .sav</p>
                <p className="mt-1 text-xs text-slate-400">
                  (อาจเป็นข้อปลายเปิด/ข้อความ หรือชื่อข้อใน xlsx ไม่ตรงกับชื่อ variable ใน .sav)
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// เลือก "ชนิดข้อ" ที่กล่องนี้ดูแล — มีปุ่มเลือกอัตโนมัติ (OE=ข้อ text, CE=ที่เหลือ)
// ============================================================
function QuestionPicker({ open, onClose, box, rawdata, questions, value, onSave }) {
  const [selected, setSelected] = useState(value)
  useEffect(() => { if (open) setSelected(value) }, [open, value])

  const toggle = (qid) => setSelected((s) => (s.includes(qid) ? s.filter((x) => x !== qid) : [...s, qid]))

  const autoSelect = () => {
    const textIds = new Set(detectTextQuestions(rawdata))
    // OE = ข้อ text (ปลายเปิด), CE = ข้อที่เหลือ (ปลายปิด/ตัวเลือก)
    const ids = questions
      .filter((q) => (box === 'oe' ? textIds.has(q.id) : !textIds.has(q.id)))
      .map((q) => q.id)
    setSelected(ids)
  }

  return (
    <Modal open={open} onClose={onClose} title={`เลือกข้อของกล่อง ${BOX_META[box].label}`} wide>
      <p className="mb-3 text-xs text-slate-500">
        ติ๊กเลือกข้อ (คอลัมน์) ที่กล่องนี้จะนำมาทำ Codeframe — CE และ OE เลือกคนละชุดได้
      </p>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="soft" size="sm" onClick={autoSelect} disabled={!rawdata}>
          <Wand2 size={14} /> เลือกอัตโนมัติ ({box === 'oe' ? 'ข้อปลายเปิด/text' : 'ข้อปลายปิด'})
        </Button>
        <button onClick={() => setSelected([])} className="cursor-pointer text-xs text-slate-400 hover:text-rose-500">
          ล้างทั้งหมด
        </button>
        <span className="ml-auto text-xs font-semibold text-indigo-600">เลือกแล้ว {selected.length} ข้อ</span>
      </div>
      <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
        {questions.map((q) => {
          const checked = selected.includes(q.id)
          return (
            <button
              type="button"
              key={q.id}
              onClick={() => toggle(q.id)}
              className={`flex cursor-pointer items-center justify-between gap-1 truncate rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                checked
                  ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
              }`}
              title={q.label}
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
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={() => { onSave(selected); onClose() }}>บันทึก ({selected.length} ข้อ)</Button>
      </div>
    </Modal>
  )
}

// ============================================================
// Wizard สร้าง Codeframe: เลือกข้อ (จากที่กล่องดูแล) → กำหนดชีท
// ============================================================
function CodeframeWizard({ open, onClose, questions, allQuestions, onCreate }) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState([])
  const [sheetCount, setSheetCount] = useState(1)
  const [sheetOf, setSheetOf] = useState({})

  // ถ้ากล่องยังไม่เลือกข้อ ให้ fallback เป็นทุกข้อ
  const pool = questions.length ? questions : allQuestions

  const reset = () => {
    setStep(1); setName(''); setSelected([]); setSheetCount(1); setSheetOf({})
  }
  const close = () => { reset(); onClose() }
  const toggle = (qid) => setSelected((s) => (s.includes(qid) ? s.filter((x) => x !== qid) : [...s, qid]))

  const goStep2 = () => {
    const init = {}
    selected.forEach((qid) => { init[qid] = sheetOf[qid] ?? 0 })
    setSheetOf(init)
    setStep(2)
  }

  const create = () => {
    const sheets = Array.from({ length: sheetCount }, (_, i) => ({
      id: uid(),
      name: i === 0 ? 'ชีทแรก (โครงแรก)' : `ชีท ${i + 1}`,
      questionIds: selected.filter((qid) => Math.min(sheetOf[qid] ?? 0, sheetCount - 1) === i),
      nets: [],
      assignments: {},
    }))
    onCreate(sheets, name.trim() || 'Codeframe ใหม่')
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 1 ? 'สร้าง Codeframe — เลือกข้อ' : 'สร้าง Codeframe — กำหนดชีท'}
      wide
    >
      <div className="mb-5 flex items-center gap-2 text-xs font-semibold">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1</span>
        <span className={step >= 1 ? 'text-indigo-700' : 'text-slate-400'}>เลือกข้อ</span>
        <span className="h-px w-8 bg-slate-200" />
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2</span>
        <span className={step >= 2 ? 'text-indigo-700' : 'text-slate-400'}>กำหนดชีท / โครง</span>
      </div>

      {step === 1 && (
        <>
          <Field label="ชื่อ Codeframe">
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น Codeframe Q2 เหตุผล" />
          </Field>
          <Field
            label={`เลือกข้อที่จะใช้สร้าง Codeframe (เลือกแล้ว ${selected.length} ข้อ)`}
            hint="แสดงเฉพาะข้อที่กล่องนี้ดูแล (ตั้งค่าได้ที่ปุ่ม 'เลือกข้อของกล่อง')"
          >
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
              {pool.map((q) => {
                const checked = selected.includes(q.id)
                return (
                  <button
                    type="button"
                    key={q.id}
                    onClick={() => toggle(q.id)}
                    className={`flex cursor-pointer items-center justify-between gap-1 truncate rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                      checked
                        ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                    }`}
                    title={q.label}
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
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>ยกเลิก</Button>
            <Button onClick={goStep2} disabled={selected.length === 0}>
              ถัดไป: กำหนดชีท <ChevronRight size={15} />
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <Field label="จำนวนชีท (โครง) ใน Codeframe นี้" hint="ถ้าหลายข้อใช้โครงเดียวกัน ให้รวมไว้ชีทเดียวกันได้">
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={Math.max(1, selected.length)}
                value={sheetCount}
                onChange={(e) => setSheetCount(Math.max(1, Math.min(selected.length, Number(e.target.value) || 1)))}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <span className="text-xs text-slate-400">สูงสุด {selected.length} ชีท (ตามจำนวนข้อที่เลือก)</span>
            </div>
          </Field>
          <Field label="กำหนดว่าแต่ละข้ออยู่ชีทไหน" hint="ข้อที่อยู่ชีทเดียวกันจะใช้โครง Codeframe เดียวกัน">
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
              {selected.map((qid) => {
                const q = pool.find((x) => x.id === qid)
                return (
                  <div key={qid} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                    <span className="truncate text-sm font-medium text-slate-700">{q?.label}</span>
                    <select
                      value={Math.min(sheetOf[qid] ?? 0, sheetCount - 1)}
                      onChange={(e) => setSheetOf((s) => ({ ...s, [qid]: Number(e.target.value) }))}
                      className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-500"
                    >
                      {Array.from({ length: sheetCount }, (_, i) => (
                        <option key={i} value={i}>{i === 0 ? 'ชีทแรก (โครงแรก)' : `ชีท ${i + 1}`}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </Field>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft size={15} /> ย้อนกลับ
            </Button>
            <Button onClick={create}>
              <Plus size={15} /> สร้าง Codeframe ({sheetCount} ชีท / {selected.length} ข้อ)
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
