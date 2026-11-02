#!/usr/bin/env node
'use strict';
// 非公開の固定コピーを読むだけの照合。金額・店名・ID・本文は出力しない。
const fs = require('node:fs');
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

function reconcile(state, facts, cardName, cardText) {
  const cards = state.cards.filter(card => card.name === cardName);
  if (cards.length !== 1 || !cardText || !facts.length) throw new Error('カードと通知の対象を明示してください');
  const counts = { notices: facts.length, foreign: 0, cardEvidenceMismatch: 0, uniqueMatches: 0, unmatched: 0, ambiguous: 0, merchantMismatch: 0, timeMatches: 0, timeMismatch: 0, timeMissing: 0, timeZoneUnverified: 0, repeatedMessageIds: 0, reusedTransactions: 0 };
  const messages = new Set();
  const matchedTransactions = new Set();
  for (const fact of facts) {
    if (!fact.messageId || messages.has(fact.messageId)) counts.repeatedMessageIds++;
    messages.add(fact.messageId);
    if (normalize(fact.cardText) !== normalize(cardText)) { counts.cardEvidenceMismatch++; continue; }
    if (fact.currency && fact.currency !== 'JPY') { counts.foreign++; continue; }
    if (!Number.isSafeInteger(fact.amount) || fact.amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fact.usedDate)) throw new Error('メール事実データの形式を確認してください');
    const hits = state.transactions.filter(tx => tx.cardId === cards[0].id && tx.amount === fact.amount && tx.transactionDate === fact.usedDate);
    if (!hits.length) { counts.unmatched++; continue; }
    if (hits.length !== 1) { counts.ambiguous++; continue; }
    const tx = hits[0];
    counts.uniqueMatches++;
    if (matchedTransactions.has(tx.id)) counts.reusedTransactions++;
    matchedTransactions.add(tx.id);
    if (!normalize(fact.merchant) || !normalize(tx.memo).includes(normalize(fact.merchant))) counts.merchantMismatch++;
    if (fact.timeZone !== 'Asia/Tokyo') { counts.timeZoneUnverified++; continue; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fact.usedTime || '')) throw new Error('メールの利用時刻を確認してください');
    if (!tx.transactionAt || !Number.isFinite(Date.parse(tx.transactionAt))) { counts.timeMissing++; continue; }
    const expected = Date.parse(`${fact.usedDate}T${fact.usedTime}:00+09:00`);
    if (Math.floor(Date.parse(tx.transactionAt) / 60000) === expected / 60000) counts.timeMatches++;
    else counts.timeMismatch++;
  }
  const passed = counts.uniqueMatches === facts.length && counts.timeMatches === facts.length &&
    !counts.cardEvidenceMismatch && !counts.merchantMismatch && !counts.repeatedMessageIds && !counts.reusedTransactions;
  return { suite: 'private-mail-reconciliation', status: passed ? 'pass' : 'review', counts, scopeLimited: true, writes: 0 };
}

if (require.main === module) {
  const [snapshot, mail, cardName, cardText] = process.argv.slice(2);
  const read = path => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const report = reconcile(read(snapshot), read(mail).facts, cardName, cardText);
  console.log(JSON.stringify(report));
  if (report.status !== 'pass') process.exitCode = 1;
}
module.exports = { reconcile };
