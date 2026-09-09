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
  getSession: () => ({
    user: { uid: 'test-user', email: 'test@example.com' },
    workspace: { id: 'ws-test', name: 'テストworkspace', memberUids: ['test-user'], ownerUid: 'test-user' },
    workspaces: [{ id: 'ws-test', name: 'テストworkspace', memberUids: ['test-user'], ownerUid: 'test-user' }]
  })
};
