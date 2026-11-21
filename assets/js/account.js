/* 蟳埔花事 · 我的账户（顾客端）
 * 登录 / 注册 / 我的订单 / 资料 / 改密。后端不可达时给出提示，不白屏。
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.getElementById('acct-root');
  var titleEl = doc.getElementById('acct-title');
  var leadEl = doc.getElementById('acct-lead');
  var asideEl = doc.getElementById('acct-aside');

  var state = {
    customer: null,
    orders: null,
    coupons: null,
    couponStats: { active: 0 },
    tab: 'login',
    panel: 'orders',
    busy: false,
    notice: null
  };

  var STATUS = {
    pending: '待处理', confirmed: '已确认', producing: '生产中',
    shipped: '已发货', completed: '已完成', cancelled: '已取消'
  };

  /* ---------------------------------------------------------------- */

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    var num = Number(n) || 0;
    return '¥' + (num % 1 === 0 ? num : num.toFixed(2));
  }

  /* ---- 浮动标签字段 -------------------------------------------------
     标签平常躺在输入框里，聚焦或有内容时缩到框上方并常驻；
     说明文字放框下方，不再用 placeholder（占位符一输入就没了）。 */
  function field(o) {
    var attrs = '';
    if (o.name) attrs += ' name="' + o.name + '"';
    if (o.type) attrs += ' type="' + o.type + '"';
    if (o.mode) attrs += ' inputmode="' + o.mode + '"';
    if (o.autocomplete) attrs += ' autocomplete="' + o.autocomplete + '"';
    if (o.maxlength) attrs += ' maxlength="' + o.maxlength + '"';
    if (o.value !== undefined && o.value !== null && o.value !== '') {
      attrs += ' value="' + o.value + '"';
    }
    if (o.disabled) attrs += ' disabled';

    return '<label class="xb-field' + (o.value ? ' is-filled' : '') + '">' +
      '<span class="xb-field__label">' + o.label + '</span>' +
      '<input' + attrs + '>' +
      (o.hint ? '<span class="xb-field__hint">' + o.hint + '</span>' : '') +
      '</label>';
  }

  /* 有内容 → 标签浮上去；清空 → 落回框里 */
  function syncField(input) {
    var wrap = input && input.closest ? input.closest('.xb-field') : null;
    if (!wrap) return;
    wrap.classList.toggle('is-filled', String(input.value || '').length > 0);
  }

  function syncFields(scope) {
    var host = scope || doc;
    var list = host.querySelectorAll ? host.querySelectorAll('.xb-field input, .xb-field textarea') : [];
    Array.prototype.forEach.call(list, syncField);
  }

  doc.addEventListener('input', function (e) {
    if (e.target && e.target.closest && e.target.closest('.xb-field')) syncField(e.target);
  }, true);

  doc.addEventListener('focusin', function (e) {
    if (e.target && e.target.closest && e.target.closest('.xb-field')) syncField(e.target);
  }, true);

  doc.addEventListener('change', function (e) {
    if (e.target && e.target.closest && e.target.closest('.xb-field')) syncField(e.target);
  }, true);

  function timeText(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function api(path, options) {
    var opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (payload) {
        if (!res.ok || !payload || payload.ok === false) {
          var err = new Error((payload && payload.error && payload.error.message) || '请求失败（' + res.status + '）');
          err.status = res.status;
          throw err;
        }
        return payload.data;
      });
    });
  }

  function notify(message, isError) {
    state.notice = message ? { text: message, error: !!isError } : null;
    var box = doc.getElementById('acct-alert');
    if (!box) return;
    if (!message) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.textContent = message;
    box.className = 'acct-alert' + (isError ? '' : ' acct-alert--ok');
  }

  /* ---------------------------------------------------------------- */
  /* 未登录：登录 / 注册                                               */
  /* ---------------------------------------------------------------- */

  function renderAuth() {
    titleEl.textContent = '我的账户';
    leadEl.textContent = '登录后可以看到每一顶花冠走到哪一步，也能把收货信息存下来，下次不必再填。';
    asideEl.innerHTML = '';

    var isLogin = state.tab === 'login';

    root.innerHTML =
      '<div class="acct-auth">' +
        '<div class="acct-auth__intro">' +
          '<span class="eyebrow">账户 · Account</span>' +
          '<h2 class="display" style="font-size:clamp(1.8rem,3.2vw,2.5rem);line-height:1.2;margin:12px 0 0">' +
            '把这一顶花园<br>留在名下' +
          '</h2>' +
          '<ul class="acct-auth__points">' +
            '<li><span>①</span><span>订单进度随时可查，从扎花到发货每一步都看得到。</span></li>' +
            '<li><span>②</span><span>收货信息存在账户里，下次下单不用重复填。</span></li>' +
            '<li><span>③</span><span>限量礼盒与新品会优先通知登记过的花友。</span></li>' +
          '</ul>' +
        '</div>' +

        '<div class="acct-card">' +
          '<div class="acct-tabs" role="tablist">' +
            '<button type="button" data-tab="login" class="' + (isLogin ? 'is-active' : '') + '">登录</button>' +
            '<button type="button" data-tab="register" class="' + (isLogin ? '' : 'is-active') + '">注册</button>' +
          '</div>' +

          '<p class="acct-alert" id="acct-alert" hidden></p>' +

          '<form class="acct-form" id="auth-form" novalidate>' +
            field({ name: 'phone', mode: 'numeric', autocomplete: 'tel', maxlength: 11, label: '手机号', hint: '11 位手机号' }) +

            (isLogin ? '' :
              field({ name: 'nickname', autocomplete: 'nickname', maxlength: 20, label: '昵称', hint: '可留空，会出现在订单与祝福卡上' }) +
              field({ name: 'email', type: 'email', autocomplete: 'email', label: '邮箱', hint: '选填，用于接收订单通知' })) +

            field({
              name: 'password', type: 'password', label: '密码',
              autocomplete: isLogin ? 'current-password' : 'new-password',
              hint: isLogin ? '' : '至少 8 位，不能是纯数字'
            }) +

            (isLogin ? '' :
              field({ name: 'confirm', type: 'password', autocomplete: 'new-password', label: '确认密码', hint: '再输一次' })) +

            '<button type="submit" class="xb-btn xb-btn--primary acct-form__submit" data-submit>' +
              (isLogin ? '登录' : '注册并登录') +
            '</button>' +
          '</form>' +

          '<div class="acct-switch">' +
            '<span>' + (isLogin ? '还没有账号？' : '已经有账号了？') + '</span>' +
            '<button type="button" data-tab="' + (isLogin ? 'register' : 'login') + '">' +
              (isLogin ? '用手机号注册' : '直接登录') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    syncFields(root);

    root.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.dataset.tab;
        state.notice = null;
        renderAuth();
        var first = root.querySelector('input[name="phone"]');
        if (first) first.focus();
      });
    });

    var form = doc.getElementById('auth-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitAuth(form);
    });

    if (state.notice) notify(state.notice.text, state.notice.error);
  }

  function submitAuth(form) {
    if (state.busy) return;
    var get = function (n) {
      var el = form.querySelector('[name="' + n + '"]');
      return el ? el.value.trim() : '';
    };

    var phone = get('phone');
    var password = form.querySelector('[name="password"]').value;
    var isLogin = state.tab === 'login';

    if (!/^1[3-9]\d{9}$/.test(phone)) return notify('请填写正确的 11 位手机号', true);
    if (password.length < 8) return notify('密码至少 8 位', true);

    if (!isLogin) {
      if (/^\d+$/.test(password)) return notify('密码不能是纯数字', true);
      if (password !== form.querySelector('[name="confirm"]').value) return notify('两次输入的密码不一致', true);
    }

    var btn = form.querySelector('[data-submit]');
    btn.disabled = true;
    btn.textContent = isLogin ? '登录中…' : '注册中…';
    state.busy = true;

    var payload = isLogin
      ? { phone: phone, password: password }
      : { phone: phone, password: password, nickname: get('nickname'), email: get('email') };

    api(isLogin ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body: payload })
      .then(function (data) {
        state.customer = data.customer;
        state.tab = 'login';
        state.panel = location.hash === '#coupons' ? 'coupons' : 'orders';
        if (data.cart) {
          window.dispatchEvent(new CustomEvent('xb:cart', { detail: data.cart }));
        }
        window.dispatchEvent(new CustomEvent('xb:auth', { detail: data.customer }));
        state.notice = {
          text: isLogin ? '欢迎回来，' + data.customer.nickname + '。' : '注册成功，欢迎加入花友，' + data.customer.nickname + '。',
          error: false
        };
        renderAccount();
        loadOrders();
        if (state.panel === 'coupons') loadCoupons();
      })
      .catch(function (err) {
        notify(err.message, true);
        btn.disabled = false;
        btn.textContent = isLogin ? '登录' : '注册并登录';
      })
      .finally(function () {
        state.busy = false;
      });
  }

  /* ---------------------------------------------------------------- */
  /* 已登录：账户面板                                                   */
  /* ---------------------------------------------------------------- */

  function renderAccount() {
    var c = state.customer;
    var stats = (state.orders && state.orders.stats) || { orders: 0, spent: 0 };
    var couponCount = (state.couponStats && state.couponStats.active) || 0;

    titleEl.textContent = '你好，' + c.nickname;
    leadEl.textContent = '这里是你和这顶花园的往来记录。订单进度、收货信息与账号设置都在下面。';
    asideEl.innerHTML =
      '<a class="btn btn--ghost" href="collection.html">继续挑选礼物 →</a>';

    root.innerHTML =
      '<div class="acct-grid">' +
        '<aside class="acct-card acct-profile">' +
          '<div class="acct-avatar">' + esc(c.nickname.slice(0, 1)) + '</div>' +
          '<div class="acct-profile__name">' + esc(c.nickname) + '</div>' +
          '<div class="acct-profile__meta">' + esc(c.phoneMasked) + ' · 加入于 ' + timeText(c.createdAt).slice(0, 10) + '</div>' +

          '<dl class="acct-stats">' +
            '<div><dt>订单</dt><dd>' + stats.orders + '</dd></div>' +
            '<div><dt>累计消费</dt><dd>' + money(stats.spent) + '</dd></div>' +
          '</dl>' +

          '<div class="acct-menu">' +
            '<button type="button" data-panel="orders" class="' + (state.panel === 'orders' ? 'is-active' : '') + '">' +
              '我的订单<span class="acct-menu__n">' + stats.orders + '</span></button>' +
            '<button type="button" data-panel="coupons" class="' + (state.panel === 'coupons' ? 'is-active' : '') + '">' +
              '我的券<span class="acct-menu__n" data-coupon-count>' + couponCount + '</span></button>' +
            '<button type="button" data-panel="profile" class="' + (state.panel === 'profile' ? 'is-active' : '') + '">个人资料</button>' +
            '<button type="button" data-panel="password" class="' + (state.panel === 'password' ? 'is-active' : '') + '">修改密码</button>' +
            '<button type="button" data-logout>退出登录</button>' +
          '</div>' +
        '</aside>' +

        '<div class="acct-panel" id="acct-panel">' +
          '<p class="acct-alert" id="acct-alert" hidden></p>' +
        '</div>' +
      '</div>';

    root.querySelectorAll('[data-panel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.panel = btn.dataset.panel;
        state.notice = null;
        renderAccount();
        if (state.panel === 'orders') loadOrders();
        if (state.panel === 'coupons') loadCoupons();
      });
    });

    doc.querySelector('[data-logout]').addEventListener('click', function () {
      if (!window.confirm('确认退出登录？')) return;
      api('/api/auth/logout', { method: 'POST' })
        .catch(function () {})
        .then(function () {
          state.customer = null;
          state.orders = null;
          state.tab = 'login';
          state.notice = null;
          renderAuth();
          window.dispatchEvent(new CustomEvent('xb:auth', { detail: null }));
          window.dispatchEvent(new CustomEvent('xb:cart'));
        });
    });

    if (state.panel === 'profile') renderProfilePanel();
    else if (state.panel === 'password') renderPasswordPanel();
    else if (state.panel === 'coupons') { renderCouponsPanel(); if (!state.coupons) loadCoupons(); }
    else renderOrdersPanel();

    if (state.notice) notify(state.notice.text, state.notice.error);
  }

  function loadOrders() {
    api('/api/auth/orders?limit=50').then(function (data) {
      state.orders = data;
      if (state.panel === 'orders') renderOrdersPanel();
      // 顺带刷新侧栏统计
      var statsEl = root.querySelector('.acct-stats');
      if (statsEl) {
        statsEl.innerHTML =
          '<div><dt>订单</dt><dd>' + data.stats.orders + '</dd></div>' +
          '<div><dt>累计消费</dt><dd>' + money(data.stats.spent) + '</dd></div>';
      }
    }).catch(function (err) {
      if (err.status === 401) {
        state.customer = null;
        renderAuth();
      }
    });
  }

  function panelHead(title, note) {
    return '<p class="acct-alert" id="acct-alert" hidden></p>' +
      '<div class="acct-panel__head"><h2>' + esc(title) + '</h2><span>' + esc(note || '') + '</span></div>';
  }

  function renderOrdersPanel() {
    var box = doc.getElementById('acct-panel');
    if (!box) return;

    if (!state.orders) {
      box.innerHTML = panelHead('我的订单', '读取中…') + '<div class="acct-empty"><h3>正在读取订单…</h3></div>';
      return;
    }

    var list = state.orders.items;
    if (!list.length) {
      box.innerHTML = panelHead('我的订单', '共 0 笔') +
        '<div class="acct-empty">' +
          '<h3>还没有订单</h3>' +
          '<p>挑一顶花冠，或一枚三十九元的花签，都能把泉州带走一点。</p>' +
          '<a class="xb-btn xb-btn--primary xb-btn--sm" href="collection.html">浏览六件礼物</a>' +
        '</div>';
      return;
    }

    box.innerHTML = panelHead('我的订单', '共 ' + state.orders.total + ' 笔') +
      list.map(function (o) {
        var items = o.items.map(function (i) {
          return '<div class="acct-item">' +
            '<img src="' + esc(i.image || 'assets/img/logo.svg') + '" alt="">' +
            '<div>' +
              '<div class="acct-item__name">' + esc(i.name) + '</div>' +
              '<div class="acct-item__meta">' + esc(i.variantName) + ' · ' + i.priceText + ' × ' + i.qty + '</div>' +
            '</div>' +
            '<div class="acct-item__amount">' + i.subtotalText + '</div>' +
          '</div>';
        }).join('');

        var addr = [o.customer.province, o.customer.city, o.customer.district, o.customer.address]
          .filter(Boolean).join(' ');

        return '<div class="acct-order" data-order="' + o.id + '">' +
          '<div class="acct-order__head" data-toggle-order>' +
            '<div>' +
              '<div class="acct-order__no">' + esc(o.orderNo) + '</div>' +
              '<div class="acct-order__time">' + timeText(o.createdAt) + ' · ' + o.items.length + ' 件商品</div>' +
            '</div>' +
            '<div class="acct-order__right">' +
              '<span class="acct-chip acct-chip--' + esc(o.status) + '">' + esc(o.statusText) + '</span>' +
              '<div class="acct-order__total">' + o.totalText + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="acct-order__body">' +
            items +
            '<div class="acct-order__foot">' +
              '<span>' + esc(addr || '到店自提') + '</span>' +
              '<span>商品 ' + o.itemsTotalText + ' · 运费 ' + (o.shippingFeeCents ? o.shippingFeeText : '免') +
                (o.discountCents ? ' · 券抵 ' + o.discountText : '') + '</span>' +
            '</div>' +
            (o.note ? '<div class="acct-order__foot" style="border-top:0;padding-top:0"><span>备注：' + esc(o.note) + '</span></div>' : '') +
            '<div class="acct-order__foot" style="border-top:0;padding-top:0">' +
              '<span class="small">查询码：' + esc(o.customer.phone) + '</span>' +
              (['pending', 'confirmed'].indexOf(o.status) >= 0
                ? '<button class="xb-btn xb-btn--sm" data-cancel="' + esc(o.orderNo) + '">取消订单</button>'
                : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

    box.querySelectorAll('[data-toggle-order]').forEach(function (head) {
      head.addEventListener('click', function () {
        head.parentElement.classList.toggle('is-open');
      });
    });

    box.querySelectorAll('[data-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var no = btn.dataset.cancel;
        if (!window.confirm('确认取消订单 ' + no + '？库存会自动释放。')) return;
        btn.disabled = true;
        api('/api/orders/' + no + '/cancel', { method: 'POST', body: {} })
          .then(function () {
            notify('订单已取消', false);
            loadOrders();
            renderAccount();
          })
          .catch(function (err) {
            notify(err.message, true);
            btn.disabled = false;
          });
      });
    });
  }

  function loadCoupons() {
    api('/api/coupons').then(function (data) {
      state.coupons = data;
      state.couponStats = { active: (data.summary && data.summary.active) || 0 };
      var badge = root.querySelector('[data-coupon-count]');
      if (badge) badge.textContent = String(state.couponStats.active);
      if (state.panel === 'coupons') renderCouponsPanel();
    }).catch(function (err) {
      if (err.status === 401) {
        state.customer = null;
        renderAuth();
        return;
      }
      notify(err.message, true);
    });
  }

  function couponStatusText(c) {
    if (c.status === 'active') return '可用';
    if (c.status === 'used') return '已使用';
    if (c.status === 'expired') return '已过期';
    return '已作废';
  }

  function couponDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function copyCoupon(code, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(function () { btn.textContent = '请手动复制'; });
      return;
    }
    var ta = doc.createElement('textarea');
    ta.value = code;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); done(); } catch (e) { btn.textContent = '请手动复制'; }
    doc.body.removeChild(ta);
  }

  function renderCouponsPanel() {
    var box = doc.getElementById('acct-panel');
    if (!box) return;

    if (!state.coupons) {
      box.innerHTML = panelHead('我的券', '读取中…') + '<div class="acct-empty"><h3>正在读取券包…</h3></div>';
      return;
    }

    var items = state.coupons.items || [];
    var summary = state.coupons.summary || { active: 0, usableValueText: '¥0' };
    var active = items.filter(function (c) { return c.status === 'active'; });
    var history = items.filter(function (c) { return c.status !== 'active'; });

    function card(c) {
      var status = couponStatusText(c);
      return '<div class="acct-coupon acct-coupon--' + esc(c.status) + '">' +
        '<div class="acct-coupon__amount"><b>' + esc(c.amountText) + '</b><span>满 ' + esc(c.minSpendText) + '</span></div>' +
        '<div class="acct-coupon__body">' +
          '<div class="acct-coupon__title">' + esc(c.title) + '</div>' +
          '<div class="acct-coupon__meta">' + (c.gameLabel ? esc(c.gameLabel) + ' · ' : '') +
            '有效期至 ' + couponDate(c.expiresAt) + '</div>' +
          '<div class="acct-coupon__code"><code>' + esc(c.code) + '</code>' +
            (c.status === 'active'
              ? '<button type="button" class="xb-btn xb-btn--sm" data-copy-coupon="' + esc(c.code) + '">复制券码</button>'
              : '') +
          '</div>' +
        '</div>' +
        '<span class="acct-coupon__status">' + esc(status) + '</span>' +
      '</div>';
    }

    box.innerHTML = panelHead('我的券', '通关花间游戏获得 · 满 ¥59 减 ¥5') +
      '<div class="acct-card">' +
        '<div class="acct-coupon-summary">' +
          '<div><span>可用券</span><b>' + summary.active + '</b></div>' +
          '<div><span>可用面额</span><b>' + esc(summary.usableValueText || '¥0') + '</b></div>' +
          '<a class="xb-btn xb-btn--sm" href="games/index.html">去玩游戏赢券</a>' +
        '</div>' +
        (active.length
          ? '<div class="acct-coupon-list">' + active.map(card).join('') + '</div>'
          : '<div class="acct-empty"><h3>券包还是空的</h3><p>去花间游戏通关一局，就能领一张 ¥5 券。</p><a class="xb-btn xb-btn--primary xb-btn--sm" href="games/index.html">去玩游戏</a></div>') +
        (history.length
          ? '<div class="acct-coupon-history"><h4>已用 / 失效</h4>' + history.map(card).join('') + '</div>'
          : '') +
      '</div>';

    box.querySelectorAll('[data-copy-coupon]').forEach(function (btn) {
      btn.addEventListener('click', function () { copyCoupon(btn.dataset.copyCoupon, btn); });
    });
  }

  function renderProfilePanel() {
    var box = doc.getElementById('acct-panel');
    var c = state.customer;
    if (!box) return;

    box.innerHTML = panelHead('个人资料', '昵称会出现在订单与祝福卡上') +
      '<div class="acct-card">' +
        '<form class="acct-form" id="profile-form">' +
          field({ name: 'nickname', maxlength: 20, label: '昵称', value: esc(c.nickname) }) +
          field({ name: 'email', type: 'email', label: '邮箱', hint: '选填，用于接收订单通知', value: esc(c.email) }) +
          field({ label: '手机号', hint: '手机号不可自行修改，需联系客服核验', value: esc(c.phoneMasked), disabled: true }) +
          '<button type="submit" class="xb-btn xb-btn--primary" data-save>保存修改</button>' +
        '</form>' +
      '</div>';

    syncFields(box);

    doc.getElementById('profile-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var btn = form.querySelector('[data-save]');
      btn.disabled = true;
      api('/api/auth/profile', {
        method: 'PATCH',
        body: {
          nickname: form.querySelector('[name="nickname"]').value.trim(),
          email: form.querySelector('[name="email"]').value.trim()
        }
      }).then(function (data) {
        state.customer = Object.assign({}, state.customer, data.customer);
        state.panel = 'profile';
        state.notice = { text: '资料已更新', error: false };
        renderAccount();
      }).catch(function (err) {
        notify(err.message, true);
        btn.disabled = false;
      });
    });
  }

  function renderPasswordPanel() {
    var box = doc.getElementById('acct-panel');
    if (!box) return;

    box.innerHTML = panelHead('修改密码', '修改后其它设备会自动下线') +
      '<div class="acct-card">' +
        '<form class="acct-form" id="pw-form">' +
          field({ name: 'current', type: 'password', autocomplete: 'current-password', label: '当前密码' }) +
          field({ name: 'next', type: 'password', autocomplete: 'new-password', label: '新密码', hint: '至少 8 位，不能是纯数字' }) +
          field({ name: 'confirm', type: 'password', autocomplete: 'new-password', label: '确认新密码' }) +
          '<button type="submit" class="xb-btn xb-btn--primary" data-save>更新密码</button>' +
        '</form>' +
        '<div class="acct-note">忘记密码目前需要联系品牌客服人工核验身份后重置。</div>' +
      '</div>';

    syncFields(box);

    doc.getElementById('pw-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var current = form.querySelector('[name="current"]').value;
      var next = form.querySelector('[name="next"]').value;
      var confirm = form.querySelector('[name="confirm"]').value;

      if (next.length < 8) return notify('新密码至少 8 位', true);
      if (/^\d+$/.test(next)) return notify('新密码不能是纯数字', true);
      if (next !== confirm) return notify('两次输入的新密码不一致', true);

      var btn = form.querySelector('[data-save]');
      btn.disabled = true;
      api('/api/auth/password', { method: 'POST', body: { current: current, next: next } })
        .then(function () {
          state.panel = 'password';
          state.notice = { text: '密码已更新，其它设备已退出登录', error: false };
          renderAccount();
        })
        .catch(function (err) {
          notify(err.message, true);
          btn.disabled = false;
        });
    });
  }

  /* ---------------------------------------------------------------- */

  function start() {
    api('/api/auth/me')
      .then(function (data) {
        state.customer = data.customer;
        state.orders = { items: [], total: 0, stats: data.orders };
        state.couponStats = data.coupons || { active: 0 };
        if (location.hash === '#coupons') state.panel = 'coupons';
        renderAccount();
        loadOrders();
      })
      .catch(function (err) {
        if (err.status && err.status !== 401) {
          root.innerHTML = '<div class="acct-empty"><h3>暂时无法连接后台</h3>' +
            '<p>' + esc(err.message) + '</p></div>';
          return;
        }
        renderAuth();
      });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
