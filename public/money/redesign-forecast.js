/* 90日間の統合検証用。本番データ・画面には未接続。 */
(function attach(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const recurring = node ? require('./redesign-recurring.js') : root.RedesignRecurring;
  const cashflow = node ? require('./redesign-cashflow-composition.js') : root.RedesignCashflowComposition;
  function forecast90(input = {}) {
    if (typeof input.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.today)) throw new Error('試算開始日が不正です');
    const date = new Date(`${input.today}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.today) throw new Error('試算開始日が不正です');
    date.setUTCDate(date.getUTCDate() + 89);
    const endDate = date.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Array.isArray(input.recurringPlans) || !Array.isArray(input.otherEvents)) throw new Error('試算期間または定期予定が不正です');
    const planIds = new Set(), generated = [];
    for (const plan of input.recurringPlans) {
      if (!plan || !plan.id || planIds.has(plan.id)) throw new Error('定期予定の識別子が不正または重複しています');
      planIds.add(plan.id);
      generated.push(...recurring.generateRecurring(plan, input.today, endDate, input.otherEvents));
    }
    const result = cashflow.evaluateCashflow({ ...input, endDate, otherEvents: [...input.otherEvents, ...generated] });
    return { ...result, today: input.today, endDate, generated };
  }
  const api = { forecast90 };
  if (node) module.exports = api;
  root.RedesignForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
