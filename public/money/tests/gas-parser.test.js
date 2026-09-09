#!/usr/bin/env node
/**
 * Parsers.gs の解析ルールを Node で検証する。
 * 実際に届いたメールの構造（JCB・三井住友カード）を再現したケースを含む。
 * 金額と日付以外はマスクした内容だけを使い、本文そのものは保存しない。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'gas-card-mail-import', 'Parsers.gs'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const parse = (sender, subject, body, receivedAt = new Date(2026, 7, 25, 12)) =>
  sandbox.parseCardMail({ sender, subject, body, receivedAt });

const failures = [];
let total = 0;
const test = (name, fn) => {
  total += 1;
  try { fn(); } catch (error) { failures.push({ name, message: error.message }); }
};
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`${message}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

/* ---------- 実際のメール形式 ---------- */

test('JCB: ラベル付きの利用通知を完全に解析できる', () => {
  const result = parse(
    'JCBカード <jcb_info@qa.jcb.co.jp>',
    'JCBカード／ショッピングご利用のお知らせ',
    [
      'カード名称 ： 【OS】ＪＣＢカードＷ　ＮＬ',
      '',
      'いつも【OS】ＪＣＢカードＷ　ＮＬをご利用いただきありがとうございます。',
      'JCBカードのご利用がありましたのでご連絡します。',
      '',
      '',
      '【ご利用日時(日本時間)】 2026/08/24 23:09',
      '【ご利用金額】 279円',
      '【ご利用先】 ローソン'
    ].join('\n')
  );
  equal(result.amount, 279, '金額');
  equal(result.usedDate, '2026-08-24', '利用日');
  equal(result.merchant, 'ローソン', '利用先');
  equal(result.cardHint, '【OS】ＪＣＢカードＷ ＮＬ', 'カード名称');
  equal(result.type, 'purchase', '種別');
  equal(result.issuerLabel, 'JCB', 'カード会社');
  equal(result.confident, true, '自動確定できる');
  equal(result.note, '', '注記なし');
});

test('三井住友カード: 金額にラベルが無い形式でも解析できる', () => {
  const result = parse(
    '三井住友カード <statement@vpass.ne.jp>',
    'ご利用のお知らせ【三井住友カード】',
    [
      'いつも三井住友カードをご利用いただきありがとうございます。',
      '三井住友カードＶＩＳＡ（ＮＬ）についてカードの利用内容をお知らせします。',
      '',
      'ご利用内容',
      '',
      'ご利用日時：2026/08/23 15:03',
      'セブン－イレブン（買物）',
      '145円'
    ].join('\n')
  );
  equal(result.amount, 145, '利用日時の直後の金額を拾う');
  equal(result.usedDate, '2026-08-23', '利用日');
  equal(result.merchant, 'セブン－イレブン（買物）', '金額の直前の行を利用先とみなす');
  equal(result.cardHint, '三井住友カードＶＩＳＡ（ＮＬ）', 'カード名');
  equal(result.issuerLabel, '三井住友カード', 'vpass.ne.jp を三井住友カードとして認識する');
  equal(result.confident, true, '自動確定できる');
});

test('エポスカード: 01epos.jp を差出人として認識する', () => {
  const result = parse(
    'エポスカード <info@01epos.jp>',
    'エポスカードより「カードご利用のお知らせ」',
    ['ご利用日時：2026/08/14 01:00', 'ご利用金額：1,320円', 'ご利用先：マルイ'].join('\n')
  );
  equal(result.issuerLabel, 'エポスカード', 'カード会社');
  equal(result.amount, 1320, '金額');
  equal(result.usedDate, '2026-08-14', '利用日');
  equal(result.merchant, 'マルイ', '利用先');
  equal(result.confident, true, '自動確定できる');
});

/* ---------- 金額の特定 ---------- */

test('ラベル付きの金額は、他に数字があっても確定する', () => {
  const result = parse(
    '三井住友カード <statement@vpass.ne.jp>',
    'ご利用のお知らせ',
    ['ご利用日時：2026/08/22 12:00', 'ご利用金額 5,000円', '分割手数料 250円'].join('\n')
  );
  equal(result.amount, 5000, 'ラベル付きの金額を採用する');
  equal(result.confident, true, '自動確定できる');
});

test('ラベルが無く金額が複数ある通知は自動確定しない', () => {
  const result = parse(
    '三井住友カード <statement@vpass.ne.jp>',
    'お知らせ',
    ['ご案内 2026年8月22日', '5,000円', '250円'].join('\n')
  );
  equal(result.confident, false, '要確認になる');
  assert(result.note.indexOf('複数') !== -1, '複数金額の注記が入る');
});

test('全角数字・¥表記・JPY表記を解析できる', () => {
  equal(parse('info@smbc-card.com', 'ご利用のお知らせ', 'ご利用日 2026年8月20日\n￥２，３４５').amount, 2345, '全角と￥');
  equal(parse('info@jcb.co.jp', 'ご利用のお知らせ', 'ご利用日 2026-08-19\n3,456 JPY').amount, 3456, 'JPY表記');
});

test('ポイント・残高の数字を金額として拾わない', () => {
  const result = parse(
    'info@rakuten-card.co.jp',
    'ご利用のお知らせ',
    ['ご利用日 2026/08/24', 'ご利用金額 980円', '獲得ポイント 9ポイント', 'ご利用可能残高 123,456円'].join('\n')
  );
  equal(result.amount, 980, '金額のみ拾う');
  equal(result.confident, true, '自動確定できる');
});

/* ---------- 安全側に倒すケース ---------- */

test('金額を読み取れない通知も破棄せず要確認にする', () => {
  const result = parse('info@jcb.co.jp', 'ご利用のお知らせ', 'ご利用明細はアプリでご確認ください。');
  equal(result.amount, null, '金額は空');
  equal(result.confident, false, '要確認');
});

test('返金・取消は自動確定しない', () => {
  equal(parse('info@01epos.jp', 'ご返金のお知らせ', 'ご返金日 2026/08/21\nご返金額 2,000円').type, 'refund', '返金');
  equal(parse('info@01epos.jp', 'お取消のお知らせ', '取消日 2026/08/21\n取消金額 2,000円').type, 'cancel', '取消');
  equal(parse('info@01epos.jp', 'ご返金のお知らせ', 'ご返金日 2026/08/21\nご返金額 2,000円').confident, false, '要確認になる');
});

test('未対応の差出人は要確認にする', () => {
  const result = parse('news@example.com', 'ご利用のお知らせ', 'ご利用日 2026/08/23\nご利用金額 1,000円');
  equal(result.confident, false, '未対応の差出人は要確認');
  equal(result.issuerLabel, '', 'カード会社は不明');
});

test('カード利用と関係のないメールは候補にしない', () => {
  equal(parse('news@example.com', 'キャンペーンのご案内', '今月のおすすめ商品はこちら'), null, '候補を作らない');
});

test('年をまたぐ短い日付表記を補正する', () => {
  const result = parse('info@jcb.co.jp', 'ご利用のお知らせ', 'ご利用日 12/28\nご利用金額 800円', new Date(2027, 0, 3, 12));
  equal(result.usedDate, '2026-12-28', '前年の12月として扱う');
});

test('カード番号らしき数字をカード名として保存しない', () => {
  const result = parse(
    'info@jcb.co.jp',
    'ご利用のお知らせ',
    ['カード名称 ： ＪＣＢカードＷ', '【ご利用日時(日本時間)】 2026/08/24 10:00', '【ご利用金額】 500円'].join('\n')
  );
  equal(result.cardHint, 'ＪＣＢカードＷ', 'カード名のみ');
  assert(!/[0-9]{4}/.test(result.cardHint), 'カード名に4桁以上の数字を含めない');
});

if (failures.length === 0) {
  console.log(JSON.stringify({ suite: 'gas-parser', total, passed: total, failed: 0 }));
  process.exit(0);
}
console.log(JSON.stringify({ suite: 'gas-parser', total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
process.exit(1);
