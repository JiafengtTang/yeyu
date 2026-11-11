import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import type { ApiErrorBody, ListResult, UserDTO } from '@lab/shared'
import { buildApp } from '../../app.js'
import { disconnectPrisma, prisma } from '../../lib/prisma.js'

let app: FastifyInstance

const ADMIN_PHONE = '13800000001'
const ADMIN_PASSWORD = 'admin123'
const MEMBER_PHONE = '13900000001'
const MEMBER_PASSWORD = 'member123'

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

beforeEach(async () => {
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany()
})

afterAll(async () => {
  await app.close()
  await disconnectPrisma()
})

async function seedActiveAdmin(phone: string = ADMIN_PHONE, name = '管理员甲'): Promise<void> {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)
  await prisma.user.create({ data: { phone, passwordHash, name, role: 'ADMIN', status: 'ACTIVE' } })
}

async function registerUser(phone: string = MEMBER_PHONE, password: string = MEMBER_PASSWORD, name = '成员乙') {
  return app.inject({ method: 'POST', url: '/api/auth/register', payload: { phone, password, name } })
}

async function login(phone: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone, password } })
}

async function tokenOf(phone: string, password: string): Promise<string> {
  const res = await login(phone, password)
  expect(res.statusCode).toBe(200)
  return (res.json() as { token: string }).token
}

function bearer(token: string): Record<string, string> {
  return { authorization: 'Bearer ' + token }
}

async function userIdByPhone(phone: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { phone } })
  expect(user).not.toBeNull()
  return user?.id ?? ''
}

describe('注册 / 审批 / 登录', () => {
  it('注册后为 PENDING 且未审批登录 403「账号待管理员审批」', async () => {
    const res = await registerUser()
    expect(res.statusCode).toBe(201)
    const created = (res.json() as { user: UserDTO }).user
    expect(created.status).toBe('PENDING')
    expect(created.role).toBe('MEMBER')
    expect(res.body).not.toContain('passwordHash')

    const denied = await login(MEMBER_PHONE, MEMBER_PASSWORD)
    expect(denied.statusCode).toBe(403)
    expect((denied.json() as ApiErrorBody).error.code).toBe('FORBIDDEN')
    expect((denied.json() as ApiErrorBody).error.message).toBe('账号待管理员审批')
  })

  it('手机号重复注册返回 409', async () => {
    expect((await registerUser()).statusCode).toBe(201)
    const again = await registerUser()
    expect(again.statusCode).toBe(409)
    expect(again.json<ApiErrorBody>().error.code).toBe('CONFLICT')
  })

  it('管理员审批通过后可以登录，/api/auth/me 返回 ACTIVE', async () => {
    await registerUser()
    await seedActiveAdmin()
    const adminToken = await tokenOf(ADMIN_PHONE, ADMIN_PASSWORD)
    const memberId = await userIdByPhone(MEMBER_PHONE)

    const approve = await app.inject({
      method: 'PATCH',
      url: '/api/users/' + memberId,
      headers: bearer(adminToken),
      payload: { status: 'ACTIVE' }
    })
    expect(approve.statusCode).toBe(200)
    expect((approve.json() as UserDTO).status).toBe('ACTIVE')

    const ok = await login(MEMBER_PHONE, MEMBER_PASSWORD)
    expect(ok.statusCode).toBe(200)
    const body = ok.json() as { token: string; user: UserDTO }
    expect(typeof body.token).toBe('string')
    expect(body.user.status).toBe('ACTIVE')

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(body.token) })
    expect(me.statusCode).toBe(200)
    expect((me.json() as UserDTO).phone).toBe(MEMBER_PHONE)
  })

  it('密码错误返回 401「手机号或密码不正确」', async () => {
    await registerUser()
    await seedActiveAdmin()
    const res = await login(MEMBER_PHONE, 'wrong-password')
    expect(res.statusCode).toBe(401)
    expect(res.json<ApiErrorBody>().error.message).toBe('手机号或密码不正确')
  })
})

describe('权限门禁', () => {
  it('非管理员访问 /api/users 返回 403', async () => {
    await registerUser()
    await seedActiveAdmin()
    const adminToken = await tokenOf(ADMIN_PHONE, ADMIN_PASSWORD)
    const memberId = await userIdByPhone(MEMBER_PHONE)
    await app.inject({ method: 'PATCH', url: '/api/users/' + memberId, headers: bearer(adminToken), payload: { status: 'ACTIVE' } })
    const memberToken = await tokenOf(MEMBER_PHONE, MEMBER_PASSWORD)

    const list = await app.inject({ method: 'GET', url: '/api/users', headers: bearer(memberToken) })
    expect(list.statusCode).toBe(403)
    expect(list.json<ApiErrorBody>().error.code).toBe('FORBIDDEN')
  })

  it('未带 token 访问 /api/auth/me 与 /api/users 均返回 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(401)
  })

  it('禁用后登录 403「账号已被禁用」，已签发 token 调 /api/auth/me 也 403', async () => {
    await registerUser()
    await seedActiveAdmin()
    const adminToken = await tokenOf(ADMIN_PHONE, ADMIN_PASSWORD)
    const memberId = await userIdByPhone(MEMBER_PHONE)
    await app.inject({ method: 'PATCH', url: '/api/users/' + memberId, headers: bearer(adminToken), payload: { status: 'ACTIVE' } })
    const memberToken = await tokenOf(MEMBER_PHONE, MEMBER_PASSWORD)

    const disable = await app.inject({ method: 'PATCH', url: '/api/users/' + memberId, headers: bearer(adminToken), payload: { status: 'DISABLED' } })
    expect(disable.statusCode).toBe(200)

    const denied = await login(MEMBER_PHONE, MEMBER_PASSWORD)
    expect(denied.statusCode).toBe(403)
    expect(denied.json<ApiErrorBody>().error.message).toBe('账号已被禁用')

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(memberToken) })
    expect(me.statusCode).toBe(403)
  })
})

describe('最后一个管理员保护与用户管理', () => {
  it('最后一个 ACTIVE 管理员降级或禁用返回 409', async () => {
    await seedActiveAdmin()
    const adminId = await userIdByPhone(ADMIN_PHONE)
    const adminToken = await tokenOf(ADMIN_PHONE, ADMIN_PASSWORD)

    const demote = await app.inject({ method: 'PATCH', url: '/api/users/' + adminId, headers: bearer(adminToken), payload: { role: 'MEMBER' } })
    expect(demote.statusCode).toBe(409)
    expect(demote.json<ApiErrorBody>().error.code).toBe('CONFLICT')

    const disable = await app.inject({ method: 'PATCH', url: '/api/users/' + adminId, headers: bearer(adminToken), payload: { status: 'DISABLED' } })
    expect(disable.statusCode).toBe(409)
  })

  it('存在第二名激活管理员时，降级其中一个返回 200', async () => {
    await seedActiveAdmin()
    await seedActiveAdmin('13800000002', '管理员乙')
    const adminId = await userIdByPhone(ADMIN_PHONE)
    const adminToken = await tokenOf(ADMIN_PHONE, ADMIN_PASSWORD)

    const demote = await app.inject({ method: 'PATCH', url: '/api/users/' + adminId, headers: bearer(adminToken), payload: { role: 'MEMBER' } })
    expect(demote.statusCode).toBe(200)
    expect((demote.json() as UserDTO).role).toBe('MEMBER')
  })

  it('管理员建号默认 ACTIVE，且列表支持 status/q 过滤与分页', async () => {
    await seedActiveAdmin()
    const adminToken = await tokenOf(ADMIN_PHONE, ADMIN_PASSWORD)

    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: bearer(adminToken),
      payload: { phone: '13700000003', password: 'created123', name: '张三' }
    })
    expect(created.statusCode).toBe(201)
    expect((created.json() as UserDTO).status).toBe('ACTIVE')

    await registerUser('13911112222', MEMBER_PASSWORD, '李四')

    const byStatus = await app.inject({ method: 'GET', url: '/api/users?status=PENDING', headers: bearer(adminToken) })
    expect(byStatus.statusCode).toBe(200)
    const pending = byStatus.json<ListResult<UserDTO>>()
    expect(pending.total).toBe(1)
    expect(pending.items[0].name).toBe('李四')

    const byQuery = await app.inject({ method: 'GET', url: '/api/users?q=13700000003', headers: bearer(adminToken) })
    expect(byQuery.json<ListResult<UserDTO>>().items[0].name).toBe('张三')

    const paged = await app.inject({ method: 'GET', url: '/api/users?page=1&pageSize=1', headers: bearer(adminToken) })
    const pageBody = paged.json<ListResult<UserDTO>>()
    expect(pageBody.items).toHaveLength(1)
    expect(pageBody.total).toBe(3)
    expect(pageBody.pageSize).toBe(1)
  })

  it('重置密码后旧密码失败、新密码可登录，审计不含 passwordHash', async () => {
    await registerUser()
    await seedActiveAdmin()
    const adminToken = await tokenOf(ADMIN_PHONE, ADMIN_PASSWORD)
    const memberId = await userIdByPhone(MEMBER_PHONE)
    await app.inject({ method: 'PATCH', url: '/api/users/' + memberId, headers: bearer(adminToken), payload: { status: 'ACTIVE' } })

    const reset = await app.inject({
      method: 'POST',
      url: '/api/users/' + memberId + '/reset-password',
      headers: bearer(adminToken),
      payload: { password: 'newpass123' }
    })
    expect(reset.statusCode).toBe(200)

    expect((await login(MEMBER_PHONE, MEMBER_PASSWORD)).statusCode).toBe(401)
    expect((await login(MEMBER_PHONE, 'newpass123')).statusCode).toBe(200)

    const audits = await prisma.auditLog.findMany()
    expect(audits.length).toBeGreaterThan(0)
    for (const audit of audits) {
      expect(audit.beforeJson ?? '').not.toContain('passwordHash')
      expect(audit.afterJson ?? '').not.toContain('passwordHash')
    }
  })
})
