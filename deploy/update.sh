#!/usr/bin/env bash
#
# 更新已部署的实例并重启。
#
#   sudo bash /srv/xunpu/deploy/update.sh                 # Git 仓库：git pull
#   sudo bash /srv/xunpu/deploy/update.sh /root/xunpu-new  # 从新代码目录同步
#
# 升级不会动 data/ 里的数据库与备份。

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/xunpu}"
APP_NAME="xunpu"
APP_USER="xunpu"
SRC="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "请用 root 运行"; exit 1; }
[ -d "$APP_DIR" ] || { echo "安装目录不存在：$APP_DIR"; exit 1; }

echo "▸ 更新前先备份数据库"
if [ -f "$APP_DIR/data/xunpu.db" ]; then
  (cd "$APP_DIR" && node --disable-warning=ExperimentalWarning deploy/backup.js) || echo "  备份失败，继续（数据仍在原位）"
fi

echo "▸ 同步代码"
if [ -n "$SRC" ]; then
  [ -d "$SRC" ] || { echo "源码目录不存在：$SRC"; exit 1; }
  rsync -a --exclude 'data/' --exclude '.git/' --exclude '.tmp/' --exclude 'node_modules/' \
    "$SRC/" "$APP_DIR/"
  echo "  已从 $SRC 同步"
elif [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  echo "  既没有传源码目录，也不是 git 仓库。用法：bash deploy/update.sh /path/to/new/code"
  exit 1
fi

echo "▸ 修正权限"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR/data"

echo "▸ 重启服务"
systemctl restart "$APP_NAME"

echo "▸ 健康检查"
PORT="$(grep -E '^PORT=' /etc/xunpu/xunpu.env 2>/dev/null | cut -d= -f2 || echo 3000)"
for i in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    echo "  ✓ 更新完成，服务正常"
    exit 0
  fi
  sleep 1
done

echo "  ✗ 服务未就绪，最近日志："
journalctl -u "$APP_NAME" -n 30 --no-pager
exit 1
