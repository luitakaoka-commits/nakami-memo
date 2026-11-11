/* UI-only fixture. No Firebase, Gmail, storage writes, or production engine. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const yen = amount => `${amount < 0 ? '−' : ''}¥${Math.abs(amount).toLocaleString('ja-JP')}`;
  const { box: note, date: formatDate, yen: yenText } = window.moneyNotice;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const groups = {
    'メイン': ['資金繰り・試算', '支払いの見通し', '予定', '記録', 'メール確認', '口座・カード', 'シフト・給与', 'レシート'],
    'サブ': ['ふりかえり・ムダ支出', '定期支払い', '設定']
  };
  let state = 'normal';
  let route = '資金繰り・試算';
  const menuIcons = {
    '資金繰り・試算': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M5 9v6m14-6v6"/>',
    '支払いの見通し': '<path d="M2 12h20"/><path class="menu-icon-blue" d="M5 12V4h5v8z"/><path class="menu-icon-red" d="M14 12v8h5v-8z"/>',
    '予定': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>',
    '記録': '<path d="M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1"/>',
    'メール確認': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m3 7 9 7 9-7"/>',
    '口座・カード': '<path d="m2 8 9-5 9 5H2zm2 9h9M6 8v9m5-9v5"/><rect class="menu-icon-red" x="12" y="12" width="10" height="8" rx="1"/><path d="M12 15h10"/>',
    'シフト・給与': '<path d="M4 13V6c4-4 10-4 14 0v5M4 13h8m-6 0v7h6"/><circle cx="17" cy="17" r="5"/><path d="M17 14v3h2"/>',
    'レシート': '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8m-8 4h8m-8 4h5"/>',
    'ふりかえり・ムダ支出': '<path d="M12 8C9 5 6 5 2 7v13c4-2 7-2 10 1 3-3 6-3 10-1v-7M12 8v13m1-8 6-9 3 2-6 9-4 2z"/>',
    '定期支払い': '<path d="M2 12h14v9H2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM16 15h-5v3h5m-4-8 3-7 8 3-3 7-3-1m1-5 2 1M3 8h5M5 5h4"/>',
    '設定': '<path d="m10 2 4 0 1 3 3-1 3 3-1 3 2 1v3l-3 1 1 3-3 3-3-1-1 2h-4l-1-3-3 1-3-3 1-3-2-1v-3l3-1-1-3 3-3 3 1z"/><circle cx="12" cy="12" r="3"/>'
  };
  const startDate = '2026-11-09';
  const useDeadline = '2026-11-15';
  function fixture() {
    let balance = state === 'shortfall' ? 60000 : window.moneyOverview.primaryBalance();
    const opening = balance;
    const end = new Date(Date.UTC(2026, 10, 9 + window.moneyExtras.horizon() - 1)).toISOString().slice(0, 10);
    const events = window.moneyPlans.forecastItems().filter(event => event.date >= startDate && event.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
    const rows = [{ date: startDate, name: '現在の口座残高', amount: 0, type: '現在' }, ...events]
      .map(event => ({ ...event, balance: balance += event.amount }));
    const payments = events.filter(event => event.amount < 0);
    const paymentDeadline = payments.at(-1)?.date;
    const reserve = window.moneyExtras.reserve();
    return {
      opening, rows, payments, reserve,
      paymentDeadline: paymentDeadline && paymentDeadline > useDeadline ? paymentDeadline : useDeadline,
      available: opening + payments.reduce((sum, item) => sum + item.amount, 0) - reserve,
      sameDayIncome: payments.some(item => item.debit && events.some(event => event.date === item.date && event.amount > 0))
    };
  }
  const shortDate = date => date.slice(5).split('-').map(Number).join('/');
  function menu() {
    const count = window.moneyMail.pendingCount();
    $('#menu-items').innerHTML = Object.entries(groups).map(([title, links]) => `<p class="menu-group-title">${title}</p>${links.map(label => `<button class="menu-link" data-route="${label}" ${route === label ? 'aria-current="page"' : ''}>${menuIcons[label] ? '<svg aria-hidden="true" viewBox="0 0 24 24">' + menuIcons[label] + '</svg>' : ''}<span class="menu-label">${label}</span>${label === 'メール確認' && count ? `<span class="menu-badge">${count}件</span>` : ''}</button>`).join('')}`).join('');
  }
  function banner() {
    if (state === 'offline') return '<p class="notice" role="status">オフライン · 保存待ち</p>';
    if (state === 'success') return '<p class="notice success" role="status">保存完了</p>';
    return '';
  }
  function blankState() {
    if (state === 'empty') return '<section class="sheet state-sheet"><h2>口座未登録</h2><button class="primary-button" data-detail="account">口座登録</button></section>';
    if (state === 'loading') return '<section class="sheet state-sheet" role="status" aria-busy="true"><h2>読込中</h2><div class="skeleton" aria-hidden="true"></div><div class="skeleton amount-placeholder" aria-hidden="true"></div></section>';
    if (state === 'error') return '<section class="sheet state-sheet" role="alert"><h2>読込エラー</h2><button class="primary-button" data-retry>再読込</button></section>';
    return '';
  }
  function render() {
    const data = fixture();
    const shortage = data.rows.find(row => row.balance < 0);
    const account = window.moneyOverview.primaryAccount();
    const blank = blankState();
    $('#balance-content').innerHTML = blank || `${banner()}
      <section class="sheet amount-sheet"><p class="date-label">${formatDate(useDeadline)}まで</p><p class="amount ${data.available < 0 ? 'negative' : ''}">${yen(data.available)}</p>${data.available < 0 ? note('支払い額と予備額を確保すると、' + yenText(data.available) + '不足する見込みです。') : ''}</section>
      <section class="sheet" data-calculation><h2 class="section-heading">金額の計算</h2>${note(formatDate(useDeadline) + 'までに使える額の目安です。' + formatDate(data.paymentDeadline) + 'までの支払い額と予備額は差し引いてあります。入金予定額は含みません。')}<dl class="ledger"><div><dt>口座残高</dt><dd>${yen(data.opening)}</dd></div>${data.payments.map(item => `<div><dt>${escape(item.name)} · ${shortDate(item.date)}</dt><dd>${yen(item.amount)}</dd></div>`).join('')}<div><dt>予備額</dt><dd>${yen(-data.reserve)}</dd></div><div class="ledger-total"><dt>計</dt><dd>${yen(data.available)}</dd></div></dl></section>
      <section class="sheet"><h2 class="section-heading">確認事項</h2><button class="check-row" data-detail="account"><span>口座残高<small>${account.verifiedDate ? '確認日 ' + shortDate(account.verifiedDate) : '銀行残高は未確認'}</small></span><span class="check-count">1口座 ›</span></button><button class="check-row" data-detail="bill"><span>請求額<small>12月分 · 見込み</small></span><span class="check-count">1件 ›</span></button><button class="check-row" data-route="メール確認"><span>メール</span><span class="check-count" data-mail-count>${window.moneyMail.pendingCount()}件 ›</span></button></section>`;
    $('#forecast-content').innerHTML = blank || `${banner()}
      <section class="sheet"><p class="date-label">${formatDate(startDate)}〜${formatDate(data.rows.at(-1).date)}</p><div class="forecast-head"><p id="forecast-event" class="support">11/9 · 現在の口座残高</p><strong id="forecast-amount">${yen(data.opening)}</strong></div>${chart(data.rows)}
      ${note('登録した入出金がすべて予定どおりに行われた場合の残高です。')}
      ${data.sameDayIncome ? note('引落日と入金日が同じ場合は、入金が引落に間に合うか確認してください。') : ''}
      ${shortage ? note(formatDate(shortage.date) + (shortage.debit ? 'の引落後、' : 'の時点で、') + '残高が' + yenText(shortage.balance) + '不足する見込みです。') : ''}</section>
      <section class="sheet"><h2 class="section-heading">入出金と残高</h2><div class="table-wrap"><table><thead><tr><th scope="col">日付 / 内容</th><th scope="col">入出金</th><th scope="col">残高</th></tr></thead><tbody>${data.rows.map(row => `<tr><td>${shortDate(row.date)}<br>${escape(row.name)}<small>${row.type}</small></td><td class="${row.amount > 0 ? 'income' : ''}">${row.amount ? (row.amount > 0 ? '+' : '') + yen(row.amount) : '—'}</td><td class="${row.balance < 0 ? 'negative' : ''}">${yen(row.balance)}</td></tr>`).join('')}</tbody></table></div></section>`;
    $('#announcement').textContent = $('#preview-state').selectedOptions[0].textContent;
    menu();
  }
  function chart(rows) {
    const values = rows.map(row => row.balance);
    const roughStep = Math.max(10000, Math.max(...values.map(Math.abs)) / 4);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const step = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= roughStep);
    const min = Math.floor(Math.min(0, ...values) / step) * step;
    const max = Math.max(step, Math.ceil(Math.max(0, ...values) / step) * step);
    const y = value => 202 - (value - min) / (max - min) * 182;
    const zero = y(0);
    const ticks = [];
    for (let value = min; value <= max; value += step) {
      ticks.push(`<line class="${value === 0 ? 'chart-zero' : 'chart-grid'}" x1="52" x2="334" y1="${y(value)}" y2="${y(value)}"/><text class="chart-label chart-tick" x="46" y="${y(value) + 3}" text-anchor="end">${value === 0 ? '0円' : (value < 0 ? '−' : '') + Math.abs(value / 10000) + '万円'}</text>`);
    }
    const bars = rows.map((row, i) => {
      const x = 52 + (i + .5) * 282 / rows.length;
      return `<rect class="chart-bar ${row.balance < 0 ? 'negative' : 'positive'}" data-bar="${i}" x="${x - 11}" y="${Math.min(zero, y(row.balance))}" width="${Math.min(22, 230 / rows.length)}" height="${Math.abs(y(row.balance) - zero)}" aria-label="${shortDate(row.date)} ${yen(row.balance)}"/><text class="chart-label" x="${x}" y="225" text-anchor="middle">${shortDate(row.date)}</text>`;
    });
    return `<svg class="forecast-chart" viewBox="0 0 340 240" role="img" aria-label="口座残高の棒グラフ">${ticks.join('')}${bars.join('')}</svg>`;
  }
  const routeKeys = { '資金繰り・試算': 'cashflow', '支払いの見通し': 'forecast', 'メール確認': 'mail', '予定': 'plans', '記録': 'records', '口座・カード': 'accounts', 'シフト・給与': 'shift', 'レシート': 'receipts', 'ふりかえり・ムダ支出': 'review', '定期支払い': 'recurring', '設定': 'settings' };
  function closeSidebar() { $('#sidebar').close(); }
  function applyRoute() {
    $('#toast').classList.remove('visible');
    const key = decodeURIComponent(location.hash.slice(1)) || 'cashflow';
    route = Object.keys(routeKeys).find(label => routeKeys[label] === key) || Object.values(groups).flat().find(label => label === key) || '資金繰り・試算';
    $('#screen-name').textContent = route;
    $('#page-title').textContent = route;
    for (const name of Object.values(routeKeys)) $('#' + name + '-screen').hidden = routeKeys[route] !== name;
    if (routeKeys[route] === 'mail') window.moneyMail.open();
    if (routeKeys[route] === 'plans') window.moneyPlans.open();
    window.moneyOverview[routeKeys[route]]?.();
    window.moneyExtras[routeKeys[route]]?.();
    closeSidebar(); menu();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function navigate(label) {
    const hash = '#' + encodeURIComponent(routeKeys[label] || label);
    if (location.hash !== hash) history.pushState(null, '', hash);
    applyRoute();
    $('#main').focus({ preventScroll: true });
  }
  function openDetail(kind) {
    const content = {
      account: ['口座残高', note(window.moneyOverview.balanceText(window.moneyOverview.primaryAccount()))],
      bill: ['請求額', '<dl class="ledger"><div><dt>12/10</dt><dd>¥120,000</dd></div><div><dt>状態</dt><dd>見込み</dd></div></dl>']
    };
    $('#detail-title').textContent = content[kind][0];
    $('#detail-body').innerHTML = content[kind][1];
    $('#detail-dialog').showModal();
    document.body.classList.add('modal-open');
  }
  $('#menu-open').addEventListener('click', () => { $('#sidebar').showModal(); $('#menu-open').setAttribute('aria-expanded', 'true'); document.body.classList.add('modal-open'); });
  $('#menu-close').addEventListener('click', closeSidebar);
  $('#sidebar').addEventListener('close', () => { $('#menu-open').setAttribute('aria-expanded', 'false'); document.body.classList.remove('modal-open'); });
  $('#detail-dialog').addEventListener('close', () => document.body.classList.remove('modal-open'));
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-route]'); if (link) navigate(link.dataset.route);
    const detail = event.target.closest('[data-detail]'); if (detail) openDetail(detail.dataset.detail);
    if (event.target.closest('[data-close-detail]')) $('#detail-dialog').close();
    if (event.target.closest('[data-retry]')) { state = 'normal'; $('#preview-state').value = state; render(); }
  });
  $('#preview-state').addEventListener('change', event => { state = event.target.value; render(); });
  window.addEventListener('hashchange', applyRoute);
  document.addEventListener('mail-change', () => {
    menu();
    const badge = $('[data-mail-count]');
    if (badge) badge.textContent = window.moneyMail.pendingCount() + '件 ›';
  });
  let toastTimer;
  document.addEventListener('money-toast', event => {
    const toast = $('#toast');
    clearTimeout(toastTimer);
    toast.textContent = event.detail;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  });
  document.addEventListener('preview-accounts-change', render);
  document.addEventListener('preview-plans-change', render);
  document.addEventListener('preview-settings-change', render);
  render(); applyRoute();
})();
