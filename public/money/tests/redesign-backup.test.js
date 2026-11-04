#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { readSnapshot } = require('../redesign-backup-read.js');
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
(async () => {
  const failures = [];
  for (const item of cases) { try { await item.fn(); } catch (error) { failures.push({ name: item.name, message: error.message }); } }
  console.log(JSON.stringify({ suite: 'redesign-backup', total: cases.length, passed: cases.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
  if (failures.length) process.exitCode = 1;
})();
