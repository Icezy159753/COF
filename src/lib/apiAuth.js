// แนบ Firebase ID token ไปกับทุก request ที่เรียก AI backend (ai-runner ตรวจ token + สถานะอนุมัติ)
// แยกไฟล์นี้ไว้เพื่อให้ lib อื่น (aiGroup/spss) ไม่ต้อง import Firebase เอง — auth.jsx เป็นคนตั้ง provider
let tokenProvider = null

export function setApiTokenProvider(fn) {
  tokenProvider = typeof fn === 'function' ? fn : null
}

export async function authHeaders(extra = {}) {
  // ถ้าดึง token ไม่ได้ ให้ส่งไปแบบไม่มี token → backend ตอบ 401 พร้อมข้อความที่อ่านเข้าใจ
  const token = tokenProvider ? await Promise.resolve().then(tokenProvider).catch(() => null) : null
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra }
}
