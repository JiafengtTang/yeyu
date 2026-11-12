import type { FastifyInstance } from 'fastify'
import { borrowInputSchema } from '@yeyu/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { recordAudit } from '../../lib/audit.js'
import { parseDateInput } from '../../lib/time.js'
import { currentUser, isAdmin, requestIp, requireAuth } from '../../plugins/auth.js'
import { BORROW_INCLUDE, toBorrowDTO } from './dto.js'
import { parseInput } from './helpers.js'

export async function registerBorrowRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/assets/:id/borrow', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const input = parseInput(borrowInputSchema, req.body)
    const asset = await prisma.asset.findUnique({ where: { id } })
    if (!asset) throw AppError.notFound('资产不存在')
    if (asset.status === 'SCRAPPED') throw AppError.conflict('已报废的资产不能借用')
    const active = await prisma.borrowRecord.findFirst({ where: { assetId: asset.id, returnedAt: null }, select: { id: true } })
    if (asset.status === 'BORROWED' || active) throw AppError.conflict('该资产已在借用中')

    const borrowerId = input.borrowerId?.trim() || user.id
    if (borrowerId !== user.id && !isAdmin(user)) throw AppError.forbidden('成员只能为自己登记借用')
    const borrower = await prisma.user.findUnique({ where: { id: borrowerId }, select: { id: true } })
    if (!borrower) throw AppError.validation('借用人不存在')

    let dueAt: Date | null = null
    if (input.dueAt) {
      dueAt = parseDateInput(input.dueAt)
      if (!dueAt) throw AppError.validation('预计归还日期格式不正确')
    }

    const record = await prisma.borrowRecord.create({
      data: { assetId: asset.id, borrowerId, dueAt, note: input.note ?? null },
      include: BORROW_INCLUDE
    })
    await prisma.asset.update({ where: { id: asset.id }, data: { status: 'BORROWED' } })
    await recordAudit({
      actor: user,
      action: 'BORROW',
      entityType: 'ASSET',
      entityId: asset.id,
      before: { status: asset.status },
      after: { status: 'BORROWED', borrowerId, borrowId: record.id },
      ip: requestIp(req)
    })
    return reply.status(201).send(toBorrowDTO(record))
  })

  app.post('/api/assets/:id/return', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const asset = await prisma.asset.findUnique({ where: { id } })
    if (!asset) throw AppError.notFound('资产不存在')
    const active = await prisma.borrowRecord.findFirst({
      where: { assetId: asset.id, returnedAt: null },
      orderBy: { borrowedAt: 'desc' }
    })
    if (!active) throw AppError.conflict('该资产没有未归还的借用记录')
    const record = await prisma.borrowRecord.update({
      where: { id: active.id },
      data: { returnedAt: new Date() },
      include: BORROW_INCLUDE
    })
    await prisma.asset.update({ where: { id: asset.id }, data: { status: 'IN_USE' } })
    await recordAudit({
      actor: user,
      action: 'RETURN',
      entityType: 'ASSET',
      entityId: asset.id,
      before: { status: asset.status, borrowId: active.id },
      after: { status: 'IN_USE' },
      ip: requestIp(req)
    })
    return toBorrowDTO(record)
  })

  app.get('/api/borrows', { preHandler: requireAuth }, async (req) => {
    const raw = (req.query ?? {}) as Record<string, unknown>
    const page = Math.max(1, Math.floor(Number(raw.page) || 1))
    const pageSize = Math.min(Math.max(1, Math.floor(Number(raw.pageSize) || 20)), 200)
    const where = {
      ...(typeof raw.assetId === 'string' && raw.assetId ? { assetId: raw.assetId } : {}),
      ...(typeof raw.borrowerId === 'string' && raw.borrowerId ? { borrowerId: raw.borrowerId } : {}),
      ...(raw.active === 'true' ? { returnedAt: null } : {})
    }
    const [total, rows] = await Promise.all([
      prisma.borrowRecord.count({ where }),
      prisma.borrowRecord.findMany({
        where,
        include: BORROW_INCLUDE,
        orderBy: { borrowedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])
    return { items: rows.map(toBorrowDTO), total, page, pageSize }
  })
}
