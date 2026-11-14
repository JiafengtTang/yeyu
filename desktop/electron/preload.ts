import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  setServerUrl: (serverUrl: string) => ipcRenderer.invoke('config:set', { serverUrl }),
  getSession: () => ipcRenderer.invoke('session:get'),
  setSession: (token: string | null) => ipcRenderer.invoke('session:set', token),
  setWindowMode: (mode: 'login' | 'app') => ipcRenderer.invoke('window:set-mode', mode),
  appInfo: () => ipcRenderer.invoke('app:info'),
  printPdf: (payload: { html: string; filename?: string }) => ipcRenderer.invoke('report:printPdf', payload),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (asset: { name: string; url: string; size: number }) => ipcRenderer.invoke('update:download', asset),
  installUpdate: (filePath: string) => ipcRenderer.invoke('update:install', filePath),
  openReleasePage: (url: string) => ipcRenderer.invoke('update:open-release', url),
  onUpdateProgress: (handler: (payload: { received: number; total: number; percent: number }) => void) => {
    const listener = (_event: unknown, payload: { received: number; total: number; percent: number }) => handler(payload)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  onUpdateAvailable: (handler: (result: unknown) => void) => {
    const listener = (_event: unknown, result: unknown) => handler(result)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  }
})
