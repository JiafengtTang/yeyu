import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ListResult, MemoDTO } from '@yeyu/shared'
import { api, apiErrorMessage, formatDateTime } from '../api/client'
import { Button, Card, EmptyState, Field, Input, Modal, Spinner, useToast } from '../ui'
import { Icon } from '../ui/icons'
import { MEMO_CHANGED_EVENT } from '../memos/useMemoWatcher'

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  )
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function dueLabel(memo: MemoDTO): string {
  if (!memo.dueAt) return '没有截止时间'
  return formatDateTime(memo.dueAt)
}

function bucketOf(memo: MemoDTO): 'overdue' | 'today' | 'week' | 'later' | 'none' {
  if (!memo.dueAt) return 'none'
  const due = new Date(memo.dueAt).getTime()
  const start = startOfToday()
  if (due < Date.now()) return 'overdue'
  if (due < start + 86400_000) return 'today'
  if (due < start + 7 * 86400_000) return 'week'
  return 'later'
}

const BUCKETS: Array<{ key: ReturnType<typeof bucketOf>; label: string }> = [
  { key: 'overdue', label: '已逾期' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '未来 7 天' },
  { key: 'later', label: '以后' },
  { key: 'none', label: '未设截止时间' }
]

export default function MemosPage() {
  const toast = useToast()
  const [items, setItems] = useState<MemoDTO[]>([])
  const [doneItems, setDoneItems] = useState<MemoDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<MemoDTO | null>(null)
  const [form, setForm] = useState({ title: '', note: '', dueAt: '' })
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const broadcast = (): void => {
    window.dispatchEvent(new Event(MEMO_CHANGED_EVENT))
  }

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [open, done] = await Promise.all([
        api<ListResult<MemoDTO>>('/api/memos', { query: { status: 'open', q: keyword || undefined } }),
        api<ListResult<MemoDTO>>('/api/memos', { query: { status: 'done', pageSize: 50 } })
      ])
      setItems(open.items)
      setDoneItems(done.items)
      broadcast()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [keyword, toast])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<ReturnType<typeof bucketOf>, MemoDTO[]>()
    for (const memo of items) {
      const key = bucketOf(memo)
      const list = map.get(key) ?? []
      list.push(memo)
      map.set(key, list)
    }
    return map
  }, [items])

  async function add(): Promise<void> {
    const text = title.trim()
    if (!text) return
    setAdding(true)
    try {
      await api<MemoDTO>('/api/memos', { method: 'POST', body: { title: text, dueAt: fromLocalInput(dueAt) } })
      setTitle('')
      setDueAt('')
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setAdding(false)
    }
  }

  async function toggle(memo: MemoDTO): Promise<void> {
    setBusyId(memo.id)
    try {
      await api<MemoDTO>('/api/memos/' + memo.id, { method: 'PATCH', body: { done: !memo.done } })
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(memo: MemoDTO): Promise<void> {
    if (!window.confirm('删除「' + memo.title + '」？')) return
    setBusyId(memo.id)
    try {
      await api<{ ok: boolean }>('/api/memos/' + memo.id, { method: 'DELETE' })
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  function openEdit(memo: MemoDTO): void {
    setEditing(memo)
    setForm({ title: memo.title, note: memo.note ?? '', dueAt: toLocalInput(memo.dueAt) })
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return
    const text = form.title.trim()
    if (!text) {
      toast.push('内容不能为空', 'error')
      return
    }
    setSaving(true)
    try {
      await api<MemoDTO>('/api/memos/' + editing.id, {
        method: 'PATCH',
        body: { title: text, note: form.note.trim() || null, dueAt: fromLocalInput(form.dueAt) }
      })
      toast.push('已保存', 'success')
      setEditing(null)
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>备忘录</h2>
          <p className="muted">待办清单：勾掉即完成，可设截止时间，到期会在应用内提醒你。仅自己可见。</p>
        </div>
      </div>

      <Card title="添加一条">
        <div className="memo-add">
          <Input
            className="grow"
            placeholder="要做什么？例如：问西空设备进度 / 交周报前补数据"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add()
            }}
          />
          <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} aria-label="截止时间" />
          <Button variant="primary" loading={adding} onClick={() => void add()}>
            <Icon name="plus" size={14} /> 添加
          </Button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          截止时间可以留空；留空就不会提醒。
        </p>
      </Card>

      <Card
        title="待办"
        extra={
          <div className="toolbar" style={{ margin: 0 }}>
            <Input
              style={{ width: 180 }}
              placeholder="搜索"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Button className="btn-sm" variant="ghost" onClick={() => setShowDone((prev) => !prev)}>
              {showDone ? '隐藏已完成' : '显示已完成（' + doneItems.length + '）'}
            </Button>
          </div>
        }
      >
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="没有待办" description="在上面输入一条，回车即可添加。" />
        ) : (
          <div className="memo-groups">
            {BUCKETS.map((bucket) => {
              const list = grouped.get(bucket.key) ?? []
              if (list.length === 0) return null
              return (
                <div key={bucket.key} className="memo-group">
                  <div className={'memo-group-title' + (bucket.key === 'overdue' ? ' danger' : '')}>
                    {bucket.label}
                    <span className="memo-group-count">{list.length}</span>
                  </div>
                  {list.map((memo) => (
                    <div key={memo.id} className={'memo-row' + (memo.overdue ? ' overdue' : '')}>
                      <button
                        className={'memo-check' + (memo.done ? ' checked' : '')}
                        disabled={busyId === memo.id}
                        onClick={() => void toggle(memo)}
                        title={memo.done ? '标记为未完成' : '标记为完成'}
                      >
                        {memo.done ? <Icon name="check" size={12} /> : null}
                      </button>
                      <div className="memo-body">
                        <span className="memo-title">{memo.title}</span>
                        {memo.note ? <span className="memo-note">{memo.note}</span> : null}
                        <span className={'memo-due' + (memo.overdue ? ' danger' : '')}>
                          {memo.overdue ? '已逾期 · ' : ''}
                          {dueLabel(memo)}
                        </span>
                      </div>
                      <div className="memo-actions">
                        <button className="icon-action" onClick={() => openEdit(memo)} title="编辑">
                          <Icon name="edit" size={15} />
                        </button>
                        <button className="icon-action" onClick={() => void remove(memo)} title="删除">
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {showDone && doneItems.length > 0 ? (
          <div className="memo-done-block">
            <div className="memo-group-title">已完成（{doneItems.length}）</div>
            {doneItems.map((memo) => (
              <div key={memo.id} className="memo-row done">
                <button className="memo-check checked" onClick={() => void toggle(memo)} title="恢复为未完成">
                  <Icon name="check" size={12} />
                </button>
                <div className="memo-body">
                  <span className="memo-title">{memo.title}</span>
                  {memo.doneAt ? <span className="memo-due">完成于 {formatDateTime(memo.doneAt)}</span> : null}
                </div>
                <div className="memo-actions">
                  <button className="icon-action" onClick={() => void remove(memo)} title="删除">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Modal
        open={editing !== null}
        title="编辑备忘"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button variant="primary" loading={saving} onClick={() => void saveEdit()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="内容" required>
          <Input value={form.title} maxLength={200} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
        </Field>
        <Field label="备注">
          <Input
            value={form.note}
            maxLength={2000}
            placeholder="可选，例如：记得问价格"
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          />
        </Field>
        <Field label="截止时间" hint="留空则不提醒">
          <Input type="datetime-local" value={form.dueAt} onChange={(event) => setForm((prev) => ({ ...prev, dueAt: event.target.value }))} />
        </Field>
      </Modal>
    </>
  )
}
