import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  setServerUrl: (serverUrl: string) => ipcRenderer.invoke('config:set', { serverUrl }),
  getSession: () => ipcRenderer.invoke('session:get'),
  setSession: (token: string | null) => ipcRenderer.invoke('session:set', token),
  setWindowMode: (mode: 'login' | 'app') => ipcRenderer.invoke('window:set-mode', mode),
  appInfo: () => ipcRenderer.invoke('app:info'),
  printPdf: (payload: { html: string; filename?: string }) => ipcRenderer.invoke('report:printPdf', payload)
})
