/* eslint-disable react-hooks/refs */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Grid } from 'react-window'
import { ArrowLeft, FileSpreadsheet, Search, X, Download, ListFilter } from 'lucide-react'
import { useStore, useRawdata, LoadingAnimation } from '../store.jsx'
import { exportRawdataXlsx, exportRawdataWithEdits, buildOverwrittenRawdata } from '../lib/excel.js'
import { Button } from '../components/ui.jsx'

const COL_W = 100 // ความกว้างคอลัมน์เท่ากันทุกช่อง (px) — เท่า default ของ Google Sheets
const ROW_H = 30 // ความสูงแถว (px)
const INDEX_W = 50 // ความกว้างคอลัมน์เลขแถว
const HEAD_H = 38 // ความสูงหัวตาราง

const normCell = (v) => String(v ?? '').trim()
const sortValueOptions = (a, b) => {
  const an = Number(a.value)
  const bn = Number(b.value)
  const aNum = a.value !== '' && Number.isFinite(an)
  const bNum = b.value !== '' && Number.isFinite(bn)
  if (aNum && bNum) return an - bn
  if (aNum) return -1
  if (bNum) return 1
  return String(a.value).localeCompare(String(b.value), 'th', { numeric: true, sensitivity: 'base' })
}

// เซลล์ข้อมูล (react-window เรนเดอร์เฉพาะที่มองเห็น)
//   isEdited = เซลล์ที่ถูก "ลง Code ทับค่าอื่นๆ" → ไฮไลต์เหลือง
function Cell({ columnIndex, rowIndex, style, rows, flashCol, masks }) {
  const v = rows[rowIndex]?.[columnIndex] ?? ''
  const isEdited = masks?.[rowIndex]?.has(columnIndex)
  return (
    <div
      style={style}
      title={v}
      className={`truncate border-b border-r border-slate-100 px-2 text-xs leading-[30px] ${
        flashCol === columnIndex
          ? 'bg-amber-100'
          : isEdited
            ? 'bg-yellow-100'
            : rowIndex % 2
              ? 'bg-slate-50/40'
              : 'bg-white'
      } ${isEdited ? 'text-center font-bold text-indigo-700' : v ? 'text-slate-700' : 'text-slate-300'}`}
    >
      {v}
    </div>
  )
}

export default function RawdataViewer() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { state, setRawdata, loadOriginalRawdata } = useStore()
  const project = state.projects.find((p) => p.id === projectId)
  const { rawdata, loading, error } = useRawdata(projectId)
  const [originalState, setOriginalState] = useState({ projectId: null, data: null })
  const originalRawdata = originalState.projectId === projectId ? originalState.data : null

  const [query, setQuery] = useState('') // ค้นหาเนื้อหา (กรองแถว ทุกคอลัมน์)
  const [colFilters, setColFilters] = useState({}) // { colIndex: text } กรองรายคอลัมน์
  const [colExactFilters, setColExactFilters] = useState({}) // { colIndex: value } เลือกจากรายการค่า/Code → match ตรงตัว
  const [filterPopover, setFilterPopover] = useState(null) // { col, x, y }
  const [finderOpen, setFinderOpen] = useState(false) // Ctrl+F ค้นหาคอลัมน์
  const [finderQuery, setFinderQuery] = useState('')
  const [flashCol, setFlashCol] = useState(null)
  const [savingCodedRawdata, setSavingCodedRawdata] = useState(false)

  const headerRef = useRef(null)
  const indexRef = useRef(null)
  const gridRef = useRef(null)
  const flashTimer = useRef(null)
  const autoSaveTimer = useRef(null)
  const autoSaveSignature = useRef('')

  useEffect(() => {
    let cancelled = false
    if (!projectId || !(project?.rawMeta?.originalChunkCount > 0)) return () => { cancelled = true }
    loadOriginalRawdata(projectId)
      .then((value) => { if (!cancelled) setOriginalState({ projectId, data: value }) })
      .catch((err) => console.error('load original rawdata for Verbatim repair failed', err))
    return () => { cancelled = true }
  }, [projectId, project?.rawMeta?.originalChunkCount, loadOriginalRawdata])

  // ลง Code แบบ "เขียนทับค่าอื่นๆ" (ไม่เพิ่มคอลัมน์) + จดจุดที่แก้ไว้ไฮไลต์
  const coded = useMemo(() => {
    if (!rawdata) return null
    const sheets = state.codeframes.filter((c) => c.projectId === projectId).flatMap((c) => c.sheets ?? [])
    if (!sheets.length) return null
    const { rows, editMaskRows, editedCols, editLog } = buildOverwrittenRawdata(
      rawdata,
      { sheets },
      project.codebook,
      { sourceRawdata: originalRawdata },
    )
    if (!editedCols.size) return null
    return { rows, editMaskRows, editedCols, editLog }
  }, [rawdata, originalRawdata, state.codeframes, projectId, project])

  const editedCols = coded?.editedCols ?? null

  const headers = useMemo(() => {
    if (!rawdata) return []
    if (rawdata.headers?.length) return rawdata.headers
    const first = rawdata.rows?.[0]
    return first ? first.map((_, i) => `คอลัมน์ ${i + 1}`) : []
  }, [rawdata])

  // กรองแถว: ค้นหารวม (query) + ตัวกรองรายคอลัมน์ (AND) — เก็บ mask จุดที่แก้ให้ตรงแถวที่กรอง
  const { rows, masks } = useMemo(() => {
    const all = coded?.rows ?? rawdata?.rows ?? []
    const allMasks = coded?.editMaskRows ?? null
    const q = query.trim().toLowerCase()
    const active = Object.entries(colFilters)
      .map(([ci, v]) => [Number(ci), v.trim().toLowerCase(), colExactFilters[ci] != null ? normCell(colExactFilters[ci]).toLowerCase() : null])
      .filter(([, v]) => v)
    if (!q && !active.length) return { rows: all, masks: allMasks }
    const outRows = []
    const outMasks = allMasks ? [] : null
    all.forEach((row, i) => {
      if (q && !row.some((c) => String(c ?? '').toLowerCase().includes(q))) return
      for (const [ci, v, exact] of active) {
        const cell = normCell(row[ci]).toLowerCase()
        if (exact != null) {
          if (cell !== exact) return
        } else if (!cell.includes(v)) return
      }
      outRows.push(row)
      if (outMasks) outMasks.push(allMasks[i])
    })
    return { rows: outRows, masks: outMasks }
  }, [rawdata, coded, query, colFilters, colExactFilters])

  const activeFilterCount = useMemo(
    () => Object.values(colFilters).filter((v) => v.trim()).length,
    [colFilters],
  )

  const getColumnOptions = (ci) => {
    const all = coded?.rows ?? rawdata?.rows ?? []
    const q = rawdata?.questions?.find((x) => (x.columns ?? [x.index]).includes(ci))
    const cb = q ? project?.codebook?.byVar?.[q.label] : null
    const targetCf = q
      ? state.codeframes.find((c) => c.projectId === projectId && (c.sheets ?? []).some((s) => (s.questionIds ?? []).includes(q.id)))
      : null
    const targetSheet = targetCf?.sheets?.find((s) => (s.questionIds ?? []).includes(q.id))
    const labels = new Map((cb?.values ?? []).map((v) => [normCell(v.value), String(v.label ?? '').trim()]))
    const counts = new Map()
    let blank = 0
    for (const row of all) {
      const v = normCell(row?.[ci])
      if (!v) { blank += 1; continue }
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const options = [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: labels.get(value) || '' }))
      .sort(sortValueOptions)
    const missingCodebook = [...labels.entries()]
      .filter(([value]) => value && !counts.has(value))
      .map(([value, label]) => ({ value, count: 0, label }))
      .sort(sortValueOptions)
    return {
      question: q,
      questionLabel: cb?.label || q?.label || headers[ci] || '',
      options,
      missingCodebook,
      blank,
      total: all.length,
      unique: counts.size,
      targetCf,
      targetSheet,
    }
  }

  const activeFilterItems = useMemo(() => Object.entries(colFilters)
    .map(([ci, v]) => ({ ci: Number(ci), value: String(v ?? '').trim(), exact: colExactFilters[ci] != null }))
    .filter((it) => it.value), [colFilters, colExactFilters])

  // คอลัมน์ที่ตรงกับคำค้นใน finder (Ctrl+F)
  const finderMatches = useMemo(() => {
    const q = finderQuery.trim().toLowerCase()
    if (!q) return []
    const res = []
    for (let i = 0; i < headers.length && res.length < 60; i++) {
      if (String(headers[i]).toLowerCase().includes(q)) res.push(i)
    }
    return res
  }, [headers, finderQuery])

  // sync เลื่อนหัวตาราง/เลขแถว ตามตัว grid (ตรึงไว้แบบ Google Sheet)
  const onScroll = (e) => {
    const { scrollLeft, scrollTop } = e.currentTarget
    if (headerRef.current) headerRef.current.style.transform = `translateX(${-scrollLeft}px)`
    if (indexRef.current) indexRef.current.style.transform = `translateY(${-scrollTop}px)`
    if (filterPopover) setFilterPopover(null) // ปิด popover เมื่อเลื่อน (กันลอยผิดตำแหน่ง)
  }

  const jumpToColumn = (ci) => {
    gridRef.current?.scrollToColumn({ index: ci, align: 'start' })
    setFinderOpen(false)
    setFlashCol(ci)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashCol(null), 1800)
  }

  const openFilter = (ci, e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.min(rect.left, window.innerWidth - 260)
    setFilterPopover({ col: ci, x, y: rect.bottom })
  }

  const handleExport = async () => {
    if (!rawdata) return
    const base = (project.rawMeta?.fileName ?? 'rawdata').replace(/\.(xlsx|xls|csv)$/i, '')
    const suffix = query || activeFilterCount ? '_filtered' : ''
    try {
      if (coded) await exportRawdataWithEdits(headers, rows, masks, editedCols, `${base}_coded${suffix}.xlsx`, coded.editLog ?? [])
      else await exportRawdataXlsx(headers, rows, `${base}${suffix}.xlsx`)
    } catch (err) {
      console.error(err)
      window.alert(`Export ไม่สำเร็จ: ${err?.message || err}`)
    }
  }

  useEffect(() => {
    if (!rawdata || !coded || savingCodedRawdata) return undefined
    const editCount = coded.editMaskRows.reduce((sum, set) => sum + (set?.size ?? 0), 0)
    if (!editCount) return undefined
    const signature = JSON.stringify((coded.editLog ?? []).map((e) => [
      e.rowKey, e.action, e.codeColumnIndex, e.newCode, e.ruleCode, e.sourceCodeColumnIndex,
    ]))
    if (signature && autoSaveSignature.current === signature) return undefined
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      autoSaveSignature.current = signature
      setSavingCodedRawdata(true)
      try {
        await setRawdata(projectId, { ...rawdata, rows: coded.rows }, { updateOriginal: false })
        setColFilters({})
        setColExactFilters({})
      } catch (err) {
        console.error('auto-save coded rawdata failed', err)
        autoSaveSignature.current = ''
      } finally {
        setSavingCodedRawdata(false)
      }
    }, 350)
    return () => clearTimeout(autoSaveTimer.current)
  }, [rawdata, coded, savingCodedRawdata, setRawdata, projectId])

  // Ctrl+F → เปิดตัวค้นหาคอลัมน์ (แทน find ของเบราว์เซอร์), Esc → ปิด
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFinderOpen(true)
        setFilterPopover(null)
      } else if (e.key === 'Escape') {
        setFinderOpen(false)
        setFilterPopover(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(flashTimer.current)
    }
  }, [])

  if (!project) {
    return (
      <div className="px-5 py-16 text-center text-slate-400">
        ไม่พบโปรเจกต์นี้ — <Link to="/" className="text-indigo-600 underline">กลับหน้าหลัก</Link>
      </div>
    )
  }

  const colCount = headers.length
  const rowCount = rows.length

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ===== Toolbar ===== */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft size={15} /> {project.name}
        </button>
        <span className="text-slate-300">/</span>
        <h1 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <FileSpreadsheet size={16} className="text-emerald-500" />
          <span className="max-w-[22rem] truncate">{project.rawMeta?.fileName ?? 'Rawdata'}</span>
        </h1>
        {rawdata && (
          <span className="text-xs text-slate-400">
            {headers.length} คอลัมน์ · {rawdata.rows.length} แถว
            {editedCols && <> · <b className="text-indigo-600">{editedCols.size}</b> ข้อที่ลง Code (ไฮไลต์)</>}
            {(query || activeFilterCount > 0) && (
              <> · กรองเหลือ <b className="text-indigo-600">{rowCount}</b> แถว</>
            )}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setColFilters({}); setColExactFilters({}) }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-100"
            >
              <ListFilter size={13} /> ล้างตัวกรอง {activeFilterCount} คอลัมน์
            </button>
          )}
          <button
            onClick={() => setFinderOpen(true)}
            title="ค้นหาคอลัมน์ (Ctrl+F)"
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-300"
          >
            <Search size={13} /> ค้นหาคอลัมน์ <kbd className="rounded bg-slate-100 px-1 text-[10px]">Ctrl+F</kbd>
          </button>

          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาในข้อมูล (กรองแถว)…"
              className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-rose-500"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <Button size="sm" onClick={handleExport} disabled={!rawdata || savingCodedRawdata}>
            <Download size={14} /> Export Excel
          </Button>
        </div>
      </div>

      {activeFilterItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/60 px-5 py-2">
          <span className="text-xs font-bold text-indigo-700">Active Filters:</span>
          {activeFilterItems.map((it) => (
            <button
              key={it.ci}
              onClick={() => {
                setColFilters((f) => { const next = { ...f }; delete next[it.ci]; return next })
                setColExactFilters((f) => { const next = { ...f }; delete next[it.ci]; return next })
              }}
              className="inline-flex max-w-xs items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-indigo-100 hover:bg-rose-50 hover:text-rose-600"
              title="คลิกเพื่อลบ filter นี้"
            >
              <span className="truncate">{headers[it.ci]}</span>
              <span className="font-mono text-indigo-600">{it.exact ? '=' : 'มี'} {it.value}</span>
              <X size={12} />
            </button>
          ))}
          <button
            onClick={() => { setColFilters({}); setColExactFilters({}) }}
            className="ml-auto text-xs font-bold text-indigo-500 hover:text-rose-600"
          >
            ล้างทั้งหมด
          </button>
        </div>
      )}

      {/* ===== Grid ===== */}
      <div className="min-h-0 flex-1 bg-slate-50">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingAnimation full={false} label="กำลังโหลดข้อมูล" />
          </div>
        ) : error ? (
          <p className="m-5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            โหลดข้อมูลไม่สำเร็จ: {error.message}
          </p>
        ) : !rawdata || !colCount ? (
          <p className="m-5 text-sm text-slate-400">ไม่มีข้อมูล Rawdata</p>
        ) : (
          <div className="relative h-full w-full overflow-hidden">
            {/* มุมซ้ายบน */}
            <div
              className="absolute left-0 top-0 z-30 flex items-center justify-center border-b border-r border-slate-200 bg-slate-100 text-[11px] font-bold text-slate-400"
              style={{ width: INDEX_W, height: HEAD_H }}
            >
              #
            </div>

            {/* หัวตาราง (ตรึงบน + คลิกเพื่อกรองรายคอลัมน์) */}
            <div
              className="absolute top-0 z-20 overflow-hidden border-b border-slate-200 bg-slate-100"
              style={{ left: INDEX_W, right: 0, height: HEAD_H }}
            >
              <div ref={headerRef} className="flex h-full will-change-transform">
                {headers.map((h, ci) => {
                  const active = (colFilters[ci] ?? '').trim()
                  const isEdited = editedCols?.has(ci)
                  return (
                    <div
                      key={ci}
                      onClick={(e) => openFilter(ci, e)}
                      title={`${h}${isEdited ? ' — มีการลง Code ทับค่าอื่นๆ' : ''}${active ? ` — กรอง: "${active}"` : ' (คลิกเพื่อกรอง)'}`}
                      style={{ width: COL_W, height: HEAD_H }}
                      className={`flex shrink-0 cursor-pointer items-center gap-1 border-r border-slate-200 px-2 text-xs font-bold ${
                        flashCol === ci
                          ? 'bg-amber-200 text-amber-900'
                          : active
                            ? 'bg-indigo-100 text-indigo-700'
                            : isEdited
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                              : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <span className="truncate">{h}</span>
                      <span className={`ml-auto shrink-0 text-[9px] ${active ? 'text-indigo-500' : isEdited ? 'text-indigo-200' : 'text-slate-300'}`}>▼</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* คอลัมน์เลขแถว (ตรึงซ้าย) */}
            <div
              className="absolute left-0 z-20 overflow-hidden border-r border-slate-200 bg-slate-100"
              style={{ top: HEAD_H, bottom: 0, width: INDEX_W }}
            >
              <div ref={indexRef} className="will-change-transform">
                {rows.map((_, ri) => (
                  <div
                    key={ri}
                    style={{ height: ROW_H }}
                    className="flex items-center justify-center border-b border-slate-100 text-[11px] text-slate-400"
                  >
                    {ri + 1}
                  </div>
                ))}
              </div>
            </div>

            {/* เนื้อตาราง (virtualized) */}
            <div className="absolute" style={{ top: HEAD_H, left: INDEX_W, right: 0, bottom: 0 }}>
              <Grid
                gridRef={gridRef}
                cellComponent={Cell}
                cellProps={{ rows, flashCol, masks }}
                columnCount={colCount}
                columnWidth={COL_W}
                rowCount={rowCount}
                rowHeight={ROW_H}
                overscanCount={4}
                onScroll={onScroll}
                defaultWidth={1000}
                defaultHeight={600}
                style={{ width: '100%', height: '100%' }}
              />
              {rowCount === 0 && (
                <p className="p-5 text-sm text-slate-400">ไม่พบแถวที่ตรงกับตัวกรอง</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== Popover กรองรายคอลัมน์ ===== */}
      {filterPopover && (() => {
        const info = getColumnOptions(filterPopover.col)
        const searchText = colFilters[filterPopover.col] ?? ''
        const q = searchText.trim().toLowerCase()
        const visibleOptions = info.options
          .filter((it) => !q || it.value.toLowerCase().includes(q) || it.label.toLowerCase().includes(q))
          .slice(0, 80)
        const chooseValue = (value) => {
          setColFilters((f) => ({ ...f, [filterPopover.col]: value }))
          setColExactFilters((f) => ({ ...f, [filterPopover.col]: value }))
          setFilterPopover(null)
        }
        const clearColumn = () => {
          setColFilters((f) => {
            const next = { ...f }
            delete next[filterPopover.col]
            return next
          })
          setColExactFilters((f) => {
            const next = { ...f }
            delete next[filterPopover.col]
            return next
          })
          setFilterPopover(null)
        }
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setFilterPopover(null)} />
            <div
              className="fixed z-50 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
              style={{ left: Math.min(filterPopover.x, window.innerWidth - 330), top: filterPopover.y + 4 }}
            >
              <div className="border-b border-slate-100 p-3">
                <p className="truncate text-xs font-bold text-slate-700">
                  กรอง: {headers[filterPopover.col]}
                </p>
                {info.questionLabel && info.questionLabel !== headers[filterPopover.col] && (
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">{info.questionLabel}</p>
                )}
                <input
                  autoFocus
                  value={searchText}
                  onChange={(e) => {
                    const v = e.target.value
                    setColFilters((f) => ({ ...f, [filterPopover.col]: v }))
                    setColExactFilters((f) => {
                      const next = { ...f }
                      delete next[filterPopover.col]
                      return next
                    })
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') setFilterPopover(null) }}
                  placeholder="Search / พิมพ์ค้นหา Code หรือค่า…"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
                  <div className="rounded bg-slate-50 px-1 py-1"><b className="block text-slate-700">{info.total}</b><span className="text-slate-400">rows</span></div>
                  <div className="rounded bg-slate-50 px-1 py-1"><b className="block text-slate-700">{info.unique}</b><span className="text-slate-400">unique</span></div>
                  <div className="rounded bg-slate-50 px-1 py-1"><b className="block text-slate-700">{info.blank}</b><span className="text-slate-400">blank</span></div>
                  <div className="rounded bg-indigo-50 px-1 py-1"><b className="block text-indigo-700">{rows.length}</b><span className="text-indigo-400">shown</span></div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {info.targetCf ? (
                    <button
                      onClick={() => navigate(`/projects/${projectId}/${info.targetCf.box}/codeframes/${info.targetCf.id}`)}
                      className="flex-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                      title={info.targetSheet ? `เปิดชีท ${info.targetSheet.name}` : 'เปิด Codeframe ของข้อนี้'}
                    >
                      เปิด Codeframe ข้อนี้
                    </button>
                  ) : (
                    <span className="flex-1 rounded-lg bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-400">ยังไม่มี Codeframe ของคอลัมน์นี้</span>
                  )}
                  <button onClick={handleExport} className="rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200">Export filtered</button>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  คลิกค่าเพื่อกรองตรง Code นั้นทันที · พิมพ์เองยังค้นหาแบบมีคำนี้ได้
                </p>
              </div>

              <div className="max-h-72 overflow-y-auto p-1.5">
                {visibleOptions.length ? (
                  visibleOptions.map((it) => (
                    <button
                      key={it.value}
                      onClick={() => chooseValue(it.value)}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left ${colExactFilters[filterPopover.col] === it.value ? 'bg-indigo-100 ring-1 ring-indigo-200' : 'hover:bg-indigo-50'}`}
                    >
                      <span className="w-12 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center font-mono text-xs font-bold text-slate-700">
                        {it.value}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                        {it.label || '(ไม่มี label)'}
                      </span>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        {it.count}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-5 text-center text-xs text-slate-400">ไม่พบค่า/Code ที่ตรงกับคำค้น</p>
                )}
                {!q && info.missingCodebook.length > 0 && (
                  <div className="mt-1 border-t border-slate-100 pt-1">
                    <p className="px-2 py-1 text-[10px] font-bold text-slate-400">Code ใน codebook ที่ยังไม่มีในข้อมูลชุดนี้</p>
                    {info.missingCodebook.slice(0, 30).map((it) => (
                      <button
                        key={`missing-${it.value}`}
                        onClick={() => chooseValue(it.value)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left opacity-70 hover:bg-slate-50"
                      >
                        <span className="w-12 shrink-0 rounded bg-slate-50 px-1.5 py-0.5 text-center font-mono text-xs font-bold text-slate-500">{it.value}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{it.label}</span>
                        <span className="text-[10px] text-slate-300">0</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-between border-t border-slate-100 px-3 py-2">
                <button onClick={clearColumn} className="cursor-pointer text-xs font-medium text-slate-400 hover:text-rose-500">
                  ล้างคอลัมน์นี้
                </button>
                <button onClick={() => setFilterPopover(null)} className="cursor-pointer rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700">
                  เสร็จ
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* ===== ตัวค้นหาคอลัมน์ (Ctrl+F) ===== */}
      {finderOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFinderOpen(false)} />
          <div className="fixed left-1/2 top-20 z-50 w-[28rem] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
              <Search size={16} className="text-slate-400" />
              <input
                autoFocus
                value={finderQuery}
                onChange={(e) => setFinderQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && finderMatches.length) jumpToColumn(finderMatches[0]) }}
                placeholder="ค้นหาชื่อคอลัมน์ / ข้อ แล้วกระโดดไป…"
                className="flex-1 text-sm outline-none placeholder:text-slate-400"
              />
              <button onClick={() => setFinderOpen(false)} className="cursor-pointer text-slate-400 hover:text-rose-500">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {!finderQuery.trim() ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400">พิมพ์เพื่อค้นหาคอลัมน์ (เช่น s1, q2, Status)</p>
              ) : finderMatches.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400">ไม่พบคอลัมน์ที่ตรงกับ "{finderQuery}"</p>
              ) : (
                finderMatches.map((ci) => (
                  <button
                    key={ci}
                    onClick={() => jumpToColumn(ci)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50"
                  >
                    <span className="truncate font-medium text-slate-700">{headers[ci]}</span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400">คอลัมน์ {ci + 1}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
