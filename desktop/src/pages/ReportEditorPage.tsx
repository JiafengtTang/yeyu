import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DeadlineDTO, ReportCommentDTO, ReportDTO, ReportSectionDTO, ReportTemplateDTO } from '@yeyu/shared'
import { REPORT_EDITABLE_STATUSES } from '@yeyu/shared'
import { ApiError, api, apiDownload, apiErrorMessage, formatDateTime } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, Card, Field, Input, Modal, Spinner, useToast } from '../ui'
import { CommentPanel } from './reports/CommentPanel'
import { ReportPreview } from './reports/ReportPreview'
import { ReportStatusBadge } from './reports/ReportStatusBadge'
import { RichEditor } from './reports/RichEditor'
import { SectionedEditor, composeSectionsHtml } from './reports/SectionedEditor'
import { deadlineSourceLabel, isPastDeadline } from './reports/deadline'
import { buildPrintHtml } from './reports/printHtml'
import { isBlankHtml, toDisplayHtml, toStorageHtml } from './reports/mediaHtml'

/** legacy：旧版单富文本；sectioned：按模版小节逐节填写 */
type EditorMode = 'legacy' | 'sectioned'

interface Draft {
  title: string
  html: string
  sections: ReportSectionDTO[]
}

function sameDraft(left: Draft, right: Draft): boolean {
  return left.title === right.title && left.html === right.html && JSON.stringify(left.sections) === JSON.stringify(right.sections)
}

export default function ReportEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [report, setReport] = useState<ReportDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<EditorMode>('legacy')
  const [title, setTitle] = useState('')
  const [html, setHtml] = useState('')
  const [sections, setSections] = useState<ReportSectionDTO[]>([])
  const [template, setTemplate] = useState<ReportTemplateDTO | null>(null)
  const [deadline, setDeadline] = useState<DeadlineDTO | null>(null)
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportingWord, setExportingWord] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const draftRef = useRef<Draft>({ title: '', html: '', sections: [] })
  const savedRef = useRef<Draft>({ title: '', html: '', sections: [] })
  draftRef.current = { title, html, sections }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    const load = async () => {
      try {
        const dto = await api<ReportDTO>('/api/reports/' + id)
        if (cancelled) return
        // 模版/截止接口可能尚未上线：失败时退回旧版单富文本编辑
        const [activeTemplate, currentDeadline] = await Promise.all([
          api<ReportTemplateDTO | null>('/api/templates/active').catch(() => null),
          api<DeadlineDTO>('/api/settings/report-deadline', { query: { week: dto.week } }).catch(() => null)
        ])
        if (cancelled) return
        const savedSections: ReportSectionDTO[] = (dto.sections ?? []).map((section) => ({
          ...section,
          contentHtml: toDisplayHtml(section.contentHtml ?? '')
        }))
        const displayHtml = toDisplayHtml(dto.contentHtml ?? '')
        const hasLegacyBody = !isBlankHtml(dto.contentHtml ?? '')
        let nextMode: EditorMode = 'legacy'
        let nextSections: ReportSectionDTO[] = []
        if (savedSections.length > 0) {
          nextMode = 'sectioned'
          nextSections = savedSections
        } else if (activeTemplate !== null && activeTemplate.sections.length > 0 && !hasLegacyBody) {
          nextMode = 'sectioned'
          nextSections = activeTemplate.sections.map((section) => ({
            key: section.key,
            title: section.title,
            hint: section.hint,
            contentHtml: ''
          }))
        }
        setReport(dto)
        setTemplate(activeTemplate)
        setDeadline(currentDeadline)
        setMode(nextMode)
        setTitle(dto.title)
        setHtml(displayHtml)
        setSections(nextSections)
        setSectionErrors({})
        savedRef.current = { title: dto.title, html: displayHtml, sections: nextSections }
        setDirty(false)
      } catch (err) {
        if (!cancelled) toast.push('加载周报失败：' + apiErrorMessage(err), 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, toast])

  const canEdit = report !== null && user !== null && report.authorId === user.id && REPORT_EDITABLE_STATUSES.includes(report.status)

  useEffect(() => {
    setDirty(!sameDraft({ title, html, sections }, savedRef.current))
  }, [title, html, sections])

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!report || !canEdit) return false
    const snapshot = draftRef.current
    setSaving(true)
    setSaveError('')
    try {
      const body: Record<string, unknown> = { title: snapshot.title }
      if (mode === 'sectioned') {
        body.sections = snapshot.sections.map((section) => ({
          key: section.key,
          title: section.title,
          contentHtml: toStorageHtml(section.contentHtml)
        }))
      } else {
        body.contentHtml = toStorageHtml(snapshot.html)
      }
      const updated = await api<ReportDTO>('/api/reports/' + report.id, { method: 'PATCH', body })
      setReport(updated)
      setSavedAt(new Date())
      savedRef.current = snapshot
      setDirty(!sameDraft(draftRef.current, snapshot))
      return true
    } catch (err) {
      setSaveError(apiErrorMessage(err))
      return false
    } finally {
      setSaving(false)
    }
  }, [report, canEdit, mode])

  useEffect(() => {
    if (!canEdit || !dirty) return
    const timer = window.setTimeout(() => {
      void saveNow()
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [canEdit, dirty, title, html, sections, saveNow])

  const onSectionChange = useCallback((key: string, value: string) => {
    setSections((prev) => prev.map((section) => (section.key === key ? { ...section, contentHtml: value } : section)))
    setSectionErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const submitReport = async () => {
    if (!report) return
    setSubmitting(true)
    try {
      const saved = await saveNow()
      if (!saved) {
        toast.push('草稿保存失败，请稍后重试', 'error')
        return
      }
      const updated = await api<ReportDTO>('/api/reports/' + report.id + '/submit', { method: 'POST' })
      setReport(updated)
      setDirty(false)
      setSectionErrors({})
      setConfirmOpen(false)
      toast.push(updated.late ? '周报已提交（迟交），等待管理员审阅' : '周报已提交，等待管理员审阅', 'success')
    } catch (err) {
      const message = apiErrorMessage(err)
      const missing = /《(.+?)》未填写/.exec(message)
      const target = missing ? sections.find((section) => section.title === missing[1]) : undefined
      if (target) {
        setSectionErrors({ [target.key]: message })
        setConfirmOpen(false)
      }
      toast.push('提交失败：' + message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const exportWord = async () => {
    if (!report) return
    setExportingWord(true)
    try {
      await apiDownload('/api/reports/' + report.id + '/export.docx', '周报-' + report.week + '.docx')
      toast.push('Word 已开始下载', 'success')
    } catch (err) {
      toast.push('导出 Word 失败：' + apiErrorMessage(err), 'error')
    } finally {
      setExportingWord(false)
    }
  }

  const exportPdf = async () => {
    if (!report) return
    const bridge = window.desktop
    if (!bridge || !bridge.printPdf) {
      toast.push('导出 PDF 需要在桌面客户端中使用', 'error')
      return
    }
    setExportingPdf(true)
    try {
      const result = await bridge.printPdf({ html: buildPrintHtml(report, toStorageHtml(previewHtml)), filename: '周报-' + report.week + '.pdf' })
      if (result.saved) toast.push('PDF 已保存' + (result.path ? '：' + result.path : ''), 'success')
      else toast.push('PDF 导出未完成' + (result.reason ? '：' + result.reason : ''), 'info')
    } catch (err) {
      toast.push('导出 PDF 失败：' + apiErrorMessage(err), 'error')
    } finally {
      setExportingPdf(false)
    }
  }

  const onHtmlChange = (value: string) => {
    setHtml(value)
  }

  const onComment = (comment: ReportCommentDTO) => {
    setReport((prev) => (prev ? { ...prev, comments: [...prev.comments, comment] } : prev))
  }

  if (loading) return <Spinner />

  if (!report) {
    return (
      <Card title="周报不存在">
        <p className="muted">该周报可能已被删除，或你没有查看权限。</p>
        <div className="toolbar">
          <Button onClick={() => navigate('/reports')}>返回列表</Button>
        </div>
      </Card>
    )
  }

  const previewHtml = mode === 'sectioned' ? composeSectionsHtml(sections) : html
  const deadlineOverdue = isPastDeadline(deadline)
  const late = report.late === true

  const saveLabel = saving
    ? '保存中…'
    : saveError
      ? '保存失败：' + saveError
      : dirty
        ? '有未保存修改，2 秒后自动保存'
        : savedAt
          ? '已保存 ' + formatDateTime(savedAt)
          : ''

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{report.title || '周报 ' + report.week}</h2>
          <p className="muted">
            {report.week} · {report.authorName} · 更新于 {formatDateTime(report.updatedAt)}
          </p>
        </div>
        <div className="toolbar">
          <Button onClick={() => navigate('/reports')}>返回列表</Button>
          <Button onClick={() => setPreviewOpen(true)}>预览</Button>
          <Button loading={exportingWord} onClick={() => void exportWord()}>
            导出 Word
          </Button>
          <Button loading={exportingPdf} onClick={() => void exportPdf()}>
            导出 PDF
          </Button>
          {canEdit ? (
            <Button variant="primary" loading={submitting} onClick={() => setConfirmOpen(true)}>
              提交周报
            </Button>
          ) : null}
        </div>
      </div>

      {deadline ? (
        <div className="offline-banner">
          <Badge tone={deadlineOverdue ? 'danger' : 'info'}>{deadlineOverdue ? '已过期' : '进行中'}</Badge>
          <span>
            {' '}
            本轮截止 {formatDateTime(deadline.deadline)}（{deadlineSourceLabel(deadline)}）
            {deadlineOverdue ? '，已过期，可迟交：提交后状态标记为「迟交」，不阻断提交。' : '，逾期提交会标记为「迟交」，不阻断提交。'}
          </span>
        </div>
      ) : null}

      {template && mode === 'sectioned' ? (
        <p className="muted">
          模版：{report.templateSnapshot?.name ?? template.name}（{sections.length} 个小节，逐节填写后提交；有未填写小节时无法提交）
        </p>
      ) : null}

      {report.status === 'REJECTED' ? (
        <div className="offline-banner">
          <Badge tone="danger">已退回</Badge>
          <span> {report.reviewComment || '管理员未填写退回意见，请补充内容后重新提交。'}</span>
        </div>
      ) : null}

      {!canEdit ? (
        <div className="offline-banner">
          <Badge tone="info">{report.status === 'SUBMITTED' ? '已提交' : '已通过'}</Badge>
          <span>
            {' '}
            {report.status === 'SUBMITTED'
              ? '周报已提交，等待管理员审阅；提交后不可修改。'
              : '周报已通过审阅，不可再修改；如需调整请联系管理员退回。'}
          </span>
        </div>
      ) : null}

      <div className="split">
        <Card title="周报内容" extra={<ReportStatusBadge status={report.status} late={late} />}>
          <div className="form-grid">
            <div className="span-2">
              <Field label="标题" hint="留空时导出使用「周报 + 周次」作为标题">
                <Input value={title} maxLength={120} disabled={!canEdit} placeholder="例如：第 46 周工作周报" onChange={(event) => setTitle(event.target.value)} />
              </Field>
            </div>
            {mode === 'sectioned' ? (
              <div className="span-2">
                <SectionedEditor sections={sections} editable={canEdit} errors={sectionErrors} onChange={onSectionChange} />
              </div>
            ) : (
              <div className="span-2">
                <RichEditor key={report.id} value={html} editable={canEdit} onChange={onHtmlChange} />
              </div>
            )}
            <div className="span-2">
              <span className="muted">{saveLabel}</span>
            </div>
          </div>
        </Card>
        <CommentPanel reportId={report.id} comments={report.comments} onComment={onComment} />
      </div>

      <Modal
        open={previewOpen}
        title="预览"
        width={880}
        onClose={() => setPreviewOpen(false)}
        footer={<Button onClick={() => setPreviewOpen(false)}>关闭</Button>}
      >
        <h3>{title.trim() || '周报 ' + report.week}</h3>
        <ReportPreview html={previewHtml} />
      </Modal>

      <Modal
        open={confirmOpen}
        title="提交周报"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button disabled={submitting} onClick={() => setConfirmOpen(false)}>
              再想想
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submitReport()}>
              确认提交
            </Button>
          </>
        }
      >
        <p>提交后正文将不能修改，需等待管理员审阅。若被退回，可再次编辑并重新提交。</p>
        {mode === 'sectioned' ? <p className="muted">当前模版共 {sections.length} 个小节，每个小节都必须填写才能提交。</p> : null}
        {deadlineOverdue ? <p className="field-error">已过本轮截止时间，本次提交将标记为「迟交」。</p> : null}
      </Modal>
    </>
  )
}
