import { z, type ZodTypeAny } from 'zod'
import type { Prisma } from '@prisma/client'
import type { AssetQuery } from '@yeyu/shared'
import { AppError } from '../../lib/errors.js'

export function parseInput<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {})
  if (!result.success) throw AppError.validation('参数校验失败', result.error.issues)
  return result.data as z.infer<T>
}

export function pageParams(query: { page?: number; pageSize?: number }): { page: number; pageSize: number; skip: number; take: number } {
  const page = query.page && query.page > 0 ? Math.floor(query.page) : 1
  const pageSize = Math.min(query.pageSize ?? 20, 200)
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function buildAssetWhere(query: AssetQuery): Prisma.AssetWhereInput {
  const where: Prisma.AssetWhereInput = {}
  const keyword = query.q?.trim()
  if (keyword) {
    where.OR = (['code', 'name', 'model', 'serialNo', 'remark'] as const).map((field) => ({
      [field]: { contains: keyword }
    })) as Prisma.AssetWhereInput[]
  }
  if (query.category) where.category = query.category
  if (query.status) where.status = query.status
  if (query.ownerId) where.ownerId = query.ownerId
  if (query.groupId === 'NONE') {
    where.AND = [{ groupId: null }, { OR: [{ ownerId: null }, { owner: { groupId: null } }] }]
  } else if (query.groupId) {
    where.OR = [
      { groupId: query.groupId },
      { groupId: null, owner: { groupId: query.groupId } }
    ]
  }
  return where
}

export function buildAssetOrderBy(query: AssetQuery): Prisma.AssetOrderByWithRelationInput {
  const key = query.sortBy ?? 'updatedAt'
  const dir = query.sortDir ?? 'desc'
  return { [key]: dir } as Prisma.AssetOrderByWithRelationInput
}

export function nullIfEmpty(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
