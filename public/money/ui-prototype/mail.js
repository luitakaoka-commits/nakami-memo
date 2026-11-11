(() => {
  'use strict';
  const screen = document.querySelector('#mail-screen');
  const tabs = [['pending', '未取り込み'], ['accepted', '取り込み済み'], ['ignored', '無視']];
  const candidates = [
    { id: 1, status: 'pending', amount: 2480, merchant: 'スーパー', date: '2026-11-09', card: 'JCB W', type: 'itemized' },
    { id: 2, status: 'needs_review', amount: 9800, merchant: 'カード請求', date: '2026-12-10', card: '', type: '' },
    { id: 3, status: 'accepted', amount: 1200, merchant: '書店', date: '2026-11-08', card: 'JCB W', type: 'itemized' },
    { id: 4, status: 'ignored', amount: 500, merchant: 'コンビニ', date: '2026-11-07', card: '三井住友', type: 'itemized' },
  ];
  const pending = candidate => ['pending', 'needs_review'].includes(candidate.status);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const cards = ['JCB W', '三井住友', 'MUFG'];
  const cardMappings = new Map();
  let selected = 0;
  const dateLabel = type => type === 'statement' ? '引落日' : type === 'itemized' ? '利用日' : '利用日／引落日';

  function candidateRow(item) {
    const fields = pending(item) ? `
      <div class="mail-fields">
        <label>金額<input name="amount" type="number" min="1" step="1" required value="${item.amount}"></label>
        <label><span data-mail-date-label>${dateLabel(item.type)}</span><input name="date" type="date" required value="${escape(item.date)}"></label>
        <label>内容の種類<select name="type" required><option value="">種類を選択</option><option value="itemized" ${item.type === 'itemized' ? 'selected' : ''}>1件の利用</option><option value="statement" ${item.type === 'statement' ? 'selected' : ''}>請求総額</option></select></label>
        <label>利用先・メモ<input name="merchant" maxlength="40" value="${escape(item.merchant)}"></label>
        <label>取り込むカード<select name="card" required><option value="">カードを選択</option>${cards.map(card => `<option ${card === item.card ? 'selected' : ''}>${card}</option>`).join('')}</select></label>
      </div>
      <button class="text-button" type="button" data-mail-action="remember">このカードの対応を覚える</button>
      <div class="mail-actions"><button class="primary-button" type="submit">取り込む</button><button class="text-button" type="button" data-mail-action="ignore">無視</button></div>` : '';
    return `<form class="sheet mail-card" data-candidate="${item.id}">
      <strong>¥${item.amount.toLocaleString('ja-JP')}</strong>
      <p class="support">${escape(item.date)} · ${escape(item.merchant)} · ${escape(item.card || 'カード未確認')}</p>
      ${fields}<button class="text-button" type="button" data-mail-action="delete">削除</button>
    </form>`;
  }

  function updateTabs(index) {
    selected = index;
    screen.querySelectorAll('[data-mail-tab]').forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === index));
    });
    screen.querySelectorAll('.mail-panel').forEach((panel, i) => { panel.inert = i !== index; });
  }

  function render(index = 0) {
    screen.innerHTML = `<div class="mail-tabs" role="group" aria-label="メールの状態">${tabs.map(([, label], i) =>
      `<button type="button" data-mail-tab="${i}">${label}</button>`).join('')}</div>
      <div class="mail-track">${tabs.map(([status, label]) => {
        const rows = candidates.filter(item => status === 'pending' ? pending(item) : item.status === status);
        return `<section class="mail-panel" aria-label="${label}">${status === 'pending' && rows.length ? window.moneyNotice.box('まだ取り込んでいない候補は試算に含まれていません。カード、金額、日付と内容を確認してください。') : ''}${rows.map(candidateRow).join('') || '<p class="sheet">0件</p>'}</section>`;
      }).join('')}</div>${cardMappings.size ? `<div class="sheet"><h2>メールとカードの対応</h2>${[...cardMappings].map(([id, card]) => `<div class="mail-actions"><span>${escape(card)}</span><button type="button" class="text-button" data-forget-card="${id}">対応を解除</button></div>`).join('')}</div>` : ''}`;
    const track = screen.querySelector('.mail-track');
    track.scrollLeft = index * track.clientWidth;
    updateTabs(index);
    track.addEventListener('scroll', () => {
      if (track.clientWidth) updateTabs(Math.round(track.scrollLeft / track.clientWidth));
    }, { passive: true });
  }

  screen.addEventListener('input', event => {
    const form = event.target.closest('[data-candidate]');
    if (!form) return;
    const item = candidates.find(candidate => candidate.id === Number(form.dataset.candidate));
    if (event.target.name === 'amount') item.amount = Number(event.target.value);
    else if (['date', 'merchant', 'card', 'type'].includes(event.target.name)) item[event.target.name] = event.target.value;
    if (event.target.name === 'type') form.querySelector('[data-mail-date-label]').textContent = dateLabel(item.type);
  });
  function changed(message) {
    document.dispatchEvent(new CustomEvent('money-toast', { detail: message }));
    render(selected);
    document.dispatchEvent(new Event('mail-change'));
  }
  screen.addEventListener('submit', event => {
    const form = event.target.closest('[data-candidate]');
    if (!form) return;
    event.preventDefault();
    candidates.find(item => item.id === Number(form.dataset.candidate)).status = 'accepted';
    changed('取り込みました');
  });
  screen.addEventListener('click', event => {
    const tab = event.target.closest('[data-mail-tab]');
    if (tab) {
      const track = screen.querySelector('.mail-track');
      track.scrollLeft = Number(tab.dataset.mailTab) * track.clientWidth;
      updateTabs(Number(tab.dataset.mailTab));
      return;
    }
    const forget = event.target.closest('[data-forget-card]');
    if (forget) {
      cardMappings.delete(Number(forget.dataset.forgetCard));
      changed('カードの対応を解除しました');
      return;
    }
    const button = event.target.closest('[data-mail-action]');
    if (!button) return;
    const form = button.closest('[data-candidate]');
    const index = candidates.findIndex(item => item.id === Number(form.dataset.candidate));
    const item = candidates[index];
    if (button.dataset.mailAction === 'remember') {
      if (!form.elements.card.reportValidity()) return;
      cardMappings.set(item.id, item.card);
      changed('カードの対応を保存しました');
    } else if (button.dataset.mailAction === 'ignore') {
      item.status = 'ignored';
      changed('無視しました');
    } else if (window.confirm('削除しますか？')) {
      candidates.splice(index, 1);
      changed('削除しました');
    }
  });
  window.moneyMail = { open: () => render(), pendingCount: () => candidates.filter(pending).length };
})();
