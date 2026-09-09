/* Firebase の設定値。
   Firebase コンソール →「プロジェクトの設定」→「マイアプリ」→ ウェブアプリの構成 で表示されるもの。

   ここに書く値は公開されても問題ないもの（クライアントを識別するための値）です。
   データを守るのは firestore.rules / storage.rules の側です。 */

export const firebaseConfig = {
  apiKey: "AIzaSyClrHXJL7HDrEfCU0chH2FUuXCu54aQcQ0",
  authDomain: "recipe-a18e1.firebaseapp.com",
  projectId: "recipe-a18e1",
  storageBucket: "recipe-a18e1.firebasestorage.app",
  messagingSenderId: "692052886567",
  appId: "1:692052886567:web:ade3712cd78f2863283a02"
};

/* ローカルで Firebase エミュレータに接続したいときだけ true にする。
   （firebase emulators:start を動かしている状態でのみ使う） */
export const useEmulators = false;
