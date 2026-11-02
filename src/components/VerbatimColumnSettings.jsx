/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
// หน้าต่างตั้งค่าคอลัมน์ของกล่อง Verbatim — ใช้ทั้งหน้าสรุป (VerbatimHub) และหน้าแก้ (VerbatimEditor)
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, ListChecks, Search, X } from 'lucide-react'
import { detectTextQuestions } from '../lib/boxes.js'
import { cellValue } from '../lib/verbatim.js'
import { Button, Field, Modal } from './ui.jsx'

// ============================================================
// ตั้งค่าคอลัมน์: เลือกบทบาทของแต่ละข้อ (Verbatim / อ้างอิง) + Preview การวางคอลัมน์
// ============================================================
export default function VerbatimColumnSettings({ open, onClose, questions, rawdata, value, onSave }) {
  const [sbjNumId, setSbjNumId] = useState(value?.sbjNumId ?? null)
  const [verbatimIds, setVerbatimIds] = useState(value?.questionIds ?? [])
  const [refIds, setRefIds] = useState(value?.refQuestionIds ?? [])
  const [search, setSearch] = useState('')
  const [textOnly, setTextOnly] = useState(true)

  useEffect(() => {
    if (open) {
      const sbj = value?.sbjNumId ?? null
      setSbjNumId(sbj)
      setVerbatimIds((value?.questionIds ?? []).filter((id) => id !== sbj))
      setRefIds((value?.refQuestionIds ?? []).filter((id) => id !== sbj))
      setSearch('')
    }
  }, [open])

  // ข้อที่เดาว่าเป็นข้อความอิสระ + สถิติ (จำนวนที่ตอบ / ตัวอย่างคำตอบ) — คำนวณตอนเปิดหน้าต่าง
  const textIds = useMemo(() => (open && rawdata ? new Set(detectTextQuestions(rawdata)) : new Set()), [open, rawdata])
  const stats = useMemo(() => {
    const m = new Map()
    if (!open || !rawdata) return m
    for (const q of questions) {
      let filled = 0
      let sample = ''
      for (const row of rawdata.rows) {
        const v = cellValue(row, q)
        if (!v) continue
        filled++
        if (v.length > sample.length && sample.length < 40) sample = v
      }
      m.set(q.id, { filled, sample })
    }
    return m
  }, [open, rawdata, questions])
  const total = rawdata?.rows?.length ?? 0
  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])

  const roleOf = (id) => (verbatimIds.includes(id) ? 'v' : refIds.includes(id) ? 'r' : null)
  const setRole = (id, role) => {
    const cur = roleOf(id)
    setVerbatimIds((l) => l.filter((x) => x !== id).concat(role === 'v' && cur !== 'v' ? [id] : []))
    setRefIds((l) => l.filter((x) => x !== id).concat(role === 'r' && cur !== 'r' ? [id] : []))
  }
  const move = (id, dir) => setVerbatimIds((l) => {
    const i = l.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= l.length) return l
    const n = l.slice()
    const t = n[i]
    n[i] = n[j]
    n[j] = t
    return n
  })

  const s = search.trim().toLowerCase()
  const listed = questions.filter((q) => q.id !== sbjNumId
    && (!s || String(q.label).toLowerCase().includes(s) || String(q.text ?? '').toLowerCase().includes(s))
    && (!textOnly || textIds.has(q.id) || roleOf(q.id)))

  const vQs = verbatimIds.map((id) => qById.get(id)).filter(Boolean)
  const rQs = refIds.map((id) => qById.get(id)).filter(Boolean)
  const sbjQ = sbjNumId ? qById.get(sbjNumId) : null
  // แถวตัวอย่างสำหรับ Preview: แถวแรก ๆ ที่มีคำตอบใน Verbatim ที่เลือก
  const verbatimIdsKey = verbatimIds.join('|')
  const previewRows = useMemo(() => {
    if (!rawdata) return []
    const out = []
    for (let i = 0; i < rawdata.rows.length && out.length < 3; i++) {
      const row = rawdata.rows[i]
      if (!vQs.length || vQs.some((q) => cellValue(row, q))) out.push([row, i])
    }
    return out
  }, [rawdata, verbatimIdsKey])

  return (
    <Modal open={open} onClose={onClose} title="ตั้งค่าคอลัมน์ Clean Verbatim" xwide>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ----- ซ้าย: เลือกข้อ ----- */}
        <div className="min-w-0">
          <Field label="ข้อที่ใช้เป็น SbjNum (รหัสผู้ตอบ)">
            <select
              value={sbjNumId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null
                setSbjNumId(id)
                if (id) { setVerbatimIds((l) => l.filter((x) => x !== id)); setRefIds((l) => l.filter((x) => x !== id)) }
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
            >
              <option value="">— ไม่ระบุ —</option>
              {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          </Field>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อข้อ…"
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} className="accent-indigo-600" />
              เฉพาะข้อความ (text)
            </label>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Button variant="soft" size="sm" onClick={() => setVerbatimIds(detectTextQuestions(rawdata).filter((id) => id !== sbjNumId && !refIds.includes(id)))} disabled={!rawdata}>
              <ListChecks size={14} /> เลือกข้อ text อัตโนมัติ
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setVerbatimIds([]); setRefIds([]) }}>
              ล้างที่เลือก
            </Button>
          </div>

          <div className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {listed.length === 0 && <p className="p-4 text-center text-xs text-slate-400">ไม่พบข้อ — ลองเอาติ๊ก “เฉพาะข้อความ” ออก</p>}
            {listed.map((q) => {
              const role = roleOf(q.id)
              const st = stats.get(q.id) ?? { filled: 0, sample: '' }
              return (
                <div key={q.id} className={`flex items-center gap-3 px-3 py-2 ${role === 'v' ? 'bg-amber-50/70' : role === 'r' ? 'bg-sky-50/70' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-slate-800" title={q.label}>{q.label}</span>
                      {q.type === 'MA' && <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">MA</span>}
                      {textIds.has(q.id) && <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">text</span>}
                      <span className="ml-auto shrink-0 text-[10px] text-slate-400">ตอบ {st.filled}/{total}</span>
                    </div>
                    <p className="truncate text-[11px] text-slate-400" title={st.sample}>
                      {q.text && q.text !== q.label ? <span className="text-slate-500">{q.text} · </span> : null}
                      {st.sample ? `“${st.sample}”` : 'ไม่มีคำตอบ'}
                    </p>
                  </div>
                  <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => setRole(q.id, 'v')}
                      className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-bold ${role === 'v' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:text-amber-700'}`}
                    >
                      Verbatim
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole(q.id, 'r')}
                      className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-bold ${role === 'r' ? 'bg-sky-500 text-white' : 'text-slate-500 hover:text-sky-700'}`}
                    >
                      อ้างอิง
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ----- ขวา: ลำดับ + Preview ----- */}
        <div className="min-w-0">
          <p className="mb-1.5 text-sm font-semibold text-slate-700">ข้อ Verbatim ที่จะ Clean <span className="font-normal text-slate-400">(เรียงตามลำดับที่แสดง · {vQs.length} ข้อ)</span></p>
          <div className="mb-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-dashed border-amber-200 bg-amber-50/40 p-2">
            {vQs.length === 0 && <span className="text-xs text-slate-400">ยังไม่ได้เลือก — กดปุ่ม “Verbatim” ที่ข้อทางซ้าย</span>}
            {vQs.map((q, i) => (
              <span key={q.id} className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-white py-0.5 pl-2.5 pr-1 text-xs font-semibold text-amber-800">
                <span className="mr-1 text-[10px] text-amber-400">{i + 1}</span>{q.label}
                <button type="button" onClick={() => move(q.id, -1)} disabled={i === 0} className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="เลื่อนขึ้น"><ArrowUp size={11} /></button>
                <button type="button" onClick={() => move(q.id, 1)} disabled={i === vQs.length - 1} className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="เลื่อนลง"><ArrowDown size={11} /></button>
                <button type="button" onClick={() => setRole(q.id, 'v')} className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-rose-600" title="เอาออก"><X size={11} /></button>
              </span>
            ))}
          </div>
          <p className="mb-1.5 text-sm font-semibold text-slate-700">คอลัมน์อ้างอิง <span className="font-normal text-slate-400">(อ่านอย่างเดียว · {rQs.length})</span></p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {rQs.length === 0 && <span className="text-xs text-slate-400">ไม่มี — เลือกได้ถ้าต้องการดูข้อปลายปิดประกอบ</span>}
            {rQs.map((q) => (
              <span key={q.id} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white py-0.5 pl-2.5 pr-1 text-xs font-semibold text-sky-700">
                {q.label}
                <button type="button" onClick={() => setRole(q.id, 'r')} className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-rose-600" title="เอาออก"><X size={11} /></button>
              </span>
            ))}
          </div>

          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Eye size={14} className="text-indigo-500" /> Preview การวางคอลัมน์</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
            {vQs.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-400">เลือกข้อ Verbatim เพื่อดูตัวอย่าง</p>
            ) : (
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className="text-left font-bold text-slate-600">
                    <th rowSpan={2} className="border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-slate-400">#</th>
                    {sbjQ && <th rowSpan={2} className="border-b border-r border-slate-200 bg-slate-100 px-2 py-1">{sbjQ.label}</th>}
                    {rQs.map((q) => <th key={q.id} rowSpan={2} className="border-b border-r border-slate-200 bg-sky-50 px-2 py-1 text-sky-700">{q.label}</th>)}
                    {vQs.map((q) => <th key={q.id} colSpan={2} className="border-b border-r border-slate-200 bg-amber-50 px-2 py-1 text-amber-800">{q.label}</th>)}
                  </tr>
                  <tr className="text-left text-[10px] font-semibold">
                    {vQs.map((q) => (
                      <PreviewHead key={q.id} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(([row, i]) => (
                    <tr key={i} className="bg-white align-top">
                      <td className="border-b border-r border-slate-100 px-2 py-1 text-slate-400">{i + 1}</td>
                      {sbjQ && <td className="border-b border-r border-slate-100 px-2 py-1 font-mono text-slate-600">{cellValue(row, sbjQ)}</td>}
                      {rQs.map((q) => <td key={q.id} className="max-w-[8rem] truncate border-b border-r border-slate-100 px-2 py-1 text-slate-500">{cellValue(row, q) || '—'}</td>)}
                      {vQs.map((q) => (
                        <PreviewPair key={q.id} text={cellValue(row, q)} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">ในหน้าทำงาน แต่ละข้อจะมีคอลัมน์ Original · Clean · สถานะ และเลือกดูทีละข้อหรือหลายข้อได้</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <span className="mr-auto text-xs text-slate-500">Verbatim {vQs.length} ข้อ · อ้างอิง {rQs.length} ข้อ</span>
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={() => { onSave({ sbjNumId, questionIds: verbatimIds, refQuestionIds: refIds }); onClose() }}>
          บันทึกการตั้งค่า
        </Button>
      </div>
    </Modal>
  )
}

function PreviewHead() {
  return (
    <>
      <th className="border-b border-r border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-500">Original</th>
      <th className="border-b border-r border-slate-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">Clean</th>
    </>
  )
}

function PreviewPair({ text }) {
  return (
    <>
      <td className="min-w-[7rem] max-w-[11rem] border-b border-r border-slate-100 px-2 py-1 text-slate-500"><span className="line-clamp-2">{text || '—'}</span></td>
      <td className="min-w-[7rem] max-w-[11rem] border-b border-r border-slate-100 px-2 py-1 text-slate-800"><span className="line-clamp-2">{text || '—'}</span></td>
    </>
  )
}
