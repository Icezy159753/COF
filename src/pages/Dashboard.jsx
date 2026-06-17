import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FolderKanban, Plus, Trash2, ChevronRight, FileSpreadsheet, Layers,
  SlidersHorizontal, Search, X,
} from 'lucide-react'
import { useStore } from '../store.jsx'
import { newRowCount } from '../lib/boxes.js'
import {
  Button, Modal, Field, TextInput, EmptyState, ConfirmDelete, NewRowsBadge, Badge,
} from '../components/ui.jsx'

export default function Dashboard() {
  const { state, addProject, deleteProject } = useStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [programmer, setProgrammer] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    addProject({ name: name.trim(), client: client.trim(), programmer: programmer.trim() })
    setName('')
    setClient('')
    setProgrammer('')
    setCreateOpen(false)
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      {/* Hero */}
      <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 p-8 text-white shadow-lg shadow-indigo-200">
        <h1 className="text-2xl font-bold sm:text-3xl">โปรเจกต์การทำงาน</h1>
        <p className="mt-2 max-w-xl text-sm text-indigo-100">
          1 โปรเจกต์ = 4 กล่องบนข้อมูลก้อนเดียวกัน — Rawdata (ศูนย์กลาง),
          CE, OE และ Verbatim แก้ข้อความ + ตรวจสะกดด้วย AI
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Button
            size="lg"
            className="!bg-white !text-indigo-700 hover:!bg-indigo-50 !shadow-none"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={18} /> สร้างโปรเจกต์ใหม่
          </Button>
          <button
            onClick={() => setExcludedOpen(true)}
            title="กำหนดตัวแปรที่ห้ามนำมาทำ Code อัตโนมัติ (ใช้ทุกโปรเจกต์)"
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/40 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <SlidersHorizontal size={16} /> ตัวแปรไม่ทำ Code
            {state.settings?.excludedVars?.length > 0 && (
              <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
                {state.settings.excludedVars.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {state.projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="ยังไม่มีโปรเจกต์"
          subtitle="เริ่มต้นด้วยการสร้างโปรเจกต์แรก แล้วอัปโหลด Rawdata เพื่อเปิดกล่อง CE / OE / Verbatim"
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> สร้างโปรเจกต์
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.projects.map((p) => {
            const cfCount = state.codeframes.filter((c) => c.projectId === p.id).length
            const pendingRows = Math.max(
              newRowCount(p, 'ce'),
              newRowCount(p, 'oe'),
              newRowCount(p, 'verbatim'),
            )
            return (
              <div
                key={p.id}
                className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
              >
                <Link to={`/projects/${p.id}`} className="block">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                      <FolderKanban size={20} />
                    </div>
                    <div className="ml-auto"><NewRowsBadge count={p.rawMeta ? pendingRows : 0} /></div>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-700">
                    {p.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {p.client ? `CI: ${p.client}` : 'ไม่ระบุ CI'} ·{' '}
                    {new Date(p.createdAt).toLocaleDateString('th-TH')}
                  </p>
                  {p.programmer ? (
                    <p className="mt-0.5 text-xs text-slate-400">Programmer: {p.programmer}</p>
                  ) : null}
                  <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <FileSpreadsheet size={15} className={p.rawMeta ? 'text-emerald-500' : 'text-slate-300'} />
                      {p.rawMeta ? `${p.rawMeta.rowCount} แถว` : 'ยังไม่มี Rawdata'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Layers size={15} className={cfCount ? 'text-indigo-500' : 'text-slate-300'} />
                      {cfCount} Codeframe
                    </span>
                    <ChevronRight size={16} className="ml-auto text-slate-300 group-hover:text-indigo-400" />
                  </div>
                </Link>
                <button
                  title="ลบโปรเจกต์"
                  onClick={() => setDeleting(p)}
                  className="absolute top-4 right-4 cursor-pointer rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="สร้างโปรเจกต์ใหม่">
        <form onSubmit={submit}>
          <Field label="ชื่อโปรเจกต์ *">
            <TextInput
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น Starry Sky 3"
            />
          </Field>
          <Field label="CI" hint="ไม่บังคับ">
            <TextInput
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="เช่น Kao, Attack"
            />
          </Field>
          <Field label="Programmer" hint="ไม่บังคับ">
            <TextInput
              value={programmer}
              onChange={(e) => setProgrammer(e.target.value)}
              placeholder="เช่น ชื่อผู้เขียนโปรแกรม"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              สร้างโปรเจกต์
            </Button>
          </div>
        </form>
      </Modal>

      <ExcludedVarsModal open={excludedOpen} onClose={() => setExcludedOpen(false)} />

      <ConfirmDelete
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteProject(deleting.id)}
        what={`โปรเจกต์ "${deleting?.name}"`}
      />
    </div>
  )
}

// ====== Popup: ตัวแปรที่ "ไม่ทำ Code" (global ทุกโปรเจกต์ · บันทึกลง Firestore) ======
function ExcludedVarsModal({ open, onClose }) {
  const { state, setExcludedVars } = useStore()
  const excluded = state.settings?.excludedVars ?? []
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')

  // เพิ่มได้ทีละหลายตัว (คั่นด้วย , เว้นวรรค หรือขึ้นบรรทัดใหม่)
  const addVars = () => {
    const parts = input.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    setExcludedVars([...excluded, ...parts])
    setInput('')
  }
  const removeVar = (name) => setExcludedVars(excluded.filter((v) => v !== name))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return excluded.filter((v) => !q || v.toLowerCase().includes(q))
  }, [excluded, search])

  return (
    <Modal open={open} onClose={onClose} title="ตัวแปรที่ไม่ทำ Code (ทุกโปรเจกต์)" wide>
      <p className="-mt-1 mb-4 text-xs text-slate-500">
        ใส่ชื่อตัวแปร (เช่น <code className="rounded bg-slate-100 px-1">SbjNum</code>,{' '}
        <code className="rounded bg-slate-100 px-1">Duration</code>) ที่จะให้ระบบ
        <b> ข้าม</b> ตอนสร้าง Codeframe อัตโนมัติ — มีผลกับทุกโปรเจกต์ และบันทึกลง Database อัตโนมัติ
      </p>

      <Field label="เพิ่มตัวแปร" hint="พิมพ์หลายตัวพร้อมกันได้ คั่นด้วยเว้นวรรค , หรือขึ้นบรรทัดใหม่ แล้วกด Enter">
        <div className="flex gap-2">
          <TextInput
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVars() } }}
            placeholder="เช่น SbjNum, Filter, Duration"
          />
          <Button className="shrink-0" onClick={addVars} disabled={!input.trim()}>
            <Plus size={15} /> เพิ่ม
          </Button>
        </div>
      </Field>

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700">
          รายการที่ตั้งไว้ <Badge color="indigo">{excluded.length}</Badge>
        </span>
        {excluded.length > 5 && (
          <div className="relative w-52">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา…"
              className="!py-1.5 !pl-8 text-xs"
            />
          </div>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2">
        {excluded.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-slate-400">
            ยังไม่มีตัวแปรที่ห้ามทำ Code — เพิ่มด้านบนได้เลย
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-slate-400">ไม่พบ "{search}"</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {filtered.map((v) => (
              <span
                key={v}
                className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm"
              >
                {v}
                <button
                  title="ลบ"
                  onClick={() => removeVar(v)}
                  className="cursor-pointer rounded text-slate-300 hover:text-rose-500"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>เสร็จสิ้น</Button>
      </div>
    </Modal>
  )
}
