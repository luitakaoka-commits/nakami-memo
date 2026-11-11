/*
 * 再設計の検証用: 口座別の支払い能力。
 * 旧画面・本番データには未接続。開始残高は集計開始時点で反映済みの額。
 * 日付だけで順序が不明な入金・振替は、同日の出金後に反映する。
 */
(function attach(root) {
  'use strict';

  const isDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const add = (a, b) => {
    const value = a + b;
    if (!Number.isSafeInteger(value)) throw new Error('計算可能な金額の範囲を超えています');
    return value;
  };

  function calculateReadiness(input = {}) {
    const { today, endDate } = input;
    if (!isDate(today) || !isDate(endDate) || endDate < today) throw new Error('試算期間が不正です');
    if (!Array.isArray(input.accounts) || !input.accounts.length || !Array.isArray(input.events)) throw new Error('口座と予定が必要です');
    const accounts = new Map();
    input.accounts.forEach(account => {
      if (!account.id || accounts.has(account.id) || !Number.isSafeInteger(account.balance)) throw new Error('口座情報が不正です');
      accounts.set(account.id, account);
    });
    const seen = new Set();
    const events = input.events.map(event => {
      if (!event.id || seen.has(event.id)) throw new Error('予定の識別子が重複しています');
      seen.add(event.id);
      if (!isDate(event.date) || !['income', 'expense', 'transfer'].includes(event.kind)) throw new Error('予定の日付または種類が不正です');
      if (!['planned', 'settled'].includes(event.status)) throw new Error('実行済みか未実行か確認が必要です');
      if (event.status === 'settled' && event.date > today) throw new Error('実行済みの予定日が未来です');
      if (!Number.isSafeInteger(event.amount) || event.amount < 0) throw new Error('予定額が不正です');
      if (event.additionalPossible != null && (!Number.isSafeInteger(event.additionalPossible) || event.additionalPossible < 0 || event.kind !== 'expense')) throw new Error('未照合額が不正です');
      if (!accounts.has(event.accountId)) throw new Error('予定の口座が不明です');
      if (event.kind === 'transfer' && (!accounts.has(event.toAccountId) || event.toAccountId === event.accountId)) throw new Error('振替先が不正です');
      if (event.cardPayment && event.kind !== 'expense') throw new Error('カード引落は支払いとして登録してください');
      return event;
    });
    // 実行済みの入出金は開始残高へ反映済み。請求額の確定(amountConfirmed)とは別。
    const overdue = events.filter(event => event.status === 'planned' && event.date < today);
    const active = events.filter(event => event.status === 'planned' && event.date >= today && event.date <= endDate);
    const dates = [...new Set(active.map(event => event.date))].sort();
    const confirmed = new Map([...accounts].map(([id, account]) => [id, account.balance]));
    const projected = new Map(confirmed);
    const issues = [];
    const timeline = [];
    const balancesByDate = [{ date: today, balances: Object.fromEntries(projected) }];
    // 開始残高の不足は、予定がない日や同日入金がある日でも残す。
    for (const [accountId, balance] of projected) {
      if (balance < 0) issues.push({ type: 'projected_shortfall', accountId, date: today, amount: -balance, phase: 'opening' });
    }
    // 対象期間の請求・口座・未照合候補が揃っている根拠がなければ安全とは判定しない。
    const coverageVerified = input.coverageVerified === true;
    if (!coverageVerified) issues.push({ type: 'incomplete_source_data' });
    const isUnreliable = account => account.balanceVerified !== true || account.unreconciled === true;
    const accountReliable = new Map([...accounts].map(([id, account]) => [id, !isUnreliable(account)]));
    for (const event of overdue) {
      issues.push({ type: 'overdue', eventId: event.id, accountId: event.accountId, date: event.date });
      accountReliable.set(event.accountId, false);
      if (event.toAccountId) accountReliable.set(event.toAccountId, false);
    }

    for (const date of dates) {
      const day = active.filter(event => event.date === date);
      const laterCredits = new Map([...accounts].map(([id]) => [id, 0]));
      for (const event of day.filter(item => item.kind === 'income')) laterCredits.set(event.accountId, add(laterCredits.get(event.accountId), event.amount));
      for (const event of day.filter(item => item.kind === 'transfer')) laterCredits.set(event.toAccountId, add(laterCredits.get(event.toAccountId), event.amount));
      // 同じ日・同じ口座のカードを合計して判定する。
      const cards = new Map();
      for (const event of day.filter(item => item.kind === 'expense')) {
        const additionalPossible = event.additionalPossible || 0;
        confirmed.set(event.accountId, add(confirmed.get(event.accountId), -add(event.amount, additionalPossible)));
        projected.set(event.accountId, add(projected.get(event.accountId), -event.amount));
        if (event.cardPayment) {
          const group = cards.get(event.accountId) || { amount: 0, possible: 0, known: true, ids: [] };
          group.amount = add(group.amount, event.amount);
          group.possible = add(group.possible, additionalPossible);
          group.known = group.known && event.amountConfirmed === true && additionalPossible === 0;
          group.ids.push(event.id);
          cards.set(event.accountId, group);
        }
        if (event.amountConfirmed !== true || additionalPossible > 0) {
          issues.push({ type: 'amount_unconfirmed', eventId: event.id, accountId: event.accountId, date });
          accountReliable.set(event.accountId, false);
        }
      }
      // 予定振替は移動済みではない。保守側では送金を控除し、受取は加えない。
      for (const event of day.filter(item => item.kind === 'transfer')) {
        // 振替元に不足があるとき、振替先への入金を予測に足すと存在しない資金を作ってしまう。
        // 同日入金との順序も未確定のため、上位画面に要確認として扱わせる。
        if (projected.get(event.accountId) < event.amount) throw new Error('振替元の資金が不足しているか順序を確認できません');
        confirmed.set(event.accountId, add(confirmed.get(event.accountId), -event.amount));
        projected.set(event.accountId, add(projected.get(event.accountId), -event.amount));
      }
      for (const [accountId, card] of cards) {
        const safeBalance = confirmed.get(accountId);
        const predictedBalance = projected.get(accountId);
        const reliable = coverageVerified && accountReliable.get(accountId) && card.known;
        // 不確実な前提下でも不足の可能性を隠さない。推定額による不足は見込みとして扱う。
        const status = add(predictedBalance, laterCredits.get(accountId)) < 0 ? 'shortfall'
          : (predictedBalance < 0 || safeBalance < 0 || !reliable ? 'review' : 'safe');
        timeline.push({ date, accountId, cardEventIds: card.ids, cardAmount: card.amount, cardAdditionalPossible: card.possible, confirmedBalance: safeBalance, projectedBalance: predictedBalance, status });
      }
      const beforeCredits = new Map(projected);
      // 入金・振替は当日引落に間に合う保証がないので、同日の判定後に反映。
      for (const event of day.filter(item => item.kind === 'income')) projected.set(event.accountId, add(projected.get(event.accountId), event.amount));
      for (const event of day.filter(item => item.kind === 'transfer')) projected.set(event.toAccountId, add(projected.get(event.toAccountId), event.amount));
      balancesByDate.push({ date, balances: Object.fromEntries(projected) });
      // カード以外も含め、各口座の不足と水道代等の不確実な予定を追跡する。
      for (const [accountId] of accounts) {
        if (projected.get(accountId) < 0) issues.push({ type: 'projected_shortfall', accountId, date, amount: -projected.get(accountId) });
        else if (beforeCredits.get(accountId) < 0) issues.push({ type: 'same_day_income_unconfirmed', accountId, date });
        else if (confirmed.get(accountId) < 0) issues.push({ type: 'depends_on_planned_income', accountId, date });
      }
    }
    // 引落が未登録なら「安全」とは言えない。
    const nextDate = timeline[0]?.date || '';
    const nextPayments = timeline.filter(item => item.date === nextDate);
    const nextStatus = !nextPayments.length ? 'review'
      : nextPayments.some(item => item.status === 'shortfall') ? 'shortfall'
        : nextPayments.some(item => item.status === 'review') ? 'review' : 'safe';
    const futureStatus = issues.some(issue => issue.type === 'projected_shortfall') ? 'shortfall'
      : !timeline.length || issues.length || [...accounts.values()].some(isUnreliable) ? 'review' : 'safe';
    return { nextDate, nextStatus, nextPayments, futureStatus, timeline, balancesByDate, issues };
  }

  function spendingAllowance(input, { deadline, accountId, reserve = 0 } = {}) {
    if (!isDate(deadline) || deadline < input.today || deadline > input.endDate || !Number.isSafeInteger(reserve) || reserve < 0) throw new Error('締め日と予備額を確認してください');
    const assessment = calculateReadiness(input);
    const account = input.accounts.find(item => item.id === accountId);
    if (!account) throw new Error('支出に使う口座を確認してください');
    let throughDeadline = 0, afterDeadline = 0;
    const paymentEvents = [];
    for (const event of input.events) {
      if (event.accountId !== accountId || event.status !== 'planned' || event.kind === 'income' || event.date < input.today || event.date > input.endDate) continue;
      const cost = add(event.amount, event.additionalPossible || 0);
      paymentEvents.push(event);
      if (event.date <= deadline) throughDeadline = add(throughDeadline, cost);
      else afterDeadline = add(afterDeadline, cost);
    }
    const amount = add(add(add(account.balance, -throughDeadline), -afterDeadline), -reserve);
    const status = amount < 0 || assessment.futureStatus === 'shortfall' ? 'shortfall' : assessment.futureStatus;
    return { amount, status, referenceOnly: status !== 'safe', openingBalance: account.balance, throughDeadline, afterDeadline, reserve, deadline, endDate: input.endDate, paymentEvents };
  }
  const api = { calculateReadiness, spendingAllowance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignReadiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
