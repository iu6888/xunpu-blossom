'use strict';

const { getDb } = require('../db');
const { notFound } = require('../lib/http');
const { parseJson } = require('../lib/format');

/** 只暴露白名单内的公开文案键 */
const PUBLIC_KEYS = ['site.contact', 'site.stats', 'site.timeline', 'site.palette', 'site.notice', 'site.shipping'];

module.exports = function register(router) {
  /** 全部公开文案 */
  router.get('/api/content', async () => {
    const db = getDb();
    const rows = db.all('SELECT key, value, updated_at FROM content');
    const out = {};
    for (const r of rows) {
      if (!PUBLIC_KEYS.includes(r.key)) continue;
      out[r.key.replace(/^site\./, '')] = parseJson(r.value, null);
    }
    return out;
  });

  /** 单个文案键，如 /api/content/timeline */
  router.get('/api/content/:key', async (ctx) => {
    const key = `site.${ctx.params.key}`;
    if (!PUBLIC_KEYS.includes(key)) throw notFound('文案不存在');
    const row = getDb().get('SELECT key, value, updated_at FROM content WHERE key = ?', key);
    if (!row) throw notFound('文案不存在');
    return { key: ctx.params.key, value: parseJson(row.value, null), updatedAt: row.updated_at };
  });
};
