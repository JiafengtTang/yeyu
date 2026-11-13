import type { FastifyInstance } from 'fastify'
import {
  extractTags,
  extractWikilinks,
  htmlToMarkdown,
  htmlToPlainText,
  noteInputSchema,
  noteQuerySchema,
  noteUpdateSchema
} from '@yeyu/shared'
import type { NoteBacklinkDTO, NoteDTO, NoteKind, NoteLinkRefDTO } from '@yeyu/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { currentUser, requireAuth } from '../../plugins/auth.js'
import { parseInput } from '../users/shared.js'

const EXCERPT_LENGTH = 120

function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function excerptOf(plainText: string): string {
  const flat = plainText.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? flat.slice(0, EXCERPT_LENGTH) + '…' : flat
}

interface NoteRow {
  id: string
  kind: string
  title: string
  day: string | null
  contentHtml: string
  plainText: string
  tagsJson: string
  createdAt: Date
  updatedAt: Date
}

/** 把正文里的 [[链接]] 与 #标签 落库：重建出链、解析目标笔记 */
async function syncDerived(noteId: string, ownerId: string, contentHtml: string): Promise<void> {
  const plainText = htmlToPlainText(contentHtml)
  const tags = extractTags(plainText)
  const titles = extractWikilinks(plainText)

  await prisma.$transaction([
    prisma.note.update({
      where: { id: noteId },
      data: { plainText, tagsJson: JSON.stringify(tags) }
    }),
    prisma.noteLink.deleteMany({ where: { sourceId: noteId } })
  ])

  for (const title of titles) {
    const target = await prisma.note.findFirst({
      where: { ownerId, title, NOT: { id: noteId } },
      select: { id: true }
    })
    await prisma.noteLink.create({ data: { sourceId: noteId, targetId: target?.id ?? null, targetTitle: title } })
  }
}

/** 新建或改名后，把此前指向同名标题的未解析链接接上 */
async function resolveDanglingLinks(ownerId: string, noteId: string, title: string): Promise<void> {
  await prisma.noteLink.updateMany({
    where: { targetId: null, targetTitle: title, source: { ownerId } },
    data: { targetId: noteId }
  })
}

async function toDetail(row: NoteRow): Promise<NoteDTO> {
  const [linkRows, backlinkRows] = await Promise.all([
    prisma.noteLink.findMany({ where: { sourceId: row.id }, orderBy: { targetTitle: 'asc' } }),
    prisma.noteLink.findMany({
      where: { targetId: row.id },
      include: { source: { select: { id: true, title: true, kind: true, day: true } } },
      orderBy: { id: 'asc' }
    })
  ])

  const links: NoteLinkRefDTO[] = linkRows.map((link) => ({ title: link.targetTitle, noteId: link.targetId }))
  const backlinks: NoteBacklinkDTO[] = backlinkRows.map((link) => ({
    id: link.source.id,
    title: link.source.title,
    kind: link.source.kind as NoteKind,
    day: link.source.day ?? null
  }))

  return {
    id: row.id,
    kind: row.kind as NoteKind,
    title: row.title,
    day: row.day ?? null,
    contentHtml: row.contentHtml,
    tags: parseTags(row.tagsJson),
    links,
    backlinks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

/** 日报：按 用户+日期 取或建（标题就是日期） */
async function ensureDaily(ownerId: string, day: string): Promise<NoteRow> {
  const existing = await prisma.note.findFirst({ where: { ownerId, day } })
  if (existing) return existing
  return prisma.note.create({ data: { ownerId, kind: 'DAILY', day, title: day, contentHtml: '' } })
}

export async function registerNotesModule(app: FastifyInstance): Promise<void> {
  async function ownedNote(id: string, ownerId: string): Promise<NoteRow> {
    const row = await prisma.note.findUnique({ where: { id } })
    if (!row || row.ownerId !== ownerId) throw AppError.notFound('笔记不存在或无权访问')
    return row
  }

  app.get('/api/notes', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const query = parseInput(noteQuerySchema, request.query)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    const where: Record<string, unknown> = { ownerId: me.id }
    if (query.kind) where.kind = query.kind
    if (query.q) {
      const keyword = query.q.trim()
      if (keyword) where.OR = [{ title: { contains: keyword } }, { plainText: { contains: keyword } }]
    }
    if (query.tag) where.tagsJson = { contains: '"' + query.tag + '"' }

    const [total, rows] = await Promise.all([
      prisma.note.count({ where }),
      prisma.note.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind as NoteKind,
        title: row.title,
        day: row.day ?? null,
        excerpt: excerptOf(row.plainText),
        tags: parseTags(row.tagsJson),
        updatedAt: row.updatedAt.toISOString()
      })),
      total,
      page,
      pageSize
    }
  })

  app.get('/api/notes/tags', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const rows = await prisma.note.findMany({ where: { ownerId: me.id }, select: { tagsJson: true } })
    const counts = new Map<string, number>()
    for (const row of rows) {
      for (const tag of parseTags(row.tagsJson)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    const items = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    return { items, total: items.length }
  })

  app.get('/api/notes/calendar', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const month = String((request.query as { month?: string }).month ?? dayKey(new Date()).slice(0, 7))
    if (!/^\d{4}-\d{2}$/.test(month)) throw AppError.validation('month 格式应为 YYYY-MM')

    const rows = await prisma.note.findMany({
      where: { ownerId: me.id, kind: 'DAILY', day: { startsWith: month } },
      select: { day: true, plainText: true }
    })
    const items = rows
      .filter((row): row is { day: string; plainText: string } => Boolean(row.day))
      .map((row) => ({ day: row.day, hasContent: row.plainText.trim().length > 0 }))
      .sort((a, b) => a.day.localeCompare(b.day))
    return { items, total: items.length }
  })

  app.get('/api/notes/graph', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const notes = await prisma.note.findMany({
      where: { ownerId: me.id },
      select: { id: true, title: true, kind: true, day: true },
      orderBy: { updatedAt: 'desc' },
      take: 300
    })
    const ids = new Set(notes.map((note) => note.id))
    const links = await prisma.noteLink.findMany({
      where: { sourceId: { in: [...ids] }, targetId: { not: null } },
      select: { sourceId: true, targetId: true }
    })
    return {
      nodes: notes.map((note) => ({ id: note.id, title: note.title, kind: note.kind as NoteKind, day: note.day ?? null })),
      edges: links
        .filter((link): link is { sourceId: string; targetId: string } => Boolean(link.targetId && ids.has(link.targetId)))
        .map((link) => ({ source: link.sourceId, target: link.targetId }))
    }
  })

  app.get('/api/notes/daily', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const day = String((request.query as { day?: string }).day ?? dayKey(new Date()))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw AppError.validation('day 格式应为 YYYY-MM-DD')
    return toDetail(await ensureDaily(me.id, day))
  })

  app.post('/api/notes', { preHandler: requireAuth }, async (request, reply) => {
    const me = currentUser(request)
    const input = parseInput(noteInputSchema, request.body)
    const kind: NoteKind = input.kind ?? 'NOTE'

    if (kind === 'DAILY') {
      const day = input.day ?? dayKey(new Date())
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw AppError.validation('day 格式应为 YYYY-MM-DD')
      const row = await ensureDaily(me.id, day)
      reply.code(200)
      return toDetail(row)
    }

    const title = (input.title ?? '').trim()
    if (!title) throw AppError.validation('笔记标题不能为空')

    const row = await prisma.note.create({
      data: { ownerId: me.id, kind: 'NOTE', title, contentHtml: input.contentHtml ?? '' }
    })
    if (input.contentHtml) await syncDerived(row.id, me.id, input.contentHtml)
    await resolveDanglingLinks(me.id, row.id, row.title)
    reply.code(201)
    return toDetail(row)
  })

  app.get('/api/notes/:id', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const { id } = request.params as { id: string }
    return toDetail(await ownedNote(id, me.id))
  })

  app.patch('/api/notes/:id', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const { id } = request.params as { id: string }
    const input = parseInput(noteUpdateSchema, request.body)
    const target = await ownedNote(id, me.id)

    const row = await prisma.note.update({
      where: { id },
      data: {
        title: input.title ?? target.title,
        contentHtml: input.contentHtml === undefined ? target.contentHtml : input.contentHtml
      }
    })
    if (input.contentHtml !== undefined) await syncDerived(id, me.id, input.contentHtml)
    if (row.title !== target.title) await resolveDanglingLinks(me.id, id, row.title)
    return toDetail(row)
  })

  app.delete('/api/notes/:id', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request)
    const { id } = request.params as { id: string }
    await ownedNote(id, me.id)
    await prisma.note.delete({ where: { id } })
    return { ok: true }
  })

  app.get('/api/notes/:id/markdown', { preHandler: requireAuth }, async (request, reply) => {
    const me = currentUser(request)
    const { id } = request.params as { id: string }
    const row = await ownedNote(id, me.id)
    const body = '# ' + row.title + '\n\n' + htmlToMarkdown(row.contentHtml)
    reply.type('text/markdown; charset=utf-8')
    return body
  })
}
