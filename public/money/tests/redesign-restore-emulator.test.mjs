/* ローカルFirestore模擬環境の架空データ専用。利用者権限で復元を試験する。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import backup from '../redesign-backup-read.js';
import migration from '../redesign-migration-check.js';
import planner from '../redesign-restore-plan.js';
import executor from '../redesign-restore-execute.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8487') throw new Error('ローカル模擬環境専用です');
const base = 'http://127.0.0.1:8487/v1/projects/demo-kurashi/databases/(default)/documents';
const sourceId = `source-${randomUUID()}`, targetId = `restore-${randomUUID()}`, interruptedId = `interrupted-${randomUUID()}`, verifiedId = `verified-${randomUUID()}`;
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
async function read(workspaceId, time, afterRootRead, readHeaders = headers) {
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
    const response = await fetch(local, { headers: readHeaders });
    const body = await response.json();
    if (!response.ok) throw new Error(`模擬Firestoreの読み取り ${response.status}: ${body.error?.message || '不明'}`);
    if (afterRootRead && parsed.pathname.endsWith(`/workspaces/${workspaceId}`)) await afterRootRead();
    return body;
  } });
}
const cleanup = [];
const failures = [];
try {
  await write(`workspaces/${sourceId}`, rootFields); cleanup.push(`workspaces/${sourceId}`);
  await write(`workspaces/${sourceId}`, { ...rootFields, revision: { integerValue: '1' } });
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
  const receiptPath = `workspaces/${sourceId}/receiptItems`;
  let concurrentUpdate;
  const historical = await read(sourceId, last.updateTime, async () => {
    await write(`${receiptPath}/one`, { ...fields('receiptItems'), amount: { integerValue: '9999' } });
    concurrentUpdate = await write(`${receiptPath}/two`, fields('receiptItems'));
    cleanup.push(`${receiptPath}/two`);
  });
  assert.equal(historical.collections.receiptItems.documents[0].data.fields.amount.integerValue, '1234');
  assert.equal(migration.compare(snapshot, historical).matches, true);
  const latest = await read(sourceId, concurrentUpdate.updateTime);
  assert.deepEqual(latest.collections.receiptItems.documents.map(row => row.id).sort(), ['one', 'two']);
  assert.equal(latest.collections.receiptItems.documents.find(row => row.id === 'one').data.fields.amount.integerValue, '9999');
  const plan = planner.planRestore({ snapshot, targetId, uid: 'restore-user' });
  assert.equal(plan.rootWrites.length, 1); assert.equal(plan.childWrites.length, 4);
  assert.equal(snapshot.workspace.fields.revision.integerValue, '1');
  assert.equal(plan.rootWrites[0].update.fields.revision.integerValue, '0');
  assert.throws(() => planner.planRestore({ snapshot, targetId: sourceId, uid: 'restore-user' }), /上書き/);
  assert.throws(() => planner.planRestore({ snapshot, targetId, uid: 'other-user' }), /所有者/);
  let attempts = 0;
  const interrupted = await executor.executeRestore({ snapshot, targetId: interruptedId, uid: 'restore-user', readBack: read, commitWrites: async writes => {
    attempts += 1;
    if (attempts === 2) throw new Error('模擬通信失敗');
    const response = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) });
    if (!response.ok) throw new Error('親の作成に失敗');
    return response.json();
  } });
  assert.equal(interrupted.status, 'children_uncertain');
  cleanup.push(`workspaces/${interruptedId}`);
  const interruptedRoot = await request(`workspaces/${interruptedId}`);
  assert.equal(interruptedRoot.fields.ownerUid.stringValue, 'restore-user');
  const partial = await read(interruptedId, interruptedRoot.updateTime);
  const inspection = planner.inspectRestore({ snapshot, target: partial, targetId: interruptedId, uid: 'restore-user' });
  assert.equal(inspection.status, 'incomplete'); assert.equal(inspection.missingWrites.length, 4);
  let resumeCommits = 0;
  const resume = receipt => executor.resumeRestore({
    snapshot, receipt, uid: 'restore-user', readBack: read,
    readCurrent: async id => read(id, new Date().toISOString()),
    commitWrites: async writes => {
      const response = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) });
      if (!response.ok) throw new Error('再開できません');
      resumeCommits++;
      if (resumeCommits === 1) {
        cleanup.push(...names.map(name => `workspaces/${interruptedId}/${name}/one`));
        throw new Error('明細は保存済みだが応答が失われた');
      }
      return response.json();
    }
  });
  assert.equal((await resume({ ...interrupted, rootVersion: snapshot.readTime })).status, 'conflict');
  assert.equal((await resume(interrupted)).status, 'children_uncertain');
  assert.equal((await resume(interrupted)).status, 'verified');
  assert.equal(resumeCommits, 1);
  const resumed = await read(interruptedId, new Date().toISOString());
  assert.equal(planner.inspectRestore({ snapshot, target: resumed, targetId: interruptedId, uid: 'restore-user' }).status, 'matches');
  const changedTarget = structuredClone(resumed);
  changedTarget.collections.receiptItems.documents[0].data.fields.amount.integerValue = '9999';
  assert.equal(planner.inspectRestore({ snapshot, target: changedTarget, targetId: interruptedId, uid: 'restore-user' }).status, 'conflict');
  const verified = await executor.executeRestore({ snapshot, targetId: verifiedId, uid: 'restore-user', readBack: read, commitWrites: async writes => {
    const response = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) });
    if (!response.ok) throw new Error('書き込みに失敗');
    cleanup.push(...writes.map(item => item.update.name.split('/documents/')[1]));
    return response.json();
  } });
  assert.equal(verified.status, 'verified');
  let replayCalls = 0;
  const replay = await executor.executeRestore({ snapshot, targetId: verifiedId, uid: 'restore-user', readBack: read, commitWrites: async writes => {
    replayCalls += 1;
    const response = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) });
    if (!response.ok) throw new Error('既存の復元先');
    return response.json();
  } });
  assert.equal(replay.status, 'root_uncertain'); assert.equal(replayCalls, 1);
  // 現行ルールは親の家計が先に存在することを要求する。
  const createRoot = () => fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: plan.rootWrites }) });
  const rootResponse = await createRoot();
  if (!rootResponse.ok) throw new Error(`親の作成 ${rootResponse.status}: ${(await rootResponse.json()).error?.message}`);
  cleanup.push(`workspaces/${targetId}`);
  const repeated = await createRoot();
  assert.equal(repeated.ok, false);
  const commit = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: plan.childWrites }) });
  if (!commit.ok) throw new Error(`明細の復元 ${commit.status}: ${(await commit.json()).error?.message}`);
  const result = await commit.json();
  last = { updateTime: result.commitTime };
  cleanup.push(...names.map(name => `workspaces/${targetId}/${name}/one`));
  const duplicateChildren = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: plan.childWrites }) });
  assert.equal(duplicateChildren.ok, false);
  const restored = await read(targetId, last.updateTime);
  assert.equal(restored.workspace.fields.revision.integerValue, '0');
  assert.equal(migration.compareRestored(snapshot, restored).matches, true);
  await write(`workspaces/${targetId}/receiptItems/one`, { ...fields('receiptItems'), amount: { integerValue: '1235' } });
  const changed = await request(`workspaces/${targetId}/receiptItems/one`);
  const modified = await read(targetId, changed.updateTime);
  assert.equal(migration.compareRestored(snapshot, modified).matches, false);
  const raceId = `restore-race-${randomUUID()}`, racePath = `workspaces/${raceId}`;
  async function commitRace(writes) {
    const response = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) });
    if (!response.ok) throw new Error('復元の書き込みが拒否されました');
    return response.json();
  }
  const raceReceipt = await executor.executeRestore({
    snapshot, targetId: raceId, uid: 'restore-user', readBack: read,
    commitWrites: async writes => {
      if (writes.length !== 1) throw new Error('明細を送信する前に通信が切れた');
      const committed = await commitRace(writes);
      cleanup.push(racePath);
      return committed;
    }
  });
  assert.equal(raceReceipt.status, 'children_uncertain');
  let raceWrites = 0;
  const tryRaceResume = () => executor.resumeRestore({
    snapshot, receipt: raceReceipt, uid: 'restore-user', readBack: read,
    readCurrent: id => read(id, new Date().toISOString()),
    commitWrites: async writes => {
      raceWrites++;
      await write(racePath, { ...rootFields, name: str('別端末からの更新'), revision: { integerValue: '0' } });
      return commitRace(writes);
    }
  });
  assert.equal((await tryRaceResume()).status, 'children_uncertain');
  assert.equal((await tryRaceResume()).status, 'conflict');
  assert.equal(raceWrites, 1);
  const raceTarget = await read(raceId, new Date().toISOString());
  assert.equal(raceTarget.workspace.fields.name.stringValue, '別端末からの更新');
  assert.ok(names.every(name => raceTarget.collections[name].documents.length === 0));
} catch (error) {
  failures.push({ name: '架空家計の読み取り・復元・内容照合', message: error.message });
} finally {
  for (const path of cleanup.reverse()) await request(path, { method: 'DELETE' }).catch(() => {});
}
let total = 1;
if (process.env.PRIVATE_CLOUD_SNAPSHOT) {
  total++;
  const privateCleanup = [];
  let privateHeaders;
  try {
    const snapshot = JSON.parse(readFileSync(process.env.PRIVATE_CLOUD_SNAPSHOT, 'utf8').replace(/^\uFEFF/, ''));
    const uid = snapshot.workspace.fields.ownerUid.stringValue;
    privateHeaders = { Authorization: `Bearer ${token(uid)}`, 'Content-Type': 'application/json' };
    const privateTargetId = `private-copy-${randomUUID()}`;
    const original = JSON.stringify(snapshot);
    const result = await executor.executeRestore({
      snapshot, targetId: privateTargetId, uid,
      readBack: (id, time) => read(id, time, undefined, privateHeaders),
      commitWrites: async writes => {
        // 原本のprojectsパスは外部へ送らず、ローカル模擬プロジェクトだけに書く。
        const localWrites = writes.map(write => ({ ...write, update: {
          ...write.update, name: write.update.name.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, 'projects/demo-kurashi/databases/(default)/documents/')
        } }));
        const response = await fetch(`${base}:commit`, { method: 'POST', headers: privateHeaders, body: JSON.stringify({ writes: localWrites }) });
        if (!response.ok) throw new Error('private_restore_write_failed');
        privateCleanup.push(...localWrites.map(write => write.update.name.split('/documents/')[1]));
        return response.json();
      }
    });
    assert.equal(result.status, 'verified');
    assert.equal(JSON.stringify(snapshot), original);
    const restored = await read(privateTargetId, new Date().toISOString(), undefined, privateHeaders);
    assert.equal(migration.compareRestored(snapshot, restored).matches, true);
    assert.deepEqual(names.map(name => restored.collections[name].documents.length), names.map(name => snapshot.collections[name].documents.length));
  } catch (_) {
    failures.push({ name: '非公開原本全体の隔離復元', message: 'private_restore_check_failed' });
  } finally {
    for (const path of privateCleanup.reverse()) await fetch(`${base}/${path}`, { method: 'DELETE', headers: privateHeaders });
  }
}
console.log(JSON.stringify({ suite: 'redesign-restore-emulator', total, passed: total - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
