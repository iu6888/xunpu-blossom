#!/usr/bin/env bash
#
# 打包成可上传服务器的压缩包（不含数据库、日志、临时文件）。
#
#   bash package.sh                    # 输出到上级目录
#   bash package.sh /tmp/xunpu.tar.gz  # 指定路径
#
# 产物：xunpu-blossom-YYYYMMDD-HHMM.tar.gz + .sha256

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$(basename "$ROOT")"
PARENT="$(dirname "$ROOT")"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="${1:-$PARENT/${BASE}-${STAMP}.tar.gz}"

mkdir -p "$(dirname "$OUT")"

echo "▸ 打包 $BASE → $OUT"
tar -czf "$OUT" -C "$PARENT" \
  --exclude="$BASE/data" \
  --exclude="$BASE/.git" \
  --exclude="$BASE/.tmp" \
  --exclude="$BASE/node_modules" \
  --exclude="$BASE/.env" \
  --exclude="*.log" \
  "$BASE"

SIZE="$(du -h "$OUT" | cut -f1)"
SUM="$(cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" | cut -d' ' -f1)"
echo "$SUM  $(basename "$OUT")" > "$OUT.sha256"

echo "  ✓ 完成：$OUT（$SIZE）"
echo "  ✓ 校验：$OUT.sha256"
echo
echo "  包内文件数：$(tar -tzf "$OUT" | grep -vc '/$')"
echo
echo "部署到服务器（三条命令）："
echo "  scp $(basename "$OUT") root@<公网IP>:/root/"
echo "  ssh root@<公网IP> \"mkdir -p /srv && tar -xzf /root/$(basename "$OUT") -C /srv\""
echo "  ssh root@<公网IP> \"bash /srv/$BASE/deploy/install.sh --domain=你的域名\""
echo
echo "  没有域名就用：bash /srv/$BASE/deploy/install.sh"
echo "  （脚本会把代码复制到 /srv/xunpu 并配好 systemd、Nginx、防火墙、每日备份）"
