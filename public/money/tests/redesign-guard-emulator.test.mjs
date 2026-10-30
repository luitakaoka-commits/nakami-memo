/* ローカルのdemo-kurashi専用。試作ルールは本番に適用しない。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocFromServer, getFirestore, runTransaction, setDoc } from 'firebase/firestore';
import guard from '../redesign-guarded-save.js';
import billStore from '../redesign-bill-store.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8488') throw new Error('ローカル模擬環境専用です');
const app = initializeApp({ projectId: 'demo-kurashi', apiKey: 'demo', appId: 'demo' }, `guard-${randomUUID()}`);
const verifierApp = initializeApp({ projectId: 'demo-kurashi', apiKey: 'demo', appId: 'demo' }, `verifier-${randomUUID()}`);
const verifier = getFirestore(verifierApp);
connectFirestoreEmulator(verifier, '127.0.0.1', 8488, { mockUserToken: { sub: 'guard-user', user_id: 'guard-user' } });
const db = getFirestore(app);
let disconnected = false;
const sockets = new Set();
const proxy = net.createServer(client => {
  if (disconnected) { client.destroy(); return; }
  const server = net.connect(8488, '127.0.0.1');
  sockets.add(client); sockets.add(server);
  client.on('error', () => {}); server.on('error', () => client.destroy());
  client.on('close', () => { sockets.delete(client); server.destroy(); });
  server.on('close', () => { sockets.delete(server); client.destroy(); });
  client.pipe(server).pipe(client);
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
connectFirestoreEmulator(db, '127.0.0.1', proxy.address().port, { mockUserToken: { sub: 'guard-user', user_id: 'guard-user' } });
const workspaceId = `guard-${randomUUID()}`;
const ref = doc(db, 'workspaces', workspaceId);
const verifierRef = doc(verifier, 'workspaces', workspaceId);
const original = { ownerUid: 'guard-user', memberUids: ['guard-user'], updatedBy: 'guard-user', revision: 0, state: { balance: 50000 } };
async function guardedSave(expected, state) {
  return guard.saveGuarded({ db, ref, expectedRevision: expected, state, uid: 'guard-user', runTransaction: (database, action) => runTransaction(database, action, { maxAttempts: 1 }) });
}
const failures = [];
async function check(name, fn) { try { await fn(); } catch (error) { failures.push({ name, message: error.message }); } }
try {
  await setDoc(ref, original);
  await check('最新の版で保存後、古い版の保存を拒否', async () => {
    await guardedSave(0, { balance: 40000 });
    await assert.rejects(guardedSave(0, { balance: 50000 }), /他端末/);
    assert.equal((await getDoc(ref)).data().state.balance, 40000);
  });
  await check('旧式の版を更新しない全体上書きを拒否', async () => {
    await assert.rejects(setDoc(ref, { state: { balance: 50000 }, updatedBy: 'guard-user' }, { merge: true }), /permission|権限/i);
    assert.equal((await getDoc(ref)).data().state.balance, 40000);
  });
  await check('同じ版からの同時保存は一方だけ成功', async () => {
    const results = await Promise.allSettled([guardedSave(1, { balance: 30000 }), guardedSave(1, { balance: 35000 })]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter(item => item.status === 'rejected').length, 1);
    const data = (await getDoc(ref)).data();
    assert.equal(data.revision, 2); assert.ok([30000, 35000].includes(data.state.balance));
  });
  await check('通信不能時はトランザクションを保存済みにしない', async () => {
    const before = (await getDoc(ref)).data();
    disconnected = true;
    for (const socket of sockets) socket.destroy();
    try {
      await assert.rejects(guardedSave(before.revision, { balance: 1 }));
    } finally {
      disconnected = false;
    }
    const after = (await getDocFromServer(verifierRef)).data();
    assert.equal(after.revision, before.revision);
    assert.equal(after.state.balance, before.state.balance);
  });
  await check('請求と残高を同時保存し再送で二重に減らさない', async () => {
    const before = (await getDocFromServer(verifierRef)).data();
    const newState = { accounts: [{ id: 'a', balance: 50000, revision: 1 }], bills: [{ id: 'b', accountId: 'a', amount: 10000, amountConfirmed: true, status: 'planned' }], note: 'keep' };
    await guard.saveGuarded({ db: verifier, ref: verifierRef, expectedRevision: before.revision, state: newState, uid: 'guard-user', runTransaction });
    const expectedRevision = before.revision + 1;
    const request = { db: verifier, ref: verifierRef, uid: 'guard-user', billId: 'b', expectedRevision, input: { operationId: 'bank-op', amount: 10000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: false, expectedRevision: 1 }, runTransaction };
    const first = await billStore.recordDebitGuarded(request);
    const again = await billStore.recordDebitGuarded(request);
    assert.equal(first.alreadyApplied, false); assert.equal(again.alreadyApplied, true);
    const state = (await getDocFromServer(verifierRef)).data().state;
    assert.equal(state.accounts[0].balance, 40000); assert.equal(state.bills[0].status, 'settled'); assert.equal(state.note, 'keep');
    await assert.rejects(billStore.recordDebitGuarded({ ...request, input: { ...request.input, operationId: 'other' } }), /引落済み/);
  });
} finally {
  await deleteDoc(verifierRef).catch(() => {});
  await deleteApp(app);
  await deleteApp(verifierApp);
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => proxy.close(resolve));
}
console.log(JSON.stringify({ suite: 'redesign-guard-emulator', total: 5, passed: 5 - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
