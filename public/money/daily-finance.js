/* 日常画面は検証済みの口座別計算だけを使う。保存・残高変更は行わない。 */
(function attach(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const adapter = node ? require('./redesign-legacy-adapter.js') : root.RedesignLegacyAdapter;
  const readiness = node ? require('./redesign-readiness.js') : root.RedesignReadiness;
  const deadline = node ? require('./redesign-deadline.js') : root.RedesignDeadline;
  function overview({ state, today, candidates }) {
    const primary = state?.accounts?.find(a => a.isPrimary) || state?.accounts?.find(a => a.role === 'primary') || state?.accounts?.[0];
    if (!primary) throw new Error('口座を登録すると余力を試算できます。');
    const cards = state.cards || [];
    const selected = (state.settings?.deadlineCardIds || []).filter(id => cards.some(c => c.id === id));
    const defaults = cards.filter(c => c.closingDay === 15);
    const selectedCardIds = selected.length ? selected : (defaults.length ? defaults : cards).map(c => c.id);
    if (!selectedCardIds.length) throw new Error('カードの締め日を登録してください。');
    const period = deadline.periodForCards({ today, cards, selectedCardIds });
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 89);
    const endDate = end.toISOString().slice(0, 10);
    const { scenario, issues } = adapter.buildLegacyScenario(state, today, endDate, { candidates });
    // 日常画面で示す引落額と残高の前提を揃える。
    // 追加の可能額を表示するなら、その支払いを見込んだ残高を示す。
    // 確認済み扱いにはせず、元のシナリオも書き換えない。
    const displayScenario = { ...scenario, events: scenario.events.map(event => event.kind === 'expense' ? ({
      ...event, amount: event.amount + (event.additionalPossible || 0), additionalPossible: 0
    }) : ({ ...event })) };
    const assessment = readiness.calculateReadiness(displayScenario);
    const allowance = readiness.spendingAllowance(scenario, { deadline: period.deadline, accountId: primary.id, reserve: Number(state.settings?.defenseLine || 0) });
    const pending = (candidates || []).filter(c => ['pending', 'needs_review'].includes(c.status)).length;
    const unverifiedAccounts = scenario.accounts.filter(a => !a.balanceVerified).length;
    const overdue = scenario.events.filter(e => e.status === 'planned' && e.date < today).length;
    const unconfirmedBills = scenario.events.filter(e => e.cardPayment && (!e.amountConfirmed || e.additionalPossible)).length;
    return { primary, period, endDate, scenario, issues, assessment, allowance, pending, unverifiedAccounts, overdue, unconfirmedBills,
      selectedCards: cards.filter(c => selectedCardIds.includes(c.id)),
      throughDeadlineOnly: allowance.openingBalance - allowance.throughDeadline - allowance.reserve };
  }
  const api = { overview };
  if (node) module.exports = api;
  root.DailyFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
