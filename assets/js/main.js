/* 蟳埔花事 · 站点交互（原生 JS，无依赖） */
(function () {
  'use strict';

  var doc = document;
  var body = doc.body;

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

  /* ---------- 3. 进入视口渐显 ---------- */
  var reveals = doc.querySelectorAll('.reveal');
  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      reveals.forEach(function (el) { el.classList.add('is-in'); });
    }
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

  /* ---------- 9. Hero 落英毛玻璃 ---------- */
  var heroEl = doc.querySelector('.hero');
  var backCv = doc.getElementById('petals-back');
  var frontCv = doc.getElementById('petals-front');
  if (heroEl && backCv && frontCv && backCv.getContext) {
    initPetals(heroEl, backCv, frontCv);
  }

  function initPetals(hero, backCanvas, frontCanvas) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var backCtx = backCanvas.getContext('2d');
    var frontCtx = frontCanvas.getContext('2d');

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
      maxFront = Math.max(8, Math.round(Math.min(28, area / 65000) * k));
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
      H = Math.max(1, Math.round(rect.height));
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      sizeCanvas(backCanvas, backCtx);
      sizeCanvas(frontCanvas, frontCtx);
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
        ctx.globalAlpha = p.alpha * (0.55 + 0.45 * fs);
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
      drawList(frontCtx, front, dt);
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
