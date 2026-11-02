// UI smoke test — เปิดแอปที่ build แล้วใน Chrome headless (โหมด ux-preview = ข้อมูลจำลอง ไม่แตะ Firestore จริง)
// ตรวจว่าทุกหน้าโหลดได้ ไม่มี JS error และปุ่ม Export สร้างไฟล์ Excel ที่อ่านได้จริง
//
// วิธีรัน:  npm run test:smoke        (build ก่อน แล้วรันไฟล์นี้)
// ต้องมี Chrome/Chromium: ตั้ง CHROME_PATH หรือให้สคริปต์หาเองจาก Playwright cache (~/.cache/ms-playwright)
// ถ้าหา Chrome ไม่เจอ → ข้าม (exit 0) พร้อมแจ้งเตือน เพื่อไม่ให้ CI ที่ไม่มีเบราว์เซอร์พัง
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'dist')
const PROJECT = 'ux-preview-job'
const CF = 'ux-preview-cf'

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  for (const bin of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (fs.existsSync(bin)) return bin
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  if (fs.existsSync(cache)) {
    const dirs = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const d of dirs) {
      const bin = path.join(cache, d, 'chrome-linux64/chrome')
      if (fs.existsSync(bin)) return bin
    }
  }
  return null
}

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)) }) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeout = 15000, step = 200) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step) }
  return null
}

async function main() {
  const chrome = findChrome()
  if (!chrome) { console.warn('⚠ ui-smoke: ไม่พบ Chrome (ตั้ง CHROME_PATH) — ข้าม'); return 0 }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('✗ ไม่พบ dist/ — รัน npm run build ก่อน'); return 1 }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cof-smoke-'))
  const downloads = path.join(tmp, 'downloads'); fs.mkdirSync(downloads)
  const port = await freePort()
  const preview = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  const children = [preview]
  process.on('exit', () => { for (const c of children) try { c.kill() } catch { /* ignore */ } })
  const base = `http://127.0.0.1:${port}/?ux-preview=1`
  const up = await waitFor(() => fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false))
  if (!up) { preview.kill(); console.error('✗ vite preview ไม่ขึ้น'); return 1 }

  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${path.join(tmp, 'profile')}`, '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  children.push(ch)
  const wsUrl = await new Promise((res, rej) => { let b = ''; ch.stderr.on('data', (d) => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]) }); setTimeout(() => rej(new Error('Chrome DevTools ไม่ตอบ')), 20000) })
  const devPort = new URL(wsUrl).port
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${devPort}/json`)).json()).find((t) => t.type === 'page'), 10000)
  if (!page) throw new Error('Chrome ไม่มีแท็บ page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))

  let id = 0; const pending = new Map(); let errors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0])
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && m.params.response.url.startsWith(`http://127.0.0.1:${port}`)) errors.push(`HTTP ${m.params.response.status} ${m.params.response.url}`)
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable')
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })

  const results = []
  const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }
  const bodyText = () => evaluate('document.body.innerText')

  async function visit(name, hash, expectText) {
    errors = []
    await send('Page.navigate', { url: `${base}#${hash}` })
    const text = await waitFor(async () => { const t = await bodyText(); return t && expectText.every((s) => t.includes(s)) && !t.includes('กำลังโหลด') ? t : null }, 15000)
    const notFound = (await bodyText() || '').includes('ไม่พบหน้านี้')
    check(`หน้า ${name}`, !!text && !notFound && errors.length === 0, !text ? `ไม่พบข้อความ ${JSON.stringify(expectText)}` : notFound ? 'ขึ้นหน้าไม่พบ' : errors.slice(0, 3).join(' | '))
  }

  async function clickExport(name, buttonText) {
    errors = []
    // ล้างโฟลเดอร์ก่อน — บางปุ่มตั้งชื่อไฟล์ซ้ำกัน (Chrome จะเขียนทับ)
    for (const f of fs.readdirSync(downloads)) fs.rmSync(path.join(downloads, f), { force: true })
    const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(buttonText)} && !x.disabled); if (!b) return false; b.click(); return true })()`)
    if (!clicked) return check(`Export: ${name}`, false, `ไม่พบปุ่ม "${buttonText}"`)
    const file = await waitFor(() => fs.readdirSync(downloads).find((f) => f.endsWith('.xlsx')), 20000)
    if (!file) {
      const toast = ((await bodyText()) || '').split('\n').filter((l) => /ไม่สำเร็จ|ยังโหลด|error/i.test(l)).slice(0, 2).join(' / ')
      return check(`Export: ${name}`, false, `ไม่มีไฟล์ดาวน์โหลด ${toast} ${errors.slice(0, 2).join(' | ')}`)
    }
    await sleep(300)
    const buf = fs.readFileSync(path.join(downloads, file))
    const XLSX = await import('xlsx')
    const sheets = XLSX.read(buf).SheetNames
    check(`Export: ${name}`, buf.subarray(0, 2).toString() === 'PK' && sheets.length > 0 && errors.length === 0, `${file} · ชีท: ${sheets.join(', ')}`)
  }

  try {
    await visit('Dashboard', '/', ['UX Preview · Starry Sky 3'])
    await visit('Project Hub', `/projects/${PROJECT}`, ['Job health', 'Coding & Editing'])
    await visit('Box CE', `/projects/${PROJECT}/ce`, ['กล่อง CE', 'Codeframe (1)'])
    await visit('Box OE', `/projects/${PROJECT}/oe`, ['UX Preview'])
    await visit('Rawdata Viewer', `/projects/${PROJECT}/rawdata`, ['SbjNum'])
    await clickExport('Rawdata Excel', 'Export Excel')
    await visit('Verbatim', `/projects/${PROJECT}/verbatim`, ['UX Preview'])
    await visit('Codeframe Editor', `/projects/${PROJECT}/ce/codeframes/${CF}`, ['Export Codeframe'])
    await clickExport('Codeframe', 'Export Codeframe')
    await clickExport('Data (Rawdata + Code)', 'Export Data')
    await visit('Members', '/members', ['JS UX Preview'])
    await visit('Ops Center', '/ops', ['Ops'])
    await visit('AI Providers', '/ai-providers', ['AI'])
  } finally {
    ws.close(); ch.kill(); preview.kill()
    await sleep(300)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\nui-smoke: ผ่าน ${results.length - failed.length}/${results.length}`)
  return failed.length ? 1 : 0
}

main().then((code) => process.exit(code), (err) => { console.error('✗ ui-smoke error:', err); process.exit(1) })
