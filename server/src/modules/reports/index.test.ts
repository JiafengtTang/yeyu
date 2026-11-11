import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { isoWeekKey, weekRange } from '@lab/shared'
import type { ReportCommentDTO, ReportDTO, ReportSummaryDTO, UserDTO } from '@lab/shared'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { signToken } from '../../plugins/auth.js'
import { computeDeadline } from '../settings/deadline.js'

const UPLOAD_ROOT = path.resolve(process.cwd(), '.tmp-reports-uploads')
process.env.UPLOAD_DIR = UPLOAD_ROOT

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

interface Account {
  id: string
  token: string
  name: string
}

let app: FastifyInstance
let admin: Account
let alice: Account
let bob: Account

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

async function makeAccount(phone: string, name: string, role: 'ADMIN' | 'MEMBER'): Promise<Account> {
  const user = await prisma.user.create({
    data: { phone, name, role, status: 'ACTIVE', passwordHash: 'not-used-in-reports-tests' }
  })
  return { id: user.id, name, token: signToken({ id: user.id, phone: user.phone, name: user.name, role }) }
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

async function createMedia(uploaderId: string): Promise<string> {
  await mkdir(path.join(UPLOAD_ROOT, 'test'), { recursive: true })
  await writeFile(path.join(UPLOAD_ROOT, 'test', 'pixel.png'), PNG_BYTES)
  const media = await prisma.media.create({
    data: {
      id: 'media-weekly-photo',
      filename: 'pixel.png',
      mime: 'image/png',
      size: PNG_BYTES.byteLength,
      path: 'test/pixel.png',
      usage: 'REPORT',
      uploaderId
    }
  })
  return media.id
}

const WEEK = isoWeekKey(new Date())

interface TemplateSectionFixture {
  key: string
  title: string
  hint: string
}

const TEMPLATE_SECTIONS: TemplateSectionFixture[] = [
  { key: 's1', title: '本周进展', hint: '写完成的工作' },
  { key: 's2', title: '下周计划', hint: '列出计划' }
]

async function createActiveTemplate(
  name = '课题组周报模版',
  sections: TemplateSectionFixture[] = TEMPLATE_SECTIONS
): Promise<string> {
  const row = await prisma.reportTemplate.create({
    data: {
      name,
      version: 1,
      sectionsJson: JSON.stringify(sections),
      sourceName: 'template.md',
      sourceFormat: 'md',
      isActive: true
    }
  })
  return row.id
}

async function overrideDeadline(week: string, deadline: Date, reason = '单周覆盖'): Promise<void> {
  await prisma.deadlineOverride.create({ data: { week, deadline, reason } })
}

beforeAll(async () => {
  await rm(UPLOAD_ROOT, { recursive: true, force: true })
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
  await rm(UPLOAD_ROOT, { recursive: true, force: true })
})

beforeEach(async () => {
  await resetData()
  admin = await makeAccount('13000000001', '管理员甲', 'ADMIN')
  alice = await makeAccount('13000000002', '成员甲', 'MEMBER')
  bob = await makeAccount('13000000003', '成员乙', 'MEMBER')
})

describe('周报权限', () => {
  it('成员读取他人周报返回 403', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    expect(created.statusCode).toBe(201)
    const id = json<ReportDTO>(created.payload).id

    const res = await call({ method: 'GET', url: '/api/reports/' + id, token: bob.token })
    expect(res.statusCode).toBe(403)
    expect(errorCode(res.payload)).toBe('FORBIDDEN')

    const owner = await call({ method: 'GET', url: '/api/reports/' + id, token: alice.token })
    expect(owner.statusCode).toBe(200)
    const asAdmin = await call({ method: 'GET', url: '/api/reports/' + id, token: admin.token })
    expect(asAdmin.statusCode).toBe(200)
  })

  it('成员列表只能看到自己的周报', async () => {
    await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK, title: '甲的周报' } })
    await call({ method: 'POST', url: '/api/reports', token: bob.token, body: { week: WEEK, title: '乙的周报' } })

    const mine = await call({ method: 'GET', url: '/api/reports', token: bob.token })
    expect(mine.statusCode).toBe(200)
    const list = json<{ items: ReportDTO[]; total: number }>(mine.payload)
    expect(list.total).toBe(1)
    expect(list.items[0]?.authorId).toBe(bob.id)

    const all = await call({ method: 'GET', url: '/api/reports', token: admin.token })
    expect(json<{ total: number }>(all.payload).total).toBe(2)
  })
})

describe('周报状态机', () => {
  it('已提交的周报 PATCH 返回 409 REPORT_LOCKED', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id

    const firstPatch = await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: { contentHtml: '<p>草稿正文</p>' }
    })
    expect(firstPatch.statusCode).toBe(200)

    const submitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(submitted.statusCode).toBe(200)
    expect(json<ReportDTO>(submitted.payload).status).toBe('SUBMITTED')

    const locked = await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: { contentHtml: '<p>提交后再改</p>' }
    })
    expect(locked.statusCode).toBe(409)
    expect(errorCode(locked.payload)).toBe('REPORT_LOCKED')
  })

  it('审阅非 SUBMITTED 的周报返回 409', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id

    const reviewed = await call({
      method: 'POST',
      url: '/api/reports/' + id + '/review',
      token: admin.token,
      body: { decision: 'APPROVED' }
    })
    expect(reviewed.statusCode).toBe(409)
    expect(errorCode(reviewed.payload)).toBe('CONFLICT')
  })

  it('同一作者同一周重复 POST 不会新建第二份', async () => {
    const first = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const second = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK, title: '再次保存' } })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)

    const firstId = json<ReportDTO>(first.payload).id
    const secondDto = json<ReportDTO>(second.payload)
    expect(secondDto.id).toBe(firstId)
    expect(secondDto.title).toBe('再次保存')
    expect(await prisma.report.count()).toBe(1)
  })

  it('submit 清空上一轮审核结论', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id
    await call({ method: 'PATCH', url: '/api/reports/' + id, token: alice.token, body: { contentHtml: '<p>第一版</p>' } })
    await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })

    const rejected = await call({
      method: 'POST',
      url: '/api/reports/' + id + '/review',
      token: admin.token,
      body: { decision: 'REJECTED', comment: '请补充进展数据' }
    })
    expect(rejected.statusCode).toBe(200)
    const rejectedDto = json<ReportDTO>(rejected.payload)
    expect(rejectedDto.status).toBe('REJECTED')
    expect(rejectedDto.reviewedById).toBe(admin.id)
    expect(rejectedDto.reviewComment).toBe('请补充进展数据')

    const rePatched = await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: { contentHtml: '<p>第二版，补了数据</p>' }
    })
    expect(rePatched.statusCode).toBe(200)

    const resubmitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(resubmitted.statusCode).toBe(200)
    const dto = json<ReportDTO>(resubmitted.payload)
    expect(dto.status).toBe('SUBMITTED')
    expect(dto.reviewedById).toBeNull()
    expect(dto.reviewedAt).toBeNull()
    expect(dto.reviewComment).toBeNull()
  })

  it('空正文提交返回 422', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id
    const submitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(submitted.statusCode).toBe(422)
    expect(errorCode(submitted.payload)).toBe('VALIDATION')
  })
})

describe('周报汇总', () => {
  it('管理员 summary 计算未交名单与待审阅数', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id
    await call({ method: 'PATCH', url: '/api/reports/' + id, token: alice.token, body: { contentHtml: '<p>已写内容</p>' } })
    await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })

    const res = await call({ method: 'GET', url: '/api/reports/summary', token: admin.token })
    expect(res.statusCode).toBe(200)
    const summary = json<ReportSummaryDTO>(res.payload)
    expect(summary.week).toBe(WEEK)
    expect(summary.admin).not.toBeNull()
    const missingIds = (summary.admin?.missing ?? []).map((u: UserDTO) => u.id)
    expect(missingIds).toContain(bob.id)
    expect(missingIds).not.toContain(alice.id)
    expect(missingIds).not.toContain(admin.id)
    expect(summary.admin?.pendingReview).toBe(1)

    const mineSummary = json<ReportSummaryDTO>((await call({ method: 'GET', url: '/api/reports/summary', token: alice.token })).payload)
    expect(mineSummary.admin).toBeNull()
    expect(mineSummary.mine?.id).toBe(id)
    expect(mineSummary.isOverdue).toBe(false)
  })
})

describe('周报评论与导出', () => {
  it('评论：他人周报 403，本人与管理员 201', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id

    const denied = await call({ method: 'POST', url: '/api/reports/' + id + '/comments', token: bob.token, body: { body: '路过' } })
    expect(denied.statusCode).toBe(403)

    const byAuthor = await call({ method: 'POST', url: '/api/reports/' + id + '/comments', token: alice.token, body: { body: '补充说明' } })
    expect(byAuthor.statusCode).toBe(201)
    expect(json<ReportCommentDTO>(byAuthor.payload).authorName).toBe('成员甲')

    const byAdmin = await call({ method: 'POST', url: '/api/reports/' + id + '/comments', token: admin.token, body: { body: '请按模板写' } })
    expect(byAdmin.statusCode).toBe(201)

    const detail = await call({ method: 'GET', url: '/api/reports/' + id, token: alice.token })
    expect(json<ReportDTO>(detail.payload).comments).toHaveLength(2)
  })

  it('导出 docx 返回 200、正确的 content-type 与内嵌图片', async () => {
    const mediaId = await createMedia(alice.id)
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK, title: '第 ' + WEEK + ' 周周报' } })
    const id = json<ReportDTO>(created.payload).id
    await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: { contentHtml: '<h2>本周进展</h2><p>完成资产盘点</p><img src="media:' + mediaId + '">' }
    })

    const res = await call({ method: 'GET', url: '/api/reports/' + id + '/export.docx', token: alice.token })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('wordprocessingml')
    expect(res.headers['content-disposition']).toContain('.docx')
    expect(res.rawPayload.byteLength).toBeGreaterThan(1000)
    expect(res.rawPayload.toString('latin1')).toContain('word/media')

    const denied = await call({ method: 'GET', url: '/api/reports/' + id + '/export.docx', token: bob.token })
    expect(denied.statusCode).toBe(403)
  })
})

describe('真实往返', () => {
  it('POST 建草稿 → PATCH 正文（含 media: 占位）→ submit → REJECTED → 作者再 PATCH 成功', async () => {
    const mediaId = await createMedia(alice.id)

    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    expect(created.statusCode).toBe(201)
    const id = json<ReportDTO>(created.payload).id
    expect(json<ReportDTO>(created.payload).status).toBe('DRAFT')

    const patched = await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: { title: '第 ' + WEEK + ' 周周报', contentHtml: '<p>本周完成 <strong>设备巡检</strong></p><img src="media:' + mediaId + '">' }
    })
    expect(patched.statusCode).toBe(200)
    expect(json<ReportDTO>(patched.payload).contentHtml).toContain('media:' + mediaId)

    const submitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(submitted.statusCode).toBe(200)
    expect(json<ReportDTO>(submitted.payload).status).toBe('SUBMITTED')

    const reviewed = await call({
      method: 'POST',
      url: '/api/reports/' + id + '/review',
      token: admin.token,
      body: { decision: 'REJECTED', comment: '请补充下周计划' }
    })
    expect(reviewed.statusCode).toBe(200)
    expect(json<ReportDTO>(reviewed.payload).status).toBe('REJECTED')

    const rePatched = await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: { contentHtml: '<p>补充：下周计划做两次巡检</p>' }
    })
    expect(rePatched.statusCode).toBe(200)
    const finalDto = json<ReportDTO>(rePatched.payload)
    expect(finalDto.status).toBe('REJECTED')
    expect(finalDto.contentHtml).toContain('下周计划做两次巡检')
  })
})

describe('周报模版小节', () => {
  it('POST 用生效模版自动初始化小节并首次落模版快照', async () => {
    const templateId = await createActiveTemplate()
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    expect(created.statusCode).toBe(201)

    const dto = json<ReportDTO>(created.payload)
    expect(dto.late).toBe(false)
    expect(dto.sections).toEqual([
      { key: 's1', title: '本周进展', hint: '写完成的工作', contentHtml: '' },
      { key: 's2', title: '下周计划', hint: '列出计划', contentHtml: '' }
    ])
    expect(dto.templateSnapshot).toEqual({ name: '课题组周报模版', sections: TEMPLATE_SECTIONS })

    const stored = await prisma.report.findUnique({ where: { id: dto.id } })
    expect(stored?.templateId).toBe(templateId)
    expect(stored?.templateSnapshotJson).toBeTruthy()
  })

  it('只填一节可存草稿并保留 hint，缺节提交返回 422「《小节标题》未填写」', async () => {
    await createActiveTemplate()
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id

    const patched = await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: {
        sections: [
          { key: 's1', title: '本周进展', contentHtml: '<p>完成了示波器校准</p>' },
          { key: 's2', title: '下周计划', contentHtml: '' }
        ]
      }
    })
    expect(patched.statusCode).toBe(200)
    const patchedDto = json<ReportDTO>(patched.payload)
    expect(patchedDto.sections[0]?.contentHtml).toContain('示波器校准')
    expect(patchedDto.sections[0]?.hint).toBe('写完成的工作')
    expect(patchedDto.status).toBe('DRAFT')

    const submitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(submitted.statusCode).toBe(422)
    expect(errorCode(submitted.payload)).toBe('VALIDATION')
    expect(errorMessage(submitted.payload)).toContain('《下周计划》未填写')
  })

  it('去标签后为空（含 &nbsp; 与 <br>）仍算未填写', async () => {
    await createActiveTemplate()
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id

    await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: {
        sections: [
          { key: 's1', title: '本周进展', contentHtml: '<p>本周完成了巡检</p>' },
          { key: 's2', title: '下周计划', contentHtml: '<p><br></p><p>&nbsp;</p>' }
        ]
      }
    })
    const submitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(submitted.statusCode).toBe(422)
    expect(errorMessage(submitted.payload)).toContain('《下周计划》未填写')

    await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: {
        sections: [
          { key: 's1', title: '本周进展', contentHtml: '<p>本周完成了巡检</p>' },
          { key: 's2', title: '下周计划', contentHtml: '<p>下周做两次校准</p>' }
        ]
      }
    })
    const ok = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(ok.statusCode).toBe(200)
    const submittedDto = json<ReportDTO>(ok.payload)
    expect(submittedDto.status).toBe('SUBMITTED')
    expect(submittedDto.sections[1]?.contentHtml).toContain('两次校准')
    expect(submittedDto.templateSnapshot?.name).toBe('课题组周报模版')
  })

  it('模版快照首次写入后不再随模版变化', async () => {
    await createActiveTemplate()
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id

    const template = await prisma.reportTemplate.findFirst({ where: { isActive: true } })
    await prisma.reportTemplate.update({
      where: { id: template?.id ?? '' },
      data: {
        name: '课题组周报模版 v2',
        sectionsJson: JSON.stringify([{ key: 's1', title: '改版后的小节', hint: '新提示' }])
      }
    })

    const patched = await call({
      method: 'PATCH',
      url: '/api/reports/' + id,
      token: alice.token,
      body: { sections: [{ key: 's1', title: '本周进展', contentHtml: '<p>内容</p>' }] }
    })
    expect(patched.statusCode).toBe(200)
    const dto = json<ReportDTO>(patched.payload)
    expect(dto.templateSnapshot?.name).toBe('课题组周报模版')
    expect(dto.templateSnapshot?.sections.map((section) => section.title)).toEqual(['本周进展', '下周计划'])
  })

  it('无生效模版时 sections 为空数组（旧版自由正文兼容）', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    expect(json<ReportDTO>(created.payload).sections).toEqual([])
    expect(json<ReportDTO>(created.payload).templateSnapshot).toBeNull()
  })
})

describe('提交截止与迟交', () => {
  it('默认按规则计算：summary.deadline 为本周周一 00:00 + (weekday-1) 天 + time', async () => {
    const res = await call({ method: 'GET', url: '/api/reports/summary', token: alice.token })
    expect(res.statusCode).toBe(200)
    const summary = json<ReportSummaryDTO>(res.payload)
    expect(summary.deadline.week).toBe(WEEK)
    expect(summary.deadline.source).toBe('RULE')
    expect(summary.deadline.weekday).toBe(7)
    expect(summary.deadline.time).toBe('18:00')
    expect(summary.deadline.deadline).toBe(
      computeDeadline(weekRange(new Date()).start, 7, '18:00').toISOString()
    )
  })

  it('过期提交仍返回 200 且 late=true；未过期提交 late=false', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    await overrideDeadline(WEEK, past, '提前截止')

    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id
    await call({ method: 'PATCH', url: '/api/reports/' + id, token: alice.token, body: { contentHtml: '<p>补交内容</p>' } })

    const draftSummary = json<ReportSummaryDTO>((await call({ method: 'GET', url: '/api/reports/summary', token: alice.token })).payload)
    expect(draftSummary.isOverdue).toBe(true)
    expect(draftSummary.deadline.source).toBe('OVERRIDE')
    expect(draftSummary.deadline.overrideReason).toBe('提前截止')
    expect(draftSummary.deadline.deadline).toBe(past.toISOString())

    const late = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(late.statusCode).toBe(200)
    const lateDto = json<ReportDTO>(late.payload)
    expect(lateDto.status).toBe('SUBMITTED')
    expect(lateDto.late).toBe(true)

    const afterSubmit = json<ReportSummaryDTO>((await call({ method: 'GET', url: '/api/reports/summary', token: alice.token })).payload)
    expect(afterSubmit.isOverdue).toBe(false)
  })

  it('截止时间未到的提交 late=false（走管理员 PUT 覆盖接口）', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const put = await call({
      method: 'PUT',
      url: '/api/settings/report-deadline/overrides/' + WEEK,
      token: admin.token,
      body: { deadline: future.toISOString(), reason: '本周顺延' }
    })
    expect(put.statusCode).toBe(200)

    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id
    await call({ method: 'PATCH', url: '/api/reports/' + id, token: alice.token, body: { contentHtml: '<p>按时交</p>' } })

    const submitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(submitted.statusCode).toBe(200)
    expect(json<ReportDTO>(submitted.payload).late).toBe(false)

    const summary = json<ReportSummaryDTO>((await call({ method: 'GET', url: '/api/reports/summary', token: alice.token })).payload)
    expect(summary.isOverdue).toBe(false)
    expect(summary.deadline.overrideReason).toBe('本周顺延')
  })

  it('修改全局规则后 summary.deadline 跟随规则变化', async () => {
    const patched = await call({
      method: 'PATCH',
      url: '/api/settings/report-deadline',
      token: admin.token,
      body: { weekday: 3, time: '09:15' }
    })
    expect(patched.statusCode).toBe(200)

    const summary = json<ReportSummaryDTO>((await call({ method: 'GET', url: '/api/reports/summary', token: alice.token })).payload)
    expect(summary.deadline.source).toBe('RULE')
    expect(summary.deadline.weekday).toBe(3)
    expect(summary.deadline.time).toBe('09:15')
    expect(summary.deadline.deadline).toBe(computeDeadline(weekRange(new Date()).start, 3, '09:15').toISOString())
  })
})


describe('模版小节（旧草稿）', () => {
  it('先生成草稿、后启用模版：提交时按缺节拒绝并提示模版首节', async () => {
    const created = await call({ method: 'POST', url: '/api/reports', token: alice.token, body: { week: WEEK } })
    const id = json<ReportDTO>(created.payload).id
    expect(json<ReportDTO>(created.payload).sections).toEqual([])
    await call({ method: 'PATCH', url: '/api/reports/' + id, token: alice.token, body: { contentHtml: '<p>旧版自由正文</p>' } })

    await createActiveTemplate()
    const submitted = await call({ method: 'POST', url: '/api/reports/' + id + '/submit', token: alice.token })
    expect(submitted.statusCode).toBe(422)
    expect(errorMessage(submitted.payload)).toBe('《本周进展》未填写')

    const patched = await call({ method: 'PATCH', url: '/api/reports/' + id, token: alice.token })
    expect(patched.statusCode).toBe(200)
    const dto = json<ReportDTO>(patched.payload)
    expect(dto.sections.map((section) => section.title)).toEqual(['本周进展', '下周计划'])
  })
})

