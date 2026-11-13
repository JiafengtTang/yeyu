import type { ReportSectionDTO } from '@yeyu/shared'
import { RichEditor } from './RichEditor'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 预览 / 导出用：把各小节拼成一段 HTML（展示态） */
export function composeSectionsHtml(sections: ReportSectionDTO[]): string {
  return sections
    .map((section) => '<h2>' + escapeHtml(section.title) + '</h2>' + (section.contentHtml || '<p></p>'))
    .join('')
}

interface SectionedEditorProps {
  sections: ReportSectionDTO[]
  editable: boolean
  errors: Record<string, string>
  onChange(key: string, html: string): void
}

/** 按模版小节逐节渲染富文本：每节一个独立 RichEditor 实例，hint 显示在标题下方，校验错误显示在编辑器下方 */
export function SectionedEditor({ sections, editable, errors, onChange }: SectionedEditorProps) {
  return (
    <div className="form-grid">
      {sections.map((section, index) => (
        <div className="span-2 field" key={section.key}>
          <span className="field-label">
            {index + 1}. {section.title}
          </span>
          {section.hint ? <span className="field-hint">提示：{section.hint}</span> : null}
          <RichEditor
            value={section.contentHtml}
            editable={editable}
            placeholder={'在这里填写「' + (section.title.length > 16 ? section.title.slice(0, 16) + '…' : section.title) + '」…（可直接粘贴或拖拽图片）'}
            onChange={(html) => onChange(section.key, html)}
          />
          {errors[section.key] ? <span className="field-error">{errors[section.key]}</span> : null}
        </div>
      ))}
    </div>
  )
}
