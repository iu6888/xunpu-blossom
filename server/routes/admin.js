'use strict';

const { getDb } = require('../db');
const config = require('../config');
const repo = require('../repo');
const v = require('../lib/validate');
const { requireAdmin, checkPassword } = require('../lib/auth');
const { badRequest, notFound, conflict, send } = require('../lib/http');
const { orderOut, inquiryOut, money, toYuan, ORDER_STATUS, ORDER_FLOW, INQUIRY_STATUS, INQUIRY_TYPES, parseJson } = require('../lib/format');
const { maskPhone } = require('../lib/customer-auth');
const { dayKey, recentDays, hashPassword, verifyPassword } = require('../lib/security');

const ORDER_STATUS_KEYS = Object.keys(ORDER_STATUS);
const INQUIRY_STATUS_KEYS = Object.keys(INQUIRY_STATUS);
const INQUIRY_TYPE_KEYS = Object.keys(INQUIRY_TYPES);

function pagination(ctx, defaultLimit = 20) {
  const page = Math.max(1, Number(ctx.query.get('page')) || 1);
  const limit = Math.max(1, Math.min(100, Number(ctx.query.get('limit')) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function dateRange(ctx) {
  const from = ctx.query.get('from') || '';
  const to = ctx.query.get('to') || '';
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  return { from: valid(from) ? from : '', to: valid(to) ? to : '' };
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

function overview() {
  const db = getDb();
  const today = dayKey(new Date(), config.timezone);
  const days = recentDays(14, config.timezone);
  const weekStart = days[days.length - 7];
  const monthStart = recentDays(30, config.timezone)[0];

  const sumRevenue = (fromDay) =>
    db.get(
      "SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE status <> 'cancelled' AND day >= ?",
      fromDay
    );

  const todayRow = db.get(
    "SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE status <> 'cancelled' AND day = ?",
    today
  );
  const week = sumRevenue(weekStart);
  const month = sumRevenue(monthStart);

  const statusRows = db.all("SELECT status, COUNT(*) AS n FROM orders GROUP BY status");
  const statusCounts = Object.fromEntries(ORDER_STATUS_KEYS.map((k) => [k, 0]));
  for (const r of statusRows) statusCounts[r.status] = r.n;

  const seriesRows = db.all(
    `SELECT day, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
       FROM orders WHERE status <> 'cancelled' AND day >= ? GROUP BY day`,
    days[0]
  );
  const byDay = new Map(seriesRows.map((r) => [r.day, r]));
  const series = days.map((d) => {
    const hit = byDay.get(d);
    return {
      day: d,
      label: d.slice(5),
      orders: hit ? hit.orders : 0,
      revenue: hit ? toYuan(hit.revenue) : 0,
      revenueCents: hit ? hit.revenue : 0
    };
  });

  const topRows = db.all(
    `SELECT oi.name, oi.name_en AS nameEn, SUM(oi.qty) AS qty, SUM(oi.subtotal) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status <> 'cancelled' AND o.day >= ?
      GROUP BY oi.name ORDER BY qty DESC LIMIT 6`,
    monthStart
  );

  const lowStock = db.all(
    `SELECT v.id, v.sku, v.name AS variantName, v.stock, p.name AS productName, p.slug
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.status = 'active' AND p.status = 'active' AND v.stock <= 5
      ORDER BY v.stock ASC LIMIT 8`
  );

  const channelRows = db.all(
    `SELECT channel, COUNT(*) AS n, COALESCE(SUM(total), 0) AS revenue
       FROM orders WHERE status <> 'cancelled' AND day >= ? GROUP BY channel ORDER BY n DESC`,
    monthStart
  );

  const newInquiries = db.get("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'new'").n;
  const customerCount = db.get("SELECT COUNT(*) AS n FROM customers WHERE status = 'active'").n;
  const productCount = db.get("SELECT COUNT(*) AS n FROM products WHERE status = 'active'").n;
  const stockTotal = db.get("SELECT COALESCE(SUM(v.stock), 0) AS n FROM variants v JOIN products p ON p.id = v.product_id WHERE p.status = 'active'").n;

  const recent = db.all('SELECT * FROM orders ORDER BY id DESC LIMIT 6');
  const recentItems = repo.orderItemsOf(recent.map((r) => r.id));

  const validOrders = db.get(
    "SELECT COUNT(*) AS n FROM orders WHERE status <> 'cancelled' AND day >= ?",
    monthStart
  ).n;

  return {
    today: {
      day: today,
      orders: todayRow.orders,
      revenue: toYuan(todayRow.revenue),
      revenueText: money(todayRow.revenue)
    },
    week: { from: weekStart, orders: week.orders, revenue: toYuan(week.revenue), revenueText: money(week.revenue) },
    month: { from: monthStart, orders: month.orders, revenue: toYuan(month.revenue), revenueText: money(month.revenue) },
    avgOrderValue: validOrders ? toYuan(Math.round(month.revenue / validOrders)) : 0,
    pendingOrders: statusCounts.pending + statusCounts.confirmed,
    newInquiries,
    customerCount,
    productCount,
    stockTotal,
    statusCounts,
    series,
    topProducts: topRows.map((r) => ({
      name: r.name,
      nameEn: r.nameEn,
      qty: r.qty,
      revenue: toYuan(r.revenue),
      revenueText: money(r.revenue)
    })),
    channels: channelRows.map((r) => ({ channel: r.channel, orders: r.n, revenue: toYuan(r.revenue) })),
    lowStock: lowStock.map((r) => ({
      variantId: r.id,
      sku: r.sku,
      productName: r.productName,
      variantName: r.variantName,
      slug: r.slug,
      stock: r.stock
    })),
    recentOrders: recent.map((r) => orderOut(r, recentItems.get(r.id) || []))
  };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // BOM 让 Excel 正确识别 UTF-8
  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

module.exports = function register(router) {
  /* ---------- 概览 ---------- */
  router.get('/api/admin/overview', async (ctx) => {
    requireAdmin(ctx);
    return overview();
  });

  /* ---------- 订单 ---------- */
  router.get('/api/admin/orders', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const { page, limit, offset } = pagination(ctx);
    const { from, to } = dateRange(ctx);
    const status = ctx.query.get('status') || '';
    const q = (ctx.query.get('q') || '').trim();

    const where = [];
    const params = [];
    if (status && ORDER_STATUS_KEYS.includes(status)) {
      where.push('status = ?');
      params.push(status);
    }
    if (from) { where.push('day >= ?'); params.push(from); }
    if (to) { where.push('day <= ?'); params.push(to); }
    if (q) {
      where.push('(order_no LIKE ? OR customer_name LIKE ? OR phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.get(`SELECT COUNT(*) AS n FROM orders ${clause}`, ...params).n;
    const rows = db.all(`SELECT * FROM orders ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    const items = repo.orderItemsOf(rows.map((r) => r.id));

    return {
      items: rows.map((r) => orderOut(r, items.get(r.id) || [])),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit))
    };
  });

  router.get('/api/admin/orders/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('订单不存在');
    return { ...orderOut(row, repo.orderItemsOf([row.id]).get(row.id) || []), allowedStatus: ORDER_FLOW[row.status] || [] };
  });

  router.patch('/api/admin/orders/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('订单不存在');

    const body = ctx.body || {};
    const patch = [];
    const params = [];

    if (body.status !== undefined) {
      const next = v.oneOf(body.status, '订单状态', ORDER_STATUS_KEYS);
      if (next !== row.status) {
        const allowed = ORDER_FLOW[row.status] || [];
        if (!allowed.includes(next)) {
          throw conflict(`不能从「${ORDER_STATUS[row.status]}」直接改为「${ORDER_STATUS[next]}」`, {
            current: row.status,
            allowed
          });
        }
        // 取消：库存回滚
        if (next === 'cancelled') {
          const items = db.all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', row.id);
          for (const it of items) {
            if (it.variant_id) db.run('UPDATE variants SET stock = stock + ? WHERE id = ?', it.qty, it.variant_id);
          }
        }
        patch.push('status = ?');
        params.push(next);
        if (next === 'completed' || next === 'shipped') {
          patch.push('paid_at = COALESCE(paid_at, ?)');
          params.push(new Date().toISOString());
        }
      }
    }

    if (body.adminNote !== undefined) {
      patch.push('admin_note = ?');
      params.push(v.optStr(body.adminNote, '内部备注', { max: 500 }) || null);
    }

    if (body.payment !== undefined) {
      patch.push('payment = ?');
      params.push(v.oneOf(body.payment, '支付方式', ['offline', 'wechat', 'alipay', 'transfer', 'cash']));
    }

    if (body.customer !== undefined && body.customer && typeof body.customer === 'object') {
      const c = body.customer;
      if (c.name !== undefined) { patch.push('customer_name = ?'); params.push(v.str(c.name, '姓名', { max: 30 })); }
      if (c.phone !== undefined) { patch.push('phone = ?'); params.push(v.phone(c.phone)); }
      if (c.address !== undefined) { patch.push('address = ?'); params.push(v.optStr(c.address, '地址', { max: 200 }) || null); }
    }

    if (!patch.length) throw badRequest('没有需要更新的字段');

    patch.push('updated_at = ?');
    params.push(new Date().toISOString());
    db.run(`UPDATE orders SET ${patch.join(', ')} WHERE id = ?`, ...params, row.id);

    const fresh = db.get('SELECT * FROM orders WHERE id = ?', row.id);
    return { ...orderOut(fresh, repo.orderItemsOf([row.id]).get(row.id) || []), allowedStatus: ORDER_FLOW[fresh.status] || [] };
  });

  router.get('/api/admin/orders.csv', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const { from, to } = dateRange(ctx);
    const status = ctx.query.get('status') || '';

    const where = [];
    const params = [];
    if (status && ORDER_STATUS_KEYS.includes(status)) { where.push('status = ?'); params.push(status); }
    if (from) { where.push('day >= ?'); params.push(from); }
    if (to) { where.push('day <= ?'); params.push(to); }

    const rows = db.all(
      `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`,
      ...params
    );
    const items = repo.orderItemsOf(rows.map((r) => r.id));

    const data = rows.map((r) => {
      const list = (items.get(r.id) || []).map((i) => `${i.name}/${i.variant_name}×${i.qty}`).join(' | ');
      return [
        r.order_no,
        r.day,
        ORDER_STATUS[r.status] || r.status,
        r.customer_name,
        r.phone,
        [r.province, r.city, r.district, r.address].filter(Boolean).join(' '),
        list,
        (r.items_total / 100).toFixed(2),
        (r.shipping_fee / 100).toFixed(2),
        (r.total / 100).toFixed(2),
        r.channel,
        r.fulfillment,
        r.note || '',
        r.admin_note || ''
      ];
    });

    const csv = toCsv(
      ['订单号', '日期', '状态', '收货人', '手机号', '地址', '商品明细', '商品金额', '运费', '合计', '来源', '交付方式', '买家备注', '内部备注'],
      data
    );
    send(ctx.res, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Length': String(csv.length),
      'Content-Disposition': `attachment; filename="xunpu-orders-${dayKey(new Date(), config.timezone)}.csv"`,
      'Cache-Control': 'no-store'
    }, csv);
    return undefined;
  });

  /* ---------- 商品 ---------- */
  router.get('/api/admin/products', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const rows = db.all('SELECT * FROM products ORDER BY sort_order, id');
    return {
      items: rows.map((r) => {
        const variants = repo.variantsOf(r.id, { includeInactive: true });
        return {
          ...repo.getProduct(r.slug),
          variants: variants.map((x) => ({
            id: x.id,
            sku: x.sku,
            name: x.name,
            price: toYuan(x.price),
            priceCents: x.price,
            priceText: money(x.price),
            stock: x.stock,
            status: x.status
          }))
        };
      })
    };
  });

  router.post('/api/admin/products', async (ctx) => {
    requireAdmin(ctx);
    ctx.status = 201;
    const body = ctx.body || {};
    const db = getDb();

    const name = v.str(body.name, '商品名称', { max: 60 });
    const slug = (v.optStr(body.slug, '商品标识', { max: 40 }) || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `item-${Date.now()}`;

    if (db.get('SELECT id FROM products WHERE slug = ?', slug)) throw conflict(`标识「${slug}」已被占用`);

    const category = v.oneOf(body.category, '分类', ['wear', 'scent', 'textile', 'object', 'gift']);
    const variants = v.array(body.variants, '规格', { min: 1, max: 20 });
    const parsed = variants.map((x, i) => ({
      sku: v.optStr(x.sku, 'SKU', { max: 40 }) || `XB-${slug.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
      name: v.str(x.name, '规格名称', { max: 40 }),
      price: v.yuanToCents(x.price, '价格'),
      stock: v.int(x.stock, '库存', { min: 0, max: 999999, fallback: 0 }),
      sort_order: i
    }));
    if (new Set(parsed.map((p) => p.sku)).size !== parsed.length) throw badRequest('SKU 不能重复');

    const now = new Date().toISOString();
    const priceFrom = Math.min(...parsed.map((p) => p.price));

    const id = db.tx(() => {
      const res = db.run(
        `INSERT INTO products
          (slug, name, name_en, category, categories, tagline, description, specs, badges, image, unit,
           price_from, is_limited, featured, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', ?, ?, ?)`,
        slug,
        name,
        v.optStr(body.nameEn, '英文名', { max: 80 }) || '',
        category,
        JSON.stringify(Array.isArray(body.categories) && body.categories.length ? body.categories : [category]),
        v.optStr(body.tagline, '卖点', { max: 200 }) || '',
        v.optStr(body.description, '描述', { max: 2000 }) || '',
        JSON.stringify(Array.isArray(body.specs) ? body.specs.slice(0, 20) : []),
        JSON.stringify(Array.isArray(body.badges) ? body.badges.slice(0, 10) : []),
        v.optStr(body.image, '主图', { max: 200 }) || '',
        v.optStr(body.unit, '单位', { max: 10 }) || '件',
        priceFrom,
        v.int(body.sortOrder, '排序', { min: 0, max: 9999, fallback: 99 }),
        now,
        now
      );
      for (const p of parsed) {
        db.run(
          'INSERT INTO variants (product_id, sku, name, price, stock, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          res.lastInsertRowid,
          p.sku,
          p.name,
          p.price,
          p.stock,
          p.sort_order
        );
      }
      return res.lastInsertRowid;
    });

    return repo.getProduct(id);
  });

  router.patch('/api/admin/products/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM products WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('商品不存在');

    const body = ctx.body || {};
    const map = {
      name: ['name', (x) => v.str(x, '商品名称', { max: 60 })],
      nameEn: ['name_en', (x) => v.optStr(x, '英文名', { max: 80 }) || ''],
      tagline: ['tagline', (x) => v.optStr(x, '卖点', { max: 200 }) || ''],
      description: ['description', (x) => v.optStr(x, '描述', { max: 2000 }) || ''],
      image: ['image', (x) => v.optStr(x, '主图', { max: 200 }) || ''],
      unit: ['unit', (x) => v.optStr(x, '单位', { max: 10 }) || '件'],
      category: ['category', (x) => v.oneOf(x, '分类', ['wear', 'scent', 'textile', 'object', 'gift'])],
      status: ['status', (x) => v.oneOf(x, '状态', ['active', 'archived'])],
      sortOrder: ['sort_order', (x) => v.int(x, '排序', { min: 0, max: 9999 })],
      featured: ['featured', (x) => (v.boolean(x, '主推') ? 1 : 0)],
      isLimited: ['is_limited', (x) => (v.boolean(x, '限量') ? 1 : 0)]
    };

    const patch = [];
    const params = [];
    for (const [key, [column, cast]] of Object.entries(map)) {
      if (body[key] === undefined) continue;
      patch.push(`${column} = ?`);
      params.push(cast(body[key]));
    }
    if (body.categories !== undefined) {
      patch.push('categories = ?');
      params.push(JSON.stringify(Array.isArray(body.categories) ? body.categories : []));
    }
    if (body.specs !== undefined) {
      patch.push('specs = ?');
      params.push(JSON.stringify(Array.isArray(body.specs) ? body.specs.slice(0, 20) : []));
    }
    if (body.badges !== undefined) {
      patch.push('badges = ?');
      params.push(JSON.stringify(Array.isArray(body.badges) ? body.badges.slice(0, 10) : []));
    }
    if (!patch.length) throw badRequest('没有需要更新的字段');

    patch.push('updated_at = ?');
    params.push(new Date().toISOString());
    db.run(`UPDATE products SET ${patch.join(', ')} WHERE id = ?`, ...params, row.id);

    // 价格下限跟随最低变体价
    const min = db.get('SELECT MIN(price) AS p FROM variants WHERE product_id = ?', row.id).p;
    if (min) db.run('UPDATE products SET price_from = ? WHERE id = ?', min, row.id);

    return repo.getProduct(row.id);
  });

  router.del('/api/admin/products/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM products WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('商品不存在');
    // 归档而非物理删除，保住历史订单快照
    db.run("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?", new Date().toISOString(), row.id);
    return { id: row.id, status: 'archived' };
  });

  /** 库存 / 价格 / 上下架 */
  router.patch('/api/admin/variants/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM variants WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('规格不存在');

    const body = ctx.body || {};
    const patch = [];
    const params = [];
    if (body.stock !== undefined) { patch.push('stock = ?'); params.push(v.int(body.stock, '库存', { min: 0, max: 999999 })); }
    if (body.price !== undefined) { patch.push('price = ?'); params.push(v.yuanToCents(body.price, '价格')); }
    if (body.name !== undefined) { patch.push('name = ?'); params.push(v.str(body.name, '规格名称', { max: 40 })); }
    if (body.status !== undefined) { patch.push('status = ?'); params.push(v.oneOf(body.status, '状态', ['active', 'archived'])); }
    if (!patch.length) throw badRequest('没有需要更新的字段');

    db.run(`UPDATE variants SET ${patch.join(', ')} WHERE id = ?`, ...params, row.id);
    const min = db.get('SELECT MIN(price) AS p FROM variants WHERE product_id = ? AND status = ?', row.product_id, 'active').p;
    if (min) db.run('UPDATE products SET price_from = ? WHERE id = ?', min, row.product_id);

    const fresh = db.get('SELECT * FROM variants WHERE id = ?', row.id);
    return { id: fresh.id, sku: fresh.sku, name: fresh.name, price: toYuan(fresh.price), stock: fresh.stock, status: fresh.status };
  });

  /* ---------- 询价 ---------- */
  router.get('/api/admin/inquiries', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const { page, limit, offset } = pagination(ctx);
    const status = ctx.query.get('status') || '';
    const type = ctx.query.get('type') || '';

    const where = [];
    const params = [];
    if (status && INQUIRY_STATUS_KEYS.includes(status)) { where.push('status = ?'); params.push(status); }
    if (type && INQUIRY_TYPE_KEYS.includes(type)) { where.push('type = ?'); params.push(type); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.get(`SELECT COUNT(*) AS n FROM inquiries ${clause}`, ...params).n;
    const rows = db.all(`SELECT * FROM inquiries ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);

    return {
      items: rows.map(inquiryOut),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit))
    };
  });

  router.patch('/api/admin/inquiries/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM inquiries WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('询价记录不存在');

    const body = ctx.body || {};
    const patch = [];
    const params = [];
    if (body.status !== undefined) { patch.push('status = ?'); params.push(v.oneOf(body.status, '状态', INQUIRY_STATUS_KEYS)); }
    if (body.adminNote !== undefined) { patch.push('admin_note = ?'); params.push(v.optStr(body.adminNote, '内部备注', { max: 500 }) || null); }
    if (!patch.length) throw badRequest('没有需要更新的字段');

    patch.push('updated_at = ?');
    params.push(new Date().toISOString());
    db.run(`UPDATE inquiries SET ${patch.join(', ')} WHERE id = ?`, ...params, row.id);
    return inquiryOut(db.get('SELECT * FROM inquiries WHERE id = ?', row.id));
  });

  /* ---------- 站点文案 ---------- */
  router.get('/api/admin/content', async (ctx) => {
    requireAdmin(ctx);
    const rows = getDb().all('SELECT key, value, updated_at FROM content ORDER BY key');
    return {
      items: rows.map((r) => ({ key: r.key.replace(/^site\./, ''), value: parseJson(r.value, null), updatedAt: r.updated_at }))
    };
  });

  router.put('/api/admin/content/:key', async (ctx) => {
    requireAdmin(ctx);
    const key = `site.${ctx.params.key}`;
    if (ctx.body?.value === undefined) throw badRequest('缺少 value 字段');
    const db = getDb();
    const exists = db.get('SELECT key FROM content WHERE key = ?', key);
    const payload = JSON.stringify(ctx.body.value);
    if (payload.length > 20000) throw badRequest('文案内容过大');
    if (exists) db.run('UPDATE content SET value = ?, updated_at = ? WHERE key = ?', payload, new Date().toISOString(), key);
    else db.run('INSERT INTO content (key, value, updated_at) VALUES (?, ?, ?)', key, payload, new Date().toISOString());
    return { key: ctx.params.key, value: ctx.body.value };
  });

  /* ---------- 顾客 ---------- */
  router.get('/api/admin/customers', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const { page, limit, offset } = pagination(ctx);
    const q = (ctx.query.get('q') || '').trim();

    const where = [];
    const params = [];
    if (q) {
      where.push('(phone LIKE ? OR nickname LIKE ? OR email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.get(`SELECT COUNT(*) AS n FROM customers ${clause}`, ...params).n;
    const rows = db.all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o
                WHERE o.customer_id = c.id AND o.status <> 'cancelled') AS spent
         FROM customers c ${clause} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        phone: r.phone,
        phoneMasked: maskPhone(r.phone),
        nickname: r.nickname,
        email: r.email || '',
        status: r.status,
        orders: r.orders_count,
        spent: toYuan(r.spent),
        spentText: money(r.spent),
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit))
    };
  });

  router.patch('/api/admin/customers/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM customers WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('顾客不存在');

    const status = v.oneOf(ctx.body?.status, '状态', ['active', 'disabled']);
    db.run('UPDATE customers SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), row.id);
    if (status === 'disabled') db.run('DELETE FROM customer_sessions WHERE customer_id = ?', row.id);
    return { id: row.id, status };
  });

  router.del('/api/admin/customers/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM customers WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('顾客不存在');

    const orders = db.get('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', row.id).n;
    if (orders > 0) {
      throw conflict(`该顾客有 ${orders} 笔订单，不能直接删除。请改为「停用」，或先在订单里清理。`);
    }
    db.run('DELETE FROM customers WHERE id = ?', row.id);
    return { id: row.id, deleted: true };
  });

  /* ---------- 删除无用数据 ---------- */

  /** 未发货的订单删除时把库存还回去 */
  function restoreStock(orderId) {
    const db = getDb();
    const items = db.all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', orderId);
    for (const it of items) {
      if (it.variant_id) db.run('UPDATE variants SET stock = stock + ? WHERE id = ?', it.qty, it.variant_id);
    }
  }

  router.del('/api/admin/orders/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('订单不存在');

    db.tx(() => {
      if (['pending', 'confirmed', 'producing'].includes(row.status)) restoreStock(row.id);
      db.run('DELETE FROM order_items WHERE order_id = ?', row.id);
      db.run('DELETE FROM orders WHERE id = ?', row.id);
    });

    return { id: row.id, orderNo: row.order_no, deleted: true, stockRestored: ['pending', 'confirmed', 'producing'].includes(row.status) };
  });

  router.del('/api/admin/inquiries/:id', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const row = db.get('SELECT * FROM inquiries WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('询价记录不存在');
    db.run('DELETE FROM inquiries WHERE id = ?', row.id);
    return { id: row.id, deleted: true };
  });

  /**
   * 批量清理无用数据。
   * body: { target: 'orders' | 'inquiries' | 'customers' | 'all', confirm: '清空' }
   */
  router.post('/api/admin/data/clear', async (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const body = ctx.body || {};
    const target = v.oneOf(body.target, '清理对象', ['orders', 'inquiries', 'customers', 'all']);
    if (String(body.confirm || '').trim() !== '清空') {
      throw badRequest('请输入「清空」以确认操作', { field: 'confirm' });
    }

    const counts = { orders: 0, inquiries: 0, customers: 0, carts: 0 };

    db.tx(() => {
      if (target === 'orders' || target === 'all') {
        const rows = db.all("SELECT id, status FROM orders WHERE status IN ('pending','confirmed','producing')");
        for (const r of rows) restoreStock(r.id);
        counts.orders = db.get('SELECT COUNT(*) AS n FROM orders').n;
        db.run('DELETE FROM order_items');
        db.run('DELETE FROM orders');
        db.run("UPDATE counters SET value = 0 WHERE name LIKE 'order:%'");
      }

      if (target === 'inquiries' || target === 'all') {
        counts.inquiries = db.get('SELECT COUNT(*) AS n FROM inquiries').n;
        db.run('DELETE FROM inquiries');
      }

      if (target === 'customers' || target === 'all') {
        counts.customers = db.get('SELECT COUNT(*) AS n FROM customers').n;
        db.run('DELETE FROM customer_sessions');
        db.run('UPDATE orders SET customer_id = NULL');
        db.run('DELETE FROM customers');
      }

      if (target === 'all') {
        counts.carts = db.get('SELECT COUNT(*) AS n FROM carts').n;
        db.run('DELETE FROM cart_items');
        db.run('DELETE FROM carts');
      }
    });

    return { cleared: counts, target };
  });

  /* ---------- 账号 ---------- */
  router.post('/api/admin/password', async (ctx) => {
    const user = requireAdmin(ctx);
    const body = ctx.body || {};
    const current = v.str(body.current, '当前密码', { max: 100 });
    const next = v.str(body.next, '新密码', { min: 8, max: 100 });

    const db = getDb();
    const row = db.get('SELECT * FROM users WHERE id = ?', user.id);
    // 用主密码或任一备用密码都可以作为「当前密码」
    if (!checkPassword(row, current).ok) throw badRequest('当前密码不正确', { field: 'current' });

    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
    // 其他会话失效
    db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', user.id, user.sessionId);
    return { updated: true };
  });

  /* ---------- 备用密码 ----------
     同一个管理员账号可以有多个可用密码，主密码在 users.password_hash，
     备用密码在 user_passwords，登录时两者都接受。
     场景：平时用强密码，应急时用记熟的短密码。                        */

  const MAX_ALT_PASSWORDS = 5;

  router.get('/api/admin/passwords', async (ctx) => {
    const user = requireAdmin(ctx);
    const db = getDb();
    const rows = db.all(
      'SELECT id, label, created_at, last_used_at FROM user_passwords WHERE user_id = ? ORDER BY id',
      user.id
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at
      })),
      max: MAX_ALT_PASSWORDS
    };
  });

  router.post('/api/admin/passwords', async (ctx) => {
    const user = requireAdmin(ctx);
    const body = ctx.body || {};
    const current = v.str(body.current, '当前密码', { max: 100 });
    // 备用密码放宽到 4 位，方便设一个应急短密码
    const password = v.str(body.password, '备用密码', { min: 4, max: 100 });
    const label = body.label ? v.str(body.label, '备注', { max: 30 }) : '备用密码';

    const db = getDb();
    const row = db.get('SELECT * FROM users WHERE id = ?', user.id);
    if (!checkPassword(row, current).ok) throw badRequest('当前密码不正确', { field: 'current' });

    const count = db.get('SELECT COUNT(*) AS n FROM user_passwords WHERE user_id = ?', user.id).n;
    if (count >= MAX_ALT_PASSWORDS) throw conflict(`备用密码最多 ${MAX_ALT_PASSWORDS} 个，请先删掉不用的`);

    if (checkPassword(row, password).ok) throw badRequest('这个密码已经能登录了，换一个', { field: 'password' });

    db.run(
      'INSERT INTO user_passwords (user_id, password_hash, label, created_at) VALUES (?, ?, ?, ?)',
      user.id,
      hashPassword(password),
      label,
      new Date().toISOString()
    );
    return { created: true };
  }, { status: 201 });

  router.del('/api/admin/passwords/:id', async (ctx) => {
    const user = requireAdmin(ctx);
    const db = getDb();
    const res = db.run(
      'DELETE FROM user_passwords WHERE id = ? AND user_id = ?',
      Number(ctx.params.id),
      user.id
    );
    if (!res.changes) throw notFound('备用密码不存在');
    return { deleted: true };
  });
};
