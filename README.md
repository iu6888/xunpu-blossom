# 蟳埔花事 · 城市礼物

泉州蟳埔品牌站：品牌故事 + 文创商城 + 顾客账户 + 花间小游戏 + 管理后台。
零第三方依赖，只需 Node.js ≥ 22.5（内置 `node:sqlite`）或 Docker。

## 功能一览

| 模块 | 内容 |
|---|---|
| 品牌站 | 首页、品牌故事、设计手记、系列页、6 件商品详情页 |
| 商城 | 购物车、地址填写、运费规则、优惠券抵扣、下单、订单查询 |
| 顾客账户 | 手机号注册 / 登录、我的订单、我的券 |
| 花间游戏 | 9 款小游戏、花间榜（本机/全站）、通关发券 |
| 管理后台 | 商品与库存、订单、顾客、优惠券、询价、数据统计、站点文案、账号设置 |

## 本地安装

### Windows

1. 克隆或下载本仓库
2. 双击 `start.bat`
3. 打开 <http://localhost:3000>

`start.bat` 会自动选择 Node.js 或 Docker；两者都没有时会提示安装地址。

### macOS / Linux

```bash
git clone https://github.com/iu6888/xunpu-blossom.git
cd xunpu-blossom
chmod +x start.sh
./start.sh
```

### Docker

```bash
git clone https://github.com/iu6888/xunpu-blossom.git
cd xunpu-blossom
docker compose up -d --build
```

停止：`docker compose down`

### 直接用 Node.js

```bash
npm start
```

无需 `npm install`。首次启动会自动建库并写入初始数据。

## 访问地址

| 入口 | 地址 |
|---|---|
| 站点 | <http://localhost:3000> |
| 花间游戏 | <http://localhost:3000/games/> |
| 顾客账户 | <http://localhost:3000/account.html> |
| 管理后台 | <http://localhost:3000/admin/> |

默认管理员：`admin` / `xunpu2026`

> 上线前请改密码。Node 方式：`ADMIN_PASSWORD=你的密码 npm start`；Docker 方式：先在同目录建 `.env`，写入 `ADMIN_PASSWORD=你的密码`。密码仅在首次建库时生效，已建库请登录后台「设置 → 修改密码」。

## 花间游戏与通关优惠券

`/games/` 下有 9 款小游戏，其中 3 款以泉州非遗为题材：

| 序号 | 游戏 | 题材 | 玩法 |
|---|---|---|---|
| 01 | 拼图 | 簪花围 | 拖动拼块复原 |
| 02 | 翻卡片 | 花事记忆 | 配对翻牌 |
| 03 | 找不同 | 街巷细节 | 限时找差异 |
| 04 | 簪花 | 蟳埔簪花围 | 按顺序簪花 |
| 05 | 配花 | 花材配色 | 按提示配色 |
| 06 | 方巾纹样 | 纹样复原 | 复刻纹样 |
| 07 | 南音·节拍 | 泉州南音 | 按工尺谱拍板，8 拍一句、4 句一阕 |
| 08 | 花灯·点灯 | 泉州花灯 | 记忆亮灯顺序，三巡递增 |
| 09 | 德化瓷·拉坯 | 德化白瓷 | 火候滑块进绿区定坯，五器成窑 |

**奖励规则**（`server/config.js` 的 `coupon` 块，可用环境变量覆盖）：

- 通关一局 → 服务端发 1 张券：面额 ¥5，满 ¥59 可用，7 天有效
- 同一玩家同一游戏每天 1 张；同一 IP 每天最多 3 张
- 游客按昵称去重（昵称换一下可多领，靠 IP 上限兜底）；登录顾客按账号去重
- 券码格式 `XB` + 8 位大写字母/数字，例如 `XB7K2M9QD`

**使用路径**：

1. 通关弹窗显示券码 → 一键复制；也会存进浏览器 `localStorage`（最多 20 张）
2. 结算抽屉输入券码 → 「核对券码」→ 实时显示抵扣与应付
3. 下单后券核销并写入订单（`orders.coupon_code` / `orders.discount`）
4. `account.html#coupons`「我的券」可查看全部券；登录后自动按账号拉取
5. 取消订单、后台删单、清空订单时，未过期的已用券自动回退为可用

**后台**：`/admin/` → 优惠券，可按状态（可用 / 已用 / 过期 / 作废）筛选、搜索券码或领取人、查看统计、手动作废。

## 常用配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 端口 |
| `HOST` | `127.0.0.1` | 监听地址，对外服务改 `0.0.0.0` |
| `DB_FILE` | `data/xunpu.db` | 数据库文件 |
| `ADMIN_PASSWORD` | `xunpu2026` | 首次建库的管理员密码 |
| `GAME_COUPON_FEN` | `500` | 通关券面额（分） |
| `GAME_COUPON_MIN_FEN` | `5900` | 通关券使用门槛（分） |
| `GAME_COUPON_DAYS` | `7` | 通关券有效天数 |
| `GAME_COUPON_PLAYER_DAILY` | `1` | 同一玩家同一游戏每日发放上限 |
| `GAME_COUPON_IP_DAILY` | `3` | 同一 IP 每日发放上限 |

完整变量见 [`.env.example`](.env.example)。服务本身不自动读取 `.env`，Node 方式请用环境变量传入；Docker 方式由 compose 读取。

## 测试

```bash
npm test
```

覆盖商品、购物车、下单、取消、登录注册、后台增删改查、批量清理、限流、会话 Cookie、游戏发券与用券核销等 40 项用例。

## 服务器安装（Ubuntu / Debian）

```bash
sudo bash deploy/install.sh --domain=你的域名
```

脚本会安装 Node.js、配置 systemd 与 Nginx，并输出后台账号密码。参数说明见 `deploy/install.sh` 头部。

## 停止服务

- `start.bat` / `start.sh` / `npm start`：按 `Ctrl+C`
- Docker：`docker compose down`

## License

MIT
