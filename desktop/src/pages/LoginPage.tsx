import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import logoUrl from '../assets/logo.png'
import bgUrl from '../assets/login-bg.jpg'
import { apiErrorMessage, getBaseUrl, setServerUrl } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input, Spinner, useToast } from '../ui'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverInput, setServerInput] = useState(getBaseUrl())
  const [savingServer, setSavingServer] = useState(false)
  const [showServer, setShowServer] = useState(false)

  if (loading) return <Spinner />
  if (user) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!phone.trim() || !password) {
      setError('请填写手机号和密码')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await login({ phone: phone.trim(), password })
      toast.push('登录成功', 'success')
      navigate('/', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveServer(): Promise<void> {
    const next = serverInput.trim()
    if (!/^https?:\/\/\S+$/.test(next)) {
      setError('服务器地址需以 http:// 或 https:// 开头')
      return
    }
    setSavingServer(true)
    try {
      await setServerUrl(next)
      setServerInput(getBaseUrl())
      setError('')
      toast.push('服务器地址已保存', 'success')
    } finally {
      setSavingServer(false)
    }
  }

  return (
    <div className="auth-scene">
      <img className="auth-scene-bg" src={bgUrl} alt="" aria-hidden="true" />
      <div className="auth-scene-tint" aria-hidden="true" />

      <header className="auth-scene-brand">
        <img className="auth-scene-logo" src={logoUrl} alt="" />
        <span>
          <strong>页屿</strong>
          <small>台账 · 周报 · 留痕</small>
        </span>
      </header>

      <div className="auth-panel">
        <form className="form" onSubmit={handleSubmit}>
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="手机号"
            inputMode="numeric"
            maxLength={11}
            autoComplete="username"
          />
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码"
            autoComplete="current-password"
          />
          {error ? (
            <div>
              <p className="field-error">{error}</p>
              {error.includes('待管理员审批') ? <p className="muted">联系管理员审批后再登录。</p> : null}
            </div>
          ) : null}
          <Button type="submit" variant="primary" className="btn-block" loading={submitting}>
            登录
          </Button>
        </form>

        <div className="auth-links">
          <Link to="/register">注册账号</Link>
          <button type="button" className="auth-gear" onClick={() => setShowServer((prev) => !prev)}>
            服务器
          </button>
        </div>

        {showServer ? (
          <div className="auth-server-row">
            <Input value={serverInput} onChange={(event) => setServerInput(event.target.value)} placeholder="http://127.0.0.1:4000" />
            <Button variant="ghost" onClick={() => void handleSaveServer()} loading={savingServer}>
              保存
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
