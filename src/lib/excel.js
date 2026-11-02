import * as XLSX from 'xlsx'
import * as XLSXStyle from 'xlsx-js-style' // fork ที่รองรับสีพื้นเซลล์ (ใช้ตอน export)
import ExcelJS from 'exceljs' // ใช้ตอน export Codeframe — รองรับสี "แถบชีท" (tabColor) จริง
import { findOtherColumns, isOtherLabel, shortSheetName, closedQuestionGroupColumns, questionGroupBase, otherColumnsForCode, otherCodeFromColumnLabel } from './boxes.js'

const normalizeRuleText = (v) => String(v ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()

// ---------- ลง Code แบบ "เขียนทับค่าอื่นๆ" (ไม่เพิ่มคอลัมน์ใหม่) ----------
// คำตอบที่ตอบ "อื่นๆ" (ค่าปลายปิด = code อื่นๆ) และถูกจัดเข้ารหัสจริงจากข้อความต่อท้าย
//   → เขียนทับค่าในคอลัมน์เดิมด้วย Code No. ที่จัดได้ พร้อมจดตำแหน่งที่แก้ไว้ไฮไลต์
// คืน { rows, editMaskRows: Set<col> ต่อแถว, editedCols: Set<col>, editLog }
// editLog ผูกด้วย key แถวแรก/SbjNum + ชื่อคอลัมน์ เพื่อ audit และกัน mapping เพี้ยนเมื่อเปลี่ยนก้อนข้อมูล
export function buildOverwrittenRawdata(rawdata, codeframe, codebook, options = {}) {
  const rows = (rawdata.rows ?? []).map((r) => r.slice())
  const sourceRows = options.sourceRawdata?.rows ?? []
  const editMaskRows = rows.map(() => new Set())
  const editedCols = new Set()
  const editLog = []
  const scheduledReplaceSourceCells = new Map()
  const headers = rawdata.headers ?? []
  const keyHeader = headers[0] || 'SbjNum'
  const byId = new Map((rawdata.questions ?? []).map((q) => [q.id, q]))
  const scheduleReplaceSourceCell = (rowIndex, colIndex, replacementText, meta = {}) => {
    if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return
    const originalText = normalizeRuleText(rows[rowIndex]?.[colIndex])
    const nextText = String(replacementText ?? '').trim()
    if (!originalText || originalText === normalizeRuleText(nextText)) return
    const key = `${rowIndex}:${colIndex}`
    if (!scheduledReplaceSourceCells.has(key)) {
      scheduledReplaceSourceCells.set(key, { rowIndex, colIndex, originalText, nextText, meta })
    }
  }

  for (const sheet of codeframe.sheets ?? []) {
    const codes = (sheet.nets ?? []).flatMap((n) => n.codes ?? [])
    const codeById = new Map(codes.map((c) => [c.id, c]))
    const codeNoById = new Map(codes.map((c) => [c.id, c.codeNo]))
    const sourceOtherColumnsForCode = (question, codeNo) => {
      const exact = otherColumnsForCode(rawdata, question, codebook, codeNo)
      if (exact.length) return exact
      const all = findOtherColumns(rawdata, question, codebook)
      const cb = codebook?.byVar?.[question?.label]
      const otherNos = (cb?.values ?? [])
        .filter((v) => isOtherLabel(v.label))
        .map((v) => String(v.value ?? '').trim().replace(/\.0$/, ''))
        .filter(Boolean)
      const generic = all.filter((q) => !otherCodeFromColumnLabel(q.label))
      const idx = otherNos.indexOf(String(codeNo ?? '').trim().replace(/\.0$/, ''))
      return idx >= 0 && generic[idx] ? [generic[idx]] : []
    }
    const otherValues = new Set(
      codes.filter((c) => /ระบุ|specify/i.test(c.thai)).map((c) => String(c.codeNo).trim()).filter(Boolean),
    )
    if (!otherValues.size) {
      for (const c of codes) if (isOtherLabel(c.thai)) otherValues.add(String(c.codeNo).trim())
    }

    const pairs = []
    const fallbackClosedCols = []
    const fallbackTextCols = []
    for (const qid of sheet.questionIds ?? []) {
      const q = byId.get(qid)
      if (!q) continue
      const cols = q.columns ?? [q.index]
      const cb = codebook?.byVar?.[q.label]
      if (cb?.values?.length) {
        fallbackClosedCols.push(...cols)
        const pairOtherValues = new Set()
        for (const v of cb.values) {
          if (isOtherLabel(v.label)) {
            const val = String(v.value).trim()
            pairOtherValues.add(val)
            otherValues.add(val)
          }
        }
        const otherQs = findOtherColumns(rawdata, q, codebook)
        for (const otherQ of otherQs) {
          if (otherQ && (sheet.questionIds ?? []).includes(otherQ.id) && pairOtherValues.size) {
            pairs.push({ questionId: q.id, question: q.label, closedCols: cols, textQuestion: otherQ.label, textCols: otherQ.columns ?? [otherQ.index], otherValues: pairOtherValues })
          }
        }
      } else {
        fallbackTextCols.push(...cols)
      }
    }
    if (!pairs.length && otherValues.size && fallbackClosedCols.length && fallbackTextCols.length) {
      pairs.push({ questionId: '', question: sheet.name || 'unknown', closedCols: fallbackClosedCols, textQuestion: 'fallback text', textCols: fallbackTextCols, otherValues })
    }

    const compactGroups = new Map()
    const ensureCompactGroup = (q) => {
      if (!q) return null
      const base = questionGroupBase(q.label)
      if (!compactGroups.has(base)) {
        compactGroups.set(base, { question: q, cols: closedQuestionGroupColumns(rawdata, q, codebook), rows: new Set(), priorityByRow: new Map() })
      }
      return compactGroups.get(base)
    }
    // Always compact every MA target group in the sheet, even if the current run only needs to
    // clean up rows persisted by an earlier save (e.g. 211 stuck in s13_3_04 with no 13 left).
    for (const qid of sheet.questionIds ?? []) {
      const q = byId.get(qid)
      const cb = q ? codebook?.byVar?.[q.label] : null
      if (q && cb?.values?.length) {
        const group = ensureCompactGroup(q)
        if ((group?.cols ?? []).length > 1) {
          for (let r = 0; r < rows.length; r++) group.rows.add(r)
        }
      }
    }
    const markCompactGroup = (q, rowIndex, priorityCode = '') => {
      const group = ensureCompactGroup(q)
      if (!group || rowIndex == null) return
      group.rows.add(rowIndex)
      const code = String(priorityCode ?? '').trim()
      if (code) {
        if (!group.priorityByRow.has(rowIndex)) group.priorityByRow.set(rowIndex, new Set())
        group.priorityByRow.get(rowIndex).add(code)
      }
    }

    for (let r = 0; r < rows.length; r++) {
      const usedCols = new Set()
      for (const pair of pairs) {
        for (const tc of pair.textCols) {
          const currentText = String(rows[r][tc] ?? '').trim()
          const sourceText = String(sourceRows[r]?.[tc] ?? '').trim()
          const recoveredFromOriginal = !currentText && !!sourceText
          const text = currentText || sourceText
          if (!text) continue
          const assign = sheet.assignments?.[text]
          const assignedCode = assign?.length ? codeById.get(assign[0]) : null
          const newNo = assignedCode?.codeNo
          const newNoStr = newNo == null ? '' : String(newNo).trim()
          const assignedLabel = String(assignedCode?.thai || assignedCode?.thai2 || assignedCode?.eng || assignedCode?.codeNo || '').trim()
          if (!newNoStr || pair.otherValues.has(newNoStr)) continue
          const existingAssignedCol = pair.closedCols.find((c) => String(rows[r][c] ?? '').trim() === newNoStr)
          const otherCol = pair.closedCols.find((c) => !usedCols.has(c) && pair.otherValues.has(String(rows[r][c] ?? '').trim()))
          if (otherCol == null) {
            // เวอร์ชันเก่าอาจบันทึก Code ลง Working Rawdata แล้วล้าง *_oth/Verbatim ไปแล้ว
            // กู้ key จาก Original Rawdata เฉพาะเมื่อ assignment เดิมยังตรงและ Code ที่ลงไว้มีอยู่จริงในแถว
            if (recoveredFromOriginal && existingAssignedCol != null && assignedLabel) {
              const isNewCode = !!(assignedCode?.manualNew || assignedCode?.aiNew)
              if (!isNewCode) continue
              rows[r][tc] = assignedLabel
              editMaskRows[r].add(tc)
              editedCols.add(tc)
              editLog.push({
                rowIndex: r + 1,
                keyHeader,
                rowKey: String((rawdata.rows ?? [])[r]?.[0] ?? r + 1).trim() || String(r + 1),
                sheet: sheet.name || '',
                question: pair.question || '',
                textQuestion: pair.textQuestion || '',
                codeColumn: headers[existingAssignedCol] || `คอลัมน์ ${existingAssignedCol + 1}`,
                codeColumnIndex: existingAssignedCol + 1,
                textColumn: headers[tc] || `คอลัมน์ ${tc + 1}`,
                textColumnIndex: tc + 1,
                otherText: sourceText,
                originalCode: newNoStr,
                newCode: newNoStr,
                action: 'restore_legacy_cleared_verbatim',
              })
            }
            continue
          }
          usedCols.add(otherCol)
          const originalCode = String(rows[r][otherCol] ?? '').trim()
          const rowKey = String((rawdata.rows ?? [])[r]?.[0] ?? r + 1).trim() || String(r + 1)
          const baseLog = {
            rowIndex: r + 1,
            keyHeader,
            rowKey,
            sheet: sheet.name || '',
            question: pair.question || '',
            textQuestion: pair.textQuestion || '',
            codeColumn: headers[otherCol] || `คอลัมน์ ${otherCol + 1}`,
            codeColumnIndex: otherCol + 1,
            textColumn: headers[tc] || `คอลัมน์ ${tc + 1}`,
            textColumnIndex: tc + 1,
            otherText: text,
            originalCode,
            newCode: newNoStr,
          }
          const dupCol = pair.closedCols.find((c) => c !== otherCol && String(rows[r][c] ?? '').trim() === newNoStr)
          // กติกา Verbatim หลังลง Code (ตาม requirement ล่าสุด):
          //   - Code ที่มีอยู่เดิม → ลบ Verbatim ทิ้ง (ช่อง text ว่าง)
          //   - Code ที่สร้างใหม่ (manualNew/aiNew) → เก็บ Verbatim ไว้ แต่เขียนทับเป็นชื่อ Code ใหม่
          const isNewCode = !!(assignedCode?.manualNew || assignedCode?.aiNew)
          const replacementText = isNewCode ? assignedLabel : ''
          if (dupCol != null) {
            rows[r][otherCol] = ''
            markCompactGroup(byId.get(pair.questionId), r)
            editMaskRows[r].add(otherCol)
            editMaskRows[r].add(dupCol)
            editedCols.add(otherCol)
            editedCols.add(dupCol)
            editLog.push({
              ...baseLog,
              action: 'clear_original_other_because_new_code_already_exists',
              duplicateColumn: headers[dupCol] || `คอลัมน์ ${dupCol + 1}`,
              duplicateColumnIndex: dupCol + 1,
            })
            scheduleReplaceSourceCell(r, tc, replacementText, baseLog)
          } else {
            rows[r][otherCol] = newNoStr
            markCompactGroup(byId.get(pair.questionId), r)
            editMaskRows[r].add(otherCol)
            editedCols.add(otherCol)
            editLog.push({ ...baseLog, action: 'overwrite_other_code' })
            scheduleReplaceSourceCell(r, tc, replacementText, baseLog)
          }
        }
      }
    }

    // Manual cross-question recode rules:
    // ใช้เมื่อ question มี Other/specify แต่ไม่มี verbatim ของตัวเองในชีทนี้
    // เช่น A3 ไม่มีช่อง text แต่ respondent เดียวกันมี A1 verbatim ที่ถูกลง Code แล้ว
    for (const rule of sheet.manualRecodeRules ?? []) {
      const q = byId.get(rule.questionId)
      const newNo = codeNoById.get(rule.codeId)
      const newNoStr = newNo == null ? '' : String(newNo).trim()
      const sourceTexts = new Set()
      if (rule.sourceText) sourceTexts.add(normalizeRuleText(rule.sourceText))
      if (rule.sourceCodeId) {
        for (const [text, ids] of Object.entries(sheet.assignments ?? {})) {
          if ((ids ?? []).includes(rule.sourceCodeId)) sourceTexts.add(normalizeRuleText(text))
        }
        const sourceCodeNo = codeNoById.get(rule.sourceCodeId)
        const sourceQuestions = rule.sourceQuestionId ? [byId.get(rule.sourceQuestionId)].filter(Boolean) : (sheet.questionIds ?? []).map((qid) => byId.get(qid)).filter(Boolean)
        for (const sourceQ of sourceQuestions) {
          for (const otherQ of sourceOtherColumnsForCode(sourceQ, sourceCodeNo).filter((oq) => (sheet.questionIds ?? []).includes(oq.id))) {
            for (const c of otherQ.columns ?? [otherQ.index]) {
              for (const row of rows) {
                const text = normalizeRuleText(row[c])
                if (text) sourceTexts.add(text)
              }
            }
          }
        }
      }
      if (!q || !newNoStr || !sourceTexts.size) continue
      const cb = codebook?.byVar?.[q.label]
      const ruleOtherValues = new Set((cb?.values ?? []).filter((v) => isOtherLabel(v.label)).map((v) => String(v.value).trim()))
      // Some real exports have target columns (e.g. q41b/q41 variants) whose raw header/codebook
      // does not carry value labels, while the Codeframe still has the original Other codes
      // (141/142/143). Do not skip the manual follow-source rule; use Codeframe Other codes as fallback.
      if (!ruleOtherValues.size) {
        for (const c of codes) {
          if (isOtherLabel(c.thai) || isOtherLabel(c.eng) || isOtherLabel(c.thai2)) {
            const no = String(c.codeNo ?? '').trim()
            if (no) ruleOtherValues.add(no)
          }
        }
      }
      if (!ruleOtherValues.size) continue
      const closedCols = closedQuestionGroupColumns(rawdata, q, codebook)
      const resolveSourceQuestion = (sourceId) => {
        const sourceQ = sourceId ? byId.get(sourceId) : null
        if (!sourceQ) return { sourceQ: null, sourceClosedQ: null, sourceTextQs: [] }
        const sourceCb = codebook?.byVar?.[sourceQ.label]
        if (sourceCb?.values?.length) {
          const sourceTextQs = findOtherColumns(rawdata, sourceQ, codebook).filter((otherQ) => (sheet.questionIds ?? []).includes(otherQ.id))
          return { sourceQ, sourceClosedQ: sourceQ, sourceTextQs }
        }
        // Some persisted rules point at the actual Verbatim/Oth text column (e.g. q41a_oth)
        // instead of the closed-ended owner (q41a). Use the text column for matching,
        // but walk back to the owning closed question to read the source code (99, 211, etc.).
        const owner = (sheet.questionIds ?? [])
          .map((qid) => byId.get(qid))
          .filter(Boolean)
          .find((candidate) => {
            const cb = codebook?.byVar?.[candidate.label]
            if (!(cb?.values?.length)) return false
            return findOtherColumns(rawdata, candidate, codebook).some((otherQ) => otherQ.id === sourceQ.id)
          })
        return { sourceQ, sourceClosedQ: owner ?? null, sourceTextQs: [sourceQ] }
      }
      const sourceTextCols = []
      const resolvedSource = resolveSourceQuestion(rule.sourceQuestionId)
      if (rule.sourceQuestionId) {
        for (const tq of resolvedSource.sourceTextQs) sourceTextCols.push(...(tq.columns ?? [tq.index]))
      } else {
        for (const qid of sheet.questionIds ?? []) {
          const tq = byId.get(qid)
          if (!tq) continue
          const tcb = codebook?.byVar?.[tq.label]
          if (!(tcb?.values?.length)) sourceTextCols.push(...(tq.columns ?? [tq.index]))
        }
      }
      const sourceClosedCols = resolvedSource.sourceClosedQ ? closedQuestionGroupColumns(rawdata, resolvedSource.sourceClosedQ, codebook) : []
      const sourceCodeFromRow = (row) => {
        for (const c of sourceClosedCols) {
          const v = String(row?.[c] ?? '').trim()
          if (v) return { code: v, col: c }
        }
        return { code: newNoStr, col: null }
      }
      const markSourceCodeCell = (rowIndex, sourceCol) => {
        if (sourceCol == null) return
        // Manual “follow source question” uses this source CE value (e.g. S13_1)
        // as evidence for the target recode, so highlight it in Rawdata + Code too.
        editMaskRows[rowIndex].add(sourceCol)
        editedCols.add(sourceCol)
      }
      for (let r = 0; r < rows.length; r++) {
        const matchedText = sourceTextCols
          .map((tc) => normalizeRuleText(rows[r][tc]))
          .find((text) => sourceTexts.has(text))
        if (!matchedText) continue
        // Follow-source rules must read from the progressively coded row, not the original upload.
        // Example: Q41a is first changed from its Oth text to 99, then Q41b should follow that coded Q41a=99.
        const sourceCodeInfo = sourceCodeFromRow(rows[r])
        const effectiveNoStr = sourceCodeInfo.code
        const effectiveSourceCol = sourceCodeInfo.col
        if (!effectiveNoStr) continue
        const otherCol = closedCols.find((c) => ruleOtherValues.has(String(rows[r][c] ?? '').trim()))
        const effectiveDupCol = closedCols.find((c) => String(rows[r][c] ?? '').trim() === effectiveNoStr)
        const oldRuleCols = effectiveNoStr === newNoStr ? [] : closedCols.filter((c) => String(rows[r][c] ?? '').trim() === newNoStr)
        const writeCol = otherCol ?? (effectiveDupCol == null ? oldRuleCols[0] : null) ?? (effectiveDupCol == null ? closedCols.find((c) => !String(rows[r][c] ?? '').trim()) : null)
        if (writeCol == null && !oldRuleCols.length) {
          if (effectiveDupCol != null) {
            markCompactGroup(q, r, effectiveNoStr)
            markSourceCodeCell(r, effectiveSourceCol)
            editMaskRows[r].add(effectiveDupCol)
            editedCols.add(effectiveDupCol)
            const rowKey = String((rawdata.rows ?? [])[r]?.[0] ?? r + 1).trim() || String(r + 1)
            editLog.push({
              rowIndex: r + 1,
              keyHeader,
              rowKey,
              sheet: sheet.name || '',
              question: q.label || '',
              textQuestion: 'manual cross-question source',
              codeColumn: headers[effectiveDupCol] || `คอลัมน์ ${effectiveDupCol + 1}`,
              codeColumnIndex: effectiveDupCol + 1,
              textColumn: '',
              textColumnIndex: '',
              otherText: matchedText,
              originalCode: effectiveNoStr,
              newCode: effectiveNoStr,
              ruleCode: newNoStr,
              sourceCodeColumn: effectiveSourceCol == null ? '' : (headers[effectiveSourceCol] || `คอลัมน์ ${effectiveSourceCol + 1}`),
              sourceCodeColumnIndex: effectiveSourceCol == null ? '' : effectiveSourceCol + 1,
              action: 'manual_cross_question_existing_source_code',
            })
          }
          continue
        }
        const originalCode = writeCol == null ? '' : String(rows[r][writeCol] ?? '').trim()
        markSourceCodeCell(r, effectiveSourceCol)
        const rowKey = String((rawdata.rows ?? [])[r]?.[0] ?? r + 1).trim() || String(r + 1)
        const baseLog = {
          rowIndex: r + 1,
          keyHeader,
          rowKey,
          sheet: sheet.name || '',
          question: q.label || '',
          textQuestion: 'manual cross-question source',
          codeColumn: writeCol == null ? '' : (headers[writeCol] || `คอลัมน์ ${writeCol + 1}`),
          codeColumnIndex: writeCol == null ? '' : writeCol + 1,
          textColumn: '',
          textColumnIndex: '',
          otherText: matchedText,
          originalCode,
          newCode: effectiveNoStr,
          ruleCode: newNoStr,
          sourceCodeColumn: effectiveSourceCol == null ? '' : (headers[effectiveSourceCol] || `คอลัมน์ ${effectiveSourceCol + 1}`),
          sourceCodeColumnIndex: effectiveSourceCol == null ? '' : effectiveSourceCol + 1,
        }
        if (writeCol != null && effectiveDupCol == null) {
          rows[r][writeCol] = effectiveNoStr
          editMaskRows[r].add(writeCol)
          editedCols.add(writeCol)
        } else if (writeCol != null && effectiveDupCol != null && writeCol !== effectiveDupCol) {
          rows[r][writeCol] = ''
          editMaskRows[r].add(writeCol)
          editedCols.add(writeCol)
        }
        for (const oldCol of oldRuleCols) {
          if (oldCol === writeCol) continue
          rows[r][oldCol] = ''
          editMaskRows[r].add(oldCol)
          editedCols.add(oldCol)
        }
        markCompactGroup(q, r, effectiveNoStr)
        editLog.push({
          ...baseLog,
          action: effectiveNoStr === newNoStr
            ? (otherCol == null ? 'manual_cross_question_insert_code' : 'manual_cross_question_recode')
            : 'manual_cross_question_follow_source_code',
          clearedRuleColumns: oldRuleCols.filter((c) => c !== writeCol).map((c) => headers[c] || `คอลัมน์ ${c + 1}`),
        })
      }
    }

    for (const { cols, rows: changedRows, priorityByRow } of compactGroups.values()) {
      if ((cols ?? []).length <= 1) continue
      for (const r of changedRows) {
        const before = cols.map((c) => rows[r][c] ?? '')
        const values = before.map((v) => String(v ?? '').trim()).filter(Boolean)
        const priority = priorityByRow?.get(r) ?? new Set()
        const priorityValues = []
        const restValues = []
        for (const v of values) {
          if (priority.has(v) && !priorityValues.includes(v)) priorityValues.push(v)
          else restValues.push(v)
        }
        const afterValues = [...priorityValues, ...restValues]
        const after = [...afterValues, ...Array(Math.max(0, cols.length - afterValues.length)).fill('')]
        for (let i = 0; i < cols.length; i++) {
          const c = cols[i]
          if (String(rows[r][c] ?? '').trim() === String(after[i] ?? '').trim()) continue
          rows[r][c] = after[i]
          editMaskRows[r].add(c)
          editedCols.add(c)
        }
      }
    }
    for (const e of sheet.rawdataEditLog ?? []) {
      const r = Number(e.rowIndex0)
      const cols = (e.cols ?? []).map((c) => Number(c)).filter((c) => Number.isInteger(c) && c >= 0)
      if (!Number.isInteger(r) || r < 0 || r >= rows.length || !cols.length) continue
      for (const c of cols) {
        editMaskRows[r].add(c)
        editedCols.add(c)
      }
      editLog.push({
        rowIndex: r + 1,
        keyHeader,
        rowKey: String((rawdata.rows ?? [])[r]?.[0] ?? r + 1).trim() || String(r + 1),
        sheet: sheet.name || '',
        question: e.question || '',
        textQuestion: e.textQuestion || '',
        codeColumn: e.codeColumn || '',
        codeColumnIndex: e.codeColumnIndex || '',
        textColumn: e.textColumn || '',
        textColumnIndex: e.textColumnIndex || '',
        otherText: e.otherText || '',
        originalCode: e.originalCode || '',
        newCode: e.newCode || '',
        ruleCode: e.ruleCode || '',
        action: e.action || 'rawdata_delete_verbatim',
      })
    }
  }
  for (const { rowIndex, colIndex, originalText, nextText, meta } of scheduledReplaceSourceCells.values()) {
    if (normalizeRuleText(rows[rowIndex]?.[colIndex]) !== originalText) continue
    rows[rowIndex][colIndex] = nextText
    editMaskRows[rowIndex].add(colIndex)
    editedCols.add(colIndex)
    editLog.push({
      rowIndex: rowIndex + 1,
      keyHeader,
      rowKey: String((rawdata.rows ?? [])[rowIndex]?.[0] ?? rowIndex + 1).trim() || String(rowIndex + 1),
      sheet: meta.sheet || '',
      question: meta.question || '',
      textQuestion: meta.textQuestion || '',
      codeColumn: meta.codeColumn || '',
      codeColumnIndex: meta.codeColumnIndex || '',
      textColumn: headers[colIndex] || `คอลัมน์ ${colIndex + 1}`,
      textColumnIndex: colIndex + 1,
      otherText: originalText,
      originalCode: meta.originalCode || '',
      newCode: meta.newCode || '',
      ruleCode: meta.ruleCode || '',
      sourceCodeColumn: meta.sourceCodeColumn || '',
      sourceCodeColumnIndex: meta.sourceCodeColumnIndex || '',
      action: nextText ? 'replace_verbatim_with_code_label' : 'clear_coded_verbatim',
    })
  }
  return { rows, editMaskRows, editedCols, editLog }
}

// ลงสีไฮไลต์เซลล์/หัวคอลัมน์ที่ถูกแก้ (หัว = น้ำเงิน, เซลล์ = เหลือง) ด้วย xlsx-js-style
function styleEdits(ws, editMaskRows, editedCols) {
  const headerStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: '4F46E5' } }, // indigo-600
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  }
  const cellStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FDE047' } }, // yellow-300
    font: { bold: true },
    alignment: { horizontal: 'center' },
  }
  for (const c of editedCols) {
    const ref = XLSXStyle.utils.encode_cell({ r: 0, c })
    if (!ws[ref]) ws[ref] = { t: 's', v: '' }
    ws[ref].s = headerStyle
  }
  editMaskRows.forEach((set, r) => {
    for (const c of set) {
      const ref = XLSXStyle.utils.encode_cell({ r: r + 1, c }) // +1 เพราะแถว 0 = หัวตาราง
      if (!ws[ref]) ws[ref] = { t: 's', v: '' }
      ws[ref].s = cellStyle
    }
  })
}

function appendRecodeLogSheet(wb, editLog = []) {
  if (!editLog.length) return
  const logHeaders = [
    'row_key_header', 'row_key', 'raw_row_no', 'sheet', 'question', 'text_question',
    'code_column', 'code_column_index', 'text_column', 'text_column_index',
    'other_text', 'original_code', 'new_code', 'rule_code', 'source_code_column', 'source_code_column_index',
    'action', 'duplicate_column', 'duplicate_column_index',
  ]
  const aoa = [logHeaders, ...editLog.map((e) => [
    e.keyHeader, e.rowKey, e.rowIndex, e.sheet, e.question, e.textQuestion,
    e.codeColumn, e.codeColumnIndex, e.textColumn, e.textColumnIndex,
    e.otherText, e.originalCode, e.newCode, e.ruleCode || '', e.sourceCodeColumn || '', e.sourceCodeColumnIndex || '',
    e.action, e.duplicateColumn || '', e.duplicateColumnIndex || '',
  ])]
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)
  ws['!cols'] = colWidthsFromAoA(aoa, { min: 8, max: 42 })
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Recode Log')
}

// ---------- Export Rawdata (ที่แสดง/กรองในหน้า Viewer) พร้อมไฮไลต์จุดที่แก้ ----------
// rows = แถวที่กรองแล้ว · masks = Set<col> ของจุดที่แก้ ต่อแถว (เรียงตรงกับ rows)
export function exportRawdataWithEdits(headers, rows, masks, editedCols, fileName, editLog = []) {
  const toCell = (v) => {
    if (typeof v !== 'string') return v
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)) {
      const n = Number(v)
      if (Number.isFinite(n) && Math.abs(n) < 1e15) return n
    }
    return v
  }
  const aoa = [headers, ...rows.map((r) => r.map(toCell))]
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)
  ws['!cols'] = colWidthsFromAoA(aoa)
  styleEdits(ws, masks ?? [], editedCols ?? new Set())
  const wb = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Rawdata + Code')
  appendRecodeLogSheet(wb, editLog)
  XLSXStyle.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

// ---------- Export Data: Rawdata ที่ลง Code แล้ว (เขียนทับอื่นๆ + ไฮไลต์) ----------
export function exportCodedData(rawdata, codeframe, codebook, fileName) {
  const { rows, editMaskRows, editedCols, editLog } = buildOverwrittenRawdata(rawdata, codeframe, codebook)
  const headers = rawdata.headers ?? []
  const toCell = (v) => {
    if (typeof v !== 'string') return v
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)) {
      const n = Number(v)
      if (Number.isFinite(n) && Math.abs(n) < 1e15) return n
    }
    return v
  }
  const aoa = [headers, ...rows.map((r) => r.map(toCell))]
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)
  ws['!cols'] = colWidthsFromAoA(aoa)
  styleEdits(ws, editMaskRows, editedCols)
  const wb = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Rawdata + Code')
  appendRecodeLogSheet(wb, editLog)
  XLSXStyle.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

// ---------- อ่านไฟล์ Rawdata ----------
// แถวแรก = ชื่อข้อ/คอลัมน์ (เช่น ID, Q28, Q28_1, P15_1)
// แถวถัดไป = คำตอบของผู้ตอบแต่ละคน
export async function parseRawdataFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (!aoa.length) throw new Error('ไฟล์ว่างเปล่า')

  const headers = aoa[0].map((h, i) => String(h ?? '').trim() || `คอลัมน์ ${i + 1}`)
  const rows = aoa
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => headers.map((_, i) => String(r[i] ?? '').trim()))

  const questions = buildQuestions(headers)

  return { fileName: file.name, sheetName: wb.SheetNames[0], headers, questions, rows }
}

// ---------- รวมคอลัมน์ MA เป็นข้อเดียว ----------
// ข้อ MA (หลายคำตอบ) มาเป็นหลายคอลัมน์ที่ลงท้ายด้วย _O<เลข> หรือ $<เลข>
//   เช่น S1_O1, S1_O2, ...  หรือ  S1$1, S1$2, ...  → ยุบเป็นข้อเดียวชื่อ "S1" (type 'MA')
// คอลัมน์ปกติ → 1 ข้อต่อ 1 คอลัมน์ (type 'single')
// คืน [{ id, label, type, index, columns: [คอลัมน์ที่ครอบคลุม] }]
const MA_SUFFIX = /^(.+?)(?:_O\d+|\$\d+)$/i

function buildQuestions(headers) {
  const questions = []
  const baseToQuestion = new Map()
  headers.forEach((label, index) => {
    const m = label.match(MA_SUFFIX)
    if (m) {
      const base = m[1].trim()
      let q = baseToQuestion.get(base)
      if (!q) {
        q = { id: `q${index}`, index, label: base, type: 'MA', columns: [] }
        baseToQuestion.set(base, q)
        questions.push(q)
      }
      q.columns.push(index)
    } else {
      questions.push({ id: `q${index}`, index, label, type: 'single', columns: [index] })
    }
  })
  return questions
}

// ---------- อ่านโครง Codeframe จากไฟล์ (รูปแบบเดียวกับ Test_Code.xlsx) ----------
// คอลัมน์: Code No. | ThaiGroup | ThaiGroup2 | English
// แถวที่ ThaiGroup ขึ้นต้นด้วย "Net" = หัวข้อกลุ่ม, แถวที่มี Code No. = รหัส
export async function parseFrameFile(file, makeId) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  const nets = []
  let current = null
  const headerIndex = aoa.findIndex((row) => /^code\s*no\.?$/i.test(String(row?.[0] ?? '').trim()))
  // Files exported from COF contain question rows above the Code No. header.
  // Start after the header so question rows are not imported as fake codes.
  const rows = headerIndex >= 0 ? aoa.slice(headerIndex + 1) : aoa
  for (const row of rows) {
    const [c0, c1, c2, c3] = [0, 1, 2, 3].map((i) => String(row[i] ?? '').trim())
    if (!c0 && !c1) continue
    const lower = c1.toLowerCase()
    if (!c0 && (lower.startsWith('net') || lower.startsWith('grandnet') || lower.startsWith('subnet'))) {
      current = {
        id: makeId(),
        name: c1.replace(/^(grandnet|subnet|net)\s*:?\s*/i, '').trim() || c1,
        codes: [],
      }
      nets.push(current)
      continue
    }
    // ข้ามแถวหัวตาราง เช่น "Code No." / "ข้อ"
    if (/^code/i.test(c0) || c0 === 'ข้อ') continue
    if (c0) {
      if (!current) {
        current = { id: makeId(), name: 'ไม่ระบุกลุ่ม', codes: [] }
        nets.push(current)
      }
      current.codes.push({ id: makeId(), codeNo: c0, thai: c1, thai2: c2, eng: c3 })
    }
  }
  if (!nets.length) throw new Error('ไม่พบโครง Codeframe ในไฟล์ (ต้องมีแถว "Net : ..." และแถวรหัส)')
  return nets
}

// ---------- สร้าง aoa ของ Rawdata ต้นฉบับ + คอลัมน์ Code ----------
// แทรกคอลัมน์ Code ต่อท้าย "แต่ละข้อ" ที่ถูกโค้ด
//   จำนวนช่อง Code = จำนวนโค้ดมากสุดที่ผู้ตอบคนใดคนหนึ่งลงในข้อนั้น
//   ค่าในช่อง = Code No. จาก Codeframe (ตามการ assign ของชีทที่ครอบคลุมข้อนั้น)
export function buildCodedRawdataAoA(rawdata, codeframe) {
  const headers = rawdata.headers ?? []
  const rows = rawdata.rows ?? []
  const questions = rawdata.questions ?? []
  const nRows = rows.length

  // questionId → sheet (อันแรกที่ครอบคลุม) และ codeId → codeNo ต่อ sheet
  const qToSheet = new Map()
  const sheetCodeNo = new Map()
  for (const sheet of codeframe.sheets ?? []) {
    const m = new Map()
    for (const net of sheet.nets ?? []) {
      for (const code of net.codes ?? []) m.set(code.id, code.codeNo)
    }
    sheetCodeNo.set(sheet.id, m)
    for (const qid of sheet.questionIds ?? []) if (!qToSheet.has(qid)) qToSheet.set(qid, sheet)
  }

  // คำนวณ Code ต่อแถวของแต่ละข้อที่ถูกโค้ด (เก็บช่วงคอลัมน์ของข้อไว้ด้วย)
  const coded = []
  for (const q of questions) {
    const sheet = qToSheet.get(q.id)
    if (!sheet) continue
    const codeNoOf = sheetCodeNo.get(sheet.id)
    const cols = q.columns ?? [q.index]
    const perRow = []
    let maxCodes = 0
    for (let r = 0; r < nRows; r++) {
      const seen = new Set()
      const list = []
      for (const col of cols) {
        const text = String(rows[r]?.[col] ?? '').trim()
        if (!text) continue
        for (const cid of sheet.assignments?.[text] ?? []) {
          const no = codeNoOf.get(cid)
          if (no != null && no !== '' && !seen.has(no)) { seen.add(no); list.push(no) }
        }
      }
      perRow.push(list)
      if (list.length > maxCodes) maxCodes = list.length
    }
    if (maxCodes === 0) continue // ไม่มีคำตอบไหนถูกโค้ดในข้อนี้ → ไม่ต้องเพิ่มช่อง
    coded.push({ label: q.label, min: Math.min(...cols), max: Math.max(...cols), maxCodes, perRow })
  }

  // รวม "ข้อที่คอลัมน์ติดกัน" (เช่น Q2 หลาย mention ของงาน OE) เป็นบล็อกเดียว
  // แล้วเอาช่อง Code ของทุกข้อในบล็อกไปต่อท้ายบล็อก (ไม่แทรกคั่นกลางระหว่างข้อ)
  coded.sort((a, b) => a.min - b.min)
  const runs = []
  for (const e of coded) {
    const last = runs[runs.length - 1]
    if (last && e.min === last.max + 1) {
      last.entries.push(e)
      last.max = e.max
    } else {
      runs.push({ max: e.max, entries: [e] })
    }
  }
  // คอลัมน์สุดท้ายของบล็อก → รายการ entry ที่จะต่อท้าย (ตามลำดับข้อ)
  const anchor = new Map()
  for (const run of runs) anchor.set(run.max, run.entries)

  // แปลง Code No. เป็นตัวเลขถ้าเป็นจำนวนเต็มล้วน (ตัดสามเหลี่ยมเขียว + ใช้คำนวณต่อได้)
  const toCell = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)

  const C = headers.length
  const headerRow = []
  const codeCols = new Set() // ตำแหน่งคอลัมน์ (ในผลลัพธ์) ที่เป็นช่อง Code — ไว้ลงสี
  for (let c = 0; c < C; c++) {
    headerRow.push(headers[c])
    const entries = anchor.get(c)
    if (entries) {
      for (const e of entries) for (let k = 1; k <= e.maxCodes; k++) {
        codeCols.add(headerRow.length)
        headerRow.push(`${e.label}_Code${k}`)
      }
    }
  }
  const aoa = [headerRow]
  for (let r = 0; r < nRows; r++) {
    const out = []
    for (let c = 0; c < C; c++) {
      out.push(rows[r]?.[c] ?? '')
      const entries = anchor.get(c)
      if (entries) {
        for (const e of entries) {
          const list = e.perRow[r]
          for (let k = 0; k < e.maxCodes; k++) out.push(list[k] != null ? toCell(list[k]) : '')
        }
      }
    }
    aoa.push(out)
  }
  return { aoa, codeCols }
}

// ลงสีพื้นช่อง Code (หัวคอลัมน์เข้ม + เซลล์ข้อมูลอ่อน) ด้วย xlsx-js-style
function styleCodeColumns(ws, rowCount, codeCols) {
  const headerStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'F59E0B' } }, // amber-500
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  }
  const cellStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } }, // amber-100
    alignment: { horizontal: 'center' },
  }
  for (let r = 0; r < rowCount; r++) {
    for (const c of codeCols) {
      const ref = XLSXStyle.utils.encode_cell({ r, c })
      if (!ws[ref]) ws[ref] = { t: 's', v: '' }
      ws[ref].s = r === 0 ? headerStyle : cellStyle
    }
  }
}

// ป้ายชั้นของ Net ในไฟล์ Excel (1=Net … 5=Subsubsubsubnet)
const NET_PREFIX = { 1: 'Net', 2: 'Subnet', 3: 'Subsubnet', 4: 'Subsubsubnet', 5: 'Subsubsubsubnet' }
const codeNoCell = (v) => (typeof v === 'string' && /^-?(?:0|[1-9]\d*)$/.test(v) ? Number(v) : v)
const isAddedCode = (code) => !!(code?.aiNew || code?.manualNew)

// ---------- Export Codeframe เป็น Excel (เฉพาะโครง — ใช้ exceljs เพื่อให้ลงสี "แถบชีท" ได้จริง) ----------
// getSheetColor(sheet) → hex (RRGGBB) สีแถบชีทตามสถานะ | undefined
// getSheetInfo(sheet) → { name, questions:[{ column, label }] } — ชื่อชีท + โจทย์ทุกข้อ
// options.freqByCode = { [sheetId]: { [codeId]: n } } → คอลัมน์ Frequency เดี่ยว (รวมทุกข้อ)
// options.freqByCodeByQuestion = { [sheetId]: { [codeId]: { [questionColumn]: n } } } → แยก Frequency ต่อข้อ
//   ถ้าชีทมีหลายข้อ: หัวคอลัมน์เป็น "เลขข้อ" ของแต่ละข้อ + "รวม" ท้ายสุด (ไม่มีคำว่า Frequency)
export function freqHeadersForQuestions(questions) {
  const cols = (questions ?? []).filter(Boolean)
  if (cols.length > 1) return [...cols.map((q) => String(q.column ?? '')), 'รวม']
  if (cols.length === 1) return [String(cols[0].column ?? '')]
  return ['Frequency']
}

export async function exportCodeframe(codeframe, job, getSheetColor, getSheetInfo, options = {}) {
  const customer = options.preset === 'customer'
  const freqByCode = options.freqByCode || null
  const freqByCodeByQuestion = options.freqByCodeByQuestion || null
  const wb = new ExcelJS.Workbook()
  const usedNames = new Set()
  const uniqName = (name) => {
    let base = sanitizeSheetName(name)
    let cand = base
    let n = 2
    while (usedNames.has(cand)) { cand = sanitizeSheetName(`${base.slice(0, 27)} (${n})`); n += 1 }
    usedNames.add(cand)
    return cand
  }
  const thin = { style: 'thin', color: { argb: customer ? 'FFD6D3CC' : 'FFBFBFBF' } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }
  const addedCodeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: customer ? 'FFFFF2CC' : 'FFFEF3C7' } } // สีเหลืองสุภาพสำหรับ Code เพิ่มใหม่
  const addedCodeLeft = { style: 'medium', color: { argb: 'FFF59E0B' } } // amber-500
  const headerFill = customer ? 'FF1F2937' : 'FFDBE5F1'
  const headerFont = customer ? { bold: true, color: { argb: 'FFFFFFFF' } } : { bold: true }

  for (const sheet of codeframe.sheets ?? []) {
    const hex = getSheetColor?.(sheet)
    const info = getSheetInfo?.(sheet) ?? { name: sheet.name, questions: [] }
    const shortName = shortSheetName(info.name || sheet.name) // ชื่อชีทสั้น (เช่น d4)
    // คอลัมน์ Frequency: แยกต่อข้อเมื่อชีทมีหลายข้อ (ตามที่หน้าเว็บ/Freq drawer แสดง)
    const sheetQuestions = (info.questions ?? []).filter(Boolean)
    const multiQuestion = sheetQuestions.length > 1
    const hasQuestionFreq = !!freqByCodeByQuestion?.[sheet.id]
    const includeFrequency = !!freqByCode || hasQuestionFreq
    const freqHeaders = includeFrequency
      ? (multiQuestion && hasQuestionFreq
          ? freqHeadersForQuestions(sheetQuestions)
          : ['Frequency'])
      : []
    const freqColStart = 5
    const colCount = 4 + freqHeaders.length
    const freqOfCode = (code) => {
      const perQ = freqByCodeByQuestion?.[sheet.id]?.[code.id]
      if (perQ) {
        const per = multiQuestion
          ? sheetQuestions.map((q) => Number(perQ[q.column] ?? perQ[q.id] ?? 0) || 0)
          : []
        const total = freqByCode?.[sheet.id]?.[code.id] ?? per.reduce((s, n) => s + n, 0)
        return [...per, ...(multiQuestion ? [Number(total) || 0] : [Number(freqByCode?.[sheet.id]?.[code.id] ?? total) || 0])]
      }
      const total = Number(freqByCode?.[sheet.id]?.[code.id] ?? 0) || 0
      return multiQuestion ? [total] : [total]
    }
    const ws = wb.addWorksheet(uniqName(`Code ${shortName}`),
      hex ? { properties: { tabColor: { argb: 'FF' + hex } } } : undefined)
    const baseColumns = customer
      ? [{ width: 12 }, { width: 68 }, { width: 24 }, { width: 34 }]
      : [{ width: 14 }, { width: 60 }, { width: 22 }, { width: 30 }]
    ws.columns = [...baseColumns, ...freqHeaders.map(() => ({ width: 12 }))]

    if (customer) {
      const title = ws.addRow([codeframe.name || 'Codeframe', '', '', ''])
      ws.mergeCells(title.number, 1, title.number, colCount)
      title.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF111827' } }
      title.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
      title.height = 24
      const sub = ws.addRow(['หมายเหตุ: แถวสีเหลือง = Code ที่เพิ่มใหม่', '', '', ''])
      ws.mergeCells(sub.number, 1, sub.number, colCount)
      sub.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF92400E' } }
      sub.getCell(1).fill = addedCodeFill
      ws.addRow(Array(colCount).fill(''))
    }

    // แถวบนสุด: โจทย์ "ทุกข้อ" ในชีท (A = ชื่อข้อ/variable · B = ข้อความโจทย์เต็ม)
    const qs = info.questions?.length ? info.questions : [{ column: shortName, label: '' }]
    for (const q of qs) {
      const r = ws.addRow(includeFrequency ? [q.column ?? '', q.label ?? '', '', '', ''] : [q.column ?? '', q.label ?? '', '', ''])
      if (q.label && colCount > 2) ws.mergeCells(r.number, 2, r.number, colCount)
      for (let c = 1; c <= colCount; c++) {
        const cell = r.getCell(c)
        cell.border = border
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: customer ? 'FFF8FAFC' : 'FFEEF2FF' } }
        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c === 1 ? 'center' : 'left' }
      }
      r.getCell(1).font = { bold: true, size: 9, color: { argb: customer ? 'FF374151' : 'FF4F46E5' } }
      r.getCell(2).font = { bold: true, size: 9, color: { argb: 'FF111827' } }
      r.height = Math.max(16, Math.min(26, 14 + Math.ceil(String(q.label ?? '').length / 140) * 6))
    }

    // หัวตาราง (ตัวหนา + จัดกลาง + เส้นตาราง + พื้นสีฟ้าอ่อน)
    const head = ws.addRow(['Code No.', 'ThaiGroup', 'ThaiGroup2', 'English', ...freqHeaders])
    for (let c = 1; c <= colCount; c++) {
      const cell = head.getCell(c)
      cell.font = headerFont
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFill } }
      cell.border = border
    }
    // ตรึงโจทย์+หัวตาราง (ทุกแถวเหนือรหัส) + คอลัมน์ A
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: head.number }]

    for (const net of sheet.nets ?? []) {
      const lv = net.level >= 1 ? net.level : 0
      if (lv >= 1 && String(net.name || '').trim()) {
        const indent = '    '.repeat(lv - 1)
        const nr = ws.addRow(includeFrequency ? ['', `${indent}${NET_PREFIX[lv] || 'Net'} : ${net.name}`, '', '', ''] : ['', `${indent}${NET_PREFIX[lv] || 'Net'} : ${net.name}`, '', ''])
        nr.getCell(2).font = { bold: true, color: { argb: customer ? 'FF111827' : 'FF3730A3' } }
        for (let c = 1; c <= colCount; c++) {
          nr.getCell(c).border = border
          if (customer) nr.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
        }
      }
      for (const code of net.codes ?? []) {
        const freqs = includeFrequency ? freqOfCode(code) : []
        const r = ws.addRow([codeNoCell(code.codeNo), code.thai, code.thai2 || '', code.eng || '', ...freqs])
        r.getCell(1).alignment = { horizontal: 'center' }
        const added = isAddedCode(code)
        for (let c = 1; c <= colCount; c++) {
          const cell = r.getCell(c)
          cell.border = c === 1 && added ? { ...border, left: addedCodeLeft } : border
          if (customer) cell.alignment = { vertical: 'top', wrapText: c !== 1 && c < freqColStart, horizontal: c === 1 || c >= freqColStart ? 'center' : 'left' }
          if (added) cell.fill = addedCodeFill
          if (includeFrequency && c >= freqColStart) {
            const freq = freqs[c - freqColStart] ?? 0
            const isTotalCol = multiQuestion && c === colCount
            cell.alignment = { horizontal: 'center', vertical: 'middle' }
            cell.font = { bold: freq > 0, color: { argb: freq > 0 ? (isTotalCol ? 'FF065F46' : 'FF047857') : 'FF94A3B8' } }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: freq > 0 ? (isTotalCol ? 'FFA7F3D0' : 'FFD1FAE5') : 'FFF1F5F9' } }
          }
        }
      }
    }
  }

  const fileName = options.fileName || `${job?.jobNo ? job.jobNo + '_' : ''}${codeframe.name}${customer ? '_customer' : ''}.xlsx`
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------- Export เฉพาะชีทปัจจุบัน เพื่อจัดโครงข้างนอกแล้ว import กลับเฉพาะชีท ----------
export async function exportCodeframeSheet(codeframe, sheet, job, getSheetColor, getSheetInfo, options = {}) {
  const safe = shortSheetName(sheet?.name || 'sheet').replace(/[\\/:*?"<>|]/g, '_')
  return exportCodeframe(
    { ...codeframe, name: `${codeframe.name || 'Codeframe'}_${safe}`, sheets: [sheet] },
    job,
    getSheetColor,
    getSheetInfo,
    { ...options, fileName: options.fileName || `${codeframe.name || 'Codeframe'}_${safe}.xlsx` },
  )
}


// ---------- Export Question List เป็น Excel (รายการโจทย์ที่แสดงในหน้าเว็บ) ----------
// rows: [{ sheetNo, sheetName, variable, column, question, codeCount, status }]
export async function exportQuestionList(rows, fileName = 'questions_export.xlsx') {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'COF Codeframe Studio'
  wb.created = new Date()
  const ws = wb.addWorksheet('Questions')
  ws.columns = [
    { header: 'Sheet No.', key: 'sheetNo', width: 10 },
    { header: 'Sheet Name', key: 'sheetName', width: 24 },
    { header: 'Variable / Code', key: 'variable', width: 18 },
    { header: 'Rawdata Column', key: 'column', width: 20 },
    { header: 'Question Text / โจทย์', key: 'question', width: 72 },
    { header: 'Code Count', key: 'codeCount', width: 12 },
    { header: 'Status', key: 'status', width: 24 },
  ]

  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.alignment = { horizontal: 'center', vertical: 'middle' }
  header.height = 22
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  })

  for (const row of rows) {
    const r = ws.addRow(row)
    r.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: 'top', wrapText: colNumber === 5 }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      }
    })
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: 'A1', to: 'G1' }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function sanitizeSheetName(name) {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
}

// คำนวณความกว้างคอลัมน์ให้พอดีเนื้อหา (จาก aoa) — มี min/max กันแคบ/กว้างเกิน
function colWidthsFromAoA(aoa, { min = 5, max = 40 } = {}) {
  const widths = []
  for (const row of aoa) {
    for (let c = 0; c < row.length; c++) {
      const len = String(row[c] ?? '').length
      if (len > (widths[c] ?? 0)) widths[c] = len
    }
  }
  return widths.map((w) => ({ wch: Math.max(min, Math.min((w ?? 0) + 1, max)) }))
}


// ---------- Export Question + Code List จากหน้า "โจทย์ & Code" ----------
// รูปแบบตามตัวอย่างลูกค้า: 4 คอลัมน์เท่านั้น
// A No. | B Variable | C Question Text / โจทย์ | D Frequency
// แถวแรกของแต่ละข้อ = เลขข้อ + variable + ข้อความโจทย์
// แถวถัดไป = value code + label ในคอลัมน์ C และ frequency ในคอลัมน์ D
export async function exportQuestionCodeList(rows, fileName = 'questions_and_codes.xlsx') {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'COF Codeframe Studio'
  wb.created = new Date()
  const ws = wb.addWorksheet('Questions + Codes')
  ws.columns = [
    { header: 'No.', key: 'no', width: 8 },
    { header: 'Variable', key: 'variable', width: 18 },
    { header: 'Question Text / โจทย์', key: 'text', width: 76 },
    { header: 'Frequency', key: 'frequency', width: 14 },
  ]

  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.alignment = { horizontal: 'center', vertical: 'middle' }
  header.height = 22
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  })

  for (const row of rows) {
    const isQuestionRow = row.kind === 'question'
    const r = ws.addRow(row)
    r.eachCell((cell, colNumber) => {
      cell.alignment = {
        vertical: 'middle',
        wrapText: colNumber === 3,
        horizontal: colNumber === 4 ? 'center' : (isQuestionRow && colNumber === 1 ? 'right' : 'left'),
      }
      cell.border = {
        top: { style: isQuestionRow ? 'thin' : 'hair', color: { argb: isQuestionRow ? 'FFCBD5E1' : 'FFE2E8F0' } },
        left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      }
      if (isQuestionRow) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
        if (colNumber === 3) cell.font = { bold: true, color: { argb: 'FF111827' } }
        if (colNumber === 4) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } }
          cell.font = { bold: true, color: { argb: 'FF111827' } }
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
        }
      }
    })
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: 'A1', to: 'D1' }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------- Export Rawdata ดิบ (headers + rows) เป็น Excel ----------
// rows = array ของ array (ค่าตามที่แสดง/กรองในหน้า Viewer)
// codeCols = Set ของ index คอลัมน์ Code (ถ้ามี → ลงสีไฮไลต์เหมือนชีท "Rawdata + Code")
export function exportRawdataXlsx(headers, rows, fileName, codeCols) {
  // แปลงเป็นตัวเลขถ้าเป็นจำนวนล้วน (ไม่มี 0 นำหน้า เพื่อกันรหัส/ID ที่มี 0 นำ) — ตัดสามเหลี่ยมเขียว
  const toCell = (v) => {
    if (typeof v !== 'string') return v
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)) {
      const n = Number(v)
      if (Number.isFinite(n) && Math.abs(n) < 1e15) return n
    }
    return v
  }
  const aoa = [headers, ...rows.map((r) => r.map(toCell))]
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)
  ws['!cols'] = colWidthsFromAoA(aoa)
  if (codeCols?.size) styleCodeColumns(ws, aoa.length, codeCols)
  const wb = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Rawdata')
  XLSXStyle.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}
