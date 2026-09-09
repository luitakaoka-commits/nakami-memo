/**
 * カード会社ごとの解析ルール。
 *
 * 実際に届いたメールの構造に合わせて作ってある。
 * 未対応の差出人でも汎用ルールで拾い、確信が持てないものは needs_review に倒す。
 * 新しいカード会社を足すときは ISSUERS に1件追加するだけでよい。
 *
 * 実データで確認した構造
 *   JCB          【ご利用日時(日本時間)】 2026/08/24 23:09
 *                【ご利用金額】 279円
 *                【ご利用先】 ローソン
 *                カード名称 ： 【OS】ＪＣＢカードＷ　ＮＬ
 *   三井住友カード  ご利用日時：2026/08/23 15:03
 *                セブン－イレブン（買物）  145円      ← 金額にラベルが無い
 *                三井住友カードＶＩＳＡ（ＮＬ）についてカードの利用内容をお知らせします。
 */

var ISSUERS = [
  { domain: 'jcb.co.jp', label: 'JCB' },
  // 三井住友カードの利用通知は smbc-card.com ではなく vpass.ne.jp から届く
  { domain: 'vpass.ne.jp', label: '三井住友カード', cardHint: /(三井住友カード[^\n]{1,14}?)について/ },
  { domain: 'smbc-card.com', label: '三井住友カード', cardHint: /(三井住友カード[^\n]{1,14}?)について/ },
  // エポスカードは 01epos.jp から届く
  { domain: '01epos.jp', label: 'エポスカード' },
  { domain: 'eposcard.co.jp', label: 'エポスカード' },
  { domain: 'rakuten-card.co.jp', label: '楽天カード' },
  { domain: 'paypay-card.co.jp', label: 'PayPayカード' },
  { domain: 'saisoncard.co.jp', label: 'セゾンカード' },
  { domain: 'aeon.co.jp', label: 'イオンカード' },
  { domain: 'cr.mufg.jp', label: '三菱UFJカード' },
  { domain: 'mufg.jp', label: '三菱UFJカード' }
];

/** 金額表記。1,234円 / ¥1,234 / 1,234 JPY / 1234円 に対応する。 */
var AMOUNT_PATTERNS = [
  /[¥￥]\s*([0-9０-９,，]+)/g,
  /([0-9０-９,，]+)\s*円/g,
  /([0-9０-９,，]+)\s*JPY/gi
];

/** 「【ご利用金額】 279円」のように、金額そのものにラベルが付いている場合 */
var AMOUNT_LABEL_PATTERN = /【?\s*(?:ご利用金額|ご利用額|利用金額|ご請求金額|請求金額|お支払金額|支払金額|決済金額)\s*】?\s*[：:]?\s*[¥￥]?\s*([0-9,]+)\s*(?:円|JPY)?/;

/** 「【ご利用日時(日本時間)】」「ご利用日時：」のような利用日ラベル */
var USED_AT_LABEL_PATTERN = /【?\s*(?:ご利用日時|ご利用年月日|ご利用日|利用日時|利用日)\s*(?:\([^)\n]{0,12}\)|（[^）\n]{0,12}）)?\s*】?\s*[：:]?\s*/;

/** 「【ご利用先】 ローソン」のような利用先ラベル */
var MERCHANT_LABEL_PATTERN = /【?\s*(?:ご利用先|ご利用店舗|利用先|加盟店名|加盟店)\s*】?\s*[：:]?\s*([^\n]{1,40})/;

/** 「カード名称 ： …」のようなカード名ラベル */
var CARD_LABEL_PATTERN = /【?\s*(?:カード名称|カード名|ご利用カード|利用カード)\s*】?\s*[：:]\s*([^\n]{1,40})/;

/** 日付表記。2026/8/25 / 2026-08-25 / 2026年8月25日 / 08/25 に対応する。 */
var DATE_PATTERNS = [
  /(20[0-9]{2})[\/\-年]\s*([01]?[0-9])[\/\-月]\s*([0-3]?[0-9])/,
  /(?:^|[^0-9])([01]?[0-9])[\/\-月]\s*([0-3]?[0-9])日?/
];

var REFUND_WORDS = ['返金', 'ご返金', 'キャッシュバック'];
var CANCEL_WORDS = ['取消', 'お取消', 'キャンセル', '取り消し'];

/** 金額らしくない数字を拾わないよう、除外する行 */
var IGNORE_LINE_WORDS = ['ポイント', '残高', '利用可能枠', '限度額', '合計請求', '手数料率', '年会費', 'キャンペーン'];

/**
 * メール1通を解析する。
 * 戻り値: { amount, usedDate, cardHint, merchant, type, confident, issuerLabel, note } または null
 */
function parseCardMail(mail) {
  var text = normalizeText(mail.subject + '\n' + mail.body);
  var issuer = findIssuer(mail.sender);
  var type = detectType(text);

  var amounts = extractAmounts(text);
  var primary = findPrimaryAmount(text, issuer);
  var usedDate = extractUsedDate(text, mail.receivedAt);
  var cardHint = extractCardHint(text, issuer);
  var merchant = extractMerchant(text, primary);

  // カード利用のお知らせらしさが無いメールは候補にしない
  if (!issuer && amounts.length === 0 && !primary) return null;

  var amount = primary ? primary.value : (amounts.length ? amounts[0] : null);
  var note = '';
  var confident = true;

  if (amount === null) {
    confident = false;
    note = '金額を読み取れませんでした。Webアプリで入力してください。';
  } else if (primary && (primary.source === 'issuer' || primary.source === 'label')) {
    // 「ご利用金額」などのラベル付きで特定できた場合は、他に数字があっても確定してよい
    confident = true;
  } else if (primary && primary.source === 'afterDate' && issuer) {
    // 利用日時の直後に現れる金額。対応済みのカード会社に限り確定とする
    confident = true;
  } else if (amounts.length > 1) {
    confident = false;
    note = '金額が複数ありました（' + amounts.slice(0, 4).join('円 / ') + '円）。正しい金額を確認してください。';
  }

  if (!issuer) {
    confident = false;
    note = note || '未対応の差出人です。内容を確認してください。';
  }

  if (type === 'refund' || type === 'cancel') {
    confident = false;
    note = note || '返金・取消の可能性があります。対象の取引を確認してください。';
  }

  return {
    amount: amount,
    usedDate: usedDate,
    cardHint: cardHint,
    merchant: merchant,
    type: type,
    confident: confident,
    issuerLabel: issuer ? issuer.label : '',
    note: note
  };
}

/**
 * 「これが利用金額だ」と特定できる金額を探す。
 *  1. カード会社ごとの専用ルール
 *  2. 「ご利用金額」などのラベル付き
 *  3. 利用日時ラベルの直後に最初に現れる金額（三井住友のように金額にラベルが無い形式）
 */
function findPrimaryAmount(text, issuer) {
  if (issuer && issuer.amount) {
    var custom = text.match(issuer.amount);
    if (custom) return { value: toAmount(custom[1]), source: 'issuer', index: custom.index };
  }

  var labeled = text.match(AMOUNT_LABEL_PATTERN);
  if (labeled) return { value: toAmount(labeled[1]), source: 'label', index: labeled.index };

  var usedAt = text.match(USED_AT_LABEL_PATTERN);
  if (usedAt) {
    var offset = usedAt.index + usedAt[0].length;
    var after = text.slice(offset);
    var found = extractAmounts(after);
    if (found.length) return { value: found[0], source: 'afterDate', index: offset + after.indexOf(String(found[0])) };
  }
  return null;
}

function toAmount(value) {
  return Number(String(value).replace(/,/g, ''));
}

function findIssuer(sender) {
  var lower = String(sender || '').toLowerCase();
  for (var i = 0; i < ISSUERS.length; i += 1) {
    if (lower.indexOf(ISSUERS[i].domain) !== -1) return ISSUERS[i];
  }
  return null;
}

function detectType(text) {
  for (var i = 0; i < CANCEL_WORDS.length; i += 1) {
    if (text.indexOf(CANCEL_WORDS[i]) !== -1) return 'cancel';
  }
  for (var j = 0; j < REFUND_WORDS.length; j += 1) {
    if (text.indexOf(REFUND_WORDS[j]) !== -1) return 'refund';
  }
  if (text.indexOf('利用') !== -1) return 'purchase';
  return 'unknown';
}

/** 全角数字・空白を正規化する */
function normalizeText(text) {
  return String(text || '')
    .replace(/[０-９]/g, function (char) { return String.fromCharCode(char.charCodeAt(0) - 0xFEE0); })
    .replace(/[，]/g, ',')
    .replace(/\r/g, '');
}

/** 金額をすべて拾い、重複を除いて返す */
function extractAmounts(text) {
  var lines = String(text).split('\n').filter(function (line) {
    for (var i = 0; i < IGNORE_LINE_WORDS.length; i += 1) {
      if (line.indexOf(IGNORE_LINE_WORDS[i]) !== -1) return false;
    }
    return true;
  });
  var target = lines.join('\n');

  var found = [];
  AMOUNT_PATTERNS.forEach(function (pattern) {
    pattern.lastIndex = 0;
    var match = pattern.exec(target);
    while (match) {
      var value = toAmount(match[1]);
      if (value > 0 && value < 100000000 && found.indexOf(value) === -1) found.push(value);
      match = pattern.exec(target);
    }
  });
  return found;
}

/** 利用日を推定する。年が書かれていない場合は受信日の年を使う。 */
function extractUsedDate(text, receivedAt) {
  // 利用日ラベルがあれば、そこから後ろだけを見る
  var scope = text;
  var usedAt = text.match(USED_AT_LABEL_PATTERN);
  if (usedAt) scope = text.slice(usedAt.index + usedAt[0].length, usedAt.index + usedAt[0].length + 40);

  var full = scope.match(DATE_PATTERNS[0]) || text.match(DATE_PATTERNS[0]);
  if (full) return pad4(full[1]) + '-' + pad2(full[2]) + '-' + pad2(full[3]);

  var short = scope.match(DATE_PATTERNS[1]) || text.match(DATE_PATTERNS[1]);
  if (short) {
    var year = receivedAt.getFullYear();
    var month = Number(short[1]);
    var day = Number(short[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // 年末年始のまたぎを補正する（受信が1月で利用が12月など）
      if (receivedAt.getMonth() === 0 && month === 12) year -= 1;
      return pad4(year) + '-' + pad2(month) + '-' + pad2(day);
    }
  }
  return '';
}

/**
 * カード名の候補を取り出す。
 * カード番号そのものは保存しないため、下4桁も含めない。
 */
function extractCardHint(text, issuer) {
  if (issuer && issuer.cardHint) {
    var matched = text.match(issuer.cardHint);
    if (matched) return clean(matched[1] || matched[0]);
  }
  var labeled = text.match(CARD_LABEL_PATTERN);
  if (labeled) return clean(labeled[1]);
  return issuer ? issuer.label : '';
}

/**
 * 利用先（店舗名）を取り出す。
 * ラベルが無い形式では、金額の直前にある短い行を店舗名とみなす。
 */
function extractMerchant(text, primary) {
  var labeled = text.match(MERCHANT_LABEL_PATTERN);
  if (labeled) return clean(labeled[1]);

  if (primary && primary.index >= 0) {
    var before = text.slice(0, primary.index).split('\n');
    for (var i = before.length - 1; i >= 0 && i >= before.length - 3; i -= 1) {
      var line = clean(before[i]);
      // 数字だけの行・日付の行・空行は店舗名ではない
      if (!line || line.length > 40) continue;
      if (/^[0-9\/:\-\s]+$/.test(line)) continue;
      if (/[0-9]{4}[\/\-年]/.test(line)) continue;
      if (/^(ご利用内容|ご利用明細|お知らせ)$/.test(line)) continue;
      return line;
    }
  }
  return '';
}

function clean(value) {
  return String(value || '').replace(/[\s　]+/g, ' ').trim().slice(0, 40);
}

function pad2(value) { return ('0' + Number(value)).slice(-2); }
function pad4(value) { return String(Number(value)); }
