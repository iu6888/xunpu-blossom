'use strict';

const { getDb } = require('../db');
const config = require('../config');
const repo = require('../repo');
const v = require('../lib/validate');
const { badRequest, notFound, conflict, forbidden } = require('../lib/http');
const { resolveCart } = require('../lib/session');
const { orderNumber, accessToken, dayKey } = require('../lib/security');
const { orderOut, money } = require('../lib/format');

const MAX_LINES = 20;

/** 把请求里的 items 归一化为 [{variant, qty}]，并校验上架与库存 */
function resolveLines(rawItems) {
  const db = getDb();
  const list = v.array(rawItems, '商品明细', { min: 1, max: MAX_LINES });
  const lines = [];
  const seen = new Set();

  for (const raw of list) {
    const qty = v.int(raw?.qty, '数量', { min: 1, max: 99 });
    let variant = null;
    if (raw.variantId) variant = repo.findVariant({ variantId: raw.variantId });
    else if (raw.sku) variant = repo.findVariant({ sku: raw.sku });
    else if (raw.productId || raw.slug) {
      const product = repo.getProductRow(raw.productId || raw.slug);
      if (product) variant = repo.defaultVariant(product.id);
    }
    if (!variant) throw badRequest('商品或规格不存在', { item: raw });
    if (seen.has(variant.id)) throw badRequest('同一规格重复提交，请合并数量');
    seen.add(variant.id);

    const product = db.get('SELECT * FROM products WHERE id = ?', variant.product_id);
    if (!product || product.status !== 'active') throw conflict(`「${variant.name}」所属商品已下架`);
    if (variant.status !== 'active') throw conflict(`「${product.name} · ${variant.name}」已下架`);
    if (variant.stock < qty) {
      throw conflict(`「${product.name} · ${variant.name}」库存仅剩 ${variant.stock} 件`, {
        sku: variant.sku,
        stock: variant.stock,
        requested: qty
      });
    }

    lines.push({ variant, product, qty });
  }
  return lines;
}

function readCustomer(body) {
  const c = body.customer || body;
  const fulfillment = v.oneOf(body.fulfillment, '交付方式', ['express', 'pickup'], 'express');
  const name = v.str(c.name, '收货人姓名', { min: 1, max: 30 });
  const phone = v.phone(c.phone, '手机号');
  const email = v.email(c.email, '邮箱');
  const province = v.optStr(c.province, '省份', { max: 30 });
  const city = v.optStr(c.city, '城市', { max: 30 });
  const district = v.optStr(c.district, '区县', { max: 30 });
  const address = v.optStr(c.address, '详细地址', { max: 200 });

  if (fulfillment === 'express' && !address) {
    throw badRequest('快递配送需要填写详细地址', { field: 'address' });
  }

  return { name, phone, email, province, city, district, address, fulfillment };
}

module.exports = function register(router) {
  /** 提交订单 */
  router.post('/api/orders', async (ctx) => {
    ctx.status = 201;
    const body = ctx.body || {};
    const customer = readCustomer(body);
    const note = v.optStr(body.note, '备注', { max: 300 }) || null;
    const channel = v.oneOf(body.channel, '来源', ['web', 'store', 'airport', 'live', 'wechat', 'phone'], 'web');
    const idemKey = v.optStr(body.idempotencyKey || ctx.headers['idempotency-key'], '幂等键', { max: 80 }) || null;
    const db = getDb();

    // 幂等：同一 key 直接返回已有订单，避免重复下单
    if (idemKey) {
      const existing = db.get('SELECT * FROM orders WHERE idem_key = ?', idemKey);
      if (existing) {
        const itemMap = repo.orderItemsOf([existing.id]);
        return { ...orderOut(existing, itemMap.get(existing.id) || []), accessToken: existing.access_token, duplicated: true };
      }
    }

    // 明细来源：显式 items 优先，否则取购物袋
    let lines;
    let cart = null;
    if (Array.isArray(body.items) && body.items.length) {
      lines = resolveLines(body.items);
    } else {
      cart = resolveCart(ctx, { create: false });
      if (!cart) throw badRequest('购物袋是空的');
      const rows = repo.cartRows(cart.id);
      if (!rows.length) throw badRequest('购物袋是空的');
      lines = resolveLines(rows.map((r) => ({ variantId: r.variant_id, qty: r.qty })));
    }

    const itemsTotal = lines.reduce((n, l) => n + l.variant.price * l.qty, 0);
    const totals = repo.totalsFor(itemsTotal);
    const now = new Date();
    const nowIso = now.toISOString();
    const day = dayKey(now, config.timezone);

    const created = db.tx(() => {
      const seq = db.nextCounter(`order:${day}`);
      const no = orderNumber(seq, now, config.timezone);
      const token = accessToken();

      const res = db.run(
        `INSERT INTO orders
          (order_no, customer_id, access_token, customer_name, phone, email, province, city, district, address,
           note, channel, fulfillment, idem_key, items_total, shipping_fee, total,
           status, payment, day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'offline', ?, ?, ?)`,
        no,
        ctx.customer ? ctx.customer.id : null,
        token,
        customer.name,
        customer.phone,
        customer.email || null,
        customer.province || null,
        customer.city || null,
        customer.district || null,
        customer.address || null,
        note,
        channel,
        customer.fulfillment,
        idemKey,
        itemsTotal,
        totals.shippingFeeCents,
        totals.totalCents,
        day,
        nowIso,
        nowIso
      );

      const orderId = res.lastInsertRowid;
      for (const line of lines) {
        db.run(
          `INSERT INTO order_items
            (order_id, product_id, variant_id, name, name_en, variant_name, sku, image, price, qty, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          orderId,
          line.product.id,
          line.variant.id,
          line.product.name,
          line.product.name_en,
          line.variant.name,
          line.variant.sku,
          line.product.image,
          line.variant.price,
          line.qty,
          line.variant.price * line.qty
        );
        // 扣减库存（带条件更新，防止并发超卖）
        const upd = db.run(
          'UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?',
          line.qty,
          line.variant.id,
          line.qty
        );
        if (!upd.changes) {
          throw conflict(`「${line.product.name} · ${line.variant.name}」库存不足，请调整数量`);
        }
      }

      // 下单成功后清空购物袋
      if (cart) db.run('DELETE FROM cart_items WHERE cart_id = ?', cart.id);

      return { orderId, no, token };
    });

    const row = db.get('SELECT * FROM orders WHERE id = ?', created.orderId);
    const itemMap = repo.orderItemsOf([row.id]);
    return {
      ...orderOut(row, itemMap.get(row.id) || []),
      accessToken: created.token,
      payTip: `订单已提交，请在 24 小时内完成支付。合计 ${money(row.total)}，满 ${money(config.freeShippingThresholdCents)} 免运费。`
    };
  });

  /** 订单查询：需提供 token（下单时返回）或下单手机号 */
  router.get('/api/orders/:orderNo', async (ctx) => {
    const db = getDb();
    const row = db.get('SELECT * FROM orders WHERE order_no = ?', String(ctx.params.orderNo).toUpperCase());
    if (!row) throw notFound('订单不存在');

    const token = ctx.query.get('token') || ctx.headers['x-order-token'];
    const phone = ctx.query.get('phone');
    const allowed =
      (token && token === row.access_token) ||
      (phone && String(phone).replace(/[\s-]/g, '') === row.phone) ||
      (ctx.customer && row.customer_id === ctx.customer.id);
    if (!allowed) throw forbidden('请提供下单手机号或订单查询码');

    const itemMap = repo.orderItemsOf([row.id]);
    return orderOut(row, itemMap.get(row.id) || []);
  });

  /** 取消订单（仅未进入生产前，库存回滚） */
  router.post('/api/orders/:orderNo/cancel', async (ctx) => {
    const db = getDb();
    const row = db.get('SELECT * FROM orders WHERE order_no = ?', String(ctx.params.orderNo).toUpperCase());
    if (!row) throw notFound('订单不存在');

    const token = ctx.body?.token || ctx.query.get('token') || ctx.headers['x-order-token'];
    const phone = ctx.body?.phone || ctx.query.get('phone');
    const allowed =
      (token && token === row.access_token) ||
      (phone && String(phone).replace(/[\s-]/g, '') === row.phone) ||
      (ctx.customer && row.customer_id === ctx.customer.id);
    if (!allowed) throw forbidden('请提供下单手机号或订单查询码');
    if (!['pending', 'confirmed'].includes(row.status)) {
      throw conflict(`订单已${row.status === 'cancelled' ? '取消' : '进入生产，'}无法取消，请联系客服`);
    }

    db.tx(() => {
      db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", new Date().toISOString(), row.id);
      const items = db.all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', row.id);
      for (const it of items) {
        if (it.variant_id) db.run('UPDATE variants SET stock = stock + ? WHERE id = ?', it.qty, it.variant_id);
      }
    });

    const fresh = db.get('SELECT * FROM orders WHERE id = ?', row.id);
    return orderOut(fresh, repo.orderItemsOf([row.id]).get(row.id) || []);
  });
};
