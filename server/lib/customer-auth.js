'use strict';

/**
 * 顾客账号：注册、登录、会话。
 * 与后台管理员（lib/auth.js + sessions 表）完全隔离，互不影响。
 */

const { getDb } = require('../db');
const config = require('../config');
const { unauthorized, forbidden, conflict, badRequest } = require('./http');
const { sha256, newToken, hashPassword, verifyPassword } = require('./security');

const COOKIE = 'xb_user';

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

function readToken(ctx) {
  const header = ctx.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return ctx.cookies[COOKIE] || '';
}

function currentCustomer(ctx) {
  const token = readToken(ctx);
  if (!token) return null;

  const db = getDb();
  const row = db.get(
    `SELECT s.id AS session_id, s.expires_at,
            c.id, c.phone, c.nickname, c.email, c.status, c.created_at
       FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash = ?`,
    sha256(token)
  );
  if (!row) return null;

  if (row.expires_at <= Date.now()) {
    db.run('DELETE FROM customer_sessions WHERE id = ?', row.session_id);
    return null;
  }
  if (row.status !== 'active') return null;

  return {
    id: row.id,
    phone: row.phone,
    nickname: row.nickname,
    email: row.email || '',
    createdAt: row.created_at,
    sessionId: row.session_id
  };
}

function requireCustomer(ctx) {
  if (!ctx.customer) throw unauthorized('请先登录');
  return ctx.customer;
}

/* ------------------------------------------------------------------ */
/* 口令策略                                                            */
/* ------------------------------------------------------------------ */

function assertPassword(password, field = '密码') {
  const text = String(password || '');
  if (text.length < 8) throw badRequest(`${field}至少 8 位`, { field: 'password' });
  if (text.length > 64) throw badRequest(`${field}不能超过 64 位`, { field: 'password' });
  if (/^\d+$/.test(text)) throw badRequest(`${field}不能是纯数字`, { field: 'password' });
  return text;
}

/* ------------------------------------------------------------------ */
/* 注册 / 登录                                                         */
/* ------------------------------------------------------------------ */

function maskPhone(phone) {
  return String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function register({ phone, password, nickname, email }, ip) {
  const db = getDb();
  assertPassword(password);

  const exists = db.get('SELECT id FROM customers WHERE phone = ?', phone);
  if (exists) throw conflict('该手机号已注册，请直接登录', { field: 'phone' });

  const now = new Date().toISOString();
  const name = (nickname || '').trim() || `花友${phone.slice(-4)}`;

  const res = db.run(
    `INSERT INTO customers (phone, password_hash, nickname, email, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    phone,
    hashPassword(password),
    name,
    email || null,
    now,
    now
  );

  const customer = db.get('SELECT * FROM customers WHERE id = ?', res.lastInsertRowid);
  const session = openSession(customer, ip);
  return { ...session, customer: publicCustomer(customer), isNew: true };
}

function login(phone, password, ip) {
  const db = getDb();
  const row = db.get('SELECT * FROM customers WHERE phone = ?', String(phone).trim());
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  if (row.status !== 'active') throw forbidden('账号已被停用，请联系客服');

  const session = openSession(row, ip);
  return { ...session, customer: publicCustomer(row), isNew: false };
}

function openSession(customer, ip) {
  const db = getDb();
  const token = newToken();
  const now = new Date();
  const expires = now.getTime() + config.sessionTtl;

  db.run('DELETE FROM customer_sessions WHERE expires_at <= ?', Date.now());
  db.run(
    'INSERT INTO customer_sessions (token_hash, customer_id, expires_at, created_at, ip) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    customer.id,
    expires,
    now.toISOString(),
    ip || null
  );
  db.run('UPDATE customers SET last_login_at = ? WHERE id = ?', now.toISOString(), customer.id);

  return { token, expiresAt: new Date(expires).toISOString() };
}

function logout(token) {
  if (!token) return false;
  return getDb().run('DELETE FROM customer_sessions WHERE token_hash = ?', sha256(token)).changes > 0;
}

function publicCustomer(row) {
  return {
    id: row.id,
    phone: row.phone,
    phoneMasked: maskPhone(row.phone),
    nickname: row.nickname,
    email: row.email || '',
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null
  };
}

function changePassword(customerId, current, next, keepSessionId) {
  const db = getDb();
  assertPassword(next, '新密码');

  const row = db.get('SELECT * FROM customers WHERE id = ?', customerId);
  if (!row) throw unauthorized('账号不存在');
  if (!verifyPassword(current, row.password_hash)) throw badRequest('当前密码不正确', { field: 'current' });
  if (verifyPassword(next, row.password_hash)) throw badRequest('新密码不能与当前密码相同', { field: 'next' });

  db.run('UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(next), new Date().toISOString(), customerId);
  // 其它设备下线，保留当前会话
  db.run('DELETE FROM customer_sessions WHERE customer_id = ? AND id <> ?', customerId, keepSessionId || -1);
  return true;
}

module.exports = {
  COOKIE,
  readToken,
  currentCustomer,
  requireCustomer,
  register,
  login,
  logout,
  publicCustomer,
  changePassword,
  assertPassword,
  maskPhone
};
