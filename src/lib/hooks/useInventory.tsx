"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Area } from "@/lib/types/area";
import type { Item, ItemWithLocation } from "@/lib/types/item";
import type { Location } from "@/lib/types/location";
import { getExpiringItems, isLowStock, joinItemsWithLocations } from "@/lib/utils/inventory";
import { useAreas } from "./useAreas";
import { useAuth } from "./useAuth";
import { useItems } from "./useItems";
import { useLocations } from "./useLocations";

export type InventoryValue = {
  areas: Area[];
  locations: Location[];
  items: Item[];
  /** areas / locations と結合済みのアイテム。areas・locations が揃ってから使うこと。 */
  itemsWithLocation: ItemWithLocation[];
  /** areas / locations / items のいずれかが未到着なら true。 */
  loading: boolean;
  /** 最初に発生したFirestoreエラー（権限・オフライン・インデックス欠如など）。 */
  error: Error | null;
};

const InventoryContext = createContext<InventoryValue | null>(null);

/**
 * areas / locations / items のリスナーをアプリ全体で1本ずつに集約する。
 * 以前は各画面が個別に useAreas などを呼び、同一ページ内でもリスナーが重複していた。
 */
export function InventoryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { areas, loading: areasLoading, error: areasError } = useAreas(user?.uid);
  const { locations, loading: locationsLoading, error: locationsError } = useLocations(user?.uid);
  const { items, loading: itemsLoading, error: itemsError } = useItems(user?.uid);

  const value = useMemo<InventoryValue>(
    () => ({
      areas,
      locations,
      items,
      itemsWithLocation: joinItemsWithLocations(items, locations, areas),
      loading: areasLoading || locationsLoading || itemsLoading,
      error: areasError ?? locationsError ?? itemsError,
    }),
    [areas, areasError, areasLoading, items, itemsError, itemsLoading, locations, locationsError, locationsLoading],
  );

  /* アプリ切り替えシートに出す「今の状態」を1行で書き残す。
     window.__appStatus は共有の切り替えバー（public/shared/app-switcher.js）が用意する。
     期限を最優先にしているのは、それが一番「開く理由」になるため。 */
  useEffect(() => {
    const publish = (window as unknown as { __appStatus?: (text: string) => void }).__appStatus;
    if (typeof publish !== "function" || value.loading) return;

    const expiring = getExpiringItems(value.items).length;
    if (expiring) { publish(`期限が近い ${expiring}件`); return; }

    const low = value.items.filter(isLowStock).length;
    if (low) { publish(`在庫が少ない ${low}件`); return; }

    publish(value.items.length ? `在庫 ${value.items.length}件` : "在庫はまだありません");
  }, [value.items, value.loading]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory(): InventoryValue {
  const value = useContext(InventoryContext);
  if (!value) throw new Error("useInventory は InventoryProvider の内側で使ってください。");
  return value;
}

/** 一覧カードに出す「エリア / 保管場所」表記。 */
export function locationLabelOf(item: ItemWithLocation) {
  return `${item.areaName} / ${item.locationName}`;
}
