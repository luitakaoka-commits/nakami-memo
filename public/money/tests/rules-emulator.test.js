#!/usr/bin/env node
/* ローカルの demo-kurashi Firestore emulator 専用。実際のFirebaseには送信しない。 */
'use strict';
const assert = require('node:assert/strict');
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host !== '127.0.0.1:8487') throw new Error('このテストは指定されたローカルのエミュレーター専用です');
const root = `http://${host}/v1/projects/demo-kurashi/databases/(default)/documents/workspaces/test-space`;
const home = `http://${host}/v1/projects/demo-kurashi/databases/(default)/documents/households/test-home`;
const value = x => typeof x === 'string' ? { stringValue: x } : { integerValue: String(x) };
const fields = object => Object.fromEntries(Object.entries(object).map(([k, v]) => [k, value(v)]));
const token = uid => {
  const part = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: uid, user_id: uid, aud: 'demo-kurashi', iss: 'https://securetoken.google.com/demo-kurashi', iat: 1, exp: 4102444800, firebase: { sign_in_provider: 'custom' } })}.`;
};
const candidate = { sourcePackage: 'jcb.example', detectedAt: '2026-01-01T00:00:00Z', amount: 1000, type: 'purchase', status: 'pending', fingerprint: 'test' };
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
async function patch(id, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  return fetch(`${root}/importCandidates/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: fields(body) }) });
}
test('旧形式の候補を本人が保存できる', async () => assert.equal((await patch('old', candidate, token('owner-user'))).status, 200));
test('日本時間と本文の出所がある候補を本人が保存できる', async () => assert.equal((await patch('new', { ...candidate, usedTime: '23:59', usedTimeZone: 'Asia/Tokyo', usedTimeSource: 'mail-body' }, token('owner-user'))).status, 200));
test('時刻や時間帯が不明な候補も保存できる', async () => assert.equal((await patch('unknown', { ...candidate, usedTime: '', usedTimeZone: '', usedTimeSource: '' }, token('owner-user'))).status, 200));
test('不正な時刻は拒否', async () => assert.equal((await patch('bad-time', { ...candidate, usedTime: '25:30' }, token('owner-user'))).status, 403));
test('認めていない時間帯は拒否', async () => assert.equal((await patch('bad-zone', { ...candidate, usedTimeZone: 'UTC' }, token('owner-user'))).status, 403));
test('認めていない時刻の出所は拒否', async () => assert.equal((await patch('bad-source', { ...candidate, usedTimeSource: 'receipt-time' }, token('owner-user'))).status, 403));
test('許されない追加項目は拒否', async () => assert.equal((await patch('bad-field', { ...candidate, unexpected: 'test' }, token('owner-user'))).status, 403));
test('本人以外は候補を保存できない', async () => assert.equal((await patch('outsider', candidate, token('other-user'))).status, 403));
test('未ログインでは候補を保存できない', async () => assert.equal((await patch('anonymous', candidate, '')).status, 403));
test('家の同居人でも本人の家計とメール候補を読めない', async () => {
  const headers = { Authorization: `Bearer ${token('housemate')}` };
  assert.equal((await fetch(root, { headers })).status, 403);
  assert.equal((await fetch(`${root}/importCandidates/new`, { headers })).status, 403);
});
test('家の同居人は共有在庫を読めるが非メンバーは読めない', async () => {
  assert.equal((await fetch(`${home}/items/test-item`, { headers: { Authorization: `Bearer ${token('housemate')}` } })).status, 200);
  assert.equal((await fetch(`${home}/items/test-item`, { headers: { Authorization: `Bearer ${token('other-user')}` } })).status, 403);
});
test('本人の健康記録を家の同居人は読めない', async () => {
  const path = `http://${host}/v1/projects/demo-kurashi/databases/(default)/documents/users/owner-user/health/test`;
  assert.equal((await fetch(path, { headers: { Authorization: `Bearer ${token('housemate')}` } })).status, 403);
});
(async () => {
  const initial = { fields: { name: value('test'), ownerUid: value('owner-user'), memberUids: { arrayValue: { values: [value('owner-user')] } }, state: { mapValue: { fields: {} } }, createdAt: value('test'), updatedAt: value('test'), updatedBy: value('owner-user') } };
  const seeded = await fetch(root, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(initial) });
  if (!seeded.ok) throw new Error(`テストデータの準備に失敗しました: ${seeded.status}`);
  const adminHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
  const homeSeed = { fields: { ownerUid: value('owner-user'), memberUids: { arrayValue: { values: [value('owner-user'), value('housemate')] } } } };
  const homeResult = await fetch(home, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify(homeSeed) });
  const itemResult = await fetch(`${home}/items/test-item`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ fields: fields({ name: '架空の食品', purchasePrice: 100, purchaseWorkspaceId: 'test-space' }) }) });
  if (!homeResult.ok || !itemResult.ok) throw new Error('共有在庫テストの準備に失敗しました');
  const failures = [];
  for (const item of cases) { try { await item.fn(); } catch (error) { failures.push({ name: item.name, message: error.message }); } }
  const visible = await fetch(`${home}/items/test-item`, { headers: { Authorization: `Bearer ${token('housemate')}` } });
  const data = await visible.json();
  const sharedPurchaseFieldsVisible = Boolean(data.fields?.purchasePrice || data.fields?.purchaseWorkspaceId);
  console.log(JSON.stringify({ suite: 'rules-emulator', total: cases.length, passed: cases.length - failures.length, failed: failures.length, sharedPurchaseFieldsVisible, ...(failures.length ? { failures } : {}) }));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
