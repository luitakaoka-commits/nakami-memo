#!/usr/bin/env node
/* つくりおきノートの「作った」で、なかみメモの在庫をどれだけ減らすかの確認。
 * 実行: node tests/cook-stock.test.js
 */
import { planFromSourceItems, remainingQuantity, rowsToApply } from "../../shared/cook-stock.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/* app.js の normalizeRecipe は、読み込みのたびにレシピを決まった形に作り直す。
   在庫との結びつき（sourceItems）をここで落とすと、「作った」の確認画面が出なくなる（2026-09-15 の不具合）。
   その回帰を止めるため、app.js から宣言を切り出してそのまま動かす（row-template.test.js と同じやり方）。 */
const APP_SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app.js"), "utf8");
function extract(marker) {
  const start = APP_SOURCE.indexOf(marker);
  if (start < 0) throw new Error("見つかりません: " + marker);
  let depth = 0;
  for (let i = APP_SOURCE.indexOf("{", start); i < APP_SOURCE.length; i++) {
    if (APP_SOURCE[i] === "{") depth++;
    else if (APP_SOURCE[i] === "}") {
      depth--;
      if (depth === 0) return APP_SOURCE.slice(start, i + 1);
    }
  }
  throw new Error("閉じ括弧が見つかりません: " + marker);
}
const appCode = new Function([
  "const CATEGORIES = " + APP_SOURCE.match(/const CATEGORIES = (\[[^\]]*\])/)[1] + ";",
  "const SOURCES = " + APP_SOURCE.match(/const SOURCES = (\[[^\]]*\])/)[1] + ";",
  extract("function uid("),
  extract("function normalizeSourceItems("),
  extract("function normalizeRecipe("),
  "return { normalizeRecipe, normalizeSourceItems };"
].join("\n\n"))();

let checked = 0;
let failed = 0;
function same(label, expected, actual) {
  checked += 1;
  const a = JSON.stringify(expected);
  const b = JSON.stringify(actual);
  if (a === b) return;
  failed += 1;
  console.error("NG " + label);
  console.error("  期待: " + a);
  console.error("  実際: " + b);
}

const ITEMS = [
  { id: "egg", name: "卵", quantity: 10, unit: "個" },
  { id: "milk", name: "牛乳", quantity: 300, unit: "mL" },
  { id: "bread", name: "食パン", quantity: 0, unit: "枚" },
];

const SOURCE = [
  { itemId: "egg", name: "卵", unit: "個", use: 1 },
  { itemId: "milk", name: "牛乳", unit: "mL", use: 500 },
  { itemId: "bread", name: "食パン", unit: "枚", use: 1 },
  { itemId: "gone", name: "消した食材", unit: "個", use: 1 },
];

const rows = planFromSourceItems(SOURCE, ITEMS);

same("いまの在庫にあるものだけ出す（消された食材は出さない）", ["egg", "milk", "bread"], rows.map((row) => row.itemId));
same("在庫より多くは減らさない（牛乳500mL → 在庫300mL）", 300, rows.find((row) => row.itemId === "milk").use);
same("在庫が0のものは0のまま", 0, rows.find((row) => row.itemId === "bread").use);
same("名前と単位はいまの在庫のものを使う", ["卵", "個", 10, 1], (() => { const r = rows[0]; return [r.name, r.unit, r.available, r.use]; })());
same("結びつきが無いレシピでは何も出ない", [], planFromSourceItems(undefined, ITEMS));
same("在庫が読めていないときも落ちない", [], planFromSourceItems(SOURCE, []));

same("実際に減らすのは1以上の行だけ", ["egg", "milk"], rowsToApply(rows).map((row) => row.itemId));
same("減らしたあとの数量", [9, 0, 0.9, 5], [
  remainingQuantity(10, 1),
  remainingQuantity(300, 500),
  remainingQuantity(1.1, 0.2),
  remainingQuantity(5, -1),
]);

/* ---------- 読み込みで結びつきを落とさない ---------- */

const saved = {
  id: "r1", title: "フレンチトースト", category: "お菓子", servings: 1,
  ingredients: ["食パン 1枚"], steps: ["焼く"], source: "AIの提案", createdAt: 1, lastCookedAt: 0,
  sourceItems: [{ itemId: "egg", name: "卵", unit: "個", use: 1 }]
};

same("読み込んでも在庫との結びつきが残る（これが落ちると確認画面が出ない）",
  [{ itemId: "egg", name: "卵", unit: "個", use: 1 }], appCode.normalizeRecipe(saved).sourceItems);
same("結びつきの無いレシピ（手で作ったもの）は空", [], appCode.normalizeRecipe({ title: "手作り" }).sourceItems);
same("壊れた結びつきは落とす", [{ itemId: "ok", name: "", unit: "", use: 0 }],
  appCode.normalizeSourceItems([{ itemId: "ok", use: -5 }, { name: "idなし" }, null, "文字列"]));
same("つくりおきノートで編集して保存し直しても、結びつきは引き継ぐ",
  [{ itemId: "egg", name: "卵", unit: "個", use: 1 }],
  appCode.normalizeRecipe({ ...saved, title: "名前を変えた" }).sourceItems);

if (failed) {
  console.error("\n" + failed + " / " + checked + " 件が不一致です。");
  process.exit(1);
}
console.log("OK: " + checked + " 件すべて期待どおりです。");
