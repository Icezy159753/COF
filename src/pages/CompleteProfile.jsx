import { useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { UserCircle2, LogOut } from 'lucide-react'
import { db } from '../lib/firebase.js'
import { useAuth } from '../lib/auth.jsx'

const DEPARTMENTS = [
  'Coding (CE/OE/Verbatim)',
  'Research',
  'Data Processing (DP)',
  'Fieldwork',
  'Project / Account',
  'IT / Programmer',
  'Management',
]

export default function CompleteProfile() {
  const { user, profile, signOutUser } = useAuth()
  const [fullName, setFullName] = useState(profile?.fullName || user?.displayName || '')
  const [dept, setDept] = useState('')
  const [customDept, setCustomDept] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const department = dept === '__other__' ? customDept.trim() : dept

  async function save(e) {
    e.preventDefault()
    setErr('')
    if (!fullName.trim()) return setErr('กรุณากรอกชื่อ-นามสกุล')
    if (!department) return setErr('กรุณาเลือกหรือระบุแผนก')
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        fullName: fullName.trim(),
        department,
        displayName: fullName.trim(),
        profileCompleted: true,
        updatedAt: serverTimestamp(),
      })
      // onSnapshot ใน AuthProvider จะอัปเดตและพาเข้าแอปเอง
    } catch (e2) {
      console.error('complete profile failed', e2)
      setErr('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50 to-violet-100 px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/85 p-8 shadow-xl shadow-indigo-200/50 backdrop-blur">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-300">
            <UserCircle2 size={28} />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">ตั้งค่าโปรไฟล์</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            บัญชีของคุณได้รับอนุมัติแล้ว — กรุณากรอกข้อมูลก่อนเริ่มใช้งานครั้งแรก
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-2.5">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">
              {(user?.email?.[0] || '?').toUpperCase()}
            </span>
          )}
          <span className="truncate text-[12px] text-slate-500">{user?.email}</span>
        </div>

        <form onSubmit={save} className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-[13px] font-semibold text-slate-700">ชื่อ-นามสกุล</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-semibold text-slate-700">แผนก</label>
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">— เลือกแผนก —</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              <option value="__other__">อื่นๆ (ระบุเอง)</option>
            </select>
            {dept === '__other__' ? (
              <input
                value={customDept}
                onChange={(e) => setCustomDept(e.target.value)}
                placeholder="ระบุชื่อแผนก"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            ) : null}
          </div>

          {err ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-600">{err}</p>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
          >
            {saving ? 'กำลังบันทึก…' : 'เริ่มใช้งาน'}
          </button>
        </form>

        <button
          onClick={signOutUser}
          className="mx-auto mt-4 flex items-center gap-1.5 text-[12px] text-slate-400 transition hover:text-slate-600"
        >
          <LogOut size={13} /> ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
