'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { mimeFor, send } = require('./lib/http');

/** 禁止对外暴露的目录与文件 */
const BLOCKED_PREFIX = [
  'server',
  'data',
  'node_modules',
  '.git',
  '.workbuddy',
  'test',
  'package.json',
  'package-lock.json',
  '.env'
];

function isBlocked(relPath) {
  const first = relPath.split('/')[0];
  return BLOCKED_PREFIX.includes(first) || relPath.split('/').some((s) => s.startsWith('.') && s !== '');
}

/** 把 URL 路径安全地解析为磁盘路径，越界返回 null */
function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const normalized = path.posix.normalize(decoded).replace(/^(\.\.\/)+/, '');
  if (normalized.includes('..')) return null;

  const abs = path.join(root, normalized);
  const rootResolved = path.resolve(root);
  const absResolved = path.resolve(abs);
  if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + path.sep)) return null;

  const rel = path.relative(rootResolved, absResolved).split(path.sep).join('/');
  if (isBlocked(rel)) return null;
  return { abs: absResolved, rel };
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function etagFor(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

function headersFor(relPath, stat, { cacheSeconds } = {}) {
  const ext = path.extname(relPath).toLowerCase();
  const isHtml = ext === '.html' || ext === '';
  const maxAge = isHtml ? 0 : (cacheSeconds ?? 604800);
  return {
    'Content-Type': mimeFor(relPath || 'index.html'),
    'Content-Length': String(stat.size),
    'Cache-Control': maxAge === 0 ? 'no-cache' : `public, max-age=${maxAge}`,
    ETag: etagFor(stat),
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff'
  };
}

/**
 * 发送一个静态文件；找不到返回 false，便于调用方降级。
 */
function sendFile(req, res, filePath, relForMime, { cacheSeconds } = {}) {
  const stat = statSafe(filePath);
  if (!stat || !stat.isFile()) return false;

  const headers = headersFor(relForMime || filePath, stat, { cacheSeconds });
  const inm = req.headers['if-none-match'];
  if (inm && inm === headers.ETag) {
    res.writeHead(304, { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return true;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.writableEnded) res.destroy();
  });
  stream.pipe(res);
  return true;
}

/** 站点静态文件（含 .html 补全、目录 index、404 回退） */
function serveSite(req, res, pathname, root, { notFoundPage }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let target = safeJoin(root, pathname === '/' ? '/index.html' : pathname);
  if (!target) return false;

  let stat = statSafe(target.abs);
  if (stat && stat.isDirectory()) {
    const indexPath = path.join(target.abs, 'index.html');
    if (sendFile(req, res, indexPath, `${target.rel}/index.html`)) return true;
    return false;
  }
  if (stat && stat.isFile()) {
    return sendFile(req, res, target.abs, target.rel);
  }

  // /collection → collection.html
  if (!path.extname(target.abs)) {
    const htmlPath = `${target.abs}.html`;
    if (statSafe(htmlPath)) return sendFile(req, res, htmlPath, `${target.rel}.html`);
  }

  if (notFoundPage) {
    const nf = safeJoin(root, notFoundPage);
    if (nf && statSafe(nf.abs)) {
      const body = fs.readFileSync(nf.abs);
      send(res, 404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store'
      }, body);
      return true;
    }
  }
  return false;
}

/** 管理后台静态资源（挂在 /admin 下） */
function serveAdmin(req, res, pathname, adminDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const sub = pathname.replace(/^\/admin\/?/, '');
  const clean = sub === '' ? 'index.html' : sub;
  const target = safeJoin(adminDir, `/${clean}`);
  if (!target) return false;

  const stat = statSafe(target.abs);
  if (stat && stat.isFile()) return sendFile(req, res, target.abs, target.rel, { cacheSeconds: 0 });

  // SPA 回退
  const index = path.join(adminDir, 'index.html');
  return sendFile(req, res, index, 'index.html', { cacheSeconds: 0 });
}

module.exports = { serveSite, serveAdmin, sendFile, safeJoin };
