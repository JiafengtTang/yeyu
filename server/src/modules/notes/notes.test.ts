import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import type { ListResult, NoteDTO, NoteGraphDTO, NoteSummaryDTO } from '@yeyu/shared'
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

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.noteLink.deleteMany({})
  await prisma.note.deleteMany({})
  await prisma.user.deleteMany({})
  alice = await makeAccount('13700000001', '甲')
  bob = await makeAccount('13700000002', '乙')
})

describe('日报与笔记', () => {
  it('日报按天取或建：同一天两次请求返回同一条，标题为日期', async () => {
    const first = await call({ method: 'GET', url: '/api/notes/daily?day=2026-11-13', token: alice.token })
    expect(first.statusCode).toBe(200)
    const a = json<NoteDTO>(first.payload)
    expect(a.kind).toBe('DAILY')
    expect(a.title).toBe('2026-11-13')

    const second = await call({ method: 'GET', url: '/api/notes/daily?day=2026-11-13', token: alice.token })
    expect(json<NoteDTO>(second.payload).id).toBe(a.id)
  })

  it('自由笔记：创建/列表/详情；标题为空返回 422', async () => {
    const created = await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '实验想法' } })
    expect(created.statusCode).toBe(201)
    const note = json<NoteDTO>(created.payload)
    expect(note.kind).toBe('NOTE')
    expect(note.title).toBe('实验想法')

    const list = await call({ method: 'GET', url: '/api/notes?kind=NOTE', token: alice.token })
    expect(json<ListResult<NoteSummaryDTO>>(list.payload).items.map((n) => n.title)).toEqual(['实验想法'])

    const bad = await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '  ' } })
    expect(bad.statusCode).toBe(422)
  })

  it('双向链接：[[标题]] 解析到已有笔记，反链出现在目标笔记；未命中保持 noteId=null', async () => {
    const target = json<NoteDTO>((await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '声发射基础' } })).payload)
    const source = json<NoteDTO>(
      (
        await call({
          method: 'POST',
          url: '/api/notes',
          token: alice.token,
          body: { title: '本周记录', contentHtml: '<p>参考 [[声发射基础]] 与 [[还没写的笔记]] #实验</p>' }
        })
      ).payload
    )

    const sourceDetail = json<NoteDTO>((await call({ method: 'GET', url: '/api/notes/' + source.id, token: alice.token })).payload)
    const byTitle = new Map(sourceDetail.links.map((l) => [l.title, l.noteId]))
    expect(byTitle.get('声发射基础')).toBe(target.id)
    expect(byTitle.get('还没写的笔记')).toBeNull()
    expect(sourceDetail.tags).toEqual(['实验'])

    const targetDetail = json<NoteDTO>((await call({ method: 'GET', url: '/api/notes/' + target.id, token: alice.token })).payload)
    expect(targetDetail.backlinks.map((b) => b.title)).toEqual(['本周记录'])
  })

  it('先写 [[标题]] 后创建该笔记，未解析链接会自动接上', async () => {
    const source = json<NoteDTO>(
      (
        await call({
          method: 'POST',
          url: '/api/notes',
          token: alice.token,
          body: { title: '先有引用', contentHtml: '<p>见 [[后创建的笔记]]</p>' }
        })
      ).payload
    )
    const before = json<NoteDTO>((await call({ method: 'GET', url: '/api/notes/' + source.id, token: alice.token })).payload)
    expect(before.links[0]?.noteId).toBeNull()

    const target = json<NoteDTO>((await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '后创建的笔记' } })).payload)

    const after = json<NoteDTO>((await call({ method: 'GET', url: '/api/notes/' + source.id, token: alice.token })).payload)
    expect(after.links[0]?.noteId).toBe(target.id)

    const graph = json<NoteGraphDTO>((await call({ method: 'GET', url: '/api/notes/graph', token: alice.token })).payload)
    expect(graph.edges).toEqual([{ source: source.id, target: target.id }])
  })

  it('按标签筛选与全文搜索', async () => {
    await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '键孔缺陷', contentHtml: '<p>#实验 观察熔池</p>' } })
    await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '文献笔记', contentHtml: '<p>#文献 读了 LSTM 相关</p>' } })

    const tagged = await call({ method: 'GET', url: '/api/notes?tag=文献', token: alice.token })
    expect(json<ListResult<NoteSummaryDTO>>(tagged.payload).items.map((n) => n.title)).toEqual(['文献笔记'])

    const searched = await call({ method: 'GET', url: '/api/notes?q=熔池', token: alice.token })
    expect(json<ListResult<NoteSummaryDTO>>(searched.payload).items.map((n) => n.title)).toEqual(['键孔缺陷'])

    const tags = await call({ method: 'GET', url: '/api/notes/tags', token: alice.token })
    expect(json<{ items: Array<{ tag: string; count: number }> }>(tags.payload).items.map((t) => t.tag).sort()).toEqual(['实验', '文献'])
  })

  it('日历与图谱：日历只列有内容的日报日期，图谱含已解析的边', async () => {
    const daily = json<NoteDTO>((await call({ method: 'GET', url: '/api/notes/daily?day=2026-11-05', token: alice.token })).payload)
    await call({ method: 'PATCH', url: '/api/notes/' + daily.id, token: alice.token, body: { contentHtml: '<p>写了点东西</p>' } })
    await call({ method: 'GET', url: '/api/notes/daily?day=2026-11-06', token: alice.token })

    const calendar = await call({ method: 'GET', url: '/api/notes/calendar?month=2026-11', token: alice.token })
    expect(json<{ items: Array<{ day: string; hasContent: boolean }> }>(calendar.payload).items).toEqual([
      { day: '2026-11-05', hasContent: true },
      { day: '2026-11-06', hasContent: false }
    ])

    const target = json<NoteDTO>((await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '目标笔记' } })).payload)
    await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '引用方', contentHtml: '<p>[[目标笔记]]</p>' } })

    const graph = await call({ method: 'GET', url: '/api/notes/graph', token: alice.token })
    const dto = json<NoteGraphDTO>(graph.payload)
    expect(dto.nodes.some((n) => n.id === target.id)).toBe(true)
    expect(dto.edges.length).toBe(1)
  })

  it('仅本人可见：他人笔记一律 404，删除后列表减少', async () => {
    const note = json<NoteDTO>((await call({ method: 'POST', url: '/api/notes', token: alice.token, body: { title: '私人笔记' } })).payload)

    const peek = await call({ method: 'GET', url: '/api/notes/' + note.id, token: bob.token })
    expect(peek.statusCode).toBe(404)

    const bobList = await call({ method: 'GET', url: '/api/notes', token: bob.token })
    expect(json<ListResult<NoteSummaryDTO>>(bobList.payload).total).toBe(0)

    const removed = await call({ method: 'DELETE', url: '/api/notes/' + note.id, token: alice.token })
    expect(removed.statusCode).toBe(200)
    const after = await call({ method: 'GET', url: '/api/notes', token: alice.token })
    expect(json<ListResult<NoteSummaryDTO>>(after.payload).total).toBe(0)
  })

  it('导出 Markdown：带标题与粗体标记', async () => {
    const note = json<NoteDTO>(
      (
        await call({
          method: 'POST',
          url: '/api/notes',
          token: alice.token,
          body: { title: '导出示例', contentHtml: '<h2>小节</h2><p><strong>重点</strong> 与 <em>斜体</em></p><ul><li>条目一</li></ul>' }
        })
      ).payload
    )
    const res = await call({ method: 'GET', url: '/api/notes/' + note.id + '/markdown', token: alice.token })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    const body = res.payload
    expect(body.startsWith('# 导出示例')).toBe(true)
    expect(body).toContain('## 小节')
    expect(body).toContain('**重点**')
    expect(body).toContain('*斜体*')
    expect(body).toContain('- 条目一')
  })
})
