import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABEL,
  type AssetAttachmentDTO,
  type AssetDTO,
  type AttachmentKind
} from '@yeyu/shared'
import { api, apiDownload, apiErrorMessage, apiForm, formatDateTime, mediaUrl } from '../../api/client'
import { Button, EmptyState, Modal, Select, Spinner, useToast } from '../../ui'

function isImage(mime: string): boolean {
  return mime.startsWith('image/')
}

interface Props {
  assetId: string
  initial: AssetAttachmentDTO[]
  canEdit: boolean
}

export function AssetAttachments({ assetId, initial, canEdit }: Props) {
  const toast = useToast()
  const [items, setItems] = useState<AssetAttachmentDTO[]>(initial)
  const [kind, setKind] = useState<AttachmentKind>('PHOTO')
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<AssetAttachmentDTO | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    const detail = await api<AssetDTO>('/api/assets/' + assetId)
    setItems(detail.attachments)
  }, [assetId])

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('kind', kind)
      form.append('file', file)
      await apiForm<AssetAttachmentDTO>('/api/assets/' + assetId + '/attachments', form)
      await refresh()
      toast.push('附件已上传', 'success')
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(attachment: AssetAttachmentDTO): Promise<void> {
    try {
      await api<{ ok: boolean }>('/api/assets/' + assetId + '/attachments/' + attachment.id, { method: 'DELETE' })
      await refresh()
      toast.push('附件已删除', 'success')
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }

  function openAttachment(attachment: AssetAttachmentDTO): void {
    if (isImage(attachment.media.mime)) {
      setPreview(attachment)
      return
    }
    void apiDownload('/api/media/' + attachment.media.id, attachment.media.filename).catch((err) => {
      toast.push(apiErrorMessage(err), 'error')
    })
  }

  return (
    <div className="field">
      <span className="field-label">附件（照片 / 发票 / 合同）</span>
      {canEdit ? (
        <div className="toolbar">
          <Select value={kind} onChange={(event) => setKind(event.target.value as AttachmentKind)} aria-label="附件类型">
            {ATTACHMENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {ATTACHMENT_KIND_LABEL[value]}
              </option>
            ))}
          </Select>
          <Button onClick={() => fileRef.current?.click()} loading={uploading}>
            {uploading ? '上传中…' : '上传附件'}
          </Button>
          <input ref={fileRef} type="file" hidden onChange={(event) => void handleFile(event)} />
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="暂无附件" description="支持图片与 PDF，单文件不超过 20MB。" />
      ) : (
        <div className="attachment-grid">
          {items.map((attachment) => (
            <div key={attachment.id} className="attachment">
              {isImage(attachment.media.mime) ? (
                <img
                  src={mediaUrl(attachment.media.id)}
                  alt={attachment.media.filename}
                  onClick={() => openAttachment(attachment)}
                />
              ) : (
                <div className="attachment-file" onClick={() => openAttachment(attachment)}>
                  {attachment.media.mime === 'application/pdf' ? 'PDF 文件' : '文件'}
                  <br />
                  {attachment.media.filename}
                </div>
              )}
              <div className="attachment-foot">
                <span>{ATTACHMENT_KIND_LABEL[attachment.kind]}</span>
                <span className="table-actions">
                  <button className="icon-btn" onClick={() => openAttachment(attachment)} title="打开">
                    打开
                  </button>
                  {canEdit ? (
                    <button className="icon-btn" onClick={() => void handleDelete(attachment)} title="删除附件">
                      删除
                    </button>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={preview !== null}
        title={preview?.media.filename ?? '附件预览'}
        onClose={() => setPreview(null)}
        width={720}
        footer={
          preview ? (
            <>
              <Button onClick={() => setPreview(null)}>关闭</Button>
              <Button
                variant="primary"
                onClick={() => {
                  void apiDownload('/api/media/' + preview.media.id, preview.media.filename).catch((err) => {
                    toast.push(apiErrorMessage(err), 'error')
                  })
                }}
              >
                下载
              </Button>
            </>
          ) : null
        }
      >
        {preview ? (
          <div>
            <img src={mediaUrl(preview.media.id)} alt={preview.media.filename} style={{ maxWidth: '100%' }} />
            <p className="muted">
              {ATTACHMENT_KIND_LABEL[preview.kind]} · {formatDateTime(preview.createdAt)}
            </p>
          </div>
        ) : (
          <Spinner />
        )}
      </Modal>
    </div>
  )
}
