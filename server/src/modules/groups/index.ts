import type { FastifyInstance } from 'fastify'
import type { GroupDTO } from '@yeyu/shared'
import { groupInputSchema, groupUpdateSchema } from '@yeyu/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { recordAudit } from '../../lib/audit.js'
import { currentUser, requestIp, requireAdmin, requireAuth } from '../../plugins/auth.js'
import { parseInput } from '../users/shared.js'

const WITH_COUNT = { _count: { select: { users: true } } } as const

interface GroupRow {
  id: string
  name: string
  description: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  _count?: { users: number }
}

function toGroupDTO(row: GroupRow): GroupDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    memberCount: row._count?.users ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

/**
 * 成员分组：管理员维护小组，成员通过 PATCH /api/users/:id 的 groupId 归属。
 * 删除小组时成员的 groupId 由数据库外键置空（onDelete: SetNull），不会连带删成员。
 */
export async function registerGroupsModule(app: FastifyInstance): Promise<void> {
  app.get('/api/groups', { preHandler: requireAuth }, async () => {
    const rows = await prisma.group.findMany({
      include: WITH_COUNT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    })
    return { items: rows.map(toGroupDTO), total: rows.length, page: 1, pageSize: rows.length }
  })

  app.post('/api/groups', { preHandler: requireAdmin }, async (request, reply) => {
    const actor = currentUser(request)
    const input = parseInput(groupInputSchema, request.body)
    const clash = await prisma.group.findUnique({ where: { name: input.name } })
    if (clash) throw AppError.conflict('同名小组已存在')

    const row = await prisma.group.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0
      },
      include: WITH_COUNT
    })
    await recordAudit({
      actor,
      action: 'CREATE',
      entityType: 'GROUP',
      entityId: row.id,
      before: null,
      after: { name: row.name, description: row.description },
      ip: requestIp(request)
    })
    reply.code(201)
    return toGroupDTO(row)
  })

  app.patch('/api/groups/:id', { preHandler: requireAdmin }, async (request) => {
    const actor = currentUser(request)
    const { id } = request.params as { id: string }
    const input = parseInput(groupUpdateSchema, request.body)
    const target = await prisma.group.findUnique({ where: { id } })
    if (!target) throw AppError.notFound('小组不存在')

    if (input.name && input.name !== target.name) {
      const clash = await prisma.group.findUnique({ where: { name: input.name } })
      if (clash) throw AppError.conflict('同名小组已存在')
    }

    const row = await prisma.group.update({
      where: { id },
      data: {
        name: input.name ?? target.name,
        description: input.description === undefined ? target.description : input.description,
        sortOrder: input.sortOrder ?? target.sortOrder
      },
      include: WITH_COUNT
    })
    await recordAudit({
      actor,
      action: 'UPDATE',
      entityType: 'GROUP',
      entityId: id,
      before: { name: target.name, description: target.description, sortOrder: target.sortOrder },
      after: { name: row.name, description: row.description, sortOrder: row.sortOrder },
      ip: requestIp(request)
    })
    return toGroupDTO(row)
  })

  app.delete('/api/groups/:id', { preHandler: requireAdmin }, async (request) => {
    const actor = currentUser(request)
    const { id } = request.params as { id: string }
    const target = await prisma.group.findUnique({ where: { id }, include: WITH_COUNT })
    if (!target) throw AppError.notFound('小组不存在')

    await prisma.group.delete({ where: { id } })
    await recordAudit({
      actor,
      action: 'DELETE',
      entityType: 'GROUP',
      entityId: id,
      before: { name: target.name, memberCount: target._count.users },
      after: null,
      ip: requestIp(request)
    })
    return { ok: true, movedToUngrouped: target._count.users }
  })
}
