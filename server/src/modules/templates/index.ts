import path from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { uploadTemplateSchema } from '@lab/shared'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { recordAudit } from '../../lib/audit.js'
import { MAX_UPLOAD_BYTES, saveUpload } from '../../lib/storage.js'
import { currentUser, requestIp, requireAdmin, requireAuth } from '../../plugins/auth.js'
import { toTemplateDTO } from './dto.js'
import { parseTemplateBuffer } from './parse.js'
import type { TemplateFormat } from './parse.js'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MD_MIME = 'text/plain'
const TEMPLATE_INCLUDE = { _count: { select: { reports: true } } } as const

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {})
  if (!result.success) throw AppError.validation('参数校验失败', result.error.issues)
  return result.data
}

/** 依扩展名判定模版格式（.docx / .md / .markdown） */
export function templateFormatOf(filename: string): TemplateFormat {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.docx') return 'docx'
  if (ext === '.md' || ext === '.markdown') return 'md'
  throw AppError.validation('仅支持 .docx / .md / .markdown 模版文件，当前文件：' + (filename || '未命名'))
}

/** 落盘走 lib/storage 的白名单 MIME：markdown 以 text/plain 存，docx 统一 openxml MIME */
function storageMime(format: TemplateFormat, mimetype: string): string {
  if (format === 'md') return MD_MIME
  return mimetype.startsWith('application/vnd.openxmlformats-officedocument') ? mimetype : DOCX_MIME
}

function defaultName(filename: string): string {
  const base = path.basename(filename, path.extname(filename)).trim()
  return (base.length > 0 ? base : '周报模版').slice(0, 64)
}

interface UploadedPart {
  buffer: Buffer
  filename: string
  mimetype: string
}

async function readMultipart(req: FastifyRequest): Promise<{ upload: UploadedPart | null; fields: Record<string, string> }> {
  const fields: Record<string, string> = {}
  let upload: UploadedPart | null = null
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer()
      if (part.fieldname === 'file' && upload === null) {
        upload = { buffer, filename: part.filename ?? '', mimetype: part.mimetype ?? '' }
      }
      continue
    }
    if (typeof part.value === 'string') fields[part.fieldname] = part.value
  }
  return { upload, fields }
}

// 归属：子任务 E（周报模版）。契约见 docs/API.md 第 4A 节「模版端点」与「解析规则」。
export async function registerTemplatesModule(app: FastifyInstance): Promise<void> {
  app.get('/api/templates', { preHandler: requireAuth }, async () => {
    const rows = await prisma.reportTemplate.findMany({
      include: TEMPLATE_INCLUDE,
      orderBy: { createdAt: 'desc' }
    })
    return { items: rows.map(toTemplateDTO), total: rows.length, page: 1, pageSize: rows.length > 0 ? rows.length : 20 }
  })

  app.get('/api/templates/active', { preHandler: requireAuth }, async () => {
    const row = await prisma.reportTemplate.findFirst({
      where: { isActive: true },
      include: TEMPLATE_INCLUDE,
      orderBy: { createdAt: 'desc' }
    })
    return row ? toTemplateDTO(row) : null
  })

  app.post('/api/templates', { preHandler: requireAdmin }, async (req, reply) => {
    const user = currentUser(req)
    if (!req.isMultipart()) throw AppError.validation('请使用 multipart/form-data 上传模版文件')
    const { upload, fields } = await readMultipart(req)
    if (!upload) throw AppError.validation('缺少上传文件字段 file')
    if (upload.buffer.byteLength === 0) throw AppError.validation('空文件')
    if (upload.buffer.byteLength > MAX_UPLOAD_BYTES) throw AppError.validation('文件超过 20MB')
    const input = parse(uploadTemplateSchema, fields)

    const format = templateFormatOf(upload.filename)
    const sections = await parseTemplateBuffer(format, upload.buffer)

    const part = upload
    const storageFile = {
      filename: part.filename,
      mimetype: storageMime(format, part.mimetype),
      toBuffer: async () => part.buffer
    } as unknown as MultipartFile
    const media = await saveUpload(storageFile, { usage: 'TEMPLATE', uploaderId: user.id })
    const stored = await prisma.media.findUnique({ where: { id: media.id }, select: { path: true } })

    const activate = input.activate === '1' || input.activate === true
    const version = (await prisma.reportTemplate.count()) + 1
    const row = await prisma.$transaction(async (tx) => {
      if (activate) {
        await tx.reportTemplate.updateMany({ where: { isActive: true }, data: { isActive: false } })
      }
      return tx.reportTemplate.create({
        data: {
          name: input.name ?? defaultName(upload.filename),
          version,
          sectionsJson: JSON.stringify(sections),
          sourceName: upload.filename.length > 0 ? upload.filename : null,
          sourceFormat: format,
          rawPath: stored?.path ?? null,
          isActive: activate,
          createdById: user.id
        },
        include: TEMPLATE_INCLUDE
      })
    })

    await recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'TEMPLATE',
      entityId: row.id,
      before: null,
      after: { name: row.name, sourceFormat: row.sourceFormat, sections: sections.length, isActive: row.isActive },
      ip: requestIp(req)
    })

    return reply.status(201).send(toTemplateDTO(row))
  })

  app.patch('/api/templates/:id/activate', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const existing = await prisma.reportTemplate.findUnique({ where: { id } })
    if (!existing) throw AppError.notFound('模版不存在')

    const row = await prisma.$transaction(async (tx) => {
      await tx.reportTemplate.updateMany({ where: { isActive: true, id: { not: id } }, data: { isActive: false } })
      return tx.reportTemplate.update({ where: { id }, data: { isActive: true }, include: TEMPLATE_INCLUDE })
    })

    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'TEMPLATE',
      entityId: row.id,
      before: { isActive: existing.isActive },
      after: { isActive: row.isActive },
      ip: requestIp(req)
    })

    return toTemplateDTO(row)
  })

  app.delete('/api/templates/:id', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { id } = req.params as { id: string }
    const existing = await prisma.reportTemplate.findUnique({ where: { id } })
    if (!existing) throw AppError.notFound('模版不存在')

    await prisma.$transaction([
      prisma.report.updateMany({ where: { templateId: id }, data: { templateId: null } }),
      prisma.reportTemplate.delete({ where: { id } })
    ])

    await recordAudit({
      actor: user,
      action: 'DELETE',
      entityType: 'TEMPLATE',
      entityId: id,
      before: { name: existing.name, sections: existing.sectionsJson },
      after: null,
      ip: requestIp(req)
    })

    return { ok: true }
  })
}
