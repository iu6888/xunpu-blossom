'use strict';

/**
 * 优惠券：花间游戏完成奖励 + 结算核销。
 *
 * 规则：
 *  - 同一玩家（登录顾客按 customer_id，游客按昵称）同一游戏每天最多 1 张
 *  - 同一 IP / 同一顾客每天最多 3 张，避免脚本刷券
 *  - 券码只存明文（需要给顾客看），但不含任何个人信息，8 位随机字符
 */

const crypto = require('node:crypto');
const config = require('../config');
const { money } = require('./format');
const { badRequest, conflict, notFound } = require('./http');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^XB[A-Z2-9]{8}$/;

const GAME_LABELS = {
  puzzle: '拼图 · 复原花冠',
  memory: '翻卡片 · 花签配对',
  spot: '找不同 · 两座花园',
  zanhua: '簪花 · 头顶花园',
  market: '配花 · 花市清晨',
  pattern: '方巾纹样 · 半城红',
  nanyin: '南音 · 节拍',
  lantern: '花灯 · 点灯',
  porcelain: '德化瓷 · 拉坯'
};

function normalize(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function newCode() {
  const bytes = crypto.randomBytes(8);
  let out = 'XB';
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 过期状态是算出来的，不依赖后台定时任务 */
function effectiveStatus(row, now = Date.now()) {
  if (row.status === 'active' && Date.parse(row.expires_at) <= now) return 'expired';
  return row.status;
}

function toPublic(row, now = Date.now()) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    amount: Math.round(row.amount) / 100,
    amountCents: row.amount,
    amountText: money(row.amount),
    minSpend: Math.round(row.min_spend) / 100,
    minSpendCents: row.min_spend,
    minSpendText: money(row.min_spend),
    status: effectiveStatus(row, now),
    source: row.source,
    game: row.game || null,
    gameLabel: row.game ? (GAME_LABELS[row.game] || row.game) : '',
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    usedAt: row.used_at || null
  };
}

/**
 * 完成一局游戏后发券。
 * 返回 { coupon, alreadyClaimed, note }；coupon 为 null 表示今日额度已满。
 */
function issueGameReward({ db, game, playerKey, customerId, ip, day, now = new Date() }) {
  const cfg = config.coupon;
  const nowIso = now.toISOString();

  const existing = db.get(
    "SELECT * FROM coupons WHERE source = 'game' AND game = ? AND player_key = ? AND day = ?",
    game,
    playerKey,
    day
  );
  if (existing) {
    return { coupon: toPublic(existing, now.getTime()), alreadyClaimed: true, note: '今天的这一局奖励已经领过，券码还能继续用。' };
  }

  if (ip) {
    const ipCount = db.get(
      "SELECT COUNT(*) AS n FROM coupons WHERE source = 'game' AND ip = ? AND day = ?",
      ip,
      day
    ).n;
    if (ipCount >= cfg.gameDailyPerIp) {
      return {
        coupon: null,
        alreadyClaimed: false,
        note: `同一网络今天最多领 ${cfg.gameDailyPerIp} 张游戏券，明天再来。`
      };
    }
  }

  if (customerId) {
    const mine = db.get(
      "SELECT COUNT(*) AS n FROM coupons WHERE source = 'game' AND customer_id = ? AND day = ?",
      customerId,
      day
    ).n;
    if (mine >= cfg.gameDailyPerIp) {
      return {
        coupon: null,
        alreadyClaimed: false,
        note: `今天已经领了 ${cfg.gameDailyPerIp} 张游戏券，先用掉再来。`
      };
    }
  }

  const expiresAt = new Date(now.getTime() + cfg.gameTtlDays * 86400_000).toISOString();
  const title = `花间游戏券 · ${GAME_LABELS[game] || game}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    try {
      const res = db.run(
        `INSERT INTO coupons
          (code, title, amount, min_spend, status, source, game, player_key, customer_id, ip, day, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'active', 'game', ?, ?, ?, ?, ?, ?, ?)`,
        code,
        title,
        cfg.gameAmountCents,
        cfg.gameMinSpendCents,
        game,
        playerKey,
        customerId || null,
        ip || null,
        day,
        expiresAt,
        nowIso
      );
      const row = db.get('SELECT * FROM coupons WHERE id = ?', res.lastInsertRowid);
      return { coupon: toPublic(row, now.getTime()), alreadyClaimed: false, note: '' };
    } catch (err) {
      // 券码碰撞或同一天并发领取：后一种情况直接返回已有的那张
      const dup = db.get(
        "SELECT * FROM coupons WHERE source = 'game' AND game = ? AND player_key = ? AND day = ?",
        game,
        playerKey,
        day
      );
      if (dup) {
        return { coupon: toPublic(dup, now.getTime()), alreadyClaimed: true, note: '今天的这一局奖励已经领过，券码还能继续用。' };
      }
      if (!/UNIQUE|constraint/i.test(String(err && err.message))) throw err;
    }
  }

  return { coupon: null, alreadyClaimed: false, note: '券码生成失败，请稍后再试。' };
}

/**
 * 校验券是否可用（不核销）。
 * @returns {{ row: object, discountCents: number }}
 */
function inspect(db, rawCode, { itemsTotalCents, customerId, now = Date.now() } = {}) {
  const code = normalize(rawCode);
  if (!CODE_RE.test(code)) throw badRequest('券码格式不正确，请检查后重试', { field: 'couponCode' });

  const row = db.get('SELECT * FROM coupons WHERE code = ?', code);
  if (!row) throw notFound('没有找到这张券，请检查券码');

  const status = effectiveStatus(row, now);
  if (status === 'used') throw conflict('这张券已经使用过了');
  if (status === 'void') throw conflict('这张券已作废');
  if (status === 'expired') throw conflict('这张券已过期');

  if (row.customer_id && row.customer_id !== customerId) {
    throw conflict('这张券只能由领取它的账号使用');
  }

  const total = Number(itemsTotalCents) || 0;
  if (total < row.min_spend) {
    throw conflict(`还差 ${money(row.min_spend - total)} 可用这张券`, {
      minSpendCents: row.min_spend,
      gapCents: row.min_spend - total
    });
  }

  return { row, discountCents: Math.min(row.amount, total) };
}

/** 核销：条件更新，防止同一张券并发用两次 */
function markUsed(db, couponId, orderId, nowIso) {
  const res = db.run(
    "UPDATE coupons SET status = 'used', used_at = ?, order_id = ? WHERE id = ? AND status = 'active'",
    nowIso,
    orderId,
    couponId
  );
  if (!res.changes) throw conflict('这张券刚刚被使用过了，请换一张');
  return true;
}

module.exports = {
  CODE_RE,
  GAME_LABELS,
  normalize,
  toPublic,
  effectiveStatus,
  issueGameReward,
  inspect,
  markUsed
};
