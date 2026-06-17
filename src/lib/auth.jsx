import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { auth, googleProvider, db } from './firebase.js'

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

  useEffect(() => {
    let unsubProfile = null
    const unsub = onAuthStateChanged(auth, async (u) => {
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
      try {
        await ensureProfile(u)
      } catch (e) {
        console.error('ensureProfile failed', e)
      }
      // ติดตามโปรไฟล์แบบเรียลไทม์ (สถานะ/role เปลี่ยน → อัปเดตทันทีโดยไม่ต้องรีโหลด)
      unsubProfile = onSnapshot(
        doc(db, 'users', u.uid),
        (s) => {
          setProfile(s.exists() ? s.data() : null)
          setLoading(false)
        },
        (err) => {
          console.error('profile snapshot error', err)
          setLoading(false)
        },
      )
    })
    return () => {
      unsub()
      if (unsubProfile) unsubProfile()
    }
  }, [])

  async function signInWithGoogle() {
    setError('')
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return
      setError(e?.message || 'เข้าสู่ระบบไม่สำเร็จ')
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
