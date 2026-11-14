/* 蟳埔花事 · 商品列表动态渲染
 *
 * 设计原则：后端优先、静态兜底。
 * - 接口可用：用数据库里的在售商品重建卡片（后台新上架的商品立刻出现）
 * - 接口不可用：保持页面里原有的静态卡片不动，站点仍可正常浏览
 */
(function () {
  'use strict';

  var doc = document;

  /* 已有独立详情页的商品：卡片直接链过去（这些页面有更完整的内容与 SEO 信息） */
  var STATIC_PAGES = {
    garland: 'product-garland.html',
    scarf: 'product-scarf.html',
    incense: 'product-incense.html',
    cup: 'product-cup.html',
    bookmark: 'product-bookmark.html',
    giftbox: 'product-giftbox.html'
  };

  var CAT_EN = { wear: 'Wearable', scent: 'Fragrance', textile: 'Textile', object: 'Object', gift: 'Gift Set' };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** 图片路径：兼容「assets/img/x.png」「/assets/img/x.png」「http(s)://…」三种写法 */
  function imgOf(product) {
    var s = String((product && product.image) || '').trim();
    if (!s) return 'assets/img/logo.svg';
    if (/^(https?:)?\/\//i.test(s) || s.indexOf('data:') === 0) return s;
    return '/' + s.replace(/^\/+/, '');
  }

  function hrefOf(product) {
    return STATIC_PAGES[product.slug] || ('product.html?slug=' + encodeURIComponent(product.slug));
  }

  function textOf(product) {
    var t = String(product.tagline || product.description || '').replace(/\s+/g, ' ').trim();
    return t.length > 64 ? t.slice(0, 64) + '…' : t;
  }

  function priceOf(product) {
    var text = product.priceFromText || ('¥' + (product.priceFrom || 0));
    return String(text).replace(/^[¥￥]\s*/, '');
  }

  function cardHTML(product, index, opts) {
    var heading = opts.heading || 'h3';
    var cats = product.categories && product.categories.length ? product.categories : [product.category];
    var primary = cats[0] || 'object';
    var tag = product.featured ? '<span class="card__tag">主推</span>' : '';

    var en = '<span class="card__en">' + pad(index + 1) + ' / ' + esc(CAT_EN[primary] || 'Object') + '</span>';
    var name = '<' + heading + ' class="card__name">' + esc(product.name) + '</' + heading + '>';

    return '<article class="card reveal is-in" data-category="' + esc(cats.join(' ')) + '" data-delay="' + (index % 3) + '">' +
      '<div class="card__media">' + tag +
        '<img src="' + esc(imgOf(product)) + '" alt="' + esc(product.name) + '" loading="lazy">' +
      '</div>' +
      '<div class="card__body">' +
        (opts.enFirst ? en + name : name + en) +
        '<p class="card__desc">' + esc(textOf(product)) + '</p>' +
        '<div class="card__foot">' +
          '<span class="price">¥' + esc(priceOf(product)) + '<small>起</small></span>' +
          '<a class="card__more" href="' + esc(hrefOf(product)) + '">查看详情 →</a>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function fetchProducts(query) {
    return fetch('/api/products?' + query, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (payload) {
      if (!payload || payload.ok === false) throw new Error('接口返回异常');
      var data = payload.data || payload;
      return (data.items || []).filter(function (p) {
        return p && p.status !== 'archived' && p.slug;
      });
    });
  }

  function emitRendered() {
    var ev;
    try {
      ev = new CustomEvent('catalog:rendered');
    } catch (err) {
      ev = doc.createEvent('Event');
      ev.initEvent('catalog:rendered', true, true);
    }
    doc.dispatchEvent(ev);
  }

  var grid = doc.querySelector('[data-catalog]');
  if (!grid) return;

  var isHome = grid.getAttribute('data-catalog') === 'home';
  var opts = isHome ? { heading: 'h3', enFirst: false } : { heading: 'h2', enFirst: true };

  /* 图片加载失败的兜底：换成品牌标识，避免出现破图标 */
  grid.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && !img.getAttribute('data-fb')) {
      img.setAttribute('data-fb', '1');
      img.src = 'assets/img/logo.svg';
    }
  }, true);

  /* 首页取「主推」里最新的三件：新上架并勾选主推的商品能立刻露头 */
  var primary = isHome ? 'featured=1&limit=3&sort=newest' : 'limit=60&sort=featured';

  fetchProducts(primary)
    .then(function (items) {
      /* 首页主推不足三件时，用其余在售商品补齐，避免出现大片空白 */
      if (!isHome || items.length >= 3) return items;
      return fetchProducts('limit=3&sort=newest').then(function (all) {
        var seen = {};
        items.forEach(function (p) { seen[p.slug] = 1; });
        all.forEach(function (p) {
          if (items.length < 3 && !seen[p.slug]) {
            items.push(p);
            seen[p.slug] = 1;
          }
        });
        return items;
      });
    })
    .then(function (items) {
      if (!items.length) return;

      grid.innerHTML = items.map(function (p, i) {
        return cardHTML(p, i, opts);
      }).join('');

      var count = doc.querySelector('[data-count]');
      if (count) count.textContent = String(items.length);

      var link = doc.querySelector('[data-total]');
      if (link) link.textContent = String(items.length);

      emitRendered();
    })
    .catch(function () {
      /* 接口不可用：保留静态卡片，不做任何破坏性操作 */
    });
})();
