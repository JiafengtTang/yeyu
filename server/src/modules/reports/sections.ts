import type { ReportSectionDTO, TemplateSectionDTO } from '@lab/shared'
import { prisma } from '../../lib/prisma.js'
import { parseTemplateSections } from '../templates/dto.js'

export interface SectionInput {
  key: string
  title: string
  contentHtml: string
}

export interface ActiveTemplate {
  id: string
  name: string
  sections: TemplateSectionDTO[]
}

/** Report.sectionsJson 解析容错；空数组表示旧版自由正文周报 */
export function parseReportSections(raw: string | null | undefined): ReportSectionDTO[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const sections: ReportSectionDTO[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const key = typeof row.key === 'string' ? row.key : ''
      const title = typeof row.title === 'string' ? row.title : ''
      if (key.length === 0 || title.length === 0) continue
      sections.push({
        key,
        title,
        hint: typeof row.hint === 'string' ? row.hint : '',
        contentHtml: typeof row.contentHtml === 'string' ? row.contentHtml : ''
      })
    }
    return sections
  } catch {
    return []
  }
}

/** Report.templateSnapshotJson = { name, sections:[{key,title,hint}] } */
export function parseTemplateSnapshot(
  raw: string | null | undefined
): { name: string; sections: TemplateSectionDTO[] } | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const row = parsed as Record<string, unknown>
    const rawSections = Array.isArray(row.sections)
      ? JSON.stringify(row.sections)
      : typeof row.sectionsJson === 'string'
        ? row.sectionsJson
        : '[]'
    return {
      name: typeof row.name === 'string' ? row.name : '',
      sections: parseTemplateSections(rawSections)
    }
  } catch {
    return null
  }
}

export function snapshotJson(template: ActiveTemplate): string {
  return JSON.stringify({
    name: template.name,
    sections: template.sections.map((section) => ({ key: section.key, title: section.title, hint: section.hint }))
  })
}

export async function loadActiveTemplate(): Promise<ActiveTemplate | null> {
  const row = await prisma.reportTemplate.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
  if (!row) return null
  return { id: row.id, name: row.name, sections: parseTemplateSections(row.sectionsJson) }
}

/** 新建/首次保存时用生效模版小节初始化（contentHtml 空串） */
export function initializeSections(template: ActiveTemplate | null): ReportSectionDTO[] {
  if (!template) return []
  return template.sections.map((section) => ({
    key: section.key,
    title: section.title,
    hint: section.hint,
    contentHtml: ''
  }))
}

/** 保存小节时补齐 hint：优先当前生效模版，其次已存小节（hint 不在 reportSectionInputSchema 里） */
export function mergeSectionInputs(
  incoming: SectionInput[],
  current: ReportSectionDTO[],
  template: ActiveTemplate | null
): ReportSectionDTO[] {
  const hints = new Map<string, string>()
  for (const section of current) hints.set(section.key, section.hint)
  for (const section of template?.sections ?? []) hints.set(section.key, section.hint)
  return incoming.map((section) => ({
    key: section.key,
    title: section.title,
    hint: hints.get(section.key) ?? '',
    contentHtml: section.contentHtml
  }))
}
