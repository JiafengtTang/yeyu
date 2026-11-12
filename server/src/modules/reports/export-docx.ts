import { readFile } from 'node:fs/promises'
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import { REPORT_STATUS_LABEL } from '@yeyu/shared'
import type { ReportDTO } from '@yeyu/shared'
import { prisma } from '../../lib/prisma'
import { mediaAbsPath } from '../../lib/storage'

type Block =
  | { kind: 'text'; text: string; heading?: 1 | 2 | 3 }
  | { kind: 'image'; mediaId: string }

const BLOCK_NAMES = new Set([
  'p', 'div', 'li', 'blockquote', 'tr', 'section', 'article',
  'ul', 'ol', 'table', 'td', 'th', 'pre', 'dd', 'dt', 'figure', 'figcaption'
])

const TAG_RE = /<\/?[a-zA-Z][^>]*>/g
const IMAGE_TYPE: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp'
}
const MAX_IMAGE_WIDTH = 480

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/** 把 contentHtml 拆成「文本段 / 图片」序列；正文里的 media:<id> 转成可嵌入的图片块 */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = []
  let buffer = ''
  let heading: 1 | 2 | 3 | undefined
  let cursor = 0

  const flush = () => {
    const text = decodeEntities(buffer)
    buffer = ''
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/[\t ]+/g, ' ').trim()
      if (trimmed) blocks.push({ kind: 'text', text: trimmed, heading })
    }
  }

  TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG_RE.exec(html)) !== null) {
    buffer += html.slice(cursor, match.index)
    cursor = TAG_RE.lastIndex
    const tag = match[0]
    const name = (/^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)?.[1] ?? '').toLowerCase()
    const closing = tag.startsWith('</')

    if (name === 'img') {
      flush()
      const src = /src\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ''
      const mediaId = /^media:([A-Za-z0-9_-]+)$/.exec(src.trim())?.[1]
      if (mediaId) blocks.push({ kind: 'image', mediaId })
      continue
    }
    if (name === 'br') {
      buffer += '\n'
      continue
    }
    if (/^h[1-6]$/.test(name)) {
      flush()
      heading = closing ? undefined : (Math.min(Number(name[1]), 3) as 1 | 2 | 3)
      buffer += '\n'
      continue
    }
    if (BLOCK_NAMES.has(name)) {
      buffer += '\n'
      continue
    }
    // 行内标签（span/b/strong/i/u/a/...）忽略标签本身，保留内部文本
  }
  buffer += html.slice(cursor)
  flush()
  return blocks
}

function imageSize(data: Buffer): { width: number; height: number } | null {
  if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = data[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) }
      }
      const length = data.readUInt16BE(offset + 2)
      if (length <= 0) break
      offset += 2 + length
    }
  }
  return null
}

function scaled(width: number, height: number): { width: number; height: number } {
  const safeWidth = width > 0 ? width : MAX_IMAGE_WIDTH
  const safeHeight = height > 0 ? height : MAX_IMAGE_WIDTH * 0.66
  if (safeWidth <= MAX_IMAGE_WIDTH) {
    return { width: Math.round(safeWidth), height: Math.max(1, Math.round(safeHeight)) }
  }
  const ratio = MAX_IMAGE_WIDTH / safeWidth
  return { width: MAX_IMAGE_WIDTH, height: Math.max(1, Math.round(safeHeight * ratio)) }
}

function placeholderParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, color: '999999', italics: true })]
  })
}

async function imageParagraph(mediaId: string): Promise<Paragraph> {
  const media = await prisma.media.findUnique({ where: { id: mediaId } })
  if (!media) return placeholderParagraph('（图片缺失：' + mediaId + '）')
  const type = IMAGE_TYPE[media.mime]
  if (!type) return placeholderParagraph('（暂不支持的图片格式：' + media.filename + '）')
  try {
    const data = await readFile(mediaAbsPath(media.path))
    const size = scaled(imageSize(data)?.width ?? 0, imageSize(data)?.height ?? 0)
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [new ImageRun({ type, data, transformation: size })]
    })
  } catch {
    return placeholderParagraph('（图片已丢失：' + media.filename + '）')
  }
}

function textParagraph(block: Extract<Block, { kind: 'text' }>): Paragraph {
  const heading =
    block.heading === 1 ? HeadingLevel.HEADING_1 : block.heading === 2 ? HeadingLevel.HEADING_2 : block.heading === 3 ? HeadingLevel.HEADING_3 : undefined
  return new Paragraph({
    heading,
    spacing: { after: 120 },
    children: [new TextRun({ text: block.text })]
  })
}

function metaParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text, color: '444444' })]
  })
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-'
}

function moment(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '-'
}

export function docxFilename(report: ReportDTO): string {
  return '周报-' + report.week + '-' + (report.authorName || '未署名') + '.docx'
}

export async function buildReportDocx(report: ReportDTO): Promise<Buffer> {
  const blocks = htmlToBlocks(report.contentHtml)
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
      children: [new TextRun({ text: report.title.trim() || '周报 ' + report.week })]
    })
  )
  children.push(metaParagraph('作者：' + (report.authorName || '-')))
  children.push(metaParagraph('周次：' + report.week + '（' + day(report.periodStart) + ' ~ ' + day(report.periodEnd) + '）'))
  children.push(metaParagraph('状态：' + (REPORT_STATUS_LABEL[report.status] ?? report.status)))
  if (report.submittedAt) children.push(metaParagraph('提交时间：' + moment(report.submittedAt)))
  if (report.late) children.push(metaParagraph('迟交：是（超过本周截止时间）'))
  if (report.reviewedAt) {
    children.push(metaParagraph('审阅：' + (report.reviewerName ?? '-') + ' · ' + moment(report.reviewedAt)))
  }
  if (report.reviewComment) children.push(metaParagraph('审核意见：' + report.reviewComment))
  children.push(new Paragraph({ text: '', spacing: { after: 120 } }))

  // 模版周报按小节渲染；sections 为空时仍按旧版自由正文渲染
  if (report.sections.length > 0) {
    for (const section of report.sections) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: section.title })]
        })
      )
      const sectionBlocks = htmlToBlocks(section.contentHtml)
      if (sectionBlocks.length === 0) {
        children.push(placeholderParagraph('（本节未填写）'))
        continue
      }
      for (const block of sectionBlocks) {
        if (block.kind === 'text') children.push(textParagraph(block))
        else children.push(await imageParagraph(block.mediaId))
      }
    }
    if (blocks.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: '补充正文' })]
        })
      )
      for (const block of blocks) {
        if (block.kind === 'text') children.push(textParagraph(block))
        else children.push(await imageParagraph(block.mediaId))
      }
    }
  } else {
    if (blocks.length === 0) {
      children.push(placeholderParagraph('（正文为空）'))
    }
    for (const block of blocks) {
      if (block.kind === 'text') children.push(textParagraph(block))
      else children.push(await imageParagraph(block.mediaId))
    }
  }

  if (report.comments.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: '评论（' + report.comments.length + '）' })]
      })
    )
    for (const comment of report.comments) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: (comment.authorName || '-') + ' · ' + moment(comment.createdAt), color: '666666', size: 18 })]
        })
      )
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: comment.body })] }))
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}
