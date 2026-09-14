#!/usr/bin/env node
/* つくりおきノートの「作った」で、なかみメモの在庫をどれだけ減らすかの確認。
 * 実行: node tests/cook-stock.test.js
 */
import { planFromSourceItems, remainingQuantity, rowsToApply } from "../../shared/cook-stock.js";

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

if (failed) {
  console.error("\n" + failed + " / " + checked + " 件が不一致です。");
  process.exit(1);
}
console.log("OK: " + checked + " 件すべて期待どおりです。");
