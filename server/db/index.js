'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

class Db {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA synchronous = NORMAL');

    this._stmts = new Map();
    this.migrate();
  }

  migrate() {
    const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    this.raw.exec(sql);
    this.upgrade();
  }

  /**
   * 轻量迁移：老库补列。
   * CREATE TABLE IF NOT EXISTS 不会给已存在的表加新列，这里逐个补。
   */
  upgrade() {
    const additions = [
      ['carts', 'customer_id', 'INTEGER'],
      ['orders', 'customer_id', 'INTEGER'],
      ['orders', 'fulfillment', "TEXT NOT NULL DEFAULT 'express'"],
      ['orders', 'idem_key', 'TEXT']
    ];

    for (const [table, column, ddl] of additions) {
      let columns;
      try {
        columns = this.raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      } catch {
        continue; // 表还不存在，schema.sql 已负责创建
      }
      if (columns.includes(column)) continue;
      try {
        this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      } catch {
        /* 并发启动时可能已被其它进程加过 */
      }
    }

    // 依赖新列的索引放在补列之后创建
    this.raw.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, id)');
    this.raw.exec('CREATE INDEX IF NOT EXISTS idx_carts_customer ON carts(customer_id)');
  }

  /** 预处理语句缓存 */
  stmt(sql) {
    let s = this._stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this._stmts.set(sql, s);
    }
    return s;
  }

  run(sql, ...params) {
    const res = this.stmt(sql).run(...params);
    return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
  }

  get(sql, ...params) {
    return this.stmt(sql).get(...params);
  }

  all(sql, ...params) {
    return this.stmt(sql).all(...params);
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  /** 事务包装：异常自动回滚（支持嵌套时复用外层事务） */
  tx(fn) {
    if (this._inTx) return fn();
    this._inTx = true;
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* 回滚失败时保留原始错误 */
      }
      throw err;
    } finally {
      this._inTx = false;
    }
  }

  /** 自增计数器，用于订单流水号 */
  nextCounter(name) {
    const row = this.get('SELECT value FROM counters WHERE name = ?', name);
    const next = (row ? row.value : 0) + 1;
    if (row) {
      this.run('UPDATE counters SET value = ? WHERE name = ?', next, name);
    } else {
      this.run('INSERT INTO counters (name, value) VALUES (?, ?)', name, next);
    }
    return next;
  }

  close() {
    this._stmts.clear();
    this.raw.close();
  }
}

let instance = null;

function getDb() {
  if (!instance) instance = new Db(config.dbFile);
  return instance;
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { Db, getDb, closeDb };
