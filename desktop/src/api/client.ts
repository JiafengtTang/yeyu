import type { ApiErrorBody } from '@yeyu/shared'

const TOKEN_KEY = 'yeyu.token'
const BASE_KEY = 'yeyu.baseUrl'
let baseUrl = 'http://127.0.0.1:4000'
let token: string | null = null

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export async function initClient(): Promise<void> {
  token = localStorage.getItem(TOKEN_KEY)
  const stored = localStorage.getItem(BASE_KEY)
  if (stored) baseUrl = stored
  try {
    const bridge = window.desktop
    const cfg = await bridge?.getConfig?.()
    if (cfg?.serverUrl) baseUrl = cfg.serverUrl.replace(/\/+$/, '')
    // 桌面端把会话写在 userData/config.json：file:// 下 localStorage 不可靠，且重启后要免登录
    const saved = await bridge?.getSession?.()
    if (saved) {
      token = saved
      localStorage.setItem(TOKEN_KEY, saved)
    } else if (token) {
      void bridge?.setSession?.(token)
    }
  } catch {
    // 桌面桥不可用时退回 localStorage / 默认值
  }
}

export function getBaseUrl(): string {
  return baseUrl
}

export function getToken(): string | null {
  return token
}

export function setToken(next: string | null): void {
  token = next
  if (next) localStorage.setItem(TOKEN_KEY, next)
  else localStorage.removeItem(TOKEN_KEY)
  void window.desktop?.setSession?.(next)
}

export async function setServerUrl(next: string): Promise<void> {
  baseUrl = next.replace(/\/+$/, '')
  localStorage.setItem(BASE_KEY, baseUrl)
  try {
    await window.desktop?.setServerUrl(baseUrl)
  } catch {
    // 忽略：浏览器里没有桌面桥
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  form?: FormData
  query?: Record<string, unknown>
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? '?' + qs : ''
}

async function request(path: string, options: ApiOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = 'Bearer ' + token
  let body: BodyInit | undefined
  if (options.form) {
    body = options.form
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const res = await fetch(baseUrl + path + buildQuery(options.query), {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body
  })
  if (!res.ok) {
    let payload: ApiErrorBody | null = null
    try {
      payload = (await res.json()) as ApiErrorBody
    } catch {
      payload = null
    }
    const code = payload?.error?.code ?? 'INTERNAL'
    const message = payload?.error?.message ?? '请求失败 (' + String(res.status) + ')'
    throw new ApiError(code, message, res.status, payload?.error?.details)
  }
  return res
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await request(path, options)
  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as unknown as T
}

export function apiForm<T>(path: string, form: FormData, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  return api<T>(path, { method, form })
}

export async function apiDownload(path: string, filename: string, query?: Record<string, unknown>): Promise<void> {
  const res = await request(path, { query })
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function mediaUrl(mediaId: string): string {
  const suffix = token ? '?token=' + encodeURIComponent(token) : ''
  return baseUrl + '/api/media/' + mediaId + suffix
}

export function resolveMediaHtml(html: string): string {
  return html.replace(/media:([A-Za-z0-9_-]+)/g, (_match, id: string) => mediaUrl(id))
}

export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return '未知错误'
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return formatDate(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
