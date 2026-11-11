import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { isoWeekKey } from '@lab/shared'
import type { DeadlineDTO } from '@lab/shared'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { signToken } from '../../plugins/auth.js'
import { weekKeyToRange } from '../../lib/time.js'
import { DEFAULT_TIME, DEFAULT_WEEKDAY, computeDeadline, ruleFromSettings } from './deadline.js'

interface Account {
  id: string
  token: string
}

let app: FastifyInstance
let admin: Account
let member: Account

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

async function call(opts: { method: Method; url: string; token?: string; body?: unknown }) {
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: opts.token ? { authorization: 'Bearer ' + opts.token } : {},
    payload: opts.body === undefined ? undefined : (opts.body as Record<string, unknown>)
  })
}

function json<T>(payload: string): T {
  return JSON.parse(payload) as T
}

function errorCode(payload: string): string {
  return json<{ error: { code: string } }>(payload).error.code
}

function errorMessage(payload: string): string {
  return json<{ error: { message: string } }>(payload).error.message
}

/** 按本地时区取年月日时分，断言断言不受机器时区偏移影响 */
function localParts(iso: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const date = new Date(iso)
  return {
    y: date.getFullYear(),
    mo: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    mi: date.getMinutes()
  }
}

function ruleDeadline(week: string, weekday: number, time: string): string {
  const range = weekKeyToRange(week)
  if (!range) throw new Error('bad week ' + week)
  return computeDeadline(range.start, weekday, time).toISOString()
}

async function makeAccount(phone: string, name: string, role: 'ADMIN' | 'MEMBER'): Promise<Account> {
  const user = await prisma.user.create({
    data: { phone, name, role, status: 'ACTIVE', passwordHash: 'not-used-in-settings-tests' }
  })
  return { id: user.id, token: signToken({ id: user.id, phone: user.phone, name: user.name, role }) }
}

async function resetData(): Promise<void> {
  await prisma.deadlineOverride.deleteMany()
  await prisma.appSetting.deleteMany()
  await prisma.reportComment.deleteMany()
  await prisma.report.deleteMany()
  await prisma.reportTemplate.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.media.deleteMany()
  await prisma.assetAttachment.deleteMany()
  await prisma.borrowRecord.deleteMany()
  await prisma.inventoryItem.deleteMany()
  await prisma.inventoryBatch.deleteMany()
  await prisma.asset.deleteMany()
  await prisma.user.deleteMany()
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
  await resetData()
  admin = await makeAccount('13100000001', '管理员甲', 'ADMIN')
  member = await makeAccount('13100000002', '成员甲', 'MEMBER')
})

describe('截止时间计算规则（纯函数）', () => {
  it('周一 00:00 + (weekday-1) 天 + time：跨月周 2025-W14 的周三是 04-02', () => {
    const start = weekKeyToRange('2025-W14')?.start
    expect(start).toBeDefined()
    const deadline = computeDeadline(start as Date, 3, '12:30')
    expect({ y: deadline.getFullYear(), mo: deadline.getMonth() + 1, d: deadline.getDate() }).toEqual({
      y: 2025,
      mo: 4,
      d: 2
    })
    expect(deadline.getHours()).toBe(12)
    expect(deadline.getMinutes()).toBe(30)
  })

  it('跨年周 2025-W01（周一 2024-12-30）的周日是 2025-01-05', () => {
    const start = weekKeyToRange('2025-W01')?.start
    const deadline = computeDeadline(start as Date, 7, '18:00')
    expect({ y: deadline.getFullYear(), mo: deadline.getMonth() + 1, d: deadline.getDate() }).toEqual({
      y: 2025,
      mo: 1,
      d: 5
    })
    expect(deadline.getHours()).toBe(18)
  })

  it('跨年周 2026-W01（周一 2025-12-29）的周日是 2026-01-04', () => {
    const start = weekKeyToRange('2026-W01')?.start
    const deadline = computeDeadline(start as Date, 7, '09:05')
    expect({ y: deadline.getFullYear(), mo: deadline.getMonth() + 1, d: deadline.getDate() }).toEqual({
      y: 2026,
      mo: 1,
      d: 4
    })
    expect(deadline.getHours()).toBe(9)
    expect(deadline.getMinutes()).toBe(5)
  })

  it('默认规则为周日 18:00，损坏的设置值回落到默认', () => {
    expect(ruleFromSettings({})).toEqual({ weekday: DEFAULT_WEEKDAY, time: DEFAULT_TIME })
    expect(ruleFromSettings({ 'report.deadline.weekday': '9', 'report.deadline.time': '25:61' })).toEqual({
      weekday: 7,
      time: '18:00'
    })
    expect(ruleFromSettings({ 'report.deadline.weekday': '3', 'report.deadline.time': '08:15' })).toEqual({
      weekday: 3,
      time: '08:15'
    })
  })
})

describe('截止时间端点', () => {
  it('默认返回本周按规则计算的截止时间（source=RULE）', async () => {
    const week = isoWeekKey(new Date())
    const res = await call({ method: 'GET', url: '/api/settings/report-deadline', token: member.token })
    expect(res.statusCode).toBe(200)
    const dto = json<DeadlineDTO>(res.payload)
    expect(dto.week).toBe(week)
    expect(dto.source).toBe('RULE')
    expect(dto.weekday).toBe(7)
    expect(dto.time).toBe('18:00')
    expect(dto.overrideReason).toBeNull()
    expect(dto.deadline).toBe(ruleDeadline(week, 7, '18:00'))
    expect(localParts(dto.deadline)).toMatchObject({ h: 18, mi: 0 })
  })

  it('管理员 PATCH 规则后按新规则计算（跨月周 2025-W14 为 04-04 17:30）', async () => {
    const patched = await call({
      method: 'PATCH',
      url: '/api/settings/report-deadline',
      token: admin.token,
      body: { weekday: 5, time: '17:30' }
    })
    expect(patched.statusCode).toBe(200)
    expect(json<{ weekday: number; time: string }>(patched.payload)).toEqual({ weekday: 5, time: '17:30' })

    const res = await call({ method: 'GET', url: '/api/settings/report-deadline?week=2025-W14', token: member.token })
    expect(res.statusCode).toBe(200)
    const dto = json<DeadlineDTO>(res.payload)
    expect(dto.source).toBe('RULE')
    expect(dto.weekday).toBe(5)
    expect(dto.time).toBe('17:30')
    expect(dto.deadline).toBe(ruleDeadline('2025-W14', 5, '17:30'))
    expect(localParts(dto.deadline)).toEqual({ y: 2025, mo: 4, d: 4, h: 17, mi: 30 })

    const stored = await prisma.appSetting.findMany({ orderBy: { key: 'asc' } })
    expect(stored.map((row) => [row.key, row.value])).toEqual([
      ['report.deadline.time', '17:30'],
      ['report.deadline.weekday', '5']
    ])
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'SETTING' } })
    expect(audit?.action).toBe('UPDATE')
  })

  it('单周覆盖优先于全局规则，取消覆盖后回到规则', async () => {
    await call({ method: 'PATCH', url: '/api/settings/report-deadline', token: admin.token, body: { weekday: 5, time: '17:30' } })
    const overrideIso = new Date(2025, 3, 5, 12, 0, 0).toISOString()

    const put = await call({
      method: 'PUT',
      url: '/api/settings/report-deadline/overrides/2025-W14',
      token: admin.token,
      body: { deadline: overrideIso, reason: '清明调休' }
    })
    expect(put.statusCode).toBe(200)
    const overrideDto = json<DeadlineDTO>(put.payload)
    expect(overrideDto.source).toBe('OVERRIDE')
    expect(overrideDto.deadline).toBe(overrideIso)
    expect(overrideDto.overrideReason).toBe('清明调休')
    expect(overrideDto.weekday).toBe(6)
    expect(overrideDto.time).toBe('12:00')

    const read = await call({ method: 'GET', url: '/api/settings/report-deadline?week=2025-W14', token: member.token })
    expect(read.statusCode).toBe(200)
    expect(json<DeadlineDTO>(read.payload).source).toBe('OVERRIDE')

    const other = await call({ method: 'GET', url: '/api/settings/report-deadline?week=2025-W15', token: member.token })
    expect(json<DeadlineDTO>(other.payload).source).toBe('RULE')

    const removed = await call({
      method: 'DELETE',
      url: '/api/settings/report-deadline/overrides/2025-W14',
      token: admin.token
    })
    expect(removed.statusCode).toBe(200)
    expect(json<{ ok: boolean }>(removed.payload)).toEqual({ ok: true })

    const back = await call({ method: 'GET', url: '/api/settings/report-deadline?week=2025-W14', token: member.token })
    expect(json<DeadlineDTO>(back.payload).source).toBe('RULE')
    expect(await prisma.deadlineOverride.count()).toBe(0)
  })

  it('覆盖列表按 week 倒序并支持 from/to 过滤', async () => {
    for (const week of ['2025-W10', '2025-W14', '2025-W20']) {
      await call({
        method: 'PUT',
        url: '/api/settings/report-deadline/overrides/' + week,
        token: admin.token,
        body: { deadline: new Date(2025, 2, 1, 18, 0, 0).toISOString(), reason: week + ' 覆盖' }
      })
    }

    const all = await call({ method: 'GET', url: '/api/settings/report-deadline/overrides', token: admin.token })
    expect(all.statusCode).toBe(200)
    const allBody = json<{ items: Array<{ week: string; deadline: string; reason: string | null }>; total: number }>(all.payload)
    expect(allBody.total).toBe(3)
    expect(allBody.items.map((item) => item.week)).toEqual(['2025-W20', '2025-W14', '2025-W10'])
    expect(allBody.items[0]?.reason).toBe('2025-W20 覆盖')

    const ranged = await call({
      method: 'GET',
      url: '/api/settings/report-deadline/overrides?from=2025-W11&to=2025-W19',
      token: admin.token
    })
    const rangedBody = json<{ items: Array<{ week: string }> }>(ranged.payload)
    expect(rangedBody.items.map((item) => item.week)).toEqual(['2025-W14'])
  })

  it('成员不能改规则与覆盖，管理员权限校验生效', async () => {
    const byMemberPatch = await call({
      method: 'PATCH',
      url: '/api/settings/report-deadline',
      token: member.token,
      body: { weekday: 3, time: '10:00' }
    })
    expect(byMemberPatch.statusCode).toBe(403)
    expect(errorCode(byMemberPatch.payload)).toBe('FORBIDDEN')

    const byMemberPut = await call({
      method: 'PUT',
      url: '/api/settings/report-deadline/overrides/2025-W14',
      token: member.token,
      body: { deadline: new Date(2025, 3, 4, 18, 0, 0).toISOString() }
    })
    expect(byMemberPut.statusCode).toBe(403)

    const byMemberList = await call({ method: 'GET', url: '/api/settings/report-deadline/overrides', token: member.token })
    expect(byMemberList.statusCode).toBe(403)

    const anonymous = await call({ method: 'GET', url: '/api/settings/report-deadline' })
    expect(anonymous.statusCode).toBe(401)
  })

  it('非法入参返回 422：星期越界、时间格式错、周次格式错', async () => {
    const badWeekday = await call({
      method: 'PATCH',
      url: '/api/settings/report-deadline',
      token: admin.token,
      body: { weekday: 0, time: '18:00' }
    })
    expect(badWeekday.statusCode).toBe(422)
    expect(errorCode(badWeekday.payload)).toBe('VALIDATION')

    const badTime = await call({
      method: 'PATCH',
      url: '/api/settings/report-deadline',
      token: admin.token,
      body: { weekday: 7, time: '25:00' }
    })
    expect(badTime.statusCode).toBe(422)

    const badQuery = await call({ method: 'GET', url: '/api/settings/report-deadline?week=2025-14', token: member.token })
    expect(badQuery.statusCode).toBe(422)
    expect(errorMessage(badQuery.payload)).toContain('YYYY-Www')

    const badOverride = await call({
      method: 'PUT',
      url: '/api/settings/report-deadline/overrides/2025-W14',
      token: admin.token,
      body: { deadline: '不是时间' }
    })
    expect(badOverride.statusCode).toBe(422)
  })
})
