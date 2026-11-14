import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { createWriteStream, promises as fs } from 'node:fs'

/** 发布源：GitHub Release（tag 形如 v0.2.0，附带 dmg / exe 安装包） */
const REPO = 'JiafengtTang/yeyu'
const LATEST_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest'
const UA = 'yeyu-desktop-updater'

export interface UpdateAssetInfo {
  name: string
  url: string
  size: number
}

export interface UpdateCheckResult {
  ok: boolean
  currentVersion: string
  latestVersion?: string
  available?: boolean
  notes?: string
  pageUrl?: string
  publishedAt?: string
  asset?: UpdateAssetInfo | null
  error?: string
}

function currentVersion(): string {
  // 仅用于自测：YEYU_FORCE_VERSION=0.1.0 可模拟旧版本
  const forced = process.env.YEYU_FORCE_VERSION?.trim()
  return forced && forced.length > 0 ? forced : app.getVersion()
}

function segments(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => Number(part.replace(/\D/g, '')) || 0)
}

function compareVersions(a: string, b: string): number {
  const left = segments(a)
  const right = segments(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

function assetPattern(): RegExp {
  if (process.platform === 'darwin') return /\.dmg$/i
  if (process.platform === 'win32') return /\.exe$/i
  return /\.AppImage$/i
}

function pickAsset(assets: Array<{ name: string; browser_download_url: string; size: number }>): UpdateAssetInfo | null {
  const candidates = assets.filter((asset) => assetPattern().test(asset.name))
  if (candidates.length === 0) return null
  const archPattern = process.arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64|amd64/i
  const matched = candidates.find((asset) => archPattern.test(asset.name)) ?? candidates[0]
  return { name: matched.name, url: matched.browser_download_url, size: matched.size }
}

async function fetchLatest(): Promise<{
  tag: string
  notes: string
  pageUrl: string
  publishedAt: string
  assets: Array<{ name: string; browser_download_url: string; size: number }>
}> {
  const response = await fetch(LATEST_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA }
  })
  if (response.status === 404) throw new Error('还没有发布任何版本')
  if (response.status === 403) throw new Error('GitHub 接口限流，请稍后再试')
  if (!response.ok) throw new Error('GitHub 返回 ' + response.status)
  const data = (await response.json()) as {
    tag_name?: string
    body?: string
    html_url?: string
    published_at?: string
    assets?: Array<{ name: string; browser_download_url: string; size: number }>
  }
  if (!data.tag_name) throw new Error('无法识别版本号')
  return {
    tag: data.tag_name,
    notes: data.body ?? '',
    pageUrl: data.html_url ?? 'https://github.com/' + REPO + '/releases',
    publishedAt: data.published_at ?? '',
    assets: data.assets ?? []
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const current = currentVersion()
  try {
    const latest = await fetchLatest()
    const latestVersion = latest.tag.replace(/^v/i, '')
    const available = compareVersions(latestVersion, current) > 0
    return {
      ok: true,
      currentVersion: current,
      latestVersion,
      available,
      notes: latest.notes,
      pageUrl: latest.pageUrl,
      publishedAt: latest.publishedAt,
      asset: pickAsset(latest.assets)
    }
  } catch (error) {
    return { ok: false, currentVersion: current, error: error instanceof Error ? error.message : String(error) }
  }
}

async function downloadAsset(asset: UpdateAssetInfo, win: BrowserWindow | null): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yeyu-update-'))
    const target = path.join(dir, asset.name)
    const response = await fetch(asset.url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (!response.ok || !response.body) return { ok: false, error: '下载失败：HTTP ' + response.status }

    const total = Number(response.headers.get('content-length') ?? 0) || asset.size || 0
    const output = createWriteStream(target)
    const reader = response.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        received += value.byteLength
        output.write(Buffer.from(value))
        win?.webContents.send('update:progress', {
          received,
          total,
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
        })
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('update:check', async () => checkForUpdates())

  ipcMain.handle('update:download', async (_event, asset: UpdateAssetInfo) => {
    if (!asset?.url || !asset?.name) return { ok: false, error: '缺少下载地址' }
    return downloadAsset(asset, getWindow())
  })

  ipcMain.handle('update:install', async (_event, filePath: string) => {
    try {
      if (!filePath) return { ok: false, error: '没有已下载的安装包' }
      await fs.access(filePath)
      const opened = await shell.openPath(filePath)
      if (opened) return { ok: false, error: opened }
      // 打开安装包后退出，交给系统安装程序接管
      setTimeout(() => app.quit(), 800)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('update:open-release', async (_event, url: string) => {
    const target = typeof url === 'string' && url.startsWith('https://github.com/') ? url : 'https://github.com/' + REPO + '/releases'
    await shell.openExternal(target)
    return { ok: true }
  })
}
