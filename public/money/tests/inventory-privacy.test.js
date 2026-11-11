#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'firebase-sync.js'), 'utf8');
const start = source.indexOf('async function addToInventory(plan)');
const end = source.indexOf('/** レシートの状態', start);
if (start < 0 || end < 0) throw new Error('在庫追加処理が見つかりません');
async function exercise(householdId) {
  const calls = [];
  const batch = { set: (ref, data) => calls.push({ method: 'set', ref, data }), update: (ref, data) => calls.push({ method: 'update', ref, data }), commit: async () => {} };
  const box = { connected: () => true, currentWorkspace: { id: 'private-workspace' }, householdId, db: {}, writeBatch: () => batch, inventoryCol: () => 'items', doc: (...parts) => parts.length === 1 ? { id: 'new-item' } : { id: parts.at(-1) }, Date };
  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);
  const result = await box.addToInventory({ creates: [{ locationId: 'shelf', name: '食品', quantity: 1, unit: '個', category: '食品', purchaseRef: 'receipt#1', purchasePrice: 100, lineId: 'line1' }], merges: [] });
  return { result, calls };
}
(async () => {
  const failures = [], cases = [
    ['共有在庫は購入金額なしで作り、レシートとの連携を保つ', async () => {
      const { calls } = await exercise('shared-house');
      const item = calls.find(call => call.method === 'set').data;
      assert.equal(Object.hasOwn(item, 'purchasePrice'), false);
      assert.equal(item.purchaseWorkspaceId, 'private-workspace');
      assert.equal(calls.find(call => call.method === 'update').data.inventoryItemId, 'new-item');
    }],
    ['個人在庫の既存の購入金額は維持する', async () => {
      const { calls } = await exercise(null);
      assert.equal(calls.find(call => call.method === 'set').data.purchasePrice, 100);
    }]
  ];
  for (const [name, fn] of cases) { try { await fn(); } catch (error) { failures.push({ name, message: error.message }); } }
  console.log(JSON.stringify({ suite: 'inventory-privacy', total: cases.length, passed: cases.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
