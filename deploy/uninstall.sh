#!/usr/bin/env bash
#
# 卸载。默认保留数据库与备份，只停服务、删配置。
#
#   sudo bash deploy/uninstall.sh            # 保留 /srv/xunpu/data
#   sudo bash deploy/uninstall.sh --purge    # 连数据一起删（不可恢复）

set -Eeuo pipefail

APP_NAME="xunpu"
APP_DIR="${APP_DIR:-/srv/xunpu}"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

[ "$(id -u)" -eq 0 ] || { echo "请用 root 运行"; exit 1; }

echo "▸ 停止并移除服务"
systemctl stop "$APP_NAME" 2>/dev/null || true
systemctl disable "$APP_NAME" 2>/dev/null || true
rm -f /etc/systemd/system/xunpu.service
systemctl daemon-reload

echo "▸ 移除 Nginx 站点"
rm -f /etc/nginx/sites-enabled/xunpu /etc/nginx/sites-available/xunpu
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
fi

echo "▸ 移除定时备份"
rm -f /etc/cron.d/xunpu-backup

if [ "$PURGE" -eq 1 ]; then
  echo "▸ 删除全部文件（含数据库与备份）"
  rm -rf "$APP_DIR" /etc/xunpu
  id xunpu >/dev/null 2>&1 && userdel -r xunpu 2>/dev/null || true
  rmdir /var/lib/xunpu 2>/dev/null || true
  echo "  ✓ 已彻底删除"
else
  echo "▸ 已保留 $APP_DIR/data（数据库与备份）"
  echo "  如需彻底删除：sudo bash $APP_DIR/deploy/uninstall.sh --purge"
fi
