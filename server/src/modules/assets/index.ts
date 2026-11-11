import type { FastifyInstance } from 'fastify'
import { registerAssetRoutes } from './assets.js'
import { registerExcelRoutes } from './excel-routes.js'
import { registerBorrowRoutes } from './borrows.js'
import { registerInventoryRoutes } from './inventory.js'
import { registerAuditRoutes } from './audit.js'

// 归属：子任务 B（资产台账）。契约见 docs/API.md 第 3 节。
export async function registerAssetsModule(app: FastifyInstance): Promise<void> {
  await registerAssetRoutes(app)
  await registerExcelRoutes(app)
  await registerBorrowRoutes(app)
  await registerInventoryRoutes(app)
  await registerAuditRoutes(app)
}
