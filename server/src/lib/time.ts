import { isoWeekKey, weekRange, weekKeyToRange } from '@yeyu/shared'

export { isoWeekKey, weekRange, weekKeyToRange }

export function weekOf(date: Date): { week: string; periodStart: Date; periodEnd: Date } {
  const range = weekRange(date)
  return { week: isoWeekKey(date), periodStart: range.start, periodEnd: range.end }
}

export function resolveWeek(week?: string | null): { week: string; periodStart: Date; periodEnd: Date } {
  if (week) {
    const range = weekKeyToRange(week)
    if (range) return { week, periodStart: range.start, periodEnd: range.end }
  }
  return weekOf(new Date())
}

export function parseDateInput(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}
