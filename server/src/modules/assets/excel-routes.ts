import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { assetQuerySchema, type AssetStatus } from '@yeyu/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { recordAudit } from '../../lib/audit.js'
import { parseDateInput } from '../../lib/time.js'
import { currentUser, requestIp, requireAdmin, requireAuth } from '../../plugins/auth.js'
import { ASSET_INCLUDE } from './dto.js'
import { buildAssetOrderBy, buildAssetWhere, parseInput } from './helpers.js'
import { parseAssetStatus } from './columns.js'
import { XLSX_MIME, buildAssetWorkbook, buildTemplateWorkbook, readAssetSheet, workbookToBuffer } from './excel.js'

interface ImportError {
  row: number
  message: string
}

function dateStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename)
}

function parseAmount(value?: string): number | null {
  if (value === undefined || value.trim() === '') return null
  const num = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(num) || num < 0) return null
  return num
}

export async function registerExcelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/assets/export', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    const query = parseInput(assetQuerySchema, req.query)
    const rows = await prisma.asset.findMany({
      where: buildAssetWhere(query),
      include: ASSET_INCLUDE,
      orderBy: buildAssetOrderBy(query)
    })
    const buffer = await workbookToBuffer(buildAssetWorkbook(rows))
    await recordAudit({
      actor: user,
      action: 'EXPORT',
      entityType: 'ASSET',
      after: { rows: rows.length },
      ip: requestIp(req)
    })
    reply.header('Content-Type', XLSX_MIME)
    reply.header('Content-Disposition', contentDisposition('资产台账-' + dateStamp() + '.xlsx'))
    reply.header('Content-Length', String(buffer.byteLength))
    return reply.send(buffer)
  })

  app.get('/api/assets/template', { preHandler: requireAuth }, async (_req, reply) => {
    const buffer = await workbookToBuffer(buildTemplateWorkbook())
    reply.header('Content-Type', XLSX_MIME)
    reply.header('Content-Disposition', contentDisposition('资产导入模板.xlsx'))
    reply.header('Content-Length', String(buffer.byteLength))
    return reply.send(buffer)
  })

  app.post('/api/assets/import', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    if (!req.isMultipart()) throw AppError.validation('请使用 multipart/form-data 上传文件')
    const file = await req.file()
    if (!file) throw AppError.validation('缺少上传文件字段 file')
    const buffer = await file.toBuffer()
    if (buffer.byteLength === 0) throw AppError.validation('空文件')

    let sheetRows
    try {
      sheetRows = await readAssetSheet(buffer)
    } catch {
      throw AppError.validation('无法解析 Excel 文件，请使用导入模板')
    }

    const ownerCache = new Map<string, string | null>()
    const groupCache = new Map<string, string | null>()
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: ImportError[] = []

    for (const { rowNumber, values } of sheetRows) {
      try {
        const code = values.code?.trim()
        if (!code) throw new Error('缺少资产编码')
        const name = values.name?.trim()
        if (!name) throw new Error('缺少资产名称')
        const category = values.category?.trim() || '其他'
        const quantityRaw = values.quantity?.trim()
        const quantity = quantityRaw ? Number(quantityRaw) : 1
        if (!Number.isInteger(quantity) || quantity < 1) throw new Error('数量必须是正整数')
        const unitPrice = parseAmount(values.unitPrice)
        if (values.unitPrice !== undefined && unitPrice === null) throw new Error('单价不是合法数字')
        const amount = parseAmount(values.amount)
        if (values.amount !== undefined && amount === null) throw new Error('金额不是合法数字')
        let purchaseDate: Date | null = null
        if (values.purchaseDate !== undefined) {
          purchaseDate = parseDateInput(values.purchaseDate)
          if (!purchaseDate) throw new Error('购置日期无法识别')
        }
        let status: AssetStatus | undefined
        if (values.status !== undefined) {
          status = parseAssetStatus(values.status)
          if (!status) throw new Error('状态不在可选范围内')
        }
        let ownerId: string | null = null
        const ownerName = values.ownerName?.trim()
        if (ownerName) {
          if (ownerCache.has(ownerName)) {
            ownerId = ownerCache.get(ownerName) ?? null
          } else {
            const owner = await prisma.user.findFirst({ where: { name: ownerName }, select: { id: true } })
            ownerId = owner?.id ?? null
            ownerCache.set(ownerName, ownerId)
          }
          if (!ownerId) throw new Error('责任人不存在: ' + ownerName)
        }

        let groupId: string | null = null
        const groupName = values.groupName?.trim()
        if (groupName) {
          if (groupCache.has(groupName)) {
            groupId = groupCache.get(groupName) ?? null
          } else {
            const group = await prisma.group.findFirst({ where: { name: groupName }, select: { id: true } })
            groupId = group?.id ?? null
            groupCache.set(groupName, groupId)
          }
          if (!groupId) throw new Error('小组不存在: ' + groupName)
        }

        const base = {
          name,
          category,
          model: values.model?.trim() || null,
          serialNo: values.serialNo?.trim() || null,
          quantity,
          unitPrice,
          amount: amount ?? (unitPrice !== null ? Number((unitPrice * quantity).toFixed(2)) : null),
          purchaseDate,
          supplier: values.supplier?.trim() || null,
          location: values.location?.trim() || null,
          remark: values.remark?.trim() || null
        }

        const existing = await prisma.asset.findUnique({ where: { code }, select: { id: true } })
        if (existing) {
          const data: Prisma.AssetUncheckedUpdateInput = { ...base }
          if (ownerId) data.ownerId = ownerId
          if (groupId) data.groupId = groupId
          if (status) data.status = status
          await prisma.asset.update({ where: { id: existing.id }, data })
          updated += 1
        } else {
          const data: Prisma.AssetUncheckedCreateInput = {
            code,
            ...base,
            status: status ?? 'IN_USE',
            ownerId,
            groupId,
            createdById: user.id
          }
          await prisma.asset.create({ data })
          created += 1
        }
      } catch (err) {
        skipped += 1
        errors.push({ row: rowNumber, message: err instanceof Error ? err.message : '未知错误' })
      }
    }

    const summary = { created, updated, skipped, errors }
    await recordAudit({
      actor: user,
      action: 'IMPORT',
      entityType: 'ASSET',
      after: { created, updated, skipped, errorCount: errors.length },
      ip: requestIp(req)
    })
    return summary
  })
}
