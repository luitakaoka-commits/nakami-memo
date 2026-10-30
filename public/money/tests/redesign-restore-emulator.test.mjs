/* ローカルFirestore模擬環境の架空データ専用。利用者権限で復元を試験する。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import backup from '../redesign-backup-read.js';
import migration from '../redesign-migration-check.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8487') throw new Error('ローカル模擬環境専用です');
const base = 'http://127.0.0.1:8487/v1/projects/demo-kurashi/databases/(default)/documents';
const sourceId = `source-${randomUUID()}`, targetId = `restore-${randomUUID()}`;
const names = ['importCandidates', 'receipts', 'receiptItems', 'itemAliases'];
const token = uid => {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: uid, user_id: uid, aud: 'demo-kurashi', iss: 'https://securetoken.google.com/demo-kurashi', iat: 1, exp: 4102444800, firebase: { sign_in_provider: 'custom' } })}.`;
};
const headers = { Authorization: `Bearer ${token('restore-user')}`, 'Content-Type': 'application/json' };
const str = stringValue => ({ stringValue });
const amount = { integerValue: '1234' };
const rootFields = { name: str('架空家計'), ownerUid: str('restore-user'), memberUids: { arrayValue: { values: [str('restore-user')] } }, state: { mapValue: { fields: { balance: { integerValue: '50000' } } } }, createdAt: str('test'), updatedAt: str('test'), updatedBy: str('restore-user') };
const fields = name => ({
  importCandidates: { sourcePackage: str('test'), detectedAt: str('2026-10-30'), amount, type: str('purchase'), status: str('pending'), fingerprint: str('test') },
  receipts: { storeName: str('架空店舗'), purchasedAt: str('2026-10-30'), total: amount, paymentMethod: str('card'), source: str('manual'), status: str('pending') },
  receiptItems: { receiptId: str('one'), name: str('架空商品'), amount, category: str('食品'), outcome: str('in_stock') },
  itemAliases: { aliasKey: str('one'), canonicalName: str('架空商品'), canonicalKey: str('test') }
})[name];
async function request(path, options = {}) {
  const response = await fetch(`${base}/${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`模擬Firestoreの応答 ${response.status}`);
  return response.status === 204 ? {} : response.json();
}
async function write(path, content) { return request(path, { method: 'PATCH', body: JSON.stringify({ fields: content }) }); }
async function read(workspaceId, time) {
  return backup.readSnapshot({ projectId: 'demo-kurashi', workspaceId, readTime: time, getJson: async url => {
    const parsed = new URL(url);
    // エミュレーターのRESTはRFC 3339のreadTimeを誤解析するため、
    // 同じ時刻を秒・ナノ秒のフィールドに分ける（本番用URLは変更しない）。
    const stamp = parsed.searchParams.get('readTime');
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(stamp || '');
    if (!match) throw new Error('試験用の読み取り時刻が不正です');
    parsed.searchParams.delete('readTime');
    parsed.searchParams.set('readTime.seconds', String(Date.parse(`${match[1]}Z`) / 1000));
    parsed.searchParams.set('readTime.nanos', String(Number((match[2] || '').padEnd(9, '0'))));
    const local = `http://127.0.0.1:8487${parsed.pathname}${parsed.search}`;
    const response = await fetch(local, { headers });
    const body = await response.json();
    if (!response.ok) throw new Error(`模擬Firestoreの読み取り ${response.status}: ${body.error?.message || '不明'}`);
    return body;
  } });
}
const cleanup = [];
const failures = [];
try {
  await write(`workspaces/${sourceId}`, rootFields); cleanup.push(`workspaces/${sourceId}`);
  let last;
  for (const name of names) {
    const path = `workspaces/${sourceId}/${name}/one`;
    last = await write(path, fields(name)); cleanup.push(path);
  }
  const snapshot = await read(sourceId, last.updateTime);
  assert.equal(names.reduce((sum, name) => sum + snapshot.collections[name].documents.length, 0), 4);
  const outsiderHeaders = { Authorization: `Bearer ${token('other-user')}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/workspaces/${sourceId}`, { headers: outsiderHeaders })).status, 403);
  assert.equal((await fetch(`${base}/workspaces/${sourceId}/importCandidates/one`, { headers: outsiderHeaders })).status, 403);
  assert.equal((await fetch(`${base}/workspaces/${sourceId}/receiptItems/one`, { method: 'PATCH', headers: outsiderHeaders, body: JSON.stringify({ fields: fields('receiptItems') }) })).status, 403);
  await write(`workspaces/${sourceId}/receiptItems/one`, { ...fields('receiptItems'), amount: { integerValue: '9999' } });
  const historical = await read(sourceId, last.updateTime);
  assert.equal(historical.collections.receiptItems.documents[0].data.fields.amount.integerValue, '1234');
  assert.equal(migration.compare(snapshot, historical).matches, true);
  await write(`workspaces/${targetId}`, snapshot.workspace.fields); cleanup.push(`workspaces/${targetId}`);
  for (const name of names) for (const item of snapshot.collections[name].documents) {
    const path = `workspaces/${targetId}/${name}/${item.id}`;
    last = await write(path, item.data.fields); cleanup.push(path);
  }
  const restored = await read(targetId, last.updateTime);
  assert.equal(migration.compareRestored(snapshot, restored).matches, true);
  await write(`workspaces/${targetId}/receiptItems/one`, { ...fields('receiptItems'), amount: { integerValue: '1235' } });
  const changed = await request(`workspaces/${targetId}/receiptItems/one`);
  const modified = await read(targetId, changed.updateTime);
  assert.equal(migration.compareRestored(snapshot, modified).matches, false);
} catch (error) {
  failures.push({ name: '架空家計の読み取り・復元・内容照合', message: error.message });
} finally {
  for (const path of cleanup.reverse()) await request(path, { method: 'DELETE' }).catch(() => {});
}
console.log(JSON.stringify({ suite: 'redesign-restore-emulator', total: 1, passed: 1 - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
