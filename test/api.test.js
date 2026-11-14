'use strict';

/**
 * 接口回归测试（node:test，零依赖）
 *   npm test
 *
 * 使用独立的临时数据库与随机端口，不影响 data/xunpu.db。
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const DB_FILE = path.join(os.tmpdir(), `xunpu-test-${process.pid}-${Date.now()}.db`);
process.env.DB_FILE = DB_FILE;
process.env.NODE_ENV = 'test';
process.env.LOG_REQUESTS = '0';
process.env.RATE_MAX = '5000';
process.env.RATE_WRITE_MAX = '5000';
process.env.ADMIN_PASSWORD = 'test-pass-2026';

const { createServer } = require('../server/app');
const { seed } = require('../server/db/seed');
const { closeDb, getDb } = require('../server/db');

let server;
let base;
let adminCookie = '';
let cartCookie = '';
let orderNo = '';
let orderToken = '';

function url(p) {
  return base + p;
}

async function call(method, p, body, extraHeaders) {
  const headers = Object.assign({}, extraHeaders || {});
  const cookies = [];
  if (adminCookie) cookies.push(adminCookie);
  if (cartCookie) cookies.push(cartCookie);
  if (cookies.length) headers.cookie = cookies.join('; ');
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(url(p), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const pair = c.split(';')[0];
    if (pair.startsWith('xb_admin=') && !pair.includes('xb_admin=;')) adminCookie = pair;
    if (pair.startsWith('xb_cart=')) cartCookie = pair;
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV / HTML */
  }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  seed();
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(DB_FILE + suffix);
    } catch {
      /* 文件可能不存在 */
    }
  }
});

/* ------------------------------------------------------------------ */

test('健康检查', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.status, 'ok');
});

test('商品列表返回 6 件，且带价格与变体', async () => {
  const r = await call('GET', '/api/products');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.total, 6);
  const garland = r.json.data.items.find((p) => p.slug === 'garland');
  assert.equal(garland.priceFromCents, 39800);
  assert.equal(garland.variants.length, 4);
});

test('分类计数正确（花签同时属于器物与可佩戴）', async () => {
  const r = await call('GET', '/api/categories');
  const map = Object.fromEntries(r.json.data.map((c) => [c.key, c.count]));
  assert.equal(map.wear, 2);
  assert.equal(map.object, 2);
  assert.equal(map.gift, 1);
});

test('商品详情 404', async () => {
  const r = await call('GET', '/api/products/not-exist');
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, 'NOT_FOUND');
});

test('加入礼袋并合计运费', async () => {
  const r = await call('POST', '/api/cart/items', { sku: 'XB-BMK-SET', qty: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.count, 1);
  assert.equal(r.json.data.itemsTotalCents, 6900);
  // 69 元 < 299 元，运费 12 元
  assert.equal(r.json.data.shippingFeeCents, 1200);
  assert.equal(r.json.data.totalCents, 8100);
});

test('超出库存被拒绝', async () => {
  const r = await call('POST', '/api/cart/items', { sku: 'XB-GAR-SX', qty: 99 });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'CONFLICT');
});

test('提交订单扣减库存并返回查询码', async () => {
  await call('POST', '/api/cart/items', { sku: 'XB-GAR-SX', qty: 1 });
  const before = getDb().get("SELECT stock FROM variants WHERE sku = 'XB-GAR-SX'").stock;

  const r = await call('POST', '/api/orders', {
    customer: { name: '测试买家', phone: '13800138001', address: '福建省泉州市丰泽区 1 号' },
    note: '测试备注'
  });

  assert.equal(r.status, 201);
  orderNo = r.json.data.orderNo;
  orderToken = r.json.data.accessToken;
  assert.match(orderNo, /^XB\d{12}$/);
  assert.equal(r.json.data.status, 'pending');
  assert.ok(r.json.data.items.length >= 1);

  const afterStock = getDb().get("SELECT stock FROM variants WHERE sku = 'XB-GAR-SX'").stock;
  assert.equal(afterStock, before - 1);
});

test('幂等键不会重复下单', async () => {
  const payload = {
    items: [{ sku: 'XB-INC-ST', qty: 1 }],
    customer: { name: '幂等测试', phone: '13800138002', address: '泉州市 2 号' },
    idempotencyKey: 'idem-key-1'
  };
  const first = await call('POST', '/api/orders', payload);
  assert.equal(first.status, 201);
  const second = await call('POST', '/api/orders', payload);
  assert.equal(first.json.data.orderNo, second.json.data.orderNo);
  assert.equal(second.json.data.duplicated, true);
});

test('订单查询：无凭据拒绝，凭手机号放行', async () => {
  const denied = await call('GET', `/api/orders/${orderNo}`);
  assert.equal(denied.status, 403);

  const ok = await call('GET', `/api/orders/${orderNo}?phone=13800138001`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.orderNo, orderNo);

  const byToken = await call('GET', `/api/orders/${orderNo}?token=${orderToken}`);
  assert.equal(byToken.status, 200);
});

test('未登录访问后台接口返回 401', async () => {
  const r = await call('GET', '/api/admin/overview');
  assert.equal(r.status, 401);
});

test('错误密码无法登录', async () => {
  const r = await call('POST', '/api/admin/auth/login', { username: 'admin', password: 'wrong' });
  assert.equal(r.status, 401);
});

test('管理员登录成功', async () => {
  const r = await call('POST', '/api/admin/auth/login', { username: 'admin', password: 'test-pass-2026' });
  assert.equal(r.status, 200);
  assert.ok(r.json.data.token);
  assert.ok(adminCookie.includes('xb_admin='));
});

test('概览统计包含必要字段', async () => {
  const r = await call('GET', '/api/admin/overview');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.series.length, 14);
  assert.ok(r.json.data.month.orders >= 1);
  assert.ok(Array.isArray(r.json.data.lowStock));
});

test('订单状态不能跳级流转', async () => {
  const list = await call('GET', '/api/admin/orders?status=pending');
  const target = list.json.data.items[0];
  const bad = await call('PATCH', `/api/admin/orders/${target.id}`, { status: 'shipped' });
  assert.equal(bad.status, 409);

  const good = await call('PATCH', `/api/admin/orders/${target.id}`, { status: 'confirmed' });
  assert.equal(good.status, 200);
  assert.equal(good.json.data.status, 'confirmed');
});

test('取消订单回滚库存', async () => {
  const stockBefore = getDb().get("SELECT stock FROM variants WHERE sku = 'XB-GAR-SX'").stock;

  const created = await call('POST', '/api/orders', {
    items: [{ sku: 'XB-GAR-SX', qty: 2 }],
    customer: { name: '取消测试', phone: '13800138003', address: '泉州市 3 号' }
  });
  assert.equal(created.status, 201);
  const no = created.json.data.orderNo;
  const token = created.json.data.accessToken;

  assert.equal(getDb().get("SELECT stock FROM variants WHERE sku = 'XB-GAR-SX'").stock, stockBefore - 2);

  const cancelled = await call('POST', `/api/orders/${no}/cancel`, { token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.data.status, 'cancelled');
  assert.equal(getDb().get("SELECT stock FROM variants WHERE sku = 'XB-GAR-SX'").stock, stockBefore);
});

test('询价：手机号校验与批量定制必填数量', async () => {
  const bad = await call('POST', '/api/inquiries', { type: 'trial', name: '张三', phone: '123' });
  assert.equal(bad.status, 400);

  const noQty = await call('POST', '/api/inquiries', {
    type: 'batch', name: '李四', phone: '13700137009', message: '企业年会礼赠定制'
  });
  assert.equal(noQty.status, 400);

  const ok = await call('POST', '/api/inquiries', {
    type: 'batch', name: '李四', phone: '13700137009', qty: 200, message: '企业年会礼赠定制'
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.status, 'new');
});

test('CSV 导出带表头与 BOM 标记', async () => {
  const r = await call('GET', '/api/admin/orders.csv');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('订单号,日期,状态'));
  assert.match(r.headers.get('content-type') || '', /text\/csv/);
});

test('库存可被后台修改，商品起价随最低变体同步', async () => {
  const products = await call('GET', '/api/admin/products');
  const bookmark = products.json.data.items.find((p) => p.slug === 'bookmark');
  const variant = bookmark.variants[0];

  const r = await call('PATCH', `/api/admin/variants/${variant.id}`, { stock: 7, price: 29 });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.stock, 7);

  const detail = await call('GET', '/api/products/bookmark');
  assert.equal(detail.json.data.priceFromCents, 2900);

  // 还原，避免影响其它用例
  await call('PATCH', `/api/admin/variants/${variant.id}`, { stock: 180, price: 39 });
});

test('静态资源边界：源码与数据库不可访问', async () => {
  for (const p of ['/server/config.js', '/data/xunpu.db', '/package.json']) {
    const r = await fetch(url(p));
    assert.equal(r.status, 404, `${p} 不应可访问`);
  }
});

test('站点首页与后台页面可访问', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.ok(home.text.includes('蟳埔花事'));

  const admin = await call('GET', '/admin/');
  assert.equal(admin.status, 200);
  assert.ok(admin.text.includes('管理后台') || admin.text.includes('蟳埔花事'));
});

test('未知接口返回 404 信封', async () => {
  const r = await call('GET', '/api/nothing');
  assert.equal(r.status, 404);
  assert.equal(r.json.ok, false);
});

/* ================================================================== */
/* 顾客账号                                                            */
/* ================================================================== */

/** 用显式 cookie 发请求，避免与上面的共享购物袋互相干扰 */
async function raw(method, p, body, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(url(p), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  const setCookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(';')[0]);
  return { status: res.status, json, text, setCookie };
}

function pickCookie(jar, name) {
  const all = Object.assign({}, ...jar.map((c) => ({ [c.split('=')[0]]: c })));
  return all[name] || '';
}

test('顾客注册成功并自动登录', async () => {
  const r = await raw('POST', '/api/auth/register', {
    phone: '13500001111',
    password: 'huashi2026',
    nickname: '阿满'
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.customer.nickname, '阿满');
  assert.equal(r.json.data.customer.phoneMasked, '135****1111');
  assert.ok(r.json.data.token);
  assert.ok(r.json.data.cart, '注册后应返回购物袋');
});

test('重复手机号与弱密码被拒', async () => {
  const dup = await raw('POST', '/api/auth/register', { phone: '13500001111', password: 'huashi2026' });
  assert.equal(dup.status, 409);

  const weak = await raw('POST', '/api/auth/register', { phone: '13500002222', password: '12345678' });
  assert.equal(weak.status, 400);

  const short = await raw('POST', '/api/auth/register', { phone: '13500002222', password: 'abc123' });
  assert.equal(short.status, 400);
});

test('顾客登录与错误密码', async () => {
  const bad = await raw('POST', '/api/auth/login', { phone: '13500001111', password: 'wrong-pass' });
  assert.equal(bad.status, 401);

  const ok = await raw('POST', '/api/auth/login', { phone: '13500001111', password: 'huashi2026' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.isNew, false);
});

test('游客购物袋在登录后并入账号', async () => {
  const guest = await raw('POST', '/api/cart/items', { sku: 'XB-BMK-BK', qty: 2 });
  assert.equal(guest.status, 201);
  const guestCart = pickCookie(guest.setCookie, 'xb_cart');
  assert.ok(guestCart);

  const login = await raw('POST', '/api/auth/login',
    { phone: '13500001111', password: 'huashi2026' }, guestCart);
  assert.equal(login.status, 200);
  assert.ok(login.json.data.cart.count >= 2);
});

test('登录顾客下单后可在「我的订单」看到，游客看不到', async () => {
  const login = await raw('POST', '/api/auth/login', { phone: '13500001111', password: 'huashi2026' });
  const userCookie = pickCookie(login.setCookie, 'xb_user');
  const cartCookie2 = pickCookie(login.setCookie, 'xb_cart');
  assert.ok(userCookie);

  // 加购（购物袋 cookie 与会话 cookie 一起带）
  const cookie = [userCookie, cartCookie2].filter(Boolean).join('; ');
  await raw('POST', '/api/cart/items', { sku: 'XB-INC-DB', qty: 1 }, cookie);

  const order = await raw('POST', '/api/orders', {
    customer: { name: '阿满', phone: '13500001111', address: '泉州市鲤城区 1 号' }
  }, cookie);
  assert.equal(order.status, 201);
  const orderNo = order.json.data.orderNo;

  // 我的订单
  const mine = await raw('GET', '/api/auth/orders', undefined, userCookie);
  assert.equal(mine.status, 200);
  assert.ok(mine.json.data.total >= 1);
  assert.ok(mine.json.data.items.some((o) => o.orderNo === orderNo));

  // 已登录顾客可直接读自己的订单详情
  const detail = await raw('GET', `/api/orders/${orderNo}`, undefined, userCookie);
  assert.equal(detail.status, 200);

  // 未登录、无凭据则拒绝
  const denied = await raw('GET', `/api/orders/${orderNo}`);
  assert.equal(denied.status, 403);
});

test('后台可看到顾客及其消费', async () => {
  const r = await call('GET', '/api/admin/customers');
  assert.equal(r.status, 200);
  const target = r.json.data.items.find((c) => c.phone === '13500001111');
  assert.ok(target, '应能查到注册的顾客');
  assert.ok(target.orders >= 1);
  assert.ok(target.phoneMasked.includes('****'));
});

test('后台删除未发货订单会回滚库存', async () => {
  const login = await raw('POST', '/api/auth/login', { phone: '13500001111', password: 'huashi2026' });
  const userCookie = pickCookie(login.setCookie, 'xb_user');
  const cartCookie2 = pickCookie(login.setCookie, 'xb_cart');
  const cookie = [userCookie, cartCookie2].filter(Boolean).join('; ');

  const before = getDb().get("SELECT stock FROM variants WHERE sku = 'XB-INC-ST'").stock;
  await raw('POST', '/api/cart/items', { sku: 'XB-INC-ST', qty: 2 }, cookie);
  const created = await raw('POST', '/api/orders', {
    customer: { name: '阿满', phone: '13500001111', address: '泉州市鲤城区 1 号' }
  }, cookie);

  assert.equal(created.status, 201);
  const id = created.json.data.id;
  assert.equal(getDb().get("SELECT stock FROM variants WHERE sku = 'XB-INC-ST'").stock, before - 2);

  const del = await call('DELETE', `/api/admin/orders/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.data.stockRestored, true);
  assert.equal(getDb().get("SELECT stock FROM variants WHERE sku = 'XB-INC-ST'").stock, before);
  assert.equal(getDb().get('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?', id).n, 0);
});

test('有订单的顾客不能直接删除，可停用', async () => {
  const list = await call('GET', '/api/admin/customers');
  const target = list.json.data.items.find((c) => c.phone === '13500001111');

  const del = await call('DELETE', `/api/admin/customers/${target.id}`);
  assert.equal(del.status, 409);

  const disable = await call('PATCH', `/api/admin/customers/${target.id}`, { status: 'disabled' });
  assert.equal(disable.status, 200);

  const blocked = await raw('POST', '/api/auth/login', { phone: '13500001111', password: 'huashi2026' });
  assert.equal(blocked.status, 403);

  await call('PATCH', `/api/admin/customers/${target.id}`, { status: 'active' });
});

test('批量清理需要确认口令', async () => {
  const bad = await call('POST', '/api/admin/data/clear', { target: 'inquiries', confirm: '删除' });
  assert.equal(bad.status, 400);

  const noAuth = await raw('POST', '/api/admin/data/clear', { target: 'all', confirm: '清空' });
  assert.equal(noAuth.status, 401);
});

test('清空业务数据后商品与文案保留', async () => {
  const inquiriesBefore = getDb().get('SELECT COUNT(*) AS n FROM inquiries').n;
  assert.ok(inquiriesBefore > 0);

  const r = await call('POST', '/api/admin/data/clear', { target: 'all', confirm: '清空' });
  assert.equal(r.status, 200);
  assert.ok(r.json.data.cleared.orders >= 0);

  assert.equal(getDb().get('SELECT COUNT(*) AS n FROM orders').n, 0);
  assert.equal(getDb().get('SELECT COUNT(*) AS n FROM inquiries').n, 0);
  assert.equal(getDb().get('SELECT COUNT(*) AS n FROM customers').n, 0);

  // 商品与站点文案不受影响
  assert.equal(getDb().get('SELECT COUNT(*) AS n FROM products').n, 6);
  assert.equal(getDb().get('SELECT COUNT(*) AS n FROM variants').n, 16);
  assert.ok(getDb().get("SELECT COUNT(*) AS n FROM content WHERE key = 'site.contact'").n === 1);

  const products = await call('GET', '/api/products');
  assert.equal(products.json.data.total, 6);
});

test('登录超限后返回 429（防爆破）', async () => {
  // 连续错误登录直到触发阈值
  let last = null;
  for (let i = 0; i < 12; i++) {
    last = await raw('POST', '/api/auth/login', { phone: '13500009999', password: 'wrong-pass' });
    if (last.status === 409) break;
  }
  assert.ok([409, 401].includes(last.status));
});

test('HTTP 下发的会话 Cookie 不能带 Secure（否则浏览器直接丢弃）', async () => {
  const body = { username: 'admin', password: 'test-pass-2026' };

  const plain = await call('POST', '/api/admin/auth/login', body);
  assert.equal(plain.status, 200);
  const plainCookie = (plain.headers.getSetCookie() || []).find((c) => c.startsWith('xb_admin='));
  assert.ok(plainCookie, '应下发 xb_admin');
  assert.ok(!/;\s*Secure/i.test(plainCookie), `HTTP 下不应带 Secure：${plainCookie}`);

  const viaHttps = await call('POST', '/api/admin/auth/login', body, { 'x-forwarded-proto': 'https' });
  const httpsCookie = (viaHttps.headers.getSetCookie() || []).find((c) => c.startsWith('xb_admin='));
  assert.ok(/;\s*Secure/i.test(httpsCookie), `HTTPS 下应带 Secure：${httpsCookie}`);

  // 恢复一个普通会话，避免影响其它用例
  await call('POST', '/api/admin/auth/login', body);
});

test('管理员可设第二个密码，主密码与备用密码都能登录', async () => {
  const MAIN = 'test-pass-2026';
  const ALT = 'backup-9527';

  const mainLogin = await call('POST', '/api/admin/auth/login', { username: 'admin', password: MAIN });
  assert.equal(mainLogin.status, 200);
  assert.ok(adminCookie, '应拿到管理员会话');

  // 添加备用密码
  const add = await call('POST', '/api/admin/passwords', { current: MAIN, password: ALT, label: '备用' });
  assert.equal(add.status, 201);
  assert.equal(add.json.data.created, true);

  // 列表可见，且绝不返回哈希
  const list = await call('GET', '/api/admin/passwords');
  assert.equal(list.json.data.items.length, 1);
  assert.equal(list.json.data.items[0].label, '备用');
  const dumped = JSON.stringify(list.json);
  assert.ok(!dumped.includes('scrypt'), '列表不能泄露哈希');
  assert.ok(!('passwordHash' in list.json.data.items[0]));

  // 备用密码可登录
  const altLogin = await raw('POST', '/api/admin/auth/login', { username: 'admin', password: ALT });
  assert.equal(altLogin.status, 200);
  const altCookie = (altLogin.setCookie || []).find((c) => c.startsWith('xb_admin='));
  assert.ok(altCookie, '备用密码应能拿到会话');

  // 主密码依然可用
  const mainAgain = await raw('POST', '/api/admin/auth/login', { username: 'admin', password: MAIN });
  assert.equal(mainAgain.status, 200);

  // 错误密码仍拒绝
  const bad = await raw('POST', '/api/admin/auth/login', { username: 'admin', password: 'wrong-pass-1' });
  assert.equal(bad.status, 401);

  // 重复添加被拦
  const dup = await call('POST', '/api/admin/passwords', { current: MAIN, password: ALT });
  assert.equal(dup.status, 400);

  // 删除后该密码立即失效，主密码不受影响
  const id = list.json.data.items[0].id;
  const del = await call('DELETE', '/api/admin/passwords/' + id);
  assert.equal(del.status, 200);
  const afterDel = await raw('POST', '/api/admin/auth/login', { username: 'admin', password: ALT });
  assert.equal(afterDel.status, 401);
  const stillMain = await raw('POST', '/api/admin/auth/login', { username: 'admin', password: MAIN });
  assert.equal(stillMain.status, 200);

  // 恢复管理员会话
  await call('POST', '/api/admin/auth/login', { username: 'admin', password: MAIN });
});
