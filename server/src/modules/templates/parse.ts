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
  '未在文件中识别到小节标题：请把栏目名设成 Word 的「标题 1/2/3」样式，或用 Markdown 的 ## 标题'

/** 段落块：level 为标题级别（1 起），null 表示正文 */
export interface ParagraphBlock {
  text: string
  level: number | null
}

const MARKDOWN_HEADING_RE = /^(#{1,3})\s+(.+)$/
const MARKDOWN_LIST_PREFIX_RE = /^(?:[-*+]\s+|\d+[.)]\s+)/
const MARKDOWN_NOISE_RE = /^(?:```|---|===|\|)/

const PARAGRAPH_RE = /<(?:\w+:)?p(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?p>/g
const PARAGRAPH_STYLE_RE = /<(?:\w+:)?pStyle\b[^>]*>/
const PARAGRAPH_OUTLINE_RE = /<(?:\w+:)?outlineLvl\b[^>]*>/
const VAL_RE = /\b(?:\w+:)?val\s*=\s*"([^"]*)"/i
const TEXT_RE = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g
const STYLE_ENTRY_RE = /<(?:\w+:)?style\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?style>/g
const STYLE_ID_RE = /(?:\w+:)?styleId\s*=\s*"([^"]+)"/i
const STYLE_NAME_RE = /<(?:\w+:)?name\b[^>]*?(?:\w+:)?val\s*=\s*"([^"]*)"/i

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

/** 解析 word/styles.xml：styleId → 样式名（如 "1" → "heading 1"） */
export function parseStyleNames(stylesXml: string): Map<string, string> {
  const names = new Map<string, string>()
  STYLE_ENTRY_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STYLE_ENTRY_RE.exec(stylesXml)) !== null) {
    const id = STYLE_ID_RE.exec(match[1] ?? '')?.[1]
    if (!id) continue
    const name = STYLE_NAME_RE.exec(match[2] ?? '')?.[1]
    if (name) names.set(id, name)
  }
  return names
}

/**
 * 样式名 / 样式 id → 标题级别（1 起），非标题返回 null。
 * 中文版 Word 会把「标题 1/2/3」的 styleId 直接记成 "1"/"2"/"3"，所以既看 styles.xml 里的名字，也做数字兜底。
 */
export function headingLevelOfStyle(styleVal: string, styleNames?: Map<string, string>): number | null {
  const id = styleVal.trim()
  if (id.length === 0) return null
  const candidates = [styleNames?.get(id) ?? '', id].map((value) => value.trim()).filter(Boolean)
  for (const candidate of candidates) {
    const match = /^(?:heading|标题)\s*([1-9])$/i.exec(candidate)
    if (match) return Number(match[1])
  }
  if (!styleNames || styleNames.size === 0) {
    if (/^[1-3]$/.test(id)) return Number(id)
  }
  return null
}

function paragraphHeadingLevel(xml: string, styleNames?: Map<string, string>): number | null {
  let level: number | null = null
  const styleTag = PARAGRAPH_STYLE_RE.exec(xml)
  if (styleTag) {
    const styleVal = VAL_RE.exec(styleTag[0])?.[1] ?? ''
    level = headingLevelOfStyle(styleVal, styleNames)
  }
  const outlineTag = PARAGRAPH_OUTLINE_RE.exec(xml)
  if (outlineTag) {
    const outlineVal = VAL_RE.exec(outlineTag[0])?.[1]?.trim() ?? ''
    if (/^[0-9]+$/.test(outlineVal)) {
      const outlineLevel = Number(outlineVal) + 1
      level = level === null ? outlineLevel : Math.min(level, outlineLevel)
    }
  }
  return level
}

/**
 * 选定"小节层级"：取出现 ≥2 次的最浅级别。
 * 这样「标题 1 只出现一次（文档标题）+ 标题 2 出现多次（真正的栏目）」时，会正确取标题 2。
 */
export function selectSectionLevel(blocks: ParagraphBlock[]): number {
  const counts = new Map<number, number>()
  for (const block of blocks) {
    if (block.level === null) continue
    counts.set(block.level, (counts.get(block.level) ?? 0) + 1)
  }
  if (counts.size === 0) return 0
  const levels = [...counts.keys()].sort((a, b) => a - b)
  return levels.find((level) => (counts.get(level) ?? 0) >= 2) ?? levels[0] ?? 0
}

/** 段落块 → 小节草稿；非小节层级的标题文本降级为该小节的提示 */
export function blocksToDrafts(blocks: ParagraphBlock[]): Array<{ title: string; hint: string }> {
  const sectionLevel = selectSectionLevel(blocks)
  if (sectionLevel === 0) return []
  const drafts: Array<{ title: string; hint: string }> = []
  let current: { title: string; hintParts: string[] } | null = null
  for (const block of blocks) {
    if (block.text.length === 0) continue
    if (block.level !== null && block.level === sectionLevel) {
      if (current) drafts.push({ title: current.title, hint: clip(current.hintParts.join(' '), MAX_HINT_LENGTH) })
      current = { title: block.text, hintParts: [] }
      continue
    }
    // 纯数字/标点碎片（如 "(4"）对填写没有指导意义，别当提示
    if (!/[\p{L}\p{N}]/u.test(block.text) || /^[\s\d()（）.、,，;；:\-]+$/.test(block.text)) continue
    if (current) current.hintParts.push(block.text)
  }
  if (current) drafts.push({ title: current.title, hint: clip(current.hintParts.join(' '), MAX_HINT_LENGTH) })
  return drafts
}

/** docx：逐段落算出文本与标题级别 */
export function docxBlocks(xml: string, styleNames?: Map<string, string>): ParagraphBlock[] {
  const blocks: ParagraphBlock[] = []
  PARAGRAPH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PARAGRAPH_RE.exec(xml)) !== null) {
    const body = match[1] ?? ''
    blocks.push({ text: paragraphText(body), level: paragraphHeadingLevel(body, styleNames) })
  }
  return blocks
}

/** markdown：^#{1,3} 为标题层级 */
export function markdownBlocks(source: string): ParagraphBlock[] {
  const blocks: ParagraphBlock[] = []
  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const heading = MARKDOWN_HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ text: collapse(heading[2] ?? ''), level: (heading[1] ?? '#').length })
      continue
    }
    if (MARKDOWN_NOISE_RE.test(line)) continue
    blocks.push({ text: collapse(line.replace(MARKDOWN_LIST_PREFIX_RE, '')), level: null })
  }
  return blocks
}

export function parseDocxDocumentXml(xml: string, styleNames?: Map<string, string>): Array<{ title: string; hint: string }> {
  return blocksToDrafts(docxBlocks(xml, styleNames))
}

export function parseMarkdownText(source: string): Array<{ title: string; hint: string }> {
  return blocksToDrafts(markdownBlocks(source))
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
  let styleNames: Map<string, string> | undefined
  try {
    const zip = await JSZip.loadAsync(buffer)
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('missing word/document.xml')
    xml = await entry.async('string')
    const stylesEntry = zip.file('word/styles.xml')
    if (stylesEntry) styleNames = parseStyleNames(await stylesEntry.async('string'))
  } catch {
    throw AppError.validation('DOCX 文件解析失败：缺少 word/document.xml，请确认上传的是有效的 .docx 文件')
  }
  return finalizeSections(parseDocxDocumentXml(xml, styleNames))
}
