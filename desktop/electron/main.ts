import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

interface AppConfig {
  serverUrl: string
}

const DEFAULT_CONFIG: AppConfig = { serverUrl: 'http://127.0.0.1:4000' }
const devServerArg = process.argv.find((a) => a.startsWith('--dev-server='))
const devServerUrl = devServerArg ? devServerArg.split('=')[1] : null
let mainWindow: BrowserWindow | null = null

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

async function writeConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await readConfig()
  const next: AppConfig = { ...current, ...patch }
  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    title: '课题组资产台账',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
    // 默认不弹 DevTools（它会在终端刷 Autofill.enable failed 这类噪声）；需要时 OPEN_DEVTOOLS=1
    if (process.env.OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('config:get', async () => readConfig())

ipcMain.handle('config:set', async (_event, payload: Partial<AppConfig>) => {
  const next = await writeConfig({ serverUrl: payload?.serverUrl ?? DEFAULT_CONFIG.serverUrl })
  return next
})

ipcMain.handle('app:info', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  userData: app.getPath('userData'),
  configPath: configPath()
}))

ipcMain.handle('report:printPdf', async (_event, payload: { html: string; filename?: string }) => {
  const html = String(payload?.html ?? '')
  if (html.length === 0) return { saved: false, reason: 'empty' }
  const tmpFile = path.join(os.tmpdir(), 'lab-report-' + Date.now() + '.html')
  await fs.writeFile(tmpFile, html, 'utf-8')

  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: false } })
  await win.loadFile(tmpFile)
  await new Promise((resolve) => setTimeout(resolve, 400))
  const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } })
  win.destroy()

  const suggested = payload?.filename ?? '周报.pdf'
  const result = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), suggested), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (result.canceled || !result.filePath) {
    await fs.unlink(tmpFile).catch(() => undefined)
    return { saved: false, reason: 'canceled' }
  }
  await fs.writeFile(result.filePath, pdf)
  await fs.unlink(tmpFile).catch(() => undefined)
  return { saved: true, path: result.filePath }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
