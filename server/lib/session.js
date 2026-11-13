'use strict';

const crypto = require('node:crypto');
const { getDb } = require('../db');
const { cookie, appendCookie } = require('./http');

const COOKIE = 'xb_cart';
const TTL = 30 * 24 * 3600 * 1000;
const MAX_QTY = 99;

function setCartCookie(ctx, token, current) {
  if (current === token) return;
  appendCookie(ctx.res, cookie(COOKIE, token, { maxAge: TTL, httpOnly: false, sameSite: 'Lax' }));
}

/** 把游客购物袋里的东西并入账号购物袋，库存与上限内取小值 */
function mergeCarts(fromId, toId) {
  const db = getDb();
  const rows = db.all(
    `SELECT ci.variant_id, ci.qty, v.stock, v.status
       FROM cart_items ci JOIN variants v ON v.id = ci.variant_id
      WHERE ci.cart_id = ?`,
    fromId
  );

  for (const row of rows) {
    if (row.status !== 'active' || row.stock <= 0) continue;
    const existing = db.get('SELECT * FROM cart_items WHERE cart_id = ? AND variant_id = ?', toId, row.variant_id);
    const cap = Math.min(row.stock, MAX_QTY);

    if (existing) {
      const qty = Math.min(cap, existing.qty + row.qty);
      if (qty > existing.qty) {
        db.run('UPDATE cart_items SET qty = ? WHERE id = ?', qty, existing.id);
      }
    } else {
      db.run(
        'INSERT INTO cart_items (cart_id, variant_id, qty, added_at) VALUES (?, ?, ?, ?)',
        toId,
        row.variant_id,
        Math.min(cap, row.qty),
        new Date().toISOString()
      );
    }
  }
}

/**
 * 取（或新建）当前请求的购物袋。
 * - 已登录顾客：优先使用账号袋，并把游客袋并入
 * - 未登录：按 cookie / X-Cart-Token 取游客袋
 */
function resolveCart(ctx, { create = true } = {}) {
  const db = getDb();
  const cookieToken = ctx.cookies[COOKIE] || ctx.headers['x-cart-token'] || '';
  const customerId = ctx.customer ? ctx.customer.id : null;

  const guest = cookieToken
    ? db.get('SELECT * FROM carts WHERE token = ?', String(cookieToken).slice(0, 80))
    : null;
  const owned = customerId
    ? db.get('SELECT * FROM carts WHERE customer_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1', customerId)
    : null;

  // 1. 有账号袋
  if (owned) {
    if (guest && guest.id !== owned.id) {
      mergeCarts(guest.id, owned.id);
      db.run('DELETE FROM carts WHERE id = ?', guest.id);
      db.run('UPDATE carts SET updated_at = ? WHERE id = ?', new Date().toISOString(), owned.id);
    }
    setCartCookie(ctx, owned.token, cookieToken);
    return db.get('SELECT * FROM carts WHERE id = ?', owned.id);
  }

  // 2. 只有游客袋
  if (guest) {
    if (customerId) {
      db.run('UPDATE carts SET customer_id = ? WHERE id = ?', customerId, guest.id);
    }
    setCartCookie(ctx, guest.token, cookieToken);
    return db.get('SELECT * FROM carts WHERE id = ?', guest.id);
  }

  // 3. 都没有
  if (!create) return null;

  const token = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO carts (token, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
    token,
    customerId,
    now,
    now
  );
  setCartCookie(ctx, token, cookieToken);
  return db.get('SELECT * FROM carts WHERE token = ?', token);
}

/** 顾客注册/登录后调用：把当前游客袋挂到账号上 */
function adoptCart(ctx) {
  if (!ctx.customer) return null;
  return resolveCart(ctx);
}

/** 空购物袋结构，避免前端做空判断 */
function emptyCart(ctx) {
  const threshold = ctx.config.freeShippingThresholdCents;
  return {
    token: null,
    items: [],
    count: 0,
    itemsTotal: 0,
    itemsTotalCents: 0,
    itemsTotalText: '¥0',
    shippingFee: 0,
    shippingFeeCents: 0,
    shippingFeeText: '¥0',
    total: 0,
    totalCents: 0,
    totalText: '¥0',
    freeShippingThreshold: threshold / 100,
    freeShippingGap: threshold / 100,
    freeShippingGapText: `¥${threshold / 100}`
  };
}

module.exports = { resolveCart, adoptCart, emptyCart, mergeCarts, CART_COOKIE: COOKIE };
