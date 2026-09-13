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

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
