#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { readSnapshot, readCurrentSnapshot } = require('../redesign-backup-read.js');
const { compare, compareRestored } = require('../redesign-migration-check.js');
const names = ['importCandidates', 'receipts', 'receiptItems', 'itemAliases'];
const workspace = 'projects/test/databases/(default)/documents/workspaces/example';
const time = '2026-10-30T12:00:00.123456Z';
const document = (name, value) => ({ name, fields: { amount: { integerValue: value } }, createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z' });
const args = getJson => ({ projectId: 'test', workspaceId: 'example', readTime: time, getJson });
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
function server(change = () => {}) {
  const calls = [];
  const getJson = async text => {
    const url = new URL(text); calls.push(url);
    assert.equal(url.searchParams.get('readTime'), time);
    if (url.pathname.endsWith('/workspaces/example')) return document(workspace, '1');
    const name = url.pathname.split('/').pop();
    assert.ok(names.includes(name));
    const page = url.searchParams.get('pageToken');
    const reply = page ? { documents: [document(`${workspace}/${name}/two`, '2')] }
      : { documents: [document(`${workspace}/${name}/one`, '9007199254740993')], nextPageToken: 'page2' };
    return change(name, page, reply) || reply;
  };
  return { calls, getJson };
}
test('同じ時刻で全ページを取得しFirestoreの整数を文字列のまま保持', async () => {
  const s = server(), result = await readSnapshot(args(s.getJson));
  assert.equal(s.calls.length, 9);
  for (const name of names) {
    assert.equal(result.collections[name].documents.length, 2);
    assert.equal(result.collections[name].documents[0].data.fields.amount.integerValue, '9007199254740993');
  }
  assert.equal(compare(result, JSON.parse(JSON.stringify(result))).matches, true);
});
test('空のコレクションも最終ページまで取得したことを記録', async () => {
  const s = server((name) => name === 'receipts' ? {} : null);
  const result = await readSnapshot(args(s.getJson));
  assert.deepEqual(result.collections.receipts.documents, []);
  assert.equal(result.collections.receipts.complete, true);
});
test('復元先の場所や作成時刻が変わっても内容を比較し欠落を検出する', async () => {
  const source = await readSnapshot(args(server().getJson));
  const restored = JSON.parse(JSON.stringify(source));
  const target = 'projects/test/databases/(default)/documents/workspaces/restored';
  restored.workspaceId = 'restored';
  restored.workspace.name = target;
  restored.workspace.createTime = '2026-10-31T00:00:00Z';
  restored.readTime = '2026-10-31T00:00:00Z';
  for (const name of names) for (const doc of restored.collections[name].documents) {
    doc.data.name = `${target}/${name}/${doc.id}`;
    doc.data.createTime = '2026-10-31T00:00:00Z';
  }
  assert.equal(compare(source, restored).matches, false);
  assert.equal(compareRestored(source, restored).matches, true);
  restored.collections.importCandidates.documents[0].data.fields.amount.integerValue = '1';
  assert.equal(compareRestored(source, restored).matches, false);
  restored.collections.importCandidates.documents[0].data.name = `${workspace}/importCandidates/one`;
  assert.throws(() => compareRestored(source, restored), /場所/);
});
test('途中のアクセス拒否やサーバーエラーで部分的なバックアップを返さない', async () => {
  const s = server((name, page) => name === 'receipts' && page ? { error: { code: 403 } } : null);
  await assert.rejects(readSnapshot(args(s.getJson)), /取得に失敗/);
  await assert.rejects(readSnapshot(args(async () => { throw new Error('network'); })), /network/);
  const futurePage = server((name, page, reply) => name === 'receipts' && page
    ? { documents: [{ ...reply.documents[0], updateTime: '2026-10-30T12:00:00.123457Z' }] } : null);
  await assert.rejects(readSnapshot(args(futurePage.getJson)), /更新時刻/);
});
test('繰り返すページ・異なる家計の文書・文書ID重複を拒否', async () => {
  const loop = server((name, page, reply) => name === 'receipts' && page ? { ...reply, nextPageToken: 'page2' } : null);
  await assert.rejects(readSnapshot(args(loop.getJson)), /ページが繰り返/);
  const wrong = server(name => name === 'receipts' ? { documents: [document('projects/test/databases/(default)/documents/workspaces/other/receipts/one', '1')] } : null);
  await assert.rejects(readSnapshot(args(wrong.getJson)), /別の場所/);
  const duplicate = server((name, page) => name === 'receipts' && page ? { documents: [document(`${workspace}/${name}/one`, '1')] } : null);
  await assert.rejects(readSnapshot(args(duplicate.getJson)), /重複/);
});
test('過剰な時刻精度やIDへのパス混入を拒否', async () => {
  await assert.rejects(readSnapshot({ ...args(server().getJson), readTime: '2026-10-30T12:00:00.123456789Z' }), /時刻/);
  await assert.rejects(readSnapshot({ ...args(server().getJson), readTime: '2026-02-30T12:00:00Z' }), /時刻/);
  await assert.rejects(readSnapshot({ ...args(server().getJson), workspaceId: 'other/sub' }), /ID/);
});
test('端末時計がずれても保存完了後のサーバー読取時刻で原本を固定する', async () => {
  let saved = false, captured = false;
  const savedDoc = { ...document(workspace, '2'), updateTime: time };
  const originalNow = Date.now;
  Date.now = () => Date.parse('2036-01-01T00:00:00Z');
  try {
    const result = await readCurrentSnapshot({
      projectId: 'test', workspaceId: 'example',
      beforeRead: async () => { saved = true; },
      postJson: async (url, body) => {
        assert.ok(saved); captured = true;
        assert.equal(url, 'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents:batchGet');
        assert.deepEqual(body, { documents: [workspace] });
        return [{ found: savedDoc, readTime: time }];
      },
      getJson: async text => {
        assert.ok(captured); const url = new URL(text);
        assert.equal(url.searchParams.get('readTime'), time);
        return url.pathname.endsWith('/workspaces/example') ? savedDoc : {};
      }
    });
    assert.equal(result.readTime, time);
    assert.equal(result.workspace.fields.amount.integerValue, '2');
    assert.ok(names.every(name => result.collections[name].complete));
  } finally { Date.now = originalNow; }
});

test('読取点が不明・別家計・文書更新前なら原本の書き出しを中断する', async () => {
  assert.equal(typeof readCurrentSnapshot, 'function');
  const good = { found: document(workspace, '1'), readTime: time };
  const bad = [[], [{ missing: workspace, readTime: time }], [{ ...good, readTime: 'invalid' }],
    [{ ...good, found: document(workspace + '-other', '1') }], [good, good],
    [{ ...good, found: { ...good.found, updateTime: '2026-10-30T12:00:00.123457Z' } }]];
  for (const response of bad) {
    let reads = 0;
    await assert.rejects(readCurrentSnapshot({ projectId: 'test', workspaceId: 'example', postJson: async () => response, getJson: async () => { reads++; return {}; } }));
    assert.equal(reads, 0);
  }
});

test('サーバーのナノ秒表記はAPIが受け取るマイクロ秒へ揃え、取得失敗を隠さない', async () => {
  assert.equal(typeof readCurrentSnapshot, 'function');
  const result = await readCurrentSnapshot({ projectId: 'test', workspaceId: 'example',
    postJson: async () => [{ found: document(workspace, '1'), readTime: '2026-10-30T12:00:00.123456789Z' }],
    getJson: server().getJson });
  assert.equal(result.readTime, time);
  await assert.rejects(readCurrentSnapshot({ projectId: 'test', workspaceId: 'example', postJson: async () => { throw Error('network'); }, getJson: server().getJson }), /network/);
});

test('画面の実関数で保存直後と競合退避中のクラウド原本をHTTP取得する', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), http = require('node:http');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'firebase-sync.js'), 'utf8');
  const start = apiSource.indexOf('async function readCloudBackup()');
  const end = start + apiSource.slice(start).search(/^}/m) + 1;
  assert.ok(start >= 0 && end > start);
  let saved = false, anchored = false, requests = 0;
  const failures = [];
  const doc = { ...document(workspace, '2'), updateTime: time };
  const server = http.createServer(async (request, response) => {
    try {
      requests++;
      assert.equal(request.headers.authorization, 'Bearer test-only-token');
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.endsWith('/documents:batchGet')) {
        assert.ok(saved, '保存完了前に原本の取得を開始した');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers['content-type'], 'application/json');
        let body = ''; for await (const chunk of request) body += chunk;
        assert.deepEqual(JSON.parse(body), { documents: [workspace] });
        anchored = true;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify([{ found: doc, readTime: time }]));
      } else {
        assert.ok(anchored);
        assert.equal(request.method, 'GET');
        assert.equal(url.searchParams.get('readTime'), time);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(url.pathname.endsWith('/workspaces/example') ? doc : {}));
      }
    } catch (error) { failures.push(error.message); response.statusCode = 500; response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const context = vm.createContext({
    currentUser: { getIdToken: async () => 'test-only-token' }, currentWorkspace: { id: 'example' },
    workspaceSaver: { flush: async () => { saved = true; } }, firebaseConfig: { projectId: 'test' },
    RedesignBackupRead: require('../redesign-backup-read.js'), AbortSignal,
    fetch: (url, options) => { const target = new URL(url); assert.equal(target.origin, 'https://firestore.googleapis.com'); return fetch(origin + target.pathname + target.search, options); }
  });
  try {
    const run = vm.runInContext('(' + apiSource.slice(start, end).trim() + ')', context);
    const result = await run();
    assert.deepEqual(failures, []);
    assert.equal(result.workspace.fields.amount.integerValue, '2');
    assert.equal(result.readTime, time);
    assert.equal(requests, 6);
    context.workspaceSaver = { flush: async () => {}, isBlocked: () => true, isDirty: () => true };
    const conflicted = await run();
    assert.equal(conflicted.readTime, time);
    assert.deepEqual(conflicted.workspace, result.workspace);
    assert.deepEqual(failures, []);
    assert.equal(requests, 12);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

(async () => {
  const failures = [];
  for (const item of cases) { try { await item.fn(); } catch (error) { failures.push({ name: item.name, message: error.message }); } }
  console.log(JSON.stringify({ suite: 'redesign-backup', total: cases.length, passed: cases.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
  if (failures.length) process.exitCode = 1;
})();
