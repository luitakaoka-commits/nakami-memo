/* 公開用ルール候補と実際の保存関数。ローカルdemoプロジェクト専用。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, getFirestore, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import sync from '../redesign-sync-coordinator.js';
import refunds from '../redesign-refund.js';
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
      await assert.rejects(updateDoc(candidate, { status: 'ignored' }), /permission/i);
      assert.equal((await getDocFromServer(candidate)).data().status, 'accepted');
      const ignored = candidateRef('ignored');
      await setDoc(ignored, { sourcePackage: 'jcb.example', detectedAt: '2026-01-01T00:00:00Z', amount: 1000, type: 'purchase', status: 'pending', fingerprint: 'ignored' });
      try {
        await updateDoc(ignored, { status: 'ignored' });
        await assert.rejects(updateDoc(ignored, { status: 'accepted' }), /permission/i);
        assert.equal((await getDocFromServer(ignored)).data().status, 'ignored');
      } finally { await deleteDoc(ignored); }
    } finally { await deleteDoc(candidate); }
  });
  await check('照合済みの返金だけを候補と一緒に保存する', async () => {
    const refundWorkspace = doc(db, 'workspaces', 'refund-' + randomUUID());
    const candidateRef = id => doc(refundWorkspace, 'importCandidates', id);
    const candidate = { id: 'refund', sourcePackage: 'test.example', detectedAt: '2026-11-04T00:00:00Z', amount: 1000, type: 'refund', status: 'pending', fingerprint: 'refund-fingerprint' };
    const { id, ...candidateData } = candidate;
    const purchase = { id: 'purchase', kind: 'payment', entryType: 'itemized', status: 'planned', amount: 3000, cardId: 'card', sourceAccountId: 'a', transactionDate: '2026-11-01', dueDate: '2026-12-10' };
    const state = { cards: [{ id: 'card', accountId: 'a', closingDay: 15, paymentDay: 10 }], transactions: [purchase] };
    await setDoc(refundWorkspace, { ...original, state });
    await setDoc(candidateRef(id), candidateData);
    try {
      const prepared = refunds.preparePendingRefund({ state, candidate, targetId: purchase.id, amount: 1000, confirmed: true });
      const saveRefund = entry => sync.saveSnapshot({
        db, ref: refundWorkspace, uid: 'sync-user', baseline: state,
        state: { ...state, transactions: [purchase, entry] }, expectedRevision: 0,
        runTransaction, updatedAt: serverTimestamp(), candidateRef,
        acceptances: [{ id, patch: { status: 'accepted', amount: 1000 }, refundTarget: purchase.id }]
      });
      await assert.rejects(saveRefund({ ...prepared.transaction, amount: -1001 }), /保存条件/);
      assert.deepEqual((await getDocFromServer(refundWorkspace)).data().state, state);
      assert.equal((await getDocFromServer(candidateRef(id))).data().status, 'pending');
      await saveRefund(prepared.transaction);
      assert.equal((await getDocFromServer(refundWorkspace)).data().state.transactions[1].amount, -1000);
      assert.equal((await getDocFromServer(candidateRef(id))).data().status, 'accepted');
      const later = { ...candidateData, amount: 500, fingerprint: 'later-refund' };
      const laterId = 'later-refund';
      await setDoc(candidateRef(laterId), later);
      try {
        const baseline = (await getDocFromServer(refundWorkspace)).data().state;
        const statement = { ...purchase, id: 'next-bill', entryType: 'statement', amount: 20000, dueDate: '2027-01-12',
          statementEvidence: { source: 'issuer-manual', cardId: 'card', accountId: 'a', amount: 20000, dueDate: '2027-01-12', cycle: '2026-12', checkedAt: '2026-12-30T00:00:00Z' } };
        const amended = { ...baseline, transactions: [...baseline.transactions, statement] };
        const result = refunds.preparePendingRefund({ state: amended, candidate: { ...later, id: laterId },
          targetId: purchase.id, amount: 500, confirmed: true, destinationStatementId: statement.id });
        assert.equal(result.status, 'ready');
        await sync.saveSnapshot({ db, ref: refundWorkspace, uid: 'sync-user', baseline, expectedRevision: 1, runTransaction,
          updatedAt: serverTimestamp(), candidateRef, state: { ...amended, transactions: [...amended.transactions, result.transaction] },
          acceptances: [{ id: laterId, patch: { status: 'accepted', amount: 500 }, refundTarget: purchase.id, destinationStatementId: statement.id }] });
        const stored = (await getDocFromServer(refundWorkspace)).data().state.transactions;
        assert.equal(stored.find(item => item.id === statement.id).amount, 20000);
        assert.equal(stored.find(item => item.id === 'mail_' + laterId).absorbedBy, statement.id);
      } finally { await deleteDoc(candidateRef(laterId)); }
    } finally {
      await deleteDoc(candidateRef(id));
      await deleteDoc(refundWorkspace);
    }
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
