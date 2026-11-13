'use strict';

/**
 * 运行时配置。全部可通过环境变量覆盖，带安全默认值，开箱即跑。
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProd: env === 'production',
  root: ROOT,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',

  /** 站点静态文件根目录 */
  siteDir: ROOT,
  /** 管理后台目录 */
  adminDir: path.join(ROOT, 'admin'),
  /** 数据库文件 */
  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', 'xunpu.db'),

  /** 管理后台初始账号（仅首次建库时写入） */
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'xunpu2026',
  adminName: process.env.ADMIN_NAME || '品牌主理人',

  /** 会话有效期（毫秒），默认 7 天 */
  sessionTtl: int(process.env.SESSION_TTL_HOURS, 168) * 3600 * 1000,

  /** 订单规则 */
  shippingFeeCents: int(process.env.SHIPPING_FEE_FEN, 1200),
  freeShippingThresholdCents: int(process.env.FREE_SHIPPING_FEN, 29900),

  /** 限流：每个窗口内允许的请求数 */
  rateLimit: {
    windowMs: int(process.env.RATE_WINDOW_MS, 60_000),
    max: int(process.env.RATE_MAX, 120),
    writeMax: int(process.env.RATE_WRITE_MAX, 60)
  },

  /** 允许跨域的来源，逗号分隔；默认同源 + 本地调试端口 */
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** 时区，用于订单日期分组 */
  timezone: process.env.TZ_NAME || 'Asia/Shanghai',

  logRequests: bool(process.env.LOG_REQUESTS, true),
  /** 由 HTTPS 反向代理转发时信任 X-Forwarded-For */
  trustProxy: bool(process.env.TRUST_PROXY, false),

  /** 上传/请求体上限 256KB */
  maxBodyBytes: int(process.env.MAX_BODY_KB, 256) * 1024,

  brand: {
    name: '蟳埔花事',
    nameEn: 'XUNPU BLOSSOM',
    currency: 'CNY',
    currencySymbol: '¥'
  }
};

module.exports = config;
