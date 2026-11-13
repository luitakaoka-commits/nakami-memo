/* 請求額と明細の二重計上を防ぐ（2026-11-13 ユーザー決定）。
 * 請求額は「カードアプリで見た日」時点の合計。見た日から「反映までの日数」より前に使った明細は請求額に含まれているとみなし、
 * それより後の明細だけを上乗せする。反映までの日数は、エポス0日（当日分まで含まれる）、ほかは2日（前日・当日は上乗せ）。
 * 実データで、未確認の請求額（JCB W 36,683円・SMBC 82,232円）に同じ期間の明細が全部足され、
 * 12/10 が 94,210円・184,692円 と出ていたのを受けたテスト。 */
const assert = require('node:assert/strict');
global.FinanceEngine = require('../finance-engine.js');
const engine = global.FinanceEngine;
const { overview } = require('../daily-finance.js');

const card = (id, name, extra = {}) => ({ id, name, accountId: 'bank', closingDay: 15, paymentDay: 10, paymentMonthOffset: 1, ...extra });
const statement = (extra = {}) => ({ id: 'bill', kind: 'payment', sourceAccountId: 'bank', cardId: 'jcb', entryType: 'statement', status: 'planned', amount: 50000, dueDate: '2026-12-10', transactionDate: '2026-12-10', createdAt: '2026-11-13T03:00:00.000Z', updatedAt: '2026-11-13T03:00:00.000Z', ...extra });
const detail = (id, used, amount, extra = {}) => ({ id, kind: 'payment', sourceAccountId: 'bank', cardId: 'jcb', entryType: 'itemized', origin: 'mail-import', status: 'planned', amount, transactionDate: used, dueDate: '2026-12-10', ...extra });
const state = (transactions, cards = [card('jcb', 'JCB W')]) => ({
  accounts: [{ id: 'bank', isPrimary: true, currentBalance: 300000, balanceEvidence: { source: 'bank-manual', amount: 300000, date: '2026-11-13' } }],
  cards, transactions, recurringPlans: [], workEntries: [], settings: { defenseLine: 0, cashflowHorizonDays: 90, wage: {} }
});
const cardEvent = s => overview({ state: s, today: '2026-11-13', candidates: [] }).scenario.events.find(e => e.cardPayment);
const bill = s => { const e = cardEvent(s); return [e.amount, e.additionalPossible]; };

const checks = [];
const test = (name, fn) => { try { fn(); checks.push({ name, pass: true }); } catch (e) { checks.push({ name, pass: false, message: e.message }); } };

test('見た日より2日以上前の明細は請求額に含まれているので、確認済みでなくても上乗せしない（二重計上の解消）', () => {
  assert.deepEqual(bill(state([statement(), detail('d1', '2026-10-20', 3000), detail('d2', '2026-11-11', 2000)])), [50000, 0]);
});
test('見た日の前日・当日の利用は、まだ請求額に入っていないとみなして上乗せする', () => {
  assert.deepEqual(bill(state([statement(), detail('d1', '2026-11-12', 1500), detail('d2', '2026-11-13', 800), detail('d3', '2026-11-11', 999)])), [50000, 2300]);
});
test('見た日より後の利用は、確認済みの請求額でも上乗せする（少なく見積もらない）', () => {
  const confirmed = statement({ asOfDate: '2026-11-05', statementEvidence: { source: 'issuer-manual', cardId: 'jcb', accountId: 'bank', dueDate: '2026-12-10', amount: 50000, cycle: '2026-11', checkedAt: '2026-11-05T00:00:00Z' } });
  assert.deepEqual(bill(state([confirmed, detail('d1', '2026-11-10', 4000), detail('d2', '2026-11-01', 7000)])), [50000, 4000]);
});
test('エポスは当日分まで請求額に含まれている（反映までの日数0）', () => {
  const s = state([statement({ cardId: 'epos' }), detail('d1', '2026-11-13', 800, { cardId: 'epos' })], [card('epos', 'エポスカード', { closingDay: 15 })]);
  assert.equal(engine.reflectionDaysOf({ name: 'EPOS' }), 0);
  assert.equal(engine.reflectionDaysOf({ name: 'JCB W' }), 2);
  assert.deepEqual(bill(s), [50000, 0]);
});
test('カードごとの「反映までの日数」を設定すれば、その日数で分ける', () => {
  assert.deepEqual(bill(state([statement(), detail('d1', '2026-11-10', 1000)], [card('jcb', 'JCB W', { reflectionDays: 4 })])), [50000, 1000]);
  assert.deepEqual(bill(state([statement(), detail('d1', '2026-11-12', 1000)], [card('jcb', 'JCB W', { reflectionDays: 0 })])), [50000, 0]);
});
test('明細ごとに本人が選んだ「含まれている」「まだ入っていない」が優先される', () => {
  assert.deepEqual(bill(state([statement(), detail('d1', '2026-10-20', 3000, { statementInclusion: 'pending' }), detail('d2', '2026-11-13', 900, { statementInclusion: 'included' })])), [50000, 3000]);
});
test('「次の請求へ」を選んだ明細は次の締め月にまとまり、今回の請求額には足さない', () => {
  const moved = detail('d1', '2026-11-14', 6000, { billingCycleOverride: '2026-12', dueDate: '2027-01-12' });
  const groups = engine.groupCardCharges([statement(), moved], [card('jcb', 'JCB W')]);
  assert.deepEqual(groups.map(g => [g.billingCycle, g.source, g.adoptedTotal]), [['2026-11', 'statement', 50000], ['2026-12', 'itemized', 6000]]);
});
test('見た日の記録が無いときは、確認・最後に直した日・登録した日の順に代わりにする（日本の日付で）', () => {
  assert.equal(engine.statementAsOfDate({ asOfDate: '2026-11-01', updatedAt: '2026-11-13T00:00:00Z' }), '2026-11-01');
  assert.equal(engine.statementAsOfDate({ updatedAt: '2026-11-12T16:30:00Z' }), '2026-11-13');
  assert.equal(engine.statementAsOfDate({ amount: 5, cardId: 'c', statementEvidence: { amount: 4, cardId: 'c', checkedAt: '2026-10-01T00:00:00Z' }, createdAt: '2026-11-02T00:00:00Z' }), '2026-11-02');
});
test('含まれているとみなした明細の合計が請求額を上回るときは知らせる（重複・反映待ちの確認）', () => {
  const groups = engine.groupCardCharges([statement({ amount: 1000 }), detail('d1', '2026-10-20', 900), detail('d2', '2026-10-20', 900)], [card('jcb', 'JCB W')]);
  assert.equal(groups[0].itemizedExceedsStatement, true);
});

const failures = checks.filter(c => !c.pass);
console.log(JSON.stringify({ suite: 'statement-asof', total: checks.length, passed: checks.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
