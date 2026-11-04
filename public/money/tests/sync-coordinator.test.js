'use strict';
const assert = require('node:assert/strict');
const { createCoordinator, canonical, readRecovery } = require('../redesign-sync-coordinator.js');
const failures = []; let total = 0;
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const check = async (name, fn) => { total++; try { await fn(); } catch (error) { failures.push({ name, message: error.message }); } };
function setup(write = async request => request.expectedRevision + 1, retain) {
  const applied = [], statuses = [], held = [];
  const saver = createCoordinator({ write, applyRemote: value => applied.push(value), onStatus: (status, error) => statuses.push({ status, error }), retain: retain || (value => held.push(structuredClone(value))), clearRetained: () => held.splice(0) });
  return { saver, applied, statuses, held };
}
(async () => {
  await check('正常保存でのみ退避を解除する', async () => {
    const { saver, held, statuses } = setup(); saver.receive({ n: 0 }, 0); saver.enqueue({ n: 1 });
    assert.equal(held.length, 1); await saver.flush();
    assert.equal(held.length, 0); assert.equal(saver.isDirty(), false); assert.equal(statuses.at(-1).status, 'saved');
  });
  await check('待機中に他端末が更新したら送らずローカルを保持する', async () => {
    let writes = 0; const { saver, applied, held } = setup(async () => { writes++; });
    saver.receive({ n: 0 }, 0); saver.enqueue({ n: 1 }); saver.receive({ n: 2 }, 1); await saver.flush();
    assert.equal(writes, 0); assert.deepEqual(applied, [{ n: 0 }]); assert.deepEqual(held, [{ n: 1 }]); assert.equal(saver.isBlocked(), true);
  });
  await check('保存中の連続編集は直列化し新しい版で保存する', async () => {
    const gate = defer(), calls = [];
    const { saver, held } = setup(async request => { calls.push(request); if (calls.length === 1) await gate.promise; return request.expectedRevision + 1; });
    saver.receive({ n: 0 }, 0); saver.enqueue({ n: 1 }); const running = saver.flush();
    saver.enqueue({ n: 2 }); assert.equal(saver.flush(), running); gate.resolve(); await running;
    assert.equal(calls.length, 2); assert.equal(calls[1].expectedRevision, 1); assert.deepEqual(calls[1].baseline, { n: 1 }); assert.deepEqual(calls[1].state, { n: 2 }); assert.equal(held.length, 0);
  });
  await check('自分の保存通知で編集中の内容を上書きしない', async () => {
    const gate = defer(); const { saver, applied } = setup(async request => { await gate.promise; return request.expectedRevision + 1; });
    saver.receive({ n: 0 }, 0); saver.enqueue({ n: 1 }); const running = saver.flush();
    saver.enqueue({ n: 2 }); saver.receive({ n: 1 }, 1); assert.deepEqual(applied, [{ n: 0 }]); gate.resolve(); await running;
    assert.equal(saver.isBlocked(), false);
  });
  await check('保存中の別端末更新では最新の未保存変更を残す', async () => {
    const gate = defer(); let writes = 0;
    const { saver, held } = setup(async () => { writes++; await gate.promise; return 1; });
    saver.receive({ n: 0 }, 0); saver.enqueue({ n: 1 }); const running = saver.flush();
    saver.enqueue({ n: 2 }); saver.receive({ n: 3 }, 1); gate.resolve(); await running;
    assert.equal(writes, 1); assert.equal(saver.isBlocked(), true); assert.deepEqual(held.at(-1), { n: 2 });
  });
  await check('通信失敗では保存済みにせず再送を停止する', async () => {
    const held = [], gate = defer();
    const { saver, statuses } = setup(async () => { await gate.promise; throw Error('offline'); }, (state, metadata) => held.push({ state, ...metadata }));
    const first = { id: 'one', patch: { status: 'accepted' } }, second = { id: 'two', patch: { status: 'accepted' } };
    saver.receive({ n: 0 }, 0); saver.enqueue({ n: 1 }, first); const saving = saver.flush();
    saver.enqueue({ n: 2 }, second); gate.resolve(); await saving;
    assert.deepEqual(held.at(-1), { state: { n: 2 }, baselineRevision: 0, acceptances: [first, second] });
    saver.enqueue({ n: 3 }); saver.receive({ n: 4 }, 1);
    assert.deepEqual(held.at(-1), { state: { n: 3 }, baselineRevision: 0, acceptances: [first, second] });
    const storage = { length: 0, getItem: key => key === 'okane-unsaved:user:home'
      ? JSON.stringify({ format: 'money-unsaved-entry-v2', ...held.at(-1) }) : null };
    assert.deepEqual(readRecovery(storage, 'user', 'home').snapshots, [{ kind: 'pending', ...held.at(-1) }]);
    assert.equal(saver.isDirty(), true); assert.equal(saver.isBlocked(), true); assert.equal(statuses.at(-1).status, 'error');
  });
  await check('退避できない場合は送らない', async () => {
    let writes = 0; const { saver } = setup(async () => { writes++; }, () => { throw Error('quota'); });
    saver.receive({ n: 0 }, 0); assert.throws(() => saver.enqueue({ n: 1 }), /quota/); await saver.flush(); assert.equal(writes, 0);
  });
  await check('キー順序の違いだけでは競合としない', async () => {
    const { saver } = setup(); saver.receive({ a: 1, b: 2 }, 0); saver.enqueue({ a: 2, b: 2 }); saver.receive({ b: 2, a: 1 }, 0); await saver.flush(); assert.equal(saver.isBlocked(), false);
    assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
  });
  await check('初回読込前の保存と不正な版番号を拒否する', () => {
    const { saver } = setup(); assert.throws(() => saver.enqueue({ n: 1 })); assert.throws(() => saver.receive({ n: 0 }, null));
  });
  await check('保存応答の版が不正なら退避を消さない', async () => {
    const { saver, held } = setup(async () => 7); saver.receive({ n: 0 }, 0); saver.enqueue({ n: 1 }); await saver.flush(); assert.equal(saver.isBlocked(), true); assert.equal(held.length, 1);
  });
  console.log(JSON.stringify({ suite: 'sync-coordinator', total, passed: total - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
  if (failures.length) process.exitCode = 1;
})();
