import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, ArchiveRestore, ArrowLeft, Bot, CheckCircle2, Download, FileClock,
  History, KeyRound, RefreshCcw, ShieldCheck, Upload, WandSparkles,
} from 'lucide-react'
import { useStore } from '../store.jsx'
import { useAuth } from '../lib/auth.jsx'
import { Badge, Button, EmptyState, Field, TextInput, Toast } from '../components/ui.jsx'

const fmt = (n) => new Intl.NumberFormat('th-TH').format(n || 0)
const dt = (v) => (v ? new Date(v).toLocaleString('th-TH') : '—')

function downloadJson(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export default function OpsCenter() {
  const { state } = useStore()
  const { user, role } = useAuth()
  const importRef = useRef(null)
  const [toast, setToast] = useState(null)
  const [query, setQuery] = useState('')

  const stats = useMemo(() => {
    const rows = state.projects.reduce((sum, p) => sum + (p.rawMeta?.rowCount || 0), 0)
    const questions = state.projects.reduce((sum, p) => sum + (p.rawMeta?.questions?.length || 0), 0)
    const withRaw = state.projects.filter((p) => p.rawMeta).length
    const aiReady = state.settings?.ai?.provider && state.settings?.ai?.model
    const lastUpdated = Math.max(
      0,
      ...state.projects.map((p) => p.rawMeta?.updatedAt || p.createdAt || 0),
      ...state.codeframes.map((c) => c.updatedAt || c.createdAt || 0),
    )
    return { rows, questions, withRaw, aiReady, lastUpdated }
  }, [state])

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return state.projects
    return state.projects.filter((p) =>
      [p.name, p.client, p.programmer, p.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [state.projects, query])

  const exportBackup = () => {
    downloadJson(`codeframe-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      exportedBy: user?.email || null,
      app: 'Codeframe Studio',
      backendProject: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'codeframe-dbd8d',
      projects: state.projects,
      codeframes: state.codeframes,
      settings: state.settings,
    })
    setToast({ type: 'success', title: 'Export backup แล้ว', message: 'ดาวน์โหลด JSON สำรองข้อมูล metadata/project/codeframe เรียบร้อย', duration: 4500 })
  }

  const exportAiQueue = () => {
    const jobs = state.projects.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      client: p.client || '',
      rawRows: p.rawMeta?.rowCount || 0,
      questions: p.rawMeta?.questions?.length || 0,
      ceCodeframes: state.codeframes.filter((c) => c.projectId === p.id && c.box === 'ce').length,
      oeCodeframes: state.codeframes.filter((c) => c.projectId === p.id && c.box === 'oe').length,
      verbatimReady: !!p.boxes?.verbatim?.questionIds?.length,
      recommendedNextAction: p.rawMeta ? 'review-codeframe-and-run-human-approval' : 'upload-rawdata',
    }))
    downloadJson(`codeframe-ai-work-queue-${new Date().toISOString().slice(0, 10)}.json`, { jobs })
    setToast({ type: 'success', title: 'Export AI work queue แล้ว', message: 'ไฟล์นี้ใช้วางแผน batch coding / human approval ต่อได้', duration: 4500 })
  }

  const importBackupPreview = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      setToast({
        type: 'info',
        title: 'อ่านไฟล์ backup ได้',
        message: `พบ ${data.projects?.length || 0} โปรเจกต์ / ${data.codeframes?.length || 0} codeframe — เพื่อความปลอดภัย MVP นี้ยังเป็น preview ไม่เขียนทับ Firestore`,
        duration: 8000,
      })
    } catch (e) {
      setToast({ type: 'warning', title: 'อ่าน backup ไม่สำเร็จ', message: e.message, duration: 7000 })
    }
  }

  const checks = [
    { label: 'GitHub/Deploy standard', ok: true, detail: 'มี firebase.json, .firebaserc, workflow template' },
    { label: 'Firebase backend split', ok: true, detail: 'Hosting codeframe-dp · Data/Auth codeframe-dbd8d' },
    { label: 'Auto save', ok: true, detail: 'Project/codeframe/rawdata บันทึก Firestore อัตโนมัติ + debounce' },
    { label: 'Version/Backup', ok: true, detail: 'Export backup JSON + restore preview' },
    { label: 'Permission', ok: true, detail: `Login required · role: ${role || '—'}` },
    { label: 'AI workflow', ok: true, detail: 'AI provider setting + export work queue' },
    { label: 'Audit/Recovery', ok: true, detail: 'Ops Center รวมสถานะและ action สำรองข้อมูล' },
  ]

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600">
        <ArrowLeft size={15} /> กลับหน้าโปรเจกต์
      </Link>

      <div className="mb-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge color="indigo">Ops Center</Badge>
              <Badge color="emerald">Production Ready MVP</Badge>
              <Badge color="slate">Backend: {import.meta.env.VITE_FIREBASE_PROJECT_ID || 'codeframe-dbd8d'}</Badge>
            </div>
            <h1 className="text-2xl font-bold text-slate-950">ศูนย์ควบคุม Codeframe Studio</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              รวมสถานะ deploy, autosave, backup, permission, AI workflow และ recovery สำหรับพัฒนาต่อแบบปลอดภัย
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportBackup}><Download size={16} /> Backup JSON</Button>
            <Button variant="secondary" onClick={exportAiQueue}><Bot size={16} /> AI Queue</Button>
            <Button onClick={() => importRef.current?.click()}><Upload size={16} /> Restore Preview</Button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={(e) => { importBackupPreview(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat icon={ArchiveRestore} label="Projects" value={fmt(state.projects.length)} sub={`${fmt(stats.withRaw)} มี rawdata`} />
        <Stat icon={FileClock} label="Raw rows" value={fmt(stats.rows)} sub={`${fmt(stats.questions)} columns`} />
        <Stat icon={WandSparkles} label="Codeframes" value={fmt(state.codeframes.length)} sub="CE/OE sheets" />
        <Stat icon={Activity} label="Auto save" value="ON" sub={`ล่าสุด ${dt(stats.lastUpdated)}`} ok />
        <Stat icon={KeyRound} label="Auth" value="ON" sub={user?.email || 'signed in'} ok />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Project command table</h2>
              <p className="text-xs text-slate-400">นับจากข้อมูลที่โหลดจริงใน Firestore ตอนเปิดหน้า</p>
            </div>
            <div className="w-full sm:w-72">
              <Field label="" hint="">
                <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาโปรเจกต์ / client / id" />
              </Field>
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <EmptyState icon={ArchiveRestore} title="ไม่พบโปรเจกต์" subtitle="ลองล้างคำค้นหา หรือสร้างโปรเจกต์ใหม่ในหน้าแรก" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[1fr_90px_90px_120px] bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <span>Project</span><span>Rows</span><span>CF</span><span>Updated</span>
              </div>
              <div className="max-h-[28rem] overflow-auto">
                {filteredProjects.map((p) => {
                  const cf = state.codeframes.filter((c) => c.projectId === p.id).length
                  return (
                    <Link key={p.id} to={`/projects/${p.id}`} className="grid grid-cols-[1fr_90px_90px_120px] border-t border-slate-100 px-3 py-3 text-sm hover:bg-indigo-50/50">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-800">{p.name}</span>
                        <span className="block truncate text-xs text-slate-400">{p.client || 'No client'} · {p.id}</span>
                      </span>
                      <span className="text-slate-600">{fmt(p.rawMeta?.rowCount)}</span>
                      <span className="text-slate-600">{fmt(cf)}</span>
                      <span className="text-xs text-slate-400">{dt(p.rawMeta?.updatedAt || p.createdAt)}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-bold text-slate-900">Readiness checklist</h2>
            <div className="space-y-2.5">
              {checks.map((c) => (
                <div key={c.label} className="flex gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <CheckCircle2 size={18} className={c.ok ? 'text-emerald-500' : 'text-slate-300'} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">{c.label}</p>
                    <p className="text-xs text-slate-400">{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 text-amber-600" size={20} />
              <div>
                <h3 className="font-bold text-amber-900">Security next step</h3>
                <p className="mt-1 text-sm text-amber-800">
                  Production rules ควร deploy ผ่าน Firebase Console/CLI หลังยืนยัน role structure แล้ว: login required + admin-only user management.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><History size={18} /> Recovery actions</h2>
            <div className="grid gap-2">
              <Button variant="secondary" onClick={exportBackup}><Download size={16} /> Download full metadata backup</Button>
              <Button variant="secondary" onClick={() => window.location.reload()}><RefreshCcw size={16} /> Reload from Firestore</Button>
            </div>
          </div>
        </section>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

function Stat({ icon: Icon, label, value, sub, ok = false }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className={`rounded-xl p-2 ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-400">{sub}</p>
    </div>
  )
}
