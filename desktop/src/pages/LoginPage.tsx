import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import logoUrl from '../assets/logo.png'
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
    <div className="auth-page">
      <div className="auth-card auth-card-minimal">
        <div className="auth-brand">
          <img className="auth-logo" src={logoUrl} alt="" />
          <div>
            <h1>课题组资产台账</h1>
            <p className="muted">固定资产台账 · 图文周报</p>
          </div>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <Field label="手机号" required>
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="请输入手机号"
              inputMode="numeric"
              maxLength={11}
              autoComplete="username"
            />
          </Field>
          <Field label="密码" required>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </Field>
          {error ? (
            <div>
              <p className="field-error">{error}</p>
              {error.includes('待管理员审批') ? <p className="muted">注册申请已提交，请联系管理员审批后再登录。</p> : null}
            </div>
          ) : null}
          <Button type="submit" variant="primary" className="btn-block" loading={submitting}>
            登录
          </Button>
        </form>

        <p className="auth-foot">
          还没有账号？<Link to="/register">立即注册</Link>
        </p>

        <p className="auth-meta">内网自建 · v0.2</p>

        <div className="auth-server-line">
          <button className="auth-server-toggle" onClick={() => setShowServer((prev) => !prev)}>
            {showServer ? '收起服务器设置' : '服务器：' + getBaseUrl().replace(/^https?:\/\//, '')}
          </button>
          {showServer ? (
            <div className="auth-server">
              <Input value={serverInput} onChange={(event) => setServerInput(event.target.value)} placeholder="http://127.0.0.1:4000" />
              <Button variant="ghost" onClick={() => void handleSaveServer()} loading={savingServer}>
                保存
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
