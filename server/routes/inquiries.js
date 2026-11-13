'use strict';

const { getDb } = require('../db');
const config = require('../config');
const v = require('../lib/validate');
const { dayKey } = require('../lib/security');
const { conflict, badRequest } = require('../lib/http');
const { inquiryOut } = require('../lib/format');

const TYPE_KEYS = ['coop', 'batch', 'trial', 'press'];

/** 同一 IP 10 分钟内最多 5 条询价，防刷 */
const recent = new Map();
const WINDOW = 10 * 60 * 1000;
const LIMIT = 5;

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of recent) if (now > rec.resetAt) recent.delete(ip);
}, 5 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

function checkQuota(ip) {
  const now = Date.now();
  const rec = recent.get(ip);
  if (!rec || now > rec.resetAt) {
    recent.set(ip, { count: 1, resetAt: now + WINDOW });
    return true;
  }
  rec.count += 1;
  return rec.count <= LIMIT;
}

module.exports = function register(router) {
  /** 提交合作 / 定制 / 试戴 / 授权询问 */
  router.post('/api/inquiries', async (ctx) => {
    ctx.status = 201;
    const body = ctx.body || {};

    // 蜜罐字段：正常用户看不到，机器人会填
    const isBot = !!(body.website || body.url || body.companyUrl);
    if (isBot) return { id: null, received: true };

    if (!checkQuota(ctx.ip)) {
      throw conflict('提交过于频繁，请 10 分钟后再试，或直接致电品牌电话');
    }

    const type = v.oneOf(body.type, '咨询类型', TYPE_KEYS, 'coop');
    const name = v.str(body.name, '称呼', { min: 1, max: 30 });
    const phone = v.phone(body.phone, '手机号');
    const email = v.email(body.email, '邮箱');
    const company = v.optStr(body.company, '公司 / 机构', { max: 60 });
    const qty = body.qty === undefined || body.qty === '' ? null : v.int(body.qty, '数量', { min: 1, max: 100000 });
    const budget = v.optStr(body.budget, '预算区间', { max: 40 });

    let message = v.optStr(body.message, '具体需求', { max: 1000 });
    if (['coop', 'batch'].includes(type) && (!message || message.length < 5)) {
      throw v.str(message, '具体需求（至少 5 个字）', { min: 5, max: 1000 });
    }

    if (type === 'batch' && !qty) {
      throw badRequest('批量定制请填写预计数量（50 套起）', { field: 'qty' });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const db = getDb();
    const res = db.run(
      `INSERT INTO inquiries (type, name, phone, email, company, qty, budget, message, status, day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
      type,
      name,
      phone,
      email || null,
      company || null,
      qty,
      budget || null,
      message || null,
      dayKey(now, config.timezone),
      nowIso,
      nowIso
    );

    const row = db.get('SELECT * FROM inquiries WHERE id = ?', res.lastInsertRowid);
    return {
      ...inquiryOut(row),
      replyTip: '我们会在 1 个工作日内联系你。批量定制 50 套起，可提供 BOM 与阶梯报价。'
    };
  });
};
