#!/usr/bin/env sh
# 蟳埔花事 · 本地一键启动（macOS / Linux）
# 有 Node.js 22.5+ 就直接跑，没有就用 Docker。
set -eu

cd "$(dirname "$0")"
PORT="${PORT:-3000}"
export PORT

say_hello() {
  printf '\n  蟳埔花事 · Xunpu Blossom\n  ---------------------------------------------\n\n'
}

open_browser_later() {
  (
    i=0
    while [ "$i" -lt 90 ]; do
      if command -v curl >/dev/null 2>&1 && curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
        if command -v open >/dev/null 2>&1; then
          open "http://localhost:$PORT"
        elif command -v xdg-open >/dev/null 2>&1; then
          xdg-open "http://localhost:$PORT" >/dev/null 2>&1
        fi
        break
      fi
      i=$((i + 1))
      sleep 2
    done
  ) >/dev/null 2>&1 &
}

say_hello

if command -v node >/dev/null 2>&1 && node -e 'const p=process.versions.node.split(".").map(Number);process.exit(p[0]>22||(p[0]===22&&p[1]>=5)?0:1)' >/dev/null 2>&1; then
  export NODE_ENV=production HOST=127.0.0.1
  printf '  启动方式 : 本机 Node.js (%s)\n' "$(node -v)"
  printf '  网站     : http://localhost:%s\n' "$PORT"
  printf '  管理后台 : http://localhost:%s/admin/\n' "$PORT"
  printf '  默认账号 : admin / xunpu2026\n\n'
  open_browser_later
  exec node --disable-warning=ExperimentalWarning server/index.js
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    printf '  [x] Docker 没有运行，或当前用户没有权限。\n'
    printf '      Linux 可执行 sudo systemctl start docker，并把用户加入 docker 组后重试。\n\n'
    exit 1
  fi
  printf '  启动方式 : Docker\n'
  printf '  网站     : http://localhost:%s\n' "$PORT"
  printf '  管理后台 : http://localhost:%s/admin/\n' "$PORT"
  printf '  默认账号 : admin / xunpu2026\n\n'
  printf '  首次运行需要构建镜像，可能几分钟；按 Ctrl+C 停止。\n\n'
  open_browser_later
  exec docker compose up --build
fi

cat <<'EOF'
  [x] 没找到可用的 Node.js（22.5+）或 Docker

      二选一：
      1. 安装 Node.js LTS（22.5 以上）：https://nodejs.org
      2. 安装 Docker Desktop：https://www.docker.com/products/docker-desktop/

      装好后再执行 ./start.sh
EOF
exit 1
