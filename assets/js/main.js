/* 蟳埔花事 · 站点交互（原生 JS，无依赖） */
(function () {
  'use strict';

  var doc = document;
  var body = doc.body;

  /* ---------- 0. 入场闸门 ----------
     由站内跳转而来时，落地页先被米色幕布盖着（抬升 600ms + 120ms 延迟）。
     场景动画（渐显、数字滚动）挂在闸门后面，幕布走完才放行，
     否则动画在幕布后面悄悄演完，用户看到的只是一个静止页面。 */
  var rootEl = doc.documentElement;
  var arriving = rootEl.className.indexOf('wipe-arrive') !== -1;
  var entranceReady = false;
  var entranceWaiters = [];

  function releaseEntrance() {
    if (entranceReady) return;
    entranceReady = true;
    var queue = entranceWaiters.slice();
    entranceWaiters.length = 0;
    queue.forEach(function (fn) { fn(); });
  }

  function onEntranceReady(fn) {
    if (entranceReady) fn();
    else entranceWaiters.push(fn);
  }

  var gateReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 开场（intro-boot）走另一条闸门：玫瑰演完、幕布开始抬升后再放行，
     首屏的渐显 / 数字滚动才落在用户看得见的那一拍上；
     站内跳转（wipe-arrive）不受影响，仍按幕布抬完的时机放行。 */
  var introPending = !arriving && rootEl.className.indexOf('intro-boot') !== -1;

  if (arriving && !gateReduceMotion) {
    var wipeEl = doc.querySelector('.wipe');
    var liftDone = false;
    /* 幕布抬完后再留一点空档，让“切换结束”和“场景开始”分成两拍 */
    var ENTRANCE_GAP = 140;
    var openGate = function () {
      if (liftDone) return;
      liftDone = true;
      rootEl.classList.remove('wipe-arrive');
      window.setTimeout(releaseEntrance, ENTRANCE_GAP);
    };
    if (wipeEl) {
      wipeEl.addEventListener('animationend', function (event) {
        if (event.animationName === 'wipe-lift') openGate();
      });
    }
    /* 动画被系统节流或用户中途切页时的兜底 */
    window.setTimeout(openGate, 1000);
  } else if (introPending && !gateReduceMotion) {
    var INTRO_LIFT = 580;   /* 比 .intro 的 780ms 掀幕早 200ms 起跑，收尾与抬幕交叠 */
    var INTRO_GAP = 60;     /* 加一点空档，避免两个动作同时卡在同一帧起步 */
    var introGateOpen = false;
    var openIntroGate = function () {
      if (introGateOpen) return;
      introGateOpen = true;
      window.setTimeout(releaseEntrance, INTRO_LIFT + INTRO_GAP);
    };
    doc.addEventListener('xb:intro-lift', openIntroGate, { once: true });
    /* 兜底：开场脚本半路失败也不能把首屏一直关着 */
    window.setTimeout(openIntroGate, 4500);
  } else {
    releaseEntrance();
  }

  /* ---------- 1. 移动端导航 ---------- */
  var toggle = doc.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    doc.querySelectorAll('.nav a').forEach(function (link) {
      link.addEventListener('click', function () {
        body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- 2. 顶栏滚动态 ---------- */
  var header = doc.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 2b. 滚轮弹簧滚动 ---------- */
  /* 自己接管滚轮：滚轮只负责推「目标位置」，真正的 scrollTop 以欠阻尼弹簧追目标。
     于是 —— 松手那一刻的速度会被带着走（位置还落后于目标）、到点会略微过冲再回落
     （ζ < 1 的固有行为）、在页面首尾继续滚会把位置推出边界，超滚量换算成整页位移，
     弹簧再把它拉回 0，就是边界回弹。
     阻尼比 / 频率可在控制台调：xbSpringScroll.set({ zeta: 0.5, freq: 3 }) */
  (function () {
    'use strict';

    var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var coarseQuery = window.matchMedia ? window.matchMedia('(hover: none) and (pointer: coarse)') : null;

    /* 触屏与「减少动态效果」保持原生滚动：系统的惯性比脚本更合适 */
    if (reduceQuery && reduceQuery.matches) return;
    if (coarseQuery && coarseQuery.matches) return;

    var cfg = {
      zeta: 0.62,       /* 阻尼比：0.45 很弹，0.62 轻微过冲，1 完全不过冲 */
      freq: 2.6,        /* 自然频率 Hz：越大越跟手 */
      gain: 1,          /* 滚轮增量 → 目标位移 */
      edge: 130,        /* 首尾最大拉伸（px） */
      edgeGain: 10,     /* 边界外的滚轮增量转成速度的系数（越大越硬） */
      settlePos: 0.5,
      settleVel: 6
    };

    var rootEl = doc.documentElement;
    var pos = window.pageYOffset || rootEl.scrollTop || 0;
    var target = pos;
    var vel = 0;
    var rafId = 0;
    var lastTime = 0;
    var running = false;

    function maxScroll() {
      return Math.max(0, rootEl.scrollHeight - window.innerHeight);
    }

    function blocked() {
      var wipeEl = doc.getElementById('wipe');
      if (wipeEl && (wipeEl.className.indexOf('is-active') !== -1 ||
        rootEl.className.indexOf('wipe-arrive') !== -1)) return true;
      return window.getComputedStyle(doc.body).overflowY === 'hidden';
    }

    function insideScroller(node, dy) {
      for (var el = node; el && el !== doc.body; el = el.parentElement) {
        if (el.nodeType !== 1) continue;
        var style = window.getComputedStyle(el);
        var oy = style.overflowY;
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
        if (el.scrollHeight - el.clientHeight <= 4) continue;
        if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
      }
      return false;
    }

    function paint() {
      var max = maxScroll();
      var y = pos < 0 ? 0 : (pos > max ? max : pos);
      var over = pos - y;

      if (over > cfg.edge) { over = cfg.edge; pos = y + over; }
      else if (over < -cfg.edge) { over = -cfg.edge; pos = y + over; }

      try {
        window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      } catch (err) {
        window.scrollTo(0, y);
      }

      if (over < -0.4 || over > 0.4) {
        rootEl.style.setProperty('--xb-over', (-over).toFixed(2) + 'px');
        rootEl.classList.add('is-overscroll');
      } else if (rootEl.classList.contains('is-overscroll')) {
        rootEl.classList.remove('is-overscroll');
        rootEl.style.removeProperty('--xb-over');
      }
    }

    function step(now) {
      rafId = 0;
      var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
      lastTime = now;

      var live = window.pageYOffset || 0;
      var maxNow = maxScroll();
      var rendered = pos < 0 ? 0 : (pos > maxNow ? maxNow : pos);
      if (Math.abs(live - rendered) > 1.5) {
        pos = live;
        target = live;
        vel = 0;
      }

      var k = Math.pow(2 * Math.PI * cfg.freq, 2);
      var c = 2 * cfg.zeta * Math.sqrt(k);
      var steps = Math.max(1, Math.ceil(dt * 240));
      var h = dt / steps;

      for (var i = 0; i < steps; i++) {
        vel += (-k * (pos - target) - c * vel) * h;
        pos += vel * h;
      }

      paint();

      if (Math.abs(pos - target) < cfg.settlePos && Math.abs(vel) < cfg.settleVel) {
        pos = target;
        vel = 0;
        paint();
        running = false;
        lastTime = 0;
        return;
      }

      rafId = window.requestAnimationFrame(step);
    }

    function start() {
      if (running) return;
      running = true;
      lastTime = 0;
      rafId = window.requestAnimationFrame(step);
    }

    function onWheel(e) {
      if (e.ctrlKey || e.defaultPrevented) return;
      if (!e.deltaY) return;
      if (blocked()) return;

      var dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= window.innerHeight;
      if (insideScroller(e.target, dy)) return;

      e.preventDefault();

      if (!running) {
        pos = window.pageYOffset || 0;
        target = pos;
        vel = 0;
      }

      var max = maxScroll();
      var next = target + dy * cfg.gain;

      if (next < 0) {
        vel += next * cfg.edgeGain;
        target = 0;
      } else if (next > max) {
        vel += (next - max) * cfg.edgeGain;
        target = max;
      } else {
        target = next;
      }

      start();
    }

    window.addEventListener('wheel', onWheel, { passive: false });

    window.xbSpringScroll = {
      config: cfg,
      set: function (patch) {
        if (!patch) return cfg;
        for (var key in patch) {
          if (Object.prototype.hasOwnProperty.call(cfg, key) && typeof patch[key] === 'number') cfg[key] = patch[key];
        }
        return cfg;
      },
      stop: function () {
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = 0;
        running = false;
        pos = target = window.pageYOffset || 0;
        vel = 0;
        rootEl.classList.remove('is-overscroll');
        rootEl.style.removeProperty('--xb-over');
      }
    };
  })();

  /* ---------- 3. 滚动显现：手标 + 自动覆盖组件，同组错峰 50ms ---------- */
  var REVEAL_STEP = 50;   /* 错峰间隔 */
  var REVEAL_MAX = 12;    /* 一组最多叠到 600ms，再往后就不等了 */

  /* 组件级选择器：段落里的子块、栅格里的小卡、图文块、表格、页脚栏……
     手工标了 .reveal 的（首屏标题、正文块）继续生效，自动标记只补没标的 */
  var AUTO_REVEAL_SELECTOR = [
    'main section > .wrap > *',
    'main .grid > *',
    'main .pdp > *',
    'main .doc__body > section',
    'main .card',
    'main figure',
    'main table',
    'main .pullquote',
    'main .stats',
    'main .timeline > li',
    'main .section-head .num',
    'main .section-head .eyebrow',
    'main .section-head h2',
    'main .doc__h .num',
    'main .doc__h h2',
    'main .cta-band__inner > *',
    '.site-footer .footer__brand',
    '.site-footer .footer__col'
  ].join(',');

  function markComponents() {
    var picks = Array.prototype.filter.call(doc.querySelectorAll(AUTO_REVEAL_SELECTOR), function (el) {
      if (el.classList.contains('reveal')) return false;
      if (el.closest('.reveal')) return false;
      if (el.closest('.petals, .frost, .grain, canvas, script, style')) return false;
      /* 内部已有手标 .reveal 的容器不再整体入场，免得父子叠两次 */
      if (el.querySelector('.reveal')) return false;
      return true;
    });

    /* 只保留最内层：父容器被拆开，让里面的组件各自入场，避免父子叠两次 */
    picks = picks.filter(function (el) {
      return !picks.some(function (other) { return other !== el && el.contains(other); });
    });

    picks.forEach(function (el) { el.classList.add('reveal'); });
    return picks.length;
  }

  /* 用一个滚动的整帧扫描代替 IntersectionObserver：观察器只在“相交状态变化”时
     回调，滚得快时上一次离开和下一次进入会被合并成一条，组件就再也不会复位，
     看上去就是“回滚重演失效”。整帧扫描是确定性的，来回滚都必然重演。 */
  var revealList = [];
  var passQueued = false;
  var scrollDir = 1;
  var lastScrollY = window.pageYOffset || doc.documentElement.scrollTop || 0;

  function applyReveal(el) {
    onEntranceReady(function () {
      window.requestAnimationFrame(function () {
        /* 入场阀门可能压了几百毫秒，期间组件可能已经滚出视口：
           这种情况不加 is-in，等它再进来时重新演 */
        var box = el.getBoundingClientRect();
        if (box.bottom <= 0 || box.top >= (window.innerHeight || doc.documentElement.clientHeight)) return;
        el.classList.add('is-in');
      });
    });
  }

  function revealPass() {
    passQueued = false;

    var y = window.pageYOffset || doc.documentElement.scrollTop || 0;
    if (Math.abs(y - lastScrollY) > 2) scrollDir = y > lastScrollY ? 1 : -1;
    lastScrollY = y;

    var vh = window.innerHeight || doc.documentElement.clientHeight;
    var enterLine = vh * 0.92;   /* 底部内缩 8%：高于视口的组件也在露出第一截时触发 */
    var outLine = 60;            /* 离开视口 60px 才复位，贴边抖动不至于一闪一灭 */

    for (var i = 0; i < revealList.length; i++) {
      var el = revealList[i];
      if (!el || !el.isConnected) continue;

      var box = el.getBoundingClientRect();

      if (box.top < enterLine && box.bottom > 0) {
        if (!el.classList.contains('is-in')) {
          /* 方向取自“这一帧在往哪滚”，不取组件某一刻的坐标：
             跳着滚、甩着滚都不会判反 */
          el.classList.toggle('reveal-from-top', scrollDir < 0);
          applyReveal(el);
        }
      } else if (box.bottom < -outLine || box.top > vh + outLine) {
        el.classList.remove('is-in');
      }
    }
  }

  function queueRevealPass() {
    if (passQueued) return;
    passQueued = true;
    window.requestAnimationFrame(revealPass);
  }

  window.addEventListener('scroll', queueRevealPass, { passive: true });
  window.addEventListener('resize', queueRevealPass, { passive: true });

  function setupReveals() {
    markComponents();

    /* 标记那一帧先关过渡，下一帧再撤遮罩：保证「透明」是瞬间落定的，
       之后 is-in 才有干净的 0 → 1 起步（否则会先淡出再淡入） */
    if (!doc.documentElement.classList.contains('reveal-ready')) {
      window.requestAnimationFrame(function () {
        doc.documentElement.classList.remove('reveal-boot');
        doc.documentElement.classList.add('reveal-ready');
      });
    }

    var fresh = doc.querySelectorAll('.reveal:not([data-reveal-bound])');
    if (!fresh.length) { queueRevealPass(); return; }

    Array.prototype.forEach.call(fresh, function (el) {
      el.setAttribute('data-reveal-bound', '');

      /* 错峰按“所在区块内的文档顺序”算，而不是只看同一个父元素——
         这样 num → eyebrow → 标题这种跨层的组件也能依次落下 */
      var scope = el.closest('section') || el.closest('.site-footer') || el.parentElement;
      var step = 0;

      if (scope) {
        step = Array.prototype.indexOf.call(scope.querySelectorAll('.reveal'), el);
      }

      /* 显式 data-delay 优先（跨列排顺序时用），否则按同组次序错峰 */
      var explicit = el.getAttribute('data-delay');
      if (explicit !== null) step = parseInt(explicit, 10) || 0;

      if (step > 0) {
        el.style.setProperty('--reveal-delay', Math.min(step, REVEAL_MAX) * REVEAL_STEP + 'ms');
      }
      revealList.push(el);
    });

    /* 首屏无需滚动也要跑一遍 */
    queueRevealPass();
  }

  setupReveals();

  /* 账户页正文是 JS 渲染的，等它落地后再补一遍标记 */
  window.addEventListener('xb:auth', function () {
    window.setTimeout(setupReveals, 0);
  });

  /* ---------- 3b. 数据条计数：一次 700ms，尊重减少动态偏好 ---------- */
  var statBlock = doc.querySelector('.stats');
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (statBlock && 'IntersectionObserver' in window && !(motionQuery && motionQuery.matches)) {
    var statNums = Array.prototype.slice.call(statBlock.querySelectorAll('.stat__num'));
    var hasCounted = false;

    var countUp = function () {
      if (hasCounted) return;
      hasCounted = true;

      statNums.forEach(function (el) {
        var textNode = el.firstChild;
        if (!textNode || textNode.nodeType !== 3) return;

        var raw = String(textNode.nodeValue).trim();
        var target = parseInt(raw, 10);
        if (!target) return;

        var width = raw.replace(/[^0-9]/g, '').length;
        var started = 0;

        var frame = function (now) {
          if (!started) started = now;
          var t = Math.min(1, (now - started) / 700);
          var eased = 1 - Math.pow(1 - t, 3);
          textNode.nodeValue = String(Math.round(target * eased)).padStart(width, '0');
          if (t < 1) {
            window.requestAnimationFrame(frame);
          } else {
            textNode.nodeValue = raw;
          }
        };

        window.requestAnimationFrame(frame);
      });
    };

    var statObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        statObserver.disconnect();
        onEntranceReady(countUp);
      });
    }, { threshold: 0.35 });

    statObserver.observe(statBlock);
  }

  /* ---------- 4. 系列筛选 ---------- */
  var filterWrap = doc.querySelector('[data-filters]');
  if (filterWrap) {
    var cards = Array.prototype.slice.call(doc.querySelectorAll('[data-category]'));
    var countEl = doc.querySelector('[data-count]');

    filterWrap.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      var key = btn.getAttribute('data-filter');

      filterWrap.querySelectorAll('.chip').forEach(function (c) {
        c.classList.toggle('is-active', c === btn);
        c.setAttribute('aria-pressed', c === btn ? 'true' : 'false');
      });

      var shown = 0;
      cards.forEach(function (card) {
        var match = matchCard(card, key);
        card.hidden = !match;
        if (match) {
          shown++;
          card.classList.remove('is-in');
          // 重新触发动画
          void card.offsetWidth;
          card.classList.add('is-in');
        }
      });

      if (countEl) countEl.textContent = String(shown);

      // 弹出该品类对应的产品
      openCatModal(btn.textContent.trim(), key, btn);
    });
  }

  /* ---------- 4b. 品类弹层 ---------- */
  var catModal = doc.getElementById('cat-modal');
  var lastFocus = null;

  function matchCard(card, key) {
    if (key === 'all') return true;
    return (card.getAttribute('data-category') || '').split(/\s+/).indexOf(key) >= 0;
  }

  function openCatModal(label, key, fromEl) {
    if (!catModal) return;
    var grid = catModal.querySelector('[data-modal-grid]');
    var title = catModal.querySelector('[data-modal-title]');
    var count = catModal.querySelector('[data-modal-count]');
    if (!grid || !title) return;

    var matched = (catModal._cards || []).filter(function (c) {
      return matchCard(c.el, key);
    });

    title.textContent = label;
    if (count) count.textContent = '该品类共 ' + matched.length + ' 件单品';
    grid.innerHTML = '';

    matched.forEach(function (c) {
      var a = doc.createElement('a');
      a.className = 'modal__item';
      a.href = c.href;
      a.innerHTML =
        '<img class="modal__thumb" src="' + c.img + '" alt="' + c.alt + '" loading="lazy">' +
        '<span class="modal__info">' +
          '<span class="modal__en">' + c.en + '</span>' +
          '<span class="modal__name">' + c.name + '</span>' +
          '<span class="modal__price">' + c.price + '</span>' +
        '</span>' +
        '<span class="modal__arrow" aria-hidden="true">→</span>';
      grid.appendChild(a);
    });

    lastFocus = fromEl || doc.activeElement;
    catModal.classList.add('is-open');
    catModal.setAttribute('aria-hidden', 'false');
    doc.body.style.overflow = 'hidden';
    var closeBtn = catModal.querySelector('.modal__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeCatModal() {
    if (!catModal || !catModal.classList.contains('is-open')) return;
    catModal.classList.remove('is-open');
    catModal.setAttribute('aria-hidden', 'true');
    doc.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (catModal) {
    // 预提取卡片数据，弹层直接复用
    catModal._cards = Array.prototype.slice.call(doc.querySelectorAll('[data-category]')).map(function (el) {
      var img = el.querySelector('.card__media img');
      var more = el.querySelector('.card__more');
      var price = el.querySelector('.price');
      return {
        el: el,
        img: img ? img.getAttribute('src') : '',
        alt: img ? (img.getAttribute('alt') || '') : '',
        en: (el.querySelector('.card__en') || {}).textContent || '',
        name: (el.querySelector('.card__name') || {}).textContent || '',
        price: price ? price.innerHTML : '',
        href: more ? more.getAttribute('href') : '#'
      };
    });

    catModal.addEventListener('click', function (e) {
      if (e.target.closest('[data-modal-close]')) closeCatModal();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeCatModal();
    });
  }

  /* ---------- 5. 手风琴 ---------- */
  doc.querySelectorAll('.acc').forEach(function (acc) {
    acc.querySelectorAll('.acc__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.acc__item');
        var open = item.classList.contains('is-open');

        acc.querySelectorAll('.acc__item').forEach(function (other) {
          other.classList.remove('is-open');
          var b = other.querySelector('.acc__btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        });

        if (!open) {
          item.classList.add('is-open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  });

  /* ---------- 6. 复制联系方式 ---------- */
  doc.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      var done = function () {
        var raw = btn.innerHTML;
        btn.textContent = '已复制 · ' + text;
        setTimeout(function () { btn.innerHTML = raw; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var ta = doc.createElement('textarea');
        ta.value = text;
        doc.body.appendChild(ta);
        ta.select();
        try { doc.execCommand('copy'); done(); } catch (err) {}
        doc.body.removeChild(ta);
      }
    });
  });

  /* ---------- 7. 页脚年份 ---------- */
  doc.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- 8. 目录高亮（设计说明页） ---------- */
  var tocLinks = doc.querySelectorAll('.doc__toc a[href^="#"]');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var sections = Array.prototype.map.call(tocLinks, function (a) {
      return doc.querySelector(a.getAttribute('href'));
    });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        tocLinks.forEach(function (a) {
          var active = a.getAttribute('href') === '#' + entry.target.id;
          a.style.color = active ? 'var(--red)' : '';
        });
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach(function (s) { if (s) spy.observe(s); });
  }

  /* ---------- 9. 落英场景层（首屏 .hero 与内页 hero 共用） ----------
     谁带 data-petals 就在谁里面落英；前层可选，没有就只铺后层。
     场景同样是「进入动画」的一部分：等幕布抬完再启动。 */
  Array.prototype.forEach.call(doc.querySelectorAll('[data-petals]'), function (host) {
    var backCv = host.querySelector('.petals--back');
    var frontCv = host.querySelector('.petals--front');
    if (!backCv || !backCv.getContext) return;

    onEntranceReady(function () {
      initPetals(host, backCv, frontCv);
      host.classList.add('is-scene-on');
    });
  });

  /* ---------- 9b. 花冠 3D 跟随鼠标 ---------- */
  initCrownTilt();

  function initCrownTilt() {
    var art = doc.querySelector('.hero__art');
    if (!art || !window.requestAnimationFrame) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var MAX = 9;        /* 最大倾角（度） */
    var EASE = 0.12;    /* 跟随阻尼 */
    var curX = 0, curY = 0, tarX = 0, tarY = 0, raf = 0;

    function paint() {
      art.style.transform = 'perspective(1100px) rotateX(' +
        curX.toFixed(2) + 'deg) rotateY(' + curY.toFixed(2) + 'deg)';
    }

    function step() {
      curX += (tarX - curX) * EASE;
      curY += (tarY - curY) * EASE;
      if (Math.abs(tarX - curX) < 0.05 && Math.abs(tarY - curY) < 0.05) {
        curX = tarX;
        curY = tarY;
        paint();
        if (tarX === 0 && tarY === 0) art.classList.remove('is-tilting');
        raf = 0;
        return;
      }
      paint();
      raf = requestAnimationFrame(step);
    }

    function kick() {
      if (!raf) raf = requestAnimationFrame(step);
    }

    function reset() {
      tarX = 0;
      tarY = 0;
      kick();
    }

    function onMove(e) {
      if (e.pointerType === 'touch') return;
      var r = art.getBoundingClientRect();
      if (!r.width || !r.height) return;
      /* 响应范围收到花冠本身的圆内（半径 = 半个盒宽，留 4% 余量） */
      var nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      var ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      if (nx * nx + ny * ny > 1.04) {
        reset();
        return;
      }
      nx = Math.max(-1, Math.min(1, nx));
      ny = Math.max(-1, Math.min(1, ny));
      tarY = nx * MAX;
      tarX = -ny * MAX;
      art.classList.add('is-tilting');
      kick();
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', reset);
    doc.addEventListener('pointerleave', reset);
    paint();
  }

  function initPetals(hero, backCanvas, frontCanvas) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hasFront = !!frontCanvas;
    /* 内页只铺后层（大花瓣压在正文上会吵），缺前层时用离屏画布占位 */
    if (!hasFront) frontCanvas = doc.createElement('canvas');
    var backCtx = backCanvas.getContext('2d');
    var frontCtx = frontCanvas.getContext('2d');

    /* 画布向下多出的一段：让落英落到花名滚动文字正上方才消失 */
    var BLEED = 20;
    var FADE = 110;     /* 底部渐隐高度 */
    var W = 0, H = 0, DPR = 1;
    var back = [], front = [];
    var maxBack = 60, maxFront = 12;

    /* 品牌花色：素馨白 / 含笑金 / 刺桐红 / 茉莉白 / 玉兰 */
    var PALETTES = [
      ['#FFFDF6', '#C9A24A'],
      ['#F7E7BB', '#C4624E'],
      ['#F3C9C2', '#A8342B'],
      ['#FFFDF8', '#D98A6F'],
      ['#FFFCF4', '#B9A98A']
    ];
    var sprites = [];

    function makeSprite(px, c1, c2) {
      var c = doc.createElement('canvas');
      c.width = px; c.height = px;
      var g = c.getContext('2d');
      var s = px * 0.44;
      g.translate(px / 2, px / 2);

      var grad = g.createLinearGradient(0, -s, 0, s);
      grad.addColorStop(0, c1);
      grad.addColorStop(0.45, c1);
      grad.addColorStop(1, c2);

      g.beginPath();
      g.moveTo(0, -s);
      g.bezierCurveTo(s * 0.78, -s * 0.74, s * 0.99, s * 0.16, s * 0.37, s * 0.88);
      g.quadraticCurveTo(s * 0.17, s * 1.02, 0, s * 0.80);
      g.quadraticCurveTo(-s * 0.17, s * 1.02, -s * 0.37, s * 0.88);
      g.bezierCurveTo(-s * 0.99, s * 0.16, -s * 0.78, -s * 0.74, 0, -s);
      g.closePath();

      g.shadowColor = 'rgba(168, 52, 43, .35)';
      g.shadowBlur = px * 0.045;
      g.fillStyle = grad;
      g.fill();

      g.shadowBlur = 0;
      g.globalAlpha = 0.5;
      g.strokeStyle = 'rgba(124, 35, 29, .45)';
      g.lineWidth = Math.max(1, px * 0.008);
      g.stroke();

      g.strokeStyle = '#ffffff';
      g.globalAlpha = 0.42;
      g.lineWidth = Math.max(1, px * 0.009);
      g.beginPath();
      g.moveTo(0, -s * 0.66);
      g.quadraticCurveTo(s * 0.05, 0, 0, s * 0.72);
      g.stroke();

      g.globalAlpha = 0.18;
      g.lineWidth = Math.max(1, px * 0.006);
      g.beginPath();
      g.moveTo(0, -s * 0.3);
      g.quadraticCurveTo(s * 0.26, s * 0.1, s * 0.3, s * 0.44);
      g.stroke();
      g.beginPath();
      g.moveTo(0, -s * 0.3);
      g.quadraticCurveTo(-s * 0.26, s * 0.1, -s * 0.3, s * 0.44);
      g.stroke();

      return c;
    }

    for (var i = 0; i < PALETTES.length; i++) {
      sprites.push(makeSprite(176, PALETTES[i][0], PALETTES[i][1]));
    }

    function sizeCanvas(canvas, ctx) {
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    function targets() {
      var area = W * H;
      var cores = navigator.hardwareConcurrency || 4;
      var k = cores <= 4 ? 0.62 : 1;
      maxBack = Math.max(30, Math.round(Math.min(140, area / 11000) * k));
      maxFront = hasFront ? Math.max(8, Math.round(Math.min(28, area / 65000) * k)) : 0;
    }

    function makePetal(isFront) {
      return {
        x: Math.random() * (W + 160) - 80,
        y: Math.random() * (H + 120) - 60,
        size: isFront ? 14 + Math.random() * 18 : 6.2 + Math.random() * 12,
        sprite: (Math.random() * sprites.length) | 0,
        alpha: isFront ? 0.7 + Math.random() * 0.28 : 0.7 + Math.random() * 0.3,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * (isFront ? 0.7 : 1.1),
        flip: Math.random() * Math.PI * 2,
        flipSpeed: 0.5 + Math.random() * 1.7,
        fall: (isFront ? 30 : 14) + Math.random() * (isFront ? 34 : 24),
        swayAmp: 8 + Math.random() * 24,
        swaySpeed: 0.45 + Math.random() * 1.0,
        phase: Math.random() * Math.PI * 2,
        vx: 0, vy: 0, avx: 0, avy: 0,
        drag: 1.1 + Math.random() * 1.4
      };
    }

    function fit() {
      var rect = hero.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height)) + BLEED;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      sizeCanvas(backCanvas, backCtx);
      if (hasFront) sizeCanvas(frontCanvas, frontCtx);
      targets();
      while (back.length < maxBack) back.push(makePetal(false));
      while (back.length > maxBack) back.pop();
      while (front.length < maxFront) front.push(makePetal(true));
      while (front.length > maxFront) front.pop();
    }

    var wind = 0;
    var pointerX = 0.5, pointerXs = 0.5;
    var pointer = { x: -9999, y: -9999, active: false, offTimer: 0 };

    function drawList(ctx, list, dt) {
      ctx.clearRect(0, 0, W, H);
      var spd = reduce ? 0.3 : 1;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        p.phase += p.swaySpeed * dt;
        p.rot += p.spin * dt * spd;
        p.flip += p.flipSpeed * dt * spd;

        var sway = Math.sin(p.phase) * p.swayAmp * 0.5;
        var wf = 0.35 + p.size / 26;

        var pushed = false;
        if (pointer.active) {
          var dx = p.x - pointer.x;
          var dy = p.y - pointer.y;
          var R = 165 + p.size * 3;
          var d2 = dx * dx + dy * dy;
          if (d2 < R * R) {
            var d = Math.sqrt(d2) || 0.001;
            var f = 1 - d / R;
            var weight = Math.min(1.3, 24 / (p.size + 12));
            var tv = f * f * 400 * weight;
            var steer = Math.min(1, dt * 11);
            p.avx += ((dx / d) * tv - (dy / d) * tv * 0.55 - p.avx) * steer;
            p.avy += ((dy / d) * tv + (dx / d) * tv * 0.55 - p.avy) * steer;
            pushed = true;
          }
        }
        if (!pushed) {
          p.avx *= Math.max(0, 1 - 2.8 * dt);
          p.avy *= Math.max(0, 1 - 2.8 * dt);
        }

        p.x += (sway + wind * wf) * dt * spd + (p.avx + p.vx) * dt;
        p.y += p.fall * dt * spd + (p.avy + p.vy) * dt;
        p.vx *= Math.max(0, 1 - p.drag * dt);
        p.vy *= Math.max(0, 1 - p.drag * dt);

        var m = p.size * 2 + 30;
        if (p.y > H + m) {
          p.y = -m;
          p.x = Math.random() * (W + 120) - 60;
          p.vx = 0; p.vy = 0;
        } else if (p.y < -m * 2) {
          p.y = H + m;
        }
        if (p.x < -m) { p.x = W + m; }
        else if (p.x > W + m) { p.x = -m; }

        var fs = Math.abs(Math.cos(p.flip));

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.max(0.12, fs), 1);
        /* 末段渐隐：消失点贴近花名滚动文字上方，不再被画布边缘直接切断 */
        var fade = 1;
        if (p.y > H - FADE) fade = Math.max(0, (H - p.y) / FADE);
        ctx.globalAlpha = p.alpha * (0.55 + 0.45 * fs) * fade;
        ctx.drawImage(sprites[p.sprite], -p.size, -p.size, p.size * 2, p.size * 2);
        ctx.restore();
      }
    }

    function burst(x, y) {
      var n = reduce ? 6 : 14;
      for (var i = 0; i < n; i++) {
        var p = makePetal(true);
        var a = Math.random() * Math.PI * 2;
        var v = 40 + Math.random() * 150;
        p.x = x; p.y = y;
        p.size = 9 + Math.random() * 14;
        p.alpha = 0.6 + Math.random() * 0.3;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - 40;
        front.push(p);
      }
      while (front.length > maxFront + 40) front.shift();
    }

    var last = 0;
    var running = true;
    var inView = true;

    function frame(now) {
      requestAnimationFrame(frame);
      if (!running || !inView) { last = now; return; }
      if (!last) last = now;
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05;
      if (dt <= 0) dt = 0.016;

      pointerXs += (pointerX - pointerXs) * Math.min(1, dt * 2.2);
      var t = now / 1000;
      var target = Math.sin(t * 0.24) * 16 + Math.sin(t * 0.071 + 1.6) * 10 + (pointerXs - 0.5) * 26;
      wind += (target - wind) * Math.min(1, dt * 0.9);

      drawList(backCtx, back, dt);
      if (hasFront) drawList(frontCtx, front, dt);
    }

    function toLocal(e) {
      var r = hero.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fit, 120);
    }, { passive: true });

    hero.addEventListener('pointermove', function (e) {
      var pt = toLocal(e);
      pointerX = pt.x / Math.max(1, W);
      pointer.x = pt.x; pointer.y = pt.y;
      pointer.active = true;
      clearTimeout(pointer.offTimer);
    }, { passive: true });

    hero.addEventListener('pointerdown', function (e) {
      if (e.target.closest('a, button')) return;
      var pt = toLocal(e);
      pointer.x = pt.x; pointer.y = pt.y;
      pointer.active = true;
      clearTimeout(pointer.offTimer);
      burst(pt.x, pt.y);
      if (window.matchMedia('(pointer: coarse)').matches) {
        pointer.offTimer = setTimeout(function () { pointer.active = false; }, 1400);
      }
    }, { passive: true });

    hero.addEventListener('pointerup', function () {
      if (window.matchMedia('(pointer: coarse)').matches) {
        clearTimeout(pointer.offTimer);
        pointer.offTimer = setTimeout(function () { pointer.active = false; }, 900);
      }
    }, { passive: true });

    hero.addEventListener('pointerleave', function () {
      pointer.active = false;
    });

    doc.addEventListener('visibilitychange', function () {
      running = !doc.hidden;
      last = 0;
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        last = 0;
      }).observe(hero);
    }

    fit();
    requestAnimationFrame(frame);
  }
})();

/* ---------- 8. 页面转场：米色幕布 + 五瓣螺旋（无框架，无刷观感） ---------- */
/* 五瓣内摆线取 five-petal-spiral 的曲线：x = (R-r)cos t + d cos(((R-r)/r)t)，R=5 / r=1 / d=3；
   颜色不用参考页的纯黑，改成本站刺桐红 → 素馨金的拖尾渐变。
   换页时机不靠固定时长：轨道画满后，彗尾再完整跑完一圈，由动画自己触发跳转。 */
(function () {
  'use strict';

  var wipe = document.getElementById('wipe');
  if (!wipe) return;

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var prefersReduced = function () { return !!(motionQuery && motionQuery.matches); };

  var DRAW_MS = 700;   /* 花瓣从零画满 */
  var LAP_MS = 1000;   /* 画满后彗尾绕行一整圈 —— 这一圈走完才换页 */
  var SAFETY_MS = 9000;

  var jumping = false;
  var targetUrl = '';
  var navigated = false;

  function setArrivalFlag(on) {
    try {
      if (on) window.sessionStorage.setItem('xunpu:wipe', '1');
      else window.sessionStorage.removeItem('xunpu:wipe');
    } catch (err) { /* 隐私模式下忽略 */ }
  }

  /* ---- 8.1 螺旋几何与绘制 ---- */
  var CFG = {
    R: 5,
    r: 1,
    d: 3,
    scale: 2.5,
    breath: 0,
    strokeWidth: 5.5,
    particles: 140,
    trailSpan: 0.5,
    spinMs: 12000,
    pulseMs: 2600
  };

  var loader = document.querySelector('.wipe__loader');
  var canvas = loader ? loader.querySelector('.wipe__canvas') : null;
  var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  var rafId = 0;
  var phaseStart = 0;
  var bootAt = 0;

  /* idle → draw（画花瓣）→ lap（绕一整圈）→ 跳转 */
  var phase = 'idle';
  var drawn = 1;
  var lap = 0;
  /* 每次转场重新随机：曲线参数起点 + 初始旋转角。
     五瓣曲线本身是 5 次对称的，只随机参数起点看不出差别，所以旋转角也一起随机，
     让每次 loading 出现时的朝向、起笔位置都不一样。 */
  var startAt = 0;
  var startSpin = 0;

  function tokenColor(name, fallback) {
    var root = getComputedStyle(document.documentElement);
    var value = (root.getPropertyValue(name) || '').trim();
    return value || fallback;
  }

  function hexToRgb(hex) {
    var raw = String(hex).replace('#', '');
    if (raw.length === 3) raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
    var num = parseInt(raw, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  var RED = hexToRgb(tokenColor('--red', '#A8342B'));
  var GOLD = hexToRgb(tokenColor('--gold', '#C9A24A'));

  function mixColor(from, to, t) {
    return {
      r: Math.round(from.r + (to.r - from.r) * t),
      g: Math.round(from.g + (to.g - from.g) * t),
      b: Math.round(from.b + (to.b - from.b) * t)
    };
  }

  function paint(color, alpha) {
    return 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + alpha.toFixed(3) + ')';
  }

  function pointOnSpiral(progress, detail) {
    var t = progress * Math.PI * 2;
    var d = CFG.d + detail * CFG.breath * 0.26;
    var k = (CFG.R - CFG.r) / CFG.r;
    var baseX = (CFG.R - CFG.r) * Math.cos(t) + d * Math.cos(k * t);
    var baseY = (CFG.R - CFG.r) * Math.sin(t) - d * Math.sin(k * t);
    var scale = CFG.scale + detail * CFG.breath;
    return { x: 50 + baseX * scale, y: 50 + baseY * scale };
  }

  function goNow() {
    if (navigated || !targetUrl) return;
    navigated = true;
    stopSpiral();
    window.location.href = targetUrl;
  }

  function drawSpiral(now) {
    if (!ctx || !canvas) return;
    if (!phaseStart) phaseStart = now;

    var elapsed = now - phaseStart;

    if (phase === 'draw') {
      var p = Math.min(1, elapsed / DRAW_MS);
      drawn = 1 - Math.pow(1 - p, 3);
      lap = drawn;
      if (p >= 1) {
        phase = 'lap';
        phaseStart = now;
        drawn = 1;
        lap = 0;
      }
    } else if (phase === 'lap') {
      var q = Math.min(1, elapsed / LAP_MS);
      lap = q;
      if (q >= 1) {
        drawOneFrame(now);
        goNow();
        return;
      }
    }

    drawOneFrame(now);
    rafId = window.requestAnimationFrame(drawSpiral);
  }

  function drawOneFrame(now) {
    var size = canvas.clientWidth || 138;
    var dpr = window.devicePixelRatio || 1;
    var px = Math.max(1, Math.round(size * dpr));

    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var unit = px / 100;
    ctx.setTransform(unit, 0, 0, unit, 0, 0);

    if (!bootAt) bootAt = now;
    var stamp = now - bootAt;
    var pulse = ((stamp % CFG.pulseMs) + CFG.pulseMs) % CFG.pulseMs / CFG.pulseMs;
    var detail = 0.52 + ((Math.sin(pulse * Math.PI * 2 + 0.55) + 1) / 2) * 0.48;
    var spin = startSpin - (((stamp % CFG.spinMs) + CFG.spinMs) % CFG.spinMs / CFG.spinMs) * 360;

    ctx.save();
    ctx.translate(50, 50);
    ctx.rotate((spin * Math.PI) / 180);
    ctx.translate(-50, -50);

    if (drawn > 0.004) {
      ctx.beginPath();
      for (var i = 0; i <= 180; i += 1) {
        var track = pointOnSpiral((startAt + (i / 180) * drawn) % 1, detail);
        if (i === 0) ctx.moveTo(track.x, track.y);
        else ctx.lineTo(track.x, track.y);
      }
      ctx.lineWidth = CFG.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = paint(RED, 0.20);
      ctx.stroke();
    }

    var drawing = phase === 'draw';
    for (var j = 0; j < CFG.particles; j += 1) {
      var tail = j / (CFG.particles - 1);
      var rel = lap - tail * CFG.trailSpan;
      if (drawing && rel < 0) continue;
      var head = pointOnSpiral((startAt + rel + 1) % 1, detail);
      var fade = Math.pow(1 - tail, 0.56);
      ctx.beginPath();
      ctx.arc(head.x, head.y, 0.8 + fade * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = paint(mixColor(RED, GOLD, tail), 0.05 + fade * 0.95);
      ctx.fill();
    }

    ctx.restore();
  }

  function startSpiral() {
    if (!ctx) return;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = window.requestAnimationFrame(drawSpiral);
  }

  function stopSpiral() {
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    phaseStart = 0;
    phase = 'idle';
  }

  /* ---- 8.2 覆盖 → 画满 → 绕行一整圈 → 跳转 ---- */
  var safetyTimer = 0;

  function coverAndGo(url) {
    if (jumping) return;
    jumping = true;
    navigated = false;
    targetUrl = url;

    setArrivalFlag(true);
    wipe.classList.add('is-active');

    phase = 'draw';
    drawn = 0;
    lap = 0;
    phaseStart = 0;
    startAt = Math.random();
    startSpin = Math.random() * 360;
    startSpiral();

    /* 后台标签页里 rAF 会被节流，留一条兜底路径 */
    window.clearTimeout(safetyTimer);
    safetyTimer = window.setTimeout(goNow, SAFETY_MS);
  }

  function release() {
    jumping = false;
    navigated = false;
    window.clearTimeout(safetyTimer);
    wipe.classList.remove('is-active');
    stopSpiral();
  }

  function resolveTarget(anchor) {
    if (!anchor || anchor.hasAttribute('download')) return '';
    if (anchor.target && anchor.target !== '_self') return '';
    if (/external/i.test(anchor.getAttribute('rel') || '')) return '';

    var href = anchor.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return '';
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) return '';

    var url;
    try { url = new URL(href, window.location.href); } catch (err) { return ''; }

    if (url.origin !== window.location.origin) return '';
    if (!/\.html?$/i.test(url.pathname) && url.pathname !== '/') return '';

    var here = window.location;
    if (url.pathname === here.pathname && url.search === here.search && url.hash === here.hash) return '';
    return url.href;
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    var target = resolveTarget(anchor);
    if (!target) return;
    if (prefersReduced()) return;

    event.preventDefault();
    coverAndGo(target);
  });

  /* ---- 8.3 预取：指针划过站内链接先把页面取回来 ---- */
  var prefetched = {};

  document.addEventListener('pointerover', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    var target = resolveTarget(anchor);
    if (!target || prefetched[target]) return;

    prefetched[target] = true;
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = target;
    document.head.appendChild(link);
  }, { passive: true });

  /* ---- 8.4 生命周期 ---- */
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) release();
  });

  setArrivalFlag(false);

  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener('change', function () {
      if (prefersReduced()) release();
    });
  }
})();

/* ---------- 10. 自定义光标：簪花围（磁吸方形） ---------- */
/* 系统指针被藏起来（html.xb-cursor-on），接手的是 34px 的一圈八瓣「簪花围」。
   默认是圆环；碰到按钮 / 链接时按 magnetic pointer 的思路：
   环心朝元素中心吸过去（留 10% 给指针），同时花环从圆「长」成方框 ——
   方框正好把元素套在中间，八片花瓣挪到四角与四边中点。
   形变进度 g 每帧推进（指数趋近），位置走欠阻尼弹簧，所以是「先吸过去、再张开」。
   离开时 g 退回 0，方框收回成圆环；快速移动时身后落几枚花瓣；输入框换回红竖线。 */
(function () {
  'use strict';

  var fineQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  if (fineQuery && !fineQuery.matches) return;          /* 触屏不接管 */
  if (!('PointerEvent' in window)) return;

  var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduce = !!(reduceQuery && reduceQuery.matches);

  var dots = '';
  var d;
  for (d = 0; d < 8; d++) {
    dots += '<i></i>';
  }

  var wrap = document.createElement('div');
  wrap.className = 'xb-cursor';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<span class="xb-cursor__halo"><span class="xb-cursor__garland">' +
    '<span class="xb-cursor__frame"></span>' + dots + '</span></span>' +
    '<span class="xb-cursor__bar"></span>';
  document.body.appendChild(wrap);
  document.documentElement.classList.add('xb-cursor-on');

  var halo = wrap.querySelector('.xb-cursor__halo');
  var garland = wrap.querySelector('.xb-cursor__garland');
  var frame = wrap.querySelector('.xb-cursor__frame');
  var petalEls = wrap.querySelectorAll('.xb-cursor__garland i');

  /* 花瓣层：单独一片 fixed 区域，花瓣落在地上不跟着指针跑 */
  var trail = document.createElement('div');
  trail.className = 'xb-cursor-trail';
  trail.setAttribute('aria-hidden', 'true');
  var petals = [];
  var pt;
  for (pt = 0; pt < 9; pt++) {
    var leaf = document.createElement('i');
    trail.appendChild(leaf);
    petals.push(leaf);
  }
  document.body.appendChild(trail);

  /* 磁吸目标：按钮、链接这类「按下去会有反应」的小块 */
  var MAGNET_SEL = 'a[href], button, .btn, [role="button"], summary, label, ' +
    'input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"]';
  /* 只点亮、不吸附的大块 */
  var HOVER_SEL = MAGNET_SEL + ', select, .card, .swatch, .pdp__thumb, .card__more';
  var TEXT_SEL = 'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="range"]), ' +
    'textarea, [contenteditable="true"], [contenteditable=""]';

  /* 缓动跟随：一条欠阻尼弹簧，ω=26 rad/s、ζ=0.78 ——
     指针停下后约 220ms 落位，带一点回弹（过冲约 1%）；
     拖得越快花环落得越后面（匀速拖 1000px/s 落后约 60px），是「追上来」而不是硬贴住指针。
     减少动效时不做缓动，环心直接贴在指针上。 */
  var OMEGA = 26;
  var ZETA = 0.78;
  var K = OMEGA * OMEGA;
  var C = 2 * ZETA * OMEGA;

  var RESIDUAL = 0;        /* 磁吸后残留的指针偏移比例：0 = 环心正好压在元素中心 */
  var BASE_R = 17;         /* 静息半径：34px 圆环 */
  var MIN_HALF = 12;       /* 方框最小半尺寸：24px，再小花瓣就挤在一起了 */
  var MAX_HALF_W = 220;
  var MAX_HALF_H = 150;
  var PAD_MIN = 6;         /* 留白随元素大小走：小按钮 6px，大按钮 14px，不给文字链接套大框 */
  var PAD_MAX = 14;
  var PAD_RATIO = 0.22;
  var MORPH = 200;         /* 圆 → 方的时间常数（ms） */
  var SIZE_MS = 150;       /* 方框伸缩的时间常数（ms）：进出自如，不会「啪」一下 */
  var BIG_W = 360;         /* 超过这个尺寸的可点区域只点亮不吸附（整块横幅、表单行） */
  var BIG_H = 120;
  var RELEASE_PAD = 40;    /* 指针离开元素这么多还不回来，就解除磁吸（滚动、元素被挪走时用） */

  /* 八片花瓣的极角：0/45/…/315，正好对上矩形四角与四边中点 */
  var ANGLES = [];
  var ai;
  for (ai = 0; ai < 8; ai++) {
    ANGLES.push(ai * Math.PI / 4);
  }

  var px = -200, py = -200;
  var x = px, y = py, vx = 0, vy = 0;
  var g = 0;               /* 0 = 圆环，1 = 方框 */
  var halfW = BASE_R, halfH = BASE_R;         /* 当前尺寸（缓动） */
  var targetW = BASE_R, targetH = BASE_R;     /* 目标尺寸（元素变、指针走都会改） */
  var drawnRx = -1, drawnRy = -1, drawnG = -1, drawnSpin = -1;
  var spin = 0;
  var travelled = 0;
  var petalIndex = 0;
  var raf = 0;
  var lastTime = 0;
  var shown = false;
  var lastTarget = null;
  var magnetEl = null;

  /* 八片花瓣摆到「圆 ↔ 方」插值后的位置：
     圆上取 (r·cos, r·sin)，方框上取 (a·cos/m, b·sin/m)，m = max(|cos|,|sin|)，
     两点按 g 插值 —— 圆环是边界连续地长成方框，不会跳。 */
  function applyGeometry() {
    var morph = g * g * (3 - 2 * g);          /* smoothstep，收尾更稳 */
    var rx = BASE_R + (halfW - BASE_R) * morph;
    var ry = BASE_R + (halfH - BASE_R) * morph;
    var scale = 1 + (Math.max(rx, ry) - BASE_R) * 0.0045;

    frame.style.setProperty('--fw', (rx * 2).toFixed(2) + 'px');
    frame.style.setProperty('--fh', (ry * 2).toFixed(2) + 'px');
    frame.style.setProperty('--fr', (50 * (1 - morph)).toFixed(2) + '%');

    var orbit = spin * Math.PI / 180 * (1 - morph);   /* 自转角：成方时收干净，花瓣正好落在四角与四边中点 */

    var i;
    for (i = 0; i < 8; i++) {
      var a = ANGLES[i] + orbit;
      var ca = Math.cos(a);
      var sa = Math.sin(a);
      var m = Math.max(Math.abs(ca), Math.abs(sa));

      var cxp = BASE_R * ca;
      var cyp = BASE_R * sa;
      var rxp = halfW * ca / m;
      var ryp = halfH * sa / m;

      var fx = (cxp + (rxp - cxp) * morph).toFixed(2);
      var fy = (cyp + (ryp - cyp) * morph).toFixed(2);

      petalEls[i].style.transform =
        'translate3d(' + fx + 'px,' + fy + 'px,0) rotate(' + (a * 180 / Math.PI + 90).toFixed(1) + 'deg) scale(' + scale.toFixed(3) + ')';
    }

    drawnRx = rx;
    drawnRy = ry;
    drawnG = g;
    drawnSpin = spin;
  }

  function paint() {
    wrap.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
    /* 光晕圆盘自转；花环反着转回来，方框才永远是正的（不自转的花环靠花瓣自己绕圈） */
    halo.style.transform = 'translate3d(0,0,0) rotate(' + spin.toFixed(2) + 'deg)';
    garland.style.transform = 'rotate(' + (-spin).toFixed(2) + 'deg)';
  }

  /* 留白按元素「最小边」换算：17px 高的文字链接给 6px，50px 高的按钮给 11px，
     372px 宽的表单行不会被套成一个大方块 */
  function padFor(w, h) {
    var m = Math.min(w, h);
    return Math.max(PAD_MIN, Math.min(PAD_MAX, m * PAD_RATIO));
  }

  /* 元素没了 / 被滚走了 / 不在指针底下了：解除磁吸，尺寸自然回落到圆环 */
  function releases(magnetEl, r) {
    return !magnetEl || !magnetEl.isConnected || !r.width || !r.height ||
      px < r.left - RELEASE_PAD || px > r.right + RELEASE_PAD ||
      py < r.top - RELEASE_PAD || py > r.bottom + RELEASE_PAD;
  }

  function releaseMagnet() {
    magnetEl = null;
    lastTarget = null;            /* 允许再次进入时重新判断 */
    targetW = BASE_R;
    targetH = BASE_R;
    wrap.classList.remove('is-magnet');
  }

  /* 每帧算一次磁吸落点与方框「目标」半尺寸（真正的尺寸在 step 里缓动追上去） */
  function magnetTarget() {
    if (!magnetEl) {
      targetW = BASE_R;
      targetH = BASE_R;
      return null;
    }
    var r = magnetEl.getBoundingClientRect();
    if (releases(magnetEl, r)) {
      releaseMagnet();
      return null;
    }
    var pad = padFor(r.width, r.height);
    targetW = Math.min(MAX_HALF_W, Math.max(MIN_HALF, r.width / 2 + pad));
    targetH = Math.min(MAX_HALF_H, Math.max(MIN_HALF, r.height / 2 + pad));

    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    return {
      x: cx + (px - cx) * RESIDUAL,
      y: cy + (py - cy) * RESIDUAL
    };
  }

  function dropPetal(atX, atY) {
    var el = petals[petalIndex];
    petalIndex = (petalIndex + 1) % petals.length;
    if (el.__anim) el.__anim.cancel();

    el.style.left = atX + 'px';
    el.style.top = atY + 'px';
    el.style.background = Math.random() < 0.34 ? '#C9A24A' : '#A8342B';

    var dx = (Math.random() - 0.5) * 22;
    var dy = 10 + Math.random() * 16;
    var r0 = Math.random() * 360;
    var duration = 480 + Math.random() * 220;

    el.__anim = el.animate([
      { transform: 'rotate(' + r0 + 'deg) scale(1)', opacity: 0.42 },
      {
        transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) rotate(' + (r0 + 70).toFixed(1) + 'deg) scale(.34)',
        opacity: 0
      }
    ], {
      duration: duration,
      easing: 'cubic-bezier(.22,.7,.3,1)',
      fill: 'forwards'
    });
  }

  function step(now) {
    raf = 0;
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = now;

    var goal = magnetTarget();
    var tx = goal ? goal.x : px;
    var ty = goal ? goal.y : py;

    /* 形变：圆 ↔ 方，指数趋近 */
    var goalG = magnetEl ? 1 : 0;
    g += (goalG - g) * Math.min(1, dt * 1000 / MORPH);
    if (Math.abs(goalG - g) < 0.004) g = goalG;

    /* 尺寸也是缓动：进磁吸是长大，退出磁吸是收回，都不许「啪」一下 */
    var kSize = Math.min(1, dt * 1000 / SIZE_MS);
    halfW += (targetW - halfW) * kSize;
    halfH += (targetH - halfH) * kSize;
    if (Math.abs(halfW - targetW) < 0.12) halfW = targetW;
    if (Math.abs(halfH - targetH) < 0.12) halfH = targetH;

    if (reduce) {
      /* 减少动效：不做缓动，环心直接贴在指针上 */
      x = tx;
      y = ty;
      vx = 0;
      vy = 0;
    } else {
      var sub = Math.max(1, Math.ceil(dt * 240));
      var h = dt / sub;
      var k;
      for (k = 0; k < sub; k++) {
        vx += (-K * (x - tx) - C * vx) * h;
        x += vx * h;
        vy += (-K * (y - ty) - C * vy) * h;
        y += vy * h;
      }
    }

    var speed = Math.sqrt(vx * vx + vy * vy);

    /* 走得越快，花环转得越快；停下来就停 */
    if (speed > 12) {
      spin += (speed * dt) * 0.22;
      if (spin > 360) spin -= 360;
    }

    /* 花瓣：按走过距离撒，不按帧，快慢一致 */
    if (!reduce && speed > 210) {
      travelled += speed * dt;
      if (travelled >= 26) {
        travelled = 0;
        dropPetal(x, y);
      }
    } else {
      travelled = 0;
    }

    paint();

    if (Math.abs(g - drawnG) > 0.002 || Math.abs(halfW - drawnRx) > 0.2 ||
        Math.abs(halfH - drawnRy) > 0.2 || Math.abs(spin - drawnSpin) > 0.05) {
      applyGeometry();
    }

    if (speed < 4 && g === goalG && halfW === targetW && halfH === targetH &&
        Math.abs(x - tx) < .1 && Math.abs(y - ty) < .1 &&
        Math.abs(vx) < 1 && Math.abs(vy) < 1) {
      x = tx;
      y = ty;
      vx = vy = 0;
      lastTime = 0;
      paint();
      return;
    }

    raf = window.requestAnimationFrame(step);
  }

  function updateState(node) {
    if (!node || node === lastTarget) return;
    lastTarget = node;
    var el = node.nodeType === 1 ? node : node.parentElement;
    var isText = !!(el && el.closest && el.closest(TEXT_SEL));
    var hoverEl = el && el.closest ? el.closest(HOVER_SEL) : null;
    var magnet = !isText && el && el.closest ? el.closest(MAGNET_SEL) : null;

    /* 整块大链接（整段可点的横幅、整行表单）只点亮不吸附，否则方框会大到失控 */
    if (magnet) {
      var mr = magnet.getBoundingClientRect();
      if (mr.width > BIG_W || mr.height > BIG_H) magnet = null;
    }

    wrap.classList.toggle('is-text', isText);
    wrap.classList.toggle('is-hover', !!hoverEl && !isText);
    wrap.classList.toggle('is-magnet', !!magnet);
    magnetEl = magnet || null;

    if (!raf && !reduce) {
      lastTime = 0;
      raf = window.requestAnimationFrame(step);
    }
  }

  function onMove(event) {
    px = event.clientX;
    py = event.clientY;

    if (!shown) {
      shown = true;
      x = px;
      y = py;
      vx = vy = 0;
      paint();
      wrap.classList.add('is-visible');
    }

    updateState(event.target);

    if (reduce) {
      var goal = magnetTarget();
      g = magnetEl ? 1 : 0;
      halfW = targetW;
      halfH = targetH;
      x = goal ? goal.x : px;
      y = goal ? goal.y : py;
      applyGeometry();
      paint();
      return;
    }

    if (!raf) {
      lastTime = 0;
      raf = window.requestAnimationFrame(step);
    }
  }

  applyGeometry();

  document.addEventListener('pointermove', onMove, { passive: true });

  /* 页面滚动时元素会在指针底下跑掉：轻推一帧让磁吸重新判定（元素走了就顺势收回） */
  window.addEventListener('scroll', function () {
    if (!shown || reduce || raf) return;
    lastTime = 0;
    raf = window.requestAnimationFrame(step);
  }, { passive: true });

  document.addEventListener('pointerdown', function () {
    wrap.classList.add('is-down');
  }, { passive: true });

  document.addEventListener('pointerup', function () {
    wrap.classList.remove('is-down');
  }, { passive: true });

  /* pointerleave 会一路上报到 document（离开任何元素都会触发），
     所以只认 relatedTarget 为空的那种 —— 真正移出窗口时才收起来 */
  document.addEventListener('pointerout', function (event) {
    if (event.relatedTarget) return;
    shown = false;
    lastTarget = null;
    magnetEl = null;
    halfW = targetW = BASE_R;
    halfH = targetH = BASE_R;
    g = 0;
    applyGeometry();
    wrap.classList.remove('is-visible', 'is-down', 'is-hover', 'is-magnet', 'is-text');
  });

  window.addEventListener('blur', function () {
    shown = false;
    lastTarget = null;
    magnetEl = null;
    targetW = targetH = BASE_R;
    wrap.classList.remove('is-visible', 'is-down');
  });
})();

/* ---------- 11. 商品卡整块可点（查看详情之外，卡内任意处都能进详情页） ---------- */
(function cardLinks() {
  var cards = document.querySelectorAll('.card');
  if (!cards.length) return;

  Array.prototype.forEach.call(cards, function (card) {
    var more = card.querySelector('.card__more[href]');
    if (!more) return;

    var url = more.getAttribute('href');
    var nameEl = card.querySelector('.card__name');
    var name = nameEl ? nameEl.textContent.trim() : '这件礼物';

    card.setAttribute('data-href', url);
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', name + ' · 查看详情');

    card.addEventListener('click', function (e) {
      /* 卡内自带的链接、按钮优先走自己的行为 */
      if (e.target.closest && e.target.closest('a, button')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      location.href = url;
    });

    card.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.target !== card) return;
      e.preventDefault();
      location.href = url;
    });
  });
})();

/* ---------- 12. 打开网站时的开场：玫瑰轨道 r = cos(kθ)（k = 5，起点随机） ----------
   每一次「用浏览器打开这个站」都放一次（直接输入地址、外链进入、刷新、新标签页），
   站内点链接跳转不算打开，仍交给 §34 的幕布过渡。
   几何与节奏按参数面板取值：k=5、基础半径 5.2、细节振幅 5、缩放 2.5、
   轨迹粗细 5.2、粒子 100、尾迹长度 0.30、循环 5.2s、呼吸 4.6s、旋转 28s。 */
(function introLoader() {
  var root = document.documentElement;
  if (root.className.indexOf('intro-boot') === -1) return;   /* 站内跳转：交给幕布 */

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce) {
    root.classList.remove('intro-boot');
    return;
  }

  var NS = 'http://www.w3.org/2000/svg';
  var K = 5;            /* k 值：花瓣数 */
  var ORBIT = 5.2;      /* 基础半径 */
  var DETAIL = 5;       /* 细节振幅 */
  var SCALE = 2.5;      /* 缩放 */
  var COUNT = 100;      /* 粒子数 */
  var TRAIL = 0.30;     /* 尾迹长度 */
  var LAP = 5200;       /* 循环时长 */
  var SPIN = 28000;     /* 旋转时长 */
  var PULSE = 4600;     /* 呼吸时长 */
  var HOLD = 1900;      /* 停留多久后掀幕 */
  var RED = [168, 52, 43];
  var GOLD = [201, 162, 74];

  /* 起点随机：尾迹从随机角度出发，整体朝向也随机 */
  var phase0 = Math.random();
  var spin0 = Math.random() * 360;

  /* 参数面板以 0–100 为画框；这里把画框裁到曲线实际占位（VIEW 单位），
     描边与珠粒按同一比例折算，比例与面板一模一样，只是把周围留白收掉。 */
  var VIEW = 56;
  var UNIT = VIEW / 100;

  var svg = document.createElementNS(NS, 'svg');
  var vb = (50 - VIEW / 2).toFixed(2);
  svg.setAttribute('viewBox', vb + ' ' + vb + ' ' + VIEW + ' ' + VIEW);
  svg.setAttribute('class', 'intro__svg');
  svg.setAttribute('aria-hidden', 'true');

  var group = document.createElementNS(NS, 'g');
  svg.appendChild(group);

  var path = document.createElementNS(NS, 'path');
  path.setAttribute('class', 'intro__path');
  path.setAttribute('stroke-width', (5.2 * UNIT).toFixed(2));   /* 轨迹粗细 5.20（面板值） */
  group.appendChild(path);

  var dots = [];
  for (var i = 0; i < COUNT; i++) {
    var dot = document.createElementNS(NS, 'circle');
    group.appendChild(dot);
    dots.push(dot);
  }

  function norm(v) { return ((v % 1) + 1) % 1; }

  /* r(t) = ORBIT - DETAIL·cos(k·t)，再乘 SCALE —— 与参考实现同一组几何 */
  function point(p, detail) {
    var t = p * Math.PI * 2;
    var r = ORBIT - DETAIL * detail * Math.cos(K * t);
    return {
      x: 50 + Math.cos(t) * r * SCALE,
      y: 50 + Math.sin(t) * r * SCALE
    };
  }

  function buildPath(detail) {
    var steps = 420;
    var d = '';
    for (var s = 0; s <= steps; s++) {
      var pt = point(s / steps, detail);
      d += (s === 0 ? 'M ' : 'L ') + pt.x.toFixed(2) + ' ' + pt.y.toFixed(2);
    }
    return d;
  }

  /* 尾迹由朱红渐到赤金 */
  function tint(fade) {
    var r = Math.round(RED[0] + (GOLD[0] - RED[0]) * fade);
    var g = Math.round(RED[1] + (GOLD[1] - RED[1]) * fade);
    var b = Math.round(RED[2] + (GOLD[2] - RED[2]) * fade);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  var startedAt = 0;
  var raf = 0;

  function frame(now) {
    if (!startedAt) startedAt = now;
    var time = now - startedAt;
    var detail = 0.52 + ((Math.sin((time % PULSE) / PULSE * Math.PI * 2 + 0.55) + 1) / 2) * 0.48;
    var spin = spin0 - (time / SPIN) * 360;

    group.setAttribute('transform', 'rotate(' + spin.toFixed(2) + ' 50 50)');
    path.setAttribute('d', buildPath(detail));

    var head = norm(time / LAP + phase0);
    for (var n = 0; n < COUNT; n++) {
      var tail = n / (COUNT - 1);
      var pt = point(norm(head - tail * TRAIL), detail);
      var fade = Math.pow(1 - tail, 0.56);
      var node = dots[n];
      node.setAttribute('cx', pt.x.toFixed(2));
      node.setAttribute('cy', pt.y.toFixed(2));
      node.setAttribute('r', ((0.9 + fade * 2.7) * UNIT).toFixed(2));
      node.setAttribute('fill', tint(fade));
      node.setAttribute('opacity', (0.05 + fade * 0.95).toFixed(3));
    }

    raf = window.requestAnimationFrame(frame);
  }

  var stage = document.createElement('div');
  stage.className = 'intro__stage';
  stage.appendChild(svg);

  var label = document.createElement('span');
  label.className = 'intro__label';
  label.textContent = '蟳埔花事';
  stage.appendChild(label);

  var sub = document.createElement('span');
  sub.className = 'intro__sub';
  sub.textContent = 'XUNPU BLOSSOM';
  stage.appendChild(sub);

  var intro = document.createElement('div');
  intro.className = 'intro';
  intro.setAttribute('aria-hidden', 'true');
  intro.appendChild(stage);
  document.body.appendChild(intro);

  raf = window.requestAnimationFrame(frame);

  var done = false;
  function finish() {
    if (done) return;
    done = true;
    root.classList.remove('intro-boot');   /* 兜底封面让位，露出正在掀起的开场 */
    intro.classList.add('is-done');
    /* 通知 §0 的入场闸门：幕布开始抬升，首屏的进场动画压到抬完再放 */
    try { document.dispatchEvent(new Event('xb:intro-lift')); } catch (e) {}
    window.setTimeout(function () {
      window.cancelAnimationFrame(raf);
      if (intro.parentNode) intro.parentNode.removeChild(intro);
    }, 900);
  }

  window.setTimeout(finish, HOLD);
})();

