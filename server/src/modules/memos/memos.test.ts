import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import type { ListResult, MemoDTO, MemoSummaryDTO } from '@yeyu/shared'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { signToken } from '../../plugins/auth.js'

interface Account {
  id: string
  token: string
}

let app: FastifyInstance
let alice: Account
let bob: Account

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

async function call(opts: { method: Method; url: string; token: string; body?: unknown }) {
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: { authorization: 'Bearer ' + opts.token },
    payload: opts.body === undefined ? undefined : (opts.body as Record<string, unknown>)
  })
}

function json<T>(payload: string): T {
  return JSON.parse(payload) as T
}

async function makeAccount(phone: string, name: string): Promise<Account> {
  const user = await prisma.user.create({
    data: { phone, name, role: 'MEMBER', status: 'ACTIVE', passwordHash: await bcrypt.hash('Passw0rd!', 10) }
  })
  return { id: user.id, token: signToken({ id: user.id, phone: user.phone, name: user.name, role: 'MEMBER' }) }
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString()
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
  await prisma.memo.deleteMany({})
  await prisma.user.deleteMany({})
  alice = await makeAccount('13600000001', '甲')
  bob = await makeAccount('13600000002', '乙')
})

describe('备忘录', () => {
  it('新建/列表/标题校验', async () => {
    const created = await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '问西空设备进度', dueAt: hoursFromNow(5) } })
    expect(created.statusCode).toBe(201)
    const memo = json<MemoDTO>(created.payload)
    expect(memo.title).toBe('问西空设备进度')
    expect(memo.done).toBe(false)
    expect(memo.dueAt).not.toBeNull()

    const list = await call({ method: 'GET', url: '/api/memos', token: alice.token })
    expect(json<ListResult<MemoDTO>>(list.payload).items.map((m) => m.title)).toEqual(['问西空设备进度'])

    const bad = await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '   ' } })
    expect(bad.statusCode).toBe(422)
  })

  it('勾选完成写 doneAt，取消完成清空；按状态过滤', async () => {
    const memo = json<MemoDTO>((await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '交周报前补数据' } })).payload)

    const done = await call({ method: 'PATCH', url: '/api/memos/' + memo.id, token: alice.token, body: { done: true } })
    expect(done.statusCode).toBe(200)
    const doneDto = json<MemoDTO>(done.payload)
    expect(doneDto.done).toBe(true)
    expect(doneDto.doneAt).not.toBeNull()

    const openList = await call({ method: 'GET', url: '/api/memos?status=open', token: alice.token })
    expect(json<ListResult<MemoDTO>>(openList.payload).total).toBe(0)
    const doneList = await call({ method: 'GET', url: '/api/memos?status=done', token: alice.token })
    expect(json<ListResult<MemoDTO>>(doneList.payload).total).toBe(1)

    const reopened = await call({ method: 'PATCH', url: '/api/memos/' + memo.id, token: alice.token, body: { done: false } })
    expect(json<MemoDTO>(reopened.payload).doneAt).toBeNull()
  })

  it('逾期标记与 summary 计数（含 dueNow 只提醒一次）', async () => {
    await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '已过期的事', dueAt: hoursFromNow(-3) } })
    await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '今天要做的事', dueAt: hoursFromNow(2) } })
    await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '没有截止时间' } })

    const summary = json<MemoSummaryDTO>((await call({ method: 'GET', url: '/api/memos/summary', token: alice.token })).payload)
    expect(summary.openCount).toBe(3)
    expect(summary.overdueCount).toBe(1)
    expect(summary.dueNow.map((m) => m.title)).toEqual(['已过期的事'])

    // 标记已提醒后不再出现在 dueNow
    await call({ method: 'PATCH', url: '/api/memos/' + summary.dueNow[0]!.id, token: alice.token, body: { reminded: true } })
    const again = json<MemoSummaryDTO>((await call({ method: 'GET', url: '/api/memos/summary', token: alice.token })).payload)
    expect(again.dueNow).toHaveLength(0)
    expect(again.overdueCount).toBe(1)

    const list = json<ListResult<MemoDTO>>((await call({ method: 'GET', url: '/api/memos', token: alice.token })).payload)
    expect(list.items.find((m) => m.title === '已过期的事')?.overdue).toBe(true)
    expect(list.items.find((m) => m.title === '今天要做的事')?.overdue).toBe(false)
  })

  it('仅本人可见：他人备忘录 404，列表互不干扰', async () => {
    const memo = json<MemoDTO>((await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '甲的事' } })).payload)

    const peek = await call({ method: 'PATCH', url: '/api/memos/' + memo.id, token: bob.token, body: { done: true } })
    expect(peek.statusCode).toBe(404)

    const bobList = await call({ method: 'GET', url: '/api/memos', token: bob.token })
    expect(json<ListResult<MemoDTO>>(bobList.payload).total).toBe(0)

    const del = await call({ method: 'DELETE', url: '/api/memos/' + memo.id, token: bob.token })
    expect(del.statusCode).toBe(404)
  })

  it('删除与搜索', async () => {
    await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '打电话给供应商', note: '问探头价格' } })
    const other = json<MemoDTO>((await call({ method: 'POST', url: '/api/memos', token: alice.token, body: { title: '整理实验记录' } })).payload)

    const searched = await call({ method: 'GET', url: '/api/memos?q=探头', token: alice.token })
    expect(json<ListResult<MemoDTO>>(searched.payload).items.map((m) => m.title)).toEqual(['打电话给供应商'])

    const removed = await call({ method: 'DELETE', url: '/api/memos/' + other.id, token: alice.token })
    expect(removed.statusCode).toBe(200)
    const left = await call({ method: 'GET', url: '/api/memos', token: alice.token })
    expect(json<ListResult<MemoDTO>>(left.payload).total).toBe(1)
  })
})
