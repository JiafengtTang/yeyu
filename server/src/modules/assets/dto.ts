import type { Prisma } from '@prisma/client'
import type {
  AssetAttachmentDTO,
  AssetDTO,
  AssetStatus,
  AttachmentKind,
  AuditDTO,
  BorrowDTO,
  InventoryBatchDTO,
  InventoryCheckStatus,
  InventoryItemDTO,
  InventoryResult
} from '@yeyu/shared'
import { toMediaDTO } from '../../lib/storage.js'
import { iso } from '../../lib/time.js'

export const ATTACHMENT_INCLUDE = { media: true } satisfies Prisma.AssetAttachmentInclude
export type AttachmentRow = Prisma.AssetAttachmentGetPayload<{ include: typeof ATTACHMENT_INCLUDE }>

export const BORROW_INCLUDE = {
  borrower: { select: { id: true, name: true } }
} satisfies Prisma.BorrowRecordInclude
export type BorrowRow = Prisma.BorrowRecordGetPayload<{ include: typeof BORROW_INCLUDE }>

export const ASSET_INCLUDE = {
  owner: { select: { id: true, name: true } },
  attachments: { include: { media: true }, orderBy: { createdAt: 'asc' } },
  borrows: {
    where: { returnedAt: null },
    include: { borrower: { select: { id: true, name: true } } },
    orderBy: { borrowedAt: 'desc' },
    take: 1
  }
} satisfies Prisma.AssetInclude
export type AssetRow = Prisma.AssetGetPayload<{ include: typeof ASSET_INCLUDE }>

export const INVENTORY_ITEM_INCLUDE = {
  asset: { select: { code: true, name: true } }
} satisfies Prisma.InventoryItemInclude
export type InventoryItemRow = Prisma.InventoryItemGetPayload<{ include: typeof INVENTORY_ITEM_INCLUDE }>

export const INVENTORY_BATCH_INCLUDE = {
  createdBy: { select: { id: true, name: true } }
} satisfies Prisma.InventoryBatchInclude
export type InventoryBatchRow = Prisma.InventoryBatchGetPayload<{ include: typeof INVENTORY_BATCH_INCLUDE }>

export interface InventoryStats {
  total: number
  checked: number
  mismatched: number
}

export function toBorrowDTO(row: BorrowRow): BorrowDTO {
  return {
    id: row.id,
    assetId: row.assetId,
    borrowerId: row.borrowerId,
    borrowerName: row.borrower?.name ?? null,
    borrowedAt: row.borrowedAt.toISOString(),
    dueAt: iso(row.dueAt),
    returnedAt: iso(row.returnedAt),
    note: row.note
  }
}

export function toAttachmentDTO(row: AttachmentRow): AssetAttachmentDTO {
  return {
    id: row.id,
    kind: row.kind as AttachmentKind,
    media: toMediaDTO(row.media),
    createdAt: row.createdAt.toISOString()
  }
}

export function toAssetDTO(row: AssetRow): AssetDTO {
  const active = row.borrows[0]
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    model: row.model,
    serialNo: row.serialNo,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    amount: row.amount,
    purchaseDate: iso(row.purchaseDate),
    supplier: row.supplier,
    location: row.location,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    status: row.status as AssetStatus,
    remark: row.remark,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachments: row.attachments.map(toAttachmentDTO),
    activeBorrow: active ? toBorrowDTO(active) : null
  }
}

export function toInventoryItemDTO(row: InventoryItemRow): InventoryItemDTO {
  return {
    id: row.id,
    batchId: row.batchId,
    assetId: row.assetId,
    assetCode: row.asset.code,
    assetName: row.asset.name,
    expectedStatus: row.expectedStatus,
    expectedLocation: row.expectedLocation,
    actualStatus: (row.actualStatus as InventoryCheckStatus | null) ?? null,
    actualLocation: row.actualLocation,
    result: row.result as InventoryResult,
    checkedById: row.checkedById,
    checkedAt: iso(row.checkedAt),
    note: row.note
  }
}

export function toInventoryBatchDTO(row: InventoryBatchRow, stats: InventoryStats, items?: InventoryItemRow[]): InventoryBatchDTO {
  return {
    id: row.id,
    name: row.name,
    createdById: row.createdById,
    creatorName: row.createdBy.name,
    createdAt: row.createdAt.toISOString(),
    closedAt: iso(row.closedAt),
    total: stats.total,
    checked: stats.checked,
    mismatched: stats.mismatched,
    ...(items ? { items: items.map(toInventoryItemDTO) } : {})
  }
}

export function toAuditDTO(row: {
  id: string
  userId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  beforeJson: string | null
  afterJson: string | null
  ip: string | null
  createdAt: Date
}): AuditDTO {
  return {
    id: row.id,
    userId: row.userId,
    actorName: row.actorName,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeJson: row.beforeJson,
    afterJson: row.afterJson,
    ip: row.ip,
    createdAt: row.createdAt.toISOString()
  }
}
