/* demo-kurashi のローカル模擬環境専用。実データには接続しない。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, runTransaction, setDoc, deleteDoc } from 'firebase/firestore';
import lifecycle from '../redesign-bill-lifecycle.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8487') throw new Error('ローカル模擬環境専用です');
const apps = [0, 1].map(index => initializeApp({ projectId: 'demo-kurashi', apiKey: 'demo', appId: 'demo' }, `race-${randomUUID()}-${index}`));
const dbs = apps.map(app => {
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8487, { mockUserToken: { sub: 'race-user', user_id: 'race-user' } });
  return db;
});
const workspaceId = `race-${randomUUID()}`;
const refs = dbs.map(db => doc(db, 'workspaces', workspaceId));
const account = { id: 'a', balance: 50000, revision: 1 };
const bill = { id: 'b', accountId: 'a', amount: 10000, amountConfirmed: true, status: 'planned' };
const input = { operationId: 'op', amount: 10000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: false, expectedRevision: 1 };
const original = { name: '架空家計', ownerUid: 'race-user', memberUids: ['race-user'], createdAt: 1, updatedAt: 1, updatedBy: 'race-user', state: { account, bill, unrelated: 'keep' } };
async function settle(index, request) {
  return runTransaction(dbs[index], async tx => {
    const snapshot = await tx.get(refs[index]);
    if (!snapshot.exists()) throw new Error('家計がありません');
    const state = snapshot.data().state;
    const result = lifecycle.recordDebit({ account: state.account, bill: state.bill }, request);
    if (!result.alreadyApplied) tx.update(refs[index], { state: { ...state, account: result.account, bill: result.bill }, updatedBy: 'race-user' });
    return result.alreadyApplied;
  });
}
const failures = [];
async function check(name, fn) { try { await fn(); } catch (error) { failures.push({ name, message: error.message }); } }
try {
  await check('2端末で同じ引落を同時送信しても一度だけ引く', async () => {
    await setDoc(refs[0], original);
    const results = await Promise.all([settle(0, input), settle(1, input)]);
    assert.deepEqual(results.sort(), [false, true]);
    const state = (await getDoc(refs[0])).data().state;
    assert.equal(state.account.balance, 40000); assert.equal(state.bill.status, 'settled'); assert.equal(state.unrelated, 'keep');
  });
  await check('違う処理IDで同じ請求を同時送信しても二重に引かない', async () => {
    await setDoc(refs[0], original);
    const results = await Promise.allSettled([settle(0, input), settle(1, { ...input, operationId: 'different' })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await getDoc(refs[0])).data().state.account.balance, 40000);
  });
  await check('旧式の全体上書きは新しい残高を戻し得ることを検出', async () => {
    await setDoc(refs[0], original);
    const stale = (await getDoc(refs[1])).data().state;
    await settle(0, input);
    await setDoc(refs[1], { state: stale, updatedBy: 'race-user' }, { merge: true });
    assert.equal((await getDoc(refs[0])).data().state.account.balance, 50000);
  });
} finally {
  await deleteDoc(refs[0]).catch(() => {});
  await Promise.all(apps.map(deleteApp));
}
console.log(JSON.stringify({ suite: 'redesign-concurrency-emulator', total: 3, passed: 3 - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
