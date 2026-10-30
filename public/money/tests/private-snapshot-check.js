#!/usr/bin/env node
/* 指定されたローカルの家計コピーのみをメモリ上で検証する。値は出力・保存しない。 */
'use strict';
const fs = require('node:fs');
const { previewLegacy } = require('../redesign-legacy-preview.js');
const { previewSpendable } = require('../redesign-spendable-preview.js');
const source = process.argv[2];
if (!source) throw new Error('テスト用の家計コピーを指定してください');
const state = JSON.parse(fs.readFileSync(source, 'utf8'));
const exported = new Date(state.exportedAt);
if (!Number.isFinite(exported.getTime())) throw new Error('書き出し日時を確認してください');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(exported);
const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 89);
const endDate = end.toISOString().slice(0, 10);
if (!Array.isArray(state.cards)) throw new Error('カード一覧を確認してください');
const selected = state.cards.filter(card => /JCB|SMBC|三井住友|MUFG/i.test(card.name || ''));
if (selected.length !== 3) throw new Error('基準カードを3枚に特定できません');
const ids = selected.map(card => card.id);
const main = previewLegacy({ state, today, endDate, selectedCardIds: ids });
const supplemental = previewSpendable({ state, today, selectedCardIds: ids });
const issues = {};
for (const issue of main.issues) issues[issue.type] = (issues[issue.type] || 0) + 1;
console.log(JSON.stringify({ suite: 'private-snapshot', asOf: today, endDate, deadline: main.period.deadline, counts: { accounts: state.accounts.length, cards: state.cards.length, transactions: state.transactions.length, workEntries: (state.workEntries || []).length }, nextStatus: main.assessment.nextStatus, futureStatus: main.assessment.futureStatus, supplementalReferenceOnly: supplemental.referenceOnly, issues }));
