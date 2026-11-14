import type { ReportSummaryDTO } from '@yeyu/shared'
import type { AuthUser } from '../../plugins/auth'
import { isAdmin } from '../../plugins/auth'
import { prisma } from '../../lib/prisma'
import { weekOf } from '../../lib/time'
import { resolveDeadline } from '../settings/deadline.js'
import { toReportDTO, toUserDTO } from './dto.js'
import { REPORT_INCLUDE } from './query.js'

export function isFinishedStatus(status: string): boolean {
  return status === 'SUBMITTED' || status === 'APPROVED'
}

export async function buildSummary(user: AuthUser, now: Date = new Date()): Promise<ReportSummaryDTO> {
  const { week, periodStart } = weekOf(now)
  // 截止时间来自全局规则/单周覆盖，不再硬编码周日 18:00
  const deadline = await resolveDeadline(week)

  const mine = await prisma.report.findUnique({
    where: { authorId_periodStart: { authorId: user.id, periodStart } },
    include: REPORT_INCLUDE
  })

  const finished = mine !== null && isFinishedStatus(mine.status)
  const isOverdue = deadline.required && now.getTime() > new Date(deadline.deadline).getTime() && !finished

  let admin: ReportSummaryDTO['admin'] = null
  if (isAdmin(user) && deadline.required) {
    const [members, submitted, pendingReview] = await Promise.all([
      prisma.user.findMany({ where: { role: 'MEMBER', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } }),
      prisma.report.findMany({
        where: { periodStart, status: { in: ['SUBMITTED', 'APPROVED'] } },
        select: { authorId: true }
      }),
      prisma.report.count({ where: { status: 'SUBMITTED' } })
    ])
    const done = new Set(submitted.map((row) => row.authorId))
    admin = {
      missing: members.filter((member) => !done.has(member.id)).map(toUserDTO),
      pendingReview
    }
  } else if (isAdmin(user)) {
    // 非提交周：不算未交，但待审阅数仍要看
    const pendingReview = await prisma.report.count({ where: { status: 'SUBMITTED' } })
    admin = { missing: [], pendingReview }
  }

  return { week, mine: mine ? toReportDTO(mine) : null, isOverdue, deadline, admin }
}
