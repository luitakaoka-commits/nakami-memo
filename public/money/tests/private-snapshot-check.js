#!/usr/bin/env node
/* 指定されたローカルの家計コピーのみをメモリ上で検証する。値は出力・保存しない。 */
'use strict';
const fs = require('node:fs');
const { previewLegacy } = require('../redesign-legacy-preview.js');
const { previewSpendable } = require('../redesign-spendable-preview.js');
const { buildLegacyScenario } = require('../redesign-legacy-adapter.js');
const { spendingAllowance } = require('../redesign-readiness.js');
const source = process.argv[2];
if (!source) throw new Error('テスト用の家計コピーを指定してください');
const state = JSON.parse(fs.readFileSync(source, 'utf8'));
const candidatePath = process.argv[3];
const capture = candidatePath ? JSON.parse(fs.readFileSync(candidatePath, 'utf8').replace(/^\uFEFF/, '')) : null;
const candidates = capture?.pending;
if (capture && (!Array.isArray(candidates) || candidates.length !== capture.displayedCounts?.pending + capture.displayedCounts?.needs_review)) throw new Error('候補画面の件数が一致しません');
const exported = new Date(state.exportedAt);
if (!Number.isFinite(exported.getTime())) throw new Error('書き出し日時を確認してください');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(exported);
const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 89);
const endDate = end.toISOString().slice(0, 10);
if (!Array.isArray(state.cards)) throw new Error('カード一覧を確認してください');
const selected = state.cards.filter(card => /JCB|SMBC|三井住友|MUFG/i.test(card.name || ''));
if (selected.length !== 3) throw new Error('基準カードを3枚に特定できません');
const ids = selected.map(card => card.id);
const main = previewLegacy({ state, today, endDate, selectedCardIds: ids, candidates });
const supplemental = previewSpendable({ state, today, selectedCardIds: ids, candidates });
const { scenario } = buildLegacyScenario(state, today, endDate, { candidates });
const active = scenario.events.filter(event => event.status === 'planned' && event.date >= today && event.date <= endDate);
const dates = [...new Set(active.map(event => event.date))].sort();
const sum = events => events.reduce((total, event) => total + event.amount, 0);
let cardChecks = 0, shortageChecks = 0;
for (const account of scenario.accounts) {
  for (const date of dates) {
    const outgoing = active.filter(event => event.accountId === account.id && event.kind !== 'income' && event.date <= date);
    const incoming = active.filter(event => event.date <= date && ((event.kind === 'income' && event.accountId === account.id) || (event.kind === 'transfer' && event.toAccountId === account.id)));
    const endBalance = account.balance - sum(outgoing) + sum(incoming);
    const cards = outgoing.filter(event => event.date === date && event.cardPayment);
    const rows = main.assessment.timeline.filter(row => row.date === date && row.accountId === account.id);
    const shortfalls = main.assessment.issues.filter(issue => issue.type === 'projected_shortfall' && issue.date === date && issue.accountId === account.id && issue.phase !== 'opening');
    if (shortfalls.length !== Number(endBalance < 0) || (shortfalls.length && shortfalls[0].amount !== -endBalance)) throw new Error('口座別の予測不足額が独立集計と一致しません');
    shortageChecks += 1;
    if (rows.length !== Number(cards.length > 0)) throw new Error('カード引落の予測行が不足または重複しています');
    if (cards.length) {
      const beforeCredits = endBalance - sum(incoming.filter(event => event.date === date));
      if (rows[0].projectedBalance !== beforeCredits || rows[0].cardAmount !== sum(cards)) throw new Error('カード引落時点の残高が独立集計と一致しません');
      cardChecks += 1;
    }
  }
}
const forecastChecks = { cardChecks, shortageChecks, events: Object.fromEntries(['expense', 'income', 'transfer'].map(kind => [kind, active.filter(event => event.kind === kind).length])) };
const funding = state.accounts.find(account => account.isPrimary) || state.accounts.find(account => account.role === 'primary') || state.accounts[0];
const reserve = Number(state.settings?.defenseLine || 0);
const deadline = main.period.deadline;
const fundingOutflows = active.filter(event => event.accountId === funding.id && event.kind !== 'income');
const cost = events => sum(events) + events.reduce((total, event) => total + (event.additionalPossible || 0), 0);
const before = fundingOutflows.filter(event => event.date <= deadline);
const after = fundingOutflows.filter(event => event.date > deadline);
const expected = funding.currentBalance - cost(before) - cost(after) - reserve;
const allowance = spendingAllowance(scenario, { deadline, accountId: funding.id, reserve });
if (allowance.openingBalance !== funding.currentBalance || allowance.throughDeadline !== cost(before)
  || allowance.afterDeadline !== cost(after) || allowance.reserve !== reserve || allowance.amount !== expected
  || allowance.referenceOnly !== true) throw new Error('締め日までの参考額または内訳が独立集計と一致しません');
const allowanceCheck = { beforeCount: before.length, afterCount: after.length, excludedIncome: active.filter(event => event.accountId === funding.id && event.kind === 'income').length, referenceOnly: allowance.referenceOnly };
const issues = {};
for (const issue of main.issues) issues[issue.type] = (issues[issue.type] || 0) + 1;
const candidateSummary = candidates ? {
  count: candidates.length,
  rawCollectionComplete: capture.completeRawCollection === true,
  amountMissing: candidates.filter(item => item.amount == null).length,
  possibleExistingTransactions: candidates.filter(item => item.amount != null && item.merchant && state.transactions.some(tx => tx.amount === item.amount && tx.transactionDate === item.usedDate && (tx.memo || '').includes(item.merchant))).length
} : null;
if (candidates?.length && (main.assessment.nextStatus === 'safe' || main.assessment.futureStatus === 'safe')) throw new Error('未確認候補を含むデータを安全と判定しています');
console.log(JSON.stringify({ suite: 'private-snapshot', asOf: today, endDate, deadline: main.period.deadline, counts: { accounts: state.accounts.length, cards: state.cards.length, transactions: state.transactions.length, workEntries: (state.workEntries || []).length }, candidates: candidateSummary, nextStatus: main.assessment.nextStatus, futureStatus: main.assessment.futureStatus, supplementalReferenceOnly: supplemental.referenceOnly, forecastChecks, allowanceCheck, issues }));
