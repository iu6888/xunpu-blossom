'use strict';

const { URL } = require('node:url');

/* ------------------------------------------------------------------ */
/* 错误                                                                */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message = '请先登录') => new HttpError(401, 'UNAUTHORIZED', message);
const forbidden = (message = '无权访问') => new HttpError(403, 'FORBIDDEN', message);
const notFound = (message = '资源不存在') => new HttpError(404, 'NOT_FOUND', message);
const conflict = (message, details) => new HttpError(409, 'CONFLICT', message, details);
const tooMany = (message = '操作过于频繁，请稍后再试') => new HttpError(429, 'RATE_LIMITED', message);

/* ------------------------------------------------------------------ */
/* 响应                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8'
};

function mimeFor(filePath) {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME[filePath.slice(dot).toLowerCase()] || 'application/octet-stream';
}

function send(res, status, headers, body) {
  if (res.writableEnded) return;
  res.writeHead(status, headers);
  if (body === undefined || body === null) res.end();
  else res.end(body);
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  send(res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store'
  }, body);
}

/** 统一成功信封：{ ok: true, data } */
function ok(res, data, status = 200) {
  sendJson(res, status, { ok: true, data });
}

/** 统一错误信封：{ ok: false, error } */
function fail(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const code = err instanceof HttpError ? err.code : 'INTERNAL_ERROR';
  const message = err instanceof HttpError ? err.message : '服务器内部错误，请稍后再试';
  const payload = { ok: false, error: { code, message } };
  if (err && err.details) payload.error.details = err.details;
  sendJson(res, status, payload);
}

/* ------------------------------------------------------------------ */
/* 请求                                                                */
/* ------------------------------------------------------------------ */

function parseUrl(req) {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}

/** 读取并解析请求体（支持 application/json 与表单），超限即拒绝 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    const chunks = [];
    let size = 0;
    let done = false;

    const abort = (err) => {
      if (done) return;
      done = true;
      req.destroy();
      reject(err);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        abort(new HttpError(413, 'PAYLOAD_TOO_LARGE', `请求体超过 ${Math.round(maxBytes / 1024)}KB 限制`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (err) => abort(new HttpError(400, 'STREAM_ERROR', err.message)));
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        if (type.includes('application/json')) {
          const parsed = JSON.parse(raw);
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } else if (type.includes('application/x-www-form-urlencoded')) {
          resolve(Object.fromEntries(new URLSearchParams(raw)));
        } else {
          resolve({});
        }
      } catch {
        reject(badRequest('请求体不是合法 JSON'));
      }
    });
  });
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function cookie(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  if (opts.secure) bits.push('Secure');
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  return bits.join('; ');
}

/**
 * 追加一条 Set-Cookie。
 * 直接 setHeader('Set-Cookie', ...) 会覆盖之前写入的 cookie，
 * 一次性需要下发多个 cookie（会话 + 购物袋）时必须用这个。
 */
function appendCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev.slice() : prev ? [String(prev)] : [];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}

/**
 * 当前请求是否真的走 HTTPS。
 * 不能拿 NODE_ENV 判断：生产环境也可能先用 HTTP（未备案、未配证书），
 * 这时若给 Cookie 加 Secure，浏览器会直接丢弃，表现为“登录成功但立刻掉线”。
 */
function isSecureRequest(ctx) {
  const proto = String(ctx.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto) return proto === 'https';
  return !!(ctx.req && ctx.req.socket && ctx.req.socket.encrypted);
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

function splitPath(p) {
  return String(p).split('/').filter((s) => s.length > 0);
}

class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * @param {'GET'|'POST'|'PATCH'|'PUT'|'DELETE'|'*'} method
   * @param {string} pattern 形如 /api/products/:slug
   * @param {Function} handler async (ctx) => data
   */
  add(method, pattern, handler, opts = {}) {
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      parts: splitPath(pattern),
      handler,
      auth: opts.auth || null,
      limit: opts.limit || null,
      status: opts.status || null
    });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  patch(p, h, o) { return this.add('PATCH', p, h, o); }
  put(p, h, o) { return this.add('PUT', p, h, o); }
  del(p, h, o) { return this.add('DELETE', p, h, o); }

  match(method, pathname) {
    const target = splitPath(pathname);
    let methodNotAllowed = false;

    for (const route of this.routes) {
      const params = matchParts(route.parts, target);
      if (!params) continue;
      if (route.method !== method && route.method !== '*') {
        methodNotAllowed = true;
        continue;
      }
      return { route, params };
    }

    // 路径存在但方法不对 → 405
    if (methodNotAllowed) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `不支持 ${method} 方法`);
    return null;
  }
}

function matchParts(parts, target) {
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === '*') {
      params.rest = target.slice(i).join('/');
      return params;
    }
    const t = target[i];
    if (t === undefined) return null;
    if (seg.startsWith(':')) {
      if (t === '') return null;
      try {
        params[seg.slice(1)] = decodeURIComponent(t);
      } catch {
        params[seg.slice(1)] = t;
      }
      continue;
    }
    if (seg !== t) return null;
  }
  return target.length === parts.length ? params : null;
}

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  MIME,
  mimeFor,
  send,
  sendJson,
  ok,
  fail,
  parseUrl,
  readBody,
  clientIp,
  parseCookies,
  cookie,
  appendCookie,
  isSecureRequest,
  Router
};
