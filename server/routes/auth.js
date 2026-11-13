'use strict';

const auth = require('../lib/auth');
const v = require('../lib/validate');
const { badRequest, unauthorized, cookie, appendCookie, isSecureRequest } = require('../lib/http');

/** 登录失败计数：同一 IP + 账号 10 分钟内 8 次即锁定 */
const failures = new Map();
const WINDOW = 10 * 60 * 1000;
const LIMIT = 8;

function tooManyFailures(key) {
  const rec = failures.get(key);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) {
    failures.delete(key);
    return false;
  }
  return rec.count >= LIMIT;
}

function recordFailure(key) {
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec || now > rec.resetAt) failures.set(key, { count: 1, resetAt: now + WINDOW });
  else rec.count += 1;
}

module.exports = function register(router) {
  /** 登录 */
  router.post('/api/admin/auth/login', async (ctx) => {
    const body = ctx.body || {};
    const username = v.str(body.username, '账号', { max: 40 });
    const password = v.str(body.password, '密码', { max: 100 });
    const key = `${ctx.ip}:${username.toLowerCase()}`;

    if (tooManyFailures(key)) {
      throw badRequest('尝试次数过多，请 10 分钟后再试');
    }

    const result = auth.login(username, password, ctx.ip);
    if (!result) {
      recordFailure(key);
      throw unauthorized('账号或密码不正确');
    }
    failures.delete(key);

    appendCookie(
      ctx.res,
      cookie(auth.ADMIN_COOKIE, result.token, {
        maxAge: ctx.config.sessionTtl,
        httpOnly: true,
        sameSite: 'Lax',
        secure: isSecureRequest(ctx)
      })
    );

    return result;
  });

  /** 退出登录 */
  router.post('/api/admin/auth/logout', async (ctx) => {
    auth.logout(auth.readToken(ctx));
    appendCookie(ctx.res, cookie(auth.ADMIN_COOKIE, '', { maxAge: 0, httpOnly: true }));
    return { loggedOut: true };
  });

  /** 当前登录态 */
  router.get('/api/admin/auth/me', async (ctx) => {
    if (!ctx.user) throw unauthorized('未登录');
    return { user: ctx.user };
  });
};
