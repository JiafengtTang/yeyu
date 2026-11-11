import { type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { Spinner } from './ui'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import HomePage from './pages/HomePage'
import AssetsPage from './pages/AssetsPage'
import ReportsPage from './pages/ReportsPage'
import ReportEditorPage from './pages/ReportEditorPage'
import ReviewPage from './pages/ReviewPage'
import AdminUsersPage from './pages/AdminUsersPage'

interface NavItem {
  to: string
  label: string
  admin?: boolean
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '工作台', end: true },
  { to: '/assets', label: '资产台账' },
  { to: '/reports', label: '我的周报' },
  { to: '/reviews', label: '周报审阅', admin: true },
  { to: '/admin/users', label: '用户与权限', admin: true }
]

const TITLES: Record<string, string> = {
  '/': '工作台',
  '/assets': '资产台账',
  '/reports': '我的周报',
  '/reviews': '周报审阅',
  '/admin/users': '用户与权限'
}

function Guard({ adminOnly = false, children }: { adminOnly?: boolean; children: ReactNode }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function Shell({ children }: { children: ReactNode }) {
  const { user, isAdmin, logout } = useAuth()
  const location = useLocation()
  const title = TITLES[location.pathname] ?? '课题组资产台账'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">资</span>
          <span className="brand-text">
            课题组资产台账
            <small>固定资产 · 图文周报</small>
          </span>
        </div>
        <nav className="nav">
          {NAV_ITEMS.filter((item) => !item.admin || isAdmin).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {user?.name ?? ''} · {isAdmin ? '管理员' : '成员'}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <div className="topbar-user">
            <span>{user?.phone}</span>
            <button className="btn btn-sm btn-ghost" onClick={logout}>
              退出
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}

function AuthedLayout({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  return (
    <Guard adminOnly={adminOnly}>
      <Shell>{children}</Shell>
    </Guard>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<AuthedLayout><HomePage /></AuthedLayout>} />
      <Route path="/assets" element={<AuthedLayout><AssetsPage /></AuthedLayout>} />
      <Route path="/reports" element={<AuthedLayout><ReportsPage /></AuthedLayout>} />
      <Route path="/reports/:id" element={<AuthedLayout><ReportEditorPage /></AuthedLayout>} />
      <Route path="/reviews" element={<AuthedLayout adminOnly><ReviewPage /></AuthedLayout>} />
      <Route path="/admin/users" element={<AuthedLayout adminOnly><AdminUsersPage /></AuthedLayout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
