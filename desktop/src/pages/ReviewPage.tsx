import { useCallback, useEffect, useState } from 'react'
import type { ListResult, ReportCommentDTO, ReportDTO, ReportStatus } from '@lab/shared'
import { REPORT_STATUS_LABEL } from '@lab/shared'
import { api, apiErrorMessage, formatDateTime } from '../api/client'
import { Badge, Button, Card, EmptyState, Field, Select, Spinner, Textarea, useToast } from '../ui'
import { CommentPanel } from './reports/CommentPanel'
import { ReportPreview } from './reports/ReportPreview'
import { ReportStatusBadge } from './reports/ReportStatusBadge'

const FILTER_STATUSES: ReportStatus[] = ['SUBMITTED', 'APPROVED', 'REJECTED']

export default function ReviewPage() {
  const toast = useToast()
  const [status, setStatus] = useState<ReportStatus>('SUBMITTED')
  const [items, setItems] = useState<ReportDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReportDTO | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<'APPROVED' | 'REJECTED' | null>(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<ListResult<ReportDTO>>('/api/reports', { query: { status, page: 1, pageSize: 50 } })
      setItems(result.items)
      setSelectedId((prev) => (prev && result.items.some((item) => item.id === prev) ? prev : result.items[0]?.id ?? null))
    } catch (err) {
      toast.push('加载周报列表失败：' + apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [status, toast])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    api<ReportDTO>('/api/reports/' + selectedId)
      .then((dto) => {
        if (!cancelled) setDetail(dto)
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.push('加载周报详情失败：' + apiErrorMessage(err), 'error')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, toast])

  const review = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!detail) return
    if (decision === 'REJECTED' && !comment.trim()) {
      toast.push('退回需要填写审核意见', 'error')
      return
    }
    setBusy(decision)
    try {
      const updated = await api<ReportDTO>('/api/reports/' + detail.id + '/review', {
        method: 'POST',
        body: { decision, comment: comment.trim() || undefined }
      })
      setDetail(updated)
      setComment('')
      toast.push(decision === 'APPROVED' ? '已通过该周报' : '已退回该周报', 'success')
      await loadList()
    } catch (err) {
      toast.push('审阅失败：' + apiErrorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const onComment = (created: ReportCommentDTO) => {
    setDetail((prev) => (prev ? { ...prev, comments: [...prev.comments, created] } : prev))
  }

  const pending = status === 'SUBMITTED'

  return (
    <>
      <div className="page-head">
        <div>
          <h2>周报审阅</h2>
          <p className="muted">通过或退回成员提交的周报，退回时必须填写审核意见</p>
        </div>
        <div className="toolbar">
          <Field label="按状态筛选">
            <Select value={status} onChange={(event) => setStatus(event.target.value as ReportStatus)}>
              {FILTER_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {REPORT_STATUS_LABEL[item]}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => void loadList()}>刷新</Button>
        </div>
      </div>

      <Card title={'周报列表（' + items.length + '）'}>
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title={pending ? '没有待审阅的周报' : '该状态下没有周报'} description={pending ? '成员提交后会出现在这里' : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>周次</th>
                  <th>作者</th>
                  <th>标题</th>
                  <th>状态</th>
                  <th>提交时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.id === selectedId ? 'red-row' : undefined}>
                    <td>{item.week}</td>
                    <td>{item.authorName}</td>
                    <td>{item.title || <span className="muted">未填写标题</span>}</td>
                    <td>
                      <ReportStatusBadge status={item.status} late={item.late === true} />
                    </td>
                    <td>{formatDateTime(item.submittedAt)}</td>
                    <td>
                      <div className="table-actions">
                        <Button className="btn-sm" onClick={() => setSelectedId(item.id)}>
                          {item.id === selectedId ? '当前预览' : '预览'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detailLoading ? (
        <Spinner />
      ) : detail ? (
        <div className="split">
          <Card
            title={detail.title || '周报 ' + detail.week}
            extra={<ReportStatusBadge status={detail.status} late={detail.late === true} />}
          >
            <p className="muted">
              {detail.authorName} · {detail.week} · 提交于 {formatDateTime(detail.submittedAt)}
            </p>
            {detail.reviewedAt ? (
              <p className="muted">
                上次审阅：{detail.reviewerName ?? '-'} · {formatDateTime(detail.reviewedAt)}
                {detail.reviewComment ? ' · ' + detail.reviewComment : ''}
              </p>
            ) : null}
            <ReportPreview html={detail.contentHtml} />
          </Card>

          <Card title="审阅操作">
            <div className="form-grid">
              <div className="span-2">
                <Field label="审核意见" hint={detail.status === 'SUBMITTED' ? '退回时必填，通过时可选' : '该周报已审阅完成'}>
                  <Textarea
                    value={comment}
                    rows={4}
                    maxLength={2000}
                    disabled={detail.status !== 'SUBMITTED'}
                    placeholder="写清楚需要修改的地方，作者会看到这条意见"
                    onChange={(event) => setComment(event.target.value)}
                  />
                </Field>
              </div>
              <div className="span-2">
                <div className="toolbar">
                  <Button
                    variant="primary"
                    loading={busy === 'APPROVED'}
                    disabled={detail.status !== 'SUBMITTED' || busy !== null}
                    onClick={() => void review('APPROVED')}
                  >
                    通过
                  </Button>
                  <Button
                    variant="danger"
                    loading={busy === 'REJECTED'}
                    disabled={detail.status !== 'SUBMITTED' || busy !== null}
                    onClick={() => void review('REJECTED')}
                  >
                    退回
                  </Button>
                  {detail.status !== 'SUBMITTED' ? <Badge tone="info">已处理</Badge> : null}
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Card title="周报正文">
          <p className="muted">请先在上方列表中选择一份周报。</p>
        </Card>
      )}

      {detail ? <CommentPanel reportId={detail.id} comments={detail.comments} onComment={onComment} /> : null}
    </>
  )
}
