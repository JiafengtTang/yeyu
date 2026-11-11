// 端到端冒烟：注册 → 审批 → 登录 → 录资产 → 借还 → 写周报（含图片）→ 提交 → 退回 → 再审 → 导出
// 运行：cd server && DATABASE_URL="file:./smoke.db" npx tsx ../verify/smoke.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { buildApp } from '../server/src/app'
import { prisma } from '../server/src/lib/prisma'
import { signToken } from '../server/src/plugins/auth'

const uploadRoot = process.env.UPLOAD_DIR as string
const results: Array<{ step: string; ok: boolean; detail: string }> = []

function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + step + '  —  ' + detail)
}

async function main() {
  const app = await buildApp()

  // 0) admin 账号（登录接口需要密码哈希，直接落库）
  const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url))
  const bcrypt = requireFromServer('bcryptjs') as typeof import('bcryptjs')
  const adminHash = await bcrypt.hash('Admin@123456', 10)
  const admin = await prisma.user.create({ data: { phone: '13900000000', passwordHash: adminHash, name: '组长', role: 'ADMIN', status: 'ACTIVE' } })

  // 1) 注册
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { phone: '13900000001', password: 'Member@123', name: '小王' } })
  const regBody = reg.json() as { user?: { id: string; status: string } }
  check('注册成员', reg.statusCode === 201 && regBody.user?.status === 'PENDING', 'http=' + reg.statusCode + ' status=' + regBody.user?.status)

  // 2) 未审批登录被拒
  const loginPending = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '13900000001', password: 'Member@123' } })
  check('未审批登录被拒', loginPending.statusCode === 403, 'http=' + loginPending.statusCode)

  // 3) 管理员登录 + 审批
  const admLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '13900000000', password: 'Admin@123456' } })
  const admToken = (admLogin.json() as { token?: string }).token
  check('管理员登录', admLogin.statusCode === 200 && !!admToken, 'http=' + admLogin.statusCode)
  const approve = await app.inject({ method: 'PATCH', url: '/api/users/' + (regBody.user?.id ?? ''), headers: { authorization: 'Bearer ' + admToken }, payload: { status: 'ACTIVE' } })
  check('审批通过', approve.statusCode === 200, 'http=' + approve.statusCode)

  // 4) 成员登录
  const memLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '13900000001', password: 'Member@123' } })
  const memToken = (memLogin.json() as { token?: string }).token as string
  check('成员登录', memLogin.statusCode === 200 && !!memToken, 'http=' + memLogin.statusCode)
  const mh = { authorization: 'Bearer ' + memToken }
  const ah = { authorization: 'Bearer ' + admToken }

  // 5) 资产 + 借用归还
  const asset = await app.inject({ method: 'POST', url: '/api/assets', headers: mh, payload: { code: 'SMOKE-001', name: '频谱仪', category: '仪器设备', quantity: 1, unitPrice: 12800, location: '实验台 B' } })
  const assetId = (asset.json() as { id?: string }).id ?? ''
  check('新建资产', asset.statusCode === 201 && !!assetId, 'http=' + asset.statusCode + ' id=' + assetId.slice(0, 8))
  const borrow = await app.inject({ method: 'POST', url: '/api/assets/' + assetId + '/borrow', headers: ah, payload: { note: '借给李老师' } })
  const ret = await app.inject({ method: 'POST', url: '/api/assets/' + assetId + '/return', headers: ah, payload: {} })
  check('借用→归还', borrow.statusCode < 300 && ret.statusCode < 300, 'borrow=' + borrow.statusCode + ' return=' + ret.statusCode)

  // 6) 盘点
  const batch = await app.inject({ method: 'POST', url: '/api/inventory/batches', headers: ah, payload: { name: '2026 秋季盘点' } })
  const batchBody = batch.json() as { id?: string; items?: Array<{ id: string }> }
  check('创建盘点批次', batch.statusCode === 201 && (batchBody.items?.length ?? 0) > 0, 'http=' + batch.statusCode + ' items=' + String(batchBody.items?.length ?? 0))
  const diffXlsx = await app.inject({ method: 'GET', url: '/api/inventory/batches/' + (batchBody.id ?? '') + '/export', headers: ah })
  check('盘点差异导出', diffXlsx.statusCode === 200, 'http=' + diffXlsx.statusCode + ' bytes=' + String(diffXlsx.rawPayload.length))

  // 7) 周报：草稿 → 带图正文 → 提交
  const mediaId = 'smoke-photo'
  const bucket = '2026-11'
  mkdirSync(path.join(uploadRoot, bucket), { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  writeFileSync(path.join(uploadRoot, bucket, mediaId + '.png'), png)
  await prisma.media.create({ data: { id: mediaId, filename: 'photo.png', mime: 'image/png', size: png.length, path: path.join(bucket, mediaId + '.png'), usage: 'REPORT' } })

  const mediaGet = await app.inject({ method: 'GET', url: '/api/media/' + mediaId + '?token=' + memToken })
  check('周报图片可经 ?token= 读取', mediaGet.statusCode === 200 && String(mediaGet.headers['content-type']).includes('image'), 'http=' + mediaGet.statusCode)

  const draft = await app.inject({ method: 'POST', url: '/api/reports', headers: mh, payload: { title: '第 1 周周报' } })
  const reportId = (draft.json() as { id?: string }).id ?? ''
  check('创建周报草稿', draft.statusCode === 201 && !!reportId, 'http=' + draft.statusCode)
  const patch = await app.inject({ method: 'PATCH', url: '/api/reports/' + reportId, headers: mh, payload: { contentHtml: '<h2>本周进展</h2><p>完成频谱仪校准。</p><img src="media:' + mediaId + '">' } })
  check('写入图文正文', patch.statusCode === 200, 'http=' + patch.statusCode)
  const submit = await app.inject({ method: 'POST', url: '/api/reports/' + reportId + '/submit', headers: mh, payload: {} })
  check('提交周报', submit.statusCode === 200 && (submit.json() as { status?: string }).status === 'SUBMITTED', 'http=' + submit.statusCode)
  const patchLocked = await app.inject({ method: 'PATCH', url: '/api/reports/' + reportId, headers: mh, payload: { contentHtml: '<p>提交后再改</p>' } })
  check('已提交不可改（锁定）', patchLocked.statusCode === 409, 'http=' + patchLocked.statusCode)

  // 8) 审阅：退回 → 再改 → 再审通过
  const reject = await app.inject({ method: 'POST', url: '/api/reports/' + reportId + '/review', headers: ah, payload: { decision: 'REJECTED', comment: '补充下周计划' } })
  check('管理员退回', reject.statusCode === 200 && (reject.json() as { status?: string }).status === 'REJECTED', 'http=' + reject.statusCode)
  const patchAgain = await app.inject({ method: 'PATCH', url: '/api/reports/' + reportId, headers: mh, payload: { contentHtml: '<p>已补充下周计划</p><img src="media:' + mediaId + '">' } })
  check('退回后可再编辑', patchAgain.statusCode === 200, 'http=' + patchAgain.statusCode)
  await app.inject({ method: 'POST', url: '/api/reports/' + reportId + '/submit', headers: mh, payload: {} })
  const approveReport = await app.inject({ method: 'POST', url: '/api/reports/' + reportId + '/review', headers: ah, payload: { decision: 'APPROVED', comment: '通过' } })
  check('管理员通过', approveReport.statusCode === 200 && (approveReport.json() as { status?: string }).status === 'APPROVED', 'http=' + approveReport.statusCode)

  const comment = await app.inject({ method: 'POST', url: '/api/reports/' + reportId + '/comments', headers: ah, payload: { body: '下周补充采购清单' } })
  check('批注评论', comment.statusCode === 201 || comment.statusCode === 200, 'http=' + comment.statusCode)

  // 9) 汇总与导出
  const summary = await app.inject({ method: 'GET', url: '/api/reports/summary', headers: ah })
  const sumBody = summary.json() as { week?: string; mine?: unknown; admin?: { missing?: unknown[]; pendingReview?: number } }
  check('工作台汇总', summary.statusCode === 200 && !!sumBody.week && !!sumBody.admin, 'http=' + summary.statusCode + ' week=' + String(sumBody.week) + ' missing=' + String(sumBody.admin?.missing?.length ?? -1))

  const docx = await app.inject({ method: 'GET', url: '/api/reports/' + reportId + '/export.docx', headers: ah })
  check('导出 Word', docx.statusCode === 200 && String(docx.headers['content-type']).includes('wordprocessingml'), 'http=' + docx.statusCode + ' bytes=' + String(docx.rawPayload.length))

  const xlsx = await app.inject({ method: 'GET', url: '/api/assets/export', headers: ah })
  let rows = -1
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer)
    rows = wb.worksheets[0]?.rowCount ?? -1
  } catch {
    rows = -1
  }
  check('资产导出可被 ExcelJS 回读', xlsx.statusCode === 200 && rows >= 2, 'http=' + xlsx.statusCode + ' rows=' + String(rows))

  const audit = await app.inject({ method: 'GET', url: '/api/audit?pageSize=100', headers: ah })
  const auditBody = audit.json() as { total?: number }
  check('审计日志有记录', audit.statusCode === 200 && (auditBody.total ?? 0) > 0, 'http=' + audit.statusCode + ' total=' + String(auditBody.total))

  await app.close()
  await prisma.$disconnect()

  const failed = results.filter((r) => !r.ok)
  console.log('\n=== 冒烟结果：' + String(results.length - failed.length) + '/' + String(results.length) + ' 通过 ===')
  if (failed.length > 0) {
    console.log('失败项：' + failed.map((f) => f.step).join(' / '))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('冒烟脚本异常：', err)
  process.exit(1)
})
