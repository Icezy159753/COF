import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Cpu, Check, Loader2, Sparkles, KeyRound, RefreshCw, Gift } from 'lucide-react'
import { useStore } from '../store.jsx'
import { useAuth } from '../lib/auth.jsx'
import { DEFAULT_AI_CONFIG, toAiPayload, aiTestConnection, fetchOpenRouterModels } from '../lib/aiGroup.js'

const CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Sonnet (สมดุล คุณภาพ/ความเร็ว)' },
  { id: 'haiku', label: 'Haiku (เร็ว/ประหยัด)' },
  { id: 'opus', label: 'Opus (ฉลาดสุด)' },
]

// โมเดลยอดนิยม (ใช้เป็นตัวเลือกเริ่มต้นก่อนกด "โหลดรายชื่อ" — พิมพ์เองได้ทุกรุ่น)
const OPENROUTER_FALLBACK = [
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.5-haiku',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.3-70b-instruct',
]

// ตัดรุ่นฟรีที่ไม่เหมาะกับงานนี้ออก (coder, เสียง/ภาพ, จิ๋ว, reasoning ที่ชอบพังรูปแบบ JSON ฯลฯ)
const FREE_EXCLUDE = /coder|content-safety|guard|lyria|clip|audio|tts|whisper|embed|-vl\b|vision|owl-alpha|openrouter\/free|uncensored|venice|dolphin|thinking|reasoning|omni|(?:^|[-/])(?:0\.5b|1b|1\.2b|2b|3b)/i
// ลำดับความเหมาะสมสำหรับภาษาไทย + ทำตามคำสั่ง JSON (รุ่นใหญ่ instruct มาก่อน)
const FREE_PRIORITY = [
  /qwen3-next.*instruct/i,
  /qwen.*instruct/i,
  /llama-3\.3-70b-instruct/i,
  /gemma-4-31b/i,
  /hermes-3-llama.*405b/i,
  /gpt-oss-120b/i,
  /nemotron-3-(?:super|ultra)/i,
  /gemma-4/i,
]

// คัดรุ่นฟรี "แนะนำ" จากรายการจริงที่โหลดมา (id ถูกต้องเสมอ)
function recommendFree(models) {
  const free = models.filter((m) => m.free && !FREE_EXCLUDE.test(m.id))
  const picked = []
  for (const re of FREE_PRIORITY) {
    const hit = free.find((m) => re.test(m.id) && !picked.includes(m.id))
    if (hit) picked.push(hit.id)
  }
  // เติมรุ่นฟรีอื่น ๆ ที่เหลือจนครบ ~6 ตัว
  for (const m of free) {
    if (picked.length >= 6) break
    if (!picked.includes(m.id)) picked.push(m.id)
  }
  return picked
}

export default function AiProviders() {
  const { state, setAiConfig } = useStore()
  const { canManage } = useAuth()
  const [form, setForm] = useState({ ...DEFAULT_AI_CONFIG, ...(state.settings.ai || {}) })
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState(null) // null | 'loading' | {ok, msg}
  const [models, setModels] = useState(null) // null | [{id,name,free}]
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsErr, setModelsErr] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)

  const recommendedFree = useMemo(() => (models ? recommendFree(models) : []), [models])
  const freeCount = useMemo(() => (models ? models.filter((m) => m.free).length : 0), [models])
  const datalistIds = useMemo(() => {
    if (!models) return OPENROUTER_FALLBACK
    return (freeOnly ? models.filter((m) => m.free) : models).map((m) => m.id)
  }, [models, freeOnly])

  const loadModels = async () => {
    setLoadingModels(true)
    setModelsErr('')
    try {
      setModels(await fetchOpenRouterModels())
    } catch (e) {
      setModelsErr(e.message || 'โหลดไม่สำเร็จ')
    } finally {
      setLoadingModels(false)
    }
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center text-slate-500">
        หน้านี้สำหรับ Admin หรือ SuperAdmin เท่านั้น
        <div className="mt-3">
          <Link to="/" className="text-indigo-600 underline">
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    )
  }

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }))
    setSaved(false)
    setTest(null)
  }

  const save = () => {
    setAiConfig(form)
    setSaved(true)
  }

  const runTest = async () => {
    setTest('loading')
    try {
      await aiTestConnection(toAiPayload(form))
      setTest({ ok: true, msg: 'เชื่อมต่อสำเร็จ โมเดลตอบกลับปกติ' })
    } catch (e) {
      setTest({ ok: false, msg: e.message || 'เชื่อมต่อไม่สำเร็จ' })
    }
  }

  const Provider = ({ id, name, desc, badge }) => {
    const active = form.provider === id
    return (
      <button
        type="button"
        onClick={() => set({ provider: id })}
        className={`flex-1 rounded-2xl border-2 p-4 text-left transition ${
          active
            ? 'border-indigo-500 bg-indigo-50/60 shadow-sm'
            : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${
              active ? 'bg-gradient-to-br from-indigo-500 to-violet-600' : 'bg-slate-300'
            }`}
          >
            <Sparkles size={17} />
          </span>
          <span className="font-bold text-slate-800">{name}</span>
          {badge ? (
            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              {badge}
            </span>
          ) : null}
          {active ? <Check size={18} className="ml-auto text-indigo-600" /> : null}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">{desc}</p>
      </button>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
        <ArrowLeft size={15} /> กลับหน้าหลัก
      </Link>

      <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
        <Cpu size={24} className="text-indigo-600" /> ตั้งค่า AI Provider
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Admin/SuperAdmin ตั้งค่า Provider และโมเดลกลางให้ทั้งระบบ — ตั้ง Codex Subscription ครั้งเดียวแล้วทุก user ใช้ได้ร่วมกัน
      </p>


      {/* เลือก Provider */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Provider
          id="claude"
          name="Claude (Subscription)"
          desc="ใช้ Claude subscription/CLI ที่ Admin หรือ SuperAdmin ตั้งไว้บน runner กลาง แล้วทุก user ใช้งาน AI ผ่านค่านี้"
          badge="Global"
        />
        <Provider
          id="codex"
          name="Codex CLI (OpenAI)"
          desc="ใช้ Codex CLI / ChatGPT subscription ที่ Admin หรือ SuperAdmin login ไว้บน runner กลาง แล้วทุก user ใช้งานร่วมกัน"
          badge="Global"
        />
        <Provider
          id="openrouter"
          name="OpenRouter"
          desc="เรียกผ่าน OpenRouter API เลือกได้หลายโมเดล (Claude, GPT, Gemini, Llama ฯลฯ) — ต้องมี API key"
        />
      </div>

      {/* ตั้งค่าตาม Provider ที่เลือก */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
        {form.provider === 'claude' ? (
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">โมเดล Claude</label>
            <select
              value={form.claudeModel}
              onChange={(e) => set({ claudeModel: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[12px] text-slate-400">
              ใช้สิทธิ์ subscription/CLI กลางที่ Admin ตั้งไว้ ค่า model นี้จะมีผลกับงาน AI ของทุก user
            </p>
          </div>
        ) : form.provider === 'codex' ? (
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">โมเดล Codex</label>
            <input
              list="codex-models"
              value={form.codexModel}
              onChange={(e) => set({ codexModel: e.target.value })}
              placeholder="เว้นว่าง = ใช้ค่าเริ่มต้นของ Codex (เช่น gpt-5.5)"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <datalist id="codex-models">
              {['gpt-5.5', 'gpt-5-codex', 'gpt-5', 'o3', 'o4-mini', 'gpt-4.1'].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="mt-2 text-[12px] text-slate-400">
              ใช้สิทธิ์ ChatGPT/Codex subscription ที่ Admin หรือ SuperAdmin login ไว้บน runner กลาง — ตั้งครั้งเดียวแล้วทุก user ใช้ร่วมกัน
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
                <KeyRound size={14} /> OpenRouter API Key
              </label>
              <input
                type="password"
                value={form.openrouterApiKey}
                onChange={(e) => set({ openrouterApiKey: e.target.value })}
                placeholder="sk-or-v1-…"
                autoComplete="off"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <p className="mt-1.5 text-[12px] text-slate-400">
                สร้าง API Key กลางได้ที่{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 underline"
                >
                  openrouter.ai/keys
                </a>
                {' '}แล้วนำ key กลางมาวางในช่องนี้ (ใช้ร่วมกันทั้งระบบ)
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="text-[13px] font-semibold text-slate-700">โมเดล</label>
                <div className="flex items-center gap-2">
                  {models ? (
                    <label className="flex cursor-pointer items-center gap-1 text-[12px] font-medium text-slate-500">
                      <input
                        type="checkbox"
                        checked={freeOnly}
                        onChange={(e) => setFreeOnly(e.target.checked)}
                        className="accent-emerald-600"
                      />
                      เฉพาะรุ่นฟรี ({freeCount})
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={loadModels}
                    disabled={loadingModels}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {loadingModels ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {models ? `โหลดแล้ว ${models.length} รุ่น` : 'โหลดรายชื่อโมเดล'}
                  </button>
                </div>
              </div>

              {/* quick-pick รุ่นฟรีที่แนะนำสำหรับงานไทย */}
              {recommendedFree.length ? (
                <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-emerald-700">
                    <Gift size={13} /> รุ่นฟรี แนะนำสำหรับงานไทย
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {recommendedFree.map((id) => {
                      const active = form.openrouterModel === id
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => set({ openrouterModel: id })}
                          className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition ${
                            active
                              ? 'border-emerald-500 bg-emerald-600 text-white'
                              : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {id.replace(/:free$/, '')}
                          <span className={`ml-1 ${active ? 'text-emerald-100' : 'text-emerald-400'}`}>·ฟรี</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <input
                list="or-models"
                value={form.openrouterModel}
                onChange={(e) => set({ openrouterModel: e.target.value })}
                placeholder="พิมพ์ model id เช่น anthropic/claude-3.5-sonnet"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <datalist id="or-models">
                {datalistIds.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              {modelsErr ? (
                <p className="mt-1.5 text-[12px] text-rose-500">{modelsErr}</p>
              ) : (
                <p className="mt-1.5 text-[12px] text-slate-400">
                  พิมพ์ model id เองได้ทุกรุ่น หรือกด “โหลดรายชื่อโมเดล” แล้วเลือก/ติ๊ก “เฉพาะรุ่นฟรี” (รูปแบบ{' '}
                  <span className="font-mono">ผู้ให้บริการ/โมเดล</span>)
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ทดสอบผลลัพธ์ */}
      {test ? (
        test === 'loading' ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={15} className="animate-spin" /> กำลังทดสอบการเชื่อมต่อ…
          </p>
        ) : (
          <p
            className={`mt-4 rounded-xl px-4 py-2.5 text-[13px] ${
              test.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
            }`}
          >
            {test.ok ? '✓ ' : '✕ '}
            {test.msg}
          </p>
        )
      ) : null}

      {/* ปุ่ม */}
      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={save}
          className="rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:brightness-105 active:scale-[0.99]"
        >
          บันทึกการตั้งค่า
        </button>
        <button
          onClick={runTest}
          disabled={test === 'loading'}
          className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          ทดสอบการเชื่อมต่อ
        </button>
        {saved ? (
          <span className="flex items-center gap-1 text-[13px] font-medium text-emerald-600">
            <Check size={15} /> บันทึกแล้ว
          </span>
        ) : null}
      </div>

      <p className="mt-5 text-[12px] text-slate-400">
        การตั้งค่านี้ใช้ร่วมกันทั้งระบบ (ทุก user) — เฉพาะ Admin/SuperAdmin แก้ไขได้
      </p>
    </div>
  )
}
