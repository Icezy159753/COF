import { LayoutGrid } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  )
}

export default function Login() {
  const { signInWithGoogle, error } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50 to-violet-100 px-5">
      <div className="w-full max-w-sm rounded-3xl border border-white/60 bg-white/80 p-8 shadow-xl shadow-indigo-200/50 backdrop-blur">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-300">
            <LayoutGrid size={28} />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
            Codeframe <span className="text-indigo-600">Studio</span>
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            ระบบสร้าง Codeframe สำหรับงาน CE / OE / Verbatim
          </p>
        </div>

        <button
          onClick={signInWithGoogle}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
        >
          <GoogleMark />
          เข้าสู่ระบบด้วย Google
        </button>

        {error ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-center text-[12px] text-rose-600">
            {error}
          </p>
        ) : null}

        <p className="mt-6 text-center text-[11px] text-slate-400">
          เข้าสู่ระบบเพื่อจัดการโปรเจกต์และข้อมูลของคุณ
        </p>
      </div>
    </div>
  )
}
