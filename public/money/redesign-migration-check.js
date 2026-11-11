/* 移行リハーサル専用。Firestore のバックアップ・復元は行わない。 */
(function attach(root) {
  'use strict';
  const requiredCollections = ['importCandidates', 'receipts', 'receiptItems', 'itemAliases'];
  function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    if (Array.isArray(value)) {
      const result = [];
      if (Object.keys(value).length !== value.length) throw new Error('JSONで正確に表せない配列が含まれています');
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error('JSONで正確に表せない配列が含まれています');
        result.push(canonical(value[index]));
      }
      return result;
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      const result = Object.create(null);
      for (const key of Object.keys(value).sort()) result[key] = canonical(value[key]);
      return result;
    }
    throw new Error('JSONで正確に表せない値が含まれています');
  }
  function validate(bundle) {
    if (!bundle || typeof bundle !== 'object' || !bundle.workspaceId || !bundle.workspace || !bundle.collections) throw new Error('家計データが不足しています');
    for (const name of requiredCollections) {
      const collection = bundle.collections[name];
      if (!collection || collection.complete !== true || !Array.isArray(collection.documents)) throw new Error(`取得が完了していないコレクション: ${name}`);
      const ids = new Set();
      for (const doc of collection.documents) {
        if (!doc || typeof doc.id !== 'string' || !doc.id || ids.has(doc.id) || !doc.data || typeof doc.data !== 'object') throw new Error(`文書IDまたは内容が不正です: ${name}`);
        ids.add(doc.id);
      }
    }
    const copy = canonical(bundle);
    for (const name of requiredCollections) copy.collections[name].documents.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return copy;
  }
  function compare(source, restored) {
    const left = validate(source), right = validate(restored);
    return { matches: JSON.stringify(left) === JSON.stringify(right) };
  }
  function restoreContent(bundle) {
    const copy = validate(bundle);
    const rootName = copy.workspace.name;
    const prefix = `workspaces/${copy.workspaceId}`;
    if (typeof copy.workspaceId !== 'string' || !copy.workspaceId || copy.workspaceId.includes('/') || typeof rootName !== 'string' || !rootName.endsWith(`/${prefix}`) || !rootName.startsWith('projects/') || !copy.workspace.createTime || !copy.workspace.updateTime) throw new Error('家計文書の場所が不正です');
    function fields(document) {
      if (!document || typeof document !== 'object' || !document.createTime || !document.updateTime || (document.fields !== undefined && (!document.fields || typeof document.fields !== 'object' || Array.isArray(document.fields)))) throw new Error('Firestore文書が不正です');
      return document.fields || {};
    }
    const collections = {};
    for (const name of requiredCollections) {
      collections[name] = copy.collections[name].documents.map(doc => {
        if (doc.id.includes('/') || doc.data.name !== `${rootName}/${name}/${doc.id}`) throw new Error('復元文書の場所が不正です');
        return { id: doc.id, fields: fields(doc.data) };
      });
    }
    return { workspace: fields(copy.workspace), collections };
  }
  function compareRestored(source, restored) {
    const expected = restoreContent(source), actual = restoreContent(restored);
    if (source.workspaceId !== restored.workspaceId && Object.hasOwn(expected.workspace, 'revision')) {
      expected.workspace.revision = { integerValue: '0' };
    }
    return { matches: JSON.stringify(expected) === JSON.stringify(actual) };
  }
  const api = { compare, compareRestored };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignMigrationCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
