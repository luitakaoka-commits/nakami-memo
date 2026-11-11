/* 請求引落と残高の同時保存の試作。現行データ・画面には未接続。 */
(function attach(root) {
  'use strict';
  const lifecycle = typeof module !== 'undefined' && module.exports ? require('./redesign-bill-lifecycle.js') : root.RedesignBillLifecycle;
  async function confirmBillGuarded({ db, ref, uid, billId, expectedRevision, evidence, runTransaction }) {
    if (!db || !ref || typeof runTransaction !== 'function' || typeof uid !== 'string' || !uid.trim() ||
        typeof billId !== 'string' || !billId.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER || !evidence) throw new Error('保存条件を確認してください');
    const proof = structuredClone(evidence);
    if (typeof proof.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(proof.checkedAt) || !Number.isFinite(Date.parse(proof.checkedAt)) ||
        !['issuer-app', 'issuer-statement'].includes(proof.source)) throw new Error('請求額を確認した日時と取得元が必要です');
    const calendarDate = proof.checkedAt.slice(0, 10);
    if (new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDate) throw new Error('請求額の確認日が不正です');
    return runTransaction(db, async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('家計が見つかりません');
      const data = snapshot.data(), state = data.state;
      if (data.revision !== expectedRevision) throw new Error('他端末で更新されました');
      if (!state || !Array.isArray(state.accounts) || !Array.isArray(state.bills)) throw new Error('口座と請求を確認してください');
      const bills = state.bills.filter(item => item?.id === billId);
      if (bills.length !== 1) throw new Error('請求の識別子を確認してください');
      const bill = bills[0];
      if (typeof bill.cardId !== 'string' || !bill.cardId.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(bill.cycle || '') ||
          proof.cardId !== bill.cardId || proof.cycle !== bill.cycle) throw new Error('確定額のカードと請求期間が一致しません');
      const accounts = state.accounts.filter(item => item?.id === bill.accountId);
      if (accounts.length !== 1) throw new Error('引落口座を確認してください');
      const result = lifecycle.confirmBill({ account: accounts[0], bill }, proof);
      const confirmedBill = { ...result.bill, confirmationEvidence: { cardId: proof.cardId, cycle: proof.cycle, checkedAt: proof.checkedAt, source: proof.source } };
      const revision = expectedRevision + 1;
      tx.update(ref, { state: { ...state, bills: state.bills.map(item => item.id === billId ? confirmedBill : item) }, revision, updatedBy: uid });
      return { revision };
    });
  }
  async function recordDebitGuarded({ db, ref, uid, billId, expectedRevision, input, runTransaction }) {
    if (!db || !ref || typeof runTransaction !== 'function' || typeof uid !== 'string' || !uid.trim() || typeof billId !== 'string' || !billId.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER || !input || typeof input !== 'object') throw new Error('保存条件を確認してください');
    const request = structuredClone(input);
    return runTransaction(db, async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('家計が見つかりません');
      const data = snapshot.data(), state = data.state;
      if (!state || !Array.isArray(state.accounts) || !Array.isArray(state.bills)) throw new Error('口座と請求を確認してください');
      const bills = state.bills.filter(item => item?.id === billId);
      if (bills.length !== 1) throw new Error('請求の識別子を確認してください');
      const accounts = state.accounts.filter(item => item?.id === bills[0].accountId);
      if (accounts.length !== 1) throw new Error('引落口座を確認してください');
      const result = lifecycle.recordDebit({ account: accounts[0], bill: bills[0] }, request);
      if (result.alreadyApplied) return { alreadyApplied: true, revision: data.revision };
      if (data.revision !== expectedRevision) throw new Error('他端末で更新されました');
      const revision = expectedRevision + 1;
      tx.update(ref, { state: { ...state, accounts: state.accounts.map(item => item.id === result.account.id ? result.account : item), bills: state.bills.map(item => item.id === billId ? result.bill : item) }, revision, updatedBy: uid });
      return { alreadyApplied: false, revision };
    });
  }
  const api = { confirmBillGuarded, recordDebitGuarded };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignBillStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
