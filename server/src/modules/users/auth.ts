import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { loginSchema, registerSchema, type Role } from '@lab/shared'
import { recordAudit } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { currentUser, requestIp, requireAuth, signToken } from '../../plugins/auth.js'
import { parseInput, toUserDTO, userAuditSnapshot } from './shared.js'

const BCRYPT_COST = 10

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const input = parseInput(registerSchema, request.body)
    const exists = await prisma.user.findUnique({ where: { phone: input.phone } })
    if (exists) throw AppError.conflict('该手机号已注册')
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST)
    const user = await prisma.user.create({
      data: {
        phone: input.phone,
        passwordHash,
        name: input.name,
        email: input.email ?? null,
        role: 'MEMBER',
        status: 'PENDING'
      }
    })
    await recordAudit({
      action: 'REGISTER',
      entityType: 'USER',
      entityId: user.id,
      after: userAuditSnapshot(user),
      ip: requestIp(request)
    })
    return reply.status(201).send({ user: toUserDTO(user) })
  })

  app.post('/api/auth/login', async (request) => {
    const input = parseInput(loginSchema, request.body)
    const user = await prisma.user.findUnique({ where: { phone: input.phone } })
    const passwordOk = user ? await bcrypt.compare(input.password, user.passwordHash) : false
    if (!user || !passwordOk) throw AppError.unauthenticated('手机号或密码不正确')
    if (user.status === 'PENDING') throw AppError.forbidden('账号待管理员审批')
    if (user.status === 'DISABLED') throw AppError.forbidden('账号已被禁用')
    if (user.status !== 'ACTIVE') throw AppError.forbidden('账号状态不可登录')

    const actor = { id: user.id, phone: user.phone, name: user.name, role: user.role as Role }
    const token = signToken(actor)
    await recordAudit({
      actor,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      after: userAuditSnapshot(user),
      ip: requestIp(request)
    })
    return { token, user: toUserDTO(user) }
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const actor = currentUser(request)
    const user = await prisma.user.findUnique({ where: { id: actor.id } })
    if (!user) throw AppError.unauthenticated('账号不存在')
    if (user.status === 'PENDING') throw AppError.forbidden('账号待管理员审批')
    if (user.status !== 'ACTIVE') throw AppError.forbidden('账号已被禁用')
    return toUserDTO(user)
  })
}
