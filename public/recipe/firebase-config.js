/* Firebase の設定値。
   Firebase コンソール →「プロジェクトの設定」→「マイアプリ」→ ウェブアプリの構成 で表示されるもの。

   ここに書く値は公開されても問題ないもの（クライアントを識別するための値）です。
   データを守るのは firestore.rules / storage.rules の側です。 */

/* 2026-09-14 に3アプリの Firebase を cash-manege 1つにまとめた。
   引っ越し前は recipe-a18e1（データは消さずに残してある）。
   お金管理（public/money/firebase-sync.js）となかみメモ（src/lib/firebase/config.ts）と同じ値。 */
export const firebaseConfig = {
  apiKey: "AIzaSyA4qpbwxpp8tEEWLCkNMPIYuDTN7G9cF3A",
  authDomain: "cash-manege.firebaseapp.com",
  projectId: "cash-manege",
  storageBucket: "cash-manege.firebasestorage.app",
  messagingSenderId: "529145553530",
  appId: "1:529145553530:web:d65452017ffb9c109b51c3"
};

/* ローカルで Firebase エミュレータに接続したいときだけ true にする。
   （firebase emulators:start を動かしている状態でのみ使う） */
export const useEmulators = false;
