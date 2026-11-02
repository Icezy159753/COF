/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Login from './pages/Login.jsx'
import PendingApproval from './pages/PendingApproval.jsx'
import CompleteProfile from './pages/CompleteProfile.jsx'
import CodeframeReview from './pages/CodeframeReview.jsx'
import { StoreProvider, LoadingAnimation } from './store.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'

function AuthGate() {
  const { user, loading, approved, profileCompleted } = useAuth()
  const isReviewRoute = window.location.hash.startsWith('#/review/')

  if (isReviewRoute) {
    return (
      <HashRouter>
        <Routes>
          <Route path="/review/:token" element={<CodeframeReview />} />
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
        <App />
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
