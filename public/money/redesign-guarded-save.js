/* 版番号付き保存の試作。現行アプリ・本番ルールには未接続。 */
(function attach(root) {
  'use strict';
  async function saveGuarded({ db, ref, expectedRevision, state, uid, runTransaction }) {
    if (!db || !ref || typeof runTransaction !== 'function' || typeof uid !== 'string' || !uid.trim() ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER ||
        !state || typeof state !== 'object' || Array.isArray(state)) throw new Error('保存内容または版番号が不正です');
    const payload = structuredClone(state);
    return runTransaction(db, async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('家計が見つかりません');
      if (snapshot.data().revision !== expectedRevision) throw new Error('他端末で更新されました');
      const revision = expectedRevision + 1;
      tx.update(ref, { state: payload, revision, updatedBy: uid });
      return { revision };
    });
  }
  const api = { saveGuarded };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignGuardedSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
