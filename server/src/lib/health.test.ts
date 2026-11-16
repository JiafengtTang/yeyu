import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { buildApp } from '../app.js'
import { prisma } from './prisma.js'
import { signToken } from '../plugins/auth.js'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret'
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'yeyu-health-test-'))

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('test-h')) {
  throw new Error('测试必须使用独立测试库，请用 DATABASE_URL="file:./test-h.db" 运行')
}

let app: FastifyInstance
let adminToken = ''
let memberToken = ''

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  const hash = await bcrypt.hash('Passw0rd!', 10)
  const admin = await prisma.user.create({
    data: { phone: '13500001000', name: '管理员', role: 'ADMIN', status: 'ACTIVE', passwordHash: hash }
  })
  const member = await prisma.user.create({
    data: { phone: '13500001001', name: '成员', role: 'MEMBER', status: 'ACTIVE', passwordHash: hash }
  })
  adminToken = signToken({ id: admin.id, phone: admin.phone, name: admin.name, role: 'ADMIN' })
  memberToken = signToken({ id: member.id, phone: member.phone, name: member.name, role: 'MEMBER' })
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.memo.deleteMany({})
})

describe('健康检查与指标', () => {
  it('/api/health 无需登录，含 db 与 uploads 检查项', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean; checks: Record<string, string>; uptimeSec: number }
    expect(body.ok).toBe(true)
    expect(body.checks.db).toBe('ok')
    expect(body.checks.uploads).toBe('ok')
    expect(typeof body.uptimeSec).toBe('number')
  })

  it('/api/metrics 只有管理员能看，成员 403', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: 'Bearer ' + memberToken } })
    expect(denied.statusCode).toBe(403)

    const res = await app.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: 'Bearer ' + adminToken } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { counters: Record<string, number>; activity7d: Record<string, number> }
    expect(body.counters.users).toBeGreaterThanOrEqual(2)
    expect(body.counters.activeUsers).toBeGreaterThanOrEqual(2)
    expect(typeof body.counters.overdueMemos).toBe('number')
    expect(body.activity7d).toHaveProperty('reports')
  })

  it('指标里的逾期备忘录计数随数据变化', async () => {
    const admin = await prisma.user.findFirst({ where: { phone: '13500001000' } })
    await prisma.memo.create({
      data: { ownerId: admin!.id, title: '过期事项', dueAt: new Date(Date.now() - 3600_000) }
    })
    const res = await app.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: 'Bearer ' + adminToken } })
    expect((res.json() as { counters: { overdueMemos: number } }).counters.overdueMemos).toBe(1)
  })
})
