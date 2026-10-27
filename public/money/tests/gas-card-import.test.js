const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const dir = path.join(__dirname, '..', 'integrations', 'gas-card-mail-import');
const failures = [];
let total = 0;
const test = (name, fn) => { total++; try { fn(); } catch (error) { failures.push({ name, message: error.message }); } };
const assert = (value, message) => { if (!value) throw new Error(message); };

function fixture({ ids = ['a', 'b'], failModify = false, failSave = false, body = 'ご利用日時：2026/08/23 15:03\nご利用金額：1,000円' } = {}) {
  const saved = new Map();
  const labeled = [];
  let released = false;
  const response = (status, data = {}) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(data) });
  const box = {
    Logger: { log() {} },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_a, text) => [...crypto.createHash('sha256').update(text).digest()].map(x => x > 127 ? x - 256 : x), base64Decode: text => Buffer.from(text, 'base64'), base64DecodeWebSafe: text => Buffer.from(text, 'base64url'), newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released = true; } }) },
    UrlFetchApp: { fetch: (url, opts = {}) => {
      if (url.includes('/gmail/v1/users/me/messages?')) return response(200, { messages: ids.map(id => ({ id })) });
      if (url.endsWith('/gmail/v1/users/me/labels')) return response(200, { labels: [{ id: 'processed-label', name: 'CashManege/取込済み' }] });
      if (url.includes('/gmail/v1/users/me/messages/') && url.endsWith('?format=full')) return response(200, {
        internalDate: String(Date.parse('2026-08-23T06:03:00.000Z')),
        payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'notice@jcb.co.jp' }, { name: 'Subject', value: 'ご利用のお知らせ' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') } }] }
      });
      if (url.includes('/gmail/v1/users/me/messages/') && url.endsWith('/modify')) {
        const id = url.split('/').slice(-2)[0];
        if (failModify) return response(503);
        labeled.push({ id, label: JSON.parse(opts.payload).addLabelIds[0] });
        return response(200);
      }
      if (url.includes('/importCandidates?documentId=')) {
        if (failSave) return response(403);
        const id = decodeURIComponent(url.split('documentId=')[1]);
        if (saved.has(id)) return response(409);
        saved.set(id, JSON.parse(opts.payload).fields);
        return response(200);
      }
      throw new Error('unexpected request');
    } }
  };
  vm.createContext(box);
  for (const file of ['Parsers.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), box);
  box.readConfig = () => ({ projectId: 'test', workspaceId: 'ws', gmailQuery: '' });
  box.fetchAccessToken = () => 'test-token';
  return { box, saved, labeled, released: () => released };
}

test('別のメールは同額同日でも別候補とし、処理済みは各メールに付ける', () => {
  const f = fixture();
  const summary = f.box.importCardMails();
  assert(summary.created === 2 && f.saved.size === 2, '別々の通知を1件にまとめている');
  assert(f.labeled.length === 2 && f.labeled.every(x => x.label === 'processed-label'), '各メールへのラベルが不足');
  assert(f.released(), 'ロックを解放していない');
});

test('同じメールの再処理は新しい候補を作らない', () => {
  const f = fixture({ ids: ['a'] });
  f.box.importCardMails();
  const result = f.box.importCardMails();
  assert(f.saved.size === 1 && result.duplicated === 1, '同一メールが重複登録された');
});

test('ラベル付け失敗後は保存済み候補を重複させず再試行できる', () => {
  const f = fixture({ ids: ['a'], failModify: true });
  const result = f.box.importCardMails();
  assert(result.failed === 1 && f.saved.size === 1 && f.labeled.length === 0, '失敗したメールの扱いが不正');
  assert(f.released(), '失敗時もロックを解放する');
});

test('保存に失敗したメールには処理済みラベルを付けない', () => {
  const f = fixture({ ids: ['a'], failSave: true });
  const result = f.box.importCardMails();
  assert(result.failed === 1 && f.saved.size === 0 && f.labeled.length === 0, '保存失敗を処理済みにしている');
  assert(f.released(), '保存失敗時もロックを解放する');
});

test('利用日が不明な場合、受信日を利用日と誤って保存しない', () => {
  const f = fixture({ ids: ['a'], body: 'ご利用金額：1,000円' });
  f.box.importCardMails();
  const fields = [...f.saved.values()][0];
  assert(fields.usedDate.stringValue === '' && fields.status.stringValue === 'needs_review', '受信日を利用日と誤認している');
});

test('符号化された日本語件名を元の文字に戻す', () => {
  const f = fixture();
  const word = Buffer.from('ご請求額確定').toString('base64');
  assert(f.box.decodeMimeHeader(`=?UTF-8?B?${word}?=`) === 'ご請求額確定', '日本語の件名を復元できない');
  assert(f.box.decodeMimeHeader('=?UTF-8?Q?Card_Notice?=') === 'Card Notice', 'Q形式の件名を復元できない');
});

console.log(JSON.stringify({ suite: 'gas-card-import', total, passed: total - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
process.exit(failures.length ? 1 : 0);
