/* 引っ越しページ（public/migrate/）の、Firebase を使わない部分の確認。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SOURCES, BATCH_SIZE, chunk, compareCollections, publicTokensOf, remapPublicLocation, sameAccount } from "../migrate/plan.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("失敗 " + name + "  →  " + (e.message || e)); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: 期待 ${b} / 実際 ${a}`);
}
function ok(cond, label) { if (!cond) throw new Error(label); }

t("書き写すコレクションが、アプリの使うものと、引っ越し先のルールで許されるものに揃っている", () => {
  const names = SOURCES.flatMap((source) => source.collections.map((c) => c.name));
  eq(names, ["areas", "locations", "items", "recipes", "plans", "shopping"], "書き写す名前");
  const rules = readFileSync(path.join(ROOT, "public", "money", "firestore.rules"), "utf8");
  for (const name of names) ok(rules.includes(`'${name}'`), `ルールに ${name} が無い`);
});

t("バッチは Firestore の上限（500件）を超えない大きさに分ける", () => {
  ok(BATCH_SIZE <= 500, "上限超え");
  const parts = chunk(Array.from({ length: 1001 }, (_, i) => i), 400);
  eq(parts.map((p) => p.length), [400, 400, 201], "分け方");
  eq(chunk([], 400), [], "空");
});

t("公開用ドキュメントは、公開中でトークンのある保管場所だけを拾う（重複なし）", () => {
  eq(publicTokensOf([
    { isPublic: true, publicToken: "a" },
    { isPublic: false, publicToken: "b" },
    { isPublic: true },
    { isPublic: true, publicToken: "a" },
    null,
  ]), ["a"], "トークン");
});

t("公開用ドキュメントの持ち主を新しい uid に書き換え、ほかの項目はそのまま", () => {
  const before = { ownerId: "old", locationId: "L1", isPublic: true, items: [{ name: "水", quantity: 2 }] };
  const after = remapPublicLocation(before, "new");
  eq(after.ownerId, "new", "ownerId");
  eq({ ...after, ownerId: "old" }, before, "ほかの項目");
  eq(before.ownerId, "old", "元のオブジェクトは変えない");
});

t("違う Google アカウントのログインが混ざっていたら止める", () => {
  ok(sameAccount(["a@example.com", "A@example.com", null]), "大文字小文字は同じ扱い・未ログインは比べない");
  ok(sameAccount([null, null, null]), "誰もログインしていない");
  ok(!sameAccount(["a@example.com", "b@example.com", null]), "違うアカウント");
});

t("照合は、元にあるIDが先に全部あるかで判定する（先の余分は失敗にしない）", () => {
  eq(compareCollections(["1", "2"], ["2", "1", "3"]), { source: 2, dest: 3, missing: [], ok: true }, "余分あり");
  eq(compareCollections(["1", "2"], ["1"]), { source: 2, dest: 1, missing: ["2"], ok: false }, "足りない");
});

t("引っ越しページは検索に出さず、アプリのどこからもリンクしていない", () => {
  const html = readFileSync(path.join(ROOT, "public", "migrate", "index.html"), "utf8");
  ok(html.includes('name="robots" content="noindex"'), "noindex");
  for (const file of [["public", "money", "index.html"], ["public", "recipe", "index.html"], ["public", "shared", "app-switcher.js"]]) {
    ok(!readFileSync(path.join(ROOT, ...file), "utf8").includes("/migrate"), `${file.join("/")} からリンクしている`);
  }
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
