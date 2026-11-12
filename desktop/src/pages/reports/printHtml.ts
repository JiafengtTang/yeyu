import { resolveMediaHtml } from '../../api/client'
import { REPORT_STATUS_LABEL } from '@yeyu/shared'
import type { ReportDTO } from '@yeyu/shared'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  )
}

/** 打印/导出 PDF 用的自包含 HTML：正文里的 media: 一律换成带 token 的绝对地址 */
export function buildPrintHtml(report: ReportDTO, contentHtml: string): string {
  const title = report.title.trim() || '周报 ' + report.week
  const body = resolveMediaHtml(contentHtml)
  const meta = [
    '作者：' + escapeHtml(report.authorName || '-'),
    '周次：' + escapeHtml(report.week) + '（' + formatDateTime(report.periodStart).slice(0, 10) + ' ~ ' + formatDateTime(report.periodEnd).slice(0, 10) + '）',
    '状态：' + escapeHtml(REPORT_STATUS_LABEL[report.status] ?? report.status),
    '提交时间：' + formatDateTime(report.submittedAt)
  ]
  const comments = report.comments
    .map(
      (comment) =>
        '<div class="comment"><strong>' + escapeHtml(comment.authorName || '-') + '</strong> · ' + formatDateTime(comment.createdAt) + '<br>' + escapeHtml(comment.body) + '</div>'
    )
    .join('')

  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>' + escapeHtml(title) + '</title>',
    '<style>',
    'body{font:14px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2430;margin:32px 40px;}',
    'h1{font-size:20px;margin:0 0 8px;}h2{font-size:16px;margin:22px 0 8px;}h3{font-size:15px;margin:18px 0 6px;}',
    '.meta{color:#5b6472;font-size:12px;line-height:1.9;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid #e3e6ec;}',
    'img{max-width:100%;border-radius:8px;margin:6px 0;}',
    'blockquote{border-left:3px solid #e3e6ec;margin:8px 0;padding-left:12px;color:#5b6472;}',
    '.comment{border-top:1px solid #e3e6ec;margin-top:14px;padding-top:8px;color:#5b6472;font-size:12px;}',
    '</style></head><body>',
    '<h1>' + escapeHtml(title) + '</h1>',
    '<div class="meta">' + meta.join('<br>') + '</div>',
    body,
    comments,
    '</body></html>'
  ].join('\n')
}
