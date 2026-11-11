import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReportDTO, ReportSummaryDTO } from '@lab/shared'
import { REPORT_STATUS_LABEL } from '@lab/shared'
import { api, apiErrorMessage, formatDate, formatDateTime } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, Card, Spinner, useToast } from '../ui'
import { ReportStatusBadge } from './reports/ReportStatusBadge'
import { deadlineSourceLabel, formatDeadlineShort, isPastDeadline } from './reports/deadline'

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
  const overdue = summary?.isOverdue ?? (deadline ? isPastDeadline(deadline) && (!summary?.mine || summary.mine.status === 'DRAFT' || summary.mine.status === 'REJECTED') : false)
  const missing = summary?.admin?.missing ?? []
  const pendingReview = summary?.admin?.pendingReview ?? 0
  const statusText = mine ? REPORT_STATUS_LABEL[mine.status] : '未写'

  return (
    <>
      <div className="page-head">
        <div>
          <h2>你好，{user?.name ?? ''}</h2>
          <p className="muted">本周（{summary?.week ?? '-'}）周报状态与课题组待办</p>
        </div>
        <div className="toolbar">
          {mine ? (
            <Button variant="primary" onClick={() => navigate('/reports/' + mine.id)}>
              继续处理本周周报
            </Button>
          ) : (
            <Button variant="primary" loading={creating} onClick={() => void createThisWeek()}>
              新建本周周报
            </Button>
          )}
          <Button onClick={() => navigate('/reports')}>我的周报</Button>
        </div>
      </div>

      <p className={overdue ? 'field-error' : 'muted'}>
        本周截止 {formatDeadlineShort(deadline?.deadline)}（{deadline ? deadlineSourceLabel(deadline) : '规则：周日 18:00'}）
      </p>

      {overdue ? (
        <div className="offline-banner">
          <Badge tone="danger">已逾期</Badge>
          <span> 本周周报还没提交（截止时间：{formatDeadlineShort(deadline?.deadline)}），请尽快补交。</span>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">本周周报</div>
          <div className={statusText === '未写' || mine?.status === 'REJECTED' ? 'stat-value danger' : 'stat-value'}>{statusText}</div>
          <div className="stat-hint">{mine ? '最后更新 ' + formatDateTime(mine.updatedAt) : '尚未创建本周周报'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">周报周期</div>
          <div className="stat-value">{summary?.week ?? '-'}</div>
          <div className="stat-hint">{mine ? formatDate(mine.periodStart) + ' ~ ' + formatDate(mine.periodEnd) : '周一 00:00 ~ 周日 23:59'}</div>
        </div>
        {mine ? (
          <div className="stat">
            <div className="stat-label">审阅状态</div>
            <div className="stat-value">
              {mine.status === 'APPROVED' ? '已通过' : mine.status === 'SUBMITTED' ? '等待审阅' : '未提交'}
            </div>
            <div className="stat-hint">{mine.reviewerName ? '审阅人 ' + mine.reviewerName : '提交后由管理员审阅'}</div>
          </div>
        ) : null}
      </div>

      {mine && mine.status === 'REJECTED' ? (
        <Card title="本周周报被退回" extra={<ReportStatusBadge status={mine.status} />}>
          <p className="muted">{mine.reviewComment || '管理员未填写退回意见'}</p>
          <div className="toolbar">
            <Button variant="primary" onClick={() => navigate('/reports/' + mine.id)}>
              去修改并重新提交
            </Button>
          </div>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card
          title="管理员待办"
          extra={
            <Button className="btn-sm" onClick={() => navigate('/reviews')}>
              去审阅
            </Button>
          }
        >
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">待审阅</div>
              <div className={pendingReview > 0 ? 'stat-value danger' : 'stat-value'}>{pendingReview}</div>
              <div className="stat-hint">已提交、等待审阅的周报</div>
            </div>
            <div className="stat">
              <div className="stat-label">本周未交</div>
              <div className={missing.length > 0 ? 'stat-value danger' : 'stat-value'}>{missing.length}</div>
              <div className="stat-hint">已激活成员中还没提交本周周报的人数</div>
            </div>
          </div>
          {missing.length === 0 ? (
            <p className="muted">本周所有成员都已提交周报。</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>手机号</th>
                    <th>本周状态</th>
                  </tr>
                </thead>
                <tbody>
                  {missing.map((member) => (
                    <tr className="red-row" key={member.id}>
                      <td>{member.name}</td>
                      <td>{member.phone}</td>
                      <td>
                        <Badge tone="danger">未交</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      <Card title="快捷入口">
        <div className="toolbar">
          <Button onClick={() => navigate('/reports')}>我的周报</Button>
          <Button onClick={() => navigate('/assets')}>资产台账</Button>
          {isAdmin ? <Button onClick={() => navigate('/reviews')}>周报审阅</Button> : null}
          {isAdmin ? <Button onClick={() => navigate('/admin/users')}>用户与权限</Button> : null}
        </div>
      </Card>
    </>
  )
}
