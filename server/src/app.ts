import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import { prisma } from './lib/prisma'
import { requireAdmin } from './plugins/auth'
import { installErrorHandler } from './lib/errors'
import { registerMediaRoutes, MAX_UPLOAD_BYTES } from './lib/storage'
import { registerUsersModule } from './modules/users/index'
import { registerAssetsModule } from './modules/assets/index'
import { registerReportsModule } from './modules/reports/index'
import { registerTemplatesModule } from './modules/templates/index'
import { registerSettingsModule } from './modules/settings/index'
import { registerGroupsModule } from './modules/groups/index'
import { registerNotesModule } from './modules/notes/index'
import { registerMemosModule } from './modules/memos/index'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: MAX_UPLOAD_BYTES + 1024 * 1024
  })

  await app.register(cors, { origin: true, credentials: false })
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } })
  installErrorHandler(app)

  const startedAt = Date.now()

  app.get('/api/health', async (_req, reply) => {
    const checks: Record<string, string> = {}
    let ok = true
    try {
      await prisma.user.count()
      checks.db = 'ok'
    } catch (error) {
      checks.db = 'error: ' + (error instanceof Error ? error.message : String(error))
      ok = false
    }
    try {
      await fs.access(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'), fsConstants.W_OK)
      checks.uploads = 'ok'
    } catch {
      checks.uploads = 'unwritable'
      ok = false
    }
    if (!ok) reply.code(503)
    return {
      ok,
      version: process.env.npm_package_version ?? '0.0.0',
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      at: new Date().toISOString(),
      checks
    }
  })

  app.get('/api/metrics', { preHandler: requireAdmin }, async () => {
    const since = new Date(Date.now() - 7 * 86400_000)
    const [users, activeUsers, assets, reports, pendingReview, notes, memos, openMemos, overdueMemos, mediaCount] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'ACTIVE' } }),
        prisma.asset.count(),
        prisma.report.count(),
        prisma.report.count({ where: { status: 'SUBMITTED' } }),
        prisma.note.count(),
        prisma.memo.count(),
        prisma.memo.count({ where: { done: false } }),
        prisma.memo.count({ where: { done: false, dueAt: { lt: new Date() } } }),
        prisma.media.count()
      ])
    const [recentReports, recentNotes] = await Promise.all([
      prisma.report.count({ where: { updatedAt: { gte: since } } }),
      prisma.note.count({ where: { updatedAt: { gte: since } } })
    ])
    return {
      at: new Date().toISOString(),
      counters: {
        users,
        activeUsers,
        assets,
        reports,
        pendingReview,
        notes,
        memos,
        openMemos,
        overdueMemos,
        mediaFiles: mediaCount
      },
      activity7d: { reports: recentReports, notes: recentNotes }
    }
  })

  await registerMediaRoutes(app)
  await registerUsersModule(app)
  await registerGroupsModule(app)
  await registerNotesModule(app)
  await registerMemosModule(app)
  await registerAssetsModule(app)
  await registerReportsModule(app)
  await registerTemplatesModule(app)
  await registerSettingsModule(app)

  return app
}
