(() => {
  'use strict';
  const concepts = window.DESIGN_CONCEPTS;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const groups = {
    money: { name: 'お金管理', kicker: 'MONEY / 5 CONCEPTS', title: 'お金に向き合う、5つの佇まい。', note: '重厚さの中に、金額の読みやすさを。' },
    home: { name: 'なかみメモ', kicker: 'HOME / 5 CONCEPTS', title: 'わが家をひらく、5つの楽しみ。', note: '探すことも、しまうことも、ちょっと楽しく。' },
    recipe: { name: 'つくりおきノート', kicker: 'KITCHEN / 5 CONCEPTS', title: 'また作りたくなる、5つの台所。', note: '料理の楽しさと、手元での使いやすさを。' }
  };
  const paths = {
    bank: '<path d="m3 9 9-6 9 6M4 10h16M6 10v9m6-9v9m6-9v9M3 21h18"/>',
    home: '<path d="m3 10 9-7 9 7v10H5V10m5 10v-7h5v7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    record: '<path d="M7 4h13v17H4V4h3m2-2h6v4H9ZM8 11h8m-8 5h8"/>',
    wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m0 4h-5v4h5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 11h18"/>',
    box: '<path d="m3 7 9-4 9 4-9 4ZM3 7v11l9 4 9-4V7M12 11v11"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    cook: '<path d="M7 12a4 4 0 0 1-2-7 4 4 0 0 1 7-1 4 4 0 0 1 7 1 4 4 0 0 1-2 7v8H7Zm0 4h10"/>',
    list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
    bag: '<path d="M5 7h14l2 14H3ZM8 8V6a4 4 0 0 1 8 0v2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    leaf: '<path d="M20 3c-9-1-16 3-15 10 1 7 14 7 15-10ZM4 21 16 8"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
  const plate = (kind = 'plate') => `<svg class="food-art ${kind}" viewBox="0 0 320 182" aria-hidden="true"><ellipse cx="160" cy="158" rx="104" ry="9" class="food-shadow"/><ellipse cx="160" cy="95" rx="118" ry="70" class="food-plate"/><ellipse cx="160" cy="94" rx="100" ry="56" class="food-rim"/><g class="food-chicken"><path d="M101 62c14-20 55-25 67-8 20-14 50 6 44 24 22 13 8 40-8 41-9 20-46 19-59 7-25 10-61-6-53-26-16-14-10-31 9-38Z"/><path d="m113 66 32 55m-13-67 33 76m-11-78 34 75m-14-69 26 47"/></g><g class="food-tomato"><circle cx="211" cy="114" r="15"/><circle cx="225" cy="100" r="12"/><path d="m205 103 7 4 4-7m3-7 7 2 3-6"/></g><g class="food-leaves"><path d="M76 89c-21-30 4-36 16-10-7-32 23-28 16 0 23-18 31 7 0 18-14 27-37 16-20-3-25 7-34-9-12-5Z"/><path d="m90 97 8-28m-7 14-11-6m12 14 13-8"/></g><g class="steam"><path d="M143 37c-13-15 11-19 0-33M163 31c-13-15 11-19 0-30M183 36c-13-15 11-19 0-30"/></g></svg>`;
  const jars = () => `<svg class="jar-art" viewBox="0 0 300 132" aria-hidden="true"><path class="shelf-line" d="M12 117h276"/><g class="jar one"><rect x="35" y="35" width="47" height="78" rx="9"/><path d="M40 34v-8h37v8"/><rect class="jar-label" x="41" y="60" width="35" height="28" rx="2"/><path d="M55 67v14m-7-7h14"/></g><g class="jar two"><rect x="112" y="48" width="58" height="65" rx="9"/><path d="M118 47V35h45v12"/><rect class="jar-label" x="122" y="63" width="37" height="32" rx="4"/><path d="m132 80 6 6 11-14"/></g><g class="jar three"><rect x="200" y="26" width="43" height="87" rx="5"/><path d="M205 25V13h33v12"/><rect class="jar-label" x="204" y="56" width="35" height="34" rx="2"/><path d="M215 66h14m-14 7h14m-14 7h9"/></g></svg>`;
  const house = () => `<svg class="house-art" viewBox="0 0 320 185" aria-hidden="true"><g class="cloud"><path d="M234 34c-2-15 20-22 29-10 18-8 28 15 10 19h-39c-13-1-13-15 0-16"/></g><path class="ground-line" d="M20 173h280"/><path class="house-roof" d="m51 79 109-64 109 64-7 9-102-58L58 88Z"/><path class="house-wall" d="M65 82 160 30l95 52v89H65Z"/><path class="house-divider" d="M160 56v115M65 112h190"/><rect class="room-warm" x="75" y="119" width="76" height="46" rx="3"/><rect class="room-cool" x="169" y="119" width="76" height="46" rx="3"/><rect class="attic-window" x="143" y="62" width="34" height="35" rx="17"/><path class="window-cross" d="M160 63v32m-16-16h32"/><g class="furniture"><path d="M82 139h60v22H82Zm3-9h25v9m6-6h17v6m-22 0v22"/><path d="M181 143h48v15h-48Zm4-7h40v7m-40 15v6m40-6v6"/></g><g class="plant"><path d="M39 173v-32m0 13c-20-1-21-20-4-18m4 10c22-2 22-21 3-19"/><path d="M26 161h26l-4 12H30Z"/></g></svg>`;
  const chart = () => `<svg class="chart" viewBox="0 0 300 93" aria-label="残高推移のサンプル"><path class="chart-grid" d="M0 15h300M0 45h300M0 75h300M50 0v90M150 0v90M250 0v90"/><path class="chart-line" pathLength="1" d="M0 22h37l0 17h45l0-10h34l0 31h53l0-16h39l0 30h38l0-14h54"/><circle cx="299" cy="60" r="3"/></svg>`;
  const numbers = () => `<p class="balance-label">安心して使える額</p><div class="amount"><span>¥</span>48,620</div><p class="balance-caption">次の支払いと貯金を確保したあと</p>`;
  const financialRows = () => `<div class="money-rows"><div><span>次の支払い</span><b>¥56,000</b></div><div><span>貯金・NISA</span><b>¥40,000</b></div><div><span>最低維持残高</span><b>¥12,820</b></div></div>`;
  const stock = () => `<div class="stock-list"><div><span class="stock-icon">${icon('box')}</span><span><b>たまご</b><small>冷蔵庫 · あと3日</small></span><strong>6<small> 個</small></strong></div><div><span class="stock-icon">${icon('box')}</span><span><b>牛乳</b><small>冷蔵庫 · あと2日</small></span><strong>500<small> mL</small></strong></div></div>`;
  const effectButton = (c) => `<button class="demo-primary" type="button" data-action="effect" aria-expanded="false"><span>${c.action}</span>${icon('arrow')}</button>`;
  const recipeBadge = () => `<div class="cooked-badge">${icon('check')} 作りました<span>10 / 19</span></div>`;
  function money(c) {
    const heading = `<div class="app-heading"><span>${icon('bank')}お金管理</span><small>10月の家計</small></div>`;
    let body;
    if (c.id === 'M1') body = `<div class="vault-plaque"><div class="vault-top"><span>HOUSEHOLD RESERVE</span>${icon('bank')}</div>${numbers()}<div class="vault-rule"></div><div class="vault-bottom"><span>今月の収入予定</span><b>¥182,000</b></div></div><div class="mini-section"><span>直近の予定</span><b>25日　給料日</b></div>`;
    if (c.id === 'M2') body = `<div class="ledger-heading"><span>家計帳</span><small>令和八年 十月</small></div><div class="ledger-balance">${numbers()}</div><div class="ledger-lines"><div><span>10.19</span><b>食料品</b><span>− ¥2,180</span></div><div><span>10.18</span><b>日用品</b><span>− ¥860</span></div></div><div class="ledger-stamp" aria-hidden="true">確認</div>`;
    if (c.id === 'M3') body = `<div class="terminal-caption"><span class="status-dot"></span>家計の見通し<span>JPY</span></div><div class="terminal-balance">${numbers()}</div><div class="chart-wrap">${chart()}<div class="chart-axis"><span>今日</span><span>次の給料日前</span></div></div><div class="terminal-ticks"><span>支給予定日</span><b>10 / 25</b><span>給料見込み</span><b>¥182,000</b></div>`;
    if (c.id === 'M4') body = `<div class="platinum-main"><div>${numbers()}</div><div class="reserve-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-track" cx="60" cy="60" r="48"/><circle class="ring-fill" cx="60" cy="60" r="48" pathLength="100"/></svg><span>確保済み<b>69<span>%</span></b></span></div></div><div class="platinum-total"><span>現在の残高合計</span><b>¥157,440</b></div><div class="platinum-split"><span><i></i>使える額</span><span><i></i>確保した額</span></div>`;
    if (c.id === 'M5') body = `<div class="book-page"><div class="book-tab">十月</div><div class="book-eyebrow">わたしの家計手帳</div>${numbers()}<div class="book-entry"><span>収入の予定</span><b>¥182,000</b></div><div class="book-entry"><span>次の給料日</span><b>10月25日</b></div><span class="page-number">— 10 —</span></div>`;
    return heading + body + `<div class="detail-reveal">${financialRows()}</div>`;
  }
  function home(c) {
    let body;
    if (c.id === 'N1') body = `<div class="home-welcome"><small>今日も、おかえりなさい。</small><h3>わが家のなかみ</h3></div><div class="house-scene">${house()}<button class="room-hit kitchen" type="button" data-action="room" data-room="kitchen" aria-label="キッチンの在庫をみる"></button><button class="room-hit living" type="button" data-action="room" data-room="living" aria-label="リビングの在庫をみる"></button></div><div class="room-labels"><span>キッチン</span><span>リビング</span></div>`;
    if (c.id === 'N2') body = `<div class="home-welcome"><small>ひとつずつ、しまう楽しみ。</small><h3>わが家のストック棚</h3></div><div class="cupboard"><div class="cupboard-inside">${jars()}<span>ストックが、ここに。</span></div><button class="cabinet-door left" data-action="effect" type="button" aria-label="食器棚の扉をあける"><span>食品の棚</span><i></i></button><button class="cabinet-door right" data-action="effect" type="button" aria-label="食器棚の扉をあける"><span>日用品の棚</span><i></i></button></div>`;
    if (c.id === 'N3') body = `<div class="home-welcome"><small>暮らしを、上からひと目で。</small><h3>わが家の間取り</h3></div><div class="floorplan"><button class="floor-room floor-kitchen" data-action="room" data-room="kitchen" type="button">${icon('cook')}<b>キッチン</b><small>24 アイテム</small></button><button class="floor-room floor-living" data-action="room" data-room="living" type="button">${icon('home')}<b>リビング</b><small>18 アイテム</small></button><button class="floor-room floor-bath" data-action="room" data-room="bath" type="button">${icon('box')}<b>洗面所</b><small>12 アイテム</small></button><span class="floor-entry">玄関</span></div>`;
    if (c.id === 'N4') body = `<div class="journal-page"><span class="tape" aria-hidden="true"></span><p class="journal-date">10月19日　月曜日</p><h3>今日の、家のこと。</h3><p>なくなる前に、気づけるといいね。</p><div class="journal-summary"><span><b>54</b> モノ</span><span><b>4</b> 保管場所</span></div><div class="journal-note"><small>先に使いたいもの</small><span>たまご、牛乳。</span><i aria-hidden="true">✓</i></div></div>`;
    if (c.id === 'N5') body = `<div class="home-welcome"><small>家の灯りが、待っています。</small><h3>おかえり、わが家。</h3></div><div class="night-window"><div class="window-stars" aria-hidden="true">＋ ·　　✦　 ·</div><div class="window-inside">${jars()}</div><button class="curtain curtain-left" type="button" data-action="effect" aria-label="左のカーテンをあける"></button><button class="curtain curtain-right" type="button" data-action="effect" aria-label="右のカーテンをあける"></button><div class="window-cross" aria-hidden="true"></div><span class="window-sill" aria-hidden="true"></span></div>`;
    const overview = c.id === 'N4' ? '' : `<div class="home-counts"><span><b>54</b> モノ</span><span><b>4</b> 保管場所</span><span><b>2</b> 期限間近</span></div>`;
    return `<div class="app-heading"><span>${icon('home')}なかみメモ</span><small>わが家</small></div>` + body + overview + `<div class="inventory-caption"><b data-stock-title>先に使いたいもの</b><small>冷蔵庫</small></div><div class="stock-wrap">${stock()}</div>`;
  }
  function recipe(c) {
    const name = `<h3>鶏もも肉の<br>香ばし照り焼き</h3>`;
    const meta = `<div class="recipe-meta"><span>${icon('clock')}15分</span><span>主菜</span><span>2人分</span></div>`;
    let body;
    if (c.id === 'R1') body = `<div class="bistro-stripe"></div><div class="bistro-title"><small>わが家のビストロ</small><h3>本日のつくりおき</h3><span>RECIPES FOR EVERYDAY</span></div><div class="bistro-dish">${plate()}</div><div class="recipe-name">${name}${meta}</div>`;
    if (c.id === 'R2') body = `<div class="herb-heading"><span>${icon('leaf')}</span><h3>台所から、ひと皿。</h3><small>今日も、食材をおいしく。</small></div><div class="herb-dish">${plate()}</div><div class="recipe-name">${name}${meta}</div><div class="herb-ingredients"><span>鶏もも肉</span><span>しょうゆ</span><span>みりん</span></div>`;
    if (c.id === 'R3') body = `<div class="chef-heading"><small>RECIPE / 01</small><span>主菜</span></div><div class="chef-dish">${plate()}</div><div class="recipe-name">${name}${meta}</div><div class="chef-steps"><span>下ごしらえ</span><i></i><span>焼く</span><i></i><span>仕上げ</span></div>`;
    if (c.id === 'R4') body = `<div class="enamel-heading"><h3>きょうの作り置き</h3><small>おいしさを、明日の自分にも。</small></div><div class="enamel-grid"><div class="enamel-dish main-dish">${plate('bento')}<span>主菜</span></div><div class="enamel-dish side-dish"><svg viewBox="0 0 90 90" aria-hidden="true"><g class="vegetable"><ellipse cx="35" cy="38" rx="11" ry="23" transform="rotate(-40 35 38)"/><ellipse cx="57" cy="51" rx="11" ry="24" transform="rotate(35 57 51)"/><ellipse cx="34" cy="65" rx="12" ry="20" transform="rotate(40 34 65)"/></g></svg><span>副菜</span></div></div><div class="recipe-name">${name}${meta}</div>`;
    if (c.id === 'R5') body = `<div class="cookbook-page"><div class="cookbook-index">主菜</div><small class="cookbook-kicker">いつもの料理帖</small>${name}<div class="cookbook-dish">${plate()}</div>${meta}<div class="cookbook-ingredients"><b>材料</b><span>鶏もも肉、しょうゆ、みりん</span></div><span class="page-number">— 01 —</span></div>`;
    return `<div class="app-heading"><span>${icon('cook')}つくりおきノート</span><small>レシピ</small></div>` + body + recipeBadge();
  }
  const navs = {
    money: [['home','ホーム'],['calendar','予定'],['record','記録'],['wallet','口座'],['clock','シフト']],
    home: [['home','ホーム'],['box','保管場所'],['plus','追加'],['search','検索'],['cook','レシピ']],
    recipe: [['cook','レシピ'],['calendar','献立'],['bag','買い物'],['list','設定']]
  };
  function screen(c, _context) {
    return `<section class="screen theme-${c.theme}" data-concept="${c.id}" data-view="0" aria-label="${c.name}の操作できる見本"><div class="sample-ribbon">デザイン見本 <span>サンプルデータ</span></div><div class="screen-body"><div class="screen-home">${({money,home,recipe}[c.app])(c)}</div><div class="subview" hidden></div></div><div class="screen-effect">${effectButton(c)}</div><p class="screen-notice" role="status" aria-live="polite"></p><nav class="screen-nav" aria-label="${c.name}の見本メニュー">${navs[c.app].map(([i,n],v) => `<button type="button" data-action="nav" data-nav="${v}" aria-pressed="${v===0}" aria-label="${n}の見本を開く">${icon(i)}<span>${n}</span></button>`).join('')}</nav></section>`;
  }
  let app = 'money';
  let picks = {};
  const storageKey = 'kurashi-design-proposals-v1';
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value && typeof value === 'object') picks = value; } catch { /* Private browsing still supports the gallery. */ }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.dataset.motion = reduced ? 'off' : 'on';
  function motionButton() { const on = document.body.dataset.motion === 'on'; $('#motion-toggle').setAttribute('aria-pressed', String(on)); $('#motion-toggle span:last-child').textContent = `動き：${on ? 'オン' : 'オフ'}`; }
  function candidateButton(c) { return `<button class="candidate-button" type="button" data-action="pick" data-id="${c.id}" aria-pressed="${picks[c.app]===c.id}">${icon('check')}<span>${picks[c.app]===c.id ? 'この案を選択中' : 'この案を候補に'}</span></button>`; }
  function render() {
    const g = groups[app];
    $$('.app-tabs button').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.app===app)); b.tabIndex = b.dataset.app===app ? 0 : -1; });
    $('#gallery-panel').setAttribute('aria-labelledby', `tab-${app}`);
    $('#section-kicker').textContent = g.kicker; $('#section-title').textContent = g.title; $('#section-note').textContent = g.note;
    $('#gallery').innerHTML = concepts.filter(c => c.app===app).map(c => `<article class="concept" data-card="${c.id}"><div class="concept-header"><span class="concept-id">${c.id}</span><span class="concept-en">${c.en}</span>${c.recommended ? '<span class="recommend">まず見たい案</span>' : ''}</div>${screen(c,'card')}<div class="concept-description"><div class="concept-name"><h3>${c.name}</h3><div class="palette" aria-label="配色：${c.colors.join('、')}">${c.colors.map(color=>`<i style="--swatch:${color}"></i>`).join('')}</div></div><p class="concept-lead">${c.lead}</p><p class="concept-motion">${icon(c.app==='money'?'bank':c.app==='home'?'home':'cook')}<span>${c.motion}</span></p><div class="concept-actions"><button class="expand-button" type="button" data-action="expand" data-id="${c.id}">大きく見る <span aria-hidden="true">↗</span></button>${candidateButton(c)}</div></div></article>`).join('');
    updatePicks();
  }
  function updatePicks() {
    const valid = Object.keys(groups).map(key => concepts.find(c => c.id===picks[key] && c.app===key));
    $('#selected-count').textContent = valid.filter(Boolean).length;
    $('#selection-list').innerHTML = Object.keys(groups).map((key,i) => `<div><span>${groups[key].name}</span><b>${valid[i] ? `${valid[i].id}　${valid[i].name}` : 'まだ選んでいません'}</b>${valid[i] ? `<button type="button" data-action="expand" data-id="${valid[i].id}" aria-label="${valid[i].name}を見直す">見直す ↗</button>` : '<small>上の案から選んでください</small>'}</div>`).join('');
    $$('[data-action="pick"]').forEach(b => { const c = concepts.find(v=>v.id===b.dataset.id); const selected = picks[c.app]===c.id; b.setAttribute('aria-pressed', String(selected)); $('span',b).textContent = selected?'この案を選択中':'この案を候補に'; });
    $('#copy-selection').disabled = !valid.some(Boolean);
  }
  function showDetail(c) {
    $('#detail-body').innerHTML = `<div class="detail-copy"><p class="eyebrow">${c.id} / ${groups[c.app].name}</p><h2 id="detail-title">${c.name}</h2><p class="detail-lead">${c.lead}</p><p>${c.description}</p><dl><div><dt>雰囲気</dt><dd>${c.mood}</dd></div><div><dt>文字</dt><dd>${c.font}</dd></div><div><dt>動き</dt><dd>${c.motion}</dd></div></dl><p class="detail-hint">右の見本のボタンや下のタブを押してみてください。スマホでは見本が下に表示されます。</p>${candidateButton(c)}<p class="small">配色だけ、動きだけを他の案と組み合わせることもできます。</p></div><div class="detail-preview">${screen(c,'detail')}</div>`;
    if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  }
  function playEffect(s) {
    const c = concepts.find(v=>v.id===s.dataset.concept);
    const played = !s.classList.contains('is-played'); s.classList.toggle('is-played',played);
    const primary = $('.demo-primary',s); primary.setAttribute('aria-expanded',String(played)); $('span',primary).textContent = played?c.done:c.action;
    $('.screen-notice',s).textContent = played ? c.result : '見本の表示をもとに戻しました。';
    if(c.app==='home') $('[data-stock-title]',s).textContent = played?'キッチンのなかみ':'先に使いたいもの';
    if(c.app==='home' && !played) $('.stock-wrap',s).innerHTML = stock();
    if(played && c.app!=='home') setTimeout(()=>{ if(s.isConnected) { const body=$('.screen-body',s); body.scrollTo({top:body.scrollHeight,behavior:document.body.dataset.motion==='on'&&!reduced?'smooth':'instant'}); } },document.body.dataset.motion==='on'&&!reduced?480:0);
  }
  function openNav(s, n) {
    const c = concepts.find(v=>v.id===s.dataset.concept);
    s.dataset.view = n;
    $$('.screen-nav button',s).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.nav===n)));
    $('.screen-home',s).hidden = n !== '0'; $('.subview',s).hidden = n === '0';
    $('.screen-effect',s).hidden = n !== '0';
    $('.screen-body',s).scrollTop = 0;
    $('.screen-notice',s).textContent = '';
    if(n === '0') return;
    const label = navs[c.app][Number(n)][1];
    const pages = c.app==='money' ? {
      '1': '<div class="sample-row"><span>10月25日　給料日</span><b>¥182,000</b></div><div class="sample-row"><span>10月27日　カード引落</span><b>¥56,000</b></div>',
      '2': '<div class="sample-segments" role="group" aria-label="記録の見本"><button type="button" data-action="filter" data-filter="未確認" aria-pressed="true">未確認</button><button type="button" data-action="filter" data-filter="確認済み" aria-pressed="false">確認済み</button></div><p class="filter-result">未確認のレシート · 2件</p><div class="sample-row"><span>10月19日　食料品</span><b>¥2,180</b></div><div class="sample-row"><span>10月18日　日用品</span><b>¥860</b></div>',
      '3': '<div class="sample-row"><span>生活用の口座</span><b>¥127,440</b></div><div class="sample-row"><span>現金</span><b>¥30,000</b></div>',
      '4': '<p class="subview-note">10月支給分</p><div class="sample-row"><span>シフトからの見込み</span><b>¥182,000</b></div><p class="subview-note">支給額を確定したら、ここにも反映。</p>'
    } : c.app==='home' ? {
      '1': '<div class="sample-row"><span>キッチン / 冷蔵庫</span><b>24</b></div><div class="sample-row"><span>リビング / 棚</span><b>18</b></div>',
      '2': '<label class="sample-field">モノの名前<input placeholder="例：牛乳" aria-label="追加するモノの名前（見本）"></label><label class="sample-field">保管場所<select aria-label="保管場所（見本）"><option>冷蔵庫</option><option>ストック棚</option></select></label><p class="subview-note">入力の見え方を試せます。保存はしません。</p>',
      '3': '<label class="sample-field">家のなかを探す<input placeholder="たまご・冷蔵庫など" aria-label="家のなかを検索（見本）" data-search="true"></label><div class="search-results">'+stock()+'</div>',
      '4': '<p class="subview-note">家にある食材から</p><div class="sample-row"><span>たまごと牛乳のオムレツ</span>'+icon('cook')+'</div><p class="subview-note">レシピ提案画面の見本です。</p>'
    } : {
      '1': '<p class="subview-note">10月19日　晩ごはん</p><div class="sample-row"><span>鶏もも肉の照り焼き</span><b>主菜</b></div><div class="sample-row"><span>ほうれん草のおひたし</span><b>副菜</b></div>',
      '2': '<p class="subview-note">家にあるものは、買う前に確認。</p><label class="ingredient-check"><input type="checkbox"> 鶏もも肉</label><label class="ingredient-check"><input type="checkbox"> ほうれん草</label><p class="pantry-note">牛乳は家にまだあります · 500 mL</p>',
      '3': '<h4>画面の雰囲気</h4><p class="subview-note">この見本では、各案の配色・文字・操作感を比べられます。</p><p class="subview-note">動きはページ上部で停止できます。</p>'
    };
    $('.subview',s).innerHTML = `<div class="subview-heading">${icon(navs[c.app][Number(n)][0])}<h3>${label}</h3></div>${pages[n]}<button class="demo-secondary" type="button" data-action="back">最初の見本にもどる</button>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    if(b.dataset.app) { app=b.dataset.app; render(); return; }
    if(b.id==='motion-toggle') { document.body.dataset.motion = document.body.dataset.motion==='on'?'off':'on'; motionButton(); return; }
    if(b.id==='close-dialog') { $('#detail-dialog').close(); return; }
    const action = b.dataset.action;
    if(action==='pick') { const c=concepts.find(v=>v.id===b.dataset.id); if(picks[c.app]===c.id) delete picks[c.app]; else picks[c.app]=c.id; try { localStorage.setItem(storageKey,JSON.stringify(picks)); } catch { /* Selection still works for this visit. */ } updatePicks(); $('#copy-status').textContent=''; return; }
    if(action==='expand') { showDetail(concepts.find(c=>c.id===b.dataset.id)); return; }
    const s = b.closest('.screen');
    if(action==='effect') playEffect(s);
    if(action==='room') { if(!s.classList.contains('is-played')) playEffect(s); const labels={kitchen:'キッチン',living:'リビング',bath:'洗面所'}; const label=labels[b.dataset.room]; $('[data-stock-title]',s).textContent = `${label}のなかみ`; $('.stock-wrap',s).innerHTML=b.dataset.room==='kitchen'?stock():`<div class="sample-row"><span>${b.dataset.room==='living'?'ティッシュ':'ハンドソープ'}</span><b>${b.dataset.room==='living'?'2 箱':'300 mL'}</b></div>`; $('.screen-notice',s).textContent=`${label}のモノを表示しました。`; $$('.floor-room',s).forEach(v=>v.classList.toggle('selected',v===b)); }
    if(action==='nav') openNav(s,b.dataset.nav);
    if(action==='back') openNav(s,'0');
    if(action==='filter') { $$('.sample-segments button',s).forEach(v=>v.setAttribute('aria-pressed',String(v===b))); $('.filter-result',s).textContent=`${b.dataset.filter}のレシート · ${b.dataset.filter==='未確認'?'2':'1'}件`; const rows=$$('.sample-row',s); rows.forEach((row,i)=>{ row.hidden=b.dataset.filter==='確認済み'&&i===1; }); }
  });
  document.addEventListener('input',e=>{ if(e.target.dataset.search) { const s=e.target.closest('.screen'); const text=e.target.value.trim(); const matches=['たまご','牛乳','冷蔵庫'].some(v=>v.includes(text)); $('.search-results',s).innerHTML=matches?stock():'<p class="subview-note">見本の在庫に該当がありません。</p>'; } });
  $('.app-tabs').addEventListener('keydown',e=>{ if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return; e.preventDefault(); const tabs=$$('.app-tabs button'); let i=tabs.indexOf(document.activeElement); i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3; tabs[i].click(); tabs[i].focus(); });
  $('#detail-dialog').addEventListener('click',e=>{ if(e.target===$('#detail-dialog')) { const r=e.target.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close(); } });
  $('#copy-selection').addEventListener('click',async()=>{ const text=Object.keys(groups).map(key=>{const c=concepts.find(v=>v.id===picks[key]&&v.app===key);return `${groups[key].name}：${c?`${c.id}「${c.name}」`:'未選択'}`;}).join('\n'); try { await navigator.clipboard.writeText(text); $('#copy-status').textContent='コピーしました。このチャットに貼り付けて選んだ案を伝えられます。'; } catch { $('#copy-status').textContent=text+' ／ この内容をチャットに書いてください。'; } });
  motionButton(); render();
})();
