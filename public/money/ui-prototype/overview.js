/* Sample data for the record, account and shift previews. */
(() => {
  'use strict';
  const records = document.querySelector('#records-screen');
  const accounts = document.querySelector('#accounts-screen');
  const shifts = document.querySelector('#shift-screen');
  const editor = document.querySelector('#shift-editor');
  const form = editor.querySelector('form');
  const assetEditor = document.querySelector('#asset-editor');
  const assetForm = assetEditor.querySelector('form');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const yen = amount => (amount < 0 ? '−' : '') + '¥' + Math.abs(amount).toLocaleString('ja-JP');
  const { box: note, date: formatDate, yen: yenText } = window.moneyNotice;
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
  const work = [['2026-11-10', 6], ['2026-11-13', 5], ['2026-11-18', 7], ['2026-12-03', 6]]
    .map(([date, hours]) => ({ date, hours, status: 'planned', rate: 0, memo: '' }));
  const bankAccounts = [
    { id: 1, name: '三菱UFJ銀行', balance: 180000, role: 'primary', spendable: true, verifiedDate: '2026-11-08' },
    { id: 2, name: '貯蓄口座', balance: 60000, role: 'savings', spendable: false }
  ];
  const bankCards = [
    { id: 3, name: 'JCB W', number: '•••• 1024', style: 'jcb' },
    { id: 4, name: '三井住友', number: '•••• 2024', style: 'smbc' },
    { id: 5, name: 'MUFG', number: '•••• 3024', style: 'mufg' }
  ].map(card => ({ ...card, accountId: 1, closing: 15, payment: 10, offset: 1, inUse: true }));
  const roles = { primary: '基準口座', spending: '自由利用口座', savings: '貯金口座', investment: '投資・NISA口座', other: 'その他' };
  let nextAssetId = 6;
  let editingAsset;
  let editingWork;
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
      ${slices.length ? `<ul class="record-legend">${slices.map(item => `<li><span style="color:${item.color}">●</span> ${escape(item.name)} ${yen(item.amount)}</li>`).join('')}</ul>` : ''}</section>
      <section class="sheet"><h2>${Number(recordMonth.slice(5))}月の履歴</h2>${rows.slice().sort((a,b) => b.date.localeCompare(a.date)).map(item => `<article class="plan-row"><div class="plan-toolbar"><strong>${escape(item.name)}</strong><strong>${yen(item.amount)}</strong></div><p class="support">${item.date.replaceAll('-', '/')} · ${escape(item.category)}</p>${actions('record', history.indexOf(item))}</article>`).join('') || '<p class="support">履歴なし</p>'}</section>`;
  }

  function actions(type, id) {
    return `<div class="mail-actions"><button type="button" class="text-button" data-edit="${type}" data-id="${id}">編集</button><button type="button" class="text-button" data-delete="${type}" data-id="${id}">削除</button></div>`;
  }

  function renderAccounts() {
    const primary = primaryAccount();
    accounts.innerHTML = `<div class="plan-toolbar"><button type="button" class="text-button" data-edit="account">口座を追加</button></div>
      <section class="sheet"><h2>基準口座</h2><p class="support">${escape(primary.name)}</p>${note(balanceText(primary))}${actions('account', primary.id)}</section>
      <details class="sheet" id="subaccounts" ${subaccountsOpen ? 'open' : ''}><summary>サブ口座</summary>${bankAccounts.filter(item => item !== primary).map(item => `<article class="plan-row"><strong>${escape(item.name)}</strong>${note(balanceText(item))}${actions('account', item.id)}</article>`).join('') || '<p class="support">口座なし</p>'}</details>
      <div class="plan-toolbar"><h2 class="section-heading">クレジットカード</h2><button type="button" class="text-button" data-edit="card">カードを追加</button></div>
      <div class="account-card-grid">${bankCards.map(item => `<section><article class="account-card ${item.style || 'jcb'}"><strong>${escape(item.name)}</strong><span aria-hidden="true">▣</span><small>${item.number || ''}</small></article><p class="support">${item.closing ? item.closing + '日' : '月末'}締め · ${item.payment ? item.payment + '日' : '月末'}払い</p>${actions('card', item.id)}</section>`).join('')}</div>`;
    accounts.querySelector('#subaccounts').addEventListener('toggle', event => { subaccountsOpen = event.target.open; });
  }
  function primaryAccount() { return bankAccounts.find(item => item.role === 'primary'); }
  function balanceText(item) {
    const amount = (item.balance < 0 ? '−' : '') + yenText(item.balance);
    return item.verifiedDate ? '銀行で確認した残高：' + amount + '（' + formatDate(item.verifiedDate) + '確認）'
      : '登録した残高：' + amount + '（銀行の残高は未確認です）';
  }
  function adjustBalance(delta) {
    if (!delta) return;
    const item = primaryAccount();
    item.balance += delta;
    delete item.verifiedDate;
    document.dispatchEvent(new Event('preview-accounts-change'));
  }

  function openAsset(type, item) {
    editingAsset = { type, item };
    const isAccount = type === 'account';
    const title = isAccount ? '口座' : 'カード';
    assetEditor.querySelector('h2').textContent = title + (item ? 'を編集' : 'を追加');
    assetForm.innerHTML = `<label>${title}名<input name="name" maxlength="40" required value="${escape(item?.name ?? '')}"></label>${isAccount ? `
      <label>役割<select name="role">${Object.entries(roles).map(([key, label]) => `<option value="${key}" ${key === (item?.role ?? 'spending') ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label>現在の実残高<input type="number" step="1" inputmode="numeric" name="balance" value="${item?.balance ?? 0}" required></label>
      <label class="asset-check"><input type="checkbox" name="verified">今日の銀行明細とこの残高が一致しています</label>
      <label class="asset-check"><input type="checkbox" name="spendable" ${item?.spendable !== false ? 'checked' : ''}>使える額に含める</label>` : `
      <label>引落口座<select name="accountId" required>${bankAccounts.map(account => `<option value="${account.id}" ${account.id === item?.accountId ? 'selected' : ''}>${escape(account.name)}</option>`).join('')}</select></label>
      <label>締め日<input name="closing" type="number" min="0" max="31" step="1" value="${item?.closing ?? 0}" required><small>月末締めは0</small></label>
      <label>支払日<input name="payment" type="number" min="0" max="31" step="1" value="${item?.payment ?? 27}" required><small>月末払いは0</small></label>
      <label>支払月<select name="offset">${[[1,'締め月の翌月に引き落とし'],[2,'締め月の翌々月に引き落とし'],[0,'締め月と同じ月に引き落とし']].map(([value, label]) => `<option value="${value}" ${value === (item?.offset ?? 1) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`}
      <button class="primary-button" type="submit">保存</button><button class="text-button" type="button" data-asset-cancel>キャンセル</button>`;
    assetEditor.showModal();
  }
  accounts.addEventListener('click', event => {
    const button = event.target.closest('[data-edit], [data-delete]');
    if (!button) return;
    const type = button.dataset.edit || button.dataset.delete;
    const list = type === 'account' ? bankAccounts : bankCards;
    const item = list.find(value => value.id === Number(button.dataset.id));
    if (button.dataset.edit) return openAsset(type, item);
    if (!item) return;
    if (item.role === 'primary') return toast('基準口座は削除できません');
    if (type === 'account' && bankCards.some(card => card.accountId === item.id)) return toast('カードで使用中の口座は削除できません');
    if (item.inUse) return toast('支払いで使用中のカードは削除できません');
    if (!window.confirm(item.name + 'を削除しますか？')) return;
    list.splice(list.indexOf(item), 1);
    renderAccounts();
    toast('削除しました');
  });
  assetEditor.addEventListener('click', event => {
    if (event.target.closest('[data-asset-close], [data-asset-cancel]')) assetEditor.close();
  });
  assetForm.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(assetForm);
    const { type, item } = editingAsset;
    const name = String(data.get('name')).trim();
    if (!name) { assetForm.elements.name.focus(); return; }
    if (type === 'account') {
      const balance = Number(data.get('balance'));
      if (!Number.isSafeInteger(balance)) return;
      const role = data.get('role');
      const verifiedDate = data.has('verified') ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()) : item?.balance === balance ? item.verifiedDate : undefined;
      if (role === 'primary') bankAccounts.filter(account => account !== item && account.role === 'primary').forEach(account => { account.role = 'spending'; });
      const values = { name, balance, role, verifiedDate, spendable: data.has('spendable') && !['savings', 'investment'].includes(role) };
      if (item) Object.assign(item, values);
      else bankAccounts.push({ id: nextAssetId++, ...values });
      if (!bankAccounts.some(account => account.role === 'primary')) bankAccounts[0].role = 'primary';
    } else {
      const values = { name, accountId: Number(data.get('accountId')), closing: Number(data.get('closing')), payment: Number(data.get('payment')), offset: Number(data.get('offset')) };
      if (item) Object.assign(item, values);
      else bankCards.push({ id: nextAssetId++, ...values });
    }
    assetEditor.close();
    renderAccounts();
    document.dispatchEvent(new Event('preview-accounts-change'));
    toast('保存しました');
  });

  function renderShifts() {
    const [year, number] = shiftMonth.split('-').map(Number);
    const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const entries = work.filter(item => item.date.startsWith(shiftMonth)).sort((a,b) => a.date.localeCompare(b.date));
    const total = entries.reduce((sum, item) => sum + item.hours, 0);
    const planned = entries.reduce((sum, item) => sum + (item.status === 'planned' ? item.hours : 0), 0);
    const estimated = entries.reduce((sum, item) => sum + Math.round(item.hours * (item.rate || window.moneyExtras.hourlyRate())), 0);
    shifts.innerHTML = `<section class="sheet plan-calendar" aria-label="シフトカレンダー">${pager(shiftMonth)}
      <div class="plan-grid">${[...'日月火水木金土'].map(label => `<span>${label}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}
      ${Array.from({ length: last }, (_, i) => {
        const date = shiftMonth + '-' + String(i + 1).padStart(2, '0');
        const hours = entries.reduce((sum, item) => sum + (item.date === date ? item.hours : 0), 0);
        return `<button type="button" data-shift-day="${date}" aria-label="${number}月${i + 1}日${hours ? '、' + hours + '時間' : ''}">${i + 1}${hours ? `<small class="shift-hours">${hours}h</small>` : ''}</button>`;
      }).join('')}</div></section>
      <div class="shift-totals"><section class="sheet"><h2>給与見込み額</h2><strong>${yen(estimated)}</strong></section><section class="sheet"><h2>予定勤務時間</h2><strong>${planned}時間</strong><p class="support">勤務済み ${total - planned}時間</p></section></div>
      <section class="sheet"><div class="plan-toolbar"><h2>シフト一覧</h2><button type="button" class="text-button" data-shift-add>シフトを追加</button></div>${entries.map(item =>
        `<article class="plan-row"><div class="plan-toolbar"><strong>${item.date.replaceAll('-', '/')}</strong><strong>${item.hours}時間</strong></div><p class="support">${item.status === 'worked' ? '勤務済み' : '勤務予定'} · ${yen(item.rate || window.moneyExtras.hourlyRate())}／時${item.memo ? ' · ' + escape(item.memo) : ''}</p>${actions('work', work.indexOf(item))}</article>`).join('') || '<p class="support">シフトなし</p>'}</section>`;
  }

  records.addEventListener('click', event => {
    const button = event.target.closest('[data-month-step]');
    if (button) { recordMonth = changeMonth(recordMonth, Number(button.dataset.monthStep)); renderRecords(); return; }
    const action = event.target.closest('[data-edit="record"], [data-delete="record"]');
    if (!action) return;
    const index = Number(action.dataset.id);
    const item = history[index];
    if (action.dataset.delete) {
      if (!window.confirm(item.name + 'を削除しますか？')) return;
      adjustBalance(-item.amount);
      history.splice(index, 1);
      renderRecords();
      toast('削除しました');
      return;
    }
    window.moneyPlans.editTransaction({
      ...item, settled: true, kind: item.kind ?? (item.amount >= 0 ? 'income' : 'payment'), amount: Math.abs(item.amount)
    }, '取引を編集', values => {
      const amount = values.kind === 'income' || values.kind === 'reimbursement' ? values.amount : -values.amount;
      adjustBalance(amount - item.amount);
      Object.assign(item, values, { amount });
      recordMonth = item.date.slice(0, 7);
      renderRecords();
    });
  });
  records.addEventListener('change', event => {
    if (event.target.id === 'record-chart-type') { recordType = event.target.value; renderRecords(); }
  });
  shifts.addEventListener('click', event => {
    const monthButton = event.target.closest('[data-month-step]');
    if (monthButton) { shiftMonth = changeMonth(shiftMonth, Number(monthButton.dataset.monthStep)); renderShifts(); return; }
    const rowButton = event.target.closest('[data-edit="work"], [data-delete="work"]');
    if (rowButton) {
      const item = work[Number(rowButton.dataset.id)];
      if (rowButton.dataset.delete) return deleteWork(item);
      return openWork(item, item.date);
    }
    if (event.target.closest('[data-shift-add]')) return openWork(null, shiftMonth + '-01');
    const dateButton = event.target.closest('[data-shift-day]');
    if (!dateButton) return;
    const date = dateButton.dataset.shiftDay;
    openWork(work.find(item => item.date === date), date);
  });
  function openWork(item, date) {
    editingWork = item;
    form.reset();
    form.elements.date.value = date;
    form.elements.status.value = item?.status ?? 'worked';
    form.elements.hours.value = item?.hours ?? '';
    form.elements.rate.value = item?.rate || '';
    form.elements.memo.value = item?.memo ?? '';
    editor.querySelector('[data-shift-delete]').hidden = !item;
    editor.querySelector('h2').textContent = item ? '勤務を編集' : '勤務を記録';
    editor.showModal();
  }
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
    const values = {
      date: form.elements.date.value,
      hours: Number(form.elements.hours.value),
      status: form.elements.status.value,
      rate: Number(form.elements.rate.value),
      memo: form.elements.memo.value.trim()
    };
    if (editingWork) Object.assign(editingWork, values);
    else work.push(values);
    shiftMonth = values.date.slice(0, 7);
    editor.close();
    renderShifts();
    toast('保存しました');
  });
  editor.querySelectorAll('[data-shift-close]').forEach(button => button.addEventListener('click', () => editor.close()));
  function deleteWork(item) {
    if (!item) return;
    if (!window.confirm('シフトを削除しますか？')) return;
    work.splice(work.indexOf(item), 1);
    editor.close();
    renderShifts();
    toast('削除しました');
  }
  editor.querySelector('[data-shift-delete]').addEventListener('click', () => deleteWork(editingWork));
  window.moneyOverview = {
    records: renderRecords, accounts: renderAccounts, shift: renderShifts,
    primaryBalance: () => primaryAccount().balance, primaryAccount, balanceText, adjustBalance
  };
})();
