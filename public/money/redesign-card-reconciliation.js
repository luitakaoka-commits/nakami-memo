/* 再設計の検証用。累計への包含を日時だけで断定せず、未照合を幅として返す。 */
(function attach(root) {
  'use strict';

  function validInstant(value) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value || '');
    if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return false;
    const day = new Date(`${match[1]}T00:00:00Z`);
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1] && Number.isFinite(Date.parse(value));
  }
  function add(a, b) {
    const value = a + b;
    if (!Number.isSafeInteger(value)) throw new Error('計算可能な金額の範囲を超えています');
    return value;
  }

  function reconcileCardCycle(input = {}) {
    const { cardId, cycle, snapshot, entries = [] } = input;
    if (!cardId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle || '') || !Array.isArray(entries)) throw new Error('カードまたは対象月が不正です');
    if (snapshot && (!Number.isSafeInteger(snapshot.amount) || snapshot.amount < 0 || !['estimate', 'confirmed'].includes(snapshot.status))) throw new Error('累計額が不正です');
    if (snapshot && (snapshot.cardId !== cardId || snapshot.cycle !== cycle)) throw new Error('別のカードまたは請求期間の累計額です');
    const ids = new Set();
    const mailIds = new Map();
    let known = snapshot ? snapshot.amount : 0;
    let possible = 0;
    const issues = [];
    const items = [];
    let includedTotal = 0;
    if (snapshot && !validInstant(snapshot.checkedAt)) issues.push({ type: 'snapshot_check_time_unknown' });
    if (snapshot?.status === 'estimate' && !validInstant(snapshot.latestUsedAt)) issues.push({ type: 'snapshot_latest_usage_unknown' });
    if (snapshot && validInstant(snapshot.checkedAt) && validInstant(snapshot.latestUsedAt)
      && Date.parse(snapshot.latestUsedAt) > Date.parse(snapshot.checkedAt)) issues.push({ type: 'snapshot_time_conflict' });
    for (const entry of entries) {
      if (!entry.id || ids.has(entry.id)) throw new Error('明細IDが重複しています');
      ids.add(entry.id);
      if (entry.cardId !== cardId || entry.cycle !== cycle) throw new Error('別のカードまたは請求期間の明細です');
      if (!Number.isSafeInteger(entry.amount) || entry.amount < 0) throw new Error('明細額が不正です');
      if (!['email', 'manual'].includes(entry.origin)) throw new Error('明細の取得元が不明です');
      if (entry.messageId && mailIds.has(entry.messageId)) {
        const previous = mailIds.get(entry.messageId);
        // 同じメールでも抽出額が食い違うなら単なる再取得とは断定できない。
        // 確定額には足さず、未確定の上限に残して確認を求める。
        const conflict = previous.amount !== entry.amount || previous.usedAt !== entry.usedAt || previous.type !== entry.type || previous.inclusion !== entry.inclusion;
        if (conflict && snapshot?.status !== 'confirmed') possible = add(possible, entry.amount);
        issues.push({ type: conflict ? 'duplicate_message_conflict' : 'duplicate_message', id: entry.id });
        items.push({ id: entry.id, treatment: conflict ? 'review' : 'duplicate_message' });
        continue;
      }
      if (entry.messageId) mailIds.set(entry.messageId, entry);
      if (entry.type && entry.type !== 'purchase') {
        issues.push({ type: 'refund_or_cancellation', id: entry.id });
        items.push({ id: entry.id, treatment: 'review' });
        continue;
      }
      const hasEvidence = entry.evidenceComplete === true && validInstant(entry.usedAt)
        && (entry.origin !== 'email' || Boolean(entry.messageId));
      // 異なるメールIDでも同じ決済の通知かもしれない。照合未実施は安全扱いしない。
      const duplicateUnchecked = entry.origin === 'email' && entry.duplicateCheck !== 'clear';
      if (snapshot && entry.inclusion === 'included' && hasEvidence && !entry.duplicateRisk && !duplicateUnchecked) includedTotal = add(includedTotal, entry.amount);
      if (snapshot?.status === 'confirmed') {
        // 確定請求は優先するが、後着・不一致がないことは勝手に決めない。
        if (entry.inclusion !== 'included' || entry.duplicateRisk === true || duplicateUnchecked || !hasEvidence) issues.push({ type: 'confirmed_bill_conflict', id: entry.id });
        items.push({ id: entry.id, treatment: entry.inclusion === 'included' && hasEvidence && !entry.duplicateRisk && !duplicateUnchecked ? 'included' : 'review' });
      } else if (entry.duplicateRisk === true || duplicateUnchecked || !hasEvidence) {
        possible = add(possible, entry.amount);
        issues.push({ type: entry.duplicateRisk ? 'possible_duplicate' : duplicateUnchecked ? 'duplicate_unchecked' : 'missing_evidence', id: entry.id });
        items.push({ id: entry.id, treatment: 'review' });
      } else if (!snapshot || entry.inclusion === 'not_included') {
        known = add(known, entry.amount);
        items.push({ id: entry.id, treatment: 'added' });
      } else if (entry.inclusion === 'included') {
        items.push({ id: entry.id, treatment: 'included' });
      } else {
        possible = add(possible, entry.amount);
        issues.push({ type: 'inclusion_unknown', id: entry.id });
        items.push({ id: entry.id, treatment: 'review' });
      }
    }
    if (snapshot && includedTotal > snapshot.amount) issues.push({ type: 'included_exceeds_snapshot' });
    const needsReview = issues.length > 0 || snapshot?.status !== 'confirmed';
    return { amount: known, possibleAdditional: possible, upperEstimate: add(known, possible), sourceConfirmed: snapshot?.status === 'confirmed', confirmed: snapshot?.status === 'confirmed' && !needsReview, needsReview, issues, items };
  }
  const api = { reconcileCardCycle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignCardReconciliation = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
