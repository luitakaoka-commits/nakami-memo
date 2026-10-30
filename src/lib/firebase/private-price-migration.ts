import { collection, deleteField, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";

export type PurchasePriceCheck = { itemId: string; status: "ready" | "invalid" | "other-owner" | "unavailable" | "backup-conflict" };

/** 実行前の確認。金額自体を結果に含めず、移動できないものを明示する。 */
export async function inspectSharedPurchasePrices(db: Firestore, userId: string, householdId: string): Promise<PurchasePriceCheck[]> {
  if (!userId || userId.includes("/") || !householdId || householdId.includes("/")) throw new Error("識別子が不正です");
  const items = await getDocsFromServer(collection(db, "households", householdId, "items"));
  const results: PurchasePriceCheck[] = [];
  for (const snapshot of items.docs) {
    const item = snapshot.data();
    if (!Object.prototype.hasOwnProperty.call(item, "purchasePrice")) continue;
    const amount = item.purchasePrice, workspaceId = item.purchaseWorkspaceId;
    if (!Number.isSafeInteger(amount) || amount < 0 || typeof workspaceId !== "string" || !workspaceId || workspaceId.includes("/")) {
      results.push({ itemId: snapshot.id, status: "invalid" });
      continue;
    }
    try {
      const workspace = await getDocFromServer(doc(db, "workspaces", workspaceId));
      if (!workspace.exists()) { results.push({ itemId: snapshot.id, status: "unavailable" }); continue; }
      if (workspace.data().ownerUid !== userId) { results.push({ itemId: snapshot.id, status: "other-owner" }); continue; }
      const backup = await getDocFromServer(doc(db, "users", userId, "privatePurchasePrices", householdId, "items", snapshot.id));
      if (backup.exists()) {
        const previous = backup.data();
        if (previous.amount !== amount || previous.workspaceId !== workspaceId || previous.householdId !== householdId || previous.itemId !== snapshot.id) {
          results.push({ itemId: snapshot.id, status: "backup-conflict" });
          continue;
        }
      }
      results.push({ itemId: snapshot.id, status: "ready" });
    } catch {
      results.push({ itemId: snapshot.id, status: "unavailable" });
    }
  }
  return results;
}

/**
 * 共有在庫の購入金額を本人だけの領域へ退避して削除する。UI・本番への呼び出しは未接続。
 * 取引の所有者が判明したものだけ、1品ずつ同一トランザクションで処理する。
 */
export async function migrateSharedPurchasePrice(db: Firestore, userId: string, householdId: string, itemId: string): Promise<"migrated" | "no-price"> {
  for (const id of [userId, householdId, itemId]) {
    if (!id || id.includes("/")) throw new Error("識別子が不正です");
  }
  const itemRef = doc(db, "households", householdId, "items", itemId);
  const backupRef = doc(db, "users", userId, "privatePurchasePrices", householdId, "items", itemId);
  return runTransaction(db, async (transaction) => {
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists()) throw new Error("共有在庫が見つかりません");
    const item = itemSnapshot.data();
    if (!Object.prototype.hasOwnProperty.call(item, "purchasePrice")) return "no-price";
    const amount = item.purchasePrice;
    const workspaceId = item.purchaseWorkspaceId;
    if (!Number.isSafeInteger(amount) || amount < 0 || typeof workspaceId !== "string" || !workspaceId || workspaceId.includes("/")) {
      throw new Error("購入金額または家計の所有者を確認してください");
    }
    const workspace = await transaction.get(doc(db, "workspaces", workspaceId));
    if (!workspace.exists() || workspace.data().ownerUid !== userId) throw new Error("購入した家計の所有者を確認してください");
    const backup = await transaction.get(backupRef);
    if (backup.exists()) {
      const previous = backup.data();
      if (previous.amount !== amount || previous.workspaceId !== workspaceId || previous.householdId !== householdId || previous.itemId !== itemId) {
        throw new Error("個人の保管済み金額と一致しません");
      }
    } else {
      transaction.set(backupRef, { amount, workspaceId, householdId, itemId, savedAt: serverTimestamp() });
    }
    transaction.update(itemRef, { purchasePrice: deleteField() });
    return "migrated";
  });
}

/** 指定されたIDだけ処理する。開始時に再点検し、各品目のトランザクションでも再検証する。 */
export async function migrateSelectedPurchasePrices(db: Firestore, userId: string, householdId: string, itemIds: string[]): Promise<{ migrated: string[]; skipped: { itemId: string; reason: string }[] }> {
  if (!Array.isArray(itemIds) || itemIds.some(id => typeof id !== "string" || !id || id.includes("/")) || new Set(itemIds).size !== itemIds.length) throw new Error("対象の識別子が不正です");
  const checks = await inspectSharedPurchasePrices(db, userId, householdId);
  const byId = new Map(checks.map(check => [check.itemId, check.status]));
  const result: { migrated: string[]; skipped: { itemId: string; reason: string }[] } = { migrated: [], skipped: [] };
  for (const itemId of itemIds) {
    const status = byId.get(itemId);
    if (status !== "ready") { result.skipped.push({ itemId, reason: status || "not-found" }); continue; }
    try {
      const outcome = await migrateSharedPurchasePrice(db, userId, householdId, itemId);
      if (outcome === "migrated") result.migrated.push(itemId);
      else result.skipped.push({ itemId, reason: "no-price" });
    } catch {
      result.skipped.push({ itemId, reason: "changed-or-failed" });
    }
  }
  return result;
}
