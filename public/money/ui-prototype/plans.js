/* Sample transactions for the calendar preview. */
(() => {
  'use strict';
  const screen = document.querySelector('#plans-screen');
  const editor = document.querySelector('#plan-editor');
  const form = editor.querySelector('form');
  const kinds = { payment: '支払い', income: '収入', saving: '貯金', nisa: 'NISA', transfer: '振込' };
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const yen = amount => '¥' + amount.toLocaleString('ja-JP');
  const plans = [
    { id: 1, date: '2026-11-10', name: 'カード引落', amount: 100000, kind: 'payment', statement: true, confirmed: true, card: 'JCB W' },
    { id: 2, date: '2026-11-13', name: '給与', amount: 78000, kind: 'income' },
    { id: 3, date: '2026-11-15', name: '生活費', amount: 20000, kind: 'payment' },
    { id: 4, date: '2026-12-05', name: '仕送り', amount: 55000, kind: 'income' },
    { id: 5, date: '2026-12-10', name: 'カード引落', amount: 120000, kind: 'payment', statement: true, card: '三井住友' }
  ];
  const details = [
    { date: '2026-11-09', name: 'スーパー', amount: 2480, card: 'JCB W', included: true },
    { date: '2026-11-14', name: '書店', amount: 1200, card: '三井住友' },
    { date: '2026-11-08', name: '日用品', amount: 1800, card: 'MUFG' },
    { date: '2026-10-03', name: '食品', amount: 3200, card: 'JCB W', included: true }
  ];
  const cards = ['JCB W', '三井住友', 'MUFG'];
  const periods = [
    { start: '2026-10-16', end: '2026-11-15' },
    { start: '2026-09-16', end: '2026-10-15' }
  ];
  let nextId = 6;
  let month = '2026-11';
  let day = '2026-11-10';
  let showDetails = false;
  let cardIndex = 0;
  let periodIndex = 0;
  const toast = message => document.dispatchEvent(new CustomEvent('money-toast', { detail: message }));

  function selectCard(index) {
    cardIndex = index;
    screen.querySelectorAll('[data-detail-card]').forEach((button, i) =>
      button.setAttribute('aria-pressed', String(i === index)));
    screen.querySelectorAll('.detail-card-panel').forEach((panel, i) => { panel.inert = i !== index; });
  }

  function renderDetails() {
    const period = periods[periodIndex];
    screen.innerHTML = `
      <div class="plan-toolbar"><button type="button" class="text-button" data-plan-calendar>‹ 予定</button><h2>カード明細</h2></div>
      <label class="detail-period">利用期間<select id="detail-period">${periods.map(({ start, end }, i) =>
        `<option value="${i}" ${i === periodIndex ? 'selected' : ''}>${start.replaceAll('-', '/')} 〜 ${end.replaceAll('-', '/')}</option>`).join('')}</select></label>
      <div class="mail-track detail-track">${cards.map(card => {
        const rows = details.filter(item => item.card === card && item.date >= period.start && item.date <= period.end)
          .sort((a, b) => b.date.localeCompare(a.date));
        return `<section class="detail-card-panel" aria-label="${card}"><div class="sheet"><h2>${card}</h2>${rows.map(item =>
          `<article class="plan-row"><div class="plan-toolbar"><strong>${escape(item.name)}</strong><strong>${yen(item.amount)}</strong></div><p class="support">${item.date.replaceAll('-', '/')}${item.included ? ' · 請求総額の内訳' : ''}</p></article>`).join('') || '<p class="support">明細なし</p>'}</div></section>`;
      }).join('')}</div>
      <nav class="detail-card-nav" aria-label="明細のカード">${cards.map((card, i) => `<button type="button" data-detail-card="${i}">${card}</button>`).join('')}</nav>`;
    const track = screen.querySelector('.detail-track');
    track.scrollLeft = cardIndex * track.clientWidth;
    selectCard(cardIndex);
    track.addEventListener('scroll', () => {
      if (track.clientWidth) selectCard(Math.round(track.scrollLeft / track.clientWidth));
    }, { passive: true });
  }

  function render() {
    screen.classList.toggle('showing-card-details', showDetails);
    if (showDetails) return renderDetails();
    const [year, number] = month.split('-').map(Number);
    const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const rows = plans.filter(item => !item.settled);
    const cells = Array.from({ length: last }, (_, i) => {
      const date = month + '-' + String(i + 1).padStart(2, '0');
      const daily = rows.filter(item => item.date === date);
      const groups = [
        { name: '収入', sign: '+', style: 'in', count: daily.filter(item => item.kind === 'income').length },
        { name: '支出', sign: '−', style: 'out', count: daily.filter(item => item.kind === 'payment').length },
        { name: '資金移動', sign: '↔', style: 'move', count: daily.filter(item => !['income', 'payment'].includes(item.kind)).length }
      ].filter(group => group.count);
      const label = [`${number}月${i + 1}日`, `${daily.length}件`, ...groups.map(group => group.name + group.count + '件')].join('、');
      return `<button type="button" data-plan-day="${date}" aria-label="${label}" aria-pressed="${date === day}"><span>${i + 1}</span><span class="plan-marks" aria-hidden="true">${groups.map(group => `<span class="plan-mark ${group.style}">${group.sign}</span>`).join('')}</span></button>`;
    });
    screen.innerHTML = `
      <div class="plan-toolbar"><button type="button" class="text-button" data-plan-details>明細</button><button type="button" class="primary-button" data-plan-add>予定を追加</button></div>
      <section class="sheet plan-calendar" aria-label="予定カレンダー">
        <div class="plan-toolbar"><button type="button" class="icon-button" data-plan-month="-1" aria-label="前月">‹</button><h2>${year}年${number}月</h2><button type="button" class="icon-button" data-plan-month="1" aria-label="翌月">›</button></div>
        <div class="plan-grid">${[...'日月火水木金土'].map(label => `<span>${label}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}${cells.join('')}</div>
        <p class="plan-legend"><span class="plan-mark in">＋ 収入</span><span class="plan-mark out">− 支出</span><span class="plan-mark move">↔ 資金移動</span></p>
      </section>
      <section class="sheet"><h2>${number}月${Number(day.slice(-2))}日の予定</h2>
        ${rows.filter(item => item.date === day).map(item => `
          <article class="plan-row"><div class="plan-toolbar"><strong>${escape(item.name)}</strong><strong>${yen(item.amount)}</strong></div>
          <p class="support">${escape(item.card || kinds[item.kind])}${item.included ? ' · 請求総額の内訳' : item.confirmed ? ' · 請求額確認済み' : ''}</p>
          ${item.id ? `<div class="mail-actions">${item.statement && !item.confirmed ? `<button class="text-button" data-plan-action="confirm" data-id="${item.id}">請求額を確認</button>` : ''}
          <button class="text-button" data-plan-action="settle" data-id="${item.id}">${item.statement ? '引落を記録' : '確定'}</button>
          <button class="text-button" data-plan-action="edit" data-id="${item.id}">編集</button>
          <button class="text-button" data-plan-action="delete" data-id="${item.id}">削除</button></div>` : ''}</article>`).join('') || '<p class="support">0件</p>'}
      </section>`;
  }

  function openEditor(item) {
    form.reset();
    form.elements.id.value = item?.id ?? '';
    form.elements.date.value = item?.date ?? day;
    form.elements.name.value = item?.name ?? '';
    form.elements.amount.value = item?.amount ?? '';
    form.elements.kind.value = item?.kind ?? 'payment';
    editor.querySelector('h2').textContent = item ? '予定を編集' : '予定を追加';
    editor.showModal();
  }

  screen.addEventListener('change', event => {
    if (event.target.id !== 'detail-period') return;
    periodIndex = Number(event.target.value);
    render();
  });
  screen.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if ('planAdd' in button.dataset) return openEditor();
    if ('detailCard' in button.dataset) {
      const track = screen.querySelector('.detail-track');
      const index = Number(button.dataset.detailCard);
      track.scrollLeft = index * track.clientWidth;
      selectCard(index);
      return;
    }
    if ('planDetails' in button.dataset || 'planCalendar' in button.dataset) {
      showDetails = 'planDetails' in button.dataset;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (button.dataset.planDay) day = button.dataset.planDay;
    else if (button.dataset.planMonth) {
      const [year, number] = month.split('-').map(Number);
      month = new Date(Date.UTC(year, number - 1 + Number(button.dataset.planMonth), 1)).toISOString().slice(0, 7);
      day = month + '-01';
    } else if (button.dataset.planAction) {
      const index = plans.findIndex(item => item.id === Number(button.dataset.id));
      const item = plans[index];
      switch (button.dataset.planAction) {
        case 'edit': return openEditor(item);
        case 'confirm': item.confirmed = true; toast('請求額を確認しました'); break;
        case 'settle': item.settled = true; toast(item.statement ? '引落を記録しました' : '確定しました'); break;
        case 'delete':
          if (!window.confirm('予定を削除しますか？')) return;
          plans.splice(index, 1);
          toast('削除しました');
          break;
      }
    } else return;
    render();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    if (!name) { form.elements.name.focus(); return; }
    const item = plans.find(plan => plan.id === Number(data.get('id')));
    const values = { date: data.get('date'), name, amount: Number(data.get('amount')), kind: data.get('kind') };
    if (item) Object.assign(item, values);
    else plans.push({ id: nextId++, ...values });
    day = values.date;
    month = day.slice(0, 7);
    editor.close();
    render();
    toast('保存しました');
  });
  editor.querySelector('[data-plan-close]').addEventListener('click', () => editor.close());
  window.moneyPlans = { open() { showDetails = false; render(); } };
})();
