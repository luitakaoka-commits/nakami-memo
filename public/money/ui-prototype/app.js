/* UI-only fixture. No Firebase, Gmail, storage writes, or production engine. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const yen = amount => `${amount < 0 ? '−' : ''}¥${Math.abs(amount).toLocaleString('ja-JP')}`;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const groups = {
    'メイン': ['ホーム', '資金繰り・試算', '支払いの見通し', '予定', '記録', 'メール確認', '口座・カード', 'シフト・給与', 'レシート'],
    'サブ': ['ふりかえり・ムダ支出', '定期支払い', '設定', '家計・共有', 'バックアップ・復元']
  };
  let state = 'normal';
  let route = 'ホーム';
  let timer = null;
  let animationIndex = 0;
  const events = [
    { date: '11/9', name: '現在の口座残高', amount: 0, type: '現在' },
    { date: '11/10', name: 'カード引落', amount: -100000, type: '確認済み' },
    { date: '11/13', name: '給与', amount: 78000, type: '予定収入' },
    { date: '11/15', name: '生活費', amount: -20000, type: '見込み' },
    { date: '12/5', name: '仕送り', amount: 55000, type: '予定収入' },
    { date: '12/10', name: 'カード引落', amount: -120000, type: '見込み' }
  ];
  function fixture() {
    let balance = state === 'shortfall' ? 60000 : 180000;
    const opening = balance;
    const rows = events.map(event => ({ ...event, balance: balance += event.amount }));
    return { opening, rows, available: opening - 100000 - 20000 - 10000 };
  }
  function menu() {
    $('#menu-items').innerHTML = Object.entries(groups).map(([title, links]) => `<p class="menu-group-title">${title}</p>${links.map(label => `<button class="menu-link" data-route="${label}" ${route === label ? 'aria-current="page"' : ''}><span>${label}</span>${label === 'メール確認' ? '<span class="menu-badge">2件</span>' : ''}</button>`).join('')}`).join('');
  }
  function stopAnimation() {
    clearInterval(timer);
    timer = null;
    const play = $('#play-forecast');
    if (play) { play.textContent = '再生'; play.setAttribute('aria-pressed', 'false'); }
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
    stopAnimation();
    const data = fixture();
    const blank = blankState();
    $('#balance-content').innerHTML = blank || `${banner()}
      <section class="sheet amount-sheet"><p class="date-label">11月15日（日）まで</p><p class="amount ${data.available < 0 ? 'negative' : ''}">${yen(data.available)}</p>${data.available < 0 ? '<p class="notice">不足</p>' : ''}</section>
      <section class="sheet" data-calculation><h2 class="section-heading">金額の計算</h2><dl class="ledger"><div><dt>口座残高</dt><dd>${yen(data.opening)}</dd></div><div><dt>カード引落 · 11/10</dt><dd>−¥100,000</dd></div><div><dt>生活費 · 11/15まで</dt><dd>−¥20,000</dd></div><div><dt>予備額</dt><dd>−¥10,000</dd></div><div class="ledger-total"><dt>計</dt><dd>${yen(data.available)}</dd></div></dl></section>
      <section class="sheet"><h2 class="section-heading">確認事項</h2><button class="check-row" data-detail="account"><span>口座残高<small>確認日 11/8</small></span><span class="check-count">1口座 ›</span></button><button class="check-row" data-detail="bill"><span>請求額<small>12月分 · 見込み</small></span><span class="check-count">1件 ›</span></button><button class="check-row" data-detail="mail"><span>メール</span><span class="check-count">2件 ›</span></button></section>`;
    $('#cashflow-content').innerHTML = blank || banner() + $('#balance-content .amount-sheet').outerHTML + $('#balance-content [data-calculation]').outerHTML;
    $('#forecast-content').innerHTML = blank || `${banner()}
      <section class="sheet"><p class="date-label">11月9日〜12月10日</p><div class="forecast-head"><p id="forecast-event" class="support">11/9 · 現在の口座残高</p><strong id="forecast-amount">${yen(data.opening)}</strong></div>${chart(data.rows)}<div class="chart-legend"><span>＋ 給与・仕送り</span><span>− 引落・生活費</span></div><div class="play-row">${state === 'shortfall' ? '<span class="status danger">不足</span>' : ''}<button id="play-forecast" class="primary-button small-button" aria-pressed="false">再生</button></div></section>
      <section class="sheet"><h2 class="section-heading">入出金と残高</h2><div class="table-wrap"><table><thead><tr><th scope="col">日付 / 内容</th><th scope="col">入出金</th><th scope="col">残高</th></tr></thead><tbody>${data.rows.map((row, index) => `<tr data-event-row="${index}" ${index === 0 ? 'class="highlight"' : ''}><td>${row.date}<br>${row.name}<small>${row.type}</small></td><td class="${row.amount > 0 ? 'income' : ''}">${row.amount ? (row.amount > 0 ? '+' : '') + yen(row.amount) : '—'}</td><td class="${row.balance < 0 ? 'negative' : ''}">${yen(row.balance)}</td></tr>`).join('')}</tbody></table></div></section>`;
    if ($('#play-forecast')) $('#play-forecast').addEventListener('click', playAnimation);
    $('#announcement').textContent = $('#preview-state').selectedOptions[0].textContent;
    menu();
  }
  function points(rows) {
    const values = rows.map(row => row.balance);
    const min = Math.min(0, ...values);
    const max = Math.max(10000, ...values);
    return rows.map((row, i) => ({ x: 20 + i * 56, y: 130 - ((row.balance - min) / (max - min)) * 104 }));
  }
  function chart(rows) {
    const coordinates = points(rows);
    return `<svg class="forecast-chart" viewBox="0 0 320 164" role="img" aria-label="口座残高の推移"><path class="chart-grid" d="M20 26H300M20 78H300M20 130H300"/><polyline class="chart-line" points="${coordinates.map(p => `${p.x},${p.y}`).join(' ')}"/>${coordinates.map((p, i) => `<circle class="chart-point" cx="${p.x}" cy="${p.y}" r="4"/><text class="chart-label" x="${p.x}" y="153" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}">${rows[i].date}</text>`).join('')}<circle id="chart-cursor" class="chart-cursor" cx="${coordinates[0].x}" cy="${coordinates[0].y}" r="7"/></svg>`;
  }
  function showAnimationStep(index) {
    const rows = fixture().rows;
    const point = points(rows)[index];
    $('#forecast-event').textContent = `${rows[index].date} · ${rows[index].name}`;
    $('#forecast-amount').textContent = yen(rows[index].balance);
    $('#forecast-amount').classList.toggle('negative', rows[index].balance < 0);
    $('#chart-cursor').setAttribute('cx', point.x);
    $('#chart-cursor').setAttribute('cy', point.y);
    document.querySelectorAll('[data-event-row]').forEach((row, i) => row.classList.toggle('highlight', i === index));
  }
  function playAnimation() {
    if (timer) { stopAnimation(); return; }
    animationIndex = 0;
    showAnimationStep(0);
    if (reducedMotion.matches) { showAnimationStep(events.length - 1); $('#announcement').textContent = '動きを減らす設定のため、最後の予測残高を表示しました。'; return; }
    $('#play-forecast').textContent = '停止';
    $('#play-forecast').setAttribute('aria-pressed', 'true');
    timer = setInterval(() => { animationIndex++; showAnimationStep(animationIndex); if (animationIndex === events.length - 1) { stopAnimation(); $('#announcement').textContent = '残高推移の再生が完了しました。'; } }, 1000);
  }
  const routeKeys = { 'ホーム': 'home', '資金繰り・試算': 'cashflow', '支払いの見通し': 'forecast' };
  function closeSidebar() { $('#sidebar').close(); }
  function applyRoute() {
    stopAnimation();
    const key = decodeURIComponent(location.hash.slice(1)) || 'home';
    route = Object.keys(routeKeys).find(label => routeKeys[label] === key) || Object.values(groups).flat().find(label => label === key) || 'ホーム';
    $('#screen-name').textContent = route;
    $('#page-title').textContent = route === 'ホーム' ? '現残高 − 支払い' : route;
    for (const name of ['home', 'cashflow', 'forecast']) $('#' + name + '-screen').hidden = routeKeys[route] !== name;
    $('#pending-screen').hidden = Boolean(routeKeys[route]);
    closeSidebar(); menu();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function navigate(label) {
    location.hash = routeKeys[label] || label;
    applyRoute();
    $('#main').focus({ preventScroll: true });
  }
  function openDetail(kind) {
    const content = {
      account: ['口座残高', '<dl class="ledger"><div><dt>基準口座</dt><dd>' + yen(fixture().opening) + '</dd></div><div><dt>確認日</dt><dd>11/8</dd></div></dl>'],
      bill: ['請求額', '<dl class="ledger"><div><dt>12/10</dt><dd>¥120,000</dd></div><div><dt>状態</dt><dd>見込み</dd></div></dl>'],
      mail: ['メール', '<p>未確認 2件</p>']
    };
    $('#detail-title').textContent = content[kind][0];
    $('#detail-body').innerHTML = content[kind][1];
    $('#detail-dialog').showModal();
    document.body.classList.add('modal-open');
  }
  $('#menu-open').addEventListener('click', () => { stopAnimation(); $('#sidebar').showModal(); $('#menu-open').setAttribute('aria-expanded', 'true'); document.body.classList.add('modal-open'); });
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAnimation(); });
  reducedMotion.addEventListener('change', () => stopAnimation());
  render(); applyRoute();
})();
