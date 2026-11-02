/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, Bytes } from 'firebase/firestore'
import pako from 'pako'
import { db } from './lib/firebase.js'
import { isLocalUxPreview, useAuth } from './lib/auth.jsx'
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

const emptyState = { projects: [], codeframes: [], members: [], settings: { excludedVars: [], ai: DEFAULT_AI_CONFIG } }

function createUxPreviewData() {
  const now = Date.now()
  const projectId = 'ux-preview-job'
  const cfId = 'ux-preview-cf'
  const rawdata = {
    fileName: 'UX-preview-rawdata.xlsx',
    sheetName: 'Rawdata',
    headers: ['SbjNum', 'Status', 'Q1', 'Q1_Other', 'Q2'],
    rows: [
      ['001', 'Approved', '99', 'ปอนด์', 'ดีมาก'],
      ['002', 'Approved', '99', 'ปอนด์ ณราวิชญ์', 'บริการเร็ว'],
      ['003', 'Requires Approval', '99', 'บอนด์', 'ราคาเหมาะสม'],
      ['004', 'Approved', '101', '', 'กลับมาซื้อซ้ำ'],
      ['005', 'Pending', '99', 'ปังปอนด์', 'แพ็กเกจสวย'],
      ['006', 'Approved', '102', '', 'ใช้ง่าย'],
    ],
    questions: [
      { id: 'q_status', label: 'Status', text: 'Status', index: 1, columns: [1] },
      { id: 'q1', label: 'Q1', text: 'แบรนด์/ชื่อที่เลือก', index: 2, columns: [2] },
      { id: 'q1_other', label: 'Q1_Other', text: 'อื่นๆ ระบุ', index: 3, columns: [3] },
      { id: 'q2', label: 'Q2', text: 'เหตุผลที่เลือก', index: 4, columns: [4] },
    ],
  }
  const codebook = {
    fileName: 'UX-preview-codebook.sav',
    varCount: 4,
    byVar: {
      Q1: { label: 'แบรนด์/ชื่อที่เลือก', values: [
        { value: '99', label: 'อื่นๆ ระบุ' },
        { value: '101', label: 'แบรนด์ A' },
        { value: '102', label: 'แบรนด์ B' },
      ] },
    },
  }
  const project = {
    id: projectId,
    createdAt: now - 86400000,
    name: 'UX Preview · Starry Sky 3',
    client: 'Kao',
    programmer: 'พี่ไอซ์',
    clientDueDate: '2026-07-03',
    programmerDueDate: '2026-07-05',
    ownerUid: 'local-ux-preview',
    ownerEmail: 'js-ux-preview@local.test',
    ownerName: 'JS UX Preview',
    sharedWithUids: [],
    sharedWithEmails: [],
    rawMeta: { fileName: rawdata.fileName, sheetName: rawdata.sheetName, questions: rawdata.questions, rowCount: rawdata.rows.length, chunkCount: -1, rawdata, updatedAt: now - 3600000 },
    codebook,
    codebookMeta: { chunkCount: 0, varCount: codebook.varCount, fileName: codebook.fileName, updatedAt: now - 3000000 },
    boxes: { ce: { questionIds: ['q1', 'q1_other'], seenRowCount: 2 }, oe: { questionIds: [], seenRowCount: 0 }, verbatim: { sbjNumId: null, questionIds: [], refQuestionIds: [], seenRowCount: 0 } },
    notes: [{ id: 'note-1', text: 'UX preview สำหรับตรวจ flow: Upload Rawdata → CE → Group Code → Export', createdAt: now - 7200000, updatedAt: now - 7200000 }],
  }
  const codeframe = {
    id: cfId,
    projectId,
    box: 'ce',
    name: 'Codeframe CE other',
    createdAt: now - 1800000,
    sheets: [{
      id: 'sheet-1',
      name: 'Q1 Other',
      questionIds: ['q1', 'q1_other'],
      assignments: { 'ปอนด์': ['code-101'], 'ปอนด์ ณราวิชญ์': ['code-101'], 'บอนด์': ['code-101'] },
      nets: [
        { id: 'net-1', name: 'Celebrity / Presenter', level: 1, codes: [
          { id: 'code-101', codeNo: 101, thai: 'ปอนด์ ณราวิชญ์', thai2: '', eng: 'Pond Naravit', aiNew: false, manualNew: false },
          { id: 'code-102', codeNo: 102, thai: 'แบรนด์ A', thai2: '', eng: 'Brand A', aiNew: false, manualNew: false },
          { id: 'code-103', codeNo: 103, thai: 'อื่นๆ ระบุ', thai2: '', eng: 'Other specify', aiNew: false, manualNew: false },
        ] },
      ],
      checkpoints: [],
      manualRecodeRules: [],
    }],
    checkpoints: [],
    clientReviewEnabled: false,
    reviewFreqByCode: {},
    reviewSheetStatusMap: {},
    reviewLinks: [],
  }
  rawdataCache.set(projectId, rawdata)
  return {
    projects: [project],
    codeframes: [codeframe],
    members: [{ id: 'local-ux-preview', email: 'js-ux-preview@local.test', displayName: 'JS UX Preview', role: 'superadmin', status: 'approved' }],
    settings: { excludedVars: ['SbjNum', 'Status', 'Duration'], ai: DEFAULT_AI_CONFIG },
  }
}


// cache ของ rawdata (ก้อนคำตอบ) ที่โหลดจาก Firestore — กันโหลดซ้ำเวลาเปลี่ยนหน้า (key = projectId)
const rawdataCache = new Map()
const originalRawdataCache = new Map()
const rawdataUndoCache = new Map()

// คิวเขียน Rawdata ต่อโปรเจกต์: ให้ UI อัปเดตทันที แต่ Firestore เขียนเรียงลำดับกัน
// กันเคสแก้ Verbatim หลายคำติด ๆ กันแล้ว request ที่ช้ากว่ากลับไปทับ request ใหม่กว่า
const rawdataWriteQueues = new Map()
function enqueueRawdataWrite(projectId, task) {
  const previous = rawdataWriteQueues.get(projectId) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  const queued = current.finally(() => {
    if (rawdataWriteQueues.get(projectId) === queued) rawdataWriteQueues.delete(projectId)
  })
  rawdataWriteQueues.set(projectId, queued)
  return current
}

// ---------- เก็บ rawdata ลง Firestore แบบบีบอัด (gzip) + ซอยเป็น chunk ----------
// บีบ JSON ด้วย gzip ก่อน (ข้อความ survey ซ้ำเยอะ บีบได้หลายเท่า) แล้วซอย byte เป็นชิ้น
// เก็บเป็น Firestore Bytes ใน collection 'rawdata_chunks' (docId = `${projectId}_${i}`)
//   - แต่ละ doc ≤ ~900KB (ใต้ลิมิต 1MB/doc)
//   - แต่ละ batch commit ≤ ~8MB (ใต้ลิมิต 10MB/commit ของ Firestore)
const RAW_CHUNK_BYTES = 900_000
const MAX_BATCH_BYTES = 8_000_000
const BATCH_OPS = 400 // Firestore batch จำกัด 500 ops/รอบ
const chunkDocId = (ownerId, i) => `${ownerId}_${i}`
const originalRawdataOwnerId = (projectId) => `${projectId}__original`
const rawdataUndoOwnerId = (projectId, undoId) => `${projectId}__undo_${undoId}`

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

async function readOriginalRawdata(projectId, originalChunkCount = 0) {
  if (originalRawdataCache.has(projectId)) return originalRawdataCache.get(projectId)
  if (!originalChunkCount) return null
  const rawdata = await readRawdataChunks(originalRawdataOwnerId(projectId), originalChunkCount)
  if (rawdata) originalRawdataCache.set(projectId, rawdata)
  return rawdata
}

const rawdataUndoCacheKey = (projectId, undoId) => `${projectId}::${undoId}`

async function readRawdataUndo(projectId, undoMeta) {
  if (!undoMeta?.id) return null
  const key = rawdataUndoCacheKey(projectId, undoMeta.id)
  if (rawdataUndoCache.has(key)) return rawdataUndoCache.get(key)
  if (undoMeta.cells?.length) {
    const cached = { ...undoMeta, cells: undoMeta.cells }
    rawdataUndoCache.set(key, cached)
    return cached
  }
  if (!undoMeta.chunkCount) return null
  const undo = await readRawdataChunks(rawdataUndoOwnerId(projectId, undoMeta.id), undoMeta.chunkCount)
  if (undo) rawdataUndoCache.set(key, undo)
  return undo
}

function deleteRawdataUndoChunkOps(projectId, undoStack = []) {
  return (undoStack ?? []).flatMap((u) => deleteRawdataChunkOps(rawdataUndoOwnerId(projectId, u.id), u.chunkCount ?? 0))
}

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
    checkpointsJson: JSON.stringify(cf.checkpoints ?? []),
    // CI Review / Genlink fields must persist too; otherwise links disappear after refresh
    // and public review rules cannot read the codeframe.
    clientReviewEnabled: cf.clientReviewEnabled ?? false,
    reviewFreqByCode: cf.reviewFreqByCode ?? {},
    reviewSheetStatusMap: cf.reviewSheetStatusMap ?? {},
    reviewLinks: cf.reviewLinks ?? [],
    reviewProjectName: cf.reviewProjectName ?? '',
    reviewUpdatedAt: cf.reviewUpdatedAt ?? null,
  }
}
function cfFromDoc(d) {
  const sheets = (() => {
    try {
      return JSON.parse(d.sheetsJson ?? '[]')
    } catch {
      return []
    }
  })()
  const checkpoints = (() => {
    try {
      return JSON.parse(d.checkpointsJson ?? '[]')
    } catch {
      return []
    }
  })()
  return {
    id: d.id,
    projectId: d.projectId,
    box: d.box ?? 'oe',
    name: d.name,
    createdAt: d.createdAt,
    sheets,
    checkpoints,
    clientReviewEnabled: d.clientReviewEnabled ?? false,
    reviewFreqByCode: d.reviewFreqByCode ?? {},
    reviewSheetStatusMap: d.reviewSheetStatusMap ?? {},
    reviewLinks: d.reviewLinks ?? [],
    reviewProjectName: d.reviewProjectName ?? '',
    reviewUpdatedAt: d.reviewUpdatedAt ?? null,
  }
}

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const { user, isAdmin } = useAuth()
  const uxPreview = isLocalUxPreview()
  const [state, setState] = useState(() => (uxPreview ? createUxPreviewData() : emptyState))
  const [ready, setReady] = useState(() => uxPreview)
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
    if (uxPreview) {
      setActiveAiPayload(toAiPayload(DEFAULT_AI_CONFIG))
      setReady(true)
      return () => { cancelled = true }
    }
    ;(async () => {
      try {
        const [pSnap, cSnap, uSnap, settingsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'codeframes')),
          // Firestore rules only allow admins to list all users. Approved members
          // must still be able to open the app and load their own/shared jobs.
          isAdmin ? getDocs(collection(db, 'users')) : Promise.resolve({ docs: [] }),
          getDoc(doc(db, 'settings', 'global')),
        ])
        if (cancelled) return
        const byCreatedDesc = (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
        const allProjects = pSnap.docs.map((d) => withBoxes(d.data()))
        const canSeeProject = (p) => {
          if (isAdmin) return true
          if (!user?.uid) return false
          return p.ownerUid === user.uid || (p.sharedWithUids ?? []).includes(user.uid)
        }
        const projects = allProjects.filter(canSeeProject)
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
        const visibleProjectIds = new Set(projects.map((p) => p.id))
        const members = uSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m) => m.status === 'approved')
          .sort((a, b) => (a.email || '').localeCompare(b.email || ''))
        const aiCfg = { ...DEFAULT_AI_CONFIG, ...(settingsSnap.data()?.ai ?? {}) }
        setActiveAiPayload(toAiPayload(aiCfg)) // sync ให้ทุก AI request ใช้ provider/model ที่ตั้งไว้
        setState({
          projects,
          codeframes: cSnap.docs.map((d) => cfFromDoc(d.data())).filter((cf) => visibleProjectIds.has(cf.projectId)).sort(byCreatedDesc),
          members,
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
  }, [user?.uid, isAdmin, uxPreview])

  // ---------- ตัวช่วยบันทึก ----------
  // ถ้า codebook ถูกเก็บแบบ chunk แล้ว (มี codebookMeta) → ตัด codebook ออกจากเอกสาร (กัน doc โต)
  //   ของเก่าที่ยังเก็บ inline (ไม่มี codebookMeta) → เก็บ codebook ในเอกสารเหมือนเดิม (ไม่ทำให้หาย)
  const persistProject = (p) => {
    if (uxPreview) return Promise.resolve()
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
        if (uxPreview) return
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
        ownerUid: user?.uid || '',
        ownerEmail: user?.email || '',
        ownerName: user?.displayName || '',
        sharedWithUids: [],
        sharedWithEmails: [],
        rawMeta: null,
        codebook: null, // metadata Value+Label จากไฟล์ SPSS .sav (เก็บครั้งเดียวตอนแนบ)
        boxes: defaultBoxes(),
        notes: [],
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
        ...st,
        projects: st.projects.filter((p) => p.id !== id),
        codeframes: st.codeframes.filter((c) => c.projectId !== id),
      }))
      const ops = [(b) => b.delete(doc(db, 'projects', id))]
      ops.push(...deleteRawdataChunkOps(id, project?.rawMeta?.chunkCount ?? 0))
      ops.push(...deleteRawdataChunkOps(originalRawdataOwnerId(id), project?.rawMeta?.originalChunkCount ?? 0))
      ops.push(...deleteRawdataUndoChunkOps(id, project?.rawMeta?.undoStack ?? []))
      ops.push(...deleteRawdataUndoChunkOps(id, project?.rawMeta?.redoStack ?? []))
      ops.push(...deleteCodebookChunkOps(id, project?.codebookMeta?.chunkCount ?? 0))
      cfs.forEach((c) => ops.push((b) => b.delete(doc(db, 'codeframes', c.id))))
      commitInBatches(ops).catch(reportPersistError)
      rawdataCache.delete(id)
    },

    // ---------- Rawdata (ก้อนกลางของ Project — ซอยเป็น chunk เก็บใน Firestore) ----------
    async setRawdata(projectId, rawdata, options = {}) {
      const { updateOriginal = true, undoSnapshot = null } = options
      const cur = stateRef.current.projects.find((p) => p.id === projectId)
      const currentUndoStack = cur?.rawMeta?.undoStack ?? []
      const currentRedoStack = cur?.rawMeta?.redoStack ?? []
      const fastUndoMeta = undoSnapshot?.id && (undoSnapshot.cells?.length ?? 0) > 0
        ? {
            id: undoSnapshot.id,
            kind: undoSnapshot.kind || 'rawdata_edit',
            title: undoSnapshot.title || 'Rawdata edit',
            createdAt: undoSnapshot.createdAt || Date.now(),
            cellCount: undoSnapshot.cells.length,
            rowCount: rawdata.rows.length,
            chunkCount: 0,
          }
        : null
      if (fastUndoMeta) {
        rawdataUndoCache.set(rawdataUndoCacheKey(projectId, fastUndoMeta.id), {
          ...fastUndoMeta,
          cells: undoSnapshot.cells,
        })
      }
      const optimisticUndoStack = fastUndoMeta ? [fastUndoMeta, ...currentUndoStack].slice(0, 15) : currentUndoStack
      const optimisticRedoStack = fastUndoMeta ? [] : currentRedoStack
      const optimisticMeta = {
        fileName: rawdata.fileName,
        sheetName: rawdata.sheetName,
        questions: rawdata.questions,
        rowCount: rawdata.rows.length,
        // คง chunkCount เดิมไว้จนกว่าเขียน chunks สำเร็จ — กัน client อื่นอ่าน meta ใหม่ก่อน chunks พร้อม
        chunkCount: cur?.rawMeta?.chunkCount ?? 0,
        originalChunkCount: cur?.rawMeta?.originalChunkCount ?? 0,
        originalUpdatedAt: cur?.rawMeta?.originalUpdatedAt ?? null,
        undoStack: optimisticUndoStack,
        redoStack: optimisticRedoStack,
        updatedAt: Date.now(),
        ...(cur?.rawMeta?.rawdata ? { rawdata } : {}),
      }

      // อัปเดต UI/cache ทันที เพื่อให้แก้ Verbatim ต่อได้โดยไม่ต้องรอ Firebase
      rawdataCache.set(projectId, rawdata)
      if (cur) {
        const optimistic = { ...cur, rawMeta: optimisticMeta }
        setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? optimistic : p)) }))
      }

      return enqueueRawdataWrite(projectId, async () => {
        const latest = stateRef.current.projects.find((p) => p.id === projectId)
        const oldChunkCount = latest?.rawMeta?.chunkCount ?? 0
        const chunkCount = uxPreview ? -1 : await writeRawdataChunks(projectId, rawdata, oldChunkCount)
        const oldUndoStack = latest?.rawMeta?.undoStack ?? []
        const oldRedoStack = latest?.rawMeta?.redoStack ?? []
        let undoStack = oldUndoStack
        let redoStack = oldRedoStack
        if (undoSnapshot?.id && (undoSnapshot.cells?.length ?? 0) > 0) {
          const cleanUndo = {
            id: undoSnapshot.id,
            kind: undoSnapshot.kind || 'rawdata_edit',
            title: undoSnapshot.title || 'Rawdata edit',
            createdAt: undoSnapshot.createdAt || Date.now(),
            cellCount: undoSnapshot.cells.length,
            rowCount: rawdata.rows.length,
            cells: undoSnapshot.cells,
          }
          const undoChunkCount = uxPreview ? -1 : await writeRawdataChunks(rawdataUndoOwnerId(projectId, cleanUndo.id), cleanUndo, 0)
          const metaItem = {
            id: cleanUndo.id,
            kind: cleanUndo.kind,
            title: cleanUndo.title,
            createdAt: cleanUndo.createdAt,
            cellCount: cleanUndo.cellCount,
            rowCount: cleanUndo.rowCount,
            chunkCount: undoChunkCount,
          }
          undoStack = [metaItem, ...oldUndoStack.filter((u) => u.id !== cleanUndo.id)].slice(0, 15)
          redoStack = []
        }
        const oldOriginalChunkCount = latest?.rawMeta?.originalChunkCount ?? 0
        const shouldWriteOriginal = updateOriginal
        const originalChunkCount = uxPreview
          ? -1
          : shouldWriteOriginal
            ? await writeRawdataChunks(originalRawdataOwnerId(projectId), rawdata, oldOriginalChunkCount)
            : oldOriginalChunkCount
        if (shouldWriteOriginal) originalRawdataCache.set(projectId, rawdata)
        const meta = {
          fileName: rawdata.fileName,
          sheetName: rawdata.sheetName,
          questions: rawdata.questions,
          rowCount: rawdata.rows.length,
          chunkCount,
          originalChunkCount,
          originalUpdatedAt: shouldWriteOriginal ? Date.now() : (latest?.rawMeta?.originalUpdatedAt ?? null),
          undoStack,
          redoStack,
          updatedAt: Date.now(),
          ...(uxPreview ? { rawdata } : {}),
        }
        if (latest) {
          const updated = { ...latest, rawMeta: meta }
          setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? updated : p)) }))
          persistProject(updated)
        }
      })
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
      // Legacy fallback: โปรเจกต์เก่าบางตัวเคยเก็บ rawdata inline ก่อนระบบ chunk
      if (project?.rawdata) {
        rawdataCache.set(projectId, project.rawdata)
        return project.rawdata
      }
      if (project?.rawMeta?.rawdata) {
        rawdataCache.set(projectId, project.rawMeta.rawdata)
        return project.rawMeta.rawdata
      }
      if (!project?.rawMeta || (project.rawMeta.chunkCount ?? 0) <= 0) return null
      const rawdata = await readRawdataChunks(projectId, project.rawMeta.chunkCount ?? 0)
      if (rawdata) rawdataCache.set(projectId, rawdata)
      return rawdata
    },
    async loadOriginalRawdata(projectId) {
      const project = stateRef.current.projects.find((p) => p.id === projectId)
      return readOriginalRawdata(projectId, project?.rawMeta?.originalChunkCount ?? 0)
    },
    async restoreRawdataUndo(projectId, undoId = null) {
      const project = stateRef.current.projects.find((p) => p.id === projectId)
      const stack = project?.rawMeta?.undoStack ?? []
      const redoStack = project?.rawMeta?.redoStack ?? []
      const undoMeta = undoId ? stack.find((u) => u.id === undoId) : stack[0]
      if (!project || !undoMeta) throw new Error('ยังไม่มีประวัติ Rawdata ให้กู้คืน')
      const [rawdata, undo] = await Promise.all([
        api.loadRawdata(projectId),
        readRawdataUndo(projectId, undoMeta),
      ])
      if (!rawdata || !undo?.cells?.length) throw new Error('โหลดข้อมูล Undo ไม่สำเร็จ')
      const rows = (rawdata.rows ?? []).map((r) => r.slice())
      let restored = 0
      for (const cell of undo.cells) {
        const r = Number(cell.r)
        const c = Number(cell.c)
        if (!Number.isInteger(r) || !Number.isInteger(c) || !rows[r]) continue
        rows[r][c] = String(cell.v ?? '')
        restored += 1
      }
      const nextStack = stack.filter((u) => u.id !== undoMeta.id)
      const nextRedoStack = [{ ...undoMeta, redoneAt: undoMeta.createdAt ?? 0 }, ...redoStack].slice(0, 15)
      const latest = stateRef.current.projects.find((p) => p.id === projectId) ?? project
      const fastUpdatedAt = Math.max(Number(latest.rawMeta?.updatedAt ?? 0) + 1, Number(undoMeta.createdAt ?? 0))
      const updated = { ...latest, rawMeta: { ...(latest.rawMeta ?? {}), undoStack: nextStack, redoStack: nextRedoStack, updatedAt: fastUpdatedAt } }
      rawdataCache.set(projectId, { ...rawdata, rows })
      setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? updated : p)) }))
      api.setRawdata(projectId, { ...rawdata, rows }, { updateOriginal: false })
        .catch(reportPersistError)
      setToast({
        type: 'success',
        title: 'Undo Rawdata แล้ว',
        message: `คืนค่า ${restored.toLocaleString('th-TH')} เซลล์จาก “${undoMeta.title || 'Undo'}”`,
        duration: 5000,
      })
      return { restored, undo: undoMeta }
    },
    async restoreRawdataRedo(projectId, redoId = null) {
      const project = stateRef.current.projects.find((p) => p.id === projectId)
      const undoStack = project?.rawMeta?.undoStack ?? []
      const redoStack = project?.rawMeta?.redoStack ?? []
      const redoMeta = redoId ? redoStack.find((u) => u.id === redoId) : redoStack[0]
      if (!project || !redoMeta) throw new Error('ยังไม่มีประวัติ Redo Rawdata')
      const [rawdata, undo] = await Promise.all([
        api.loadRawdata(projectId),
        readRawdataUndo(projectId, redoMeta),
      ])
      if (!rawdata || !undo?.cells?.length) throw new Error('โหลดข้อมูล Redo ไม่สำเร็จ')
      const rows = (rawdata.rows ?? []).map((r) => r.slice())
      let restored = 0
      for (const cell of undo.cells) {
        const r = Number(cell.r)
        const c = Number(cell.c)
        if (!Number.isInteger(r) || !Number.isInteger(c) || !rows[r]) continue
        rows[r][c] = String(cell.next ?? '')
        restored += 1
      }
      const nextRedoStack = redoStack.filter((u) => u.id !== redoMeta.id)
      const nextUndoStack = [{ ...redoMeta, redoneAt: null }, ...undoStack].slice(0, 15)
      const latest = stateRef.current.projects.find((p) => p.id === projectId) ?? project
      const fastUpdatedAt = Math.max(Number(latest.rawMeta?.updatedAt ?? 0) + 1, Number(redoMeta.createdAt ?? 0))
      const updated = { ...latest, rawMeta: { ...(latest.rawMeta ?? {}), undoStack: nextUndoStack, redoStack: nextRedoStack, updatedAt: fastUpdatedAt } }
      rawdataCache.set(projectId, { ...rawdata, rows })
      setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? updated : p)) }))
      api.setRawdata(projectId, { ...rawdata, rows }, { updateOriginal: false })
        .catch(reportPersistError)
      setToast({
        type: 'success',
        title: 'Redo Rawdata แล้ว',
        message: `ทำซ้ำ ${restored.toLocaleString('th-TH')} เซลล์จาก “${redoMeta.title || 'Redo'}”`,
        duration: 5000,
      })
      return { restored, redo: redoMeta }
    },

    // ---------- Codeframes (ผูกกับ project + box) ----------
    addCodeframe(data) {
      const cf = { id: uid(), createdAt: Date.now(), box: 'oe', sheets: [], ...data }
      setState((s) => ({ ...s, codeframes: [cf, ...s.codeframes] }))
      if (!uxPreview) setDoc(doc(db, 'codeframes', cf.id), cfToDoc(cf)).catch(reportPersistError)
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
      const curState = stateRef.current
      const deleting = curState.codeframes.find((c) => c.id === id)
      const projectId = deleting?.projectId
      const project = projectId ? curState.projects.find((p) => p.id === projectId) : null
      const remainingForProject = projectId
        ? curState.codeframes.filter((c) => c.projectId === projectId && c.id !== id)
        : []
      setState((s) => ({ ...s, codeframes: s.codeframes.filter((c) => c.id !== id) }))
      const timers = cfTimers.current
      clearTimeout(timers.get(id))
      timers.delete(id)
      if (!uxPreview) deleteDoc(doc(db, 'codeframes', id)).catch(reportPersistError)
      if (projectId && project?.rawMeta?.originalChunkCount && remainingForProject.length === 0) {
        ;(async () => {
          try {
            const original = await readOriginalRawdata(projectId, project.rawMeta.originalChunkCount)
            if (!original) return
            await api.setRawdata(projectId, original, { updateOriginal: false })
            setToast({
              type: 'success',
              title: 'คืน Rawdata Original แล้ว',
              message: 'ลบ Codeframe ตัวสุดท้ายแล้ว ระบบคืนค่าคำตอบกลับเป็นต้นฉบับก่อนลง Code',
              duration: 5000,
            })
          } catch (err) {
            reportPersistError(err)
          }
        })()
      } else if (projectId && remainingForProject.length === 0 && !project?.rawMeta?.originalChunkCount) {
        setToast({
          type: 'warning',
          title: 'ยังไม่มี Original Rawdata สำรอง',
          message: 'โปรเจกต์นี้ถูกสร้างก่อนระบบเก็บต้นฉบับ แนะนำอัปโหลด Rawdata เดิมอีกครั้งเพื่อสร้าง baseline แล้วค่อยสร้าง Codeframe ใหม่',
          duration: 9000,
        })
      }
    },

    // ---------- Settings (global, ใช้ทุกโปรเจกต์) ----------
    // ตัวแปรที่ "ไม่ทำ Code" — Auto Codeframe จะข้ามตัวแปรเหล่านี้ (เก็บใน settings/global)
    setExcludedVars(vars) {
      const clean = [...new Set(vars.map((v) => String(v).trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'th'))
      setState((s) => ({ ...s, settings: { ...s.settings, excludedVars: clean } }))
      if (!uxPreview) setDoc(doc(db, 'settings', 'global'), { excludedVars: clean }, { merge: true }).catch(reportPersistError)
    },

    // ตั้งค่า AI Provider/Model (Admin/SuperAdmin) — เก็บใน settings/global.ai แล้วใช้ร่วมกันทั้งระบบ
    setAiConfig(partial) {
      setState((s) => {
        const ai = { ...DEFAULT_AI_CONFIG, ...s.settings.ai, ...partial }
        setActiveAiPayload(toAiPayload(ai))
        if (!uxPreview) setDoc(doc(db, 'settings', 'global'), { ai }, { merge: true }).catch(reportPersistError)
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
  if (p.boxes?.ce && p.boxes?.oe && p.boxes?.verbatim) return { ...p, notes: p.notes ?? [] }
  const d = defaultBoxes()
  return { ...p, boxes: { ...d, ...(p.boxes ?? {}) }, notes: p.notes ?? [] }
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
  const legacyRaw = project?.rawdata ?? project?.rawMeta?.rawdata ?? null
  const hasRaw = !!project?.rawMeta && ((project.rawMeta.chunkCount ?? 0) > 0 || !!legacyRaw)

  const [rawdata, setRawdata] = useState(() => rawdataCache.get(projectId) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)
  const autoRetryRef = useRef({ key: null, count: 0 })

  useEffect(() => {
    let cancelled = false
    if (!projectId || !hasRaw) {
      setRawdata(null)
      setLoading(false)
      return
    }
    if (!reloadTick && rawdataCache.has(projectId)) {
      setRawdata(rawdataCache.get(projectId))
      setLoading(false)
      return
    }
    if (reloadTick) rawdataCache.delete(projectId)
    setLoading(true)
    setError(null)
    const loadKey = `${projectId}:${version}`
    loadRawdata(projectId)
      .then((rd) => {
        if (!cancelled) {
          if (!rd) throw new Error(`ไม่พบ Rawdata chunks ของโปรเจกต์นี้ (chunkCount=${project?.rawMeta?.chunkCount ?? 0})`)
          autoRetryRef.current = { key: loadKey, count: 0 }
          setRawdata(rd)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          // ถ้ากดปุ่ม retry แล้วโหลดได้ แปลว่า initial load อาจ race กับ state/cache/Firebase
          // ให้ retry อัตโนมัติหนึ่งครั้งก่อนโชว์ error เพื่อไม่ให้ผู้ใช้ต้องกดเองหลัง refresh
          const cur = autoRetryRef.current
          const canRetry = cur.key !== loadKey || cur.count < 1
          if (canRetry) {
            // ไม่ใช้ console.error ในรอบที่จะ retry เพราะถ้า retry สำเร็จแล้วจะเหลือ error แดงหลอกใน DevTools
            console.warn('[firebase] loadRawdata initial attempt failed; retrying once', err)
            autoRetryRef.current = { key: loadKey, count: (cur.key === loadKey ? cur.count : 0) + 1 }
            rawdataCache.delete(projectId)
            setTimeout(() => {
              if (!cancelled) setReloadTick((n) => n + 1)
            }, 350)
          } else {
            console.error('[firebase] loadRawdata error after retry', err)
            setError(err)
            setLoading(false)
          }
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, hasRaw, version, reloadTick])

  return { rawdata, loading, error, reload: () => setReloadTick((n) => n + 1) }
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
