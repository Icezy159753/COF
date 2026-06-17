import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { runClaudeGrouping, runClaudeCoding, runClaudeReview, runClaudeSpellcheck, runClaudeAssign, runClaudeGroupCE, listOpenRouterModels } from './server/claudeGroup.mjs'
import { parseSavBuffer } from './server/savCodebook.mjs'

// อ่าน body แบบ binary (สำหรับไฟล์ .sav) → Buffer
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// อ่าน body ของ request เป็น UTF-8 ทีเดียว (กัน UTF-8 หลายไบต์เพี้ยนตรงรอยต่อ chunk)
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// ปลั๊กอิน: เปิด endpoint ให้หน้าเว็บเรียก แล้วสั่ง Claude CLI (ล็อกอินบนเครื่อง)
//   POST /api/ai-group → จัดกลุ่ม "รหัส" ที่มีอยู่เป็น Net
//   POST /api/ai-code  → อ่าน verbatim ดิบ สร้าง codeframe + จับหลายโค้ดต่อ 1 คำตอบ
function aiGroupPlugin() {
  return {
    name: 'ai-group-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/ai-group', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }
        res.setHeader('Content-Type', 'application/json')
        readJsonBody(req)
          .then(async ({ codes, ai }) => {
            if (!Array.isArray(codes) || !codes.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'ไม่มีรหัสให้จัดกลุ่ม' }))
            }
            const grouping = await runClaudeGrouping(codes, ai || {})
            res.end(JSON.stringify(grouping))
          })
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          })
      })

      server.middlewares.use('/api/ai-code', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }
        res.setHeader('Content-Type', 'application/json')
        readJsonBody(req)
          .then(async ({ verbatims, ai }) => {
            if (!Array.isArray(verbatims) || !verbatims.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'ไม่มีคำตอบให้โค้ดดิ้ง' }))
            }
            const result = await runClaudeCoding(verbatims, ai || {})
            res.end(JSON.stringify(result))
          })
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          })
      })

      server.middlewares.use('/api/ai-review', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }
        res.setHeader('Content-Type', 'application/json')
        readJsonBody(req)
          .then(async ({ verbatims, ai }) => {
            if (!Array.isArray(verbatims) || !verbatims.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'ไม่มีคำตอบให้รีวิว' }))
            }
            const result = await runClaudeReview(verbatims, ai || {})
            res.end(JSON.stringify(result))
          })
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          })
      })

      // ตรวจตัวสะกด/รูปประโยคของ Verbatim (ไม่เปลี่ยนความหมาย)
      server.middlewares.use('/api/ai-spellcheck', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }
        res.setHeader('Content-Type', 'application/json')
        readJsonBody(req)
          .then(async ({ items, ai }) => {
            if (!Array.isArray(items) || !items.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'ไม่มีข้อความให้ตรวจ' }))
            }
            const result = await runClaudeSpellcheck(items, ai || {})
            res.end(JSON.stringify(result))
          })
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          })
      })

      // Group CE อัตโนมัติ: จับเข้า Code เดิม (ถ้าตรง) + สร้าง Code ใหม่ (ถ้าไม่มี)
      server.middlewares.use('/api/ai-group-ce', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }
        res.setHeader('Content-Type', 'application/json')
        readJsonBody(req)
          .then(async ({ codes, verbatims, ai }) => {
            if (!Array.isArray(codes) || !Array.isArray(verbatims) || !verbatims.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'ต้องมีรหัสและคำตอบ' }))
            }
            const result = await runClaudeGroupCE(codes, verbatims, ai || {})
            res.end(JSON.stringify(result))
          })
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          })
      })

      // จับ verbatim 'อื่นๆ ระบุ' เข้ารหัสที่มีอยู่ (จาก SPSS value labels)
      server.middlewares.use('/api/ai-assign', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }
        res.setHeader('Content-Type', 'application/json')
        readJsonBody(req)
          .then(async ({ codes, verbatims, ai }) => {
            if (!Array.isArray(codes) || !codes.length || !Array.isArray(verbatims) || !verbatims.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'ต้องมีทั้งรหัสและคำตอบ' }))
            }
            const result = await runClaudeAssign(codes, verbatims, ai || {})
            res.end(JSON.stringify(result))
          })
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          })
      })

      // ดึงรายชื่อโมเดลทั้งหมดจาก OpenRouter (proxy ผ่าน server เลี่ยงปัญหา CORS)
      server.middlewares.use('/api/openrouter-models', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        listOpenRouterModels()
          .then((models) => res.end(JSON.stringify({ models })))
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: `ดึงรายชื่อโมเดลไม่สำเร็จ: ${e.message}` }))
          })
      })

      // อ่าน metadata (Value+Label) จากไฟล์ SPSS .sav (body = ไฟล์ binary)
      server.middlewares.use('/api/parse-sav', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }
        res.setHeader('Content-Type', 'application/json')
        readRawBody(req)
          .then(async (buf) => {
            if (!buf?.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'ไม่มีไฟล์ .sav' }))
            }
            const result = await parseSavBuffer(buf)
            res.end(JSON.stringify(result))
          })
          .catch((e) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: `อ่านไฟล์ .sav ไม่สำเร็จ: ${e.message}` }))
          })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), aiGroupPlugin()],
})
