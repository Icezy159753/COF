/* eslint-disable react-refresh/only-export-components */
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
import { setApiTokenProvider } from './apiAuth.js'

// ทุก request ไป AI backend แนบ ID token ของผู้ใช้ปัจจุบัน (SDK refresh ให้อัตโนมัติเมื่อใกล้หมดอายุ)
setApiTokenProvider(() => auth.currentUser?.getIdToken() ?? null)

// อีเมลนี้เป็น SuperAdmin ถาวร (bootstrap สิทธิ์สูงสุด)
export const SUPERADMIN_EMAIL = 'songklod159@gmail.com'

const AuthContext = createContext(null)

export function isLocalUxPreview() {
  if (typeof window === 'undefined') return false
  const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  return localHost && (window.location.search.includes('ux-preview=1') || window.location.hash.includes('ux-preview=1'))
}

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
  const previewMode = isLocalUxPreview()
  const previewUser = {
    uid: 'local-ux-preview',
    email: 'js-ux-preview@local.test',
    displayName: 'JS UX Preview',
    photoURL: '',
  }

  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    if (previewMode) return undefined
    let unsubProfile = null
    let cancelled = false
    setPersistence(auth, browserLocalPersistence)
      .then(() => getRedirectResult(auth))
      .then((result) => {
        if (cancelled) return
        const wasRedirecting = window.sessionStorage.getItem('codeframe_login_redirect_pending') === '1'
        if (result?.user) {
          window.sessionStorage.removeItem('codeframe_login_redirect_pending')
          setError('')
          setSigningIn(false)
        } else if (wasRedirecting) {
          window.sessionStorage.removeItem('codeframe_login_redirect_pending')
          setError('Google กลับมาที่เว็บแล้ว แต่ Firebase ยังไม่ได้ยืนยันผู้ใช้ — ให้ลองกดเข้าสู่ระบบอีกครั้ง หรือเช็กว่า Authorized domains มี codeframe-dp.web.app')
          setSigningIn(false)
        }
      })
      .catch((e) => {
        if (cancelled) return
        console.error('google redirect sign-in failed', e)
        const msg = e?.code === 'auth/unauthorized-domain'
          ? 'Domain นี้ยังไม่ได้รับอนุญาตใน Firebase Auth: ต้องเพิ่ม codeframe-dp.web.app ใน Authorized domains ของ project codeframe-dbd8d'
          : `${e?.code ? `${e.code}: ` : ''}${e?.message || 'เข้าสู่ระบบ Google ไม่สำเร็จ'}`
        setError(msg)
        setSigningIn(false)
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
      if (u) {
        setError('')
        setSigningIn(false)
      }
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
  }, [previewMode])

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
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
      if (isMobile) {
        window.sessionStorage.setItem('codeframe_login_redirect_pending', '1')
        await signInWithRedirect(auth, googleProvider)
        return
      }
      try {
        await signInWithPopup(auth, googleProvider)
        setSigningIn(false)
        return
      } catch (popupErr) {
        if (popupErr?.code === 'auth/popup-closed-by-user' || popupErr?.code === 'auth/cancelled-popup-request') {
          setSigningIn(false)
          return
        }
        if (popupErr?.code === 'auth/unauthorized-domain') {
          setError('Domain นี้ยังไม่ได้รับอนุญาตใน Firebase Auth: ต้องเพิ่ม codeframe-dp.web.app ใน Authorized domains ของ project codeframe-dbd8d')
          setSigningIn(false)
          return
        }
        // ถ้า browser บล็อก popup จริง ๆ ค่อยใช้ redirect ต่อ
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

  if (previewMode) {
    return (
      <AuthContext.Provider
        value={{
          user: previewUser,
          profile: { uid: previewUser.uid, email: previewUser.email, displayName: previewUser.displayName, role: 'superadmin', status: 'approved', profileCompleted: true },
          role: 'superadmin',
          status: 'approved',
          approved: true,
          profileCompleted: true,
          isSuperAdmin: true,
          isAdmin: true,
          canManage: true,
          loading: false,
          signingIn: false,
          error: '',
          signInWithGoogle: async () => {},
          signOutUser: async () => {},
        }}
      >
        {children}
      </AuthContext.Provider>
    )
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
