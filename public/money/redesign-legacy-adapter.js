/* 旧データから検証用シナリオを構築する。読み取り専用・本番未接続。 */
(function attach(root) {
  'use strict';
  const engine = typeof module !== 'undefined' && module.exports ? require('./finance-engine.js') : root.FinanceEngine;
  function buildLegacyScenario(state, today, endDate, options = {}) {
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
    if (options.candidates === undefined) issues.push({ type: 'mail_candidates_unavailable' });
    else {
      if (!Array.isArray(options.candidates)) throw new Error('メール候補の一覧が不正です');
      const seenCandidates = new Set();
      const transactionIds = new Set(state.transactions.map(item => item?.id));
      for (const candidate of options.candidates) {
        if (!candidate || typeof candidate.id !== 'string' || !candidate.id || seenCandidates.has(candidate.id)) throw new Error('メール候補の識別子が不正または重複しています');
        seenCandidates.add(candidate.id);
        if (['pending', 'needs_review'].includes(candidate.status)) issues.push({ type: 'mail_candidate_unreviewed', id: candidate.id });
        else if (candidate.status === 'accepted' && !transactionIds.has(`mail_${candidate.id}`)) issues.push({ type: 'accepted_mail_without_transaction', id: candidate.id });
        else if (!['accepted', 'ignored'].includes(candidate.status)) issues.push({ type: 'mail_candidate_status_unknown', id: candidate.id });
      }
    }
    const planIds = new Set(), mappedPlans = [];
    for (const plan of state.recurringPlans) {
      if (!plan || !plan.id || planIds.has(plan.id)) throw new Error('定期予定の識別子が不正または重複しています');
      planIds.add(plan.id);
      if (plan.isActive === false) continue;
      if (!Number.isInteger(plan.dayOfMonth) || plan.dayOfMonth < 1 || plan.dayOfMonth > 31 || (plan.intervalMonths != null && plan.intervalMonths !== 1) || !Number.isSafeInteger(plan.amount) || plan.amount < 0 || plan.cardId) {
        issues.push({ type: 'recurring_plans_not_mapped', id: plan.id });
        continue;
      }
      if (!plan.amount) issues.push({ type: 'recurring_amount_unknown', id: plan.id });
      mappedPlans.push(plan);
    }
    const virtual = engine.expandScheduledTransactions(mappedPlans, today, endDate, state.transactions);
    const ids = new Set(), cardTransactions = [], events = [];
    const salaryMonths = new Set(), recurringDates = new Set();
    for (const item of state.transactions) {
      if (item?.recurringPlanId && item.status !== 'cancelled') {
        const key = JSON.stringify([item.recurringPlanId, item.dueDate]);
        if (recurringDates.has(key)) throw new Error('同じ日の定期支払いが重複しています');
        recurringDates.add(key);
      }
      if (!item?.salaryPaymentMonth || item.status === 'cancelled') continue;
      if (salaryMonths.has(item.salaryPaymentMonth)) throw new Error('同じ月の給与記録が重複しています');
      salaryMonths.add(item.salaryPaymentMonth);
    }
    for (const item of [...state.transactions, ...virtual]) {
      if (!item || !item.id || ids.has(item.id)) throw new Error('旧取引の識別子が不正または重複しています');
      ids.add(item.id);
      if (!['planned', 'settled', 'cancelled', 'absorbed'].includes(item.status)) throw new Error('旧取引の状態が不明です');
      if (item.status === 'settled' && item.dueDate > today) throw new Error('未来の取引が実行済みです');
      if (item.status !== 'planned') continue;
      if (item.affectsForecast === false) { issues.push({ type: 'excluded_transaction', id: item.id }); continue; }
      if (!Number.isSafeInteger(item.amount)) throw new Error('旧取引の金額を確認してください');
      if (item.amount < 0 && item.kind === 'payment') {
        if (item.cardId && !cards.has(item.cardId)) throw new Error('返金先のカードを確認してください');
        // 元の購入・請求との対応が分からない返金は請求を勝手に減らさない。
        issues.push({ type: 'legacy_refund_unverified', id: item.id });
        continue;
      }
      if (item.amount < 0 && item.kind !== 'adjustment') throw new Error('旧取引の金額を確認してください');
      if (item.cardId) {
        if (item.kind !== 'payment' || !cards.has(item.cardId)) throw new Error('カード取引の種類またはカードを確認してください');
        cardTransactions.push(item);
        continue;
      }
      const base = { id: `legacy:${item.id}`, date: item.dueDate, status: 'planned', amount: Math.abs(item.amount), accountId: item.sourceAccountId };
      if (item.kind === 'income' || item.kind === 'reimbursement') events.push({ ...base, kind: 'income' });
      else if (item.kind === 'adjustment') events.push(item.amount < 0 ? { ...base, kind: 'income' } : { ...base, kind: 'expense', amountConfirmed: false });
      else if (item.kind === 'payment') events.push({ ...base, kind: 'expense', amountConfirmed: false });
      else if (['transfer', 'saving', 'nisa'].includes(item.kind)) {
        if (item.destinationAccountId && item.transferType !== 'external') events.push({ ...base, kind: 'transfer', toAccountId: item.destinationAccountId });
        else events.push({ ...base, kind: 'expense', amountConfirmed: false });
      } else throw new Error('旧取引の種類を確認してください');
    }
    const namedCards = state.cards.map(card => {
      if (typeof card.name === 'string' && card.name.trim()) return card;
      issues.push({ type: 'card_name_missing', cardId: card.id });
      return { ...card, name: card.id };
    });
    const groups = engine.groupCardCharges(cardTransactions, namedCards, state.settings?.holidayOverrides ? { overrides: state.settings.holidayOverrides } : {});
    for (const group of groups) {
      if (group.statements.length > 1) throw new Error('同じ請求期間に複数の総額があります');
      const dates = new Set([...group.adopted, ...group.suppressed].map(item => item.dueDate));
      if (dates.size !== 1 || !group.dueDate) throw new Error('カードの引落日が一致しません');
      if (!Number.isSafeInteger(group.adoptedTotal) || !Number.isSafeInteger(group.suppressedTotal)) throw new Error('カード請求額が不正です');
      // 旧明細にはメールの重複照合や利用日時の根拠が保存されていない。
      // 総額が無い場合、明細合計を確定額とせず上限側に残す。
      const detailsOnly = group.source === 'itemized';
      events.push({ id: `legacy-card:${group.key}`, date: group.dueDate, status: 'planned', amount: detailsOnly ? 0 : group.adoptedTotal, accountId: group.accountId, kind: 'expense', cardPayment: true, amountConfirmed: false, additionalPossible: detailsOnly ? group.adoptedTotal : group.suppressedTotal });
      if (detailsOnly) issues.push({ type: 'legacy_card_details_unverified', cardId: group.cardId, cycle: group.billingCycle });
      issues.push({ type: 'card_group_unverified', cardId: group.cardId, cycle: group.billingCycle });
    }
    if (!Array.isArray(state.workEntries) || !state.settings?.wage) issues.push({ type: 'salary_data_missing' });
    else {
      const wage = state.settings.wage;
      const recordedMonths = engine.salaryMonthsOutsideForecast(state.transactions, wage);
      const forecasts = engine.collectSalaryEvents(state.workEntries, wage, today, endDate, { overrides: state.settings.holidayOverrides || {}, recordedMonths });
      if (forecasts.length && !accountIds.has(wage.depositAccountId)) issues.push({ type: 'salary_account_unknown' });
      else for (const salary of forecasts) events.push({ id: `legacy-salary:${salary.paymentMonth}`, date: salary.paymentDate, status: 'planned', amount: salary.totalAmount, accountId: wage.depositAccountId, kind: 'income' });
    }
    return { scenario: { today, endDate, coverageVerified: false, accounts, events }, issues };
  }
  const api = { buildLegacyScenario };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignLegacyAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
