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
  let currentSlide = 0;
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
    if (play) { play.textContent = '推移を再生'; play.setAttribute('aria-pressed', 'false'); }
  }
  function banner() {
    if (state === 'offline') return '<p class="notice" role="status">オフラインです。最後に読み込んだ表示を保持しています。変更は保存待ちです。</p>';
    if (state === 'success') return '<p class="notice success" role="status">保存しました。これは試作上の完了表示です。</p>';
    return '';
  }
  function blankState() {
    if (state === 'empty') return '<section class="sheet state-sheet"><h2>口座がまだありません</h2><p class="support">口座残高を登録すると、金額と支払いの見通しが表示されます。</p><button class="primary-button" data-detail="account">口座を登録する</button></section>';
    if (state === 'loading') return '<section class="sheet state-sheet" role="status" aria-busy="true"><h2>読み込んでいます</h2><div class="skeleton" aria-hidden="true"></div><div class="skeleton amount-placeholder" aria-hidden="true"></div><p class="support">口座と支払いを確認しています。</p></section>';
    if (state === 'error') return '<section class="sheet state-sheet" role="alert"><h2>データを読み込めませんでした</h2><p class="support">接続を確認して、もう一度お試しください。不明な金額を0円として表示しません。</p><button class="primary-button" data-retry>もう一度読み込む</button></section>';
    return '';
  }
  function render() {
    stopAnimation();
    const data = fixture();
    const blank = blankState();
    $('#balance-content').innerHTML = blank || `${banner()}
      <section class="sheet amount-sheet"><p class="date-label">11月15日（日）まで</p><h2>支払いを引いた残り</h2><p class="amount ${data.available < 0 ? 'negative' : ''}">${yen(data.available)}</p><p class="support">基準口座から、期限内の支払いと予備額を引いた金額。予定の給与・仕送りは含めません。</p>${data.available < 0 ? '<p class="notice">登録済みの支払いに対して不足の見込みです。今すぐ全額を支払う意味ではありません。</p>' : ''}</section>
      <section class="sheet"><h2 class="section-heading">金額の計算</h2><dl class="ledger"><div><dt>現在の口座残高</dt><dd>${yen(data.opening)}</dd></div><div><dt>カード引落 · 11/10</dt><dd>−¥100,000</dd></div><div><dt>生活費 · 11/15まで</dt><dd>−¥20,000</dd></div><div><dt>残しておく予備額</dt><dd>−¥10,000</dd></div><div class="ledger-total"><dt>支払いを引いた残り</dt><dd>${yen(data.available)}</dd></div></dl><button class="text-button" data-detail="formula">計算条件を見る →</button></section>
      <section class="sheet"><h2 class="section-heading">確認事項</h2><button class="check-row" data-detail="account"><span>口座残高<small>最後の確認は11月8日</small></span><span class="check-count">1口座 ›</span></button><button class="check-row" data-detail="bill"><span>カードの請求額<small>12月分はまだ見込みです</small></span><span class="check-count">1件 ›</span></button><button class="check-row" data-detail="mail"><span>メール取り込み<small>カード・金額・利用日を確認</small></span><span class="check-count">2件 ›</span></button></section>`;
    $('#forecast-content').innerHTML = blank || `${banner()}
      <section class="sheet"><p class="date-label">11月9日〜12月10日</p><h2 class="section-heading">引落後、いくら残る？</h2><div class="forecast-head"><p id="forecast-event" class="support">11/9 · 現在の口座残高</p><strong id="forecast-amount">${yen(data.opening)}</strong></div>${chart(data.rows)}<div class="chart-legend"><span>＋ 給与・仕送り</span><span>− 引落・生活費</span></div><div class="play-row"><span class="status ${state === 'shortfall' ? 'danger' : ''}">${state === 'shortfall' ? '不足の見込み' : '予定収入を含む予測'}</span><button id="play-forecast" class="primary-button small-button" aria-pressed="false">推移を再生</button></div><p class="support" style="margin-top:12px">予定の給与・仕送りを含みます。入金や請求額が変わると、残高も変わります。</p></section>
      <section class="sheet"><h2 class="section-heading">入出金と残高</h2><div class="table-wrap"><table><thead><tr><th scope="col">日付 / 内容</th><th scope="col">入出金</th><th scope="col">残高</th></tr></thead><tbody>${data.rows.map((row, index) => `<tr data-event-row="${index}" ${index === 0 ? 'class="highlight"' : ''}><td>${row.date}<br>${row.name}<small>${row.type}</small></td><td class="${row.amount > 0 ? 'income' : ''}">${row.amount ? (row.amount > 0 ? '+' : '') + yen(row.amount) : '—'}</td><td class="${row.balance < 0 ? 'negative' : ''}">${yen(row.balance)}</td></tr>`).join('')}</tbody></table></div><p class="support">この表にない支払いは含みません。予備額は支払いではないため、残高からは引いていません。</p></section>`;
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
    return `<svg class="forecast-chart" viewBox="0 0 320 164" role="img" aria-label="予定の給与・仕送りと支払いを含めた口座残高の推移。各日付の金額は下の表に記載しています。"><path class="chart-grid" d="M20 26H300M20 78H300M20 130H300"/><polyline class="chart-line" points="${coordinates.map(p => `${p.x},${p.y}`).join(' ')}"/>${coordinates.map((p, i) => `<circle class="chart-point" cx="${p.x}" cy="${p.y}" r="4"/><text class="chart-label" x="${p.x}" y="153" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}">${rows[i].date}</text>`).join('')}<circle id="chart-cursor" class="chart-cursor" cx="${coordinates[0].x}" cy="${coordinates[0].y}" r="7"/></svg>`;
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
    $('#play-forecast').textContent = '停止する';
    $('#play-forecast').setAttribute('aria-pressed', 'true');
    timer = setInterval(() => { animationIndex++; showAnimationStep(animationIndex); if (animationIndex === events.length - 1) { stopAnimation(); $('#announcement').textContent = '残高推移の再生が完了しました。'; } }, 1000);
  }
  function syncSlide() {
    if (!$('#carousel').clientWidth) return;
    const next = Math.round($('#carousel').scrollLeft / $('#carousel').clientWidth);
    if (next !== currentSlide) stopAnimation();
    currentSlide = next;
    $('#slide-title').textContent = currentSlide === 0 ? '現残高 − 支払い' : '残高の見通し';
    $('#page-number').textContent = `${currentSlide + 1} / 2`;
    document.querySelectorAll('[data-slide]').forEach((button, index) => { button.classList.toggle('active', index === currentSlide); if (index === currentSlide) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    document.querySelectorAll('.slide').forEach((slide, index) => { slide.inert = index !== currentSlide; });
    $('#carousel').style.height = `${document.querySelectorAll('.slide')[currentSlide].offsetHeight}px`;
  }
  function goSlide(index, smooth = true) {
    $('#carousel').scrollTo({ left: index * $('#carousel').clientWidth, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'instant' });
    if (!smooth || reducedMotion.matches) syncSlide();
  }
  function closeSidebar() { $('#sidebar').close(); }
  function navigate(label) {
    route = label === '支払いの見通し' || label === '資金繰り・試算' ? 'ホーム' : label;
    $('#screen-name').textContent = route;
    $('#home-screen').hidden = route !== 'ホーム';
    $('#pending-screen').hidden = route === 'ホーム';
    $('#pending-title').textContent = route;
    closeSidebar(); menu();
    if (route === 'ホーム') goSlide(label === '支払いの見通し' ? 1 : 0, false);
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#main').focus({ preventScroll: true });
  }
  function openDetail(kind) {
    const content = {
      formula: ['計算条件', '<p>対象は11月15日まで。この試作では、現在の残高からカード引落・生活費・予備額を引いています。</p><p>給与78,000円と仕送り55,000円は、ホームの金額には足さず「残高の見通し」に含めます。</p><p class="support">金額・期間は配置確認用の架空データです。本番の計算方法を変更するものではありません。</p>'],
      account: ['口座残高を確認', '<p><strong>基準口座 · 架空の口座</strong></p><p>銀行明細で残高と確認日を記録する画面につながります。</p><p class="support">入力・保存フォームは、次の段階で作成します。現在は保存されません。</p>'],
      bill: ['請求額を確認', '<p><strong>12月10日 · カード引落</strong></p><p>見込み120,000円。カード会社の請求総額と照合して確定する画面につながります。</p><p class="support">確認しただけでは、口座残高を減らしません。</p>'],
      mail: ['メールを確認', '<p><strong>未確認 2件</strong></p><p>対象カード・金額・利用日時を確認してから取り込む画面につながります。</p><p class="support">この試作はGmailに接続していません。実際のメールではありません。</p>']
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
    const slide = event.target.closest('[data-slide]'); if (slide) goSlide(Number(slide.dataset.slide));
    const link = event.target.closest('[data-route]'); if (link) navigate(link.dataset.route);
    const detail = event.target.closest('[data-detail]'); if (detail) openDetail(detail.dataset.detail);
    if (event.target.closest('[data-close-detail]')) $('#detail-dialog').close();
    if (event.target.closest('[data-retry]')) { state = 'normal'; $('#preview-state').value = state; render(); }
  });
  $('#preview-state').addEventListener('change', event => { state = event.target.value; render(); syncSlide(); });
  $('#carousel').addEventListener('scroll', syncSlide, { passive: true });
  $('#carousel').addEventListener('keydown', event => { if (event.target !== $('#carousel')) return; if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); goSlide(event.key === 'ArrowRight' ? 1 : 0); } });
  let carouselWidth = $('#carousel').clientWidth;
  const resize = new ResizeObserver(() => {
    const width = $('#carousel').clientWidth;
    if (!width) return;
    if (width !== carouselWidth) { carouselWidth = width; goSlide(currentSlide, false); }
  });
  resize.observe($('#carousel'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAnimation(); });
  reducedMotion.addEventListener('change', () => stopAnimation());
  render(); syncSlide();
})();
