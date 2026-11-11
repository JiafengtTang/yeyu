import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
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
      <div className="auth-card">
        <div>
          <h1>课题组资产台账</h1>
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
            <div>
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
        <div className="toolbar">
          <span className="muted">服务器</span>
          <div className="grow">
            <Input value={serverInput} onChange={(event) => setServerInput(event.target.value)} placeholder="http://127.0.0.1:4000" />
          </div>
          <Button variant="ghost" onClick={() => void handleSaveServer()} loading={savingServer}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
