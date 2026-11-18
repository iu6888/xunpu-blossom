/* ==========================================================================
   花间游戏 · 排行榜前端逻辑（三个小游戏共用）
   - 上报成绩
   - 渲染榜单
   - 胜利弹窗里的「留个昵称上榜」
   ========================================================================== */
(function () {
  'use strict';

  var API = '/api/games';
  var NAME_KEY = 'xb-game-name';
  var LABELS = { puzzle: '拼图', memory: '翻卡片', spot: '找不同' };

  var mePromise = null;

  function fmt(sec) {
    var s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function req(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}))
      .then(function (r) {
        return r.text().then(function (t) {
          var body = null;
          try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
          if (!r.ok) {
            var msg = (body && (body.message || (body.error && body.error.message))) || '请求失败';
            var err = new Error(msg);
            err.code = body && body.error && body.error.code;
            throw err;
          }
          return body && body.data !== undefined ? body.data : body;
        });
      });
  }

  /** 当前登录的顾客（没有就是 null），只查一次 */
  function me() {
    if (!mePromise) {
      mePromise = req('/api/auth/me')
        .then(function (d) { return (d && d.customer) || null; })
        .catch(function () { return null; });
    }
    return mePromise;
  }

  function getName() {
    try { return (localStorage.getItem(NAME_KEY) || '').trim(); } catch (e) { return ''; }
  }

  function setName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* 隐私模式忽略 */ }
  }

  function submit(payload) {
    return req(API + '/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  /* ---------------- 榜单渲染 ---------------- */

  function rowHtml(it, game) {
    return '<li class="board__row">' +
      '<span class="board__rank">' + it.rank + '</span>' +
      '<span class="board__name">' + esc(it.name) + '</span>' +
      '<span class="board__time">' + fmt(it.seconds) + '</span>' +
      '<span class="board__moves">' + movesText(it, game) + '</span>' +
      '</li>';
  }

  function movesText(it, game) {
    if (!it.moves) return '—';
    return it.moves + (game === 'spot' ? ' 次误点' : ' 步');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * 把榜单渲染进一个容器。
   * 容器结构：<div class="board__head">…<div class="board__tabs">…</div></div>
   *            <ol class="board__list"></ol><div class="board__foot"></div>
   */
  function renderBoard(root, game) {
    var list = root.querySelector('.board__list');
    var foot = root.querySelector('.board__foot');
    if (!list) return;

    list.innerHTML = '<li class="board__empty">正在读取榜单…</li>';

    req(API + '/leaderboard?game=' + encodeURIComponent(game) + '&limit=10')
      .then(function (d) {
        if (!d.items.length) {
          list.innerHTML = '<li class="board__empty">还没有人上榜，来做第一个</li>';
        } else {
          list.innerHTML = d.items.map(function (it) { return rowHtml(it, game); }).join('');
        }
        if (foot) {
          var left = d.stats.plays
            ? '共 ' + d.stats.plays + ' 局 · ' + d.stats.players + ' 位玩家'
            : '战绩从这一局开始累计';
          var right = d.me ? '我的最好成绩 · 第 ' + d.me.rank + ' 名 · ' + fmt(d.me.seconds) : '';
          foot.innerHTML = '<span>' + left + '</span><span>' + right + '</span>';
        }
      })
      .catch(function () {
        list.innerHTML = '<li class="board__empty">榜单暂时读不出来</li>';
      });
  }

  function initBoards() {
    var nodes = document.querySelectorAll('[data-board]');
    for (var i = 0; i < nodes.length; i++) {
      (function (root) {
        var game = root.getAttribute('data-board');
        var tabs = root.querySelectorAll('[data-tab]');
        for (var j = 0; j < tabs.length; j++) {
          tabs[j].addEventListener('click', function () {
            for (var k = 0; k < tabs.length; k++) tabs[k].classList.remove('is-active');
            this.classList.add('is-active');
            renderBoard(root, this.getAttribute('data-tab'));
          });
        }
        renderBoard(root, game);
      })(nodes[i]);
    }
  }

  /* ---------------- 胜利弹窗：上报成绩 ---------------- */

  var inflight = false;

  /**
   * 统一处理一局结束后的上报。
   * opts: { game, seconds, moves }
   * 页面结构需包含 #score-form / #score-name / #score-submit / #score-hint
   */
  function finish(opts) {
    var form = document.getElementById('score-form');
    var hint = document.getElementById('score-hint');
    var input = document.getElementById('score-name');
    var btn = document.getElementById('score-submit');
    if (!form || !hint) return;

    if (inflight) return;

    me().then(function (account) {
      var saved = getName();
      var name = account ? (account.nickname || '') : saved;

      if (name) {
        form.hidden = true;
        hint.className = 'score-hint';
        hint.textContent = '正在记入花间榜…';
        send(opts, name, hint, form);
        return;
      }

      // 没有昵称：让玩家填一个
      form.hidden = false;
      hint.className = 'score-hint';
      hint.textContent = '同一个昵称只保留最好的一次成绩';
      if (input) {
        input.value = '';
        input.focus();
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = '上榜';
      }
      if (input) {
        input.onkeydown = function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            doSubmit(opts, input, hint, form, btn);
          }
        };
      }
      if (btn) {
        btn.onclick = function () { doSubmit(opts, input, hint, form, btn); };
      }
    });
  }

  function doSubmit(opts, input, hint, form, btn) {
    var name = (input && input.value || '').trim();
    if (name.length < 2) {
      hint.className = 'score-hint is-warn';
      hint.textContent = '昵称至少 2 个字';
      return;
    }
    setName(name);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '记分中…';
    }
    send(opts, name, hint, form, function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '上榜';
      }
    });
  }

  function send(opts, name, hint, form, done) {
    if (inflight) return;
    inflight = true;

    submit({
      game: opts.game,
      seconds: Math.round(opts.seconds),
      moves: Math.round(opts.moves || 0),
      name: name
    })
      .then(function (d) {
        hints(hint, 'ok', d);
        if (form) form.hidden = true;
        refreshBoards(opts.game);
      })
      .catch(function (err) {
        hints(hint, 'error', err);
      })
      .then(function () {
        inflight = false;
        if (done) done();
      });
  }

  function hints(hint, kind, d) {
    hint.className = 'score-hint';
    if (kind === 'ok') {
      var best = d.best || {};
      var record = d.isRecord;
      var text = '已上榜 · 第 <b>' + d.rank + '</b> 名';
      if (best.seconds !== undefined) {
        text += ' · 最好成绩 <b>' + fmt(best.seconds) + '</b>';
      }
      if (record && d.rank === 1) text = '新纪录！你暂时是第 <b>1</b> 名';
      else if (record) text += '（个人新纪录）';
      text += '<br>全站已有 ' + d.players + ' 位玩家留下成绩';
      hint.innerHTML = text;
      return;
    }

    hint.className = 'score-hint is-warn';
    var msg = d && d.message ? d.message : '成绩没记上，稍后再试';
    if (d && d.code === 'RATE_LIMITED') msg = '提交太频繁了，歇一会儿再来';
    hint.textContent = msg;
  }

  function refreshBoards(game) {
    var nodes = document.querySelectorAll('[data-board]');
    for (var i = 0; i < nodes.length; i++) {
      var root = nodes[i];
      var active = root.querySelector('.board__tabs .tab.is-active');
      var current = active ? active.getAttribute('data-tab') : root.getAttribute('data-board');
      if (current === game) renderBoard(root, game);
    }
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    initBoards();
    document.documentElement.classList.add('xb-game-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.XBGame = {
    fmt: fmt,
    me: me,
    getName: getName,
    setName: setName,
    submit: submit,
    finish: finish,
    renderBoard: renderBoard,
    labels: LABELS
  };
})();
