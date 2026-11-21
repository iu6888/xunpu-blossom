'use strict';

const { getDb } = require('../db');
const config = require('../config');
const ca = require('../lib/customer-auth');
const v = require('../lib/validate');
const { badRequest, tooMany } = require('../lib/http');
const { dayKey } = require('../lib/security');
const { issueGameReward } = require('../lib/coupons');

/**
 * 花间游戏 · 排行榜
 *
 * 九个小游戏共用一个战绩表，排名规则一律是「用时短的在前，同样用时步数少的在前」。
 * 同一个人（登录顾客按 customer_id，游客按昵称去重）只取自己的最好成绩上榜。
 */

const GAMES = {
  puzzle: { label: '拼图', minSeconds: 2, maxSeconds: 3600, minMoves: 1, maxMoves: 999 },
  memory: { label: '翻卡片', minSeconds: 5, maxSeconds: 3600, minMoves: 8, maxMoves: 999 },
  spot: { label: '找不同', minSeconds: 1, maxSeconds: 3600, minMoves: 0, maxMoves: 0 },
  zanhua: { label: '簪花', minSeconds: 2, maxSeconds: 3600, minMoves: 0, maxMoves: 999 },
  market: { label: '配花', minSeconds: 5, maxSeconds: 3600, minMoves: 0, maxMoves: 999 },
  pattern: { label: '方巾纹样', minSeconds: 2, maxSeconds: 3600, minMoves: 6, maxMoves: 999 },
  nanyin: { label: '南音', minSeconds: 3, maxSeconds: 3600, minMoves: 0, maxMoves: 999 },
  lantern: { label: '花灯', minSeconds: 3, maxSeconds: 3600, minMoves: 1, maxMoves: 999 },
  porcelain: { label: '德化瓷', minSeconds: 3, maxSeconds: 3600, minMoves: 0, maxMoves: 999 }
};

const GAME_KEYS = Object.keys(GAMES);

/* ---------------- 提交频率限制：同一 IP 10 分钟内最多 30 条 ---------------- */

const recent = new Map();
const WINDOW = 10 * 60 * 1000;
const LIMIT = 30;

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

/* ---------------- 工具 ---------------- */

function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

function gameOf(raw) {
  const key = String(raw || '').trim();
  if (!GAMES[key]) throw badRequest('游戏不存在', { field: 'game' });
  return key;
}

function playerKey(customer, name) {
  return customer ? `c${customer.id}` : `n${name.toLowerCase()}`;
}

/** 取某个玩家的最好成绩与名次 */
function bestOf(db, game, key) {
  const row = db.get(
    `SELECT seconds, moves, created_at FROM game_scores
      WHERE game = ? AND player_key = ?
      ORDER BY seconds ASC, moves ASC, created_at ASC LIMIT 1`,
    game,
    key
  );
  if (!row) return null;

  const better = db.get(
    `SELECT COUNT(*) AS n FROM (
       SELECT player_key, MIN(seconds * 1000 + moves) AS k
         FROM game_scores WHERE game = ? GROUP BY player_key
     ) WHERE k < ?`,
    game,
    row.seconds * 1000 + row.moves
  );

  return {
    seconds: row.seconds,
    moves: row.moves,
    at: row.created_at,
    rank: better.n + 1
  };
}

function leaderboard(db, game, limit) {
  const rows = db.all(
    `WITH ranked AS (
       SELECT player_key, player_name, seconds, moves, created_at,
              ROW_NUMBER() OVER (
                PARTITION BY player_key
                ORDER BY seconds ASC, moves ASC, created_at ASC
              ) AS rn,
              COUNT(*) OVER (PARTITION BY player_key) AS plays
         FROM game_scores
        WHERE game = ?
     )
     SELECT player_key, player_name, seconds, moves, created_at, plays
       FROM ranked WHERE rn = 1
      ORDER BY seconds ASC, moves ASC, created_at ASC
      LIMIT ?`,
    game,
    limit
  );

  return rows.map((r, i) => ({
    rank: i + 1,
    key: r.player_key,
    name: r.player_name,
    seconds: r.seconds,
    moves: r.moves,
    plays: r.plays,
    at: r.created_at
  }));
}

function statsOf(db, game) {
  const row = db.get(
    `SELECT COUNT(*) AS plays,
            COUNT(DISTINCT player_key) AS players,
            MIN(seconds) AS best
       FROM game_scores WHERE game = ?`,
    game
  );
  return { plays: row.plays, players: row.players, best: row.best };
}

/* ---------------- 路由 ---------------- */

module.exports = function register(router) {
  /**
   * 提交一局成绩。
   * 登录顾客直接用账号昵称，游客自报昵称（用 localStorage 记住）。
   */
  router.post('/api/games/scores', async (ctx) => {
    if (!checkQuota(ctx.ip)) throw tooMany('提交太频繁，休息一下再来');

    const body = ctx.body || {};
    const game = gameOf(body.game);
    const rule = GAMES[game];

    const seconds = v.int(body.seconds, '用时', {
      min: rule.minSeconds,
      max: rule.maxSeconds
    });
    const moves = v.int(body.moves, '步数', {
      min: rule.minMoves,
      max: rule.maxMoves || 9999,
      fallback: 0
    });

    const customer = ca.currentCustomer(ctx);
    let name;
    if (customer) {
      name = cleanName(customer.nickname) || '花友';
    } else {
      name = cleanName(body.name);
      if (!name) throw badRequest('先留一个昵称，方便上榜', { field: 'name' });
      if (name.length < 2) throw badRequest('昵称至少 2 个字', { field: 'name' });
    }

    const db = getDb();
    const key = playerKey(customer, name);
    const nowDate = new Date();
    const now = nowDate.toISOString();

    db.run(
      `INSERT INTO game_scores
        (game, player_key, player_name, customer_id, seconds, moves, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      game,
      key,
      name,
      customer ? customer.id : null,
      seconds,
      moves,
      ctx.ip || null,
      now
    );

    const best = bestOf(db, game, key);
    const stats = statsOf(db, game);

    // 通关即发券：同一玩家同一游戏每天一张，同一网络 / 账号每天最多 3 张
    const reward = issueGameReward({
      db,
      game,
      playerKey: key,
      customerId: customer ? customer.id : null,
      ip: ctx.ip || null,
      day: dayKey(nowDate, config.timezone),
      now: nowDate
    });

    return {
      game,
      name,
      best,
      rank: best.rank,
      players: stats.players,
      isRecord: best.seconds === seconds && best.moves === moves && best.at === now,
      coupon: reward.coupon,
      couponNote: reward.note,
      couponAlreadyClaimed: reward.alreadyClaimed
    };
  });

  /** 单个游戏的排行榜 */
  router.get('/api/games/leaderboard', async (ctx) => {
    const game = gameOf(ctx.query.get('game') || 'puzzle');
    const limit = v.int(ctx.query.get('limit'), '条数', {
      min: 1,
      max: 50,
      fallback: 10
    });

    const db = getDb();
    const customer = ca.currentCustomer(ctx);
    const me = customer ? playerKey(customer, cleanName(customer.nickname)) : null;

    return {
      game,
      label: GAMES[game].label,
      items: leaderboard(db, game, limit),
      stats: statsOf(db, game),
      me: me ? bestOf(db, game, me) : null
    };
  });

  /** 首页用：每个游戏各取前三，外加总量 */
  router.get('/api/games/overview', async () => {
    const db = getDb();
    const games = GAME_KEYS.map((key) => ({
      game: key,
      label: GAMES[key].label,
      items: leaderboard(db, key, 3),
      stats: statsOf(db, key)
    }));

    const total = db.get(
      `SELECT COUNT(*) AS plays, COUNT(DISTINCT player_key) AS players FROM game_scores`
    );

    return { games, total: { plays: total.plays, players: total.players } };
  });
};

module.exports.GAMES = GAMES;
