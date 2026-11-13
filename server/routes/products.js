'use strict';

const repo = require('../repo');
const { notFound } = require('../lib/http');
const { getDb } = require('../db');
const { dayKey } = require('../lib/security');
const config = require('../config');
const { CATEGORIES } = require('../db/seed');

function logEvent(type, ref) {
  try {
    const now = new Date();
    getDb().run(
      'INSERT INTO events (type, ref, day, created_at) VALUES (?, ?, ?, ?)',
      type,
      ref || null,
      dayKey(now, config.timezone),
      now.toISOString()
    );
  } catch {
    /* 埋点失败不影响主流程 */
  }
}

module.exports = function register(router) {
  /** 商品列表：?category=wear&q=&sort=featured|price_asc|price_desc|newest&page=1&limit=24&featured=1 */
  router.get('/api/products', async (ctx) => {
    const result = repo.listProducts({
      category: ctx.query.get('category') || '',
      q: (ctx.query.get('q') || '').slice(0, 60),
      sort: ctx.query.get('sort') || 'featured',
      page: Number(ctx.query.get('page')) || 1,
      limit: Number(ctx.query.get('limit')) || 24,
      featuredOnly: ctx.query.get('featured') === '1'
    });
    return result;
  });

  /** 商品详情 */
  router.get('/api/products/:slug', async (ctx) => {
    const product = repo.getProduct(ctx.params.slug);
    if (!product || product.status !== 'active') throw notFound('商品不存在或已下架');
    logEvent('product_view', product.slug);
    return product;
  });

  /** 分类列表（含在售数量） */
  router.get('/api/categories', async (ctx) => {
    const all = repo.listProducts({ limit: 100 }).items;
    return CATEGORIES.map((c) => ({
      ...c,
      count: all.filter((p) => p.categories.includes(c.key)).length
    }));
  });

  /** 站点公开信息：品牌、运费规则、公告 */
  router.get('/api/meta', async (ctx) => {
    return {
      brand: config.brand,
      shipping: {
        fee: config.shippingFeeCents / 100,
        feeText: `¥${config.shippingFeeCents / 100}`,
        freeThreshold: config.freeShippingThresholdCents / 100,
        freeThresholdText: `¥${config.freeShippingThresholdCents / 100}`
      },
      orderStatus: {
        pending: '待处理',
        confirmed: '已确认',
        producing: '生产中',
        shipped: '已发货',
        completed: '已完成',
        cancelled: '已取消'
      },
      inquiryTypes: {
        coop: '合作洽谈',
        batch: '批量定制',
        trial: '试戴预约',
        press: '媒体 / 图库授权'
      }
    };
  });
};
