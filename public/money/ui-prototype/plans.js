/* Sample transactions for the calendar preview. */
(() => {
  'use strict';
  const screen = document.querySelector('#plans-screen');
  const editor = document.querySelector('#plan-editor');
  const form = editor.querySelector('form');
  const kinds = { payment: '支払い', income: '収入', saving: '貯金', nisa: 'NISA', reimbursement: '立替回収', transfer: '振込' };
  const marks = {
    income: { style: 'in', icon: '+' },
    payment: { style: 'out', icon: '−' },
    saving: { style: 'saving', icon: '<path d="M5 9a6 6 0 0 1 5-3l3-3v3h2a5 5 0 0 1 5 4h2v5h-3l-2 4h-3v-3H9v3H6l-2-4a5 5 0 0 1 1-6zM3 11c-2 0-2-3 0-3m7 1h4m3 1h.1"/>' },
    nisa: { style: 'nisa', icon: '<path d="M3 3v18h18M7 15l5-5 4 3 5-7m-5 0h5v5"/>' },
    reimbursement: { style: 'reimbursement', icon: '<path d="M4 8h11a5 5 0 0 1 0 10H9M8 4 4 8l4 4"/><path d="M5 15v6m-2-4h4m-4 2h4"/>' },
    transfer: { style: 'transfer', icon: '<path d="M3 8h17m-4-4 4 4-4 4M21 16H4m4-4-4 4 4 4"/>' }
  };
  function mark(kind) {
    const { style, icon } = marks[kind];
    return `<span class="plan-mark ${style}" data-kind="${kind}" aria-hidden="true">${icon.startsWith('<') ? `<svg viewBox="0 0 24 24" focusable="false">${icon}</svg>` : icon}</span>`;
  }
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const yen = amount => '¥' + amount.toLocaleString('ja-JP');
  const { box: note, date: formatDate, yen: yenText, confirm: confirmOperation } = window.moneyNotice;
  const plans = [
    { id: 1, date: '2026-11-10', name: 'カード引落', amount: 100000, kind: 'payment', statement: true, confirmed: true, card: 'JCB W' },
    { id: 2, date: '2026-11-13', name: '給与', amount: 78000, kind: 'income', salaryEstimate: true },
    { id: 3, date: '2026-11-15', name: '生活費', amount: 20000, kind: 'payment' },
    { id: 4, date: '2026-12-05', name: '仕送り', amount: 55000, kind: 'income' },
    { id: 5, date: '2026-12-10', name: 'カード引落', amount: 120000, kind: 'payment', statement: true, card: 'JCB W' },
    { id: 6, date: '2026-11-16', name: '積立貯金', amount: 10000, kind: 'saving', exclude: true },
    { id: 7, date: '2026-11-18', name: 'NISA積立', amount: 5000, kind: 'nisa', exclude: true },
    { id: 8, date: '2026-11-20', name: '立替分の入金', amount: 3200, kind: 'reimbursement', exclude: true },
    { id: 9, date: '2026-11-24', name: '口座間の振込', amount: 20000, kind: 'transfer', exclude: true }
  ];
  const details = [
    { date: '2026-11-09', name: 'スーパー', amount: 2480, card: 'JCB W', included: true, statementId: 5 },
    { date: '2026-11-14', name: '書店', amount: 1200, card: '三井住友' },
    { date: '2026-11-08', name: '日用品', amount: 1800, card: 'MUFG' },
    { date: '2026-10-03', name: '食品', amount: 3200, card: 'JCB W', included: true, statementId: 1 }
  ];
  const cards = ['JCB W', '三井住友', 'MUFG'];
  const periods = [
    { start: '2026-10-16', end: '2026-11-15' },
    { start: '2026-09-16', end: '2026-10-15' }
  ];
  let nextId = 10;
  let month = '2026-11';
  let day = '2026-11-10';
  let showDetails = false;
  let cardIndex = 0;
  let periodIndex = 0;
  let saveEdit;
  let editedTransaction;
  const toast = message => document.dispatchEvent(new CustomEvent('money-toast', { detail: message }));
  const signedAmount = item => ['income', 'reimbursement'].includes(item.kind) ? item.amount : -item.amount;
  const notifyPlans = () => document.dispatchEvent(new Event('preview-plans-change'));
  const debitDate = period => {
    const [year, month] = period.end.split('-').map(Number);
    return new Date(Date.UTC(year, month, 10)).toISOString().slice(0, 10);
  };

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
        `<option value="${i}" ${i === periodIndex ? 'selected' : ''}>${formatDate(start)}〜${formatDate(end)}</option>`).join('')}</select></label>
      <p class="support">引落予定日：${formatDate(debitDate(period))}</p>
      <div class="mail-track detail-track">${cards.map(card => {
        const rows = details.filter(item => item.card === card && item.date >= period.start && item.date <= period.end)
          .sort((a, b) => b.date.localeCompare(a.date));
        return `<section class="detail-card-panel" aria-label="${card}"><div class="sheet"><h2>${card}</h2>${rows.map(item =>
          `<article class="plan-row"><div class="plan-toolbar"><strong>${escape(item.name)}</strong><strong>${yen(item.amount)}</strong></div><p class="support">${item.date.replaceAll('-', '/')}${item.included ? ' · 請求総額の内訳' : ''}</p>${item.included ? note('この明細は請求総額' + yenText(plans.find(plan => plan.id === item.statementId).amount) + 'に含まれています。') : `<div class="mail-actions"><button class="text-button" type="button" data-edit-detail="${details.indexOf(item)}">編集</button><button class="text-button" type="button" data-delete-detail="${details.indexOf(item)}">削除</button></div>`}</article>`).join('') || '<p class="support">明細なし</p>'}</div></section>`;
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
      const groups = Object.keys(marks).map(kind => ({ kind, count: daily.filter(item => item.kind === kind).length })).filter(group => group.count);
      const label = [`${number}月${i + 1}日`, `${daily.length}件`, ...groups.map(({ kind, count }) => (kind === 'payment' ? '支出' : kinds[kind]) + count + '件')].join('、');
      return `<button type="button" data-plan-day="${date}" aria-label="${label}" aria-pressed="${date === day}"><span>${i + 1}</span><span class="plan-marks" aria-hidden="true">${groups.map(group => mark(group.kind)).join('')}</span></button>`;
    });
    screen.innerHTML = `
      <div class="plan-toolbar"><button type="button" class="text-button" data-plan-details>明細</button><button type="button" class="primary-button" data-plan-add>予定を追加</button></div>
      <section class="sheet plan-calendar" aria-label="予定カレンダー">
        <div class="plan-toolbar"><button type="button" class="icon-button" data-plan-month="-1" aria-label="前月">‹</button><h2>${year}年${number}月</h2><button type="button" class="icon-button" data-plan-month="1" aria-label="翌月">›</button></div>
        <div class="plan-grid">${[...'日月火水木金土'].map(label => `<span>${label}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}${cells.join('')}</div>
        <p class="plan-legend">${Object.keys(marks).map(kind => `<span>${mark(kind)}${kind === 'payment' ? '支出' : kinds[kind]}</span>`).join('')}</p>
      </section>
      <section class="sheet"><h2>${number}月${Number(day.slice(-2))}日の予定</h2>
        ${rows.filter(item => item.date === day).map(item => `
          <article class="plan-row"><div class="plan-toolbar"><strong>${escape(item.name)}</strong><strong>${yen(item.amount)}</strong></div>
          <p class="support plan-kind">${mark(item.kind)}${escape(kinds[item.kind])}${item.card ? ' · ' + escape(item.card) : ''}${item.confirmed ? ' · 請求額確認済み' : ''}</p>
          ${item.id ? `<div class="mail-actions">${item.statement && !item.confirmed ? `<button class="text-button" data-plan-action="confirm" data-id="${item.id}">請求額を確認</button>` : ''}
          <button class="text-button" data-plan-action="settle" data-id="${item.id}">${item.statement ? '引落を記録' : '確定'}</button>
          <button class="text-button" data-plan-action="edit" data-id="${item.id}">編集</button>
          <button class="text-button" data-plan-action="delete" data-id="${item.id}">削除</button></div>` : ''}</article>`).join('') || '<p class="support">0件</p>'}
      </section>`;
  }

  function openEditor(item, title, onSave) {
    saveEdit = onSave;
    editedTransaction = item;
    form.reset();
    form.elements.id.value = item?.id ?? '';
    form.elements.date.value = item?.date ?? day;
    form.elements.name.value = item?.name ?? '';
    form.elements.amount.value = item?.amount ?? '';
    form.elements.kind.value = item?.kind ?? 'payment';
    const category = form.elements.category;
    for (const option of category.querySelectorAll('[data-existing]')) option.remove();
    if (item?.category && !Array.from(category.options).some(option => option.value === item.category)) {
      const option = new Option(item.category, item.category);
      option.dataset.existing = '';
      category.add(option);
    }
    category.value = item?.category ?? '生活費';
    form.elements.lending.value = item?.lending ?? '';
    form.elements.exclude.checked = Boolean(item?.exclude);
    editor.querySelector('h2').textContent = title ?? (item ? '予定を編集' : '予定を追加');
    updateEditNotice();
    editor.showModal();
  }
  function updateEditNotice() {
    const current = editedTransaction;
    const amount = Number(form.elements.amount.value);
    const diff = current?.settled ? signedAmount({ kind: form.elements.kind.value, amount }) - signedAmount(current) : 0;
    const message = current?.settled
      ? 'この操作で口座残高も変わります。' + (diff ? ' 残高の変化：' + (diff > 0 ? '＋' : '−') + yenText(diff) : '')
      : '予定を保存すると見通しに反映されます。';
    editor.querySelector('#plan-operation-note').innerHTML = note(message) + (current?.salaryEstimate
      ? note('実際の支給額が分かったら、この見込みを編集して給与を確定してください。') : '');
  }
  form.addEventListener('input', updateEditNotice);

  screen.addEventListener('change', event => {
    if (event.target.id !== 'detail-period') return;
    periodIndex = Number(event.target.value);
    render();
  });
  screen.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if ('editDetail' in button.dataset || 'deleteDetail' in button.dataset) {
      const index = Number(button.dataset.editDetail ?? button.dataset.deleteDetail);
      const item = details[index];
      if (!item || item.included) return;
      if ('editDetail' in button.dataset) {
        return openEditor({ ...item, kind: 'payment' }, '明細を編集', values => {
          Object.assign(item, values);
          render();
        });
      }
      if (!window.confirm(item.name + 'を削除しますか？')) return;
      details.splice(index, 1);
      render();
      toast('削除しました');
      return;
    }
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
        case 'confirm':
          return confirmOperation({ title: '請求額を確認', message: 'カード会社で確認した請求額を保存します。', action: '保存', commit() {
            item.confirmed = true;
            render();
            notifyPlans();
            toast('請求額を確認しました');
          } });
        case 'settle':
          return confirmOperation({
            title: item.statement ? '引落を記録' : '入出金を確定',
            message: item.statement ? '登録した口座残高に、この引落は反映済みですか？' : '入出金を確定すると、登録した口座残高に反映されます。',
            action: item.statement ? '記録する' : '確定する',
            choices: item.statement ? [['yes', '反映済み（登録残高はそのまま）'], ['no', '未反映（登録残高から' + yenText(item.amount) + 'を差し引く）']] : undefined,
            commit(reflected) {
              item.settled = true;
              if (reflected !== 'yes') window.moneyOverview.adjustBalance(signedAmount(item));
              render();
              notifyPlans();
              toast(item.statement ? '引落を記録しました' : '確定しました');
            }
          });
        case 'delete':
          const children = details.filter(row => row.included && row.statementId === item.id);
          const message = children.length ? 'この請求を削除すると、内訳の' + children.length + '件が未確定に戻ります。' :
            item.salaryEstimate ? '削除すると、この月の給与見込みは自動では作り直されません。\n削除しますか？' : '予定を削除しますか？';
          if (!window.confirm(message)) return;
          children.forEach(row => { row.included = false; delete row.statementId; });
          plans.splice(index, 1);
          notifyPlans();
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
    const values = {
      date: data.get('date'), name, amount: Number(data.get('amount')), kind: data.get('kind'),
      category: data.get('category'), lending: Number(data.get('lending')), exclude: data.has('exclude')
    };
    if (saveEdit) {
      const save = saveEdit;
      saveEdit = undefined;
      editor.close();
      save(values);
      toast('保存しました');
      return;
    }
    if (item) Object.assign(item, values);
    else plans.push({ id: nextId++, ...values });
    day = values.date;
    month = day.slice(0, 7);
    editor.close();
    render();
    notifyPlans();
    toast('保存しました');
  });
  editor.querySelectorAll('[data-plan-close]').forEach(button => button.addEventListener('click', () => editor.close()));
  window.moneyPlans = {
    open() { showDetails = false; render(); }, editTransaction: openEditor,
    forecastItems: () => plans.filter(item => !item.settled && !item.exclude).map(item => ({
      date: item.date, name: item.name, amount: signedAmount(item), debit: Boolean(item.statement),
      type: item.confirmed ? '確認済み' : signedAmount(item) > 0 ? '予定収入' : '見込み'
    }))
  };
})();
