import { useState } from 'react'
import type { ReportTemplateDTO } from '@yeyu/shared'
import { formatDateTime } from '../../../api/client'
import { Badge, Button, Card, EmptyState, Modal, Spinner } from '../../../ui'

interface TemplateListCardProps {
  templates: ReportTemplateDTO[]
  loading: boolean
  onActivate(template: ReportTemplateDTO): Promise<void>
  onDelete(template: ReportTemplateDTO): Promise<void>
}

export function TemplateListCard({ templates, loading, onActivate, onDelete }: TemplateListCardProps) {
  const [preview, setPreview] = useState<ReportTemplateDTO | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ReportTemplateDTO | null>(null)
  const [busyId, setBusyId] = useState('')

  const run = async (template: ReportTemplateDTO, action: (template: ReportTemplateDTO) => Promise<void>) => {
    setBusyId(template.id)
    try {
      await action(template)
    } finally {
      setBusyId('')
    }
  }

  return (
    <Card
      title="周报模版"
      extra={<span className="muted">共 {templates.length} 个模版</span>}
    >
      {loading ? (
        <Spinner />
      ) : templates.length === 0 ? (
        <EmptyState title="还没有模版" description="上传 .docx / .md 模版后，周报编辑器会按小节逐节填写" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>小节数</th>
                <th>是否生效</th>
                <th>引用周报</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>{template.name}</td>
                  <td>{template.sections.length}</td>
                  <td>{template.isActive ? <Badge tone="success">生效中</Badge> : <Badge>未生效</Badge>}</td>
                  <td>{template.reportCount}</td>
                  <td>{formatDateTime(template.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      <Button className="btn-sm" onClick={() => setPreview(template)}>
                        预览
                      </Button>
                      <Button
                        className="btn-sm"
                        disabled={template.isActive || busyId === template.id}
                        onClick={() => void run(template, onActivate)}
                      >
                        设为生效
                      </Button>
                      <Button className="btn-sm" variant="danger" disabled={busyId === template.id} onClick={() => setPendingDelete(template)}>
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={preview !== null}
        title={'模版预览 · ' + (preview?.name ?? '')}
        width={720}
        onClose={() => setPreview(null)}
        footer={<Button onClick={() => setPreview(null)}>关闭</Button>}
      >
        {preview ? (
          <>
            <p className="muted">
              共 {preview.sections.length} 个小节 · 来源 {preview.sourceName ?? '未记录'} · {preview.sourceFormat === 'docx' ? 'Word 文档' : 'Markdown'}
            </p>
            {(preview.sections ?? []).map((section, index) => (
              <div key={section.key}>
                <p>
                  {index + 1}. {section.title}
                </p>
                {section.hint ? <p className="muted">提示：{section.hint}</p> : <p className="muted">（无提示文字）</p>}
              </div>
            ))}
          </>
        ) : null}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        title="删除模版"
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>取消</Button>
            <Button
              variant="danger"
              loading={busyId === (pendingDelete?.id ?? '')}
              onClick={() => {
                const target = pendingDelete
                setPendingDelete(null)
                if (target) void run(target, onDelete)
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p>
          确定删除模版「{pendingDelete?.name ?? ''}」吗？被 {pendingDelete?.reportCount ?? 0} 份周报引用；历史周报仍可通过提交快照正常展示。
        </p>
      </Modal>
    </Card>
  )
}
