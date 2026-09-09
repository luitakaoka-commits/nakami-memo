/**
 * カード利用のお知らせメール → Firestore 取込候補
 *
 * 設計方針
 *  - 本文の全文、カード番号、口座番号、認証コードは保存もログ出力もしない。
 *  - 解析できたものだけを構造化して保存し、確信が持てないものは needs_review にする。
 *  - 取り込んだ時点では正式な取引にしない。Webアプリでユーザーが承認して初めて取引になる。
 *  - fingerprint を Firestore のドキュメントIDに使い、同じメールを二重に登録しない。
 *
 * 認証について
 *  パスワードもAPIキーも保存しない。スクリプトを実行するGoogleアカウント自身の
 *  OAuthトークン（ScriptApp.getOAuthToken）でFirestoreへアクセスする。
 *  そのため、取り込み専用のFirebaseユーザーを作る必要はない。
 *
 * スクリプトプロパティ（すべて任意。秘密情報は一つも無い）
 *   PROJECT_ID    既定 'cash-manege'
 *   WORKSPACE_ID  未設定なら自動検出する（workspaceが1つだけのとき）
 *   GMAIL_QUERY   既定は下記 DEFAULT_QUERY
 */

var DEFAULT_QUERY = 'newer_than:7d (subject:(利用 OR ご利用 OR 速報 OR お知らせ) OR from:(jcb.co.jp OR vpass.ne.jp OR smbc-card.com OR 01epos.jp OR eposcard.co.jp OR rakuten-card.co.jp OR paypay-card.co.jp OR aeon.co.jp OR saisoncard.co.jp OR cr.mufg.jp))';
var PROCESSED_LABEL = 'CashManege/取込済み';
var MAX_THREADS = 50;

/** 定期実行のエントリポイント。時間主導型トリガーでこの関数を呼ぶ。 */
function importCardMails() {
  var config = readConfig();
  var label = getOrCreateLabel(PROCESSED_LABEL);
  var query = (config.gmailQuery || DEFAULT_QUERY) + ' -label:"' + PROCESSED_LABEL + '"';
  var threads = GmailApp.search(query, 0, MAX_THREADS);

  var summary = { scanned: 0, created: 0, duplicated: 0, needsReview: 0, failed: 0 };
  if (!threads.length) {
    Logger.log(JSON.stringify(summary));
    return summary;
  }

  var token = fetchAccessToken();

  for (var t = 0; t < threads.length; t += 1) {
    var messages = threads[t].getMessages();
    var handled = true;
    for (var m = 0; m < messages.length; m += 1) {
      summary.scanned += 1;
      try {
        var candidate = buildCandidate(messages[m]);
        if (!candidate) continue;
        if (candidate.status === 'needs_review') summary.needsReview += 1;
        var result = saveCandidate(config, token, candidate);
        if (result === 'created') summary.created += 1;
        else if (result === 'duplicate') summary.duplicated += 1;
      } catch (error) {
        handled = false;
        summary.failed += 1;
        // 本文は出力しない。原因の特定に必要な最小限だけ残す。
        Logger.log('取り込みに失敗: ' + error.message);
      }
    }
    if (handled) threads[t].addLabel(label);
  }

  Logger.log(JSON.stringify(summary));
  return summary;
}

/** 1通のメールから取込候補を組み立てる。保存してよい項目だけを返す。 */
function buildCandidate(message) {
  var sender = String(message.getFrom() || '');
  var subject = String(message.getSubject() || '');
  var body = message.getPlainBody() || '';
  var receivedAt = message.getDate();

  var parsed = parseCardMail({ sender: sender, subject: subject, body: body, receivedAt: receivedAt });
  if (!parsed) return null;

  var usedDate = parsed.usedDate || formatDate(receivedAt);
  var amount = parsed.amount === null ? 0 : parsed.amount;
  var status = parsed.confident && amount > 0 ? 'pending' : 'needs_review';

  var candidate = {
    sourcePackage: extractSenderDomain(sender),
    sourceLabel: parsed.issuerLabel || extractSenderDomain(sender),
    detectedAt: receivedAt.toISOString(),
    usedDate: usedDate,
    amount: amount,
    cardHint: parsed.cardHint || '',
    merchant: parsed.merchant || '',
    type: parsed.type || 'unknown',
    status: status,
    note: parsed.note || '',
    createdAt: new Date().toISOString(),
    createdBy: 'gas-card-mail-import'
  };
  candidate.fingerprint = buildFingerprint(candidate, subject);
  return candidate;
}

/**
 * 重複判定用のfingerprint。
 * 通知元・金額・利用日・種別・件名の正規化値から作る。
 * Firestore のドキュメントIDとして使うため、同じメールが再送されても1件しか作られない。
 */
function buildFingerprint(candidate, subject) {
  var normalizedSubject = String(subject || '')
    .replace(/[\s　]+/g, '')
    .replace(/[0-9０-９]/g, '#')
    .slice(0, 60);
  var seed = [
    candidate.sourcePackage,
    String(candidate.amount),
    candidate.usedDate,
    candidate.type,
    normalizedSubject
  ].join('|');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i += 1) {
    var value = (digest[i] + 256) % 256;
    hex += (value < 16 ? '0' : '') + value.toString(16);
  }
  return hex.slice(0, 40);
}

/* ---------- Firebase ---------- */

var DEFAULT_PROJECT_ID = 'cash-manege';

function readConfig() {
  var properties = PropertiesService.getScriptProperties();
  var config = {
    projectId: properties.getProperty('PROJECT_ID') || DEFAULT_PROJECT_ID,
    workspaceId: properties.getProperty('WORKSPACE_ID') || '',
    gmailQuery: properties.getProperty('GMAIL_QUERY') || ''
  };
  if (!config.workspaceId) config.workspaceId = discoverWorkspaceId(config);
  return config;
}

/**
 * このスクリプトを実行しているGoogleアカウント自身のアクセストークンを返す。
 * パスワードもAPIキーも保存しない。
 */
function fetchAccessToken() {
  return ScriptApp.getOAuthToken();
}

/**
 * workspaceが1つだけならIDを自動検出する。
 * 複数ある場合は、どれを使うかをスクリプトプロパティ WORKSPACE_ID で指定してもらう。
 */
function discoverWorkspaceId(config) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('workspaceId');
  if (cached) return cached;

  var url = 'https://firestore.googleapis.com/v1/projects/' + config.projectId
    + '/databases/(default)/documents/workspaces?pageSize=20&mask.fieldPaths=name';
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + fetchAccessToken() }
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('workspaceの一覧を取得できません (HTTP ' + response.getResponseCode() + ') '
      + String(response.getContentText()).slice(0, 500));
  }

  var documents = JSON.parse(response.getContentText()).documents || [];
  var ids = documents.map(function (item) { return String(item.name).split('/').pop(); });
  if (ids.length === 0) throw new Error('workspaceが見つかりません。先にWebアプリへログインしてください。');
  if (ids.length > 1) {
    throw new Error('workspaceが複数あります。スクリプトプロパティ WORKSPACE_ID に次のいずれかを設定してください: ' + ids.join(', '));
  }
  cache.put('workspaceId', ids[0], 21600);
  return ids[0];
}

/**
 * 取込候補を保存する。
 * fingerprint をドキュメントIDにしているため、同じ内容は二重に作られない。
 */
function saveCandidate(config, token, candidate) {
  var base = 'https://firestore.googleapis.com/v1/projects/' + config.projectId
    + '/databases/(default)/documents/workspaces/' + config.workspaceId + '/importCandidates';
  var url = base + '?documentId=' + encodeURIComponent(candidate.fingerprint);

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ fields: toFirestoreFields(candidate) })
  });

  var code = response.getResponseCode();
  if (code === 200) return 'created';
  if (code === 409) return 'duplicate';
  throw new Error('Firestoreへ保存できません (HTTP ' + code + ')');
}

/** JSONをFirestoreのフィールド表現へ変換する */
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

/* ---------- 共通ヘルパ ---------- */

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function extractSenderDomain(sender) {
  var match = String(sender).match(/@([A-Za-z0-9.\-]+)/);
  return match ? match[1].toLowerCase() : 'unknown';
}

function formatDate(date) {
  var year = date.getFullYear();
  var month = ('0' + (date.getMonth() + 1)).slice(-2);
  var day = ('0' + date.getDate()).slice(-2);
  return year + '-' + month + '-' + day;
}

/**
 * 最初に1回だけ実行する確認用の関数。
 * 権限の承認、Firestoreへの接続、workspaceの自動検出、Gmail検索の当たり具合をまとめて確認する。
 * Firestoreへは書き込まない。
 */
function setup() {
  var report = { firestore: '', workspaceId: '', gmailMatched: 0, parsed: [] };

  var config = readConfig();
  report.firestore = 'OK（プロジェクト ' + config.projectId + '）';
  report.workspaceId = config.workspaceId;

  var query = (config.gmailQuery || DEFAULT_QUERY) + ' -label:"' + PROCESSED_LABEL + '"';
  var threads = GmailApp.search(query, 0, 10);
  report.gmailMatched = threads.length;

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      var candidate = buildCandidate(message);
      if (!candidate) return;
      // 本文は含めない
      report.parsed.push({
        差出人: candidate.sourceLabel,
        利用日: candidate.usedDate,
        金額: candidate.amount,
        カード: candidate.cardHint,
        利用先: candidate.merchant,
        種別: candidate.type,
        状態: candidate.status
      });
    });
  });

  Logger.log(JSON.stringify(report, null, 2));
  Logger.log(report.gmailMatched === 0
    ? '該当メールが0件でした。カード会社の利用速報メールが有効か、GMAIL_QUERY の条件を確認してください。'
    : '解析結果が正しければ、importCardMails を1回実行してからトリガーを設定してください。');
  return report;
}

/**
 * 解析結果の確認用。Firestoreへは書き込まない。
 * 取込済みラベルが付いたメールも対象にするため、解析ルールを直したあとの確認に使える。
 */
function dryRun() {
  var config = readConfig();
  var threads = GmailApp.search(config.gmailQuery || DEFAULT_QUERY, 0, 20);
  var results = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      var candidate = buildCandidate(message);
      if (!candidate) return;
      // 本文は含めない
      results.push({
        差出人: candidate.sourceLabel,
        利用日: candidate.usedDate,
        金額: candidate.amount,
        カード: candidate.cardHint,
        利用先: candidate.merchant,
        種別: candidate.type,
        状態: candidate.status,
        メモ: candidate.note
      });
    });
  });
  Logger.log(JSON.stringify({ 件数: results.length, 明細: results }, null, 2));
  return results;
}
