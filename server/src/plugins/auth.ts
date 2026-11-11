import jwt from 'jsonwebtoken'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Role } from '@lab/shared'
import { AppError } from '../lib/errors'

export interface AuthUser {
  id: string
  phone: string
  name: string
  role: Role
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

function secret(): string {
  return process.env.JWT_SECRET ?? 'dev-only-secret-change-me'
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, phone: user.phone, name: user.name, role: user.role }, secret(), { expiresIn: '7d' })
}

export function verifyTokenString(raw: string | null | undefined): AuthUser | null {
  if (!raw) return null
  try {
    const payload = jwt.verify(raw, secret()) as jwt.JwtPayload
    if (!payload.sub || !payload.role) return null
    return { id: String(payload.sub), phone: String(payload.phone ?? ''), name: String(payload.name ?? ''), role: payload.role as Role }
  } catch {
    return null
  }
}

export function readToken(req: FastifyRequest): AuthUser | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  return verifyTokenString(header.slice(7))
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const user = readToken(req)
  if (!user) throw AppError.unauthenticated()
  req.user = user
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply)
  if (req.user?.role !== 'ADMIN') throw AppError.forbidden('需要管理员权限')
}

export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw AppError.unauthenticated()
  return req.user
}

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return user?.role === 'ADMIN'
}

export function canEditAsset(user: AuthUser, asset: { ownerId: string | null }): boolean {
  return user.role === 'ADMIN' || (asset.ownerId !== null && asset.ownerId === user.id)
}

export function requestIp(req: FastifyRequest): string | null {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim()
  return req.ip ?? null
}
