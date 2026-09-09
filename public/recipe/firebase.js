/* Firebase の初期化。SDK は gstatic の CDN から読み込む（ビルド不要）。 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, useEmulators } from "./firebase-config.js";

/* firebase-config.js がプレースホルダーのままなら、アプリ側で案内を出すための目印。 */
export const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");

/* app / auth はこのファイルの中だけで使う（外へは signIn などの関数で公開する）。 */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* オフライン永続化。複数タブを開いても壊れないよう multi-tab マネージャを使う。
   これにより、電波のない場所でも閲覧・編集ができ、復帰時にまとめて同期される。 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/* 写真は Firebase Storage ではなく、同一オリジンの画像APIへ送る。
   Cloud Storage for Firebase は2024年9月以降、バケットの作成に Blaze プラン
   （クレジットカード登録）が必須になり、Spark のままでは有効化できないため。 */

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

/* 画像APIに渡す本人確認用のトークン。サーバー側で Google に問い合わせて検証される。 */
export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/* インストール済みPWAやアプリ内ブラウザではポップアップが塞がれることがあるため、
   失敗したらリダイレクト方式にフォールバックする。 */
export async function signIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const fallback = ["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"];
    if (fallback.includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw error;
  }
}

export function signOutUser() { return signOut(auth); }
export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }
export function consumeRedirectResult() { return getRedirectResult(auth).catch(() => null); }
