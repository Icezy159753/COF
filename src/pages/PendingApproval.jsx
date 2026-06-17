import { Clock, LogOut, ShieldX } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'

export default function PendingApproval() {
  const { user, status, signOutUser } = useAuth()
  const rejected = status === 'rejected'

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50 to-violet-100 px-5">
      <div className="w-full max-w-sm rounded-3xl border border-white/60 bg-white/80 p-8 text-center shadow-xl shadow-indigo-200/50 backdrop-blur">
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg ${
            rejected
              ? 'bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-300'
              : 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-300'
          }`}
        >
          {rejected ? <ShieldX size={28} /> : <Clock size={28} />}
        </span>

        <h1 className="mt-4 text-lg font-bold text-slate-900">
          {rejected ? 'บัญชีนี้ถูกปฏิเสธการเข้าใช้' : 'รอการอนุมัติ'}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
          {rejected
            ? 'บัญชีของคุณยังไม่ได้รับอนุญาตให้ใช้งานระบบ หากคิดว่าผิดพลาดกรุณาติดต่อผู้ดูแล'
            : 'คำขอเข้าใช้งานของคุณถูกส่งไปยังผู้ดูแลระบบแล้ว กรุณารอ SuperAdmin หรือ Admin อนุมัติก่อนจึงจะเริ่มใช้งานได้'}
        </p>

        <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-left">
          <div className="truncate text-sm font-semibold text-slate-800">{user?.displayName || 'ผู้ใช้'}</div>
          <div className="truncate text-[12px] text-slate-500">{user?.email}</div>
        </div>

        <button
          onClick={signOutUser}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          <LogOut size={15} /> ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
