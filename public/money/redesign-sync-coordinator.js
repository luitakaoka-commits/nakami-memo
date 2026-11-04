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
  async function saveSnapshot({ db, ref, uid, expectedRevision, baseline, state, runTransaction, updatedAt }) {
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
      transaction.update(ref, { state: payload, revision: expectedRevision + 1, updatedBy: uid, ...(updatedAt === undefined ? {} : { updatedAt }) });
      return expectedRevision + 1;
    });
  }
  function createCoordinator({ write, applyRemote, onStatus, retain, clearRetained }) {
    let base = null, pending = null, flight = null, blocked = false, running = null;
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
    function enqueue(state) {
      if (!base) throw new Error('サーバーの家計を読み込んでから保存してください');
      const copy = structuredClone(state);
      canonical(copy);
      // 退避に失敗したら、未保存内容を安全に保持できないため送信しない。
      retain(copy);
      pending = copy;
      if (blocked) { conflict(); return; }
      onStatus('saving');
    }
    function flush() {
      if (running) return running;
      running = (async () => {
        while (pending && !blocked) {
          const payload = pending; pending = null;
          flight = { state: payload, text: canonical(payload), revision: base.revision };
          try {
            const revision = await write({ state: structuredClone(payload), baseline: structuredClone(base.state), expectedRevision: base.revision });
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
  const api = { canonical, createCoordinator, saveSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignSyncCoordinator = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
