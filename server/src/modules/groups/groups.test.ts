import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import type { GroupDTO, UserDTO } from '@yeyu/shared'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { signToken } from '../../plugins/auth.js'

interface Account {
  id: string
  token: string
}

let app: FastifyInstance
let admin: Account
let member: Account

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

async function call(opts: { method: Method; url: string; token?: string; body?: unknown }) {
  const res = await app.inject({
    method: opts.method,
    url: opts.url,
    headers: opts.token ? { authorization: 'Bearer ' + opts.token } : {},
    payload: opts.body === undefined ? undefined : (opts.body as Record<string, unknown>)
  })
  return res
}

function json<T>(payload: string): T {
  return JSON.parse(payload) as T
}

async function makeAccount(phone: string, name: string, role: 'ADMIN' | 'MEMBER'): Promise<Account> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: { name, role, status: 'ACTIVE' },
    create: {
      phone,
      name,
      role,
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash('Passw0rd!', 10)
    }
  })
  return { id: user.id, token: signToken({ id: user.id, phone: user.phone, name: user.name, role: role }) }
}

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.auditLog.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.group.deleteMany({})
  admin = await makeAccount('13500000001', '管理员甲', 'ADMIN')
  member = await makeAccount('13500000002', '成员甲', 'MEMBER')

})

describe('成员分组', () => {
  it('管理员创建小组，列表带成员数；名称重复返回 409', async () => {
    const created = await call({ method: 'POST', url: '/api/groups', token: admin.token, body: { name: '熔池监测组', description: '声发射方向' } })
    expect(created.statusCode).toBe(201)
    const dto = json<GroupDTO>(created.payload)
    expect(dto.name).toBe('熔池监测组')
    expect(dto.memberCount).toBe(0)

    const dup = await call({ method: 'POST', url: '/api/groups', token: admin.token, body: { name: '熔池监测组' } })
    expect(dup.statusCode).toBe(409)

    const list = await call({ method: 'GET', url: '/api/groups', token: member.token })
    expect(list.statusCode).toBe(200)
    expect(json<{ items: GroupDTO[] }>(list.payload).items).toHaveLength(1)
  })

  it('成员可读小组但不能增删改', async () => {
    const list = await call({ method: 'GET', url: '/api/groups', token: member.token })
    expect(list.statusCode).toBe(200)

    const create = await call({ method: 'POST', url: '/api/groups', token: member.token, body: { name: '越权组' } })
    expect(create.statusCode).toBe(403)
    expect(json<{ error: { code: string } }>(create.payload).error.code).toBe('FORBIDDEN')
  })

  it('把成员归入小组后 user.groupId/groupName 生效，memberCount 增加；可移出', async () => {
    const created = json<GroupDTO>((await call({ method: 'POST', url: '/api/groups', token: admin.token, body: { name: '工艺组' } })).payload)

    const joined = await call({ method: 'PATCH', url: '/api/users/' + member.id, token: admin.token, body: { groupId: created.id } })
    expect(joined.statusCode).toBe(200)
    const user = json<UserDTO>(joined.payload)
    expect(user.groupId).toBe(created.id)
    expect(user.groupName).toBe('工艺组')

    const list = json<{ items: GroupDTO[] }>((await call({ method: 'GET', url: '/api/groups', token: admin.token })).payload)
    expect(list.items[0]?.memberCount).toBe(1)

    const left = await call({ method: 'PATCH', url: '/api/users/' + member.id, token: admin.token, body: { groupId: null } })
    expect(json<UserDTO>(left.payload).groupId).toBeNull()

    const after = json<{ items: GroupDTO[] }>((await call({ method: 'GET', url: '/api/groups', token: admin.token })).payload)
    expect(after.items[0]?.memberCount).toBe(0)
  })

  it('按小组筛选成员，NONE 表示未分组', async () => {
    const created = json<GroupDTO>((await call({ method: 'POST', url: '/api/groups', token: admin.token, body: { name: '仿真组' } })).payload)
    await call({ method: 'PATCH', url: '/api/users/' + member.id, token: admin.token, body: { groupId: created.id } })

    const inGroup = await call({ method: 'GET', url: '/api/users?groupId=' + created.id, token: admin.token })
    expect(json<{ items: UserDTO[] }>(inGroup.payload).items.map((u) => u.name)).toEqual(['成员甲'])

    const ungrouped = await call({ method: 'GET', url: '/api/users?groupId=NONE', token: admin.token })
    expect(json<{ items: UserDTO[] }>(ungrouped.payload).items.map((u) => u.name)).toEqual(['管理员甲'])
  })

  it('改名与删除；删除后成员回到未分组且成员不消失；写操作留审计', async () => {
    const created = json<GroupDTO>((await call({ method: 'POST', url: '/api/groups', token: admin.token, body: { name: '临时组' } })).payload)
    await call({ method: 'PATCH', url: '/api/users/' + member.id, token: admin.token, body: { groupId: created.id } })

    const renamed = await call({ method: 'PATCH', url: '/api/groups/' + created.id, token: admin.token, body: { name: '正式组' } })
    expect(json<GroupDTO>(renamed.payload).name).toBe('正式组')

    const removed = await call({ method: 'DELETE', url: '/api/groups/' + created.id, token: admin.token })
    expect(removed.statusCode).toBe(200)
    expect(json<{ movedToUngrouped: number }>(removed.payload).movedToUngrouped).toBe(1)

    const users = json<{ items: UserDTO[] }>((await call({ method: 'GET', url: '/api/users?groupId=NONE', token: admin.token })).payload)
    expect(users.items.map((u) => u.name).sort()).toEqual(['成员甲', '管理员甲'].sort())

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'GROUP' } })
    expect(audits.map((a) => a.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE'])
  })

  it('指派到不存在的小组返回 404', async () => {
    const res = await call({ method: 'PATCH', url: '/api/users/' + member.id, token: admin.token, body: { groupId: 'not-exists' } })
    expect(res.statusCode).toBe(404)
  })
})
