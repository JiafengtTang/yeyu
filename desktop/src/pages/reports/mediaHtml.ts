import { getBaseUrl, resolveMediaHtml } from '../../api/client'

/** 存储态（media:<id>）→ 展示态（带 token 的绝对地址） */
export function toDisplayHtml(html: string): string {
  return resolveMediaHtml(html)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 展示态（绝对地址 + token）→ 存储态（media:<id>），保证正文只落 media: 占位 */
export function toStorageHtml(html: string): string {
  const absolute = new RegExp(escapeRegExp(getBaseUrl()) + '/api/media/([A-Za-z0-9_-]+)(?:\\?token=[^"\'\\s>]*)?', 'g')
  return html.replace(absolute, (_match, id: string) => 'media:' + id)
}

export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isBlankHtml(html: string): boolean {
  return !/<img\b/i.test(html) && htmlToText(html).length === 0
}
