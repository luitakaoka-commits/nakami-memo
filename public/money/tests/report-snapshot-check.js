#!/usr/bin/env node
/* 利用者指定の資料をメモリ上で読み、資料時点に固定して検算する。保存・通信はしない。 */
'use strict';
const fs = require('node:fs');
const { calculateReadiness } = require('../redesign-readiness.js');
const path = process.argv[2];
if (!path) throw new Error('資金繰り資料のパスを指定してください');
const text = fs.readFileSync(path, 'utf8');
const section = text.split('### 12/10までの資金推移（食費・日用品の支出前）')[1]?.split('### 食費の算定')[0];
if (!section) throw new Error('対象の資金推移表が見つかりません');
const rows = section.split(/\r?\n/).filter(line => /^\|\s*\d{1,2}\/\d{1,2}/.test(line));
if (rows.length !== 9) throw new Error('対象の表の行数が想定と異なります');
const yen = value => {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) throw new Error('表の金額を読み取れません');
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) throw new Error('表の金額が不正です');
  return number;
};
const cells = rows.map(line => line.split('|').slice(1, 4).map(value => value.trim()));
const opening = yen(cells[0][2]);
let arithmetic = opening;
const events = [], expected = new Map();
for (const [label, movement, balance] of cells.slice(1)) {
  const parts = /^(\d{1,2})\/(\d{1,2})/.exec(label);
  if (!parts || !/^[＋−]/.test(movement)) throw new Error('表の日付または入出金を読み取れません');
  const date = `2026-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  const incoming = movement.startsWith('＋'), amount = yen(movement);
  arithmetic += incoming ? amount : -amount;
  if (arithmetic !== yen(balance)) throw new Error(`資料の手計算が一致しません: ${date}`);
  expected.set(date, arithmetic);
  events.push({ id: date, date, accountId: 'account', kind: incoming ? 'income' : 'expense', amount, status: 'planned', ...(incoming ? {} : { cardPayment: true, amountConfirmed: false }) });
}
const result = calculateReadiness({ today: '2026-10-28', endDate: '2026-12-10', accounts: [{ id: 'account', balance: opening, balanceVerified: false }], events, coverageVerified: false });
const mismatches = result.timeline.filter(row => row.projectedBalance !== expected.get(row.date)).map(row => row.date);
const failures = [];
if (result.timeline.length !== 5 || mismatches.length) failures.push({ check: 'card_balances', mismatches });
if (result.timeline.some(row => row.status === 'safe') || result.futureStatus === 'safe') failures.push({ check: 'unconfirmed_not_safe' });
const transferSection = text.match(/三井住友銀行([\d,]+)円が現在も残っており[^\n]*\r?\n[^\n]*仮に([\d,]+)円を移せば12\/10後の追加支出前はUFJ([\d,]+)円・三井住友([\d,]+)円/);
if (!transferSection) throw new Error('資料の振替案を読み取れません');
const [sourceBalance, transferAmount, expectedTarget, expectedSource] = transferSection.slice(1).map(yen);
const withTransfer = calculateReadiness({
  today: '2026-10-28', endDate: '2026-12-10', coverageVerified: false,
  accounts: [{ id: 'account', balance: opening, balanceVerified: false }, { id: 'source', balance: sourceBalance, balanceVerified: false }],
  events: [{ id: 'proposed-transfer', date: '2026-10-28', accountId: 'source', toAccountId: 'account', kind: 'transfer', status: 'planned', amount: transferAmount }, ...events]
});
const originalLast = result.timeline.at(-1), transferLast = withTransfer.timeline.at(-1);
if (transferLast?.projectedBalance !== originalLast.projectedBalance + transferAmount
  || transferLast.projectedBalance + (sourceBalance - transferAmount) !== originalLast.projectedBalance + sourceBalance
  || transferLast.confirmedBalance !== originalLast.confirmedBalance
  || withTransfer.futureStatus === 'safe') failures.push({ check: 'proposed_transfer' });
const transferSourceMatches = transferLast?.projectedBalance === expectedTarget && sourceBalance - transferAmount === expectedSource;
console.log(JSON.stringify({ suite: 'report-snapshot', asOf: '2026-10-28', sourceRows: rows.length, cardChecks: result.timeline.length, transferScenario: !failures.some(failure => failure.check === 'proposed_transfer'), transferSourceStatus: transferSourceMatches ? 'matches' : 'review', passed: failures.length === 0, failures }));
if (failures.length) process.exitCode = 1;
