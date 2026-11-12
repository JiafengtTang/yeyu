import ExcelJS from 'exceljs'
import type { InventoryBatchDTO, InventoryResult } from '@yeyu/shared'
import {
  ASSET_COLUMNS,
  TEMPLATE_ROW,
  assetStatusLabel,
  columnKeyOfHeader,
  inventoryCheckLabel,
  inventoryResultLabel,
  type AssetColumnKey
} from './columns.js'
import type { AssetRow, InventoryItemRow } from './dto.js'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface AssetSheetRow {
  rowNumber: number
  values: Partial<Record<AssetColumnKey, string>>
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const composite = value as { text?: unknown; result?: unknown; richText?: { text: string }[] }
  if (typeof composite.text === 'string') return composite.text
  if (Array.isArray(composite.richText)) return composite.richText.map((part) => part.text).join('')
  if (composite.result !== undefined) return cellText(composite.result as ExcelJS.CellValue)
  return ''
}

function assetCellValue(row: AssetRow, key: AssetColumnKey): string | number | null {
  switch (key) {
    case 'code':
      return row.code
    case 'name':
      return row.name
    case 'category':
      return row.category
    case 'model':
      return row.model
    case 'serialNo':
      return row.serialNo
    case 'quantity':
      return row.quantity
    case 'unitPrice':
      return row.unitPrice
    case 'amount':
      return row.amount
    case 'purchaseDate':
      return row.purchaseDate ? row.purchaseDate.toISOString().slice(0, 10) : null
    case 'supplier':
      return row.supplier
    case 'location':
      return row.location
    case 'ownerName':
      return row.owner?.name ?? null
    case 'status':
      return assetStatusLabel(row.status)
    case 'remark':
      return row.remark
  }
}

function applyHeaderStyle(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.height = 22
  header.alignment = { vertical: 'middle' }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

export function buildAssetWorkbook(rows: AssetRow[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'yeyu'
  const sheet = workbook.addWorksheet('资产台账')
  sheet.columns = ASSET_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }))
  applyHeaderStyle(sheet)
  for (const row of rows) {
    const record: Record<string, string | number | null> = {}
    for (const column of ASSET_COLUMNS) record[column.key] = assetCellValue(row, column.key)
    sheet.addRow(record)
  }
  return workbook
}

export function buildTemplateWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'yeyu'
  const sheet = workbook.addWorksheet('导入模板')
  sheet.columns = ASSET_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }))
  applyHeaderStyle(sheet)
  sheet.addRow(TEMPLATE_ROW as unknown as Record<string, string | number>)
  return workbook
}

export function buildInventoryWorkbook(batch: InventoryBatchDTO, items: InventoryItemRow[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'yeyu'
  const sheet = workbook.addWorksheet('盘点差异')
  sheet.columns = [
    { header: '资产编码', key: 'code', width: 18 },
    { header: '资产名称', key: 'name', width: 26 },
    { header: '预期状态', key: 'expectedStatus', width: 12 },
    { header: '预期位置', key: 'expectedLocation', width: 18 },
    { header: '实际状态', key: 'actualStatus', width: 12 },
    { header: '实际位置', key: 'actualLocation', width: 18 },
    { header: '盘点结果', key: 'result', width: 12 },
    { header: '盘点时间', key: 'checkedAt', width: 20 },
    { header: '备注', key: 'note', width: 30 }
  ]
  applyHeaderStyle(sheet)
  sheet.addRow({ code: '盘点批次：' + batch.name, name: '', expectedStatus: '', expectedLocation: '' } as unknown as Record<string, string>)
  for (const item of items) {
    sheet.addRow({
      code: item.asset.code,
      name: item.asset.name,
      expectedStatus: assetStatusLabel(item.expectedStatus),
      expectedLocation: item.expectedLocation ?? '',
      actualStatus: inventoryCheckLabel(item.actualStatus),
      actualLocation: item.actualLocation ?? '',
      result: inventoryResultLabel(item.result as InventoryResult),
      checkedAt: item.checkedAt ? item.checkedAt.toISOString().slice(0, 19).replace('T', ' ') : '',
      note: item.note ?? ''
    })
  }
  return workbook
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const data = await workbook.xlsx.writeBuffer()
  return Buffer.from(data)
}

export async function readAssetSheet(buffer: Buffer): Promise<AssetSheetRow[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet(1)
  if (!sheet) return []

  const keysByColumn = new Map<number, AssetColumnKey>()
  sheet.getRow(1).eachCell((cell, column) => {
    const key = columnKeyOfHeader(cellText(cell.value))
    if (key) keysByColumn.set(column, key)
  })
  if (keysByColumn.size === 0) return []

  const rows: AssetSheetRow[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const values: Partial<Record<AssetColumnKey, string>> = {}
    let filled = false
    for (const [column, key] of keysByColumn) {
      const text = cellText(row.getCell(column).value).trim()
      if (!text) continue
      values[key] = text
      filled = true
    }
    if (filled) rows.push({ rowNumber, values })
  })
  return rows
}
