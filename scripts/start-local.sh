#!/usr/bin/env bash
# 一条命令在本地起整套：数据库准备 → 后端 → 前端 → 桌面窗口
# 用法：bash scripts/start-local.sh   或根目录 pnpm start
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-5173}"
export DATABASE_URL="${DATABASE_URL:-file:./dev.db}"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret-lab-asset-hub}"
export WEB_PORT

# VS Code / DSH 这类 Electron 应用的集成终端会带上这个变量，会让 electron 退化成纯 Node（窗口不出现）
unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE

cyan() { printf '\033[36m[assets]\033[0m %s\n' "$*"; }
red()  { printf '\033[31m[assets]\033[0m %s\n' "$*" >&2; }

cleanup() {
  cyan '正在关闭…'
  pkill -f "vite --port $WEB_PORT" 2>/dev/null
  pkill -f "tsx watch src/index.ts" 2>/dev/null
  pkill -f "tsx src/index.ts" 2>/dev/null
  pkill -f "electron \. --dev-server" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

[ -d node_modules ] || { cyan '安装依赖（首次约 1-2 分钟）'; pnpm install || { red '依赖安装失败'; exit 1; }; }

for port in "$API_PORT" "$WEB_PORT"; do
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"
  if [ -n "${pids// /}" ]; then
    cyan "端口 $port 被占用（PID: $pids），先释放"
    kill $pids 2>/dev/null; sleep 1; kill -9 $pids 2>/dev/null
  fi
done

cyan '检查数据库与管理员账号'
( cd server && npx prisma db push --skip-generate >/dev/null 2>&1 || npx prisma db push --skip-generate )
( cd server && npx tsx prisma/seed.ts 2>&1 | sed 's/^/    /' | tail -3 )

cyan '启动后端 + 前端 + 桌面窗口（pnpm dev）'
cyan '──────────────────────────────────────────'
cyan '登录账号：13800000000 / Admin@123456'
cyan '关闭窗口或按 Ctrl+C 结束'
cyan '──────────────────────────────────────────'
pnpm dev
cleanup
