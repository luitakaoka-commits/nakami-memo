/* 買い物前チェック（Phase 4 手C）。
 *
 * 買い物リストに「牛乳」と書いてあっても、冷蔵庫にまだ牛乳があれば買う必要はない。
 * 二重買いは、使い切れずに捨てる一番よくある入口なので、リストの行に
 * 「家にまだあります」とだけ出す。**消したり減らしたりはしない**（買う理由は本人にしか分からない）。
 *
 * 品名の突き合わせは、お金管理の normalizeItemName をそのまま借りる（関数を受け取る形にしてある）。
 * 「牛乳」と「低脂肪乳」のような意味の判断はここでもやらない。表記のゆれだけを吸収する。
 *
 * ここはネットワークもDOMも使わない。public/recipe/tests/pantry-check.test.js がそのままテストする。
 */

/**
 * なかみメモの在庫を、名前のキーで引ける形にする。
 * 数量0のもの（使い切った・捨てた）は入れない。棚に無いものを「あります」と言わないため。
 */
export function buildPantryIndex(items, normalize) {
  const index = new Map();
  (items || []).forEach((item) => {
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const name = String(item?.name || "").trim();
    if (!name) return;
    const key = normalize(name);
    if (!key) return;
    const entry = { name, quantity, unit: String(item?.unit || "") };
    if (index.has(key)) index.get(key).push(entry);
    else index.set(key, [entry]);
  });
  return index;
}

/**
 * 買い物リストの1行に対する、家にあるものの一覧。
 * 「牛乳 200mL」のように量が付いた行でも、normalizeItemName が量を剥がすので引ける。
 */
export function pantryHitsFor(shoppingName, index, normalize) {
  const key = normalize(String(shoppingName || "").trim());
  if (!key) return [];
  return index.get(key) || [];
}

/** 行に出す短い文。単位が無い在庫もあるので、数量だけでも読める形にする。 */
export function pantryNote(hits) {
  if (!hits || !hits.length) return "";
  const detail = hits.map((hit) => `${hit.name} ${hit.quantity}${hit.unit}`.trim()).join("・");
  return `家にまだあります（${detail}）`;
}

/**
 * 買い物リスト全体に印を付ける。
 * 買ったもの（done）には出さない。買ったあとに「家にあります」と言われても遅い。
 */
export function markPantryHits(shoppingItems, inventoryItems, normalize) {
  const index = buildPantryIndex(inventoryItems, normalize);
  return (shoppingItems || []).map((item) => {
    const hits = item?.done ? [] : pantryHitsFor(item?.name, index, normalize);
    return { ...item, pantryNote: pantryNote(hits) };
  });
}

/** 未購入のうち、家にまだあるものの数。「◯件は家にあります」と出すのに使う。 */
export function pantryHitCount(markedItems) {
  return (markedItems || []).filter((item) => item && !item.done && item.pantryNote).length;
}
