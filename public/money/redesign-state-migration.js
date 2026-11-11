/* 旧家計を新計算・保存形式へ変換する。元データは変更せず別の封筒に保持する。 */
(function attach(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const adapter = node ? require('./redesign-legacy-adapter.js') : root.RedesignLegacyAdapter;
  const readiness = node ? require('./redesign-readiness.js') : root.RedesignReadiness;
  function migrateState({ state, today, endDate, candidates }) {
    if (state?.modelVersion !== undefined || state?.bills !== undefined) throw new Error('新形式や既存の請求情報を旧形式として移行できません');
    const original = structuredClone(state);
    if (original?.accounts?.some(account => ['balance', 'revision', 'processedDebitOperations'].some(key => Object.hasOwn(account, key)))) throw new Error('口座に新形式の状態があるため移行を停止しました');
    const { scenario, issues } = adapter.buildLegacyScenario(original, today, endDate, { candidates });
    const accounts = original.accounts.map(account => {
      const mapped = scenario.accounts.find(item => item.id === account.id);
      const result = { ...account, balance: mapped.balance, revision: 0, balanceVerified: mapped.balanceVerified };
      delete result.currentBalance;
      return result;
    });
    const bills = scenario.events.filter(event => event.cardPayment).map(event => {
      const key = event.id.slice('legacy-card:'.length);
      const cycle = key.slice(-7), cardId = key.slice(0, -8);
      if (!original.cards.some(card => card.id === cardId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle)) throw new Error('請求期間とカードを特定できません');
      return { id: event.id, cardId, cycle, accountId: event.accountId, dueDate: event.date,
        amount: event.amount, additionalPossible: event.additionalPossible || 0,
        amountConfirmed: event.amountConfirmed === true, status: 'planned', origin: 'legacy-migration' };
    });
    const migrated = { ...original, modelVersion: 1, asOf: today, forecastEnd: endDate,
      accounts, bills, forecastEvents: scenario.events.filter(event => !event.cardPayment),
      coverageVerified: false };
    // 呼出側が旧画面に誤って渡せないよう、家計の配列を最上位へ置かない。
    return { format: 'money-redesign-migration-v1', original, migrated, issues,
      limitations: ['legacy_evidence_unverified', 'candidate_collection_completeness_unverified'] };
  }
  function scenarioFromMigrated(state) {
    if (state?.modelVersion !== 1 || !Array.isArray(state.bills) || !Array.isArray(state.forecastEvents)) throw new Error('新形式の家計が必要です');
    const cards = new Set(state.cards.map(card => card.id));
    const cycles = new Set();
    const events = state.bills.map(bill => {
      const key = JSON.stringify([bill.cardId, bill.cycle]);
      if (!cards.has(bill.cardId) || cycles.has(key) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(bill.cycle || '')) throw new Error('請求のカード・期間が不正または重複しています');
      cycles.add(key);
      return { id: bill.id, date: bill.dueDate, accountId: bill.accountId, kind: 'expense', cardPayment: true,
        amount: bill.amount, additionalPossible: bill.additionalPossible || 0,
        amountConfirmed: bill.amountConfirmed === true, status: bill.status };
    });
    return { today: state.asOf, endDate: state.forecastEnd, accounts: state.accounts,
      events: [...state.forecastEvents, ...events], coverageVerified: state.coverageVerified === true };
  }
  function assessMigrated(state) { return readiness.calculateReadiness(scenarioFromMigrated(state)); }
  const api = { migrateState, scenarioFromMigrated, assessMigrated };
  if (node) module.exports = api;
  root.RedesignStateMigration = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
