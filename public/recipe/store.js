/* Firestore と Storage の読み書きをまとめた層。
   データは users/{uid}/ の下にユーザーごとに分かれて入る。

     users/{uid}/recipes/{recipeId}
     users/{uid}/plans/{planId}
     users/{uid}/shopping/{itemId}

   表示の好み（テーマ・並び順・検索条件）は端末ごとの設定として localStorage に置き、
   Firestore には同期しない。 */

import { db, getIdToken } from "./firebase.js";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

let uid = null;

export function setUser(nextUid) { uid = nextUid; }

function col(name) { return collection(db, "users", uid, name); }

export function newId(name) { return doc(col(name)).id; }

/* コレクションの購読。ローカルキャッシュがあるため、
   オフラインでもすぐに手元のデータが返ってくる。 */
export function subscribe(name, onData, onError) {
  return onSnapshot(col(name), { includeMetadataChanges: true }, (snap) => {
    const items = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    onData(items, { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
  }, onError);
}

/* 書き込みは待たない。オフラインのときサーバー確認が返らず固まるため、
   ローカルキャッシュへの反映（＝購読側の即時更新）に任せる。 */
export function saveDocument(name, id, data) {
  return setDoc(doc(col(name), id), data).catch(reportWriteError);
}

export function patchDocument(name, id, data) {
  return updateDoc(doc(col(name), id), data).catch(reportWriteError);
}

export function removeDocument(name, id) {
  return deleteDoc(doc(col(name), id)).catch(reportWriteError);
}

/* Firestore のバッチ上限は500件なので、それ以下に切って流す。
   既定では commit を待たない（オフラインでサーバー確認が返らず固まるのを避けるため）。
   waitForCommit を true にしたときだけ完了を待つ。「全部消してから入れ直す」のように
   順序が保証されないと壊れる処理でのみ使い、呼び出し側で失敗を受け止めること。 */
async function runBatches(operations, waitForCommit) {
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(db);
    operations.slice(index, index + 400).forEach((apply) => apply(batch));
    const commit = batch.commit();
    if (waitForCommit) await commit;
    else commit.catch(reportWriteError);
  }
}

function setOperations(name, items) {
  return items.map((item) => (batch) => {
    const { id, ...data } = item;
    batch.set(doc(col(name), id), data);
  });
}

function deleteOperations(name, ids) {
  return ids.map((id) => (batch) => batch.delete(doc(col(name), id)));
}

export function saveMany(name, items) {
  return runBatches(setOperations(name, items));
}

export function removeMany(name, ids) {
  return runBatches(deleteOperations(name, ids));
}

/* コレクションを丸ごと空にする。JSON取込のように「消してから入れ直す」用途なので、
   削除の commit を待ってから返す（待たないと直後の saveMany と順序が入れ替わりうる）。
   オフラインでは解決しないので、呼び出し側でオンライン確認と失敗処理を行うこと。 */
export async function removeCollection(name) {
  const snap = await getDocs(col(name));
  await runBatches(deleteOperations(name, snap.docs.map((entry) => entry.id)), true);
}

/* ---------- 写真 ---------- */

/* 画像は Supabase Storage に置く。ただし書き込み用のキーはブラウザに出せないので、
   同一オリジンの画像API（Next.js の Route Handler）を経由する。
   このアプリが /recipe/ に同居していることが前提。別のドメインに単独で置く場合は、
   ここを "https://nakami-memo.vercel.app/api/images/upload" のような絶対URLにする。 */
const IMAGE_API = "/api/images/upload";

async function authHeader() {
  const token = await getIdToken();
  if (!token) throw new Error("ログインを確認できませんでした");
  return { Authorization: "Bearer " + token };
}

/* サーバーが返すユーザー向けメッセージを、そのままトーストに出せる形にして投げる。 */
async function toError(response, fallback) {
  const body = await response.json().catch(() => null);
  return new Error((body && body.error) || fallback);
}

export async function uploadRecipeImage(recipeId, blob) {
  const form = new FormData();
  form.append("app", "recipe");
  form.append("collection", "recipes");
  form.append("recordId", recipeId);
  /* Blob のままだとサーバー側で File として受け取れないので、ファイル名を付ける。 */
  form.append("file", blob, recipeId + ".jpg");

  const response = await fetch(IMAGE_API, {
    method: "POST",
    headers: await authHeader(),
    body: form
  });
  if (!response.ok) throw await toError(response, "写真をアップロードできませんでした");

  const data = await response.json();
  return data.url;
}

export async function deleteRecipeImage(recipeId) {
  const response = await fetch(IMAGE_API, {
    method: "DELETE",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ app: "recipe", collection: "recipes", recordId: recipeId })
  });
  /* 元から無い場合も成功扱いでよい。消えていることが目的なので。 */
  if (!response.ok && response.status !== 404) throw await toError(response, "写真を削除できませんでした");
}

/* ---------- エラー通知 ---------- */

let errorHandler = () => {};
export function onWriteError(handler) { errorHandler = handler; }
function reportWriteError(error) {
  if (!error) return;
  if (error.code === "unavailable" || error.code === "failed-precondition") return; /* オフラインは後で同期される */
  errorHandler(error);
}
