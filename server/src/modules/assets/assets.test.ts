import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import ExcelJS from 'exceljs'
import type { AssetDTO, AssetAttachmentDTO, AssetStatus, InventoryItemDTO } from '@yeyu/shared'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { signToken } from '../../plugins/auth.js'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret'
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'lab-asset-test-'))

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('test-b')) {
  throw new Error('测试必须使用独立测试库，请用 DATABASE_URL="file:./test-b.db" 运行')
}

interface Session {
  id: string
  token: string
}

let app: FastifyInstance
let admin: Session
let member: Session
let other: Session

async function createSession(phone: string, name: string, role: 'ADMIN' | 'MEMBER'): Promise<Session> {
  const user = await prisma.user.create({ data: { phone, name, role, status: 'ACTIVE', passwordHash: 'not-used' } })
  return { id: user.id, token: signToken({ id: user.id, phone: user.phone, name: user.name, role: user.role as 'ADMIN' | 'MEMBER' }) }
}

function auth(session: Session): Record<string, string> {
  return { authorization: 'Bearer ' + session.token }
}

function assetBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: 'AST-001', name: '示波器', category: '仪器设备', quantity: 1, ...overrides }
}

async function createAsset(session: Session, overrides: Record<string, unknown> = {}): Promise<AssetDTO> {
  const res = await app.inject({ method: 'POST', url: '/api/assets', headers: auth(session), payload: assetBody(overrides) })
  expect(res.statusCode).toBe(201)
  return res.json() as AssetDTO
}

function multipart(
  fields: Record<string, string>,
  file: { field: string; filename: string; contentType: string; buffer: Buffer }
): { body: Buffer; contentType: string } {
  const boundary = '----lab-asset-test-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n'))
  }
  chunks.push(
    Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="' + file.field + '"; filename="' + file.filename +
        '"\r\nContent-Type: ' + file.contentType + '\r\n\r\n'
    )
  )
  chunks.push(file.buffer)
  chunks.push(Buffer.from('\r\n--' + boundary + '--\r\n'))
  return { body: Buffer.concat(chunks), contentType: 'multipart/form-data; boundary=' + boundary }
}

const ASSET_HEADERS = ['资产编码', '资产名称', '类别', '型号', '序列号', '数量', '单价', '金额', '购置日期', '供应商', '存放位置', '责任人', '状态', '备注']

async function buildImportWorkbook(rows: (string | number | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('导入模板')
  sheet.addRow(ASSET_HEADERS)
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
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
  await prisma.inventoryItem.deleteMany()
  await prisma.inventoryBatch.deleteMany()
  await prisma.borrowRecord.deleteMany()
  await prisma.assetAttachment.deleteMany()
  await prisma.asset.deleteMany()
  await prisma.media.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany()
  admin = await createSession('13800000001', '管理员', 'ADMIN')
  member = await createSession('13800000002', '成员甲', 'MEMBER')
  other = await createSession('13800000003', '成员乙', 'MEMBER')
})

describe('资产台账', () => {
  it('列表默认按 updatedAt 倒序，支持关键词与状态过滤', async () => {
    await createAsset(member, { code: 'AST-001', name: '示波器', status: 'IN_USE' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await createAsset(member, { code: 'AST-002', name: '万用表', status: 'IDLE' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await createAsset(member, { code: 'AST-003', name: '显示器', status: 'IDLE' })

    const list = await app.inject({ method: 'GET', url: '/api/assets', headers: auth(member) })
    expect(list.statusCode).toBe(200)
    const body = list.json() as { items: AssetDTO[]; total: number; page: number; pageSize: number }
    expect(body.total).toBe(3)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
    expect(body.items.map((item) => item.code)).toEqual(['AST-003', 'AST-002', 'AST-001'])

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/assets?q=' + encodeURIComponent('表') + '&status=IDLE',
      headers: auth(member)
    })
    const filteredBody = filtered.json() as { items: AssetDTO[]; total: number }
    expect(filteredBody.total).toBe(1)
    expect(filteredBody.items[0].code).toBe('AST-002')
  })

  it('成员创建资产时 ownerId 被强制为自己，指定他人为责任人返回 403', async () => {
    const mine = await createAsset(member)
    expect(mine.ownerId).toBe(member.id)
    expect(mine.ownerName).toBe('成员甲')

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: auth(member),
      payload: assetBody({ code: 'AST-002', ownerId: other.id })
    })
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })

    const adminAssigned = await createAsset(admin, { code: 'AST-003', ownerId: other.id })
    expect(adminAssigned.ownerId).toBe(other.id)
  })

  it('重复资产编码返回 409', async () => {
    await createAsset(member, { code: 'AST-DUP' })
    const dup = await app.inject({ method: 'POST', url: '/api/assets', headers: auth(member), payload: assetBody({ code: 'AST-DUP' }) })
    expect(dup.statusCode).toBe(409)
    expect(dup.json()).toMatchObject({ error: { code: 'CONFLICT', message: '资产编码已存在' } })
  })

  it('成员修改他人资产返回 403，成员不得修改 ownerId', async () => {
    const asset = await createAsset(admin, { code: 'AST-OTHER', ownerId: other.id })
    const denied = await app.inject({
      method: 'PATCH',
      url: '/api/assets/' + asset.id,
      headers: auth(member),
      payload: { name: '偷改名称' }
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN', message: '只能修改自己负责的资产' } })

    const own = await createAsset(member, { code: 'AST-MINE' })
    const stealOwner = await app.inject({
      method: 'PATCH',
      url: '/api/assets/' + own.id,
      headers: auth(member),
      payload: { ownerId: other.id }
    })
    expect(stealOwner.statusCode).toBe(403)

    const ownUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/assets/' + own.id,
      headers: auth(member),
      payload: { location: '实验室 B-02', status: 'REPAIR' }
    })
    expect(ownUpdate.statusCode).toBe(200)
    const updated = ownUpdate.json() as AssetDTO
    expect(updated.location).toBe('实验室 B-02')
    expect(updated.status).toBe('REPAIR')
  })

  it('借用成功后资产置为 BORROWED，重复借用返回 409', async () => {
    const asset = await createAsset(member, { code: 'AST-BORROW' })
    const first = await app.inject({
      method: 'POST',
      url: '/api/assets/' + asset.id + '/borrow',
      headers: auth(member),
      payload: { dueAt: '2026-06-30', note: '课程实验' }
    })
    expect(first.statusCode).toBe(201)
    expect((first.json() as { borrowerId: string }).borrowerId).toBe(member.id)

    const afterBorrow = await app.inject({ method: 'GET', url: '/api/assets/' + asset.id, headers: auth(member) })
    const borrowed = afterBorrow.json() as AssetDTO
    expect(borrowed.status).toBe('BORROWED')
    expect(borrowed.activeBorrow?.borrowerName).toBe('成员甲')

    const second = await app.inject({ method: 'POST', url: '/api/assets/' + asset.id + '/borrow', headers: auth(member), payload: {} })
    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({ error: { code: 'CONFLICT', message: '该资产已在借用中' } })
  })

  it('无未归还记录时归还返回 409，借出后归还可回到 IN_USE', async () => {
    const asset = await createAsset(member, { code: 'AST-RETURN' })
    const noRecord = await app.inject({ method: 'POST', url: '/api/assets/' + asset.id + '/return', headers: auth(member) })
    expect(noRecord.statusCode).toBe(409)
    expect(noRecord.json()).toMatchObject({ error: { code: 'CONFLICT' } })

    await app.inject({ method: 'POST', url: '/api/assets/' + asset.id + '/borrow', headers: auth(member), payload: {} })
    const returned = await app.inject({ method: 'POST', url: '/api/assets/' + asset.id + '/return', headers: auth(member) })
    expect(returned.statusCode).toBe(200)
    expect((returned.json() as { returnedAt: string | null }).returnedAt).not.toBeNull()

    const detail = await app.inject({ method: 'GET', url: '/api/assets/' + asset.id, headers: auth(member) })
    const dto = detail.json() as AssetDTO
    expect(dto.status).toBe('IN_USE')
    expect(dto.activeBorrow).toBeNull()
  })

  it('盘点批次为范围内资产生成条目，PRESENT/MISSING 计算为 MATCH/MISSING', async () => {
    const a = await createAsset(member, { code: 'AST-INV-1', name: '频谱仪' })
    const b = await createAsset(member, { code: 'AST-INV-2', name: '信号源' })
    await createAsset(member, { code: 'AST-INV-3', name: '电源', category: '耗材' })
    void a
    void b

    const created = await app.inject({
      method: 'POST',
      url: '/api/inventory/batches',
      headers: auth(admin),
      payload: { name: '2026 春季盘点', category: '仪器设备' }
    })
    expect(created.statusCode).toBe(201)
    const batch = created.json() as { id: string; total: number; items: InventoryItemDTO[] }
    expect(batch.total).toBe(2)
    expect(batch.items.every((item) => item.result === 'PENDING')).toBe(true)
    expect(batch.items.every((item) => item.expectedStatus === 'IN_USE')).toBe(true)

    const presentItem = batch.items.find((item) => item.assetCode === 'AST-INV-1')
    const missingItem = batch.items.find((item) => item.assetCode === 'AST-INV-2')
    expect(presentItem).toBeTruthy()
    expect(missingItem).toBeTruthy()

    const present = await app.inject({
      method: 'PATCH',
      url: '/api/inventory/items/' + presentItem!.id,
      headers: auth(admin),
      payload: { actualStatus: 'PRESENT', actualLocation: '实验室 A-01' }
    })
    expect(present.statusCode).toBe(200)
    expect((present.json() as InventoryItemDTO).result).toBe('MATCH')

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/inventory/items/' + missingItem!.id,
      headers: auth(admin),
      payload: { actualStatus: 'MISSING', note: '柜里没有找到' }
    })
    expect((missing.json() as InventoryItemDTO).result).toBe('MISSING')

    const detail = await app.inject({ method: 'GET', url: '/api/inventory/batches/' + batch.id, headers: auth(member) })
    expect(detail.statusCode).toBe(200)
    const dto = detail.json() as { total: number; checked: number; mismatched: number }
    expect(dto).toMatchObject({ total: 2, checked: 2, mismatched: 1 })
  })

  it('盘点 DAMAGED / UNKNOWN 计算为 MISMATCH', async () => {
    await createAsset(member, { code: 'AST-C-1', name: '探头' })
    await createAsset(member, { code: 'AST-C-2', name: '转接头' })
    const created = await app.inject({
      method: 'POST',
      url: '/api/inventory/batches',
      headers: auth(admin),
      payload: { name: '专项盘点' }
    })
    const batch = created.json() as { id: string; items: InventoryItemDTO[] }
    const [first, second] = batch.items
    const damaged = await app.inject({
      method: 'PATCH',
      url: '/api/inventory/items/' + first.id,
      headers: auth(admin),
      payload: { actualStatus: 'DAMAGED' }
    })
    expect((damaged.json() as InventoryItemDTO).result).toBe('MISMATCH')
    const unknown = await app.inject({
      method: 'PATCH',
      url: '/api/inventory/items/' + second.id,
      headers: auth(admin),
      payload: { actualStatus: 'UNKNOWN' }
    })
    expect((unknown.json() as InventoryItemDTO).result).toBe('MISMATCH')

    const diff = await app.inject({ method: 'GET', url: '/api/inventory/batches/' + batch.id + '/export', headers: auth(member) })
    expect(diff.statusCode).toBe(200)
    expect(diff.headers['content-type']).toContain('spreadsheetml.sheet')
  })

  it('导出 20 条资产返回 xlsx，行数与表头正确', async () => {
    for (let index = 1; index <= 20; index += 1) {
      const code = 'AST-' + String(index).padStart(3, '0')
      await createAsset(member, { code, name: '导出资产 ' + index, category: index % 2 === 0 ? '电脑办公' : '仪器设备' })
    }
    const res = await app.inject({ method: 'GET', url: '/api/assets/export?sortBy=code&sortDir=asc', headers: auth(member) })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const disposition = String(res.headers['content-disposition'])
    expect(disposition).toContain("filename*=UTF-8''")
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toMatch(/^资产台账-[0-9]{8}\.xlsx$/)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(res.rawPayload)
    const sheet = workbook.getWorksheet(1)!
    const headers = (sheet.getRow(1).values as (string | undefined)[]).slice(1).map((value) => String(value))
    console.log(
      '[export] status=' + res.statusCode + ' rows=' + (sheet.rowCount - 1) + ' headers=' + headers.join(',') +
        ' disposition=' + disposition
    )
    expect(headers).toEqual(ASSET_HEADERS)
    expect(sheet.rowCount).toBe(21)
    const firstRow = (sheet.getRow(2).values as (string | number | undefined)[]).slice(1)
    const lastRow = (sheet.getRow(21).values as (string | number | undefined)[]).slice(1)
    expect(firstRow[0]).toBe('AST-001')
    expect(firstRow[1]).toBe('导出资产 1')
    expect(firstRow[12]).toBe('在用')
    expect(lastRow[0]).toBe('AST-020')

    const template = await app.inject({ method: 'GET', url: '/api/assets/template', headers: auth(member) })
    expect(template.statusCode).toBe(200)
    const templateBook = new ExcelJS.Workbook()
    await templateBook.xlsx.load(template.rawPayload)
    const templateSheet = templateBook.getWorksheet(1)!
    const templateHeaders = (templateSheet.getRow(1).values as (string | undefined)[]).slice(1).map((value) => String(value))
    expect(templateHeaders).toEqual(ASSET_HEADERS)
    expect(templateSheet.rowCount).toBe(2)
  })

  it('导入按 code upsert 并返回 created/updated/skipped/errors', async () => {
    await createAsset(admin, { code: 'IMP-001', name: '原名称', ownerId: admin.id })
    const buffer = await buildImportWorkbook([
      ['IMP-002', '导入新增资产', '仪器设备', 'M-2', 'SN-2', 2, 100, 200, '2025-01-10', '供应商甲', 'A-02', '成员甲', '闲置', '导入备注'],
      ['IMP-001', '导入改名资产', '仪器设备', null, null, 1, 100, 100, '2025-01-10', null, 'A-01', '管理员', '在用', null],
      ['IMP-003', null, '仪器设备', null, null, 1, null, null, null, null, null, null, null, null]
    ])
    const payload = multipart({}, { field: 'file', filename: 'import.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets/import',
      headers: { ...auth(admin), 'content-type': payload.contentType },
      payload: payload.body
    })
    expect(res.statusCode).toBe(200)
    const summary = res.json() as { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }
    expect(summary).toMatchObject({ created: 1, updated: 1, skipped: 1 })
    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0].row).toBe(4)

    const updated = await prisma.asset.findUniqueOrThrow({ where: { code: 'IMP-001' } })
    expect(updated.name).toBe('导入改名资产')
    const created = await prisma.asset.findUniqueOrThrow({ where: { code: 'IMP-002' } })
    expect(created.quantity).toBe(2)
    expect(created.status).toBe('IDLE')

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/assets/import',
      headers: { ...auth(member), 'content-type': payload.contentType },
      payload: payload.body
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('附件上传写入 AssetAttachment，并可通过媒体地址预览', async () => {
    const asset = await createAsset(member, { code: 'AST-ATT' })
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const payload = multipart({ kind: 'INVOICE' }, { field: 'file', filename: 'invoice.png', contentType: 'image/png', buffer: png })
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets/' + asset.id + '/attachments',
      headers: { ...auth(member), 'content-type': payload.contentType },
      payload: payload.body
    })
    expect(res.statusCode).toBe(201)
    const attachment = res.json() as AssetAttachmentDTO
    expect(attachment.kind).toBe('INVOICE')
    expect(attachment.media.url).toBe('/api/media/' + attachment.media.id)

    const detail = await app.inject({ method: 'GET', url: '/api/assets/' + asset.id, headers: auth(member) })
    expect((detail.json() as AssetDTO).attachments).toHaveLength(1)

    const preview = await app.inject({ method: 'GET', url: attachment.media.url, headers: auth(member) })
    expect(preview.statusCode).toBe(200)
    expect(preview.headers['content-type']).toBe('image/png')

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/assets/' + asset.id + '/attachments/' + attachment.id,
      headers: auth(member)
    })
    expect(removed.statusCode).toBe(200)
    expect((removed.json() as { ok: boolean }).ok).toBe(true)
    expect(await prisma.assetAttachment.count()).toBe(0)
  })

  it('写操作落库审计日志，管理员可查询 /api/audit，成员查询 403', async () => {
    const asset = await createAsset(admin, { code: 'AST-AUDIT' })
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/assets/' + asset.id,
      headers: auth(admin),
      payload: { location: 'A-09' }
    })
    expect(patch.statusCode).toBe(200)

    const logs = await prisma.auditLog.findMany({ where: { entityType: 'ASSET' }, orderBy: { createdAt: 'asc' } })
    expect(logs.map((log) => log.action)).toEqual(['CREATE', 'UPDATE'])
    expect(JSON.parse(logs[1].afterJson ?? '{}')).toEqual({ location: 'A-09' })

    const list = await app.inject({ method: 'GET', url: '/api/audit?entityType=ASSET', headers: auth(admin) })
    expect(list.statusCode).toBe(200)
    const body = list.json() as { items: { action: string; entityId: string | null }[]; total: number; page: number; pageSize: number }
    expect(body.total).toBe(2)
    expect(body.items[0].entityId).toBe(asset.id)

    const denied = await app.inject({ method: 'GET', url: '/api/audit', headers: auth(member) })
    expect(denied.statusCode).toBe(403)
  })

  it('管理员删除资产写入 DELETE 审计，成员删除 403', async () => {
    const asset = await createAsset(admin, { code: 'AST-DEL' })
    const denied = await app.inject({ method: 'DELETE', url: '/api/assets/' + asset.id, headers: auth(member) })
    expect(denied.statusCode).toBe(403)

    const res = await app.inject({ method: 'DELETE', url: '/api/assets/' + asset.id, headers: auth(admin) })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { ok: boolean }).ok).toBe(true)
    const log = await prisma.auditLog.findFirst({ where: { entityType: 'ASSET', action: 'DELETE' } })
    expect(log?.entityId).toBe(asset.id)
  })
})
