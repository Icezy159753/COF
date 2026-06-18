import { LayoutGrid, LockKeyhole } from 'lucide-react'
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,#eef2ff_0,#f8fafc_36%,#f8fafc_100%)] px-5 py-10">
      <span className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-indigo-200/45 blur-3xl" />
      <span className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-violet-200/45 blur-3xl" />
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-100/70 blur-3xl" />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-[2.25rem] border border-white/70 bg-white shadow-[0_28px_90px_rgba(79,70,229,0.20)] ring-1 ring-indigo-50 md:grid-cols-[0.95fr_1.05fr]">
        <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500 p-8 text-white md:p-10">
          <span className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-white/15 blur-2xl" />
          <span className="pointer-events-none absolute bottom-6 right-6 h-40 w-40 rounded-full bg-sky-300/25 blur-2xl" />
          <span className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />

          <div className="relative flex h-full min-h-[360px] items-center justify-center">
            <div className="flex flex-col items-center text-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-[1.7rem] bg-white/18 shadow-2xl shadow-indigo-950/15 ring-1 ring-white/25 backdrop-blur">
                <LayoutGrid size={40} />
              </span>
              <p className="mt-6 text-[11px] font-black uppercase tracking-[0.24em] text-white/65">DP Data Tools</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">Codeframe Studio</h1>
            </div>
          </div>
        </section>

        <section className="relative flex items-center bg-white p-7 md:p-10">
          <div className="w-full">
            <div className="mb-8">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                <LockKeyhole size={23} />
              </span>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-400">Welcome back</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">เข้าสู่ระบบเพื่อเริ่มงาน</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                ใช้บัญชี Google เพื่อเปิดโปรเจกต์และข้อมูล Codeframe อย่างปลอดภัย
              </p>
            </div>

            <button
              onClick={signInWithGoogle}
              className="group flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-black text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50/40 hover:shadow-xl hover:shadow-indigo-100 active:scale-[0.99]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-100 transition-transform group-hover:scale-105">
                <GoogleMark />
              </span>
              เข้าสู่ระบบด้วย Google
            </button>

            {error ? (
              <p className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-center text-[12px] font-semibold text-rose-600">
                {error}
              </p>
            ) : null}

            <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
              <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                <LockKeyhole size={14} className="mt-0.5 shrink-0 text-indigo-400" />
                ระบบใช้ Google Authentication เท่านั้น — ไม่มีการเก็บรหัสผ่านไว้ในเว็บนี้
              </p>
            </div>

            <p className="mt-7 text-center text-[11px] font-medium text-slate-400">
              © 2026 Codeframe Studio · DP Data Tools
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
