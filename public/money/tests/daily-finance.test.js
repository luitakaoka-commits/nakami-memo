const assert = require('node:assert/strict');
const { overview } = require('../daily-finance.js');
const seed = () => ({
  accounts: [{ id: 'bank', isPrimary: true, currentBalance: 100000, balanceEvidence: { source: 'bank-manual', amount: 100000, date: '2026-10-31' } }],
  cards: [{ id: 'main', accountId: 'bank', closingDay: 15, paymentDay: 10, paymentMonthOffset: 1 }],
  transactions: [
    { id: 'rent', kind: 'payment', sourceAccountId: 'bank', status: 'planned', amount: 20000, dueDate: '2026-11-01' },
    { id: 'card', kind: 'payment', sourceAccountId: 'bank', cardId: 'main', entryType: 'itemized', status: 'planned', amount: 30000, transactionDate: '2026-10-20', dueDate: '2026-12-10' },
    { id: 'income', kind: 'income', sourceAccountId: 'bank', status: 'planned', amount: 50000, dueDate: '2026-11-05' }
  ],
  recurringPlans: [], workEntries: [], settings: { deadlineMode: 'legacy14', defenseLine: 5000, wage: {} }
});
const checks = [];
const test = (name, fn) => { try { fn(); checks.push({ name, pass: true }); } catch (e) { checks.push({ name, pass: false, message: e.message }); } };
const run = state => overview({ state, today: '2026-10-31', candidates: [] });
test('old14SettingDoesNotOverrideRealCardClosing', () => assert.equal(run(seed()).period.deadline, '2026-11-15'));
test('reserveFutureBillsAndDoNotSpendPlannedIncome', () => {
  const state = seed(), before = structuredClone(state), view = run(state);
  assert.equal(view.allowance.amount, 45000);
  assert.equal(view.throughDeadlineOnly, 75000);
  assert.equal(view.allowance.afterDeadline, 30000);
  assert.deepEqual(state, before);
  state.transactions.find(t => t.id === 'income').amount = 900000;
  assert.equal(run(state).allowance.amount, 45000);
});
test('honorExplicitCardSelection', () => {
  const state = seed(); state.cards.push({ id: 'other', accountId: 'bank', closingDay: 27, paymentDay: 10 });
  state.settings.deadlineCardIds = ['other'];
  assert.equal(run(state).period.deadline, '2026-11-27');
});
test('cancellationPreservesInputAndDoesNotBecomeRefund', () => {
  const state = seed(); state.transactions[1].status = 'cancelled'; const before = structuredClone(state);
  assert.equal(run(state).allowance.amount, 75000); assert.deepEqual(state, before);
});
test('unverifiedDataCannotBecomeSafe', () => {
  const state = seed(); delete state.accounts[0].balanceEvidence;
  const view = overview({ state, today: '2026-10-31', candidates: [{ id: 'x', status: 'pending' }] });
  assert.equal(view.pending, 1); assert.equal(view.unverifiedAccounts, 1);
  assert.notEqual(view.assessment.futureStatus, 'safe'); assert.equal(view.allowance.referenceOnly, true);
});
test('displayedBillAndProjectedBalanceIncludeTheSamePossibleCharges', () => {
  const view = run(seed());
  const row = view.assessment.timeline.find(t => t.date === '2026-12-10');
  // 残高10万−口座支払い2万＋予定入金5万−カード明細の見込み3万。
  assert.equal(row.projectedBalance, 100000);
  assert.equal(row.cardAmount + row.cardAdditionalPossible, 30000);
  // この見方でも、請求総額未確定を確認済みには昇格させない。
  assert.notEqual(row.status, 'safe');
});
test('missingOrInvalidInputsFailWithoutLegacyFallback', () => {
  assert.throws(() => run({ accounts: [] }), /口座/);
  const state = seed(); state.accounts[0].currentBalance = NaN; assert.throws(() => run(state));
});
test('configuredHorizonChangesDatesAndReservedPayments', () => {
  const expected = [[30, '2026-11-29'], [60, '2026-12-29'], [90, '2027-01-28'], [180, '2027-04-28']];
  for (const [days, endDate] of expected) {
    const state = seed(); state.settings.cashflowHorizonDays = days;
    const view = run(state);
    assert.equal(view.horizonDays, days);
    assert.equal(view.endDate, endDate);
    assert.equal(view.allowance.endDate, endDate);
    assert.equal(view.allowance.amount, days === 30 ? 75000 : 45000);
    assert.ok(view.assessment.timeline.every(row => row.date <= endDate));
  }
});
test('shortHorizonStillReservesPaymentsThroughClosingDate', () => {
  const state = seed(); state.settings.cashflowHorizonDays = 30;
  state.transactions.push({ id: 'closing-day', kind: 'payment', status: 'planned', sourceAccountId: 'bank', amount: 8000, dueDate: '2027-01-15' });
  const view = overview({ state, today: '2026-12-16', candidates: [] });
  assert.equal(view.endDate, '2027-01-14');
  assert.equal(view.period.deadline, '2027-01-15');
  assert.equal(view.allowance.endDate, '2027-01-15');
  assert.equal(view.allowance.amount, 87000);
});
const failures = checks.filter(c => !c.pass);
console.log(JSON.stringify({ suite: 'daily-finance', total: checks.length, passed: checks.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
