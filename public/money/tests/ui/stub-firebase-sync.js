// テスト用のFirebaseスタブ。ネットワークへ接続せずにアプリを起動する。
export const firebaseSync = {
  waitForAuth: async () => ({ uid: 'test-user', email: 'test@example.com' }),
  signIn: async () => ({ user: { uid: 'test-user' } }),
  signOut: async () => {},
  connect: async (initialState, onRemote, onStatus, onCandidates) => {
    if (onStatus) onStatus('saved');
    if (onCandidates) { window.__TEST_CANDIDATE_SINK__ = onCandidates; onCandidates([]); }
  },
  selectWorkspace: async () => {},
  refreshWorkspaces: async () => [],
  queueSave: () => {},
  addMember: async () => {},
  removeMember: async () => {},
  renameWorkspace: async () => {},
  updateImportCandidate: async () => {},
  deleteImportCandidate: async () => {},
  // レシートの保存は Firestore に行かず、呼ばれた中身を window.__TEST_CALLS__ に残す（テストが中身を見る）
  saveReceipt: async (receipt, items) => { (window.__TEST_CALLS__ ||= []).push({ fn: 'saveReceipt', receipt, items }); return receipt.id || 'r-new'; },
  updateReceiptStatus: async (id, status) => { (window.__TEST_CALLS__ ||= []).push({ fn: 'updateReceiptStatus', id, status }); return true; },
  updateReceiptItem: async (id, patch) => { (window.__TEST_CALLS__ ||= []).push({ fn: 'updateReceiptItem', id, patch }); return true; },
  deleteReceipt: async () => true,
  // なかみメモの在庫（2026-09-16）。読み取りは固定値、書き込みは記録するだけ
  readInventoryLocations: async () => [
    { id: 'loc-fridge', name: '冷蔵庫', areaName: 'キッチン', sortOrder: 1 },
    { id: 'loc-shelf', name: '食品棚', areaName: 'キッチン', sortOrder: 2 }
  ],
  readInventoryItems: async () => [{ id: 'inv-moyashi', name: 'もやし', quantity: 1, unit: '袋' }],
  addToInventory: async (plan) => {
    (window.__TEST_CALLS__ ||= []).push({ fn: 'addToInventory', plan });
    return { created: (plan.creates || []).length, merged: (plan.merges || []).length };
  },
  saveItemAlias: async () => true,
  deleteItemAlias: async () => true,
  getSession: () => ({
    user: { uid: 'test-user', email: 'test@example.com' },
    workspace: { id: 'ws-test', name: 'テストworkspace', memberUids: ['test-user'], ownerUid: 'test-user' },
    workspaces: [{ id: 'ws-test', name: 'テストworkspace', memberUids: ['test-user'], ownerUid: 'test-user' }]
  })
};
