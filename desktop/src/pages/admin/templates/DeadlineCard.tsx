import { useEffect, useState } from 'react'
import type { DeadlineDTO } from '@lab/shared'
import { formatDateTime } from '../../../api/client'
import { Badge, Button, Card, Field, Input, Select, Spinner, useToast } from '../../../ui'
import { WEEKDAY_LABELS, deadlineSourceLabel, fromDateTimeLocalValue, toDateTimeLocalValue } from '../../reports/deadline'
import type { DeadlineOverrideItem } from './shared'

interface DeadlineCardProps {
  rule: { weekday: number; time: string }
  currentWeek: string
  deadline: DeadlineDTO | null
  overrides: DeadlineOverrideItem[]
  loading: boolean
  onSaveRule(weekday: number, time: string): Promise<void>
  onSaveOverride(week: string, isoDeadline: string, reason: string): Promise<void>
  onDeleteOverride(week: string): Promise<void>
}

export function DeadlineCard({
  rule,
  currentWeek,
  deadline,
  overrides,
  loading,
  onSaveRule,
  onSaveOverride,
  onDeleteOverride
}: DeadlineCardProps) {
  const toast = useToast()
  const [weekday, setWeekday] = useState(rule.weekday)
  const [time, setTime] = useState(rule.time)
  const [savingRule, setSavingRule] = useState(false)
  const [overrideWeek, setOverrideWeek] = useState(currentWeek)
  const [overrideAt, setOverrideAt] = useState(() => toDateTimeLocalValue(deadline?.deadline ?? new Date()))
  const [overrideReason, setOverrideReason] = useState('')
  const [savingOverride, setSavingOverride] = useState(false)
  const [deletingWeek, setDeletingWeek] = useState('')

  useEffect(() => {
    setWeekday(rule.weekday)
    setTime(rule.time)
  }, [rule.weekday, rule.time])

  const saveRule = async () => {
    setSavingRule(true)
    try {
      await onSaveRule(weekday, time)
    } finally {
      setSavingRule(false)
    }
  }

  const saveOverride = async () => {
    const week = overrideWeek.trim()
    if (!/^[0-9]{4}-W[0-9]{2}$/.test(week)) {
      toast.push('周次格式应为 2025-W46', 'error')
      return
    }
    const iso = fromDateTimeLocalValue(overrideAt)
    if (!iso) {
      toast.push('请选择有效的截止时间', 'error')
      return
    }
    setSavingOverride(true)
    try {
      await onSaveOverride(week, iso, overrideReason.trim())
      setOverrideReason('')
    } finally {
      setSavingOverride(false)
    }
  }

  const removeOverride = async (week: string) => {
    setDeletingWeek(week)
    try {
      await onDeleteOverride(week)
    } finally {
      setDeletingWeek('')
    }
  }

  return (
    <Card title="提交截止时间" extra={<span className="muted">本周 {currentWeek}</span>}>
      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="form-grid">
            <Field label="全局规则：截止日" hint="1 = 周一 … 7 = 周日，默认周日">
              <Select value={String(weekday)} onChange={(event) => setWeekday(Number(event.target.value))}>
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={String(index + 1)}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="截止时间" hint="按本地时区 HH:mm">
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </Field>
            <div className="span-2">
              <div className="toolbar">
                <Button variant="primary" loading={savingRule} onClick={() => void saveRule()}>
                  保存截止规则
                </Button>
                {deadline ? (
                  <span className="muted">
                    本周截止 {formatDateTime(deadline.deadline)}（
                    {deadline.source === 'OVERRIDE' ? (
                      <Badge tone="warning">{deadlineSourceLabel(deadline)}</Badge>
                    ) : (
                      deadlineSourceLabel(deadline)
                    )}
                    ）
                  </span>
                ) : (
                  <span className="muted">尚未读取到本周截止时间</span>
                )}
              </div>
            </div>
          </div>

          <h4>单周覆盖</h4>
          <div className="form-grid">
            <Field label="周次" hint="格式 2025-W46，默认本周">
              <Input value={overrideWeek} placeholder="2025-W46" onChange={(event) => setOverrideWeek(event.target.value)} />
            </Field>
            <Field label="截止时间">
              <Input type="datetime-local" value={overrideAt} onChange={(event) => setOverrideAt(event.target.value)} />
            </Field>
            <Field label="原因" hint="会显示在工作台与周报编辑器">
              <Input value={overrideReason} maxLength={200} placeholder="例如：周五组会提前" onChange={(event) => setOverrideReason(event.target.value)} />
            </Field>
            <div className="span-2">
              <div className="toolbar">
                <Button loading={savingOverride} onClick={() => void saveOverride()}>
                  保存单周覆盖
                </Button>
              </div>
            </div>
          </div>

          {overrides.length === 0 ? (
            <p className="muted">暂无单周覆盖，所有周次都按全局规则计算截止时间。</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>周次</th>
                    <th>截止时间</th>
                    <th>原因</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((item) => (
                    <tr key={item.week}>
                      <td>{item.week}</td>
                      <td>{formatDateTime(item.deadline)}</td>
                      <td>{item.reason || <span className="muted">未填写</span>}</td>
                      <td>
                        <div className="table-actions">
                          <Button className="btn-sm" variant="danger" loading={deletingWeek === item.week} onClick={() => void removeOverride(item.week)}>
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
