/* Isolated sample data for the remaining money screens. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const editor = $('#extra-editor');
  const form = editor.querySelector('form');
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const yen = value => '¥' + value.toLocaleString('ja-JP');
  const toast = message => document.dispatchEvent(new CustomEvent('money-toast', { detail: message }));
  const settings = { reserve: 10000, horizon: 90, reviewDay: 0, rate: 1250, payday: 15, deposit: '基準口座' };
  const receipts = [
    { id: 1, store: 'スーパー', date: '2026-11-09', method: 'カード', status: 'pending', lines: [{ name: '野菜', amount: 480 }, { name: '牛乳', amount: 260 }] },
    { id: 2, store: '青果店', date: '2026-11-07', method: '現金', status: 'accepted', lines: [{ name: 'りんご', amount: 390 }, { name: '葉物野菜', amount: 180, outcome: '期限切れ' }] }
  ];
  const recurring = [
    { id: 1, name: '通信費', amount: 3300, method: 'JCB W', start: '2026-11-10', interval: 1, active: true },
    { id: 2, name: '水道代', amount: 4200, method: '基準口座', start: '2026-11-25', interval: 2, active: true }
  ];
  const statuses = { pending: '未確認', accepted: '確認済み', ignored: '無視' };
  const reasons = ['期限切れ', '使わなかった', '買いすぎ', '好みでなかった'];
  const methods = ['現金', 'カード', '電子マネー', '不明'];
  const spaces = { personal: ['あなた（所有者）'], family: ['あなた（所有者）', '家族（サンプル）'] };
  let space = 'family';
  let receiptStatus = 'pending';
  let reviewMonth = '2026-11';
  let nextReceipt = 3;
  let nextRecurring = 3;
  let submitEditor;
  const options = (values, current) => values.map(value =>
    `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(value)}</option>`).join('');

  function openEditor(title, fields, save) {
    editor.querySelector('h2').textContent = title;
    form.innerHTML = fields + '<button class="primary-button" type="submit">保存</button><button class="text-button" type="button" data-extra-close>キャンセル</button>';
    submitEditor = save;
    editor.showModal();
  }
  editor.addEventListener('click', event => {
    if (event.target.closest('[data-extra-close]')) editor.close();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (submitEditor(new FormData(form)) === false) return;
    editor.close();
    toast('保存しました');
  });

  function renderReceipts() {
    const rows = receipts.filter(item => item.status === receiptStatus).sort((a,b) => b.date.localeCompare(a.date));
    $('#receipts-screen').innerHTML = `
      <div class="plan-toolbar extra-toolbar"><label>状態 <select id="receipt-status">${Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${key === receiptStatus ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="primary-button" data-receipt="add">追加</button></div>
      ${rows.map(item => `<article class="sheet"><div class="plan-toolbar"><h2>${esc(item.store)}</h2><strong>${yen(item.lines.reduce((sum, line) => sum + line.amount, 0))}</strong></div><p class="support">${item.date.replaceAll('-', '/')} · ${esc(item.method)} · ${item.lines.length}品</p>
      <details class="extra-lines"><summary>明細</summary><dl class="ledger">${item.lines.map(line => `<div><dt>${esc(line.name)}${line.inventory ? ' · 在庫登録済み' : ''}</dt><dd>${yen(line.amount)}</dd></div>`).join('')}</dl></details>
      <div class="mail-actions extra-actions">${item.status !== 'accepted' ? `<button class="text-button" data-receipt="accept" data-id="${item.id}">確認済みにする</button>` : ''}<button class="text-button" data-receipt="inventory" data-id="${item.id}">在庫に入れる</button><button class="text-button" data-receipt="edit" data-id="${item.id}">編集</button><button class="text-button" data-receipt="delete" data-id="${item.id}">削除</button></div></article>`).join('') || '<p class="sheet support">レシートなし</p>'}`;
  }
  function receiptLine(line = {}) {
    return `<fieldset class="receipt-fields mail-fields"><legend>明細</legend><label>商品名<input name="product" maxlength="40" required value="${esc(line.name ?? '')}"></label><label>金額<input name="price" type="number" step="1" inputmode="numeric" required value="${line.amount ?? ''}"></label><button type="button" class="text-button" data-remove-line>明細を削除</button></fieldset>`;
  }
  form.addEventListener('click', event => {
    if (event.target.closest('[data-add-line]')) $('#extra-lines').insertAdjacentHTML('beforeend', receiptLine());
    const line = event.target.closest('[data-remove-line]')?.closest('fieldset');
    if (line && form.querySelectorAll('.receipt-fields').length > 1) line.remove();
  });
  $('#receipts-screen').addEventListener('change', event => {
    if (event.target.id === 'receipt-status') { receiptStatus = event.target.value; renderReceipts(); }
  });
  $('#receipts-screen').addEventListener('click', event => {
    const button = event.target.closest('[data-receipt]');
    if (!button) return;
    const item = receipts.find(receipt => receipt.id === Number(button.dataset.id));
    const action = button.dataset.receipt;
    if (action === 'add' || action === 'edit') {
      openEditor(item ? 'レシートを編集' : 'レシートを追加', `
        <label>店名<input name="store" required maxlength="40" value="${esc(item?.store ?? '')}"></label><label>購入日<input name="date" type="date" required value="${item?.date ?? '2026-11-09'}"></label>
        <label>支払い方法<select name="method">${options(methods, item?.method)}</select></label>
        <label>状態<select name="status">${Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${key === item?.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <div id="extra-lines">${(item?.lines ?? [{}]).map(receiptLine).join('')}</div><button type="button" class="text-button" data-add-line>明細を追加</button>`, data => {
        const products = data.getAll('product').map(name => name.trim());
        const store = data.get('store').trim();
        if (!store || products.some(name => !name)) return false;
        const prices = data.getAll('price').map(Number);
        const lines = products.map((name, i) => ({ ...item?.lines.find(line => line.name === name && line.amount === prices[i]), name, amount: prices[i] }));
        const values = { store, date: data.get('date'), method: data.get('method'), status: data.get('status'), lines };
        if (item) Object.assign(item, values);
        else receipts.push({ id: nextReceipt++, ...values });
        receiptStatus = values.status;
        renderReceipts();
      });
    } else if (action === 'delete' && window.confirm('レシートを削除しますか？')) {
      receipts.splice(receipts.indexOf(item), 1);
      renderReceipts();
      toast('削除しました');
    } else if (action === 'accept') {
      item.status = 'accepted';
      renderReceipts();
      toast('確認済みにしました');
    } else if (action === 'inventory') {
      const eligible = item.lines.filter(line => line.amount > 0 && !line.inventory);
      if (!eligible.length) return toast('追加できる商品はありません');
      openEditor('在庫に入れる', `<label>商品<select name="product">${eligible.map((line, i) => `<option value="${i}">${esc(line.name)}</option>`).join('')}</select></label><label>保管場所<select name="location">${options(['冷蔵庫','冷凍庫','棚'])}</select></label>`, data => {
        eligible[Number(data.get('product'))].inventory = data.get('location');
        renderReceipts();
      });
    }
  });

  function renderReview() {
    const months = [...new Set(['2026-11', '2026-10', reviewMonth, ...receipts.map(item => item.date.slice(0, 7))])].sort().reverse();
    const rows = receipts.filter(item => item.status === 'accepted' && item.date.startsWith(reviewMonth)).flatMap(item =>
      item.lines.map((line, index) => ({ item, line, index })).filter(({ line }) => line.amount > 0));
    const wasted = rows.filter(({ line }) => reasons.includes(line.outcome));
    const wasteTotal = wasted.reduce((sum, { line }) => sum + Math.floor(line.amount * (line.outcome === '買いすぎ' ? .5 : 1)), 0);
    $('#review-screen').innerHTML = `<div class="extra-toolbar"><label>対象月 <select id="review-month">${options(months, reviewMonth)}</select></label></div>
      <section class="sheet"><div class="plan-toolbar"><h2>ムダ支出</h2><strong class="negative">${yen(wasteTotal)}</strong></div><p class="support">${wasted.length}品</p></section>
      <section class="sheet"><h2>買ったもの</h2>${rows.map(({ item, line, index }) => `<article class="plan-row"><div class="plan-toolbar"><strong>${esc(line.name)}</strong><strong>${yen(line.amount)}</strong></div><p class="support">${esc(item.store)} · ${esc(line.outcome || '未確認')}</p><label>結果 <select data-review-id="${item.id}" data-line="${index}">${options(['未確認', '使った', 'まだある', '捨てた'], reasons.includes(line.outcome) ? '捨てた' : line.outcome || '未確認')}</select></label></article>`).join('') || '<p class="support">対象なし</p>'}</section>`;
  }
  $('#review-screen').addEventListener('change', event => {
    const select = event.target;
    if (select.id === 'review-month') { reviewMonth = select.value; renderReview(); return; }
    if (!select.dataset.reviewId) return;
    const line = receipts.find(item => item.id === Number(select.dataset.reviewId)).lines[Number(select.dataset.line)];
    if (select.value === '捨てた') {
      renderReview();
      openEditor('捨てた理由', `<label>理由<select name="reason">${options(reasons, line.outcome)}</select></label>`, data => {
        line.outcome = data.get('reason');
        renderReview();
      });
      return;
    }
    line.outcome = select.value;
    renderReview();
    toast('保存しました');
  });

  const intervalLabel = n => n === 1 ? '毎月' : n === 2 ? '隔月' : n + 'か月ごと';
  function renderRecurring() {
    $('#recurring-screen').innerHTML = `<div class="extra-toolbar"><button type="button" class="primary-button" data-repeat="add">定期支払いを追加</button></div>
      ${recurring.map(item => `<article class="sheet"><div class="plan-toolbar"><h2>${esc(item.name)}</h2><strong>${yen(item.amount)}</strong></div><p class="support">${intervalLabel(item.interval)} · ${esc(item.method)}${item.active ? '' : ' · 停止中'}</p>
      <div class="mail-actions extra-actions"><button class="text-button" data-repeat="edit" data-id="${item.id}">編集</button><button class="text-button" data-repeat="toggle" data-id="${item.id}">${item.active ? '停止' : '再開'}</button></div></article>`).join('') || '<p class="sheet support">定期支払いなし</p>'}`;
  }
  $('#recurring-screen').addEventListener('click', event => {
    const button = event.target.closest('[data-repeat]');
    if (!button) return;
    const item = recurring.find(row => row.id === Number(button.dataset.id));
    if (button.dataset.repeat === 'toggle') {
      item.active = !item.active;
      renderRecurring();
      toast(item.active ? '再開しました' : '停止しました');
      return;
    }
    openEditor(item ? '定期支払いを編集' : '定期支払いを追加', `<label>名前<input name="name" required maxlength="40" value="${esc(item?.name ?? '')}"></label><label>見込み金額<input name="amount" type="number" min="1" step="1" inputmode="numeric" required value="${item?.amount ?? ''}"></label>
      <label>支払い方法<select name="method">${options(['基準口座','JCB W','三井住友','MUFG'], item?.method)}</select></label><label>開始日<input name="start" type="date" required value="${item?.start ?? '2026-11-09'}"></label>
      <label>間隔<select name="interval">${Array.from({length:12}, (_, i) => `<option value="${i + 1}" ${item?.interval === i + 1 ? 'selected' : ''}>${intervalLabel(i + 1)}</option>`).join('')}</select></label>`, data => {
      const name = data.get('name').trim();
      if (!name) return false;
      const values = { name, amount: Number(data.get('amount')), method: data.get('method'), start: data.get('start'), interval: Number(data.get('interval')) };
      if (item) Object.assign(item, values);
      else recurring.push({ id: nextRecurring++, active: true, ...values });
      renderRecurring();
    });
  });

  function renderSettings() {
    const opened = new Set([...$('#settings-screen').querySelectorAll('details[open]')].map(item => item.dataset.section));
    $('#settings-screen').innerHTML = `
      <details class="sheet" data-section="calculation" ${opened.has('calculation') ? 'open' : ''}><summary>計算設定</summary><form class="mail-fields" data-settings="calculation"><label>最低限残す金額<input name="reserve" type="number" min="0" step="1" required value="${settings.reserve}"></label><label>支払いの予測期間<select name="horizon">${[30,60,90,180].map(days => `<option value="${days}" ${days === settings.horizon ? 'selected' : ''}>${days}日間</option>`).join('')}</select></label><label>ふりかえりを始める曜日<select name="reviewDay">${[...'日月火水木金土'].map((day, i) => `<option value="${i}" ${i === settings.reviewDay ? 'selected' : ''}>${day}曜日</option>`).join('')}</select></label><button class="primary-button">保存</button></form></details>
      <details class="sheet" data-section="wage" ${opened.has('wage') ? 'open' : ''}><summary>給与設定</summary><form class="mail-fields" data-settings="wage"><label>基本時給<input name="rate" type="number" min="0" step="1" required value="${settings.rate}"></label><label>給料日<input name="payday" type="number" min="1" max="31" step="1" required value="${settings.payday}"></label><label>給与の入金口座<select name="deposit">${options(['基準口座','貯蓄口座'], settings.deposit)}</select></label><button class="primary-button">保存</button></form></details>
      <details class="sheet" data-section="sharing" ${opened.has('sharing') ? 'open' : ''}><summary>家計共有</summary><div class="mail-fields"><label>共有スペース<select id="preview-space"><option value="family" ${space === 'family' ? 'selected' : ''}>家族の家計</option><option value="personal" ${space === 'personal' ? 'selected' : ''}>個人の家計</option></select></label><ul class="extra-members">${spaces[space].map((member, i) => `<li class="plan-toolbar"><span>${esc(member)}</span>${i ? `<button type="button" class="text-button" data-remove-member="${i}">削除</button>` : ''}</li>`).join('')}</ul><button type="button" class="text-button" data-add-member>メンバーを追加</button></div></details>
      <details class="sheet" data-section="backup" ${opened.has('backup') ? 'open' : ''}><summary>バックアップ・復元</summary><div class="mail-fields"><button type="button" class="text-button" data-export-settings>試作の設定を書き出す</button><label>試作の設定を復元<input type="file" id="settings-import" accept=".json,application/json"></label></div></details>`;
  }
  const settingsScreen = $('#settings-screen');
  function settingsChanged() { document.dispatchEvent(new Event('preview-settings-change')); }
  settingsScreen.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.target);
    for (const [key, value] of data) settings[key] = key === 'deposit' ? value : Number(value);
    settingsChanged();
    toast('保存しました');
  });
  settingsScreen.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-member]');
    if (remove && window.confirm('メンバーを削除しますか？')) {
      spaces[space].splice(Number(remove.dataset.removeMember), 1);
      renderSettings();
      toast('削除しました');
    }
    if (event.target.closest('[data-add-member]')) {
      openEditor('メンバーを追加', '<label>メンバーID<input name="member" maxlength="40" required></label>', data => {
        const member = data.get('member').trim();
        if (!member || spaces[space].includes(member)) return false;
        spaces[space].push(member);
        renderSettings();
      });
    }
    if (event.target.closest('[data-export-settings]')) {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'money-ui-settings-v1', settings }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'money-preview-settings.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('書き出しました');
    }
  });
  settingsScreen.addEventListener('change', async event => {
    if (event.target.id === 'preview-space') { space = event.target.value; renderSettings(); return; }
    if (event.target.id !== 'settings-import' || !event.target.files.length) return;
    try {
      const file = event.target.files[0];
      if (file.size > 16384) throw new Error();
      const { format, settings: values } = JSON.parse(await file.text());
      if (format !== 'money-ui-settings-v1' || !values ||
          !Number.isSafeInteger(values.reserve) || values.reserve < 0 ||
          ![30, 60, 90, 180].includes(values.horizon) ||
          !Number.isInteger(values.reviewDay) || values.reviewDay < 0 || values.reviewDay > 6 ||
          !Number.isSafeInteger(values.rate) || values.rate < 0 ||
          !Number.isInteger(values.payday) || values.payday < 1 || values.payday > 31 ||
          !['基準口座','貯蓄口座'].includes(values.deposit)) throw new Error();
      if (!window.confirm('試作の設定を復元しますか？')) { event.target.value = ''; return; }
      for (const key of Object.keys(settings)) settings[key] = values[key];
      renderSettings();
      settingsChanged();
      toast('復元しました');
    } catch {
      event.target.value = '';
      toast('試作の設定ファイルを読み込めません');
    }
  });
  window.moneyExtras = { receipts: renderReceipts, review: renderReview, recurring: renderRecurring, settings: renderSettings, reserve: () => settings.reserve, hourlyRate: () => settings.rate, horizon: () => settings.horizon };
})();
