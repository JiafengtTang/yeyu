import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type { FastifyInstance } from 'fastify'
import { isoWeekKey } from '@yeyu/shared'
import type { ReportDTO, ReportTemplateDTO } from '@yeyu/shared'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { signToken } from '../../plugins/auth.js'

const UPLOAD_ROOT = path.resolve(process.cwd(), '.tmp-templates-uploads')
process.env.UPLOAD_DIR = UPLOAD_ROOT

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface Account {
  id: string
  token: string
}

interface FilePart {
  field: string
  filename: string
  contentType: string
  data: Buffer
}

let app: FastifyInstance
let admin: Account
let member: Account

function multipart(fields: Record<string, string>, file: FilePart, fileFirst = false): { body: Buffer; contentType: string } {
  const boundary = '----labboundary' + String(Date.now()) + String(Math.random()).slice(2, 8)
  const chunks: Buffer[] = []
  const fieldChunks = Object.entries(fields).map(([key, value]) =>
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + value + '\r\n')
  )
  const fileChunks = [
    Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="' + file.field + '"; filename="' + file.filename + '"\r\nContent-Type: ' + file.contentType + '\r\n\r\n'
    ),
    file.data,
    Buffer.from('\r\n')
  ]
  if (fileFirst) {
    chunks.push(fileChunks[0], fileChunks[1], fileChunks[2], ...fieldChunks)
  } else {
    chunks.push(...fieldChunks, fileChunks[0], fileChunks[1], fileChunks[2])
  }
  chunks.push(Buffer.from('--' + boundary + '--\r\n'))
  return { body: Buffer.concat(chunks), contentType: 'multipart/form-data; boundary=' + boundary }
}

interface DocxParagraph {
  text: string
  /** 标题样式：Heading 1 / 标题 2 … */
  style?: string
  /** w:outlineLvl 值 */
  outline?: number
}

/** 现场生成最简 docx（zip 里只放 word/document.xml），不依赖外部夹具文件 */
async function buildDocx(paragraphs: DocxParagraph[], withDocumentXml = true, stylesXml?: string): Promise<Buffer> {
  const zip = new JSZip()
  const body = paragraphs
    .map((paragraph) => {
      const props = [
        paragraph.style ? '<w:pStyle w:val="' + paragraph.style + '"/>' : '',
        paragraph.outline === undefined ? '' : '<w:outlineLvl w:val="' + String(paragraph.outline) + '"/>'
      ]
        .filter((part) => part.length > 0)
        .join('')
      const pPr = props.length > 0 ? '<w:pPr>' + props + '</w:pPr>' : ''
      return '<w:p>' + pPr + '<w:r><w:t xml:space="preserve">' + paragraph.text + '</w:t></w:r></w:p>'
    })
    .join('')
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body +
    '</w:body></w:document>'
  if (withDocumentXml) zip.file('word/document.xml', xml)
  else zip.file('word/other.xml', xml)
  if (stylesXml) zip.file('word/styles.xml', stylesXml)
  return zip.generateAsync({ type: 'nodebuffer' })
}

function json<T>(payload: string): T {
  return JSON.parse(payload) as T
}

function errorMessage(payload: string): string {
  return json<{ error: { message: string } }>(payload).error.message
}

async function makeAccount(phone: string, name: string, role: 'ADMIN' | 'MEMBER'): Promise<Account> {
  const user = await prisma.user.create({
    data: { phone, name, role, status: 'ACTIVE', passwordHash: 'not-used-in-templates-tests' }
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

async function uploadTemplate(opts: {
  token: string
  file: FilePart
  fields?: Record<string, string>
  fileFirst?: boolean
}) {
  const body = multipart(opts.fields ?? {}, opts.file, opts.fileFirst ?? false)
  return app.inject({
    method: 'POST',
    url: '/api/templates',
    headers: { authorization: 'Bearer ' + opts.token, 'content-type': body.contentType },
    payload: body.body
  })
}

const MD_SOURCE =
  '# 课题组周报\n\n## 本周进展\n【提示】在这里写完成的工作\n本周实际写的内容\n\n## 下周计划\n提示：列出计划\n\n## 问题与需求\n[提示]需要协调的事项\n'

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
  admin = await makeAccount('13200000001', '管理员甲', 'ADMIN')
  member = await makeAccount('13200000002', '成员甲', 'MEMBER')
})

describe('模版上传与解析', () => {
  it('上传 .md 解析出小节与 hint，activate=1 立即生效', async () => {
    const res = await uploadTemplate({
      token: admin.token,
      fields: { name: '课题组周报模版', activate: '1' },
      file: { field: 'file', filename: 'template.md', contentType: 'text/markdown', data: Buffer.from(MD_SOURCE, 'utf8') }
    })
    expect(res.statusCode).toBe(201)
    const dto = json<ReportTemplateDTO>(res.payload)
    expect(dto.name).toBe('课题组周报模版')
    expect(dto.sourceFormat).toBe('md')
    expect(dto.sourceName).toBe('template.md')
    expect(dto.isActive).toBe(true)
    expect(dto.reportCount).toBe(0)
    expect(dto.sections).toEqual([
      { key: 's1', title: '本周进展', hint: '在这里写完成的工作' },
      { key: 's2', title: '下周计划', hint: '列出计划' },
      { key: 's3', title: '问题与需求', hint: '需要协调的事项' }
    ])

    const stored = await prisma.reportTemplate.findUnique({ where: { id: dto.id } })
    expect(stored?.rawPath).toBeTruthy()
    const media = await prisma.media.findFirst({ where: { usage: 'TEMPLATE' } })
    expect(media?.path).toBe(stored?.rawPath)

    const active = await app.inject({
      method: 'GET',
      url: '/api/templates/active',
      headers: { authorization: 'Bearer ' + member.token }
    })
    expect(active.statusCode).toBe(200)
    expect(json<ReportTemplateDTO>(active.payload).id).toBe(dto.id)
  })

  it('.md 以 application/octet-stream 上传也能解析（文档型 MIME 归一化）', async () => {
    const res = await uploadTemplate({
      token: admin.token,
      file: { field: 'file', filename: 'note.markdown', contentType: 'application/octet-stream', data: Buffer.from(MD_SOURCE, 'utf8') }
    })
    expect(res.statusCode).toBe(201)
    expect(json<ReportTemplateDTO>(res.payload).sections).toHaveLength(3)
  })

  it('字段在文件之后也能读取（activate 生效顺序无关）', async () => {
    const res = await uploadTemplate({
      token: admin.token,
      fields: { activate: '1' },
      fileFirst: true,
      file: { field: 'file', filename: 'template.md', contentType: 'text/markdown', data: Buffer.from(MD_SOURCE, 'utf8') }
    })
    expect(res.statusCode).toBe(201)
    expect(json<ReportTemplateDTO>(res.payload).isActive).toBe(true)
  })

  it('上传 .docx（Heading 1/2 + outlineLvl）解析小节、解 XML 实体、hint 截断 200 字', async () => {
    const docx = await buildDocx([
      { text: '课题组周报', style: 'Heading 1' },
      { text: '本周进展', style: 'Heading 2' },
      { text: '【提示】完成示波器校准 &amp; 电源测试' },
      { text: '下周计划', style: '标题 2' },
      { text: '【提示】列出计划 &lt;待定&gt;' + '张'.repeat(250) },
      { text: '问题与需求', outline: 1 },
      { text: '需要协调的事项' }
    ])
    const res = await uploadTemplate({
      token: admin.token,
      fields: { activate: '1' },
      file: { field: 'file', filename: 'template.docx', contentType: DOCX_MIME, data: docx }
    })
    expect(res.statusCode).toBe(201)
    const dto = json<ReportTemplateDTO>(res.payload)
    expect(dto.sourceFormat).toBe('docx')
    expect(dto.sections.map((section) => section.title)).toEqual(['本周进展', '下周计划', '问题与需求'])
    expect(dto.sections[0]?.hint).toBe('完成示波器校准 & 电源测试')
    expect(dto.sections[1]?.hint.startsWith('列出计划 <待定>')).toBe(true)
    expect(dto.sections[1]?.hint.length).toBe(200)
    expect(dto.sections[0]?.key).toBe('s1')
    expect(dto.sections[2]?.key).toBe('s3')
  })

  it('中文 Word 的样式 id（1/2 + styles.xml heading 1/2）按真实周报结构识别小节', async () => {
    const styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="a0"><w:name w:val="List Paragraph"/></w:style>' +
      '</w:styles>'
    const docx = await buildDocx(
      [
        { text: '示例周报', style: '1' },
        { text: '研究进展（科研的进展记录，数据的分析报告）', style: '2' },
        { text: '【提示】按方向写清本周进展' },
        { text: '前两周其他事务', style: '2' },
        { text: '(4' },
        { text: '下阶段研究计划', style: '2' },
        { text: '阅读论文；' }
      ],
      true,
      styles
    )
    const res = await uploadTemplate({
      token: admin.token,
      fields: { activate: '1' },
      file: { field: 'file', filename: 'real-weekly.docx', contentType: DOCX_MIME, data: docx }
    })
    expect(res.statusCode).toBe(201)
    const dto = json<ReportTemplateDTO>(res.payload)
    // 「标题 1」只出现一次 → 当文档标题跳过；「标题 2」出现三次 → 作为小节
    expect(dto.sections.map((section) => section.title)).toEqual([
      '研究进展（科研的进展记录，数据的分析报告）',
      '前两周其他事务',
      '下阶段研究计划'
    ])
    expect(dto.sections[0]?.hint).toBe('按方向写清本周进展')
    // 正文与更深层标题不再进入 hint
    expect(dto.sections[1]?.hint).toBe('')
    expect(dto.sections[2]?.hint).toBe('')
  })

  it('无小节标题的 md / docx 返回 422 且提示可操作', async () => {
    const md = await uploadTemplate({
      token: admin.token,
      file: { field: 'file', filename: 'bad.md', contentType: 'text/markdown', data: Buffer.from('没有标题的正文\n就这样', 'utf8') }
    })
    expect(md.statusCode).toBe(422)
    expect(errorMessage(md.payload)).toContain('小节标题')

    const docx = await uploadTemplate({
      token: admin.token,
      file: {
        field: 'file',
        filename: 'bad.docx',
        contentType: DOCX_MIME,
        data: await buildDocx([{ text: '只有正文，没有标题样式' }])
      }
    })
    expect(docx.statusCode).toBe(422)
    expect(errorMessage(docx.payload)).toContain('小节标题')
    expect(await prisma.reportTemplate.count()).toBe(0)
  })

  it('小节数超过 30 返回 422', async () => {
    const lines: string[] = []
    for (let index = 1; index <= 31; index += 1) lines.push('## 小节' + String(index))
    const res = await uploadTemplate({
      token: admin.token,
      file: { field: 'file', filename: 'many.md', contentType: 'text/markdown', data: Buffer.from(lines.join('\n'), 'utf8') }
    })
    expect(res.statusCode).toBe(422)
    expect(errorMessage(res.payload)).toContain('30')
    expect(await prisma.reportTemplate.count()).toBe(0)
  })

  it('小节标题超过 120 字返回 422', async () => {
    const longTitle = '长'.repeat(121)
    const res = await uploadTemplate({
      token: admin.token,
      file: { field: 'file', filename: 'long.md', contentType: 'text/markdown', data: Buffer.from('# ' + longTitle + '\n正文', 'utf8') }
    })
    expect(res.statusCode).toBe(422)
    expect(errorMessage(res.payload)).toContain('120')
  })

  it('损坏的 docx（缺 word/document.xml）与不支持的扩展名返回 422', async () => {
    const broken = await uploadTemplate({
      token: admin.token,
      file: { field: 'file', filename: 'broken.docx', contentType: DOCX_MIME, data: await buildDocx([{ text: '正文' }], false) }
    })
    expect(broken.statusCode).toBe(422)
    expect(errorMessage(broken.payload)).toContain('document.xml')

    const txt = await uploadTemplate({
      token: admin.token,
      file: { field: 'file', filename: 'bad.txt', contentType: 'text/plain', data: Buffer.from(MD_SOURCE, 'utf8') }
    })
    expect(txt.statusCode).toBe(422)
    expect(errorMessage(txt.payload)).toContain('仅支持')
  })
})

describe('模版生效与引用', () => {
  it('activate 互斥：始终只有一个生效模版', async () => {
    const first = json<ReportTemplateDTO>(
      (await uploadTemplate({
        token: admin.token,
        fields: { name: '模版 A', activate: '1' },
        file: { field: 'file', filename: 'a.md', contentType: 'text/markdown', data: Buffer.from(MD_SOURCE, 'utf8') }
      })).payload
    )
    const second = json<ReportTemplateDTO>(
      (await uploadTemplate({
        token: admin.token,
        fields: { name: '模版 B', activate: '0' },
        file: { field: 'file', filename: 'b.md', contentType: 'text/markdown', data: Buffer.from(MD_SOURCE, 'utf8') }
      })).payload
    )
    expect(first.isActive).toBe(true)
    expect(second.isActive).toBe(false)

    const activated = await app.inject({
      method: 'PATCH',
      url: '/api/templates/' + second.id + '/activate',
      headers: { authorization: 'Bearer ' + admin.token }
    })
    expect(activated.statusCode).toBe(200)
    expect(json<ReportTemplateDTO>(activated.payload).isActive).toBe(true)

    const list = await app.inject({ method: 'GET', url: '/api/templates', headers: { authorization: 'Bearer ' + admin.token } })
    const items = json<{ items: ReportTemplateDTO[]; total: number }>(list.payload)
    expect(items.total).toBe(2)
    expect(items.items.filter((item) => item.isActive).map((item) => item.id)).toEqual([second.id])
    expect(items.items[0]?.id).toBe(second.id)

    const onlyOne = await prisma.reportTemplate.count({ where: { isActive: true } })
    expect(onlyOne).toBe(1)
  })

  it('reportCount 统计引用数；删除模版后历史周报仍靠快照展示', async () => {
    const template = json<ReportTemplateDTO>(
      (await uploadTemplate({
        token: admin.token,
        fields: { activate: '1' },
        file: { field: 'file', filename: 'template.md', contentType: 'text/markdown', data: Buffer.from(MD_SOURCE, 'utf8') }
      })).payload
    )

    const created = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: 'Bearer ' + member.token },
      payload: { week: isoWeekKey(new Date()) }
    })
    expect(created.statusCode).toBe(201)
    const report = json<ReportDTO>(created.payload)
    expect(report.sections.map((section) => section.title)).toEqual(['本周进展', '下周计划', '问题与需求'])
    expect(report.templateSnapshot?.name).toBe(template.name)

    const list = await app.inject({ method: 'GET', url: '/api/templates', headers: { authorization: 'Bearer ' + admin.token } })
    expect(json<{ items: ReportTemplateDTO[] }>(list.payload).items[0]?.reportCount).toBe(1)

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/templates/' + template.id,
      headers: { authorization: 'Bearer ' + admin.token }
    })
    expect(removed.statusCode).toBe(200)
    expect(json<{ ok: boolean }>(removed.payload)).toEqual({ ok: true })

    const detail = await app.inject({
      method: 'GET',
      url: '/api/reports/' + report.id,
      headers: { authorization: 'Bearer ' + member.token }
    })
    expect(detail.statusCode).toBe(200)
    const snapshot = json<ReportDTO>(detail.payload).templateSnapshot
    expect(snapshot?.name).toBe(template.name)
    expect(snapshot?.sections).toHaveLength(3)

    const active = await app.inject({
      method: 'GET',
      url: '/api/templates/active',
      headers: { authorization: 'Bearer ' + admin.token }
    })
    expect(active.statusCode).toBe(200)
    expect(json<ReportTemplateDTO | null>(active.payload)).toBeNull()
  })

  it('权限：成员不能上传/生效/删除，匿名不能列模版，未知 id 返回 404', async () => {
    const byMember = await uploadTemplate({
      token: member.token,
      file: { field: 'file', filename: 'x.md', contentType: 'text/markdown', data: Buffer.from(MD_SOURCE, 'utf8') }
    })
    expect(byMember.statusCode).toBe(403)

    const anonymous = await app.inject({ method: 'GET', url: '/api/templates' })
    expect(anonymous.statusCode).toBe(401)

    const activateMissing = await app.inject({
      method: 'PATCH',
      url: '/api/templates/not-exist/activate',
      headers: { authorization: 'Bearer ' + admin.token }
    })
    expect(activateMissing.statusCode).toBe(404)

    const deleteMissing = await app.inject({
      method: 'DELETE',
      url: '/api/templates/not-exist',
      headers: { authorization: 'Bearer ' + admin.token }
    })
    expect(deleteMissing.statusCode).toBe(404)

    const activatedByMember = await app.inject({
      method: 'PATCH',
      url: '/api/templates/not-exist/activate',
      headers: { authorization: 'Bearer ' + member.token }
    })
    expect(activatedByMember.statusCode).toBe(403)
  })
})
