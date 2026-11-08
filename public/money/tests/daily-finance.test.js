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
test('missingOrInvalidInputsFailWithoutLegacyFallback', () => {
  assert.throws(() => run({ accounts: [] }), /口座/);
  const state = seed(); state.accounts[0].currentBalance = NaN; assert.throws(() => run(state));
});
const failures = checks.filter(c => !c.pass);
console.log(JSON.stringify({ suite: 'daily-finance', total: checks.length, passed: checks.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
