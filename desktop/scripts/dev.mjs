// 开发启动器：起 vite + electron，并剥掉会让 electron 退化成纯 Node 的环境变量
// 用法：pnpm --filter @yeyu/desktop dev   （或根目录 pnpm dev）
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(here, '..')
const webPort = Number(process.env.WEB_PORT ?? 5173)

const env = { ...process.env }
// VS Code / DSH 等 Electron 应用的集成终端会带上它：electron 会当 Node 跑，窗口永远不出现
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

function binOf(pkgName, binName = pkgName) {
  const pkgDir = path.join(desktopDir, 'node_modules', pkgName)
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName]
  if (!rel) throw new Error(pkgName + ' 没有可执行入口 ' + binName)
  return path.join(pkgDir, rel)
}

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (ok) => { socket.destroy(); resolve(ok) }
    socket.setTimeout(800)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

// vite 只监听 localhost（通常是 IPv6 的 ::1），所以两个地址都探
async function waitPort(port, timeoutMs = 60000) {
  const started = Date.now()
  for (;;) {
    if (await tryConnect('localhost', port) || await tryConnect('127.0.0.1', port)) return
    if (Date.now() - started > timeoutMs) throw new Error('等待端口 ' + port + ' 超时（vite 没起来？）')
    await new Promise((r) => setTimeout(r, 300))
  }
}

const cleanup = () => {
  for (const child of [electron, vite]) {
    if (child && child.exitCode === null) child.kill('SIGTERM')
  }
}

// 先把主进程 / preload 的 TypeScript 编译到 dist-electron，否则改 main.ts 不生效
try {
  execFileSync(process.execPath, [binOf('typescript', 'tsc'), '-p', 'electron/tsconfig.json'], {
    cwd: desktopDir,
    env,
    stdio: 'inherit'
  })
} catch {
  console.error('[dev] 主进程 TypeScript 编译失败，已中止')
  process.exit(1)
}

let electron = null
const vite = spawn(process.execPath, [binOf('vite'), '--port', String(webPort), '--strictPort'], {
  cwd: desktopDir,
  env,
  stdio: 'inherit'
})
vite.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error('[dev] vite 退出（code ' + code + '），可能是端口被占用')
    process.exit(code)
  }
})

await waitPort(webPort)

const extra = (process.env.EXTRA_ELECTRON_ARGS ?? '').split(' ').filter(Boolean)
electron = spawn(process.execPath, [binOf('electron'), '.', '--dev-server=http://localhost:' + webPort, ...extra], {
  cwd: desktopDir,
  env,
  stdio: 'inherit'
})
electron.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})

process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })
