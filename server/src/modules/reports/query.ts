import type { Prisma } from '@prisma/client'

export const REPORT_INCLUDE = {
  author: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  comments: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' }
  }
} satisfies Prisma.ReportInclude

export const COMMENT_INCLUDE = {
  author: { select: { id: true, name: true } }
} satisfies Prisma.ReportCommentInclude
