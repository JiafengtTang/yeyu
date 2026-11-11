#!/usr/bin/env bash
# 本地开发一键启动：环境检查 → 准备 server/.env → 同步数据库 → seed 首个管理员 → 并行起服务端与桌面端
#
# 用法：
#   scripts/dev.sh            # 正常启动（会执行 prisma db push 与 seed，两者都幂等）
#   scripts/dev.sh --check    # 只做环境自检，不动数据库、不启动进程（CI/排障用）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say() { printf '[dev] %s\n' "$1"; }
fail() { printf '[dev] 失败：%s\n' "$1" >&2; exit 1; }

# 1) 工具链
command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node.js 20+（本项目在 Node 24 上验证）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 版本过低：$(node -v)，需要 20+"
command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm，请执行 corepack enable 或 npm i -g pnpm@11"
say "node $(node -v) / pnpm $(pnpm -v)"

# 2) 依赖
[ -d node_modules ] && [ -d server/node_modules ] && [ -d desktop/node_modules ] \
  || fail "依赖未安装，请在仓库根执行：pnpm install（electron 二进制走 .npmrc 里的 npmmirror）"
[ -x server/node_modules/.bin/prisma ] || fail "server 依赖不完整，请重新 pnpm install"

# 3) 后端环境变量：Prisma 与 Fastify 都从 server/.env 读
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  say "已生成 server/.env（来自 .env.example），生产请改 JWT_SECRET"
fi

# 能从 server/.env 读到 DATABASE_URL 即可（Prisma 相对路径以 server/prisma 为基准）
grep -q '^DATABASE_URL=' server/.env || fail "server/.env 缺少 DATABASE_URL"

# 4) 端口占用提示（4000 服务端 / 5173 渲染层 dev server）
for port in 4000 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    say "警告：端口 $port 已被占用，启动会失败（可用 lsof -nP -iTCP:$port -sTCP:LISTEN 查看进程）"
  fi
done

if [ "$CHECK_ONLY" = "1" ]; then
  say "--check 通过：工具链、依赖、server/.env 均就绪（未改动数据库）"
  exit 0
fi

# 5) 数据库：建表/同步（幂等），首个管理员（幂等）
say "同步数据库结构：pnpm db:push"
pnpm run db:push
say "初始化首个管理员：pnpm db:seed"
pnpm run db:seed

say "启动服务端(4000) + 桌面端(5173/Electron)…"
exec pnpm run dev
