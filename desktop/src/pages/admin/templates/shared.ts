import type { ListResult } from '@yeyu/shared'

export interface DeadlineOverrideItem {
  week: string
  deadline: string
  reason: string | null
}

export function emptyList<T>(): ListResult<T> {
  return { items: [], total: 0, page: 1, pageSize: 0 }
}
