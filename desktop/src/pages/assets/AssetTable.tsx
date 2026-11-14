import { ASSET_STATUS_LABEL, formatMoney, type AssetDTO } from '@yeyu/shared'
import { Badge, Button, Card, EmptyState, Spinner } from '../../ui'
import { Icon } from '../../ui/icons'
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
              <th>使用小组</th>
              <th>状态</th>
              <th>操作</th>
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
                  <td>
                    {asset.groupName ?? '-'}
                    {asset.groupFromOwner ? <span className="group-hint">随责任人</span> : null}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="icon-action"
                        disabled={!editable}
                        title={editable ? '编辑资产' : '仅责任人可修改'}
                        onClick={() => onEdit(asset)}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        className="icon-action"
                        title={'附件' + (asset.attachments.length > 0 ? '（' + String(asset.attachments.length) + '）' : '')}
                        onClick={() => onAttachments(asset)}
                      >
                        <Icon name="paperclip" size={15} />
                      </button>
                      {asset.activeBorrow ? (
                        <button className="icon-action" title="归还" onClick={() => onReturn(asset)}>
                          <Icon name="download" size={15} />
                        </button>
                      ) : (
                        <button
                          className="icon-action"
                          disabled={asset.status === 'SCRAPPED'}
                          title="借用"
                          onClick={() => onBorrow(asset)}
                        >
                          <Icon name="upload" size={15} />
                        </button>
                      )}
                      {isAdmin ? (
                        <button className="icon-action icon-action-danger" title="删除" onClick={() => onDelete(asset)}>
                          <Icon name="trash" size={15} />
                        </button>
                      ) : null}
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
