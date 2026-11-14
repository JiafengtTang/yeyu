import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AssetDTO, ListResult } from '@yeyu/shared'
import { api, apiDownload, apiErrorMessage, apiForm } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Modal, useToast } from '../ui'
import { AssetAttachments } from './assets/AssetAttachments'
import { AssetFilters, EMPTY_FILTERS, type AssetFilterState } from './assets/AssetFilters'
import { AssetFormModal } from './assets/AssetFormModal'
import { AssetTable } from './assets/AssetTable'
import { AuditTab } from './assets/AuditTab'
import { BorrowModal } from './assets/BorrowModal'
import { InventoryTab } from './assets/InventoryTab'
import { canEditAsset, fetchGroups, fetchOwners, mergeOwners, type GroupOption, type OwnerOption } from './assets/shared'

const PAGE_SIZE = 20

interface ImportSummary {
  created: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

type TabKey = 'ledger' | 'inventory' | 'audit'

export default function AssetsPage() {
  const { user, isAdmin } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>('ledger')
  const [filters, setFilters] = useState<AssetFilterState>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListResult<AssetDTO> | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchedOwners, setFetchedOwners] = useState<OwnerOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AssetDTO | null>(null)
  const [attachmentsAsset, setAttachmentsAsset] = useState<AssetDTO | null>(null)
  const [borrowAsset, setBorrowAsset] = useState<AssetDTO | null>(null)
  const [deleting, setDeleting] = useState<AssetDTO | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportSummary | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<ListResult<AssetDTO>>('/api/assets', {
        query: {
          q: filters.q.trim(),
          category: filters.category,
          status: filters.status,
          ownerId: filters.ownerId,
          groupId: filters.groupId,
          page,
          pageSize: PAGE_SIZE
        }
      })
      setData(result)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [filters, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let alive = true
    void fetchOwners().then((list) => {
      if (alive) setFetchedOwners(list)
    })
    void fetchGroups().then((list) => {
      if (alive) setGroups(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const owners = useMemo<OwnerOption[]>(() => {
    const self: OwnerOption[] = user ? [{ id: user.id, name: user.name }] : []
    return mergeOwners(self, fetchedOwners)
  }, [user, fetchedOwners])

  const editable = useCallback((asset: AssetDTO) => canEditAsset(asset, user, isAdmin), [user, isAdmin])

  function changeFilters(next: AssetFilterState): void {
    setFilters(next)
    setPage(1)
  }

  function handleCreate(): void {
    setEditing(null)
    setFormOpen(true)
  }

  function handleEdit(asset: AssetDTO): void {
    if (!canEditAsset(asset, user, isAdmin)) {
      toast.push('仅责任人可修改', 'error')
      return
    }
    setEditing(asset)
    setFormOpen(true)
  }

  async function handleSaved(): Promise<void> {
    setFormOpen(false)
    setEditing(null)
    await load()
  }

  async function handleReturn(asset: AssetDTO): Promise<void> {
    try {
      await api('/api/assets/' + asset.id + '/return', { method: 'POST', body: {} })
      toast.push('资产已归还', 'success')
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await api('/api/assets/' + deleting.id, { method: 'DELETE' })
      toast.push('资产已删除', 'success')
      setDeleting(null)
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setDeletingBusy(false)
    }
  }

  function handleExport(): void {
    void apiDownload('/api/assets/export', '资产台账.xlsx', {
      q: filters.q.trim(),
      category: filters.category,
      status: filters.status,
      ownerId: filters.ownerId,
      groupId: filters.groupId
    }).catch((err) => {
      toast.push(apiErrorMessage(err), 'error')
    })
  }

  function handleDownloadTemplate(): void {
    void apiDownload('/api/assets/template', '资产导入模板.xlsx').catch((err) => {
      toast.push(apiErrorMessage(err), 'error')
    })
  }

  async function handleImport(file: File): Promise<void> {
    setImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await apiForm<ImportSummary>('/api/assets/import', form)
      setImportResult(result)
      if (result.created + result.updated > 0) await load()
      toast.push(
        '导入完成：新增 ' + String(result.created) + ' · 更新 ' + String(result.updated) + ' · 跳过 ' + String(result.skipped),
        result.errors.length > 0 ? 'info' : 'success'
      )
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setImporting(false)
    }
  }

  const total = data?.total ?? 0

  return (
    <>
      <div className="page-head">
        <div>
          <h2>资产台账</h2>
          <p className="muted">共 {total} 条资产 · 默认按最近更新排序 · 表格中的金额单位：元</p>
        </div>
      </div>

      <div className="tabs">
        <button className={'tab' + (tab === 'ledger' ? ' active' : '')} onClick={() => setTab('ledger')}>
          台账
        </button>
        <button className={'tab' + (tab === 'inventory' ? ' active' : '')} onClick={() => setTab('inventory')}>
          盘点
        </button>
        {isAdmin ? (
          <button className={'tab' + (tab === 'audit' ? ' active' : '')} onClick={() => setTab('audit')}>
            审计
          </button>
        ) : null}
      </div>

      {tab === 'ledger' ? (
        <>
          <AssetFilters
            value={filters}
            owners={owners}
            groups={groups}
            canImport={isAdmin}
            importing={importing}
            onChange={changeFilters}
            onCreate={handleCreate}
            onImport={(file) => void handleImport(file)}
            onExport={handleExport}
            onDownloadTemplate={handleDownloadTemplate}
          />
          <AssetTable
            items={data?.items ?? []}
            total={total}
            page={data?.page ?? page}
            pageSize={data?.pageSize ?? PAGE_SIZE}
            loading={loading}
            isAdmin={isAdmin}
            canEdit={editable}
            onEdit={handleEdit}
            onAttachments={(asset) => setAttachmentsAsset(asset)}
            onBorrow={(asset) => setBorrowAsset(asset)}
            onReturn={(asset) => void handleReturn(asset)}
            onDelete={(asset) => setDeleting(asset)}
            onPageChange={setPage}
          />
        </>
      ) : null}

      {tab === 'inventory' ? <InventoryTab isAdmin={isAdmin} owners={owners} /> : null}

      {tab === 'audit' && isAdmin ? <AuditTab /> : null}

      <AssetFormModal
        open={formOpen}
        asset={editing}
        owners={owners}
        groups={groups}
        isAdmin={isAdmin}
        currentUserId={user?.id ?? ''}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSaved={() => void handleSaved()}
      />

      <BorrowModal
        asset={borrowAsset}
        owners={owners}
        isAdmin={isAdmin}
        currentUserId={user?.id ?? ''}
        onClose={() => setBorrowAsset(null)}
        onDone={() => {
          setBorrowAsset(null)
          void load()
        }}
      />

      <Modal
        open={attachmentsAsset !== null}
        title={'附件 · ' + (attachmentsAsset?.code ?? '')}
        onClose={() => setAttachmentsAsset(null)}
        width={720}
        footer={<Button onClick={() => setAttachmentsAsset(null)}>关闭</Button>}
      >
        {attachmentsAsset ? (
          <AssetAttachments
            key={attachmentsAsset.id}
            assetId={attachmentsAsset.id}
            initial={attachmentsAsset.attachments}
            canEdit={canEditAsset(attachmentsAsset, user, isAdmin)}
          />
        ) : null}
      </Modal>

      <Modal
        open={deleting !== null}
        title="删除资产"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="danger" loading={deletingBusy} onClick={() => void handleDelete()}>
              确认删除
            </Button>
          </>
        }
      >
        <p>
          确认删除资产「{deleting?.code} {deleting?.name}」？
        </p>
        <p className="muted">删除后该资产的附件、借用记录与盘点条目一并移除，且不可恢复。</p>
      </Modal>

      <Modal
        open={importResult !== null}
        title="导入结果"
        onClose={() => setImportResult(null)}
        width={640}
        footer={<Button onClick={() => setImportResult(null)}>知道了</Button>}
      >
        {importResult ? (
          <>
            <p className="muted">
              新增 {importResult.created} 条 · 更新 {importResult.updated} 条 · 跳过 {importResult.skipped} 条
            </p>
            {importResult.errors.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.errors.map((error, index) => (
                      <tr key={String(error.row) + '-' + String(index)}>
                        <td>{error.row}</td>
                        <td>{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>全部行导入成功。</p>
            )}
          </>
        ) : null}
      </Modal>
    </>
  )
}
