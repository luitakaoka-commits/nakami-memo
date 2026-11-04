#!/usr/bin/env node
/* 保存原本の照合。値や識別子を標準出力に出さない。 */
'use strict';
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { compareRestored } = require('../redesign-migration-check.js');

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

function decode(value) {
  const keys = Object.keys(value || {});
  if (keys.length !== 1) throw new Error('Firestoreの値が不正です');
  const [type] = keys;
  const raw = value[type];
  if (type === 'mapValue') return decodeFields(raw.fields);
  if (type === 'arrayValue') return (raw.values || []).map(decode);
  if (type === 'nullValue' && raw === null) return null;
  if (['stringValue', 'timestampValue'].includes(type) && typeof raw === 'string') return raw;
  if (type === 'booleanValue' && typeof raw === 'boolean') return raw;
  if (type === 'doubleValue' && typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (type === 'integerValue' && typeof raw === 'string' && /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) return Number(raw);
  throw new Error('正確に比較できないFirestoreの値があります');
}

function audit(bundle, prior) {
  compareRestored(bundle, bundle);
  const state = decode(bundle.workspace.fields?.state?.mapValue ? bundle.workspace.fields.state : null);
  const groups = ['accounts', 'cards', 'transactions', 'workEntries', 'recurringPlans'];
  const counts = {}, differences = {};
  for (const key of groups) {
    const rows = state[key];
    if (!Array.isArray(rows)) throw new Error('家計の配列が不足しています');
    counts[key] = rows.length;
    const index = items => {
      const result = new Map();
      for (const row of items) {
        if (typeof row?.id !== 'string' || !row.id || result.has(row.id)) throw new Error('家計の識別子が不正または重複しています');
        result.set(row.id, row);
      }
      return result;
    };
    const current = index(rows);
    if (prior) {
      if (!Array.isArray(prior[key])) throw new Error('比較元の家計の配列が不足しています');
      const older = index(prior[key]);
      differences[key] = {
        added: rows.filter(row => !older.has(row.id)).length,
        removed: prior[key].filter(row => !current.has(row.id)).length,
        changed: rows.filter(row => older.has(row.id) && !isDeepStrictEqual(row, older.get(row.id))).length
      };
    }
  }
  const transactions = new Map(state.transactions.map(item => [item.id, item]));
  const cards = new Map(state.cards.map(item => [item.id, item]));
  const candidateIds = new Set();
  const candidates = { pending: 0, needs_review: 0, accepted: 0, ignored: 0, unknown: 0, acceptedWithoutTransaction: 0, pendingWithTransaction: 0, transactionsWithoutCandidate: 0, linkedAmountMismatch: 0, linkedDateMismatch: 0, linkedCardAccountMismatch: 0 };
  for (const { id, data } of bundle.collections.importCandidates.documents) {
    candidateIds.add(id);
    const status = data.fields?.status?.stringValue;
    if (['pending', 'needs_review', 'accepted', 'ignored'].includes(status)) candidates[status]++;
    else candidates.unknown++;
    const linked = transactions.get('mail_' + id);
    if (status === 'accepted' && !linked) candidates.acceptedWithoutTransaction++;
    if ((status === 'pending' || status === 'needs_review') && linked) candidates.pendingWithTransaction++;
    if (status === 'accepted' && linked?.entryType === 'itemized' && !linked.refundEvidence) {
      const amount = data.fields?.amount ? decode(data.fields.amount) : undefined;
      const usedDate = data.fields?.usedDate?.stringValue;
      if (Number.isSafeInteger(amount) && amount !== linked.amount) candidates.linkedAmountMismatch++;
      if (usedDate && usedDate !== linked.transactionDate) candidates.linkedDateMismatch++;
      const card = cards.get(linked.cardId);
      if (!card?.accountId || card.accountId !== linked.sourceAccountId) candidates.linkedCardAccountMismatch++;
    }
  }
  candidates.transactionsWithoutCandidate = state.transactions.filter(item => item.id.startsWith('mail_') && !candidateIds.has(item.id.slice(5))).length;
  const receiptIds = new Set(bundle.collections.receipts.documents.map(item => item.id));
  const receiptItemsWithoutReceipt = bundle.collections.receiptItems.documents.filter(({ data }) => !receiptIds.has(data.fields?.receiptId?.stringValue)).length;
  return { counts, differences: prior ? differences : null, candidates, receiptItemsWithoutReceipt, collections: Object.fromEntries(Object.entries(bundle.collections).map(([name, data]) => [name, data.documents.length])) };
}

if (require.main === module) {
  try {
    const read = path => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    const [, , source, earlier] = process.argv;
    console.log(JSON.stringify({ suite: 'cloud-snapshot-audit', ...audit(read(source), earlier ? read(earlier) : null) }));
  } catch (_) {
    console.error(JSON.stringify({ suite: 'cloud-snapshot-audit', status: 'invalid_input' }));
    process.exitCode = 1;
  }
}
module.exports = { audit };
