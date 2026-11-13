# 蟳埔花事 · 城市礼物

安装与启动说明。需要 Node.js ≥ 22.5 或 Docker，二选一。

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
| 管理后台 | <http://localhost:3000/admin/> |

默认管理员：`admin` / `xunpu2026`

> 上线前请改密码。Node 方式：`ADMIN_PASSWORD=你的密码 npm start`；Docker 方式：先在同目录建 `.env`，写入 `ADMIN_PASSWORD=你的密码`。密码仅在首次建库时生效，已建库请登录后台「设置 → 修改密码」。

## 常用配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 端口 |
| `HOST` | `127.0.0.1` | 监听地址，对外服务改 `0.0.0.0` |
| `DB_FILE` | `data/xunpu.db` | 数据库文件 |
| `ADMIN_PASSWORD` | `xunpu2026` | 首次建库的管理员密码 |

完整变量见 [`.env.example`](.env.example)。服务本身不自动读取 `.env`，Node 方式请用环境变量传入；Docker 方式由 compose 读取。

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
