import { createContext, useContext, useEffect, useState } from 'react'
import {
  browserLocalPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { auth, googleProvider, db } from './firebase.js'
import { firebaseConfig } from './firebaseConfig.js'

// อีเมลนี้เป็น SuperAdmin ถาวร (bootstrap สิทธิ์สูงสุด)
export const SUPERADMIN_EMAIL = 'songklod159@gmail.com'

const AuthContext = createContext(null)

// สร้าง/อัปเดตเอกสารโปรไฟล์ผู้ใช้ใน users/{uid}
async function ensureProfile(u) {
  const ref = doc(db, 'users', u.uid)
  const snap = await getDoc(ref)
  const isSuper = (u.email || '').toLowerCase() === SUPERADMIN_EMAIL

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: u.uid,
      email: u.email || '',
      displayName: u.displayName || '',
      photoURL: u.photoURL || '',
      role: isSuper ? 'superadmin' : 'member',
      status: isSuper ? 'approved' : 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return
  }

  // มีอยู่แล้ว — อัปเดตข้อมูลพื้นฐานให้สด + บังคับสิทธิ์ SuperAdmin ให้อีเมลที่กำหนด
  const data = snap.data()
  const patch = {
    email: u.email || '',
    displayName: u.displayName || '',
    photoURL: u.photoURL || '',
  }
  if (isSuper && (data.role !== 'superadmin' || data.status !== 'approved')) {
    patch.role = 'superadmin'
    patch.status = 'approved'
  }
  await setDoc(ref, patch, { merge: true })
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    let unsubProfile = null
    let cancelled = false
    setPersistence(auth, browserLocalPersistence)
      .then(() => getRedirectResult(auth))
      .catch((e) => {
        if (cancelled) return
        console.error('google redirect sign-in failed', e)
        setError(e?.message || 'เข้าสู่ระบบ Google ไม่สำเร็จ')
        setLoading(false)
      })
    const authFallback = setTimeout(() => {
      // กัน Firebase Auth initial state ไม่ callback แล้วค้างที่หน้า "กำลังเข้าสู่ระบบ"
      setLoading(false)
    }, 8000)
    const unsub = onAuthStateChanged(auth, async (u) => {
      clearTimeout(authFallback)
      if (unsubProfile) {
        unsubProfile()
        unsubProfile = null
      }
      setUser(u)
      if (!u) {
        setProfile(null)
        setLoading(false)
        return
      }
      setLoading(true)
      const profileRef = doc(db, 'users', u.uid)
      const fallback = setTimeout(() => {
        // กันหน้า Splash ค้างถ้า Firestore/profile listener ช้าในมือถือ
        setLoading(false)
      }, 8000)

      // ติดตามโปรไฟล์แบบเรียลไทม์ทันที — ไม่รอ ensureProfile เพื่อกัน boot ค้าง
      unsubProfile = onSnapshot(
        profileRef,
        (s) => {
          clearTimeout(fallback)
          setProfile(s.exists() ? s.data() : null)
          setLoading(false)
        },
        (err) => {
          clearTimeout(fallback)
          console.error('profile snapshot error', err)
          setLoading(false)
        },
      )

      ensureProfile(u).catch((e) => {
        console.error('ensureProfile failed', e)
        setLoading(false)
      })
    })
    return () => {
      cancelled = true
      clearTimeout(authFallback)
      unsub()
      if (unsubProfile) unsubProfile()
    }
  }, [])

  async function signInWithGoogle() {
    setError('')
    setSigningIn(true)
    try {
      if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('...')) {
        setError('Firebase API key ยังไม่ใช่ key จริงของ backend codeframe-dbd8d — ต้องใส่ Web API key จริงก่อนจึงล็อกอินได้')
        setSigningIn(false)
        return
      }
      // setPersistence ถูกตั้งตอนโหลด AuthProvider แล้ว — อย่า await ใน click handler ไม่งั้นมือถืออาจบล็อก popup/redirect
      setPersistence(auth, browserLocalPersistence).catch(() => {})
      googleProvider.setCustomParameters({ prompt: 'select_account' })
      const redirectTimer = window.setTimeout(() => {
        setError('ยังไม่เห็นหน้า Google เปิดขึ้น — ถ้าใช้มือถือให้กดปุ่มอีกครั้ง หรือเปิดเว็บใน Chrome โดยตรง')
        setSigningIn(false)
      }, 2500)
      try {
        await signInWithPopup(auth, googleProvider)
        window.clearTimeout(redirectTimer)
        setSigningIn(false)
        return
      } catch (popupErr) {
        if (popupErr?.code === 'auth/popup-closed-by-user' || popupErr?.code === 'auth/cancelled-popup-request') {
          window.clearTimeout(redirectTimer)
          setSigningIn(false)
          return
        }
        if (popupErr?.code === 'auth/unauthorized-domain') {
          window.clearTimeout(redirectTimer)
          setError('Domain นี้ยังไม่ได้รับอนุญาตใน Firebase Auth: ต้องเพิ่ม codeframe-dp.web.app ใน Authorized domains ของ project codeframe-dbd8d')
          setSigningIn(false)
          return
        }
        // มือถือบางเครื่องบล็อก popup → ใช้ redirect ต่อ แต่ไม่ให้ปุ่มค้างถ้า redirect ไม่ออก
        await signInWithRedirect(auth, googleProvider)
        return
      }
    } catch (e) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
        setSigningIn(false)
        return
      }
      if (e?.code === 'auth/unauthorized-domain') {
        setError('Domain นี้ยังไม่ได้รับอนุญาตใน Firebase Auth: ต้องเพิ่ม codeframe-dp.web.app ใน Authorized domains ของ project codeframe-dbd8d')
        setSigningIn(false)
        return
      }
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await signInWithRedirect(auth, googleProvider)
          return
        } catch (redirectErr) {
          setError(redirectErr?.message || 'เข้าสู่ระบบ Google ไม่สำเร็จ')
          setSigningIn(false)
          return
        }
      }
      setError(e?.message || 'เข้าสู่ระบบไม่สำเร็จ')
      setSigningIn(false)
    }
  }

  async function signOutUser() {
    try {
      await signOut(auth)
    } catch {
      /* ignore */
    }
  }

  const role = profile?.role || null
  const status = profile?.status || null
  const isSuperAdmin = role === 'superadmin'
  const isAdmin = role === 'admin' || isSuperAdmin
  const canManage = isAdmin && status === 'approved'
  const approved = status === 'approved'
  const profileCompleted = !!profile?.profileCompleted

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        status,
        approved,
        profileCompleted,
        isSuperAdmin,
        isAdmin,
        canManage,
        loading,
        signingIn,
        error,
        signInWithGoogle,
        signOutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องอยู่ภายใน <AuthProvider>')
  return ctx
}
