/* 引っ越しページの本体。
 *
 * 3つの Firebase プロジェクトに同時につなぎ、本人のログインで「古い uid の下」を読み、「新しい uid の下」へ書く。
 * サービスアカウントの鍵は使わない。読み書きはそれぞれのプロジェクトのセキュリティルールに従う
 * （引っ越し先 cash-manege には、先に public/money/firestore.rules を公開しておく必要がある）。
 *
 * Firebase の uid はプロジェクトごとに振られるので、同じ Google アカウントでも元と先で違う。
 * だから「そのままコピー」ではなく、users/{古いuid}/… を users/{新しいuid}/… へ書き写す。
 * ドキュメントIDは変えない（items.locationId → locations のような参照を壊さないため）。
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, getFirestore, writeBatch } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { SOURCES, chunk, compareCollections, publicTokensOf, remapPublicLocation, sameAccount } from "./plan.js";

/* 各プロジェクトの公開してよい設定値（それぞれのアプリのコードに書かれているものと同じ）。 */
const CONFIGS = {
  cash: {
    apiKey: "AIzaSyA4qpbwxpp8tEEWLCkNMPIYuDTN7G9cF3A",
    authDomain: "cash-manege.firebaseapp.com",
    projectId: "cash-manege",
    storageBucket: "cash-manege.firebasestorage.app",
    messagingSenderId: "529145553530",
    appId: "1:529145553530:web:d65452017ffb9c109b51c3",
  },
  nakami: {
    apiKey: "AIzaSyBSCQ8iB_IQbDpgep8dtL9k4rbritgNuNc",
    authDomain: "nakami-memo.firebaseapp.com",
    projectId: "nakami-memo",
    storageBucket: "nakami-memo.firebasestorage.app",
    messagingSenderId: "591525975861",
    appId: "1:591525975861:web:90bbb1d8264588d81b5e7c",
  },
  recipe: {
    apiKey: "AIzaSyClrHXJL7HDrEfCU0chH2FUuXCu54aQcQ0",
    authDomain: "recipe-a18e1.firebaseapp.com",
    projectId: "recipe-a18e1",
    storageBucket: "recipe-a18e1.firebasestorage.app",
    messagingSenderId: "692052886567",
    appId: "1:692052886567:web:ade3712cd78f2863283a02",
  },
};

/* アプリ名を分けて初期化する。同じページで3つのログインを別々に持てる。 */
const projects = Object.fromEntries(Object.entries(CONFIGS).map(([key, config]) => {
  const app = initializeApp(config, `migrate-${key}`);
  return [key, { auth: getAuth(app), db: getFirestore(app), user: null }];
}));

/** 引っ越し元ごとの読み取り結果。書き写しと照合の両方で使う。 */
const snapshots = { nakami: null, recipe: null };

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function log(message) {
  const node = $("log");
  node.textContent += "\n" + new Date().toLocaleTimeString("ja-JP") + "  " + message;
  node.scrollTop = node.scrollHeight;
}

function shortUid(uid) {
  return uid ? "ID 末尾 " + uid.slice(-6) : "";
}

/* ---------- ログイン ---------- */

async function login(key) {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(projects[key].auth, provider);
  } catch (error) {
    log(`ログインできませんでした（${key}）: ${error.code || error.message}`);
    if (String(error.code).includes("unauthorized-domain")) {
      log("→ そのプロジェクトの Authentication の「承認済みドメイン」に nakami-memo.vercel.app を追加してください。");
    }
  }
}

function checkAccounts() {
  const emails = ["cash", "nakami", "recipe"].map((key) => projects[key].user?.email || null);
  const same = sameAccount(emails);
  $("account-warning").hidden = same;
  if (!same) {
    $("account-warning-text").textContent =
      "3つとも同じ Google アカウントでログインしてください。違うアカウントのデータを混ぜないよう、書き写しは止めています。"
      + `（お金管理: ${emails[0] || "未"} ／ なかみメモ: ${emails[1] || "未"} ／ つくりおき: ${emails[2] || "未"}）`;
  }
  return same;
}

function refreshCopyButton() {
  const ready = projects.cash.user && (snapshots.nakami || snapshots.recipe) && checkAccounts();
  $("copy").disabled = !ready;
}

/* ---------- 読み取り（引っ越し元） ---------- */

async function readSource(key) {
  const project = projects[key];
  const source = SOURCES.find((entry) => entry.key === key);
  const uid = project.user.uid;
  const result = { uid, collections: {}, userDoc: null, publicLocations: [] };

  for (const { name } of source.collections) {
    const snap = await getDocs(collection(project.db, "users", uid, name));
    result.collections[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  const userSnap = await getDoc(doc(project.db, "users", uid));
  if (userSnap.exists()) result.userDoc = userSnap.data();

  // なかみメモの公開閲覧ページ。一覧は取れないので、公開中の保管場所のトークンから1件ずつ読む
  if (key === "nakami") {
    const tokens = publicTokensOf((result.collections.locations || []).map((entry) => entry.data));
    for (const token of tokens) {
      const snap = await getDoc(doc(project.db, "publicLocations", token));
      if (snap.exists()) result.publicLocations.push({ id: token, data: snap.data() });
    }
  }
  return result;
}

function renderCounts(key) {
  const source = SOURCES.find((entry) => entry.key === key);
  const snap = snapshots[key];
  const rows = source.collections
    .map(({ name, label }) => `<tr><td>${esc(label)}</td><td class="num">${snap.collections[name].length} 件</td></tr>`)
    .join("");
  const extra = key === "nakami" ? `<tr><td>公開中の保管場所</td><td class="num">${snap.publicLocations.length} 件</td></tr>` : "";
  $(`count-${key}`).innerHTML = `<table><tbody>${rows}${extra}</tbody></table>`;
}

/* ---------- 書き写し ---------- */

async function copyAll() {
  $("copy").disabled = true;
  const cash = projects.cash;
  const newUid = cash.user.uid;
  const report = [];
  try {
    for (const key of ["nakami", "recipe"]) {
      const snap = snapshots[key];
      if (!snap) { log(`${key}: ログインしていないので飛ばします`); continue; }
      const source = SOURCES.find((entry) => entry.key === key);

      if (snap.userDoc) {
        const batch = writeBatch(cash.db);
        batch.set(doc(cash.db, "users", newUid), snap.userDoc, { merge: true });
        await batch.commit();
      }

      for (const { name, label } of source.collections) {
        const docs = snap.collections[name];
        for (const part of chunk(docs)) {
          const batch = writeBatch(cash.db);
          part.forEach(({ id, data }) => batch.set(doc(cash.db, "users", newUid, name, id), data));
          await batch.commit();
        }
        log(`${source.label}の${label}: ${docs.length} 件を書き写しました`);

        const dest = await getDocs(collection(cash.db, "users", newUid, name));
        report.push({ label: `${source.label}・${label}`, ...compareCollections(docs.map((d) => d.id), dest.docs.map((d) => d.id)) });
      }

      if (key === "nakami" && snap.publicLocations.length) {
        for (const part of chunk(snap.publicLocations)) {
          const batch = writeBatch(cash.db);
          part.forEach(({ id, data }) => batch.set(doc(cash.db, "publicLocations", id), remapPublicLocation(data, newUid)));
          await batch.commit();
        }
        // 公開ドキュメントは一覧が取れないので、1件ずつ読めるかで照合する
        const found = [];
        for (const { id } of snap.publicLocations) {
          const check = await getDoc(doc(cash.db, "publicLocations", id));
          if (check.exists() && check.data().ownerId === newUid) found.push(id);
        }
        log(`公開中の保管場所: ${snap.publicLocations.length} 件を書き写しました`);
        report.push({ label: "なかみメモ・公開中の保管場所", ...compareCollections(snap.publicLocations.map((d) => d.id), found) });
      }
    }
    renderReport(report);
  } catch (error) {
    log(`書き写しの途中で止まりました: ${error.code || error.message}`);
    if (String(error.code).includes("permission-denied")) {
      log("→ cash-manege に新しいセキュリティルールが公開されていない可能性があります。公開してから、もう一度押してください（途中まで書いた分は上書きされるだけです）。");
    }
    if (report.length) renderReport(report);
  } finally {
    refreshCopyButton();
  }
}

function renderReport(report) {
  const allOk = report.every((row) => row.ok);
  const rows = report.map((row) => `<tr>
    <td>${esc(row.label)}</td><td class="num">元 ${row.source}</td><td class="num">先 ${row.dest}</td>
    <td class="${row.ok ? "ok" : "ng"}">${row.ok ? "一致" : `${row.missing.length} 件足りない`}</td></tr>`).join("");
  $("result").innerHTML = `<table><tbody>${rows}</tbody></table>
    <p class="${allOk ? "ok" : "ng"}">${allOk ? "すべて書き写せました。この画面を閉じて大丈夫です。" : "足りないものがあります。もう一度「書き写す」を押してください。"}</p>`;
  log(allOk ? "照合: すべて一致" : "照合: 足りないものがあります");
}

/* ---------- 画面の配線 ---------- */

document.querySelectorAll("[data-login]").forEach((button) => {
  button.addEventListener("click", () => login(button.dataset.login));
});
$("copy").addEventListener("click", copyAll);

for (const key of ["cash", "nakami", "recipe"]) {
  onAuthStateChanged(projects[key].auth, async (user) => {
    projects[key].user = user;
    $(`who-${key}`).textContent = user ? `${user.email} でログイン中（${shortUid(user.uid)}）` : "まだログインしていません";
    if (key !== "cash") {
      snapshots[key] = null;
      $(`count-${key}`).innerHTML = "";
      if (user) {
        try {
          log(`${key === "nakami" ? "なかみメモ" : "つくりおきノート"}のデータを数えています…`);
          snapshots[key] = await readSource(key);
          renderCounts(key);
          log("数え終わりました");
        } catch (error) {
          log(`読み取れませんでした（${key}）: ${error.code || error.message}`);
        }
      }
    }
    refreshCopyButton();
  });
}
