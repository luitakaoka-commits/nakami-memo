/* 請求確定と口座引落を分ける検証用ロジック。本番データには未接続。 */
(function attach(root) {
  'use strict';
  const dateValid = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  function validate(state) {
    const { account, bill } = state || {};
    if (!account?.id || !Number.isSafeInteger(account.balance) || !Number.isSafeInteger(account.revision) || account.revision < 0) throw new Error('口座が不正です');
    if (!bill?.id || bill.accountId !== account.id || !Number.isSafeInteger(bill.amount) || bill.amount < 0 || !['planned', 'settled'].includes(bill.status)) throw new Error('請求が不正です');
    return { account, bill };
  }
  function confirmBill(state, evidence) {
    const { account, bill } = validate(state);
    if (bill.status !== 'planned') throw new Error('引落済みの請求は直接変更できません');
    if (!evidence || evidence.issuerConfirmed !== true || !Number.isSafeInteger(evidence.amount) || evidence.amount < 0) throw new Error('カード会社の確定額を確認してください');
    return { account: { ...account }, bill: { ...bill, amount: evidence.amount, amountConfirmed: true } };
  }
  function recordDebit(state, input) {
    const { account, bill } = validate(state);
    if (!input?.operationId || typeof input.operationId !== 'string') throw new Error('処理の識別子が必要です');
    if (bill.status === 'settled') {
      if (bill.settlement?.operationId === input.operationId && bill.settlement.amount === input.amount && bill.settlement.date === input.date && bill.settlement.balanceAlreadyIncludesDebit === input.balanceAlreadyIncludesDebit) return { account: { ...account }, bill: { ...bill }, alreadyApplied: true };
      throw new Error('既に引落済みです。内容の違いを確認してください');
    }
    if (bill.amountConfirmed !== true || input.bankConfirmed !== true || input.amount !== bill.amount) throw new Error('請求額と実際の引落額を確認してください');
    if (!dateValid(input.today) || !dateValid(input.date) || input.date > input.today) throw new Error('引落日を確認してください');
    if (typeof input.balanceAlreadyIncludesDebit !== 'boolean') throw new Error('残高に引落が反映済みか確認してください');
    if (input.expectedRevision !== account.revision) throw new Error('口座の残高が更新されました。確認してからやり直してください');
    const newBalance = input.balanceAlreadyIncludesDebit ? account.balance : account.balance - input.amount;
    if (!Number.isSafeInteger(newBalance) || !Number.isSafeInteger(account.revision + 1)) throw new Error('計算可能な金額の範囲を超えています');
    return {
      account: { ...account, balance: newBalance, revision: account.revision + 1 },
      bill: { ...bill, status: 'settled', settlement: { operationId: input.operationId, amount: input.amount, date: input.date, balanceAlreadyIncludesDebit: input.balanceAlreadyIncludesDebit } },
      alreadyApplied: false
    };
  }
  const api = { confirmBill, recordDebit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignBillLifecycle = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
