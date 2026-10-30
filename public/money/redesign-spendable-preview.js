/* 旧式の補助額を締め日に合わせて比較する試作。画面には接続しない。 */
(function attach(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const engine = node ? require('./finance-engine.js') : root.FinanceEngine;
  const deadlines = node ? require('./redesign-deadline.js') : root.RedesignDeadline;
  const legacy = node ? require('./redesign-legacy-adapter.js') : root.RedesignLegacyAdapter;
  function previewSpendable({ state, today, selectedCardIds, candidates, reserve = 0 }) {
    if (!Number.isSafeInteger(reserve) || reserve < 0) throw new Error('予備額を確認してください');
    const period = deadlines.periodForCards({ today, cards: state?.cards, selectedCardIds });
    const checked = legacy.buildLegacyScenario(state, today, period.deadline, { candidates });
    const wage = state.settings?.wage || {};
    const result = engine.calculateSpendableAmount({
      today, deadline: period.deadline, accounts: state.accounts,
      cards: state.cards.map(card => ({ ...card, name: typeof card.name === 'string' && card.name.trim() ? card.name : card.id })),
      transactions: state.transactions, recurringPlans: state.recurringPlans,
      workEntries: state.workEntries || [], wage,
      defenseLine: reserve, includeSalary: wage.includeForecastInSpendable !== false,
      holidayOptions: { overrides: state.settings?.holidayOverrides || {} }
    });
    if (!Number.isSafeInteger(result.total)) throw new Error('試算額を確認してください');
    // 旧計算の数値は未照合のままなので、使ってよい額として表示しない。
    return { period, status: 'review', referenceOnly: true, result, issues: checked.issues };
  }
  const api = { previewSpendable };
  if (node) module.exports = api;
  root.RedesignSpendablePreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
