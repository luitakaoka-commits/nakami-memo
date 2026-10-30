/* カード照合を口座別試算へつなぐ検証用の入口。本番には未接続。 */
(function attach(root) {
  'use strict';
  const reconcile = typeof module !== 'undefined' && module.exports ? require('./redesign-card-reconciliation.js') : root.RedesignCardReconciliation;
  const readiness = typeof module !== 'undefined' && module.exports ? require('./redesign-readiness.js') : root.RedesignReadiness;
  function evaluateCashflow(input = {}) {
    if (!Array.isArray(input.cardBills) || !Array.isArray(input.otherEvents)) throw new Error('カード請求と予定の一覧が必要です');
    if (input.otherEvents.some(event => event?.cardPayment)) throw new Error('カード請求はカードの一覧から指定してください');
    const keys = new Set(), messageGroups = new Map(), cardResults = [], events = [...input.otherEvents];
    for (const bill of input.cardBills) {
      if (!bill || typeof bill.cardId !== 'string' || !bill.cardId || !['planned', 'settled'].includes(bill.status)) throw new Error('カードまたは引落状態が不明です');
      const key = JSON.stringify([bill.cardId, bill.cycle]);
      if (keys.has(key)) throw new Error('同じカードと請求期間が重複しています');
      keys.add(key);
      for (const entry of bill.entries || []) {
        if (entry?.origin !== 'email' || !entry.messageId) continue;
        if (messageGroups.has(entry.messageId) && messageGroups.get(entry.messageId) !== key) throw new Error('同じメールが複数のカードまたは請求期間にあります');
        messageGroups.set(entry.messageId, key);
      }
      const card = reconcile.reconcileCardCycle({ cardId: bill.cardId, cycle: bill.cycle, snapshot: bill.snapshot, entries: bill.entries || [] });
      cardResults.push({ cardId: bill.cardId, cycle: bill.cycle, accountId: bill.accountId, dueDate: bill.dueDate, ...card });
      events.push({ id: `card:${key}`, accountId: bill.accountId, date: bill.dueDate, status: bill.status, kind: 'expense', cardPayment: true, amount: card.minimumAmount, additionalPossible: card.upperEstimate - card.minimumAmount, amountConfirmed: card.confirmed });
    }
    const result = readiness.calculateReadiness({ today: input.today, endDate: input.endDate, accounts: input.accounts, events, coverageVerified: input.coverageVerified });
    return { ...result, cards: cardResults };
  }
  const api = { evaluateCashflow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignCashflowComposition = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
