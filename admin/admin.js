/* 蟳埔花事 · 管理后台（原生 JS，无依赖） */
(function () {
  'use strict';

  /* ================================================================
     工具
     ================================================================ */

  const $ = (sel, root) => (root || document).querySelector(sel);

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const money = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

  function timeText(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const STATUS = {
    pending: '待处理', confirmed: '已确认', producing: '生产中',
    shipped: '已发货', completed: '已完成', cancelled: '已取消'
  };

  function statusTag(status) {
    return `<span class="tag tag--${esc(status)}">${esc(STATUS[status] || status)}</span>`;
  }

  function toast(message, isError) {
    const node = $('#toast');
    node.textContent = message;
    node.className = 'toast is-on' + (isError ? ' toast--err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { node.className = 'toast'; }, 2400);
  }

  let sessionExpired = false;

  async function api(path, options) {
    const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* 非 JSON */ }

    // 登录接口自己会返回 401（密码错误），不能当成会话过期处理
    const isLoginCall = String(path).indexOf('/auth/login') >= 0;
    if (res.status === 401 && !sessionExpired && !isLoginCall) {
      sessionExpired = true;
      showLogin('登录已过期，请重新登录');
      throw new Error('登录已过期');
    }
    if (!res.ok || !payload || payload.ok === false) {
      const msg = (payload && payload.error && payload.error.message) || `请求失败（${res.status}）`;
      throw new Error(msg);
    }
    return payload.data;
  }

  /* ================================================================
     登录
     ================================================================ */

  async function boot() {
    try {
      const me = await api('/api/admin/auth/me');
      enterApp(me.user);
    } catch (_) {
      showLogin();
    }
  }

  function showLogin(message) {
    $('#app').hidden = true;
    $('#login-screen').hidden = false;
    const err = $('#login-error');
    if (message) { err.textContent = message; err.classList.add('is-on'); }
    else { err.classList.remove('is-on'); }
    setTimeout(() => $('#username').focus(), 60);
  }

  function enterApp(user) {
    sessionExpired = false;
    window.__user = user;
    $('#login-screen').hidden = true;
    $('#app').hidden = false;
    $('#whoami').textContent = user.name || user.username;
    goto('dashboard');
    refreshBadges();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-submit');
    const err = $('#login-error');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const result = await api('/api/admin/auth/login', {
        method: 'POST',
        body: { username: $('#username').value.trim(), password: $('#password').value }
      });
      err.classList.remove('is-on');
      $('#password').value = '';
      enterApp(result.user);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add('is-on');
    } finally {
      btn.disabled = false;
      btn.textContent = '进入后台';
    }
  });

  $('#logout').addEventListener('click', async () => {
    try { await api('/api/admin/auth/logout', { method: 'POST' }); } catch (_) {}
    showLogin();
  });

  /* ================================================================
     路由
     ================================================================ */

  const TITLES = {
    dashboard: ['概览', '今日经营状态与库存提醒'],
    orders: ['订单', '按状态流转，支持导出对账'],
    products: ['商品', '价格、库存与上下架'],
    customers: ['客户', '已注册的顾客与消费汇总'],
    inquiries: ['询价', '合作、定制、试戴与授权需求'],
    settings: ['设置', '站点文案、数据清理与账号安全']
  };

  const nav = $('#nav');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) goto(btn.dataset.view);
  });

  function goto(view) {
    state.view = view;
    nav.querySelectorAll('.nav__item').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.view === view);
    });
    const [title, sub] = TITLES[view] || ['', ''];
    $('#page-title').textContent = title;
    $('#page-sub').textContent = sub;
    $('#page-actions').innerHTML = '';
    const view$ = $('#view');
    view$.innerHTML = '<div class="empty">加载中…</div>';
    ({ dashboard: renderDashboard, orders: renderOrders, products: renderProducts, customers: renderCustomers, inquiries: renderInquiries, settings: renderSettings }[view])()
      .catch((ex) => {
        view$.innerHTML = `<div class="empty">${esc(ex.message)}</div>`;
      });
  }

  const state = {
    view: 'dashboard',
    orderFilter: { status: '', q: '', from: '', to: '', page: 1 },
    customerFilter: { q: '', page: 1 },
    inquiryFilter: { status: '', type: '', page: 1 }
  };

  /* ================================================================
     概览
     ================================================================ */

  async function renderDashboard() {
    const d = await api('/api/admin/overview');
    const view$ = $('#view');

    $('#page-actions').innerHTML =
      '<button class="btn btn--sm" id="act-refresh">刷新数据</button>' +
      '<a class="btn btn--sm btn--primary" href="/" target="_blank" rel="noopener">查看站点</a>';
    $('#act-refresh').addEventListener('click', () => goto('dashboard'));

    const kpis = `
      <div class="kpis">
        <div class="kpi kpi--accent">
          <div class="kpi__label">今日成交</div>
          <div class="kpi__value">${money(d.today.revenue)}</div>
          <div class="kpi__foot">${d.today.orders} 笔订单 · ${d.today.day}</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">近 7 日</div>
          <div class="kpi__value">${money(d.week.revenue)}</div>
          <div class="kpi__foot">${d.week.orders} 笔 · 自 ${d.week.from}</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">待处理订单</div>
          <div class="kpi__value">${d.pendingOrders}<small>笔</small></div>
          <div class="kpi__foot">${d.newInquiries} 条询价待跟进</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">近 30 日客单价</div>
          <div class="kpi__value">${money(d.avgOrderValue)}</div>
          <div class="kpi__foot">累计 ${money(d.month.revenue)} · 在库 ${d.stockTotal} 件</div>
        </div>
      </div>`;

    const chart = `
      <div class="card">
        <div class="section-title">
          <h3>近 14 日成交</h3>
          <span>柱为金额 · 折线为单量</span>
        </div>
        ${renderChart(d.series)}
      </div>`;

    const lowStock = d.lowStock.length
      ? d.lowStock.map((s) => `
        <div class="line-item" style="grid-template-columns:1fr auto">
          <div>
            <div class="line-item__name">${esc(s.productName)}</div>
            <div class="line-item__meta">${esc(s.variantName)} · ${esc(s.sku)}</div>
          </div>
          <div class="line-item__amount" style="color:var(--red)">剩 ${s.stock}</div>
        </div>`).join('')
      : '<div class="empty" style="padding:26px 0">库存充足，暂无预警</div>';

    const side = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="section-title"><h3>库存预警</h3><span>≤ 5 件</span></div>
          <div class="line-items">${lowStock}</div>
        </div>
        <div class="card">
          <div class="section-title"><h3>热销单品</h3><span>近 30 日</span></div>
          ${d.topProducts.length ? d.topProducts.map((p, i) => `
            <div class="line-item" style="grid-template-columns:20px 1fr auto">
              <span class="muted small">${i + 1}</span>
              <div>
                <div class="line-item__name">${esc(p.name)}</div>
                <div class="line-item__meta">售出 ${p.qty} 件</div>
              </div>
              <div class="line-item__amount">${money(p.revenue)}</div>
            </div>`).join('') : '<div class="empty" style="padding:26px 0">还没有成交记录</div>'}
        </div>
      </div>`;

    const recent = d.recentOrders.length
      ? `<table class="tbl">
          <thead><tr><th>订单号</th><th>客户</th><th>金额</th><th>状态</th><th class="right">时间</th></tr></thead>
          <tbody>${d.recentOrders.map((o) => `
            <tr class="is-clickable" data-order="${o.id}">
              <td class="mono small">${esc(o.orderNo)}</td>
              <td>${esc(o.customer.name)}<span class="muted small"> · ${esc(o.customer.phone)}</span></td>
              <td class="num">${o.totalText}</td>
              <td>${statusTag(o.status)}</td>
              <td class="right muted small">${timeText(o.createdAt)}</td>
            </tr>`).join('')}</tbody>
        </table>`
      : '<div class="empty">还没有订单。站点上的「预订 / 加入礼袋」提交后会出现在这里。</div>';

    view$.innerHTML = `
      ${kpis}
      <div class="grid-2" style="margin-bottom:14px">
        ${chart}
        ${side}
      </div>
      <div class="card">
        <div class="section-title">
          <h3>最近订单</h3>
          <button class="btn btn--sm" id="go-orders">查看全部</button>
        </div>
        <div class="table-wrap">${recent}</div>
      </div>`;

    $('#go-orders').addEventListener('click', () => goto('orders'));
    view$.querySelectorAll('[data-order]').forEach((tr) => {
      tr.addEventListener('click', () => openOrder(Number(tr.dataset.order)));
    });
  }

  function renderChart(series) {
    const W = 640, H = 190, padL = 34, padR = 8, padT = 10, padB = 22;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxRev = Math.max(1, ...series.map((s) => s.revenue));
    const maxOrders = Math.max(1, ...series.map((s) => s.orders));
    const step = innerW / series.length;
    const barW = Math.max(6, step * 0.44);

    const ticks = 3;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const y = padT + (innerH / ticks) * i;
      const value = Math.round((maxRev / ticks) * (ticks - i));
      grid += `<line class="chart__grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      grid += `<text class="chart__axis" x="${padL - 6}" y="${y + 3}" text-anchor="end">${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}</text>`;
    }

    let bars = '';
    let points = [];
    series.forEach((s, i) => {
      const h = (s.revenue / maxRev) * innerH;
      const x = padL + step * i + (step - barW) / 2;
      const y = padT + innerH - h;
      bars += `<rect class="chart__bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="1">` +
        `<title>${s.day} · ${money(s.revenue)} · ${s.orders} 单</title></rect>`;

      const cx = padL + step * i + step / 2;
      const cy = padT + innerH - (s.orders / maxOrders) * innerH * 0.82;
      points.push(`${cx.toFixed(1)},${cy.toFixed(1)}`);

      if (i % 2 === 0 || i === series.length - 1) {
        bars += `<text class="chart__axis" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${s.label}</text>`;
      }
    });

    const line = `<polyline class="chart__line" points="${points.join(' ')}"/>`;
    const dots = series.map((s, i) => {
      const [cx, cy] = points[i].split(',');
      return `<circle class="chart__dot" cx="${cx}" cy="${cy}" r="2.4"><title>${s.day} · ${s.orders} 单</title></circle>`;
    }).join('');

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 14 日成交趋势">
      ${grid}${bars}${line}${dots}
    </svg>`;
  }

  /* ================================================================
     订单
     ================================================================ */

  async function renderOrders() {
    const f = state.orderFilter;
    const params = new URLSearchParams();
    if (f.status) params.set('status', f.status);
    if (f.q) params.set('q', f.q);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    params.set('page', String(f.page));
    params.set('limit', '20');

    const data = await api('/api/admin/orders?' + params.toString());
    const view$ = $('#view');

    $('#page-actions').innerHTML =
      '<button class="btn btn--sm" id="act-export">导出 CSV</button>';

    const chips = [
      ['', '全部'], ['pending', '待处理'], ['confirmed', '已确认'],
      ['producing', '生产中'], ['shipped', '已发货'], ['completed', '已完成'], ['cancelled', '已取消']
    ].map(([key, label]) =>
      `<button class="chip ${f.status === key ? 'is-active' : ''}" data-status="${key}">${label}</button>`
    ).join('');

    const rows = data.items.length ? data.items.map((o) => `
      <tr class="is-clickable" data-order="${o.id}">
        <td class="mono small">${esc(o.orderNo)}</td>
        <td class="small nowrap">${timeText(o.createdAt)}</td>
        <td>${esc(o.customer.name)}<div class="muted small">${esc(o.customer.phone)}</div></td>
        <td class="small muted">${o.items.map((i) => esc(i.name) + ' ×' + i.qty).join('<br>')}</td>
        <td class="num nowrap">${o.totalText}</td>
        <td>${statusTag(o.status)}</td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="tbl__empty">没有符合条件的订单</td></tr>`;

    view$.innerHTML = `
      <div class="toolbar">
        <div class="chips" id="status-chips">${chips}</div>
        <div class="toolbar__grow"></div>
        <div class="search"><input class="input" id="order-q" placeholder="订单号 / 姓名 / 手机号" value="${esc(f.q)}"></div>
        <input class="input date-input" type="date" id="order-from" value="${esc(f.from)}" title="起始日期">
        <input class="input date-input" type="date" id="order-to" value="${esc(f.to)}" title="结束日期">
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>订单号</th><th>下单时间</th><th>客户</th><th>商品</th><th>金额</th><th>状态</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pager">
          <span>共 ${data.total} 笔 · 第 ${data.page}/${data.pages} 页</span>
          <div class="pager__btns">
            <button class="btn btn--sm" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>上一页</button>
            <button class="btn btn--sm" id="next-page" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button>
          </div>
        </div>
      </div>`;

    $('#act-export').addEventListener('click', () => {
      const q = new URLSearchParams();
      if (f.status) q.set('status', f.status);
      if (f.from) q.set('from', f.from);
      if (f.to) q.set('to', f.to);
      window.open('/api/admin/orders.csv?' + q.toString(), '_blank');
    });

    $('#status-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-status]');
      if (!chip) return;
      f.status = chip.dataset.status;
      f.page = 1;
      goto('orders');
    });

    const submitFilter = () => {
      f.q = $('#order-q').value.trim();
      f.from = $('#order-from').value;
      f.to = $('#order-to').value;
      f.page = 1;
      goto('orders');
    };
    $('#order-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitFilter(); });
    $('#order-from').addEventListener('change', submitFilter);
    $('#order-to').addEventListener('change', submitFilter);

    $('#prev-page').addEventListener('click', () => { f.page = Math.max(1, f.page - 1); goto('orders'); });
    $('#next-page').addEventListener('click', () => { f.page += 1; goto('orders'); });

    view$.querySelectorAll('[data-order]').forEach((tr) => {
      tr.addEventListener('click', () => openOrder(Number(tr.dataset.order)));
    });
  }

  async function openOrder(id) {
    const drawer = $('#drawer');
    $('#drawer-eyebrow').textContent = '订单详情';
    $('#drawer-title').textContent = '加载中…';
    $('#drawer-body').innerHTML = '<div class="empty">读取中…</div>';
    $('#drawer-foot').innerHTML = '';
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');

    let o;
    try {
      o = await api('/api/admin/orders/' + id);
    } catch (ex) {
      $('#drawer-body').innerHTML = `<div class="empty">${esc(ex.message)}</div>`;
      return;
    }

    $('#drawer-title').textContent = o.orderNo;
    $('#drawer-eyebrow').textContent = '订单 · ' + o.statusText;

    const items = o.items.map((i) => `
      <div class="line-item">
        <img src="/${esc(i.image || 'assets/img/logo.svg')}" alt="">
        <div>
          <div class="line-item__name">${esc(i.name)}</div>
          <div class="line-item__meta">${esc(i.variantName)} · ${esc(i.sku)} · ×${i.qty}</div>
        </div>
        <div class="line-item__amount">${i.subtotalText}</div>
      </div>`).join('');

    $('#drawer-body').innerHTML = `
      <div class="kv">
        <dt>状态</dt><dd>${statusTag(o.status)}</dd>
        <dt>下单</dt><dd class="small">${timeText(o.createdAt)}</dd>
        <dt>来源</dt><dd class="small">${esc(o.channel)} · ${o.fulfillment === 'pickup' ? '到店自提' : '快递配送'}</dd>
        <dt>收货</dt><dd>${esc(o.customer.name)} · ${esc(o.customer.phone)}${
          o.customer.address ? `<div class="small muted">${esc([o.customer.province, o.customer.city, o.customer.district, o.customer.address].filter(Boolean).join(' '))}</div>` : ''
        }</dd>
        ${o.customer.email ? `<dt>邮箱</dt><dd class="small">${esc(o.customer.email)}</dd>` : ''}
        ${o.note ? `<dt>买家备注</dt><dd class="small">${esc(o.note)}</dd>` : ''}
      </div>

      <div class="section-title" style="margin-bottom:8px"><h3 style="font-size:14px">商品</h3></div>
      <div class="line-items">${items}</div>

      <div class="totals">
        <div class="totals__row"><span>商品金额</span><span>${o.itemsTotalText}</span></div>
        <div class="totals__row"><span>运费</span><span>${o.shippingFeeCents ? o.shippingFeeText : '免运费'}</span></div>
        <div class="totals__row totals__row--sum"><span>合计</span><strong>${o.totalText}</strong></div>
      </div>

      <div class="section-title" style="margin:22px 0 8px"><h3 style="font-size:14px">内部备注</h3></div>
      <textarea class="input" id="order-note" rows="3" placeholder="仅后台可见，例如：已电话确认、需补发花簇">${esc(o.adminNote)}</textarea>
      <div style="margin-top:10px"><button class="btn btn--sm" id="save-note">保存备注</button></div>`;

    const allowed = o.allowedStatus || [];
    const labels = { confirmed: '确认订单', producing: '转入生产', shipped: '标记发货', completed: '标记完成', cancelled: '取消订单' };

    $('#drawer-foot').innerHTML =
      allowed.map((s) => `<button class="btn btn--sm ${s === 'cancelled' ? 'btn--danger' : 'btn--primary'}" data-next="${s}">${labels[s] || STATUS[s]}</button>`).join('') +
      '<button class="btn btn--sm" data-delete-order title="删除后不可恢复">删除订单</button>';

    $('#save-note').addEventListener('click', async () => {
      try {
        await api('/api/admin/orders/' + id, { method: 'PATCH', body: { adminNote: $('#order-note').value } });
        toast('备注已保存');
      } catch (ex) { toast(ex.message, true); }
    });

    bindFoot(async (e) => {
      const del = e.target.closest('[data-delete-order]');
      if (del) {
        if (!window.confirm(`删除订单 ${o.orderNo}？\n\n这是永久删除，无法恢复。未发货订单会自动把库存还回去。`)) return;
        del.disabled = true;
        try {
          await api('/api/admin/orders/' + id, { method: 'DELETE' });
          toast('订单已删除');
          closeDrawer();
          refreshBadges();
          goto(state.view === 'dashboard' ? 'dashboard' : 'orders');
        } catch (ex) {
          toast(ex.message, true);
          del.disabled = false;
        }
        return;
      }

      const btn = e.target.closest('[data-next]');
      if (!btn) return;
      const next = btn.dataset.next;
      if (next === 'cancelled' && !window.confirm('确认取消该订单？库存会自动回滚。')) return;
      btn.disabled = true;
      try {
        await api('/api/admin/orders/' + id, { method: 'PATCH', body: { status: next } });
        toast('已更新为「' + STATUS[next] + '」');
        closeDrawer();
        refreshBadges();
        goto(state.view === 'dashboard' ? 'dashboard' : 'orders');
      } catch (ex) {
        toast(ex.message, true);
        btn.disabled = false;
      }
    });
  }

  /* ================================================================
     商品
     ================================================================ */

  async function renderProducts() {
    const data = await api('/api/admin/products');
    const view$ = $('#view');

    $('#page-actions').innerHTML =
      '<button class="btn btn--sm btn--primary" id="act-new-product">新增商品</button>';
    $('#act-new-product').addEventListener('click', openNewProduct);

    const list = data.items.map((p) => `
      <div class="prod" data-product="${p.id}">
        <img class="prod__img" src="/${esc(p.image || 'assets/img/logo.svg')}" alt="">
        <div>
          <div class="prod__name">${esc(p.name)} ${p.status === 'archived' ? '<span class="tag tag--spam">已下架</span>' : ''} ${p.featured ? '<span class="tag tag--pending">主推</span>' : ''}</div>
          <div class="prod__meta">${esc(p.nameEn)} · ${esc(p.slug)} · 共 ${p.variants.length} 个规格 · 合计库存 ${p.stock}</div>
          <div class="prod__tagline">${esc(p.tagline)}</div>
          <div class="prod__vars">
            ${p.variants.map((v) => `
              <div class="var-row">
                <div>
                  <div>${esc(v.name)}</div>
                  <div class="var-row__sku">${esc(v.sku)}</div>
                </div>
                <input class="input input--sm var-price" type="number" min="0" step="0.01" value="${v.price}" data-variant="${v.id}" data-field="price" title="价格（元）">
                <input class="input input--sm var-stock" type="number" min="0" step="1" value="${v.stock}" data-variant="${v.id}" data-field="stock" title="库存">
                <button class="btn btn--sm var-status" data-toggle="${v.id}" data-current="${v.status}">${v.status === 'active' ? '在售' : '停售'}</button>
              </div>`).join('')}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <button class="btn btn--sm" data-edit="${p.id}">编辑文案</button>
          <button class="btn btn--sm ${p.status === 'active' ? 'btn--danger' : ''}" data-archive="${p.id}" data-current="${p.status}">
            ${p.status === 'active' ? '下架' : '重新上架'}
          </button>
        </div>
      </div>`).join('');

    view$.innerHTML = `<div id="products-root">${list || '<div class="empty">还没有商品</div>'}</div>`;

    const root = $('#products-root');
    root.addEventListener('change', onVariantChange);
    root.addEventListener('click', onProductClick);
  }

  async function onVariantChange(e) {
    const input = e.target.closest('[data-variant]');
    if (!input) return;
    const id = input.dataset.variant;
    const field = input.dataset.field;
    const value = input.value;
    try {
      await api('/api/admin/variants/' + id, { method: 'PATCH', body: { [field]: value } });
      toast(field === 'price' ? `价格已改为 ${money(value)}` : `库存已改为 ${value}`);
    } catch (ex) {
      toast(ex.message, true);
    }
  }

  async function onProductClick(e) {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const next = toggle.dataset.current === 'active' ? 'archived' : 'active';
      try {
        await api('/api/admin/variants/' + toggle.dataset.toggle, { method: 'PATCH', body: { status: next } });
        goto('products');
      } catch (ex) { toast(ex.message, true); }
      return;
    }

    const archive = e.target.closest('[data-archive]');
    if (archive) {
      const next = archive.dataset.current === 'active' ? 'archived' : 'active';
      if (next === 'archived' && !window.confirm('下架后站点不再展示该商品，历史订单保留。确认？')) return;
      try {
        if (next === 'archived') {
          await api('/api/admin/products/' + archive.dataset.archive, { method: 'DELETE' });
        } else {
          await api('/api/admin/products/' + archive.dataset.archive, { method: 'PATCH', body: { status: 'active' } });
        }
        toast(next === 'archived' ? '已下架' : '已重新上架');
        goto('products');
      } catch (ex) { toast(ex.message, true); }
      return;
    }

    const edit = e.target.closest('[data-edit]');
    if (edit) openEditProduct(Number(edit.dataset.edit));
  }

  function openModal(title, bodyHtml, footerHtml) {
    const modal = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-foot').innerHTML = footerHtml;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const modal = $('#modal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function openNewProduct() {
    openModal('新增商品', `
      <div class="field">
        <label class="field__label">商品名称</label>
        <input class="input" id="np-name" placeholder="如：花冠 · 头顶花园">
      </div>
      <div class="row-2">
        <div class="field">
          <label class="field__label">标识（英文，用于链接）</label>
          <input class="input" id="np-slug" placeholder="garland">
        </div>
        <div class="field">
          <label class="field__label">分类</label>
          <select class="input" id="np-category">
            <option value="wear">可佩戴</option>
            <option value="scent">香氛</option>
            <option value="textile">织物</option>
            <option value="object">器物</option>
            <option value="gift">礼盒</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label class="field__label">一句话卖点</label>
        <input class="input" id="np-tagline" placeholder="二十二簇真丝绢花，三点卡扣可拆可换。">
      </div>
      <div class="row-2">
        <div class="field">
          <label class="field__label">首个规格名称</label>
          <input class="input" id="np-variant" placeholder="标准款">
        </div>
        <div class="field">
          <label class="field__label">价格（元）</label>
          <input class="input" id="np-price" type="number" min="0" step="0.01" placeholder="398">
        </div>
      </div>
      <div class="row-2">
        <div class="field">
          <label class="field__label">初始库存</label>
          <input class="input" id="np-stock" type="number" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label class="field__label">主图路径</label>
          <input class="input" id="np-image" placeholder="assets/img/p-garland.svg">
        </div>
      </div>`, `
      <button class="btn" data-close>取消</button>
      <button class="btn btn--primary" id="np-save">创建</button>`);

    $('#np-save').addEventListener('click', async () => {
      const body = {
        name: $('#np-name').value.trim(),
        slug: $('#np-slug').value.trim() || undefined,
        category: $('#np-category').value,
        tagline: $('#np-tagline').value.trim(),
        image: $('#np-image').value.trim(),
        unit: '件',
        variants: [{
          name: $('#np-variant').value.trim() || '标准款',
          price: $('#np-price').value,
          stock: $('#np-stock').value || 0
        }]
      };
      if (!body.name) return toast('请填写商品名称', true);
      if (!body.variants[0].price) return toast('请填写价格', true);
      try {
        await api('/api/admin/products', { method: 'POST', body });
        closeModal();
        toast('商品已创建');
        goto('products');
      } catch (ex) { toast(ex.message, true); }
    });
  }

  async function openEditProduct(id) {
    const data = await api('/api/admin/products');
    const p = data.items.find((x) => x.id === id);
    if (!p) return toast('商品不存在', true);

    openModal('编辑商品文案', `
      <div class="field">
        <label class="field__label">商品名称</label>
        <input class="input" id="ep-name" value="${esc(p.name)}">
      </div>
      <div class="field">
        <label class="field__label">英文名</label>
        <input class="input" id="ep-name-en" value="${esc(p.nameEn)}">
      </div>
      <div class="field">
        <label class="field__label">卖点</label>
        <input class="input" id="ep-tagline" value="${esc(p.tagline)}">
      </div>
      <div class="field">
        <label class="field__label">描述</label>
        <textarea class="input" id="ep-desc" rows="4">${esc(p.description)}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label class="field__label">单位</label>
          <input class="input" id="ep-unit" value="${esc(p.unit)}">
        </div>
        <div class="field">
          <label class="field__label">主图路径</label>
          <input class="input" id="ep-image" value="${esc(p.image)}">
        </div>
      </div>
      <label class="small muted" style="display:flex;gap:6px;align-items:center">
        <input type="checkbox" id="ep-featured" ${p.featured ? 'checked' : ''}> 在首页主推
      </label>`, `
      <button class="btn" data-close>取消</button>
      <button class="btn btn--primary" id="ep-save">保存</button>`);

    $('#ep-save').addEventListener('click', async () => {
      try {
        await api('/api/admin/products/' + id, {
          method: 'PATCH',
          body: {
            name: $('#ep-name').value.trim(),
            nameEn: $('#ep-name-en').value.trim(),
            tagline: $('#ep-tagline').value.trim(),
            description: $('#ep-desc').value.trim(),
            unit: $('#ep-unit').value.trim(),
            image: $('#ep-image').value.trim(),
            featured: $('#ep-featured').checked
          }
        });
        closeModal();
        toast('已保存');
        goto('products');
      } catch (ex) { toast(ex.message, true); }
    });
  }

  /* ================================================================
     客户
     ================================================================ */

  async function renderCustomers() {
    const f = state.customerFilter;
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    params.set('page', String(f.page));
    params.set('limit', '20');

    const data = await api('/api/admin/customers?' + params.toString());
    const view$ = $('#view');

    const rows = data.items.length ? data.items.map((c) => `
      <tr data-customer="${c.id}">
        <td>
          <div>${esc(c.nickname)}</div>
          <div class="muted small">${esc(c.phoneMasked)}</div>
        </td>
        <td class="small muted">${esc(c.email || '—')}</td>
        <td class="num">${c.orders}</td>
        <td class="num">${c.spentText}</td>
        <td class="small muted nowrap">${c.lastLoginAt ? timeText(c.lastLoginAt) : '—'}</td>
        <td>
          <span class="tag ${c.status === 'active' ? 'tag--confirmed' : 'tag--spam'}">
            ${c.status === 'active' ? '正常' : '已停用'}
          </span>
        </td>
        <td class="right nowrap">
          <button class="btn btn--sm" data-toggle-customer="${c.id}" data-current="${c.status}">
            ${c.status === 'active' ? '停用' : '启用'}
          </button>
          <button class="btn btn--sm btn--danger" data-del-customer="${c.id}" data-orders="${c.orders}">删除</button>
        </td>
      </tr>`).join('')
      : `<tr><td colspan="7" class="tbl__empty">还没有顾客注册。站点右上角「登录」即可注册。</td></tr>`;

    view$.innerHTML = `<div id="customers-root">
      <div class="toolbar">
        <div class="search"><input class="input" id="cust-q" placeholder="手机号 / 昵称 / 邮箱" value="${esc(f.q)}"></div>
        <div class="toolbar__grow"></div>
        <span class="small muted">共 ${data.total} 位顾客</span>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>顾客</th><th>邮箱</th><th>订单</th><th>累计消费</th><th>最近登录</th><th>状态</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pager">
          <span>第 ${data.page}/${data.pages} 页</span>
          <div class="pager__btns">
            <button class="btn btn--sm" id="cprev" ${data.page <= 1 ? 'disabled' : ''}>上一页</button>
            <button class="btn btn--sm" id="cnext" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button>
          </div>
        </div>
      </div>
    </div>`;

    $('#cust-q').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      f.q = e.target.value.trim();
      f.page = 1;
      goto('customers');
    });
    $('#cprev').addEventListener('click', () => { f.page = Math.max(1, f.page - 1); goto('customers'); });
    $('#cnext').addEventListener('click', () => { f.page += 1; goto('customers'); });

    const root = $('#customers-root');
    root.addEventListener('click', async (e) => {
      const toggle = e.target.closest('[data-toggle-customer]');
      if (toggle) {
        const next = toggle.dataset.current === 'active' ? 'disabled' : 'active';
        if (next === 'disabled' && !window.confirm('停用后该顾客无法登录，购物袋与订单保留。确认？')) return;
        try {
          await api('/api/admin/customers/' + toggle.dataset.toggleCustomer, { method: 'PATCH', body: { status: next } });
          toast(next === 'disabled' ? '已停用' : '已启用');
          goto('customers');
        } catch (ex) { toast(ex.message, true); }
        return;
      }

      const del = e.target.closest('[data-del-customer]');
      if (del) {
        if (Number(del.dataset.orders) > 0) {
          return toast('该顾客有订单，不能删除，请改为停用', true);
        }
        if (!window.confirm('删除该顾客账号？此操作不可恢复。')) return;
        try {
          await api('/api/admin/customers/' + del.dataset.delCustomer, { method: 'DELETE' });
          toast('已删除');
          goto('customers');
        } catch (ex) { toast(ex.message, true); }
      }
    });
  }

  /* ================================================================
     询价
     ================================================================ */

  async function renderInquiries() {
    const f = state.inquiryFilter;
    const params = new URLSearchParams();
    if (f.status) params.set('status', f.status);
    if (f.type) params.set('type', f.type);
    params.set('page', String(f.page));
    params.set('limit', '20');

    const data = await api('/api/admin/inquiries?' + params.toString());
    const view$ = $('#view');

    const chips = [
      ['', '全部'], ['new', '待跟进'], ['following', '跟进中'], ['done', '已完成'], ['spam', '无效']
    ].map(([key, label]) =>
      `<button class="chip ${f.status === key ? 'is-active' : ''}" data-istatus="${key}">${label}</button>`
    ).join('');

    const rows = data.items.length ? data.items.map((q) => `
      <tr class="is-clickable" data-inquiry="${q.id}">
        <td class="small nowrap">${timeText(q.createdAt)}</td>
        <td>${esc(q.name)}<div class="muted small">${esc(q.phone)}</div></td>
        <td class="small">${esc(q.typeText)}</td>
        <td class="small muted">${esc((q.company || '') + (q.qty ? ' · ' + q.qty + ' 套' : ''))}</td>
        <td class="small" style="max-width:260px">${esc((q.message || '').slice(0, 46))}${(q.message || '').length > 46 ? '…' : ''}</td>
        <td><span class="tag tag--${esc(q.status)}">${esc(q.statusText)}</span></td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="tbl__empty">暂无询价记录</td></tr>`;

    view$.innerHTML = `
      <div class="toolbar">
        <div class="chips" id="inquiry-chips">${chips}</div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>时间</th><th>联系人</th><th>类型</th><th>公司 / 数量</th><th>需求摘要</th><th>状态</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pager">
          <span>共 ${data.total} 条 · 第 ${data.page}/${data.pages} 页</span>
          <div class="pager__btns">
            <button class="btn btn--sm" id="iprev" ${data.page <= 1 ? 'disabled' : ''}>上一页</button>
            <button class="btn btn--sm" id="inext" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button>
          </div>
        </div>
      </div>`;

    $('#inquiry-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-istatus]');
      if (!chip) return;
      f.status = chip.dataset.istatus;
      f.page = 1;
      goto('inquiries');
    });
    $('#iprev').addEventListener('click', () => { f.page = Math.max(1, f.page - 1); goto('inquiries'); });
    $('#inext').addEventListener('click', () => { f.page += 1; goto('inquiries'); });

    view$.querySelectorAll('[data-inquiry]').forEach((tr) => {
      tr.addEventListener('click', () => openInquiry(Number(tr.dataset.inquiry), data.items));
    });
  }

  function openInquiry(id, cache) {
    const q = (cache || []).find((x) => x.id === id);
    if (!q) return;

    $('#drawer-eyebrow').textContent = '询价 · ' + q.typeText;
    $('#drawer-title').textContent = q.name;
    $('#drawer-body').innerHTML = `
      <div class="kv">
        <dt>状态</dt><dd><span class="tag tag--${esc(q.status)}">${esc(q.statusText)}</span></dd>
        <dt>类型</dt><dd>${esc(q.typeText)}</dd>
        <dt>手机</dt><dd>${esc(q.phone)}</dd>
        ${q.email ? `<dt>邮箱</dt><dd>${esc(q.email)}</dd>` : ''}
        ${q.company ? `<dt>公司</dt><dd>${esc(q.company)}</dd>` : ''}
        ${q.qty ? `<dt>数量</dt><dd>${q.qty} 套</dd>` : ''}
        ${q.budget ? `<dt>预算</dt><dd>${esc(q.budget)}</dd>` : ''}
        <dt>提交</dt><dd class="small">${timeText(q.createdAt)}</dd>
      </div>
      <div class="section-title" style="margin-bottom:6px"><h3 style="font-size:14px">需求描述</h3></div>
      <p class="small" style="white-space:pre-wrap;line-height:1.7">${esc(q.message || '（未填写）')}</p>

      <div class="section-title" style="margin:20px 0 8px"><h3 style="font-size:14px">内部备注</h3></div>
      <textarea class="input" id="iq-note" rows="3" placeholder="跟进记录">${esc(q.adminNote)}</textarea>
      <div style="margin-top:10px"><button class="btn btn--sm" id="iq-save">保存备注</button></div>`;

    $('#drawer-foot').innerHTML = ['new', 'following', 'done', 'spam'].map((s) =>
      `<button class="btn btn--sm ${s === q.status ? 'btn--primary' : ''}" data-istatus="${s}">${({ new: '待跟进', following: '跟进中', done: '已完成', spam: '无效' })[s]}</button>`
    ).join('') + '<button class="btn btn--sm" data-delete-inquiry>删除</button>';

    $('#drawer').classList.add('is-open');
    $('#drawer').setAttribute('aria-hidden', 'false');

    $('#iq-save').addEventListener('click', async () => {
      try {
        await api('/api/admin/inquiries/' + id, { method: 'PATCH', body: { adminNote: $('#iq-note').value } });
        toast('备注已保存');
      } catch (ex) { toast(ex.message, true); }
    });

    bindFoot(async (e) => {
      const del = e.target.closest('[data-delete-inquiry]');
      if (del) {
        if (!window.confirm(`删除「${q.name}」的询价记录？此操作不可恢复。`)) return;
        try {
          await api('/api/admin/inquiries/' + id, { method: 'DELETE' });
          toast('已删除');
          closeDrawer();
          refreshBadges();
          goto('inquiries');
        } catch (ex) { toast(ex.message, true); }
        return;
      }

      const btn = e.target.closest('[data-istatus]');
      if (!btn) return;
      try {
        await api('/api/admin/inquiries/' + id, { method: 'PATCH', body: { status: btn.dataset.istatus } });
        toast('状态已更新');
        closeDrawer();
        refreshBadges();
        goto('inquiries');
      } catch (ex) { toast(ex.message, true); }
    });
  }

  /* ================================================================
     设置
     ================================================================ */

  async function renderSettings() {
    const [content, me] = await Promise.all([api('/api/admin/content'), api('/api/admin/auth/me')]);
    const map = Object.fromEntries(content.items.map((x) => [x.key, x.value]));
    const contact = map.contact || {};
    const notice = map.notice || {};

    const view$ = $('#view');
    view$.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="section-title"><h3>联系信息</h3><span>站点「合作联系」区块</span></div>
          <div class="field">
            <label class="field__label">合作邮箱</label>
            <input class="input" id="ct-email" value="${esc(contact.email)}">
          </div>
          <div class="field">
            <label class="field__label">品牌电话</label>
            <input class="input" id="ct-phone" value="${esc(contact.phone)}">
          </div>
          <div class="field">
            <label class="field__label">线下展厅</label>
            <input class="input" id="ct-showroom" value="${esc(contact.showroom)}">
          </div>
          <div class="field">
            <label class="field__label">营业时间</label>
            <input class="input" id="ct-hours" value="${esc(contact.hours)}">
          </div>
          <button class="btn btn--primary btn--sm" id="save-contact">保存联系信息</button>

          <div class="section-title" style="margin:26px 0 10px"><h3>首页公告</h3><span>显示在站点顶部</span></div>
          <div class="field">
            <label class="field__label">公告文案</label>
            <input class="input" id="nt-text" value="${esc(notice.text)}">
          </div>
          <label class="small muted" style="display:flex;gap:6px;align-items:center;margin-bottom:12px">
            <input type="checkbox" id="nt-enabled" ${notice.enabled ? 'checked' : ''}> 启用公告条
          </label>
          <button class="btn btn--primary btn--sm" id="save-notice">保存公告</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card">
            <div class="section-title"><h3>账号</h3><span>${esc(me.user.role)}</span></div>
            <div class="kv" style="grid-template-columns:64px 1fr">
              <dt>账号</dt><dd>${esc(me.user.username)}</dd>
              <dt>姓名</dt><dd>${esc(me.user.name)}</dd>
            </div>
            <div class="field">
              <label class="field__label">当前密码</label>
              <input class="input" type="password" id="pw-current" autocomplete="current-password">
            </div>
            <div class="field">
              <label class="field__label">新密码（至少 8 位）</label>
              <input class="input" type="password" id="pw-next" autocomplete="new-password">
            </div>
            <button class="btn btn--sm" id="save-pw">修改密码</button>
          </div>

          <div class="card">
            <div class="section-title"><h3>备用密码</h3><span>同一账号可用多个密码</span></div>
            <p class="small muted" style="margin:0 0 12px">
              主密码之外再加一个应急密码，两个都能登录。<br>
              适合平时用强密码、临时用记熟的短密码的场景。
            </p>
            <div id="alt-pw-list" class="small" style="line-height:2"></div>
            <div class="field">
              <label class="field__label">当前密码（确认是你本人在操作）</label>
              <input class="input" type="password" id="alt-pw-current" autocomplete="current-password">
            </div>
            <div class="field">
              <label class="field__label">新备用密码（至少 4 位）</label>
              <input class="input" type="password" id="alt-pw-input" autocomplete="new-password" placeholder="一个你记得住的密码">
            </div>
            <div class="field">
              <label class="field__label">备注（选填）</label>
              <input class="input" id="alt-pw-label" placeholder="例如：应急短密码">
            </div>
            <button class="btn btn--sm" id="add-alt-pw">添加备用密码</button>
          </div>

          <div class="card">
            <div class="section-title"><h3>接口</h3><span>供前端或第三方调用</span></div>
            <div class="small" style="line-height:2">
              <div><code>GET /api/products</code> 商品列表</div>
              <div><code>GET /api/products/:slug</code> 商品详情</div>
              <div><code>POST /api/cart/items</code> 加入购物袋</div>
              <div><code>POST /api/orders</code> 提交订单</div>
              <div><code>POST /api/inquiries</code> 提交询价</div>
            </div>
            <p class="small muted" style="margin-top:12px">完整说明见项目 README「接口一览」。</p>
          </div>

          <div class="card" style="border-color:rgba(168,52,43,.32)">
            <div class="section-title"><h3 style="color:var(--red-deep)">数据清理</h3><span>不可恢复</span></div>
            <p class="small muted" style="margin:0 0 12px">
              测试或演示产生的数据可以在这里删掉。商品、文案与管理账号不受影响。
            </p>
            <div class="field">
              <label class="field__label">输入「清空」以解锁</label>
              <input class="input" id="clear-confirm" placeholder="清空">
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button class="btn btn--sm btn--danger" data-clear="orders">清空订单</button>
              <button class="btn btn--sm btn--danger" data-clear="inquiries">清空询价</button>
              <button class="btn btn--sm btn--danger" data-clear="customers">清空顾客</button>
              <button class="btn btn--sm btn--danger" data-clear="all">全部业务数据</button>
            </div>
            <p class="small muted" style="margin:12px 0 0">
              未发货订单会先把库存还回商品；清空顾客会解除订单与账号的关联，订单本身保留。
            </p>
          </div>
        </div>
      </div>`;

    $('#save-contact').addEventListener('click', async () => {
      try {
        await api('/api/admin/content/contact', {
          method: 'PUT',
          body: {
            value: {
              email: $('#ct-email').value.trim(),
              phone: $('#ct-phone').value.trim(),
              showroom: $('#ct-showroom').value.trim(),
              hours: $('#ct-hours').value.trim()
            }
          }
        });
        toast('联系信息已保存');
      } catch (ex) { toast(ex.message, true); }
    });

    $('#save-notice').addEventListener('click', async () => {
      try {
        await api('/api/admin/content/notice', {
          method: 'PUT',
          body: { value: { text: $('#nt-text').value.trim(), enabled: $('#nt-enabled').checked, link: notice.link || '' } }
        });
        toast('公告已保存');
      } catch (ex) { toast(ex.message, true); }
    });

    $('#save-pw').addEventListener('click', async () => {
      try {
        await api('/api/admin/password', {
          method: 'POST',
          body: { current: $('#pw-current').value, next: $('#pw-next').value }
        });
        $('#pw-current').value = '';
        $('#pw-next').value = '';
        toast('密码已修改，其他设备已退出');
      } catch (ex) { toast(ex.message, true); }
    });

    /* ---------- 备用密码 ---------- */
    async function renderAltPasswords() {
      const box = $('#alt-pw-list');
      if (!box) return;
      try {
        const data = await api('/api/admin/passwords');
        if (!data.items.length) {
          box.innerHTML = '<span class="muted">还没有备用密码，当前只能用主密码登录</span>';
          return;
        }
        box.innerHTML = data.items
          .map((p) => {
            const used = p.lastUsedAt ? '上次使用 ' + String(p.lastUsedAt).slice(5, 16).replace('T', ' ') : '从未使用';
            return (
              '<div style="display:flex;align-items:center;gap:10px;padding:4px 0">' +
              '<span>' + esc(p.label) + '</span>' +
              '<span class="muted" style="flex:1">' + esc(used) + '</span>' +
              '<button class="btn btn--sm btn--danger" data-del-alt="' + p.id + '">删除</button>' +
              '</div>'
            );
          })
          .join('');
      } catch (ex) {
        box.innerHTML = '<span class="muted">' + esc(ex.message) + '</span>';
      }
    }

    $('#add-alt-pw').addEventListener('click', async () => {
      const password = $('#alt-pw-input').value;
      const current = $('#alt-pw-current').value;
      if (!current) return toast('请先填写当前密码', true);
      if (password.length < 4) return toast('备用密码至少 4 位', true);
      const btn = $('#add-alt-pw');
      btn.disabled = true;
      try {
        await api('/api/admin/passwords', {
          method: 'POST',
          body: {
            current,
            password,
            label: $('#alt-pw-label').value.trim() || '备用密码'
          }
        });
        $('#alt-pw-current').value = '';
        $('#alt-pw-input').value = '';
        $('#alt-pw-label').value = '';
        toast('备用密码已添加，现在可以用它登录了');
        renderAltPasswords();
      } catch (ex) {
        toast(ex.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    $('#alt-pw-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del-alt]');
      if (!btn) return;
      if (!window.confirm('删除这个备用密码？删除后它不能再登录，主密码不受影响。')) return;
      btn.disabled = true;
      try {
        await api('/api/admin/passwords/' + btn.dataset.delAlt, { method: 'DELETE' });
        toast('已删除');
        renderAltPasswords();
      } catch (ex) {
        toast(ex.message, true);
        btn.disabled = false;
      }
    });

    renderAltPasswords();

    const CLEAR_LABELS = {
      orders: '全部订单',
      inquiries: '全部询价记录',
      customers: '全部顾客账号',
      all: '全部业务数据（订单 + 询价 + 顾客 + 购物袋）'
    };

    view$.querySelectorAll('[data-clear]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (($('#clear-confirm').value || '').trim() !== '清空') {
          return toast('请先在上方输入「清空」两个字', true);
        }
        const target = btn.dataset.clear;
        if (!window.confirm(`确认清空${CLEAR_LABELS[target]}？\n\n此操作不可恢复。`)) return;

        btn.disabled = true;
        try {
          const r = await api('/api/admin/data/clear', { method: 'POST', body: { target, confirm: '清空' } });
          const c = r.cleared;
          toast(`已清空 — 订单 ${c.orders} · 询价 ${c.inquiries} · 顾客 ${c.customers} · 购物袋 ${c.carts}`);
          refreshBadges();
          goto('settings');
        } catch (ex) {
          toast(ex.message, true);
          btn.disabled = false;
        }
      });
    });
  }

  /* ================================================================
     全局交互
     ================================================================ */

  function closeDrawer() {
    $('#drawer').classList.remove('is-open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }

  /** 抽屉底部按钮每次打开都会重建内容，用 onclick 赋值避免监听器叠加 */
  function bindFoot(handler) {
    $('#drawer-foot').onclick = handler;
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closeDrawer();
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeModal();
    }
  });

  /** 侧栏红点：待处理订单 / 待跟进询价 */
  async function refreshBadges() {
    try {
      const d = await api('/api/admin/overview');
      const setBadge = (key, n) => {
        const node = document.querySelector(`[data-badge="${key}"]`);
        if (!node) return;
        node.hidden = !n;
        node.textContent = n > 99 ? '99+' : String(n);
      };
      setBadge('orders', d.pendingOrders);
      setBadge('inquiries', d.newInquiries);
    } catch (_) { /* 忽略 */ }
  }

  boot();
})();
