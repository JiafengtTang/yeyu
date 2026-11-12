import type { DeadlineDTO } from '@yeyu/shared'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/errors.js'
import { weekKeyToRange } from '../../lib/time.js'

/** AppSetting 键：截止规则（1=周一 … 7=周日）与 HH:mm */
export const WEEKDAY_KEY = 'report.deadline.weekday'
export const TIME_KEY = 'report.deadline.time'

export const DEFAULT_WEEKDAY = 7
export const DEFAULT_TIME = '18:00'

export const WEEK_RE = /^[0-9]{4}-W[0-9]{2}$/
export const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

export interface DeadlineRule {
  weekday: number
  time: string
}

/** 设置值缺失或损坏时回落到默认规则（周日 18:00），不阻断读取 */
export function ruleFromSettings(values: Record<string, string | undefined>): DeadlineRule {
  const rawWeekday = Number(values[WEEKDAY_KEY])
  const weekday = Number.isInteger(rawWeekday) && rawWeekday >= 1 && rawWeekday <= 7 ? rawWeekday : DEFAULT_WEEKDAY
  const rawTime = values[TIME_KEY]
  const time = rawTime && TIME_RE.test(rawTime) ? rawTime : DEFAULT_TIME
  return { weekday, time }
}

export async function loadRule(): Promise<DeadlineRule> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [WEEKDAY_KEY, TIME_KEY] } } })
  const values: Record<string, string> = {}
  for (const row of rows) values[row.key] = row.value
  return ruleFromSettings(values)
}

export async function saveRule(rule: DeadlineRule): Promise<DeadlineRule> {
  if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) {
    throw AppError.validation('截止星期应在 1–7 之间（1=周一，7=周日）')
  }
  if (!TIME_RE.test(rule.time)) throw AppError.validation('时间格式应为 HH:mm')
  const weekday = String(rule.weekday)
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: WEEKDAY_KEY },
      create: { key: WEEKDAY_KEY, value: weekday },
      update: { value: weekday }
    }),
    prisma.appSetting.upsert({
      where: { key: TIME_KEY },
      create: { key: TIME_KEY, value: rule.time },
      update: { value: rule.time }
    })
  ])
  return { weekday: rule.weekday, time: rule.time }
}

/** 该 ISO 周周一 00:00 + (weekday-1) 天 + time，全部按本地时区 */
export function computeDeadline(periodStart: Date, weekday: number, time: string): Date {
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const deadline = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate())
  deadline.setDate(deadline.getDate() + (weekday - 1))
  deadline.setHours(hour, minute, 0, 0)
  return deadline
}

function weekdayOf(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

function timeOf(date: Date): string {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

export function assertWeek(week: string): void {
  if (!WEEK_RE.test(week) || weekKeyToRange(week) === null) throw AppError.validation('周次格式应为 YYYY-Www')
}

/** 单周截止时间：有覆盖用覆盖值（source=OVERRIDE），否则按全局规则计算 */
export async function resolveDeadline(week: string): Promise<DeadlineDTO> {
  assertWeek(week)
  const override = await prisma.deadlineOverride.findUnique({ where: { week } })
  if (override) {
    return {
      week,
      deadline: override.deadline.toISOString(),
      source: 'OVERRIDE',
      weekday: weekdayOf(override.deadline),
      time: timeOf(override.deadline),
      overrideReason: override.reason ?? null
    }
  }
  const range = weekKeyToRange(week)
  if (!range) throw AppError.validation('周次格式应为 YYYY-Www')
  const rule = await loadRule()
  return {
    week,
    deadline: computeDeadline(range.start, rule.weekday, rule.time).toISOString(),
    source: 'RULE',
    weekday: rule.weekday,
    time: rule.time,
    overrideReason: null
  }
}

/** 提交时刻是否已过本轮截止时间（过期不阻断提交，只记 late） */
export async function isPastDeadline(week: string, now: Date = new Date()): Promise<boolean> {
  const dto = await resolveDeadline(week)
  return now.getTime() > new Date(dto.deadline).getTime()
}

export async function upsertOverride(week: string, deadlineInput: string, reason?: string): Promise<DeadlineDTO> {
  assertWeek(week)
  const deadline = new Date(deadlineInput)
  if (Number.isNaN(deadline.getTime())) throw AppError.validation('截止时间格式不正确')
  const trimmed = reason?.trim()
  await prisma.deadlineOverride.upsert({
    where: { week },
    create: { week, deadline, reason: trimmed && trimmed.length > 0 ? trimmed : null },
    update: { deadline, reason: trimmed && trimmed.length > 0 ? trimmed : null }
  })
  return resolveDeadline(week)
}

export async function deleteOverride(week: string): Promise<void> {
  assertWeek(week)
  await prisma.deadlineOverride.deleteMany({ where: { week } })
}

export interface DeadlineOverrideRow {
  week: string
  deadline: string
  reason: string | null
}

export async function listOverrides(from?: string, to?: string): Promise<DeadlineOverrideRow[]> {
  if (from) assertWeek(from)
  if (to) assertWeek(to)
  const where: { week?: { gte?: string; lte?: string } } = {}
  if (from || to) {
    where.week = {}
    if (from) where.week.gte = from
    if (to) where.week.lte = to
  }
  const rows = await prisma.deadlineOverride.findMany({ where, orderBy: { week: 'desc' } })
  return rows.map((row) => ({ week: row.week, deadline: row.deadline.toISOString(), reason: row.reason ?? null }))
}
