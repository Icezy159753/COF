import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const editor = fs.readFileSync(new URL('../src/pages/CodeframeEditor.jsx', import.meta.url), 'utf8')
const store = fs.readFileSync(new URL('../src/store.jsx', import.meta.url), 'utf8')

// CE แก้ Rawdata ผ่าน stampRawdataCells → store.patchRawdata (เขียนเฉพาะเซลล์ที่แก้ บน Rawdata ล่าสุด)
const stampCalls = [...editor.matchAll(/stampRawdataCells\(undoSnapshot\)\.catch/g)]

test('CodeframeEditor rawdata edits do not overwrite original rawdata baseline', () => {
  assert.ok(stampCalls.length >= 3, 'expected edit/delete/split Verbatim rawdata save calls')
  assert.doesNotMatch(editor, /setRawdata\(projectId,\s*\{\s*\.\.\.rawdata,\s*rows\s*\}/, 'whole-rawdata writes would clobber Verbatim-box edits')
  // patchRawdata บังคับ updateOriginal: false (ไม่แตะต้นฉบับ)
  assert.match(store, /async patchRawdata\(projectId, cells, options = \{\}\)[\s\S]*?updateOriginal: false, \.\.\.options/)
})

test('CodeframeEditor rawdata edit paths send undo snapshots', () => {
  assert.ok(stampCalls.length >= 3, 'expected edit/delete/split Verbatim rawdata save calls')
  assert.match(editor, /const stampRawdataCells = \(undoSnapshot\) => \(undoSnapshot\s*\? patchRawdata\(projectId, undoSnapshot\.cells, \{ undoSnapshot \}\)/)
})

test('CodeframeEditor delete Verbatim with code-specific _oth does not fallback-clear other codes like 13', () => {
  assert.match(editor, /const specificTextCols = matchedTextCols\.filter/)
  assert.match(editor, /if \(!specificTextCols\.length\) \{\n\s*for \(const \{ q, cols \} of info\.closedQs\)/)
  assert.match(editor, /ต้องลบ code 211 เท่านั้น ไม่ลบ 13/)
})

test('CodeframeEditor Coding Sheet exposes Undo and Redo controls', () => {
  assert.match(editor, /<Undo2 size=\{13\}/)
  assert.match(editor, /<Redo2 size=\{13\}/)
  assert.match(editor, /canUndoStep/)
  assert.match(editor, /canRedoStep/)
})

test('store rawdata undo/redo is optimistic and cache-backed', () => {
  assert.match(store, /rawdataUndoCache/)
  assert.match(store, /rawdataUndoCacheKey/)
  assert.match(store, /rawdataUndoCache\.has\(key\)/)
  assert.match(store, /fastUndoMeta/)
  assert.match(store, /optimisticUndoStack/)
  assert.match(store, /api\.setRawdata\(projectId, \{ \.\.\.rawdata, rows \}, \{ updateOriginal: false \}\)\n\s*\.catch\(reportPersistError\)/)
})

test('CodeframeEditor has one bulk gray-sheet hide/unhide button, not per-tab hide buttons', () => {
  assert.match(editor, /toggleHideGraySheets/)
  assert.match(editor, /graySheets = \(cf\.sheets \?\? \[\]\)\.filter\(\(s\) => \(sheetStatusMap\[s\.id\] \?\? 'none'\) === 'gray'\)/)
  assert.match(editor, /Hide สีเทา/)
  assert.match(editor, /Show สีเทา/)
  assert.doesNotMatch(editor, /toggleHideSheet/)
})

test('CodeframeEditor bulk hide removes hidden gray sheets from bottom tab strip', () => {
  assert.match(editor, /visibleSheetTabs = \(cf\.sheets \?\? \[\]\)\.filter\(\(s\) => statusKeyForSheet\(s\) !== 'hidden'\)/)
  assert.match(editor, /\{visibleSheetTabs\.map\(\(s\) => \{/)
  assert.match(editor, /nextActiveSheetId = \(!shouldUnhide && grayIds\.has\(activeSheetId\)\)/)
})
