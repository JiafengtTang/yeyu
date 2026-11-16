#!/usr/bin/env bash
# 定时备份守护：按固定间隔调用 backup.sh，适合不想配 crontab 的机器
#
# 用法：
#   scripts/backup-daemon.sh                    # 每 6 小时备份一次，前台运行
#   INTERVAL_HOURS=12 KEEP=30 scripts/backup-daemon.sh
#   scripts/backup-daemon.sh --once             # 只跑一次（配合 cron 使用）
#
# 环境变量：
#   INTERVAL_HOURS  备份间隔小时数，默认 6
#   KEEP            保留份数（透传给 backup.sh），默认 14
#   BACKUP_DIR      备份输出目录，默认 backups/
#   START_DELAY_SEC 启动后延迟多少秒再跑第一次，默认 30
#
# systemd 常驻示例（/etc/systemd/system/yeyu-backup.service）：
#   [Unit]
#   Description=yeyu backup daemon
#   [Service]
#   WorkingDirectory=/srv/yeyu
#   Environment=INTERVAL_HOURS=6 KEEP=14
#   ExecStart=/srv/yeyu/scripts/backup-daemon.sh
#   Restart=always
#   [Install]
#   WantedBy=multi-user.target
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_HOURS="${INTERVAL_HOURS:-6}"
START_DELAY_SEC="${START_DELAY_SEC:-30}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
ONE_SHOT=0

for arg in "$@"; do
  case "$arg" in
    --once) ONE_SHOT=1 ;;
    -h|--help) sed -n "2,24p" "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

log() { printf "[%s] %s\n" "$(date "+%Y-%m-%d %H:%M:%S")" "$*"; }

run_once() {
  log "开始备份 -> $BACKUP_DIR"
  if "$ROOT/scripts/backup.sh" "$BACKUP_DIR"; then
    log "备份成功：$(ls -1t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | head -1 || echo 无归档)"
  else
    log "备份失败，等待下一轮"
  fi
}

if [ "$ONE_SHOT" = "1" ]; then
  run_once
  exit 0
fi

log "守护启动：每 ${INTERVAL_HOURS} 小时备份一次，首次在 ${START_DELAY_SEC} 秒后"
sleep "$START_DELAY_SEC"

while true; do
  run_once
  log "下一轮：${INTERVAL_HOURS} 小时后"
  sleep "$((INTERVAL_HOURS * 3600))"
done
