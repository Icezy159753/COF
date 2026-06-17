import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, Bytes } from 'firebase/firestore'
import pako from 'pako'
import { db } from './lib/firebase.js'
import { Toast } from './components/ui.jsx'
import { DEFAULT_AI_CONFIG, toAiPayload, setActiveAiPayload } from './lib/aiGroup.js'

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// ค่าเริ่มต้นของ 4 กล่องเมื่อสร้าง Project ใหม่
//   ce / oe   = ชนิดข้อที่กล่องนั้นเลือกมาทำ codeframe (CE/OE ต่างกันที่ "ข้อที่เลือก")
//   verbatim  = SbjNum + ข้อ text ที่จะแก้ + คอลัมน์ CE ที่ดึงมาดูประกอบ
//   seenRowCount = watermark ของแถวที่ "ดู/ตรวจแล้ว" (ไว้ทำ badge แถวใหม่)
export const defaultBoxes = () => ({
  ce: { questionIds: [], seenRowCount: 0 },
  oe: { questionIds: [], seenRowCount: 0 },
  verbatim: { sbjNumId: null, questionIds: [], refQuestionIds: [], seenRowCount: 0 },
})

const emptyState = { projects: [], codeframes: [], settings: { excludedVars: [], ai: DEFAULT_AI_CONFIG } }

// cache ของ rawdata (ก้อนคำตอบ) ที่โหลดจาก Firestore — กันโหลดซ้ำเวลาเปลี่ยนหน้า (key = projectId)
const rawdataCache = new Map()

// ---------- เก็บ rawdata ลง Firestore แบบบีบอัด (gzip) + ซอยเป็น chunk ----------
// บีบ JSON ด้วย gzip ก่อน (ข้อความ survey ซ้ำเยอะ บีบได้หลายเท่า) แล้วซอย byte เป็นชิ้น
// เก็บเป็น Firestore Bytes ใน collection 'rawdata_chunks' (docId = `${projectId}_${i}`)
//   - แต่ละ doc ≤ ~900KB (ใต้ลิมิต 1MB/doc)
//   - แต่ละ batch commit ≤ ~8MB (ใต้ลิมิต 10MB/commit ของ Firestore)
const RAW_CHUNK_BYTES = 900_000
const MAX_BATCH_BYTES = 8_000_000
const BATCH_OPS = 400 // Firestore batch จำกัด 500 ops/รอบ
const chunkDocId = (ownerId, i) => `${ownerId}_${i}`

async function commitInBatches(ops) {
  for (let i = 0; i < ops.length; i += BATCH_OPS) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + BATCH_OPS)) op(batch)
    await batch.commit()
  }
}

// เขียน rawdata: gzip → ซอย byte → เขียนเป็น Bytes (ลบ chunk เก่าที่เกินทิ้ง) → คืนจำนวน chunk
async function writeRawdataChunks(ownerId, rawdata, oldChunkCount = 0) {
  const gz = pako.gzip(JSON.stringify(rawdata)) // Uint8Array
  const parts = []
  for (let i = 0; i < gz.length; i += RAW_CHUNK_BYTES) {
    parts.push(gz.subarray(i, i + RAW_CHUNK_BYTES))
  }

  let batch = writeBatch(db)
  let ops = 0
  let bytes = 0
  const flush = async () => {
    if (ops > 0) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
      bytes = 0
    }
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (ops >= BATCH_OPS || bytes + part.length > MAX_BATCH_BYTES) await flush()
    batch.set(doc(db, 'rawdata_chunks', chunkDocId(ownerId, i)), {
      ownerId,
      i,
      b: Bytes.fromUint8Array(part),
    })
    ops += 1
    bytes += part.length
  }
  // ลบ chunk เก่าที่เกินจำนวนใหม่
  for (let i = parts.length; i < oldChunkCount; i++) {
    if (ops >= BATCH_OPS) await flush()
    batch.delete(doc(db, 'rawdata_chunks', chunkDocId(ownerId, i)))
    ops += 1
  }
  await flush()
  return parts.length
}

async function readRawdataChunks(ownerId, chunkCount) {
  if (!chunkCount) return null
  const snaps = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) =>
      getDoc(doc(db, 'rawdata_chunks', chunkDocId(ownerId, i))),
    ),
  )
  const arrays = snaps.map((s) => s.data()?.b?.toUint8Array() ?? new Uint8Array())
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const a of arrays) {
    merged.set(a, off)
    off += a.length
  }
  return JSON.parse(pako.ungzip(merged, { to: 'string' }))
}

function deleteRawdataChunkOps(ownerId, chunkCount = 0) {
  const ops = []
  for (let i = 0; i < chunkCount; i++) {
    ops.push((b) => b.delete(doc(db, 'rawdata_chunks', chunkDocId(ownerId, i))))
  }
  return ops
}

// ---------- เก็บ "codebook" (value labels จาก .sav) แบบบีบอัด+ซอย chunk ----------
// แยกออกจากเอกสารโปรเจกต์ เพื่อกัน doc เกินลิมิต 1MB ของ Firestore (โปรเจกต์ที่ข้อเยอะ)
async function writeCodebookChunks(ownerId, codebook, oldChunkCount = 0) {
  const gz = pako.gzip(JSON.stringify(codebook))
  const parts = []
  for (let i = 0; i < gz.length; i += RAW_CHUNK_BYTES) parts.push(gz.subarray(i, i + RAW_CHUNK_BYTES))
  const ops = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    ops.push((b) => b.set(doc(db, 'codebook_chunks', chunkDocId(ownerId, i)), {
      ownerId, i, b: Bytes.fromUint8Array(part),
    }))
  }
  for (let i = parts.length; i < oldChunkCount; i++) {
    ops.push((b) => b.delete(doc(db, 'codebook_chunks', chunkDocId(ownerId, i))))
  }
  await commitInBatches(ops)
  return parts.length
}
async function readCodebookChunks(ownerId, chunkCount) {
  if (!chunkCount) return null
  const snaps = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) =>
      getDoc(doc(db, 'codebook_chunks', chunkDocId(ownerId, i))),
    ),
  )
  const arrays = snaps.map((s) => s.data()?.b?.toUint8Array() ?? new Uint8Array())
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { merged.set(a, off); off += a.length }
  return JSON.parse(pako.ungzip(merged, { to: 'string' }))
}
function deleteCodebookChunkOps(ownerId, chunkCount = 0) {
  const ops = []
  for (let i = 0; i < chunkCount; i++) {
    ops.push((b) => b.delete(doc(db, 'codebook_chunks', chunkDocId(ownerId, i))))
  }
  return ops
}

// ---------- แปลง codeframe ↔ Firestore doc ----------
// sheets มี nested array (nets→codes) และ assignments ที่ key เป็นข้อความคำตอบอิสระ
// ซึ่งชนข้อจำกัดของ Firestore → เก็บเป็น JSON string ไปเลย
function cfToDoc(cf) {
  return {
    id: cf.id,
    projectId: cf.projectId,
    box: cf.box ?? 'oe',
    name: cf.name,
    createdAt: cf.createdAt,
    sheetsJson: JSON.stringify(cf.sheets ?? []),
  }
}
function cfFromDoc(d) {
  let sheets = []
  try {
    sheets = JSON.parse(d.sheetsJson ?? '[]')
  } catch {
    sheets = []
  }
  return {
    id: d.id,
    projectId: d.projectId,
    box: d.box ?? 'oe',
    name: d.name,
    createdAt: d.createdAt,
    sheets,
  }
}

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, setState] = useState(emptyState)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [toast, setToast] = useState(null) // แจ้งเตือนกลางจอ (เช่น บันทึกไม่สำเร็จ)

  // อ้างถึง state ล่าสุดแบบ sync (mutation อ่านค่าปัจจุบันได้โดยไม่ต้องพึ่ง closure)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const reportPersistError = (err) => {
    console.error('[firebase] persist error', err)
    setToast({
      type: 'warning',
      title: 'บันทึกขึ้น Firebase ไม่สำเร็จ',
      message:
        (err?.message ?? String(err)) +
        ' — ข้อมูลยังใช้งานได้ในหน้านี้ แต่ยังไม่ถูกบันทึก',
      duration: 9000,
    })
  }

  // ---------- โหลดข้อมูลทั้งหมดจาก Firestore ตอนเปิดแอป ----------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pSnap, cSnap, settingsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'codeframes')),
          getDoc(doc(db, 'settings', 'global')),
        ])
        if (cancelled) return
        const byCreatedDesc = (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
        const projects = pSnap.docs.map((d) => withBoxes(d.data()))
        // codebook ที่เก็บแบบ chunk (ของใหม่/ข้อเยอะ) → โหลดมาแนบกลับ project.codebook
        //   ของเก่าที่เก็บ inline ในเอกสารจะมี codebook อยู่แล้ว (ใช้ต่อได้ ไม่ต้องโหลด)
        await Promise.all(
          projects.map(async (p) => {
            if (p.codebookMeta?.chunkCount && !p.codebook) {
              try { p.codebook = await readCodebookChunks(p.id, p.codebookMeta.chunkCount) } catch { /* ปล่อยว่าง */ }
            }
          }),
        )
        if (cancelled) return
        projects.sort(byCreatedDesc)
        const aiCfg = { ...DEFAULT_AI_CONFIG, ...(settingsSnap.data()?.ai ?? {}) }
        setActiveAiPayload(toAiPayload(aiCfg)) // sync ให้ทุก AI request ใช้ provider/model ที่ตั้งไว้
        setState({
          projects,
          codeframes: cSnap.docs.map((d) => cfFromDoc(d.data())).sort(byCreatedDesc),
          settings: { excludedVars: settingsSnap.data()?.excludedVars ?? [], ai: aiCfg },
        })
        setReady(true)
      } catch (err) {
        if (cancelled) return
        console.error('[firebase] load error', err)
        setLoadError(err)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ---------- ตัวช่วยบันทึก ----------
  // ถ้า codebook ถูกเก็บแบบ chunk แล้ว (มี codebookMeta) → ตัด codebook ออกจากเอกสาร (กัน doc โต)
  //   ของเก่าที่ยังเก็บ inline (ไม่มี codebookMeta) → เก็บ codebook ในเอกสารเหมือนเดิม (ไม่ทำให้หาย)
  const persistProject = (p) => {
    let toSave = p
    if (p.codebookMeta?.chunkCount) {
      const { codebook, ...rest } = p // eslint-disable-line no-unused-vars
      toSave = rest
    }
    return setDoc(doc(db, 'projects', p.id), toSave).catch(reportPersistError)
  }

  // codeframe ถูกแก้บ่อย (พิมพ์ทีละตัวอักษร) → debounce การเขียนขึ้น Firestore
  const cfTimers = useRef(new Map())
  const persistCodeframeDebounced = (id, delay = 600) => {
    const timers = cfTimers.current
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        const cf = stateRef.current.codeframes.find((c) => c.id === id)
        if (cf) setDoc(doc(db, 'codeframes', id), cfToDoc(cf)).catch(reportPersistError)
      }, delay),
    )
  }

  const api = {
    state,
    ready,
    loadError,

    // ---------- Projects ----------
    addProject(data) {
      const project = {
        id: uid(),
        createdAt: Date.now(),
        name: '',
        client: '',
        programmer: '',
        rawMeta: null,
        codebook: null, // metadata Value+Label จากไฟล์ SPSS .sav (เก็บครั้งเดียวตอนแนบ)
        boxes: defaultBoxes(),
        ...data,
      }
      setState((s) => ({ ...s, projects: [project, ...s.projects] }))
      persistProject(project)
      return project
    },
    updateProject(id, patch) {
      const cur = stateRef.current.projects.find((p) => p.id === id)
      if (!cur) return
      const updated = { ...cur, ...patch }
      setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? updated : p)) }))
      persistProject(updated)
    },
    // อัปเดตค่าของกล่องใดกล่องหนึ่ง (ce/oe/verbatim)
    updateProjectBox(id, box, patch) {
      const cur = stateRef.current.projects.find((p) => p.id === id)
      if (!cur) return
      const boxes = withBoxes(cur).boxes
      const updated = { ...cur, boxes: { ...boxes, [box]: { ...boxes[box], ...patch } } }
      setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? updated : p)) }))
      persistProject(updated)
    },
    // เก็บ codebook (Value Label จาก .sav) — บีบอัด+ซอย chunk แยกจากเอกสารโปรเจกต์ (กันเกิน 1MB)
    async setCodebook(id, codebook) {
      const cur = stateRef.current.projects.find((p) => p.id === id)
      if (!cur) return
      // อัปเดตในหน้า (in-memory) ก่อน เพื่อให้ใช้งานได้ทันที
      setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, codebook } : p)) }))
      try {
        const chunkCount = await writeCodebookChunks(id, codebook, cur.codebookMeta?.chunkCount ?? 0)
        const codebookMeta = { chunkCount, varCount: codebook.varCount ?? 0, fileName: codebook.fileName ?? '', updatedAt: Date.now() }
        const latest = stateRef.current.projects.find((p) => p.id === id) ?? cur
        const updated = { ...latest, codebook, codebookMeta }
        setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? updated : p)) }))
        persistProject(updated) // เก็บเอกสาร (ตัด codebook ออก เหลือ codebookMeta)
      } catch (err) {
        reportPersistError(err)
      }
    },
    // ทำเครื่องหมายว่ากล่องนี้ "ดูแถวล่าสุดแล้ว" → ล้าง badge แถวใหม่
    markBoxSeen(id, box) {
      const cur = stateRef.current.projects.find((p) => p.id === id)
      const rowCount = cur?.rawMeta?.rowCount ?? 0
      if ((cur?.boxes?.[box]?.seenRowCount ?? 0) === rowCount) return
      api.updateProjectBox(id, box, { seenRowCount: rowCount })
    },
    deleteProject(id) {
      const s = stateRef.current
      const project = s.projects.find((p) => p.id === id)
      const cfs = s.codeframes.filter((c) => c.projectId === id)
      setState((st) => ({
        projects: st.projects.filter((p) => p.id !== id),
        codeframes: st.codeframes.filter((c) => c.projectId !== id),
      }))
      const ops = [(b) => b.delete(doc(db, 'projects', id))]
      ops.push(...deleteRawdataChunkOps(id, project?.rawMeta?.chunkCount ?? 0))
      ops.push(...deleteCodebookChunkOps(id, project?.codebookMeta?.chunkCount ?? 0))
      cfs.forEach((c) => ops.push((b) => b.delete(doc(db, 'codeframes', c.id))))
      commitInBatches(ops).catch(reportPersistError)
      rawdataCache.delete(id)
    },

    // ---------- Rawdata (ก้อนกลางของ Project — ซอยเป็น chunk เก็บใน Firestore) ----------
    async setRawdata(projectId, rawdata) {
      const cur = stateRef.current.projects.find((p) => p.id === projectId)
      const oldChunkCount = cur?.rawMeta?.chunkCount ?? 0
      // เขียน chunk ก่อน — ถ้าพลาดจะ throw ออกไปให้ผู้เรียกจัดการ
      const chunkCount = await writeRawdataChunks(projectId, rawdata, oldChunkCount)
      rawdataCache.set(projectId, rawdata)
      const meta = {
        fileName: rawdata.fileName,
        sheetName: rawdata.sheetName,
        questions: rawdata.questions,
        rowCount: rawdata.rows.length,
        chunkCount,
        updatedAt: Date.now(),
      }
      if (cur) {
        const updated = { ...cur, rawMeta: meta }
        setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? updated : p)) }))
        persistProject(updated)
      }
    },
    // ต่อ "ก้อนข้อมูลใหม่" เข้าท้าย rawdata เดิม (header/questions ต้องเข้ากันได้)
    // คืน { added, total } — ไม่แตะ seenRowCount ของกล่อง เพื่อให้ขึ้น badge แถวใหม่
    async appendRawdata(projectId, incoming) {
      const cur = await api.loadRawdata(projectId)
      if (!cur) {
        await api.setRawdata(projectId, incoming)
        return { added: incoming.rows.length, total: incoming.rows.length }
      }
      // จับคู่คอลัมน์ของไฟล์ใหม่ตาม "ชื่อหัวคอลัมน์" ของก้อนเดิม (กันสลับคอลัมน์)
      const mapped = incoming.rows.map((row) =>
        cur.headers.map((h) => {
          const j = incoming.headers.indexOf(h)
          return j >= 0 ? (row[j] ?? '') : ''
        }),
      )
      const merged = { ...cur, rows: [...cur.rows, ...mapped] }
      await api.setRawdata(projectId, merged)
      return { added: mapped.length, total: merged.rows.length }
    },
    async loadRawdata(projectId) {
      if (rawdataCache.has(projectId)) return rawdataCache.get(projectId)
      const project = stateRef.current.projects.find((p) => p.id === projectId)
      if (!project?.rawMeta) return null
      const rawdata = await readRawdataChunks(projectId, project.rawMeta.chunkCount ?? 0)
      if (rawdata) rawdataCache.set(projectId, rawdata)
      return rawdata
    },

    // ---------- Codeframes (ผูกกับ project + box) ----------
    addCodeframe(data) {
      const cf = { id: uid(), createdAt: Date.now(), box: 'oe', sheets: [], ...data }
      setState((s) => ({ ...s, codeframes: [cf, ...s.codeframes] }))
      setDoc(doc(db, 'codeframes', cf.id), cfToDoc(cf)).catch(reportPersistError)
      return cf
    },
    updateCodeframe(id, patchOrFn) {
      const cur = stateRef.current.codeframes.find((c) => c.id === id)
      if (!cur) return
      const updated = typeof patchOrFn === 'function' ? patchOrFn(cur) : { ...cur, ...patchOrFn }
      setState((s) => ({ ...s, codeframes: s.codeframes.map((c) => (c.id === id ? updated : c)) }))
      persistCodeframeDebounced(id)
    },
    deleteCodeframe(id) {
      setState((s) => ({ ...s, codeframes: s.codeframes.filter((c) => c.id !== id) }))
      const timers = cfTimers.current
      clearTimeout(timers.get(id))
      timers.delete(id)
      deleteDoc(doc(db, 'codeframes', id)).catch(reportPersistError)
    },

    // ---------- Settings (global, ใช้ทุกโปรเจกต์) ----------
    // ตัวแปรที่ "ไม่ทำ Code" — Auto Codeframe จะข้ามตัวแปรเหล่านี้ (เก็บใน settings/global)
    setExcludedVars(vars) {
      const clean = [...new Set(vars.map((v) => String(v).trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'th'))
      setState((s) => ({ ...s, settings: { ...s.settings, excludedVars: clean } }))
      setDoc(doc(db, 'settings', 'global'), { excludedVars: clean }, { merge: true }).catch(reportPersistError)
    },

    // ตั้งค่า AI Provider/Model (SuperAdmin) — เก็บใน settings/global.ai + sync ให้ทุก request
    setAiConfig(partial) {
      setState((s) => {
        const ai = { ...DEFAULT_AI_CONFIG, ...s.settings.ai, ...partial }
        setActiveAiPayload(toAiPayload(ai))
        setDoc(doc(db, 'settings', 'global'), { ai }, { merge: true }).catch(reportPersistError)
        return { ...s, settings: { ...s.settings, ai } }
      })
    },
  }

  if (!ready) return <LoadingScreen />
  if (loadError) return <ErrorScreen error={loadError} />

  return (
    <StoreContext.Provider value={api}>
      {children}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </StoreContext.Provider>
  )
}

// เติม boxes ให้ project ที่อาจยังไม่มี field นี้ (กันพังเวลาอ่าน)
function withBoxes(p) {
  if (p.boxes?.ce && p.boxes?.oe && p.boxes?.verbatim) return p
  const d = defaultBoxes()
  return { ...p, boxes: { ...d, ...(p.boxes ?? {}) } }
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

// ---------- โหลด rawdata (ก้อนคำตอบ) แบบ lazy สำหรับหน้าที่ต้องใช้ (key = projectId) ----------
export function useRawdata(projectId) {
  const { state, loadRawdata } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const version = project?.rawMeta?.updatedAt ?? 0
  const hasRaw = !!project?.rawMeta

  const [rawdata, setRawdata] = useState(() => rawdataCache.get(projectId) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!hasRaw) {
      setRawdata(null)
      return
    }
    if (rawdataCache.has(projectId)) {
      setRawdata(rawdataCache.get(projectId))
      return
    }
    setLoading(true)
    setError(null)
    loadRawdata(projectId)
      .then((rd) => {
        if (!cancelled) {
          setRawdata(rd)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[firebase] loadRawdata error', err)
          setError(err)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, hasRaw, version])

  return { rawdata, loading, error }
}

// ============================================================
// แอนิเมชันโลโก้ "Codeframe Studio กำลังประมวลผล" — ใช้ซ้ำได้ (fullscreen หรือ inline)
export function LoadingAnimation({ full = true, label = 'กำลังประมวลผล' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${full ? 'min-h-screen bg-slate-100' : 'py-16'}`}>
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 rounded-2xl bg-indigo-400/30 animate-ping" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-200 [animation:cs-breathe_1.8s_ease-in-out_infinite]">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
        </span>
      </div>
      <div className="text-center">
        <p className="text-lg font-bold text-slate-900">Codeframe <span className="text-indigo-600">Studio</span></p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-slate-400">
          {label}
          <span className="flex gap-0.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" />
          </span>
        </p>
      </div>
    </div>
  )
}

function LoadingScreen() {
  return <LoadingAnimation full />
}

function ErrorScreen({ error }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-bold text-rose-700">เชื่อมต่อ Firebase ไม่สำเร็จ</p>
        <p className="mt-2 text-xs text-rose-600">{error?.message ?? String(error)}</p>
        <p className="mt-3 text-xs text-slate-500">
          ตรวจสอบว่าได้วางค่า config ที่ <code>src/lib/firebaseConfig.js</code> ครบถ้วน
          และเปิดใช้ Firestore + Storage ใน Firebase Console แล้ว
        </p>
      </div>
    </div>
  )
}
