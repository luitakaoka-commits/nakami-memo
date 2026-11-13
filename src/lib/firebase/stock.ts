"use client";

import { doc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import type { User } from "firebase/auth";
import type { Item } from "@/lib/types/item";
import {
  japanDay, linkId, productKey, stockEventFor,
  type InventoryInsights, type ProductLink, type StockEvent, type StockEventKind,
} from "@/lib/inventory/stock-core";
import { db } from "./client";
import { itemDoc } from "./refs";
import { spaceCollection, spaceDoc } from "./space";

/*
 * 在庫AI（2026-11-14）の読み書き。
 *   stockEvents        「まだ残っている」「使い切った」「捨てた」の記録（在庫が消えても残る。家と共有）
 *   productLinks       本人が決めた「同じ商品／別の商品」（家と共有）
 *   inventoryInsights  在庫AIの結果（からだの記録を使うので、家ではなく本人の場所 users/{uid} だけ）
 */

/** 在庫に入れた日（YYYY-MM-DD）。createdAt が無ければ null */
export function sinceOf(item: Pick<Item, "createdAt">): string | null {
  const millis = item.createdAt?.toMillis?.();
  return typeof millis === "number" ? japanDay(millis) : null;
}

/** 記録1件のドキュメント（バッチに入れる用） */
export function newStockEventRef(userId: string) {
  return doc(spaceCollection(userId, "stockEvents"));
}

export function stockEventOf(item: Pick<Item, "id" | "name" | "quantity" | "unit" | "category" | "createdAt">, kind: StockEventKind): StockEvent {
  return stockEventFor({ ...item, since: sinceOf(item) }, kind, japanDay(Date.now()));
}

/** 「まだ残っている」：押した日を在庫と記録に残す（買い替え時の一覧から数日外れる） */
export async function recordStillRemaining(userId: string, item: Item) {
  const batch = writeBatch(db);
  batch.update(itemDoc(userId, item.id), { remainingCheckedAt: japanDay(Date.now()), updatedAt: serverTimestamp() });
  batch.set(newStockEventRef(userId), { ...stockEventOf(item, "remaining"), recordedAt: serverTimestamp() });
  await batch.commit();
}

export async function readStockEvents(userId: string): Promise<StockEvent[]> {
  const snapshot = await getDocs(spaceCollection(userId, "stockEvents"));
  return snapshot.docs.map((entry) => entry.data() as StockEvent);
}

export function watchProductLinks(userId: string, onData: (links: ProductLink[]) => void) {
  return onSnapshot(spaceCollection(userId, "productLinks"), (snapshot) => {
    onData(snapshot.docs.map((entry) => {
      const data = entry.data();
      return { a: String(data.a ?? ""), b: String(data.b ?? ""), same: data.same === true };
    }));
  }, () => onData([]));
}

/** 本人が「同じ／別」を決める。次から同じ商品として数える（別なら、もう聞かない） */
export async function decideSameProduct(userId: string, nameA: string, nameB: string, same: boolean) {
  const a = productKey(nameA);
  const b = productKey(nameB);
  await setDoc(spaceDoc(userId, "productLinks", linkId(a, b)), { a, b, nameA, nameB, same, decidedAt: serverTimestamp(), decidedBy: userId });
}

export type SavedInsights = InventoryInsights & { generatedAt: number; model: string; fallbackModel: string; usedHealth: boolean };

/** 在庫AIの結果は本人の場所に置く（からだの記録を使うので、同居人と共有する家には置かない） */
const insightsDoc = (userId: string) => doc(db, "users", userId, "inventoryInsights", "current");

export function watchInsights(userId: string, onData: (insights: SavedInsights | null) => void) {
  return onSnapshot(insightsDoc(userId), (snapshot) => onData(snapshot.exists() ? (snapshot.data() as SavedInsights) : null), () => onData(null));
}

export async function saveInsights(userId: string, insights: SavedInsights) {
  await setDoc(insightsDoc(userId), insights);
}

/** /api/inventory/insights を呼ぶ */
export async function requestInsights(user: User): Promise<SavedInsights> {
  const idToken = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch("/api/inventory/insights", { method: "POST", headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new Error("通信できませんでした。電波の良いところでお試しください。");
  }
  const data = (await response.json().catch(() => ({}))) as Partial<SavedInsights> & { error?: string };
  if (!response.ok) throw new Error(data.error || "在庫AIが考えられませんでした。");
  return {
    samePairs: Array.isArray(data.samePairs) ? data.samePairs : [],
    nutrition: data.nutrition ?? null,
    shopping: Array.isArray(data.shopping) ? data.shopping : [],
    generatedAt: Date.now(),
    model: String(data.model ?? ""),
    fallbackModel: String(data.fallbackModel ?? ""),
    usedHealth: data.usedHealth === true,
  };
}

/** つくりおきノートの買い物リストに入れる（同じ名前がまだ買っていない行にあれば入れない）。入れた数を返す */
export async function addToShoppingList(userId: string, names: string[], reason: string): Promise<number> {
  const snapshot = await getDocs(spaceCollection(userId, "shopping"));
  const existing = new Set(snapshot.docs.filter((entry) => !entry.data().done).map((entry) => productKey(String(entry.data().name ?? ""))));
  const batch = writeBatch(db);
  let added = 0;
  names.forEach((name, index) => {
    const key = productKey(name);
    if (!key || existing.has(key)) return;
    existing.add(key);
    // つくりおきノートの買い物リストと同じ形（normalizeShoppingItem）。recipeTitle に「どこから来たか」を入れる
    batch.set(doc(spaceCollection(userId, "shopping")), { name, recipeTitle: reason, done: false, createdAt: Date.now() + index });
    added++;
  });
  if (added) await batch.commit();
  return added;
}
