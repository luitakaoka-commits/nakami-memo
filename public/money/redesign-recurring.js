/* 支払予定生成の検証用。実データや画面への接続はしない。 */
(function attach(root) {
  'use strict';
  function parseDay(text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) throw new Error('日付が不正です');
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error('日付が不正です');
    return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
  }
  function generateRecurring(plan, fromDate, toDate, existing = []) {
    const first = parseDay(plan?.firstDate); parseDay(fromDate); parseDay(toDate);
    if (fromDate > toDate || !plan.id || typeof plan.id !== 'string' || !plan.accountId || typeof plan.accountId !== 'string') throw new Error('予定の期間または識別子が不正です');
    if (!Number.isInteger(plan.intervalMonths) || plan.intervalMonths < 1 || plan.intervalMonths > 12) throw new Error('繰り返し間隔が不正です');
    if (plan.amount != null && (!Number.isSafeInteger(plan.amount) || plan.amount < 0)) throw new Error('予定金額が不正です');
    if (!Array.isArray(existing)) throw new Error('登録済み予定が不正です');
    const taken = new Set();
    for (const item of existing) {
      if (item?.recurringPlanId !== plan.id) continue;
      parseDay(item.date);
      if (!['planned', 'settled'].includes(item.status)) throw new Error('登録済み予定の実行状態が不明です');
      if (taken.has(item.date)) throw new Error('同じ定期予定が重複しています');
      taken.add(item.date);
    }
    const startIndex = first.year * 12 + first.month;
    const last = parseDay(toDate);
    const lastIndex = last.year * 12 + last.month;
    const result = [];
    for (let index = startIndex; index <= lastIndex; index += plan.intervalMonths) {
      const year = Math.floor(index / 12), month = index % 12;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const day = Math.min(first.day, lastDay);
      const date = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (date < fromDate || date > toDate || taken.has(date)) continue;
      result.push({ id: `recurring:${plan.id}:${date}`, recurringPlanId: plan.id, date, accountId: plan.accountId, kind: 'expense', amount: plan.amount ?? 0, amountConfirmed: false, status: 'planned' });
    }
    return result;
  }
  const api = { generateRecurring };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignRecurring = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
