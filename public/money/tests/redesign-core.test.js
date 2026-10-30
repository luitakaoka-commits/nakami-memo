#!/usr/bin/env node
'use strict';
const { calculateReadiness } = require('../redesign-readiness.js');
const { reconcileCardCycle } = require('../redesign-card-reconciliation.js');
const { calculateCardPaymentDate, calculateSpendableAmount, accountDeltasFor } = require('../finance-engine.js');
const { compare: compareMigration } = require('../redesign-migration-check.js');
const { generateRecurring } = require('../redesign-recurring.js');
const { buildLegacyScenario } = require('../redesign-legacy-adapter.js');
const { previewLegacy } = require('../redesign-legacy-preview.js');
const { confirmBill, recordDebit } = require('../redesign-bill-lifecycle.js');
const { planRefund } = require('../redesign-refund.js');
const { planCsv } = require('../redesign-csv-reconciliation.js');
const { periodForCards } = require('../redesign-deadline.js');
const { evaluateCashflow } = require('../redesign-cashflow-composition.js');
const assert = require('node:assert/strict');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const account = (id, balance, extra = {}) => ({ id, balance, balanceVerified: true, ...extra });
const bill = (id, date, accountId, amount, extra = {}) => ({ id, date, accountId, amount, kind: 'expense', status: 'planned', cardPayment: true, amountConfirmed: true, ...extra });
const income = (id, date, accountId, amount) => ({ id, date, accountId, amount, kind: 'income', status: 'planned' });
const expense = (id, date, accountId, amount, extra = {}) => ({ id, date, accountId, amount, kind: 'expense', status: 'planned', amountConfirmed: true, ...extra });
const transfer = (id, date, accountId, toAccountId, amount) => ({ id, date, accountId, toAccountId, amount, kind: 'transfer', status: 'planned' });
const plan = (accounts, events, extra = {}) => calculateReadiness({ today: '2026-10-30', endDate: '2026-12-31', coverageVerified: true, accounts, events, ...extra });
const row = (id, amount, extra = {}) => ({ id, cardId: 'jcb', cycle: '2026-11', amount, origin: 'email', messageId: `mail-${id}`, usedAt: '2026-11-01T12:00:00+09:00', evidenceComplete: true, duplicateCheck: 'clear', ...extra });
const reconcile = (snapshot, entries) => reconcileCardCycle({ cardId: 'jcb', cycle: '2026-11', snapshot: snapshot && { cardId: 'jcb', cycle: '2026-11', checkedAt: '2026-11-02T12:00:00+09:00', latestUsedAt: '2026-11-01T12:00:00+09:00', ...snapshot }, entries });

test('確定請求を実残高で支払える', () => assert.equal(plan([account('a', 50000)], [bill('b', '2026-11-10', 'a', 30000)]).nextStatus, 'safe'));
test('対象情報の網羅を確認できない場合は安全にしない', () => {
  for (const coverageVerified of [false, undefined]) {
    const r = plan([account('a', 50000)], [bill('b', '2026-11-10', 'a', 30000)], { coverageVerified });
    assert.equal(r.nextStatus, 'review'); assert.equal(r.futureStatus, 'review');
    assert.ok(r.issues.some(issue => issue.type === 'incomplete_source_data'));
  }
});
test('情報不足があっても判明している不足は警告する', () => {
  const r = plan([account('a', 1000)], [bill('b', '2026-11-10', 'a', 30000)], { coverageVerified: false });
  assert.equal(r.nextStatus, 'shortfall'); assert.equal(r.futureStatus, 'shortfall');
});
test('引落後が1万円でも水道代を払えるなら安全', () => {
  const r = plan([account('a', 40000)], [bill('b', '2026-11-10', 'a', 30000), expense('water', '2026-11-20', 'a', 6000)]);
  assert.equal(r.nextStatus, 'safe'); assert.equal(r.futureStatus, 'safe');
});
test('引落可能でも後日の水道代が不足すれば将来は警告', () => {
  const r = plan([account('a', 40000)], [bill('b', '2026-11-10', 'a', 30000), expense('water', '2026-11-20', 'a', 12000)]);
  assert.equal(r.nextStatus, 'safe'); assert.equal(r.futureStatus, 'shortfall');
});
test('未確定の水道代は要確認', () => assert.equal(plan([account('a', 40000)], [bill('b', '2026-11-10', 'a', 30000), expense('water', '2026-11-20', 'a', 0, { amountConfirmed: false })]).futureStatus, 'review'));
test('別の引落口座が不足していたら安全にしない', () => {
  const r = plan([account('main', 100000), account('other', 1000)], [bill('b', '2026-11-10', 'other', 5000)]);
  assert.equal(r.nextStatus, 'shortfall'); assert.equal(r.nextPayments[0].accountId, 'other');
});
test('同日同口座の複数カードを合算', () => {
  const r = plan([account('a', 50000)], [bill('b1', '2026-11-10', 'a', 30000), bill('b2', '2026-11-10', 'a', 25000)]);
  assert.equal(r.nextStatus, 'shortfall'); assert.equal(r.nextPayments[0].cardAmount, 55000);
});
test('締め日と休日による引落日の補正を新判定へ渡す', () => {
  const due = calculateCardPaymentDate('2026-08-16', 15, 10, 1);
  assert.equal(due, '2026-10-13');
  const r = calculateReadiness({ today: '2026-09-01', endDate: '2026-10-20', coverageVerified: true, accounts: [account('a', 10000)], events: [bill('b', due, 'a', 5000)] });
  assert.equal(r.nextDate, '2026-10-13'); assert.equal(r.nextStatus, 'safe');
});
test('主要カードが15日締めなら15日を期限に含める', () => {
  const cards = ['jcb', 'smbc', 'mufg'].map(id => ({ id, closingDay: 15 }));
  const result = periodForCards({ today: '2026-10-30', cards, selectedCardIds: ['jcb', 'smbc', 'mufg'] });
  assert.equal(result.deadline, '2026-11-15'); assert.equal(result.daysInclusive, 17); assert.equal(result.differentDeadlines, false);
  assert.equal(periodForCards({ today: '2026-11-15', cards, selectedCardIds: ['jcb'] }).daysInclusive, 1);
  assert.equal(periodForCards({ today: '2026-11-16', cards, selectedCardIds: ['jcb'] }).deadline, '2026-12-15');
});
test('締め日の違うカードは別々の日付と最初の期限を示す', () => {
  const result = periodForCards({ today: '2026-10-30', cards: [{ id: 'a', closingDay: 15 }, { id: 'b', closingDay: 5 }], selectedCardIds: ['a', 'b'] });
  assert.equal(result.deadline, '2026-11-05'); assert.equal(result.differentDeadlines, true);
  assert.deepEqual(result.deadlines.map(item => item.deadline), ['2026-11-15', '2026-11-05']);
});
test('月末締め・うるう年・年末の締め日を正しく計算', () => {
  const cards = [{ id: 'a', closingDay: 31 }, { id: 'b', closingDay: 0 }, { id: 'c', closingDay: 15 }];
  assert.equal(periodForCards({ today: '2028-02-01', cards, selectedCardIds: ['a'] }).deadline, '2028-02-29');
  assert.equal(periodForCards({ today: '2027-02-01', cards, selectedCardIds: ['b'] }).deadline, '2027-02-28');
  assert.equal(periodForCards({ today: '2026-12-16', cards, selectedCardIds: ['c'] }).deadline, '2027-01-15');
});
test('基準カードが不明・重複・締め日不正なら期限を推測しない', () => {
  const cards = [{ id: 'a', closingDay: 15 }, { id: 'b', closingDay: 32 }];
  for (const ids of [[], ['missing'], ['a', 'a'], ['b']]) assert.throws(() => periodForCards({ today: '2026-10-30', cards, selectedCardIds: ids }));
});
test('15日当日の入出金は期限を15日にすると既存の試算へ含まれる', () => {
  const deadline = periodForCards({ today: '2026-10-30', cards: [{ id: 'a', closingDay: 15 }], selectedCardIds: ['a'] }).deadline;
  const input = { today: '2026-10-30', deadline, accounts: [{ id: 'bank', role: 'primary', currentBalance: 10000, includeInSpendable: true }], cards: [], transactions: [{ id: 'salary', kind: 'income', amount: 500, dueDate: '2026-11-15', sourceAccountId: 'bank', status: 'planned', affectsForecast: true }], recurringPlans: [], workEntries: [], wage: {} };
  const newPeriod = calculateSpendableAmount(input);
  const previousPeriod = calculateSpendableAmount({ ...input, deadline: '2026-11-14' });
  assert.equal(newPeriod.deadline, '2026-11-15'); assert.equal(newPeriod.incomeTotal, 500);
  assert.equal(newPeriod.total - previousPeriod.total, 500);
});
test('同日の別口座は別々に判定', () => {
  const r = plan([account('a', 50000), account('b', 1000)], [bill('x', '2026-11-10', 'a', 30000), bill('y', '2026-11-10', 'b', 5000)]);
  assert.equal(r.nextStatus, 'shortfall'); assert.equal(r.nextPayments.length, 2);
});
test('未入金の給与がなければ不足する場合は要確認', () => assert.equal(plan([account('a', 10000)], [income('salary', '2026-11-09', 'a', 30000), bill('b', '2026-11-10', 'a', 30000)]).nextStatus, 'review'));
test('予定給与を含めても不足する場合は不足見込み', () => assert.equal(plan([account('a', 10000)], [income('salary', '2026-11-09', 'a', 5000), bill('b', '2026-11-10', 'a', 30000)]).nextStatus, 'shortfall'));
test('引落後の給与では当日の引落を救済しない', () => assert.equal(plan([account('a', 10000)], [bill('b', '2026-11-10', 'a', 30000), income('salary', '2026-11-11', 'a', 100000)]).nextStatus, 'shortfall'));
test('同日の未入金給与に依存すると要確認', () => assert.equal(plan([account('a', 10000)], [income('salary', '2026-11-10', 'a', 30000), bill('b', '2026-11-10', 'a', 30000)]).nextStatus, 'review'));
test('同日の入金に依存する水道代も要確認', () => assert.equal(plan([account('a', 1000)], [expense('water', '2026-11-10', 'a', 5000), income('salary', '2026-11-10', 'a', 10000)]).futureStatus, 'review'));
test('未実行の振替は安全な入金としない', () => assert.equal(plan([account('a', 1000), account('b', 50000)], [transfer('t', '2026-11-09', 'b', 'a', 10000), bill('p', '2026-11-10', 'a', 5000)]).nextStatus, 'review'));
test('振替元も二重に支払えると扱わない', () => assert.equal(plan([account('a', 1000), account('b', 7000)], [transfer('t', '2026-11-09', 'b', 'a', 6000), bill('p', '2026-11-10', 'b', 5000)]).nextStatus, 'shortfall'));
test('資金のない振替を受取口座の収入として扱わない', () => {
  assert.throws(() => plan([account('a', 1000), account('b', 2000)], [transfer('t', '2026-11-09', 'b', 'a', 10000), bill('p', '2026-11-10', 'a', 5000)]), /振替元/);
});
test('口座残高に未照合がある場合は要確認', () => assert.equal(plan([account('a', 50000, { unreconciled: true })], [bill('b', '2026-11-10', 'a', 30000)]).nextStatus, 'review'));
test('未確認の残高で安全と言わない', () => assert.equal(plan([account('a', 50000, { balanceVerified: false })], [bill('b', '2026-11-10', 'a', 30000)]).nextStatus, 'review'));
test('確定前の請求額は要確認', () => assert.equal(plan([account('a', 50000)], [bill('b', '2026-11-10', 'a', 30000, { amountConfirmed: false })]).nextStatus, 'review'));
test('請求額が未確定でも不足なら不足見込み', () => assert.equal(plan([account('a', 10000)], [bill('b', '2026-11-10', 'a', 30000, { amountConfirmed: false })]).nextStatus, 'shortfall'));
test('未照合分を含めると不足の可能性がある場合は要確認', () => {
  const r = plan([account('a', 12000)], [bill('b', '2026-11-10', 'a', 10000, { additionalPossible: 3000 })]);
  assert.equal(r.nextStatus, 'review'); assert.equal(r.nextPayments[0].projectedBalance, 2000);
  assert.equal(r.nextPayments[0].confirmedBalance, -1000); assert.equal(r.nextPayments[0].cardAdditionalPossible, 3000);
});
test('過去の未処理支払がある口座を安全にしない', () => assert.equal(plan([account('a', 50000)], [bill('old', '2026-10-27', 'a', 20000), bill('next', '2026-11-10', 'a', 20000)]).nextStatus, 'review'));
test('引落済みの支払いは開始残高から再び引かない', () => {
  const r = plan([account('a', 50000)], [bill('old', '2026-10-27', 'a', 20000, { status: 'settled' }), bill('next', '2026-11-10', 'a', 20000)]);
  assert.equal(r.nextStatus, 'safe'); assert.equal(r.nextPayments[0].projectedBalance, 30000);
});
test('請求額確定だけでは支払済みとみなさない', () => {
  const r = plan([account('a', 50000)], [bill('next', '2026-11-10', 'a', 20000, { amountConfirmed: true, status: 'planned' })]);
  assert.equal(r.nextPayments[0].projectedBalance, 30000);
});
test('複数月の入出金を手計算と照合し、入金前の引落と後日の水道代を分ける', () => {
  // 架空の例: 100000+50000-130000=20000、+70000-15000+55000-115000=15000。
  const events = [income('support1', '2026-11-05', 'a', 50000), bill('nov', '2026-11-10', 'a', 130000), income('salary', '2026-11-13', 'a', 70000), expense('other', '2026-11-27', 'a', 15000), income('support2', '2026-12-07', 'a', 55000), bill('dec', '2026-12-10', 'a', 115000), expense('water', '2026-12-20', 'a', 16000)];
  const r = plan([account('a', 100000)], events);
  assert.equal(r.nextDate, '2026-11-10');
  assert.equal(r.timeline[0].projectedBalance, 20000);
  assert.equal(r.timeline[1].projectedBalance, 15000);
  assert.equal(r.nextStatus, 'review');
  assert.equal(r.futureStatus, 'shortfall');
  assert.ok(r.issues.some(issue => issue.type === 'projected_shortfall' && issue.date === '2026-12-20' && issue.amount === 1000));
});
test('将来の給与が不足に間に合うかどうかは入金日で変わる', () => {
  const base = [bill('nov', '2026-11-10', 'a', 130000), income('salary', '2026-11-13', 'a', 50000)];
  const late = plan([account('a', 100000)], base);
  const early = plan([account('a', 100000)], [base[0], { ...base[1], date: '2026-11-09' }]);
  assert.equal(late.nextStatus, 'shortfall');
  assert.equal(early.nextStatus, 'review');
  assert.equal(early.nextPayments[0].projectedBalance, 20000);
});
test('同じ入出金の入力順を変えても判定と口座別残高は変わらない', () => {
  const events = [income('support', '2026-11-05', 'a', 50000), bill('one', '2026-11-10', 'a', 60000), bill('two', '2026-11-10', 'a', 70000), expense('water', '2026-12-20', 'a', 21000)];
  const first = plan([account('a', 100000)], events);
  const second = plan([account('a', 100000)], [...events].reverse());
  assert.equal(first.nextStatus, second.nextStatus);
  assert.equal(first.futureStatus, second.futureStatus);
  assert.equal(first.nextPayments[0].projectedBalance, 20000);
  assert.equal(second.nextPayments[0].projectedBalance, 20000);
  assert.ok(second.issues.some(issue => issue.type === 'projected_shortfall' && issue.amount === 1000));
});
test('支払予定を増やすと次の引落後残高が同額減り、安全から改善しない', () => {
  const rank = { safe: 0, review: 1, shortfall: 2 };
  for (const startingBalance of [0, 10000, 50000]) {
    for (const extra of [0, 1, 5000, 30000]) {
      const initial = plan([account('a', startingBalance)], [bill('b', '2026-11-10', 'a', 10000)]);
      const changed = plan([account('a', startingBalance)], [bill('b', '2026-11-10', 'a', 10000), expense('extra', '2026-11-09', 'a', extra)]);
      assert.equal(changed.nextPayments[0].projectedBalance, initial.nextPayments[0].projectedBalance - extra);
      assert.ok(rank[changed.nextStatus] >= rank[initial.nextStatus]);
    }
  }
});
test('口座残高に反映済みの入金・支払いはもう一度加減しない', () => {
  const base = [bill('next', '2026-11-10', 'a', 10000)];
  const recorded = [{ ...income('paid-salary', '2026-10-29', 'a', 50000), status: 'settled' }, expense('paid-water', '2026-10-29', 'a', 3000, { status: 'settled' })];
  const without = plan([account('a', 20000)], base);
  const withRecorded = plan([account('a', 20000)], [...base, ...recorded]);
  assert.equal(withRecorded.nextPayments[0].projectedBalance, without.nextPayments[0].projectedBalance);
  assert.equal(withRecorded.nextStatus, without.nextStatus);
  assert.equal(withRecorded.futureStatus, without.futureStatus);
});
test('別口座のお金を無断で引落口座に加算しない', () => {
  for (const otherBalance of [0, 100000, 1000000]) {
    const r = plan([account('a', 1000), account('b', otherBalance)], [bill('b', '2026-11-10', 'a', 5000)]);
    assert.equal(r.nextStatus, 'shortfall');
    assert.equal(r.nextPayments[0].projectedBalance, -4000);
  }
});
test('カード会社の確定額は見込みを置換し、口座残高を変えない', () => {
  const before = { account: { id: 'a', balance: 50000, revision: 1 }, bill: { id: 'b', accountId: 'a', amount: 23000, amountConfirmed: false, status: 'planned' } };
  const after = confirmBill(before, { issuerConfirmed: true, amount: 25000 });
  assert.equal(after.bill.amount, 25000); assert.equal(after.bill.amountConfirmed, true);
  assert.equal(after.bill.status, 'planned'); assert.equal(after.account.balance, 50000);
  assert.equal(before.bill.amount, 23000);
});
test('銀行引落を一度だけ反映し、同じ処理の再送は残高を変えない', () => {
  const state = { account: { id: 'a', balance: 50000, revision: 1 }, bill: { id: 'b', accountId: 'a', amount: 25000, amountConfirmed: true, status: 'planned' } };
  const input = { operationId: 'op1', amount: 25000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: false, expectedRevision: 1 };
  const first = recordDebit(state, input), again = recordDebit(first, input);
  assert.equal(first.account.balance, 25000); assert.equal(first.bill.status, 'settled');
  assert.equal(again.account.balance, 25000); assert.equal(again.alreadyApplied, true);
  assert.throws(() => recordDebit(first, { ...input, operationId: 'op2' }), /既に引落済み/);
});
test('銀行引落が現在残高に反映済みならもう一度差し引かない', () => {
  const state = { account: { id: 'a', balance: 25000, revision: 2 }, bill: { id: 'b', accountId: 'a', amount: 25000, amountConfirmed: true, status: 'planned' } };
  const after = recordDebit(state, { operationId: 'op', amount: 25000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: true, expectedRevision: 2 });
  assert.equal(after.account.balance, 25000); assert.equal(after.bill.status, 'settled');
});
test('残高の反映状況・銀行の確証・請求額が不明なら引落処理しない', () => {
  const state = { account: { id: 'a', balance: 50000, revision: 1 }, bill: { id: 'b', accountId: 'a', amount: 25000, amountConfirmed: true, status: 'planned' } };
  const base = { operationId: 'op', amount: 25000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: false, expectedRevision: 1 };
  for (const patch of [{ bankConfirmed: false }, { amount: 26000 }, { balanceAlreadyIncludesDebit: undefined }, { date: '2026-11-11' }, { expectedRevision: 0 }]) assert.throws(() => recordDebit(state, { ...base, ...patch }));
  assert.equal(state.account.balance, 50000); assert.equal(state.bill.status, 'planned');
});
test('請求元の確定根拠や口座が不正な場合は処理しない', () => {
  const state = { account: { id: 'a', balance: 50000, revision: 1 }, bill: { id: 'b', accountId: 'a', amount: 25000, amountConfirmed: false, status: 'planned' } };
  assert.throws(() => confirmBill(state, { issuerConfirmed: false, amount: 25000 }));
  assert.throws(() => confirmBill({ ...state, bill: { ...state.bill, accountId: 'other' } }, { issuerConfirmed: true, amount: 25000 }));
});
test('引落処理後の残高を試算に渡しても同じ支払いを再び引かない', () => {
  const state = { account: { id: 'a', balance: 50000, revision: 1 }, bill: { id: 'b', accountId: 'a', amount: 25000, amountConfirmed: true, status: 'planned' } };
  const result = recordDebit(state, { operationId: 'op', amount: 25000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: false, expectedRevision: 1 });
  const readiness = calculateReadiness({ today: '2026-11-11', endDate: '2026-12-31', coverageVerified: true, accounts: [account('a', result.account.balance)], events: [bill('b', '2026-11-10', 'a', 25000, { status: 'settled' }), bill('next', '2026-12-10', 'a', 10000)] });
  assert.equal(readiness.nextPayments[0].projectedBalance, 15000);
});
test('実行状態が不明または未来日の実行済みは拒否', () => {
  assert.throws(() => plan([account('a', 50000)], [bill('next', '2026-11-10', 'a', 20000, { status: undefined })]));
  assert.throws(() => plan([account('a', 50000)], [bill('next', '2026-11-10', 'a', 20000, { status: 'settled' })]));
});
test('対象期間にカード引落がない場合も安全とは断定しない', () => {
  const r = plan([account('a', 50000)], []); assert.equal(r.nextStatus, 'review'); assert.equal(r.futureStatus, 'review');
});
test('未知の口座は黙って除外せずエラー', () => assert.throws(() => plan([account('a', 50000)], [bill('b', '2026-11-10', 'missing', 30000)])));
test('不正日付・重複予定IDを拒否', () => {
  assert.throws(() => plan([account('a', 50000)], [bill('b', '2026-11-31', 'a', 1000)]));
  assert.throws(() => plan([account('a', 50000)], [bill('b', '2026-11-10', 'a', 1000), bill('b', '2026-11-11', 'a', 1000)]));
});
test('資料と同じ入出金の順序を架空金額で再現する', () => {
  // 入出金の順序だけ資料に合わせた架空値。実際の金融情報はテストへ入れない。
  const r = plan([account('ufj', 120000)], [
    bill('view1', '2026-11-04', 'ufj', 4000), income('allowance1', '2026-11-05', 'ufj', 50000),
    bill('jcb', '2026-11-10', 'ufj', 50000), bill('smbc', '2026-11-10', 'ufj', 30000), bill('mufg', '2026-11-10', 'ufj', 40000),
    income('salary', '2026-11-13', 'ufj', 60000), bill('epos', '2026-11-27', 'ufj', 15000),
    bill('view2', '2026-12-04', 'ufj', 7000), income('allowance2', '2026-12-07', 'ufj', 50000),
    bill('next', '2026-12-10', 'ufj', 100000)
  ]);
  const november = r.timeline.find(x => x.date === '2026-11-10');
  const december = r.timeline.find(x => x.date === '2026-12-10');
  assert.equal(november.cardAmount, 120000); assert.equal(november.projectedBalance, 46000);
  assert.equal(november.status, 'review'); assert.equal(december.projectedBalance, 34000);
});
test('残高・入金・請求の組合せを独立した手計算と比較', () => {
  for (const balance of [0, 1000, 5000, 10000]) {
    for (const incoming of [0, 1000, 5000, 10000]) {
      for (const charge of [1000, 5000, 10000]) {
        const r = plan([account('a', balance)], [income('salary', '2026-11-09', 'a', incoming), bill('b', '2026-11-10', 'a', charge)]);
        const expected = balance + incoming < charge ? 'shortfall' : balance < charge ? 'review' : 'safe';
        assert.equal(r.nextStatus, expected, `残高=${balance} 入金=${incoming} 請求=${charge}`);
        assert.equal(r.nextPayments[0].projectedBalance, balance + incoming - charge);
      }
    }
  }
});
test('複数日・同日支払いを独立した計算で1000通り検証', () => {
  let seed = 1234567;
  const amount = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed % 11) * 1000; };
  for (let i = 0; i < 1000; i++) {
    const start = amount(), earlyIncome = amount(), earlyExpense = amount(), card = amount(), other = amount(), sameDayIncome = amount();
    const events = [income('early-in', '2026-11-01', 'a', earlyIncome), expense('early-out', '2026-11-02', 'a', earlyExpense), bill('card', '2026-11-10', 'a', card), expense('other', '2026-11-10', 'a', other), income('same-in', '2026-11-10', 'a', sameDayIncome)];
    const result = plan([account('a', start)], events);
    const projected = start + earlyIncome - earlyExpense - card - other;
    const conservative = start - earlyExpense - card - other;
    const expected = projected + sameDayIncome < 0 ? 'shortfall' : projected < 0 || conservative < 0 ? 'review' : 'safe';
    assert.equal(result.nextStatus, expected, `組合せ ${i}`);
    assert.equal(result.nextPayments[0].projectedBalance, projected, `組合せ ${i}`);
    const reversed = plan([account('a', start)], [...events].reverse());
    assert.equal(reversed.nextStatus, result.nextStatus, `入力順 ${i}`);
    assert.equal(reversed.nextPayments[0].projectedBalance, projected, `入力順 ${i}`);
    assert.equal(reversed.futureStatus, result.futureStatus, `将来の入力順 ${i}`);
  }
});
test('整数の範囲を超える残高計算を拒否', () => {
  assert.throws(() => plan([account('a', Number.MAX_SAFE_INTEGER)], [income('salary', '2026-11-01', 'a', 1), bill('b', '2026-11-10', 'a', 1)]));
});
test('総額がない場合は個別メール明細を合計', () => assert.equal(reconcile(null, [row('1', 1000), row('2', 2000)]).amount, 3000));
test('確定請求額は内訳を重複加算しない', () => {
  const r = reconcile({ status: 'confirmed', amount: 10000 }, [row('1', 3000, { inclusion: 'included' })]);
  assert.equal(r.amount, 10000); assert.equal(r.needsReview, false);
});
test('内訳合計が確定額を超える矛盾は安全としない', () => {
  const r = reconcile({ status: 'confirmed', amount: 1000 }, [row('1', 2000, { inclusion: 'included' })]);
  assert.equal(r.amount, 1000); assert.equal(r.confirmed, false); assert.ok(r.issues.some(x => x.type === 'included_exceeds_snapshot'));
});
test('累計の確認時刻が不明なら確定情報として扱わない', () => {
  const r = reconcile({ status: 'confirmed', amount: 1000, checkedAt: '' }, []);
  assert.equal(r.sourceConfirmed, true); assert.equal(r.confirmed, false); assert.equal(r.needsReview, true);
});
test('最新利用時刻が確認時刻の後なら照合状態を保留', () => {
  const r = reconcile({ status: 'estimate', amount: 1000, latestUsedAt: '2026-11-03T12:00:00+09:00' }, []);
  assert.ok(r.issues.some(x => x.type === 'snapshot_time_conflict'));
});
test('途中累計に含まれる明細は再加算しない', () => assert.equal(reconcile({ status: 'estimate', amount: 10000 }, [row('1', 3000, { inclusion: 'included' })]).amount, 10000));
test('累計確認後の利用を確認時点の累計に含まれると断定しない', () => {
  const later = row('1', 3000, { usedAt: '2026-11-03T12:00:00+09:00', inclusion: 'included' });
  const estimated = reconcile({ status: 'estimate', amount: 10000 }, [later]);
  assert.equal(estimated.amount, 10000); assert.equal(estimated.possibleAdditional, 3000);
  assert.ok(estimated.issues.some(x => x.type === 'inclusion_time_conflict'));
  const confirmed = reconcile({ status: 'confirmed', amount: 10000 }, [later]);
  assert.equal(confirmed.amount, 10000); assert.equal(confirmed.confirmed, false);
  assert.ok(confirmed.issues.some(x => x.type === 'inclusion_time_conflict'));
});
test('累計に含まれないことが確認された利用だけ加算', () => assert.equal(reconcile({ status: 'estimate', amount: 10000 }, [row('1', 3000, { inclusion: 'not_included' })]).amount, 13000));
test('包含不明は確定加算せず追加の可能性として表示', () => {
  const r = reconcile({ status: 'estimate', amount: 10000 }, [row('1', 3000)]);
  assert.equal(r.amount, 10000); assert.equal(r.possibleAdditional, 3000); assert.equal(r.needsReview, true);
});
test('累計更新後は前回の追加分をもう一度足さない', () => {
  const first = reconcile({ status: 'estimate', amount: 10000 }, [row('1', 3000, { inclusion: 'not_included' })]);
  const refreshed = reconcile({ status: 'estimate', amount: 13000 }, [row('1', 3000, { inclusion: 'included' })]);
  assert.equal(first.amount, 13000); assert.equal(refreshed.amount, 13000);
});
test('未照合の上限は支払い能力の要確認につながる', () => {
  const c = reconcile({ status: 'estimate', amount: 10000 }, [row('1', 3000)]);
  const r = plan([account('a', 12000)], [bill('b', '2026-11-10', 'a', c.amount, { amountConfirmed: c.confirmed, additionalPossible: c.possibleAdditional })]);
  assert.equal(c.upperEstimate, 13000); assert.equal(r.nextStatus, 'review');
});
function composedBill(cardId, amount, extra = {}) {
  return { cardId, cycle: '2026-10', accountId: 'a', dueDate: '2026-11-10', status: 'planned', snapshot: { cardId, cycle: '2026-10', amount, status: 'confirmed', checkedAt: '2026-10-30T10:00:00+09:00' }, entries: [], ...extra };
}
function composed(extra = {}) {
  return { today: '2026-10-30', endDate: '2026-12-31', coverageVerified: true, accounts: [account('a', 80000), account('b', 30000)], cardBills: [], otherEvents: [], ...extra };
}
test('3枚のカード・予定給与・水道代をまとめて口座別に試算', () => {
  const input = composed({ cardBills: [composedBill('jcb', 20000), composedBill('smbc', 30000), composedBill('mufg', 25000, { accountId: 'b' })], otherEvents: [income('salary', '2026-11-09', 'a', 20000), expense('water', '2026-11-20', 'a', 15000)] });
  const result = evaluateCashflow(input);
  assert.equal(result.nextPayments.length, 2); assert.equal(result.nextStatus, 'safe');
  assert.equal(result.nextPayments.find(item => item.accountId === 'a').cardAmount, 50000);
  assert.equal(result.nextPayments.find(item => item.accountId === 'b').cardAmount, 25000);
  assert.equal(result.futureStatus, 'safe');
});
test('確定請求に含まれるメール明細は二重加算せず、不明な明細は要確認', () => {
  const entry = { id: 'mail', cardId: 'jcb', cycle: '2026-10', amount: 3000, origin: 'email', messageId: 'm1', usedAt: '2026-10-29T10:00:00+09:00', evidenceComplete: true, duplicateCheck: 'clear', inclusion: 'included' };
  const verified = evaluateCashflow(composed({ cardBills: [composedBill('jcb', 20000, { entries: [entry] })] }));
  assert.equal(verified.cards[0].amount, 20000); assert.equal(verified.nextStatus, 'safe');
  const unresolved = evaluateCashflow(composed({ cardBills: [composedBill('jcb', 20000, { entries: [{ ...entry, inclusion: undefined }] })] }));
  assert.equal(unresolved.cards[0].amount, 20000); assert.equal(unresolved.nextStatus, 'review');
});
test('未確定累計への未照合明細と将来の未確定水道代を安全と断定しない', () => {
  const entry = { id: 'mail', cardId: 'jcb', cycle: '2026-10', amount: 15000, origin: 'email', messageId: 'm1', usedAt: '2026-10-29T10:00:00+09:00', evidenceComplete: true, duplicateCheck: 'clear' };
  const card = composedBill('jcb', 70000, { snapshot: { cardId: 'jcb', cycle: '2026-10', amount: 70000, status: 'estimate', checkedAt: '2026-10-30T10:00:00+09:00', latestUsedAt: '2026-10-29T10:00:00+09:00' }, entries: [entry] });
  const result = evaluateCashflow(composed({ cardBills: [card], otherEvents: [expense('water', '2026-11-20', 'a', 0, { amountConfirmed: false })] }));
  assert.equal(result.cards[0].possibleAdditional, 15000); assert.equal(result.nextStatus, 'review'); assert.equal(result.futureStatus, 'review');
});
test('同一カードの同じ請求期間と同じメールの別カード混入を拒否', () => {
  assert.throws(() => evaluateCashflow(composed({ cardBills: [composedBill('jcb', 1000), composedBill('jcb', 1000)] })), /重複/);
  const entry = cardId => ({ id: 'one', cardId, cycle: '2026-10', amount: 1000, origin: 'email', messageId: 'same', usedAt: '2026-10-29T10:00:00+09:00', evidenceComplete: true, duplicateCheck: 'clear', inclusion: 'included' });
  assert.throws(() => evaluateCashflow(composed({ cardBills: [composedBill('jcb', 1000, { entries: [entry('jcb')] }), composedBill('smbc', 1000, { entries: [entry('smbc')] })] })), /同じメール/);
});
test('引落状態が不明・対象情報が不足していると安全にしない', () => {
  assert.throws(() => evaluateCashflow(composed({ cardBills: [composedBill('jcb', 1000, { status: undefined })] })), /引落状態/);
  const result = evaluateCashflow(composed({ coverageVerified: false, cardBills: [composedBill('jcb', 1000)] }));
  assert.equal(result.nextStatus, 'review'); assert.equal(result.futureStatus, 'review');
});
test('同じメールの再取得は二重加算しない', () => {
  const r = reconcile(null, [row('1', 1000, { messageId: 'same' }), row('2', 1000, { messageId: 'same' })]);
  assert.equal(r.amount, 1000); assert.ok(r.issues.some(x => x.type === 'duplicate_message'));
});
test('同じメールの抽出金額が食い違う場合は追加の可能性を残す', () => {
  const r = reconcile(null, [row('1', 1000, { messageId: 'same' }), row('2', 5000, { messageId: 'same' })]);
  assert.equal(r.amount, 1000); assert.equal(r.possibleAdditional, 5000);
  assert.ok(r.issues.some(x => x.type === 'duplicate_message_conflict'));
  const readiness = plan([account('a', 3000)], [bill('b', '2026-11-10', 'a', r.amount, { amountConfirmed: r.confirmed, additionalPossible: r.possibleAdditional })]);
  assert.equal(readiness.nextStatus, 'review');
});
test('同日同額でも別々の明細を勝手に統合しない', () => assert.equal(reconcile(null, [row('1', 1000), row('2', 1000)]).amount, 2000));
test('同一取引か曖昧な別メールは要確認', () => {
  const r = reconcile(null, [row('1', 1000), row('2', 1000, { duplicateRisk: true })]);
  assert.equal(r.amount, 1000); assert.equal(r.possibleAdditional, 1000);
});
test('重複照合が未実施のメールを自動加算しない', () => {
  const r = reconcile(null, [row('1', 1000, { duplicateCheck: undefined })]);
  assert.equal(r.amount, 0); assert.equal(r.possibleAdditional, 1000); assert.ok(r.issues.some(x => x.type === 'duplicate_unchecked'));
});
test('利用時刻が欠けるメールは自動加算しない', () => assert.equal(reconcile(null, [row('1', 1000, { usedAt: '' })]).amount, 0));
test('あり得ない日付やタイムゾーンのない時刻は要確認', () => {
  assert.equal(reconcile(null, [row('1', 1000, { usedAt: '2026-02-30T12:00:00+09:00' })]).amount, 0);
  assert.equal(reconcile(null, [row('2', 1000, { usedAt: '2026-11-01T12:00:00' })]).amount, 0);
});
test('メール識別子のない通知は自動加算しない', () => assert.equal(reconcile(null, [row('1', 1000, { messageId: '' })]).amount, 0));
test('明細の取得元が不明ならメール重複確認をすり抜けない', () => {
  for (const origin of [undefined, '', 'unknown']) {
    assert.throws(() => reconcile(null, [row('1', 1000, { origin, messageId: '' })]), /取得元/);
  }
});
test('手入力と明示された明細は証拠があれば利用として扱える', () => {
  const r = reconcile(null, [row('1', 1000, { origin: 'manual', messageId: '' })]);
  assert.equal(r.amount, 1000);
});
test('同一メールに異なる金額がある場合は入力順で上限が変わらない', () => {
  const a = row('1', 1000, { messageId: 'same' });
  const b = row('2', 5000, { messageId: 'same' });
  const forward = reconcile(null, [a, b]);
  const reverse = reconcile(null, [b, a]);
  assert.equal(forward.upperEstimate, 6000); assert.equal(reverse.upperEstimate, 6000);
  assert.equal(forward.needsReview, true); assert.equal(reverse.needsReview, true);
});
test('同じメールの金額が食い違う場合は入力順にかかわらず不足を断定しない', () => {
  const a = { ...row('1', 1000, { messageId: 'same' }), cycle: '2026-10' };
  const b = { ...row('2', 5000, { messageId: 'same' }), cycle: '2026-10' };
  const evaluate = entries => evaluateCashflow(composed({ accounts: [account('a', 3000)], cardBills: [composedBill('jcb', 0, { snapshot: null, entries })] }));
  for (const entries of [[a, b], [b, a]]) {
    const result = evaluate(entries);
    assert.equal(result.nextStatus, 'review');
    assert.equal(result.nextPayments[0].projectedBalance, 3000);
    assert.equal(result.nextPayments[0].confirmedBalance, -3000);
  }
});
test('重複メールの食い違いは推定累計そのものを減らさず、元の加算分だけ不確実にする', () => {
  const a = row('1', 1000, { messageId: 'same', inclusion: 'not_included' });
  const b = row('2', 5000, { messageId: 'same', inclusion: 'not_included' });
  const c = row('3', 5000, { messageId: 'same', inclusion: 'not_included' });
  const r = reconcile({ status: 'estimate', amount: 10000 }, [a, b, c]);
  assert.equal(r.minimumAmount, 10000);
  assert.equal(r.upperEstimate, 21000);
  assert.equal(r.needsReview, true);
});
test('確定請求に食い違う同じメールがあっても確定請求額そのものは減らさない', () => {
  const a = { ...row('1', 1000, { messageId: 'same', inclusion: 'included' }), cycle: '2026-10' };
  const b = { ...row('2', 5000, { messageId: 'same', inclusion: 'included' }), cycle: '2026-10' };
  const r = evaluateCashflow(composed({ cardBills: [composedBill('jcb', 20000, { entries: [a, b] })] }));
  assert.equal(r.cards[0].minimumAmount, 20000);
  assert.equal(r.nextPayments[0].projectedBalance, 60000);
  assert.equal(r.nextStatus, 'review');
});
test('受信時刻だけでは利用時刻の証拠にならない', () => assert.equal(reconcile(null, [row('1', 1000, { usedAt: '', detectedAt: '2026-11-01T12:00:00+09:00' })]).needsReview, true));
test('確定請求後に新規利用が届いた場合は勝手に加算せず確認', () => {
  const r = reconcile({ status: 'confirmed', amount: 10000 }, [row('1', 3000, { inclusion: 'not_included' })]);
  assert.equal(r.amount, 10000); assert.equal(r.possibleAdditional, 0); assert.equal(r.needsReview, true);
});
test('取消・返金は対象を確認するまで勝手に減額しない', () => {
  const r = reconcile({ status: 'estimate', amount: 10000 }, [row('1', 3000, { type: 'refund' })]);
  assert.equal(r.amount, 10000); assert.ok(r.issues.some(x => x.type === 'refund_or_cancellation'));
});
test('照合済みの返金は指定された購入のみ減額する計画を作る', () => {
  const purchases = [{ id: 'a', cardId: 'jcb', amount: 1000, refundedAmount: 0, billStatus: 'estimate' }, { id: 'b', cardId: 'jcb', amount: 1000, refundedAmount: 0, billStatus: 'estimate' }];
  const notice = { id: 'mail1', type: 'refund', cardId: 'jcb', amount: 400, amountConfirmed: true, targetConfirmed: true, targetId: 'b' };
  const result = planRefund({ notice, purchases });
  assert.equal(result.status, 'ready'); assert.equal(result.plan.targetId, 'b'); assert.equal(result.plan.remainingAmount, 600);
  assert.equal(purchases[0].refundedAmount, 0); assert.equal(purchases[1].refundedAmount, 0);
});
test('返金通知は対象不明・カード違い・返金超過を自動処理しない', () => {
  const purchase = { id: 'a', cardId: 'jcb', amount: 1000, refundedAmount: 300, billStatus: 'estimate' };
  const notice = { id: 'mail1', type: 'refund', cardId: 'jcb', amount: 400, amountConfirmed: true, targetConfirmed: true, targetId: 'a' };
  for (const changed of [{ targetConfirmed: false }, { cardId: 'other' }, { amount: 701 }, { targetId: 'missing' }]) {
    assert.equal(planRefund({ notice: { ...notice, ...changed }, purchases: [purchase] }).status, 'review');
  }
  assert.equal(planRefund({ notice, purchases: [purchase, purchase] }).reason, 'target_not_unique');
});
test('同じ返金通知の再取得は二重に処理せず内容違いは要確認', () => {
  const notice = { id: 'mail1', type: 'refund', cardId: 'jcb', amount: 400, targetId: 'a' };
  const processed = [{ noticeId: 'mail1', type: 'refund', cardId: 'jcb', amount: 400, targetId: 'a' }];
  assert.equal(planRefund({ notice, purchases: [], processed }).status, 'already-applied');
  assert.equal(planRefund({ notice: { ...notice, targetId: 'b' }, purchases: [], processed }).reason, 'notice_conflict');
  assert.equal(planRefund({ notice: { ...notice, amount: 500 }, purchases: [], processed }).reason, 'notice_conflict');
});
test('取消の部分額や請求確定・引落後の返金は計上先を確認する', () => {
  const notice = { id: 'm', type: 'cancel', cardId: 'jcb', amount: 500, targetId: 'a', targetConfirmed: true, amountConfirmed: true };
  const purchase = { id: 'a', cardId: 'jcb', amount: 1000, refundedAmount: 0, billStatus: 'estimate' };
  assert.equal(planRefund({ notice, purchases: [purchase] }).reason, 'amount_conflict');
  for (const billStatus of ['confirmed', 'settled', undefined]) assert.equal(planRefund({ notice: { ...notice, type: 'refund' }, purchases: [{ ...purchase, billStatus }] }).reason, 'billing_period_unresolved');
});
const csvRow = (id, extra = {}) => ({ id, cardId: 'jcb', cycle: '2026-11', usedDate: '2026-10-31', amount: 1000, ...extra });
test('CSVを使わなくても照合案は空のまま作れる', () => {
  const result = planCsv({ cardId: 'jcb', cycle: '2026-11', existing: [csvRow('manual')], rows: [] });
  assert.deepEqual(result.decisions, []); assert.equal(result.needsReview, false);
});
test('同じ取引の外部ID・日付・金額が一致すれば二重追加しない', () => {
  const result = planCsv({ cardId: 'jcb', cycle: '2026-11', existing: [csvRow('mail', { externalRef: 'ref1', referenceVerified: true })], rows: [csvRow('csv', { externalRef: 'ref1', referenceVerified: true })] });
  assert.equal(result.decisions[0].status, 'matched'); assert.deepEqual(result.decisions[0].candidateIds, ['mail']);
});
test('外部IDの出所を確認できないときは一致と断定しない', () => {
  const result = planCsv({ cardId: 'jcb', cycle: '2026-11', existing: [csvRow('mail', { externalRef: 'ref1' })], rows: [csvRow('csv', { externalRef: 'ref1' })] });
  assert.equal(result.decisions[0].reason, 'reference_unverified');
});
test('同日同額だけでは同一取引と決めず両方を保持できる', () => {
  const result = planCsv({ cardId: 'jcb', cycle: '2026-11', existing: [csvRow('mail')], rows: [csvRow('csv')] });
  assert.equal(result.decisions[0].status, 'review'); assert.equal(result.decisions[0].reason, 'possible_duplicate');
  const rows = planCsv({ cardId: 'jcb', cycle: '2026-11', rows: [csvRow('a'), csvRow('b')] });
  assert.deepEqual(rows.decisions.map(item => item.reason), ['similar_csv_rows', 'similar_csv_rows']);
});
test('同じ外部IDに複数のCSV行や金額の不一致があれば確認する', () => {
  const rows = planCsv({ cardId: 'jcb', cycle: '2026-11', rows: [csvRow('a', { externalRef: 'ref' }), csvRow('b', { externalRef: 'ref', amount: 2000 })] });
  assert.ok(rows.decisions.every(item => item.reason === 'repeated_reference'));
  const conflict = planCsv({ cardId: 'jcb', cycle: '2026-11', existing: [csvRow('mail', { externalRef: 'ref' })], rows: [csvRow('csv', { externalRef: 'ref', amount: 2000 })] });
  assert.equal(conflict.decisions[0].reason, 'reference_conflict');
});
test('CSVの別カード・別請求期間・不正日付を混ぜない', () => {
  for (const change of [{ cardId: 'other' }, { cycle: '2026-12' }, { usedDate: '2026-02-30' }]) {
    assert.throws(() => planCsv({ cardId: 'jcb', cycle: '2026-11', rows: [csvRow('a', change)] }));
  }
});
test('別のカード・請求期間の混入を拒否', () => {
  assert.throws(() => reconcile(null, [row('1', 1000, { cardId: 'other' })]));
  assert.throws(() => reconcile(null, [row('1', 1000, { cycle: '2026-12' })]));
  assert.throws(() => reconcile({ status: 'estimate', amount: 1000, cardId: 'other' }, []));
  assert.throws(() => reconcile({ status: 'estimate', amount: 1000, cycle: '2026-12' }, []));
});
test('累計と未照合額の合算が安全な整数を超える場合を拒否', () => assert.throws(() => reconcile({ status: 'estimate', amount: Number.MAX_SAFE_INTEGER }, [row('1', 1)])));

function migrationFixture() {
  return { workspaceId: 'test', workspace: { state: { accounts: [{ id: 'a', currentBalance: 1000 }], transactions: [{ id: 't', amount: 500, futureField: 'preserve' }] } }, collections: Object.fromEntries(['importCandidates', 'receipts', 'receiptItems', 'itemAliases'].map(name => [name, { complete: true, documents: [{ id: 'one', data: { name, flag: true } }] }])) };
}
test('移行照合はすべての架空文書と未知の項目を比較する', () => {
  const source = migrationFixture(), copy = JSON.parse(JSON.stringify(source));
  assert.equal(compareMigration(source, copy).matches, true);
  delete copy.workspace.state.transactions[0].futureField;
  assert.equal(compareMigration(source, copy).matches, false);
});
test('レシート明細やメール候補の欠落を移行成功としない', () => {
  for (const name of ['importCandidates', 'receipts', 'receiptItems', 'itemAliases']) {
    const source = migrationFixture(), copy = migrationFixture();
    copy.collections[name].documents = [];
    assert.equal(compareMigration(source, copy).matches, false, name);
    copy.collections[name].complete = false;
    assert.throws(() => compareMigration(source, copy), /取得が完了/);
  }
});
test('移行照合は文書取得順の違いを無視し内容の差は検出', () => {
  const source = migrationFixture();
  source.collections.receipts.documents.push({ id: 'two', data: { amount: 100 } });
  const copy = JSON.parse(JSON.stringify(source)); copy.collections.receipts.documents.reverse();
  assert.equal(compareMigration(source, copy).matches, true);
  copy.collections.receipts.documents[0].data.amount = 101;
  assert.equal(compareMigration(source, copy).matches, false);
});
test('同一文書IDの重複やJSONで表せない値を拒否', () => {
  const source = migrationFixture(), copy = migrationFixture();
  copy.collections.receipts.documents.push(copy.collections.receipts.documents[0]);
  assert.throws(() => compareMigration(source, copy), /文書ID/);
  copy.collections.receipts.documents.pop(); copy.workspace.state.transactions[0].amount = NaN;
  assert.throws(() => compareMigration(source, copy), /JSON/);
});

test('隔月の水道代を指定された月だけ生成し未知の金額は未確定', () => {
  const water = generateRecurring({ id: 'water', accountId: 'a', firstDate: '2026-10-20', intervalMonths: 2 }, '2026-10-30', '2027-04-30');
  assert.deepEqual(water.map(item => item.date), ['2026-12-20', '2027-02-20', '2027-04-20']);
  assert.ok(water.every(item => item.amount === 0 && item.amountConfirmed === false));
  const result = plan([account('a', 50000)], [bill('card', '2026-11-10', 'a', 10000), ...water]);
  assert.equal(result.futureStatus, 'review');
});
test('月末は各月の最終日に調整し翌月以降は元の日に戻す', () => {
  const entries = generateRecurring({ id: 'r', accountId: 'a', firstDate: '2028-01-31', intervalMonths: 1, amount: 1000 }, '2028-01-01', '2028-04-30');
  assert.deepEqual(entries.map(item => item.date), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30']);
  assert.ok(entries.every(item => item.amountConfirmed === false));
});
test('同じ定期予定で登録済みの支払いを二重に生成しない', () => {
  const entries = generateRecurring({ id: 'water', accountId: 'a', firstDate: '2026-10-20', intervalMonths: 2, amount: 4000 }, '2026-10-01', '2027-02-28', [{ recurringPlanId: 'water', date: '2026-12-20', status: 'planned' }]);
  assert.deepEqual(entries.map(item => item.date), ['2026-10-20', '2027-02-20']);
});
test('定期予定の重複や実行状態不明は勝手に解消せず拒否', () => {
  const recurring = { id: 'water', accountId: 'a', firstDate: '2026-10-20', intervalMonths: 2 };
  const entry = { recurringPlanId: 'water', date: '2026-12-20', status: 'planned' };
  assert.throws(() => generateRecurring(recurring, '2026-10-01', '2027-02-28', [entry, entry]), /重複/);
  assert.throws(() => generateRecurring(recurring, '2026-10-01', '2027-02-28', [{ ...entry, status: 'unknown' }]), /実行状態/);
});
test('予定日・間隔・金額が不正な定期予定は拒否', () => {
  const recurring = { id: 'water', accountId: 'a', firstDate: '2026-10-20', intervalMonths: 2 };
  for (const patch of [{ firstDate: '2026-02-30' }, { intervalMonths: 0 }, { amount: -1 }, { amount: 2.5 }]) {
    assert.throws(() => generateRecurring({ ...recurring, ...patch }, '2026-10-01', '2027-02-28'));
  }
});

function legacyFixture() {
  return { accounts: [{ id: 'a', currentBalance: 50000 }], cards: [{ id: 'c', accountId: 'a', closingDay: 15, paymentDay: 10, paymentMonthOffset: 1 }], recurringPlans: [], transactions: [
    { id: 'bill', kind: 'payment', status: 'planned', amount: 20000, cardId: 'c', entryType: 'statement', dueDate: '2026-11-10', transactionDate: '2026-11-10' },
    { id: 'mail', kind: 'payment', status: 'planned', amount: 3000, cardId: 'c', entryType: 'itemized', dueDate: '2026-11-10', transactionDate: '2026-10-01' },
    { id: 'salary', kind: 'income', status: 'planned', amount: 10000, sourceAccountId: 'a', dueDate: '2026-11-09' }
  ] };
}
test('旧請求総額とメール明細は内訳か不明なので二重加算せず可能額に残す', () => {
  const old = legacyFixture(), before = JSON.stringify(old);
  const converted = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  const card = converted.scenario.events.find(event => event.cardPayment);
  assert.equal(card.amount, 20000); assert.equal(card.additionalPossible, 3000);
  assert.equal(card.amountConfirmed, false); assert.equal(converted.scenario.coverageVerified, false);
  assert.equal(calculateReadiness(converted.scenario).nextStatus, 'review');
  assert.equal(JSON.stringify(old), before);
});
test('旧記録の未確認残高・定期予定・除外取引は安全の根拠にしない', () => {
  const old = legacyFixture(); old.recurringPlans = [{ id: 'water' }];
  old.transactions.push({ id: 'excluded', status: 'planned', affectsForecast: false });
  const converted = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  assert.equal(converted.scenario.accounts[0].balanceVerified, false);
  assert.ok(converted.issues.some(issue => issue.type === 'recurring_plans_not_mapped'));
  assert.ok(converted.issues.some(issue => issue.type === 'excluded_transaction'));
});
test('メール候補一覧を取得していなければ未取得を明示する', () => {
  const result = buildLegacyScenario(legacyFixture(), '2026-10-30', '2026-12-31');
  assert.ok(result.issues.some(issue => issue.type === 'mail_candidates_unavailable'));
  assert.equal(calculateReadiness(result.scenario).nextStatus, 'review');
});
test('未確認メールと取引が見つからない取込済みメールを見逃さない', () => {
  const old = legacyFixture();
  const candidates = [{ id: 'pending', status: 'pending' }, { id: 'review', status: 'needs_review' }, { id: 'missing', status: 'accepted' }, { id: 'ignored', status: 'ignored' }];
  const result = buildLegacyScenario(old, '2026-10-30', '2026-12-31', { candidates });
  assert.equal(result.issues.filter(issue => issue.type === 'mail_candidate_unreviewed').length, 2);
  assert.ok(result.issues.some(issue => issue.type === 'accepted_mail_without_transaction' && issue.id === 'missing'));
  assert.equal(result.issues.some(issue => issue.id === 'ignored'), false);
});
test('取引が残る取込済みメールは候補から二重に足さない', () => {
  const old = legacyFixture();
  old.transactions.push({ id: 'mail_accepted', kind: 'payment', cardId: 'c', entryType: 'itemized', status: 'planned', amount: 500, sourceAccountId: 'a', dueDate: '2026-11-10', transactionDate: '2026-10-01' });
  const result = buildLegacyScenario(old, '2026-10-30', '2026-12-31', { candidates: [{ id: 'accepted', status: 'accepted' }] });
  assert.equal(result.issues.some(issue => issue.type === 'accepted_mail_without_transaction'), false);
  assert.equal(result.scenario.events.find(event => event.cardPayment).additionalPossible, 3500);
});
test('不明な状態と重複IDのメール候補を黙って確定扱いしない', () => {
  const result = buildLegacyScenario(legacyFixture(), '2026-10-30', '2026-12-31', { candidates: [{ id: 'a', status: 'unknown' }] });
  assert.ok(result.issues.some(issue => issue.type === 'mail_candidate_status_unknown'));
  assert.throws(() => buildLegacyScenario(legacyFixture(), '2026-10-30', '2026-12-31', { candidates: [{ id: 'a', status: 'pending' }, { id: 'a', status: 'pending' }] }), /重複/);
});
test('旧データの不明なカードや複数の請求総額は推測で統合しない', () => {
  const old = legacyFixture(); old.cards[0].accountId = 'missing';
  assert.throws(() => buildLegacyScenario(old, '2026-10-30', '2026-12-31'), /引落口座/);
  const conflict = legacyFixture(); conflict.transactions.push({ ...conflict.transactions[0], id: 'bill2' });
  assert.throws(() => buildLegacyScenario(conflict, '2026-10-30', '2026-12-31'), /複数の総額/);
});
test('旧残高調整の増減方向を既存の残高計算とそろえる', () => {
  const old = legacyFixture();
  old.transactions.push({ id: 'add', kind: 'adjustment', status: 'planned', amount: -700, sourceAccountId: 'a', dueDate: '2026-11-08' });
  old.transactions.push({ id: 'subtract', kind: 'adjustment', status: 'planned', amount: 300, sourceAccountId: 'a', dueDate: '2026-11-08' });
  const { scenario } = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  for (const id of ['add', 'subtract']) {
    const original = old.transactions.find(item => item.id === id);
    const converted = scenario.events.find(item => item.id === `legacy:${id}`);
    const delta = converted.kind === 'income' ? converted.amount : -converted.amount;
    assert.equal(delta, accountDeltasFor(original)[0].delta);
  }
});
test('旧カードの返金は確認されるまで勝手に減額せず試算を停止しない', () => {
  const old = legacyFixture();
  old.transactions.push({ id: 'refund', kind: 'payment', status: 'planned', cardId: 'c', entryType: 'itemized', amount: -500, dueDate: '2026-11-10', transactionDate: '2026-10-01' });
  const result = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  assert.ok(result.issues.some(issue => issue.type === 'legacy_refund_unverified' && issue.id === 'refund'));
  assert.equal(result.scenario.events.find(item => item.cardPayment).amount, 20000);
  assert.equal(calculateReadiness(result.scenario).nextStatus, 'review');
});
test('旧明細と請求総額の引落日が異なる場合は勝手に同日にしない', () => {
  const old = legacyFixture(); old.transactions[1].dueDate = '2026-11-11';
  assert.throws(() => buildLegacyScenario(old, '2026-10-30', '2026-12-31'), /引落日/);
});
test('旧メール明細だけの場合は重複照合がない金額を確定額にしない', () => {
  const old = legacyFixture();
  old.transactions = [old.transactions[1], { ...old.transactions[1], id: 'mail2' }];
  const result = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  const card = result.scenario.events.find(event => event.cardPayment);
  assert.equal(card.amount, 0); assert.equal(card.additionalPossible, 6000);
  assert.equal(calculateReadiness(result.scenario).nextStatus, 'review');
  assert.ok(result.issues.some(issue => issue.type === 'legacy_card_details_unverified'));
});
test('旧定期予定は登録済みの同月取引と重複させず残りの月を展開', () => {
  const old = legacyFixture();
  old.recurringPlans = [{ id: 'utility', dayOfMonth: 5, kind: 'payment', amount: 4000, sourceAccountId: 'a', isActive: true }];
  old.transactions.push({ id: 'registered', status: 'planned', kind: 'payment', amount: 4000, sourceAccountId: 'a', dueDate: '2026-11-05', recurringPlanId: 'utility' });
  const { scenario, issues } = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  const utility = scenario.events.filter(event => event.kind === 'expense' && !event.cardPayment);
  assert.deepEqual(utility.map(event => event.date).sort(), ['2026-11-05', '2026-12-05']);
  assert.ok(utility.every(event => event.amount === 4000 && event.amountConfirmed === false));
  assert.equal(issues.some(issue => issue.type === 'recurring_plans_not_mapped'), false);
});
test('登録済み給与とシフト見込みを二重に足さず未入金として扱う', () => {
  const old = legacyFixture();
  old.settings = { wage: { hourlyRate: 1000, salaryPaymentDay: 15, salaryMonthOffset: 1, depositAccountId: 'a' } };
  old.workEntries = [{ id: 'shift', date: '2026-10-02', hours: 10, status: 'worked' }];
  old.transactions.push({ id: 'salary-nov', kind: 'income', status: 'planned', salaryPaymentMonth: '2026-11', amount: 9000, sourceAccountId: 'a', dueDate: '2026-11-13' });
  const result = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  const salaries = result.scenario.events.filter(event => event.date === '2026-11-13');
  assert.equal(salaries.length, 1); assert.equal(salaries[0].amount, 9000);
  assert.equal(salaries[0].status, 'planned');
});
test('登録を消した給与はシフトから復活させず、口座不明なら入金を作らない', () => {
  const old = legacyFixture();
  old.workEntries = [{ id: 'shift', date: '2026-10-02', hours: 10, status: 'worked' }];
  old.settings = { wage: { hourlyRate: 1000, salaryPaymentDay: 15, salaryMonthOffset: 1, depositAccountId: 'a', dismissedSalaryMonths: ['2026-11'] } };
  let result = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  assert.equal(result.scenario.events.some(event => event.id === 'legacy-salary:2026-11'), false);
  old.settings.wage.dismissedSalaryMonths = []; old.settings.wage.depositAccountId = '';
  result = buildLegacyScenario(old, '2026-10-30', '2026-12-31');
  assert.equal(result.scenario.events.some(event => event.id === 'legacy-salary:2026-11'), false);
  assert.ok(result.issues.some(issue => issue.type === 'salary_account_unknown'));
});
test('重複した給与記録を黙って合算しない', () => {
  const old = legacyFixture();
  old.transactions.push({ id: 's1', status: 'planned', salaryPaymentMonth: '2026-11' }, { id: 's2', status: 'planned', salaryPaymentMonth: '2026-11' });
  assert.throws(() => buildLegacyScenario(old, '2026-10-30', '2026-12-31'), /給与記録が重複/);
});
test('同じ月の定期支払いが二重登録されていれば警告する', () => {
  const old = legacyFixture();
  old.transactions.push(
    { id: 'one', status: 'planned', recurringPlanId: 'utility', dueDate: '2026-11-05' },
    { id: 'two', status: 'planned', recurringPlanId: 'utility', dueDate: '2026-11-05' }
  );
  assert.throws(() => buildLegacyScenario(old, '2026-10-30', '2026-12-31'), /定期支払いが重複/);
});

test('旧データの締め日と引落判定をまとめて確認し入力を変更しない', () => {
  const state = legacyFixture(), before = JSON.stringify(state);
  const result = previewLegacy({ state, today: '2026-10-30', endDate: '2026-12-31', selectedCardIds: ['c'], candidates: [{ id: 'pending', status: 'pending' }] });
  assert.equal(result.period.deadline, '2026-11-15');
  assert.equal(result.assessment.nextDate, '2026-11-10');
  assert.equal(result.assessment.nextStatus, 'review');
  assert.ok(result.issues.some(issue => issue.type === 'mail_candidate_unreviewed'));
  assert.equal(JSON.stringify(state), before);
});
test('締め日の基準に選ばないカードも引落口座の不足判定に含める', () => {
  const state = legacyFixture();
  state.accounts.push({ id: 'b', currentBalance: 1000 });
  state.cards.push({ id: 'other', accountId: 'b', closingDay: 15, paymentDay: 10 });
  state.transactions.push({ id: 'other-bill', kind: 'payment', status: 'planned', amount: 5000, cardId: 'other', entryType: 'statement', dueDate: '2026-11-10', transactionDate: '2026-11-10' });
  const result = previewLegacy({ state, today: '2026-10-30', endDate: '2026-12-31', selectedCardIds: ['c'] });
  assert.equal(result.assessment.nextStatus, 'shortfall');
  assert.ok(result.assessment.nextPayments.some(item => item.accountId === 'b'));
  assert.ok(result.issues.some(issue => issue.type === 'mail_candidates_unavailable'));
  assert.ok(result.issues.some(issue => issue.type === 'card_name_missing' && issue.cardId === 'other'));
});
test('締め日より前に終わる試算期間や不明な基準カードは拒否する', () => {
  const state = legacyFixture();
  assert.throws(() => previewLegacy({ state, today: '2026-10-30', endDate: '2026-11-14', selectedCardIds: ['c'] }), /締め日/);
  assert.throws(() => previewLegacy({ state, today: '2026-10-30', endDate: '2026-12-31', selectedCardIds: ['unknown'] }), /カード/);
  assert.throws(() => previewLegacy({ state, today: '2026-10-30', endDate: '2026-99-99', selectedCardIds: ['c'] }), /期間/);
});

const failures = [];
for (const c of cases) { try { c.fn(); } catch (error) { failures.push({ name: c.name, message: error.message }); } }
console.log(JSON.stringify({ suite: 'redesign-core', total: cases.length, passed: cases.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
