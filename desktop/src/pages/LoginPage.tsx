import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import logoUrl from '../assets/logo.png'
import { apiErrorMessage, getBaseUrl, setServerUrl } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input, Spinner, useToast } from '../ui'
import { Icon } from '../ui/icons'

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
      <div className="auth-shell">
        <aside className="auth-aside">
          <div className="auth-aside-brand">
            <img className="auth-logo" src={logoUrl} alt="" />
            <span>
              <strong>页屿</strong>
              <small>台账 · 周报 · 留痕</small>
            </span>
          </div>

          <ul className="auth-points">
            <li>
              <span className="auth-point-icon">
                <Icon name="layers" size={16} />
              </span>
              <span>
                <b>固定资产台账</b>
                <small>责任人各自维护，管理员统一盘点</small>
              </span>
            </li>
            <li>
              <span className="auth-point-icon">
                <Icon name="file" size={16} />
              </span>
              <span>
                <b>模版化周报</b>
                <small>按小节逐节填写，图文并茂、便于审阅</small>
              </span>
            </li>
            <li>
              <span className="auth-point-icon">
                <Icon name="shield" size={16} />
              </span>
              <span>
                <b>内网私有部署</b>
                <small>数据只在本组服务器，写操作全留痕</small>
              </span>
            </li>
          </ul>

          <p className="auth-aside-foot">v0.2 · 内网自建 · 无需外网</p>
        </aside>

        <div className="auth-main">
          <div className="auth-head">
            <h1>欢迎回来</h1>
            <p className="muted">使用手机号登录，新账号需管理员审批后可用。</p>
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
              <div className="auth-error">
                <p className="field-error">{error}</p>
                {error.includes('待管理员审批') ? <p className="muted">注册申请已提交，请联系管理员审批后再登录。</p> : null}
              </div>
            ) : null}
            <Button type="submit" variant="primary" className="btn-block" loading={submitting}>
              登录
            </Button>
          </form>

          <div className="auth-foot">
            还没有账号？
            <Link to="/register">立即注册</Link>
          </div>

          <div className="auth-server">
            <span className="muted">服务器</span>
            <Input value={serverInput} onChange={(event) => setServerInput(event.target.value)} placeholder="http://127.0.0.1:4000" />
            <Button variant="ghost" onClick={() => void handleSaveServer()} loading={savingServer}>
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
