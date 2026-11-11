import type { ReportSummaryDTO } from '@lab/shared'
import type { AuthUser } from '../../plugins/auth'
import { isAdmin } from '../../plugins/auth'
import { prisma } from '../../lib/prisma'
import { weekOf } from '../../lib/time'
import { toReportDTO, toUserDTO } from './dto.js'
import { REPORT_INCLUDE } from './query.js'

/** 周日 18:00 为本周提交截止时刻 */
export function overdueDeadline(periodStart: Date): Date {
  const deadline = new Date(periodStart)
  deadline.setDate(deadline.getDate() + 6)
  deadline.setHours(18, 0, 0, 0)
  return deadline
}

export function isFinishedStatus(status: string): boolean {
  return status === 'SUBMITTED' || status === 'APPROVED'
}

export async function buildSummary(user: AuthUser, now: Date = new Date()): Promise<ReportSummaryDTO> {
  const { week, periodStart } = weekOf(now)
  const mine = await prisma.report.findUnique({
    where: { authorId_periodStart: { authorId: user.id, periodStart } },
    include: REPORT_INCLUDE
  })

  const finished = mine !== null && isFinishedStatus(mine.status)
  const isOverdue = now.getTime() > overdueDeadline(periodStart).getTime() && !finished

  let admin: ReportSummaryDTO['admin'] = null
  if (isAdmin(user)) {
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
  }

  return { week, mine: mine ? toReportDTO(mine) : null, isOverdue, admin }
}
