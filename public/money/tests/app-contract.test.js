#!/usr/bin/env node
/**
 * app.js 側の約束事を Node だけで検証する。
 *
 *  - normalizeState() が取引の全フィールドを欠けずに復元すること
 *  - applyEffect / revertEffect が往復で元の残高に戻ること、adjustment が「支出＝マイナス」であること
 *  - getNextDeadline() の境界（14日当日・15日・月末・年跨ぎ）
 *  - today() が日本時間で判定されること（UTCの夜は日本ではもう翌日）
 *
 * ブラウザは使わない。最小限のDOM・localStorageのスタブを用意して
 * finance-engine.js と app.js を vm 上で読み込み、window.__YORYOKU__ 経由で内部関数に触る。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const failures = [];
let total = 0;
const test = (name, fn) => { total += 1; try { fn(); } catch (error) { failures.push({ name, message: error.message }); } };
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`${message}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const deepEqual = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

/* ---------- 最小限のブラウザ環境 ---------- */

function createWindow() {
  const noop = () => {};
  const element = () => ({
    value: '', checked: false, textContent: '', innerHTML: '', hidden: true,
    dataset: {}, style: {}, files: [],
    addEventListener: noop, removeEventListener: noop, setAttribute: noop,
    focus: noop, click: noop, setSelectionRange: noop, appendChild: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    querySelector: () => element(), querySelectorAll: () => [], closest: () => null
  });
  const store = new Map();
  const win = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, Promise, Date, JSON, Math, Number, String, Boolean, Object, Array, Set, Map, Intl,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    },
    location: { search: '', protocol: 'http:', hostname: 'localhost' },
    navigator: {},
    matchMedia: () => ({ matches: false }),
    confirm: () => true,
    requestAnimationFrame: noop,
    document: {
      querySelector: () => element(),
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: () => element(),
      body: element(),
      documentElement: element()
    }
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  return win;
}

async function bootApp() {
  const win = createWindow();
  const context = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'finance-engine.js'), 'utf8'), context, { filename: 'finance-engine.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  // run() は非同期なので、__YORYOKU__ が生えるまで待つ
  for (let i = 0; i < 200 && !win.__YORYOKU__; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!win.__YORYOKU__) throw new Error('app.js の初期化が完了しませんでした');
  return win.__YORYOKU__;
}

/* ---------- 期待するフィールド一覧 ---------- */

const TRANSACTION_FIELDS = [
  'id', 'kind', 'amount', 'dueDate', 'transactionDate', 'transactionAt', 'absorbedBy',
  'entryType', 'origin', 'dateEstimated', 'status', 'sourceAccountId', 'destinationAccountId',
  'transferType', 'destinationName', 'cardId', 'category', 'memo', 'lendingAmount',
  'affectsForecast', 'recurringPlanId', 'settledAt', 'createdAt', 'updatedAt'
];

const SAMPLE_TRANSACTION = {
  id: 't1', kind: 'payment', amount: 1234, dueDate: '2026-09-10', transactionDate: '2026-08-20',
  transactionAt: '2026-08-20T01:23:00.000Z', absorbedBy: 'st1', entryType: 'itemized', origin: 'mail-import',
  dateEstimated: true, status: 'planned', sourceAccountId: 'a1', destinationAccountId: 'a2',
  transferType: 'internal', destinationName: '家族', cardId: 'c1', category: '食費', memo: 'スーパー',
  lendingAmount: 200, affectsForecast: false, recurringPlanId: 'p1', settledAt: '2026-09-10',
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z'
};

const SAMPLE_STATE = {
  schemaVersion: 6,
  mode: 'local',
  meta: { onboarded: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  accounts: [
    { id: 'a1', name: '生活費口座', role: 'primary', currentBalance: 300000, includeInSpendable: true, reserveAmount: 0, isPrimary: true },
    { id: 'a2', name: '貯金口座', role: 'savings', currentBalance: 500000, includeInSpendable: false, reserveAmount: 0, isPrimary: false }
  ],
  cards: [{ id: 'c1', name: 'メインカード', accountId: 'a1', closingDay: 15, paymentDay: 10, paymentMonthOffset: 1 }],
  workEntries: [],
  transactions: [SAMPLE_TRANSACTION],
  recurringPlans: [],
  settings: { defenseLine: 150000, holidayOverrides: {}, wage: {} }
};

(async () => {
  const api = await bootApp();

  /* ---------- normalizeState のフィールド往復 ---------- */

  test('normalizeState は取引の全フィールドを欠けずに復元する', () => {
    const restored = api.normalizeState(JSON.parse(JSON.stringify(SAMPLE_STATE))).transactions[0];
    TRANSACTION_FIELDS.forEach(field => {
      assert(Object.prototype.hasOwnProperty.call(restored, field), `フィールドが欠けている: ${field}`);
    });
    equal(Object.keys(restored).length, TRANSACTION_FIELDS.length, 'フィールド数');
    TRANSACTION_FIELDS.forEach(field => {
      equal(restored[field], SAMPLE_TRANSACTION[field], `値が変わっている: ${field}`);
    });
  });

  test('normalizeState を2回通しても内容が変わらない（べき等）', () => {
    const once = api.normalizeState(JSON.parse(JSON.stringify(SAMPLE_STATE)));
    const twice = api.normalizeState(JSON.parse(JSON.stringify(once)));
    equal(JSON.stringify(twice.transactions), JSON.stringify(once.transactions), '2回目で内容が変わった');
  });

  test('createTransaction は既定値だけで全フィールドを揃える', () => {
    const created = api.createTransaction({});
    TRANSACTION_FIELDS.forEach(field => {
      assert(Object.prototype.hasOwnProperty.call(created, field), `フィールドが欠けている: ${field}`);
    });
    equal(Object.keys(created).length, TRANSACTION_FIELDS.length, 'フィールド数');
    equal(created.status, 'planned', '新規は未確定');
    equal(created.category, 'その他', '既定カテゴリ');
    equal(created.affectsForecast, true, '既定で計算に含める');
  });

  /* ---------- applyEffect / revertEffect ---------- */

  const resetAccounts = () => {
    const state = api.getState();
    state.accounts.length = 0;
    state.accounts.push(
      { id: 'a1', name: '生活費口座', role: 'primary', currentBalance: 100000, includeInSpendable: true, reserveAmount: 0, isPrimary: true },
      { id: 'a2', name: '貯金口座', role: 'savings', currentBalance: 50000, includeInSpendable: false, reserveAmount: 0, isPrimary: false }
    );
    return state;
  };
  const balanceOf = (state, id) => state.accounts.find(item => item.id === id).currentBalance;

  const roundTrip = (name, partial, expected) => {
    test(name, () => {
      const state = resetAccounts();
      const transaction = api.createTransaction(partial);
      api.applyEffect(transaction);
      Object.entries(expected).forEach(([accountId, value]) => {
        equal(balanceOf(state, accountId), value, `${accountId}の確定後の残高`);
      });
      api.revertEffect(transaction);
      equal(balanceOf(state, 'a1'), 100000, 'a1が元に戻る');
      equal(balanceOf(state, 'a2'), 50000, 'a2が元に戻る');
    });
  };

  roundTrip('支払いは元口座を減らし、戻すと元に戻る',
    { kind: 'payment', amount: 3000, sourceAccountId: 'a1' }, { a1: 97000, a2: 50000 });
  roundTrip('収入は元口座を増やし、戻すと元に戻る',
    { kind: 'income', amount: 3000, sourceAccountId: 'a1' }, { a1: 103000, a2: 50000 });
  roundTrip('立替回収も元口座を増やす',
    { kind: 'reimbursement', amount: 2500, sourceAccountId: 'a1' }, { a1: 102500, a2: 50000 });
  roundTrip('貯金は元口座から移動先へ移る',
    { kind: 'saving', amount: 20000, sourceAccountId: 'a1', destinationAccountId: 'a2' }, { a1: 80000, a2: 70000 });
  roundTrip('NISAも元口座から移動先へ移る',
    { kind: 'nisa', amount: 10000, sourceAccountId: 'a1', destinationAccountId: 'a2' }, { a1: 90000, a2: 60000 });
  roundTrip('自分の口座への振込は合計が変わらない',
    { kind: 'transfer', amount: 5000, sourceAccountId: 'a1', destinationAccountId: 'a2', transferType: 'internal' }, { a1: 95000, a2: 55000 });
  roundTrip('他人口座への振込は元口座だけ減る',
    { kind: 'transfer', amount: 5000, sourceAccountId: 'a1', transferType: 'external', destinationName: '家族' }, { a1: 95000, a2: 50000 });

  test('残高調整は「支出＝マイナス」でエンジンと符号が一致する', () => {
    const state = resetAccounts();
    const transaction = api.createTransaction({ kind: 'adjustment', amount: 4000, sourceAccountId: 'a1' });
    api.applyEffect(transaction);
    equal(balanceOf(state, 'a1'), 96000, '残高調整は残高を減らす');
    api.revertEffect(transaction);
    equal(balanceOf(state, 'a1'), 100000, '戻すと元に戻る');
  });

  test('applyEffect の増減はエンジンの accountDeltasFor と完全に一致する', () => {
    const engine = require(path.join(ROOT, 'finance-engine.js'));
    ['payment', 'income', 'reimbursement', 'saving', 'nisa', 'transfer', 'adjustment'].forEach(kind => {
      const state = resetAccounts();
      const transaction = api.createTransaction({ kind, amount: 1000, sourceAccountId: 'a1', destinationAccountId: 'a2', transferType: 'internal' });
      api.applyEffect(transaction);
      const expected = { a1: 100000, a2: 50000 };
      engine.accountDeltasFor(transaction).forEach(({ accountId, delta }) => { expected[accountId] += delta; });
      equal(balanceOf(state, 'a1'), expected.a1, `${kind}: a1`);
      equal(balanceOf(state, 'a2'), expected.a2, `${kind}: a2`);
    });
  });

  /* ---------- validateSettlement ---------- */

  test('確定の条件は保存と確定ボタンで同じ（貯金・NISA・内部振込は移動先が必須）', () => {
    const needs = kind => api.validateSettlement(api.createTransaction({ kind, amount: 1000, sourceAccountId: 'a1', transferType: 'internal' }));
    assert(needs('saving'), '貯金は移動先が無ければ確定できない');
    assert(needs('nisa'), 'NISAは移動先が無ければ確定できない');
    assert(needs('transfer'), '内部振込は移動先が無ければ確定できない');
    equal(api.validateSettlement(api.createTransaction({ kind: 'payment', amount: 1000, sourceAccountId: 'a1' })), '', '支払いは移動先不要');
    equal(api.validateSettlement(api.createTransaction({ kind: 'saving', amount: 1000, sourceAccountId: 'a1', destinationAccountId: 'a2' })), '', '移動先があれば確定できる');
    assert(api.validateSettlement(api.createTransaction({ kind: 'transfer', amount: 1000, sourceAccountId: 'a1', transferType: 'external' })), '他人口座への振込は振込先名が必須');
  });

  /* ---------- getNextDeadline の境界 ---------- */

  const deadlineCases = [
    ['2026-09-01', '2026-09-14', '月初は今月14日'],
    ['2026-09-13', '2026-09-14', '13日は今月14日'],
    ['2026-09-14', '2026-09-14', '14日当日は当日が期限（15日になってはじめて翌月へ移る）'],
    ['2026-09-15', '2026-10-14', '15日は翌月14日'],
    ['2026-09-30', '2026-10-14', '月末は翌月14日'],
    ['2026-01-31', '2026-02-14', '1月末は2月14日'],
    ['2026-12-15', '2027-01-14', '12月15日は年を跨いで翌年1月14日'],
    ['2026-12-31', '2027-01-14', '大晦日も翌年1月14日'],
    ['2027-01-14', '2027-01-14', '年明け14日当日も当日が期限']
  ];
  deadlineCases.forEach(([base, expected, label]) => {
    test(`getNextDeadline(${base}) = ${expected}（${label}）`, () => {
      equal(api.getNextDeadline(base), expected, label);
    });
  });

  /* ---------- レシート明細は未接続では使わせない ---------- */

  test('共有スペースに接続していなければ、レシート機能は使えない扱いになる', () => {
    // このテスト環境には firebaseSyncReady が無いので、cloud は未接続のまま。
    equal(api.receiptsAvailable(), false, '未接続');
    deepEqual(api.dueReviewItems(), [], '未接続ならふりかえり対象は出さない');
  });

  test('ふりかえりを始める曜日は、その曜日以降だけ開く', () => {
    const state = api.getState();
    state.settings.reviewDayOfWeek = 3; // 水曜
    equal(api.reviewWindowOpen('2026-09-08'), false, '火曜はまだ');
    equal(api.reviewWindowOpen('2026-09-09'), true, '水曜から開く');
    equal(api.reviewWindowOpen('2026-09-12'), true, '土曜も開いたまま');
    state.settings.reviewDayOfWeek = 0; // 日曜（既定）
    equal(api.reviewWindowOpen('2026-09-08'), true, '既定はいつでも開く');
  });

  test('レシートを受け取っても state には入らない', () => {
    const before = JSON.stringify(api.getState());
    api.setReceipts([{ id: 'r1', storeName: '店', purchasedAt: '2026-09-01', total: 500, status: 'pending' }]);
    api.setReceiptItems([{ id: 'l1', receiptId: 'r1', name: 'もやし', amount: 500, category: '食品', outcomeTracked: true, outcome: 'in_stock' }]);
    equal(JSON.stringify(api.getState()), before, 'state は変わらない');
    equal(api.getState().receipts, undefined, 'state に receipts は生えない');
  });

  /* ---------- today() が日本時間であること ---------- */

  test('today() は日本時間で判定する（UTC 2026-01-01T20:00Z は日本では 2026-01-02）', () => {
    const engine = require(path.join(ROOT, 'finance-engine.js'));
    equal(engine.jstToday('2026-01-01T20:00:00.000Z'), '2026-01-02', '日本時間では翌日');
    equal(engine.jstToday('2026-01-01T14:59:59.000Z'), '2026-01-01', '日本時間で23:59はまだ当日');
    equal(engine.jstToday('2026-01-01T15:00:00.000Z'), '2026-01-02', '日本時間の0時で日付が変わる');
    equal(engine.jstToday('2026-12-31T15:00:00.000Z'), '2027-01-01', '年跨ぎ');
    // app.js の today() が同じ実装に委譲していること
    equal(api.today(), engine.jstToday(new Date()), 'app.js の today() がエンジンと一致する');
  });

  if (!failures.length) {
    console.log(JSON.stringify({ suite: 'app-contract', total, passed: total, failed: 0 }));
    process.exit(0);
  }
  console.log(JSON.stringify({ suite: 'app-contract', total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
  process.exit(1);
})().catch(error => {
  console.log(JSON.stringify({ suite: 'app-contract', total, passed: 0, failed: 1, failures: [{ name: 'boot', message: error.message }] }, null, 2));
  process.exit(1);
});
