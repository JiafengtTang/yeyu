// 用真实 .docx / .md 验证模版解析：npx tsx verify/parse-template.ts <文件路径>
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseTemplateBuffer } from '../server/src/modules/templates/parse'

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('用法: npx tsx verify/parse-template.ts <周报模版.docx|.md>')
    process.exit(2)
  }
  const format = path.extname(file).toLowerCase() === '.md' ? 'md' : 'docx'
  const sections = await parseTemplateBuffer(format as 'docx' | 'md', readFileSync(file))
  console.log('格式: ' + format + '，识别到 ' + String(sections.length) + ' 个小节：')
  for (const section of sections) {
    const hint = section.hint.length > 80 ? section.hint.slice(0, 80) + '…' : section.hint || '(空)'
    console.log('  [' + section.key + '] ' + section.title)
    console.log('        提示: ' + hint)
  }
}

main().catch((err) => {
  console.error('解析失败:', err instanceof Error ? err.message : err)
  process.exit(1)
})
