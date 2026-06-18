#!/usr/bin/env node
import http from 'node:http'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.PORT || 8787)
const CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-5.5'
const TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS || 180000)

const ROUTES = new Map([
  ['/api/ai-group', buildGroupPrompt],
  ['/api/ai-code', buildCodePrompt],
  ['/api/ai-review', buildReviewPrompt],
  ['/api/ai-spellcheck', buildSpellPrompt],
  ['/api/ai-assign', buildAssignPrompt],
  ['/api/ai-group-ce', buildGroupCePrompt],
])

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 10_000_000) reject(new Error('Request too large'))
    })
    req.on('end', () => resolve(body ? JSON.parse(body) : {}))
    req.on('error', reject)
  })
}

function extractJson(text) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // try next extraction strategy
  }
  const lines = trimmed.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).reverse()
  for (const line of lines) {
    if (!line.startsWith('{') && !line.startsWith('[')) continue
    try {
      return JSON.parse(line)
    } catch {
      // try next candidate line
    }
  }
  const lastObj = trimmed.lastIndexOf('{')
  if (lastObj >= 0) {
    try {
      return JSON.parse(trimmed.slice(lastObj))
    } catch {
      // fall through to error
    }
  }
  throw new Error(`Codex did not return JSON. Tail: ${trimmed.slice(-500)}`)
}

function runCodex(prompt, model = CODEX_MODEL) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['exec', '--ephemeral', '-m', model, prompt], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Codex timeout after ${TIMEOUT_MS / 1000}s`))
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(err || out || `Codex exited ${code}`))
      try { resolve(extractJson(out)) } catch (e) { reject(e) }
    })
  })
}

function compact(value) {
  return JSON.stringify(value).slice(0, 120000)
}
function jsonOnly(schema, input) {
  return `Return ONLY valid compact JSON. No markdown, no explanation.\nSchema: ${schema}\nInput JSON:\n${compact(input)}`
}
function buildGroupPrompt(body) {
  return jsonOnly('{"nets":[{"name":"net name","codeIndexes":[0,1]}]} codeIndexes are zero-based indexes of input codes', { codes: body.codes || [] })
}
function buildCodePrompt(body) {
  return jsonOnly('{"codes":[{"label":"code label","net":"net name"}],"assign":[[0,1],[]]} assign length equals verbatims length', { verbatims: body.verbatims || [] })
}
function buildReviewPrompt(body) {
  return jsonOnly('{"codes":[{"label":"code label","net":"net name"}],"assign":[[0],[]]}', { verbatims: body.verbatims || [] })
}
function buildSpellPrompt(body) {
  return jsonOnly('{"fixes":[{"i":0,"fixed":"fixed text","reason":"short reason"}]} only include items that need fixes', { items: body.items || [] })
}
function buildAssignPrompt(body) {
  return jsonOnly('{"assign":[0,-1,2]} assign length equals verbatims length; values are code index or -1', { codes: body.codes || [], verbatims: body.verbatims || [] })
}
function buildGroupCePrompt(body) {
  return jsonOnly('{"assign":[{"existing":0},{"neo":"new code label"},null]} assign length equals verbatims length', { codes: body.codes || [], verbatims: body.verbatims || [] })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, provider: 'codex', model: CODEX_MODEL })
  }
  if (req.method !== 'POST' || !ROUTES.has(url.pathname)) {
    return send(res, 404, { error: 'Not found' })
  }
  try {
    const body = await readBody(req)
    const requestedModel = body.ai?.provider === 'codex' && body.ai?.model ? body.ai.model : CODEX_MODEL
    const prompt = ROUTES.get(url.pathname)(body)
    const result = await runCodex(prompt, requestedModel)
    return send(res, 200, result)
  } catch (e) {
    console.error(e)
    return send(res, 500, { error: e.message || String(e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI runner listening on http://127.0.0.1:${PORT}`)
})
