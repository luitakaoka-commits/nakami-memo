#!/usr/bin/env node
/**
 * 今回の追加分を検証する。
 *  - 吸収済み(absorbed)の明細が、残高計算にも集計にも一切影響しないこと
 *  - 請求総額から明細を、利用時刻の新しい順に取り出せること
 *  - 受信時刻(UTC)から日本時間の日付を正しく求められること
 *  - 記録の期間集計で、貯蓄・投資が支出と分かれ、口座間振替が除外されること
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
const CARD = { id: 'c1', name: 'SMBC', accountId: 'a1', closingDay: 0, paymentDay: 10, paymentMonthOffset: 1 };
const ACCOUNTS = [{ id: 'a1', name: '生活費口座', role: 'primary', currentBalance: 300000, includeInSpendable: true, reserveAmount: 0, isPrimary: true }];

const tx = over => ({
  id: over.id || `t${Math.random().toString(36).slice(2, 8)}`,
  kind: 'payment', amount: 0, transactionDate: '', transactionAt: '', absorbedBy: '',
  dueDate: '', status: 'planned', sourceAccountId: 'a1', destinationAccountId: '',
  transferType: 'external', cardId: 'c1', category: 'カード', memo: '',
  affectsForecast: true, lendingAmount: 0, createdAt: '2026-08-01T00:00:00.000Z', ...over
});

/* ---------- JST 変換 ---------- */

test('日本時間の深夜〜朝に届いたメールが前日にならない', () => {
  // 2026-08-24T21:00Z = 日本時間 2026-08-25 06:00
  equal(engine.jstDateStringOf('2026-08-24T21:00:00.000Z'), '2026-08-25', 'JSTの日付');
  equal(engine.jstTimeStringOf('2026-08-24T21:00:00.000Z'), '06:00', 'JSTの時刻');
});

test('日中に届いたメールはそのままの日付になる', () => {
  equal(engine.jstDateStringOf('2026-08-24T05:09:00.000Z'), '2026-08-24', 'JSTの日付');
  equal(engine.jstTimeStringOf('2026-08-24T05:09:00.000Z'), '14:09', 'JSTの時刻');
});

test('解釈できない値では空文字を返す', () => {
  equal(engine.jstDateStringOf(''), '', '空入力');
  equal(engine.jstDateStringOf('not-a-date'), '', '不正な入力');
});

/* ---------- 明細の並び順 ---------- */

test('明細は利用時刻の新しい順に並ぶ', () => {
  const list = [
    tx({ id: 'a', transactionDate: '2026-08-24', transactionAt: '2026-08-24T00:09:00.000Z' }), // 09:09
    tx({ id: 'b', transactionDate: '2026-08-24', transactionAt: '2026-08-24T09:30:00.000Z' }), // 18:30
    tx({ id: 'c', transactionDate: '2026-08-25', transactionAt: '2026-08-25T01:00:00.000Z' })
  ];
  equal(engine.sortByUsageDesc(list).map(item => item.id).join(','), 'c,b,a', '新しい順');
});

test('時刻が無い明細は日付で並び、同日なら登録が新しい順になる', () => {
  const list = [
    tx({ id: 'old', transactionDate: '2026-08-24', createdAt: '2026-08-24T01:00:00.000Z' }),
    tx({ id: 'new', transactionDate: '2026-08-24', createdAt: '2026-08-24T05:00:00.000Z' }),
    tx({ id: 'older-day', transactionDate: '2026-08-23' })
  ];
  equal(engine.sortByUsageDesc(list).map(item => item.id).join(','), 'new,old,older-day', '日付→登録順');
});

/* ---------- 総額から明細を取り出す ---------- */

const STATEMENT = tx({ id: 'st', amount: 94899, dueDate: '2026-09-10', memo: '8月分の請求', entryType: 'statement' });
const ITEM_A = tx({ id: 'ia', amount: 279, transactionDate: '2026-08-20', transactionAt: '2026-08-20T02:00:00.000Z', dueDate: '2026-09-10', entryType: 'itemized' });
const ITEM_B = tx({ id: 'ib', amount: 145, transactionDate: '2026-08-23', transactionAt: '2026-08-23T02:00:00.000Z', dueDate: '2026-09-10', entryType: 'itemized' });
const ITEM_NEXT_CYCLE = tx({ id: 'in', amount: 500, transactionDate: '2026-09-02', dueDate: '2026-10-13', entryType: 'itemized' });

test('未確定の総額からは、同じ請求サイクルの明細だけが取り出せる', () => {
  const details = engine.detailsOfStatement(STATEMENT, [STATEMENT, ITEM_A, ITEM_B, ITEM_NEXT_CYCLE], [CARD]);
  equal(details.map(item => item.id).join(','), 'ib,ia', '新しい順・別サイクルは含まない');
});

test('確定済みの総額からは、吸収済みの明細が取り出せる', () => {
  const settled = { ...STATEMENT, status: 'settled' };
  const absorbedA = { ...ITEM_A, status: 'absorbed', absorbedBy: 'st' };
  const absorbedB = { ...ITEM_B, status: 'absorbed', absorbedBy: 'st' };
  const details = engine.detailsOfStatement(settled, [settled, absorbedA, absorbedB, ITEM_NEXT_CYCLE], [CARD]);
  equal(details.map(item => item.id).join(','), 'ib,ia', '吸収済みだけを新しい順で返す');
});

test('総額の確定後に届いた明細も、既存の内訳と一緒に取り出せる', () => {
  const settled = { ...STATEMENT, status: 'settled' };
  const absorbed = { ...ITEM_A, status: 'absorbed', absorbedBy: 'st' };
  const late = { ...ITEM_B, status: 'planned' };
  const details = engine.detailsOfStatement(settled, [settled, absorbed, late], [CARD]);
  equal(details.map(item => item.id).join(','), 'ib,ia', '遅れて届いた明細も新しい順に出す');
});

test('明細の行からは何も展開しない', () => {
  equal(engine.detailsOfStatement(ITEM_A, [STATEMENT, ITEM_A, ITEM_B], [CARD]).length, 0, '明細は展開対象外');
});

/* ---------- 吸収済みは計算に影響しない ---------- */

const spendable = transactions => engine.calculateSpendableAmount({
  today: TODAY, deadline: DEADLINE, accounts: ACCOUNTS, cards: [CARD], defenseLine: 0, transactions
});

test('総額を確定して明細を吸収すると、明細は二重に差し引かれない', () => {
  const settled = { ...STATEMENT, status: 'settled', settledAt: '2026-09-10' };
  const absorbedA = { ...ITEM_A, status: 'absorbed', absorbedBy: 'st' };
  const absorbedB = { ...ITEM_B, status: 'absorbed', absorbedBy: 'st' };
  const result = spendable([settled, absorbedA, absorbedB]);
  equal(result.unpaidCardTotal, 0, '確定済みの総額も吸収済みの明細も未払いではない');
});

test('吸収しないまま総額だけ確定すると明細が復活してしまう（吸収が必要な理由）', () => {
  const settled = { ...STATEMENT, status: 'settled', settledAt: '2026-09-10' };
  const result = spendable([settled, ITEM_A, ITEM_B]);
  equal(result.unpaidCardTotal, 424, '吸収しなければ明細が未払いとして残る');
});

test('吸収済みの明細は支払い能力チェックの残高予測にも出てこない', () => {
  const absorbed = { ...ITEM_A, status: 'absorbed', absorbedBy: 'st' };
  const check = engine.calculateCashflowCheck({
    today: TODAY, horizonDate: '2026-10-31', accounts: ACCOUNTS, cards: [CARD],
    transactions: [absorbed], workEntries: [], settings: { wage: {} }
  });
  const hit = check.timeline.some(day => Number(day.outflow || 0) !== 0);
  assert(!hit, '吸収済みの明細が残高予測に出てはいけない');
});

/* ---------- 期間集計 ---------- */

const RECORDS = [
  tx({ id: 'r1', kind: 'income', amount: 82000, dueDate: '2026-09-15', status: 'settled', cardId: '', category: '給与' }),
  tx({ id: 'r2', kind: 'payment', amount: 30000, dueDate: '2026-09-10', status: 'settled', cardId: 'c1', entryType: 'statement', category: 'カード' }),
  tx({ id: 'r3', kind: 'payment', amount: 8000, dueDate: '2026-09-03', status: 'settled', cardId: '', category: '食費', lendingAmount: 3000 }),
  tx({ id: 'r4', kind: 'saving', amount: 20000, dueDate: '2026-09-05', status: 'settled', cardId: '', category: '貯金', destinationAccountId: 'a2' }),
  tx({ id: 'r5', kind: 'nisa', amount: 10000, dueDate: '2026-09-06', status: 'settled', cardId: '', category: 'NISA', destinationAccountId: 'a3' }),
  tx({ id: 'r6', kind: 'transfer', amount: 15000, dueDate: '2026-09-07', status: 'settled', cardId: '', transferType: 'internal', destinationAccountId: 'a2', category: '振替' }),
  tx({ id: 'r7', kind: 'transfer', amount: 12000, dueDate: '2026-09-08', status: 'settled', cardId: '', transferType: 'external', destinationName: '家族', category: '仕送り' }),
  // 総額に吸収された明細。集計に出てはいけない。
  tx({ id: 'r8', kind: 'payment', amount: 5000, dueDate: '2026-09-10', status: 'absorbed', absorbedBy: 'r2', cardId: 'c1', entryType: 'itemized', category: 'カード' }),
  // 期間外
  tx({ id: 'r9', kind: 'payment', amount: 99999, dueDate: '2026-08-31', status: 'settled', cardId: '', category: '食費' }),
  // 未確定は集計しない
  tx({ id: 'r10', kind: 'payment', amount: 7777, dueDate: '2026-09-20', status: 'planned', cardId: '', category: '食費' })
];

const SEP = engine.monthRangeOf('2026-09');

test('月の範囲を正しく求める', () => {
  equal(SEP.startDate, '2026-09-01', '初日');
  equal(SEP.endDate, '2026-09-30', '末日');
});

test('収入・支出・差引を実質負担ベースで集計する', () => {
  const summary = engine.summarizePeriod(RECORDS, SEP, { basis: 'real' });
  equal(summary.income.total, 82000, '収入');
  // カード30000 + 食費(8000-3000立替) + 仕送り12000 = 47000
  equal(summary.expense.total, 47000, '支出');
  equal(summary.net, 35000, '差引');
  equal(summary.lendingTotal, 3000, '立替');
});

test('総額ベースでは立替分を差し引かない', () => {
  const summary = engine.summarizePeriod(RECORDS, SEP, { basis: 'gross' });
  equal(summary.expense.total, 50000, '支出（総額）');
});

test('貯金・NISAは支出と別枠になる', () => {
  const summary = engine.summarizePeriod(RECORDS, SEP, { basis: 'real' });
  equal(summary.saving.total, 30000, '貯蓄・投資の合計');
  assert(!summary.expense.categories.some(item => ['貯金', 'NISA'].includes(item.label)), '支出に混ざってはいけない');
});

test('吸収済みの明細と口座間の振替は集計から外れる', () => {
  const summary = engine.summarizePeriod(RECORDS, SEP, { basis: 'gross' });
  assert(!summary.expense.categories.some(item => item.label === '振替'), '口座間の振替は支出ではない');
  // 吸収済みの5000が入っていれば「カード」は35000になる
  const card = summary.expense.categories.find(item => item.label === 'カード');
  equal(card.amount, 30000, 'カードは請求総額だけを数える');
});

test('カテゴリは金額の多い順に並び、割合の合計が1になる', () => {
  const summary = engine.summarizePeriod(RECORDS, SEP, { basis: 'real' });
  const amounts = summary.expense.categories.map(item => item.amount);
  equal(JSON.stringify(amounts), JSON.stringify([...amounts].sort((a, b) => b - a)), '降順');
  const ratio = summary.expense.categories.reduce((sum, item) => sum + item.ratio, 0);
  assert(Math.abs(ratio - 1) < 1e-9, `割合の合計が1にならない: ${ratio}`);
});

test('期間を狭めるとその範囲だけを集計する', () => {
  const summary = engine.summarizePeriod(RECORDS, { startDate: '2026-09-01', endDate: '2026-09-05' }, { basis: 'real' });
  equal(summary.income.total, 0, '収入は範囲外');
  equal(summary.expense.total, 5000, '食費の実質負担のみ');
  equal(summary.saving.total, 20000, '貯金のみ');
});

test('記録が無い期間では合計が0になる', () => {
  const summary = engine.summarizePeriod(RECORDS, { startDate: '2027-01-01', endDate: '2027-01-31' }, {});
  equal(summary.income.total, 0, '収入');
  equal(summary.expense.total, 0, '支出');
  equal(summary.expense.categories.length, 0, 'カテゴリなし');
});

test('利用時刻の訂正は日本時間で保存し、変更しない時刻の秒も保持する', () => {
  equal(engine.editedUsageInstant({ date: '2026-10-20', time: '00:05' }), '2026-10-19T15:05:00.000Z', '日付境界の訂正');
  const previous = '2026-10-20T06:13:25.000Z';
  equal(engine.editedUsageInstant({ date: '2026-10-20', time: '15:13', previous }), previous, '未編集の秒');
});

test('不明な利用時刻を空欄に戻せて、利用日を変更すると古い日付を残さない', () => {
  const previous = '2026-10-20T06:13:25.000Z';
  equal(engine.editedUsageInstant({ date: '2026-10-20', time: '', previous }), '', '不明な時刻を消す');
  equal(engine.editedUsageInstant({ date: '2026-10-21', time: '15:13', previous }), '2026-10-21T06:13:00.000Z', '利用日の訂正');
});

test('存在しない日付と不正な利用時刻を保存しない', () => {
  for (const input of [{ date: '2026-02-30', time: '12:00' }, { date: '2026-10-20', time: '24:00' }, { date: '2026-10-20', time: '15:60' }]) {
    let rejected = false;
    try { engine.editedUsageInstant(input); } catch (error) { rejected = error instanceof RangeError; }
    assert(rejected, '不正な日時を受け入れた');
  }
});

function correctionFixture() {
  const cards = ['old', 'right'].map(id => ({ ...CARD, id, closingDay: 15 }));
  const detail = tx({ id: 'detail', entryType: 'itemized', amount: 988, transactionDate: '2026-08-10', dueDate: '2026-09-10', status: 'absorbed', cardId: 'old', absorbedBy: 'old-bill' });
  const bills = cards.map(card => tx({ id: card.id + '-bill', entryType: 'statement', amount: 10000, dueDate: '2026-09-10', transactionDate: '2026-09-10', status: 'settled', cardId: card.id }));
  return { cards, transactions: [detail, ...bills] };
}
test('吸収済み明細のカード訂正は総額や引落状態を変えず内訳だけを移す', () => {
  const f = correctionFixture(), before = JSON.stringify(f);
  const next = engine.correctAbsorbedCard('detail', 'right', f.transactions, f.cards);
  equal(JSON.stringify(next), JSON.stringify({ ...f.transactions[0], cardId: 'right', absorbedBy: 'right-bill' }), '変更範囲');
  equal(JSON.stringify(f), before, '入力を変更しない');
  const after = f.transactions.map(t => t.id === next.id ? next : t);
  equal(engine.detailsOfStatement(after[1], after, f.cards).length, 0, '旧請求から外す');
  equal(engine.detailsOfStatement(after[2], after, f.cards).length, 1, '正しい請求の内訳');
  equal(JSON.stringify(engine.summarizePeriod(after)), JSON.stringify(engine.summarizePeriod(f.transactions)), '支出を再計上しない');
});
test('訂正先の引落済み請求が不明・重複・別期間なら明細を移さない', () => {
  for (const change of [f => f.transactions.pop(), f => f.transactions.push({ ...f.transactions[2], id: 'duplicate' }), f => { f.transactions[2].dueDate = '2026-10-13'; }, f => { f.transactions[2].status = 'planned'; }, f => { f.transactions[0].status = 'planned'; }, f => { f.transactions[1].cardId = 'right'; }, f => { f.transactions[2].amount = 1; }]) {
    const f = correctionFixture(); change(f); const before = JSON.stringify(f);
    let rejected = false; try { engine.correctAbsorbedCard('detail', 'right', f.transactions, f.cards); } catch (_) { rejected = true; }
    assert(rejected, '曖昧な訂正を受け入れた'); equal(JSON.stringify(f), before, '拒否時も原本を保持');
  }
});
test('返金と紐付く明細のカードは単独で訂正しない', () => {
  const f = correctionFixture(); f.transactions.push(tx({ id: 'refund', refundEvidence: { targetId: 'detail' } }));
  let rejected = false; try { engine.correctAbsorbedCard('detail', 'right', f.transactions, f.cards); } catch (_) { rejected = true; }
  assert(rejected, '返金との紐付けを壊した');
});

if (!failures.length) { console.log(JSON.stringify({ suite: 'records-view', total, passed: total, failed: 0 })); process.exit(0); }
console.log(JSON.stringify({ suite: 'records-view', total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
process.exit(1);
