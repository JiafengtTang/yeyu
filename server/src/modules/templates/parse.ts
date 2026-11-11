import JSZip from 'jszip'
import { AppError } from '../../lib/errors.js'

export interface ParsedSection {
  key: string
  title: string
  hint: string
}

export type TemplateFormat = 'docx' | 'md'

export const MAX_SECTIONS = 30
export const MAX_TITLE_LENGTH = 120
export const MAX_HINT_LENGTH = 200

export const NO_SECTION_MESSAGE =
  '未在文件中识别到小节标题，请使用 Word 的标题 1/2/3 样式或 Markdown 的 ## 标题'

const HEADING_STYLE_RE = /^(Heading|标题)\s*[1-3]$/
const MARKDOWN_HEADING_RE = /^#{1,3}\s+(.+)$/
const MARKDOWN_LIST_PREFIX_RE = /^(?:[-*+]\s+|\d+[.)]\s+)/
const MARKDOWN_NOISE_RE = /^(?:```|---|===|\|)/

const PARAGRAPH_RE = /<(?:\w+:)?p(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?p>/g
const PARAGRAPH_STYLE_RE = /<(?:\w+:)?pStyle\b[^>]*>/
const PARAGRAPH_OUTLINE_RE = /<(?:\w+:)?outlineLvl\b[^>]*>/
const VAL_RE = /\b(?:\w+:)?val\s*=\s*"([^"]*)"/i
const TEXT_RE = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}
const ENTITY_RE = /&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g

/** 解 XML 实体：命名实体 + 十进制 / 十六进制字符引用 */
export function decodeXmlEntities(text: string): string {
  return text.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

function collapse(text: string): string {
  return text.replace(/[\t\r\n ]+/g, ' ').trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

function paragraphText(xml: string): string {
  let text = ''
  TEXT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TEXT_RE.exec(xml)) !== null) text += decodeXmlEntities(match[1] ?? '')
  return collapse(text)
}

function isHeadingParagraph(xml: string): boolean {
  const styleTag = PARAGRAPH_STYLE_RE.exec(xml)
  if (styleTag) {
    const styleVal = VAL_RE.exec(styleTag[0])?.[1]?.trim() ?? ''
    if (HEADING_STYLE_RE.test(styleVal)) return true
  }
  const outlineTag = PARAGRAPH_OUTLINE_RE.exec(xml)
  if (outlineTag) {
    const outlineVal = VAL_RE.exec(outlineTag[0])?.[1]?.trim() ?? ''
    if (/^[0-9]+$/.test(outlineVal) && Number(outlineVal) <= 2) return true
  }
  return false
}

interface DraftSection {
  title: string
  hintParts: string[]
}

function finishDraft(draft: DraftSection): { title: string; hint: string } {
  return { title: draft.title, hint: clip(draft.hintParts.join(' '), MAX_HINT_LENGTH) }
}

function pushDraft(drafts: Array<{ title: string; hint: string }>, draft: DraftSection | null): void {
  if (draft) drafts.push(finishDraft(draft))
}

/** docx：按 w:pStyle Heading/标题 1-3 或 w:outlineLvl<=2 识别小节，小节间正文拼成 hint */
export function parseDocxDocumentXml(xml: string): Array<{ title: string; hint: string }> {
  const drafts: Array<{ title: string; hint: string }> = []
  let current: DraftSection | null = null

  PARAGRAPH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PARAGRAPH_RE.exec(xml)) !== null) {
    const body = match[1] ?? ''
    const text = paragraphText(body)
    if (isHeadingParagraph(body)) {
      if (text.length === 0) continue
      pushDraft(drafts, current)
      current = { title: text, hintParts: [] }
      continue
    }
    if (text.length > 0 && current) current.hintParts.push(text)
  }
  pushDraft(drafts, current)
  return drafts
}

/** markdown：^#{1,3}\s+ 为小节，标题之间的正文行为 hint */
export function parseMarkdownText(source: string): Array<{ title: string; hint: string }> {
  const drafts: Array<{ title: string; hint: string }> = []
  let current: DraftSection | null = null

  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    const heading = MARKDOWN_HEADING_RE.exec(line)
    if (heading) {
      pushDraft(drafts, current)
      current = { title: collapse(heading[1] ?? ''), hintParts: [] }
      continue
    }
    if (!current || line.length === 0) continue
    if (MARKDOWN_NOISE_RE.test(line)) continue
    current.hintParts.push(collapse(line.replace(MARKDOWN_LIST_PREFIX_RE, '')))
  }
  pushDraft(drafts, current)
  return drafts
}

/** 统一校验并生成 key=s1..sn */
export function finalizeSections(drafts: Array<{ title: string; hint: string }>): ParsedSection[] {
  const usable = drafts.filter((draft) => draft.title.length > 0)
  if (usable.length === 0) throw AppError.validation(NO_SECTION_MESSAGE)
  if (usable.length > MAX_SECTIONS) {
    throw AppError.validation(
      '识别到 ' + String(usable.length) + ' 个小节，最多支持 ' + String(MAX_SECTIONS) + ' 个，请合并后再上传'
    )
  }
  const tooLong = usable.find((draft) => draft.title.length > MAX_TITLE_LENGTH)
  if (tooLong) {
    throw AppError.validation(
      '小节标题超过 ' + String(MAX_TITLE_LENGTH) + ' 字，请精简：「' + clip(tooLong.title, 20) + '…」'
    )
  }
  return usable.map((draft, index) => ({
    key: 's' + String(index + 1),
    title: draft.title,
    hint: clip(draft.hint, MAX_HINT_LENGTH)
  }))
}

export async function parseTemplateBuffer(format: TemplateFormat, buffer: Buffer): Promise<ParsedSection[]> {
  if (format === 'md') return finalizeSections(parseMarkdownText(buffer.toString('utf8')))

  let xml: string
  try {
    const zip = await JSZip.loadAsync(buffer)
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('missing word/document.xml')
    xml = await entry.async('string')
  } catch {
    throw AppError.validation('DOCX 文件解析失败：缺少 word/document.xml，请确认上传的是有效的 .docx 文件')
  }
  return finalizeSections(parseDocxDocumentXml(xml))
}
