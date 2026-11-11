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
    { date: '2026-11-14', name: '書店', amount: 1200, card: '三井住友' }
  ];
  let nextId = 6;
  let month = '2026-11';
  let day = '2026-11-10';
  let filter = 'all';
  let cardFilter = 'JCB W';
  const toast = message => document.dispatchEvent(new CustomEvent('money-toast', { detail: message }));

  function render() {
    const [year, number] = month.split('-').map(Number);
    const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const rows = filter === 'details' ? details.filter(item => item.card === cardFilter) :
      plans.filter(item => !item.settled && (filter === 'all' || item.kind === filter));
    const cells = Array.from({ length: last }, (_, i) => {
      const date = month + '-' + String(i + 1).padStart(2, '0');
      const count = rows.filter(item => item.date === date).length;
      return `<button type="button" data-plan-day="${date}" aria-label="${number}月${i + 1}日、${count}件" aria-pressed="${date === day}">${i + 1}${count ? '<span class="plan-dot" aria-hidden="true"></span>' : ''}</button>`;
    });
    screen.innerHTML = `
      <div class="plan-toolbar"><label>種類 <select id="plan-filter">${Object.entries({ all: 'すべて', details: '明細', ...kinds }).map(([key, label]) => `<option value="${key}" ${key === filter ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="primary-button" data-plan-add>予定を追加</button></div>
      ${filter === 'details' ? `<label class="plan-card-filter">カード <select id="plan-card">${['JCB W', '三井住友'].map(card => `<option ${card === cardFilter ? 'selected' : ''}>${card}</option>`).join('')}</select></label>` : ''}
      <section class="sheet plan-calendar" aria-label="予定カレンダー">
        <div class="plan-toolbar"><button type="button" class="icon-button" data-plan-month="-1" aria-label="前月">‹</button><h2>${year}年${number}月</h2><button type="button" class="icon-button" data-plan-month="1" aria-label="翌月">›</button></div>
        <div class="plan-grid">${[...'日月火水木金土'].map(label => `<span>${label}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}${cells.join('')}</div>
      </section>
      <section class="sheet"><h2>${number}月${Number(day.slice(-2))}日の${filter === 'details' ? '明細' : '予定'}</h2>
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
    form.elements.kind.value = item?.kind ?? (filter in kinds ? filter : 'payment');
    editor.querySelector('h2').textContent = item ? '予定を編集' : '予定を追加';
    editor.showModal();
  }

  screen.addEventListener('change', event => {
    if (event.target.id === 'plan-filter') filter = event.target.value;
    else if (event.target.id === 'plan-card') cardFilter = event.target.value;
    else return;
    render();
  });
  screen.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if ('planAdd' in button.dataset) return openEditor();
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
    if (filter !== 'all' && filter !== values.kind) filter = 'all';
    editor.close();
    render();
    toast('保存しました');
  });
  editor.querySelector('[data-plan-close]').addEventListener('click', () => editor.close());
  window.moneyPlans = { open: render };
})();
