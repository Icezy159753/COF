import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, Check, X, ShieldCheck, Shield, User as UserIcon, Clock } from 'lucide-react'
import { db } from '../lib/firebase.js'
import { useAuth, SUPERADMIN_EMAIL } from '../lib/auth.jsx'

const ROLE_META = {
  superadmin: { label: 'SuperAdmin', icon: ShieldCheck, cls: 'bg-violet-100 text-violet-700' },
  admin: { label: 'Admin', icon: Shield, cls: 'bg-indigo-100 text-indigo-700' },
  member: { label: 'Member', icon: UserIcon, cls: 'bg-slate-100 text-slate-600' },
}

const STATUS_META = {
  approved: { label: 'ใช้งานได้', cls: 'bg-emerald-100 text-emerald-700' },
  pending: { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-700' },
  rejected: { label: 'ถูกปฏิเสธ', cls: 'bg-rose-100 text-rose-700' },
}

export default function Members() {
  const { user, isSuperAdmin, canManage } = useAuth()
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [])

  const { pending, active } = useMemo(() => {
    const sorted = [...users].sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    return {
      pending: sorted.filter((u) => u.status === 'pending'),
      active: sorted.filter((u) => u.status !== 'pending'),
    }
  }, [users])

  async function patch(id, data) {
    setBusy(id)
    try {
      await updateDoc(doc(db, 'users', id), { ...data, updatedAt: serverTimestamp() })
    } catch (e) {
      console.error('update user failed', e)
    } finally {
      setBusy('')
    }
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center text-slate-500">
        คุณไม่มีสิทธิ์เข้าหน้านี้
        <div className="mt-3">
          <Link to="/" className="text-indigo-600 underline">
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    )
  }

  // กฎสิทธิ์: ห้ามแก้บัญชีตัวเอง / ห้ามแตะ SuperAdmin / role adm/superadmin ตั้งได้เฉพาะ SuperAdmin
  function isSuperRow(u) {
    return u.role === 'superadmin' || (u.email || '').toLowerCase() === SUPERADMIN_EMAIL
  }
  function canEditRow(u) {
    if (u.id === user?.uid) return false
    if (isSuperRow(u)) return false
    return true
  }
  const assignableRoles = isSuperAdmin ? ['member', 'admin'] : ['member']

  function Avatar({ u }) {
    const name = u.displayName || u.email || '?'
    return u.photoURL ? (
      <img src={u.photoURL} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
    ) : (
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
        {(name[0] || '?').toUpperCase()}
      </span>
    )
  }

  function RoleBadge({ role }) {
    const m = ROLE_META[role] || ROLE_META.member
    const Icon = m.icon
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
        <Icon size={12} /> {m.label}
      </span>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
        <ArrowLeft size={15} /> กลับหน้าหลัก
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">จัดการสมาชิก</h1>
      <p className="mt-1 text-sm text-slate-500">
        อนุมัติผู้ใช้ที่ขอเข้าระบบ และกำหนด Role ให้สมาชิก
      </p>

      {/* คำขอรออนุมัติ */}
      <section className="mt-7">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Clock size={16} className="text-amber-500" />
          รออนุมัติ
          {pending.length ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              {pending.length}
            </span>
          ) : null}
        </h2>

        {pending.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            ไม่มีคำขอที่รออนุมัติ
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pending.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3"
              >
                <Avatar u={u} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800">{u.displayName || 'ผู้ใช้'}</div>
                  <div className="truncate text-[12px] text-slate-500">{u.email}</div>
                </div>
                <button
                  disabled={busy === u.id}
                  onClick={() => patch(u.id, { status: 'approved', role: u.role || 'member', approvedBy: user?.email || '' })}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check size={14} /> อนุมัติ
                </button>
                <button
                  disabled={busy === u.id}
                  onClick={() => patch(u.id, { status: 'rejected' })}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  <X size={14} /> ปฏิเสธ
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* สมาชิกทั้งหมด */}
      <section className="mt-8">
        <h2 className="text-sm font-bold text-slate-700">สมาชิกทั้งหมด ({active.length})</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[12px] font-semibold text-slate-500">
                <th className="px-4 py-2.5">ผู้ใช้</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">สถานะ</th>
                <th className="px-4 py-2.5 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {active.map((u) => {
                const editable = canEditRow(u)
                const st = STATUS_META[u.status] || STATUS_META.pending
                return (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar u={u} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">
                            {u.displayName || 'ผู้ใช้'}
                            {u.id === user?.uid ? (
                              <span className="ml-1.5 text-[11px] font-normal text-slate-400">(คุณ)</span>
                            ) : null}
                          </div>
                          <div className="truncate text-[12px] text-slate-500">{u.email}</div>
                          {u.department ? (
                            <div className="truncate text-[11px] text-slate-400">แผนก: {u.department}</div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {editable ? (
                        <select
                          value={u.role || 'member'}
                          disabled={busy === u.id}
                          onChange={(e) => patch(u.id, { role: e.target.value })}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[13px] font-medium text-slate-700 outline-none focus:border-indigo-400"
                        >
                          {assignableRoles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_META[r].label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <RoleBadge role={u.role || 'member'} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editable ? (
                        u.status === 'approved' ? (
                          <button
                            disabled={busy === u.id}
                            onClick={() => patch(u.id, { status: 'rejected' })}
                            className="rounded-lg border border-rose-200 px-2.5 py-1 text-[12px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            ระงับ
                          </button>
                        ) : (
                          <button
                            disabled={busy === u.id}
                            onClick={() => patch(u.id, { status: 'approved', approvedBy: user?.email || '' })}
                            className="rounded-lg border border-emerald-200 px-2.5 py-1 text-[12px] font-semibold text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50"
                          >
                            เปิดใช้งาน
                          </button>
                        )
                      ) : (
                        <span className="text-[12px] text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
