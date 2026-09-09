#!/usr/bin/env node
/**
 * 請求サイクルごとの相殺（請求総額 と 取込明細）と、将来期間の試算を検証する。
 *
 * ねらい
 *  - 利用してから請求総額を入力するまでの空白期間を、取込明細が埋めること
 *  - 請求総額を入力した瞬間に、同じサイクルの明細が内数として外れること（二重計上の防止）
 */
const path = require('path');
const engine = require(path.join(__dirname, '..', 'finance-engine.js'));

const failures = [];
let total = 0;
const test = (name, fn) => { total += 1; try { fn(); } catch (e) { failures.push({ name, message: e.message }); } };
const equal = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected=${JSON.stringify(b)} actual=${JSON.stringify(a)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };

const TODAY = '2026-09-05';
const DEADLINE = '2026-09-14';

// 月末締め・翌月10日払い
const CARD = { id: 'c1', name: 'SMBC', accountId: 'a1', closingDay: 0, paymentDay: 10, paymentMonthOffset: 1 };
const ACCOUNTS = [{ id: 'a1', name: '生活費口座', role: 'primary', currentBalance: 300000, includeInSpendable: true, reserveAmount: 0, isPrimary: true }];

const tx = over => ({
  id: over.id || `t${Math.random().toString(36).slice(2, 8)}`,
  kind: 'payment', amount: 0, transactionDate: '', dueDate: '', status: 'planned',
  sourceAccountId: 'a1', destinationAccountId: '', transferType: 'external',
  cardId: 'c1', category: 'カード', memo: '', affectsForecast: true, ...over
});

// 8月分（9/10引落）の請求総額
const STATEMENT_AUG = tx({ id: 'st-aug', amount: 94899, dueDate: '2026-09-10', memo: '8月分の請求', entryType: 'statement' });
// 8月分に含まれる取込明細
const ITEM_AUG_A = tx({ id: 'it-aug-a', amount: 279, transactionDate: '2026-08-20', dueDate: '2026-09-10', memo: 'ローソン', entryType: 'itemized' });
const ITEM_AUG_B = tx({ id: 'it-aug-b', amount: 145, transactionDate: '2026-08-23', dueDate: '2026-09-10', memo: 'セブン', entryType: 'itemized' });
// 9月分（締め前・10/13引落）の取込明細
const ITEM_SEP = tx({ id: 'it-sep', amount: 500, transactionDate: '2026-09-02', dueDate: '2026-10-13', memo: 'ドラッグストア', entryType: 'itemized' });

const spendable = transactions => engine.calculateSpendableAmount({
  today: TODAY, deadline: DEADLINE, accounts: ACCOUNTS, cards: [CARD], defenseLine: 0, transactions
});
const check = transactions => engine.calculateCashflowCheck({
  today: TODAY, endDate: '2026-10-31', accounts: ACCOUNTS, cards: [CARD], defenseLine: 0, transactions
});

test('1. 請求総額がまだ無いサイクルは、取込明細が金額に反映される（タイムラグの解消）', () => {
  const result = spendable([ITEM_AUG_A, ITEM_AUG_B]);
  equal(result.unpaidCardTotal, 424, '明細の合計が未払いカード額になる');
  equal(result.total, 300000 - 424, '今使える金額へ反映される');
});

test('2. 請求総額を入力すると、同じサイクルの明細は内数として外れる（二重計上の防止）', () => {
  const result = spendable([STATEMENT_AUG, ITEM_AUG_A, ITEM_AUG_B]);
  equal(result.unpaidCardTotal, 94899, '請求総額だけを採用する');
  equal(result.cardSuppressedTotal, 424, '外した明細を内訳に出す');
  equal(result.total, 300000 - 94899, '合算されない');
});

test('3. 締め日をまたぐ利用は別サイクルなので、総額を入れても残る', () => {
  const result = spendable([STATEMENT_AUG, ITEM_AUG_A, ITEM_SEP]);
  equal(result.unpaidCardTotal, 94899 + 500, '8月分は総額・9月分は明細');
  equal(result.cardSuppressedTotal, 279, '8月分の明細だけが外れる');
});

test('4. 支払い能力チェックでも同じ相殺が効く', () => {
  const before = check([ITEM_AUG_A, ITEM_AUG_B]);
  const after = check([STATEMENT_AUG, ITEM_AUG_A, ITEM_AUG_B]);
  const dayBefore = before.timeline.find(d => d.date === '2026-09-10');
  const dayAfter = after.timeline.find(d => d.date === '2026-09-10');
  equal(dayBefore.primaryBalance, 300000 - 424, '総額が無ければ明細で引く');
  equal(dayAfter.primaryBalance, 300000 - 94899, '総額があれば総額だけで引く');
});

test('5. 請求サイクルの判定（明細は利用日から、総額は引落日から逆算）', () => {
  equal(engine.closingMonthOf('2026-08-20', 0), '2026-08', '月末締めの8月利用');
  equal(engine.closingMonthOf('2026-09-02', 0), '2026-09', '月末締めの9月利用');
  equal(engine.cardBillingCycleOf(ITEM_AUG_A, CARD), '2026-08', '明細');
  equal(engine.cardBillingCycleOf(STATEMENT_AUG, CARD), '2026-08', '請求総額');
});

test('6. 営業日の繰り下げで引落日がずれても同じサイクルに揃う', () => {
  // 2026-10-10は土曜、10-12はスポーツの日のため、計算上の引落日は10-13になる
  equal(engine.calculateCardPaymentDate('2026-09-02', 0, 10, 1), '2026-10-13', '前提の確認');
  // ユーザーが名目の10日で総額を入力しても、同じ9月分として扱う
  const nominal = tx({ id: 'st-sep', amount: 30000, dueDate: '2026-10-10', entryType: 'statement' });
  equal(engine.cardBillingCycleOf(nominal, CARD), '2026-09', '名目日でも同じサイクル');
  const result = spendable([nominal, ITEM_SEP]);
  equal(result.unpaidCardTotal, 30000, '総額だけを採用し、明細は外れる');
});

test('7. 明細の合計が請求総額を上回る場合は警告を出す', () => {
  const small = tx({ id: 'st-small', amount: 200, dueDate: '2026-09-10', entryType: 'statement' });
  const result = spendable([small, ITEM_AUG_A, ITEM_AUG_B]);
  equal(result.cardConflicts.length, 1, '警告が1件');
  equal(result.cardConflicts[0].billingCycle, '2026-08', '対象のサイクル');
});

test('8. 未来の利用予定は未払い実利用に含めない', () => {
  const future = tx({ id: 'it-future', amount: 800, transactionDate: '2026-09-20', dueDate: '2026-10-13', entryType: 'itemized' });
  equal(spendable([future]).unpaidCardTotal, 0, '利用日が未来なら控除しない');
});

test('9. 将来期間の試算：開始日時点の予測残高が出発点になる', () => {
  const input = { today: TODAY, deadline: DEADLINE, endDate: '2026-12-31', accounts: ACCOUNTS, cards: [CARD], defenseLine: 0, transactions: [STATEMENT_AUG] };
  const future = engine.calculateFutureSpendable(input, { startDate: '2026-09-15', endDate: '2026-10-14' });
  equal(future.isFuture, true, '将来期間として扱う');
  equal(future.startDate, '2026-09-15', '開始日');
  // 9/10に94,899が引き落とされたあとの残高から始まる
  equal(future.cashAvailable, 300000 - 94899, '開始日時点の残高');
  equal(future.total, 300000 - 94899, '期間内に他の予定が無ければそのまま');
});

test('10. 将来期間の試算：開始日より前の引落を二重に引かない', () => {
  const input = { today: TODAY, deadline: DEADLINE, endDate: '2026-12-31', accounts: ACCOUNTS, cards: [CARD], defenseLine: 0, transactions: [STATEMENT_AUG] };
  const future = engine.calculateFutureSpendable(input, { startDate: '2026-09-15', endDate: '2026-10-14' });
  equal(future.unpaidCardTotal, 0, '支払い済みの請求は未払いに残らない');
});

test('11. 将来期間の試算：期間内の収入・支出・給与を反映する', () => {
  const income = tx({ id: 'in1', kind: 'income', amount: 50000, transactionDate: '2026-09-20', dueDate: '2026-09-20', cardId: '', memo: '仕送り' });
  const rent = tx({ id: 'rent', kind: 'payment', amount: 60000, transactionDate: '2026-10-01', dueDate: '2026-10-01', cardId: '', memo: '家賃' });
  const input = { today: TODAY, deadline: DEADLINE, endDate: '2026-12-31', accounts: ACCOUNTS, cards: [CARD], defenseLine: 0, transactions: [STATEMENT_AUG, income, rent] };
  const future = engine.calculateFutureSpendable(input, { startDate: '2026-09-15', endDate: '2026-10-14' });
  equal(future.incomeTotal, 50000, '期間内の収入');
  equal(future.cashOutflow, 60000, '期間内の現金支出');
  equal(future.total, 300000 - 94899 + 50000 - 60000, '差引');
});

test('12. 開始日が今日なら、今使える金額と同じ結果になる', () => {
  const input = { today: TODAY, deadline: DEADLINE, endDate: '2026-12-31', accounts: ACCOUNTS, cards: [CARD], defenseLine: 0, transactions: [STATEMENT_AUG, ITEM_AUG_A] };
  const now = engine.calculateSpendableAmount(input);
  const future = engine.calculateFutureSpendable(input, { startDate: TODAY, endDate: DEADLINE });
  equal(future.total, now.total, '同じ金額');
  equal(future.isFuture, false, '将来扱いにしない');
});

if (!failures.length) { console.log(JSON.stringify({ suite: 'card-netting', total, passed: total, failed: 0 })); process.exit(0); }
console.log(JSON.stringify({ suite: 'card-netting', total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
process.exit(1);
