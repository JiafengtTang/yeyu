import { createReadStream } from 'node:fs'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { MediaDTO } from '@yeyu/shared'
import type { MultipartFile } from '@fastify/multipart'
import { prisma } from './prisma'
import { AppError } from './errors'
import { requireAuth, currentUser, isAdmin, verifyTokenString } from '../plugins/auth'

/** 单个文件上限，可用环境变量 MAX_UPLOAD_MB 调整（默认 200MB，够放短视频与音频） */
export const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 200)) * 1024 * 1024
export const MAX_UPLOAD_LABEL = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB'
export const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument',
  'text/plain',
  'application/msword'
]

export function uploadDir(): string {
  const dir = process.env.UPLOAD_DIR ?? './uploads'
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
}

export function mediaUrl(id: string): string {
  return '/api/media/' + id
}

export function toMediaDTO(m: { id: string; filename: string; mime: string; size: number }): MediaDTO {
  return { id: m.id, filename: m.filename, mime: m.mime, size: m.size, url: mediaUrl(m.id) }
}

export function mediaAbsPath(relPath: string): string {
  return path.join(uploadDir(), relPath)
}

export async function saveUpload(file: MultipartFile, opts: { usage: string; uploaderId: string }): Promise<MediaDTO> {
  const mime = file.mimetype || 'application/octet-stream'
  if (!ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    throw AppError.validation('不支持的文件类型: ' + mime)
  }
  const buffer = await file.toBuffer()
  if (buffer.byteLength === 0) throw AppError.validation('空文件')
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw AppError.validation('文件超过 ' + MAX_UPLOAD_LABEL)

  const ext = (path.extname(file.filename ?? '') || '').slice(0, 12).toLowerCase()
  const id = crypto.randomUUID()
  const bucket = new Date().toISOString().slice(0, 7)
  const dir = path.join(uploadDir(), bucket)
  await mkdir(dir, { recursive: true })
  const relPath = path.join(bucket, id + ext)
  await writeFile(path.join(uploadDir(), relPath), buffer)

  const media = await prisma.media.create({
    data: {
      id,
      filename: file.filename ?? id + ext,
      mime,
      size: buffer.byteLength,
      path: relPath,
      usage: opts.usage,
      uploaderId: opts.uploaderId
    }
  })
  return toMediaDTO(media)
}

function tokenFromQuery(req: { query?: unknown }): string | null {
  const q = req.query as Record<string, unknown> | undefined
  const t = q?.token
  return typeof t === 'string' && t.length > 0 ? t : null
}

// <img> 无法携带 Authorization 头，故下载路由同时接受 Bearer 头与 ?token= 查询参数
async function requireMediaAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const raw = mediaTokenFromRequest({ query: req.query, headers: req.headers as Record<string, unknown> })
  const user = verifyTokenString(raw)
  if (!user) throw AppError.unauthenticated()
  req.user = user
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/media', { preHandler: requireAuth }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } })
    if (!file) throw AppError.validation('缺少上传文件字段 file')
    const usageRaw = (file.fields?.usage as { value?: unknown } | undefined)?.value
    const usage = typeof usageRaw === 'string' ? usageRaw : 'ASSET'
    const user = currentUser(req)
    const dto = await saveUpload(file, { usage, uploaderId: user.id })
    return reply.status(201).send(dto)
  })

  app.get('/api/media/:id', { preHandler: requireMediaAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const media = await prisma.media.findUnique({ where: { id } })
    if (!media) throw AppError.notFound('文件不存在')
    const abs = mediaAbsPath(media.path)
    try {
      await stat(abs)
    } catch {
      throw AppError.notFound('文件已丢失')
    }
    reply.header('Content-Type', media.mime)
    reply.header('Cache-Control', 'private, max-age=86400')
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Content-Disposition', 'inline; filename*=UTF-8\'\'' + encodeURIComponent(media.filename))

    // 视频/音频要靠 Range 才能拖动进度条与边下边播
    const range = req.headers.range
    const size = (await stat(abs)).size
    if (range) {
      const matched = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (matched) {
        const start = matched[1] ? Number(matched[1]) : 0
        const end = matched[2] ? Math.min(Number(matched[2]), size - 1) : size - 1
        if (Number.isFinite(start) && start <= end && start < size) {
          reply.code(206)
          reply.header('Content-Range', 'bytes ' + start + '-' + end + '/' + size)
          reply.header('Content-Length', String(end - start + 1))
          return reply.send(createReadStream(abs, { start, end }))
        }
        reply.code(416).header('Content-Range', 'bytes */' + size)
        return reply.send()
      }
    }
    reply.header('Content-Length', String(size))
    return reply.send(createReadStream(abs))
  })

  app.delete('/api/media/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = currentUser(req)
    const media = await prisma.media.findUnique({ where: { id } })
    if (!media) throw AppError.notFound('文件不存在')
    if (!isAdmin(user) && media.uploaderId !== user.id) throw AppError.forbidden('只能删除自己上传的文件')
    await prisma.media.delete({ where: { id } })
    return { ok: true }
  })
}

export function mediaTokenFromRequest(req: { query?: unknown; headers: Record<string, unknown> }): string | null {
  const header = req.headers['authorization']
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7)
  return tokenFromQuery(req)
}
