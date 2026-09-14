/* つくりおきノートで「作った」を押したとき、なかみメモの在庫をどれだけ減らすかを決める部分。
 *
 * なかみメモのレシピ提案から保存したレシピには、材料と在庫の結びつき（sourceItems）が入っている。
 *   sourceItems: [{ itemId, name, unit, use }]
 * 保存したときの在庫と、いま作るときの在庫は違う（買い足した・使い切った）ので、
 * 必ず「いまの在庫」と突き合わせてから減らす。
 *
 * ここはネットワークもDOMも使わない。public/recipe/tests/cook-stock.test.js がそのままテストする。
 * 手で作ったレシピには sourceItems が無いので、今までどおり「作った日」の記録だけになる。
 */

/** 減らしたあとの数量。マイナスにしない。小数の誤差を丸める。 */
export function remainingQuantity(current, use) {
  return Math.max(0, Math.round((Number(current || 0) - Math.max(0, Number(use || 0))) * 1000) / 1000);
}

/**
 * 「作った」の確認画面に出す行を作る。
 * - いまの在庫に無い（消された）食材は出さない
 * - 在庫より多くは減らせないので、いまの数量で頭打ちにする
 * - 在庫が0の食材は、減らす量も0にして出す（買い足したかどうかは本人しか分からないため）
 */
export function planFromSourceItems(sourceItems, items) {
  const byId = new Map((items || []).map((item) => [item.id, item]));
  return (sourceItems || [])
    .filter((row) => row && typeof row.itemId === "string" && byId.has(row.itemId))
    .map((row) => {
      const item = byId.get(row.itemId);
      const available = Number(item.quantity || 0);
      const wanted = Math.max(0, Number(row.use || 0));
      return {
        itemId: row.itemId,
        name: String(item.name || row.name || ""),
        unit: String(item.unit || row.unit || ""),
        available,
        use: Math.min(wanted, available),
        /* お金管理の明細に「使い切った」を返す先。レシートから入れた在庫だけが持つ（2026-09-16） */
        purchaseWorkspaceId: String(item.purchaseWorkspaceId || ""),
      };
    });
}

/** 実際に書き込む行だけにする（0は在庫を触らない）。 */
export function rowsToApply(rows) {
  return (rows || []).filter((row) => Number(row.use) > 0);
}

/**
 * 料理で使い切った行（減らしたあとが0になるもの）。
 *
 * ここを拾わないと、料理で使い切ったのにお金管理では「まだある」のままになり、
 * 週1回のふりかえりで何度も聞かれる。使い切ったのだから無駄は0円。
 */
export function usedUpRows(rows) {
  return (rows || []).filter((row) => Number(row.use) > 0 && remainingQuantity(row.available, row.use) === 0);
}
