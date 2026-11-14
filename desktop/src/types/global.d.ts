export interface DesktopBridge {
  platform: string
  getConfig(): Promise<{ serverUrl: string }>
  setServerUrl(serverUrl: string): Promise<{ serverUrl: string }>
  getSession?(): Promise<string | null>
  setSession?(token: string | null): Promise<{ ok: boolean }>
  setWindowMode?(mode: 'login' | 'app'): Promise<{ ok: boolean; mode?: string }>
  appInfo(): Promise<{ version: string; platform: string; userData: string; configPath: string }>
  printPdf(payload: { html: string; filename?: string }): Promise<{ saved: boolean; path?: string; reason?: string }>
  checkUpdate?(): Promise<UpdateCheckResult>
  downloadUpdate?(asset: UpdateAssetInfo): Promise<{ ok: boolean; path?: string; error?: string }>
  installUpdate?(filePath: string): Promise<{ ok: boolean; error?: string }>
  openReleasePage?(url: string): Promise<{ ok: boolean }>
  onUpdateProgress?(handler: (payload: { received: number; total: number; percent: number }) => void): () => void
  onUpdateAvailable?(handler: (result: UpdateCheckResult) => void): () => void
}

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

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

export {}
