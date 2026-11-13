import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ListResult,
  NoteCalendarDayDTO,
  NoteDTO,
  NoteGraphDTO,
  NoteKind,
  NoteSummaryDTO
} from '@yeyu/shared'
import { api, apiDownload, apiErrorMessage, formatDate } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, Spinner, useToast } from '../ui'
import { Icon } from '../ui/icons'
import { RichEditor } from './reports/RichEditor'

type Tab = 'notes' | 'calendar' | 'graph'

function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export default function NotesPage() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('notes')
  const [kind, setKind] = useState<'' | NoteKind>('')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [tag, setTag] = useState('')
  const [items, setItems] = useState<NoteSummaryDTO[]>([])
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([])
  const [loading, setLoading] = useState(true)

  const [active, setActive] = useState<NoteDTO | null>(null)
  const [title, setTitle] = useState('')
  const [html, setHtml] = useState('')
  const [saving, setSaving] = useState(false)

  const [month, setMonth] = useState(dayKey(new Date()).slice(0, 7))
  const [calendar, setCalendar] = useState<NoteCalendarDayDTO[]>([])
  const [graph, setGraph] = useState<NoteGraphDTO>({ nodes: [], edges: [] })

  const saveTimer = useRef<number | null>(null)
  const pendingRef = useRef<{ title: string; html: string } | null>(null)

  const loadList = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, tagList] = await Promise.all([
        api<ListResult<NoteSummaryDTO>>('/api/notes', {
          query: { kind: kind || undefined, q: keyword || undefined, tag: tag || undefined, pageSize: 50 }
        }),
        api<{ items: Array<{ tag: string; count: number }> }>('/api/notes/tags')
      ])
      setItems(list.items)
      setTags(tagList.items)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [kind, keyword, tag, toast])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const openNote = useCallback(
    async (id: string): Promise<void> => {
      try {
        const detail = await api<NoteDTO>('/api/notes/' + id)
        setActive(detail)
        setTitle(detail.title)
        setHtml(detail.contentHtml)
        setTab('notes')
      } catch (err) {
        toast.push(apiErrorMessage(err), 'error')
      }
    },
    [toast]
  )

  const openDaily = useCallback(
    async (day?: string): Promise<void> => {
      try {
        const detail = await api<NoteDTO>('/api/notes/daily', { query: day ? { day } : undefined })
        await openNote(detail.id)
        await loadList()
      } catch (err) {
        toast.push(apiErrorMessage(err), 'error')
      }
    },
    [loadList, openNote, toast]
  )

  const saveNow = useCallback(
    async (id: string, next: { title: string; html: string }): Promise<void> => {
      setSaving(true)
      try {
        const detail = await api<NoteDTO>('/api/notes/' + id, {
          method: 'PATCH',
          body: { title: next.title.trim() || '未命名笔记', contentHtml: next.html }
        })
        setActive((prev) => (prev && prev.id === detail.id ? { ...prev, links: detail.links, backlinks: detail.backlinks, tags: detail.tags, updatedAt: detail.updatedAt } : prev))
      } catch (err) {
        toast.push(apiErrorMessage(err), 'error')
      } finally {
        setSaving(false)
      }
    },
    [toast]
  )

  const scheduleSave = useCallback(
    (next: { title: string; html: string }): void => {
      if (!active) return
      pendingRef.current = next
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        const payload = pendingRef.current
        if (!payload) return
        pendingRef.current = null
        void saveNow(active.id, payload).then(() => loadList())
      }, 1500)
    },
    [active, loadList, saveNow]
  )

  async function createNote(): Promise<void> {
    const now = new Date()
    const stamp = dayKey(now) + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    try {
      const detail = await api<NoteDTO>('/api/notes', { method: 'POST', body: { kind: 'NOTE', title: '未命名笔记 ' + stamp } })
      await loadList()
      setActive(detail)
      setTitle(detail.title)
      setHtml(detail.contentHtml)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }

  async function removeActive(): Promise<void> {
    if (!active) return
    if (!window.confirm('删除笔记「' + active.title + '」？删除后无法恢复。')) return
    try {
      await api<{ ok: boolean }>('/api/notes/' + active.id, { method: 'DELETE' })
      toast.push('笔记已删除', 'success')
      setActive(null)
      setTitle('')
      setHtml('')
      await loadList()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }

  async function exportMarkdown(): Promise<void> {
    if (!active) return
    try {
      await apiDownload('/api/notes/' + active.id + '/markdown', (title.trim() || 'note') + '.md')
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }

  const loadCalendar = useCallback(async (): Promise<void> => {
    try {
      const result = await api<{ items: NoteCalendarDayDTO[] }>('/api/notes/calendar', { query: { month } })
      setCalendar(result.items)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }, [month, toast])

  const loadGraph = useCallback(async (): Promise<void> => {
    try {
      setGraph(await api<NoteGraphDTO>('/api/notes/graph'))
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    }
  }, [toast])

  useEffect(() => {
    if (tab === 'calendar') void loadCalendar()
    if (tab === 'graph') void loadGraph()
  }, [tab, loadCalendar, loadGraph])

  const calendarCells = useMemo(() => {
    const [yearText, monthText] = month.split('-')
    const year = Number(yearText)
    const monthIndex = Number(monthText) - 1
    const first = new Date(year, monthIndex, 1)
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
    const leading = (first.getDay() + 6) % 7 // 周一为首列
    const filled = new Map(calendar.map((entry) => [entry.day, entry.hasContent]))
    const cells: Array<{ day: string | null; hasContent: boolean }> = []
    for (let i = 0; i < leading; i++) cells.push({ day: null, hasContent: false })
    for (let d = 1; d <= daysInMonth; d++) {
      const key = month + '-' + String(d).padStart(2, '0')
      cells.push({ day: key, hasContent: filled.get(key) === true })
    }
    return cells
  }, [calendar, month])

  const graphLayout = useMemo(() => {
    const nodes = graph.nodes.slice(0, 48)
    const radius = 130
    const center = { x: 190, y: 165 }
    const positions = new Map<string, { x: number; y: number }>()
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length) - Math.PI / 2
      positions.set(node.id, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) })
    })
    const edges = graph.edges
      .filter((edge) => positions.has(edge.source) && positions.has(edge.target))
      .map((edge) => ({ from: positions.get(edge.source)!, to: positions.get(edge.target)! }))
    return { nodes, positions, edges }
  }, [graph])

  return (
    <>
      <div className="page-head">
        <div>
          <h2>笔记与日报</h2>
          <p className="muted">每天一条日报，另有自由笔记；支持 [[双向链接]]、#标签、搜索、日历与图谱。仅自己可见。</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => void openDaily()}>
            <Icon name="file" size={14} /> 今天的日报
          </Button>
          <Button variant="primary" onClick={() => void createNote()}>
            <Icon name="plus" size={14} /> 新建笔记
          </Button>
        </div>
      </div>

      <div className="notes-tabs">
        <button className={'notes-tab' + (tab === 'notes' ? ' active' : '')} onClick={() => setTab('notes')}>
          笔记
        </button>
        <button className={'notes-tab' + (tab === 'calendar' ? ' active' : '')} onClick={() => setTab('calendar')}>
          日历
        </button>
        <button className={'notes-tab' + (tab === 'graph' ? ' active' : '')} onClick={() => setTab('graph')}>
          图谱
        </button>
      </div>

      {tab === 'notes' ? (
        <div className="notes-layout">
          <Card title="全部笔记" extra={<span className="muted">{items.length} 条</span>}>
            <div className="notes-filters">
              <Input
                value={keywordInput}
                onChange={(event) => setKeywordInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setKeyword(keywordInput.trim())
                }}
                placeholder="搜索标题或正文"
              />
              <Button className="btn-sm" onClick={() => setKeyword(keywordInput.trim())}>
                搜索
              </Button>
            </div>
            <div className="notes-filters">
              <select className="select-sm" value={kind} onChange={(event) => setKind(event.target.value as '' | NoteKind)}>
                <option value="">全部类型</option>
                <option value="DAILY">日报</option>
                <option value="NOTE">笔记</option>
              </select>
              <select className="select-sm" value={tag} onChange={(event) => setTag(event.target.value)}>
                <option value="">全部标签</option>
                {tags.map((item) => (
                  <option key={item.tag} value={item.tag}>
                    #{item.tag}（{item.count}）
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <Spinner />
            ) : items.length === 0 ? (
              <EmptyState title="还没有笔记" description="点右上角「新建笔记」或「今天的日报」开始。" />
            ) : (
              <div className="notes-list">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={'note-item' + (active?.id === item.id ? ' active' : '')}
                    onClick={() => void openNote(item.id)}
                  >
                    <span className="note-item-head">
                      {item.kind === 'DAILY' ? <Badge tone="info">日报</Badge> : <Badge>笔记</Badge>}
                      <span className="note-item-title">{item.title}</span>
                    </span>
                    {item.excerpt ? <span className="note-item-excerpt">{item.excerpt}</span> : null}
                    <span className="note-item-meta">
                      {formatDate(item.updatedAt)}
                      {item.tags.length > 0 ? ' · ' + item.tags.map((t) => '#' + t).join(' ') : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <div className="notes-main">
            {active ? (
              <Card
                title={
                  <span className="card-title-with-icon">
                    <Icon name="file" size={15} />
                    {active.kind === 'DAILY' ? '日报 · ' + (active.day ?? '') : '笔记'}
                  </span>
                }
                extra={
                  <div className="toolbar" style={{ margin: 0 }}>
                    <span className="muted">{saving ? '保存中…' : '已自动保存'}</span>
                    <Button className="btn-sm" onClick={() => void exportMarkdown()}>
                      导出 .md
                    </Button>
                    <Button className="btn-sm" variant="ghost" onClick={() => void removeActive()}>
                      删除
                    </Button>
                  </div>
                }
              >
                <Input
                  className="note-title-input"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value)
                    scheduleSave({ title: event.target.value, html })
                  }}
                  placeholder="笔记标题"
                  disabled={active.kind === 'DAILY'}
                />
                <div style={{ marginTop: 12 }}>
                  <RichEditor
                    key={active.id}
                    value={html}
                    editable
                    placeholder="写点什么…支持 [[双向链接]] 与 #标签"
                    onChange={(next) => {
                      setHtml(next)
                      scheduleSave({ title, html: next })
                    }}
                  />
                </div>
              </Card>
            ) : (
              <Card>
                <EmptyState title="未打开笔记" description="从左侧选一条，或新建一条笔记 / 打开今天的日报。" />
              </Card>
            )}
          </div>

          <Card title="关联">
            {active && active.backlinks.length > 0 ? (
              <>
                <div className="note-side-label">被引用（{active.backlinks.length}）</div>
                <div className="link-list">
                  {active.backlinks.map((link) => (
                    <button key={link.id} className="link-row" onClick={() => void openNote(link.id)}>
                      <Icon name="file" size={14} />
                      <span>{link.title}</span>
                      <Icon name="arrowRight" size={13} className="link-arrow" />
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {active && active.links.length > 0 ? (
              <>
                <div className="note-side-label">链接到（{active.links.length}）</div>
                <div className="link-list">
                  {active.links.map((link) => (
                    <button
                      key={link.title}
                      className="link-row"
                      disabled={!link.noteId}
                      onClick={() => link.noteId && void openNote(link.noteId)}
                    >
                      <Icon name="arrowRight" size={13} />
                      <span>{link.title}</span>
                      {link.noteId ? null : <span className="note-side-missing">未创建</span>}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {active && active.tags.length > 0 ? (
              <>
                <div className="note-side-label">标签</div>
                <div className="tag-list">
                  {active.tags.map((item) => (
                    <button key={item} className="tag-chip" onClick={() => setTag(item)}>
                      #{item}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {!active || (active.links.length === 0 && active.backlinks.length === 0 && active.tags.length === 0) ? (
              <p className="muted">在正文里写 [[另一条笔记的标题]] 建立双向链接，写 #标签 归类。</p>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === 'calendar' ? (
        <Card
          title={'日报日历 · ' + month}
          extra={
            <div className="toolbar" style={{ margin: 0 }}>
              <Button
                className="btn-sm"
                variant="ghost"
                onClick={() => {
                  const [y, m] = month.split('-').map(Number)
                  const prev = new Date(y, m - 2, 1)
                  setMonth(dayKey(prev).slice(0, 7))
                }}
              >
                上月
              </Button>
              <Button
                className="btn-sm"
                variant="ghost"
                onClick={() => {
                  const [y, m] = month.split('-').map(Number)
                  const next = new Date(y, m, 1)
                  setMonth(dayKey(next).slice(0, 7))
                }}
              >
                下月
              </Button>
            </div>
          }
        >
          <div className="calendar-week">
            {WEEK_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {calendarCells.map((cell, index) =>
              cell.day ? (
                <button
                  key={cell.day}
                  className={'calendar-cell' + (cell.hasContent ? ' has-content' : '')}
                  onClick={() => void openDaily(cell.day as string)}
                  title={cell.day}
                >
                  <span>{Number(cell.day.slice(-2))}</span>
                  {cell.hasContent ? <i className="calendar-dot" /> : null}
                </button>
              ) : (
                <span key={'pad-' + index} className="calendar-cell is-pad" />
              )
            )}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            点某一天会打开当天日报（没写过则自动创建）。
          </p>
        </Card>
      ) : null}

      {tab === 'graph' ? (
        <Card title="关系图谱" extra={<span className="muted">{graph.nodes.length} 个节点 · {graph.edges.length} 条链接</span>}>
          {graph.nodes.length === 0 ? (
            <EmptyState title="还没有笔记" description="写过带 [[链接]] 的笔记后，这里会出现关系图。" />
          ) : (
            <svg className="note-graph" viewBox="0 0 380 330">
              {graphLayout.edges.map((edge, index) => (
                <line key={index} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} className="graph-edge" />
              ))}
              {graphLayout.nodes.map((node) => {
                const pos = graphLayout.positions.get(node.id)
                if (!pos) return null
                return (
                  <g key={node.id} onClick={() => void openNote(node.id)} className="graph-node">
                    <circle cx={pos.x} cy={pos.y} r={node.kind === 'DAILY' ? 6 : 7} className={node.kind === 'DAILY' ? 'graph-dot daily' : 'graph-dot'} />
                    <text x={pos.x} y={pos.y - 11} className="graph-label">
                      {node.title.length > 10 ? node.title.slice(0, 10) + '…' : node.title}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </Card>
      ) : null}
    </>
  )
}
