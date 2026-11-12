import { type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import logoUrl from './assets/logo.png'
import { useAuth } from './auth/AuthProvider'
import { Spinner } from './ui'
import { Icon, type IconName } from './ui/icons'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import HomePage from './pages/HomePage'
import AssetsPage from './pages/AssetsPage'
import ReportsPage from './pages/ReportsPage'
import ReportEditorPage from './pages/ReportEditorPage'
import ReviewPage from './pages/ReviewPage'
import AdminUsersPage from './pages/AdminUsersPage'
import TemplatesPage from './pages/admin/TemplatesPage'

interface NavItem {
  to: string
  label: string
  icon: IconName
  admin?: boolean
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '工作台', icon: 'dashboard', end: true },
  { to: '/assets', label: '资产台账', icon: 'layers' },
  { to: '/reports', label: '我的周报', icon: 'file' },
  { to: '/reviews', label: '周报审阅', icon: 'checkSquare', admin: true },
  { to: '/admin/users', label: '用户与权限', icon: 'users', admin: true },
  { to: '/admin/templates', label: '模版与截止', icon: 'sliders', admin: true }
]

const TITLES: Record<string, string> = {
  '/': '工作台',
  '/assets': '资产台账',
  '/reports': '我的周报',
  '/reviews': '周报审阅',
  '/admin/users': '用户与权限',
  '/admin/templates': '模版与截止'
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
  const title = location.pathname.startsWith('/reports/') ? '周报编辑' : TITLES[location.pathname] ?? '课题组资产台账'
  const initial = (user?.name ?? '?').trim().slice(0, 1)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" />
          <span className="brand-text">
            课题组资产台账
            <small>固定资产 · 图文周报</small>
          </span>
        </div>

        <nav className="nav">
          {NAV_ITEMS.filter((item) => !item.admin || isAdmin).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              <span className="nav-icon">
                <Icon name={item.icon} size={15} strokeWidth={1.8} />
              </span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-user">
          <span className="avatar">{initial}</span>
          <span className="sidebar-user-info">
            <strong>{user?.name}</strong>
            <small>{isAdmin ? '管理员' : '成员'}</small>
          </span>
          <button className="icon-btn sidebar-logout" onClick={logout} title="退出登录" aria-label="退出登录">
            <Icon name="logout" size={15} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <div className="topbar-user">
            <span>{user?.phone}</span>
            <span className="topbar-role">{isAdmin ? '管理员' : '成员'}</span>
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
      <Route path="/admin/templates" element={<AuthedLayout adminOnly><TemplatesPage /></AuthedLayout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
