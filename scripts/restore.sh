#!/usr/bin/env bash
# 从 scripts/backup.sh 生成的归档恢复数据库与 uploads 目录
#
# 用法：
#   scripts/restore.sh backups/yeyu-backup-20260101-030000.tar.gz          # 预演，只打印将要做什么
#   scripts/restore.sh backups/yeyu-backup-20260101-030000.tar.gz --yes    # 真正恢复
#   DB_FILE=... UPLOAD_DIR=... scripts/restore.sh <归档> --yes
#
# 安全约定：
# - 不确认不写入；确认后先把现状再备份到 backups/pre-restore-<时间戳>.tar.gz
# - 只覆盖 DB_FILE 与 UPLOAD_DIR 两个目标，绝不递归删除其它目录
# - 服务端必须先停（SQLite 单文件，运行中覆盖会损坏）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCHIVE=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    -h | --help)
      sed -n '2,12p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) ARCHIVE="$arg" ;;
  esac
done

[ -n "$ARCHIVE" ] || { echo "[restore] 用法：scripts/restore.sh <备份.tar.gz> [--yes]" >&2; exit 2; }
[ -f "$ARCHIVE" ] || { echo "[restore] 归档不存在：$ARCHIVE" >&2; exit 1; }
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

DB_FILE="${DB_FILE:-$ROOT/server/prisma/dev.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$ROOT/server/uploads}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

# 目标路径守卫：必须是绝对路径，且不能是根目录
for target in "$DB_FILE" "$UPLOAD_DIR"; do
  case "$target" in
    /) echo "[restore] 拒绝操作根目录" >&2; exit 1 ;;
    /*) ;;
    *) echo "[restore] 目标必须是绝对路径：$target" >&2; exit 1 ;;
  esac
done

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/lab-restore-XXXXXX")"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

tar tzf "$ARCHIVE" >/dev/null 2>&1 || { echo "[restore] 归档损坏或不是 tar.gz：$ARCHIVE" >&2; exit 1; }
tar xzf "$ARCHIVE" -C "$STAGING"
[ -f "$STAGING/app.db" ] || { echo "[restore] 归档里没有 app.db，不是有效的备份" >&2; exit 1; }

echo "[restore] 归档：$ARCHIVE"
[ -f "$STAGING/MANIFEST.txt" ] && sed 's/^/[restore]   /' "$STAGING/MANIFEST.txt"
echo "[restore] 将覆盖："
echo "[restore]   数据库 → $DB_FILE"
echo "[restore]   uploads → $UPLOAD_DIR"
[ -d "$STAGING/uploads" ] || echo "[restore]   注意：归档里没有 uploads/，恢复后上传目录为空"

if [ "$ASSUME_YES" != "1" ]; then
  echo "[restore] 预演结束（未写入任何文件）。确认无误后追加 --yes 执行："
  echo "[restore]   scripts/restore.sh $ARCHIVE --yes"
  exit 0
fi

# 1) 先把现状备份一份，恢复失败还能回到恢复前
SAFETY_DIR="$BACKUP_DIR"
mkdir -p "$SAFETY_DIR"
SAFETY="$SAFETY_DIR/pre-restore-$(date +%Y%m%d-%H%M%S).tar.gz"
TMP_SAFETY="$(mktemp -d "${TMPDIR:-/tmp}/lab-safety-XXXXXX")"
mkdir -p "$TMP_SAFETY"
[ -f "$DB_FILE" ] && cp "$DB_FILE" "$TMP_SAFETY/app.db"
[ -d "$UPLOAD_DIR" ] && cp -R "$UPLOAD_DIR" "$TMP_SAFETY/uploads"
tar czf "$SAFETY" -C "$TMP_SAFETY" .
rm -rf "$TMP_SAFETY"
echo "[restore] 恢复前快照：$SAFETY"

# 2) 覆盖数据库（保留旧文件为 .bak-<时间戳>）
mkdir -p "$(dirname "$DB_FILE")"
if [ -f "$DB_FILE" ]; then
  cp "$DB_FILE" "$DB_FILE.bak-$(date +%Y%m%d-%H%M%S)"
fi
cp "$STAGING/app.db" "$DB_FILE"

# 3) 覆盖 uploads：先清空目标内容再拷贝（目标路径已通过上面的守卫校验）
if [ -d "$STAGING/uploads" ]; then
  mkdir -p "$UPLOAD_DIR"
  find "$UPLOAD_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  (cd "$STAGING/uploads" && tar cf - .) | (cd "$UPLOAD_DIR" && tar xf -)
fi

echo "[restore] 完成。请重新启动服务端并检查 GET /api/health 与关键列表页。"
