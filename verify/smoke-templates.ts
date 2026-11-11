// v2 冒烟：模版上传解析 → 按小节填写 → 缺节拒交 → 截止规则/覆盖 → 迟交标记
// 运行：cd server && DATABASE_URL="file:./smoke2.db" npx tsx ../verify/smoke-templates.ts
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { buildApp } from '../server/src/app'
import { prisma } from '../server/src/lib/prisma'
import { signToken } from '../server/src/plugins/auth'
import { isoWeekKey } from '../shared/src/index'

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url))
const bcrypt = requireFromServer('bcryptjs') as typeof import('bcryptjs')

const results: Array<{ step: string; ok: boolean; detail: string }> = []
function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + step + '  —  ' + detail)
}

function multipart(fields: Record<string, string>, file: { name: string; filename: string; contentType: string; data: Buffer }) {
  const boundary = '----labboundary' + Date.now()
  const chunks: Buffer[] = []
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + value + '\r\n'))
  }
  chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + file.name + '"; filename="' + file.filename + '"\r\nContent-Type: ' + file.contentType + '\r\n\r\n'))
  chunks.push(file.data)
  chunks.push(Buffer.from('\r\n--' + boundary + '--\r\n'))
  return { body: Buffer.concat(chunks), contentType: 'multipart/form-data; boundary=' + boundary }
}

async function main() {
  mkdirSync(process.env.UPLOAD_DIR ?? '/tmp', { recursive: true })
  await prisma.report.deleteMany({})
  await prisma.reportTemplate.deleteMany({})
  await prisma.deadlineOverride.deleteMany({})
  await prisma.appSetting.deleteMany({})
  await prisma.user.deleteMany({})

  const bcryptHash = await bcrypt.hash('Admin@123456', 10)
  await prisma.user.create({ data: { id: 'adm', phone: '13600000000', passwordHash: bcryptHash, name: '组长', role: 'ADMIN', status: 'ACTIVE' } })
  await prisma.user.create({ data: { id: 'mem', phone: '13600000001', passwordHash: bcryptHash, name: '小王', role: 'MEMBER', status: 'ACTIVE' } })
  const ta = signToken({ id: 'adm', phone: '13600000000', name: '组长', role: 'ADMIN' })
  const tm = signToken({ id: 'mem', phone: '13600000001', name: '小王', role: 'MEMBER' })
  const ah = { authorization: 'Bearer ' + ta }
  const mh = { authorization: 'Bearer ' + tm }
  const app = await buildApp()

  // 1) 截止规则
  const setRule = await app.inject({ method: 'PATCH', url: '/api/settings/report-deadline', headers: ah, payload: { weekday: 5, time: '17:30' } })
  check('设置截止规则 周五 17:30', setRule.statusCode === 200, 'http=' + setRule.statusCode)
  const deadlineRule = await app.inject({ method: 'GET', url: '/api/settings/report-deadline', headers: mh })
  const ruleBody = deadlineRule.json() as { deadline?: string; source?: string; weekday?: number; time?: string }
  const expectedHour = ruleBody.deadline ? new Date(ruleBody.deadline).getHours() : -1
  check('规则生效（时间=17:30 且 source=RULE）', deadlineRule.statusCode === 200 && expectedHour === 17 && ruleBody.source === 'RULE', 'deadline=' + ruleBody.deadline + ' source=' + ruleBody.source)

  const week = isoWeekKey(new Date())
  const past = new Date(Date.now() - 7 * 86400000).toISOString()
  const override = await app.inject({ method: 'PUT', url: '/api/settings/report-deadline/overrides/' + week, headers: ah, payload: { deadline: past, reason: '国庆顺延' } })
  const overrideCheck = await app.inject({ method: 'GET', url: '/api/settings/report-deadline?week=' + week, headers: mh })
  const ovBody = overrideCheck.json() as { source?: string; overrideReason?: string }
  check('单周覆盖优先', override.statusCode === 200 && ovBody.source === 'OVERRIDE' && ovBody.overrideReason === '国庆顺延', 'source=' + ovBody.source)
  await app.inject({ method: 'DELETE', url: '/api/settings/report-deadline/overrides/' + week, headers: ah })

  // 2) 上传 markdown 模版
  const md = '# 课题组周报\n\n## 本周进展\n在这里写完成的工作\n\n## 下周计划\n列出计划\n\n## 问题与需求\n需要协调的事项\n'
  const mp = multipart({ name: '课题组周报模版', activate: '1' }, { name: 'file', filename: 'template.md', contentType: 'text/markdown', data: Buffer.from(md, 'utf8') })
  const upload = await app.inject({ method: 'POST', url: '/api/templates', headers: { ...ah, 'content-type': mp.contentType }, payload: mp.body })
  const tpl = upload.json() as { id?: string; sections?: Array<{ key: string; title: string; hint: string }>; isActive?: boolean }
  check('上传 md 模版并解析小节', upload.statusCode === 201 && (tpl.sections?.length ?? 0) === 3 && tpl.isActive === true, 'sections=' + JSON.stringify(tpl.sections?.map((s) => s.title)))
  check('小节 hint 解析', (tpl.sections?.[1]?.hint ?? '').includes('列出计划'), 'hint=' + JSON.stringify(tpl.sections?.[1]?.hint))

  const active = await app.inject({ method: 'GET', url: '/api/templates/active', headers: mh })
  check('成员可读当前生效模版', active.statusCode === 200 && (active.json() as { id?: string }).id === tpl.id, 'http=' + active.statusCode)

  const noHeading = multipart({}, { name: 'file', filename: 'bad.md', contentType: 'text/markdown', data: Buffer.from('没有标题的正文\n就这样', 'utf8') })
  const badUpload = await app.inject({ method: 'POST', url: '/api/templates', headers: { ...ah, 'content-type': noHeading.contentType }, payload: noHeading.body })
  check('无标题文件被拒 422', badUpload.statusCode === 422, 'http=' + badUpload.statusCode)

  // 3) 周报按小节填写
  const create = await app.inject({ method: 'POST', url: '/api/reports', headers: mh, payload: {} })
  const report = create.json() as { id?: string; sections?: Array<{ key: string; title: string }>; status?: string }
  check('新建周报自动带出模版小节', create.statusCode === 201 && (report.sections?.length ?? 0) === 3, 'sections=' + String(report.sections?.length))

  const sections = (report.sections ?? []).map((s, i) => ({ key: s.key, title: s.title, contentHtml: i === 0 ? '<p>完成了示波器校准</p>' : '' }))
  const partial = await app.inject({ method: 'PATCH', url: '/api/reports/' + report.id, headers: mh, payload: { sections } })
  check('只填一节可保存草稿', partial.statusCode === 200, 'http=' + partial.statusCode)

  const submitPartial = await app.inject({ method: 'POST', url: '/api/reports/' + report.id + '/submit', headers: mh, payload: {} })
  const errMsg = (submitPartial.json() as { error?: { message?: string } }).error?.message ?? ''
  check('缺节提交被拒 422 且提示小节名', submitPartial.statusCode === 422 && errMsg.includes('下周计划'), 'http=' + submitPartial.statusCode + ' msg=' + errMsg)

  const full = sections.map((s) => ({ ...s, contentHtml: s.contentHtml || '<p>已补充</p>' }))
  await app.inject({ method: 'PATCH', url: '/api/reports/' + report.id, headers: mh, payload: { sections: full } })
  const submitOk = await app.inject({ method: 'POST', url: '/api/reports/' + report.id + '/submit', headers: mh, payload: {} })
  const submitted = submitOk.json() as { status?: string; templateSnapshot?: { name?: string } | null; sections?: unknown[] }
  check('补齐后可提交', submitOk.statusCode === 200 && submitted.status === 'SUBMITTED', 'http=' + submitOk.statusCode)
  check('提交时写入模版快照', !!submitted.templateSnapshot?.name, 'snapshot=' + JSON.stringify(submitted.templateSnapshot?.name))

  // 4) 过期提交 → late
  const lastWeek = new Date(Date.now() - 7 * 86400000)
  const lw = isoWeekKey(lastWeek)
  const mkDraft = await app.inject({ method: 'POST', url: '/api/reports', headers: mh, payload: { week: lw } })
  const lastReport = mkDraft.json() as { id?: string; sections?: Array<{ key: string; title: string }> }
  const lastSections = (lastReport.sections ?? []).map((s) => ({ key: s.key, title: s.title, contentHtml: '<p>补交内容</p>' }))
  await app.inject({ method: 'PATCH', url: '/api/reports/' + lastReport.id, headers: mh, payload: { sections: lastSections } })
  const lateSubmit = await app.inject({ method: 'POST', url: '/api/reports/' + lastReport.id + '/submit', headers: mh, payload: {} })
  const lateBody = lateSubmit.json() as { late?: boolean; status?: string }
  check('过期提交仍成功且 late=true', lateSubmit.statusCode === 200 && lateBody.late === true, 'http=' + lateSubmit.statusCode + ' late=' + String(lateBody.late))

  const summary = await app.inject({ method: 'GET', url: '/api/reports/summary', headers: ah })
  const sumBody = summary.json() as { deadline?: { deadline?: string; source?: string }; isOverdue?: boolean }
  check('工作台返回截止时间', summary.statusCode === 200 && !!sumBody.deadline?.deadline, 'deadline=' + sumBody.deadline?.deadline + ' source=' + sumBody.deadline?.source)

  const docx = await app.inject({ method: 'GET', url: '/api/reports/' + report.id + '/export.docx', headers: ah })
  check('导出 Word 仍正常', docx.statusCode === 200 && ['wordprocessingml', 'openxml'].some((k) => String(docx.headers['content-type']).includes(k)), 'bytes=' + String(docx.rawPayload.length))

  await app.close()
  await prisma.$disconnect()
  const failed = results.filter((r) => !r.ok)
  console.log('\n=== v2 冒烟：' + String(results.length - failed.length) + '/' + String(results.length) + ' 通过 ===')
  if (failed.length > 0) { console.log('失败项：' + failed.map((f2) => f2.step).join(' / ')); process.exit(1) }
}

main().catch((err) => { console.error('冒烟脚本异常：', err); process.exit(1) })
