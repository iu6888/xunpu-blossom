# 蟳埔花事 · 后端

> 一个非遗文创品牌站点的完整后端。Node.js 22 + 内置 SQLite，**零 npm 依赖**。

[![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.5-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![test](https://github.com/iu6888/xunpu-blossom/actions/workflows/test.yml/badge.svg)](https://github.com/iu6888/xunpu-blossom/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/iu6888/xunpu-blossom)](https://github.com/iu6888/xunpu-blossom/releases/latest)

泉州城市礼物「蟳埔花事」站点（6 件文创单品）的完整后端：商品目录、购物袋、订单、**顾客账号（注册 / 登录 / 我的订单）**、询价、管理后台、运营统计与数据清理。

**零外部依赖** —— 只用 Node.js 内置模块（`node:http` + `node:sqlite` + `node:crypto`），不需要 `npm install`，克隆下来就能跑。

---

## 快速开始

不想拉代码的话，直接下打包好的 zip：[最新 Release](https://github.com/iu6888/xunpu-blossom/releases/latest)（约 250 KB，解压即用）。

```bash
# 需要 Node.js ≥ 22.5（内置 node:sqlite）
node -v

npm start
# 或
node --disable-warning=ExperimentalWarning server/index.js
```

启动后：

| 入口 | 地址 |
|---|---|
| 站点（原有静态页 + 礼袋） | http://localhost:3000 |
| 管理后台 | http://localhost:3000/admin/ |
| 接口健康检查 | http://localhost:3000/api/health |

首次启动会**自动建库并写入初始数据**（6 件商品、16 个 SKU、站点文案、管理员账号），无需额外命令。

默认管理员：

```
账号：admin
密码：xunpu2026
```

> 上线前务必用环境变量改掉：`ADMIN_PASSWORD=你的强密码 npm start`（仅在首次建库时生效）。
> 已建库后改密码请登录后台 → 设置 → 修改密码。

---

## 打包给别人

分两种，取决于对方电脑上有没有 Node.js：

```bash
node deploy/pack.js              # 轻量包 约 240 KB，对方需自行安装 Node 22.5+
node deploy/pack.js --portable   # 便携包 约 33 MB，内置 Windows 版 Node，零安装
```

产物落在项目**上一级目录**：

```
蟳埔花事-交付包-20261111.zip          237 KB
蟳埔花事-交付包-便携版-20261111.zip    33 MB
```

解压后的结构（`xunpu-blossom` 用 ASCII 命名，避免解压乱码）：

```
xunpu-blossom/
├── 00-先看我.txt      ← 给不写代码的人看的说明，数字前缀保证排在最前
├── start.bat          ← 双击启动
├── index.html
├── server/ …
└── runtime/           ← 仅便携版有：node.exe + LICENSE
```

对方只需要三步：解压 → 双击 `start.bat` → 浏览器打开 `http://localhost:3000`
（后台 `/admin/`，账号 `admin` / `xunpu2026`）。

打包时**自动排除** `data/`（数据库与备份）、`.git`、`.tmp`、`node_modules`、日志，
对方拿到的是干净初始状态，首次启动自己生成数据库。

几个实现细节：

- `start.bat` 优先用 `runtime\node.exe`，找不到才用系统 Node，并校验版本 ≥ 22.5
- 会清空 `NODE_OPTIONS`，避免对方机器上某些开发工具全局注入 `--require` 导致启动失败
- 批处理是 CRLF、脚本是 LF（`.gitattributes` 强制），避免在 Windows 上编辑后 Linux 跑不起来
- 便携包附带 Node.js 的 LICENSE（MIT 协议再分发要求）
- `00-先看我.txt` 带 UTF-8 BOM，旧版记事本打开也不乱码

> 只给源码、不需要开箱即用的话，直接压缩文件夹也行，但记得先删掉 `data/`。

---

## 目录结构

```
xunpu-blossom/
├── 00-先看我.txt          # 交付包里的使用说明（非技术人员看这个）
├── start.bat              # Windows 双击启动
├── index.html / collection.html / product-*.html   # 原有静态站点
├── account.html           # 顾客账户页（登录 / 注册 / 我的订单）
├── assets/
│   ├── css/store.css      # 礼袋/结算样式（前端对接层）
│   ├── css/account.css    # 账户页样式
│   ├── js/store.js        # 礼袋/结算/顶栏账户入口（前端对接层）
│   └── js/account.js      # 账户页逻辑
├── admin/                 # 管理后台（单页，原生 JS，无构建）
│   ├── index.html
│   ├── admin.css
│   └── admin.js
├── server/
│   ├── index.js           # 启动入口、优雅退出
│   ├── app.js             # 路由分发、安全头、CORS、限流
│   ├── config.js          # 配置（全部可被环境变量覆盖）
│   ├── repo.js            # 数据访问（商品/购物袋/合计）
│   ├── static.js          # 静态资源、路径穿越防护、协商缓存
│   ├── db/
│   │   ├── schema.sql     # 表结构
│   │   ├── index.js       # sqlite 连接、事务、语句缓存
│   │   └── seed.js        # 六件商品的真实数据
│   ├── lib/
│   │   ├── http.js        # HttpError、响应信封、Router、cookie 追加
│   │   ├── customer-auth.js  # 顾客账号：注册、登录、会话（与管理员隔离）
│   │   ├── auth.js        # 会话、登录、鉴权
│   │   ├── security.js    # scrypt 口令、令牌、订单号、限流器
│   │   ├── session.js     # 购物袋 cookie 解析
│   │   ├── validate.js    # 参数校验
│   │   ├── format.js      # 金额/状态/序列化
│   │   └── logger.js
│   └── routes/            # products / cart / account / orders / inquiries / auth / content / admin
├── deploy/                # 部署与运维
│   ├── install.sh         # 服务器一键安装（Node + systemd + Nginx + 防火墙 + 备份）
│   ├── update.sh          # 更新并重启（先自动备份）
│   ├── uninstall.sh       # 卸载（默认保留 data/）
│   ├── backup.js          # SQLite 在线备份
│   └── pack.js            # 打成交付 zip（含便携版，内置 Node 运行时）
├── Dockerfile             # 生产镜像（node:22-slim，零依赖）
├── docker-compose.yml     # docker compose up -d --build
├── package.sh             # 打成服务器用 tar.gz
├── test/api.test.js       # 32 项接口回归测试
└── data/                  # 运行时生成：xunpu.db + backups/
```

---

## 管理后台

`/admin/` 是一个无构建、无框架的单页后台，配色沿用品牌（蚝壳白 `#F3EEE4` / 刺桐红 `#A8342B` / 素馨金 `#C9A24A`）。

- **概览**：今日/近 7 日/近 30 日成交、客单价、待处理订单、14 日成交柱线图、库存预警（≤5 件）、热销单品、最近订单。
- **订单**：状态筛选、订单号/姓名/手机号搜索、日期区间、详情抽屉、状态流转、内部备注、CSV 导出（带 BOM，Excel 直接打开不乱码）。
- **商品**：按 SKU 行内改价/改库存、单规格上下架、商品下架（归档，保留历史订单快照）、新增商品、编辑文案。
- **客户**：注册顾客列表、订单数与累计消费、手机号脱敏、停用/启用、无订单账号可删除。
- **询价**：合作/定制/试戴/授权四类需求，状态跟进、备注、单条删除。
- **设置**：联系信息（会自动填到站点 `***` 占位处）、首页公告、修改密码、接口速查。
- **数据清理**：输入「清空」解锁，可分别清空订单 / 询价 / 顾客 / 全部业务数据。未发货订单会先把库存还回商品。

---

## 前端如何接上后端

站点不需要改造即可用。`assets/js/store.js` 做了**渐进增强**：

1. 打开任意页面先探测 `/api/health`；
   - **不可达** → 脚本整体退出，站点保持纯静态（Netlify/Vercel 直接托管仍然正常）；
   - **可达** → 注入礼袋按钮、账户入口、商品页规格选择器、「加入礼袋 / 立即结算」、结算表单。
2. 顶栏账户入口：未登录显示「登录」，登录后显示昵称，点击进入 `account.html`。
3. 订单提交成功后展示订单号，礼袋角标清零；已登录顾客的收货人 / 手机号自动带出。
4. 首页「合作联系」区块的 `***` 占位符自动替换为后台配置的联系方式。
5. 顶部公告条读取后台「首页公告」。

`account.html` 是顾客账户页，三个状态：

- **未登录**：登录 / 注册两个页签，前端先做手机号、密码长度、纯数字、两次一致性的校验；
- **已登录 · 我的订单**：订单号、状态、金额、展开看明细，待处理/已确认可取消；
- **已登录 · 资料 / 改密**：改昵称与邮箱、改密码（其它设备下线）、退出登录。

完整链路：商品页选款式 → 加入礼袋 → 去结算 → 填收货信息（已登录自动带出）→ 提交 → 后台「订单」出现待处理 → 确认/生产/发货 → 顾客在「我的订单」看到进度。

---

## 接口一览

统一响应信封：

```jsonc
// 成功
{ "ok": true, "data": { ... } }
// 失败
{ "ok": false, "error": { "code": "CONFLICT", "message": "「花冠 · 头顶花园」库存仅剩 14 件" } }
```

### 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/meta` | 品牌、运费规则、状态字典 |
| GET | `/api/products` | 商品列表，支持 `category` `q` `sort` `page` `limit` `featured` |
| GET | `/api/products/:slug` | 商品详情（含规格与库存） |
| GET | `/api/categories` | 分类及在售数量 |
| GET | `/api/content` | 站点文案（联系方式、统计、时间线、色卡、公告） |
| GET | `/api/cart` | 当前购物袋 |
| POST | `/api/cart/items` | 加入购物袋 `{variantId\|sku\|slug, qty}` |
| PATCH | `/api/cart/items/:id` | 改数量 `{qty}`，0 表示移除 |
| DELETE | `/api/cart/items/:id` | 移除一行 |
| DELETE | `/api/cart` | 清空 |
| POST | `/api/orders` | 提交订单 |
| GET | `/api/orders/:orderNo` | 查单，需 `?phone=` 或 `?token=` |
| POST | `/api/orders/:orderNo/cancel` | 取消（仅待处理/已确认，库存回滚） |
| POST | `/api/inquiries` | 提交合作/定制/试戴/授权询价 |

### 顾客账户（Cookie `xb_user`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 `{phone, password, nickname?, email?}`，成功后自动登录 |
| POST | `/api/auth/login` | 登录 `{phone, password}` |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前顾客 + 订单数 / 消费额 |
| PATCH | `/api/auth/profile` | 改昵称 / 邮箱 |
| POST | `/api/auth/password` | 改密码 `{current, next}`，其它设备下线 |
| GET | `/api/auth/orders` | 我的订单（含明细与汇总） |

### 后台接口（需登录，Cookie `xb_admin` 或 `Authorization: Bearer <token>`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/auth/login` | 后台登录 |
| POST | `/api/admin/auth/logout` | 后台退出 |
| GET | `/api/admin/auth/me` | 后台登录态 |
| GET | `/api/admin/overview` | 概览统计（KPI、14 日序列、库存预警、热销） |
| GET | `/api/admin/orders` | 订单列表 `status` `q` `from` `to` `page` |
| GET | `/api/admin/orders/:id` | 订单详情 + 可流转状态 |
| PATCH | `/api/admin/orders/:id` | 改状态 / 内部备注 / 收货信息 |
| GET | `/api/admin/orders.csv` | 导出 CSV |
| GET | `/api/admin/products` | 全部商品（含已下架、全部规格） |
| POST | `/api/admin/products` | 新增商品（含首个规格） |
| PATCH | `/api/admin/products/:id` | 改文案 / 分类 / 主推 / 上下架 |
| DELETE | `/api/admin/products/:id` | 下架（归档，不物理删除） |
| PATCH | `/api/admin/variants/:id` | 改价格 / 库存 / 规格状态 |
| GET | `/api/admin/inquiries` | 询价列表 `status` `type` |
| PATCH | `/api/admin/inquiries/:id` | 改状态 / 备注 |
| DELETE | `/api/admin/inquiries/:id` | 删除单条询价 |
| GET | `/api/admin/customers` | 顾客列表 `q` `page`，含订单数与消费额 |
| PATCH | `/api/admin/customers/:id` | 停用 / 启用 `{status}` |
| DELETE | `/api/admin/customers/:id` | 删除顾客（有订单时返回 409） |
| DELETE | `/api/admin/orders/:id` | 删除订单（未发货会回滚库存） |
| POST | `/api/admin/data/clear` | 批量清理 `{target, confirm: "清空"}` |
| GET | `/api/admin/content` | 全部文案 |
| PUT | `/api/admin/content/:key` | 覆盖文案 `{value}` |
| POST | `/api/admin/password` | 修改密码 `{current, next}` |

### 调用示例

```bash
# 加入礼袋（用 sku 最稳）
curl -c jar.txt -X POST http://localhost:3000/api/cart/items \
  -H 'Content-Type: application/json' \
  -d '{"sku":"XB-GAR-SX","qty":2}'

# 下单
curl -b jar.txt -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "customer": {"name":"陈小姐","phone":"13800138000","address":"福建省泉州市丰泽区蟳埔社区 1 号"},
    "note": "附一张祝福卡",
    "idempotencyKey": "order-20261111-001"
  }'

# 查单
curl "http://localhost:3000/api/orders/XB202611110001?phone=13800138000"

# 后台登录并拉概览
curl -c admin.txt -X POST http://localhost:3000/api/admin/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"xunpu2026"}'
curl -b admin.txt http://localhost:3000/api/admin/overview

# 顾客注册 → 我的订单
curl -c user.txt -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800138000","password":"huashi2026","nickname":"阿簪"}'
curl -b user.txt http://localhost:3000/api/auth/orders
```

---

## 数据模型

| 表 | 用途 |
|---|---|
| `users` / `sessions` | 后台账号与会话（口令用 scrypt，令牌只存 SHA-256） |
| `customers` / `customer_sessions` | 顾客账号与会话，与后台账号完全隔离 |
| `products` | 商品主表，`categories` 支持多分类（花签同时属于器物与可佩戴） |
| `variants` | SKU：价格、库存、上下架。价格以「分」存整数 |
| `carts` / `cart_items` | 购物袋，`customer_id` 为空即游客袋，登录后自动并入账号 |
| `orders` / `order_items` | 订单与明细快照（商品改价改名不影响历史单），`customer_id` 关联顾客 |
| `inquiries` | 合作 / 批量定制 / 试戴 / 授权询价 |
| `content` | 站点文案（KV，值为 JSON） |
| `counters` | 每日订单流水号 |
| `events` | 轻量埋点（商品浏览） |
| `day` 字段 | 所有业务表按 `Asia/Shanghai` 记录日期，便于按日统计 |

### 订单状态机

```
pending 待处理 ──┬──> confirmed 已确认 ──┬──> producing 生产中 ──> shipped 已发货 ──> completed 已完成
                 │                        └──> shipped
                 └──> cancelled 已取消  ◄──┴── cancelled（confirmed/producing 也可取消）
```

- 不允许跳级（待处理 → 已发货 会返回 409 并告知可用状态）。
- 取消订单**自动回滚库存**（用户侧取消与后台取消都走同一逻辑）。
- `completed` / `cancelled` 为终态。

---

## 关键设计

- **金额**：全链路用「分」为整数，只有出参才转成 `¥` 文本，规避浮点误差。
- **库存并发**：下单用条件更新 `UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?`，在事务内校验 `changes`，避免超卖。
- **幂等**：下单支持 `idempotencyKey`（body 或 `Idempotency-Key` 头），重复提交返回同一订单，不会重复扣库存。
- **两套账号隔离**：后台 `users`/`sessions` 与顾客 `customers`/`customer_sessions` 分表、分 cookie（`xb_admin` / `xb_user`），顾客会话无法访问任何 `/api/admin/*`。
- **口令**：scrypt(N=16384) 加盐，会话令牌只存 SHA-256，改密后其它设备自动下线。
- **购物袋归并**：登录/注册时把游客袋并入账号袋，同规格数量相加并按库存封顶。
- **越权防护**：查单必须提供下单手机号、`accessToken`，或是该订单所属顾客本人；后台接口统一校验会话。
- **限流**：内存滑动窗口，读 120 次/分、写 60 次/分（可按环境变量调；已登录管理员豁免写限流）；后台登录失败 8 次 / 顾客登录失败 10 次即锁 10 分钟；询价单 IP 10 分钟 5 条。
- **删除即回收**：删订单 / 清空数据时，未发货（待处理、已确认、生产中）的订单会把库存还回 SKU；已发货与已完成不回滚，避免虚增库存。
- **静态资源安全**：`/server`、`/data`、`.git`、`package.json` 等一律 404，并做路径穿越防护。
- **响应头**：`nosniff`、`X-Frame-Options`、`Referrer-Policy`、按区域区分的 CSP。
- **SQL 注入**：全部使用预处理语句，无字符串拼接（排序字段走白名单映射）。

---

## 配置

复制 `.env.example` 为 `.env` 自行修改，或直接以环境变量传入（本服务不自动加载 `.env`，请用 `env $(cat .env | xargs) npm start` 或进程管理器注入）。

最常用的几个：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 监听端口 |
| `HOST` | 127.0.0.1 | 监听地址，对外服务改 `0.0.0.0` |
| `DB_FILE` | `data/xunpu.db` | 数据库路径 |
| `ADMIN_PASSWORD` | `xunpu2026` | 首次建库的管理员密码 |
| `SHIPPING_FEE_FEN` | 1200 | 运费（分） |
| `FREE_SHIPPING_FEN` | 29900 | 免运费门槛（分） |
| `CORS_ORIGINS` | 空 | 允许跨域的来源，逗号分隔 |
| `TRUST_PROXY` | 0 | 反代后取真实 IP |
| `LOG_REQUESTS` | 1 | 请求日志，生产可关 |

---

## 测试

```bash
npm test
```

32 项用例覆盖：商品与分类、购物袋合计与库存拦截、下单扣库存、幂等、订单查询鉴权、状态机跳级拦截、取消回滚、询价校验、CSV 导出、后台鉴权、顾客注册/登录/改密/我的订单、游客袋归并、越权隔离、后台客户管理、删除订单回滚库存、批量清理口令校验、静态资源边界。测试使用临时数据库与随机端口，不污染 `data/xunpu.db`。

---

## 部署

三种方式，按需选：

| 方式 | 适合 | 命令 |
|---|---|---|
| 一键脚本 | 全新 Ubuntu / Debian 服务器 | `sudo bash deploy/install.sh --domain=你的域名` |
| Docker | 已有 Docker 环境 | `docker compose up -d --build` |
| 手动 | 已有自己的进程管理方案 | 见下方「手动部署」 |

### 一键脚本（推荐）

先在本地打包（自动排除数据库、日志、临时文件）：

```bash
bash package.sh
```

产物是 `xunpu-blossom-YYYYMMDD-HHMM.tar.gz`（约 190 KB）和同名 `.sha256`。上传到服务器：

```bash
scp xunpu-blossom-*.tar.gz root@<公网IP>:/root/

ssh root@<公网IP>
mkdir -p /srv && tar -xzf /root/xunpu-blossom-*.tar.gz -C /srv
```

然后在服务器上执行（三条里挑一条）：

```bash
# 只有 IP，没有域名
sudo bash /srv/xunpu-blossom/deploy/install.sh

# 绑域名
sudo bash /srv/xunpu-blossom/deploy/install.sh --domain=xunpu.example.com

# 绑域名并自动申请 HTTPS（域名需已解析到本机、80 端口可访问）
sudo bash /srv/xunpu-blossom/deploy/install.sh \
  --domain=xunpu.example.com --https --email=you@example.com
```

脚本会依次完成（**可重复执行**，升级时再跑一次即可）：

1. 安装 curl / xz / nginx / cron
2. 安装 Node.js 22（优先国内镜像，失败退回 NodeSource），并校验 ≥ 22.5
3. 创建系统用户 `xunpu`
4. 复制代码到 `/srv/xunpu`
5. 生成 `/etc/xunpu/xunpu.env`（含随机管理员密码），权限 640
6. 写 systemd 单元并启动（`ProtectSystem=strict` 等安全加固，只允许写 `data/`）
7. 健康检查，最多等 30 秒，失败直接打印日志
8. 配置 Nginx 反代，静态资源 7 天缓存
9. 放行 ufw 的 22 / 80 / 443
10. 配置每天 03:20 自动备份，保留 14 份
11. 可选：Let's Encrypt 证书，续期交给 `certbot.timer`

参数：

| 参数 | 说明 |
|---|---|
| `--domain=<域名>` | Nginx server_name |
| `--https` | 申请证书，必须同时给 `--email` |
| `--email=<邮箱>` | 证书到期通知 |
| `--password=<密码>` | 指定后台密码，默认随机生成并打印 |
| `--port=<端口>` | 应用端口，默认 3000，只监听 127.0.0.1 |
| `--no-nginx` | 只装应用，不碰 Nginx |
| `--dir=<目录>` | 安装目录，默认 `/srv/xunpu` |

装完会打印访问地址和后台账号密码。**密码只在首次建库时生效**：之后改密码请登录后台「设置 → 账号」。

### 宝塔面板环境

服务器装了宝塔（`/www/server/panel`）时，`deploy/install.sh` 会**自动识别并切换分支**，不需要额外参数。

宝塔环境下有三点和普通服务器不同，脚本都已处理：

| 差异 | 处理方式 |
|---|---|
| 宝塔自带 Nginx（`/www/server/nginx`）并接管 `nginx.service` | **跳过 `apt install nginx`**，否则会覆盖 service 文件导致宝塔 Nginx 停摆 |
| 宝塔主配置只 include `/www/server/panel/vhost/nginx/*.conf` | 反向代理配置写到 `$BT_VHOST`（`/www/server/panel/vhost/nginx/xunpu.conf`），写 `/etc/nginx/sites-available` 不会被加载 |
| `certbot --nginx` 改写的是 `/etc/nginx` | 传 `--https` 时只提示，不再执行 certbot；证书请在宝塔面板「网站 → SSL」申请 |

生成的反代站点用的是 `listen 80 default_server` + `server_name _`，也就是**兜底站点** —— 用 IP 直接访问或域名没绑定站点时都会落到这个应用上。

**两个注意事项**

1. **不要在宝塔「网站」里再建一个占 80 端口的站点并设为默认**，会出现两个 `default_server` 导致 Nginx 起不来。确实要加别的站点时，把 `xunpu.conf` 里的 `default_server` 字样去掉，改成具体域名即可。
2. 宝塔默认会装 MySQL 与 PHP，本应用只用 SQLite + Node，这两项是多余的。如果不用，可以停掉释放约 300MB 内存：

   ```bash
   systemctl stop mysqld php-fpm-74 2>/dev/null || true
   systemctl disable mysqld 2>/dev/null || true
   ```

部署完验证：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<公网IP>/api/health   # 期望 200
/www/server/nginx/sbin/nginx -t                                       # 期望 syntax is ok
```

### Docker

```bash
echo 'ADMIN_PASSWORD=你的强密码' > .env
docker compose up -d --build
```

数据落在 `./data`，容器自带 healthcheck，`docker compose logs -f` 看日志。镜像基于 `node:22-bookworm-slim`，零 `npm install`。

### 日常运维

```bash
systemctl status xunpu         # 状态
systemctl restart xunpu        # 重启（改完 env 后）
journalctl -u xunpu -f         # 实时日志
bash deploy/update.sh          # 更新：先备份 → 同步代码 → 重启 → 健康检查
npm run backup                 # 手动备份一次
bash deploy/uninstall.sh       # 卸载（默认保留 data/）
```

### 手动部署

不用脚本时，核心就三件事：

```bash
NODE_ENV=production HOST=127.0.0.1 PORT=3000 TRUST_PROXY=1 \
ADMIN_PASSWORD='换成强密码' \
node --disable-warning=ExperimentalWarning server/index.js
```

再用 Nginx 反代到 `127.0.0.1:3000`（**必须加 `TRUST_PROXY=1`**，否则限流会把所有请求当成同一个 IP），systemd 或 pm2 守护。配置可直接抄 `deploy/install.sh` 生成的那份。

### 备份与恢复

`data/xunpu.db` 就是全部业务数据。`deploy/backup.js` 走 `node:sqlite` 的在线备份 API，**不停服也能安全复制**：

```bash
node deploy/backup.js                 # 默认备份到 data/backups/，保留 14 份
BACKUP_KEEP=30 node deploy/backup.js  # 自定义保留份数
```

恢复步骤：停服 → 用备份文件覆盖 `data/xunpu.db` → 删除同目录的 `xunpu.db-wal` 和 `xunpu.db-shm` → 启服。

### 上线检查清单

- [ ] 改掉默认管理员密码
- [ ] 云控制台安全组放行 22 / 80 / 443
- [ ] 大陆地域的域名已通过 ICP 备案
- [ ] `curl http://<域名>/api/health` 返回 `{"ok":true,...}`
- [ ] 后台「设置 → 数据清理」确认没有测试数据
- [ ] `data/backups/` 里已经有一份备份

---

## 接自有前端

不想用内置的 `store.js`，直接调 API 即可：

```js
// 加购
await fetch('/api/cart/items', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sku: 'XB-GAR-SX', qty: 1 })
});

// 下单
const res = await fetch('/api/orders', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: [{ sku: 'XB-GAR-SX', qty: 1 }],
    customer: { name: '陈小姐', phone: '13800138000', address: '福建省泉州市…' },
    idempotencyKey: crypto.randomUUID()
  })
});
const { data: order } = await res.json();
console.log(order.orderNo, order.totalText);
```

跨域部署时（前端在别的域名）需要设置 `CORS_ORIGINS=https://你的前端域名`，并且浏览器端带 `credentials: 'include'`；购物袋依赖 Cookie，跨站场景建议改为前端自行保存 `X-Cart-Token` 头。

---

## 已知边界

- `node:sqlite` 是 Node 的实验特性，升级 Node 大版本时请跑一遍 `npm test`。
- 支付未接入：当前订单为「线下/转账确认」模式（`payment: offline`），接微信/支付宝时在 `server/routes/orders.js` 加回调路由即可，订单表已预留 `paid_at`。
- 注册只校验格式，**没有短信验证码**，因此没有验证手机号真实归属；订单查询也只按 `customer_id` 关联，不会按手机号把历史游客订单自动并到账号上（避免被冒领）。要上短信验证需接入服务商，在 `server/routes/account.js` 的注册前加一步校验即可。
- 忘记密码目前只能由后台人工核验后重置，没有找回邮件/短信流程。
- 图片走原有 `assets/img/*.svg`；新增商品若需上传图片，可另加对象存储，`products.image` 已是可写字段。
- 单进程部署，SQLite 写入靠 WAL；日均千单以内无需换库。

---

## 开源协议

[MIT](LICENSE) © 2026 蟳埔花事 (Xunpu Blossom)

可自由使用、修改、商用、再分发，保留版权声明与许可声明即可。

## 贡献

欢迎 Issue 与 PR。提交前请跑一遍：

```bash
npm test                   # 33 项接口回归（临时库 + 随机端口，不污染 data/）
node --check server/app.js # 语法检查（或对改动的文件逐个执行）
```

代码约定：CommonJS、2 空格缩进、字符串单引号、注释用中文、金额一律以「分」为整数传输。

改动涉及数据库结构时，请在 `server/db/index.js` 的迁移列表里补一条，不要直接改 `schema.sql` 就完事 —— 已有部署不会自动获得新列。

## 设计取舍

几个刻意的选择，避免后来者误以为是遗漏：

| 选择 | 原因 |
|---|---|
| 不用 Express / Fastify | 路由、中间件、错误信封一共不到 400 行，省掉一整棵依赖树和供应链风险 |
| 不引入 ORM | 查询都在 `server/repo.js` 里，SQL 直白可读，排查慢查询不用翻 ORM 生成的语句 |
| 金额用整数分 | 规避浮点误差，出参才转成 `¥` 文本 |
| 顾客与管理员两套会话 | `customers` / `users` 分表，cookie 分别是 `xb_user` / `xb_admin`，顾客令牌碰不到任何 `/api/admin/*` |
| 前端渐进增强 | 探测不到 `/api/health` 就整体退出，站点仍可当纯静态页部署到 Netlify/Vercel |
