/* Firestore REST の読取リハーサル。通信・保存・復元は呼び出し側に委ねる。 */
(function attach(root) {
  'use strict';
  const collections = ['importCandidates', 'receipts', 'receiptItems', 'itemAliases'];
  function timestampKey(value) {
    if (typeof value !== 'string') return '';
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
    if (!match || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== match[1]) return '';
    return match[1] + (match[2] || '').padEnd(9, '0');
  }
  async function readSnapshot({ projectId, databaseId = '(default)', workspaceId, readTime, getJson }) {
    if (![projectId, databaseId, workspaceId].every(value => typeof value === 'string' && value && !value.includes('/'))) throw new Error('プロジェクトまたは家計IDが不正です');
    const cutoff = timestampKey(readTime);
    if (typeof getJson !== 'function' || !cutoff || /\.\d{7,}Z$/.test(readTime)) throw new Error('読み取り時刻または通信手段が不正です');
    const checkDocumentTime = doc => {
      const created = timestampKey(doc.createTime), updated = timestampKey(doc.updateTime);
      if (!created || !updated || created > updated || updated > cutoff) throw new Error('文書の更新時刻が読み取り時点と一致しません');
    };
    const rootName = `projects/${projectId}/databases/${databaseId}/documents/workspaces/${workspaceId}`;
    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/workspaces/${encodeURIComponent(workspaceId)}`;
    const request = async url => {
      const result = await getJson(url);
      if (!result || typeof result !== 'object' || Array.isArray(result) || result.error) throw new Error('取得に失敗しました');
      return result;
    };
    const rootUrl = new URL(base); rootUrl.searchParams.set('readTime', readTime);
    const workspace = await request(rootUrl.toString());
    if (workspace.name !== rootName || !workspace.createTime || !workspace.updateTime) throw new Error('家計データを確認できません');
    checkDocumentTime(workspace);
    const result = { workspaceId, readTime, workspace, collections: {} };
    for (const collection of collections) {
      const documents = [], ids = new Set(), tokens = new Set();
      let pageToken = '';
      do {
        const url = new URL(`${base}/${collection}`);
        url.searchParams.set('readTime', readTime); url.searchParams.set('pageSize', '200');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const page = await request(url.toString());
        if (page.documents != null && !Array.isArray(page.documents)) throw new Error('文書一覧が不正です');
        for (const doc of page.documents || []) {
          const prefix = `${rootName}/${collection}/`;
          if (!doc || typeof doc.name !== 'string' || !doc.name.startsWith(prefix) || !doc.createTime || !doc.updateTime) throw new Error('別の場所の文書か、内容が不正です');
          const id = doc.name.slice(prefix.length);
          if (!id || id.includes('/') || ids.has(id)) throw new Error('文書IDが不正または重複しています');
          checkDocumentTime(doc);
          ids.add(id); documents.push({ id, data: doc });
        }
        if (page.nextPageToken != null && typeof page.nextPageToken !== 'string') throw new Error('ページ番号が不正です');
        pageToken = page.nextPageToken || '';
        if (pageToken && tokens.has(pageToken)) throw new Error('ページが繰り返されています');
        if (pageToken) tokens.add(pageToken);
        if (tokens.size > 10000) throw new Error('ページ数が多すぎます');
      } while (pageToken);
      result.collections[collection] = { complete: true, documents };
    }
    return result;
  }
  /** 端末時計を使わず、サーバーが返した読取点で全ページを揃える。 */
  async function readCurrentSnapshot({ projectId, databaseId = '(default)', workspaceId, getJson, postJson, beforeRead = async () => {} }) {
    if (![projectId, databaseId, workspaceId].every(value => typeof value === 'string' && value && !value.includes('/'))) throw new Error('プロジェクトまたは家計IDが不正です');
    if (typeof getJson !== 'function' || typeof postJson !== 'function' || typeof beforeRead !== 'function') throw new Error('読み取りの通信手段が不正です');
    await beforeRead();
    const name = `projects/${projectId}/databases/${databaseId}/documents/workspaces/${workspaceId}`;
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:batchGet`;
    const responses = await postJson(url, { documents: [name] });
    if (!Array.isArray(responses) || responses.length !== 1) throw new Error('サーバーの読取時刻を取得できません');
    const reply = responses[0];
    if (!reply || reply.error || reply.missing !== undefined || reply.found?.name !== name || !timestampKey(reply.readTime)) throw new Error('家計またはサーバーの読取時刻を確認できません');
    // readTimeパラメータはマイクロ秒精度。端数を上へ丸めて未来の状態を混ぜない。
    const readTime = reply.readTime.replace(/(\.\d{6})\d+Z$/, '$1Z');
    const cutoff = timestampKey(readTime), created = timestampKey(reply.found.createTime), updated = timestampKey(reply.found.updateTime);
    if (!created || !updated || created > updated || updated > cutoff) throw new Error('文書の更新時刻がサーバーの読み取り時点と一致しません');
    return readSnapshot({ projectId, databaseId, workspaceId, readTime, getJson });
  }
  const api = { readSnapshot, readCurrentSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RedesignBackupRead = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
