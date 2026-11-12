import { useRef, type ChangeEvent } from 'react'
import { ASSET_CATEGORY_SUGGESTIONS, ASSET_STATUSES, ASSET_STATUS_LABEL } from '@lab/shared'
import { Button, Card, Input, Select } from '../../ui'
import type { OwnerOption } from './shared'

export interface AssetFilterState {
  q: string
  category: string
  status: string
  ownerId: string
}

export const EMPTY_FILTERS: AssetFilterState = { q: '', category: '', status: '', ownerId: '' }

interface Props {
  value: AssetFilterState
  owners: OwnerOption[]
  canImport: boolean
  importing: boolean
  onChange(next: AssetFilterState): void
  onCreate(): void
  onImport(file: File): void
  onExport(): void
  onDownloadTemplate(): void
}

export function AssetFilters({ value, owners, canImport, importing, onChange, onCreate, onImport, onExport, onDownloadTemplate }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)

  function update(patch: Partial<AssetFilterState>): void {
    onChange({ ...value, ...patch })
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onImport(file)
  }

  return (
    <Card>
      <div className="toolbar">
        <Input
          className="grow"
          style={{ flex: '1 1 220px', width: 'auto' }}
          placeholder="搜索编码 / 名称 / 型号 / 序列号 / 备注"
          value={value.q}
          onChange={(event) => update({ q: event.target.value })}
        />
        <Select
          style={{ width: 132 }}
          value={value.category}
          onChange={(event) => update({ category: event.target.value })}
          aria-label="类别筛选"
        >
          <option value="">全部类别</option>
          {ASSET_CATEGORY_SUGGESTIONS.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </Select>
        <Select
          style={{ width: 120 }}
          value={value.status}
          onChange={(event) => update({ status: event.target.value })}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          {ASSET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {ASSET_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        <Select
          style={{ width: 140 }}
          value={value.ownerId}
          onChange={(event) => update({ ownerId: event.target.value })}
          aria-label="责任人筛选"
        >
          <option value="">全部责任人</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </Select>
        <Button variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
          重置
        </Button>
        <div className="filter-actions">
          <Button variant="primary" onClick={onCreate}>
            新建资产
          </Button>
          {canImport ? (
            <Button onClick={() => fileRef.current?.click()} loading={importing}>
              {importing ? '导入中…' : '导入 xlsx'}
            </Button>
          ) : null}
          <Button onClick={onExport}>导出</Button>
          <Button variant="ghost" onClick={onDownloadTemplate}>
            模板下载
          </Button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={handleFile} />
      </div>
    </Card>
  )
}
