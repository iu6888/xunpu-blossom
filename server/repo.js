'use strict';

const { getDb } = require('./db');
const config = require('./config');
const { money, toYuan, productOut, parseJson } = require('./lib/format');

/* ------------------------------------------------------------------ */
/* 商品                                                                */
/* ------------------------------------------------------------------ */

function variantsOf(productId, { includeInactive = false } = {}) {
  const db = getDb();
  const sql = includeInactive
    ? 'SELECT * FROM variants WHERE product_id = ? ORDER BY sort_order, id'
    : "SELECT * FROM variants WHERE product_id = ? AND status = 'active' ORDER BY sort_order, id";
  return db.all(sql, productId);
}

function hydrate(row, opts) {
  return productOut(row, variantsOf(row.id, opts));
}

function getProductRow(slugOrId) {
  const db = getDb();
  const numeric = Number(slugOrId);
  if (Number.isInteger(numeric) && String(numeric) === String(slugOrId)) {
    return db.get('SELECT * FROM products WHERE id = ?', numeric);
  }
  return db.get('SELECT * FROM products WHERE slug = ?', String(slugOrId));
}

function getProduct(slugOrId) {
  const row = getProductRow(slugOrId);
  return row ? hydrate(row) : null;
}

function listProducts(query = {}) {
  const db = getDb();
  const {
    category = '',
    q = '',
    sort = 'featured',
    page = 1,
    limit = 24,
    includeArchived = false,
    featuredOnly = false
  } = query;

  const where = [];
  const params = [];

  if (!includeArchived) where.push("status = 'active'");
  if (featuredOnly) where.push('featured = 1');
  if (q) {
    where.push('(name LIKE ? OR name_en LIKE ? OR tagline LIKE ? OR description LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const orderBy = {
    featured: 'sort_order ASC, id ASC',
    price_asc: 'price_from ASC, id ASC',
    price_desc: 'price_from DESC, id ASC',
    newest: 'created_at DESC, id DESC',
    name: 'sort_order ASC, id ASC'
  }[sort] || 'sort_order ASC, id ASC';

  const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`;
  let rows = db.all(sql, ...params);

  // 多分类过滤（如「花签」同时属于器物与可佩戴）在内存中完成，数据量很小
  if (category && category !== 'all') {
    rows = rows.filter((r) => parseJson(r.categories, [r.category]).includes(category));
  }

  const total = rows.length;
  const size = Math.max(1, Math.min(100, Number(limit) || 24));
  const current = Math.max(1, Number(page) || 1);
  const start = (current - 1) * size;
  const items = rows.slice(start, start + size).map((r) => hydrate(r));

  return {
    items,
    total,
    page: current,
    limit: size,
    pages: Math.max(1, Math.ceil(total / size))
  };
}

function findVariant({ variantId, sku }) {
  const db = getDb();
  if (variantId) return db.get('SELECT * FROM variants WHERE id = ?', Number(variantId));
  if (sku) return db.get('SELECT * FROM variants WHERE sku = ?', String(sku));
  return null;
}

/** 某个商品下默认选中的变体（用于只传 slug 加购） */
function defaultVariant(productId) {
  const db = getDb();
  return db.get(
    "SELECT * FROM variants WHERE product_id = ? AND status = 'active' ORDER BY sort_order, id LIMIT 1",
    productId
  );
}

/* ------------------------------------------------------------------ */
/* 购物袋                                                              */
/* ------------------------------------------------------------------ */

function ensureCart(token) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.get('SELECT * FROM carts WHERE token = ?', token);
  if (existing) return existing;
  db.run('INSERT INTO carts (token, created_at, updated_at) VALUES (?, ?, ?)', token, now, now);
  return db.get('SELECT * FROM carts WHERE token = ?', token);
}

function cartRows(cartId) {
  const db = getDb();
  return db.all(
    `SELECT ci.id AS item_id, ci.qty, ci.added_at,
            v.id AS variant_id, v.sku, v.name AS variant_name, v.price, v.stock, v.status AS variant_status,
            p.id AS product_id, p.slug, p.name, p.name_en, p.image, p.unit, p.status AS product_status
       FROM cart_items ci
       JOIN variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE ci.cart_id = ?
      ORDER BY ci.added_at ASC, ci.id ASC`,
    cartId
  );
}

function totalsFor(itemsTotalCents) {
  const threshold = config.freeShippingThresholdCents;
  const fee = config.shippingFeeCents;
  const shipping = itemsTotalCents <= 0 || itemsTotalCents >= threshold ? 0 : fee;
  return {
    shippingFeeCents: shipping,
    totalCents: itemsTotalCents + shipping,
    freeShippingThresholdCents: threshold,
    freeShippingGapCents: Math.max(0, threshold - itemsTotalCents)
  };
}

function cartOut(cart) {
  const rows = cartRows(cart.id);
  const items = rows.map((r) => {
    const available = r.variant_status === 'active' && r.product_status === 'active';
    const subtotal = r.price * r.qty;
    return {
      id: r.item_id,
      productId: r.product_id,
      slug: r.slug,
      name: r.name,
      nameEn: r.name_en,
      image: r.image,
      unit: r.unit,
      variantId: r.variant_id,
      variantName: r.variant_name,
      sku: r.sku,
      price: toYuan(r.price),
      priceCents: r.price,
      priceText: money(r.price),
      qty: r.qty,
      stock: r.stock,
      available,
      maxQty: Math.min(r.stock, 99),
      subtotal: toYuan(subtotal),
      subtotalCents: subtotal,
      subtotalText: money(subtotal)
    };
  });

  const itemsTotalCents = items.filter((i) => i.available).reduce((n, i) => n + i.subtotalCents, 0);
  const totals = totalsFor(itemsTotalCents);

  return {
    token: cart.token,
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    itemsTotal: toYuan(itemsTotalCents),
    itemsTotalCents,
    itemsTotalText: money(itemsTotalCents),
    shippingFee: toYuan(totals.shippingFeeCents),
    shippingFeeCents: totals.shippingFeeCents,
    shippingFeeText: money(totals.shippingFeeCents),
    total: toYuan(totals.totalCents),
    totalCents: totals.totalCents,
    totalText: money(totals.totalCents),
    freeShippingThreshold: toYuan(totals.freeShippingThresholdCents),
    freeShippingGap: toYuan(totals.freeShippingGapCents),
    freeShippingGapText: money(totals.freeShippingGapCents),
    updatedAt: cart.updated_at
  };
}

function touchCart(cartId) {
  getDb().run('UPDATE carts SET updated_at = ? WHERE id = ?', new Date().toISOString(), cartId);
}

/* ------------------------------------------------------------------ */
/* 订单                                                                */
/* ------------------------------------------------------------------ */

function orderItemsOf(orderIds) {
  if (!orderIds.length) return new Map();
  const db = getDb();
  const placeholders = orderIds.map(() => '?').join(',');
  const rows = db.all(`SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`, ...orderIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.order_id)) map.set(r.order_id, []);
    map.get(r.order_id).push(r);
  }
  return map;
}

module.exports = {
  variantsOf,
  getProductRow,
  getProduct,
  listProducts,
  findVariant,
  defaultVariant,
  ensureCart,
  cartRows,
  cartOut,
  totalsFor,
  touchCart,
  orderItemsOf
};
