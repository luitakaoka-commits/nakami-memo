/* Sample data for the record, account and shift previews. */
(() => {
  'use strict';
  const records = document.querySelector('#records-screen');
  const accounts = document.querySelector('#accounts-screen');
  const shifts = document.querySelector('#shift-screen');
  const editor = document.querySelector('#shift-editor');
  const form = editor.querySelector('form');
  const yen = amount => (amount < 0 ? '−' : '') + '¥' + Math.abs(amount).toLocaleString('ja-JP');
  const monthLabel = month => Number(month.slice(0, 4)) + '年' + Number(month.slice(5)) + '月';
  const changeMonth = (month, offset) => {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
  };
  const history = [
    { date: '2026-11-03', name: '生活費の入金', category: '入金', amount: 55000 },
    { date: '2026-11-07', name: 'コンビニ', category: '食費', amount: -500 },
    { date: '2026-11-09', name: 'スーパー', category: '食費', amount: -2480 },
    { date: '2026-11-10', name: '日用品', category: '日用品', amount: -1800 },
    { date: '2026-10-20', name: '給与', category: '給与', amount: 78000 },
    { date: '2026-10-24', name: '交通費', category: '交通費', amount: -3200 }
  ];
  const work = new Map([['2026-11-10', 6], ['2026-11-13', 5], ['2026-11-18', 7], ['2026-12-03', 6]]);
  let recordMonth = '2026-11';
  let recordType = 'expense';
  let shiftMonth = '2026-11';
  let subaccountsOpen = false;
  const pager = month => `<div class="plan-toolbar overview-pager"><button type="button" class="icon-button" aria-label="前月" data-month-step="-1">‹</button><h2>${monthLabel(month)}</h2><button type="button" class="icon-button" aria-label="翌月" data-month-step="1">›</button></div>`;

  function renderRecords() {
    const rows = history.filter(item => item.date.startsWith(recordMonth));
    const income = rows.reduce((sum, item) => sum + Math.max(item.amount, 0), 0);
    const expense = rows.reduce((sum, item) => sum + Math.max(-item.amount, 0), 0);
    const groups = new Map();
    for (const item of rows.filter(item => recordType === 'expense' ? item.amount < 0 : item.amount > 0)) {
      groups.set(item.category, (groups.get(item.category) || 0) + Math.abs(item.amount));
    }
    const colors = ['var(--chart-positive)', 'var(--chart-negative)', 'var(--brand)'];
    const total = recordType === 'expense' ? expense : income;
    let angle = 0;
    const slices = [...groups].map(([name, amount], i) => {
      const color = colors[i % colors.length];
      const end = angle + amount / total * 360;
      const slice = `${color} ${angle}deg ${end}deg`;
      angle = end;
      return { name, amount, color, slice };
    });
    records.innerHTML = `${pager(recordMonth)}
      <section class="sheet record-summary"><dl class="ledger"><div><dt>収入</dt><dd>${yen(income)}</dd></div><div><dt>支出</dt><dd>${yen(expense)}</dd></div><div class="ledger-total"><dt>収支</dt><dd>${yen(income - expense)}</dd></div></dl>
      <div><div class="record-donut" aria-hidden="true" style="background:${slices.length ? `conic-gradient(${slices.map(item => item.slice).join(',')})` : 'var(--line)'}"></div>
      <label>内訳 <select id="record-chart-type"><option value="expense" ${recordType === 'expense' ? 'selected' : ''}>支出</option><option value="income" ${recordType === 'income' ? 'selected' : ''}>収入</option></select></label></div>
      ${slices.length ? `<ul class="record-legend">${slices.map(item => `<li><span style="color:${item.color}">●</span> ${item.name} ${yen(item.amount)}</li>`).join('')}</ul>` : ''}</section>
      <section class="sheet"><h2>${Number(recordMonth.slice(5))}月の履歴</h2>${rows.slice().reverse().map(item => `<article class="plan-row"><div class="plan-toolbar"><strong>${item.name}</strong><strong>${yen(item.amount)}</strong></div><p class="support">${item.date.replaceAll('-', '/')} · ${item.category}</p></article>`).join('') || '<p class="support">履歴なし</p>'}</section>`;
  }

  function renderAccounts() {
    accounts.innerHTML = `<section class="sheet"><h2>基準口座</h2><p class="support">三菱UFJ銀行</p><p class="amount">¥180,000</p></section>
      <details class="sheet" id="subaccounts" ${subaccountsOpen ? 'open' : ''}><summary>サブ口座</summary><dl class="ledger"><div><dt>貯蓄口座</dt><dd>¥60,000</dd></div></dl></details>
      <h2 class="section-heading">クレジットカード</h2><div class="account-card-grid">${[
        ['JCB W', '•••• 1024', 'jcb'],
        ['三井住友', '•••• 2024', 'smbc'],
        ['MUFG', '•••• 3024', 'mufg']
      ].map(([name, number, style]) => `<article class="account-card ${style}"><strong>${name}</strong><span aria-hidden="true">▣</span><small>${number}</small></article>`).join('')}</div>`;
    accounts.querySelector('#subaccounts').addEventListener('toggle', event => { subaccountsOpen = event.target.open; });
  }

  function renderShifts() {
    const [year, number] = shiftMonth.split('-').map(Number);
    const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const total = [...work].reduce((sum, [date, hours]) => date.startsWith(shiftMonth) ? sum + hours : sum, 0);
    shifts.innerHTML = `<section class="sheet plan-calendar" aria-label="シフトカレンダー">${pager(shiftMonth)}
      <div class="plan-grid">${[...'日月火水木金土'].map(label => `<span>${label}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}
      ${Array.from({ length: last }, (_, i) => {
        const date = shiftMonth + '-' + String(i + 1).padStart(2, '0');
        const hours = work.get(date);
        return `<button type="button" data-shift-day="${date}" aria-label="${number}月${i + 1}日${hours ? '、' + hours + '時間' : ''}">${i + 1}${hours ? `<small class="shift-hours">${hours}h</small>` : ''}</button>`;
      }).join('')}</div></section>
      <div class="shift-totals"><section class="sheet"><h2>給与見込み額</h2><strong>${yen(total * 1250)}</strong></section><section class="sheet"><h2>予定勤務時間</h2><strong>${total}時間</strong></section></div>`;
  }

  records.addEventListener('click', event => {
    const button = event.target.closest('[data-month-step]');
    if (button) { recordMonth = changeMonth(recordMonth, Number(button.dataset.monthStep)); renderRecords(); }
  });
  records.addEventListener('change', event => {
    if (event.target.id === 'record-chart-type') { recordType = event.target.value; renderRecords(); }
  });
  shifts.addEventListener('click', event => {
    const monthButton = event.target.closest('[data-month-step]');
    if (monthButton) { shiftMonth = changeMonth(shiftMonth, Number(monthButton.dataset.monthStep)); renderShifts(); return; }
    const dateButton = event.target.closest('[data-shift-day]');
    if (!dateButton) return;
    const date = dateButton.dataset.shiftDay;
    form.elements.date.value = date;
    form.elements.hours.value = work.get(date) ?? '';
    editor.querySelector('[data-shift-delete]').hidden = !work.has(date);
    editor.querySelector('h2').textContent = date.replaceAll('-', '/');
    editor.showModal();
  });
  let touchStart;
  shifts.addEventListener('touchstart', event => {
    touchStart = event.target.closest('.plan-calendar') && event.touches.length === 1 ? event.touches[0] : null;
  }, { passive: true });
  shifts.addEventListener('touchend', event => {
    if (!touchStart) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touchStart.clientX;
    const dy = end.clientY - touchStart.clientY;
    touchStart = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    shiftMonth = changeMonth(shiftMonth, dx < 0 ? 1 : -1);
    renderShifts();
  }, { passive: true });
  shifts.addEventListener('touchcancel', () => { touchStart = null; });
  const toast = message => document.dispatchEvent(new CustomEvent('money-toast', { detail: message }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    work.set(form.elements.date.value, Number(form.elements.hours.value));
    editor.close();
    renderShifts();
    toast('保存しました');
  });
  editor.querySelector('[data-shift-close]').addEventListener('click', () => editor.close());
  editor.querySelector('[data-shift-delete]').addEventListener('click', () => {
    if (!window.confirm('シフトを削除しますか？')) return;
    work.delete(form.elements.date.value);
    editor.close();
    renderShifts();
    toast('削除しました');
  });
  window.moneyOverview = { records: renderRecords, accounts: renderAccounts, shift: renderShifts };
})();
