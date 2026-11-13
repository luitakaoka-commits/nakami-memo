/* 在庫AI（2026-11-14）の純粋な部分の確認。
 * 実行: node --experimental-strip-types src/lib/inventory/stock-core.test.mjs（npm test から呼ばれる）
 *
 * 後半は、記録を書く場所（4か所）とルールの突き合わせ。在庫が消えても記録が残ることを守る。
 */
import {
  REMAINING_SNOOZE_DAYS, addDays, canonicalizer, daysBetween, isInsightStale, isRemainingSnoozed, japanDay, keyOfEvent,
  linkId, median, nextBuyLabel, nextBuys, namesForMatching, productKey, sanitizeInsights, stockEventFor, usageStats,
  buildInsightsPrompt,
} from "./stock-core.ts";
import { formatQuantity, quantityChoices, quantityStep } from "./quantity-core.ts";
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

const ev = (name, kind, since, at, itemId = name) => ({ itemId, name, key: "", kind, since, at, quantity: 1, unit: "本", category: "食品" });

t("品名の機械的な正規化：全角半角・ひらがなカタカナ・空白・部門コードをそろえ、意味はまとめない", () => {
  eq(productKey("ｷﾞｭｳﾆｭｳ"), productKey("ぎゅうにゅう"), "かなの違い");
  eq(productKey("* 3271 農場物語無調整牛乳"), productKey("農場物語 無調整牛乳"), "部門コードと空白");
  eq(productKey("ＡＢＣ　ソース"), "abcソース", "全角英字");
  ok(productKey("牛乳") !== productKey("低脂肪乳"), "牛乳と低脂肪乳は別のまま");
  ok(!/[\/\s]/.test(productKey("a/b c")), "ドキュメントIDに使えない文字が残っている");
});

t("日付の計算（日本時間）", () => {
  eq(japanDay(Date.parse("2026-11-13T15:30:00Z")), "2026-11-14", "UTC 15:30 は日本の翌日");
  eq(daysBetween("2026-11-01", "2026-11-14"), 13, "日数");
  eq(addDays("2026-12-30", 3), "2027-01-02", "年をまたぐ");
  eq(median([9, 3, 5]), 5, "奇数");
  eq(median([4, 10]), 7, "偶数");
  eq(median([]), null, "空");
});

t("本人が「同じ」と決めた組だけをつなぐ（「別」はつながない）", () => {
  const canon = canonicalizer([{ a: "b", b: "a", same: true }, { a: "c", b: "b", same: true }, { a: "d", b: "a", same: false }]);
  eq([canon("a"), canon("b"), canon("c")], ["a", "a", "a"], "3つが1つに");
  eq(canon("d"), "d", "別と決めたものはつながない");
  eq(linkId("x", "a"), linkId("a", "x"), "組のIDは順番によらない");
});

t("「まだ残っている」を押してから3日は、買い替え時の一覧に出さない", () => {
  eq(REMAINING_SNOOZE_DAYS, 3, "日数（ユーザー決定「数日隠す」）");
  ok(isRemainingSnoozed({ remainingCheckedAt: "2026-11-14" }, "2026-11-16"), "2日後は隠す");
  ok(!isRemainingSnoozed({ remainingCheckedAt: "2026-11-14" }, "2026-11-17"), "3日後はまた出す");
  ok(!isRemainingSnoozed({}, "2026-11-17"), "押していなければ出す");
});

t("記録1件の形（在庫に入れた日と、記録した日）", () => {
  const event = stockEventFor({ id: "i1", name: "牛乳", quantity: 1, unit: "本", category: "飲料", since: "2026-11-01" }, "consumed", "2026-11-14");
  eq(event, { itemId: "i1", name: "牛乳", key: productKey("牛乳"), kind: "consumed", since: "2026-11-01", at: "2026-11-14", quantity: 1, unit: "本", category: "飲料" }, "形");
  eq(stockEventFor({ id: "i", name: "x", since: "不明" }, "remaining", "2026-11-14").since, null, "日付でなければ null");
  eq(keyOfEvent({ key: "", name: "ぎゅうにゅう" }), productKey("ギュウニュウ"), "つくりおきノートの記録は品名から作り直す");
});

t("何日で使い切るか：入れた日→使い切った日の中央値。同じと決めた品名は合わせて数える", () => {
  const events = [
    ev("牛乳", "consumed", "2026-10-01", "2026-10-08"),
    ev("おいしい牛乳", "consumed", "2026-10-10", "2026-10-20"),
    ev("牛乳", "consumed", "2026-10-21", "2026-10-30"),
    ev("牛乳", "remaining", "2026-11-01", "2026-11-05"),
    ev("卵", "consumed", null, "2026-10-05"),
  ];
  const canon = canonicalizer([{ a: productKey("牛乳"), b: productKey("おいしい牛乳"), same: true }]);
  const stats = usageStats(events, canon);
  const milk = stats.get(canon(productKey("牛乳")));
  eq(milk.cycles, [7, 10, 9], "3回分");
  eq(milk.typicalDays, 9, "中央値");
  eq(stats.get(productKey("卵")).cycles, [], "入れた日が分からない記録は日数に数えない");
});

t("次の買い時：在庫にあるものは「入れた日＋いつもの日数」、7日以内だけ出す", () => {
  const events = [ev("牛乳", "consumed", "2026-10-01", "2026-10-11"), ev("牛乳", "consumed", "2026-10-12", "2026-10-22")];
  const soon = nextBuys([{ id: "m", name: "牛乳", since: "2026-11-06" }], events, [], "2026-11-14");
  eq(soon.map((e) => [e.name, e.dueDay, e.daysLeft, e.typicalDays, e.inStock]), [["牛乳", "2026-11-16", 2, 10, true]], "あと2日");
  eq(nextBuyLabel(soon[0]), "あと2日ごろ切れそうです", "文");
  eq(nextBuys([{ id: "m", name: "牛乳", since: "2026-11-14" }], events, [], "2026-11-14"), [], "まだ先なら出さない");
  eq(nextBuys([{ id: "m", name: "牛乳", since: "2026-11-06" }], [], [], "2026-11-14"), [], "記録が無ければ日付を作らない");
});

t("「まだ残っている」を予定日より後に押していれば、押した日から3日後へずらす", () => {
  const events = [ev("牛乳", "consumed", "2026-10-01", "2026-10-11"), ev("牛乳", "remaining", "2026-11-01", "2026-11-13", "m")];
  const plan = nextBuys([{ id: "m", name: "牛乳", since: "2026-11-01" }], events, [], "2026-11-14");
  eq(plan.map((e) => e.dueDay), ["2026-11-16"], "11/11 予定 → 11/13 に残っていた → 11/16");
  const byField = nextBuys([{ id: "m", name: "牛乳", since: "2026-11-01", remainingCheckedAt: "2026-11-14" }], [ev("牛乳", "consumed", "2026-10-01", "2026-10-11")], [], "2026-11-14");
  eq(byField.map((e) => e.dueDay), ["2026-11-17"], "在庫に残した日でも同じ");
});

t("同じ商品が2つ在庫にあれば、遅く切れるほうで見る。切れている定番は「切れています」", () => {
  const events = [ev("牛乳", "consumed", "2026-10-01", "2026-10-11"), ev("卵", "consumed", "2026-10-01", "2026-10-15"), ev("卵", "consumed", "2026-10-16", "2026-10-30")];
  const plan = nextBuys([{ id: "a", name: "牛乳", since: "2026-11-01" }, { id: "b", name: "牛乳", since: "2026-11-13" }], events, [], "2026-11-14");
  eq(plan.map((e) => [e.name, e.inStock, e.daysLeft]), [["卵", false, -15], ["牛乳", true, 9]].filter((row) => row[2] <= 7), "牛乳は新しいほうが残るので出さない／卵は切れている");
  eq(nextBuyLabel(plan[0]), "切れています", "文");
  const once = nextBuys([], [ev("卵", "consumed", "2026-10-01", "2026-10-15")], [], "2026-11-14");
  eq(once, [], "1回しか使い切っていないものは、切れていても定番とみなさない");
  const old = nextBuys([], [ev("卵", "consumed", "2026-07-01", "2026-07-15"), ev("卵", "consumed", "2026-07-16", "2026-07-30")], [], "2026-11-14");
  eq(old, [], "60日より前に切れたものは出さない");
});

t("AI に見せる品名は、同じ商品（機械的に同じ・本人が同じと決めた）を1つにする", () => {
  const names = namesForMatching(["牛乳", "牛　乳", "おいしい牛乳", "卵"], [{ a: productKey("牛乳"), b: productKey("おいしい牛乳"), same: true }]);
  eq(names, ["牛乳", "卵"], "1つずつ");
});

t("AI の返答の突き合わせ：見せた品名だけ・本人が決めた組は出さない・5組まで", () => {
  const names = ["牛乳", "おいしい牛乳", "卵", "たまご10個", "しょうゆ"];
  const links = [{ a: productKey("しょうゆ"), b: productKey("卵"), same: false }];
  const result = sanitizeInsights({
    samePairs: [
      { a: "牛乳", b: "おいしい牛乳", reason: "ブランド名の有無" },
      { a: "牛乳", b: "おいしい牛乳", reason: "重複" },
      { a: "卵", b: "しょうゆ", reason: "本人が別と決めた" },
      { a: "卵", b: "ないもの", reason: "見せていない" },
      { a: "卵", b: "卵", reason: "同じ文字" },
      { a: "卵", b: "たまご10個", reason: "容量の書き方" },
    ],
    nutrition: { summary: "野菜が少なめです。", tips: ["a", "b", "c", "d"] },
    shopping: [{ name: "ほうれんそう", reason: "野菜" }, { name: "ホウレンソウ", reason: "重複" }, { name: "", reason: "空" }],
  }, names, links);
  eq(result.samePairs.map((p) => [p.a, p.b]), [["牛乳", "おいしい牛乳"], ["卵", "たまご10個"]], "組");
  eq(result.nutrition.tips.length, 3, "コツは3つまで");
  eq(result.shopping.map((s) => s.name), ["ほうれんそう"], "買い物は名前で1つに");
  eq(sanitizeInsights(null, names, []), { samePairs: [], nutrition: null, shopping: [] }, "壊れた返答は空");
});

t("AI への指示：意味の違うものをまとめない・医療的な指示をしない・日付は記録から計算したもの", () => {
  const prompt = buildInsightsPrompt({ names: ["牛乳"], foods: [], nextBuys: [{ key: "k", name: "牛乳", itemId: "m", inStock: true, dueDay: "2026-11-16", daysLeft: 2, typicalDays: 10, cycles: 2 }], healthLines: ["塩分控えめ"], today: "2026-11-14" });
  ok(prompt.includes("牛乳と低脂肪乳"), "意味の違う例");
  ok(prompt.includes("迷ったら出さない"), "迷ったら出さない");
  ok(prompt.includes("医療的な指示はしない"), "医療");
  ok(prompt.includes("あと2日ごろ切れそうです（いつもは約10日で使い切る）"), "計算した買い時");
  ok(prompt.includes("塩分控えめ"), "からだの記録");
});

t("1日たったら考え直す（ホームを開いたとき）", () => {
  const now = Date.parse("2026-11-14T09:00:00+09:00");
  ok(isInsightStale(null, now), "初回");
  ok(!isInsightStale(now - 3_600_000, now), "1時間前");
  ok(isInsightStale(now - 25 * 3_600_000, now), "25時間前");
});

// ---- 数量のカルーセル（2026-11-14） ----

t("数量のカルーセル：数える単位は1きざみ、0は出さない、いまの数を必ず含む", () => {
  const list = quantityChoices(2, "冊");
  eq(list.slice(0, 3), [1, 2, 3], "1から");
  ok(!list.includes(0), "0 は出さない（使い切った／捨てたから）");
  ok(list.includes(12) && list[list.length - 1] === 12, "上は12まで（2の2倍・10先より大きいほう）");
  eq(quantityChoices(30, "個").at(-1), 60, "多いときは2倍まで");
  ok(quantityChoices(0.5, "パック").includes(0.5), "端数のいまの数も入る");
  eq(quantityChoices(0.5, "パック").slice(0, 2), [0.5, 1], "小さい順");
});

t("数量のカルーセル：g・mL は10きざみ（1000を超えたら50）、kg・L は0.1きざみ", () => {
  eq(quantityChoices(300, "g").slice(0, 3), [10, 20, 30], "g");
  ok(quantityChoices(300, "g").includes(300), "いまの数");
  eq(quantityStep("mL", 1500), 50, "多いときは50");
  eq(quantityChoices(1, "L").slice(0, 3), [0.1, 0.2, 0.3], "0.1 の誤差が出ない");
  eq(formatQuantity(0.30000000000000004), "0.3", "表示");
  ok(quantityChoices(5000, "g").length <= 151, "並びすぎない");
});

t("数量のカルーセルは一覧のカードから開き、0 にはしない", () => {
  const card = read("src", "components", "items", "ItemCard.tsx");
  ok(card.includes("<QuantityCarousel"), "カードから開けない");
  const fire = read("src", "lib", "firebase", "firestore.ts");
  ok(/export async function updateItemQuantity[\s\S]*?quantity > 0\)\) throw/.test(fire), "0 を保存できてしまう");
  ok(/export async function updateItemQuantity[\s\S]*?shouldResetOutcome\(item, quantity\)/.test(fire), "数が戻ったときに「使い切った」の印を消していない");
});

// ---- ここから下は、記録を書く場所とルールの突き合わせ ----

t("在庫が消える4つの経路すべてで、使い切った記録を残している", () => {
  ok(/batch\.set\(newStockEventRef\(userId\)/.test(read("src", "lib", "firebase", "inventory-outcome.ts")), "使い切った／捨てた");
  ok(/spaceCollection\(userId, "stockEvents"\)/.test(read("src", "lib", "firebase", "kitchen.ts")), "なかみメモの「作った」");
  ok(/col\("stockEvents"\)/.test(read("public", "recipe", "store.js")), "つくりおきノートの「作った」");
  ok(/batch\.set\(newStockEventRef\(userId\), \{ \.\.\.stockEventOf\(item, "remaining"\)/.test(read("src", "lib", "firebase", "stock.ts")), "まだ残っている");
});

t("在庫AIの結果は本人の場所にだけ置き、家には置かない（からだの記録を使うため）", () => {
  ok(read("src", "lib", "firebase", "stock.ts").includes('doc(db, "users", userId, "inventoryInsights", "current")'), "本人の場所");
  const rules = read("public", "money", "firestore.rules");
  const users = rules.slice(rules.indexOf("match /users/{userId} {"), rules.indexOf("match /households/{householdId} {"));
  eq((users.match(/collection == 'inventoryInsights'/g) || []).length, 2, "本人の場所（とその下）で許す");
  const allowed = rules.match(/function allowedUserCollection\(name\) \{[\s\S]*?\];/)[0];
  ok(!allowed.includes("inventoryInsights"), "家でも許す一覧に入っている");
  ok(allowed.includes("'stockEvents'") && allowed.includes("'productLinks'"), "記録と同じ／別の決定は家と共有する");
  ok(!read("src", "lib", "household", "household-core.ts").match(/HOUSEHOLD_COLLECTIONS = \[[^\]]*inventoryInsights/), "家へ写している");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
