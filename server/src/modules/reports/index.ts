import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  REPORT_EDITABLE_STATUSES,
  REPORT_STATUSES,
  commentInputSchema,
  reportReviewSchema,
  reportSaveSchema
} from '@lab/shared'
import type { ReportStatus } from '@lab/shared'
import { AppError } from '../../lib/errors'
import { prisma } from '../../lib/prisma'
import { recordAudit } from '../../lib/audit'
import { currentUser, isAdmin, requestIp, requireAdmin, requireAuth } from '../../plugins/auth'
import { iso, resolveWeek } from '../../lib/time'
import { toCommentDTO, toReportDTO } from './dto.js'
import { COMMENT_INCLUDE, REPORT_INCLUDE } from './query.js'
import {
  initializeSections,
  loadActiveTemplate,
  mergeSectionInputs,
  parseReportSections,
  snapshotJson
} from './sections.js'
import { buildSummary } from './summary.js'
import { resolveDeadline } from '../settings/deadline.js'
import { buildReportDocx, docxFilename } from './export-docx.js'

const WEEK_RE = /^[0-9]{4}-W[0-9]{2}$/
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const reportQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  authorId: z.string().min(1).optional(),
  week: z.string().regex(WEEK_RE, '周次格式应为 YYYY-Www').optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional()
})

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {})
  if (!result.success) throw AppError.validation('参数校验失败', result.error.issues)
  return result.data
}

function editable(status: string): boolean {
  return REPORT_EDITABLE_STATUSES.includes(status as ReportStatus)
}

/** 正文是否为空：只有空白/标签视为空；含图片视为有内容 */
export function isBlankContent(html: string): boolean {
  if (/<img\b/i.test(html)) return false
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim()
  return text.length === 0
}

function resolveWeekInput(week: string | undefined): { week: string; periodStart: Date; periodEnd: Date } {
  if (!week) return resolveWeek()
  if (!WEEK_RE.test(week)) throw AppError.validation('周次格式应为 YYYY-Www')
  return resolveWeek(week)
}

export async function registerReportsModule(app: FastifyInstance): Promise<void> {
  app.get('/api/reports/summary', { preHandler: requireAuth }, async (req) => {
    return buildSummary(currentUser(req))
  })

  app.get('/api/reports', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const query = parse(reportQuerySchema, req.query)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    const where: Record<string, unknown> = {}
    if (isAdmin(user)) {
      if (query.authorId) where.authorId = query.authorId
    } else {
      where.authorId = user.id
    }
    if (query.status) where.status = query.status
    if (query.week) where.week = query.week

    const [total, rows] = await Promise.all([
      prisma.report.count({ where }),
      prisma.report.findMany({
        where,
        include: REPORT_INCLUDE,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])

    return { items: rows.map(toReportDTO), total, page, pageSize }
  })

  app.get('/api/reports/:id', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const report = await prisma.report.findUnique({ where: { id }, include: REPORT_INCLUDE })
    if (!report) throw AppError.notFound('周报不存在')
    if (!isAdmin(user) && report.authorId !== user.id) throw AppError.forbidden('只能查看自己的周报')
    return toReportDTO(report)
  })

  app.post('/api/reports', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    const input = parse(reportSaveSchema, req.body)
    const { week, periodStart, periodEnd } = resolveWeekInput(input.week)

    const existing = await prisma.report.findUnique({
      where: { authorId_periodStart: { authorId: user.id, periodStart } }
    })
    if (existing && !editable(existing.status)) {
      throw AppError.locked('周报已提交，需管理员退回后才能修改')
    }

    const template = await loadActiveTemplate()
    const existingSections = parseReportSections(existing?.sectionsJson)
    const incoming = input.sections ?? []
    const sections =
      incoming.length > 0
        ? mergeSectionInputs(incoming, existingSections, template)
        : existingSections.length > 0
          ? existingSections
          : initializeSections(template)

    const data = {
      week,
      periodStart,
      periodEnd,
      title: input.title ?? existing?.title ?? '',
      contentHtml: input.contentHtml ?? existing?.contentHtml ?? '',
      sectionsJson: JSON.stringify(sections),
      templateId: existing?.templateId ?? template?.id ?? null,
      templateSnapshotJson: existing?.templateSnapshotJson ?? (template ? snapshotJson(template) : null)
    }

    const saved = existing
      ? await prisma.report.update({ where: { id: existing.id }, data, include: REPORT_INCLUDE })
      : await prisma.report.create({ data: { ...data, authorId: user.id, status: 'DRAFT' }, include: REPORT_INCLUDE })

    await recordAudit({
      actor: user,
      action: existing ? 'UPDATE' : 'CREATE',
      entityType: 'REPORT',
      entityId: saved.id,
      before: existing ? { title: existing.title, contentHtml: existing.contentHtml } : null,
      after: { week: saved.week, title: saved.title, sections: sections.length },
      ip: requestIp(req)
    })

    return reply.status(201).send(toReportDTO(saved))
  })

  app.patch('/api/reports/:id', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const input = parse(reportSaveSchema, req.body)

    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw AppError.notFound('周报不存在')
    if (report.authorId !== user.id) throw AppError.forbidden('只能修改自己的周报')
    if (!editable(report.status)) {
      throw AppError.locked('周报已提交，需管理员退回后才能修改')
    }

    const template = await loadActiveTemplate()
    const currentSections = parseReportSections(report.sectionsJson)
    const incoming = input.sections ?? []
    const merged = incoming.length > 0 ? mergeSectionInputs(incoming, currentSections, template) : currentSections
    const sections = merged.length > 0 ? merged : initializeSections(template)

    const nextTitle = input.title ?? report.title
    const nextHtml = input.contentHtml ?? report.contentHtml
    const before: Record<string, unknown> = {}
    if (nextTitle !== report.title) before.title = report.title
    if (nextHtml !== report.contentHtml) before.contentHtml = report.contentHtml
    if (currentSections.length !== sections.length) before.sections = currentSections.length

    const saved = await prisma.report.update({
      where: { id },
      data: {
        title: nextTitle,
        contentHtml: nextHtml,
        sectionsJson: JSON.stringify(sections),
        templateId: report.templateId ?? template?.id ?? null,
        templateSnapshotJson: report.templateSnapshotJson ?? (template ? snapshotJson(template) : null)
      },
      include: REPORT_INCLUDE
    })

    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'REPORT',
      entityId: saved.id,
      before,
      after: { title: nextTitle, contentHtml: nextHtml, sections: sections.length },
      ip: requestIp(req)
    })

    return toReportDTO(saved)
  })

  app.post('/api/reports/:id/submit', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }

    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw AppError.notFound('周报不存在')
    if (report.authorId !== user.id) throw AppError.forbidden('只能提交自己的周报')
    if (!editable(report.status)) throw AppError.locked('周报已提交，需管理员退回后才能重新提交')

    const template = await loadActiveTemplate()
    const sections = parseReportSections(report.sectionsJson)
    if (sections.length > 0) {
      const missing = sections.find((section) => isBlankContent(section.contentHtml))
      if (missing) throw AppError.validation('《' + missing.title + '》未填写')
    } else {
      // 存在生效模版却没小节（旧草稿）→ 同样按缺节拒绝
      const firstSection = template?.sections[0]
      if (firstSection) throw AppError.validation('《' + firstSection.title + '》未填写')
      if (isBlankContent(report.contentHtml)) throw AppError.validation('周报正文不能为空')
    }

    // 过期只标记迟交，不阻断提交
    const deadline = await resolveDeadline(report.week)
    const submittedAt = new Date()
    const late = submittedAt.getTime() > new Date(deadline.deadline).getTime()

    const saved = await prisma.report.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt,
        late,
        sectionsJson: JSON.stringify(sections),
        templateId: report.templateId ?? template?.id ?? null,
        templateSnapshotJson: report.templateSnapshotJson ?? (template ? snapshotJson(template) : null),
        reviewedById: null,
        reviewedAt: null,
        reviewComment: null
      },
      include: REPORT_INCLUDE
    })

    await recordAudit({
      actor: user,
      action: 'SUBMIT',
      entityType: 'REPORT',
      entityId: saved.id,
      before: { status: report.status },
      after: { status: saved.status, submittedAt: iso(saved.submittedAt), late: saved.late },
      ip: requestIp(req)
    })

    return toReportDTO(saved)
  })

  app.post('/api/reports/:id/review', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const input = parse(reportReviewSchema, req.body)

    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw AppError.notFound('周报不存在')
    if (report.status !== 'SUBMITTED') throw AppError.conflict('只有已提交的周报可以审阅')

    const saved = await prisma.report.update({
      where: { id },
      data: {
        status: input.decision,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewComment: input.comment ?? null
      },
      include: REPORT_INCLUDE
    })

    await recordAudit({
      actor: user,
      action: 'REVIEW',
      entityType: 'REPORT',
      entityId: saved.id,
      before: { status: report.status },
      after: { status: saved.status, comment: saved.reviewComment },
      ip: requestIp(req)
    })

    return toReportDTO(saved)
  })

  app.post('/api/reports/:id/comments', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const input = parse(commentInputSchema, req.body)

    const report = await prisma.report.findUnique({ where: { id }, select: { id: true, authorId: true } })
    if (!report) throw AppError.notFound('周报不存在')
    if (!isAdmin(user) && report.authorId !== user.id) throw AppError.forbidden('只能评论自己的周报')

    const comment = await prisma.reportComment.create({
      data: { reportId: id, authorId: user.id, body: input.body },
      include: COMMENT_INCLUDE
    })

    await recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'REPORT',
      entityId: id,
      after: { commentId: comment.id },
      ip: requestIp(req)
    })

    return reply.status(201).send(toCommentDTO(comment))
  })

  app.get('/api/reports/:id/export.docx', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const report = await prisma.report.findUnique({ where: { id }, include: REPORT_INCLUDE })
    if (!report) throw AppError.notFound('周报不存在')
    if (!isAdmin(user) && report.authorId !== user.id) throw AppError.forbidden('只能导出自己的周报')

    const dto = toReportDTO(report)
    const buffer = await buildReportDocx(dto)
    const filename = docxFilename(dto)

    reply.header('Content-Type', DOCX_MIME)
    reply.header('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename))
    reply.header('Content-Length', String(buffer.byteLength))
    return reply.send(buffer)
  })
}
