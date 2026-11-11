(() => {
  'use strict';
  const dialog = document.querySelector('#operation-dialog');
  const form = dialog.querySelector('form');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = value => {
    const [, month, day] = value.split('-');
    return Number(month) + '月' + Number(day) + '日';
  };
  const yen = value => Math.abs(value).toLocaleString('ja-JP') + '円';
  function box(message, label = '説明') {
    return `<details class="operation-note">
      <summary class="note-toggle"><span class="note-mark" aria-hidden="true">!</span><span>${escape(label)}</span></summary>
      <div class="note-glass"><p>${escape(message)}</p></div>
    </details>`;
  }
  let onConfirm;
  function confirm({ title, message, action, choices, commit }) {
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('#operation-message').textContent = message;
    const choice = form.elements.reflected;
    choice.closest('label').hidden = !choices;
    choice.disabled = !choices;
    choice.replaceChildren(new Option('選択してください', ''), ...(choices ?? []).map(([value, label]) => new Option(label, value)));
    form.querySelector('[type="submit"]').textContent = action;
    onConfirm = commit;
    dialog.showModal();
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const commit = onConfirm;
    const value = form.elements.reflected.value;
    dialog.close();
    commit(value);
  });
  dialog.querySelector('[data-operation-cancel]').addEventListener('click', () => dialog.close());
  window.moneyNotice = { box, confirm, date, yen };
})();
