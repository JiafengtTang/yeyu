import type { FastifyInstance } from 'fastify'
import type { MultipartFields } from '@fastify/multipart'
import { Prisma } from '@prisma/client'
import { ATTACHMENT_KINDS, assetInputSchema, assetPatchSchema, assetQuerySchema, type AttachmentKind } from '@yeyu/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { recordAudit } from '../../lib/audit.js'
import { saveUpload } from '../../lib/storage.js'
import { iso, parseDateInput } from '../../lib/time.js'
import { canEditAsset, currentUser, isAdmin, requestIp, requireAdmin, requireAuth } from '../../plugins/auth.js'
import type { AuthUser } from '../../plugins/auth.js'
import { ASSET_INCLUDE, ATTACHMENT_INCLUDE, toAssetDTO, toAttachmentDTO } from './dto.js'
import { buildAssetOrderBy, buildAssetWhere, nullIfEmpty, pageParams, parseInput } from './helpers.js'

function parsePurchaseDate(value?: string): Date | null {
  if (value === undefined || value.trim() === '') return null
  const date = parseDateInput(value)
  if (!date) throw AppError.validation('购置日期格式不正确')
  return date
}

async function ensureUserExists(id: string): Promise<void> {
  const found = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!found) throw AppError.validation('责任人不存在')
}

async function resolveOwnerForCreate(user: AuthUser, raw?: string): Promise<string> {
  const value = raw?.trim()
  if (!value) return user.id
  if (!isAdmin(user) && value !== user.id) throw AppError.forbidden('成员只能把自己设为责任人')
  await ensureUserExists(value)
  return value
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

function textField(fields: MultipartFields, name: string): string | undefined {
  const raw = fields[name]
  if (!raw) return undefined
  const item = Array.isArray(raw) ? raw[0] : raw
  if (!item || item.type !== 'field') return undefined
  return typeof item.value === 'string' ? item.value : undefined
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/assets', { preHandler: requireAuth }, async (req) => {
    const query = parseInput(assetQuerySchema, req.query)
    const { page, pageSize, skip, take } = pageParams(query)
    const where = buildAssetWhere(query)
    const [total, rows] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({ where, include: ASSET_INCLUDE, orderBy: buildAssetOrderBy(query), skip, take })
    ])
    return { items: rows.map(toAssetDTO), total, page, pageSize }
  })

  app.get('/api/assets/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const row = await prisma.asset.findUnique({ where: { id }, include: ASSET_INCLUDE })
    if (!row) throw AppError.notFound('资产不存在')
    return toAssetDTO(row)
  })

  app.post('/api/assets', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    const input = parseInput(assetInputSchema, req.body)
    const ownerId = await resolveOwnerForCreate(user, input.ownerId)
    const quantity = input.quantity ?? 1
    const amount = input.amount ?? (input.unitPrice !== undefined ? Number((input.unitPrice * quantity).toFixed(2)) : null)
    const data: Prisma.AssetUncheckedCreateInput = {
      code: input.code.trim(),
      name: input.name.trim(),
      category: input.category.trim(),
      model: nullIfEmpty(input.model) ?? null,
      serialNo: nullIfEmpty(input.serialNo) ?? null,
      quantity,
      unitPrice: input.unitPrice ?? null,
      amount,
      purchaseDate: parsePurchaseDate(input.purchaseDate),
      supplier: nullIfEmpty(input.supplier) ?? null,
      location: nullIfEmpty(input.location) ?? null,
      ownerId,
      status: input.status ?? 'IN_USE',
      remark: nullIfEmpty(input.remark) ?? null,
      createdById: user.id
    }
    let created
    try {
      created = await prisma.asset.create({ data, include: ASSET_INCLUDE })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('资产编码已存在')
      throw err
    }
    await recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'ASSET',
      entityId: created.id,
      after: { code: created.code, name: created.name, ownerId: created.ownerId, status: created.status },
      ip: requestIp(req)
    })
    return reply.status(201).send(toAssetDTO(created))
  })

  app.patch('/api/assets/:id', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const patch = parseInput(assetPatchSchema, req.body)
    const asset = await prisma.asset.findUnique({ where: { id } })
    if (!asset) throw AppError.notFound('资产不存在')
    if (!canEditAsset(user, asset)) throw AppError.forbidden('只能修改自己负责的资产')

    const data: Prisma.AssetUncheckedUpdateInput = {}
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    const setField = <K extends keyof Prisma.AssetUncheckedUpdateInput>(
      key: K,
      current: unknown,
      next: Prisma.AssetUncheckedUpdateInput[K]
    ) => {
      data[key] = next
      changes[String(key)] = { before: current, after: next }
    }

    if (patch.code !== undefined && patch.code.trim() !== asset.code) setField('code', asset.code, patch.code.trim())
    if (patch.name !== undefined && patch.name.trim() !== asset.name) setField('name', asset.name, patch.name.trim())
    if (patch.category !== undefined && patch.category.trim() !== asset.category) {
      setField('category', asset.category, patch.category.trim())
    }
    const model = nullIfEmpty(patch.model)
    if (model !== undefined && model !== asset.model) setField('model', asset.model, model)
    const serialNo = nullIfEmpty(patch.serialNo)
    if (serialNo !== undefined && serialNo !== asset.serialNo) setField('serialNo', asset.serialNo, serialNo)
    if (patch.quantity !== undefined && patch.quantity !== asset.quantity) setField('quantity', asset.quantity, patch.quantity)
    if (patch.unitPrice !== undefined && patch.unitPrice !== asset.unitPrice) setField('unitPrice', asset.unitPrice, patch.unitPrice)
    if (patch.amount !== undefined && patch.amount !== asset.amount) setField('amount', asset.amount, patch.amount)
    if (patch.purchaseDate !== undefined) {
      const next = parsePurchaseDate(patch.purchaseDate)
      if ((next?.getTime() ?? null) !== (asset.purchaseDate?.getTime() ?? null)) {
        setField('purchaseDate', iso(asset.purchaseDate), next)
      }
    }
    const supplier = nullIfEmpty(patch.supplier)
    if (supplier !== undefined && supplier !== asset.supplier) setField('supplier', asset.supplier, supplier)
    const location = nullIfEmpty(patch.location)
    if (location !== undefined && location !== asset.location) setField('location', asset.location, location)
    const remark = nullIfEmpty(patch.remark)
    if (remark !== undefined && remark !== asset.remark) setField('remark', asset.remark, remark)
    if (patch.status !== undefined && patch.status !== asset.status) setField('status', asset.status, patch.status)
    if (patch.ownerId !== undefined) {
      const raw = patch.ownerId.trim()
      const nextOwner = raw === '' ? null : raw
      if (!isAdmin(user) && nextOwner !== asset.ownerId) throw AppError.forbidden('成员不能修改责任人')
      if (nextOwner !== asset.ownerId) {
        if (nextOwner) await ensureUserExists(nextOwner)
        setField('ownerId', asset.ownerId, nextOwner)
      }
    }

    const changedKeys = Object.keys(changes)
    if (changedKeys.length === 0) {
      const row = await prisma.asset.findUniqueOrThrow({ where: { id }, include: ASSET_INCLUDE })
      return toAssetDTO(row)
    }

    let updated
    try {
      updated = await prisma.asset.update({ where: { id }, data, include: ASSET_INCLUDE })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('资产编码已存在')
      throw err
    }
    const before = Object.fromEntries(changedKeys.map((key) => [key, changes[key].before]))
    const after = Object.fromEntries(changedKeys.map((key) => [key, changes[key].after]))
    await recordAudit({ actor: user, action: 'UPDATE', entityType: 'ASSET', entityId: id, before, after, ip: requestIp(req) })
    return toAssetDTO(updated)
  })

  app.delete('/api/assets/:id', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const asset = await prisma.asset.findUnique({ where: { id } })
    if (!asset) throw AppError.notFound('资产不存在')
    await prisma.asset.delete({ where: { id } })
    await recordAudit({
      actor: user,
      action: 'DELETE',
      entityType: 'ASSET',
      entityId: id,
      before: { code: asset.code, name: asset.name, ownerId: asset.ownerId, status: asset.status },
      ip: requestIp(req)
    })
    return { ok: true }
  })

  app.post('/api/assets/:id/attachments', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const asset = await prisma.asset.findUnique({ where: { id } })
    if (!asset) throw AppError.notFound('资产不存在')
    if (!canEditAsset(user, asset)) throw AppError.forbidden('只能修改自己负责的资产')
    if (!req.isMultipart()) throw AppError.validation('请使用 multipart/form-data 上传附件')
    const file = await req.file()
    if (!file) throw AppError.validation('缺少上传文件字段 file')
    const media = await saveUpload(file, { usage: 'ASSET', uploaderId: user.id })
    const kindRaw = textField(file.fields, 'kind')
    const kind: AttachmentKind = kindRaw && (ATTACHMENT_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as AttachmentKind) : 'PHOTO'
    const attachment = await prisma.assetAttachment.create({
      data: { assetId: asset.id, mediaId: media.id, kind },
      include: ATTACHMENT_INCLUDE
    })
    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'ASSET',
      entityId: asset.id,
      after: { attachmentId: attachment.id, kind, filename: media.filename },
      ip: requestIp(req)
    })
    return reply.status(201).send(toAttachmentDTO(attachment))
  })

  app.delete('/api/assets/:id/attachments/:attachmentId', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const { id, attachmentId } = req.params as { id: string; attachmentId: string }
    const asset = await prisma.asset.findUnique({ where: { id } })
    if (!asset) throw AppError.notFound('资产不存在')
    if (!canEditAsset(user, asset)) throw AppError.forbidden('只能修改自己负责的资产')
    const attachment = await prisma.assetAttachment.findUnique({ where: { id: attachmentId } })
    if (!attachment || attachment.assetId !== asset.id) throw AppError.notFound('附件不存在')
    await prisma.assetAttachment.delete({ where: { id: attachment.id } })
    try {
      await prisma.media.delete({ where: { id: attachment.mediaId } })
    } catch {
      // 媒体被其他记录引用时保留
    }
    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'ASSET',
      entityId: asset.id,
      before: { attachmentId: attachment.id, kind: attachment.kind },
      ip: requestIp(req)
    })
    return { ok: true }
  })

}
