import { useCallback, useEffect, useState } from 'react'
import type { AuditDTO, ListResult } from '@lab/shared'
import { api, apiErrorMessage, formatDateTime } from '../../api/client'
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, useToast } from '../../ui'

const ENTITY_TYPES = ['ASSET', 'USER', 'REPORT', 'BORROW', 'INVENTORY'] as const

const ENTITY_LABEL: Record<string, string> = {
  ASSET: '资产',
  USER: '用户',
  REPORT: '周报',
  BORROW: '借用',
  INVENTORY: '盘点'
}

const ACTION_TONE: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  IMPORT: 'warning',
  EXPORT: 'default',
  BORROW: 'warning',
  RETURN: 'info',
  LOGIN: 'default',
  REGISTER: 'default',
  SUBMIT: 'info',
  REVIEW: 'success'
}

interface Filters {
  entityType: string
  entityId: string
  from: string
  to: string
}

const EMPTY: Filters = { entityType: '', entityId: '', from: '', to: '' }

function summarize(value: string | null): string {
  if (!value) return '-'
  return value.length > 90 ? value.slice(0, 90) + '…' : value
}

export function AuditTab() {
  const toast = useToast()
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListResult<AuditDTO> | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<ListResult<AuditDTO>>('/api/audit', {
        query: {
          entityType: filters.entityType,
          entityId: filters.entityId.trim(),
          from: filters.from,
          to: filters.to,
          page
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

  function update(patch: Partial<Filters>): void {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPage(1)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <Card>
        <div className="toolbar">
          <Select
            style={{ width: 150 }}
            value={filters.entityType}
            onChange={(event) => update({ entityType: event.target.value })}
            aria-label="对象类型"
          >
            <option value="">全部对象</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {ENTITY_LABEL[type]}
              </option>
            ))}
          </Select>
          <Input
            className="grow"
            style={{ flex: '1 1 180px', width: 'auto' }}
            placeholder="对象 ID（可选）"
            value={filters.entityId}
            onChange={(event) => update({ entityId: event.target.value })}
          />
          <Input
            style={{ width: 150 }}
            type="date"
            value={filters.from}
            onChange={(event) => update({ from: event.target.value })}
            aria-label="开始日期"
          />
          <Input
            style={{ width: 150 }}
            type="date"
            value={filters.to}
            onChange={(event) => update({ to: event.target.value })}
            aria-label="结束日期"
          />
          <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
            重置
          </Button>
        </div>
      </Card>
      {loading ? (
        <Card>
          <Spinner label="加载审计日志…" />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title="没有审计记录" description="所有写操作都会记录在这里。" />
        </Card>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>动作</th>
                  <th>对象类型</th>
                  <th>对象 ID</th>
                  <th>IP</th>
                  <th>变更后</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.actorName ?? '-'}</td>
                    <td>
                      <Badge tone={ACTION_TONE[log.action] ?? 'default'}>{log.action}</Badge>
                    </td>
                    <td>{ENTITY_LABEL[log.entityType] ?? log.entityType}</td>
                    <td>{log.entityId ?? '-'}</td>
                    <td>{log.ip ?? '-'}</td>
                    <td title={log.afterJson ?? ''}>{summarize(log.afterJson)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>
              共 {data.total} 条 · 第 {data.page} / {totalPages} 页
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
    </>
  )
}
