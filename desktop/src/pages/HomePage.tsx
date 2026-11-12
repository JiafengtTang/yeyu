import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AssetDTO, ListResult, ReportDTO, ReportSummaryDTO } from '@lab/shared'
import { ASSET_STATUS_LABEL, REPORT_STATUS_LABEL } from '@lab/shared'
import { api, apiErrorMessage, formatDate, formatDateTime } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, Card, Spinner, useToast } from '../ui'
import { Icon, type IconName } from '../ui/icons'
import { ReportStatusBadge } from './reports/ReportStatusBadge'
import { deadlineSourceLabel, formatDeadlineShort, isPastDeadline } from './reports/deadline'

export default function HomePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user, isAdmin } = useAuth()
  const [summary, setSummary] = useState<ReportSummaryDTO | null>(null)
  const [assets, setAssets] = useState<AssetDTO[]>([])
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
    void (async () => {
      try {
        const page = await api<ListResult<AssetDTO>>('/api/assets', { query: { pageSize: 200, sortBy: 'updatedAt', sortDir: 'desc' } })
        setAssets(page.items)
      } catch {
        setAssets([])
      }
    })()
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

  const assetTotal = assets.length
  const assetAmount = assets.reduce((sum, item) => sum + (item.amount ?? (item.unitPrice ?? 0) * (item.quantity ?? 1)), 0)
  const assetStatus = (['IN_USE', 'IDLE', 'BORROWED', 'REPAIR', 'SCRAPPED'] as const)
    .map((status) => ({ status, label: ASSET_STATUS_LABEL[status], count: assets.filter((item) => item.status === status).length }))
    .filter((row) => row.count > 0)
  const links: Array<{ to: string; label: string; icon: IconName; admin?: boolean }> = [
    { to: '/reports', label: '我的周报', icon: 'file' },
    { to: '/assets', label: '资产台账', icon: 'layers' },
    { to: '/reviews', label: '周报审阅', icon: 'checkSquare', admin: true },
    { to: '/admin/users', label: '用户与权限', icon: 'users', admin: true },
    { to: '/admin/templates', label: '模版与截止', icon: 'sliders', admin: true }
  ]

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">你好，{user?.name ?? ''}</h1>
          <p className="page-sub">
            {summary?.week ?? '-'} · {mine ? formatDate(mine.periodStart) + ' ~ ' + formatDate(mine.periodEnd) : '周一 00:00 ~ 周日 23:59'} · 本周周报{' '}
            <b className={needsWork ? 'text-warn' : 'text-ok'}>{statusText}</b> · 截止 {formatDeadlineShort(deadline?.deadline)}
          </p>
        </div>
        <div className="page-actions">
          {mine ? (
            <Button variant="primary" onClick={() => navigate('/reports/' + mine.id)}>
              {needsWork ? '继续处理' : '查看周报'}
            </Button>
          ) : (
            <Button variant="primary" loading={creating} onClick={() => void createThisWeek()}>
              新建本周周报
            </Button>
          )}
        </div>
      </header>

      {overdue ? (
        <div className="notice notice-danger">
          <Icon name="alert" size={15} />
          <span>本周周报还没提交（截止 {formatDeadlineShort(deadline?.deadline)}）。逾期仍可提交，但会标记为「迟交」。</span>
        </div>
      ) : null}

      <div className="home-grid">
        <div className="home-main">
          <Card
            title="本周周报"
            extra={<ReportStatusBadge status={mine?.status ?? 'DRAFT'} late={mine?.late ?? false} />}
          >
            <dl className="kv">
              <div>
                <dt>截止时间</dt>
                <dd>
                  {formatDeadlineShort(deadline?.deadline)}
                  <span className="kv-dim">（{deadline ? deadlineSourceLabel(deadline) : '规则：周日 18:00'}）</span>
                </dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>{statusText}{mine?.late ? '（迟交）' : ''}</dd>
              </div>
              <div>
                <dt>最后更新</dt>
                <dd>{mine ? formatDateTime(mine.updatedAt) : '尚未创建'}</dd>
              </div>
              <div>
                <dt>审阅人</dt>
                <dd>{mine?.reviewerName ?? '提交后由管理员审阅'}</dd>
              </div>
            </dl>
            {mine?.status === 'REJECTED' ? (
              <p className="notice notice-danger" style={{ marginTop: 12 }}>
                被退回：{mine.reviewComment || '管理员未填写退回意见'}
              </p>
            ) : null}
          </Card>

          <Card
            title="资产概览"
            extra={
              <Button className="btn-sm btn-ghost" onClick={() => navigate('/assets')}>
                查看台账 →
              </Button>
            }
          >
            <div className="inline-stats">
              <div className="inline-stat">
                <span className="inline-stat-num">{assetTotal}</span>
                <span className="inline-stat-label">在册资产</span>
              </div>
              <div className="inline-stat">
                <span className="inline-stat-num">¥{assetAmount.toLocaleString('zh-CN')}</span>
                <span className="inline-stat-label">资产总额</span>
              </div>
            </div>
            {assetStatus.length > 0 ? (
              <>
                <div className="bar-row">
                  {assetStatus.map((row) => (
                    <span
                      key={row.status}
                      className={'bar-seg bar-' + row.status.toLowerCase()}
                      style={{ width: (row.count / Math.max(1, assetTotal)) * 100 + '%' }}
                      title={row.label + ' ' + row.count}
                    />
                  ))}
                </div>
                <div className="bar-legend">
                  {assetStatus.map((row) => (
                    <span key={row.status}>
                      <i className={'bar-dot bar-' + row.status.toLowerCase()} />
                      {row.label} {row.count}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted" style={{ marginTop: 10 }}>
                还没有录入资产。
              </p>
            )}
          </Card>

          {isAdmin ? (
            <Card
              title="管理员待办"
              extra={
                <Button className="btn-sm btn-ghost" onClick={() => navigate('/reviews')}>
                  去审阅 →
                </Button>
              }
            >
              <div className="inline-stats">
                <button className="inline-stat" onClick={() => navigate('/reviews')}>
                  <span className="inline-stat-num">{pendingReview}</span>
                  <span className="inline-stat-label">待审阅</span>
                </button>
                <div className="inline-stat">
                  <span className={missing.length > 0 ? 'inline-stat-num text-warn' : 'inline-stat-num'}>{missing.length}</span>
                  <span className="inline-stat-label">本周未交</span>
                </div>
              </div>
              {missing.length > 0 ? (
                <ul className="plain-list">
                  {missing.map((member) => (
                    <li key={member.id}>
                      <span className="avatar avatar-sm">{member.name.slice(0, 1)}</span>
                      <span className="plain-name">{member.name}</span>
                      <span className="plain-dim">{member.phone}</span>
                      <Badge tone="danger">未交</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ marginTop: 10 }}>
                  本周所有成员都已提交。
                </p>
              )}
            </Card>
          ) : null}
        </div>

        <aside className="home-aside">
          {isAdmin ? (
            <Card title="本周进度">
              <div className="progress-line">
                <span className="progress-num">{missing.length === 0 ? '全员已交' : String(missing.length) + ' 人未交'}</span>
                <span className="progress-sub">{pendingReview} 份待审阅</span>
              </div>
              <dl className="kv kv-tight">
                <div>
                  <dt>截止</dt>
                  <dd>{formatDeadlineShort(deadline?.deadline)}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>{deadline ? deadlineSourceLabel(deadline) : '规则'}</dd>
                </div>
              </dl>
            </Card>
          ) : null}
          <Card title="快捷入口">
            <div className="link-list">
              {links
                .filter((item) => !item.admin || isAdmin)
                .map((item) => (
                  <button key={item.to} className="link-row" onClick={() => navigate(item.to)}>
                    <Icon name={item.icon} size={15} />
                    <span>{item.label}</span>
                    <Icon name="arrowRight" size={13} className="link-arrow" />
                  </button>
                ))}
            </div>
          </Card>
        </aside>
      </div>
    </>
  )
}
