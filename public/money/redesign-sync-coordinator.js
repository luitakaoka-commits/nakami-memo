/* 同一端末の保存を直列化し、他端末との競合では未保存内容を保持して止める。 */
(function attach(root) {
  'use strict';
  function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    throw new Error('保存データの形式を確認してください');
  }
  async function saveSnapshot({ db, ref, uid, expectedRevision, baseline, state, runTransaction, updatedAt, acceptances = [], candidateRef }) {
    if (!db || !ref || typeof uid !== 'string' || !uid.trim() || typeof runTransaction !== 'function' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('保存条件を確認してください');
    const payload = structuredClone(state), baseText = canonical(baseline);
    if (payload?.modelVersion !== undefined || payload?.bills !== undefined) throw new Error('新形式の家計です。対応した画面で開いてください。');
    canonical(payload);
    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('家計が見つかりません');
      const data = snapshot.data(), revision = data.revision === undefined ? 0 : data.revision;
      if (revision !== expectedRevision || canonical(data.state) !== baseText) throw new Error('他の端末で更新されました。未保存の変更はこの端末に保管しています。');
      if (data.state?.modelVersion !== undefined || data.state?.bills !== undefined) throw new Error('新形式の家計です。対応した画面で開いてください。');
      const candidates = await Promise.all(acceptances.map(async ({ id, patch, refundTarget, destinationStatementId, creditDate, bankCredit, today }) => {
        const ref = candidateRef(id);
        const candidate = await transaction.get(ref);
        if (!candidate.exists() || !['pending', 'needs_review'].includes(candidate.data().status)) {
          throw new Error('メール候補は別の端末で更新されました');
        }
        const entry = payload.transactions?.find(item => item.id === 'mail_' + id);
        if (patch.status !== 'accepted' || !entry) {
          throw new Error('メール候補に対応する取引がありません');
        }
        if (['refund', 'cancel'].includes(candidate.data().type)) {
          const refunds = typeof module !== 'undefined' && module.exports ? require('./redesign-refund.js') : root.RedesignRefund;
          if (!refundTarget) throw new Error('返金・取消は元の利用と返金先の請求を確認してください');
          const prepared = refunds.preparePendingRefund({
            state: { ...payload, transactions: payload.transactions.filter(item => item.id !== entry.id) },
            candidate: { ...candidate.data(), id }, targetId: refundTarget, amount: patch.amount, confirmed: true, destinationStatementId, creditDate, bankCredit, today
          });
          if (!refunds.matchesPreparedRefund(entry, prepared)) throw new Error('返金・取消の保存条件が一致しません');
        } else if (entry.refundEvidence) throw new Error('返金・取消の通知が一致しません');
        return { ref, patch, bankCredit };
      }));
      const bankDeltas = new Map();
      for (const { bankCredit, patch } of candidates) {
        if (!bankCredit) continue;
        const { accountId, balanceAlreadyIncludesCredit } = bankCredit;
        bankDeltas.set(accountId, (bankDeltas.get(accountId) ?? 0) + (balanceAlreadyIncludesCredit ? 0 : patch.amount));
      }
      for (const [accountId, delta] of bankDeltas) {
        const before = data.state.accounts?.find(item => item.id === accountId)?.currentBalance;
        const after = payload.accounts?.find(item => item.id === accountId)?.currentBalance;
        if (!Number.isSafeInteger(before) || !Number.isSafeInteger(before + delta) || after !== before + delta) {
          throw new Error('入金先の残高が一致しません。口座の変更を先に同期してください。');
        }
      }
      for (const candidate of candidates) transaction.update(candidate.ref, { ...candidate.patch, updatedAt });
      transaction.update(ref, { state: payload, revision: expectedRevision + 1, updatedBy: uid, ...(updatedAt === undefined ? {} : { updatedAt }) });
      return expectedRevision + 1;
    });
  }
  function createCoordinator({ write, applyRemote, onStatus, retain, clearRetained }) {
    let base = null, pending = null, flight = null, blocked = false, running = null;
    let acceptances = [];
    const conflict = () => {
      blocked = true;
      const error = new Error('他の端末で更新されました。未保存の変更はこの端末に保管しています。');
      error.code = 'save-conflict';
      onStatus('error', error);
    };
    function receive(state, revision, meta = {}) {
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('保存データの版番号が不正です');
      const copy = structuredClone(state), text = canonical(copy);
      if (blocked) return;
      if (base && revision < base.revision) return;
      if (flight && revision === flight.revision + 1 && text === flight.text) return;
      if (pending || flight) {
        if (base && revision === base.revision && text === base.text) return;
        conflict(); return;
      }
      if (!meta.initial && base && revision === base.revision && text === base.text) return;
      try {
        applyRemote(structuredClone(copy), meta);
        base = { state: copy, revision, text };
      } catch (error) {
        blocked = true;
        throw error;
      }
    }
    function enqueue(state, acceptance) {
      if (!base) throw new Error('サーバーの家計を読み込んでから保存してください');
      const copy = structuredClone(state);
      canonical(copy);
      // 退避に失敗したら、未保存内容を安全に保持できないため送信しない。
      retain(copy);
      if (acceptance) acceptances.push(structuredClone(acceptance));
      pending = copy;
      if (blocked) { conflict(); return; }
      onStatus('saving');
    }
    function flush() {
      if (running) return running;
      running = (async () => {
        while (pending && !blocked) {
          const payload = pending; pending = null;
          const batch = acceptances; acceptances = [];
          flight = { state: payload, text: canonical(payload), revision: base.revision };
          try {
            const revision = await write({ state: structuredClone(payload), baseline: structuredClone(base.state), expectedRevision: base.revision, acceptances: batch });
            if (revision !== flight.revision + 1) throw new Error('保存後の版番号が一致しません');
            if (blocked) break;
            base = { state: payload, text: flight.text, revision };
            if (!pending) { clearRetained(); onStatus('saved'); }
          } catch (error) {
            if (!pending) pending = payload;
            blocked = true;
            onStatus('error', error);
          } finally { flight = null; }
        }
      })().finally(() => { running = null; });
      return running;
    }
    return { receive, enqueue, flush, isDirty: () => Boolean(pending || flight), isBlocked: () => blocked };
  }
  function readRecovery(storage, uid, workspaceId) {
    const key = 'okane-unsaved:' + uid + ':' + workspaceId;
    const archives = [];
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      const prefix = key + ':archive:';
      if (name?.startsWith(prefix) && /^[0-9a-f-]{36}$/i.test(name.slice(prefix.length))) archives.push(name);
    }
    const snapshots = [];
    for (const name of [key, ...archives]) {
      const raw = storage.getItem(name);
      if (raw === null) continue;
      const kind = name === key ? 'pending' : 'archive';
      try { snapshots.push({ kind, state: JSON.parse(raw) }); }
      catch (_) { snapshots.push({ kind, unreadable: raw }); }
    }
    return { format: 'money-unsaved-recovery-v1', workspaceId, snapshots };
  }
  const api = { canonical, createCoordinator, saveSnapshot, readRecovery };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignSyncCoordinator = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
