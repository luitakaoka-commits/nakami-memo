/* 旧データの読み取り専用検証。本番画面には接続しない。 */
(function attach(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const deadline = node ? require('./redesign-deadline.js') : root.RedesignDeadline;
  const adapter = node ? require('./redesign-legacy-adapter.js') : root.RedesignLegacyAdapter;
  const readiness = node ? require('./redesign-readiness.js') : root.RedesignReadiness;
  function previewLegacy({ state, today, endDate, selectedCardIds, candidates }) {
    const period = deadline.periodForCards({ today, cards: state?.cards, selectedCardIds });
    if (typeof endDate !== 'string' || endDate < period.deadline) throw new Error('試算期間は締め日まで必要です');
    const { scenario, issues } = adapter.buildLegacyScenario(state, today, endDate, { candidates });
    return { period, assessment: readiness.calculateReadiness(scenario), issues };
  }
  const api = { previewLegacy };
  if (node) module.exports = api;
  root.RedesignLegacyPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
