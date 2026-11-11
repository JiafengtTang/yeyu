import { z } from 'zod'

export const ROLES = ['ADMIN', 'MEMBER'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_LABEL: Record<Role, string> = { ADMIN: '管理员', MEMBER: '成员' }

export const USER_STATUSES = ['PENDING', 'ACTIVE', 'DISABLED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]
export const USER_STATUS_LABEL: Record<UserStatus, string> = { PENDING: '待审批', ACTIVE: '已激活', DISABLED: '已禁用' }

export const ASSET_STATUSES = ['IN_USE', 'IDLE', 'BORROWED', 'REPAIR', 'SCRAPPED'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = { IN_USE: '在用', IDLE: '闲置', BORROWED: '借出', REPAIR: '维修中', SCRAPPED: '已报废' }

export const ASSET_CATEGORY_SUGGESTIONS = ['仪器设备', '电脑办公', '软件服务', '耗材', '其他'] as const

export const ATTACHMENT_KINDS = ['PHOTO', 'INVOICE', 'CONTRACT', 'OTHER'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]
export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = { PHOTO: '实物照片', INVOICE: '发票', CONTRACT: '合同', OTHER: '其他' }

export const REPORT_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = { DRAFT: '草稿', SUBMITTED: '已提交', APPROVED: '已通过', REJECTED: '已退回' }
export const REPORT_EDITABLE_STATUSES: ReportStatus[] = ['DRAFT', 'REJECTED']

export const INVENTORY_CHECK_STATUSES = ['PRESENT', 'MISSING', 'DAMAGED', 'UNKNOWN'] as const
export type InventoryCheckStatus = (typeof INVENTORY_CHECK_STATUSES)[number]
export const INVENTORY_CHECK_LABEL: Record<InventoryCheckStatus, string> = { PRESENT: '在册', MISSING: '找不到', DAMAGED: '损坏', UNKNOWN: '待查' }
export const INVENTORY_RESULTS = ['PENDING', 'MATCH', 'MISMATCH', 'MISSING'] as const
export type InventoryResult = (typeof INVENTORY_RESULTS)[number]
export const INVENTORY_RESULT_LABEL: Record<InventoryResult, string> = { PENDING: '未盘', MATCH: '一致', MISMATCH: '异常', MISSING: '缺失' }

export const ENTITY_TYPES = ['ASSET', 'USER', 'REPORT', 'BORROW', 'INVENTORY'] as const
export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'REGISTER', 'IMPORT', 'EXPORT', 'BORROW', 'RETURN', 'SUBMIT', 'REVIEW'] as const

export const API_ERROR_CODES = ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'CONFLICT', 'REPORT_LOCKED', 'INTERNAL'] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const PHONE_REGEX = /^1[3-9][0-9]{9}$/
export const phoneSchema = z.string().regex(PHONE_REGEX, '手机号格式不正确')
export const passwordSchema = z.string().min(6, '密码至少 6 位').max(64)

export const registerSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  name: z.string().min(1).max(32),
  email: z.string().email().optional()
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({ phone: phoneSchema, password: z.string().min(1) })
export type LoginInput = z.infer<typeof loginSchema>

export const createUserSchema = registerSchema.extend({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional()
})
export const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional()
})
export const resetPasswordSchema = z.object({ password: passwordSchema })

export const assetInputSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(32),
  model: z.string().max(120).optional(),
  serialNo: z.string().max(120).optional(),
  quantity: z.number().int().min(1).max(100000).optional(),
  unitPrice: z.number().min(0).optional(),
  amount: z.number().min(0).optional(),
  purchaseDate: z.string().min(8).optional(),
  supplier: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  ownerId: z.string().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  remark: z.string().max(2000).optional()
})
export type AssetInput = z.infer<typeof assetInputSchema>
export const assetPatchSchema = assetInputSchema.partial()

export const assetQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  ownerId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  sortBy: z.enum(['code', 'name', 'amount', 'purchaseDate', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional()
})
export type AssetQuery = z.infer<typeof assetQuerySchema>

export const borrowInputSchema = z.object({
  borrowerId: z.string().optional(),
  dueAt: z.string().optional(),
  note: z.string().max(500).optional()
})
export const inventoryCreateSchema = z.object({
  name: z.string().min(1).max(64),
  category: z.string().optional(),
  ownerId: z.string().optional()
})
export const inventoryCheckSchema = z.object({
  actualStatus: z.enum(INVENTORY_CHECK_STATUSES),
  actualLocation: z.string().max(200).optional(),
  note: z.string().max(500).optional()
})

export const reportSaveSchema = z.object({
  week: z.string().optional(),
  title: z.string().max(120).optional(),
  contentHtml: z.string().max(500000).optional()
})
export const reportReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(2000).optional()
})
export const commentInputSchema = z.object({ body: z.string().min(1).max(2000) })

export interface UserDTO {
  id: string
  phone: string
  name: string
  email: string | null
  role: Role
  status: UserStatus
  createdAt: string
}

export interface MediaDTO {
  id: string
  filename: string
  mime: string
  size: number
  url: string
}

export interface AssetAttachmentDTO {
  id: string
  kind: AttachmentKind
  media: MediaDTO
  createdAt: string
}

export interface BorrowDTO {
  id: string
  assetId: string
  borrowerId: string
  borrowerName: string | null
  borrowedAt: string
  dueAt: string | null
  returnedAt: string | null
  note: string | null
}

export interface AssetDTO {
  id: string
  code: string
  name: string
  category: string
  model: string | null
  serialNo: string | null
  quantity: number
  unitPrice: number | null
  amount: number | null
  purchaseDate: string | null
  supplier: string | null
  location: string | null
  ownerId: string | null
  ownerName: string | null
  status: AssetStatus
  remark: string | null
  createdAt: string
  updatedAt: string
  attachments: AssetAttachmentDTO[]
  activeBorrow: BorrowDTO | null
}

export interface InventoryItemDTO {
  id: string
  batchId: string
  assetId: string
  assetCode: string
  assetName: string
  expectedStatus: string
  expectedLocation: string | null
  actualStatus: InventoryCheckStatus | null
  actualLocation: string | null
  result: InventoryResult
  checkedById: string | null
  checkedAt: string | null
  note: string | null
}

export interface InventoryBatchDTO {
  id: string
  name: string
  createdById: string
  creatorName: string
  createdAt: string
  closedAt: string | null
  total: number
  checked: number
  mismatched: number
  items?: InventoryItemDTO[]
}

export interface AuditDTO {
  id: string
  userId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  beforeJson: string | null
  afterJson: string | null
  ip: string | null
  createdAt: string
}

export interface ReportCommentDTO {
  id: string
  reportId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

export interface ReportDTO {
  id: string
  authorId: string
  authorName: string
  week: string
  periodStart: string
  periodEnd: string
  title: string
  contentHtml: string
  status: ReportStatus
  submittedAt: string | null
  reviewedById: string | null
  reviewerName: string | null
  reviewedAt: string | null
  reviewComment: string | null
  createdAt: string
  updatedAt: string
  comments: ReportCommentDTO[]
}

export interface ReportSummaryDTO {
  week: string
  mine: ReportDTO | null
  isOverdue: boolean
  admin: { missing: UserDTO[]; pendingReview: number } | null
}

export interface ListResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown }
}

export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return String(d.getUTCFullYear()) + '-W' + String(weekNo).padStart(2, '0')
}

export function weekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = d.getDay() === 0 ? 7 : d.getDay()
  const start = new Date(d)
  start.setDate(d.getDate() - (day - 1))
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

export function weekKeyToRange(week: string): { start: Date; end: Date } | null {
  const m = /^([0-9]{4})-W([0-9]{2})$/.exec(week)
  if (!m) return null
  const year = Number(m[1])
  const wk = Number(m[2])
  const simple = new Date(year, 0, 1 + (wk - 1) * 7)
  return weekRange(simple)
}

export function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
