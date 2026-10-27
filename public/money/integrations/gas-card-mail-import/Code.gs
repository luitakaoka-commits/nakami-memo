/**
 * カード利用のお知らせメール → Firestore 取込候補
 *
 * 設計方針
 *  - 本文の全文、カード番号、口座番号、認証コードは保存もログ出力もしない。
 *  - 解析できたものだけを構造化して保存し、確信が持てないものは needs_review にする。
 *  - 取り込んだ時点では正式な取引にしない。Webアプリでユーザーが承認して初めて取引になる。
 *  - メール固有IDからFirestoreのドキュメントIDを作り、同じメールの再処理を防ぐ。
 *  - fingerprint は似た通知の警告に使う。同額同日の別の利用を勝手に消さない。
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
var MAX_MESSAGES = 50;

/** 定期実行のエントリポイント。時間主導型トリガーでこの関数を呼ぶ。 */
function importCardMails() {
  var summary = { scanned: 0, created: 0, duplicated: 0, needsReview: 0, failed: 0 };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { summary.skipped = true; return summary; }
  try {
    var properties = PropertiesService.getScriptProperties();
    var query = (properties.getProperty('GMAIL_QUERY') || DEFAULT_QUERY) + ' -label:"' + PROCESSED_LABEL + '"';
    var token = fetchAccessToken();
    var messageIds = searchMessageIds(query, token);
    if (!messageIds.length) { Logger.log(JSON.stringify(summary)); return summary; }
    var labelId = getOrCreateLabelId(PROCESSED_LABEL, token);
    var config = readConfig();
    for (var m = 0; m < messageIds.length; m += 1) {
      summary.scanned += 1;
      try {
        var message = readGmailMessage(messageIds[m], token);
        if (!message) throw new Error('メールを取得できません');
        var candidate = buildCandidate(message);
        if (candidate) {
          if (candidate.status === 'needs_review') summary.needsReview += 1;
          var result = saveCandidate(config, token, candidate, messageDocumentId(messageIds[m]));
          if (result === 'created') summary.created += 1;
          else if (result === 'duplicate') summary.duplicated += 1;
        }
        markMessageProcessed(messageIds[m], labelId, token);
      } catch (error) {
        summary.failed += 1;
        // 本文は出力しない。原因の特定に必要な最小限だけ残す。
        Logger.log('取り込みに失敗: ' + error.message);
      }
    }
    Logger.log(JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/** Gmail APIで未処理のメールを1通ずつ検索する。スレッド単位の検索は使わない。 */
function searchMessageIds(query, token, limit) {
  var url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + (limit || MAX_MESSAGES) + '&q=' + encodeURIComponent(query);
  var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } });
  if (response.getResponseCode() !== 200) throw new Error('Gmailの検索に失敗しました (HTTP ' + response.getResponseCode() + ')');
  return (JSON.parse(response.getContentText()).messages || []).map(function (message) { return message.id; });
}

/** gmail.modifyの範囲でラベルとメールを読む。本文は保存・ログ出力しない。 */
function getOrCreateLabelId(name, token) {
  var url = 'https://gmail.googleapis.com/gmail/v1/users/me/labels';
  var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } });
  if (response.getResponseCode() !== 200) throw new Error('Gmailラベルを取得できません (HTTP ' + response.getResponseCode() + ')');
  var labels = JSON.parse(response.getContentText()).labels || [];
  for (var i = 0; i < labels.length; i += 1) if (labels[i].name === name) return labels[i].id;
  response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ name: name }) });
  if (response.getResponseCode() !== 200) throw new Error('Gmailラベルを作成できません (HTTP ' + response.getResponseCode() + ')');
  return JSON.parse(response.getContentText()).id;
}

function readGmailMessage(messageId, token) {
  var url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(messageId) + '?format=full';
  var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } });
  if (response.getResponseCode() !== 200) throw new Error('メールを取得できません (HTTP ' + response.getResponseCode() + ')');
  var data = JSON.parse(response.getContentText());
  var payload = data.payload || {};
  var headers = payload.headers || [];
  function header(name) {
    var found = headers.filter(function (item) { return String(item.name || '').toLowerCase() === name; })[0];
    return found ? decodeMimeHeader(String(found.value || '')) : '';
  }
  function textParts(part) {
    if (!part) return [];
    var results = [];
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      var contentType = (part.headers || []).filter(function (item) { return String(item.name || '').toLowerCase() === 'content-type'; })[0];
      var charset = contentType && String(contentType.value || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i);
      var encoded = part.body.data;
      while (encoded.length % 4) encoded += '=';
      results.push(Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString(charset ? charset[1] : 'UTF-8'));
    }
    (part.parts || []).forEach(function (child) { results = results.concat(textParts(child)); });
    return results;
  }
  var receivedMillis = Number(data.internalDate);
  var receivedAt = new Date(receivedMillis);
  if (!receivedMillis || !Number.isFinite(receivedAt.getTime())) throw new Error('メールの受信日時を取得できません');
  var body = textParts(payload).join('\n');
  return { getFrom: function () { return header('from'); }, getSubject: function () { return header('subject'); },
    getPlainBody: function () { return body; }, getDate: function () { return receivedAt; } };
}

/** RFC 2047でエンコードされた件名や差出人を、判定前に元の文字へ戻す。 */
function decodeMimeHeader(value) {
  return String(value || '').replace(/(\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    function (whole, charset, mode, encoded) {
      try {
        var bytes;
        if (mode.toLowerCase() === 'b') {
          while (encoded.length % 4) encoded += '=';
          bytes = Utilities.base64Decode(encoded);
        } else {
          var value = encoded.replace(/_/g, ' ');
          bytes = [];
          for (var i = 0; i < value.length; i += 1) {
            if (value[i] === '=' && /^[0-9a-f]{2}$/i.test(value.slice(i + 1, i + 3))) {
              var byte = parseInt(value.slice(i + 1, i + 3), 16);
              bytes.push(byte > 127 ? byte - 256 : byte);
              i += 2;
            } else bytes.push(value.charCodeAt(i));
          }
        }
        return Utilities.newBlob(bytes).getDataAsString(charset);
      } catch (error) { return whole; }
    });
}

function markMessageProcessed(messageId, labelId, token) {
  var url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(messageId) + '/modify';
  var response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ addLabelIds: [labelId] })
  });
  if (response.getResponseCode() !== 200) throw new Error('処理済みラベルを付けられません (HTTP ' + response.getResponseCode() + ')');
}

function messageDocumentId(messageId) {
  return 'gm_' + digestHex('gmail-message:' + messageId).slice(0, 40);
}

/** 1通のメールから取込候補を組み立てる。保存してよい項目だけを返す。 */
function buildCandidate(message) {
  var sender = String(message.getFrom() || '');
  var subject = String(message.getSubject() || '');
  var body = message.getPlainBody() || '';
  var receivedAt = message.getDate();

  var parsed = parseCardMail({ sender: sender, subject: subject, body: body, receivedAt: receivedAt });
  if (!parsed) return null;

  var usedDate = parsed.usedDate || '';
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
  candidate.fingerprint = buildFingerprint(candidate, subject, formatDate(receivedAt));
  return candidate;
}

/**
 * 重複判定用のfingerprint。
 * 通知元・金額・利用日・種別・件名の正規化値から作る。
 * 異なるメールでも同じ値になりうるため、自動で捨てず、重複の可能性を表示する目印にする。
 */
function buildFingerprint(candidate, subject, fallbackDate) {
  var normalizedSubject = String(subject || '')
    .replace(/[\s　]+/g, '')
    .replace(/[0-9０-９]/g, '#')
    .slice(0, 60);
  var seed = [
    candidate.sourcePackage,
    String(candidate.amount),
    candidate.usedDate || fallbackDate || '',
    candidate.type,
    normalizedSubject
  ].join('|');
  return digestHex(seed).slice(0, 40);
}

function digestHex(seed) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i += 1) {
    var value = (digest[i] + 256) % 256;
    hex += (value < 16 ? '0' : '') + value.toString(16);
  }
  return hex;
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
 * メールIDから作ったドキュメントIDにより、同じメールの再処理を重複登録しない。
 */
function saveCandidate(config, token, candidate, documentId) {
  var base = 'https://firestore.googleapis.com/v1/projects/' + config.projectId
    + '/databases/(default)/documents/workspaces/' + config.workspaceId + '/importCandidates';
  var url = base + '?documentId=' + encodeURIComponent(documentId || candidate.fingerprint);

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

function extractSenderDomain(sender) {
  var address = String(sender || '').trim();
  var bracketed = address.match(/<([^<>]+)>/);
  if (bracketed) address = bracketed[1].trim();
  var match = address.match(/@([A-Za-z0-9.\-]+)$/);
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
  var token = fetchAccessToken();
  var messageIds = searchMessageIds(query, token, 10);
  report.gmailMatched = messageIds.length;

  messageIds.forEach(function (id) {
      var candidate = buildCandidate(readGmailMessage(id, token));
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
  var token = fetchAccessToken();
  var messageIds = searchMessageIds(config.gmailQuery || DEFAULT_QUERY, token, 20);
  var results = [];
  messageIds.forEach(function (id) {
      var candidate = buildCandidate(readGmailMessage(id, token));
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
  Logger.log(JSON.stringify({ 件数: results.length, 明細: results }, null, 2));
  return results;
}
