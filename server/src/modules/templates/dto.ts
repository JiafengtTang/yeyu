import type { ReportTemplateDTO, TemplateSectionDTO } from '@yeyu/shared'

export interface TemplateRow {
  id: string
  name: string
  version: number
  sectionsJson: string
  sourceName: string | null
  sourceFormat: string
  isActive: boolean
  createdAt: Date
  _count?: { reports: number }
}

/** sectionsJson 解析容错：损坏的 JSON 视为空小节列表 */
export function parseTemplateSections(raw: string | null | undefined): TemplateSectionDTO[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const sections: TemplateSectionDTO[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const key = typeof row.key === 'string' ? row.key : ''
      const title = typeof row.title === 'string' ? row.title : ''
      if (key.length === 0 || title.length === 0) continue
      sections.push({ key, title, hint: typeof row.hint === 'string' ? row.hint : '' })
    }
    return sections
  } catch {
    return []
  }
}

export function serializeTemplateSections(sections: TemplateSectionDTO[]): string {
  return JSON.stringify(sections.map((section) => ({ key: section.key, title: section.title, hint: section.hint })))
}

export function toTemplateDTO(row: TemplateRow): ReportTemplateDTO {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    sections: parseTemplateSections(row.sectionsJson),
    sourceName: row.sourceName ?? null,
    sourceFormat: row.sourceFormat === 'md' ? 'md' : 'docx',
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    reportCount: row._count?.reports ?? 0
  }
}
