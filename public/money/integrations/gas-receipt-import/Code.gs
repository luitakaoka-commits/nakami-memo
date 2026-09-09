/**
 * レシート写真の取込。
 *
 *   Googleドライブの「レシート」フォルダ
 *     → Gemini で明細つきJSONに（だめなら Drive OCR で店名・日付・合計だけ）
 *     → 検算して怪しければ needs_review に落とす
 *     → Firestore の receipts / receiptItems へ status: 'pending' で保存
 *     → アプリの「記録 → レシート」タブで確認・修正して確定
 *
 * 同じフォルダにある gas-card-mail-import と同じ考え方で作っている。
 *   - Firestore へは ScriptApp.getOAuthToken() で書く。APIキーもサービスアカウント鍵も持たない
 *   - ドキュメントIDを内容から決めて、二重取込を起こさない
 *   - workspace 本体の state は触らない。サブコレクションだけを書く
 *
 * 唯一の秘密情報は Gemini のAPIキーで、スクリプトプロパティに置く。
 */

/* ============================================================
 * 1. 純粋な処理（ネットワークもGASのAPIも使わない。Nodeからテストできる）
 * ============================================================ */

/** アプリ側 finance-engine.js の RECEIPT_CATEGORIES と同じ並び。ズレるとルールに弾かれる。 */
var RECEIPT_CATEGORIES = [
  '食品', '飲料', '調味料', '日用品', '消耗品',
  '外食', '交通', 'サービス', '書籍', '衣料', '雑貨', 'その他'
];

/** ふりかえりで結末を聞くカテゴリ。使い切れたかどうかで無駄が決まるものだけ。 */
var OUTCOME_TRACKED_CATEGORIES = ['食品', '飲料', '調味料', '日用品', '消耗品'];

/** 高額な買い物は、カテゴリに関わらず結末を確認する価値がある。 */
var OUTCOME_TRACK_AMOUNT = 5000;

/** 明細合計と合計金額のズレをどこまで許すか。端数処理の差を1円だけ見逃す。 */
var TOTAL_TOLERANCE_YEN = 1;

function toNumber(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

function toText(value) {
  return value === null || value === undefined ? '' : String(value);
}

/** アプリ側の classifyOutcomeTracked と同じ判定。 */
function classifyOutcomeTracked(category, amount) {
  if (Math.abs(toNumber(amount)) >= OUTCOME_TRACK_AMOUNT) return true;
  return OUTCOME_TRACKED_CATEGORIES.indexOf(toText(category)) !== -1;
}

/** 許可されたカテゴリに寄せる。知らない値が来たら「その他」。 */
function safeCategory(value) {
  return RECEIPT_CATEGORIES.indexOf(toText(value)) === -1 ? 'その他' : toText(value);
}

/** YYYY-MM-DD かどうか。年月日として成立しないものは弾く。 */
function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toText(value))) return false;
  var parts = toText(value).split('-');
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Gemini（または Drive OCR）の読み取り結果を、Firestore に入れる形へ整える。
 * フィールドの並びは firestore.rules の hasOnly と1対1にすること。
 */
function buildReceiptRecord(parsed, meta) {
  var source = parsed || {};
  var now = meta.now;

  var items = (source.items || []).filter(function (item) {
    // 金額も名前も無い行は、読み取りのゴミなので落とす
    return item && (toText(item.rawName) !== '' || toNumber(item.amount) !== 0);
  }).map(function (item, index) {
    var category = safeCategory(item.category);
    var amount = Math.round(toNumber(item.amount));
    return {
      receiptId: meta.receiptId,
      lineNo: index + 1,
      rawName: toText(item.rawName),
      // 表記ゆれの正規化はアプリ側（finance-engine.js）が読み取り時に行う。
      // ここで独自に正規化すると2箇所に同じ規則ができて必ずズレる。
      name: toText(item.rawName),
      quantity: toNumber(item.quantity) || 1,
      unit: toText(item.unit),
      unitPrice: Math.round(toNumber(item.unitPrice)),
      amount: amount,
      category: category,
      outcomeTracked: classifyOutcomeTracked(category, amount),
      outcome: 'in_stock',
      outcomeAt: '',
      outcomeReason: '',
      wasteAmount: 0,
      note: '',
      createdAt: now,
      updatedAt: now
    };
  });

  var receipt = {
    storeName: toText(source.storeName),
    purchasedAt: isDateString(source.purchasedAt) ? toText(source.purchasedAt) : '',
    total: Math.round(toNumber(source.total)),
    taxTotal: Math.round(toNumber(source.taxTotal)),
    paymentMethod: ['cash', 'card', 'emoney', 'unknown'].indexOf(toText(source.paymentMethod)) === -1
      ? 'unknown' : toText(source.paymentMethod),
    transactionId: '',
    source: meta.source,
    status: 'pending',
    note: '',
    createdAt: now,
    updatedAt: now,
    createdBy: meta.createdBy
  };

  return { receipt: receipt, items: items };
}

/**
 * 検算。少しでも怪しければ needs_review に落として、人の目を通す。
 * 自動で正式データにはしない。
 */
function reviewReceipt(record, options) {
  var receipt = record.receipt;
  var items = record.items;
  var reasons = [];

  if (!receipt.purchasedAt) reasons.push('購入日を読み取れませんでした');
  if (!receipt.storeName) reasons.push('店名を読み取れませんでした');
  if (receipt.total <= 0) reasons.push('合計金額を読み取れませんでした');
  if (!items.length) reasons.push('明細を読み取れませんでした');

  if (items.length && receipt.total > 0) {
    var sum = items.reduce(function (acc, item) { return acc + item.amount; }, 0);
    var diff = Math.abs(sum - receipt.total);
    if (diff > TOTAL_TOLERANCE_YEN) {
      reasons.push('明細の合計 ' + sum + '円 が合計金額 ' + receipt.total + '円 と合っていません');
    }
  }

  var confidence = options && options.confidence;
  if (typeof confidence === 'number' && confidence < 0.6) {
    reasons.push('読み取りの自信度が低いです');
  }

  receipt.status = reasons.length ? 'needs_review' : 'pending';
  receipt.note = reasons.join(' / ');
  return record;
}

/** JSONをFirestoreのフィールド表現へ変換する（gas-card-mail-import と同じ形）。 */
function toFirestoreFields(object) {
  var fields = {};
  Object.keys(object).forEach(function (key) {
    var value = object[key];
    if (value === null || value === undefined) return;
    if (typeof value === 'number') fields[key] = { doubleValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else fields[key] = { stringValue: String(value) };
  });
  return fields;
}

/* ============================================================
 * 2. GAS から動かす部分
 * ============================================================ */

var DEFAULT_PROJECT_ID = 'cash-manege';
var DEFAULT_FOLDER_NAME = 'レシート';
var DONE_FOLDER_NAME = '取込済み';
var DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
var MAX_FILES_PER_RUN = 10;

function readConfig() {
  var properties = PropertiesService.getScriptProperties();
  return {
    projectId: properties.getProperty('FIRESTORE_PROJECT_ID') || DEFAULT_PROJECT_ID,
    workspaceId: properties.getProperty('WORKSPACE_ID') || '',
    folderName: properties.getProperty('RECEIPT_FOLDER_NAME') || DEFAULT_FOLDER_NAME,
    geminiApiKey: properties.getProperty('GEMINI_API_KEY') || '',
    // モデルは世代が上がるので差し替えられるようにしておく。
    // 例: gemini-2.5-flash / gemini-3.5-flash-lite / gemini-3.8-flash
    geminiModel: properties.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL
  };
}

/** 15分おきに走る本体。 */
function importReceipts() {
  var config = readConfig();
  if (!config.workspaceId) throw new Error('WORKSPACE_ID が未設定です。setup() を実行してください。');

  var token = ScriptApp.getOAuthToken();
  var folder = findFolder(config.folderName);
  if (!folder) throw new Error('「' + config.folderName + '」フォルダが見つかりません。setup() を実行してください。');
  var doneFolder = ensureChildFolder(folder, DONE_FOLDER_NAME);

  var summary = { seen: 0, imported: 0, duplicate: 0, needsReview: 0, failed: 0 };
  var files = folder.getFiles();

  while (files.hasNext() && summary.seen < MAX_FILES_PER_RUN) {
    var file = files.next();
    if (!/^image\//.test(file.getMimeType())) continue;
    summary.seen += 1;

    try {
      var result = processFile(file, config, token);
      if (result === 'duplicate') summary.duplicate += 1;
      else {
        summary.imported += 1;
        if (result === 'needs_review') summary.needsReview += 1;
      }
      // 取り込めたら別フォルダへ移す。次回以降ダウンロードし直さないため。
      file.moveTo(doneFolder);
    } catch (error) {
      summary.failed += 1;
      Logger.log('取込に失敗: ' + file.getName() + ' / ' + error);
      // 失敗したファイルは動かさない。原因を直せば次回また拾える。
    }
  }

  Logger.log(JSON.stringify(summary));
  return summary;
}

/** 画像1枚を処理する。既に取り込み済みなら 'duplicate' を返す。 */
function processFile(file, config, token) {
  var receiptId = receiptIdOf(file.getId());
  var now = new Date().toISOString();

  var parsed = parseReceiptWithGemini(file.getBlob(), config);
  var source = 'gemini';
  if (!parsed) {
    parsed = parseReceiptWithDriveOcr(file);
    source = 'drive-ocr';
  }
  if (!parsed) throw new Error('画像を読み取れませんでした');

  var record = buildReceiptRecord(parsed, {
    receiptId: receiptId,
    now: now,
    source: source,
    createdBy: 'gas-receipt-import'
  });
  reviewReceipt(record, { confidence: parsed.confidence });

  var written = saveReceipt(config, token, receiptId, record);
  if (written === 'duplicate') return 'duplicate';
  return record.receipt.status;
}

/**
 * ドキュメントIDを DriveのファイルID から決める。
 * 同じ写真を2回入れても1件しか作られない。
 */
function receiptIdOf(fileId) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, fileId, Utilities.Charset.UTF_8);
  return digest.slice(0, 12).map(function (byte) {
    return ('0' + (byte & 0xff).toString(16)).slice(-2);
  }).join('');
}

/** レシート1件と明細行をまとめて書く。既にあれば 'duplicate'。 */
function saveReceipt(config, token, receiptId, record) {
  var base = 'https://firestore.googleapis.com/v1/projects/' + config.projectId
    + '/databases/(default)/documents/workspaces/' + config.workspaceId;

  var response = UrlFetchApp.fetch(base + '/receipts?documentId=' + encodeURIComponent(receiptId), {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ fields: toFirestoreFields(record.receipt) })
  });

  var code = response.getResponseCode();
  if (code === 409) return 'duplicate';
  if (code !== 200) throw new Error('レシートを保存できません (HTTP ' + code + '): ' + response.getContentText().slice(0, 200));

  record.items.forEach(function (item) {
    // 明細のIDもレシートIDと行番号から決める。取込をやり直しても増殖しない。
    var lineId = receiptId + '-' + ('000' + item.lineNo).slice(-3);
    var itemResponse = UrlFetchApp.fetch(base + '/receiptItems?documentId=' + encodeURIComponent(lineId), {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ fields: toFirestoreFields(item) })
    });
    var itemCode = itemResponse.getResponseCode();
    if (itemCode !== 200 && itemCode !== 409) {
      throw new Error('明細を保存できません (HTTP ' + itemCode + '): ' + itemResponse.getContentText().slice(0, 200));
    }
  });

  return 'created';
}

/* ---------- Drive OCR（Geminiが使えないときの保険） ---------- */

/**
 * Drive の Googleドキュメント変換で文字だけ取り出す。
 * 明細の品名と金額の対応づけまでは無理なので、店名・日付・合計だけ拾って
 * needs_review で登録する。明細は人が手で足す。
 */
function parseReceiptWithDriveOcr(file) {
  var docId = null;
  try {
    var converted = Drive.Files.copy(
      { title: 'ocr-' + file.getId(), mimeType: MimeType.GOOGLE_DOCS },
      file.getId(),
      { ocr: true, ocrLanguage: 'ja' }
    );
    docId = converted.id;
    var text = DocumentApp.openById(docId).getBody().getText();
    return {
      storeName: guessStoreName(text),
      purchasedAt: guessPurchasedAt(text),
      total: guessTotal(text),
      taxTotal: 0,
      paymentMethod: 'unknown',
      confidence: 0.3,
      items: []
    };
  } catch (error) {
    Logger.log('Drive OCR も失敗しました: ' + error);
    return null;
  } finally {
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (ignored) {} }
  }
}

/** OCRテキストの先頭のほうにある、それらしい行を店名とみなす。 */
function guessStoreName(text) {
  var lines = toText(text).split('\n').map(function (line) { return line.trim(); })
    .filter(function (line) { return line.length >= 2 && line.length <= 30; });
  for (var i = 0; i < Math.min(lines.length, 5); i++) {
    if (!/^[\d\s\-\/:.,¥￥*]+$/.test(lines[i])) return lines[i];
  }
  return '';
}

/** 日付らしき並びを YYYY-MM-DD にする。 */
function guessPurchasedAt(text) {
  var match = toText(text).match(/(20\d{2})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})/);
  if (!match) return '';
  return match[1] + '-' + ('0' + match[2]).slice(-2) + '-' + ('0' + match[3]).slice(-2);
}

/** 「合計」の近くにある一番大きい金額を合計とみなす。 */
function guessTotal(text) {
  var lines = toText(text).split('\n');
  var best = 0;
  lines.forEach(function (line) {
    if (!/合\s*計|お会計|税込/.test(line)) return;
    var numbers = line.replace(/,/g, '').match(/\d+/g) || [];
    numbers.forEach(function (value) {
      var n = Number(value);
      if (n > best && n < 1000000) best = n;
    });
  });
  return best;
}

/* ---------- フォルダ ---------- */

function findFolder(name) {
  var folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : null;
}

function ensureChildFolder(parent, name) {
  var children = parent.getFoldersByName(name);
  return children.hasNext() ? children.next() : parent.createFolder(name);
}

/* ---------- 初期設定と試し実行 ---------- */

/**
 * 一度だけ実行する。フォルダを作り、15分おきのトリガーを仕掛ける。
 * WORKSPACE_ID と GEMINI_API_KEY は先にスクリプトプロパティへ入れておくこと。
 */
function setup() {
  var config = readConfig();
  var messages = [];

  var folder = findFolder(config.folderName) || DriveApp.createFolder(config.folderName);
  ensureChildFolder(folder, DONE_FOLDER_NAME);
  messages.push('フォルダ: ' + folder.getName() + ' (' + folder.getId() + ')');

  if (!config.workspaceId) messages.push('⚠ WORKSPACE_ID が未設定です（アプリの設定画面で確認できます）');
  if (!config.geminiApiKey) messages.push('⚠ GEMINI_API_KEY が未設定です（Drive OCR だけで動きます）');

  var exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'importReceipts';
  });
  if (!exists) {
    ScriptApp.newTrigger('importReceipts').timeBased().everyMinutes(15).create();
    messages.push('15分おきのトリガーを作成しました');
  } else {
    messages.push('トリガーは既にあります');
  }

  Logger.log(messages.join('\n'));
  return messages;
}

/** 保存せずに、1枚だけ読み取り結果を見る。プロンプトを調整するとき用。 */
function dryRun() {
  var config = readConfig();
  var folder = findFolder(config.folderName);
  if (!folder) throw new Error('フォルダがありません');
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (!/^image\//.test(file.getMimeType())) continue;
    var parsed = parseReceiptWithGemini(file.getBlob(), config) || parseReceiptWithDriveOcr(file);
    var record = buildReceiptRecord(parsed || {}, {
      receiptId: 'dry-run', now: new Date().toISOString(),
      source: 'manual', createdBy: 'dry-run'
    });
    reviewReceipt(record, { confidence: parsed && parsed.confidence });
    Logger.log(file.getName() + '\n' + JSON.stringify(record, null, 2));
    return record;
  }
  Logger.log('画像がありません');
  return null;
}
