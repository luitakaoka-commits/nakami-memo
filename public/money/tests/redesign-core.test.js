#!/usr/bin/env node
'use strict';
const { calculateReadiness } = require('../redesign-readiness.js');
const { reconcileCardCycle } = require('../redesign-card-reconciliation.js');
const { calculateCardPaymentDate } = require('../finance-engine.js');
const { compare: compareMigration } = require('../redesign-migration-check.js');
const { generateRecurring } = require('../redesign-recurring.js');
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
test('受信時刻だけでは利用時刻の証拠にならない', () => assert.equal(reconcile(null, [row('1', 1000, { usedAt: '', detectedAt: '2026-11-01T12:00:00+09:00' })]).needsReview, true));
test('確定請求後に新規利用が届いた場合は勝手に加算せず確認', () => {
  const r = reconcile({ status: 'confirmed', amount: 10000 }, [row('1', 3000, { inclusion: 'not_included' })]);
  assert.equal(r.amount, 10000); assert.equal(r.possibleAdditional, 0); assert.equal(r.needsReview, true);
});
test('取消・返金は対象を確認するまで勝手に減額しない', () => {
  const r = reconcile({ status: 'estimate', amount: 10000 }, [row('1', 3000, { type: 'refund' })]);
  assert.equal(r.amount, 10000); assert.ok(r.issues.some(x => x.type === 'refund_or_cancellation'));
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

const failures = [];
for (const c of cases) { try { c.fn(); } catch (error) { failures.push({ name: c.name, message: error.message }); } }
console.log(JSON.stringify({ suite: 'redesign-core', total: cases.length, passed: cases.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
