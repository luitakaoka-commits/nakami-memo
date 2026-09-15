import {
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { Item } from "@/lib/types/item";
import { itemOutcomePatch, receiptLinePatches, type OutcomeChoice } from "@/lib/inventory/outcome-core";
import { db } from "./client";
import { itemDoc } from "./refs";

export type OutcomeResult = {
  /** お金管理のレシート明細に返せた行数。0 ならレシート由来ではない（手で足した在庫） */
  linesUpdated: number;
  /** 返した無駄金額の合計。0円なら無駄ではなかった（使い切った） */
  wasteTotal: number;
};

/**
 * 「使い切った」「捨てた」を記録する（Phase 4 手B）。
 *
 * 1. 在庫は**数量0にして残す**（消さない）
 * 2. その在庫のもとになったレシート明細（inventoryItemId が一致する行）に結末と無駄金額を返す
 *
 * 2 を探すのに workspace のIDが要る。「在庫に入れる」でお金管理が
 * purchaseWorkspaceId を在庫に書いているので、それを使う。無い在庫（手で足したもの、
 * この機能より前に入れたもの）は 1 だけ行う。
 *
 * 1 と 2 は同じバッチなので、途中で片方だけ書かれることはない。
 */
/**
 * その在庫のもとになったレシート明細を探す。
 *
 * 在庫に purchaseWorkspaceId があればそこだけを見る。
 * 無い在庫（この機能より前に「在庫に入れる」で入れたもの）のために、
 * 自分が入っている共有スペースを順に探す道も残す。手で足した在庫はどこにも当たらず、空で返る。
 */
async function findReceiptLines(userId: string, item: Item) {
  const workspaceIds: string[] = [];
  if (item.purchaseWorkspaceId) {
    workspaceIds.push(item.purchaseWorkspaceId);
  } else if (item.purchaseRef) {
    const mine = await getDocs(
      query(collection(db, "workspaces"), where("memberUids", "array-contains", userId)),
    );
    mine.forEach((workspace) => workspaceIds.push(workspace.id));
  }

  const found: QueryDocumentSnapshot<DocumentData>[] = [];
  for (const workspaceId of workspaceIds) {
    const lines = await getDocs(
      query(collection(db, "workspaces", workspaceId, "receiptItems"), where("inventoryItemId", "==", item.id)),
    );
    lines.forEach((line) => found.push(line));
  }
  return found;
}

export async function recordItemOutcome(userId: string, item: Item, choice: OutcomeChoice): Promise<OutcomeResult> {
  const patch = itemOutcomePatch(choice, new Date());
  const batch = writeBatch(db);
  batch.update(itemDoc(userId, item.id), { ...patch, updatedAt: serverTimestamp() });

  // 値引き行も同じ在庫に結びついているので、レシートごとに値引き後の額で無駄を出す
  const lines = await findReceiptLines(userId, item);
  const refs = new Map(lines.map((line) => [line.id, line.ref]));
  const { patches, wasteTotal } = receiptLinePatches(
    lines.map((line) => ({ id: line.id, receiptId: line.data().receiptId, amount: line.data().amount })),
    patch,
  );
  patches.forEach(({ id, patch: linePatch }) => {
    const ref = refs.get(id);
    if (ref) batch.update(ref, linePatch);
  });

  await batch.commit();
  return { linesUpdated: patches.length, wasteTotal };
}
