#!/usr/bin/env bash
# 构建 macOS 免签名产物（默认当前架构；可传 arm64 / x64）
#   scripts/build-mac.sh            # 当前机器架构
#   scripts/build-mac.sh arm64      # Apple Silicon
#   scripts/build-mac.sh x64        # Intel
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/desktop"

# electron 二进制与 dmg 工具走国内镜像（GitHub 直连不可用）
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

[ "$(uname -s)" = "Darwin" ] || { echo "[build-mac] 只能在 macOS 上打 macOS 包" >&2; exit 1; }
[ -f electron-builder.yml ] || { echo "[build-mac] 缺少 desktop/electron-builder.yml" >&2; exit 1; }
[ -d node_modules/electron-builder ] || { echo "[build-mac] 依赖未安装，请先在仓库根执行 pnpm install" >&2; exit 1; }

ARCH="${1:-}"
ARGS=(--mac --config electron-builder.yml)
case "$ARCH" in
  "" ) ;;
  arm64 | x64 ) ARGS+=("--$ARCH") ;;
  * ) echo "[build-mac] 未知架构：${ARCH}（只支持 arm64 / x64）" >&2; exit 2 ;;
esac

echo "[build-mac] 1/2 编译渲染层与主进程（tsc + vite build）"
pnpm run build

echo "[build-mac] 2/2 electron-builder ${ARGS[*]}"
npx --no-install electron-builder "${ARGS[@]}"

echo "[build-mac] 产物："
ls -lh release/*.dmg 2>/dev/null || true
du -sh release/mac*/*.app 2>/dev/null || true

cat <<'TIP'

免签名安装提示（无 Apple Developer ID，产物未签名未公证）：
  1. 把 release/yeyu-<版本>-mac-<arch>.dmg 拷到目标 Mac，双击挂载后把 App 拖进「应用程序」。
  2. 首次启动被拦「无法验证开发者 / 已损坏」时，任选其一：
       /usr/bin/xattr -cr /Applications/Yeyu.app
       或 在 Finder 里右键 App → 打开 → 再次确认「打开」
  3. 本机自测（未签名、未隔离）直接 open release/mac-<arch>/Yeyu.app 即可。
TIP
