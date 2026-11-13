'use strict';

const path = require('node:path');
const config = require('./config');
const log = require('./lib/logger');
const { getDb, closeDb } = require('./db');
const { seed } = require('./db/seed');
const { createServer } = require('./app');

/* ------------------------------------------------------------------ */
/* 启动自检                                                            */
/* ------------------------------------------------------------------ */

function bootstrap() {
  const db = getDb();
  const products = db.get('SELECT COUNT(*) AS n FROM products').n;

  if (products === 0) {
    log.info('数据库为空，正在写入初始数据…');
    const result = seed();
    log.ready(`初始数据就绪：${result.products} 件商品`);
  }

  const users = db.get('SELECT COUNT(*) AS n FROM users').n;
  if (users === 0) {
    seed();
  }
}

function banner(port) {
  const url = `http://localhost:${port}`;
  const line = '─'.repeat(56);
  process.stdout.write(`
\x1b[31m  ╭${line}╮\x1b[0m
\x1b[31m  │\x1b[0m  \x1b[1m蟳埔花事 · XUNPU BLOSSOM\x1b[0m  后端服务已启动
\x1b[31m  │\x1b[0m
\x1b[31m  │\x1b[0m  站点      \x1b[36m${url}\x1b[0m
\x1b[31m  │\x1b[0m  管理后台  \x1b[36m${url}/admin/\x1b[0m
\x1b[31m  │\x1b[0m  接口健康  \x1b[36m${url}/api/health\x1b[0m
\x1b[31m  │\x1b[0m
\x1b[31m  │\x1b[0m  数据库    ${path.relative(process.cwd(), config.dbFile) || config.dbFile}
\x1b[31m  │\x1b[0m  运行环境  ${config.env}
\x1b[31m  ╰${line}╯\x1b[0m
\n`);
  if (config.adminPassword === 'xunpu2026') {
    log.warn('管理员仍使用默认密码（admin / xunpu2026），上线前请设置 ADMIN_PASSWORD 环境变量');
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function main() {
  bootstrap();

  const server = createServer();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`端口 ${config.port} 已被占用。换个端口：PORT=3001 npm start`);
    } else {
      log.error('服务启动失败', err.message);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    banner(config.port);
  });

  const shutdown = (signal) => {
    log.info(`收到 ${signal}，正在关闭…`);
    server.close(() => {
      closeDb();
      log.info('已安全退出');
      process.exit(0);
    });
    setTimeout(() => {
      log.warn('强制退出');
      process.exit(1);
    }, 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('未处理的 Promise 拒绝', reason && reason.message ? reason.message : String(reason));
  });
}

if (require.main === module) main();

module.exports = { main };
