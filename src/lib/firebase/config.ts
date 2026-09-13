/**
 * Firebase の接続先。3アプリ（お金管理・なかみメモ・つくりおきノート）共通で cash-manege を使う。
 *
 * 2026-09-14 に3つのプロジェクトを cash-manege 1つにまとめた（設計書の案B）。
 * 同じサイト・同じプロジェクトになったので、どれか1つでログインすれば残りの2つもログイン済みになる。
 *
 * 値は環境変数ではなくここに書く。
 * - これはブラウザに配られる公開値で、秘密ではない（データを守るのは public/money/firestore.rules）
 * - Vercel には引っ越し前の nakami-memo の値が NEXT_PUBLIC_FIREBASE_* として残っており、
 *   環境変数を優先すると、そちらに黙ってつながってしまう
 * - お金管理（public/money/firebase-sync.js）とつくりおきノート（public/recipe/firebase-config.js）にも
 *   同じ値が書いてある。3か所が揃っているかは public/shared/rules.test.mjs が確かめる
 */
export const firebaseConfig = {
  apiKey: "AIzaSyA4qpbwxpp8tEEWLCkNMPIYuDTN7G9cF3A",
  authDomain: "cash-manege.firebaseapp.com",
  projectId: "cash-manege",
  storageBucket: "cash-manege.firebasestorage.app",
  messagingSenderId: "529145553530",
  appId: "1:529145553530:web:d65452017ffb9c109b51c3",
} as const;
