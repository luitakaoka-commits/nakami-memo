#!/usr/bin/env node
/**
 * レシート明細の純粋関数を検証する。
 *
 * ねらい
 *  - outcome から無駄金額への対応表が、表のとおりであること（半額は切り捨て）
 *  - 「ふりかえりで聞くか」の既定値が、カテゴリと5,000円の境界で正しく決まること
 *  - 期間集計・繰り返し廃棄の並び順・ふりかえり対象の日数境界
 *  - 日付は日本時間で判定すること（UTCの夜は日本ではもう翌日）
 */
const path = require('path');
const engine = require(path.join(__dirname, '..', 'finance-engine.js'));

const failures = [];
let total = 0;
const test = (name, fn) => { total += 1; try { fn(); } catch (e) { failures.push({ name, message: e.message }); } };
const equal = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected=${JSON.stringify(b)} actual=${JSON.stringify(a)}`); };
const deepEqual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected=${JSON.stringify(b)} actual=${JSON.stringify(a)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };

/** 明細行の最小形。テストで気にする値だけを上書きする。 */
const line = over => ({
  id: over.id || `l${Math.random().toString(36).slice(2, 8)}`,
  receiptId: 'r1',
  lineNo: 1,
  rawName: over.name || '品',
  name: over.name || '品',
  quantity: 1,
  unit: '個',
  unitPrice: over.amount || 0,
  amount: 0,
  category: '食品',
  outcomeTracked: true,
  outcome: 'in_stock',
  outcomeAt: '',
  outcomeReason: '',
  note: '',
  ...over
});

/* ---------- 1. wasteAmountOf ---------- */

test('1. まだある(in_stock)は無駄0', () => {
  equal(engine.wasteAmountOf(line({ amount: 1000, outcome: 'in_stock' })), 0, 'in_stock');
});

test('2. 使い切った(consumed)は無駄0', () => {
  equal(engine.wasteAmountOf(line({ amount: 1000, outcome: 'consumed' })), 0, 'consumed');
});

test('3. 期限切れ(expired)は全額', () => {
  equal(engine.wasteAmountOf(line({ amount: 1000, outcome: 'expired' })), 1000, 'expired');
});

test('4. 使わないまま処分(discarded)は全額', () => {
  equal(engine.wasteAmountOf(line({ amount: 1234, outcome: 'discarded' })), 1234, 'discarded');
});

test('5. 使う見込みなし(unused)は半額・端数切り捨て', () => {
  equal(engine.wasteAmountOf(line({ amount: 1000, outcome: 'unused' })), 500, '偶数');
  equal(engine.wasteAmountOf(line({ amount: 301, outcome: 'unused' })), 150, '奇数は切り捨て');
  equal(engine.wasteAmountOf(line({ amount: 1, outcome: 'unused' })), 0, '1円は0円');
});

test('6. そもそも不要(unnecessary)は全額', () => {
  equal(engine.wasteAmountOf(line({ amount: 800, outcome: 'unnecessary' })), 800, 'unnecessary');
});

test('7. outcome未記入は「まだある」と同じで無駄0', () => {
  equal(engine.wasteAmountOf({ amount: 1000 }), 0, '未記入');
  equal(engine.wasteAmountOf({ amount: 1000, outcome: '' }), 0, '空文字');
});

test('8. 見覚えのないoutcomeと0円以下は無駄0', () => {
  equal(engine.wasteAmountOf(line({ amount: 1000, outcome: 'broken' })), 0, '未知のoutcome');
  equal(engine.wasteAmountOf(line({ amount: 0, outcome: 'expired' })), 0, '0円');
  equal(engine.wasteAmountOf(line({ amount: -500, outcome: 'expired' })), 0, 'マイナス');
  equal(engine.wasteAmountOf(null), 0, 'null');
});

/* ---------- 2. classifyOutcomeTracked ---------- */

test('9. 食品・飲料・調味料・日用品・消耗品は聞く', () => {
  ['食品', '飲料', '調味料', '日用品', '消耗品'].forEach(category => {
    equal(engine.classifyOutcomeTracked({ category, amount: 300 }), true, category);
  });
});

test('10. 外食・交通・サービス・書籍・衣料・雑貨・その他は聞かない', () => {
  ['外食', '交通', 'サービス', '書籍', '衣料', '雑貨', 'その他'].forEach(category => {
    equal(engine.classifyOutcomeTracked({ category, amount: 300 }), false, category);
  });
});

test('11. 4,999円は聞かないカテゴリのまま', () => {
  equal(engine.classifyOutcomeTracked({ category: '雑貨', amount: 4999 }), false, '境界の手前');
});

test('12. 5,000円ちょうどからはカテゴリに関わらず聞く', () => {
  equal(engine.classifyOutcomeTracked({ category: '雑貨', amount: 5000 }), true, '境界ちょうど');
  equal(engine.classifyOutcomeTracked({ category: '交通', amount: 12000 }), true, '境界より上');
});

test('13. カテゴリ未指定・引数なしでも落ちない', () => {
  equal(engine.classifyOutcomeTracked({}), false, '空オブジェクト');
  equal(engine.classifyOutcomeTracked(), false, '引数なし');
});

/* ---------- 3. summarizeWaste ---------- */

const WASTE_ITEMS = [
  line({ id: 'w1', name: 'もやし', amount: 100, category: '食品', outcome: 'expired', purchasedAt: '2026-08-31' }),
  line({ id: 'w2', name: '牛乳', amount: 200, category: '飲料', outcome: 'expired', purchasedAt: '2026-09-01' }),
  line({ id: 'w3', name: 'にんじん', amount: 300, category: '食品', outcome: 'discarded', purchasedAt: '2026-09-15' }),
  line({ id: 'w4', name: '洗剤', amount: 501, category: '日用品', outcome: 'unused', purchasedAt: '2026-09-30' }),
  line({ id: 'w5', name: 'パン', amount: 400, category: '食品', outcome: 'consumed', purchasedAt: '2026-09-20' }),
  line({ id: 'w6', name: '米', amount: 900, category: '食品', outcome: 'in_stock', purchasedAt: '2026-09-21' }),
  line({ id: 'w7', name: 'ケーキ', amount: 700, category: '食品', outcome: 'expired', purchasedAt: '2026-10-01' })
];

test('14. 期間の両端を含めて合計する', () => {
  const result = engine.summarizeWaste(WASTE_ITEMS, { from: '2026-09-01', to: '2026-09-30' });
  equal(result.total, 200 + 300 + 250, '9月の廃棄額');
  equal(result.wastedCount, 3, '廃棄した行数');
  equal(result.count, 5, '期間内の行数（廃棄していない行も数える）');
});

test('15. 期間の外は数えない（前日・翌日）', () => {
  const before = engine.summarizeWaste(WASTE_ITEMS, { from: '2026-08-31', to: '2026-08-31' });
  equal(before.total, 100, '8/31だけ');
  const after = engine.summarizeWaste(WASTE_ITEMS, { from: '2026-10-01', to: '2026-10-31' });
  equal(after.total, 700, '10月だけ');
});

test('16. from/to を省くと全期間', () => {
  const result = engine.summarizeWaste(WASTE_ITEMS, {});
  equal(result.total, 100 + 200 + 300 + 250 + 700, '全期間の廃棄額');
  equal(result.count, WASTE_ITEMS.length, '全行');
});

test('17. カテゴリ別の内訳は金額の多い順', () => {
  const result = engine.summarizeWaste(WASTE_ITEMS, { from: '2026-09-01', to: '2026-09-30' });
  deepEqual(result.categories.map(item => [item.label, item.amount]), [['食品', 300], ['日用品', 250], ['飲料', 200]], '内訳');
  equal(Math.round(result.categories[0].ratio * 1000), Math.round(300 / 750 * 1000), '割合');
});

test('18. outcome別の件数を返す', () => {
  const result = engine.summarizeWaste(WASTE_ITEMS, { from: '2026-09-01', to: '2026-09-30' });
  equal(result.outcomes.expired, 1, 'expired');
  equal(result.outcomes.discarded, 1, 'discarded');
  equal(result.outcomes.unused, 1, 'unused');
  equal(result.outcomes.consumed, 1, 'consumed');
  equal(result.outcomes.in_stock, 1, 'in_stock');
  equal(result.outcomes.unnecessary, 0, '該当なしは0');
});

test('19. 結末を記録した日(outcomeAt)があれば、その日で期間に入れる', () => {
  // UTCの2026-09-30T16:00Z は日本時間では10/1。購入日9/1ではなく10月に数える。
  const items = [line({ id: 'x1', amount: 1000, outcome: 'expired', purchasedAt: '2026-09-01', outcomeAt: '2026-09-30T16:00:00Z' })];
  equal(engine.summarizeWaste(items, { from: '2026-09-01', to: '2026-09-30' }).total, 0, '9月には入らない');
  equal(engine.summarizeWaste(items, { from: '2026-10-01', to: '2026-10-31' }).total, 1000, '10月に入る');
});

test('20. 空配列でも落ちない', () => {
  const result = engine.summarizeWaste([], { from: '2026-09-01', to: '2026-09-30' });
  equal(result.total, 0, '合計0');
  equal(result.categories.length, 0, '内訳なし');
  equal(result.outcomes.expired, 0, '件数0');
});

/* ---------- 4. repeatedWasteRanking ---------- */

const RANKING_ITEMS = [
  // もやし: 3回買って2回捨てた（合計200円）
  line({ name: 'もやし', amount: 100, outcome: 'expired', purchasedAt: '2026-09-01' }),
  line({ name: 'もやし', amount: 100, outcome: 'expired', purchasedAt: '2026-09-08' }),
  line({ name: 'もやし', amount: 100, outcome: 'consumed', purchasedAt: '2026-09-15' }),
  // 牛乳: 2回買って2回捨てた（合計600円）→ 廃棄回数が同じなら金額で上に来る
  line({ name: '牛乳', amount: 300, outcome: 'expired', purchasedAt: '2026-09-02' }),
  line({ name: '牛乳', amount: 300, outcome: 'discarded', purchasedAt: '2026-09-09' }),
  // にんじん: 1回だけ捨てた
  line({ name: 'にんじん', amount: 500, outcome: 'unnecessary', purchasedAt: '2026-09-03' }),
  // パン: 一度も捨てていない
  line({ name: 'パン', amount: 200, outcome: 'consumed', purchasedAt: '2026-09-04' })
];

test('21. 廃棄回数が同じなら廃棄額の多い方が上', () => {
  const ranking = engine.repeatedWasteRanking(RANKING_ITEMS, { limit: 5 });
  deepEqual(ranking.map(item => item.name), ['牛乳', 'もやし', 'にんじん'], '並び順');
});

test('22. 購入回数・廃棄回数・廃棄額を数える', () => {
  const ranking = engine.repeatedWasteRanking(RANKING_ITEMS, { limit: 5 });
  const moyashi = ranking.find(item => item.name === 'もやし');
  equal(moyashi.purchaseCount, 3, '購入回数');
  equal(moyashi.wasteCount, 2, '廃棄回数');
  equal(moyashi.wasteTotal, 200, '廃棄額合計');
});

test('23. 一度も捨てていないものは並べない', () => {
  const ranking = engine.repeatedWasteRanking(RANKING_ITEMS, { limit: 10 });
  assert(!ranking.some(item => item.name === 'パン'), 'パンは出ない');
});

test('24. limitで件数を絞る（既定は5件）', () => {
  equal(engine.repeatedWasteRanking(RANKING_ITEMS, { limit: 1 }).length, 1, 'limit=1');
  equal(engine.repeatedWasteRanking(RANKING_ITEMS).length, 3, '既定は5件までなので全部');
});

test('25. 半額扱い(unused)も廃棄1回として数える', () => {
  const items = [line({ name: '調味料', amount: 999, outcome: 'unused', purchasedAt: '2026-09-01' })];
  const ranking = engine.repeatedWasteRanking(items, {});
  equal(ranking[0].wasteCount, 1, '回数');
  equal(ranking[0].wasteTotal, 499, '半額の切り捨て');
});

/* ---------- 5. dueForReview ---------- */

const TODAY = '2026-09-22';
const back = days => {
  const base = new Date(Date.UTC(2026, 8, 22) - days * 86400000);
  return base.toISOString().slice(0, 10);
};

test('26. 6日前は早すぎるので出さない／7日前から出す', () => {
  const six = line({ id: 's6', name: '6日前', purchasedAt: back(6) });
  const seven = line({ id: 's7', name: '7日前', purchasedAt: back(7) });
  const result = engine.dueForReview([six, seven], { today: TODAY });
  deepEqual(result.map(item => item.id), ['s7'], '7日前だけ');
});

test('27. 21日前までは出し、22日前は出さない', () => {
  const twentyOne = line({ id: 's21', name: '21日前', purchasedAt: back(21) });
  const twentyTwo = line({ id: 's22', name: '22日前', purchasedAt: back(22) });
  const result = engine.dueForReview([twentyOne, twentyTwo], { today: TODAY });
  deepEqual(result.map(item => item.id), ['s21'], '21日前だけ');
});

test('28. 日用品・消耗品は30日経ってから聞く', () => {
  const soap29 = line({ id: 'd29', category: '日用品', purchasedAt: back(29) });
  const soap30 = line({ id: 'd30', category: '日用品', purchasedAt: back(30) });
  const paper44 = line({ id: 'p44', category: '消耗品', purchasedAt: back(44) });
  const paper45 = line({ id: 'p45', category: '消耗品', purchasedAt: back(45) });
  const result = engine.dueForReview([soap29, soap30, paper44, paper45], { today: TODAY });
  deepEqual(result.map(item => item.id), ['p44', 'd30'], '30日〜44日の範囲だけ、古い順');
});

test('29. 日用品の日数はオプションで変えられる', () => {
  const soap = line({ id: 'd10', category: '消耗品', purchasedAt: back(10) });
  equal(engine.dueForReview([soap], { today: TODAY }).length, 0, '既定の30日では出ない');
  equal(engine.dueForReview([soap], { today: TODAY, dailyGoodsMinDays: 10 }).length, 1, '10日にすれば出る');
});

test('30. outcomeTracked が false の行は出さない', () => {
  const skipped = line({ id: 'n1', outcomeTracked: false, purchasedAt: back(10) });
  const asked = line({ id: 'n2', outcomeTracked: true, purchasedAt: back(10) });
  deepEqual(engine.dueForReview([skipped, asked], { today: TODAY }).map(item => item.id), ['n2'], 'trueだけ');
});

test('31. 結末が決まっている行は出さない', () => {
  const done = line({ id: 'f1', outcome: 'consumed', purchasedAt: back(10) });
  const trash = line({ id: 'f2', outcome: 'expired', purchasedAt: back(10) });
  const stock = line({ id: 'f3', outcome: 'in_stock', purchasedAt: back(10) });
  const blank = line({ id: 'f4', outcome: '', purchasedAt: back(10) });
  deepEqual(engine.dueForReview([done, trash, stock, blank], { today: TODAY }).map(item => item.id), ['f3', 'f4'], 'in_stockと未記入だけ');
});

test('32. 古い順に並べる', () => {
  const items = [
    line({ id: 'o8', purchasedAt: back(8) }),
    line({ id: 'o20', purchasedAt: back(20) }),
    line({ id: 'o12', purchasedAt: back(12) })
  ];
  deepEqual(engine.dueForReview(items, { today: TODAY }).map(item => item.id), ['o20', 'o12', 'o8'], '古い順');
});

test('33. limitで件数を絞る（古い方から残す）', () => {
  const items = [
    line({ id: 'l8', purchasedAt: back(8) }),
    line({ id: 'l20', purchasedAt: back(20) }),
    line({ id: 'l12', purchasedAt: back(12) })
  ];
  deepEqual(engine.dueForReview(items, { today: TODAY, limit: 2 }).map(item => item.id), ['l20', 'l12'], '2件');
  equal(engine.dueForReview(items, { today: TODAY, limit: 0 }).length, 0, 'limit=0');
});

test('34. 「まだある」と答えた日(outcomeAt)から数え直す', () => {
  // 30日前に買って、2日前に「まだある」と答えた行。購入日で数えれば期限切れだが、
  // 答えた日から数えるのでまだ早い。
  const answered = line({ id: 'a1', purchasedAt: back(30), outcomeAt: `${back(2)}T03:00:00Z` });
  equal(engine.dueForReview([answered], { today: TODAY }).length, 0, '2日前に答えたばかりなので出ない');
  const older = line({ id: 'a2', purchasedAt: back(60), outcomeAt: `${back(9)}T03:00:00Z` });
  deepEqual(engine.dueForReview([older], { today: TODAY }).map(item => item.id), ['a2'], '9日前に答えた行は出る');
});

test('35. 経過日数を添えて返す', () => {
  const item = line({ id: 'e1', purchasedAt: back(10) });
  const result = engine.dueForReview([item], { today: TODAY });
  equal(result[0].elapsedDays, 10, '経過日数');
  equal(result[0].baseDate, back(10), '基準日');
  equal(result[0].name, item.name, '元の行の値を保つ');
});

test('36. 日付が無い行・空配列でも落ちない', () => {
  equal(engine.dueForReview([], { today: TODAY }).length, 0, '空配列');
  equal(engine.dueForReview([line({ id: 'z1', purchasedAt: '' })], { today: TODAY }).length, 0, '日付なし');
  equal(engine.dueForReview([line({ id: 'z2', purchasedAt: 'あした' })], { today: TODAY }).length, 0, '壊れた日付');
});

/* ---------- 6. Rulesと実装のズレを防ぐ ----------
 * firestore.rules のホワイトリストと、firebase-sync.js が書くフィールド、
 * app.js が使う語彙がずれると、保存が黙って拒否される。
 * 文字列として突き合わせるだけの軽い検査で、ずれたら落ちるようにしておく。
 */
const fs = require('fs');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const RULES = read('firestore.rules');
const SYNC = read('firebase-sync.js');
const APP = read('app.js');

/** rules の hasOnly([...]) からフィールド名を取り出す */
function hasOnlyList(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`${marker} が見つかりません`);
  const from = source.indexOf('hasOnly([', at);
  const to = source.indexOf('])', from);
  return source.slice(from + 'hasOnly(['.length, to)
    .split(',').map(item => item.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
}

/** firebase-sync.js の定数オブジェクトからキーを取り出す */
function syncFields(name) {
  const from = SYNC.indexOf(`const ${name} = {`);
  if (from < 0) throw new Error(`${name} が見つかりません`);
  const to = SYNC.indexOf('\n};', from);
  return SYNC.slice(from, to).split('\n').slice(1)
    .map(row => (row.match(/^\s{2}([A-Za-z]+):/) || [])[1]).filter(Boolean).sort();
}

/** rules の `data.x in [...]` から語彙を取り出す */
function vocabulary(field) {
  const match = RULES.match(new RegExp(`data\\.${field} in \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`data.${field} の許可リストが見つかりません`);
  return match[1].split(',').map(item => item.trim().replace(/^'|'$/g, '')).sort();
}

test('37. receipts のフィールドが Rules と firebase-sync.js で一致する', () => {
  deepEqual(syncFields('RECEIPT_FIELDS'), hasOnlyList(RULES, 'validReceipt'), 'receipts');
});

test('38. receiptItems のフィールドが Rules と firebase-sync.js で一致する', () => {
  deepEqual(syncFields('RECEIPT_ITEM_FIELDS'), hasOnlyList(RULES, 'validReceiptItem'), 'receiptItems');
});

test('39. カテゴリの語彙が finance-engine と Rules で一致する', () => {
  deepEqual([...engine.RECEIPT_CATEGORIES].sort(), vocabulary('category'), 'category');
});

test('40. outcome の語彙が finance-engine と Rules で一致する', () => {
  deepEqual([...engine.RECEIPT_OUTCOMES].sort(), vocabulary('outcome'), 'outcome');
});

test('41. 支払い方法・レシートの状態・出所の語彙が app.js と Rules で一致する', () => {
  deepEqual(vocabulary('paymentMethod'), ['card', 'cash', 'emoney', 'unknown'], 'paymentMethod');
  deepEqual(vocabulary('status'), ['accepted', 'ignored', 'needs_review', 'pending'], 'status');
  deepEqual(vocabulary('source'), ['drive-ocr', 'gemini', 'manual'], 'source');
  ['cash', 'card', 'emoney', 'unknown'].forEach(key => {
    assert(APP.includes(`${key}:`), `PAYMENT_METHODS に ${key} がある`);
  });
});

test('42. 「捨てた」の理由4つが Rules の許可リストに入っている', () => {
  const allowed = RULES.match(/data\.outcomeReason in \[([^\]]*)\]/)[1]
    .split(',').map(item => item.trim().replace(/^'|'$/g, ''));
  ['期限切れ', '使わなかった', '買いすぎ', '好みでなかった', ''].forEach(reason => {
    assert(allowed.includes(reason), `${reason || '(空)'} が許可されている`);
  });
});

test('43. レシートは state に入れない（app.js が state.receipts を作らない）', () => {
  assert(!/state\.receipts/.test(APP), 'state.receipts を触っていない');
  assert(!/state\.receiptItems/.test(APP), 'state.receiptItems を触っていない');
  const emptyStateBody = APP.slice(APP.indexOf('function emptyState()'), APP.indexOf('function normalizeTransactionDates'));
  assert(!/receipt/i.test(emptyStateBody), 'emptyState にレシート用の入れ物を作っていない');
  assert(/reviewDayOfWeek/.test(emptyStateBody), 'ふりかえりの曜日設定だけは settings にある');
});

/* ---------- 名寄せ（品名の表記ゆれをまとめる） ---------- */

/* レシートの品名は店ごとにバラバラに出てくる。「ﾓﾔｼ」「モヤシ」「もやし2P」を
   1つにまとめられないと、この機能の一番の価値である「繰り返し捨てているもの」が出せない。
   ただし寄せすぎも失敗で、「もやし」が「野菜」にまとまると行動につながらない。
   なので機械的に確実な変換だけを自動でやり、意味の判断は辞書（ユーザーの操作）に任せる。 */

test('44. 半角カナ・全角カナ・ひらがなが同じキーになる', () => {
  const key = engine.normalizeItemName('もやし');
  equal(engine.normalizeItemName('ﾓﾔｼ'), key, '半角カナ');
  equal(engine.normalizeItemName('モヤシ'), key, '全角カナ');
  equal(key, 'もやし', 'ひらがな');
});

test('45. 末尾の数量表記を落とす', () => {
  equal(engine.normalizeItemName('もやし2P'), 'もやし', '2P');
  equal(engine.normalizeItemName('もやし 2p'), 'もやし', '小文字p＋空白');
  equal(engine.normalizeItemName('牛乳 1L'), '牛乳', '1L');
  equal(engine.normalizeItemName('たまご10個'), 'たまご', '10個');
  equal(engine.normalizeItemName('豚こま300g'), '豚こま', '300g');
});

test('46. 数量表記が重なっていても全部落とす', () => {
  equal(engine.normalizeItemName('もやし2P 3個'), 'もやし', '2段');
});

test('47. 先頭の店舗記号を落とす', () => {
  equal(engine.normalizeItemName('＊もやし'), 'もやし', '全角アスタリスク');
  equal(engine.normalizeItemName('※もやし'), 'もやし', '米印');
  equal(engine.normalizeItemName('＊たまご10個'), 'たまご', '記号＋数量');
});

test('48. 長音符は残す（消すと別語と衝突する）', () => {
  equal(engine.normalizeItemName('コーヒー'), 'こーひー', 'カタカナ長音');
  assert(engine.normalizeItemName('コーヒー') !== engine.normalizeItemName('コヒ'), 'コーヒー と コヒ が同じにならない');
});

test('49. 意味の判断はしない（緑豆もやし は もやし に寄せない）', () => {
  assert(engine.normalizeItemName('緑豆もやし') !== engine.normalizeItemName('もやし'), '別キーのまま');
  equal(engine.normalizeItemName('緑豆もやし'), '緑豆もやし', '漢字は残る');
});

test('50. 潰しすぎない（空文字を返さない）', () => {
  equal(engine.normalizeItemName(''), '', '空文字はそのまま');
  equal(engine.normalizeItemName('   '), '', '空白のみ');
  equal(engine.normalizeItemName('＊＊'), '＊＊', '記号だけなら元の値を返す');
  equal(engine.normalizeItemName('10個'), '10個', '数量だけなら元の値を返す');
  equal(engine.normalizeItemName(null), '', 'null');
  equal(engine.normalizeItemName(undefined), '', 'undefined');
});

test('51. 英字は小文字に揃える', () => {
  equal(engine.normalizeItemName('Milk'), engine.normalizeItemName('milk'), '大文字小文字');
  equal(engine.normalizeItemName('ＭＩＬＫ'), 'milk', '全角英字');
});

const alias = (aliasKey, canonicalName) => ({
  aliasKey,
  canonicalName,
  canonicalKey: engine.normalizeItemName(canonicalName)
});

test('52. resolveItemKey — 辞書にあれば寄せ先のキーを返す', () => {
  const aliases = [alias('緑豆もやし', 'もやし')];
  equal(engine.resolveItemKey({ name: '緑豆もやし' }, aliases), 'もやし', 'ヒット');
  equal(engine.resolveItemKey({ name: 'ﾘｮｸﾄﾞｳﾓﾔｼ' }, aliases), 'りょくどうもやし', '辞書に無いものは正規化キーのまま');
});

test('53. resolveItemKey — 辞書が空・未指定でも落ちない', () => {
  equal(engine.resolveItemKey({ name: 'もやし' }, []), 'もやし', '空配列');
  equal(engine.resolveItemKey({ name: 'もやし' }, null), 'もやし', 'null');
  equal(engine.resolveItemKey({ name: 'もやし' }, undefined), 'もやし', 'undefined');
  equal(engine.resolveItemKey({}, []), '', '名前が無い');
});

test('54. resolveItemKey — 連鎖は1段しか辿らない', () => {
  /* A→B→C と繋がっていても B で止める。多段を辿ると循環で無限ループになるため。 */
  const aliases = [alias('a', 'b'), alias('b', 'c')];
  equal(engine.resolveItemKey({ name: 'a' }, aliases), 'b', 'aはbまで');
  equal(engine.resolveItemKey({ name: 'b' }, aliases), 'c', 'bはcまで');
});

test('55. resolveItemKey — 循環参照があっても落ちない', () => {
  const aliases = [alias('a', 'b'), alias('b', 'a')];
  equal(engine.resolveItemKey({ name: 'a' }, aliases), 'b', 'a→b');
  equal(engine.resolveItemKey({ name: 'b' }, aliases), 'a', 'b→a');
});

test('56. resolveItemKey — name が無ければ rawName を使う', () => {
  equal(engine.resolveItemKey({ rawName: 'ﾓﾔｼ' }, []), 'もやし', 'rawNameへフォールバック');
});

test('57. 繰り返しリスト — 辞書で もやし と 緑豆もやし が1グループになる', () => {
  const items = [
    line({ name: 'もやし', amount: 200, outcome: 'expired' }),
    line({ name: '緑豆もやし', amount: 200, outcome: 'discarded' }),
    line({ name: 'ﾓﾔｼ', amount: 200, outcome: 'consumed' })
  ];
  const withoutAliases = engine.repeatedWasteRanking(items);
  assert(withoutAliases.length >= 2, `辞書なしでは分かれる: ${withoutAliases.length}件`);

  const ranked = engine.repeatedWasteRanking(items, { aliases: [alias('緑豆もやし', 'もやし')] });
  equal(ranked.length, 1, '1グループにまとまる');
  equal(ranked[0].purchaseCount, 3, '購入回数');
  equal(ranked[0].wasteCount, 2, '廃棄回数');
  equal(ranked[0].wasteTotal, 400, '廃棄額');
});

test('58. 繰り返しリスト — 表示名は辞書の canonicalName になる', () => {
  const items = [
    line({ name: '緑豆もやし', amount: 100, outcome: 'expired' }),
    line({ name: '緑豆もやし', amount: 100, outcome: 'expired' }),
    line({ name: 'もやし', amount: 100, outcome: 'expired' })
  ];
  const ranked = engine.repeatedWasteRanking(items, { aliases: [alias('緑豆もやし', 'もやし')] });
  equal(ranked.length, 1, '1グループ');
  equal(ranked[0].name, 'もやし', '出現回数が多いのは緑豆もやしだが、辞書の名前が勝つ');
});

test('59. 繰り返しリスト — 辞書が無ければ最も多い表記を表示名にする', () => {
  const items = [
    line({ rawName: 'ﾓﾔｼ', name: 'もやし', amount: 100, outcome: 'expired' }),
    line({ rawName: 'ﾓﾔｼ', name: 'もやし', amount: 100, outcome: 'expired' }),
    line({ rawName: 'モヤシ', name: 'もやし', amount: 100, outcome: 'expired' })
  ];
  const ranked = engine.repeatedWasteRanking(items);
  equal(ranked[0].name, 'ﾓﾔｼ', '最頻の rawName');
});

test('60. 繰り返しリスト — aliases 未指定でも従来どおり動く（後方互換）', () => {
  const items = [
    line({ name: 'もやし', amount: 200, outcome: 'expired' }),
    line({ name: '牛乳', amount: 300, outcome: 'discarded' }),
    line({ name: '牛乳', amount: 300, outcome: 'expired' })
  ];
  const ranked = engine.repeatedWasteRanking(items);
  equal(ranked.length, 2, '2グループ');
  equal(ranked[0].name, '牛乳', '廃棄回数の多い順');
  equal(ranked[0].wasteCount, 2, '牛乳の廃棄回数');
  equal(ranked[1].name, 'もやし', '2位');
});

test('61. 繰り返しリスト — 辞書を Map / オブジェクトで渡しても動く', () => {
  const items = [
    line({ name: '緑豆もやし', amount: 100, outcome: 'expired' }),
    line({ name: 'もやし', amount: 100, outcome: 'expired' })
  ];
  const entry = alias('緑豆もやし', 'もやし');
  equal(engine.repeatedWasteRanking(items, { aliases: new Map([[entry.aliasKey, entry]]) }).length, 1, 'Map');
  equal(engine.repeatedWasteRanking(items, { aliases: { [entry.aliasKey]: entry } }).length, 1, 'オブジェクト');
});

test('62. 辞書の壊れた行は黙って無視する', () => {
  const items = [line({ name: 'もやし', amount: 100, outcome: 'expired' })];
  const broken = [null, {}, { aliasKey: '' }, { canonicalName: 'x' }, 'ごみ', 42];
  const ranked = engine.repeatedWasteRanking(items, { aliases: broken });
  equal(ranked.length, 1, '落ちずに集計できる');
  equal(ranked[0].name, 'もやし', '表示名');
});

test('63. rules と実装のズレ防止 — itemAliases のフィールドが一致する', () => {
  const rulesBlock = RULES.slice(RULES.indexOf('match /itemAliases/'));
  const allowed = rulesBlock.match(/hasOnly\(\[([\s\S]*?)\]\)/)[1]
    .split(',').map(item => item.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const syncBlock = SYNC.slice(SYNC.indexOf('const ITEM_ALIAS_FIELDS'));
  const declared = syncBlock.slice(0, syncBlock.indexOf('};'))
    .match(/^\s{2}([A-Za-z]+):/gm).map(item => item.trim().replace(':', ''));
  declared.forEach(field => assert(allowed.includes(field), `${field} が rules で許可されている`));
  allowed.forEach(field => assert(declared.includes(field), `${field} が firebase-sync で定義されている`));
});

if (!failures.length) { console.log(JSON.stringify({ suite: 'receipt', total, passed: total, failed: 0 })); process.exit(0); }
console.log(JSON.stringify({ suite: 'receipt', total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
process.exit(1);
