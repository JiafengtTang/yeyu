export interface DesktopBridge {
  platform: string
  getConfig(): Promise<{ serverUrl: string }>
  setServerUrl(serverUrl: string): Promise<{ serverUrl: string }>
  getSession?(): Promise<string | null>
  setSession?(token: string | null): Promise<{ ok: boolean }>
  setWindowMode?(mode: 'login' | 'app'): Promise<{ ok: boolean; mode?: string }>
  appInfo(): Promise<{ version: string; platform: string; userData: string; configPath: string }>
  printPdf(payload: { html: string; filename?: string }): Promise<{ saved: boolean; path?: string; reason?: string }>
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

export {}
