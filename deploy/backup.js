#!/usr/bin/env node
'use strict';

/**
 * SQLite 在线备份。
 * 使用 node:sqlite 自带的 backup()，运行中也能安全复制（不必停服）。
 *
 *   node deploy/backup.js
 *   BACKUP_KEEP=30 node deploy/backup.js
 *
 * 环境变量：
 *   DB_FILE     数据库路径（默认 <项目>/data/xunpu.db）
 *   BACKUP_DIR  备份目录（默认 <项目>/data/backups）
 *   BACKUP_KEEP 保留份数（默认 14）
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync, backup } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'xunpu.db');
const OUT_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'data', 'backups');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function prune() {
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => /^xunpu-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();

  for (const old of files.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(OUT_DIR, old));
      console.log(`[backup] 清理旧备份 ${old}`);
    } catch (err) {
      console.warn(`[backup] 清理失败 ${old}: ${err.message}`);
    }
  }
}

async function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error(`[backup] 数据库不存在：${DB_FILE}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, `xunpu-${stamp()}.db`);

  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    await backup(db, dest);
  } finally {
    db.close();
  }

  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`[backup] 完成 ${dest} (${kb} KB)`);
  prune();
}

main().catch((err) => {
  console.error('[backup] 失败：', err.message);
  process.exit(1);
});
