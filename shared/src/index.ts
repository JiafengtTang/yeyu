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
  status: z.enum(USER_STATUSES).optional(),
  /** null 表示移出小组 */
  groupId: z.string().nullable().optional()
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

export const reportSectionInputSchema = z.object({
  key: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  contentHtml: z.string().max(500000).default('')
})
export const reportSaveSchema = z.object({
  week: z.string().optional(),
  title: z.string().max(120).optional(),
  contentHtml: z.string().max(500000).optional(),
  sections: z.array(reportSectionInputSchema).max(30).optional()
})

/** 周报提交截止：全局规则（1=周一 … 7=周日）+ 单周覆盖 */
export const deadlineRuleSchema = z.object({
  weekday: z.coerce.number().int().min(1).max(7),
  time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, '时间格式应为 HH:mm')
})
export const deadlineOverrideSchema = z.object({
  deadline: z.string().min(8),
  reason: z.string().max(200).optional()
})
export const uploadTemplateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  activate: z.union([z.literal('1'), z.literal('0'), z.boolean()]).optional()
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
  groupId: string | null
  groupName: string | null
  createdAt: string
}

export interface GroupDTO {
  id: string
  name: string
  description: string | null
  sortOrder: number
  memberCount: number
  createdAt: string
  updatedAt: string
}

export const groupInputSchema = z.object({
  name: z.string().trim().min(1, '小组名称不能为空').max(32, '名称最多 32 个字符'),
  description: z.string().trim().max(100, '说明最多 100 个字符').optional(),
  sortOrder: z.number().int().min(0).max(9999).optional()
})
export const groupUpdateSchema = groupInputSchema.partial()

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

export interface TemplateSectionDTO {
  key: string
  title: string
  hint: string
}

export interface ReportTemplateDTO {
  id: string
  name: string
  version: number
  sections: TemplateSectionDTO[]
  sourceName: string | null
  sourceFormat: 'docx' | 'md'
  isActive: boolean
  createdAt: string
  reportCount: number
}

export interface ReportSectionDTO extends TemplateSectionDTO {
  contentHtml: string
}

export interface DeadlineDTO {
  week: string
  deadline: string
  source: 'RULE' | 'OVERRIDE'
  weekday: number
  time: string
  overrideReason: string | null
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
  sections: ReportSectionDTO[]
  templateSnapshot: { name: string; sections: TemplateSectionDTO[] } | null
  late: boolean
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
  deadline: DeadlineDTO
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

/* ────────────────────────────── 笔记 / 日报 ────────────────────────────── */

export type NoteKind = 'NOTE' | 'DAILY'
export const NOTE_KINDS: NoteKind[] = ['NOTE', 'DAILY']

export interface NoteSummaryDTO {
  id: string
  kind: NoteKind
  title: string
  day: string | null
  excerpt: string
  tags: string[]
  updatedAt: string
}

export interface NoteLinkRefDTO {
  title: string
  noteId: string | null
}

export interface NoteBacklinkDTO {
  id: string
  title: string
  kind: NoteKind
  day: string | null
}

export interface NoteDTO {
  id: string
  kind: NoteKind
  title: string
  day: string | null
  contentHtml: string
  tags: string[]
  links: NoteLinkRefDTO[]
  backlinks: NoteBacklinkDTO[]
  createdAt: string
  updatedAt: string
}

export interface NoteCalendarDayDTO {
  day: string
  hasContent: boolean
}

export interface NoteGraphDTO {
  nodes: Array<{ id: string; title: string; kind: NoteKind; day: string | null }>
  edges: Array<{ source: string; target: string }>
}

export const noteInputSchema = z.object({
  kind: z.enum(['NOTE', 'DAILY']).optional(),
  title: z.string().trim().max(120, '标题最多 120 字').optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').optional(),
  contentHtml: z.string().max(200_000, '内容过长').optional()
})

export const noteUpdateSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(120, '标题最多 120 字').optional(),
  contentHtml: z.string().max(200_000, '内容过长').optional()
})

export const noteQuerySchema = z.object({
  kind: z.enum(['NOTE', 'DAILY']).optional(),
  q: z.string().max(80).optional(),
  tag: z.string().max(24).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
})

const NOTE_ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** HTML → 纯文本（用于搜索、链接与标签抽取） */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m: string, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m: string, name: string) => NOTE_ENTITY_MAP[name] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 抽取 [[双向链接]] 的目标标题（去重、保持出现顺序） */
export function extractWikilinks(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[\[([^\[\]]{1,64})\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const title = (match[1] ?? '').trim()
    if (!title) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(title)
  }
  return out
}

/** 抽取 #标签（前面须为空白/行首/括号，避免把 a#b 当标签） */
export function extractTags(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /(?:^|[\s(（\[])#([\p{L}\p{N}_-]{1,24})/gu
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const tag = match[1]
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** 极简 HTML → Markdown（导出用） */
export function htmlToMarkdown(html: string): string {
  const decode = (text: string): string =>
    text
      .replace(/&#(\d+);/g, (_m: string, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m: string, name: string) => NOTE_ENTITY_MAP[name] ?? m)

  const md = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m: string, t: string) => '\n# ' + decode(t.replace(/<[^>]+>/g, '')) + '\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m: string, t: string) => '\n## ' + decode(t.replace(/<[^>]+>/g, '')) + '\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m: string, t: string) => '\n### ' + decode(t.replace(/<[^>]+>/g, '')) + '\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_m: string, t: string) => '\n#### ' + decode(t.replace(/<[^>]+>/g, '')) + '\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, t: string) => '- ' + decode(t.replace(/<[^>]+>/g, '')) + '\n')
    .replace(/<img[^>]*src="media:([^"]+)"[^>]*>/gi, (_m: string, id: string) => '\n![图片](media:' + id + ')\n')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m: string, href: string, t: string) => '[' + decode(t.replace(/<[^>]+>/g, '')) + '](' + href + ')')
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m: string, _tag: string, t: string) => '**' + decode(t.replace(/<[^>]+>/g, '')) + '**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m: string, _tag: string, t: string) => '*' + decode(t.replace(/<[^>]+>/g, '')) + '*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m: string, t: string) => '`' + decode(t.replace(/<[^>]+>/g, '')) + '`')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m: string, t: string) => '\n> ' + decode(t.replace(/<[^>]+>/g, '')) + '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')

  return decode(md).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
