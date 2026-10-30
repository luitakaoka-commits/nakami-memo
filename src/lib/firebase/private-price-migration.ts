import { deleteField, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";

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
