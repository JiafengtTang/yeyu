#!/usr/bin/env bash
# 构建 Windows 免签名 NSIS 安装包（x64）
#   scripts/build-win.sh
#
# 在 macOS/Linux 上交叉构建也可以：electron-builder 自带 makensis（免签名不需要 wine），
# 首次构建会从 npmmirror 下载 electron 与 nsis 工具链。正式发布仍建议在 Windows 上构建后再分发。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/desktop"

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

[ -f electron-builder.yml ] || { echo "[build-win] 缺少 desktop/electron-builder.yml" >&2; exit 1; }
[ -d node_modules/electron-builder ] || { echo "[build-win] 依赖未安装，请先在仓库根执行 pnpm install" >&2; exit 1; }

echo "[build-win] 1/2 编译渲染层与主进程（tsc + vite build）"
pnpm run build

echo "[build-win] 2/2 electron-builder --win --x64"
npx --no-install electron-builder --win --x64 --config electron-builder.yml

echo "[build-win] 产物："
ls -lh release/*.exe 2>/dev/null || true

cat <<'TIP'

免签名安装提示（无代码签名证书）：
  1. 把 release/lab-asset-hub-<版本>-win-x64-setup.exe 拷到目标 Windows。
  2. 首次运行会触发 SmartScreen：点「更多信息」→「仍要运行」。
  3. 安装包默认非管理员安装（装到当前用户目录），可自选安装路径，桌面与开始菜单快捷方式为「课题组资产台账」。
TIP
