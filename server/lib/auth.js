'use strict';

const { getDb } = require('../db');
const { unauthorized, forbidden } = require('./http');
const { sha256, newToken, verifyPassword } = require('./security');
const config = require('../config');

const COOKIE = 'xb_admin';

function readToken(ctx) {
  const header = ctx.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return ctx.cookies[COOKIE] || '';
}

/** 解析当前登录用户，无会话返回 null */
function currentUser(ctx) {
  const token = readToken(ctx);
  if (!token) return null;

  const db = getDb();
  const row = db.get(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    sha256(token)
  );
  if (!row) return null;

  if (row.expires_at <= Date.now()) {
    db.run('DELETE FROM sessions WHERE id = ?', row.session_id);
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    sessionId: row.session_id
  };
}

function requireAdmin(ctx) {
  if (!ctx.user) throw unauthorized('请先登录管理后台');
  if (!['owner', 'admin'].includes(ctx.user.role)) throw forbidden();
  return ctx.user;
}

/**
 * 校验某个账号的密码，主密码与备用密码都接受。
 * 返回 { ok, kind: 'primary'|'alt', altId }。主密码命中优先，避免多一次 scrypt。
 */
function checkPassword(user, password) {
  if (!user || typeof password !== 'string' || !password) return { ok: false };
  if (verifyPassword(password, user.password_hash)) return { ok: true, kind: 'primary' };

  const db = getDb();
  const alts = db.all(
    'SELECT id, password_hash FROM user_passwords WHERE user_id = ? ORDER BY id',
    user.id
  );
  for (const alt of alts) {
    if (verifyPassword(password, alt.password_hash)) return { ok: true, kind: 'alt', altId: alt.id };
  }
  return { ok: false };
}

function login(username, password, ip) {
  const db = getDb();
  const user = db.get('SELECT * FROM users WHERE username = ?', String(username || '').trim());

  const hit = checkPassword(user, password);
  if (!hit.ok) return null;

  const token = newToken();
  const now = new Date().toISOString();
  const expires = Date.now() + config.sessionTtl;

  db.run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
  db.run(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at, ip) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    user.id,
    expires,
    now,
    ip || null
  );
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now, user.id);
  if (hit.kind === 'alt') {
    db.run('UPDATE user_passwords SET last_used_at = ? WHERE id = ?', now, hit.altId);
  }

  return {
    token,
    expiresAt: new Date(expires).toISOString(),
    user: { id: user.id, username: user.username, name: user.name, role: user.role }
  };
}

function logout(token) {
  if (!token) return false;
  const db = getDb();
  return db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token)).changes > 0;
}

module.exports = {
  readToken,
  currentUser,
  requireAdmin,
  checkPassword,
  login,
  logout,
  ADMIN_COOKIE: COOKIE
};
