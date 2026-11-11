import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  setServerUrl: (serverUrl: string) => ipcRenderer.invoke('config:set', { serverUrl }),
  appInfo: () => ipcRenderer.invoke('app:info'),
  printPdf: (payload: { html: string; filename?: string }) => ipcRenderer.invoke('report:printPdf', payload)
})
