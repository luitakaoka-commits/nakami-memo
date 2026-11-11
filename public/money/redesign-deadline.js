/* カード締め日を基準にする期間の検証用。本番画面には未接続。 */
(function attach(root) {
  'use strict';
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function periodForCards({ today, cards, selectedCardIds }) {
    if (!validDate(today) || !Array.isArray(cards) || !Array.isArray(selectedCardIds) || !selectedCardIds.length) throw new Error('日付と基準カードを確認してください');
    if (selectedCardIds.some(id => typeof id !== 'string' || !id) || new Set(selectedCardIds).size !== selectedCardIds.length) throw new Error('基準カードの指定が不正です');
    const byId = new Map();
    for (const card of cards) {
      if (!card?.id || byId.has(card.id)) throw new Error('カードIDが不正または重複しています');
      byId.set(card.id, card);
    }
    const [year, month] = today.split('-').map(Number);
    if (year < 100 || year > 9998) throw new Error('計算可能な日付の範囲外です');
    function closingDate(monthOffset, day) {
      const first = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
      const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const closingDay = day === 0 ? lastDay : Math.min(day, lastDay);
      return `${String(first.getUTCFullYear()).padStart(4, '0')}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(closingDay).padStart(2, '0')}`;
    }
    const deadlines = selectedCardIds.map(id => {
      const card = byId.get(id);
      if (!card || !Number.isInteger(card.closingDay) || card.closingDay < 0 || card.closingDay > 31) throw new Error('選択したカードの締め日を確認してください');
      const current = closingDate(0, card.closingDay);
      return { cardId: id, deadline: current >= today ? current : closingDate(1, card.closingDay) };
    });
    const earliest = deadlines.map(item => item.deadline).sort()[0];
    const daysInclusive = Math.floor((Date.parse(`${earliest}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) + 1;
    return { today, deadline: earliest, daysInclusive, deadlines, differentDeadlines: new Set(deadlines.map(item => item.deadline)).size > 1 };
  }
  const api = { periodForCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignDeadline = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
