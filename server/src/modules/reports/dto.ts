import type { ReportCommentDTO, ReportDTO, ReportStatus, UserDTO } from '@yeyu/shared'
import { parseReportSections, parseTemplateSnapshot } from './sections.js'

export interface UserRef {
  id: string
  name: string
}

export interface CommentRow {
  id: string
  reportId: string
  authorId: string
  body: string
  createdAt: Date
  author: UserRef
}

export interface ReportRow {
  id: string
  authorId: string
  periodStart: Date
  periodEnd: Date
  week: string
  title: string
  contentHtml: string
  sectionsJson: string
  templateSnapshotJson: string | null
  late: boolean
  status: string
  submittedAt: Date | null
  reviewedById: string | null
  reviewedAt: Date | null
  reviewComment: string | null
  createdAt: Date
  updatedAt: Date
  author: UserRef
  reviewedBy: UserRef | null
  comments: CommentRow[]
}

export function toCommentDTO(row: CommentRow): ReportCommentDTO {
  return {
    id: row.id,
    reportId: row.reportId,
    authorId: row.authorId,
    authorName: row.author?.name ?? '',
    body: row.body,
    createdAt: row.createdAt.toISOString()
  }
}

export function toReportDTO(row: ReportRow): ReportDTO {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.author?.name ?? '',
    week: row.week,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    title: row.title,
    contentHtml: row.contentHtml,
    sections: parseReportSections(row.sectionsJson),
    templateSnapshot: parseTemplateSnapshot(row.templateSnapshotJson),
    late: row.late,
    status: row.status as ReportStatus,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    reviewedById: row.reviewedById,
    reviewerName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewComment: row.reviewComment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    comments: (row.comments ?? []).map(toCommentDTO)
  }
}

export interface UserRow {
  id: string
  phone: string
  name: string
  email: string | null
  role: string
  status: string
  groupId?: string | null
  group?: { name: string } | null
  createdAt: Date
}

export function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    email: row.email,
    role: row.role as UserDTO['role'],
    status: row.status as UserDTO['status'],
    groupId: row.groupId ?? null,
    groupName: row.group?.name ?? null,
    createdAt: row.createdAt.toISOString()
  }
}
