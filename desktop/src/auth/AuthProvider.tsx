import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LoginInput, RegisterInput, UserDTO } from '@lab/shared'
import { ApiError, api, getToken, setToken as persistToken } from '../api/client'

interface AuthContextValue {
  user: UserDTO | null
  loading: boolean
  isAdmin: boolean
  login(input: LoginInput): Promise<void>
  register(input: RegisterInput): Promise<UserDTO>
  logout(): void
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const me = await api<UserDTO>('/api/auth/me')
      setUser(me)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) persistToken(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 登录前是"小窗"，登录后展开成应用窗口；退出登录再收回
  useEffect(() => {
    if (loading) return
    void window.desktop?.setWindowMode?.(user ? 'app' : 'login')
  }, [user, loading])

  const login = useCallback(async (input: LoginInput) => {
    const result = await api<{ token: string; user: UserDTO }>('/api/auth/login', { method: 'POST', body: input })
    persistToken(result.token)
    const me = await api<UserDTO>('/api/auth/me')
    setUser(me)
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const result = await api<{ user: UserDTO }>('/api/auth/register', { method: 'POST', body: input })
    return result.user
  }, [])

  const logout = useCallback(() => {
    persistToken(null)
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isAdmin: user?.role === 'ADMIN', login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
