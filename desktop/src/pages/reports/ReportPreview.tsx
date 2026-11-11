import { useMemo } from 'react'
import { isBlankHtml, toDisplayHtml } from './mediaHtml'

export function ReportPreview({ html, placeholder = '（暂无正文）' }: { html: string; placeholder?: string }) {
  const rendered = useMemo(() => toDisplayHtml(html), [html])
  if (isBlankHtml(html)) return <p className="muted">{placeholder}</p>
  return <div className="rich-body" dangerouslySetInnerHTML={{ __html: rendered }} />
}
