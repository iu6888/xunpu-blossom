/* 蟳埔花事 · 礼袋 / 结算 / 联系信息（后端对接层）
 *
 * 设计原则：渐进增强。
 * 若后端未部署（/api/health 不可达），本脚本自动退出，站点保持纯静态、功能不受影响。
 */
(function () {
  'use strict';

  var API = '';
  var state = { cart: null, product: null, variant: null, qty: 1, view: 'cart', busy: false, contact: null, customer: null, authReady: null, checkoutCoupon: null };

  var els = {};
  var doc = document;

  /* ---------------------------------------------------------------- */
  /* 基础工具                                                          */
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

  function api(path, options) {
    var opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (payload) {
        if (!res.ok || !payload || payload.ok === false) {
          var msg = (payload && payload.error && payload.error.message) || '请求失败（' + res.status + '）';
          throw new Error(msg);
        }
        return payload.data;
      });
    });
  }

  function el(tag, className, html) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  const slugFromPath = (function () {
    // 独立商品页：product-garland.html → garland
    var m = location.pathname.match(/product-([a-z0-9-]+)\.html$/i);
    if (m) return m[1];
    // 通用商品页：product.html?slug=item-123456
    if (/\/product\.html$/i.test(location.pathname)) {
      var q = '';
      try {
        q = new URLSearchParams(location.search).get('slug') || '';
      } catch (err) {
        q = '';
      }
      q = q.replace(/[^a-zA-Z0-9-]/g, '');
      return q || null;
    }
    return null;
  })();

  /* ---------------------------------------------------------------- */
  /* 界面骨架                                                          */
  /* ---------------------------------------------------------------- */

  function build() {
    els.overlay = el('div', 'xb-overlay');
    els.overlay.addEventListener('click', close);

    els.drawer = el('div', 'xb-drawer');
    els.drawer.setAttribute('role', 'dialog');
    els.drawer.setAttribute('aria-modal', 'true');
    els.drawer.setAttribute('aria-label', '礼袋');
    els.drawer.innerHTML =
      '<div class="xb-drawer__head">' +
        '<div>' +
          '<h2 class="xb-drawer__title">礼袋</h2>' +
          '<span class="xb-drawer__sub">Gift Bag</span>' +
        '</div>' +
        '<button class="xb-close" type="button" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="xb-drawer__body"></div>' +
      '<div class="xb-drawer__foot"></div>';

    els.body = els.drawer.querySelector('.xb-drawer__body');
    els.foot = els.drawer.querySelector('.xb-drawer__foot');
    els.drawer.querySelector('.xb-close').addEventListener('click', close);

    doc.body.appendChild(els.overlay);
    doc.body.appendChild(els.drawer);

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function open() {
    els.overlay.classList.add('is-open');
    els.drawer.classList.add('is-open');
    doc.body.style.overflow = 'hidden';
    state.view = 'cart';

    /* 礼袋需登录：先确认身份再决定是购物袋还是登录引导 */
    var ready = state.authReady || Promise.resolve(state.customer || null);
    ready.then(function (customer) {
      if (customer) {
        state.customer = customer;
        refreshCart();
        return;
      }
      renderLoginGate();
    });
  }

  /** 未登录时的礼袋面板：只给登录引导，不展示任何购物袋内容 */
  function renderLoginGate() {
    els.body.innerHTML =
      '<div class="xb-state">' +
        '<div class="xb-state__mark">花</div>' +
        '<h3>登录后才能使用礼袋</h3>' +
        '<p>礼袋会存进你的账户，<br>换台设备也能接着挑。</p>' +
        '<div class="xb-state__actions">' +
          '<a class="xb-btn xb-btn--primary xb-btn--sm" href="account.html">去登录 / 注册</a>' +
        '</div>' +
      '</div>';
    els.foot.innerHTML = '';
    state.view = 'gate';
  }

  function close() {
    els.overlay.classList.remove('is-open');
    els.drawer.classList.remove('is-open');
    doc.body.style.overflow = '';
  }

  /** 顶栏礼袋入口：右上角按钮 + 数量角标 */
  function mountCartEntry(host) {
    if (!host || host.querySelector('.xb-cart-btn')) return;
    var btn = el('button', 'xb-cart-btn', '礼袋<span class="xb-cart-btn__count" hidden></span>');
    btn.type = 'button';
    btn.setAttribute('aria-label', '打开礼袋');
    btn.addEventListener('click', open);
    host.appendChild(btn);
    els.count = btn.querySelector('.xb-cart-btn__count');
  }

  /** 顶栏右上角按钮组：礼袋 + 账户，插在汉堡菜单之前 */
  function mountHeaderActions() {
    var header = doc.querySelector('.site-header__inner');
    if (!header) return;
    var actions = header.querySelector('.xb-header-actions');
    if (!actions) {
      actions = el('div', 'xb-header-actions');
      var toggle = header.querySelector('.nav-toggle');
      if (toggle) header.insertBefore(actions, toggle);
      else header.appendChild(actions);
    }
    mountCartEntry(actions);
    mountAccountEntry(actions);
  }

  /** 顶栏账户入口 */
  function mountAccountEntry(host) {
    host = host || doc.querySelector('.site-header__inner');
    if (!host || doc.querySelector('.xb-account-btn')) return;

    // 未登录显示「登录」，已登录显示昵称
    var acct = el('a', 'xb-account-btn', '登录');
    acct.href = 'account.html';
    acct.setAttribute('aria-label', '我的账户');
    host.appendChild(acct);
    els.accountBtn = acct;
  }

  function paintAccount(customer) {
    state.customer = customer || null;
    var btn = els.accountBtn || doc.querySelector('.xb-account-btn');
    if (!btn) return;
    if (customer) {
      btn.textContent = customer.nickname;
      btn.classList.add('is-in');
      btn.title = customer.phoneMasked + ' · 我的账户';
    } else {
      btn.textContent = '登录';
      btn.classList.remove('is-in');
      btn.title = '登录 / 注册';
    }
  }

  function updateCount(n) {
    if (!els.count) return;
    var show = !!state.customer && Number(n) > 0;   /* 未登录不显示角标 */
    els.count.hidden = !show;
    els.count.textContent = show ? String(n) : '';
  }

  /* ---------------------------------------------------------------- */
  /* 商品页：规格选择 + 加入礼袋                                        */
  /* ---------------------------------------------------------------- */

  function mountProductBuy(product) {
    var anchor = doc.querySelector('.pdp__price') || doc.querySelector('.pdp__info');
    if (!anchor || doc.querySelector('.xb-picker')) return;

    state.product = product;
    var variants = (product.variants || []).filter(function (v) { return v.status === 'active'; });
    if (!variants.length) return;

    state.variant = variants.find(function (v) { return v.inStock; }) || variants[0];

    var wrap = el('div');

    if (variants.length > 1) {
      var picker = el('div', 'xb-picker',
        '<span class="xb-picker__label">选择款式 · ' + variants.length + ' 种</span>' +
        '<div class="xb-picker__opts">' +
          variants.map(function (v) {
            return '<button type="button" class="xb-opt' + (v.id === state.variant.id ? ' is-active' : '') + '"' +
              ' data-variant="' + v.id + '"' + (v.stock === 0 ? ' disabled' : '') + '>' +
              esc(v.name) + (v.priceCents !== product.priceFromCents ? ' · ' + money(v.price) : '') +
              '</button>';
          }).join('') +
        '</div>');
      wrap.appendChild(picker);

      picker.addEventListener('click', function (e) {
        var b = e.target.closest('[data-variant]');
        if (!b || b.disabled) return;
        state.variant = variants.find(function (v) { return String(v.id) === b.dataset.variant; });
        picker.querySelectorAll('.xb-opt').forEach(function (o) {
          o.classList.toggle('is-active', o === b);
        });
        syncBuyState();
      });
    }

    var buy = el('div', 'xb-buy',
      '<div class="xb-buy__qty">' +
        '<button type="button" data-step="-1" aria-label="减少">−</button>' +
        '<span data-qty>1</span>' +
        '<button type="button" data-step="1" aria-label="增加">+</button>' +
      '</div>' +
      '<button type="button" class="xb-btn xb-btn--primary" data-add>加入礼袋</button>' +
      '<button type="button" class="xb-btn" data-buynow>立即结算</button>');
    wrap.appendChild(buy);

    var note = el('p', 'xb-hint');
    wrap.appendChild(note);
    els.buyNote = note;

    anchor.insertAdjacentElement('afterend', wrap);

    buy.addEventListener('click', function (e) {
      var step = e.target.closest('[data-step]');
      if (step) {
        state.qty = Math.max(1, Math.min(99, state.qty + Number(step.dataset.step)));
        buy.querySelector('[data-qty]').textContent = String(state.qty);
        syncBuyState();
        return;
      }
      if (e.target.closest('[data-add]')) addToCart(false);
      if (e.target.closest('[data-buynow]')) addToCart(true);
    });

    syncBuyState();
  }

  function syncBuyState() {
    var v = state.variant;
    var buy = doc.querySelector('.xb-buy');
    if (!v || !buy) return;
    var max = Math.min(99, v.stock);
    if (state.qty > max) state.qty = Math.max(1, max);
    buy.querySelector('[data-qty]').textContent = String(state.qty);
    buy.querySelectorAll('[data-step]').forEach(function (b) {
      var dir = Number(b.dataset.step);
      b.disabled = dir > 0 ? state.qty >= max : state.qty <= 1;
    });
    var add = buy.querySelector('[data-add]');
    var now = buy.querySelector('[data-buynow]');
    var out = v.stock === 0;
    add.disabled = out;
    now.disabled = out;
    add.textContent = out ? '暂时售罄' : '加入礼袋';
    if (els.buyNote) {
      els.buyNote.textContent = !state.customer
        ? '登录后才能加入礼袋 · 礼袋会存进你的账户'
        : (out
          ? '这一款暂时售罄，可联系品牌预约补货。'
          : (v.stock <= 5 ? '仅剩 ' + v.stock + ' 件 · 手工制作，售完需等下一批。' : '泉州本地工艺 · 现货 7 天内发出'));
    }
  }

  function addToCart(goCheckout) {
    if (!state.customer) { open(); return; }        /* 礼袋需登录：未登录直接给登录引导 */
    if (!state.variant || state.busy) return;
    state.busy = true;
    var btn = doc.querySelector('[data-add]');
    if (btn) btn.disabled = true;

    api('/api/cart/items', { method: 'POST', body: { variantId: state.variant.id, qty: state.qty } })
      .then(function (cart) {
        state.cart = cart;
        updateCount(cart.count);
        open();
        if (goCheckout) setTimeout(function () { showCheckout(); }, 320);
      })
      .catch(function (err) {
        open();
        renderError(err.message);
      })
      .finally(function () {
        state.busy = false;
        if (btn) btn.disabled = false;
        syncBuyState();
      });
  }

  /* ---------------------------------------------------------------- */
  /* 礼袋渲染                                                          */
  /* ---------------------------------------------------------------- */

  function refreshCart() {
    return api('/api/cart').then(function (cart) {
      state.cart = cart;
      updateCount(cart.count);
      render();
    }).catch(function (err) {
      renderError(err.message);
    });
  }

  function renderError(message) {
    els.body.innerHTML = '<p class="xb-error">' + esc(message) + '</p>';
  }

  function render() {
    var cart = state.cart;
    if (!cart || !cart.items.length) {
      els.body.innerHTML =
        '<div class="xb-state">' +
          '<div class="xb-state__mark">花</div>' +
          '<h3>礼袋还是空的</h3>' +
          '<p>挑一顶花冠，或一枚三十九元的花签，<br>都能把泉州带走一点。</p>' +
          '<div class="xb-state__actions">' +
            '<a class="xb-btn xb-btn--primary xb-btn--sm" href="collection.html">浏览六件礼物</a>' +
          '</div>' +
        '</div>';
      els.foot.innerHTML = '';
      return;
    }

    els.body.innerHTML = cart.items.map(function (i) {
      return '<div class="xb-line" data-item="' + i.id + '">' +
        '<img class="xb-line__img" src="' + esc(i.image || 'assets/img/logo.svg') + '" alt="">' +
        '<div>' +
          '<div class="xb-line__name">' + esc(i.name) + '</div>' +
          '<div class="xb-line__meta">' + esc(i.variantName) + ' · ' + i.priceText + '</div>' +
          '<div class="xb-qty">' +
            '<button type="button" data-dec aria-label="减少">−</button>' +
            '<span>' + i.qty + '</span>' +
            '<button type="button" data-inc aria-label="增加"' + (i.qty >= i.maxQty ? ' disabled' : '') + '>+</button>' +
          '</div>' +
        '</div>' +
        '<div class="xb-line__right">' +
          '<div class="xb-line__price">' + i.subtotalText + '</div>' +
          '<button type="button" class="xb-line__del" data-del>移除</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var gap = cart.freeShippingGapCents;
    els.foot.innerHTML =
      '<div class="xb-sums">' +
        '<div class="xb-sums__row"><span>商品合计</span><span>' + cart.itemsTotalText + '</span></div>' +
        '<div class="xb-sums__row"><span>运费</span><span>' + (cart.shippingFeeCents ? cart.shippingFeeText : '免运费') + '</span></div>' +
        '<div class="xb-sums__row xb-sums__row--total"><span>应付</span><strong>' + cart.totalText + '</strong></div>' +
      '</div>' +
      '<p class="xb-hint' + (gap === 0 ? ' xb-hint--free' : '') + '">' +
        (gap > 0 ? '再选 ' + money(gap / 100) + ' 免运费' : '已满足免运费 · 全国顺丰') +
      '</p>' +
      '<div style="margin-top:14px"><button type="button" class="xb-btn xb-btn--primary" data-checkout>去结算</button></div>';

    els.foot.querySelector('[data-checkout]').addEventListener('click', showCheckout);
    els.body.querySelectorAll('[data-item]').forEach(bindLine);
  }

  function bindLine(row) {
    var id = row.dataset.item;
    var idx = state.cart.items.findIndex(function (i) { return String(i.id) === id; });
    if (idx < 0) return;
    var item = state.cart.items[idx];

    row.querySelector('[data-dec]').addEventListener('click', function () {
      patchQty(id, item.qty - 1);
    });
    row.querySelector('[data-inc]').addEventListener('click', function () {
      patchQty(id, item.qty + 1);
    });
    row.querySelector('[data-del]').addEventListener('click', function () {
      api('/api/cart/items/' + id, { method: 'DELETE' }).then(function (cart) {
        state.cart = cart;
        updateCount(cart.count);
        render();
      }).catch(function (err) { renderError(err.message); });
    });
  }

  function patchQty(id, qty) {
    api('/api/cart/items/' + id, { method: 'PATCH', body: { qty: qty } })
      .then(function (cart) {
        state.cart = cart;
        updateCount(cart.count);
        render();
      })
      .catch(function (err) {
        var box = els.body.querySelector('.xb-error');
        if (box) box.remove();
        els.body.insertAdjacentHTML('afterbegin', '<p class="xb-error">' + esc(err.message) + '</p>');
      });
  }

  /* ---------------------------------------------------------------- */
  /* 结算                                                              */
  /* ---------------------------------------------------------------- */

  function latestCouponCode() {
    try {
      var all = JSON.parse(localStorage.getItem('xb-coupons') || '[]');
      if (!Array.isArray(all)) return '';
      for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].code) return String(all[i].code);
      }
    } catch (e) { /* 隐私模式忽略 */ }
    return '';
  }

  function couponDiscountCents() {
    return state.checkoutCoupon ? (Number(state.checkoutCoupon.discountCents) || 0) : 0;
  }

  function payableCents() {
    if (!state.cart) return 0;
    return Math.max(0, (Number(state.cart.totalCents) || 0) - couponDiscountCents());
  }

  function paintCheckoutTotals() {
    var discount = couponDiscountCents();
    var row = els.body.querySelector('#xb-discount-row');
    var amount = els.body.querySelector('#xb-discount');
    var payable = els.body.querySelector('#xb-payable');
    var submit = els.foot.querySelector('[data-submit]');
    if (row) row.hidden = discount <= 0;
    if (amount) amount.textContent = '-' + money(discount / 100);
    if (payable) payable.textContent = money(payableCents() / 100);
    if (submit && !submit.disabled) submit.textContent = '提交订单 · ' + money(payableCents() / 100);
  }

  function checkoutCouponNote(text, kind) {
    var note = els.body.querySelector('#xb-coupon-note');
    if (!note) return;
    note.className = 'xb-coupon-note' + (kind ? ' is-' + kind : '');
    note.textContent = text;
  }

  function checkCoupon() {
    var input = els.body.querySelector('#xb-coupon-code');
    if (!input) return Promise.resolve();
    var code = String(input.value || '').trim().toUpperCase();

    if (!code) {
      state.checkoutCoupon = null;
      paintCheckoutTotals();
      checkoutCouponNote('通关游戏可得 ¥5 券，满 ¥59 可用', '');
      return Promise.resolve();
    }

    var btn = els.body.querySelector('[data-coupon-check]');
    if (btn) { btn.disabled = true; btn.textContent = '核对中…'; }
    checkoutCouponNote('正在核对券码…', '');

    return api('/api/coupons/check', {
      method: 'POST',
      body: { couponCode: code, itemsTotalCents: state.cart.itemsTotalCents }
    }).then(function (d) {
      state.checkoutCoupon = d;
      paintCheckoutTotals();
      checkoutCouponNote('已抵扣 ' + d.discountText + '，用券后应付 ' + d.totalAfterText, 'ok');
    }).catch(function (err) {
      state.checkoutCoupon = null;
      paintCheckoutTotals();
      checkoutCouponNote(err.message, 'warn');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = '核对券码'; }
    });
  }

  function showCheckout() {
    state.view = 'checkout';
    state.checkoutCoupon = null;
    if (!state.cart || !state.cart.items.length) return;

    var c = state.contact || {};
    var savedCode = latestCouponCode();

    els.body.innerHTML =
      '<p class="xb-error" hidden></p>' +
      '<div class="xb-sums" id="xb-checkout-sums" style="margin-bottom:16px">' +
        '<div class="xb-sums__row"><span>' + state.cart.count + ' 件商品</span><span>' + state.cart.itemsTotalText + '</span></div>' +
        '<div class="xb-sums__row"><span>运费</span><span>' + (state.cart.shippingFeeCents ? state.cart.shippingFeeText : '免运费') + '</span></div>' +
        '<div class="xb-sums__row xb-sums__row--discount" id="xb-discount-row" hidden><span>优惠券</span><span id="xb-discount">-¥0</span></div>' +
        '<div class="xb-sums__row xb-sums__row--total"><span>应付</span><strong id="xb-payable">' + state.cart.totalText + '</strong></div>' +
      '</div>' +
      '<div class="xb-form">' +
        '<div class="xb-form__row">' +
          '<label class="xb-field"><span>收货人</span><input name="name" autocomplete="name" required></label>' +
          '<label class="xb-field"><span>手机号</span><input name="phone" inputmode="numeric" autocomplete="tel" required></label>' +
        '</div>' +
        '<label class="xb-field xb-field--full"><span>收货地址</span><input name="address" autocomplete="street-address" placeholder="省 / 市 / 区 / 详细地址" required></label>' +
        '<label class="xb-field xb-field--full"><span>优惠券（可选）</span><input name="couponCode" id="xb-coupon-code" maxlength="20" autocomplete="off" placeholder="XBXXXXXXXX" value="' + esc(savedCode) + '"></label>' +
        '<div class="xb-coupon-row">' +
          '<button type="button" class="xb-btn xb-btn--sm" data-coupon-check>核对券码</button>' +
          '<span class="xb-coupon-note" id="xb-coupon-note">通关游戏可得 ¥5 券，满 ¥59 可用</span>' +
        '</div>' +
        '<label class="xb-field xb-field--full"><span>备注（可选）</span><textarea name="note" rows="2" placeholder="祝福卡文案、指定配色、期望送达时间"></textarea></label>' +
      '</div>' +
      '<p class="xb-hint">提交后我们会在 1 个工作日内与你确认。' + (c.hours ? ' 客服时间：' + esc(c.hours) : '') + '</p>';

    // 已登录顾客自动带出资料
    if (state.customer) {
      var nameInput = els.body.querySelector('[name="name"]');
      var phoneInput = els.body.querySelector('[name="phone"]');
      if (nameInput && !nameInput.value) nameInput.value = state.customer.nickname || '';
      if (phoneInput && !phoneInput.value) phoneInput.value = state.customer.phone || '';
    }

    els.foot.innerHTML =
      '<button type="button" class="xb-btn" data-back>返回礼袋</button>' +
      '<div style="height:8px"></div>' +
      '<button type="button" class="xb-btn xb-btn--primary" data-submit>提交订单 · ' + state.cart.totalText + '</button>';

    els.foot.querySelector('[data-back]').addEventListener('click', function () {
      state.view = 'cart';
      render();
    });
    els.foot.querySelector('[data-submit]').addEventListener('click', submitOrder);
    els.body.querySelector('[data-coupon-check]').addEventListener('click', checkCoupon);
    els.body.querySelector('#xb-coupon-code').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); checkCoupon(); }
    });

    // 有本机券码就带出来并自动核一次；登录顾客则取最近一张可用券
    if (savedCode) {
      checkCoupon();
    } else if (state.customer) {
      api('/api/coupons').then(function (d) {
        var list = (d && d.items) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].status === 'active' && state.cart.itemsTotalCents >= list[i].minSpendCents) {
            var input = els.body.querySelector('#xb-coupon-code');
            if (input && !input.value) {
              input.value = list[i].code;
              checkCoupon();
            }
            break;
          }
        }
      }).catch(function () { /* 没有券就保持空 */ });
    }
  }

  function submitOrder() {
    if (state.busy) return;
    var form = els.body.querySelector('.xb-form');
    var errBox = els.body.querySelector('.xb-error');
    var get = function (n) { return (form.querySelector('[name="' + n + '"]').value || '').trim(); };

    var name = get('name');
    var phone = get('phone');
    var address = get('address');
    var note = get('note');

    if (!name) return showFormError(errBox, '请填写收货人');
    if (!/^1[3-9]\d{9}$/.test(phone.replace(/[\s-]/g, ''))) return showFormError(errBox, '手机号格式不正确');
    if (address.length < 4) return showFormError(errBox, '请填写完整的收货地址');

    state.busy = true;
    var btn = els.foot.querySelector('[data-submit]');
    btn.disabled = true;
    btn.textContent = '提交中…';

    api('/api/orders', {
      method: 'POST',
      body: {
        customer: { name: name, phone: phone, address: address },
        note: note,
        couponCode: (form.querySelector('[name="couponCode"]') ? form.querySelector('[name="couponCode"]').value.trim() : ''),
        channel: 'web',
        fulfillment: 'express',
        idempotencyKey: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      }
    }).then(function (order) {
      state.cart = { items: [], count: 0 };
      updateCount(0);
      showSuccess(order);
    }).catch(function (err) {
      showFormError(errBox, err.message);
      btn.disabled = false;
      btn.textContent = '提交订单 · ' + money(payableCents() / 100);
    }).finally(function () {
      state.busy = false;
    });
  }

  function showFormError(box, message) {
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }

  function showSuccess(order) {
    els.body.innerHTML =
      '<div class="xb-state">' +
        '<div class="xb-state__mark">✓</div>' +
        '<h3>订单已提交</h3>' +
        '<p>我们会在 1 个工作日内与你确认。<br>请保存订单号，可随时查询进度。</p>' +
        '<div class="xb-state__no">' + esc(order.orderNo) + '</div>' +
        '<p class="small">合计 ' + esc(order.totalText) + ' · 满 ¥299 免运费</p>' +
        (order.discountCents > 0
          ? '<p class="small">已用券 ' + esc(order.couponCode || '') + ' 抵扣 ' + esc(order.discountText) + '</p>'
          : '') +
      '</div>';
    els.foot.innerHTML = '<button type="button" class="xb-btn xb-btn--primary" data-done>继续逛逛</button>';
    els.foot.querySelector('[data-done]').addEventListener('click', function () {
      close();
      if (slugFromPath) location.reload();
      else if (location.pathname.indexOf('collection') < 0) location.href = 'collection.html';
    });
  }

  /* ---------------------------------------------------------------- */
  /* 站点文案：联系信息 / 公告                                          */
  /* ---------------------------------------------------------------- */

  function applyContent(content) {
    if (!content) return;
    state.contact = content.contact || null;

    var c = content.contact;
    if (c) {
      doc.querySelectorAll('.contact-item').forEach(function (item) {
        var dt = item.querySelector('dt');
        var dd = item.querySelector('dd');
        if (!dt || !dd || dd.textContent.trim() !== '***') return;
        var label = dt.textContent.trim();
        var value = label === '合作邮箱' ? c.email : label === '品牌电话' ? c.phone : label === '线下展厅' ? c.showroom : '';
        if (value) dd.textContent = value;
      });

      doc.querySelectorAll('[data-copy]').forEach(function (btn) {
        if (btn.getAttribute('data-copy') === '***' && c.email) btn.setAttribute('data-copy', c.email);
      });
    }

    var notice = content.notice;
    if (notice && notice.enabled && notice.text && !doc.querySelector('.xb-notice')) {
      var bar = el('div', 'xb-notice',
        esc(notice.text) + (notice.link ? ' <a href="' + esc(notice.link) + '">查看</a>' : ''));
      doc.body.insertBefore(bar, doc.body.firstChild);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 启动                                                              */
  /* ---------------------------------------------------------------- */

  function start() {
    build();
    mountHeaderActions();

    /* 身份先行：礼袋是否可用、角标是否显示都由它决定 */
    state.authReady = api('/api/auth/me')
      .then(function (data) {
        paintAccount(data.customer);
        return data.customer || null;
      })
      .catch(function () {
        paintAccount(null);
        return null;
      });

    state.authReady.then(function (customer) {
      if (customer) {
        api('/api/cart').then(function (cart) {
          state.cart = cart;
          updateCount(cart.count);
        }).catch(function () { /* 静默 */ });
      }
      syncBuyState();   /* 商品页：未登录时把提示换成「登录后才能加入礼袋」 */
    });

    // 账户页登录 / 退出后同步顶栏
    window.addEventListener('xb:auth', function (e) {
      paintAccount(e.detail);
      state.authReady = Promise.resolve(e.detail || null);
      if (e.detail) {
        api('/api/cart').then(function (cart) {
          state.cart = cart;
          updateCount(cart.count);
        }).catch(function () {});
      } else {
        state.cart = null;
        updateCount(0);
      }
      syncBuyState();
    });

    // 账户页登录/退出后同步角标
    window.addEventListener('xb:cart', function (e) {
      if (e.detail) {
        state.cart = e.detail;
        updateCount(e.detail.count);
        return;
      }
      api('/api/cart').then(function (cart) {
        state.cart = cart;
        updateCount(cart.count);
      }).catch(function () {});
      api('/api/auth/me')
        .then(function (data) { paintAccount(data.customer); })
        .catch(function () { paintAccount(null); });
    });

    api('/api/content').then(applyContent).catch(function () { /* 静默 */ });

    if (slugFromPath) {
      api('/api/products/' + encodeURIComponent(slugFromPath))
        .then(function (product) { mountProductBuy(product); })
        .catch(function () { /* 静默 */ });
    }
  }

  function probe() {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 2500);

    fetch(API + '/api/health', controller ? { signal: controller.signal } : {})
      .then(function (res) {
        clearTimeout(timer);
        if (res.ok) start();
      })
      .catch(function () {
        clearTimeout(timer);
        /* 后端未部署：保持纯静态站点行为 */
      });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', probe);
  } else {
    probe();
  }
})();
