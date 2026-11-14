import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateAssetInfo, UpdateCheckResult } from '../types/global'
import { Badge, Button, Modal } from './index'
import { Icon } from './icons'

type Phase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'error'

/** 侧边栏底部的「检查更新」：从 GitHub Release 拉新版本，下载安装包并交给系统安装 */
export function UpdateChecker() {
  const bridge = typeof window !== 'undefined' ? window.desktop : undefined
  const supported = Boolean(bridge?.checkUpdate)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')
  const [installedPath, setInstalledPath] = useState('')
  const [badge, setBadge] = useState(false)
  const [version, setVersion] = useState('')
  const checkingRef = useRef(false)

  const runCheck = useCallback(async (): Promise<void> => {
    if (!bridge?.checkUpdate || checkingRef.current) return
    checkingRef.current = true
    setPhase('checking')
    setMessage('')
    try {
      const next = await bridge.checkUpdate()
      setResult(next)
      if (!next.ok) {
        setPhase('error')
        setMessage(next.error ?? '检查失败')
      } else if (next.available) {
        setPhase('available')
        setBadge(true)
      } else {
        setPhase('latest')
      }
    } catch (error) {
      setPhase('error')
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      checkingRef.current = false
    }
  }, [bridge])

  useEffect(() => {
    void bridge?.appInfo?.().then((info) => setVersion(info.version)).catch(() => undefined)
    const offProgress = bridge?.onUpdateProgress?.((payload) => {
      setPercent(payload.percent)
    })
    const offAvailable = bridge?.onUpdateAvailable?.((payload) => {
      setBadge(true)
      setResult(payload)
      setPhase('available')
    })
    return () => {
      offProgress?.()
      offAvailable?.()
    }
  }, [bridge])

  async function download(): Promise<void> {
    const asset: UpdateAssetInfo | null | undefined = result?.asset
    if (!bridge?.downloadUpdate || !asset) {
      setPhase('error')
      setMessage('这个版本没有提供与你系统匹配的安装包，请到发布页手动下载')
      return
    }
    setPhase('downloading')
    setPercent(0)
    const res = await bridge.downloadUpdate(asset)
    if (res.ok && res.path) {
      setInstalledPath(res.path)
      setPhase('downloaded')
    } else {
      setPhase('error')
      setMessage(res.error ?? '下载失败')
    }
  }

  async function install(): Promise<void> {
    if (!bridge?.installUpdate || !installedPath) return
    const res = await bridge.installUpdate(installedPath)
    if (!res.ok) {
      setPhase('error')
      setMessage(res.error ?? '无法打开安装包')
    }
  }

  return (
    <>
      <button
        className="sidebar-update"
        onClick={() => {
          setOpen(true)
          if (phase === 'idle') void runCheck()
        }}
        title="检查更新"
      >
        <Icon name="download" size={14} />
        <span>检查更新</span>
        {badge ? <i className="update-dot" /> : null}
      </button>

      <Modal
        open={open}
        title="检查更新"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>关闭</Button>
            {phase === 'available' ? (
              <Button variant="primary" onClick={() => void download()}>
                下载并安装
              </Button>
            ) : phase === 'downloaded' ? (
              <Button variant="primary" onClick={() => void install()}>
                打开安装包
              </Button>
            ) : (
              <Button variant="primary" loading={phase === 'checking'} onClick={() => void runCheck()}>
                {phase === 'checking' ? '检查中…' : '重新检查'}
              </Button>
            )}
          </>
        }
      >
        {!supported ? (
          <p className="muted">浏览器里使用时不支持自动更新，请在桌面客户端里检查。</p>
        ) : (
          <>
            <div className="update-row">
              <span className="muted">当前版本</span>
              <strong>v{result?.currentVersion || version || '—'}</strong>
            </div>

            {phase === 'checking' ? <p className="muted">正在向 GitHub 查询最新版本…</p> : null}

            {phase === 'latest' ? (
              <p className="update-ok">
                <Icon name="check" size={15} /> 已是最新版本（v{result?.latestVersion ?? version}）
              </p>
            ) : null}

            {phase === 'available' ? (
              <>
                <div className="update-row">
                  <span className="muted">最新版本</span>
                  <strong>
                    v{result?.latestVersion} <Badge tone="success">可更新</Badge>
                  </strong>
                </div>
                {result?.notes ? <pre className="update-notes">{result.notes.slice(0, 1200)}</pre> : null}
                <p className="muted">
                  下载完成后会打开安装包，按提示装完即可（安装包{result?.asset ? '：' + result.asset.name : '需手动从发布页下载'}）。
                </p>
              </>
            ) : null}

            {phase === 'downloading' ? (
              <div className="update-progress">
                <div className="update-progress-bar">
                  <span style={{ width: percent + '%' }} />
                </div>
                <span className="muted">正在下载安装包… {percent}%</span>
              </div>
            ) : null}

            {phase === 'downloaded' ? (
              <p className="update-ok">
                <Icon name="check" size={15} /> 安装包已下载完成，点「打开安装包」继续。
              </p>
            ) : null}

            {phase === 'error' ? <p className="field-error">{message}</p> : null}

            {result?.pageUrl ? (
              <button className="link-button" onClick={() => void bridge?.openReleasePage?.(result.pageUrl ?? '')}>
                在浏览器中打开发布页
              </button>
            ) : null}
          </>
        )}
      </Modal>
    </>
  )
}
