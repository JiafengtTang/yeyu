import { useState } from 'react'
import type { ReportCommentDTO } from '@yeyu/shared'
import { api, apiErrorMessage, formatDateTime } from '../../api/client'
import { Button, Card, Field, Textarea, useToast } from '../../ui'

interface CommentPanelProps {
  reportId: string
  comments: ReportCommentDTO[]
  onComment(comment: ReportCommentDTO): void
}

export function CommentPanel({ reportId, comments, onComment }: CommentPanelProps) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      const comment = await api<ReportCommentDTO>('/api/reports/' + reportId + '/comments', { method: 'POST', body: { body: text } })
      onComment(comment)
      setBody('')
      toast.push('评论已发表', 'success')
    } catch (err) {
      toast.push('评论失败：' + apiErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title={'评论（' + comments.length + '）'}>
      <div className="comment-list">
        {comments.length === 0 ? <p className="muted">还没有评论，可以就本周工作补充说明。</p> : null}
        {comments.map((comment) => (
          <div className="comment" key={comment.id}>
            <div className="comment-meta">
              {comment.authorName} · {formatDateTime(comment.createdAt)}
            </div>
            <div>{comment.body}</div>
          </div>
        ))}
        <Field label="添加评论">
          <Textarea value={body} maxLength={2000} rows={3} placeholder="补充说明或回应审核意见" onChange={(event) => setBody(event.target.value)} />
        </Field>
        <Button variant="primary" loading={saving} disabled={!body.trim()} onClick={() => void submit()}>
          发表评论
        </Button>
      </div>
    </Card>
  )
}
