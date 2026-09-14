#!/usr/bin/env node
/* 買い物前チェック（Phase 4 手C）の確認。
 * 実行: node tests/pantry-check.test.js
 *
 * 品名の突き合わせは、お金管理の normalizeItemName を**本番と同じもの**で動かす。
 * ここで自前の簡易版を使うと、本番だけ表記ゆれで引けない、という一番ありがちな失敗を見逃す。
 */
import { buildPantryIndex, markPantryHits, pantryHitCount, pantryHitsFor, pantryNote } from "../../shared/pantry-check.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const finance = require(path.join(HERE, "..", "..", "money", "finance-engine.js"));
const normalize = (name) => finance.normalizeItemName(name);

let checked = 0;
let failed = 0;
function same(label, expected, actual) {
  checked += 1;
  const a = JSON.stringify(expected);
  const b = JSON.stringify(actual);
  if (a !== b) { failed += 1; console.error("NG   " + label + "\n  期待 " + a + "\n  実際 " + b); }
  else console.log("OK   " + label);
}

const INVENTORY = [
  { id: "milk", name: "牛乳", quantity: 500, unit: "mL" },
  { id: "moyashi", name: "もやし", quantity: 2, unit: "袋" },
  { id: "egg", name: "卵", quantity: 0, unit: "個" },
  { id: "shoyu", name: "* 3271 醤油", quantity: 1, unit: "本" },
  { id: "nameless", name: "", quantity: 3, unit: "個" },
  { id: "lowfat", name: "低脂肪乳", quantity: 1, unit: "本" }
];

const index = buildPantryIndex(INVENTORY, normalize);

same("数量0のものは「家にあります」と言わない", [], pantryHitsFor("卵", index, normalize));
same("名前の無い在庫は入れない", false, [...index.keys()].includes(""));

same("そのまま同じ名前なら当たる",
  [{ name: "もやし", quantity: 2, unit: "袋" }],
  pantryHitsFor("もやし", index, normalize));

same("量が付いた行でも当たる（材料は「名前 量」で入る）",
  [{ name: "牛乳", quantity: 500, unit: "mL" }],
  pantryHitsFor("牛乳 200mL", index, normalize));

same("カタカナ・全角半角のゆれを吸収する",
  [{ name: "もやし", quantity: 2, unit: "袋" }],
  pantryHitsFor("モヤシ", index, normalize));

same("レシートの部門コードが付いた在庫にも当たる",
  [{ name: "* 3271 醤油", quantity: 1, unit: "本" }],
  pantryHitsFor("醤油", index, normalize));

same("意味の判断はしない（牛乳と低脂肪乳は別のまま）", [], pantryHitsFor("低脂肪", index, normalize));
same("家に無いものには何も出さない", [], pantryHitsFor("鶏むね肉", index, normalize));

same("同じ名前の在庫が複数あれば全部出す",
  [{ name: "牛乳", quantity: 500, unit: "mL" }, { name: "牛乳", quantity: 1, unit: "本" }],
  pantryHitsFor("牛乳", buildPantryIndex([...INVENTORY, { id: "milk2", name: "牛乳", quantity: 1, unit: "本" }], normalize), normalize));

same("行に出す文", "家にまだあります（牛乳 500mL）", pantryNote(pantryHitsFor("牛乳", index, normalize)));
same("単位が無くても読める", "家にまだあります（謎の粉 2）", pantryNote([{ name: "謎の粉", quantity: 2, unit: "" }]));
same("当たらなければ何も出さない", "", pantryNote([]));

const SHOPPING = [
  { id: "s1", name: "牛乳 200mL", done: false, recipeTitle: "" },
  { id: "s2", name: "鶏むね肉 300g", done: false, recipeTitle: "" },
  { id: "s3", name: "もやし", done: true, recipeTitle: "" }
];
const marked = markPantryHits(SHOPPING, INVENTORY, normalize);

same("家にあるものだけに印が付く",
  ["家にまだあります（牛乳 500mL）", "", ""],
  marked.map((item) => item.pantryNote));
same("買ったものには出さない（言われても遅い）", "", marked[2].pantryNote);
same("もとの中身は消さない", ["s1", "s2", "s3"], marked.map((item) => item.id));
same("未購入のうち家にある数", 1, pantryHitCount(marked));
same("在庫が読めていないときは何も出さない", ["", "", ""], markPantryHits(SHOPPING, [], normalize).map((item) => item.pantryNote));

/* app.js が本当にこの仕組みを使っているか。使い忘れるとテストだけ通って画面に出ない。 */
import { readFileSync } from "node:fs";
const APP_SOURCE = readFileSync(path.join(HERE, "..", "app.js"), "utf8");
same("app.js が買い物前チェックを読み込んでいる", true, APP_SOURCE.includes('from "../shared/pantry-check.js"'));
same("app.js がお金管理の名寄せを使っている", true, APP_SOURCE.includes("FinanceEngine.normalizeItemName"));
same("買い物リストの行に印を出している", true, /pantryNote/.test(APP_SOURCE.slice(APP_SOURCE.indexOf("function shoppingRow"))));

if (failed) {
  console.error("\n" + failed + " / " + checked + " 件が不一致です。");
  process.exit(1);
}
console.log("OK: " + checked + " 件すべて期待どおりです。");
