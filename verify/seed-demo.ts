/**
 * 生成一套纯演示数据（假人、假手机号、假资产），只用于宣传页截图。
 * 用法：
 *   DATABASE_URL="file:./demo.db" npx prisma db push --skip-generate
 *   DATABASE_URL="file:./demo.db" npx tsx ../verify/seed-demo.ts
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../server/src/lib/prisma.js'

const PASSWORD = 'Demo@123456'

const GROUPS = [
  { name: '熔池监测组', description: '声发射监测与状态辨识' },
  { name: '工艺组', description: '工艺窗口与缺陷控制' },
  { name: '仿真组', description: '热-流-固多场仿真' }
]

const USERS = [
  { phone: '19900000001', name: '陈工', role: 'ADMIN', group: '熔池监测组' },
  { phone: '19900000002', name: '林小雨', role: 'MEMBER', group: '熔池监测组' },
  { phone: '19900000003', name: '周凯', role: 'MEMBER', group: '工艺组' },
  { phone: '19900000004', name: '许文', role: 'MEMBER', group: '仿真组' },
  { phone: '19900000005', name: '高远', role: 'MEMBER', group: '熔池监测组' }
]

const ASSETS = [
  { code: 'LAB-2026-001', name: '数字示波器', category: '仪器设备', model: 'MSO54', quantity: 1, unitPrice: 36800, location: '实验楼 A302', status: 'IN_USE', group: '熔池监测组' },
  { code: 'LAB-2026-002', name: '声发射采集卡', category: '仪器设备', model: 'PCIe-6351', quantity: 2, unitPrice: 8900, location: '实验楼 A302', status: 'IN_USE', group: '熔池监测组' },
  { code: 'LAB-2026-003', name: '工控机工作站', category: '电脑办公', model: 'ThinkStation P3', quantity: 1, unitPrice: 15999, location: '实验楼 A305', status: 'IDLE', group: '仿真组' },
  { code: 'LAB-2026-004', name: '高速相机', category: '仪器设备', model: 'Phantom VEO', quantity: 1, unitPrice: 128000, location: '实验楼 B101', status: 'BORROWED', group: '工艺组' },
  { code: 'LAB-2026-005', name: '激光功率计', category: '测量工具', model: 'PM100D', quantity: 1, unitPrice: 5600, location: '实验楼 A302', status: 'IN_USE', group: '工艺组' },
  { code: 'LAB-2026-006', name: '氩气钢瓶', category: '耗材', model: '40L', quantity: 6, unitPrice: 320, location: '气瓶间', status: 'IN_USE', group: null }
]

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const groups = new Map<string, string>()
  for (const group of GROUPS) {
    const row = await prisma.group.upsert({ where: { name: group.name }, update: { description: group.description }, create: group })
    groups.set(group.name, row.id)
  }

  const users = new Map<string, string>()
  for (const user of USERS) {
    const row = await prisma.user.upsert({
      where: { phone: user.phone },
      update: { name: user.name, groupId: groups.get(user.group) ?? null, role: user.role, status: 'ACTIVE' },
      create: {
        phone: user.phone,
        name: user.name,
        role: user.role,
        status: 'ACTIVE',
        passwordHash,
        groupId: groups.get(user.group) ?? null
      }
    })
    users.set(user.name, row.id)
  }

  const adminId = users.get('陈工')!
  for (const [index, asset] of ASSETS.entries()) {
    const ownerId = [users.get('林小雨'), users.get('周凯'), users.get('许文'), users.get('高远')][index % 4] ?? adminId
    await prisma.asset.upsert({
      where: { code: asset.code },
      update: {},
      create: {
        code: asset.code,
        name: asset.name,
        category: asset.category,
        model: asset.model,
        quantity: asset.quantity,
        unitPrice: asset.unitPrice,
        amount: asset.unitPrice * asset.quantity,
        purchaseDate: new Date(2026, 2, 12),
        supplier: '示范供应商',
        location: asset.location,
        status: asset.status,
        ownerId,
        groupId: asset.group ? groups.get(asset.group) ?? null : null,
        createdById: adminId
      }
    })
  }

  // 一条已提交的周报（给审阅页与统计页用）
  const template = await prisma.reportTemplate.findFirst({ where: { isActive: true } })
  const sections = template ? (JSON.parse(template.sectionsJson) as Array<{ key: string; title: string; hint: string }>) : []
  const week = '2026-W45'
  const periodStart = new Date(2026, 10, 2)
  const periodEnd = new Date(2026, 10, 8, 23, 59, 59)
  const author = users.get('林小雨')!
  await prisma.report.deleteMany({ where: { authorId: author, periodStart } })
  await prisma.report.create({
    data: {
      authorId: author,
      week,
      periodStart,
      periodEnd,
      title: '第 45 周工作周报',
      status: 'SUBMITTED',
      submittedAt: new Date(2026, 10, 6, 17, 12),
      templateId: template?.id ?? null,
      templateSnapshotJson: template?.sectionsJson ?? null,
      sectionsJson: JSON.stringify(
        sections.map((section, index) => ({
          key: section.key,
          title: section.title,
          hint: '',
          contentHtml:
            index === 0
              ? '<p>本周完成 3 组工艺窗口试验，锁孔缺陷率由 12% 降至 4%。</p>'
              : index === 1
                ? '<p>整理了上月的声发射原始数据，补齐标注。</p>'
                : '<p>下周补做变功率条件下的重复性试验。</p>'
        }))
      )
    }
  })

  // 笔记与日报
  const noteAuthor = users.get('林小雨')!
  const noteSeeds = [
    { title: '声发射特征频段', contentHtml: '<p>#文献 锁孔塌陷在 120–200 kHz 有明显能量抬升，参考 [[工艺窗口试验记录]]。</p>' },
    { title: '工艺窗口试验记录', contentHtml: '<p>#实验 功率 180–220 W，扫描速度 800–1200 mm/s，共 12 组。</p>' },
    { title: '待补充的想法', contentHtml: '<p>想把 [[声发射特征频段]] 和小波包分解对上。</p>' }
  ]
  for (const seed of noteSeeds) {
    const exists = await prisma.note.findFirst({ where: { ownerId: noteAuthor, title: seed.title } })
    if (exists) continue
    await prisma.note.create({ data: { ownerId: noteAuthor, kind: 'NOTE', title: seed.title, contentHtml: seed.contentHtml } })
  }
  const today = new Date(2026, 10, 16)
  const dayKey = '2026-11-16'
  const daily = await prisma.note.findFirst({ where: { ownerId: noteAuthor, day: dayKey } })
  if (!daily) {
    await prisma.note.create({
      data: {
        ownerId: noteAuthor,
        kind: 'DAILY',
        day: dayKey,
        title: dayKey,
        contentHtml: '<p>上午跑了两组重复性试验，下午整理数据。<strong>结论</strong>：变功率工况下仍需补 5 组。</p>',
        plainText: ''
      }
    })
  }

  // 备忘录
  const memos = [
    { title: '把高速相机归还实验室', dueAt: new Date(2026, 10, 15, 17, 0) },
    { title: '补交第 46 周周报', dueAt: new Date(2026, 10, 20, 17, 30) },
    { title: '联系供应商询价氩气钢瓶', dueAt: null }
  ]
  for (const memo of memos) {
    const exists = await prisma.memo.findFirst({ where: { ownerId: noteAuthor, title: memo.title } })
    if (exists) continue
    await prisma.memo.create({ data: { ownerId: noteAuthor, title: memo.title, dueAt: memo.dueAt } })
  }

  console.log('演示数据已生成：' + USERS.length + ' 用户 / ' + ASSETS.length + ' 资产 / ' + GROUPS.length + ' 小组')
  console.log('演示账号：19900000001 / ' + PASSWORD + '（陈工，管理员）')
  console.log('注意：这是演示数据，不要用于真实使用。')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
