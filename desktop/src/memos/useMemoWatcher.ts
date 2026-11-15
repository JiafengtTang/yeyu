import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemoDTO, MemoSummaryDTO } from '@yeyu/shared'
import { api } from '../api/client'
import { useToast } from '../ui'

export const MEMO_CHANGED_EVENT = 'yeyu:memos-changed'

const EMPTY: MemoSummaryDTO = { openCount: 0, overdueCount: 0, todayCount: 0, dueNow: [], today: [] }

/** 每 60 秒拉一次备忘录摘要：到期未完成的弹一次提醒，并把未完成数给侧边栏角标 */
export function useMemoWatcher(): { summary: MemoSummaryDTO; refresh: () => void } {
  const toast = useToast()
  const [summary, setSummary] = useState<MemoSummaryDTO>(EMPTY)
  const reminded = useRef<Set<string>>(new Set())

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api<MemoSummaryDTO>('/api/memos/summary')
      setSummary(next)
      const fresh: MemoDTO[] = next.dueNow.filter((memo) => !reminded.current.has(memo.id))
      if (fresh.length > 0) {
        for (const memo of fresh) {
          reminded.current.add(memo.id)
          toast.push('该做这件事了：' + memo.title, 'info')
          void api<MemoDTO>('/api/memos/' + memo.id, { method: 'PATCH', body: { reminded: true } }).catch(() => undefined)
        }
      }
    } catch {
      // 未登录或服务不可用时静默跳过
    }
  }, [toast])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    const onChange = (): void => void load()
    window.addEventListener(MEMO_CHANGED_EVENT, onChange)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(MEMO_CHANGED_EVENT, onChange)
    }
  }, [load])

  return { summary, refresh: () => void load() }
}
