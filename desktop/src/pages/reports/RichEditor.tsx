import { useCallback, useEffect, useRef, type ChangeEvent } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import type { MediaDTO } from '@yeyu/shared'
import { apiErrorMessage, apiForm, mediaUrl } from '../../api/client'
import { useToast } from '../../ui'

interface RichEditorProps {
  value: string
  editable: boolean
  onChange(html: string): void
}

interface ToolButtonProps {
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick(): void
}

function ToolButton({ label, title, active = false, disabled = false, onClick }: ToolButtonProps) {
  return (
    <button type="button" className={active ? 'active' : ''} title={title} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
}

export function RichEditor({ value, editable, onChange }: RichEditorProps) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const onChangeRef = useRef(onChange)
  const readyRef = useRef(false)
  onChangeRef.current = onChange

  const insertImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const target = editorRef.current
        if (!target) return
        try {
          const form = new FormData()
          form.append('file', file)
          form.append('usage', 'REPORT')
          const media = await apiForm<MediaDTO>('/api/media', form)
          target.chain().focus().setImage({ src: mediaUrl(media.id), alt: media.filename }).run()
        } catch (err) {
          toast.push('图片上传失败：' + apiErrorMessage(err), 'error')
        }
      }
    },
    [toast]
  )

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: '本周进展、遇到的问题、下周计划…（可直接粘贴或拖拽图片）' })
    ],
    content: value,
    onCreate: () => {
      window.setTimeout(() => {
        readyRef.current = true
      }, 0)
    },
    onUpdate: ({ editor: current }) => {
      if (!readyRef.current) return
      onChangeRef.current(current.getHTML())
    },
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        void insertImages(files)
        return true
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        void insertImages(files)
        return true
      }
    }
  })

  useEffect(() => {
    editorRef.current = editor
    if (editor) editor.setEditable(editable)
  }, [editor, editable])

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void insertImages(files)
  }

  if (!editor) return <div className="rich-editor"><div className="rich-body" /></div>

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <ToolButton label="标题1" title="一级标题" active={editor.isActive('heading', { level: 1 })} disabled={!editable} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolButton label="标题2" title="二级标题" active={editor.isActive('heading', { level: 2 })} disabled={!editable} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolButton label="标题3" title="三级标题" active={editor.isActive('heading', { level: 3 })} disabled={!editable} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <ToolButton label="正文" title="正文段落" active={editor.isActive('paragraph')} disabled={!editable} onClick={() => editor.chain().focus().setParagraph().run()} />
        <ToolButton label="B" title="粗体" active={editor.isActive('bold')} disabled={!editable} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton label="I" title="斜体" active={editor.isActive('italic')} disabled={!editable} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton label="S" title="删除线" active={editor.isActive('strike')} disabled={!editable} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <ToolButton label="• 列表" title="无序列表" active={editor.isActive('bulletList')} disabled={!editable} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolButton label="1. 列表" title="有序列表" active={editor.isActive('orderedList')} disabled={!editable} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolButton label="引用" title="引用块" active={editor.isActive('blockquote')} disabled={!editable} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolButton label="代码" title="代码块" active={editor.isActive('codeBlock')} disabled={!editable} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
        <ToolButton label="分割线" title="分割线" disabled={!editable} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <ToolButton label="插入图片" title="插入图片（也可粘贴 / 拖拽）" disabled={!editable} onClick={() => fileRef.current?.click()} />
        <ToolButton label="撤销" title="撤销" disabled={!editable || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
        <ToolButton label="重做" title="重做" disabled={!editable || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
      </div>
      <EditorContent className="rich-body" editor={editor} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
    </div>
  )
}
