import { prisma } from './prisma'
import type { AuthUser } from '../plugins/auth'

export interface AuditInput {
  actor?: AuthUser | null
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  ip?: string | null
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.actor?.id ?? null,
        actorName: input.actor?.name ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeJson: toJson(input.before),
        afterJson: toJson(input.after),
        ip: input.ip ?? null
      }
    })
  } catch (err) {
    console.error('recordAudit failed', err)
  }
}
