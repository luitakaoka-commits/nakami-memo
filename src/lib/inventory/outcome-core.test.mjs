/* 「使い切った／捨てた」（Phase 4 手B）の純粋な部分の確認。
 * 実行: node --experimental-strip-types src/lib/inventory/outcome-core.test.mjs（npm test から呼ばれる）
 *
 * 後半は、お金管理（public/money）とルールとの突き合わせ。
 * 同じ値を2か所に書いているので、どちらかを直したらここで落ちる。
 */
import {
  CONSUMABLE_CATEGORIES, DISCARD_REASONS, OUTCOMES, OUTCOME_RESET, WASTE_RATIO,
  canRecordOutcome, itemOutcomePatch, outcomeLabel, outcomeOfDiscardReason,
  receiptLinePatch, shouldResetOutcome, wasteAmountOf,
} from "./outcome-core.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");

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

const NOW = new Date("2026-09-16T02:00:00.000Z");

t("使って減るものには「使い切った／捨てた」を出す", () => {
  ok(canRecordOutcome({ quantity: 1, category: "食品" }), "食品");
  ok(canRecordOutcome({ quantity: 2, category: "洗剤" }), "洗剤");
  ok(!canRecordOutcome({ quantity: 1, category: "工具" }), "工具には出さない");
  ok(!canRecordOutcome({ quantity: 1, category: "" }), "カテゴリ未設定には出さない");
});

t("レシートから入れた在庫は、カテゴリに関わらず出す（お金管理へ返す先があるため）", () => {
  ok(canRecordOutcome({ quantity: 1, category: "工具", purchaseWorkspaceId: "ws1" }), "共有スペースつき");
  ok(canRecordOutcome({ quantity: 1, category: "書類", purchaseRef: "rc1#3" }), "明細つき");
});

t("数量0のものには出さない（押す意味がない）", () => {
  ok(!canRecordOutcome({ quantity: 0, category: "食品", purchaseRef: "rc1#1" }), "0個");
  ok(!canRecordOutcome(null), "在庫が無い");
});

t("「使い切った」は数量0・無駄なし。モノは消さない", () => {
  const patch = itemOutcomePatch({ kind: "consumed" }, NOW);
  eq(patch, { quantity: 0, outcome: "consumed", outcomeAt: "2026-09-16T02:00:00.000Z", outcomeReason: "" }, "中身");
  eq(wasteAmountOf(198, patch.outcome), 0, "使い切ったので無駄は0円");
});

t("「捨てた」は理由で結末が変わる", () => {
  eq(itemOutcomePatch({ kind: "discarded", reason: "期限切れ" }, NOW).outcome, "expired", "期限切れ");
  eq(itemOutcomePatch({ kind: "discarded", reason: "買いすぎ" }, NOW).outcome, "unused", "買いすぎ");
  eq(itemOutcomePatch({ kind: "discarded", reason: "好みでなかった" }, NOW).outcomeReason, "好みでなかった", "理由は残す");
  eq(outcomeOfDiscardReason("知らない理由"), "discarded", "知らない理由は使わず処分に寄せる");
});

t("無駄金額はお金管理と同じ計算（半額扱いの端数は切り捨て）", () => {
  eq(wasteAmountOf(198, "expired"), 198, "期限切れは全額");
  eq(wasteAmountOf(198, "unnecessary"), 198, "不要だった");
  eq(wasteAmountOf(199, "unused"), 99, "使う見込みなしは半額・切り捨て");
  eq(wasteAmountOf(198, "in_stock"), 0, "まだある");
  eq(wasteAmountOf(0, "expired"), 0, "0円");
  eq(wasteAmountOf(-50, "expired"), 0, "値引き行（マイナス）は無駄と数えない");
  eq(wasteAmountOf("あ", "expired"), 0, "数でない");
});

t("レシート明細に返す内容", () => {
  const patch = itemOutcomePatch({ kind: "discarded", reason: "期限切れ" }, NOW);
  eq(receiptLinePatch({ amount: 298 }, patch), {
    outcome: "expired",
    outcomeAt: "2026-09-16T02:00:00.000Z",
    outcomeReason: "期限切れ",
    wasteAmount: 298,
    updatedAt: "2026-09-16T02:00:00.000Z",
  }, "中身");
});

t("また買って在庫が戻ったら、結末の印は消す", () => {
  ok(shouldResetOutcome({ outcome: "consumed" }, 3), "使い切ったものを買い直した");
  ok(shouldResetOutcome({ outcome: "expired" }, 1), "捨てたものを買い直した");
  ok(!shouldResetOutcome({ outcome: "consumed" }, 0), "0のままなら消さない");
  ok(!shouldResetOutcome({ outcome: "in_stock" }, 5), "もともと印が無い");
  ok(!shouldResetOutcome({}, 5), "結末を持っていない在庫");
  eq(OUTCOME_RESET, { outcome: "in_stock", outcomeAt: "", outcomeReason: "" }, "消す内容");
});

t("記録したあとカードに出す文字", () => {
  eq(outcomeLabel("consumed"), "使い切った", "使い切った");
  eq(outcomeLabel("expired", "期限切れ"), "捨てた（期限切れ）", "理由つき");
  eq(outcomeLabel("discarded"), "捨てた", "理由なし");
  eq(outcomeLabel("in_stock"), "", "まだあるものには出さない");
  eq(outcomeLabel(undefined), "", "印が無い");
});

/* ---------- ここから、お金管理・ルールとの突き合わせ ---------- */

t("「捨てた」の理由と結末が、お金管理の DISCARD_REASONS と同じ", () => {
  const source = read("public", "money", "app.js");
  const block = source.slice(source.indexOf("const DISCARD_REASONS"));
  const money = [...block.slice(0, block.indexOf("];")).matchAll(/reason:\s*'([^']+)',\s*outcome:\s*'([^']+)'/g)]
    .map(([, reason, outcome]) => ({ reason, outcome }));
  eq(money, DISCARD_REASONS.map(entry => ({ reason: entry.reason, outcome: entry.outcome })), "理由と結末");
});

t("無駄と数える割合が、お金管理の WASTE_RATIO と同じ", () => {
  const source = read("public", "money", "finance-engine.js");
  const block = source.slice(source.indexOf("const WASTE_RATIO"));
  const money = {};
  [...block.slice(0, block.indexOf("});")).matchAll(/^\s*(\w+):\s*([\d.]+)/gm)]
    .forEach(([, key, value]) => { money[key] = Number(value); });
  eq(money, WASTE_RATIO, "割合");
});

t("使う結末と理由が、Firestore のルールで許されている", () => {
  const rules = read("public", "money", "firestore.rules");
  const listOf = (marker) => rules.slice(rules.indexOf(marker)).match(/\[([^\]]*)\]/)[1]
    .split(",").map(entry => entry.trim().replace(/^'|'$/g, "")).filter(Boolean);
  const allowedOutcomes = listOf("data.outcome in ");
  const allowedReasons = listOf("data.outcomeReason in ");
  eq(OUTCOMES.filter(outcome => !allowedOutcomes.includes(outcome)), [], "ルールに無い結末を使っている");
  eq(DISCARD_REASONS.map(entry => entry.reason).filter(reason => !allowedReasons.includes(reason)), [], "ルールに無い理由を使っている");
});

t("料理で使い切ったときも「使い切った」として記録し、お金管理へ返している", () => {
  /* 両方のアプリの「作った」が同じことをするか。片方だけ直すと、
     つくりおきノートから作ったときだけムダ支出が消えない、という差が出る。 */
  const kitchen = read("src", "lib", "firebase", "kitchen.ts");
  ok(kitchen.includes("itemOutcomePatch"), "なかみメモ: 使い切りの印を付けていない");
  ok(kitchen.includes("receiptLinePatch") && kitchen.includes("inventoryItemId"), "なかみメモ: 明細へ返していない");
  const store = read("public", "recipe", "store.js");
  ok(store.includes("usedUpRows"), "つくりおきノート: 使い切りを拾っていない");
  ok(store.includes("inventoryItemId"), "つくりおきノート: 明細へ返していない");
});

t("「使い切った／捨てた」を出すカテゴリが、なかみメモのカテゴリ一覧にある", () => {
  const source = read("src", "lib", "types", "item.ts");
  const options = source.slice(source.indexOf("CATEGORY_OPTIONS"), source.indexOf("EXPIRATION_TYPE_OPTIONS"));
  eq(CONSUMABLE_CATEGORIES.filter(category => !options.includes(`"${category}"`)), [], "存在しないカテゴリを指している");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
