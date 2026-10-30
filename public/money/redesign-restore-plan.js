/* 別の家計へ復元する書き込み案。本番未接続・実行しない。 */
(function attach(root) {
  'use strict';
  const migration = typeof module !== 'undefined' && module.exports ? require('./redesign-migration-check.js') : root.RedesignMigrationCheck;
  const names = ['importCandidates', 'receipts', 'receiptItems', 'itemAliases'];
  function planRestore({ snapshot, targetId, uid }) {
    if (typeof targetId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(targetId) || typeof uid !== 'string' || !uid.trim()) throw new Error('復元先または利用者が不正です');
    migration.compareRestored(snapshot, snapshot);
    if (targetId === snapshot.workspaceId) throw new Error('元の家計へ上書きできません');
    const rootFields = snapshot.workspace.fields;
    const members = rootFields?.memberUids?.arrayValue?.values;
    if (rootFields?.ownerUid?.stringValue !== uid || !Array.isArray(members) || members.length !== 1 || members[0]?.stringValue !== uid) throw new Error('所有者と共有状態を確認してください');
    const sourceRoot = snapshot.workspace.name;
    const targetRoot = sourceRoot.slice(0, sourceRoot.lastIndexOf('/') + 1) + targetId;
    const writes = [{ update: { name: targetRoot, fields: structuredClone(rootFields) }, currentDocument: { exists: false } }];
    for (const name of names) for (const doc of snapshot.collections[name].documents) {
      writes.push({ update: { name: `${targetRoot}/${name}/${doc.id}`, fields: structuredClone(doc.data.fields || {}) }, currentDocument: { exists: false } });
    }
    if (writes.length > 450) throw new Error('一括復元の件数を超えています');
    return { rootWrites: writes.slice(0, 1), childWrites: writes.slice(1) };
  }
  function inspectRestore({ snapshot, target, targetId, uid }) {
    const plan = planRestore({ snapshot, targetId, uid });
    if (target?.workspaceId !== targetId || target?.workspace?.name !== plan.rootWrites[0].update.name) throw new Error('復元先を確認してください');
    // 対象側の取得完了・文書パスも検証する。
    migration.compareRestored(target, target);
    const available = new Set(), partial = structuredClone(snapshot);
    for (const name of names) {
      const expectedIds = new Set(snapshot.collections[name].documents.map(doc => doc.id));
      const found = target.collections[name].documents;
      if (found.some(doc => !expectedIds.has(doc.id))) return { status: 'conflict' };
      const foundIds = new Set(found.map(doc => doc.id));
      partial.collections[name].documents = partial.collections[name].documents.filter(doc => foundIds.has(doc.id));
      for (const doc of found) available.add(doc.data.name);
    }
    if (!migration.compareRestored(partial, target).matches) return { status: 'conflict' };
    const missingWrites = plan.childWrites.filter(write => !available.has(write.update.name));
    return { status: missingWrites.length ? 'incomplete' : 'matches', missingWrites };
  }
  const api = { planRestore, inspectRestore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignRestorePlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
