import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Login from './pages/Login.jsx'
import PendingApproval from './pages/PendingApproval.jsx'
import CompleteProfile from './pages/CompleteProfile.jsx'
import { StoreProvider, LoadingAnimation } from './store.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'

function AuthGate() {
  const { user, loading, approved, profileCompleted } = useAuth()

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
