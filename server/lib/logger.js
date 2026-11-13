'use strict';

const LEVEL_COLOR = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  ready: '\x1b[32m'
};
const RESET = '\x1b[0m';
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function stamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function paint(level, text) {
  if (!useColor) return text;
  return `${LEVEL_COLOR[level] || ''}${text}${RESET}`;
}

function log(level, message, meta) {
  const line = `${paint('info', stamp())} ${paint(level, level.toUpperCase().padEnd(5))} ${message}`;
  if (meta !== undefined && meta !== null) {
    const text = typeof meta === 'string' ? meta : JSON.stringify(meta);
    process.stdout.write(`${line} ${text}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  ready: (msg, meta) => log('ready', msg, meta),
  request: (method, path, status, ms, ip) => {
    const statusPaint = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'ready';
    log('info', `${method.padEnd(6)} ${String(status).padStart(3)} ${paint(statusPaint, `${ms}ms`).padEnd(12)} ${path}  ${ip || ''}`);
  }
};
