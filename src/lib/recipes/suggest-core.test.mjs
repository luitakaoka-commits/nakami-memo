/* レシピ提案（Phase 3）の純粋な部分の確認。
 * 実行: node --experimental-strip-types src/lib/recipes/suggest-core.test.mjs（npm test から呼ばれる）
 */
import {
  amountInStockUnit, buildPrompt, canonicalUnit, convertAmount, createThrottle, defaultConsumption, defaultMustUseIds,
  documentsToObjects, isCountUnit, normalizeOptions, normalizeTools, parseAmount, pickPantry, remainingQuantity,
  responseSchema, sanitizeSuggestions, toTsukuriokiRecipe, RECIPE_CATEGORIES,
  clearCachedSuggestions, readCachedSuggestions, relativeTimeLabel, writeCachedSuggestions, SUGGESTION_CACHE_KEY,
} from "./suggest-core.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

const NOW = new Date(2026, 8, 15, 10, 0).getTime();
const day = (n) => new Date(2026, 8, 15 + n, 23, 0).getTime();

const RAW_ITEMS = [
  { id: "egg", name: "卵", quantity: 2, unit: "個", category: "食品", expirationMillis: day(2) },
  { id: "moyashi", name: "もやし", quantity: 1, unit: "袋", category: "食品", expirationMillis: day(0) },
  { id: "milk", name: "牛乳", quantity: 1, unit: "本", category: "飲料", expirationMillis: day(10) },
  { id: "soy", name: "醤油", quantity: 1, unit: "本", category: "調味料", expirationMillis: day(1) },
  { id: "old", name: "豆腐", quantity: 1, unit: "丁", category: "食品", expirationMillis: day(-2) },
  { id: "rice", name: "米", quantity: 2000, unit: "g", category: "食品", expirationMillis: null },
  { id: "detergent", name: "洗剤", quantity: 1, unit: "本", category: "洗剤", expirationMillis: null },
  { id: "empty", name: "ハム", quantity: 0, unit: "パック", category: "食品", expirationMillis: day(1) },
  { id: "nocat", name: "謎の瓶", quantity: 1, unit: "本", category: "", expirationMillis: null },
];
const pantry = pickPantry(RAW_ITEMS, NOW);
const tools = normalizeTools([
  { id: "pan", name: "ティファール 26cm", type: "フライパン", sizeLabel: "26cm", features: ["IH対応"] },
  { id: "micro", name: "電子レンジ", type: "電子レンジ" },
  { id: "bad", name: "", type: "鍋" },
]);

t("在庫から、数量があり食べ物のカテゴリのものだけを、期限が近い順に取り出す", () => {
  eq(pantry.map((i) => i.id), ["old", "moyashi", "soy", "egg", "milk", "rice"], "並びと絞り込み");
  eq(pantry.find((i) => i.id === "moyashi").expiresInDays, 0, "今日まで = 0日");
  eq(pantry.find((i) => i.id === "old").expiresInDays, -2, "期限切れはマイナス");
});

t("何も選ばなくても必ず使う食材は、期限3日以内（今日を含む）で、期限切れと調味料は除く", () => {
  eq(defaultMustUseIds(pantry), ["moyashi", "egg"], "必ず使う");
});

t("器具は名前の無いものを落とし、知らない種類は「その他」にする", () => {
  eq(tools.map((x) => x.id), ["pan", "micro"], "器具");
  eq(normalizeTools([{ id: "x", name: "謎", type: "宇宙鍋" }])[0].type, "その他", "種類");
});

t("条件は安全な範囲にそろえ、在庫に無いIDは必ず使う食材から外す", () => {
  const o = normalizeOptions({ servings: 99, maxMinutes: "15", mustUseItemIds: ["egg", "ghost", "egg"], excludeIngredients: [" ピーマン ", "", 3] }, pantry);
  eq(o, { servings: 2, maxMinutes: 15, mustUseItemIds: ["egg"], excludeIngredients: ["ピーマン"] }, "条件");
});

t("AIへの指示に、4つの約束（必ず使う・器具・調味料・量）と在庫のIDが入る", () => {
  const prompt = buildPrompt(pantry, tools, normalizeOptions({ mustUseItemIds: ["moyashi"] }, pantry));
  for (const phrase of ["必ず使う食材は", "使える調理器具に無い器具", "在庫の量を超えて使わない", "shoppingNeeded", "id=moyashi", "id=pan"]) {
    ok(prompt.includes(phrase), `「${phrase}」が無い`);
  }
  ok(!prompt.includes("id=old ／"), "期限切れの豆腐を在庫として渡している");
  ok(buildPrompt(pantry, [], normalizeOptions({}, pantry)).includes("コンロ・鍋・フライパン・電子レンジだけがある"), "器具ゼロのときの前提");
});

t("返させるJSONの形のカテゴリが、つくりおきノートのカテゴリと一致する", () => {
  const schemaCats = responseSchema().properties.recipes.items.properties.category.enum;
  eq(schemaCats, [...RECIPE_CATEGORIES], "schema");
  const recipeApp = readFileSync(path.join(ROOT, "public", "recipe", "app.js"), "utf8");
  const appCats = JSON.parse(recipeApp.match(/const CATEGORIES = (\[[^\]]*\])/)[1]);
  eq(appCats, [...RECIPE_CATEGORIES], "つくりおきノートの CATEGORIES");
  const sources = JSON.parse(recipeApp.match(/const SOURCES = (\[[^\]]*\])/)[1]);
  ok(sources.includes("AIの提案"), "つくりおきノートの SOURCES に「AIの提案」が無い（保存しても「自分のレシピ」に化ける）");
});

const options = normalizeOptions({ servings: 2, maxMinutes: 20, mustUseItemIds: ["moyashi", "egg"], excludeIngredients: ["ピーマン"] }, pantry);

t("AIの返答: 在庫IDの書き間違いは名前で拾い、在庫に無い材料は買い足しへ、無い器具IDは捨てる", () => {
  const raw = { recipes: [{
    title: "もやし炒め", category: "主菜", servings: 2, estMinutes: 10,
    ingredients: [
      { name: "もやし", amount: "1", unit: "袋", itemId: "moyashi-typo", inStock: true },
      { name: "豚こま", amount: "150", unit: "g", itemId: "", inStock: false },
      { name: "塩", amount: "少々", unit: "", itemId: "", inStock: true },
    ],
    shoppingNeeded: [], steps: ["切る", "炒める"], toolIds: ["pan", "oven"], usesItemIds: ["ghost"],
  }] };
  const { recipes } = sanitizeSuggestions(raw, pantry, tools, options);
  eq(recipes[0].ingredients[0].itemId, "moyashi", "名前で在庫に結びつく");
  eq(recipes[0].shoppingNeeded, ["豚こま"], "買い足し");
  eq(recipes[0].toolIds, ["pan"], "持っていないオーブンは捨てる");
  eq(recipes[0].usesItemIds, ["moyashi"], "在庫に無いIDは捨て、材料の在庫IDは足す");
  eq(recipes[0].ingredients[2].inStock, true, "家にある前提の調味料");
});

t("AIの返答: 在庫の量を超える・期限切れ・使わない指定、は注意として残す", () => {
  const raw = { recipes: [{
    title: "オムレツ", category: "主菜", servings: 2, estMinutes: 10,
    ingredients: [
      { name: "卵", amount: "3", unit: "個", itemId: "egg", inStock: true },
      { name: "豆腐", amount: "1", unit: "丁", itemId: "old", inStock: true },
      { name: "ピーマン", amount: "1", unit: "個", itemId: "", inStock: false },
    ],
    shoppingNeeded: ["ピーマン"], steps: ["焼く"], toolIds: [], usesItemIds: ["egg"],
  }] };
  const w = sanitizeSuggestions(raw, pantry, tools, options).recipes[0].warnings;
  ok(w.some((s) => s.includes("卵を3個使いますが、在庫は2個")), `量: ${w}`);
  ok(w.some((s) => s.includes("豆腐は期限が切れています")), `期限: ${w}`);
  ok(w.some((s) => s.includes("「ピーマン」")), `使わない指定: ${w}`);
});

t("AIの返答: 題名や手順の無いものは捨て、最大3つ、どのレシピにも入らなかった必ず使う食材を返す", () => {
  const base = { category: "謎", servings: 0, estMinutes: -1, ingredients: [], shoppingNeeded: [], toolIds: [], usesItemIds: [] };
  const raw = { recipes: [
    { ...base, title: "", steps: ["a"] },
    { ...base, title: "手順なし", steps: [] },
    { ...base, title: "A", steps: ["a"], usesItemIds: ["egg"] },
    { ...base, title: "B", steps: ["b"] },
    { ...base, title: "C", steps: ["c"] },
    { ...base, title: "D", steps: ["d"] },
  ] };
  const result = sanitizeSuggestions(raw, pantry, tools, options);
  eq(result.recipes.map((r) => r.title), ["A", "B", "C"], "3つまで");
  eq(result.recipes[0].category, "その他", "知らないカテゴリ");
  eq([result.recipes[0].servings, result.recipes[0].estMinutes], [2, 20], "人数と時間は条件で補う");
  eq(result.uncoveredMustUse, ["もやし"], "使われなかった必ず使う食材");
  eq(sanitizeSuggestions("壊れた返答", pantry, tools, options), { recipes: [], uncoveredMustUse: ["もやし", "卵"] }, "形が違う返答");
});

t("量の読み取り（全角・分数・少々）", () => {
  eq([parseAmount("2"), parseAmount("０．５"), parseAmount("1/2"), parseAmount("少々"), parseAmount("1/0")], [2, 0.5, 0.5, null, null], "量");
});

t("Firestore REST の返答を読める（数値・日時・配列・入れ子）", () => {
  const objects = documentsToObjects([{
    name: "projects/p/databases/(default)/documents/users/u/items/egg",
    fields: {
      name: { stringValue: "卵" }, quantity: { integerValue: "2" }, ratio: { doubleValue: 0.5 },
      expirationDate: { timestampValue: "2026-09-17T14:00:00Z" }, tags: { arrayValue: { values: [{ stringValue: "朝" }] } },
      meta: { mapValue: { fields: { ok: { booleanValue: true } } } }, empty: { nullValue: null },
    },
  }]);
  eq(objects[0], { name: "卵", quantity: 2, ratio: 0.5, expirationDate: Date.parse("2026-09-17T14:00:00Z"), tags: ["朝"], meta: { ok: true }, empty: null, id: "egg" }, "変換");
});

t("回数の制限: 1分に5回まで、時間がたてばまた使える、人ごとに別", () => {
  const allow = createThrottle(5, 60000);
  const results = Array.from({ length: 6 }, (_, i) => allow("u1", 1000 + i));
  eq(results, [true, true, true, true, true, false], "6回目は断る");
  ok(allow("u2", 1010), "別の人は使える");
  ok(allow("u1", 61001), "1分たてば使える");
});

t("つくりおきノートに保存する形が、つくりおきノートの項目とそろい、器具と買い足しがメモに残る", () => {
  const recipe = sanitizeSuggestions({ recipes: [{
    title: "もやしの卵とじ", category: "副菜", servings: 2, estMinutes: 10,
    ingredients: [{ name: "もやし", amount: "1", unit: "袋", itemId: "moyashi", inStock: true }, { name: "ねぎ", amount: "", unit: "", itemId: "", inStock: false }],
    shoppingNeeded: [], steps: ["煮る"], toolIds: ["pan"], usesItemIds: [],
  }] }, pantry, tools, options).recipes[0];
  const doc = toTsukuriokiRecipe(recipe, ["ティファール 26cm"], NOW);
  eq(Object.keys(doc).sort(), ["category", "createdAt", "image", "ingredients", "lastCookedAt", "memo", "refUrl", "servings", "source", "steps", "title"], "項目");
  eq(doc.ingredients, ["もやし 1袋", "ねぎ"], "材料は1行の文字列");
  ok(doc.memo.includes("使う器具: ティファール 26cm") && doc.memo.includes("買い足し: ねぎ"), doc.memo);
  eq([doc.source, doc.createdAt, doc.lastCookedAt], ["AIの提案", NOW, 0], "出どころと日時");
});

t("「作った」ときに減らす量の初期値: 同じ単位はその量、調味料は0、数え方の単位は数、ほかは1、在庫を超えない", () => {
  const recipe = {
    ingredients: [
      { name: "卵", amount: "3", unit: "個", itemId: "egg", inStock: true },
      { name: "醤油", amount: "2", unit: "大さじ", itemId: "soy", inStock: true },
      { name: "米", amount: "300", unit: "g", itemId: "rice", inStock: true },
      { name: "もやし", amount: "200", unit: "g", itemId: "moyashi", inStock: true },
    ],
    usesItemIds: ["egg", "soy", "rice", "moyashi", "milk"],
  };
  const rows = defaultConsumption(recipe, pantry);
  const use = Object.fromEntries(rows.map((r) => [r.itemId, r.use]));
  eq(use, { egg: 2, soy: 0, rice: 300, moyashi: 1, milk: 1 }, "減らす量");
  eq([remainingQuantity(2, 3), remainingQuantity(1.1, 0.2), remainingQuantity(5, -1)], [0, 0.9, 5], "減らしたあと");
});

/* ---------- 単位（2026-09-15 追加。牛乳を mL で管理したい、というユーザーの指摘） ---------- */

t("単位の表記ゆれをそろえる（cc・全角・大文字小文字）", () => {
  eq([canonicalUnit("ml"), canonicalUnit("cc"), canonicalUnit("ｍｌ"), canonicalUnit("L"), canonicalUnit("キロ"), canonicalUnit("袋")],
    ["mL", "mL", "mL", "L", "kg", "袋"], "そろえた単位");
  eq([isCountUnit("本"), isCountUnit("パック"), isCountUnit("mL"), isCountUnit("g")], [true, true, false, false], "数える単位か");
});

t("量の単位どうしは換算する。種類が違うもの（本 ↔ mL）は換算しない", () => {
  eq([convertAmount(200, "mL", "mL"), convertAmount(200, "mL", "L"), convertAmount(0.5, "L", "cc"), convertAmount(300, "g", "kg"), convertAmount(1.2, "kg", "g")],
    [200, 0.2, 500, 0.3, 1200], "換算");
  eq([convertAmount(200, "mL", "g"), convertAmount(1, "本", "mL"), convertAmount(1, "mL", "本")], [null, null, null], "換算できない組み合わせ");
  eq([amountInStockUnit("200", "mL", "L"), amountInStockUnit("少々", "", "g"), amountInStockUnit("1/2", "L", "mL")], [0.2, null, 500], "レシピの量を在庫の単位で");
});

const drinkPantry = [
  { id: "milk-ml", name: "牛乳(mL管理)", quantity: 1000, unit: "mL", category: "飲料" },
  { id: "milk-bottle", name: "牛乳(本管理)", quantity: 1, unit: "本", category: "飲料" },
  { id: "flour", name: "小麦粉", quantity: 1, unit: "kg", category: "食品" },
  { id: "cabbage", name: "キャベツ", quantity: 1, unit: "玉", category: "食品" },
];

t("mL で管理している牛乳は、使った分だけ減る", () => {
  const rows = defaultConsumption({ ingredients: [{ name: "牛乳", amount: "200", unit: "mL", itemId: "milk-ml", inStock: true }], usesItemIds: [] }, drinkPantry);
  eq(rows[0].use, 200, "200mL");
  eq(remainingQuantity(1000, rows[0].use), 800, "残り");
});

t("単位が違っても同じ種類なら換算する（在庫 kg・レシピ g）", () => {
  const rows = defaultConsumption({ ingredients: [{ name: "小麦粉", amount: "300", unit: "g", itemId: "flour", inStock: true }], usesItemIds: [] }, drinkPantry);
  eq(rows[0].use, 0.3, "0.3kg");
});

t("「1本」の牛乳を mL で使うときは、勝手に1本減らさず、本人に入れてもらう", () => {
  const rows = defaultConsumption({ ingredients: [{ name: "牛乳", amount: "200", unit: "mL", itemId: "milk-bottle", inStock: true }], usesItemIds: [] }, drinkPantry);
  eq(rows[0].use, 0, "既定では減らさない");
  ok(rows[0].note.includes("200mL") && rows[0].note.includes("本"), `注意書き: ${rows[0].note}`);
});

t("「1玉」のキャベツを g で使うときは1玉使い切る扱い（食品は使い切るのがふつう）", () => {
  const rows = defaultConsumption({ ingredients: [{ name: "キャベツ", amount: "200", unit: "g", itemId: "cabbage", inStock: true }], usesItemIds: [] }, drinkPantry);
  eq(rows[0].use, 1, "1玉");
  ok(rows[0].note, "注意書きは出す");
});

t("在庫超過の注意も単位を換算してから出す", () => {
  const stock = [
    { id: "milk-ml", name: "牛乳", quantity: 500, unit: "mL", category: "飲料", expiresInDays: 5 },
  ];
  const opts = normalizeOptions({}, stock);
  const raw = { recipes: [{
    title: "ミルクスープ", category: "汁物", servings: 2, estMinutes: 10,
    ingredients: [{ name: "牛乳", amount: "1", unit: "L", itemId: "milk-ml", inStock: true }],
    shoppingNeeded: [], steps: ["煮る"], toolIds: [], usesItemIds: ["milk-ml"],
  }] };
  const warnings = sanitizeSuggestions(raw, stock, [], opts).recipes[0].warnings;
  ok(warnings.some((w) => w.includes("牛乳を1L使いますが、在庫は500mLです")), `注意: ${warnings}`);
});

t("AIへの指示に「在庫と同じ単位で書く」が入っている", () => {
  ok(buildPrompt(pantry, tools, options).includes("量は在庫と同じ単位で書く"), "単位の指示");
});

/* ---------- 出したばかりの提案をとっておく（2026-09-15 ユーザー報告：画面を移ると消える） ---------- */

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

const sample = { recipes: [{ title: "もやし炒め", steps: ["炒める"], ingredients: [], usesItemIds: [], warnings: [], shoppingNeeded: [], toolIds: [], category: "主菜", servings: 2, estMinutes: 10 }], uncoveredMustUse: [] };

t("提案をとっておいて、同じ人なら読み戻せる", () => {
  const storage = fakeStorage();
  writeCachedSuggestions(storage, "u1", sample, NOW);
  const cached = readCachedSuggestions(storage, "u1", NOW + 60000);
  eq(cached.result.recipes[0].title, "もやし炒め", "読み戻し");
  eq(cached.savedAt, NOW, "保存した時刻");
});

t("別の人・1日以上前・壊れた中身は読み戻さない", () => {
  const storage = fakeStorage();
  writeCachedSuggestions(storage, "u1", sample, NOW);
  eq(readCachedSuggestions(storage, "u2", NOW), null, "別の人");
  eq(readCachedSuggestions(storage, "u1", NOW + 24 * 60 * 60 * 1000 + 1), null, "1日たった");
  eq(readCachedSuggestions(fakeStorage({ [SUGGESTION_CACHE_KEY]: "{壊れた" }), "u1", NOW), null, "壊れたJSON");
  eq(readCachedSuggestions(fakeStorage({ [SUGGESTION_CACHE_KEY]: '{"uid":"u1","savedAt":1,"result":{"recipes":[]}}' }), "u1", NOW), null, "中身が空");
  eq(readCachedSuggestions(fakeStorage(), "u1", NOW), null, "何も無い");
});

t("提案は消せる。localStorage が使えなくても落ちない", () => {
  const storage = fakeStorage();
  writeCachedSuggestions(storage, "u1", sample, NOW);
  clearCachedSuggestions(storage);
  eq(readCachedSuggestions(storage, "u1", NOW), null, "消えている");
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  writeCachedSuggestions(broken, "u1", sample, NOW);
  clearCachedSuggestions(broken);
  eq(readCachedSuggestions(broken, "u1", NOW), null, "読めない");
});

t("いつの提案かを日本語で出す", () => {
  const minute = 60000;
  eq([relativeTimeLabel(NOW, NOW), relativeTimeLabel(NOW - 5 * minute, NOW), relativeTimeLabel(NOW - 90 * minute, NOW), relativeTimeLabel(NOW - 50 * 60 * minute, NOW)],
    ["たった今", "5分前", "1時間前", "2日前"], "表示");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
