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
  const api = { planRestore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignRestorePlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
