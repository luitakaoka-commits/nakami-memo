/* 返金・取消の照合計画。保存や本番の残高変更は行わない。 */
(function attach(root) {
  'use strict';
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
  const api = { planRefund };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignRefund = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
