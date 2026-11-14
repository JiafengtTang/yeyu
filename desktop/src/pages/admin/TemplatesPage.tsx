import { useCallback, useEffect, useState } from 'react'
import type { DeadlineDTO, ListResult, ReportTemplateDTO } from '@yeyu/shared'
import { DEFAULT_REPORT_FREQUENCY, isoWeekKey } from '@yeyu/shared'
import type { ReportFrequency } from '@yeyu/shared'
import { api, apiErrorMessage } from '../../api/client'
import { useToast } from '../../ui'
import { DeadlineCard } from './templates/DeadlineCard'
import { TemplateListCard } from './templates/TemplateListCard'
import { TemplateUploadCard } from './templates/TemplateUploadCard'
import type { DeadlineOverrideItem } from './templates/shared'

export default function TemplatesPage() {
  const toast = useToast()
  const [currentWeek] = useState(() => isoWeekKey(new Date()))
  const [templates, setTemplates] = useState<ReportTemplateDTO[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [rule, setRule] = useState<{ weekday: number; time: string; frequency: ReportFrequency }>({
    weekday: 7,
    time: '18:00',
    frequency: DEFAULT_REPORT_FREQUENCY
  })
  const [deadline, setDeadline] = useState<DeadlineDTO | null>(null)
  const [overrides, setOverrides] = useState<DeadlineOverrideItem[]>([])
  const [loadingDeadline, setLoadingDeadline] = useState(true)

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true)
    try {
      const result = await api<ListResult<ReportTemplateDTO>>('/api/templates')
      setTemplates(result.items)
    } catch (err) {
      toast.push('加载模版列表失败：' + apiErrorMessage(err), 'error')
    } finally {
      setLoadingTemplates(false)
    }
  }, [toast])

  const loadDeadline = useCallback(async () => {
    setLoadingDeadline(true)
    try {
      const [current, list] = await Promise.all([
        api<DeadlineDTO>('/api/settings/report-deadline', { query: { week: currentWeek } }),
        api<ListResult<DeadlineOverrideItem>>('/api/settings/report-deadline/overrides')
      ])
      setDeadline(current)
      setRule({ weekday: current.weekday, time: current.time, frequency: current.frequency })
      setOverrides(list.items)
    } catch (err) {
      toast.push('加载截止时间失败：' + apiErrorMessage(err), 'error')
    } finally {
      setLoadingDeadline(false)
    }
  }, [currentWeek, toast])

  useEffect(() => {
    void loadTemplates()
    void loadDeadline()
  }, [loadTemplates, loadDeadline])

  const activateTemplate = async (template: ReportTemplateDTO) => {
    try {
      await api<ReportTemplateDTO>('/api/templates/' + template.id + '/activate', { method: 'PATCH' })
      toast.push('已设为生效模版：' + template.name, 'success')
      await loadTemplates()
    } catch (err) {
      toast.push('设为生效失败：' + apiErrorMessage(err), 'error')
    }
  }

  const deleteTemplate = async (template: ReportTemplateDTO) => {
    try {
      await api<{ ok: boolean }>('/api/templates/' + template.id, { method: 'DELETE' })
      toast.push('模版已删除：' + template.name, 'success')
      await loadTemplates()
    } catch (err) {
      toast.push('删除失败：' + apiErrorMessage(err), 'error')
    }
  }

  const saveRule = async (weekday: number, time: string, frequency: ReportFrequency) => {
    try {
      await api<{ weekday: number; time: string; frequency: string }>('/api/settings/report-deadline', {
        method: 'PATCH',
        body: { weekday, time, frequency }
      })
      toast.push('截止规则已保存：' + time, 'success')
      await loadDeadline()
    } catch (err) {
      toast.push('保存截止规则失败：' + apiErrorMessage(err), 'error')
    }
  }

  const saveOverride = async (week: string, isoDeadline: string, reason: string) => {
    try {
      await api<DeadlineDTO>('/api/settings/report-deadline/overrides/' + week, {
        method: 'PUT',
        body: { deadline: isoDeadline, reason: reason || undefined }
      })
      toast.push('单周覆盖已保存：' + week, 'success')
      await loadDeadline()
    } catch (err) {
      toast.push('保存单周覆盖失败：' + apiErrorMessage(err), 'error')
    }
  }

  const deleteOverride = async (week: string) => {
    try {
      await api<{ ok: boolean }>('/api/settings/report-deadline/overrides/' + week, { method: 'DELETE' })
      toast.push('已取消单周覆盖：' + week, 'success')
      await loadDeadline()
    } catch (err) {
      toast.push('取消单周覆盖失败：' + apiErrorMessage(err), 'error')
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>模版与截止</h2>
          <p className="muted">上传周报模版（按小节填写），并设置全组周报的提交截止时间</p>
        </div>
      </div>

      <TemplateUploadCard onCreated={() => void loadTemplates()} />

      <TemplateListCard
        templates={templates}
        loading={loadingTemplates}
        onActivate={activateTemplate}
        onDelete={deleteTemplate}
      />

      <DeadlineCard
        rule={rule}
        currentWeek={currentWeek}
        deadline={deadline}
        overrides={overrides}
        loading={loadingDeadline}
        onSaveRule={saveRule}
        onSaveOverride={saveOverride}
        onDeleteOverride={deleteOverride}
      />
    </>
  )
}
