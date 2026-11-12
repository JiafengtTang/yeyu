import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

type WindowMode = 'login' | 'app'

interface AppConfig {
  serverUrl: string
  sessionToken?: string | null
}

const DEFAULT_CONFIG: AppConfig = { serverUrl: 'http://127.0.0.1:4000', sessionToken: null }
const LOGIN_SIZE = { width: 400, height: 500 }
const APP_SIZE = { width: 1360, height: 864 }

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

function applyMode(win: BrowserWindow, mode: WindowMode): void {
  if (mode === 'login') {
    win.setResizable(true)
    win.setMinimumSize(360, 480)
    win.setSize(LOGIN_SIZE.width, LOGIN_SIZE.height, true)
    win.center()
    win.setResizable(false)
  } else {
    win.setResizable(true)
    win.setMinimumSize(1080, 700)
    win.setSize(APP_SIZE.width, APP_SIZE.height, true)
    win.center()
  }
}

async function createWindow(): Promise<void> {
  const config = await readConfig()
  const startMode: WindowMode = config.sessionToken ? 'app' : 'login'
  const size = startMode === 'app' ? APP_SIZE : LOGIN_SIZE

  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 360,
    minHeight: 480,
    title: '页屿',
    backgroundColor: '#fbfbfa',
    show: false,
    resizable: startMode === 'app',
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
    if (process.env.OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (mainWindow) applyMode(mainWindow, startMode)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('config:get', async () => {
  const config = await readConfig()
  return { serverUrl: config.serverUrl }
})

ipcMain.handle('config:set', async (_event, payload: Partial<AppConfig>) => {
  const next = await writeConfig({ serverUrl: payload?.serverUrl ?? DEFAULT_CONFIG.serverUrl })
  return { serverUrl: next.serverUrl }
})

ipcMain.handle('session:get', async () => {
  const config = await readConfig()
  return config.sessionToken ?? null
})

ipcMain.handle('session:set', async (_event, token: string | null) => {
  await writeConfig({ sessionToken: token ?? null })
  return { ok: true }
})

ipcMain.handle('window:set-mode', async (_event, mode: WindowMode) => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (!win) return { ok: false }
  applyMode(win, mode === 'app' ? 'app' : 'login')
  return { ok: true, mode }
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
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'))
    } catch {
      // 图标缺失不影响启动
    }
  }
  void createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
