import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

export function Button({ variant = 'default', loading = false, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; loading?: boolean }) {
  const cls = ['btn', variant !== 'default' ? 'btn-' + variant : '', rest.className ?? ''].filter(Boolean).join(' ')
  return (
    <button {...rest} className={cls} disabled={rest.disabled || loading}>
      {loading ? '处理中…' : children}
    </button>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const cls = ['input', props.className ?? ''].filter(Boolean).join(' ')
  return <input {...props} className={cls} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const cls = ['input', 'textarea', props.className ?? ''].filter(Boolean).join(' ')
  return <textarea {...props} className={cls} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const cls = ['input', 'select', props.className ?? ''].filter(Boolean).join(' ')
  return <select {...props} className={cls} />
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required ? <em className="required">*</em> : null}
      </span>
      {children}
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}

export function Card({ title, extra, children, className }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={['card', className ?? ''].filter(Boolean).join(' ')}>
      {title ? (
        <header className="card-head">
          <h3>{title}</h3>
          {extra ? <div className="card-extra">{extra}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  )
}

export function Badge({ tone = 'default', children }: { tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={'badge badge-' + tone}>{children}</span>
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {description ? <p className="muted">{description}</p> : null}
      {action}
    </div>
  )
}

export function Modal({ open, title, onClose, footer, children, width }: { open: boolean; title: ReactNode; onClose(): void; footer?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={width ? { width } : undefined} onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return <div className="spinner">{label}</div>
}

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}
interface ToastContextValue {
  push(message: string, tone?: ToastTone): void
}
const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, tone, message }])
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id))
    }, 3600)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack">
        {items.map((item) => (
          <div key={item.id} className={'toast toast-' + item.tone}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}
