/* cash-manege にまとめたルール（public/money/firestore.rules）が、3アプリの使う場所を全部許しているかの確認。
 *
 * ルールは Firebase Console に貼って公開するまで効かず、ブラウザで開くまで間違いに気づけない。
 * とくに「アプリが新しいコレクションを使い始めたのに、ルールのホワイトリストに足し忘れた」は、
 * 本番で保存だけが黙って失敗する形で出る。ここでアプリのコードとルールを突き合わせて固定する。
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("失敗 " + name + "  →  " + (e.message || e)); }
}
function ok(cond, label) { if (!cond) throw new Error(label); }

const rules = read("public", "money", "firestore.rules");
const allowed = (() => {
  const m = rules.match(/function allowedUserCollection\(name\)\s*\{\s*return name in \[([\s\S]*?)\]/);
  ok(m, "allowedUserCollection が見つからない");
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
})();

/** src 以下の TS/TSX から collection(db, "users", …, "名前") を拾う。 */
function nakamiCollections() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        for (const m of text.matchAll(/collection\(\s*db\s*,\s*"users"\s*,\s*\w+\s*,\s*"([^"]+)"/g)) found.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return found;
}

/** つくりおきノートは store.js の col(name) 経由で、app.js から watch("recipes") のように名前を渡す。 */
function recipeCollections() {
  const text = read("public", "recipe", "app.js");
  return new Set([...text.matchAll(/\b(?:watch|put|patch|remove|newId|readAll|getAll)[A-Za-z]*\(\s*"([a-z]+)"/g)].map((m) => m[1]));
}

t("なかみメモが使う users/{uid} のコレクションが、すべてルールで許されている", () => {
  const used = nakamiCollections();
  ok(used.size >= 3, `拾えた数が少なすぎる（読み取りの正規表現が壊れていないか）: ${[...used]}`);
  const missing = [...used].filter((name) => !allowed.has(name));
  ok(!missing.length, `ルールに無い: ${missing.join(", ")}`);
});

t("つくりおきノートが使うコレクションが、すべてルールで許されている", () => {
  const used = recipeCollections();
  ok(used.has("recipes") && used.has("plans") && used.has("shopping"), `拾えた名前: ${[...used]}`);
  const missing = [...used].filter((name) => !allowed.has(name));
  ok(!missing.length, `ルールに無い: ${missing.join(", ")}`);
});

t("なかみメモの公開閲覧（publicLocations）は、1件ずつの取得だけを許し、一覧は断る", () => {
  const block = rules.match(/match \/publicLocations\/\{publicToken\} \{([\s\S]*?)\n    \}/);
  ok(block, "publicLocations の match が無い");
  ok(/allow get: if resource\.data\.isPublic == true;/.test(block[1]), "get の条件");
  ok(/allow list: if false;/.test(block[1]), "list を断っていない");
});

t("お金管理の workspaces のルールはそのまま残っている", () => {
  for (const name of ["receipts", "receiptItems", "itemAliases", "importCandidates"]) {
    ok(rules.includes(`match /${name}/`), `${name} の match が消えている`);
  }
});

t("users と publicLocations は workspaces の外（documents の直下）にある", () => {
  // workspaces の中に入れてしまうと、パスが workspaces/{id}/users/... になりアプリから届かない
  const workspacesStart = rules.indexOf("match /workspaces/{workspaceId}");
  const usersStart = rules.indexOf("match /users/{userId}");
  ok(workspacesStart >= 0 && usersStart > workspacesStart, "順序");
  const between = rules.slice(workspacesStart, usersStart);
  const depth = [...between].reduce((d, ch) => d + (ch === "{" ? 1 : ch === "}" ? -1 : 0), 0);
  ok(depth === 0, `users の match が workspaces の中に入っている（括弧の深さ ${depth}）`);
});

t("3アプリが同じ Firebase プロジェクト（cash-manege）の同じ設定値につながっている", () => {
  // どれか1つでも別の値だと、そのアプリだけ別の場所に保存し、ログインも共有されない（2026-09-14 にまとめた）
  const pick = (text, key) => (text.match(new RegExp(`${key}:\\s*["']([^"']+)["']`)) || [])[1];
  const sources = {
    "お金管理（public/money/firebase-sync.js）": read("public", "money", "firebase-sync.js"),
    "つくりおきノート（public/recipe/firebase-config.js）": read("public", "recipe", "firebase-config.js"),
    "なかみメモ（src/lib/firebase/config.ts）": read("src", "lib", "firebase", "config.ts"),
    "引っ越しページの引っ越し先（public/migrate/migrate.js）": read("public", "migrate", "migrate.js").split("nakami:")[0],
  };
  for (const [label, text] of Object.entries(sources)) {
    ok(pick(text, "projectId") === "cash-manege", `${label} の projectId が ${pick(text, "projectId")}`);
    ok(pick(text, "apiKey") === "AIzaSyA4qpbwxpp8tEEWLCkNMPIYuDTN7G9cF3A", `${label} の apiKey が違う`);
    ok(pick(text, "appId") === "1:529145553530:web:d65452017ffb9c109b51c3", `${label} の appId が違う`);
  }
});

t("なかみメモは Firebase の接続先を環境変数から読まない（Vercel に古い値が残っているため）", () => {
  const client = read("src", "lib", "firebase", "client.ts");
  ok(!client.includes("process.env"), "client.ts が環境変数を読んでいる");
  const route = read("src", "app", "api", "images", "upload", "route.ts");
  ok(!/NEXT_PUBLIC_(RECIPE_)?FIREBASE/.test(route), "画像APIが古い環境変数を読んでいる");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
