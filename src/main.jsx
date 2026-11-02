/* eslint-disable react-refresh/only-export-components */
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Login from './pages/Login.jsx'
import PendingApproval from './pages/PendingApproval.jsx'
import CompleteProfile from './pages/CompleteProfile.jsx'
import { StoreProvider, LoadingAnimation } from './store.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'

const App = lazy(() => import('./App.jsx'))
const CodeframeReview = lazy(() => import('./pages/CodeframeReview.jsx'))

// หลัง deploy เวอร์ชันใหม่ ไฟล์ chunk เก่าจะหายไป → แท็บที่เปิดค้างไว้โหลดหน้าไม่ได้
// ให้รีโหลดอัตโนมัติ 1 ครั้งเพื่อดึงเวอร์ชันล่าสุด (กันวนลูปด้วย sessionStorage)
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'cof-chunk-reload-at'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY) || 0) } catch { /* ignore */ }
  if (Date.now() - last < 10000) return
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
  event.preventDefault()
  window.location.reload()
})

function AuthGate() {
  const { user, loading, approved, profileCompleted } = useAuth()
  const isReviewRoute = window.location.hash.startsWith('#/review/')

  if (isReviewRoute) {
    return (
      <HashRouter>
        <Routes>
          <Route
            path="/review/:token"
            element={
              <Suspense fallback={<LoadingAnimation full label="กำลังโหลด" />}>
                <CodeframeReview />
              </Suspense>
            }
          />
        </Routes>
      </HashRouter>
    )
  }

  if (loading) return <LoadingAnimation full label="กำลังเข้าสู่ระบบ" />

  if (!user) return <Login />
  if (!approved) return <PendingApproval />
  if (!profileCompleted) return <CompleteProfile />

  return (
    <StoreProvider>
      <HashRouter>
        <Suspense fallback={<LoadingAnimation full label="กำลังโหลด" />}>
          <App />
        </Suspense>
      </HashRouter>
    </StoreProvider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  </StrictMode>,
)
