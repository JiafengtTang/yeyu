import { ASSET_STATUS_LABEL, formatMoney, type AssetDTO } from '@lab/shared'
import { Badge, Button, Card, EmptyState, Spinner } from '../../ui'
import { formatDate } from '../../api/client'
import { statusTone } from './shared'

interface Props {
  items: AssetDTO[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  isAdmin: boolean
  canEdit(asset: AssetDTO): boolean
  onEdit(asset: AssetDTO): void
  onAttachments(asset: AssetDTO): void
  onBorrow(asset: AssetDTO): void
  onReturn(asset: AssetDTO): void
  onDelete(asset: AssetDTO): void
  onPageChange(page: number): void
}

export function AssetTable({
  items,
  total,
  page,
  pageSize,
  loading,
  isAdmin,
  canEdit,
  onEdit,
  onAttachments,
  onBorrow,
  onReturn,
  onDelete,
  onPageChange
}: Props) {
  if (loading) return <Card><Spinner label="加载资产中…" /></Card>
  if (total === 0) {
    return (
      <Card>
        <EmptyState title="没有符合条件的资产" description="调整筛选条件，或新建第一条资产。" />
      </Card>
    )
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Card>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>编码</th>
              <th>名称</th>
              <th>类别</th>
              <th>型号</th>
              <th>数量</th>
              <th>单价</th>
              <th>金额</th>
              <th>购置日期</th>
              <th>存放位置</th>
              <th>责任人</th>
              <th>状态</th>
              <th style={{ position: 'sticky', right: 0, background: '#fafbfc', zIndex: 2 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((asset) => {
              const editable = canEdit(asset)
              return (
                <tr key={asset.id}>
                  <td>{asset.code}</td>
                  <td>{asset.name}</td>
                  <td>{asset.category}</td>
                  <td>{asset.model ?? '-'}</td>
                  <td className="num">{asset.quantity}</td>
                  <td className="num">{formatMoney(asset.unitPrice)}</td>
                  <td className="num">{formatMoney(asset.amount)}</td>
                  <td>{formatDate(asset.purchaseDate)}</td>
                  <td>{asset.location ?? '-'}</td>
                  <td>{asset.ownerName ?? '-'}</td>
                  <td>
                    <Badge tone={statusTone(asset.status)}>{ASSET_STATUS_LABEL[asset.status]}</Badge>
                    {asset.activeBorrow ? (
                      <span className="muted" title={'应还 ' + formatDate(asset.activeBorrow.dueAt)}>
                        {' '}
                        {asset.activeBorrow.borrowerName ?? '借用人'}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ position: 'sticky', right: 0, background: '#fff' }}>
                    <div className="table-actions">
                      <Button
                        className="btn-sm"
                        variant="ghost"
                        disabled={!editable}
                        title={editable ? '编辑资产' : '仅责任人可修改'}
                        onClick={() => onEdit(asset)}
                      >
                        编辑
                      </Button>
                      <Button className="btn-sm" variant="ghost" onClick={() => onAttachments(asset)}>
                        附件{asset.attachments.length > 0 ? ' (' + String(asset.attachments.length) + ')' : ''}
                      </Button>
                      {asset.activeBorrow ? (
                        <Button className="btn-sm" variant="ghost" onClick={() => onReturn(asset)}>
                          归还
                        </Button>
                      ) : (
                        <Button
                          className="btn-sm"
                          variant="ghost"
                          disabled={asset.status === 'SCRAPPED'}
                          onClick={() => onBorrow(asset)}
                        >
                          借用
                        </Button>
                      )}
                      {isAdmin ? (
                        <Button className="btn-sm" variant="ghost" onClick={() => onDelete(asset)}>
                          删除
                        </Button>
                      ) : null}
                      {!editable ? <span className="muted">仅责任人可修改</span> : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>
          共 {total} 条 · 第 {page} / {totalPages} 页
        </span>
        <div className="table-actions">
          <Button className="btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            上一页
          </Button>
          <Button className="btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            下一页
          </Button>
        </div>
      </div>
    </Card>
  )
}
