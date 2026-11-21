你是负责上线的运维工程师。请严格按本单执行，不改业务逻辑、不引入依赖、不动生产数据；完成后按最后一节格式回传结果。

# 蟳埔花事 · 上线部署交接单

> 交给接手的 AI / 运维：按本单执行即可上线。项目零第三方依赖，**不要执行 `npm install`**。
> 本单对应版本：2026-11-21（含 9 款花间游戏 + 通关发券 + 后台优惠券）。

---

## 0. 任务目标

把「蟳埔花事」部署到一台 Ubuntu 22.04/24.04 或 Debian 12 服务器，绑定域名并启用 HTTPS，保证：

1. 站点、账户、购物车、下单、管理后台正常；
2. `/games/` 下 9 款小游戏可玩，通关能发券；
3. 结算可用券抵扣，后台可查券、作废券；
4. 数据落在 SQLite 单文件，重启不丢，每天自动备份；
5. 上线后交付可复现的验收结果。

---

## 1. 项目事实（先读，避免误判）

| 项 | 值 |
|---|---|
| 运行时 | Node.js **≥ 22.5**（使用内置 `node:sqlite`，不能用 20/18） |
| 依赖 | **0 个**，`package.json` 的 dependencies 为空，不需要 `npm install` |
| 启动 | `node --disable-warning=ExperimentalWarning server/index.js` |
| 默认端口 | `3000` |
| 数据库 | `data/xunpu.db`（SQLite 单文件，另有 `-wal` / `-shm`） |
| 健康检查 | `GET /api/health` → `{"ok":true,...}` |
| 静态站点 | 仓库根目录 HTML + `assets/` + `games/` |
| 管理后台 | `/admin/`，默认 `admin / xunpu2026`（仅首次建库生效） |
| 测试 | `npm test`，40 项，使用临时库与随机端口，不影响生产数据 |
| 默认数据 | 首次启动自动建表并写入 6 件商品 / 16 个 SKU / 管理员账号 |

### 本次新增、必须一起上线的文件

若通过 Git 部署，请先确认以下文件**已提交**（当前工作区里它们是未跟踪文件，漏了会 404 或发券报错）：

```
games/nanyin.html
games/lantern.html
games/porcelain.html
games/zanhua.html
games/market.html
games/pattern.html
server/lib/coupons.js
server/routes/coupons.js
```

同时确认这些已修改文件在发布包里：`server/config.js`、`server/app.js`、`server/db/schema.sql`、`server/db/index.js`、`server/lib/format.js`、`server/routes/games.js`、`server/routes/orders.js`、`server/routes/account.js`、`server/routes/admin.js`、`assets/js/store.js`、`assets/js/account.js`、`admin/admin.js`、`test/api.test.js`、`README.md`、`.env.example`。

### 数据库升级

无需手工执行 SQL。服务启动时 `server/db/index.js` 的 `upgrade()` 会自动补：

- `orders.coupon_code TEXT`
- `orders.discount INTEGER NOT NULL DEFAULT 0`
- `coupons` 表及索引

旧库可直接升级，历史订单 `discount` 为 0，不影响数据。

---

## 2. 部署前检查

```bash
# 1) Node 版本，必须 >= 22.5
node -v

# 2) 确认关键文件存在
test -f server/lib/coupons.js && test -f games/nanyin.html && echo OK

# 3) 备份旧站与旧库（如服务器上已有版本）
sudo systemctl stop xunpu 2>/dev/null || true
sudo cp -a /srv/xunpu /srv/xunpu.bak.$(date +%Y%m%d-%H%M) 2>/dev/null || true
```

准备：域名 A 记录已指向服务器；80/443 端口未被占用；有 root/sudo。

---

## 3. 方案 A：一键脚本（推荐）

在项目根目录执行：

```bash
# 只绑定域名（HTTP）
sudo bash deploy/install.sh --domain=你的域名

# 绑定域名 + 自动申请 Let's Encrypt 证书
sudo bash deploy/install.sh --domain=你的域名 --https --email=你的邮箱
```

可选参数：

- `--password=自定义后台密码`：不传则随机生成 18 位
- `--port=3000`：应用端口，默认 3000，只监听 `127.0.0.1`
- `--dir=/srv/xunpu`：安装目录
- `--no-nginx`：只装 systemd，不碰 Nginx（已有反代时用）

脚本会自动完成：安装 Node 22 → 创建 `xunpu` 用户 → 同步代码 → 生成配置 → systemd 开机自启 → Nginx 反代 → 防火墙 → 健康检查 → 每日 03:20 自动备份（保留 14 份）。

安装后的位置：

| 内容 | 路径 |
|---|---|
| 应用 | `/srv/xunpu` |
| 配置 | `/etc/xunpu/xunpu.env`（权限 640） |
| 服务 | `/etc/systemd/system/xunpu.service` |
| Nginx | `/etc/nginx/sites-available/xunpu` |
| 数据库 | `/srv/xunpu/data/xunpu.db` |
| 备份 | `/srv/xunpu/data/backups/` |

常用命令：

```bash
systemctl status xunpu
systemctl restart xunpu
journalctl -u xunpu -f
curl -fsS http://127.0.0.1:3000/api/health
```

> 脚本可重复执行用于升级，但不会覆盖已有数据库和管理员密码。

### 修改游戏券参数（可选）

脚本生成的 `/etc/xunpu/xunpu.env` **不包含** `GAME_COUPON_*`，默认即：¥5 券、满 ¥59 可用、7 天有效、同人同游戏每天 1 张、同 IP 每天 3 张。

要改就追加：

```bash
sudo tee -a /etc/xunpu/xunpu.env >/dev/null <<'EOF'
GAME_COUPON_FEN=500
GAME_COUPON_MIN_FEN=5900
GAME_COUPON_DAYS=7
GAME_COUPON_PLAYER_DAILY=1
GAME_COUPON_IP_DAILY=3
EOF
sudo systemctl restart xunpu
```

单位都是「分」；`GAME_COUPON_FEN=500` 即 ¥5。

---

## 4. 方案 B：Docker

```bash
cd 项目目录
cat > .env <<'EOF'
ADMIN_PASSWORD=换成强密码
EOF

docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

说明：

- 数据持久化在 `./data`，映射到容器 `/app/data`；
- 容器内 `HOST=0.0.0.0`、`TRUST_PROXY=1`；
- 升级：替换代码后 `docker compose up -d --build`；
- **注意**：`docker-compose.yml` 的 `environment:` 没有透传 `GAME_COUPON_*`。要改券参数，必须在 `environment:` 里补上，或加 `env_file: .env`，只写宿主 `.env` 不会进容器。

---

## 5. 环境变量（systemd 用）

| 变量 | 默认 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | 生产改 `production` |
| `HOST` | `127.0.0.1` | Nginx 反代时保持本机；直接对外才改 `0.0.0.0` |
| `PORT` | `3000` | 应用端口 |
| `DB_FILE` | `data/xunpu.db` | SQLite 路径 |
| `ADMIN_USER` | `admin` | 管理员账号 |
| `ADMIN_PASSWORD` | `xunpu2026` | **仅首次建库生效**，已有库改这里无效 |
| `SESSION_TTL_HOURS` | `168` | 会话有效期 |
| `TRUST_PROXY` | `0` | 反代后必须 `1`，否则 IP/限流失真、HTTPS Cookie 判错 |
| `CORS_ORIGINS` | 空 | 同源部署留空；前后端分域才填，逗号分隔 |
| `GAME_COUPON_FEN` | `500` | 券面额（分） |
| `GAME_COUPON_MIN_FEN` | `5900` | 使用门槛（分） |
| `GAME_COUPON_DAYS` | `7` | 有效天数 |
| `GAME_COUPON_PLAYER_DAILY` | `1` | 同玩家同游戏每日上限 |
| `GAME_COUPON_IP_DAILY` | `3` | 同 IP 每日上限 |

> 服务**不会自动读取 `.env` 文件**（Docker 除外）。systemd 通过 `EnvironmentFile` 注入；手工跑必须自己 `export`。

---

## 6. 上线验收（逐条执行并回传输出）

### 6.1 生产只做只读检查

```bash
BASE=http://127.0.0.1:3000

curl -fsS $BASE/api/health
curl -fsS $BASE/api/games/overview | grep -o '"game":"' | wc -l   # 期望 9
curl -fsS -o /dev/null -w '%{http_code}\n' $BASE/                  # 200
curl -fsS -o /dev/null -w '%{http_code}\n' $BASE/games/            # 200
curl -fsS -o /dev/null -w '%{http_code}\n' $BASE/games/nanyin.html # 200
curl -fsS -o /dev/null -w '%{http_code}\n' $BASE/account.html      # 200
curl -fsS -o /dev/null -w '%{http_code}\n' $BASE/admin/            # 200
```

浏览器人工确认：

1. 首页 9 张游戏卡片都在，点进 07/08/09 能玩；
2. 手机宽度 390px 下，榜单 9 个 tab 每行 3 个，不溢出；
3. 后台「优惠券」菜单存在，列表能打开。

### 6.2 发券链路（在临时实例做，别污染生产库）

```bash
cd /srv/xunpu
DB_FILE=/tmp/xunpu-verify.db PORT=3101 HOST=127.0.0.1 LOG_REQUESTS=0 \
  node --disable-warning=ExperimentalWarning server/index.js &
VERIFY_PID=$!
sleep 2
V=http://127.0.0.1:3101

NAME="验收$(date +%s)"
CODE=$(curl -s -X POST $V/api/games/scores \
  -H 'Content-Type: application/json' \
  -d "{\"game\":\"nanyin\",\"name\":\"$NAME\",\"seconds\":60,\"moves\":2}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!j.data||!j.data.coupon)process.exit(2);console.log(j.data.coupon.code)})")

echo "券码: $CODE"

curl -s -X POST $V/api/coupons/check \
  -H 'Content-Type: application/json' \
  -d "{\"couponCode\":\"$CODE\",\"itemsTotalCents\":5900}"

curl -s "$V/api/coupons?codes=$CODE"

kill $VERIFY_PID
rm -f /tmp/xunpu-verify.db /tmp/xunpu-verify.db-wal /tmp/xunpu-verify.db-shm
```

期望：

- 券码匹配 `^XB[A-Z2-9]{8}$`；
- `check` 返回 `discountCents: 500`、`totalAfterCents: 5400`、`thresholdHit: true`；
- `GET /api/coupons?codes=...` 返回 1 张 `active` 券，`signedIn: false`。

再在临时实例浏览器里走一遍：登录/注册 → 玩一局 → 胜利弹窗出券码 → 购物车结算输入券码 → 显示 `优惠券 -¥5` → 下单成功。

### 6.3 回归测试

```bash
cd /srv/xunpu
npm test
```

期望：`# pass 40`、`# fail 0`。该命令使用临时数据库，不会动 `data/xunpu.db`。

---

## 7. 数据库、备份与回滚

- 自动备份：每天 03:20 执行 `node deploy/backup.js`，写入 `data/backups/`，保留 14 份；
- 手动备份：`sudo -u xunpu bash -lc 'cd /srv/xunpu && node deploy/backup.js'`；
- 备份是在线备份（SQLite `backup()`），不必停服；
- 升级脚本 `deploy/update.sh` 会先备份再同步代码。

回滚：

```bash
sudo systemctl stop xunpu
# 1) 回滚代码：恢复上一版目录或 git checkout 上一个提交
# 2) 回滚数据：用备份覆盖数据库（先删 -wal/-shm）
sudo -u xunpu cp /srv/xunpu/data/backups/xunpu-YYYYMMDD-HHMMSS.db /srv/xunpu/data/xunpu.db
sudo rm -f /srv/xunpu/data/xunpu.db-wal /srv/xunpu/data/xunpu.db-shm
sudo chown xunpu:xunpu /srv/xunpu/data/xunpu.db
sudo systemctl start xunpu
curl -fsS http://127.0.0.1:3000/api/health
```

> 数据库回滚会丢失备份时间点之后的数据，执行前再备份一次当前库。

---

## 8. 已知坑（按此排查）

1. **Node 版本过低**：`node:sqlite` 不存在，启动即报错。必须 ≥ 22.5。
2. **漏提交新文件**：`games/nanyin.html`、`server/routes/coupons.js` 等未进 Git，线上会 404 或 `/api/coupons` 404。
3. **管理员密码改了不生效**：`ADMIN_PASSWORD` 只在空库首次初始化时使用；已有库请登录后台「设置 → 修改密码」，或删除库重新初始化（会丢数据）。
4. **反代后所有人同一 IP**：忘记 `TRUST_PROXY=1`，会导致限流误伤、券的 IP 日限把所有人算在一起、HTTPS 下 Cookie 不带 `Secure`。
5. **浏览器看到旧样式/旧脚本**：静态资源有 7 天缓存。改完 CSS/JS 必须升 `?v=` 版本号；后台 `/admin/` 已是 `no-store`。
6. **Docker 改券参数无效**：见方案 B 的说明，需在 compose 的 `environment` / `env_file` 里透传。
7. **SQLite 权限**：`data/` 必须归运行用户可写（`xunpu`，750），否则建库失败。
8. **不要用 `HOST=0.0.0.0` 直连公网又开 Nginx**：应用应只监听 `127.0.0.1`，由 Nginx 对外。
9. **券的游客去重漏洞**：游客按昵称去重，换昵称可再领，靠「同 IP 每天 3 张」兜底。若要发放更大面额，建议改成仅登录用户可领。
10. **时区**：券的「每天」按 `Asia/Shanghai` 计算（`TZ`/`TZ_NAME`），服务器时区不对会导致跨日时间偏移。

---

## 9. 不要做

- 不要 `npm install` / 引入新依赖；
- 不要手工改表结构或删 `coupons` 表；
- 不要删除 `data/xunpu.db` 或 `data/backups/`；
- 不要把 `.env`、管理员密码、数据库提交进 Git；
- 不要在生产库跑发券验收脚本（用第 6.2 的临时实例）；
- 不要把 `ADMIN_PASSWORD` 明文发到公开群聊/仓库。

---

## 10. 交付回执（请按此格式回复）

```
1. 公网地址：
2. 部署方式：systemd 脚本 / Docker / 其他
3. Node 版本：
4. systemctl status xunpu（或 docker compose ps）结果：
5. /api/health 输出：
6. /api/games/overview 游戏数量：9
7. npm test：pass __ / fail __
8. 发券验收：券码 ____，discountCents ____，totalAfterCents ____
9. HTTPS：已启用 / 未启用（原因）
10. 后台账号密码获取方式（不要贴明文）：
11. 数据库路径与备份路径：
12. 未完成项 / 风险：
```
