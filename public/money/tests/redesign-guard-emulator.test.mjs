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
let total = 0;
async function check(name, fn) { total++; try { await fn(); } catch (error) { failures.push({ name, message: error.message }); } }
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
  async function seedBill() {
    const before = (await getDocFromServer(verifierRef)).data();
    const state = { accounts: [{ id: 'a', balance: 50000, revision: 1 }], bills: [{ id: 'b', cardId: 'jcb', cycle: '2026-11', accountId: 'a', amount: 10000, amountConfirmed: false, status: 'planned' }], transactions: [{ id: 'keep' }] };
    await guard.saveGuarded({ db: verifier, ref: verifierRef, expectedRevision: before.revision, state, uid: 'guard-user', runTransaction });
    return { db: verifier, ref: verifierRef, uid: 'guard-user', billId: 'b', expectedRevision: before.revision + 1, evidence: { issuerConfirmed: true, cardId: 'jcb', cycle: '2026-11', amount: 12000, checkedAt: '2026-11-01T12:00:00+09:00', source: 'issuer-app' }, runTransaction };
  }
  await check('請求額確定は残高を変えず根拠と版番号を保存', async () => {
    const request = await seedBill();
    const before = (await getDocFromServer(verifierRef)).data();
    await billStore.confirmBillGuarded(request);
    const after = (await getDocFromServer(verifierRef)).data();
    assert.deepEqual(after.state.accounts, before.state.accounts);
    assert.deepEqual(after.state.transactions, before.state.transactions);
    assert.equal(after.state.bills[0].amount, 12000);
    assert.equal(after.state.bills[0].amountConfirmed, true);
    assert.equal(after.state.bills[0].status, 'planned');
    assert.equal(after.state.bills[0].confirmationEvidence.checkedAt, request.evidence.checkedAt);
    assert.equal(after.revision, before.revision + 1);
    await assert.rejects(billStore.confirmBillGuarded(request), /他端末/);
  });
  await check('別カード・別期間・金額のない確定通知は保存しない', async () => {
    const request = await seedBill();
    const before = (await getDocFromServer(verifierRef)).data();
    for (const changes of [{ cardId: 'other' }, { cycle: '2026-12' }, { amount: undefined }, { issuerConfirmed: false }, { source: 'email-notice' }, { checkedAt: '2026-02-30T12:00:00+09:00' }]) {
      await assert.rejects(billStore.confirmBillGuarded({ ...request, evidence: { ...request.evidence, ...changes } }));
    }
    assert.deepEqual((await getDocFromServer(verifierRef)).data(), before);
  });
  await check('残高反映済みの実引落は二重控除しない', async () => {
    const request = await seedBill();
    const confirmed = await billStore.confirmBillGuarded(request);
    const debit = { ...request, expectedRevision: confirmed.revision, input: { operationId: 'included-op', amount: 12000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: true, expectedRevision: 1 } };
    await billStore.recordDebitGuarded(debit);
    await billStore.recordDebitGuarded(debit);
    const state = (await getDocFromServer(verifierRef)).data().state;
    assert.equal(state.accounts[0].balance, 50000);
    assert.equal(state.accounts[0].revision, 2);
    assert.equal(state.bills[0].status, 'settled');
    await assert.rejects(billStore.confirmBillGuarded({ ...request, expectedRevision: confirmed.revision + 1 }), /引落済み/);
  });
  await check('請求と異なる実引落額は確認を求め保存しない', async () => {
    const request = await seedBill();
    const confirmed = await billStore.confirmBillGuarded(request);
    const before = (await getDocFromServer(verifierRef)).data();
    await assert.rejects(billStore.recordDebitGuarded({ ...request, expectedRevision: confirmed.revision, input: { operationId: 'different-op', amount: 10000, date: '2026-11-10', today: '2026-11-10', bankConfirmed: true, balanceAlreadyIncludesDebit: false, expectedRevision: 1 } }), /請求額/);
    assert.deepEqual((await getDocFromServer(verifierRef)).data(), before);
  });
} finally {
  await deleteDoc(verifierRef).catch(() => {});
  await deleteApp(app);
  await deleteApp(verifierApp);
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => proxy.close(resolve));
}
console.log(JSON.stringify({ suite: 'redesign-guard-emulator', total, passed: total - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
