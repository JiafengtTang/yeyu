import type { Role, UserDTO, UserStatus } from '@yeyu/shared'
import type { ZodType } from 'zod'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'

export interface UserRecord {
  id: string
  phone: string
  name: string
  email: string | null
  role: string
  status: string
  createdAt: Date
}

export function toUserDTO(user: UserRecord): UserDTO {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    status: user.status as UserStatus,
    createdAt: user.createdAt.toISOString()
  }
}

export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw AppError.validation('参数校验失败', parsed.error.issues)
  return parsed.data
}

/** 审计快照：只含可公开字段，永不包含 passwordHash。 */
export function userAuditSnapshot(user: UserRecord): Record<string, string | null> {
  return { id: user.id, phone: user.phone, name: user.name, role: user.role, status: user.status }
}

export async function ensureNotLastActiveAdmin(target: UserRecord, next: { role: string; status: string }): Promise<void> {
  if (target.role !== 'ADMIN' || target.status !== 'ACTIVE') return
  if (next.role === 'ADMIN' && next.status === 'ACTIVE') return
  const otherActiveAdmins = await prisma.user.count({
    where: { role: 'ADMIN', status: 'ACTIVE', id: { not: target.id } }
  })
  if (otherActiveAdmins === 0) throw AppError.conflict('不能降级或禁用最后一个已激活的管理员')
}
