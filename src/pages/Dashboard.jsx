/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FolderKanban, Plus, Trash2, ChevronRight, FileSpreadsheet, Layers,
  SlidersHorizontal, Search, X, ShieldCheck, HelpCircle,
} from 'lucide-react'
import { useStore } from '../store.jsx'
import { useAuth } from '../lib/auth.jsx'
import { newRowCount } from '../lib/boxes.js'
import {
  Button, Modal, Field, TextInput, EmptyState, ConfirmDelete, NewRowsBadge, Badge,
} from '../components/ui.jsx'

export default function Dashboard() {
  const navigate = useNavigate()
  const { state, addProject, updateProject, deleteProject } = useStore()
  const { user, isAdmin } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [permissionProject, setPermissionProject] = useState(null)
  const [memberToAdd, setMemberToAdd] = useState('')
  const [editingProjectId, setEditingProjectId] = useState('')
  const [editDraft, setEditDraft] = useState({})
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [programmer, setProgrammer] = useState('')
  const [clientDueDate, setClientDueDate] = useState('')
  const [programmerDueDate, setProgrammerDueDate] = useState('')
  const [jobSearch, setJobSearch] = useState('')
  const [jobPage, setJobPage] = useState(1)
  const [viewMode, setViewMode] = useState(() => {
    try { return window.localStorage.getItem('cof-dashboard-view') || 'table' } catch { return 'table' }
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpStep, setHelpStep] = useState(0)
  const [createGuideOpen, setCreateGuideOpen] = useState(false)
  const [createGuideStep, setCreateGuideStep] = useState(0)

  const setDashboardView = (mode) => {
    setViewMode(mode)
    try { window.localStorage.setItem('cof-dashboard-view', mode) } catch { /* localStorage may be unavailable */ }
  }

  const resetCreateForm = () => {
    setName('')
    setClient('')
    setProgrammer('')
    setClientDueDate('')
    setProgrammerDueDate('')
  }

  const closeCreate = () => {
    resetCreateForm()
    setCreateOpen(false)
  }

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    addProject({
      name: name.trim(),
      client: client.trim(),
      programmer: programmer.trim(),
      clientDueDate: clientDueDate || '',
      programmerDueDate: programmerDueDate || '',
    })
    closeCreate()
  }

  const formatDate = (value) => {
    if (!value) return '—'
    const d = new Date(`${value}T00:00:00`)
    if (Number.isNaN(d.getTime())) return value
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = String(d.getFullYear())
    return `${dd}/${mm}/${yyyy}`
  }

  const parseDateText = (text, fallback = '') => {
    const v = String(text || '').trim()
    if (!v || v === '—') return ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
    const m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (!m) return fallback
    const dd = m[1].padStart(2, '0')
    const mm = m[2].padStart(2, '0')
    const yyyy = m[3]
    const iso = `${yyyy}-${mm}-${dd}`
    const d = new Date(`${iso}T00:00:00`)
    return Number.isNaN(d.getTime()) ? fallback : iso
  }

  const formatTimestamp = (value) => {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = String(d.getFullYear())
    return `${dd}/${mm}/${yyyy}`
  }

  const projectRows = state.projects.map((p) => {
    const cfCount = state.codeframes.filter((c) => c.projectId === p.id).length
    const pendingRows = Math.max(
      newRowCount(p, 'ce'),
      newRowCount(p, 'oe'),
      newRowCount(p, 'verbatim'),
    )
    return { ...p, cfCount, pendingRows }
  })
  const normalizedJobSearch = jobSearch.trim().toLowerCase()
  const filteredProjectRows = normalizedJobSearch
    ? projectRows.filter((p) => [
        p.id,
        p.name,
        p.client,
        p.programmer,
        p.ownerEmail,
        ...(p.sharedWithEmails ?? []),
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(normalizedJobSearch)))
    : projectRows
  const jobsPerPage = 10
  const totalJobPages = Math.max(1, Math.ceil(filteredProjectRows.length / jobsPerPage))
  const safeJobPage = Math.min(jobPage, totalJobPages)
  const visibleProjectRows = filteredProjectRows.slice((safeJobPage - 1) * jobsPerPage, safeJobPage * jobsPerPage)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueSoonLimit = new Date(today)
  dueSoonLimit.setDate(dueSoonLimit.getDate() + 7)
  const dashboardStats = {
    jobs: projectRows.length,
    rawReady: projectRows.filter((p) => (p.rawMeta?.rowCount ?? 0) > 0).length,
    totalRows: projectRows.reduce((sum, p) => sum + (p.rawMeta?.rowCount ?? 0), 0),
    pendingJobs: projectRows.filter((p) => p.pendingRows > 0).length,
    codeframes: projectRows.reduce((sum, p) => sum + p.cfCount, 0),
    dueSoon: projectRows.filter((p) => {
      const dates = [p.clientDueDate, p.programmerDueDate].filter(Boolean).map((v) => new Date(`${v}T00:00:00`)).filter((d) => !Number.isNaN(d.getTime()))
      return dates.some((d) => d <= dueSoonLimit)
    }).length,
  }

  const canManageProject = (project) => isAdmin || project.ownerUid === user?.uid || (!project.ownerUid && !project.ownerEmail)
  const approvedMembers = (state.members ?? []).filter((m) => m.status === 'approved' && m.email)
  const availablePermissionMembers = permissionProject
    ? approvedMembers.filter((m) => m.id !== permissionProject.ownerUid && !(permissionProject.sharedWithUids ?? []).includes(m.id))
    : []

  const openPermissionModal = (project) => {
    setPermissionProject(project)
    setMemberToAdd('')
  }

  const addPermission = () => {
    if (!permissionProject || !memberToAdd) return
    const member = approvedMembers.find((m) => m.id === memberToAdd)
    if (!member) return
    updateProject(permissionProject.id, {
      sharedWithUids: [...new Set([...(permissionProject.sharedWithUids ?? []), member.id])],
      sharedWithEmails: [...new Set([...(permissionProject.sharedWithEmails ?? []), member.email])],
    })
    setPermissionProject((p) => p ? {
      ...p,
      sharedWithUids: [...new Set([...(p.sharedWithUids ?? []), member.id])],
      sharedWithEmails: [...new Set([...(p.sharedWithEmails ?? []), member.email])],
    } : p)
    setMemberToAdd('')
  }

  const removePermission = (memberId) => {
    if (!permissionProject) return
    const member = approvedMembers.find((m) => m.id === memberId)
    const nextUids = (permissionProject.sharedWithUids ?? []).filter((id) => id !== memberId)
    const nextEmails = (permissionProject.sharedWithEmails ?? []).filter((email) => email !== member?.email)
    updateProject(permissionProject.id, { sharedWithUids: nextUids, sharedWithEmails: nextEmails })
    setPermissionProject((p) => p ? { ...p, sharedWithUids: nextUids, sharedWithEmails: nextEmails } : p)
  }

  const startEditProject = (project) => {
    setEditingProjectId(project.id)
    setEditDraft({
      name: project.name || '',
      client: project.client || '',
      clientDueDate: project.clientDueDate ? formatDate(project.clientDueDate) : '',
      programmer: project.programmer || '',
      programmerDueDate: project.programmerDueDate ? formatDate(project.programmerDueDate) : '',
    })
  }

  const cancelEditProject = () => {
    setEditingProjectId('')
    setEditDraft({})
  }

  const saveEditProject = (project) => {
    const patch = {
      name: String(editDraft.name || '').trim() || project.name,
      client: String(editDraft.client || '').trim(),
      clientDueDate: parseDateText(editDraft.clientDueDate, project.clientDueDate || ''),
      programmer: String(editDraft.programmer || '').trim(),
      programmerDueDate: parseDateText(editDraft.programmerDueDate, project.programmerDueDate || ''),
    }
    updateProject(project.id, patch)
    cancelEditProject()
  }

  const setEditValue = (key, value) => {
    setEditDraft((draft) => ({ ...draft, [key]: value }))
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      {/* Hero */}
      <div data-tour="dashboard-hero" className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 p-8 text-white shadow-lg shadow-indigo-200">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold sm:text-3xl">โปรเจกต์การทำงาน</h1>
            <p className="mt-2 max-w-xl text-sm text-indigo-100">
              1 โปรเจกต์ = 4 กล่องบนข้อมูลก้อนเดียวกัน — Rawdata (ศูนย์กลาง), CE, OE และ Verbatim
            </p>
          </div>
          <div className="flex rounded-2xl bg-white/10 p-1 text-xs font-black backdrop-blur">
            <button
              type="button"
              onClick={() => setDashboardView('table')}
              className={`rounded-xl px-3 py-2 transition ${viewMode === 'table' ? 'bg-white text-indigo-700 shadow' : 'text-white/80 hover:bg-white/10'}`}
            >
              ตาราง Job
            </button>
            <button
              type="button"
              onClick={() => setDashboardView('card')}
              className={`rounded-xl px-3 py-2 transition ${viewMode === 'card' ? 'bg-white text-indigo-700 shadow' : 'text-white/80 hover:bg-white/10'}`}
            >
              การ์ด
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Button
            data-tour="create-project"
            size="lg"
            className="!bg-white !text-indigo-700 hover:!bg-indigo-50 !shadow-none"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={18} /> สร้างโปรเจกต์ใหม่
          </Button>
          <button
            data-tour="excluded-vars"
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
          <Link
            to="/ops"
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/40 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <ShieldCheck size={16} /> Ops Center
          </Link>
        </div>
      </div>

      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="COF operation summary">
        {[
          { label: 'Jobs ทั้งหมด', value: dashboardStats.jobs.toLocaleString('th-TH'), hint: 'งานในระบบ', tone: 'slate' },
          { label: 'Rawdata ready', value: dashboardStats.rawReady.toLocaleString('th-TH'), hint: `${dashboardStats.totalRows.toLocaleString('th-TH')} rows`, tone: 'emerald' },
          { label: 'Codeframes', value: dashboardStats.codeframes.toLocaleString('th-TH'), hint: 'โครงที่สร้างแล้ว', tone: 'indigo' },
          { label: 'Pending coding', value: dashboardStats.pendingJobs.toLocaleString('th-TH'), hint: 'Jobs มีแถวใหม่/รอทำ', tone: dashboardStats.pendingJobs ? 'amber' : 'emerald' },
          { label: 'Due ≤ 7 days', value: dashboardStats.dueSoon.toLocaleString('th-TH'), hint: 'CI/Programmer', tone: dashboardStats.dueSoon ? 'rose' : 'slate' },
        ].map((item) => {
          const tone = {
            slate: 'border-slate-200 bg-white text-slate-900',
            emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
            indigo: 'border-indigo-200 bg-indigo-50/70 text-indigo-900',
            amber: 'border-amber-200 bg-amber-50/80 text-amber-900',
            rose: 'border-rose-200 bg-rose-50/80 text-rose-900',
          }[item.tone]
          return (
            <div key={item.label} className={`rounded-2xl border px-4 py-3 shadow-sm ${tone}`}>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] opacity-60">{item.label}</p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="text-2xl font-black tabular-nums">{item.value}</p>
                <p className="pb-1 text-xs font-bold opacity-60">{item.hint}</p>
              </div>
            </div>
          )
        })}
      </section>

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
      ) : viewMode === 'table' ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Project List</h2>
              <p className="text-xs font-semibold text-slate-500">แก้วันที่ส่ง CI / Programmer ได้จากตารางนี้เลย ไม่บังคับกรอก</p>
            </div>
            <div className="ml-auto flex min-w-[18rem] flex-wrap items-center justify-end gap-2">
              <div className="relative min-w-[14rem] flex-1 sm:flex-none">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={jobSearch}
                  onChange={(e) => { setJobSearch(e.target.value); setJobPage(1) }}
                  placeholder="Search Job"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                {filteredProjectRows.length.toLocaleString('th-TH')} Jobs
              </div>
            </div>
          </div>
          <div className="overflow-hidden">
            <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[18%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="bg-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap">Project Type</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap">Job Name</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap">CI</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap">ส่ง CI</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap">Programmer</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap">ส่ง Programmer</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap text-right">Raw Rows</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap text-right">Codeframes</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap text-right">Pending</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap">Created</th>
                  <th className="border-b border-slate-200 px-2 py-2.5 whitespace-nowrap text-right">Permission</th>
                </tr>
              </thead>
              <tbody>
                {visibleProjectRows.map((p, index) => (
                  <tr key={p.id} data-tour={index === 0 ? 'project-card' : undefined} className={`${index % 2 ? 'bg-slate-50/60' : 'bg-white'} h-12 hover:bg-indigo-50/70`}>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap text-xs font-bold text-slate-500">Single</td>
                    <td className="truncate border-b border-slate-100 px-2 py-2 whitespace-nowrap font-bold text-slate-900" title={p.name}>
                      {editingProjectId === p.id ? (
                        <input
                          value={editDraft.name ?? ''}
                          onChange={(e) => setEditValue('name', e.target.value)}
                          className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        />
                      ) : (
                        <Link to={`/projects/${p.id}`} className="hover:text-indigo-700 hover:underline">{p.name}</Link>
                      )}
                    </td>
                    <td className="truncate border-b border-slate-100 px-2 py-2 whitespace-nowrap text-slate-600" title={p.client || '—'}>
                      {editingProjectId === p.id ? (
                        <input value={editDraft.client ?? ''} onChange={(e) => setEditValue('client', e.target.value)} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                      ) : (p.client || '—')}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap">
                      {editingProjectId === p.id ? (
                        <input
                          type="date"
                          value={editDraft.clientDueDate ?? ''}
                          onChange={(e) => setEditValue('clientDueDate', e.target.value)}
                          className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        />
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-600">{formatDate(p.clientDueDate)}</span>
                      )}
                    </td>
                    <td className="truncate border-b border-slate-100 px-2 py-2 whitespace-nowrap text-slate-600" title={p.programmer || '—'}>
                      {editingProjectId === p.id ? (
                        <input value={editDraft.programmer ?? ''} onChange={(e) => setEditValue('programmer', e.target.value)} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                      ) : (p.programmer || '—')}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap">
                      {editingProjectId === p.id ? (
                        <input
                          type="date"
                          value={editDraft.programmerDueDate ?? ''}
                          onChange={(e) => setEditValue('programmerDueDate', e.target.value)}
                          className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        />
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-600">{formatDate(p.programmerDueDate)}</span>
                      )}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap text-right font-semibold text-slate-600">{(p.rawMeta?.rowCount ?? 0).toLocaleString('th-TH')}</td>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap text-right font-semibold text-slate-600">{p.cfCount.toLocaleString('th-TH')}</td>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-black ${p.pendingRows ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {p.pendingRows.toLocaleString('th-TH')}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap text-xs font-semibold text-slate-500">{formatTimestamp(p.createdAt)}</td>
                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        {editingProjectId === p.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEditProject(p)}
                              className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-black text-white hover:bg-emerald-700"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditProject}
                              className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-200"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            {canManageProject(p) ? (
                              <button
                                type="button"
                                title="Edit Project"
                                onClick={() => startEditProject(p)}
                                className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700 hover:bg-blue-100"
                              >
                                Edit
                              </button>
                            ) : null}
                            {canManageProject(p) ? (
                              <button
                                type="button"
                                title="Add Permission"
                                onClick={() => openPermissionModal(p)}
                                className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700 hover:bg-emerald-100"
                              >
                                Add Permission
                              </button>
                            ) : null}
                            {canManageProject(p) ? (
                              <button
                                title="ลบโปรเจกต์"
                                onClick={() => setDeleting(p)}
                                className="rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                              >
                                <Trash2 size={13} />
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredProjectRows.length === 0 ? (
            <div className="border-t border-slate-100 px-4 py-8 text-center text-sm font-semibold text-slate-400">
              ไม่พบ Job ที่ค้นหา
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500">
            <span>
              แสดง {filteredProjectRows.length ? ((safeJobPage - 1) * jobsPerPage + 1).toLocaleString('th-TH') : 0}–{Math.min(safeJobPage * jobsPerPage, filteredProjectRows.length).toLocaleString('th-TH')} จาก {filteredProjectRows.length.toLocaleString('th-TH')} Jobs
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safeJobPage <= 1}
                onClick={() => setJobPage((v) => Math.max(1, v - 1))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-black text-slate-700">
                {safeJobPage}/{totalJobPages}
              </span>
              <button
                type="button"
                disabled={safeJobPage >= totalJobPages}
                onClick={() => setJobPage((v) => Math.min(totalJobPages, v + 1))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProjectRows.map((p, idx) => (
            <div
              key={p.id}
              data-tour={idx === 0 ? 'project-card' : undefined}
              className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <Link to={`/projects/${p.id}`} className="block">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                    <FolderKanban size={20} />
                  </div>
                  <div className="ml-auto"><NewRowsBadge count={p.rawMeta ? p.pendingRows : 0} /></div>
                </div>
                <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-700">{p.name}</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  {p.client ? `CI: ${p.client}` : 'ไม่ระบุ CI'} · {formatTimestamp(p.createdAt)}
                </p>
                {p.programmer ? <p className="mt-0.5 text-xs text-slate-400">Programmer: {p.programmer}</p> : null}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-500">
                  <span className="rounded-lg bg-slate-50 px-2 py-1">ส่ง CI: {formatDate(p.clientDueDate)}</span>
                  <span className="rounded-lg bg-slate-50 px-2 py-1">ส่ง Programmer: {formatDate(p.programmerDueDate)}</span>
                </div>
                <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <FileSpreadsheet size={15} className={p.rawMeta ? 'text-emerald-500' : 'text-slate-300'} />
                    {p.rawMeta ? `${p.rawMeta.rowCount} แถว` : 'ยังไม่มี Rawdata'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Layers size={15} className={p.cfCount ? 'text-indigo-500' : 'text-slate-300'} />
                    {p.cfCount} Codeframe
                  </span>
                  <ChevronRight size={16} className="ml-auto text-slate-300 group-hover:text-indigo-400" />
                </div>
              </Link>
              {canManageProject(p) ? (
                <button
                  title="ลบโปรเจกต์"
                  onClick={() => setDeleting(p)}
                  className="absolute top-4 right-4 cursor-pointer rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          ))}
          {visibleProjectRows.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-400">
              ไม่พบ Job ที่ค้นหา
            </div>
          ) : null}
          <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500">
            <span>แสดงสูงสุด 10 โปรเจกต์ต่อหน้า</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={safeJobPage <= 1} onClick={() => setJobPage((v) => Math.max(1, v - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-black disabled:opacity-40">Prev</button>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-black text-slate-700">{safeJobPage}/{totalJobPages}</span>
              <button type="button" disabled={safeJobPage >= totalJobPages} onClick={() => setJobPage((v) => Math.min(totalJobPages, v + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-black disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={closeCreate} title="สร้างโปรเจกต์ใหม่">
        <form onSubmit={submit}>
          <div data-tour="create-name">
            <Field label="ชื่อโปรเจกต์ *">
              <TextInput
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น Starry Sky 3"
              />
            </Field>
          </div>
          <div data-tour="create-ci">
            <Field label="CI" hint="ไม่บังคับ">
              <TextInput
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="เช่น Kao, Attack"
              />
            </Field>
          </div>
          <Field label="วันที่ต้องส่ง CI" hint="ไม่บังคับ ใส่ทีหลังในตารางได้">
            <input
              type="date"
              value={clientDueDate}
              onChange={(e) => setClientDueDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </Field>
          <div data-tour="create-programmer">
            <Field label="Programmer" hint="ไม่บังคับ">
              <TextInput
              value={programmer}
              onChange={(e) => setProgrammer(e.target.value)}
              placeholder="เช่น ชื่อผู้เขียนโปรแกรม"
              />
            </Field>
          </div>
          <Field label="วันที่ต้องส่ง Programmer" hint="ไม่บังคับ ใส่ทีหลังในตารางได้">
            <input
              type="date"
              value={programmerDueDate}
              onChange={(e) => setProgrammerDueDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </Field>
          <div data-tour="create-submit" className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeCreate}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              สร้างโปรเจกต์
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!permissionProject} onClose={() => setPermissionProject(null)} title="Add Permission">
        {permissionProject ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-black text-slate-900">{permissionProject.name}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Owner: {permissionProject.ownerEmail || '—'} · Shared {permissionProject.sharedWithUids?.length ?? 0} คน
              </p>
            </div>

            <Field label="เลือก Email สมาชิกในระบบ" hint="เลือกได้เฉพาะสมาชิกที่ approved แล้ว ไม่ให้กรอกเอง">
              <div className="flex gap-2">
                <select
                  value={memberToAdd}
                  onChange={(e) => setMemberToAdd(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="">เลือก Email…</option>
                  {availablePermissionMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.email} {m.displayName ? `· ${m.displayName}` : ''}
                    </option>
                  ))}
                </select>
                <Button type="button" disabled={!memberToAdd} onClick={addPermission}>
                  Add
                </Button>
              </div>
              {!availablePermissionMembers.length ? (
                <p className="mt-2 text-xs font-semibold text-amber-600">ไม่มีสมาชิกที่พร้อมให้เพิ่ม หรือเพิ่มครบแล้ว</p>
              ) : null}
            </Field>

            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">คนที่เห็น Job นี้</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-bold text-indigo-800">{permissionProject.ownerEmail || 'Owner'}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-indigo-700">OWNER</span>
                </div>
                {(permissionProject.sharedWithUids ?? []).map((uid) => {
                  const m = approvedMembers.find((x) => x.id === uid)
                  const email = m?.email || (permissionProject.sharedWithEmails ?? [])[0] || uid
                  return (
                    <div key={uid} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{email}</span>
                      <button
                        type="button"
                        onClick={() => removePermission(uid)}
                        className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-black text-rose-600 hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <ExcludedVarsModal open={excludedOpen} onClose={() => setExcludedOpen(false)} />

      <button
        type="button"
        onClick={() => { setHelpStep(0); setHelpOpen(true) }}
        className="fixed bottom-5 right-5 z-[80] flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-2xl shadow-indigo-300 ring-4 ring-white/80 transition hover:-translate-y-0.5 hover:shadow-indigo-400"
        aria-label="เปิดคู่มือแนะนำหน้า Dashboard"
        title="คู่มือแนะนำ"
      >
        <HelpCircle size={26} />
      </button>

      <DashboardHelpGuide
        open={helpOpen}
        step={helpStep}
        setStep={setHelpStep}
        hasProjects={projectRows.length > 0}
        firstProjectId={visibleProjectRows[0]?.id || projectRows[0]?.id}
        onOpenCreateProject={() => { setCreateOpen(true); setCreateGuideStep(0); setCreateGuideOpen(true) }}
        onEnterProject={(id) => {
          if (!id) { setCreateOpen(true); setCreateGuideStep(0); setCreateGuideOpen(true); return }
          try { window.localStorage.setItem('cof-project-tour-autostart', '1') } catch { /* ignore */ }
          navigate(`/projects/${id}`)
        }}
        onClose={() => setHelpOpen(false)}
      />

      <CreateJobFieldGuide
        open={createGuideOpen && createOpen}
        step={createGuideStep}
        setStep={setCreateGuideStep}
        setName={setName}
        setClient={setClient}
        setProgrammer={setProgrammer}
        onClose={() => { setCreateGuideOpen(false); resetCreateForm() }}
      />

      <ConfirmDelete
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteProject(deleting.id)}
        what={`โปรเจกต์ "${deleting?.name}"`}
      />
    </div>
  )
}

const DASHBOARD_HELP_STEPS = [
  {
    label: '01',
    target: 'dashboard-hero',
    title: 'ภาพรวมหน้าแรก',
    page: 'Dashboard',
    mock: 'dashboard',
    text: 'หน้าแรกคือศูนย์รวม Job ทั้งหมด ใช้สร้างงานใหม่ เปิดงานเดิม ดู Raw rows, Codeframes, Pending rows และเข้าเมนูตั้งค่าหลัก',
    bullets: ['ดูจำนวนงานรวม', 'เปิด Job เดิม', 'เริ่มสร้าง Job ใหม่', 'ดูสถานะงานที่ยังต้อง Coding'],
    iconClass: 'bg-indigo-500 text-white shadow-indigo-200',
    chipClass: 'bg-indigo-50 text-indigo-700',
  },
  {
    label: '02',
    target: 'create-project',
    title: 'สาธิตสร้าง Job',
    page: 'Create Job',
    mock: 'create',
    realCreate: true,
    text: 'ขั้นนี้ให้กดเปิดฟอร์มสร้าง Job จริงได้เลย ใส่ชื่อโปรเจกต์, CI, Programmer แล้วกดสร้างโปรเจกต์ จากนั้นจะมีการ์ด Job ให้เข้าไปทำงานต่อ',
    bullets: ['ชื่อโปรเจกต์ = ชื่องาน/ชื่อไฟล์', 'CI ใส่ชื่อลูกค้าหรือทีม', 'Programmer ใส่คนรับผิดชอบ', 'สร้างแล้วกดการ์ด Job เพื่อเข้าไปอัปโหลด Rawdata'],
    iconClass: 'bg-emerald-500 text-white shadow-emerald-200',
    chipClass: 'bg-emerald-50 text-emerald-700',
  },
  {
    label: '03',
    target: 'project-card',
    fallback: 'create-project',
    title: 'การ์ด Job / เข้าเมนูจริง',
    page: 'Job Card',
    mock: 'jobcard',
    enterProject: true,
    text: 'นี่คือทางเข้า Job จริง กด Next จากขั้นตอนนี้แล้วระบบจะพาเข้า Job Hub ของโปรเจกต์จริง และเปิด Tour ต่อในหน้านั้นทันที',
    bullets: ['New badge = มีแถวใหม่รอตรวจ', 'Rawdata แสดงจำนวนแถว', 'Codeframe แสดงจำนวนเฟรมที่สร้าง', 'กด Next เพื่อเข้าเมนู Job จริง'],
    iconClass: 'bg-amber-500 text-white shadow-amber-200',
    chipClass: 'bg-amber-50 text-amber-700',
  },
  {
    label: '04',
    target: 'project-card',
    fallback: 'dashboard-hero',
    title: 'หน้า Job Hub หลังเข้า Job',
    page: 'Job Hub',
    mock: 'hub',
    text: 'หน้า Job Hub คือหน้าจัดการงานเดียว: อัปโหลด Rawdata, ดู Status, แนบ Codebook, เข้า CE, และจด Notes งาน',
    bullets: ['Rawdata = ไฟล์ข้อมูลหลัก', 'Status = นับ Approved/Requires Approval', 'Codebook .sav = value labels', 'CE = จุดทำ Group Code และลง Code'],
    iconClass: 'bg-sky-500 text-white shadow-sky-200',
    chipClass: 'bg-sky-50 text-sky-700',
  },
  {
    label: '05',
    target: 'project-card',
    fallback: 'dashboard-hero',
    title: 'Rawdata / Status / Codebook',
    page: 'Data Setup',
    mock: 'rawdata',
    text: 'ก่อนลง Code ให้เตรียมข้อมูล: อัปโหลด Excel, ตรวจ Status, แนบ .sav ถ้ามี เพื่อให้ระบบรู้ Value Label และช่วยสร้าง Codeframe ได้ดีขึ้น',
    bullets: ['ดู Data = เปิดตาราง Rawdata', 'โหลดไฟล์ Data เพิ่ม = เปลี่ยน/เพิ่มข้อมูล', 'Export โจทย์ = ส่งรายการข้อ', 'แนบ Codebook = ใช้ SPSS labels ช่วย coding'],
    iconClass: 'bg-cyan-500 text-white shadow-cyan-200',
    chipClass: 'bg-cyan-50 text-cyan-700',
  },
  {
    label: '06',
    target: 'project-card',
    fallback: 'dashboard-hero',
    title: 'เข้า CE และเลือก Codeframe',
    page: 'CE Setup',
    mock: 'ce',
    text: 'กดกล่อง CE เพื่อเลือกข้อ สร้าง Codeframe หรือเปิด Codeframe เดิม จากนั้นเข้า Editor เพื่อดูคำตอบและ Code ทั้งหมด',
    bullets: ['เลือกชีท/ข้อที่ต้องการ Coding', 'สร้าง Codeframe CE other ได้', 'เลือกชีท CodeFrame ได้', 'Export Codeframe/Data จากหน้า Editor'],
    iconClass: 'bg-violet-500 text-white shadow-violet-200',
    chipClass: 'bg-violet-50 text-violet-700',
  },
  {
    label: '07',
    target: 'project-card',
    fallback: 'dashboard-hero',
    title: 'สอน Group Code ด้วย AI',
    page: 'Group CE Agent',
    mock: 'group',
    text: 'ในหน้า CE Editor ให้เปิดตารางคำตอบ แล้วกด Group CE Agent เพื่อให้ AI จัดกลุ่มคำตอบที่ยังไม่ได้ลง Code หรือกลุ่ม Other/specify',
    bullets: ['AI จะพยายามรวมคำตอบที่ความหมายเดียวกัน', 'ตรวจชื่อ Code ก่อนยืนยัน', 'แก้/ย้ายกลุ่มได้ถ้า AI จัดไม่ตรง', 'หลัง Group แล้วต้องดู Frequency/ตัวอย่างคำตอบ'],
    iconClass: 'bg-fuchsia-500 text-white shadow-fuchsia-200',
    chipClass: 'bg-fuchsia-50 text-fuchsia-700',
  },
  {
    label: '08',
    target: 'project-card',
    fallback: 'dashboard-hero',
    title: 'สอนลง Code เอง',
    page: 'Manual Coding',
    mock: 'manual',
    text: 'ถ้า AI จัดไม่ตรง ให้ลง Code เองจากตารางคำตอบ: คลิกขวาที่คำตอบเพื่อ Insert NewCode หรือ Move to existing Code',
    bullets: ['Insert NewCode = สร้าง Code ใหม่จากคำตอบนี้', 'Move to existing Code = ย้ายเข้ากลุ่มเดิม', 'ใช้กับคำตอบชื่อคน/แบรนด์/เหตุผลที่ต้องตรวจเอง', 'การแก้เองจะสะท้อนไป Frequency และ Export'],
    iconClass: 'bg-rose-500 text-white shadow-rose-200',
    chipClass: 'bg-rose-50 text-rose-700',
  },
  {
    label: '09',
    target: 'project-card',
    fallback: 'dashboard-hero',
    title: 'Export งานส่งต่อ',
    page: 'Export',
    mock: 'export',
    text: 'เมื่อ Coding เสร็จ ใช้ Export Codeframe หรือ Export Data เพื่อส่งลูกค้า/ทีม โดยคำถามและ Base Total จะถูกจัดรูปแบบตามที่ตั้งไว้',
    bullets: ['Export Codeframe = ตารางโจทย์และ Code', 'Export Data = Rawdata หลัง recode', 'เช็ก Base Total และ Frequency ก่อนส่ง', 'Code ใหม่ที่เพิ่มควรถูก highlight ใน export'],
    iconClass: 'bg-lime-500 text-white shadow-lime-200',
    chipClass: 'bg-lime-50 text-lime-700',
  },
  {
    label: '10',
    target: 'excluded-vars',
    title: 'เมนูเสริม: ตัวแปรไม่ทำ Code / Ops Center',
    page: 'Settings',
    mock: 'settings',
    text: 'เมนูเสริมบนหน้าแรกช่วยกันผิดพลาด: ตั้งตัวแปรที่ห้ามทำ Code และเข้า Ops Center เพื่อตรวจระบบ/สถานะ backend',
    bullets: ['ตัวแปรไม่ทำ Code ใช้ข้าม SbjNum/Duration/Filter', 'Ops Center ใช้ตรวจระบบและงานแอดมิน', 'ไม่ใช่หน้าลง Code หลัก', 'ใช้เมื่อตั้งค่าระบบหรือแก้ปัญหา'],
    iconClass: 'bg-slate-700 text-white shadow-slate-200',
    chipClass: 'bg-slate-100 text-slate-700',
  },
]

function DashboardHelpGuide({ open, step, setStep, onClose, hasProjects, firstProjectId, onEnterProject, onOpenCreateProject }) {
  const [spot, setSpot] = useState(null)
  const raw = DASHBOARD_HELP_STEPS[step] ?? DASHBOARD_HELP_STEPS[0]
  const current = !hasProjects && raw.target === 'project-card' ? { ...raw, target: raw.fallback || 'create-project' } : raw
  const isLast = step >= DASHBOARD_HELP_STEPS.length - 1

  useEffect(() => {
    if (!open) return undefined
    let mounted = true
    const findTarget = () => document.querySelector(`[data-tour="${current.target}"]`) || document.querySelector('[data-tour="dashboard-hero"]')
    const updateSpot = () => {
      const el = findTarget()
      if (!el) {
        if (mounted) setSpot(null)
        return
      }
      const rect = el.getBoundingClientRect()
      const pad = 8
      if (mounted) {
        setSpot({
          top: Math.max(10, rect.top - pad),
          left: Math.max(10, rect.left - pad),
          width: Math.min(window.innerWidth - 20, rect.width + pad * 2),
          height: Math.min(window.innerHeight - 20, rect.height + pad * 2),
          bottom: rect.bottom + pad,
        })
      }
    }
    findTarget()?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    const t1 = window.setTimeout(updateSpot, 120)
    const t2 = window.setTimeout(updateSpot, 420)
    window.addEventListener('resize', updateSpot)
    window.addEventListener('scroll', updateSpot, true)
    return () => {
      mounted = false
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', updateSpot)
      window.removeEventListener('scroll', updateSpot, true)
    }
  }, [open, current.target])

  if (!open) return null

  const handleNext = () => {
    if (current.realCreate) {
      onOpenCreateProject?.()
      return
    }
    if (current.enterProject) {
      onEnterProject?.(firstProjectId)
      return
    }
    if (isLast) onClose()
    else setStep(step + 1)
  }

  const modalStyle = spot
    ? (() => {
        const modalHeight = current.mock === 'create' ? 300 : 245
        const margin = 12
        const modalWidth = Math.min(window.innerWidth - margin * 2, 432)
        const belowTop = spot.bottom + 14
        const aboveTop = spot.top - modalHeight - 14
        const useAbove = belowTop + modalHeight > window.innerHeight && aboveTop > margin
        const top = Math.max(margin, Math.min(window.innerHeight - modalHeight - margin, useAbove ? aboveTop : belowTop))
        const desiredLeft = spot.left + spot.width / 2 - modalWidth / 2
        const left = Math.max(margin, Math.min(window.innerWidth - modalWidth - margin, desiredLeft))
        return {
          top: `${top}px`,
          left: `${left}px`,
          width: `${modalWidth}px`,
        }
      })()
    : { top: '50%', left: '12px', right: '12px', transform: 'translateY(-50%)' }

  return (
    <div className="fixed inset-0 z-[95] pointer-events-none">
      <div
        className="absolute rounded-[1.6rem] border-2 border-white bg-transparent shadow-[0_0_0_9999px_rgba(15,23,42,0.55),0_18px_70px_rgba(79,70,229,0.35)] ring-4 ring-indigo-400/70 transition-all duration-300"
        style={spot ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height } : { display: 'none' }}
      />

      <div
        className="pointer-events-auto fixed max-h-[calc(100vh-24px)] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/25 [animation:cs-pop_.22s_ease-out]"
        style={modalStyle}
      >
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400" />
        <div className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-lg ${current.iconClass}`}>
                <HelpCircle size={21} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${current.chipClass}`}>{current.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{current.page}</span>
                </div>
                <h3 className="mt-1 truncate text-base font-black text-slate-950">{current.title}</h3>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label="ปิดคู่มือ">
              <X size={17} />
            </button>
          </div>

          {current.mock === 'create' ? (
            <div className="mb-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-3 shadow-inner">
              <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-indigo-500">Mockup · สร้าง Job จริงให้ดู</p>
              <div className="space-y-2">
                <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                  <p className="text-[10px] font-black text-slate-400">ชื่อโปรเจกต์ *</p>
                  <p className="text-xs font-black text-slate-800">Starry Sky 3</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400">CI</p>
                    <p className="text-xs font-black text-slate-800">Kao</p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400">Programmer</p>
                    <p className="text-xs font-black text-slate-800">พี่ไอซ์</p>
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2 text-center text-xs font-black text-white shadow-lg shadow-indigo-200">
                  กดสร้างโปรเจกต์ → ได้การ์ด Job
                </div>
              </div>
            </div>
          ) : null}

          <p className="rounded-2xl bg-slate-50 p-3 text-sm font-semibold leading-relaxed text-slate-600">
            {current.text}
          </p>

          <div className="mt-3 grid gap-1.5">
            {current.bullets.slice(0, current.mock === 'create' ? 2 : 3).map((b) => (
              <div key={b} className="rounded-xl border border-slate-100 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 shadow-sm">
                {b}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5">
            {DASHBOARD_HELP_STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                className={`h-2 rounded-full transition-all ${i === step ? 'w-7 bg-indigo-600' : 'w-2 bg-slate-200 hover:bg-slate-300'}`}
                aria-label={`ไปคำแนะนำ ${i + 1}`}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              Skip
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button type="button" onClick={() => setStep(step - 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-2 text-sm font-black text-white shadow-lg shadow-indigo-200"
              >
                {current.realCreate ? 'เปิดฟอร์มจริง' : current.enterProject ? (firstProjectId ? 'เข้า Job จริง' : 'สร้าง Job ก่อน') : isLast ? 'Done' : 'Next'}
                <ChevronRight size={15} className="ce-cta-float" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TourMockup({ type }) {
  const stepPill = (text, active = false) => (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{text}</span>
  )
  const colorMap = {
    slate: 'bg-slate-100 text-slate-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    sky: 'bg-sky-50 text-sky-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    cyan: 'bg-cyan-50 text-cyan-700',
    violet: 'bg-violet-50 text-violet-700',
    fuchsia: 'bg-fuchsia-50 text-fuchsia-700',
    rose: 'bg-rose-50 text-rose-700',
    lime: 'bg-lime-50 text-lime-700',
  }
  const row = (left, right, color = 'slate') => (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
      <span className="text-xs font-bold text-slate-600">{left}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${colorMap[color] || colorMap.slate}`}>{right}</span>
    </div>
  )
  return (
    <div className="bg-[radial-gradient(circle_at_top,#eef2ff_0,#f8fafc_60%)] p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-400">Mockup preview</p>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-500 shadow-sm">ไม่ใช่ข้อมูลจริง</span>
      </div>
      <div className="overflow-hidden rounded-[1.5rem] border border-white bg-white/80 p-3 shadow-xl shadow-indigo-100">
        <div className="mb-3 flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </div>
        {type === 'create' ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-indigo-600 p-3 text-white"><p className="text-sm font-black">สร้างโปรเจกต์ใหม่</p><p className="text-xs text-indigo-100">ตัวอย่างกรอก Job</p></div>
            {row('ชื่อโปรเจกต์', 'Starry Sky 3', 'indigo')}
            {row('CI', 'Kao', 'sky')}
            {row('Programmer', 'พี่ไอซ์', 'emerald')}
            <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-2 text-center text-xs font-black text-white">สร้างโปรเจกต์</div>
          </div>
        ) : type === 'jobcard' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between"><span className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><FolderKanban size={18} /></span>{stepPill('New 8', true)}</div>
              <p className="font-black text-slate-900">Starry Sky 3</p><p className="text-xs text-slate-400">CI: Kao · วันนี้</p>
              <div className="mt-3 flex gap-3 text-xs font-bold text-slate-500"><span>180 แถว</span><span>2 Codeframe</span></div>
            </div>
            <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700">กดการ์ดนี้เพื่อเข้า Job Hub</p>
          </div>
        ) : type === 'hub' ? (
          <div className="grid gap-2">
            {stepPill('CE พร้อมเริ่ม', true)}
            <div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-sky-50 p-3 text-xs font-black text-sky-700">CE</div><div className="rounded-xl bg-slate-100 p-3 text-xs font-black text-slate-500">OE Coming Soon</div></div>
            <div className="rounded-xl bg-emerald-50 p-3 text-xs font-black text-emerald-700">Rawdata + Status</div>
            <div className="rounded-xl bg-indigo-50 p-3 text-xs font-black text-indigo-700">Project Notes</div>
          </div>
        ) : type === 'rawdata' ? (
          <div className="space-y-2">
            {row('Rawdata', '180 rows', 'emerald')}
            {row('Status', 'Approved 180', 'cyan')}
            {row('Codebook .sav', 'Value Labels', 'amber')}
            <div className="grid grid-cols-3 gap-1 text-center text-[10px] font-black"><span className="rounded-lg bg-white p-2">ดู Data</span><span className="rounded-lg bg-white p-2">โหลดเพิ่ม</span><span className="rounded-lg bg-white p-2">Export โจทย์</span></div>
          </div>
        ) : type === 'ce' ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-sky-600 p-3 text-sm font-black text-white">Codeframe CE other</div>
            <div className="flex gap-1 overflow-hidden">{stepPill('Sheet Q1', true)}{stepPill('Sheet Q2')}{stepPill('Sheet Q3')}</div>
            {row('ข้อในชีทนี้', 'Q28_1', 'sky')}
            {row('Export', 'Codeframe/Data', 'indigo')}
          </div>
        ) : type === 'group' ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-fuchsia-600 p-3 text-sm font-black text-white">Group CE Agent</div>
            {row('คำตอบรอจัดกลุ่ม', '42', 'fuchsia')}
            {row('AI รวม alias/typo', 'ตรวจแล้ว', 'emerald')}
            {row('สร้าง New Code', 'เฉพาะจำเป็น', 'amber')}
          </div>
        ) : type === 'manual' ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs font-black text-slate-700">คำตอบ: “บอนด์ ณราวิชย์”</p></div>
            <div className="rounded-xl bg-slate-900 p-3 text-xs font-black text-white">คลิกขวา → Insert NewCode / Move to existing Code</div>
            {row('Frequency', 'อัปเดตทันที', 'rose')}
          </div>
        ) : type === 'export' ? (
          <div className="space-y-2">
            {row('Questions + Codes', 'Base Total สีเขียว', 'lime')}
            {row('Export Data', 'Recode แล้ว', 'emerald')}
            {row('New Code', 'Highlight', 'amber')}
            <div className="rounded-xl bg-lime-600 p-2 text-center text-xs font-black text-white">Download Excel</div>
          </div>
        ) : type === 'settings' ? (
          <div className="space-y-2">
            {row('ตัวแปรไม่ทำ Code', 'SbjNum, Duration', 'slate')}
            {row('Ops Center', 'Admin', 'indigo')}
            {row('AI Provider', 'Qwen/OpenRouter', 'violet')}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-2xl bg-indigo-600 p-3 text-white"><p className="font-black">Dashboard</p><p className="text-xs text-indigo-100">สร้าง Job → เข้า Job → CE → Export</p></div>
            <div className="grid grid-cols-3 gap-2"><div className="rounded-xl bg-white p-3 text-center text-xs font-black">Raw rows</div><div className="rounded-xl bg-white p-3 text-center text-xs font-black">Codeframes</div><div className="rounded-xl bg-white p-3 text-center text-xs font-black">Pending</div></div>
          </div>
        )}
      </div>
    </div>
  )
}


const CREATE_JOB_GUIDE_STEPS = [
  {
    label: '01',
    target: 'create-name',
    title: 'จำลองกรอกชื่อโปรเจกต์',
    text: 'Tour จะกรอกตัวอย่างลงช่องจริงให้ดู เช่น Starry Sky 3 ช่องนี้จำเป็น ถ้าไม่กรอกปุ่มสร้างโปรเจกต์จะยังใช้ไม่ได้',
  },
  {
    label: '02',
    target: 'create-ci',
    title: 'จำลองกรอก CI / ลูกค้า',
    text: 'Tour จะเติมตัวอย่าง CI ให้ดู เช่น Kao ช่องนี้ไม่บังคับ ใช้เพื่อแยกงานตามลูกค้าหรือทีม',
  },
  {
    label: '03',
    target: 'create-programmer',
    title: 'จำลองกรอก Programmer',
    text: 'Tour จะเติมตัวอย่าง Programmer ให้ดู เช่น พี่ไอซ์ ช่องนี้ไม่บังคับ ใช้บอกคนรับผิดชอบงาน',
  },
  {
    label: '04',
    target: 'create-submit',
    title: 'ปุ่มสร้างโปรเจกต์จริง',
    text: 'เมื่อถึงขั้นนี้จะเห็นปุ่มสร้างโปรเจกต์พร้อมใช้งาน แต่ Tour จะไม่กดสร้างข้อมูลปลอมให้ พอกดจบหรือ Skip จะล้างค่าจำลองออกทั้งหมด',
  },
]

function CreateJobFieldGuide({ open, step, setStep, setName, setClient, setProgrammer, onClose }) {
  const [spot, setSpot] = useState(null)
  const current = CREATE_JOB_GUIDE_STEPS[step] ?? CREATE_JOB_GUIDE_STEPS[0]
  const isLast = step >= CREATE_JOB_GUIDE_STEPS.length - 1

  useEffect(() => {
    if (!open) return
    if (step >= 0) setName?.('Starry Sky 3')
    if (step >= 1) setClient?.('Kao')
    if (step >= 2) setProgrammer?.('พี่ไอซ์')
  }, [open, step, setName, setClient, setProgrammer])

  useEffect(() => {
    if (!open) return undefined
    let mounted = true
    const updateSpot = () => {
      const el = document.querySelector(`[data-tour="${current.target}"]`)
      if (!el) {
        if (mounted) setSpot(null)
        return
      }
      const rect = el.getBoundingClientRect()
      const pad = 7
      if (mounted) {
        setSpot({
          top: Math.max(10, rect.top - pad),
          left: Math.max(10, rect.left - pad),
          width: Math.min(window.innerWidth - 20, rect.width + pad * 2),
          height: Math.min(window.innerHeight - 20, rect.height + pad * 2),
          bottom: rect.bottom + pad,
        })
      }
    }
    document.querySelector(`[data-tour="${current.target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    const t1 = window.setTimeout(updateSpot, 80)
    const t2 = window.setTimeout(updateSpot, 260)
    window.addEventListener('resize', updateSpot)
    window.addEventListener('scroll', updateSpot, true)
    return () => {
      mounted = false
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', updateSpot)
      window.removeEventListener('scroll', updateSpot, true)
    }
  }, [open, current.target])

  if (!open) return null

  const modalStyle = spot
    ? (() => {
        const modalHeight = 170
        const margin = 12
        const modalWidth = Math.min(window.innerWidth - margin * 2, 360)
        const belowTop = spot.bottom + 10
        const aboveTop = spot.top - modalHeight - 10
        const useAbove = belowTop + modalHeight > window.innerHeight && aboveTop > margin
        const top = Math.max(margin, Math.min(window.innerHeight - modalHeight - margin, useAbove ? aboveTop : belowTop))
        const desiredLeft = spot.left + spot.width / 2 - modalWidth / 2
        const left = Math.max(margin, Math.min(window.innerWidth - modalWidth - margin, desiredLeft))
        return { top: `${top}px`, left: `${left}px`, width: `${modalWidth}px` }
      })()
    : { top: '50%', left: '12px', right: '12px', transform: 'translateY(-50%)' }

  return (
    <div className="fixed inset-0 z-[95] pointer-events-none">
      <div
        className="absolute rounded-2xl border-2 border-white bg-transparent shadow-[0_0_0_9999px_rgba(15,23,42,0.45),0_18px_70px_rgba(79,70,229,0.35)] ring-4 ring-emerald-400/70 transition-all duration-300"
        style={spot ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height } : { display: 'none' }}
      />
      <div
        className="pointer-events-auto fixed overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-2xl shadow-slate-950/25 [animation:cs-pop_.22s_ease-out]"
        style={modalStyle}
      >
        <div className="h-1.5 bg-gradient-to-r from-emerald-500 to-indigo-500" />
        <div className="p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">จำลองใช้งานจริง · {current.label}</span>
              <h3 className="mt-1 text-sm font-black text-slate-950">{current.title}</h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label="ปิดทัวร์กรอกฟอร์ม">
              <X size={16} />
            </button>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-slate-500">{current.text}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600">Skip</button>
            <div className="flex gap-2">
              {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">Back</button>}
              <button type="button" onClick={() => (isLast ? onClose() : setStep(step + 1))} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white shadow-sm shadow-emerald-200">
                {isLast ? 'เข้าใจแล้ว' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function HeroStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2 text-indigo-100">
        <Icon size={16} />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-xl font-bold text-white">{value}</p>
    </div>
  )
}

// ====== Popup: ตัวแปรที่ \"ไม่ทำ Code\" (global ทุกโปรเจกต์ · บันทึกลง Firestore) ======
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
