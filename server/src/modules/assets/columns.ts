import { ASSET_STATUSES, ASSET_STATUS_LABEL, INVENTORY_CHECK_LABEL, INVENTORY_RESULT_LABEL, type AssetStatus, type InventoryCheckStatus, type InventoryResult } from '@yeyu/shared'

export type AssetColumnKey =
  | 'code'
  | 'name'
  | 'category'
  | 'model'
  | 'serialNo'
  | 'quantity'
  | 'unitPrice'
  | 'amount'
  | 'purchaseDate'
  | 'supplier'
  | 'location'
  | 'ownerName'
  | 'groupName'
  | 'status'
  | 'remark'

export interface AssetColumn {
  key: AssetColumnKey
  header: string
  width: number
}

export const ASSET_COLUMNS: AssetColumn[] = [
  { key: 'code', header: '资产编码', width: 18 },
  { key: 'name', header: '资产名称', width: 26 },
  { key: 'category', header: '类别', width: 12 },
  { key: 'model', header: '型号', width: 16 },
  { key: 'serialNo', header: '序列号', width: 18 },
  { key: 'quantity', header: '数量', width: 8 },
  { key: 'unitPrice', header: '单价', width: 12 },
  { key: 'amount', header: '金额', width: 12 },
  { key: 'purchaseDate', header: '购置日期', width: 14 },
  { key: 'supplier', header: '供应商', width: 18 },
  { key: 'location', header: '存放位置', width: 16 },
  { key: 'ownerName', header: '责任人', width: 12 },
  { key: 'groupName', header: '使用小组', width: 14 },
  { key: 'status', header: '状态', width: 10 },
  { key: 'remark', header: '备注', width: 30 }
]

export const TEMPLATE_ROW: Record<AssetColumnKey, string | number> = {
  code: 'ASSET-0001',
  name: '示例：戴尔显示器',
  category: '电脑办公',
  model: 'U2723QE',
  serialNo: 'CN0X1234567',
  quantity: 1,
  unitPrice: 3299,
  amount: 3299,
  purchaseDate: '2025-03-01',
  supplier: '示例供应商',
  location: '实验室 A-01',
  ownerName: '张三',
  groupName: '示例小组',
  status: '在用',
  remark: '模板示例行，导入前请删除'
}

export function columnKeyOfHeader(header: string): AssetColumnKey | null {
  const trimmed = header.trim()
  const hit = ASSET_COLUMNS.find((column) => column.header === trimmed)
  return hit ? hit.key : null
}

export function assetStatusLabel(status: string): string {
  return ASSET_STATUS_LABEL[status as AssetStatus] ?? status
}

export function parseAssetStatus(value?: string): AssetStatus | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if ((ASSET_STATUSES as readonly string[]).includes(trimmed)) return trimmed as AssetStatus
  const hit = (Object.entries(ASSET_STATUS_LABEL) as [AssetStatus, string][]).find(([, label]) => label === trimmed)
  return hit ? hit[0] : undefined
}

export function inventoryCheckLabel(status: string | null): string {
  if (!status) return '-'
  return INVENTORY_CHECK_LABEL[status as InventoryCheckStatus] ?? status
}

export function inventoryResultLabel(result: string): string {
  return INVENTORY_RESULT_LABEL[result as InventoryResult] ?? result
}
