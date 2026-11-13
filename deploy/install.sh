#!/usr/bin/env bash
#
# 蟳埔花事 · 一键部署（Ubuntu 22.04 / 24.04、Debian 12）
#
#   sudo bash deploy/install.sh                              # 最快：80 端口 IP 访问
#   sudo bash deploy/install.sh --domain=xunpu.example.com    # 绑定域名
#   sudo bash deploy/install.sh --domain=xunpu.example.com --https --email=me@example.com
#
# 可选参数：
#   --domain=<域名>      配置 Nginx server_name
#   --https              自动申请 Let's Encrypt 证书（需先解析好域名）
#   --email=<邮箱>       证书到期通知邮箱（--https 时必填）
#   --password=<密码>    指定后台管理员密码（默认随机生成）
#   --port=<端口>        应用监听端口（默认 3000，只监听 127.0.0.1）
#   --no-nginx           只装应用与 systemd，不碰 Nginx
#   --dir=<目录>         安装目录（默认 /srv/xunpu）
#
# 脚本可重复执行：升级时再跑一次即可（不会覆盖已有数据库与管理员密码）。

set -Eeuo pipefail

APP_NAME="xunpu"
APP_USER="xunpu"
APP_DIR="/srv/xunpu"
ENV_DIR="/etc/xunpu"
ENV_FILE="$ENV_DIR/xunpu.env"
SERVICE="/etc/systemd/system/xunpu.service"
NGINX_SITE="/etc/nginx/sites-available/xunpu"
PORT="3000"
DOMAIN=""
EMAIL=""
ADMIN_PASSWORD=""
WITH_NGINX=1
WITH_HTTPS=0

# 宝塔面板自带一套 Nginx（/www/server/nginx），安装时会接管 /etc/systemd/system/nginx.service。
# 在宝塔环境里必须区别对待，否则：
#   1) apt install nginx 会覆盖 nginx.service，宝塔 Nginx 直接停摆
#   2) 写 /etc/nginx/sites-available 不会被加载（宝塔的主配置不含这个 include）
BT_NGINX_BIN="/www/server/nginx/sbin/nginx"
BT_VHOST_DIR="/www/server/panel/vhost/nginx"
BT_VHOST="$BT_VHOST_DIR/xunpu.conf"
IS_BT=0
if [ -x "$BT_NGINX_BIN" ] && [ -d "$BT_VHOST_DIR" ]; then IS_BT=1; fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------- 输出 ----------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_B=''; C_0=''
fi
step()  { printf '%s▸%s %s\n' "$C_B" "$C_0" "$*"; }
ok()    { printf '  %s✓%s %s\n' "$C_OK" "$C_0" "$*"; }
warn()  { printf '  %s!%s %s\n' "$C_WARN" "$C_0" "$*"; }
die()   { printf '  %s✗%s %s\n' "$C_ERR" "$C_0" "$*" >&2; exit 1; }

trap 'die "第 $LINENO 行执行失败，已中止"' ERR

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

# ---------- 参数 ----------
for arg in "$@"; do
  case "$arg" in
    --domain=*)   DOMAIN="${arg#*=}" ;;
    --email=*)    EMAIL="${arg#*=}" ;;
    --password=*) ADMIN_PASSWORD="${arg#*=}" ;;
    --port=*)     PORT="${arg#*=}" ;;
    --dir=*)      APP_DIR="${arg#*=}" ;;
    --https)      WITH_HTTPS=1 ;;
    --no-nginx)   WITH_NGINX=0 ;;
    -h|--help)    usage ;;
    *)            warn "忽略未知参数：$arg" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash deploy/install.sh"
[ -f "$SOURCE_DIR/server/index.js" ] || die "找不到源码（$SOURCE_DIR/server/index.js），请在项目根目录执行"

# 安装目录安全校验：脚本会清理该目录内容，绝不能指向系统目录
case "$APP_DIR" in
  ""|"/"|"/usr"|"/usr/local"|"/etc"|"/var"|"/srv"|"/home"|"/root"|"/opt"|"/tmp")
    die "拒绝安装到 $APP_DIR，请用 --dir=/srv/xunpu 这类具体目录" ;;
esac
case "$APP_DIR" in
  /*) ;;
  *) die "--dir 必须是绝对路径（当前：$APP_DIR）" ;;
esac

. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ok "系统：${PRETTY_NAME}" ;;
  *) warn "未在 Ubuntu/Debian 上测试过（当前 ${PRETTY_NAME:-unknown}），将继续尝试" ;;
esac

if [ "$WITH_HTTPS" -eq 1 ] && [ -z "$DOMAIN" ]; then
  die "--https 需要同时指定 --domain"
fi
if [ "$WITH_HTTPS" -eq 1 ] && [ -z "$EMAIL" ]; then
  die "--https 需要同时指定 --email（证书到期通知）"
fi

export DEBIAN_FRONTEND=noninteractive
APT="apt-get -qq -y -o Dpkg::Options::=--force-confold"

# ---------- 1. 系统依赖 ----------
step "安装系统依赖"
$APT update >/dev/null
$APT install -y curl ca-certificates xz-utils tar rsync >/dev/null
if [ "$WITH_NGINX" -eq 1 ]; then
  if [ "$IS_BT" -eq 1 ]; then
    ok "检测到宝塔面板，沿用其自带 Nginx（不安装 apt 版，避免覆盖 nginx.service）"
  else
    $APT install -y nginx >/dev/null
  fi
fi
ok "基础工具就绪"

# ---------- 2. Node.js ----------
step "准备 Node.js 22（需要 ≥ 22.5，内置 node:sqlite）"
need_node=1
if command -v node >/dev/null 2>&1; then
  NV="$(node -v | sed 's/^v//')"
  MAJ="${NV%%.*}"; REST="${NV#*.}"; MIN="${REST%%.*}"
  if [ "$MAJ" -gt 22 ] || { [ "$MAJ" -eq 22 ] && [ "$MIN" -ge 5 ]; }; then
    need_node=0
    ok "已安装 Node v$NV"
  else
    warn "现有 Node v$NV 版本过低，将安装 22.x"
  fi
fi

if [ "$need_node" -eq 1 ]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)        NARCH="linux-x64" ;;
    aarch64|arm64) NARCH="linux-arm64" ;;
    *)             die "不支持的架构：$ARCH" ;;
  esac

  # 优先用国内镜像（阿里云 ECS 上速度快），失败再退回官方源
  MIRROR="https://registry.npmmirror.com/-/binary/node/latest-v22.x"
  FILE=""
  if curl -fsSL --max-time 20 "$MIRROR/SHASUMS256.txt" -o /tmp/node-shasums.txt 2>/dev/null; then
    FILE="$(awk '{print $2}' /tmp/node-shasums.txt | grep -E "node-v22\..*-${NARCH}\.tar\.xz$" | head -1 || true)"
  fi

  if [ -n "$FILE" ]; then
    ok "从镜像下载 $FILE"
    curl -fL --retry 3 --max-time 180 "$MIRROR/$FILE" -o "/tmp/$FILE" || FILE=""
  fi

  if [ -n "$FILE" ] && [ -s "/tmp/$FILE" ]; then
    tar -xJf "/tmp/$FILE" -C /usr/local --strip-components=1
    rm -f "/tmp/$FILE"
    hash -r
    ok "Node $(node -v) 已安装到 /usr/local"
  else
    warn "镜像不可用，改用 NodeSource 官方源"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    $APT install -y nodejs >/dev/null
    hash -r
    ok "Node $(node -v) 已安装"
  fi
fi

NODE_BIN="$(command -v node)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' \
  || die "Node 版本仍不满足 ≥ 22.5"
ok "校验通过：$($NODE_BIN -v) · node:sqlite 可用"

# ---------- 3. 运行用户 ----------
step "创建运行用户"
if id "$APP_USER" >/dev/null 2>&1; then
  ok "用户 $APP_USER 已存在"
else
  useradd --system --user-group --create-home --shell /usr/sbin/nologin "$APP_USER"
  ok "已创建系统用户 $APP_USER"
fi

# ---------- 4. 部署代码 ----------
step "部署代码到 $APP_DIR"
mkdir -p "$APP_DIR"
if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude 'data/' --exclude '.git/' --exclude '.tmp/' --exclude 'node_modules/' \
      --exclude '*.log' "$SOURCE_DIR/" "$APP_DIR/"
  else
    # 没有 rsync 时退回 cp，注意保留已有 data 目录
    find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
    tar -cf - -C "$SOURCE_DIR" \
      --exclude=./data --exclude=./.git --exclude=./.tmp --exclude=./node_modules --exclude='*.log' . \
      | tar -xf - -C "$APP_DIR"
  fi
fi
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR/data"
ok "代码就绪（$(du -sh "$APP_DIR" | cut -f1)）"

# ---------- 5. 环境变量 ----------
step "写入环境变量 $ENV_FILE"
mkdir -p "$ENV_DIR"
chmod 750 "$ENV_DIR"

if [ -f "$ENV_FILE" ]; then
  ok "已存在，保留原有配置"
  # 沿用已有端口，避免重复执行时健康检查打到错误端口
  EXISTING_PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d ' ' || true)"
  [ -n "$EXISTING_PORT" ] && PORT="$EXISTING_PORT"
  EXISTING_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
else
  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-18)"
  fi
  case "$ADMIN_PASSWORD" in
    *[[:space:]]*) die "管理员密码不能包含空格或制表符" ;;
  esac
  cat > "$ENV_FILE" <<EOF
# 蟳埔花事后端配置 · 修改后执行：systemctl restart xunpu
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT

# 后台管理员（仅在首次建库时生效）
ADMIN_USER=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_NAME=品牌主理人

# 反向代理后取真实 IP
TRUST_PROXY=1
LOG_REQUESTS=1

# 订单规则：运费 12 元，满 299 免运费（单位：分）
SHIPPING_FEE_FEN=1200
FREE_SHIPPING_FEN=29900
EOF
  chmod 640 "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"
  EXISTING_PASSWORD="$ADMIN_PASSWORD"
  ok "已生成配置"
fi

# 已存在的数据库不会被重新初始化，此时密码以库中为准
DB_EXISTED=0
[ -f "$APP_DIR/data/xunpu.db" ] && DB_EXISTED=1

# ---------- 6. systemd ----------
step "配置 systemd 服务"
cat > "$SERVICE" <<EOF
[Unit]
Description=Xunpu Blossom Backend (蟳埔花事)
Documentation=file://$APP_DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=15

# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data
RestrictSUIDSGID=true
RemoveIPC=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$APP_NAME" >/dev/null 2>&1 || true
# 启动失败时不立即中止，交给下一步健康检查输出日志，便于定位
systemctl restart "$APP_NAME" || true
ok "服务已启动并设为开机自启"

# ---------- 7. 健康检查 ----------
step "等待服务就绪"
ready=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || {
  echo
  journalctl -u "$APP_NAME" -n 30 --no-pager || true
  die "服务未能在 30 秒内就绪，日志见上方"
}
ok "健康检查通过"

# ---------- 8. Nginx ----------
if [ "$WITH_NGINX" -eq 1 ]; then
  step "配置 Nginx 反向代理"
  SERVER_NAME="${DOMAIN:-_}"

  if [ "$IS_BT" -eq 1 ]; then
    # ===== 宝塔环境：写它的 vhost 目录，用 default_server 兜底反代 =====
    # 宝塔主配置 include /www/server/panel/vhost/nginx/*.conf，写这里才会被加载；
    # 全局 gzip 宝塔已开启，此处不再重复配置。
    cat > "$BT_VHOST" <<EOF
# 蟳埔花事 · 由 deploy/install.sh 生成（宝塔环境）
server
{
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 4m;

    access_log /www/wwwlogs/xunpu.log;
    error_log  /www/wwwlogs/xunpu.error.log;

    # 后台页面与脚本一律不缓存，避免浏览器拿到旧代码
    location ^~ /admin/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store, must-revalidate" always;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ /\.(?!well-known) {
        deny all;
    }
}
EOF
    "$BT_NGINX_BIN" -t >/dev/null 2>&1 || die "宝塔 Nginx 配置校验失败，请执行 $BT_NGINX_BIN -t 查看"
    systemctl reload nginx >/dev/null 2>&1 || "$BT_NGINX_BIN" -s reload
    ok "已写入宝塔 Nginx（$BT_VHOST）"
  else
  cat > "$NGINX_SITE" <<EOF
# 蟳埔花事 · 由 deploy/install.sh 生成
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;

    # 上传/表单体积上限
    client_max_body_size 4m;

    # 文本资源压缩：Nginx 默认只压 html，这里补上 css/js/json/svg
    # 按流量计费时这能省掉六七成的文本字节
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 512;
    gzip_proxied any;
    gzip_vary on;
    gzip_types
        text/plain
        text/css
        text/xml
        application/javascript
        application/json
        application/xml
        image/svg+xml;

    # /api 与 /admin 用 ^~ 前缀匹配，避免被下面的静态资源正则抢走
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }

    # 后台页面与脚本一律不缓存：后台改版后浏览器必须立刻拿到新代码，
    # 否则会出现「服务端已修复、用户仍看到旧界面」的诡异问题
    location ^~ /admin/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store, must-revalidate" always;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # 前台静态资源长缓存（/admin 已在上面 ^~ 拦掉，不会命中这里）
    location ~* \.(css|js|svg|png|jpg|jpeg|webp|woff2?)\$ {
        proxy_pass http://127.0.0.1:$PORT;
        # 丢掉上游的 Cache-Control，统一由下面的 expires 生成，避免响应里出现两条
        proxy_hide_header Cache-Control;
        proxy_set_header Host \$host;
        expires 7d;
    }

    access_log /var/log/nginx/xunpu.access.log;
    error_log  /var/log/nginx/xunpu.error.log;
}
EOF

  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/xunpu
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null 2>&1 || die "Nginx 配置校验失败：nginx -t"
  systemctl reload nginx
  ok "Nginx 已生效（server_name: $SERVER_NAME）"
  fi
fi

# ---------- 9. 防火墙 ----------
step "配置防火墙"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 22/tcp   >/dev/null 2>&1 || true
  ufw allow 80/tcp   >/dev/null 2>&1 || true
  ufw allow 443/tcp  >/dev/null 2>&1 || true
  ok "ufw 已放行 22 / 80 / 443"
else
  warn "ufw 未启用，请确认云控制台安全组已放行 22 / 80 / 443"
fi

# ---------- 10. 每日备份 ----------
step "配置每日自动备份"
$APT install -y cron >/dev/null 2>&1 || true
mkdir -p "$APP_DIR/data/backups"
# cron 以 xunpu 身份写日志，日志文件必须先建好并授权
touch /var/log/xunpu-backup.log
chown "$APP_USER":"$APP_USER" /var/log/xunpu-backup.log
cat > /etc/cron.d/xunpu-backup <<EOF
# 每天 03:20 备份 SQLite，保留最近 14 份
20 3 * * * $APP_USER cd $APP_DIR && $NODE_BIN --disable-warning=ExperimentalWarning deploy/backup.js >> /var/log/xunpu-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/xunpu-backup
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"
ok "已配置（每天 03:20，保留 14 份，位于 $APP_DIR/data/backups）"

# ---------- 11. HTTPS ----------
if [ "$WITH_HTTPS" -eq 1 ]; then
  step "申请 Let's Encrypt 证书"
  if [ "$IS_BT" -eq 1 ]; then
    # certbot --nginx 改写的是 /etc/nginx，宝塔不读这个目录，改了也不生效
    warn "检测到宝塔面板，跳过 certbot：请在宝塔面板「网站 → SSL」里一键申请证书"
    warn "申请后把该站点的 SSL 打开，宝塔会自动把 80 跳转到 443"
  else
    $APT install -y certbot python3-certbot-nginx >/dev/null
    certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect --non-interactive \
      && ok "HTTPS 已启用，续期由 certbot.timer 自动完成" \
      || warn "证书申请失败（确认域名已解析到本机且 80 端口可访问），可稍后重试"
  fi
fi

# ---------- 完成 ----------
PUBLIC_IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || echo '<你的公网IP>')"
if [ -n "$DOMAIN" ]; then
  BASE="http://$DOMAIN"; [ "$WITH_HTTPS" -eq 1 ] && BASE="https://$DOMAIN"
else
  BASE="http://$PUBLIC_IP"
fi

printf '\n%s╭──────────────────────────────────────────────────────────╮%s\n' "$C_OK" "$C_0"
printf '%s│%s  %s部署完成%s                                              %s│%s\n' "$C_OK" "$C_0" "$C_B" "$C_0" "$C_OK" "$C_0"
printf '%s╰──────────────────────────────────────────────────────────╯%s\n\n' "$C_OK" "$C_0"

printf '  站点      %s\n' "$BASE"
printf '  管理后台  %s/admin/\n' "$BASE"
printf '  健康检查  %s/api/health\n\n' "$BASE"
printf '  安装目录  %s\n' "$APP_DIR"
printf '  配置文件  %s\n' "$ENV_FILE"
printf '  数据库    %s/data/xunpu.db\n\n' "$APP_DIR"

if [ "$DB_EXISTED" -eq 1 ]; then
  printf '  %s数据库已存在，管理员密码沿用原有（%s 中的 ADMIN_PASSWORD）%s\n\n' "$C_WARN" "$ENV_FILE" "$C_0"
elif [ -n "${EXISTING_PASSWORD:-}" ]; then
  printf '  %s后台账号：admin%s\n' "$C_B" "$C_0"
  printf '  %s后台密码：%s%s\n\n' "$C_B" "$EXISTING_PASSWORD" "$C_0"
fi

cat <<EOF
  ${C_DIM}常用命令${C_0}
    systemctl status xunpu        查看状态
    systemctl restart xunpu       重启（改完配置后）
    journalctl -u xunpu -f        实时日志
    bash deploy/update.sh         拉取新版本并重启
    node deploy/backup.js         手动备份一次

  ${C_DIM}下一步${C_0}
    1. 登录 ${BASE}/admin/ ，在「设置 → 数据清理」里确认数据是干净的
    2. 改掉默认管理员密码（设置 → 账号）
    3. 域名访问需先完成 ICP 备案（大陆地域）
    4. 在云控制台安全组放行 22 / 80 / 443
EOF

if [ "$IS_BT" -eq 1 ]; then
cat <<EOF

  ${C_WARN}宝塔面板环境${C_0}
    反代配置  $BT_VHOST
    重载命令  systemctl reload nginx
    注意事项  不要在面板里再建占 80 端口的默认站点，会出现两个 default_server
             MySQL / PHP 与本应用无关，不用可停掉省约 300MB 内存
EOF
fi
