/* 復元時の中断を扱う試作。通信と確認は呼び出し側から渡す。 */
(function attach(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const planner = node ? require('./redesign-restore-plan.js') : root.RedesignRestorePlan;
  const migration = node ? require('./redesign-migration-check.js') : root.RedesignMigrationCheck;
  function guardRoot(document, updateTime) {
    return {
      update: { name: document.name, fields: { updatedAt: document.fields.updatedAt } },
      updateMask: { fieldPaths: ['updatedAt'] },
      currentDocument: { updateTime }
    };
  }
  async function executeRestore({ snapshot, targetId, uid, commitWrites, readBack }) {
    if (typeof commitWrites !== 'function' || typeof readBack !== 'function') throw new Error('復元の通信手段を確認してください');
    const plan = planner.planRestore({ snapshot, targetId, uid });
    let commitTime, rootVersion;
    try {
      const result = await commitWrites(plan.rootWrites);
      commitTime = result?.commitTime;
      rootVersion = result?.writeResults?.[0]?.updateTime || commitTime;
    } catch (_) {
      // 応答が失われた場合、親が作られたかどうか断定できない。
      return { status: 'root_uncertain', targetId };
    }
    if (plan.childWrites.length) {
      if (typeof rootVersion !== 'string' || !rootVersion) return { status: 'root_uncertain', targetId };
      try {
        const result = await commitWrites([guardRoot(plan.rootWrites[0].update, rootVersion), ...plan.childWrites]);
        commitTime = result?.commitTime;
      } catch (_) {
        return { status: 'children_uncertain', targetId, rootVersion, sourceName: snapshot.workspace.name, sourceReadTime: snapshot.readTime };
      }
    }
    if (typeof commitTime !== 'string' || !commitTime) return { status: 'verification_required', targetId };
    try {
      const restored = await readBack(targetId, commitTime);
      if (!migration.compareRestored(snapshot, restored).matches) return { status: 'verification_required', targetId };
      return { status: 'verified', targetId };
    } catch (_) {
      return { status: 'verification_required', targetId };
    }
  }
  async function resumeRestore({ snapshot, receipt, uid, readCurrent, readBack, commitWrites }) {
    if (receipt?.status !== 'children_uncertain' || typeof receipt.rootVersion !== 'string' || !receipt.rootVersion
      || receipt.sourceName !== snapshot?.workspace?.name || receipt.sourceReadTime !== snapshot?.readTime
      || ![readCurrent, readBack, commitWrites].every(fn => typeof fn === 'function')) throw new Error('復元の再開条件を確認してください');
    const { targetId, rootVersion } = receipt;
    const plan = planner.planRestore({ snapshot, targetId, uid });
    let target;
    try { target = await readCurrent(targetId); } catch (_) { return { status: 'verification_required', targetId }; }
    if (target?.workspace?.createTime !== rootVersion) return { status: 'conflict', targetId };
    const inspection = planner.inspectRestore({ snapshot, target, targetId, uid });
    if (inspection.status === 'matches') return { status: 'verified', targetId };
    // 明細は元の処理でも一括コミット。中途半端な件数なら別の更新を疑い停止する。
    if (inspection.status !== 'incomplete' || inspection.missingWrites.length !== plan.childWrites.length
      || target.workspace.updateTime !== rootVersion) return { status: 'conflict', targetId };
    try {
      const result = await commitWrites([guardRoot(target.workspace, rootVersion), ...inspection.missingWrites]);
      const restored = await readBack(targetId, result.commitTime);
      if (migration.compareRestored(snapshot, restored).matches) return { status: 'verified', targetId };
    } catch (_) {
      return receipt;
    }
    return { status: 'verification_required', targetId };
  }
  const api = { executeRestore, resumeRestore };
  if (node) module.exports = api;
  root.RedesignRestoreExecute = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
