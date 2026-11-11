import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { parseDateInput } from '../../lib/time.js'
import { requireAdmin } from '../../plugins/auth.js'
import { toAuditDTO } from './dto.js'
import { pageParams, parseInput } from './helpers.js'

const auditQuerySchema = z.object({
  entityType: z.string().max(32).optional(),
  entityId: z.string().max(64).optional(),
  userId: z.string().max(64).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional()
})

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audit', { preHandler: requireAdmin }, async (req) => {
    const query = parseInput(auditQuerySchema, req.query)
    const { page, pageSize, skip, take } = pageParams(query)
    const where: Prisma.AuditLogWhereInput = {}
    if (query.entityType) where.entityType = query.entityType
    if (query.entityId) where.entityId = query.entityId
    if (query.userId) where.userId = query.userId
    if (query.from) {
      const from = parseDateInput(query.from)
      if (!from) throw AppError.validation('开始时间格式不正确')
      where.createdAt = { ...(where.createdAt as Prisma.DateTimeFilter | undefined), gte: from }
    }
    if (query.to) {
      const to = parseDateInput(query.to)
      if (!to) throw AppError.validation('结束时间格式不正确')
      where.createdAt = { ...(where.createdAt as Prisma.DateTimeFilter | undefined), lte: to }
    }
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take })
    ])
    return { items: rows.map(toAuditDTO), total, page, pageSize }
  })
}
