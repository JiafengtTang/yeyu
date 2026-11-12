import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerSchema } from '@lab/shared'
import { apiErrorMessage } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input } from '../ui'

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

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card-minimal">
          <div>
            <h1>注册已提交</h1>
            <p className="muted">已提交，等待管理员审批。审批通过后即可使用手机号登录。</p>
          </div>
          <Button variant="primary" className="btn-block" onClick={() => navigate('/login', { replace: true })}>
            返回登录
          </Button>
          <div className="auth-foot">
            <Link to="/login">返回登录页</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-minimal">
        <div>
          <h1>注册账号</h1>
          <p className="muted">注册后需管理员审批，审批通过前无法登录。</p>
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <Field label="手机号" required error={fieldErrors.phone}>
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="请输入 11 位手机号"
              inputMode="numeric"
              maxLength={11}
              autoComplete="username"
            />
          </Field>
          <Field label="密码" required error={fieldErrors.password} hint="至少 6 位">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="new-password"
            />
          </Field>
          <Field label="姓名" required error={fieldErrors.name}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入真实姓名" />
          </Field>
          <Field label="邮箱" error={fieldErrors.email} hint="可选，用于接收通知">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
          </Field>
          {error ? <p className="field-error">{error}</p> : null}
          <Button type="submit" variant="primary" className="btn-block" loading={submitting}>
            提交注册
          </Button>
        </form>
        <div className="auth-foot">
          已有账号？
          <Link to="/login">返回登录</Link>
        </div>
      </div>
    </div>
  )
}
