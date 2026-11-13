'use strict';

const repo = require('../repo');
const { getDb } = require('../db');
const { notFound, conflict, badRequest } = require('../lib/http');
const { resolveCart, emptyCart } = require('../lib/session');
const v = require('../lib/validate');

const MAX_QTY = 99;

module.exports = function register(router) {
  /** 读取购物袋 */
  router.get('/api/cart', async (ctx) => {
    const cart = resolveCart(ctx, { create: false });
    return cart ? repo.cartOut(cart) : emptyCart(ctx);
  });

  /** 加入购物袋：{ variantId | sku | productId(slug), qty } */
  router.post('/api/cart/items', async (ctx) => {
    ctx.status = 201;
    const body = ctx.body || {};
    const qty = v.int(body.qty, '数量', { min: 1, max: MAX_QTY, fallback: 1 });

    let variant = null;
    if (body.variantId) variant = repo.findVariant({ variantId: body.variantId });
    else if (body.sku) variant = repo.findVariant({ sku: body.sku });
    else if (body.productId || body.slug) {
      const product = repo.getProductRow(body.productId || body.slug);
      if (product) variant = repo.defaultVariant(product.id);
    }

    if (!variant) throw notFound('规格不存在，请刷新页面重试');
    if (variant.status !== 'active') throw conflict('该规格已下架');

    const db = getDb();
    const product = db.get('SELECT * FROM products WHERE id = ?', variant.product_id);
    if (!product || product.status !== 'active') throw conflict('商品已下架');

    const cart = resolveCart(ctx);
    const existing = db.get('SELECT * FROM cart_items WHERE cart_id = ? AND variant_id = ?', cart.id, variant.id);
    const target = (existing ? existing.qty : 0) + qty;

    if (target > variant.stock) {
      throw conflict(
        variant.stock === 0
          ? `「${product.name} · ${variant.name}」已售罄`
          : `「${product.name} · ${variant.name}」库存仅剩 ${variant.stock} 件`,
        { stock: variant.stock, requested: target }
      );
    }

    if (existing) {
      db.run('UPDATE cart_items SET qty = ? WHERE id = ?', target, existing.id);
    } else {
      db.run(
        'INSERT INTO cart_items (cart_id, variant_id, qty, added_at) VALUES (?, ?, ?, ?)',
        cart.id,
        variant.id,
        qty,
        new Date().toISOString()
      );
    }
    repo.touchCart(cart.id);
    return repo.cartOut(db.get('SELECT * FROM carts WHERE id = ?', cart.id));
  });

  /** 修改数量（0 = 移除） */
  router.patch('/api/cart/items/:id', async (ctx) => {
    const qty = v.int(ctx.body?.qty, '数量', { min: 0, max: MAX_QTY });
    const cart = resolveCart(ctx, { create: false });
    if (!cart) throw notFound('购物袋是空的');

    const db = getDb();
    const item = db.get(
      `SELECT ci.*, v.stock, v.name AS variant_name, p.name AS product_name
         FROM cart_items ci
         JOIN variants v ON v.id = ci.variant_id
         JOIN products p ON p.id = v.product_id
        WHERE ci.id = ? AND ci.cart_id = ?`,
      Number(ctx.params.id),
      cart.id
    );
    if (!item) throw notFound('购物袋中没有这条记录');

    if (qty === 0) {
      db.run('DELETE FROM cart_items WHERE id = ?', item.id);
    } else {
      if (qty > item.stock) throw conflict(`「${item.product_name}」库存仅剩 ${item.stock} 件`, { stock: item.stock });
      db.run('UPDATE cart_items SET qty = ? WHERE id = ?', qty, item.id);
    }
    repo.touchCart(cart.id);
    return repo.cartOut(db.get('SELECT * FROM carts WHERE id = ?', cart.id));
  });

  /** 移除一条 */
  router.del('/api/cart/items/:id', async (ctx) => {
    const cart = resolveCart(ctx, { create: false });
    if (!cart) throw notFound('购物袋是空的');
    const db = getDb();
    const res = db.run('DELETE FROM cart_items WHERE id = ? AND cart_id = ?', Number(ctx.params.id), cart.id);
    if (!res.changes) throw notFound('购物袋中没有这条记录');
    repo.touchCart(cart.id);
    return repo.cartOut(db.get('SELECT * FROM carts WHERE id = ?', cart.id));
  });

  /** 清空 */
  router.del('/api/cart', async (ctx) => {
    const cart = resolveCart(ctx, { create: false });
    if (!cart) throw badRequest('购物袋是空的');
    const db = getDb();
    db.run('DELETE FROM cart_items WHERE cart_id = ?', cart.id);
    repo.touchCart(cart.id);
    return repo.cartOut(db.get('SELECT * FROM carts WHERE id = ?', cart.id));
  });
};
