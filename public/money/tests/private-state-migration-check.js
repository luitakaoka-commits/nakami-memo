#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { migrateState, assessMigrated } = require('../redesign-state-migration.js');
const { buildLegacyScenario } = require('../redesign-legacy-adapter.js');
const { calculateReadiness } = require('../redesign-readiness.js');
process.once('uncaughtException', () => {
  console.log(JSON.stringify({ suite: 'private-state-migration', status: 'fail', privateValuesOmitted: true }));
  process.exitCode = 1;
});
const read = path => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const state = read(process.argv[2]);
const candidates = read(process.argv[3]).pending;
const before = structuredClone(state);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(state.exportedAt));
const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 89);
const endDate = end.toISOString().slice(0, 10);
const result = migrateState({ state, today, endDate, candidates });
assert.deepEqual(state, before);
assert.deepEqual(result.original, before);
assert.deepEqual(result.migrated.transactions, before.transactions);
for (const key of ['cards', 'workEntries', 'recurringPlans', 'settings', 'meta']) assert.deepEqual(result.migrated[key], before[key]);
assert.equal(result.migrated.accounts.length, before.accounts.length);
for (const account of result.migrated.accounts) {
  assert.equal(account.balance, before.accounts.find(item => item.id === account.id).currentBalance);
  assert.equal(account.balanceVerified, false);
  assert.equal(account.revision, 0);
  assert.equal('currentBalance' in account, false);
}
const baseline = calculateReadiness(buildLegacyScenario(before, today, endDate, { candidates }).scenario);
assert.deepEqual(assessMigrated(result.migrated), baseline);
assert.deepEqual(JSON.parse(JSON.stringify(result)).original, before);
assert.throws(() => migrateState({ state: result.migrated, today, endDate, candidates }));
console.log(JSON.stringify({ suite: 'private-state-migration', status: 'pass', accounts: result.migrated.accounts.length, transactions: result.migrated.transactions.length, bills: result.migrated.bills.length, originalUnchanged: true, serializedOriginalPreserved: true, forecastUnchanged: true, sourceCompleteness: 'unverified', liveWrites: 0 }));
