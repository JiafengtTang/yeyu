import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReportDTO, ReportSummaryDTO } from '@lab/shared'
import { REPORT_STATUS_LABEL } from '@lab/shared'
import { api, apiErrorMessage, formatDate, formatDateTime } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, Card, Spinner, useToast } from '../ui'
import { Icon, type IconName } from '../ui/icons'
import { ReportStatusBadge } from './reports/ReportStatusBadge'
import { deadlineSourceLabel, formatDeadlineShort, isPastDeadline } from './reports/deadline'

function countdownText(deadlineIso?: string | null): string {
  if (!deadlineIso) return '—'
  const diff = new Date(deadlineIso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const days = Math.floor(abs / 86400000)
  const hours = Math.floor((abs % 86400000) / 3600000)
  const body = days > 0 ? days + ' 天 ' + hours + ' 小时' : hours > 0 ? hours + ' 小时' : Math.max(1, Math.floor(abs / 60000)) + ' 分钟'
  return diff >= 0 ? body : '已逾期 ' + body
}

export default function HomePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user, isAdmin } = useAuth()
  const [summary, setSummary] = useState<ReportSummaryDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setSummary(await api<ReportSummaryDTO>('/api/reports/summary'))
    } catch (err) {
      toast.push('加载工作台失败：' + apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const createThisWeek = async () => {
    setCreating(true)
    try {
      const created = await api<ReportDTO>('/api/reports', { method: 'POST', body: {} })
      toast.push('已创建本周周报草稿', 'success')
      navigate('/reports/' + created.id)
    } catch (err) {
      toast.push('创建周报失败：' + apiErrorMessage(err), 'error')
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <Spinner />

  const mine = summary?.mine ?? null
  const deadline = summary?.deadline ?? null
  const overdue =
    summary?.isOverdue ??
    (deadline ? isPastDeadline(deadline) && (!summary?.mine || summary.mine.status === 'DRAFT' || summary.mine.status === 'REJECTED') : false)
  const missing = summary?.admin?.missing ?? []
  const pendingReview = summary?.admin?.pendingReview ?? 0
  const statusText = mine ? REPORT_STATUS_LABEL[mine.status] : '未写'
  const needsWork = !mine || mine.status === 'DRAFT' || mine.status === 'REJECTED'

  const quickLinks: Array<{ to: string; label: string; hint: string; icon: IconName; accent: string; admin?: boolean }> = [
    { to: '/reports', label: '我的周报', hint: '查看与撰写', icon: 'file', accent: 'violet' },
    { to: '/assets', label: '资产台账', hint: '固定资产明细', icon: 'layers', accent: 'teal' },
    { to: '/reviews', label: '周报审阅', hint: '通过或退回', icon: 'checkSquare', accent: 'amber', admin: true },
    { to: '/admin/users', label: '用户与权限', hint: '审批与角色', icon: 'users', accent: 'cyan', admin: true },
    { to: '/admin/templates', label: '模版与截止', hint: '模版 / 截止时间', icon: 'sliders', accent: 'rose', admin: true }
  ]

  return (
    <>
      <section className="hero">
        <div className="hero-main">
          <span className="hero-eyebrow">
            {summary?.week ?? '-'} · {mine ? formatDate(mine.periodStart) + ' ~ ' + formatDate(mine.periodEnd) : '周一 00:00 ~ 周日 23:59'}
          </span>
          <h1>你好，{user?.name ?? ''}</h1>
          <p className="hero-sub">
            本周周报
            <strong className={needsWork ? 'hero-strong-warn' : 'hero-strong-ok'}>{statusText}</strong>
            ，截止 {formatDeadlineShort(deadline?.deadline)}
            <span className="hero-sub-dim">（{deadline ? deadlineSourceLabel(deadline) : '规则：周日 18:00'}）</span>
          </p>
          <div className="hero-actions">
            {mine ? (
              <Button variant="primary" onClick={() => navigate('/reports/' + mine.id)}>
                {needsWork ? '继续处理本周周报' : '查看本周周报'}
                <Icon name="arrowRight" size={15} />
              </Button>
            ) : (
              <Button variant="primary" loading={creating} onClick={() => void createThisWeek()}>
                新建本周周报
                <Icon name="plus" size={15} />
              </Button>
            )}
            <Button className="btn-on-dark" onClick={() => navigate('/reports')}>
              我的周报
            </Button>
          </div>
        </div>

        <div className="hero-side">
          <div className={overdue ? 'hero-clock hero-clock-danger' : 'hero-clock'}>
            <span className="hero-clock-label">{overdue ? '已逾期' : '距离截止'}</span>
            <strong className="hero-clock-value">{overdue ? countdownText(deadline?.deadline).replace('已逾期 ', '') : countdownText(deadline?.deadline)}</strong>
            <span className="hero-clock-foot">{formatDeadlineShort(deadline?.deadline)} 截止</span>
          </div>
          {isAdmin ? (
            <div className="hero-side-row">
              <span className="hero-side-num">{missing.length}</span>
              <span className="hero-side-label">本周未交</span>
              <span className="hero-side-dot" />
              <span className="hero-side-num">{pendingReview}</span>
              <span className="hero-side-label">待审阅</span>
            </div>
          ) : null}
        </div>
      </section>

      {overdue ? (
        <div className="notice notice-danger">
          <Icon name="alert" size={16} />
          <span>本周周报还没提交（截止 {formatDeadlineShort(deadline?.deadline)}）。逾期仍可提交，但会被标记为「迟交」。</span>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat">
          <span className="icon-chip icon-chip-violet">
            <Icon name="file" size={17} />
          </span>
          <div className="stat-label">本周周报</div>
          <div className={needsWork ? 'stat-value danger' : 'stat-value'}>{statusText}</div>
          <div className="stat-hint">{mine ? '最后更新 ' + formatDateTime(mine.updatedAt) : '尚未创建本周周报'}</div>
        </div>
        <div className="stat">
          <span className="icon-chip icon-chip-blue">
            <Icon name="calendar" size={17} />
          </span>
          <div className="stat-label">周报周期</div>
          <div className="stat-value stat-value-sm">{summary?.week ?? '-'}</div>
          <div className="stat-hint">{mine ? formatDate(mine.periodStart) + ' ~ ' + formatDate(mine.periodEnd) : '周一 00:00 ~ 周日 23:59'}</div>
        </div>
        <div className="stat">
          <span className={needsWork ? 'icon-chip icon-chip-amber' : 'icon-chip icon-chip-teal'}>
            <Icon name="checkSquare" size={17} />
          </span>
          <div className="stat-label">审阅状态</div>
          <div className="stat-value stat-value-sm">
            {mine ? (mine.status === 'APPROVED' ? '已通过' : mine.status === 'SUBMITTED' ? '等待审阅' : mine.status === 'REJECTED' ? '被退回' : '未提交') : '未开始'}
          </div>
          <div className="stat-hint">
            {mine?.reviewerName ? '审阅人 ' + mine.reviewerName : '提交后由管理员审阅'}
            {mine?.late ? ' · 迟交' : ''}
          </div>
        </div>
      </div>

      {mine && mine.status === 'REJECTED' ? (
        <Card title={<span className="card-title-with-icon"><Icon name="alert" size={15} />本周周报被退回</span>} extra={<ReportStatusBadge status={mine.status} />}>
          <p className="muted">{mine.reviewComment || '管理员未填写退回意见'}</p>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <Button variant="primary" onClick={() => navigate('/reports/' + mine.id)}>
              去修改并重新提交
            </Button>
          </div>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card
          title={<span className="card-title-with-icon"><Icon name="clipboard" size={15} />管理员待办</span>}
          extra={
            <Button className="btn-sm" onClick={() => navigate('/reviews')}>
              去审阅
            </Button>
          }
        >
          <div className="stat-grid">
            <div className="stat">
              <span className="icon-chip icon-chip-amber">
                <Icon name="checkSquare" size={17} />
              </span>
              <div className="stat-label">待审阅</div>
              <div className={pendingReview > 0 ? 'stat-value danger' : 'stat-value'}>{pendingReview}</div>
              <div className="stat-hint">已提交、等待审阅的周报</div>
            </div>
            <div className="stat">
              <span className="icon-chip icon-chip-rose">
                <Icon name="alert" size={17} />
              </span>
              <div className="stat-label">本周未交</div>
              <div className={missing.length > 0 ? 'stat-value danger' : 'stat-value'}>{missing.length}</div>
              <div className="stat-hint">已激活成员中还没提交本周周报的人数</div>
            </div>
          </div>

          {missing.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              本周所有成员都已提交周报。
            </p>
          ) : (
            <ul className="todo-list">
              {missing.map((member) => (
                <li className="todo-row" key={member.id}>
                  <span className="avatar avatar-sm">{member.name.slice(0, 1)}</span>
                  <span className="todo-name">{member.name}</span>
                  <span className="todo-phone">{member.phone}</span>
                  <Badge tone="danger">未交</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title={<span className="card-title-with-icon"><Icon name="sparkles" size={15} />快捷入口</span>}>
        <div className="quick-grid">
          {quickLinks
            .filter((item) => !item.admin || isAdmin)
            .map((item) => (
              <button key={item.to} className="quick-item" onClick={() => navigate(item.to)}>
                <span className={'quick-icon nav-icon-' + item.accent}>
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="quick-text">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                <Icon name="arrowRight" size={14} className="quick-arrow" />
              </button>
            ))}
        </div>
      </Card>
    </>
  )
}
