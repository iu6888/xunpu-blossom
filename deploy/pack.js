#!/usr/bin/env node
'use strict';

/**
 * 交付打包器：把项目打成一个可以直接发给别人的 zip。
 *
 *   node deploy/pack.js                 轻量包（约 200 KB，对方需装 Node 22.5+）
 *   node deploy/pack.js --portable      便携包（约 30 MB，内置 Windows 版 Node，双击即用）
 *   node deploy/pack.js --out=D:/x.zip  指定输出路径
 *
 * 打包时自动排除：data/（数据库与备份）、.git、.tmp、node_modules、日志。
 * 不依赖任何第三方库，zip 格式自己写。
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ------------------------------------------------------------------ */
/* 最小 ZIP 写入器                                                     */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function dosDate(d) {
  const y = Math.max(1980, d.getFullYear());
  return ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}

function dosTime(d) {
  return (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
}

class ZipWriter {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
    this.entries = 0;
  }

  add(name, data, mtime = new Date()) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    let method = 0;
    let body = data;
    if (data.length > 64) {
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      if (deflated.length < data.length) {
        method = 8;
        body = deflated;
      }
    }

    const flags = 0x0800; // 文件名按 UTF-8 解析
    const time = dosTime(mtime);
    const date = dosDate(mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    this.parts.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4); // made by: UNIX, 2.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    cd.writeUInt32LE(this.offset, 42);

    this.central.push(Buffer.concat([cd, nameBuf]));
    this.offset += local.length + nameBuf.length + body.length;
    this.entries += 1;
  }

  finish() {
    const central = Buffer.concat(this.central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries, 8);
    eocd.writeUInt16LE(this.entries, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(this.offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...this.parts, central, eocd]);
  }
}

/* ------------------------------------------------------------------ */
/* 打包                                                                */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(__dirname, '..');
const INNER = 'xunpu-blossom'; // zip 内的顶层目录，用 ASCII 避免解压乱码

const SKIP_DIRS = new Set(['data', '.git', '.tmp', 'node_modules', '.workbuddy', '.idea', '.vscode']);
const SKIP_FILES = /^(\.DS_Store|Thumbs\.db|.*\.log|.*\.zip|.*\.tar\.gz|.*\.sha256)$/i;

function parseArgs(argv) {
  const opts = { portable: false, out: '', name: '' };
  for (const arg of argv) {
    if (arg === '--portable') opts.portable = true;
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else if (arg.startsWith('--name=')) opts.name = arg.slice(7);
    else if (arg === '-h' || arg === '--help') {
      console.log('用法：node deploy/pack.js [--portable] [--out=<路径>] [--name=<包名>]');
      process.exit(0);
    }
  }
  return opts;
}

function collect(dir, rel, out) {
  const items = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    const abs = path.join(dir, item.name);
    const relPath = rel ? `${rel}/${item.name}` : item.name;

    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue;
      collect(abs, relPath, out);
      continue;
    }
    if (!item.isFile()) continue;
    if (SKIP_FILES.test(item.name)) continue;
    out.push({ abs, rel: relPath });
  }
  return out;
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stamp = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  })();

  const baseName = opts.name || `蟳埔花事-交付包${opts.portable ? '-便携版' : ''}-${stamp}`;
  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(path.dirname(ROOT), `${baseName}.zip`);

  console.log(`▸ 收集文件${opts.portable ? '（含便携运行时）' : ''}`);

  const files = collect(ROOT, '', []);

  // 项目里若残留 runtime 目录，先剔掉，避免与下面塞进去的运行时重名
  for (let i = files.length - 1; i >= 0; i--) {
    if (files[i].rel.startsWith('runtime/')) files.splice(i, 1);
  }

  // 便携包：把当前 Node 运行时塞进去，对方无需安装
  if (opts.portable) {
    const self = process.execPath;
    if (!/node\.exe$/i.test(self)) {
      console.error('  ! 便携包只能在 Windows 上打（当前运行时不是 node.exe）');
      process.exit(1);
    }
    files.push({ abs: self, rel: 'runtime/node.exe' });

    // 随附许可证（Node.js 为 MIT 协议，再分发需保留版权声明）
    const runtimeDir = path.dirname(self);
    const license = path.join(runtimeDir, 'LICENSE');
    if (fs.existsSync(license)) files.push({ abs: license, rel: 'runtime/LICENSE' });

    files.push({
      rel: 'runtime/说明.txt',
      text:
        `本目录是 Node.js 运行时（v${process.versions.node}），供 start.bat 直接调用。\n` +
        '来源：https://nodejs.org\n' +
        '协议：MIT，版权归 Node.js contributors 所有，见同目录 LICENSE。\n\n' +
        '这个文件夹不需要手动动它。删掉它的话，start.bat 会改用系统安装的 Node.js。\n',
    });
  }

  console.log(`  ${files.length} 个文件`);

  const zip = new ZipWriter();
  let raw = 0;

  for (const file of files) {
    let data;
    let mtime;
    if (typeof file.text === 'string') {
      data = Buffer.from(file.text, 'utf8');
      mtime = new Date();
    } else {
      data = fs.readFileSync(file.abs);
      mtime = fs.statSync(file.abs).mtime;
    }
    zip.add(`${INNER}/${file.rel}`, data, mtime);
    raw += data.length;
  }

  const buf = zip.finish();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);

  console.log(`▸ 完成：${outPath}`);
  console.log(`  原始 ${human(raw)} → 压缩后 ${human(buf.length)}（${((buf.length / raw) * 100).toFixed(0)}%）`);
  console.log('');
  console.log('  对方拿到后：');
  console.log('    1. 解压');
  if (opts.portable) {
    console.log('    2. 双击 start.bat —— 自带运行时，不用装任何东西');
  } else {
    console.log('    2. 双击 start.bat —— 需要先装 Node.js 22.5+（https://nodejs.org）');
  }
  console.log('    3. 浏览器打开 http://localhost:3000');
  console.log('       管理后台 /admin/  账号 admin / xunpu2026');
  console.log('');
}

main();
