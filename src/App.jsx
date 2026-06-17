import { useState, useRef, useEffect } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { LayoutGrid, LogOut, Users, Cpu } from 'lucide-react'
import { useAuth } from './lib/auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Members from './pages/Members.jsx'
import AiProviders from './pages/AiProviders.jsx'
import ProjectHub from './pages/ProjectHub.jsx'
import BoxPage from './pages/BoxPage.jsx'
import CodeframeEditor from './pages/CodeframeEditor.jsx'
import RawdataViewer from './pages/RawdataViewer.jsx'
import VerbatimEditor from './pages/VerbatimEditor.jsx'

const ROLE_LABEL = { superadmin: 'SuperAdmin', admin: 'Admin', member: 'Member' }

function UserMenu() {
  const { user, role, canManage, isSuperAdmin, signOutUser } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  if (!user) return null
  const name = user.displayName || user.email || 'ผู้ใช้'
  const initial = (name[0] || '?').toUpperCase()

  return (
    <div className="ml-auto flex items-center gap-2">
      {canManage ? (
        <Link
          to="/members"
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          <Users size={15} /> <span className="hidden sm:block">จัดการสมาชิก</span>
        </Link>
      ) : null}
      <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white">
            {initial}
          </span>
        )}
        <span className="hidden max-w-[140px] truncate sm:block">{name}</span>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-800">{user.displayName || 'ผู้ใช้'}</span>
              {role ? (
                <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                  {ROLE_LABEL[role] || role}
                </span>
              ) : null}
            </div>
            <div className="truncate text-[12px] text-slate-500">{user.email}</div>
          </div>
          {canManage ? (
            <Link
              to="/members"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            >
              <Users size={15} /> จัดการสมาชิก
            </Link>
          ) : null}
          {isSuperAdmin ? (
            <Link
              to="/ai-providers"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            >
              <Cpu size={15} /> ตั้งค่า AI Provider
            </Link>
          ) : null}
          <button
            onClick={() => {
              setOpen(false)
              signOutUser()
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-600 transition hover:bg-rose-50"
          >
            <LogOut size={15} /> ออกจากระบบ
          </button>
        </div>
      ) : null}
      </div>
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const isEditor = /\/codeframes\/|\/rawdata$|\/verbatim$/.test(location.pathname)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className={`mx-auto flex h-14 items-center gap-3 px-5 ${isEditor ? '' : 'max-w-6xl'}`}>
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-200">
              <LayoutGrid size={17} />
            </span>
            <span className="text-base font-bold tracking-tight text-slate-900">
              Codeframe <span className="text-indigo-600">Studio</span>
            </span>
          </Link>
          <span className="ml-1 hidden rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 sm:block">
            ระบบสร้าง Codeframe สำหรับงาน CE / OE / Verbatim
          </span>
          <UserMenu />
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/members" element={<Members />} />
          <Route path="/ai-providers" element={<AiProviders />} />
          <Route path="/projects/:projectId" element={<ProjectHub />} />
          <Route path="/projects/:projectId/rawdata" element={<RawdataViewer />} />
          <Route path="/projects/:projectId/verbatim" element={<VerbatimEditor />} />
          <Route path="/projects/:projectId/:box" element={<BoxPage />} />
          <Route
            path="/projects/:projectId/:box/codeframes/:codeframeId"
            element={<CodeframeEditor />}
          />
          <Route
            path="*"
            element={
              <div className="px-5 py-16 text-center text-slate-400">
                ไม่พบหน้านี้ —{' '}
                <Link to="/" className="text-indigo-600 underline">
                  กลับหน้าหลัก
                </Link>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
