import { useCallback, useEffect, useState } from 'react'
import {
  ASSET_CATEGORY_SUGGESTIONS,
  INVENTORY_CHECK_LABEL,
  INVENTORY_RESULT_LABEL,
  type InventoryBatchDTO,
  type InventoryCheckStatus,
  type InventoryItemDTO,
  type ListResult
} from '@lab/shared'
import { api, apiDownload, apiErrorMessage, formatDateTime } from '../../api/client'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useToast } from '../../ui'
import type { OwnerOption } from './shared'

const CHECK_ACTIONS: InventoryCheckStatus[] = ['PRESENT', 'MISSING', 'DAMAGED', 'UNKNOWN']

function resultTone(result: string): 'default' | 'success' | 'warning' | 'danger' {
  if (result === 'MATCH') return 'success'
  if (result === 'MISSING') return 'danger'
  if (result === 'MISMATCH') return 'warning'
  return 'default'
}

interface Props {
  isAdmin: boolean
  owners: OwnerOption[]
}

export function InventoryTab({ isAdmin, owners }: Props) {
  const toast = useToast()
  const [batches, setBatches] = useState<ListResult<InventoryBatchDTO> | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<InventoryBatchDTO | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<ListResult<InventoryBatchDTO>>('/api/inventory/batches', { query: { page } })
      setBatches(result)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [page, toast])

  useEffect(() => {
    void load()
  }, [load])

  async function openDetail(batchId: string): Promise<void> {
    setDetailLoading(true)
    try {
      const dto = await api<InventoryBatchDTO>('/api/inventory/batches/' + batchId)
      setDetail(dto)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  async function createBatch(): Promise<void> {
    if (!name.trim()) {
      toast.push('请填写盘点名称', 'error')
      return
    }
    setCreating(true)
    try {
      await api<InventoryBatchDTO>('/api/inventory/batches', {
        method: 'POST',
        body: { name: name.trim(), category: category || undefined, ownerId: ownerId || undefined }
      })
      toast.push('盘点批次已创建', 'success')
      setCreateOpen(false)
      setName('')
      setCategory('')
      setOwnerId('')
      setPage(1)
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setCreating(false)
    }
  }

  async function markItem(item: InventoryItemDTO, actualStatus: InventoryCheckStatus): Promise<void> {
    try {
      await api<InventoryItemDTO>('/api/inventory/items/' + item.id, { method: 'PATCH', body: { actualStatus } })
      await openDetail(item.batchId)
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }

  async function closeBatch(batchId: string): Promise<void> {
    try {
      await api<InventoryBatchDTO>('/api/inventory/batches/' + batchId + '/close', { method: 'POST', body: {} })
      toast.push('盘点批次已关闭', 'success')
      await openDetail(batchId)
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }

  function exportDiff(batchId: string): void {
    void apiDownload('/api/inventory/batches/' + batchId + '/export', '盘点差异.xlsx').catch((err) => {
      toast.push(apiErrorMessage(err), 'error')
    })
  }

  const totalPages = batches ? Math.max(1, Math.ceil(batches.total / batches.pageSize)) : 1

  return (
    <>
      <Card>
        <div className="toolbar">
          <span className="muted grow">按类别 / 责任人缩小范围后生成盘点批次，逐条核对差异。</span>
          {isAdmin ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              新建盘点批次
            </Button>
          ) : null}
        </div>
      </Card>
      {loading ? (
        <Card>
          <Spinner label="加载盘点批次…" />
        </Card>
      ) : !batches || batches.items.length === 0 ? (
        <Card>
          <EmptyState title="还没有盘点批次" description={isAdmin ? '新建批次开始一次盘点。' : '等待管理员发起盘点。'} />
        </Card>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>批次名称</th>
                  <th>创建人</th>
                  <th>创建时间</th>
                  <th>总数</th>
                  <th>已盘</th>
                  <th>异常</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {batches.items.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.name}</td>
                    <td>{batch.creatorName}</td>
                    <td>{formatDateTime(batch.createdAt)}</td>
                    <td className="num">{batch.total}</td>
                    <td className="num">{batch.checked}</td>
                    <td className="num">{batch.mismatched}</td>
                    <td>
                      {batch.closedAt ? <Badge tone="default">已关闭</Badge> : <Badge tone="info">进行中</Badge>}
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button className="btn-sm" variant="ghost" onClick={() => void openDetail(batch.id)}>
                          查看
                        </Button>
                        <Button className="btn-sm" variant="ghost" onClick={() => exportDiff(batch.id)}>
                          导出差异
                        </Button>
                        {isAdmin && !batch.closedAt ? (
                          <Button className="btn-sm" variant="ghost" onClick={() => void closeBatch(batch.id)}>
                            关闭
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>
              共 {batches.total} 个批次 · 第 {batches.page} / {totalPages} 页
            </span>
            <div className="table-actions">
              <Button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Button className="btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                下一页
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={createOpen}
        title="新建盘点批次"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button variant="primary" loading={creating} onClick={() => void createBatch()}>
              创建
            </Button>
          </>
        }
      >
        <Field label="批次名称" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 2026 年春季盘点" />
        </Field>
        <Field label="类别范围" hint="留空表示全部类别">
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">全部类别</option>
            {ASSET_CATEGORY_SUGGESTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="责任人范围" hint="留空表示全部责任人">
          <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">全部责任人</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>

      <Modal
        open={detail !== null || detailLoading}
        title={detail ? '盘点明细 · ' + detail.name : '盘点明细'}
        onClose={() => setDetail(null)}
        width={860}
        footer={
          detail ? (
            <>
              <Button onClick={() => exportDiff(detail.id)}>导出差异</Button>
              {isAdmin && !detail.closedAt ? (
                <Button variant="danger" onClick={() => void closeBatch(detail.id)}>
                  关闭批次
                </Button>
              ) : null}
              <Button onClick={() => setDetail(null)}>关闭</Button>
            </>
          ) : null
        }
      >
        {detailLoading || !detail ? (
          <Spinner label="加载明细…" />
        ) : (
          <>
            <p className="muted">
              共 {detail.total} 条 · 已盘 {detail.checked} · 异常 {detail.mismatched}
              {detail.closedAt ? ' · 已于 ' + formatDateTime(detail.closedAt) + ' 关闭' : ''}
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>资产编码</th>
                    <th>资产名称</th>
                    <th>预期状态</th>
                    <th>实际状态</th>
                    <th>结果</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items ?? []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.assetCode}</td>
                      <td>{item.assetName}</td>
                      <td>{item.expectedStatus}</td>
                      <td>{item.actualStatus ? INVENTORY_CHECK_LABEL[item.actualStatus] : '-'}</td>
                      <td>
                        <Badge tone={resultTone(item.result)}>{INVENTORY_RESULT_LABEL[item.result]}</Badge>
                      </td>
                      <td>
                        {isAdmin && !detail.closedAt ? (
                          <div className="table-actions">
                            {CHECK_ACTIONS.map((status) => (
                              <Button
                                key={status}
                                className="btn-sm"
                                variant="ghost"
                                onClick={() => void markItem(item, status)}
                              >
                                {INVENTORY_CHECK_LABEL[status]}
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
