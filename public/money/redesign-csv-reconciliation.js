/* 正規化済みCSV明細の照合案。CSV読取・保存・自動取込は行わない。 */
(function attach(root) {
  'use strict';
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function planCsv(input = {}) {
    const { cardId, cycle, rows = [], existing = [] } = input;
    if (typeof cardId !== 'string' || !cardId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle || '') || !Array.isArray(rows) || !Array.isArray(existing)) throw new Error('カード、請求期間、一覧を確認してください');
    const validate = item => {
      if (!item || typeof item.id !== 'string' || !item.id || item.cardId !== cardId || item.cycle !== cycle || !validDate(item.usedDate) || !Number.isSafeInteger(item.amount) || item.amount < 0 || (item.externalRef != null && typeof item.externalRef !== 'string')) throw new Error('明細のカード・日付・金額が不正です');
    };
    rows.forEach(validate); existing.forEach(validate);
    const rowIds = new Set(), existingIds = new Set();
    for (const item of rows) { if (rowIds.has(item.id)) throw new Error('CSVの行IDが重複しています'); rowIds.add(item.id); }
    for (const item of existing) { if (existingIds.has(item.id)) throw new Error('登録済み明細のIDが重複しています'); existingIds.add(item.id); }
    const groups = new Map();
    for (const row of rows) if (row.externalRef) groups.set(row.externalRef, [...(groups.get(row.externalRef) || []), row]);
    const decisions = rows.map(row => {
      const group = row.externalRef ? groups.get(row.externalRef) : [];
      // 同じ外部IDが複数あるときは、金額や日付が一致していても先に重複の意味を確認する。
      if (group.length > 1) return { rowId: row.id, status: 'review', reason: 'repeated_reference', candidateIds: [] };
      const exact = row.externalRef ? existing.filter(item => item.externalRef === row.externalRef) : [];
      if (exact.length > 1) return { rowId: row.id, status: 'review', reason: 'reference_not_unique', candidateIds: exact.map(item => item.id) };
      if (exact.length === 1) {
        const match = exact[0];
        if (match.amount !== row.amount || match.usedDate !== row.usedDate) return { rowId: row.id, status: 'review', reason: 'reference_conflict', candidateIds: [match.id] };
        if (row.referenceVerified !== true || match.referenceVerified !== true) return { rowId: row.id, status: 'review', reason: 'reference_unverified', candidateIds: [match.id] };
        return { rowId: row.id, status: 'matched', candidateIds: [match.id] };
      }
      const similar = existing.filter(item => item.usedDate === row.usedDate && item.amount === row.amount);
      if (similar.length) return { rowId: row.id, status: 'review', reason: 'possible_duplicate', candidateIds: similar.map(item => item.id) };
      if (rows.some(other => other.id !== row.id && other.usedDate === row.usedDate && other.amount === row.amount)) return { rowId: row.id, status: 'review', reason: 'similar_csv_rows', candidateIds: [] };
      return { rowId: row.id, status: 'proposed', candidateIds: [] };
    });
    return { decisions, needsReview: decisions.some(item => item.status === 'review') };
  }
  const api = { planCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignCsvReconciliation = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
