#!/usr/bin/env bash
# 备份 SQLite 数据库 + uploads 目录为单个 tar.gz（一个归档 = 一次完整可恢复的备份）
#
# 用法：
#   scripts/backup.sh                       # 默认：server/prisma/dev.db + server/uploads → backups/
#   scripts/backup.sh /path/to/backups      # 指定输出目录
#   DB_FILE=... UPLOAD_DIR=... scripts/backup.sh
#   （docker compose 部署的备份/恢复见 docs/部署与使用.md 的「备份与恢复」小节）
#
# 环境变量：
#   DB_FILE     数据库文件，默认 server/prisma/dev.db
#   UPLOAD_DIR  上传目录，默认 server/uploads
#   KEEP        保留最近多少个备份，默认 14（0 表示不清理）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR=""
for arg in "$@"; do
  case "$arg" in
    -h | --help)
      sed -n '2,13p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) OUT_DIR="$arg" ;;
  esac
done

OUT_DIR="${OUT_DIR:-$ROOT/backups}"
KEEP="${KEEP:-14}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$OUT_DIR/yeyu-backup-$STAMP.tar.gz"

DB_FILE="${DB_FILE:-$ROOT/server/prisma/dev.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$ROOT/server/uploads}"

[ -f "$DB_FILE" ] || { echo "[backup] 数据库文件不存在：$DB_FILE" >&2; exit 1; }

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/lab-backup-XXXXXX")"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

# 优先用 sqlite3 的在线备份（一致性快照），没有 sqlite3 就退化为 cp
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$STAGING/app.db'"
  DB_MODE="sqlite3 .backup"
else
  cp "$DB_FILE" "$STAGING/app.db"
  DB_MODE="cp"
fi

UPLOAD_COUNT=0
if [ -d "$UPLOAD_DIR" ]; then
  mkdir -p "$STAGING/uploads"
  # 保持相对层级，排除临时文件
  (cd "$UPLOAD_DIR" && tar cf - --exclude '.DS_Store' .) | (cd "$STAGING/uploads" && tar xf -)
  UPLOAD_COUNT="$(find "$STAGING/uploads" -type f | wc -l | tr -d ' ')"
fi

{
  echo "备份时间: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "来源数据库: $DB_FILE"
  echo "数据库导出方式: $DB_MODE"
  echo "上传目录: $UPLOAD_DIR"
  echo "上传文件数: $UPLOAD_COUNT"
  echo "恢复命令: scripts/restore.sh $ARCHIVE --yes"
  echo "注意: 数据库为 SQLite，恢复前请先停掉服务端进程/容器"
} >"$STAGING/MANIFEST.txt"

tar czf "$ARCHIVE" -C "$STAGING" .
echo "[backup] 完成：${ARCHIVE}（$(du -h "$ARCHIVE" | cut -f1)，数据库 $(du -h "$STAGING/app.db" | cut -f1)，上传文件 $UPLOAD_COUNT 个）"

if [ "$KEEP" != "0" ]; then
  # 只清理输出目录里本脚本产生的归档（macOS 自带 bash 3.2 没有 mapfile，这里用管道读取）
  ls -1t "$OUT_DIR"/yeyu-backup-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r f; do
    echo "[backup] 清理旧备份：$f"
    rm -f "$f"
  done
fi
