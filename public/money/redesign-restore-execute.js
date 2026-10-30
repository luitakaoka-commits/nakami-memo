/* 復元時の中断を扱う試作。通信と確認は呼び出し側から渡す。 */
(function attach(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const planner = node ? require('./redesign-restore-plan.js') : root.RedesignRestorePlan;
  const migration = node ? require('./redesign-migration-check.js') : root.RedesignMigrationCheck;
  async function executeRestore({ snapshot, targetId, uid, commitWrites, readBack }) {
    if (typeof commitWrites !== 'function' || typeof readBack !== 'function') throw new Error('復元の通信手段を確認してください');
    const plan = planner.planRestore({ snapshot, targetId, uid });
    let commitTime;
    try {
      const result = await commitWrites(plan.rootWrites);
      commitTime = result?.commitTime;
    } catch (_) {
      // 応答が失われた場合、親が作られたかどうか断定できない。
      return { status: 'root_uncertain', targetId };
    }
    if (plan.childWrites.length) {
      try {
        const result = await commitWrites(plan.childWrites);
        commitTime = result?.commitTime;
      } catch (_) {
        return { status: 'children_uncertain', targetId };
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
  const api = { executeRestore };
  if (node) module.exports = api;
  root.RedesignRestoreExecute = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
