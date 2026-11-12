import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ListResult, ReportDTO } from '@yeyu/shared'
import { REPORT_EDITABLE_STATUSES, REPORT_STATUSES, REPORT_STATUS_LABEL } from '@yeyu/shared'
import { api, apiDownload, apiErrorMessage, formatDateTime } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Card, EmptyState, Field, Select, Spinner, useToast } from '../ui'
import { ReportStatusBadge } from './reports/ReportStatusBadge'

type Tab = 'mine' | 'all'

const PAGE_SIZE = 20

export default function ReportsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user, isAdmin } = useAuth()
  const [tab, setTab] = useState<Tab>('mine')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListResult<ReportDTO> | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query: Record<string, unknown> = { page, pageSize: PAGE_SIZE }
      if (status) query.status = status
      if (tab === 'mine' && user) query.authorId = user.id
      setData(await api<ListResult<ReportDTO>>('/api/reports', { query }))
    } catch (err) {
      toast.push('加载周报失败：' + apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [page, status, tab, user, toast])

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

  const exportWord = async (item: ReportDTO) => {
    try {
      await apiDownload('/api/reports/' + item.id + '/export.docx', '周报-' + item.week + '.docx')
    } catch (err) {
      toast.push('导出失败：' + apiErrorMessage(err), 'error')
    }
  }

  const switchTab = (next: Tab) => {
    setTab(next)
    setPage(1)
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / (data?.pageSize ?? PAGE_SIZE)))

  return (
    <>
      <div className="page-head">
        <div>
          <h2>我的周报</h2>
          <p className="muted">一人一周一份，草稿自动保存，提交后由管理员审阅</p>
        </div>
        <div className="toolbar">
          <Button variant="primary" loading={creating} onClick={() => void createThisWeek()}>
            新建本周周报
          </Button>
        </div>
      </div>

      <div className="tabs">
        <button type="button" className={'tab' + (tab === 'mine' ? ' active' : '')} onClick={() => switchTab('mine')}>
          我的周报
        </button>
        {isAdmin ? (
          <button type="button" className={'tab' + (tab === 'all' ? ' active' : '')} onClick={() => switchTab('all')}>
            全组周报
          </button>
        ) : null}
      </div>

      <div className="toolbar">
        <Field label="状态筛选">
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
          >
            <option value="">全部状态</option>
            {REPORT_STATUSES.map((item) => (
              <option key={item} value={item}>
                {REPORT_STATUS_LABEL[item]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grow" />
        <span className="muted">共 {total} 条</span>
      </div>

      <Card>
        {loading ? (
          <Spinner />
        ) : total === 0 ? (
          <EmptyState
            title="还没有周报"
            description="点击「新建本周周报」开始记录本周工作"
            action={
              <Button variant="primary" loading={creating} onClick={() => void createThisWeek()}>
                新建本周周报
              </Button>
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>周次</th>
                    {tab === 'all' ? <th>作者</th> : null}
                    <th>标题</th>
                    <th>状态</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.week}</td>
                      {tab === 'all' ? <td>{item.authorName}</td> : null}
                      <td>{item.title || <span className="muted">未填写标题</span>}</td>
                      <td>
                        <ReportStatusBadge status={item.status} late={item.late === true} />
                      </td>
                      <td>{formatDateTime(item.updatedAt)}</td>
                      <td>
                        <div className="table-actions">
                          <Button className="btn-sm" onClick={() => navigate('/reports/' + item.id)}>
                            {REPORT_EDITABLE_STATUSES.includes(item.status) ? '继续编辑' : '查看'}
                          </Button>
                          <Button className="btn-sm" onClick={() => void exportWord(item)}>
                            导出 Word
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span>
                第 {data?.page ?? page} / {totalPages} 页
              </span>
              <div className="toolbar">
                <Button className="btn-sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                  上一页
                </Button>
                <Button className="btn-sm" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>
                  下一页
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  )
}
