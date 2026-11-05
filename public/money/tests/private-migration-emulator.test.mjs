/* 非公開の固定コピーをローカル模擬Firestoreだけに保存する。値は出力しない。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, getFirestore, runTransaction, setDoc } from 'firebase/firestore';
import migration from '../redesign-state-migration.js';
import billStore from '../redesign-bill-store.js';
process.once('uncaughtException', () => {
  console.log(JSON.stringify({ suite: 'private-migration-emulator', status: 'fail', privateValuesOmitted: true }));
  process.exitCode = 1;
});
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!['127.0.0.1:8487', '127.0.0.1:8488'].includes(emulatorHost)) throw new Error('ローカル模擬環境専用です');
const read = path => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const source = read(process.argv[2]), before = structuredClone(source);
const candidates = read(process.argv[3]).pending;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(source.exportedAt));
const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 89);
const converted = migration.migrateState({ state: source, today, endDate: end.toISOString().slice(0, 10), candidates });
const app = initializeApp({ projectId: 'demo-kurashi', apiKey: 'demo', appId: 'demo' }, `private-migration-${randomUUID()}`);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', Number(emulatorHost.split(':')[1]), { mockUserToken: { sub: 'migration-user', user_id: 'migration-user' } });
const ref = doc(db, 'workspaces', `private-migration-${randomUUID()}`);
let total = 0;
const pass = () => total++;
try {
  await setDoc(ref, { name: 'isolated-test', ownerUid: 'migration-user', memberUids: ['migration-user'],
    createdAt: 'test', updatedAt: 'test', updatedBy: 'migration-user', revision: 0, state: converted.migrated });
  const restored = (await getDocFromServer(ref)).data().state;
  assert.deepEqual(restored, converted.migrated); pass();
  assert.deepEqual(migration.assessMigrated(restored), migration.assessMigrated(converted.migrated)); pass();
  assert.deepEqual(restored.transactions, before.transactions);
  for (const key of ['cards', 'workEntries', 'recurringPlans', 'settings']) assert.deepEqual(restored[key], before[key]);
  pass();
  // 以下は保存機能の仮想事象。実際の請求額・引落を確認したという意味ではない。
  const bill = restored.bills.find(item => item.amount > 0);
  assert.ok(bill, '保存検査に使う仮想請求が必要です');
  const request = { db, ref, uid: 'migration-user', billId: bill.id, expectedRevision: 0, runTransaction,
    evidence: { issuerConfirmed: true, cardId: bill.cardId, cycle: bill.cycle, amount: bill.amount,
      checkedAt: `${today}T12:00:00+09:00`, source: 'issuer-app' } };
  await billStore.confirmBillGuarded(request);
  const confirmed = (await getDocFromServer(ref)).data();
  assert.deepEqual(confirmed.state.accounts, restored.accounts);
  assert.deepEqual(confirmed.state.transactions, before.transactions); pass();
  const debit = { ...request, expectedRevision: 1, input: { operationId: 'simulated-bank-operation', amount: bill.amount,
    date: bill.dueDate, today: bill.dueDate, bankConfirmed: true, balanceAlreadyIncludesDebit: false, expectedRevision: 0 } };
  await billStore.recordDebitGuarded(debit);
  await billStore.recordDebitGuarded(debit);
  const after = (await getDocFromServer(ref)).data();
  assert.equal(after.revision, 2);
  for (const account of after.state.accounts) {
    const old = restored.accounts.find(item => item.id === account.id);
    assert.equal(account.balance, old.balance - (account.id === bill.accountId ? bill.amount : 0));
  }
  assert.deepEqual(after.state.transactions, before.transactions); pass();
  assert.deepEqual(source, before); assert.deepEqual(converted.original, before); pass();
  console.log(JSON.stringify({ suite: 'private-migration-emulator', total, passed: total, failed: 0, scenario: 'real-copy-with-hypothetical-confirmation-and-debit', liveWrites: 0 }));
} finally {
  await deleteDoc(ref).catch(() => {});
  await deleteApp(app);
}
