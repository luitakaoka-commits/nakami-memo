/* 公開用ルール候補と実際の保存関数。ローカルdemoプロジェクト専用。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, getFirestore, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import sync from '../redesign-sync-coordinator.js';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8487') throw new Error('ローカル模擬環境専用です');
const app = initializeApp({ projectId: 'demo-kurashi', apiKey: 'demo', appId: 'demo' }, `sync-${randomUUID()}`);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8487, { mockUserToken: { sub: 'sync-user', user_id: 'sync-user' } });
const ref = doc(db, 'workspaces', `sync-${randomUUID()}`);
const original = { name: 'test', ownerUid: 'sync-user', memberUids: ['sync-user'], updatedBy: 'sync-user', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), state: { n: 0 } };
const save = (baseline, state, expectedRevision) => sync.saveSnapshot({ db, ref, uid: 'sync-user', baseline, state, expectedRevision, runTransaction, updatedAt: serverTimestamp() });
const failures = []; let total = 0;
async function check(name, fn) { total++; try { await fn(); } catch (error) { failures.push({ name, message: error.message }); } }
try {
  await setDoc(ref, original);
  await check('版のない既存家計から初回の保護付き保存', async () => {
    await save({ n: 0 }, { n: 1 }, 0);
    const data = (await getDocFromServer(ref)).data();
    assert.equal(data.revision, 1); assert.deepEqual(data.state, { n: 1 });
  });
  await check('所有者でも旧式の全体上書きを拒否', async () => {
    await assert.rejects(setDoc(ref, { state: { n: 0 }, updatedBy: 'sync-user' }, { merge: true }), /permission/i);
    assert.deepEqual((await getDocFromServer(ref)).data().state, { n: 1 });
  });
  await check('古い版と古い内容のどちらも保存しない', async () => {
    await assert.rejects(save({ n: 0 }, { n: 2 }, 0), /他の端末/);
    await assert.rejects(save({ n: 0 }, { n: 2 }, 1), /他の端末/);
    assert.equal((await getDocFromServer(ref)).data().revision, 1);
  });
  await check('同時保存を自動で古い内容に戻さない', async () => {
    const results = await Promise.allSettled([save({ n: 1 }, { n: 2 }, 1), save({ n: 1 }, { n: 3 }, 1)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const data = (await getDocFromServer(ref)).data(); assert.equal(data.revision, 2); assert.ok([2, 3].includes(data.state.n));
  });
  await check('家計名の変更は版を進めず実行できる', async () => {
    await updateDoc(ref, { name: 'renamed', updatedBy: 'sync-user', updatedAt: serverTimestamp() });
    const data = (await getDocFromServer(ref)).data(); assert.equal(data.name, 'renamed'); assert.equal(data.revision, 2);
  });
  await check('版の削除や不正な増分で保護を解除できない', async () => {
    await assert.rejects(setDoc(ref, original), /permission/i);
    await assert.rejects(updateDoc(ref, { revision: 4, state: { n: 4 } }), /permission/i);
    assert.equal((await getDocFromServer(ref)).data().revision, 2);
  });
  await check('メール候補と取引は同時に保存し、拒否時は両方を戻す', async () => {
    const candidateRef = id => doc(ref, 'importCandidates', id);
    const candidate = candidateRef('atomic');
    await setDoc(candidate, { sourcePackage: 'jcb.example', detectedAt: '2026-01-01T00:00:00Z', amount: 1000, type: 'purchase', status: 'pending', fingerprint: 'atomic' });
    try {
      const before = (await getDocFromServer(ref)).data();
      const accept = patch => sync.saveSnapshot({ db, ref, uid: 'sync-user', baseline: before.state, state: { transactions: [{ id: 'mail_atomic' }] }, expectedRevision: before.revision, runTransaction, updatedAt: serverTimestamp(), candidateRef, acceptances: [{ id: 'atomic', patch }] });
      await assert.rejects(accept({ status: 'accepted', invalidField: true }), /permission/i);
      assert.equal((await getDocFromServer(candidate)).data().status, 'pending');
      assert.deepEqual((await getDocFromServer(ref)).data().state, before.state);
      await updateDoc(candidate, { type: 'refund' });
      await assert.rejects(accept({ status: 'accepted' }), /返金・取消/);
      assert.equal((await getDocFromServer(candidate)).data().status, 'pending');
      assert.deepEqual((await getDocFromServer(ref)).data().state, before.state);
      await updateDoc(candidate, { type: 'purchase' });
      await accept({ status: 'accepted' });
      assert.equal((await getDocFromServer(candidate)).data().status, 'accepted');
      assert.equal((await getDocFromServer(ref)).data().state.transactions[0].id, 'mail_atomic');
    } finally { await deleteDoc(candidate); }
  });
  await check('新形式の家計へ旧画面から保存しない', async () => {
    const before = (await getDocFromServer(ref)).data();
    await updateDoc(ref, { state: { modelVersion: 1, bills: [] }, revision: 4 });
    await assert.rejects(save({ modelVersion: 1, bills: [] }, before.state, 4), /新形式/);
    assert.deepEqual((await getDocFromServer(ref)).data().state, { modelVersion: 1, bills: [] });
  });
} finally { await deleteDoc(ref).catch(() => {}); await deleteApp(app); }
console.log(JSON.stringify({ suite: 'sync-production-rules-emulator', total, passed: total - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
