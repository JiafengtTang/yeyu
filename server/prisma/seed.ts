/**
 * 初始化数据脚本（幂等，可重复执行）
 *
 * 1. 创建首个管理员：手机号取 SEED_ADMIN_PHONE（缺省 13800000000 仅作本地演示），
 *    姓名取 SEED_ADMIN_NAME，密码取 SEED_ADMIN_PASSWORD（缺省 Admin@123456 仅作本地演示）；
 *    已存在则跳过（不会覆盖密码、角色或状态）。**生产环境必须设置这三个变量。**
 * 2. SEED_DEMO=1 时额外写入 5 条示例资产（按 code upsert，重复执行不会翻倍）。
 *    示例资产为虚构数据，不含任何真实资产信息。
 *
 * 用法：
 *   cd server && pnpm db:seed                                   # 读 server/.env 的 DATABASE_URL
 *   DATABASE_URL="file:./seedtest.db" npx tsx server/prisma/seed.ts   # 指向临时库验证
 *
 * 注意：DATABASE_URL 是相对路径时，Prisma 以 schema.prisma 所在目录（server/prisma/）为基准，
 * 因此 "file:./seedtest.db" 落在 server/prisma/seedtest.db。
 */
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 缺省值仅用于本地演示；生产部署请通过环境变量覆盖，避免使用默认账号
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '13800000000'
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? '系统管理员'
const DEFAULT_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456'

interface DemoAsset {
  code: string
  name: string
  category: string
  model: string
  serialNo: string
  quantity: number
  unitPrice: number
  amount: number
  purchaseDate: Date
  supplier: string
  location: string
  status: string
  remark: string
}

const DEMO_ASSETS: DemoAsset[] = [
  {
    code: 'DEMO-0001',
    name: '数字示波器',
    category: '仪器设备',
    model: 'Tektronix MSO54',
    serialNo: 'MSO54-220118',
    quantity: 1,
    unitPrice: 128000,
    amount: 128000,
    purchaseDate: new Date('2025-03-01T00:00:00.000Z'),
    supplier: '泰克科技（上海）有限公司',
    location: 'A 座 302 电子实验室',
    status: 'IN_USE',
    remark: '示例数据，可安全删除'
  },
  {
    code: 'DEMO-0002',
    name: '电子万能材料试验机',
    category: '仪器设备',
    model: 'Instron 5967',
    serialNo: 'IN5967-2024-007',
    quantity: 1,
    unitPrice: 468000,
    amount: 468000,
    purchaseDate: new Date('2024-09-12T00:00:00.000Z'),
    supplier: '英斯特朗（上海）实验设备贸易有限公司',
    location: 'B 座 105 力学实验室',
    status: 'IN_USE',
    remark: '示例数据，可安全删除'
  },
  {
    code: 'DEMO-0003',
    name: '图形工作站',
    category: '电脑办公',
    model: 'Dell Precision 7960',
    serialNo: 'DP7960-A021',
    quantity: 2,
    unitPrice: 42000,
    amount: 84000,
    purchaseDate: new Date('2025-01-20T00:00:00.000Z'),
    supplier: '戴尔（中国）有限公司',
    location: 'A 座 210 仿真间',
    status: 'IDLE',
    remark: '示例数据，可安全删除'
  },
  {
    code: 'DEMO-0004',
    name: '有限元仿真软件授权',
    category: '软件服务',
    model: 'Abaqus 2024 教育版（3 节点）',
    serialNo: 'ABA-EDU-3N-2024',
    quantity: 1,
    unitPrice: 56000,
    amount: 56000,
    purchaseDate: new Date('2024-11-05T00:00:00.000Z'),
    supplier: '达索系统（上海）信息技术有限公司',
    location: '服务器机房（License Server 10.20.30.41）',
    status: 'IN_USE',
    remark: '示例数据，可安全删除'
  },
  {
    code: 'DEMO-0005',
    name: '数显外径千分尺',
    category: '耗材',
    model: 'Mitutoyo 293-340-30',
    serialNo: 'MT293-005',
    quantity: 5,
    unitPrice: 980,
    amount: 4900,
    purchaseDate: new Date('2025-06-18T00:00:00.000Z'),
    supplier: '三丰精密量仪（上海）有限公司',
    location: 'B 座 105 力学实验室（工具柜 3）',
    status: 'REPAIR',
    remark: '示例数据：其中 1 把送修，可安全删除'
  }
]

async function seedAdmin(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { phone: ADMIN_PHONE } })
  if (existing) {
    console.log(
      '[seed] 管理员已存在，跳过：' + existing.phone + '（' + existing.name + ' / ' + existing.role + ' / ' + existing.status + '）'
    )
    return existing.id
  }
  const password = process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD
  const passwordHash = await bcrypt.hash(password, 10)
  const created = await prisma.user.create({
    data: {
      phone: ADMIN_PHONE,
      passwordHash,
      name: ADMIN_NAME,
      role: 'ADMIN',
      status: 'ACTIVE'
    }
  })
  console.log('[seed] 已创建管理员：' + created.phone + ' / ' + created.name + '（初始密码见 SEED_ADMIN_PASSWORD 或 docs/部署与使用.md）')
  return created.id
}

async function seedDemoAssets(adminId: string): Promise<void> {
  let created = 0
  let skipped = 0
  for (const asset of DEMO_ASSETS) {
    const exists = await prisma.asset.findUnique({ where: { code: asset.code } })
    if (exists) {
      skipped += 1
      continue
    }
    await prisma.asset.create({
      data: {
        ...asset,
        ownerId: adminId,
        createdById: adminId
      }
    })
    created += 1
  }
  console.log('[seed] 示例资产：新增 ' + String(created) + ' 条，已存在跳过 ' + String(skipped) + ' 条')
}

async function main(): Promise<void> {
  const adminId = await seedAdmin()
  if (process.env.SEED_DEMO === '1') {
    await seedDemoAssets(adminId)
  } else {
    console.log('[seed] 未设置 SEED_DEMO=1，跳过示例资产')
  }
  const userCount = await prisma.user.count()
  const assetCount = await prisma.asset.count()
  console.log('[seed] 完成：当前用户 ' + String(userCount) + ' 个、资产 ' + String(assetCount) + ' 条')
}

main()
  .catch((err: unknown) => {
    console.error('[seed] 失败：' + (err instanceof Error ? err.message : String(err)))
    if (!process.env.DATABASE_URL) {
      console.error('[seed] 提示：未读到 DATABASE_URL。请在 server/ 目录下执行（读取 server/.env），或显式传入 DATABASE_URL=...')
    }
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
