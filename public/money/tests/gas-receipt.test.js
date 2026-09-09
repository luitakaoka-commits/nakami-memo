#!/usr/bin/env node
/**
 * gas-receipt-import の純粋関数を Node で検証する。
 *
 * ねらい
 *  - Gemini の読み取り結果を Firestore の形に整えるところで、値を落としたり増やしたりしないこと
 *  - 検算（reviewReceipt）が、怪しいレシートを黙って通してしまわないこと
 *  - Code.gs の定数が finance-engine.js とズレていないこと（ズレるとルールに弾かれて保存できない）
 *  - Drive OCR の当て推量が、明らかな誤読を返さないこと
 *
 * Gemini のプロンプトそのもの（小計を明細に混ぜないか等）はここでは確かめられない。
 * それは Apps Script で dryRun() を1回走らせて目で見る領域。
 * ここが通ることは「読み取れた後の処理は正しい」ことしか意味しない。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_DIR = path.join(__dirname, '..', 'integrations', 'gas-receipt-import');
const engine = require(path.join(__dirname, '..', 'finance-engine.js'));

/* Code.gs と Gemini.gs を同じコンテキストに読み込む。
   Gemini.gs の receiptResponseSchema() が Code.gs の RECEIPT_CATEGORIES を参照するため順序が要る。 */
const sandbox = { console, Logger: { log() {} } };
vm.createContext(sandbox);
['Code.gs', 'Gemini.gs'].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(GAS_DIR, file), 'utf8'), sandbox, { filename: file });
});

const failures = [];
let total = 0;
const test = (name, fn) => {
  total += 1;
  try { fn(); } catch (error) { failures.push({ name, message: error.message }); }
};
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`${message}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};
const deepEqual = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

/** Gemini が返す想定のJSON。テストで気にする値だけ上書きする。 */
const parsed = over => Object.assign({
  storeName: 'スーパーA',
  purchasedAt: '2026-09-01',
  total: 300,
  taxTotal: 22,
  paymentMethod: 'cash',
  confidence: 0.9,
  items: [{ rawName: 'ﾓﾔｼ', quantity: 1, unit: '袋', unitPrice: 300, amount: 300, category: '食品' }]
}, over);

const META = { receiptId: 'r1', now: '2026-09-01T00:00:00.000Z', source: 'gemini', createdBy: 'gas-receipt-import' };
const build = over => sandbox.buildReceiptRecord(parsed(over), META);

/* ---------- 1. Code.gs と finance-engine.js の一致 ---------- */

test('1. カテゴリ一覧が finance-engine と完全一致する（順序も）', () => {
  deepEqual(sandbox.RECEIPT_CATEGORIES, [...engine.RECEIPT_CATEGORIES], 'RECEIPT_CATEGORIES');
});

test('2. ふりかえり対象の判定が finance-engine と同じ答えを返す', () => {
  const patterns = [
    ['食品', 100], ['飲料', 100], ['調味料', 100], ['日用品', 100], ['消耗品', 100],
    ['書籍', 100], ['衣料', 100], ['その他', 100],
    ['書籍', 4999], ['書籍', 5000], ['書籍', 5001], ['衣料', 12000]
  ];
  patterns.forEach(([category, amount]) => {
    equal(
      sandbox.classifyOutcomeTracked(category, amount),
      engine.classifyOutcomeTracked({ category, amount }),
      `${category} / ${amount}円`
    );
  });
});

test('3. 5,000円ちょうどはカテゴリを問わず対象になる', () => {
  equal(sandbox.classifyOutcomeTracked('書籍', 5000), true, '5,000円ちょうど');
  equal(sandbox.classifyOutcomeTracked('書籍', 4999), false, '4,999円');
});

/* ---------- 2. buildReceiptRecord ---------- */

test('4. Firestore に入れるフィールドが rules の hasOnly と一致する', () => {
  /* ズレるとルールに弾かれて保存できない。rules 側を正として突き合わせる。 */
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const listOf = (marker) => rules.slice(rules.indexOf(marker))
    .match(/hasOnly\(\[([\s\S]*?)\]\)/)[1]
    .split(',').map(item => item.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const record = build();
  deepEqual(Object.keys(record.receipt), listOf('match /receipts/'), 'receipts');
  deepEqual(Object.keys(record.items[0]), listOf('match /receiptItems/'), 'receiptItems');
});

test('5. 名前も金額も無い行は落とす（読み取りのゴミ）', () => {
  const record = build({
    items: [
      { rawName: 'ﾓﾔｼ', amount: 100, category: '食品' },
      { rawName: '', amount: 0, category: 'その他' },
      { rawName: '', amount: -50, category: 'その他' }
    ]
  });
  equal(record.items.length, 2, '空行だけが落ちる');
  deepEqual(record.items.map(item => item.lineNo), [1, 2], '行番号は詰め直される');
});

test('6. 値引き行はマイナスのまま保持する', () => {
  const record = build({
    total: 250,
    items: [
      { rawName: 'ﾓﾔｼ', amount: 300, category: '食品' },
      { rawName: '値引', amount: -50, category: 'その他' }
    ]
  });
  equal(record.items[1].amount, -50, 'マイナスを潰さない');
  equal(record.items[1].outcomeTracked, false, '値引き行はふりかえり対象にしない');
});

test('7. 知らないカテゴリは「その他」に寄せる', () => {
  const record = build({ items: [{ rawName: 'なにか', amount: 100, category: '謎ジャンル' }] });
  equal(record.items[0].category, 'その他', '許可リスト外');
});

test('8. rawName をそのまま name にも入れる（正規化はアプリ側の仕事）', () => {
  const record = build({ items: [{ rawName: 'ﾓﾔｼ2P', amount: 100, category: '食品' }] });
  equal(record.items[0].rawName, 'ﾓﾔｼ2P', '元の表記');
  equal(record.items[0].name, 'ﾓﾔｼ2P', 'GAS側では正規化しない');
  equal(engine.normalizeItemName(record.items[0].name), 'もやし', 'アプリ側が寄せられる形になっている');
});

test('9. 数量と単価が抜けていたら 1 と 0 で埋める', () => {
  const record = build({ items: [{ rawName: 'ﾓﾔｼ', amount: 100, category: '食品' }] });
  equal(record.items[0].quantity, 1, '数量');
  equal(record.items[0].unitPrice, 0, '単価');
  equal(record.items[0].unit, '', '単位');
});

test('10. 知らない支払方法は unknown にする', () => {
  equal(build({ paymentMethod: 'paypay' }).receipt.paymentMethod, 'unknown', '許可リスト外');
  equal(build({ paymentMethod: 'emoney' }).receipt.paymentMethod, 'emoney', '許可リスト内');
});

test('11. 日付として成立しない値は空にする', () => {
  equal(build({ purchasedAt: '2026-13-01' }).receipt.purchasedAt, '', '13月');
  equal(build({ purchasedAt: '2026-09-32' }).receipt.purchasedAt, '', '32日');
  equal(build({ purchasedAt: '2026/09/01' }).receipt.purchasedAt, '', '区切りが違う');
  equal(build({ purchasedAt: '2026-09-01' }).receipt.purchasedAt, '2026-09-01', '正しい形');
});

test('12. 金額は整数に丸める', () => {
  const record = build({ total: 300.4, items: [{ rawName: 'x', amount: 99.6, category: '食品' }] });
  equal(record.receipt.total, 300, '合計');
  equal(record.items[0].amount, 100, '明細');
});

test('13. 明細が空でも落ちない', () => {
  const record = build({ items: [] });
  equal(record.items.length, 0, '0件');
  equal(record.receipt.storeName, 'スーパーA', 'レシート本体は作られる');
});

/* ---------- 3. reviewReceipt（検算） ---------- */

const reviewed = over => {
  const record = build(over);
  return sandbox.reviewReceipt(record, { confidence: parsed(over).confidence });
};

test('14. 明細の合計が合っていれば pending', () => {
  equal(reviewed().receipt.status, 'pending', '合っている');
  equal(reviewed().receipt.note, '', '理由なし');
});

test('15. 明細の合計が合わなければ needs_review にして理由を残す', () => {
  const record = reviewed({ total: 500 });
  equal(record.receipt.status, 'needs_review', 'status');
  assert(/明細の合計/.test(record.receipt.note), `理由が入る: ${record.receipt.note}`);
});

test('16. 1円のズレは見逃す（端数処理の差）', () => {
  equal(reviewed({ total: 301 }).receipt.status, 'pending', '1円多い');
  equal(reviewed({ total: 299 }).receipt.status, 'pending', '1円少ない');
  equal(reviewed({ total: 302 }).receipt.status, 'needs_review', '2円はダメ');
});

test('17. 店名・日付・合計・明細が欠けていれば needs_review', () => {
  equal(reviewed({ storeName: '' }).receipt.status, 'needs_review', '店名なし');
  equal(reviewed({ purchasedAt: '' }).receipt.status, 'needs_review', '日付なし');
  equal(reviewed({ total: 0 }).receipt.status, 'needs_review', '合計なし');
  equal(reviewed({ items: [] }).receipt.status, 'needs_review', '明細なし');
});

test('18. 自信度が低ければ needs_review', () => {
  equal(reviewed({ confidence: 0.59 }).receipt.status, 'needs_review', '0.59');
  equal(reviewed({ confidence: 0.6 }).receipt.status, 'pending', '0.6 は通す');
});

test('19. 値引きを含めて合計が合っていれば pending', () => {
  const record = reviewed({
    total: 250,
    items: [
      { rawName: 'ﾓﾔｼ', amount: 300, category: '食品' },
      { rawName: '値引', amount: -50, category: 'その他' }
    ]
  });
  equal(record.receipt.status, 'pending', '300 - 50 = 250');
});

test('20. status と source が rules の許可リストに入っている', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  ['pending', 'needs_review'].forEach(status => {
    assert(rules.includes(`'${status}'`), `status ${status} が rules にある`);
  });
  ['gemini', 'drive-ocr'].forEach(source => {
    assert(rules.includes(`'${source}'`), `source ${source} が rules にある`);
  });
});

/* ---------- 4. toFirestoreFields ---------- */

test('21. 型ごとに正しいFirestore表現へ変換する', () => {
  const fields = sandbox.toFirestoreFields({ name: 'ﾓﾔｼ', amount: 100, tracked: true, skip: null });
  deepEqual(fields.name, { stringValue: 'ﾓﾔｼ' }, '文字列');
  deepEqual(fields.amount, { doubleValue: 100 }, '数値');
  deepEqual(fields.tracked, { booleanValue: true }, '真偽値');
  assert(!('skip' in fields), 'null は送らない');
});

/* ---------- 5. Drive OCR の当て推量 ---------- */

test('22. 合計は「合計」を含む行から拾う', () => {
  const text = ['スーパーA', 'ﾓﾔｼ 198', '小計 198', '合計 １98'.replace('１', '1'), 'お預り 500'].join('\n');
  equal(sandbox.guessTotal(text), 198, 'お預りの500を合計にしない');
});

test('23. 日付は和暦記号・スラッシュ・ハイフンのどれでも読む', () => {
  equal(sandbox.guessPurchasedAt('2026年9月1日'), '2026-09-01', '年月日');
  equal(sandbox.guessPurchasedAt('2026/09/01 15:03'), '2026-09-01', 'スラッシュ');
  equal(sandbox.guessPurchasedAt('日付なし'), '', '読めなければ空');
});

test('24. 店名は先頭付近の、数字と記号だけではない行を採る', () => {
  equal(sandbox.guessStoreName(['2026/09/01', '******', 'スーパーA', 'ﾓﾔｼ 198'].join('\n')), 'スーパーA', '店名');
  equal(sandbox.guessStoreName(''), '', '空でも落ちない');
});

test('25. OCR結果は confidence 0.3 なので必ず needs_review になる', () => {
  /* Drive OCR は明細を組み立てられない。人の確認を必ず挟む設計であることを固定する。 */
  const record = sandbox.buildReceiptRecord(
    { storeName: 'スーパーA', purchasedAt: '2026-09-01', total: 198, taxTotal: 0, paymentMethod: 'unknown', confidence: 0.3, items: [] },
    Object.assign({}, META, { source: 'drive-ocr' })
  );
  sandbox.reviewReceipt(record, { confidence: 0.3 });
  equal(record.receipt.status, 'needs_review', '自動で正式データにしない');
  equal(record.receipt.source, 'drive-ocr', 'source');
});

if (failures.length === 0) {
  console.log(JSON.stringify({ suite: 'gas-receipt', total, passed: total, failed: 0 }));
  process.exit(0);
}
console.log(JSON.stringify({ suite: 'gas-receipt', total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
process.exit(1);
