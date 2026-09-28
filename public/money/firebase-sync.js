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
  getDoc,
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
/* 同居人と共有している「家」（2026-09-28）。なかみメモの在庫はここに入る。お金管理そのものは家に入れない */
let householdId = null;
let stopOutcomeQueue = null;
const outcomeQueueInFlight = new Set();
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
  startOutcomeQueueWatch();

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
  // なかみメモの在庫の置き場所（家か本人か）を先に決める。在庫に入れる・受け渡し箱を見るのに使う
  await resolveHousehold();
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
  // 在庫に入れたときの、なかみメモ側の items のID（2026-09-16）。
  // これがあると「捨てた」をなかみメモ側から書き戻せる。
  inventoryItemId: '',
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

/* ---------- なかみメモの在庫（2026-09-16。Firebaseを1つにまとめたので users/{uid} を直接読める） ----------
 * 2026-09-28 から、同居人と「家」を共有していれば households/{id} に入っている。
 * なかみメモの src/lib/firebase/space.ts と同じ決め方にすること（ずれると別の在庫に入れてしまう）。 */

/** どの家に入っているかを調べる。読めなければ家なし（本人の場所）として続ける */
async function resolveHousehold() {
  householdId = null;
  if (!currentUser) return null;
  try {
    const profile = await getDoc(doc(db, 'users', currentUser.uid));
    const id = profile.exists() ? profile.data().householdId : null;
    if (typeof id !== 'string' || !id) return null;
    const home = await getDoc(doc(db, 'households', id));
    const members = home.exists() ? home.data().memberUids : null;
    householdId = Array.isArray(members) && members.includes(currentUser.uid) ? id : null;
  } catch (error) {
    householdId = null;
  }
  return householdId;
}

/** なかみメモの在庫のコレクション（家に入っていれば家） */
function inventoryCol(name) {
  return householdId
    ? collection(db, 'households', householdId, name)
    : collection(db, 'users', currentUser.uid, name);
}

/**
 * 同居人が記録した「使い切った／捨てた」を、今の共有スペースのレシート明細へ返す（ユーザー決定 B）。
 * 同居人はお金管理を見られないので、なかみメモ・つくりおきノートは家の受け渡し箱（outcomeQueue）に入れておく。
 * ここで明細を書き換え、終わった分を箱から消す。お金管理を開いているあいだは、箱に入った時点ですぐ返る。
 */
function startOutcomeQueueWatch() {
  if (stopOutcomeQueue) { stopOutcomeQueue(); stopOutcomeQueue = null; }
  if (!householdId || !currentWorkspace) return;
  const workspaceId = currentWorkspace.id;
  const home = householdId;
  stopOutcomeQueue = onSnapshot(collection(db, 'households', home, 'outcomeQueue'), snapshot => {
    snapshot.docs.forEach(entry => {
      const data = entry.data();
      // 別の共有スペースのレシートから入れた在庫は、そちらを開いたときに返す
      if (data.purchaseWorkspaceId && data.purchaseWorkspaceId !== workspaceId) return;
      if (outcomeQueueInFlight.has(entry.id)) return;
      outcomeQueueInFlight.add(entry.id);
      applyOutcomeEntry(workspaceId, home, entry.id, data)
        .catch(error => console.warn('受け渡し箱の記録を返せませんでした', error))
        .finally(() => outcomeQueueInFlight.delete(entry.id));
    });
  }, () => {});
}

async function applyOutcomeEntry(workspaceId, home, entryId, data) {
  const lines = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'receiptItems'),
    where('inventoryItemId', '==', String(data.inventoryItemId || ''))
  ));
  // 共有スペースが分からない古い在庫で、ここに明細が無ければ、別の共有スペースのものかもしれないので残す
  if (!lines.size && !data.purchaseWorkspaceId) return;
  const engine = window.FinanceEngine;
  const { patches } = engine.outcomeLinePatches(lines.docs.map(line => ({ id: line.id, ...line.data() })), data);
  const batch = writeBatch(db);
  patches.forEach(({ id, patch }) => batch.update(doc(db, 'workspaces', workspaceId, 'receiptItems', id), patch));
  batch.delete(doc(db, 'households', home, 'outcomeQueue', entryId));
  await batch.commit();
}

/** なかみメモの保管場所を、エリア名つきで返す。「在庫に入れる」で選んでもらうため。 */
async function readInventoryLocations() {
  if (!currentUser) return [];
  const [areaSnap, locationSnap] = await Promise.all([
    getDocs(inventoryCol('areas')),
    getDocs(inventoryCol('locations'))
  ]);
  const areaNames = new Map(areaSnap.docs.map(entry => [entry.id, entry.data().name || '']));
  return locationSnap.docs
    .map(entry => ({ id: entry.id, ...entry.data() }))
    .map(location => ({
      id: location.id,
      name: String(location.name || ''),
      areaName: areaNames.get(location.areaId) || '未分類',
      sortOrder: Number.isFinite(Number(location.sortOrder)) ? Number(location.sortOrder) : Number.POSITIVE_INFINITY
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja'));
}

/** なかみメモの在庫。まとめ先を決めるのに使う。 */
async function readInventoryItems() {
  if (!currentUser) return [];
  const snap = await getDocs(inventoryCol('items'));
  return snap.docs.map(entry => ({ id: entry.id, ...entry.data() }));
}

/**
 * レシートの明細を、なかみメモの在庫に入れる。
 * plan は finance-engine の planInventoryAdditions が作ったもの（新しく作る分と、既にある在庫に足す分）。
 * 明細側には inventoryItemId を書き戻し、どの在庫になったか分かるようにする。
 */
async function addToInventory(plan) {
  if (!connected()) return { created: 0, merged: 0 };
  const workspaceId = currentWorkspace.id;
  const now = new Date();
  const batch = writeBatch(db);

  (plan.creates || []).forEach(row => {
    const ref = doc(inventoryCol('items'));
    batch.set(ref, {
      locationId: row.locationId,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      category: row.category,
      purchaseRef: row.purchaseRef,
      purchasePrice: row.purchasePrice,
      // なかみメモが「使い切った／捨てた」をこの共有スペースの明細へ返すのに使う
      purchaseWorkspaceId: workspaceId,
      createdAt: now,
      updatedAt: now
    });
    // 商品にまとめた値引き行にも同じ在庫のIDを書く。なかみメモが「捨てた」を返すとき、値引き後の額で無駄を出せる
    const lineIds = Array.isArray(row.lineIds) && row.lineIds.length ? row.lineIds : [row.lineId];
    lineIds.filter(Boolean).forEach(lineId => {
      batch.update(doc(db, 'workspaces', workspaceId, 'receiptItems', lineId), {
        inventoryItemId: ref.id,
        updatedAt: now.toISOString()
      });
    });
  });

  (plan.merges || []).forEach(row => {
    // また買って在庫が戻るので、「使い切った／捨てた」の印は消す（残すと棚にあるのに使い切った扱いになる）。
    batch.update(doc(inventoryCol('items'), row.itemId), {
      quantity: row.quantity,
      purchaseWorkspaceId: workspaceId,
      outcome: 'in_stock',
      outcomeAt: '',
      outcomeReason: '',
      updatedAt: now
    });
    (row.lineIds || []).forEach(lineId => {
      if (!lineId) return;
      batch.update(doc(db, 'workspaces', workspaceId, 'receiptItems', lineId), {
        inventoryItemId: row.itemId,
        updatedAt: now.toISOString()
      });
    });
  });

  await batch.commit();
  return { created: (plan.creates || []).length, merged: (plan.merges || []).length };
}

/** レシートの状態（未確認・確認済みなど）だけを変える。明細行には触らない。 */
async function updateReceiptStatus(receiptId, status) {
  if (!connected() || !receiptId) return false;
  if (!['pending', 'accepted', 'needs_review', 'ignored'].includes(status)) return false;
  await updateDoc(doc(db, 'workspaces', currentWorkspace.id, 'receipts', receiptId), {
    status,
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
  if (stopOutcomeQueue) stopOutcomeQueue();
  stopOutcomeQueue = null;
  householdId = null;
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
  updateReceiptStatus,
  deleteReceipt,
  readInventoryLocations,
  readInventoryItems,
  addToInventory,
  saveItemAlias,
  deleteItemAlias
};
