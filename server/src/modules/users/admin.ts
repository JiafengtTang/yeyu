import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createUserSchema, resetPasswordSchema, updateUserSchema, USER_STATUSES } from '@yeyu/shared'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { currentUser, requestIp, requireAdmin } from '../../plugins/auth.js'
import { ensureNotLastActiveAdmin, parseInput, toUserDTO, userAuditSnapshot } from './shared.js'

const BCRYPT_COST = 10

const userQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(USER_STATUSES).optional(),
  /** 小组 id；NONE 表示"未分组" */
  groupId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional()
})

export async function registerUserAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users', { preHandler: requireAdmin }, async (request) => {
    const query = parseInput(userQuerySchema, request.query)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const where: Prisma.UserWhereInput = {}
    if (query.status) where.status = query.status
    if (query.groupId) where.groupId = query.groupId === 'NONE' ? null : query.groupId
    const keyword = query.q?.trim()
    if (keyword) where.OR = [{ name: { contains: keyword } }, { phone: { contains: keyword } }]

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: { group: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])
    return { items: items.map(toUserDTO), total, page, pageSize }
  })

  app.post('/api/users', { preHandler: requireAdmin }, async (request, reply) => {
    const actor = currentUser(request)
    const input = parseInput(createUserSchema, request.body)
    const exists = await prisma.user.findUnique({ where: { phone: input.phone } })
    if (exists) throw AppError.conflict('该手机号已注册')
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST)
    const user = await prisma.user.create({
      data: {
        phone: input.phone,
        passwordHash,
        name: input.name,
        email: input.email ?? null,
        role: input.role ?? 'MEMBER',
        status: input.status ?? 'ACTIVE'
      }
    })
    await recordAudit({
      actor,
      action: 'CREATE',
      entityType: 'USER',
      entityId: user.id,
      after: userAuditSnapshot(user),
      ip: requestIp(request)
    })
    return reply.status(201).send(toUserDTO(user))
  })

  app.patch('/api/users/:id', { preHandler: requireAdmin }, async (request) => {
    const actor = currentUser(request)
    const { id } = request.params as { id: string }
    const input = parseInput(updateUserSchema, request.body)
    const target = await prisma.user.findUnique({ where: { id }, include: { group: true } })
    if (!target) throw AppError.notFound('用户不存在')

    const nextRole = input.role ?? target.role
    const nextStatus = input.status ?? target.status
    const nextGroupId = input.groupId === undefined ? target.groupId : input.groupId
    if (nextGroupId && nextGroupId !== target.groupId) {
      const group = await prisma.group.findUnique({ where: { id: nextGroupId } })
      if (!group) throw AppError.notFound('小组不存在')
    }
    if (nextRole === target.role && nextStatus === target.status && nextGroupId === target.groupId) {
      return toUserDTO(target)
    }

    await ensureNotLastActiveAdmin(target, { role: nextRole, status: nextStatus })

    const updated = await prisma.user.update({
      where: { id },
      data: { role: nextRole, status: nextStatus, groupId: nextGroupId },
      include: { group: true }
    })
    const before = userAuditSnapshot(target)
    const after = userAuditSnapshot(updated)
    await recordAudit({
      actor,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: id,
      before: { role: before.role, status: before.status, groupId: target.groupId },
      after: { role: after.role, status: after.status, groupId: nextGroupId },
      ip: requestIp(request)
    })
    return toUserDTO(updated)
  })

  app.post('/api/users/:id/reset-password', { preHandler: requireAdmin }, async (request) => {
    const actor = currentUser(request)
    const { id } = request.params as { id: string }
    const input = parseInput(resetPasswordSchema, request.body)
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) throw AppError.notFound('用户不存在')

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST)
    await prisma.user.update({ where: { id }, data: { passwordHash } })
    await recordAudit({
      actor,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: id,
      before: { phone: target.phone, passwordReset: false },
      after: { phone: target.phone, passwordReset: true },
      ip: requestIp(request)
    })
    return { ok: true }
  })
}
