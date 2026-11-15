import type { FastifyInstance } from 'fastify'
import { memoInputSchema, memoPatchSchema, memoQuerySchema } from '@yeyu/shared'
import type { MemoDTO, MemoStatus, MemoSummaryDTO } from '@yeyu/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { currentUser, requireAuth } from '../../plugins/auth.js'
import { parseInput } from '../users/shared.js'

interface MemoRow {
  id: string
  title: string
  note: string | null
  dueAt: Date | null
  done: boolean
  doneAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toDTO(row: MemoRow, now = new Date()): MemoDTO {
  const overdue = !row.done && row.dueAt !== null && row.dueAt.getTime() < now.getTime()
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    done: row.done,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    overdue
  }
}

function parseDate(value: string | null | undefined, field: string): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw AppError.validation(field + ' 不是合法时间')
  return date
}

function dayRange(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

/** 备忘录：待办清单，仅本人可见 */
export async function registerMemosModule(app: FastifyInstance): Promise<void> {
  async function owned(id: string, ownerId: string): Promise<MemoRow> {
    const row = await prisma.memo.findUnique({ where: { id } })
    if (!row || row.ownerId !== ownerId) throw AppError.notFound('备忘录不存在或无权访问')
    return row
  }

  app.get('/api/memos', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const query = parseInput(memoQuerySchema, request.query)
    const status: MemoStatus = query.status ?? 'open'
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 100

    const where: Record<string, unknown> = { ownerId: me.id }
    if (status === 'open') where.done = false
    if (status === 'done') where.done = true
    if (query.q?.trim()) {
      const keyword = query.q.trim()
      where.OR = [{ title: { contains: keyword } }, { note: { contains: keyword } }]
    }

    const [total, rows] = await Promise.all([
      prisma.memo.count({ where }),
      prisma.memo.findMany({
        where,
        orderBy: [{ done: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])
    const now = new Date()
    return { items: rows.map((row) => toDTO(row, now)), total, page, pageSize }
  })

  app.get('/api/memos/summary', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const now = new Date()
    const { start, end } = dayRange(now)

    const [open, dueRows] = await Promise.all([
      prisma.memo.findMany({ where: { ownerId: me.id, done: false } }),
      prisma.memo.findMany({
        where: { ownerId: me.id, done: false, dueAt: { not: null, lte: end } },
        orderBy: { dueAt: 'asc' }
      })
    ])

    const openCount = open.length
    const overdueCount = open.filter((row) => row.dueAt !== null && row.dueAt.getTime() < now.getTime()).length
    const today = open.filter((row) => row.dueAt !== null && row.dueAt >= start && row.dueAt < end)
    const dueNow = dueRows.filter((row) => row.remindedAt === null && row.dueAt !== null && row.dueAt.getTime() <= now.getTime())

    const summary: MemoSummaryDTO = {
      openCount,
      overdueCount,
      todayCount: today.length,
      dueNow: dueNow.map((row) => toDTO(row, now)),
      today: today.slice(0, 5).map((row) => toDTO(row, now))
    }
    return summary
  })

  app.post('/api/memos', { preHandler: requireAuth }, async (request, reply) => {
    const me = currentUser(request)
    const input = parseInput(memoInputSchema, request.body)
    const row = await prisma.memo.create({
      data: {
        ownerId: me.id,
        title: input.title,
        note: input.note ?? null,
        dueAt: parseDate(input.dueAt, '截止时间') ?? null
      }
    })
    reply.code(201)
    return toDTO(row)
  })

  app.patch('/api/memos/:id', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const { id } = request.params as { id: string }
    const input = parseInput(memoPatchSchema, request.body)
    const target = await owned(id, me.id)

    const data: Record<string, unknown> = {}
    if (input.title !== undefined) data.title = input.title
    if (input.note !== undefined) data.note = input.note
    if (input.dueAt !== undefined) {
      const dueAt = parseDate(input.dueAt, '截止时间')
      data.dueAt = dueAt ?? null
      // 改了截止时间就允许重新提醒
      if ((dueAt?.getTime() ?? null) !== (target.dueAt?.getTime() ?? null)) data.remindedAt = null
    }
    if (input.done !== undefined && input.done !== target.done) {
      data.done = input.done
      data.doneAt = input.done ? new Date() : null
    }
    if (input.reminded === true) data.remindedAt = new Date()

    if (Object.keys(data).length === 0) return toDTO(target)
    const row = await prisma.memo.update({ where: { id }, data })
    return toDTO(row)
  })

  app.delete('/api/memos/:id', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const { id } = request.params as { id: string }
    await owned(id, me.id)
    await prisma.memo.delete({ where: { id } })
    return { ok: true }
  })
}
