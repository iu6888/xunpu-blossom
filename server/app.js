'use strict';

const config = require('./config');
const log = require('./lib/logger');
const {
  Router, HttpError, fail, ok, send, parseUrl, readBody, clientIp, parseCookies, notFound
} = require('./lib/http');
const { RateLimiter } = require('./lib/security');
const { currentUser } = require('./lib/auth');
const { currentCustomer } = require('./lib/customer-auth');
const { serveSite, serveAdmin } = require('./static');

/* ------------------------------------------------------------------ */
/* 路由表                                                              */
/* ------------------------------------------------------------------ */

const router = new Router();
require('./routes/products')(router);
require('./routes/content')(router);
require('./routes/cart')(router);
require('./routes/account')(router);
require('./routes/orders')(router);
require('./routes/inquiries')(router);
require('./routes/auth')(router);
require('./routes/admin')(router);

/* ------------------------------------------------------------------ */
/* 限流                                                                */
/* ------------------------------------------------------------------ */

const globalLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max });
const writeLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.writeMax });

/* ------------------------------------------------------------------ */
/* 安全响应头                                                          */
/* ------------------------------------------------------------------ */

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

function applySecurityHeaders(res, pathname) {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);

  if (pathname.startsWith('/admin')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
  } else if (pathname.startsWith('/api')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  } else {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; " +
      "base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    );
  }
}

/* ------------------------------------------------------------------ */
/* CORS                                                                */
/* ------------------------------------------------------------------ */

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = config.corsOrigins.includes(origin) ||
    (!config.isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  if (!allowed) return;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cart-Token, Idempotency-Key, X-Order-Token');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
}

/* ------------------------------------------------------------------ */
/* 主处理                                                              */
/* ------------------------------------------------------------------ */

async function handle(req, res) {
  const started = process.hrtime.bigint();
  const url = parseUrl(req);
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();
  const ip = clientIp(req, config.trustProxy);

  const finish = (status) => {
    if (!config.logRequests) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    log.request(method, pathname, status, ms.toFixed(1), ip);
  };

  res.on('finish', () => finish(res.statusCode));

  applySecurityHeaders(res, pathname);
  applyCors(req, res);

  // 预检
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  /* ---------- 非 API：静态资源 ---------- */
  if (!pathname.startsWith('/api')) {
    if (pathname === '/admin') {
      res.writeHead(301, { Location: '/admin/' });
      res.end();
      return;
    }
    if (pathname.startsWith('/admin/')) {
      if (serveAdmin(req, res, pathname, config.adminDir)) return;
      throw notFound('页面不存在');
    }
    if (serveSite(req, res, pathname, config.siteDir, { notFoundPage: '/404.html' })) return;
    throw notFound('页面不存在');
  }

  /* ---------- API ---------- */
  const cookies = parseCookies(req);
  const sessionCtx = { headers: req.headers, cookies };
  const user = currentUser(sessionCtx);
  const customer = currentCustomer(sessionCtx);

  const isWrite = method !== 'GET' && method !== 'HEAD';
  // 已登录的管理员不受写限流约束（后台批量改库存会产生大量 PATCH）
  if (!user) {
    const bucket = `${ip}:${isWrite ? 'w' : 'r'}`;
    const limit = (isWrite ? writeLimiter : globalLimiter).take(bucket);
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new HttpError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试');
    }
  }

  const matched = router.match(method, pathname);

  if (!matched) {
    if (pathname === '/api/health') {
      return ok(res, { status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() });
    }
    throw notFound('接口不存在');
  }

  const { route, params } = matched;

  const ctx = {
    req,
    res,
    url,
    method,
    pathname,
    params,
    query: url.searchParams,
    headers: req.headers,
    cookies,
    ip,
    config,
    body: {},
    user,
    customer
  };

  if (isWrite && /application\/(json|x-www-form-urlencoded)/i.test(req.headers['content-type'] || '')) {
    ctx.body = await readBody(req, config.maxBodyBytes);
  } else if (isWrite && req.headers['content-length'] && Number(req.headers['content-length']) > 0) {
    // 没有声明 content-type 但有内容，按 JSON 尝试
    ctx.body = await readBody(req, config.maxBodyBytes);
  }

  const data = await route.handler(ctx);
  if (res.writableEnded) return; // handler 已自行写出（如 CSV）
  ok(res, data, ctx.status || route.status || 200);
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

function createServer() {
  const http = require('node:http');

  const server = http.createServer((req, res) => {
    req.on('error', (err) => {
      log.warn('请求流出错', err.message);
      if (!res.writableEnded) res.destroy();
    });

    handle(req, res).catch((err) => {
      if (err instanceof HttpError) {
        if (err.status >= 500) log.error(`${req.method} ${req.url}`, err.message);
        fail(res, err);
        return;
      }
      log.error(`${req.method} ${req.url} 未捕获异常`, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
      fail(res, new HttpError(500, 'INTERNAL_ERROR', '服务器内部错误，请稍后再试'));
    });
  });

  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 15_000;

  server.on('close', () => {
    globalLimiter.stop();
    writeLimiter.stop();
  });

  return server;
}

module.exports = { createServer, router };
