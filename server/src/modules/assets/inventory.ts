import type { FastifyInstance } from 'fastify'
import { inventoryCheckSchema, inventoryCreateSchema, type InventoryCheckStatus, type InventoryResult } from '@lab/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { recordAudit } from '../../lib/audit.js'
import { currentUser, requestIp, requireAdmin, requireAuth } from '../../plugins/auth.js'
import {
  INVENTORY_BATCH_INCLUDE,
  INVENTORY_ITEM_INCLUDE,
  toInventoryBatchDTO,
  toInventoryItemDTO,
  type InventoryItemRow,
  type InventoryStats
} from './dto.js'
import { parseInput } from './helpers.js'
import { XLSX_MIME, buildInventoryWorkbook, workbookToBuffer } from './excel.js'

const RESULT_BY_CHECK: Record<InventoryCheckStatus, InventoryResult> = {
  PRESENT: 'MATCH',
  MISSING: 'MISSING',
  DAMAGED: 'MISMATCH',
  UNKNOWN: 'MISMATCH'
}

const ITEMS_INCLUDE = {
  ...INVENTORY_BATCH_INCLUDE,
  items: { include: INVENTORY_ITEM_INCLUDE, orderBy: { asset: { code: 'asc' } } }
} as const

function statsOf(items: InventoryItemRow[]): InventoryStats {
  let checked = 0
  let mismatched = 0
  for (const item of items) {
    if (item.result !== 'PENDING') checked += 1
    if (item.result === 'MISMATCH' || item.result === 'MISSING') mismatched += 1
  }
  return { total: items.length, checked, mismatched }
}

async function statsForBatches(batchIds: string[]): Promise<Map<string, InventoryStats>> {
  const map = new Map<string, InventoryStats>()
  if (batchIds.length === 0) return map
  const grouped = await prisma.inventoryItem.groupBy({
    by: ['batchId', 'result'],
    where: { batchId: { in: batchIds } },
    _count: { _all: true }
  })
  for (const group of grouped) {
    const entry = map.get(group.batchId) ?? { total: 0, checked: 0, mismatched: 0 }
    entry.total += group._count._all
    if (group.result !== 'PENDING') entry.checked += group._count._all
    if (group.result === 'MISMATCH' || group.result === 'MISSING') entry.mismatched += group._count._all
    map.set(group.batchId, entry)
  }
  return map
}

function batchWithItems(id: string) {
  return prisma.inventoryBatch.findUnique({ where: { id }, include: ITEMS_INCLUDE })
}

function stampForFile(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/inventory/batches', { preHandler: requireAdmin }, async (req, reply) => {
    const user = currentUser(req)
    const input = parseInput(inventoryCreateSchema, req.body)
    const assets = await prisma.asset.findMany({
      where: {
        ...(input.category ? { category: input.category } : {}),
        ...(input.ownerId ? { ownerId: input.ownerId } : {})
      },
      select: { id: true, status: true, location: true },
      orderBy: { code: 'asc' }
    })
    const batch = await prisma.inventoryBatch.create({
      data: {
        name: input.name.trim(),
        createdById: user.id,
        items: {
          create: assets.map((asset) => ({
            assetId: asset.id,
            expectedStatus: asset.status,
            expectedLocation: asset.location,
            result: 'PENDING'
          }))
        }
      }
    })
    await recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'INVENTORY',
      entityId: batch.id,
      after: { name: batch.name, scope: { category: input.category ?? null, ownerId: input.ownerId ?? null }, total: assets.length },
      ip: requestIp(req)
    })
    const full = await batchWithItems(batch.id)
    if (!full) throw AppError.notFound('盘点批次不存在')
    return reply.status(201).send(toInventoryBatchDTO(full, statsOf(full.items), full.items))
  })

  app.get('/api/inventory/batches', { preHandler: requireAuth }, async (req) => {
    const raw = (req.query ?? {}) as Record<string, unknown>
    const page = Math.max(1, Math.floor(Number(raw.page) || 1))
    const pageSize = Math.min(Math.max(1, Math.floor(Number(raw.pageSize) || 20)), 200)
    const [total, batches] = await Promise.all([
      prisma.inventoryBatch.count(),
      prisma.inventoryBatch.findMany({
        include: INVENTORY_BATCH_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])
    const stats = await statsForBatches(batches.map((batch) => batch.id))
    return {
      items: batches.map((batch) => toInventoryBatchDTO(batch, stats.get(batch.id) ?? { total: 0, checked: 0, mismatched: 0 })),
      total,
      page,
      pageSize
    }
  })

  app.get('/api/inventory/batches/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const batch = await batchWithItems(id)
    if (!batch) throw AppError.notFound('盘点批次不存在')
    return toInventoryBatchDTO(batch, statsOf(batch.items), batch.items)
  })

  app.patch('/api/inventory/items/:itemId', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { itemId } = req.params as { itemId: string }
    const input = parseInput(inventoryCheckSchema, req.body)
    const item = await prisma.inventoryItem.findUnique({ where: { id: itemId }, include: INVENTORY_ITEM_INCLUDE })
    if (!item) throw AppError.notFound('盘点条目不存在')
    const batch = await prisma.inventoryBatch.findUnique({ where: { id: item.batchId }, select: { closedAt: true } })
    if (batch?.closedAt) throw AppError.conflict('该盘点批次已关闭')
    const result = RESULT_BY_CHECK[input.actualStatus]
    const updated = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        actualStatus: input.actualStatus,
        result,
        checkedById: user.id,
        checkedAt: new Date(),
        ...(input.actualLocation !== undefined ? { actualLocation: input.actualLocation } : {}),
        ...(input.note !== undefined ? { note: input.note } : {})
      },
      include: INVENTORY_ITEM_INCLUDE
    })
    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'INVENTORY',
      entityId: item.batchId,
      before: { itemId: item.id, result: item.result, actualStatus: item.actualStatus },
      after: { itemId: item.id, result, actualStatus: input.actualStatus },
      ip: requestIp(req)
    })
    return toInventoryItemDTO(updated)
  })

  app.post('/api/inventory/batches/:id/close', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const batch = await batchWithItems(id)
    if (!batch) throw AppError.notFound('盘点批次不存在')
    if (batch.closedAt) throw AppError.conflict('该盘点批次已关闭')
    const updated = await prisma.inventoryBatch.update({
      where: { id: batch.id },
      data: { closedAt: new Date() },
      include: ITEMS_INCLUDE
    })
    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'INVENTORY',
      entityId: batch.id,
      before: { closedAt: null },
      after: { closedAt: updated.closedAt?.toISOString() ?? null },
      ip: requestIp(req)
    })
    return toInventoryBatchDTO(updated, statsOf(updated.items), updated.items)
  })

  app.get('/api/inventory/batches/:id/export', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const batch = await batchWithItems(id)
    if (!batch) throw AppError.notFound('盘点批次不存在')
    const items = batch.items.filter((item) => item.result !== 'MATCH')
    const buffer = await workbookToBuffer(buildInventoryWorkbook(toInventoryBatchDTO(batch, statsOf(batch.items)), items))
    reply.header('Content-Type', XLSX_MIME)
    reply.header(
      'Content-Disposition',
      'attachment; filename="inventory-diff-' + batch.id + '.xlsx"; filename*=UTF-8\'\'' +
        encodeURIComponent('盘点差异-' + stampForFile(batch.name) + '.xlsx')
    )
    reply.header('Content-Length', String(buffer.byteLength))
    return reply.send(buffer)
  })
}
