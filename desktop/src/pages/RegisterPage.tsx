import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerSchema } from '@yeyu/shared'
import logoUrl from '../assets/logo.png'
import bgUrl from '../assets/login-bg.jpg'
import { apiErrorMessage } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Input } from '../ui'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFieldErrors({})
    setError('')
    const parsed = registerSchema.safeParse({
      phone: phone.trim(),
      password,
      name: name.trim(),
      email: email.trim() ? email.trim() : undefined
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '')
        if (key && !next[key]) next[key] = issue.message
      }
      setFieldErrors(next)
      return
    }
    setSubmitting(true)
    try {
      await register(parsed.data)
      setSubmitted(true)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const firstError = Object.values(fieldErrors)[0] ?? ''

  return (
    <div className="auth-scene">
      <img className="auth-scene-bg" src={bgUrl} alt="" aria-hidden="true" />
      <div className="auth-scene-tint" aria-hidden="true" />

      <header className="auth-scene-brand">
        <img className="auth-brand-logo" src={logoUrl} alt="" />
        <h1 className="auth-brand-name">页屿</h1>
        <p className="auth-brand-sub">台账 · 周报 · 留痕</p>
      </header>

      <div className="auth-panel auth-panel-register">
        {submitted ? (
          <>
            <div className="auth-panel-title">注册已提交</div>
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
              等待管理员审批，通过后即可用手机号登录。
            </p>
            <Button variant="primary" className="btn-block" onClick={() => navigate('/login', { replace: true })}>
              返回登录
            </Button>
          </>
        ) : (
          <>
            <div className="auth-panel-title">注册账号</div>
            <form className="form" onSubmit={handleSubmit}>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="手机号（11 位）"
                inputMode="numeric"
                maxLength={11}
                autoComplete="username"
              />
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码（至少 6 位）"
                autoComplete="new-password"
              />
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="姓名" />
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱（可选）" />
              {firstError ? <p className="field-error">{firstError}</p> : null}
              {error ? <p className="field-error">{error}</p> : null}
              <Button type="submit" variant="primary" className="btn-block" loading={submitting}>
                提交注册
              </Button>
            </form>
          </>
        )}

        <div className="auth-links">
          <Link to="/login">返回登录</Link>
        </div>
      </div>
    </div>
  )
}
