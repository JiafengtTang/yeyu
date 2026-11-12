import type { DeadlineDTO } from '@yeyu/shared'

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday - 1] ?? '周一'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** MM-DD HH:mm（本地时区） */
export function formatDeadlineShort(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 截止来源说明：规则 →「规则：周日 18:00」；单周覆盖 →「单周覆盖：原因」 */
export function deadlineSourceLabel(dto: DeadlineDTO): string {
  if (dto.source === 'OVERRIDE') return dto.overrideReason ? '单周覆盖：' + dto.overrideReason : '单周覆盖'
  return '规则：' + weekdayLabel(dto.weekday) + ' ' + dto.time
}

export function isPastDeadline(dto: DeadlineDTO | null | undefined, now: Date = new Date()): boolean {
  if (!dto) return false
  const time = new Date(dto.deadline).getTime()
  return !Number.isNaN(time) && now.getTime() > time
}

/** datetime-local 需要本地时区的 YYYY-MM-DDTHH:mm（不能用 toISOString，那是 UTC） */
export function toDateTimeLocalValue(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  )
}

/** datetime-local 输入 → ISO 字符串；非法输入返回 null */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
