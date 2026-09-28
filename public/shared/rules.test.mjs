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
        // 2026-09-28 から、場所は space.ts の spaceCollection / spaceDoc で組み立てる（家に入っていれば家）
        for (const m of text.matchAll(/space(?:Collection|Doc)\(\s*\w+\s*,\s*"([^"]+)"/g)) found.add(m[1]);
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

/** 本人の場所（users/{uid}）でだけ許す名前（家には置かないもの。からだの記録 health など。2026-09-28） */
const personalOnly = (() => {
  const usersBlock = rules.slice(rules.indexOf("match /users/{userId} {"), rules.indexOf("match /households/{householdId} {"));
  return new Set([...usersBlock.matchAll(/collection == '([^']+)'/g)].map((m) => m[1]));
})();

t("なかみメモが使う users/{uid} のコレクションが、すべてルールで許されている", () => {
  const used = nakamiCollections();
  ok(used.size >= 3, `拾えた数が少なすぎる（読み取りの正規表現が壊れていないか）: ${[...used]}`);
  const missing = [...used].filter((name) => !allowed.has(name) && !personalOnly.has(name));
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

t("3アプリのログインの受け口（authDomain）が自分のサイトで、そこから Firebase へ中継している（2026-09-28）", () => {
  // 別のサイト（cash-manege.firebaseapp.com）のままだと、インストールしたアプリのログインが
  // 「missing initial state」で止まる。1つでも戻すと、そのアプリだけ止まる
  const pick = (text) => (text.match(/authDomain:\s*["']([^"']+)["']/) || [])[1];
  const apps = {
    "お金管理（public/money/firebase-sync.js）": read("public", "money", "firebase-sync.js"),
    "つくりおきノート（public/recipe/firebase-config.js）": read("public", "recipe", "firebase-config.js"),
    "なかみメモ（src/lib/firebase/config.ts）": read("src", "lib", "firebase", "config.ts"),
  };
  for (const [label, text] of Object.entries(apps)) ok(pick(text) === "nakami-memo.vercel.app", `${label} の authDomain が ${pick(text)}`);
  const config = read("next.config.ts");
  ok(config.includes('FIREBASE_AUTH_PROXY = "https://cash-manege.firebaseapp.com"'), "中継先が cash-manege ではない");
  for (const source of ["/__/auth/:path*", "/__/firebase/:path*"]) ok(config.includes(`source: "${source}"`), `${source} の中継が無い`);
});

t("なかみメモは Firebase の接続先を環境変数から読まない（Vercel に古い値が残っているため）", () => {
  const client = read("src", "lib", "firebase", "client.ts");
  ok(!client.includes("process.env"), "client.ts が環境変数を読んでいる");
  const route = read("src", "app", "api", "images", "upload", "route.ts");
  ok(!/NEXT_PUBLIC_(RECIPE_)?FIREBASE/.test(route), "画像APIが古い環境変数を読んでいる");
});

/* ---------- 同居人と共有する「家」（2026-09-28） ---------- */

const householdBlock = (() => {
  const start = rules.indexOf("match /households/{householdId} {");
  const end = rules.indexOf("match /householdInvites/{code} {");
  return start >= 0 && end > start ? rules.slice(start, end) : "";
})();

t("家（households）のルールがあり、一覧は断り、メンバーだけが中身を読み書きできる", () => {
  ok(householdBlock, "households の match が無い");
  ok(/allow list: if false;/.test(householdBlock), "家の一覧を断っていない");
  ok(/allow read, write: if isHouseholdMember\(householdId\) && allowedHouseholdCollection\(collection\);/.test(householdBlock), "中身はメンバーだけ");
});

t("家に写すコレクションが、すべて家のルールで許されている（写すと保存が黙って失敗する、を防ぐ）", () => {
  const core = read("src", "lib", "household", "household-core.ts");
  const list = core.match(/HOUSEHOLD_COLLECTIONS = \[([^\]]+)\]/);
  ok(list, "HOUSEHOLD_COLLECTIONS が見つからない");
  const names = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  ok(names.length >= 8, `拾えた数: ${names}`);
  const missing = names.filter((name) => !allowed.has(name));
  ok(!missing.length, `家のルールに無い: ${missing.join(", ")}`);
  // 逆に、本人の場所にあるのに家へ写さないコレクションがあると、家を作った時点でそのデータが見えなくなる
  const notCopied = [...allowed].filter((name) => !names.includes(name));
  ok(!notCopied.length, `家へ写していない: ${notCopied.join(", ")}`);
  ok(/allowedHouseholdCollection\(name\)\s*\{\s*return allowedUserCollection\(name\) \|\| name in \['outcomeQueue'\]/.test(rules), "受け渡し箱（outcomeQueue）が家で許されていない");
});

t("家に自分を足せるのは、有効な招待コードを持っているときだけ", () => {
  ok(/validInvite\(request\.resource\.data\.joinedWith, householdId\)/.test(householdBlock), "招待コードを確かめていない");
  ok(/request\.resource\.data\.memberUids\.size\(\) == resource\.data\.memberUids\.size\(\) \+ 1/.test(householdBlock), "1人ずつしか足せない、になっていない");
  ok(/invite\.data\.expiresAt > request\.time/.test(rules), "招待の期限を見ていない");
});

t("招待コードは1件ずつしか読めず（一覧は断る）、作れるのは家のメンバーだけ", () => {
  const block = rules.match(/match \/householdInvites\/\{code\} \{([\s\S]*?)\n    \}/);
  ok(block, "householdInvites の match が無い");
  ok(/allow list: if false;/.test(block[1]), "招待の一覧を断っていない（コードを総当たりで見られる）");
  ok(/isHouseholdMember\(request\.resource\.data\.householdId\)/.test(block[1]), "メンバー以外も招待を作れる");
});

t("お金管理（workspaces）は家に入れない（同居人と共有しない、というユーザーの希望）", () => {
  ok(!householdBlock.includes("workspaces"), "家のルールが workspaces に触れている");
  const core = read("src", "lib", "household", "household-core.ts");
  ok(!/HOUSEHOLD_COLLECTIONS = \[[^\]]*(receipts|transactions|workspaces)/.test(core), "お金管理のデータを家に写そうとしている");
});

t("3アプリとも、家に入っていれば家の場所を使う（ずれると別の在庫を見る）", () => {
  ok(read("src", "lib", "firebase", "space.ts").includes("spaceSegments(userId, activeHouseholdId)"), "なかみメモ");
  ok(/collection\(db, "households", householdId, name\)/.test(read("public", "recipe", "store.js")), "つくりおきノート");
  ok(/collection\(db, 'households', householdId, name\)/.test(read("public", "money", "firebase-sync.js")), "お金管理（在庫に入れる）");
  ok(/spaceSegments\(uid, householdId\)/.test(read("src", "app", "api", "recipes", "suggest", "route.ts")), "レシピ提案のサーバー");
});

t("からだの記録（health）は本人の場所にだけ置け、同居人と共有する家には置けない", () => {
  const usersBlock = rules.slice(rules.indexOf("match /users/{userId} {"), rules.indexOf("match /households/{householdId} {"));
  ok(/allowedUserCollection\(collection\) \|\| collection == 'health'/.test(usersBlock), "本人の場所で health が許されていない");
  ok(!allowed.has("health"), "health が allowedUserCollection に入っている（家にも置けてしまう）");
  ok(!householdBlock.includes("'health'"), "家のルールが health を許している");
  const store = read("src", "lib", "firebase", "health.ts");
  ok(/collection\(db, "users", uid, "health"\)/.test(store), "からだの記録を本人の場所以外に書いている");
  ok(!store.includes("spaceCollection"), "からだの記録が家の場所（space.ts）を通っている");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
