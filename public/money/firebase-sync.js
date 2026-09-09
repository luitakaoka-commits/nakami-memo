import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  enableIndexedDbPersistence,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA4qpbwxpp8tEEWLCkNMPIYuDTN7G9cF3A',
  authDomain: 'cash-manege.firebaseapp.com',
  projectId: 'cash-manege',
  storageBucket: 'cash-manege.firebasestorage.app',
  messagingSenderId: '529145553530',
  appId: '1:529145553530:web:d65452017ffb9c109b51c3'
};

const ACTIVE_WORKSPACE_KEY = 'okane-active-workspace';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});
enableIndexedDbPersistence(db).catch(() => {});

let currentUser = null;
let currentWorkspace = null;
let workspaces = [];
let stopWorkspace = null;
let stopCandidates = null;
let candidateHandler = () => {};
let stopReceipts = null;
let stopReceiptItems = null;
let stopItemAliases = null;
let receiptHandler = () => {};
let receiptItemHandler = () => {};
let itemAliasHandler = () => {};
let saveTimer = null;
let remoteHandler = () => {};
let statusHandler = () => {};

const authReady = new Promise(resolve => {
  let first = true;
  onAuthStateChanged(auth, user => {
    currentUser = user;
    if (first) {
      first = false;
      resolve(user);
    }
  });
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function workspaceView(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: data.name || '家計',
    ownerUid: data.ownerUid,
    memberUids: Array.isArray(data.memberUids) ? data.memberUids : [],
    updatedBy: data.updatedBy || ''
  };
}

async function refreshWorkspaces() {
  if (!currentUser) return [];
  const result = await getDocs(query(
    collection(db, 'workspaces'),
    where('memberUids', 'array-contains', currentUser.uid)
  ));
  workspaces = result.docs.map(workspaceView).sort((a, b) => {
    const ownerOrder = Number(b.ownerUid === currentUser.uid) - Number(a.ownerUid === currentUser.uid);
    return ownerOrder || a.name.localeCompare(b.name, 'ja');
  });
  return workspaces;
}

async function createWorkspace(initialState) {
  const ref = doc(collection(db, 'workspaces'));
  const payload = {
    name: '家計',
    ownerUid: currentUser.uid,
    memberUids: [currentUser.uid],
    state: clone(initialState),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  };
  await setDoc(ref, payload);
  const created = { id: ref.id, name: payload.name, ownerUid: currentUser.uid, memberUids: [currentUser.uid], updatedBy: currentUser.uid };
  workspaces = [created];
  return created;
}

async function selectWorkspace(workspaceId) {
  if (!currentUser) throw new Error('ログインが必要です');
  const available = await refreshWorkspaces();
  const selected = available.find(item => item.id === workspaceId);
  if (!selected) throw new Error('共有スペースを開けません');

  if (stopWorkspace) stopWorkspace();
  currentWorkspace = selected;
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, selected.id);
  startCandidateWatch();
  startReceiptWatch();

  return new Promise((resolve, reject) => {
    let first = true;
    stopWorkspace = onSnapshot(doc(db, 'workspaces', selected.id), snapshot => {
      if (!snapshot.exists()) {
        if (first) reject(new Error('共有スペースが見つかりません'));
        return;
      }
      const data = snapshot.data();
      currentWorkspace = { ...workspaceView(snapshot) };
      const meta = { initial: first, updatedBy: data.updatedBy || '', pending: snapshot.metadata.hasPendingWrites };
      if (data.state && !snapshot.metadata.hasPendingWrites) remoteHandler(clone(data.state), meta);
      if (first) {
        first = false;
        resolve(data.state ? clone(data.state) : null);
      }
    }, error => {
      statusHandler('error', error);
      if (first) reject(error);
    });
  });
}

async function connect(initialState, onRemote, onStatus, onCandidates, onReceipts, onReceiptItems, onItemAliases) {
  await authReady;
  if (!currentUser) return null;
  remoteHandler = typeof onRemote === 'function' ? onRemote : () => {};
  statusHandler = typeof onStatus === 'function' ? onStatus : () => {};
  if (typeof onCandidates === 'function') candidateHandler = onCandidates;
  if (typeof onReceipts === 'function') receiptHandler = onReceipts;
  if (typeof onReceiptItems === 'function') receiptItemHandler = onReceiptItems;
  if (typeof onItemAliases === 'function') itemAliasHandler = onItemAliases;
  let available = await refreshWorkspaces();
  if (!available.length) available = [await createWorkspace(initialState)];
  const savedId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  const selected = available.find(item => item.id === savedId) || available[0];
  await selectWorkspace(selected.id);
  return getSession();
}

function queueSave(nextState) {
  if (!currentUser || !currentWorkspace) return;
  const workspaceId = currentWorkspace.id;
  const payload = clone(nextState);
  clearTimeout(saveTimer);
  statusHandler('saving');
  saveTimer = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'workspaces', workspaceId), {
        state: payload,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      }, { merge: true });
      statusHandler('saved');
    } catch (error) {
      statusHandler('error', error);
    }
  }, 450);
}

async function addMember(memberUid) {
  const value = String(memberUid || '').trim();
  if (!value || value.length > 128) throw new Error('メンバーIDを確認してください');
  if (!currentWorkspace || currentWorkspace.ownerUid !== currentUser?.uid) throw new Error('所有者だけがメンバーを追加できます');
  if (value === currentUser.uid) throw new Error('自分はすでに参加しています');
  await updateDoc(doc(db, 'workspaces', currentWorkspace.id), {
    memberUids: arrayUnion(value),
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  });
}

async function removeMember(memberUid) {
  if (!currentWorkspace || currentWorkspace.ownerUid !== currentUser?.uid) throw new Error('所有者だけがメンバーを削除できます');
  if (memberUid === currentWorkspace.ownerUid) throw new Error('所有者は削除できません');
  await updateDoc(doc(db, 'workspaces', currentWorkspace.id), {
    memberUids: arrayRemove(memberUid),
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  });
}

async function renameWorkspace(name) {
  const value = String(name || '').trim();
  if (!value) throw new Error('共有スペース名を入力してください');
  if (!currentWorkspace || currentWorkspace.ownerUid !== currentUser?.uid) throw new Error('所有者だけが名前を変更できます');
  await updateDoc(doc(db, 'workspaces', currentWorkspace.id), {
    name: value.slice(0, 40),
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  });
}

/* ---------- 取込候補（メール・通知からの取り込み） ---------- */

/**
 * workspaces/{workspaceId}/importCandidates を購読する。
 * workspace本体の state は触らない。
 */
function startCandidateWatch() {
  if (stopCandidates) { stopCandidates(); stopCandidates = null; }
  if (!currentWorkspace) { candidateHandler([]); return; }
  const workspaceId = currentWorkspace.id;
  stopCandidates = onSnapshot(
    collection(db, 'workspaces', workspaceId, 'importCandidates'),
    snapshot => candidateHandler(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    () => candidateHandler([])
  );
}

async function updateImportCandidate(candidateId, patch) {
  if (!currentUser || !currentWorkspace) throw new Error('ログインが必要です');
  await updateDoc(doc(db, 'workspaces', currentWorkspace.id, 'importCandidates', candidateId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

async function deleteImportCandidate(candidateId) {
  if (!currentUser || !currentWorkspace) throw new Error('ログインが必要です');
  await deleteDoc(doc(db, 'workspaces', currentWorkspace.id, 'importCandidates', candidateId));
}

/* ---------- レシート明細（買ったものの行と、その結末） ----------
 * 取込候補(importCandidates)と同じ作りにする。
 *  - workspace本体の state には一切触らない。1ドキュメント方式のままでは1MiBに収まらないため。
 *  - レシートはサブコレクションだけで完結し、Firestoreが正になる。
 *  - 未ログイン／共有スペース未選択のときは、呼ばれても何もしないで false を返す。
 */

/** Rulesが許可するフィールドと既定値。ここに無いキーは書き込まない。 */
const RECEIPT_FIELDS = {
  storeName: '',
  purchasedAt: '',
  total: 0,
  taxTotal: 0,
  paymentMethod: 'unknown',
  transactionId: '',
  source: 'manual',
  status: 'pending',
  note: '',
  createdAt: '',
  updatedAt: '',
  createdBy: ''
};

const RECEIPT_ITEM_FIELDS = {
  receiptId: '',
  lineNo: 0,
  rawName: '',
  name: '',
  quantity: 0,
  unit: '',
  unitPrice: 0,
  amount: 0,
  category: 'その他',
  outcomeTracked: false,
  outcome: 'in_stock',
  outcomeAt: '',
  outcomeReason: '',
  wasteAmount: 0,
  note: '',
  createdAt: '',
  updatedAt: ''
};

/** 品名の名寄せ辞書。ドキュメントIDは aliasKey と同じ値にする（引き当てが1回で済む）。 */
const ITEM_ALIAS_FIELDS = {
  aliasKey: '',
  canonicalName: '',
  canonicalKey: '',
  category: '',
  createdAt: '',
  updatedAt: ''
};

/** 既定値で埋めて、許可されたキーだけの平らなオブジェクトにする。 */
function shape(fields, source = {}) {
  const next = {};
  Object.keys(fields).forEach(key => {
    const value = source[key];
    next[key] = value === undefined || value === null ? fields[key] : value;
  });
  return next;
}

/** patch から許可されたキーだけを取り出す（部分更新用） */
function pick(fields, source = {}) {
  const next = {};
  Object.keys(source).forEach(key => {
    if (key in fields) next[key] = source[key];
  });
  return next;
}

function connected() {
  return Boolean(currentUser && currentWorkspace);
}

/** workspaces/{id}/receipts と receiptItems を購読する。state は触らない。 */
function startReceiptWatch() {
  if (stopReceipts) { stopReceipts(); stopReceipts = null; }
  if (stopReceiptItems) { stopReceiptItems(); stopReceiptItems = null; }
  if (stopItemAliases) { stopItemAliases(); stopItemAliases = null; }
  if (!currentWorkspace) { receiptHandler([]); receiptItemHandler([]); itemAliasHandler([]); return; }
  const workspaceId = currentWorkspace.id;
  stopReceipts = onSnapshot(
    collection(db, 'workspaces', workspaceId, 'receipts'),
    snapshot => receiptHandler(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    () => receiptHandler([])
  );
  stopReceiptItems = onSnapshot(
    collection(db, 'workspaces', workspaceId, 'receiptItems'),
    snapshot => receiptItemHandler(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    () => receiptItemHandler([])
  );
  stopItemAliases = onSnapshot(
    collection(db, 'workspaces', workspaceId, 'itemAliases'),
    snapshot => itemAliasHandler(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    () => itemAliasHandler([])
  );
}

/** そのレシートに今ぶら下がっている明細行のIDを集める */
async function receiptItemIdsOf(workspaceId, receiptId) {
  const found = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'receiptItems'),
    where('receiptId', '==', receiptId)
  ));
  return found.docs.map(item => item.id);
}

/**
 * レシート1件と、その明細行をまとめて書く。
 * 編集の場合は、古い明細行を消してから書き直すので「行を減らす編集」も反映される。
 * 1回のバッチは500件までなので、明細行は先頭480行までにする。
 */
async function saveReceipt(receipt = {}, items = []) {
  if (!connected()) return false;
  const workspaceId = currentWorkspace.id;
  const now = new Date().toISOString();
  const receiptId = receipt.id || doc(collection(db, 'workspaces', workspaceId, 'receipts')).id;
  const receiptRef = doc(db, 'workspaces', workspaceId, 'receipts', receiptId);

  const existingIds = receipt.id ? await receiptItemIdsOf(workspaceId, receiptId) : [];
  const lines = (Array.isArray(items) ? items : []).slice(0, 480);
  const batch = writeBatch(db);

  batch.set(receiptRef, shape(RECEIPT_FIELDS, {
    ...receipt,
    createdAt: receipt.createdAt || now,
    updatedAt: now,
    createdBy: receipt.createdBy || currentUser.uid
  }));

  const keptIds = new Set();
  lines.forEach((item, index) => {
    const lineId = item.id || doc(collection(db, 'workspaces', workspaceId, 'receiptItems')).id;
    keptIds.add(lineId);
    batch.set(doc(db, 'workspaces', workspaceId, 'receiptItems', lineId), shape(RECEIPT_ITEM_FIELDS, {
      ...item,
      receiptId,
      lineNo: Number.isFinite(Number(item.lineNo)) ? Number(item.lineNo) : index + 1,
      createdAt: item.createdAt || now,
      updatedAt: now
    }));
  });
  existingIds.filter(id => !keptIds.has(id)).forEach(id => {
    batch.delete(doc(db, 'workspaces', workspaceId, 'receiptItems', id));
  });

  await batch.commit();
  return receiptId;
}

/** 明細行を部分更新する（結末の記録に使う）。 */
async function updateReceiptItem(lineId, patch = {}) {
  if (!connected() || !lineId) return false;
  const allowed = pick(RECEIPT_ITEM_FIELDS, patch);
  if (!Object.keys(allowed).length) return false;
  await updateDoc(doc(db, 'workspaces', currentWorkspace.id, 'receiptItems', lineId), {
    ...allowed,
    updatedAt: new Date().toISOString()
  });
  return true;
}

/** レシートと、そこにぶら下がる明細行をまとめて消す。 */
async function deleteReceipt(receiptId) {
  if (!connected() || !receiptId) return false;
  const workspaceId = currentWorkspace.id;
  const lineIds = await receiptItemIdsOf(workspaceId, receiptId);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'workspaces', workspaceId, 'receipts', receiptId));
  lineIds.slice(0, 490).forEach(id => batch.delete(doc(db, 'workspaces', workspaceId, 'receiptItems', id)));
  await batch.commit();
  return true;
}

/**
 * 品名の名寄せ辞書を1件書く。
 * ドキュメントIDは aliasKey そのもの。同じ表記ゆれを何度学んでも1件に上書きされる。
 * 未ログイン／共有スペース未選択のときは、何もしないで false を返す。
 */
async function saveItemAlias(alias = {}) {
  if (!connected()) return false;
  const aliasKey = String(alias.aliasKey || '').trim();
  const canonicalName = String(alias.canonicalName || '').trim();
  if (!aliasKey || !canonicalName) return false;
  const now = new Date().toISOString();
  await setDoc(doc(db, 'workspaces', currentWorkspace.id, 'itemAliases', aliasKey), shape(ITEM_ALIAS_FIELDS, {
    ...alias,
    aliasKey,
    canonicalName,
    createdAt: alias.createdAt || now,
    updatedAt: now
  }));
  return aliasKey;
}

/** まとめたのを取り消す。 */
async function deleteItemAlias(aliasKey) {
  if (!connected() || !aliasKey) return false;
  await deleteDoc(doc(db, 'workspaces', currentWorkspace.id, 'itemAliases', String(aliasKey)));
  return true;
}

function getSession() {
  return {
    user: currentUser ? { uid: currentUser.uid, email: currentUser.email || '' } : null,
    workspace: currentWorkspace ? { ...currentWorkspace, memberUids: [...currentWorkspace.memberUids] } : null,
    workspaces: workspaces.map(item => ({ ...item, memberUids: [...item.memberUids] }))
  };
}

async function signOutCurrentUser() {
  clearTimeout(saveTimer);
  if (stopWorkspace) stopWorkspace();
  if (stopCandidates) stopCandidates();
  if (stopReceipts) stopReceipts();
  if (stopReceiptItems) stopReceiptItems();
  if (stopItemAliases) stopItemAliases();
  stopWorkspace = null;
  stopCandidates = null;
  stopReceipts = null;
  stopReceiptItems = null;
  stopItemAliases = null;
  candidateHandler([]);
  receiptHandler([]);
  receiptItemHandler([]);
  itemAliasHandler([]);
  currentWorkspace = null;
  workspaces = [];
  localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  await signOut(auth);
}

async function signInCurrentUser() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  currentUser = credential.user;
  return credential;
}

export const firebaseSync = {
  waitForAuth: async () => {
    await authReady;
    return currentUser ? { uid: currentUser.uid, email: currentUser.email || '' } : null;
  },
  signIn: signInCurrentUser,
  signOut: signOutCurrentUser,
  connect,
  selectWorkspace,
  refreshWorkspaces,
  queueSave,
  addMember,
  removeMember,
  renameWorkspace,
  getSession,
  updateImportCandidate,
  deleteImportCandidate,
  saveReceipt,
  updateReceiptItem,
  deleteReceipt,
  saveItemAlias,
  deleteItemAlias
};
