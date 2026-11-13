'use strict';

const { getDb } = require('../db');
const config = require('../config');
const repo = require('../repo');
const ca = require('../lib/customer-auth');
const { adoptCart } = require('../lib/session');
const { badRequest, unauthorized, conflict, cookie, appendCookie, isSecureRequest } = require('../lib/http');
const { orderOut, toYuan } = require('../lib/format');
const v = require('../lib/validate');

/* ------------------------------------------------------------------ */
/* 登录 / 注册 防爆破                                                   */
/* ------------------------------------------------------------------ */

const attempts = new Map();
const WINDOW = 10 * 60 * 1000;
const LIMIT = 10;

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of attempts) if (now > rec.resetAt) attempts.delete(key);
}, 5 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

function guard(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) return true;
  return rec.count < LIMIT;
}

function recordFail(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) attempts.set(ip, { count: 1, resetAt: now + WINDOW });
  else rec.count += 1;
}

function clearFail(ip) {
  attempts.delete(ip);
}

/* ------------------------------------------------------------------ */

function setSessionCookie(ctx, token) {
  appendCookie(
    ctx.res,
    cookie(ca.COOKIE, token, {
      maxAge: ctx.config.sessionTtl,
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecureRequest(ctx)
    })
  );
}

function nickname(value) {
  const text = v.str(value, '昵称', { min: 1, max: 20 });
  if (/[\u0000-\u001f<>]/.test(text)) throw badRequest('昵称包含非法字符', { field: 'nickname' });
  return text;
}

/** 顾客自己的订单（含汇总） */
function myOrders(customerId, { limit = 20, page = 1 } = {}) {
  const db = getDb();
  const total = db.get('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', customerId).n;
  const rows = db.all(
    'SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    customerId,
    limit,
    (page - 1) * limit
  );
  const items = repo.orderItemsOf(rows.map((r) => r.id));
  const stat = db.get(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0) AS spent
       FROM orders WHERE customer_id = ?`,
    customerId
  );

  return {
    items: rows.map((r) => orderOut(r, items.get(r.id) || [])),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    stats: { orders: stat.orders, spent: toYuan(stat.spent) }
  };
}

module.exports = function register(router) {
  /** 注册 */
  router.post('/api/auth/register', async (ctx) => {
    ctx.status = 201;
    if (!guard(ctx.ip)) throw conflict('尝试次数过多，请 10 分钟后再试');

    const body = ctx.body || {};
    const phone = v.phone(body.phone, '手机号');
    const password = ca.assertPassword(body.password);
    const name = body.nickname ? nickname(body.nickname) : '';
    const email = v.email(body.email, '邮箱');

    let result;
    try {
      result = ca.register({ phone, password, nickname: name, email }, ctx.ip);
    } catch (err) {
      if (err && err.status === 409) recordFail(ctx.ip);
      throw err;
    }

    clearFail(ctx.ip);
    setSessionCookie(ctx, result.token);

    // 把注册前的游客购物袋接到账号上
    ctx.customer = result.customer;
    const cartRow = adoptCart(ctx);
    const cart = cartRow ? repo.cartOut(cartRow) : null;

    return {
      customer: result.customer,
      token: result.token,
      expiresAt: result.expiresAt,
      isNew: true,
      cart
    };
  });

  /** 登录 */
  router.post('/api/auth/login', async (ctx) => {
    if (!guard(ctx.ip)) throw conflict('尝试次数过多，请 10 分钟后再试');

    const body = ctx.body || {};
    const phone = v.phone(body.phone, '手机号');
    const password = v.str(body.password, '密码', { max: 64 });

    const result = ca.login(phone, password, ctx.ip);
    if (!result) {
      recordFail(ctx.ip);
      throw unauthorized('手机号或密码不正确');
    }

    clearFail(ctx.ip);
    setSessionCookie(ctx, result.token);

    ctx.customer = result.customer;
    const cartRow = adoptCart(ctx);
    const cart = cartRow ? repo.cartOut(cartRow) : null;

    return {
      customer: result.customer,
      token: result.token,
      expiresAt: result.expiresAt,
      isNew: false,
      cart
    };
  });

  /** 退出 */
  router.post('/api/auth/logout', async (ctx) => {
    ca.logout(ca.readToken(ctx));
    appendCookie(ctx.res, cookie(ca.COOKIE, '', { maxAge: 0, httpOnly: true }));
    return { loggedOut: true };
  });

  /** 当前登录的顾客 */
  router.get('/api/auth/me', async (ctx) => {
    if (!ctx.customer) throw unauthorized('未登录');
    return { customer: ctx.customer, orders: myOrders(ctx.customer.id, { limit: 1 }).stats };
  });

  /** 修改昵称 / 邮箱 */
  router.patch('/api/auth/profile', async (ctx) => {
    const me = ca.requireCustomer(ctx);
    const body = ctx.body || {};
    const patch = [];
    const params = [];

    if (body.nickname !== undefined) {
      patch.push('nickname = ?');
      params.push(nickname(body.nickname));
    }
    if (body.email !== undefined) {
      const email = v.email(body.email, '邮箱');
      patch.push('email = ?');
      params.push(email || null);
    }
    if (!patch.length) throw badRequest('没有需要更新的字段');

    patch.push('updated_at = ?');
    params.push(new Date().toISOString());

    const db = getDb();
    db.run(`UPDATE customers SET ${patch.join(', ')} WHERE id = ?`, ...params, me.id);
    return { customer: ca.publicCustomer(db.get('SELECT * FROM customers WHERE id = ?', me.id)) };
  });

  /** 修改密码 */
  router.post('/api/auth/password', async (ctx) => {
    const me = ca.requireCustomer(ctx);
    const body = ctx.body || {};
    const current = v.str(body.current, '当前密码', { max: 64 });
    const next = ca.assertPassword(body.next, '新密码');

    ca.changePassword(me.id, current, next, me.sessionId);
    return { updated: true };
  });

  /** 我的订单 */
  router.get('/api/auth/orders', async (ctx) => {
    const me = ca.requireCustomer(ctx);
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const limit = Math.max(1, Math.min(50, Number(ctx.query.get('limit')) || 20));
    return myOrders(me.id, { page, limit });
  });
};
