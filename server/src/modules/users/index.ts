import type { FastifyInstance } from 'fastify'
import { registerAuthRoutes } from './auth.js'
import { registerUserAdminRoutes } from './admin.js'

// 归属：子任务 A（账号与权限）。契约见 docs/API.md 第 2 节。
export async function registerUsersModule(app: FastifyInstance): Promise<void> {
  await registerAuthRoutes(app)
  await registerUserAdminRoutes(app)
}
