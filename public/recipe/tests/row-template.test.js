/* B-1（行テンプレートの共通化）の回帰テスト。
   リファクタ前の3つのインラインテンプレート（下の OLD_* にそのまま写したもの）と、
   app.js の row() 経由の recipeRow / pickRow / shoppingRow の出力が
   1文字も違わないことを確かめる。

   実行:  node tests/row-template.test.js
   一覧の見た目を意図して変えるときは、OLD_* も同じ形に更新すること。 */

const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

/* 中括弧を数えて宣言を切り出す（対象の宣言は文字列内に { } を含まない）。 */
function extract(marker) {
  const start = SOURCE.indexOf(marker);
  if (start < 0) throw new Error("見つかりません: " + marker);
  let depth = 0;
  for (let i = SOURCE.indexOf("{", start); i < SOURCE.length; i++) {
    if (SOURCE[i] === "{") depth++;
    else if (SOURCE[i] === "}") {
      depth--;
      if (depth === 0) return SOURCE.slice(start, i + 1);
    }
  }
  throw new Error("閉じ括弧が見つかりません: " + marker);
}

const sandbox = new Function([
  extract("const ICONS = {"),
  extract("function esc("),
  extract("function daysAgoLabel("),
  extract("function thumb("),
  extract("function row("),
  extract("function recipeRow("),
  extract("function pickRow("),
  extract("function shoppingRow("),
  "return { ICONS, esc, daysAgoLabel, thumb, recipeRow, pickRow, shoppingRow };"
].join("\n\n"))();

const { ICONS, esc, daysAgoLabel, thumb } = sandbox;

/* ---------- リファクタ前のテンプレート（原文のまま） ---------- */

function OLD_recipeRow(recipe) {
  const meta = [recipe.category, "材料" + recipe.ingredients.length, recipe.servings + "人分"].join(" ／ ");
  return '<button class="row row--recipe" data-action="detail" data-id="' + esc(recipe.id) + '">' + thumb(recipe) +
    '<span class="row__main"><span class="row__title">' + esc(recipe.title) + '</span><span class="row__meta">' + esc(meta) + '</span><span class="row__sub">' + esc(daysAgoLabel(recipe.lastCookedAt)) + "</span></span>" +
    '<span class="row__go">' + ICONS.chevron + "</span></button>";
}

function OLD_pickRow(recipe, picked) {
  return '<button class="row row--pick ' + (picked ? "is-picked" : "") + '" data-action="toggle-pick" data-id="' + esc(recipe.id) + '">' + thumb(recipe) +
    '<span class="row__main"><span class="row__title">' + esc(recipe.title) + '</span><span class="row__meta">' + esc(recipe.category) + " ／ 材料" + recipe.ingredients.length + "</span></span>" +
    '<span class="row__check">' + (picked ? ICONS.check : "") + "</span></button>";
}

const OLD_shoppingRow = (item) => '<label class="row row--check"><input type="checkbox" data-action="toggle-shopping" data-id="' + esc(item.id) + '" ' + (item.done ? "checked" : "") + ' /><span class="row__main"><span class="row__title">' + esc(item.name) + "</span>" + (item.recipeTitle ? '<span class="row__meta">' + esc(item.recipeTitle) + "</span>" : "") + '</span><button type="button" class="line__remove" data-action="remove-shopping" data-id="' + esc(item.id) + '" aria-label="削除">' + ICONS.close + "</button></label>";

/* ---------- 入力 ---------- */

const RECIPES = [
  { id: "recipes-1", title: "照り焼きチキン", category: "主菜", servings: 2, ingredients: ["鶏もも肉 300g", "しょうゆ"], image: "", lastCookedAt: 0 },
  { id: "recipes-2", title: '<script>"危険" & 記号\'', category: "副菜", servings: 4, ingredients: [], image: "https://example.com/a.jpg?x=1&y=2", lastCookedAt: Date.now() - 86400000 },
  { id: "r&3", title: "", category: "その他", servings: 1, ingredients: ["a", "b", "c"], image: "", lastCookedAt: Date.now() - 86400000 * 400 },
  { id: "recipes-4", title: "味噌汁", category: "汁物", servings: 3, ingredients: ["だし"], image: "blob:x", lastCookedAt: Date.now() }
];

const SHOPPING = [
  { id: "shopping-1", name: "牛乳", recipeTitle: "", done: false },
  { id: "shopping-2", name: "鶏もも肉 300g", recipeTitle: "照り焼きチキン", done: true },
  { id: "s&3", name: '<b>"卵"</b>', recipeTitle: "'カルボナーラ'", done: false },
  { id: "shopping-4", name: "塩", recipeTitle: "味噌汁", done: true }
];

/* ---------- 比較 ---------- */

let checked = 0;
let failed = 0;

function same(label, expected, actual) {
  checked++;
  if (expected === actual) return;
  failed++;
  console.error("NG " + label);
  console.error("  before: " + JSON.stringify(expected));
  console.error("  after : " + JSON.stringify(actual));
}

RECIPES.forEach((recipe, index) => {
  same("recipeRow[" + index + "]", OLD_recipeRow(recipe), sandbox.recipeRow(recipe));
  [true, false].forEach((picked) => {
    same("pickRow[" + index + "] picked=" + picked, OLD_pickRow(recipe, picked), sandbox.pickRow(recipe, picked));
  });
});

SHOPPING.forEach((item, index) => {
  same("shoppingRow[" + index + "]", OLD_shoppingRow(item), sandbox.shoppingRow(item));
});

if (failed) {
  console.error("\n" + failed + " / " + checked + " 件が不一致です。");
  process.exit(1);
}
console.log("OK: " + checked + " 件すべて、リファクタ前とHTML出力が一致しました。");
