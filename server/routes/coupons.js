'use strict';

const { getDb } = require('../db');
const repo = require('../repo');
const ca = require('../lib/customer-auth');
const { resolveCart } = require('../lib/session');
const { money } = require('../lib/format');
const { normalize, toPublic, effectiveStatus, inspect, CODE_RE } = require('../lib/coupons');
const v = require('../lib/validate');

/** 游客的设备券码：从查询串或请求头读取，最多 12 个 */
function guestCodes(ctx) {
  const raw = ctx.query.get('codes') || ctx.headers['x-coupon-codes'] || '';
  const list = String(raw).split(/[,\s]+/).map(normalize).filter(Boolean);
  return [...new Set(list)].filter((c) => CODE_RE.test(c)).slice(0, 12);
}

function currentItemsTotalCents(ctx) {
  const cart = resolveCart(ctx, { create: false });
  if (!cart) return 0;
  return repo.cartOut(cart).itemsTotalCents;
}

module.exports = function register(router) {
  /**
   * 我的券。
   * - 登录顾客：按账号取全部券（含已用 / 过期，便于回看）
   * - 游客：用查询串 codes=XB... 或请求头 X-Coupon-Codes 取本机保存的券码
   */
  router.get('/api/coupons', async (ctx) => {
    const db = getDb();
    const now = Date.now();
    let rows = [];

    if (ctx.customer) {
      rows = db.all(
        'SELECT * FROM coupons WHERE customer_id = ? ORDER BY id DESC LIMIT 100',
        ctx.customer.id
      );
    } else {
      const codes = guestCodes(ctx);
      if (codes.length) {
        rows = db.all(
          `SELECT * FROM coupons WHERE code IN (${codes.map(() => '?').join(',')}) ORDER BY id DESC`,
          ...codes
        );
      }
    }

    const items = rows.map((r) => toPublic(r, now));
    const active = items.filter((c) => c.status === 'active');
    return {
      items,
      summary: {
        total: items.length,
        active: active.length,
        usableValueCents: active.reduce((n, c) => n + Math.max(0, c.amountCents), 0),
        usableValueText: money(active.reduce((n, c) => n + Math.max(0, c.amountCents), 0))
      },
      signedIn: !!ctx.customer
    };
  });

  /** 结算前试算：只校验不核销，返回可抵扣金额与用券后应付 */
  router.post('/api/coupons/check', async (ctx) => {
    const body = ctx.body || {};
    const code = v.str(body.couponCode, '券码', { min: 6, max: 20 });
    const db = getDb();

    let itemsTotalCents;
    if (body.itemsTotalCents !== undefined && body.itemsTotalCents !== null && body.itemsTotalCents !== '') {
      itemsTotalCents = v.int(body.itemsTotalCents, '商品合计', { min: 0, max: 100_000_000 });
    } else {
      itemsTotalCents = currentItemsTotalCents(ctx);
    }

    const { row, discountCents } = inspect(db, code, {
      itemsTotalCents,
      customerId: ctx.customer ? ctx.customer.id : null,
      now: Date.now()
    });

    const thresholdHit = itemsTotalCents >= row.min_spend;
    const totalAfterCents = Math.max(0, itemsTotalCents - discountCents);
    return {
      coupon: { ...toPublic(row, Date.now()), status: effectiveStatus(row, Date.now()) },
      itemsTotalCents,
      itemsTotalText: money(itemsTotalCents),
      discountCents,
      discountText: money(discountCents),
      totalAfterCents,
      totalAfterText: money(totalAfterCents),
      thresholdHit,
      note: thresholdHit ? `已抵扣 ${money(discountCents)}` : '还没有达到使用门槛'
    };
  });
};

module.exports.guestCodes = guestCodes;
