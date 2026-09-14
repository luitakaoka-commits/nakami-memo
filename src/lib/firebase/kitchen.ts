import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { SavedRecipe } from "@/lib/types/recipe";
import type { Tool, ToolInput } from "@/lib/types/tool";
import { itemOutcomePatch, receiptLinePatch } from "@/lib/inventory/outcome-core";
import { remainingQuantity } from "@/lib/recipes/suggest-core";
import { db } from "./client";
import { syncPublicByLocationIfNeeded } from "./public-location";

/*
 * レシピ提案（Phase 3）で使う、台所まわりの読み書き。
 *   users/{uid}/tools         調理器具（なかみメモ）
 *   users/{uid}/consumptions  「作った」で在庫を減らした記録（なかみメモ）
 *   users/{uid}/recipes       つくりおきノートのレシピ（2026-09-14 に同じ Firebase にまとめたので直接書ける）
 * どれも public/money/firestore.rules の allowedUserCollection に入っている。
 */

export const toolsCollection = (userId: string) => collection(db, "users", userId, "tools");
export const toolsQuery = (userId: string) => query(toolsCollection(userId), orderBy("name"));

export function snapToTool(snapshot: QueryDocumentSnapshot<DocumentData>): Tool {
  return { id: snapshot.id, ...snapshot.data() } as Tool;
}

function toolFields(input: ToolInput) {
  return {
    name: input.name.trim(),
    type: input.type,
    sizeLabel: input.sizeLabel?.trim() || null,
    features: input.features,
    memo: input.memo?.trim() || null,
  };
}

export async function createTool(userId: string, input: ToolInput) {
  return addDoc(toolsCollection(userId), { ...toolFields(input), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function updateTool(userId: string, toolId: string, input: ToolInput) {
  const fields = toolFields(input);
  await updateDoc(doc(toolsCollection(userId), toolId), {
    ...fields,
    // 空にした項目は消す（null を残さない）
    sizeLabel: fields.sizeLabel ?? deleteField(),
    memo: fields.memo ?? deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTool(userId: string, toolId: string) {
  await deleteDoc(doc(toolsCollection(userId), toolId));
}

/* ---------- つくりおきノートに保存したレシピ（なかみメモからは履歴として見る） ---------- */

export const savedRecipesCollection = (userId: string) => collection(db, "users", userId, "recipes");
export const savedRecipesQuery = (userId: string) => query(savedRecipesCollection(userId), orderBy("createdAt", "desc"));

export function snapToSavedRecipe(snapshot: QueryDocumentSnapshot<DocumentData>): SavedRecipe {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    title: String(data.title ?? "無題のレシピ"),
    category: String(data.category ?? "その他"),
    servings: Number(data.servings) || 0,
    ingredients: Array.isArray(data.ingredients) ? data.ingredients.map(String) : [],
    steps: Array.isArray(data.steps) ? data.steps.map(String) : [],
    memo: String(data.memo ?? ""),
    source: String(data.source ?? ""),
    createdAt: Number(data.createdAt) || 0,
    lastCookedAt: Number(data.lastCookedAt) || 0,
  };
}

export async function deleteSavedRecipe(userId: string, recipeId: string) {
  await deleteDoc(doc(savedRecipesCollection(userId), recipeId));
}

/** つくりおきノートにレシピを1件保存し、そのIDを返す。形は suggest-core の toTsukuriokiRecipe で作る。 */
export async function saveRecipeToTsukurioki(userId: string, recipe: Record<string, unknown>): Promise<string> {
  const ref = doc(collection(db, "users", userId, "recipes"));
  await setDoc(ref, recipe);
  return ref.id;
}

export type CookedRow = {
  itemId: string;
  name: string;
  unit: string;
  /** 今の在庫数量（画面が持っている最新の値）。 */
  available: number;
  /** 減らす量。0 の行は触らない。 */
  use: number;
  /** 単位が噛み合わないときの注意（「本」の在庫を mL で使う、など）。 */
  note?: string;
  locationId?: string;
  /** レシートから入れた在庫だけが持つ。使い切ったときに、お金管理の明細へ返す先（2026-09-16）。 */
  purchaseWorkspaceId?: string;
};

/**
 * 「作った」。在庫を減らし、消費の記録を残す。まとめて1回で書くので、途中まで減る、は起きない。
 * 数量が0になっても在庫からは消さない（「少ない」の一覧に出て、買い足しの目安になる）。
 * つくりおきノートに保存済みのレシピなら、その「最後に作った日」も更新する。
 */
export async function recordCooking(userId: string, rows: CookedRow[], recipeTitle: string, savedRecipeId?: string | null) {
  const targets = rows.filter((row) => row.use > 0);
  const batch = writeBatch(db);
  // 料理で使い切った分は「使い切った」として記録し、お金管理の明細にも返す（2026-09-16）。
  // 返さないと、使い切ったのに週1回のふりかえりで何度も聞かれる。使い切ったので無駄は0円。
  const consumed = itemOutcomePatch({ kind: "consumed" }, new Date());
  for (const row of targets) {
    const usedUp = remainingQuantity(row.available, row.use) === 0;
    batch.update(doc(db, "users", userId, "items", row.itemId), {
      quantity: remainingQuantity(row.available, row.use),
      ...(usedUp ? { outcome: consumed.outcome, outcomeAt: consumed.outcomeAt, outcomeReason: consumed.outcomeReason } : {}),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(db, "users", userId, "consumptions")), {
      itemId: row.itemId,
      itemName: row.name,
      quantity: row.use,
      unit: row.unit,
      reason: "調理",
      recipeTitle,
      at: serverTimestamp(),
    });
  }
  if (savedRecipeId) {
    batch.update(doc(db, "users", userId, "recipes", savedRecipeId), { lastCookedAt: Date.now() });
  }

  for (const row of targets) {
    if (!row.purchaseWorkspaceId || remainingQuantity(row.available, row.use) !== 0) continue;
    const lines = await getDocs(
      query(collection(db, "workspaces", row.purchaseWorkspaceId, "receiptItems"), where("inventoryItemId", "==", row.itemId)),
    );
    lines.forEach((line) => batch.update(line.ref, receiptLinePatch(line.data(), consumed)));
  }

  await batch.commit();

  // 公開中の保管場所なら、公開ページの数量も合わせる（失敗しても在庫の更新は済んでいるので、黙って続ける）
  const locationIds = [...new Set(targets.map((row) => row.locationId).filter((id): id is string => Boolean(id)))];
  await Promise.all(locationIds.map((locationId) => syncPublicByLocationIfNeeded(userId, locationId).catch(() => undefined)));
  return targets.length;
}
