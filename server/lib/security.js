'use strict';

const crypto = require('node:crypto');

/* ------------------------------------------------------------------ */
/* 口令哈希（scrypt，存 salt:hash）                                     */
/* ------------------------------------------------------------------ */

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* 令牌                                                                */
/* ------------------------------------------------------------------ */

/** 生成不可预测的会话令牌，只把哈希入库 */
function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** 订单号：XB + 年月日 + 4 位当日序号 */
function orderNumber(seq, date = new Date(), timezone = 'Asia/Shanghai') {
  const day = dayKey(date, timezone).replace(/-/g, '');
  return `XB${day}${String(seq).padStart(4, '0')}`;
}

/** 订单查询用的短访问令牌（用户侧凭此查单） */
function accessToken() {
  return crypto.randomBytes(9).toString('base64url');
}

/* ------------------------------------------------------------------ */
/* 限流：内存滑动窗口                                                  */
/* ------------------------------------------------------------------ */

class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    if (this.timer.unref) this.timer.unref();
  }

  /** @returns {{allowed:boolean, remaining:number, retryAfter:number}} */
  take(key, max = this.max) {
    const now = Date.now();
    let bucket = this.hits.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    return {
      allowed: bucket.count <= max,
      remaining,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.hits) {
      if (now >= bucket.resetAt) this.hits.delete(key);
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

/* ------------------------------------------------------------------ */
/* 日期工具                                                            */
/* ------------------------------------------------------------------ */

const dayFormatters = new Map();

function dayFormatter(timezone) {
  let f = dayFormatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    dayFormatters.set(timezone, f);
  }
  return f;
}

/** 本地日期键 YYYY-MM-DD */
function dayKey(date = new Date(), timezone = 'Asia/Shanghai') {
  const d = date instanceof Date ? date : new Date(date);
  const parts = dayFormatter(timezone).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 从今天往前推 n 天的日期键数组（含今天） */
function recentDays(n, timezone = 'Asia/Shanghai') {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now - i * 86400_000), timezone));
  }
  return out;
}

module.exports = {
  hashPassword,
  verifyPassword,
  newToken,
  sha256,
  orderNumber,
  accessToken,
  RateLimiter,
  dayKey,
  recentDays
};
