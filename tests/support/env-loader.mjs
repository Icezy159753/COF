// Node module hook: แทน `import.meta.env` ในไฟล์ src/ ด้วย object จาก process.env (VITE_*) + MODE=test
// หมายเหตุ: hook รันใน loader thread แยก → เห็น process.env ตอนเริ่ม process เท่านั้น
// ถ้าเทสต์ต้องการค่า env เฉพาะกรณี ให้ตั้งตอนรัน (VITE_X=.. npm test) หรือ transform source เองในเทสต์
const SRC_MARK = '/src/'

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (!url.startsWith('file:') || !url.includes(SRC_MARK) || !/\.m?js(?:[?#]|$)/.test(url)) return result
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8')
  if (!source.includes('import.meta.env')) return result
  const env = { MODE: 'test', DEV: false, PROD: false }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('VITE_')) env[k] = v
  return { ...result, source: source.replaceAll('import.meta.env', `(${JSON.stringify(env)})`) }
}
