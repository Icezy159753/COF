import { useEffect } from 'react'
import { X, CheckCircle2, Info, AlertTriangle } from 'lucide-react'

export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, toast.duration ?? 4000)
    return () => clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null
  const styles = {
    success: { icon: CheckCircle2, accent: 'text-emerald-500', bar: 'from-emerald-400 to-emerald-500' },
    info: { icon: Info, accent: 'text-indigo-500', bar: 'from-indigo-400 to-indigo-500' },
    warning: { icon: AlertTriangle, accent: 'text-amber-500', bar: 'from-amber-400 to-amber-500' },
  }
  const s = styles[toast.type ?? 'info']
  const Icon = s.icon
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-start justify-center pt-[16vh]">
      <div className="pointer-events-auto w-[27rem] max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl [animation:cs-pop_.28s_ease-out]">
        <div className={`h-1.5 w-full bg-gradient-to-r ${s.bar}`} />
        <div className="flex items-start gap-3.5 px-5 py-4">
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-200">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
            <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white shadow">
              <Icon size={16} className={s.accent} />
            </span>
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[11px] font-bold tracking-tight text-slate-400">
              Codeframe <span className="text-indigo-500">Studio</span>
            </p>
            {toast.title && <p className="text-sm font-bold text-slate-900">{toast.title}</p>}
            {toast.message && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{toast.message}</p>}
          </div>
          <button onClick={onClose} className="-mr-1 -mt-1 shrink-0 cursor-pointer rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  const variants = {
    primary:
      'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 disabled:bg-indigo-300',
    secondary:
      'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50',
    soft: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
  }
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2',
  }
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
}

export function Badge({ color = 'slate', children, className = '' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600',
    indigo: 'bg-indigo-100 text-indigo-700',
    violet: 'bg-violet-100 text-violet-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-600',
    sky: 'bg-sky-100 text-sky-700',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors[color]} ${className}`}
    >
      {children}
    </span>
  )
}

export function JobTypeBadge({ type }) {
  return type === 'CE' ? (
    <Badge color="sky">CE</Badge>
  ) : (
    <Badge color="violet">OE</Badge>
  )
}

// ป้ายประจำกล่อง (ce / oe / verbatim / rawdata)
const BOX_BADGE = {
  ce: { color: 'sky', label: 'CE' },
  oe: { color: 'violet', label: 'OE' },
  verbatim: { color: 'amber', label: 'Verbatim' },
  rawdata: { color: 'emerald', label: 'Rawdata' },
}
export function BoxBadge({ box }) {
  const b = BOX_BADGE[box] ?? { color: 'slate', label: box }
  return <Badge color={b.color}>{b.label}</Badge>
}

// ป้าย "N แถวใหม่ที่ยังไม่ดู" — แสดงเมื่อ count > 0
export function NewRowsBadge({ count, className = '' }) {
  if (!count) return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 ${className}`}
      title="มีแถวข้อมูลใหม่ที่ยังไม่ได้ดู/ตรวจในกล่องนี้"
    >
      ● {count} แถวใหม่
    </span>
  )
}

export function Modal({ open, onClose, title, children, wide = false }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl`}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className="mb-4 block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </div>
  )
}

export function TextInput({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${className}`}
      {...props}
    />
  )
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-14 text-center">
      {Icon && (
        <div className="mb-4 rounded-2xl bg-indigo-50 p-4 text-indigo-400">
          <Icon size={32} />
        </div>
      )}
      <h3 className="text-base font-bold text-slate-700">{title}</h3>
      {subtitle && <p className="mt-1 max-w-sm text-sm text-slate-400">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ConfirmDelete({ open, onClose, onConfirm, what }) {
  return (
    <Modal open={open} onClose={onClose} title="ยืนยันการลบ">
      <p className="mb-5 text-sm text-slate-600">
        ต้องการลบ <span className="font-semibold text-slate-900">{what}</span> ใช่หรือไม่?
        ข้อมูลที่เกี่ยวข้องทั้งหมดจะถูกลบไปด้วย
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button
          variant="primary"
          className="!bg-rose-600 hover:!bg-rose-700 !shadow-rose-200"
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          ลบ
        </Button>
      </div>
    </Modal>
  )
}
