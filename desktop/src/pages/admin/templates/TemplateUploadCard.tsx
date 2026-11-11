import { useState } from 'react'
import type { ReportTemplateDTO } from '@lab/shared'
import { apiErrorMessage, apiForm } from '../../../api/client'
import { Button, Card, Field, Input, useToast } from '../../../ui'

/** 上传模版：multipart（file + 可选 name + activate）→ 后端解析小节后返回 201 */
export function TemplateUploadCard({ onCreated }: { onCreated(template: ReportTemplateDTO): void }) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [name, setName] = useState('')
  const [activate, setActivate] = useState(true)
  const [uploading, setUploading] = useState(false)

  const upload = async () => {
    if (!file) {
      toast.push('请先选择 .docx 或 .md 模版文件', 'error')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const trimmed = name.trim()
      if (trimmed) form.append('name', trimmed)
      form.append('activate', activate ? '1' : '0')
      const created = await apiForm<ReportTemplateDTO>('/api/templates', form)
      toast.push('模版已上传，解析出 ' + String(created.sections.length) + ' 个小节', 'success')
      setFile(null)
      setName('')
      setFileKey((prev) => prev + 1)
      onCreated(created)
    } catch (err) {
      toast.push('上传失败：' + apiErrorMessage(err), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card title="上传周报模版">
      <div className="form-grid">
        <div className="span-2">
          <Field label="模版文件" hint="支持 .docx / .md / .markdown；按 Word 标题 1/2/3 样式或 Markdown 的 ## 标题识别小节">
            <Input
              key={fileKey}
              type="file"
              accept=".docx,.md,.markdown"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        <Field label="模版名称" hint="留空时使用文件名">
          <Input value={name} maxLength={64} placeholder="例如：研究生周报模版 v2" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="生效设置">
          <label className="field-label">
            <input type="checkbox" checked={activate} onChange={(event) => setActivate(event.target.checked)} /> 立即设为生效模版
          </label>
        </Field>
        <div className="span-2">
          <div className="toolbar">
            <Button variant="primary" loading={uploading} onClick={() => void upload()}>
              上传并解析
            </Button>
            <span className="muted">{file ? '已选择：' + file.name : '尚未选择文件'}</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
