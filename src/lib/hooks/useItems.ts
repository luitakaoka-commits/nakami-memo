"use client";

import { useCallback } from "react";
import type { Item } from "@/lib/types/item";
import { itemsQuery, snapToItem } from "@/lib/firebase/firestore";
import { sortByJapaneseName } from "@/lib/utils/inventory";
import { useCollection } from "./useCollection";

export function useItems(userId?: string, locationId?: string) {
  const buildQuery = useCallback(() => (userId ? itemsQuery(userId, locationId) : null), [userId, locationId]);
  const { data, loading, error } = useCollection<Item>(buildQuery, snapToItem, sortByJapaneseName);
  return { items: data, loading, error };
}
