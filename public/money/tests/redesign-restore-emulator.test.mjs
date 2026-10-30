/* ローカルFirestore模擬環境の架空データ専用。管理者権限で復元の試験をする。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import backup from '../redesign-backup-read.js';
import migration from '../redesign-migration-check.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8487') throw new Error('ローカル模擬環境専用です');
const base = 'http://127.0.0.1:8487/v1/projects/demo-kurashi/databases/(default)/documents';
const sourceId = `source-${randomUUID()}`, targetId = `restore-${randomUUID()}`;
const names = ['importCandidates', 'receipts', 'receiptItems', 'itemAliases'];
const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const rootFields = { name: { stringValue: '架空家計' }, state: { mapValue: { fields: { balance: { integerValue: '50000' } } } } };
const fields = name => ({ category: { stringValue: name }, amount: { integerValue: '1234' } });
async function request(path, options = {}) {
  const response = await fetch(`${base}/${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`模擬Firestoreの応答 ${response.status}`);
  return response.status === 204 ? {} : response.json();
}
async function write(path, content) { return request(path, { method: 'PATCH', body: JSON.stringify({ fields: content }) }); }
async function read(workspaceId, time) {
  return backup.readSnapshot({ projectId: 'demo-kurashi', workspaceId, readTime: time, getJson: async url => {
    const parsed = new URL(url);
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
