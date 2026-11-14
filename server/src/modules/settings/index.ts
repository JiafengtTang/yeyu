import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { deadlineOverrideSchema, deadlineRuleSchema } from '@yeyu/shared'
import type { DeadlineDTO } from '@yeyu/shared'
import { AppError } from '../../lib/errors.js'
import { recordAudit } from '../../lib/audit.js'
import { isoWeekKey } from '../../lib/time.js'
import { currentUser, requestIp, requireAdmin, requireAuth } from '../../plugins/auth.js'
import {
  deleteOverride,
  listOverrides,
  loadRule,
  resolveDeadline,
  saveRule,
  upsertOverride
} from './deadline.js'

const overridesQuerySchema = z.object({
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional()
})

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {})
  if (!result.success) throw AppError.validation('参数校验失败', result.error.issues)
  return result.data
}

function weekParam(req: { query?: unknown }): string {
  const raw = (req.query as { week?: unknown } | undefined)?.week
  if (typeof raw !== 'string' || raw.length === 0) return isoWeekKey(new Date())
  return raw
}

// 归属：子任务 E（提交截止时间）。契约见 docs/API.md 第 4A 节「截止时间端点」与「计算规则」。
export async function registerSettingsModule(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/report-deadline', { preHandler: requireAuth }, async (req) => {
    return resolveDeadline(weekParam(req))
  })

  app.patch('/api/settings/report-deadline', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const input = parse(deadlineRuleSchema, req.body)
    const before = await loadRule()
    const rule = await saveRule({
      weekday: input.weekday,
      time: input.time,
      frequency: input.frequency ?? before.frequency
    })
    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'SETTING',
      entityId: 'report.deadline',
      before,
      after: rule,
      ip: requestIp(req)
    })
    return rule
  })

  app.get('/api/settings/report-deadline/overrides', { preHandler: requireAdmin }, async (req) => {
    const query = parse(overridesQuerySchema, req.query)
    const items = await listOverrides(query.from, query.to)
    return { items, total: items.length, page: 1, pageSize: items.length > 0 ? items.length : 20 }
  })

  app.put('/api/settings/report-deadline/overrides/:week', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { week } = req.params as { week: string }
    const input = parse(deadlineOverrideSchema, req.body)
    const dto: DeadlineDTO = await upsertOverride(week, input.deadline, input.reason)
    await recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'SETTING',
      entityId: 'report.deadline.override.' + week,
      before: null,
      after: { week: dto.week, deadline: dto.deadline, reason: dto.overrideReason },
      ip: requestIp(req)
    })
    return dto
  })

  app.delete('/api/settings/report-deadline/overrides/:week', { preHandler: requireAdmin }, async (req) => {
    const user = currentUser(req)
    const { week } = req.params as { week: string }
    await deleteOverride(week)
    await recordAudit({
      actor: user,
      action: 'DELETE',
      entityType: 'SETTING',
      entityId: 'report.deadline.override.' + week,
      before: { week },
      after: null,
      ip: requestIp(req)
    })
    return { ok: true }
  })
}
