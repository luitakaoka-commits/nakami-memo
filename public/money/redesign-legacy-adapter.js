/* 旧データから検証用シナリオを構築する。読み取り専用・本番未接続。 */
(function attach(root) {
  'use strict';
  const engine = typeof module !== 'undefined' && module.exports ? require('./finance-engine.js') : root.FinanceEngine;
  function buildLegacyScenario(state, today, endDate) {
    if (!state || !Array.isArray(state.accounts) || !Array.isArray(state.transactions) || !Array.isArray(state.cards) || !Array.isArray(state.recurringPlans)) throw new Error('旧データの必要な一覧が不足しています');
    const accountIds = new Set();
    const accounts = state.accounts.map(account => {
      if (!account.id || accountIds.has(account.id) || !Number.isSafeInteger(account.currentBalance)) throw new Error('旧口座の識別子または残高が不正です');
      accountIds.add(account.id);
      return { id: account.id, balance: account.currentBalance, balanceVerified: false };
    });
    if (!accounts.length) throw new Error('旧口座がありません');
    const cards = new Map();
    for (const card of state.cards) {
      if (!card.id || cards.has(card.id) || !accountIds.has(card.accountId)) throw new Error('カードの引落口座または識別子を確認してください');
      cards.set(card.id, card);
    }
    const issues = [{ type: 'legacy_evidence_unverified' }];
    if (state.recurringPlans.some(plan => plan?.isActive !== false)) issues.push({ type: 'recurring_plans_not_mapped' });
    const ids = new Set(), cardTransactions = [], events = [];
    for (const item of state.transactions) {
      if (!item || !item.id || ids.has(item.id)) throw new Error('旧取引の識別子が不正または重複しています');
      ids.add(item.id);
      if (!['planned', 'settled', 'cancelled', 'absorbed'].includes(item.status)) throw new Error('旧取引の状態が不明です');
      if (item.status === 'settled' && item.dueDate > today) throw new Error('未来の取引が実行済みです');
      if (item.status !== 'planned') continue;
      if (item.affectsForecast === false) { issues.push({ type: 'excluded_transaction', id: item.id }); continue; }
      if (!Number.isSafeInteger(item.amount) || item.amount < 0) throw new Error('旧取引の金額を確認してください');
      if (item.cardId) {
        if (item.kind !== 'payment' || !cards.has(item.cardId)) throw new Error('カード取引の種類またはカードを確認してください');
        cardTransactions.push(item);
        continue;
      }
      const base = { id: `legacy:${item.id}`, date: item.dueDate, status: 'planned', amount: item.amount, accountId: item.sourceAccountId };
      if (item.kind === 'income' || item.kind === 'reimbursement') events.push({ ...base, kind: 'income' });
      else if (item.kind === 'payment') events.push({ ...base, kind: 'expense', amountConfirmed: false });
      else if (['transfer', 'saving', 'nisa'].includes(item.kind)) {
        if (item.destinationAccountId && item.transferType !== 'external') events.push({ ...base, kind: 'transfer', toAccountId: item.destinationAccountId });
        else events.push({ ...base, kind: 'expense', amountConfirmed: false });
      } else throw new Error('旧取引の種類を確認してください');
    }
    const groups = engine.groupCardCharges(cardTransactions, state.cards, state.settings?.holidayOverrides ? { overrides: state.settings.holidayOverrides } : {});
    for (const group of groups) {
      if (group.statements.length > 1) throw new Error('同じ請求期間に複数の総額があります');
      const dates = new Set([...group.adopted, ...group.suppressed].map(item => item.dueDate));
      if (dates.size !== 1 || !group.dueDate) throw new Error('カードの引落日が一致しません');
      if (!Number.isSafeInteger(group.adoptedTotal) || !Number.isSafeInteger(group.suppressedTotal)) throw new Error('カード請求額が不正です');
      events.push({ id: `legacy-card:${group.key}`, date: group.dueDate, status: 'planned', amount: group.adoptedTotal, accountId: group.accountId, kind: 'expense', cardPayment: true, amountConfirmed: false, additionalPossible: group.suppressedTotal });
      issues.push({ type: 'card_group_unverified', cardId: group.cardId, cycle: group.billingCycle });
    }
    return { scenario: { today, endDate, coverageVerified: false, accounts, events }, issues };
  }
  const api = { buildLegacyScenario };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignLegacyAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
