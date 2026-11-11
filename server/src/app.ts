import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { installErrorHandler } from './lib/errors'
import { registerMediaRoutes, MAX_UPLOAD_BYTES } from './lib/storage'
import { registerUsersModule } from './modules/users/index'
import { registerAssetsModule } from './modules/assets/index'
import { registerReportsModule } from './modules/reports/index'
import { registerTemplatesModule } from './modules/templates/index'
import { registerSettingsModule } from './modules/settings/index'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: MAX_UPLOAD_BYTES + 1024 * 1024
  })

  await app.register(cors, { origin: true, credentials: false })
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } })
  installErrorHandler(app)

  app.get('/api/health', async () => ({ ok: true, at: new Date().toISOString() }))

  await registerMediaRoutes(app)
  await registerUsersModule(app)
  await registerAssetsModule(app)
  await registerReportsModule(app)
  await registerTemplatesModule(app)
  await registerSettingsModule(app)

  return app
}
