/* 返金・取消の照合計画。保存や本番の残高変更は行わない。 */
(function attach(root) {
  'use strict';
  const engine = typeof module !== 'undefined' && module.exports ? require('./finance-engine.js') : root.FinanceEngine;
  function planRefund(input = {}) {
    const { notice, purchases, processed = [] } = input;
    if (!notice || typeof notice.id !== 'string' || !notice.id || !['refund', 'cancel'].includes(notice.type) || typeof notice.cardId !== 'string' || !notice.cardId || !Number.isSafeInteger(notice.amount) || notice.amount <= 0 || !Array.isArray(purchases) || !Array.isArray(processed)) throw new Error('返金通知が不正です');
    const existing = processed.filter(item => item?.noticeId === notice.id);
    if (existing.length > 1) throw new Error('返金通知の処理履歴が重複しています');
    if (existing.length) {
      const previous = existing[0];
      if (previous.amount !== notice.amount || previous.cardId !== notice.cardId || previous.type !== notice.type || (notice.targetId && previous.targetId !== notice.targetId)) return { status: 'review', reason: 'notice_conflict' };
      return { status: 'already-applied' };
    }
    if (notice.amountConfirmed !== true || notice.targetConfirmed !== true || typeof notice.targetId !== 'string' || !notice.targetId) return { status: 'review', reason: 'missing_evidence' };
    const targets = purchases.filter(item => item?.id === notice.targetId);
    if (targets.length !== 1) return { status: 'review', reason: 'target_not_unique' };
    const target = targets[0];
    if (target.cardId !== notice.cardId) return { status: 'review', reason: 'card_mismatch' };
    if (!Number.isSafeInteger(target.amount) || target.amount < 0 || !Number.isSafeInteger(target.refundedAmount) || target.refundedAmount < 0 || target.refundedAmount > target.amount) throw new Error('元取引の金額が不正です');
    const remaining = target.amount - target.refundedAmount;
    if (notice.amount > remaining || (notice.type === 'cancel' && notice.amount !== remaining)) return { status: 'review', reason: 'amount_conflict' };
    // 請求確定後や引落後は、返金の計上先・時期を別途確認する。
    if (target.billStatus !== 'estimate') return { status: 'review', reason: 'billing_period_unresolved' };
    return { status: 'ready', plan: { noticeId: notice.id, targetId: target.id, cardId: notice.cardId, type: notice.type, amount: notice.amount, newRefundedAmount: target.refundedAmount + notice.amount, remainingAmount: remaining - notice.amount } };
  }
  function preparePendingRefund({ state, candidate, targetId, amount, confirmed, destinationStatementId = '' }) {
    if (!state || !Array.isArray(state.transactions) || !Array.isArray(state.cards)
      || !candidate?.id || !['pending', 'needs_review'].includes(candidate.status)) {
      return { status: 'review', reason: 'missing_evidence' };
    }
    const matches = state.transactions.filter(item => item.id === targetId);
    const target = matches[0];
    if (matches.length !== 1 || target.kind !== 'payment' || target.entryType !== 'itemized'
      || !(destinationStatementId ? ['planned', 'settled', 'absorbed'] : ['planned']).includes(target.status)
      || target.affectsForecast === false || target.dateEstimated === true) {
      return { status: 'review', reason: 'target_not_unique' };
    }
    const card = state.cards.find(item => item.id === target.cardId);
    if (!card?.accountId || card.accountId !== target.sourceAccountId) return { status: 'review', reason: 'card_mismatch' };
    const holidayOptions = { overrides: state.settings?.holidayOverrides || {} };
    const cycle = engine.cardBillingCycleOf(target, card, holidayOptions);
    if (!cycle || !target.dueDate) return { status: 'review', reason: 'billing_period_unresolved' };
    let destination, destinationCycle;
    if (destinationStatementId) {
      const statements = state.transactions.filter(item => item.id === destinationStatementId);
      destination = statements[0];
      if (statements.length !== 1 || destination.cardId !== card.id || destination.sourceAccountId !== card.accountId
        || !['planned', 'settled'].includes(destination.status)) return { status: 'review', reason: 'billing_period_unresolved' };
      destinationCycle = engine.cardBillingCycleOf(destination, card, holidayOptions);
      if (destinationCycle < cycle || !engine.hasConfirmedCardStatement(destination, destinationCycle)) {
        return { status: 'review', reason: 'billing_period_unresolved' };
      }
    }
    const hasStatement = state.transactions.some(item => item.kind === 'payment' && item.entryType === 'statement'
      && item.cardId === card.id && ['planned', 'settled'].includes(item.status)
      && engine.cardBillingCycleOf(item, card, holidayOptions) === cycle);
    const hasUnlinkedRefund = state.transactions.some(item => item.kind === 'payment' && item.amount < 0
      && item.cardId === card.id && item.status !== 'cancelled' && !item.refundEvidence
      && engine.cardBillingCycleOf(item, card, holidayOptions) === cycle);
    if (hasUnlinkedRefund) return { status: 'review', reason: 'notice_conflict' };
    const previous = state.transactions.filter(item => item.refundEvidence?.targetId === targetId && item.status !== 'cancelled');
    const conflictingNotice = state.transactions.some(item => item.id === 'mail_' + candidate.id
      || (candidate.fingerprint && item.refundEvidence?.fingerprint === candidate.fingerprint));
    if (conflictingNotice) return { status: 'review', reason: 'notice_conflict' };
    const result = planRefund({
      notice: { id: candidate.id, targetId, type: candidate.type, amount, cardId: card.id,
        amountConfirmed: confirmed === true, targetConfirmed: confirmed === true },
      purchases: [{ id: targetId, cardId: card.id, amount: target.amount,
        refundedAmount: previous.reduce((sum, item) => sum + Math.abs(item.amount), 0),
        billStatus: !destination && hasStatement ? 'confirmed' : 'estimate' }]
    });
    if (result.status !== 'ready') return result;
    return { ...result, transaction: {
      id: 'mail_' + candidate.id, kind: 'payment', amount: -amount, cardId: card.id, sourceAccountId: card.accountId,
      entryType: 'itemized', status: destination ? 'absorbed' : 'planned', origin: 'mail-import',
      dueDate: destination?.dueDate || target.dueDate, absorbedBy: destination?.id || '',
      transactionDate: target.transactionDate, refundEvidence: { targetId, noticeId: candidate.id, type: candidate.type,
        cycle, fingerprint: candidate.fingerprint || '', ...(destination ? { destinationStatementId, destinationCycle } : {}) }
    } };
  }
  function matchesPreparedRefund(transaction, prepared) {
    if (prepared.status !== 'ready' || !transaction || transaction.affectsForecast === false) return false;
    const expected = prepared.transaction;
    return ['id', 'kind', 'amount', 'cardId', 'sourceAccountId', 'entryType', 'status', 'origin', 'dueDate', 'transactionDate', 'absorbedBy']
      .every(key => transaction[key] === expected[key])
      && Object.keys(expected.refundEvidence).every(key => transaction.refundEvidence?.[key] === expected.refundEvidence[key]);
  }
  const api = { planRefund, preparePendingRefund, matchesPreparedRefund };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignRefund = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
