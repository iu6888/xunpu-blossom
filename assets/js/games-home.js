/* ==========================================================================
   首页 · 花间游戏入口
   读一次榜单概览：卡片上填「榜首是谁」，底部条填三个游戏的纪录。
   接口不通时保持占位文案，不影响首页其它内容。
   ========================================================================== */
(function () {
  'use strict';

  function fmt(sec) {
    var s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init() {
    var list = document.getElementById('games-rank-list');
    if (!list) return;

    fetch('/api/games/overview', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        var data = res && res.data;
        if (!data || !data.games) return;

        var parts = [];
        var filled = 0;

        data.games.forEach(function (g) {
          var cell = document.querySelector('[data-best="' + g.game + '"]');
          var top = g.items && g.items[0];

          if (cell) {
            if (top) {
              cell.innerHTML = '榜首 <b>' + esc(top.name) + '</b> · ' + fmt(top.seconds) +
                (top.moves ? ' · ' + top.moves + (g.game === 'spot' ? ' 次误点' : ' 步') : '');
            } else {
              cell.textContent = '还没有人上榜，来做第一个';
            }
          }

          if (top) {
            filled++;
            parts.push(
              '<span class="games-rank__item">' +
              '<em>' + g.label + '</em>' +
              '<b>' + esc(top.name) + '</b>' +
              '<span>' + fmt(top.seconds) + '</span>' +
              '</span>'
            );
          }
        });

        if (filled) {
          list.innerHTML = parts.join('');
        } else {
          list.innerHTML = '<span class="games-rank__item"><em>暂无纪录</em>' +
            '<b>三个游戏都还没有人通关</b></span>';
        }
      })
      .catch(function () {
        list.innerHTML = '<span class="games-rank__item"><em>榜单暂时读不出来</em></span>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
